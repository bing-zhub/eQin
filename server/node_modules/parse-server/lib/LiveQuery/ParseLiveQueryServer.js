'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ParseLiveQueryServer = undefined;

var _tv = require('tv4');

var _tv2 = _interopRequireDefault(_tv);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _Subscription = require('./Subscription');

var _Client = require('./Client');

var _ParseWebSocketServer = require('./ParseWebSocketServer');

var _logger = require('../logger');

var _logger2 = _interopRequireDefault(_logger);

var _RequestSchema = require('./RequestSchema');

var _RequestSchema2 = _interopRequireDefault(_RequestSchema);

var _QueryTools = require('./QueryTools');

var _ParsePubSub = require('./ParsePubSub');

var _SessionTokenCache = require('./SessionTokenCache');

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _uuid = require('uuid');

var _uuid2 = _interopRequireDefault(_uuid);

var _triggers = require('../triggers');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class ParseLiveQueryServer {
  // className -> (queryHash -> subscription)
  constructor(server, config) {
    this.server = server;
    this.clients = new Map();
    this.subscriptions = new Map();

    config = config || {};

    // Store keys, convert obj to map
    const keyPairs = config.keyPairs || {};
    this.keyPairs = new Map();
    for (const key of Object.keys(keyPairs)) {
      this.keyPairs.set(key, keyPairs[key]);
    }
    _logger2.default.verbose('Support key pairs', this.keyPairs);

    // Initialize Parse
    _node2.default.Object.disableSingleInstance();

    const serverURL = config.serverURL || _node2.default.serverURL;
    _node2.default.serverURL = serverURL;
    const appId = config.appId || _node2.default.applicationId;
    const javascriptKey = _node2.default.javaScriptKey;
    const masterKey = config.masterKey || _node2.default.masterKey;
    _node2.default.initialize(appId, javascriptKey, masterKey);

    // Initialize websocket server
    this.parseWebSocketServer = new _ParseWebSocketServer.ParseWebSocketServer(server, parseWebsocket => this._onConnect(parseWebsocket), config.websocketTimeout);

    // Initialize subscriber
    this.subscriber = _ParsePubSub.ParsePubSub.createSubscriber(config);
    this.subscriber.subscribe(_node2.default.applicationId + 'afterSave');
    this.subscriber.subscribe(_node2.default.applicationId + 'afterDelete');
    // Register message handler for subscriber. When publisher get messages, it will publish message
    // to the subscribers and the handler will be called.
    this.subscriber.on('message', (channel, messageStr) => {
      _logger2.default.verbose('Subscribe messsage %j', messageStr);
      let message;
      try {
        message = JSON.parse(messageStr);
      } catch (e) {
        _logger2.default.error('unable to parse message', messageStr, e);
        return;
      }
      this._inflateParseObject(message);
      if (channel === _node2.default.applicationId + 'afterSave') {
        this._onAfterSave(message);
      } else if (channel === _node2.default.applicationId + 'afterDelete') {
        this._onAfterDelete(message);
      } else {
        _logger2.default.error('Get message %s from unknown channel %j', message, channel);
      }
    });

    // Initialize sessionToken cache
    this.sessionTokenCache = new _SessionTokenCache.SessionTokenCache(config.cacheTimeout);
  }

  // Message is the JSON object from publisher. Message.currentParseObject is the ParseObject JSON after changes.
  // Message.originalParseObject is the original ParseObject JSON.

  // The subscriber we use to get object update from publisher
  _inflateParseObject(message) {
    // Inflate merged object
    const currentParseObject = message.currentParseObject;
    let className = currentParseObject.className;
    let parseObject = new _node2.default.Object(className);
    parseObject._finishFetch(currentParseObject);
    message.currentParseObject = parseObject;
    // Inflate original object
    const originalParseObject = message.originalParseObject;
    if (originalParseObject) {
      className = originalParseObject.className;
      parseObject = new _node2.default.Object(className);
      parseObject._finishFetch(originalParseObject);
      message.originalParseObject = parseObject;
    }
  }

  // Message is the JSON object from publisher after inflated. Message.currentParseObject is the ParseObject after changes.
  // Message.originalParseObject is the original ParseObject.
  _onAfterDelete(message) {
    _logger2.default.verbose(_node2.default.applicationId + 'afterDelete is triggered');

    const deletedParseObject = message.currentParseObject.toJSON();
    const className = deletedParseObject.className;
    _logger2.default.verbose('ClassName: %j | ObjectId: %s', className, deletedParseObject.id);
    _logger2.default.verbose('Current client number : %d', this.clients.size);

    const classSubscriptions = this.subscriptions.get(className);
    if (typeof classSubscriptions === 'undefined') {
      _logger2.default.debug('Can not find subscriptions under this class ' + className);
      return;
    }
    for (const subscription of classSubscriptions.values()) {
      const isSubscriptionMatched = this._matchesSubscription(deletedParseObject, subscription);
      if (!isSubscriptionMatched) {
        continue;
      }
      for (const [clientId, requestIds] of _lodash2.default.entries(subscription.clientRequestIds)) {
        const client = this.clients.get(clientId);
        if (typeof client === 'undefined') {
          continue;
        }
        for (const requestId of requestIds) {
          const acl = message.currentParseObject.getACL();
          // Check ACL
          this._matchesACL(acl, client, requestId).then(isMatched => {
            if (!isMatched) {
              return null;
            }
            client.pushDelete(requestId, deletedParseObject);
          }, error => {
            _logger2.default.error('Matching ACL error : ', error);
          });
        }
      }
    }
  }

  // Message is the JSON object from publisher after inflated. Message.currentParseObject is the ParseObject after changes.
  // Message.originalParseObject is the original ParseObject.
  _onAfterSave(message) {
    _logger2.default.verbose(_node2.default.applicationId + 'afterSave is triggered');

    let originalParseObject = null;
    if (message.originalParseObject) {
      originalParseObject = message.originalParseObject.toJSON();
    }
    const currentParseObject = message.currentParseObject.toJSON();
    const className = currentParseObject.className;
    _logger2.default.verbose('ClassName: %s | ObjectId: %s', className, currentParseObject.id);
    _logger2.default.verbose('Current client number : %d', this.clients.size);

    const classSubscriptions = this.subscriptions.get(className);
    if (typeof classSubscriptions === 'undefined') {
      _logger2.default.debug('Can not find subscriptions under this class ' + className);
      return;
    }
    for (const subscription of classSubscriptions.values()) {
      const isOriginalSubscriptionMatched = this._matchesSubscription(originalParseObject, subscription);
      const isCurrentSubscriptionMatched = this._matchesSubscription(currentParseObject, subscription);
      for (const [clientId, requestIds] of _lodash2.default.entries(subscription.clientRequestIds)) {
        const client = this.clients.get(clientId);
        if (typeof client === 'undefined') {
          continue;
        }
        for (const requestId of requestIds) {
          // Set orignal ParseObject ACL checking promise, if the object does not match
          // subscription, we do not need to check ACL
          let originalACLCheckingPromise;
          if (!isOriginalSubscriptionMatched) {
            originalACLCheckingPromise = _node2.default.Promise.as(false);
          } else {
            let originalACL;
            if (message.originalParseObject) {
              originalACL = message.originalParseObject.getACL();
            }
            originalACLCheckingPromise = this._matchesACL(originalACL, client, requestId);
          }
          // Set current ParseObject ACL checking promise, if the object does not match
          // subscription, we do not need to check ACL
          let currentACLCheckingPromise;
          if (!isCurrentSubscriptionMatched) {
            currentACLCheckingPromise = _node2.default.Promise.as(false);
          } else {
            const currentACL = message.currentParseObject.getACL();
            currentACLCheckingPromise = this._matchesACL(currentACL, client, requestId);
          }

          _node2.default.Promise.when(originalACLCheckingPromise, currentACLCheckingPromise).then((isOriginalMatched, isCurrentMatched) => {
            _logger2.default.verbose('Original %j | Current %j | Match: %s, %s, %s, %s | Query: %s', originalParseObject, currentParseObject, isOriginalSubscriptionMatched, isCurrentSubscriptionMatched, isOriginalMatched, isCurrentMatched, subscription.hash);

            // Decide event type
            let type;
            if (isOriginalMatched && isCurrentMatched) {
              type = 'Update';
            } else if (isOriginalMatched && !isCurrentMatched) {
              type = 'Leave';
            } else if (!isOriginalMatched && isCurrentMatched) {
              if (originalParseObject) {
                type = 'Enter';
              } else {
                type = 'Create';
              }
            } else {
              return null;
            }
            const functionName = 'push' + type;
            client[functionName](requestId, currentParseObject);
          }, error => {
            _logger2.default.error('Matching ACL error : ', error);
          });
        }
      }
    }
  }

  _onConnect(parseWebsocket) {
    parseWebsocket.on('message', request => {
      if (typeof request === 'string') {
        try {
          request = JSON.parse(request);
        } catch (e) {
          _logger2.default.error('unable to parse request', request, e);
          return;
        }
      }
      _logger2.default.verbose('Request: %j', request);

      // Check whether this request is a valid request, return error directly if not
      if (!_tv2.default.validate(request, _RequestSchema2.default['general']) || !_tv2.default.validate(request, _RequestSchema2.default[request.op])) {
        _Client.Client.pushError(parseWebsocket, 1, _tv2.default.error.message);
        _logger2.default.error('Connect message error %s', _tv2.default.error.message);
        return;
      }

      switch (request.op) {
        case 'connect':
          this._handleConnect(parseWebsocket, request);
          break;
        case 'subscribe':
          this._handleSubscribe(parseWebsocket, request);
          break;
        case 'update':
          this._handleUpdateSubscription(parseWebsocket, request);
          break;
        case 'unsubscribe':
          this._handleUnsubscribe(parseWebsocket, request);
          break;
        default:
          _Client.Client.pushError(parseWebsocket, 3, 'Get unknown operation');
          _logger2.default.error('Get unknown operation', request.op);
      }
    });

    parseWebsocket.on('disconnect', () => {
      _logger2.default.info(`Client disconnect: ${parseWebsocket.clientId}`);
      const clientId = parseWebsocket.clientId;
      if (!this.clients.has(clientId)) {
        (0, _triggers.runLiveQueryEventHandlers)({
          event: 'ws_disconnect_error',
          clients: this.clients.size,
          subscriptions: this.subscriptions.size,
          error: `Unable to find client ${clientId}`
        });
        _logger2.default.error(`Can not find client ${clientId} on disconnect`);
        return;
      }

      // Delete client
      const client = this.clients.get(clientId);
      this.clients.delete(clientId);

      // Delete client from subscriptions
      for (const [requestId, subscriptionInfo] of _lodash2.default.entries(client.subscriptionInfos)) {
        const subscription = subscriptionInfo.subscription;
        subscription.deleteClientSubscription(clientId, requestId);

        // If there is no client which is subscribing this subscription, remove it from subscriptions
        const classSubscriptions = this.subscriptions.get(subscription.className);
        if (!subscription.hasSubscribingClient()) {
          classSubscriptions.delete(subscription.hash);
        }
        // If there is no subscriptions under this class, remove it from subscriptions
        if (classSubscriptions.size === 0) {
          this.subscriptions.delete(subscription.className);
        }
      }

      _logger2.default.verbose('Current clients %d', this.clients.size);
      _logger2.default.verbose('Current subscriptions %d', this.subscriptions.size);
      (0, _triggers.runLiveQueryEventHandlers)({
        event: 'ws_disconnect',
        clients: this.clients.size,
        subscriptions: this.subscriptions.size
      });
    });

    (0, _triggers.runLiveQueryEventHandlers)({
      event: 'ws_connect',
      clients: this.clients.size,
      subscriptions: this.subscriptions.size
    });
  }

  _matchesSubscription(parseObject, subscription) {
    // Object is undefined or null, not match
    if (!parseObject) {
      return false;
    }
    return (0, _QueryTools.matchesQuery)(parseObject, subscription.query);
  }

  _matchesACL(acl, client, requestId) {
    // Return true directly if ACL isn't present, ACL is public read, or client has master key
    if (!acl || acl.getPublicReadAccess() || client.hasMasterKey) {
      return _node2.default.Promise.as(true);
    }
    // Check subscription sessionToken matches ACL first
    const subscriptionInfo = client.getSubscriptionInfo(requestId);
    if (typeof subscriptionInfo === 'undefined') {
      return _node2.default.Promise.as(false);
    }

    const subscriptionSessionToken = subscriptionInfo.sessionToken;
    return this.sessionTokenCache.getUserId(subscriptionSessionToken).then(userId => {
      return acl.getReadAccess(userId);
    }).then(isSubscriptionSessionTokenMatched => {
      if (isSubscriptionSessionTokenMatched) {
        return _node2.default.Promise.as(true);
      }

      // Check if the user has any roles that match the ACL
      return new _node2.default.Promise((resolve, reject) => {

        // Resolve false right away if the acl doesn't have any roles
        const acl_has_roles = Object.keys(acl.permissionsById).some(key => key.startsWith("role:"));
        if (!acl_has_roles) {
          return resolve(false);
        }

        this.sessionTokenCache.getUserId(subscriptionSessionToken).then(userId => {

          // Pass along a null if there is no user id
          if (!userId) {
            return _node2.default.Promise.as(null);
          }

          // Prepare a user object to query for roles
          // To eliminate a query for the user, create one locally with the id
          var user = new _node2.default.User();
          user.id = userId;
          return user;
        }).then(user => {

          // Pass along an empty array (of roles) if no user
          if (!user) {
            return _node2.default.Promise.as([]);
          }

          // Then get the user's roles
          var rolesQuery = new _node2.default.Query(_node2.default.Role);
          rolesQuery.equalTo("users", user);
          return rolesQuery.find({ useMasterKey: true });
        }).then(roles => {

          // Finally, see if any of the user's roles allow them read access
          for (const role of roles) {
            if (acl.getRoleReadAccess(role)) {
              return resolve(true);
            }
          }
          resolve(false);
        }).catch(error => {
          reject(error);
        });
      });
    }).then(isRoleMatched => {

      if (isRoleMatched) {
        return _node2.default.Promise.as(true);
      }

      // Check client sessionToken matches ACL
      const clientSessionToken = client.sessionToken;
      return this.sessionTokenCache.getUserId(clientSessionToken).then(userId => {
        return acl.getReadAccess(userId);
      });
    }).then(isMatched => {
      return _node2.default.Promise.as(isMatched);
    }, () => {
      return _node2.default.Promise.as(false);
    });
  }

  _handleConnect(parseWebsocket, request) {
    if (!this._validateKeys(request, this.keyPairs)) {
      _Client.Client.pushError(parseWebsocket, 4, 'Key in request is not valid');
      _logger2.default.error('Key in request is not valid');
      return;
    }
    const hasMasterKey = this._hasMasterKey(request, this.keyPairs);
    const clientId = (0, _uuid2.default)();
    const client = new _Client.Client(clientId, parseWebsocket, hasMasterKey);
    parseWebsocket.clientId = clientId;
    this.clients.set(parseWebsocket.clientId, client);
    _logger2.default.info(`Create new client: ${parseWebsocket.clientId}`);
    client.pushConnect();
    (0, _triggers.runLiveQueryEventHandlers)({
      event: 'connect',
      clients: this.clients.size,
      subscriptions: this.subscriptions.size
    });
  }

  _hasMasterKey(request, validKeyPairs) {
    if (!validKeyPairs || validKeyPairs.size == 0 || !validKeyPairs.has("masterKey")) {
      return false;
    }
    if (!request || !request.hasOwnProperty("masterKey")) {
      return false;
    }
    return request.masterKey === validKeyPairs.get("masterKey");
  }

  _validateKeys(request, validKeyPairs) {
    if (!validKeyPairs || validKeyPairs.size == 0) {
      return true;
    }
    let isValid = false;
    for (const [key, secret] of validKeyPairs) {
      if (!request[key] || request[key] !== secret) {
        continue;
      }
      isValid = true;
      break;
    }
    return isValid;
  }

  _handleSubscribe(parseWebsocket, request) {
    // If we can not find this client, return error to client
    if (!parseWebsocket.hasOwnProperty('clientId')) {
      _Client.Client.pushError(parseWebsocket, 2, 'Can not find this client, make sure you connect to server before subscribing');
      _logger2.default.error('Can not find this client, make sure you connect to server before subscribing');
      return;
    }
    const client = this.clients.get(parseWebsocket.clientId);

    // Get subscription from subscriptions, create one if necessary
    const subscriptionHash = (0, _QueryTools.queryHash)(request.query);
    // Add className to subscriptions if necessary
    const className = request.query.className;
    if (!this.subscriptions.has(className)) {
      this.subscriptions.set(className, new Map());
    }
    const classSubscriptions = this.subscriptions.get(className);
    let subscription;
    if (classSubscriptions.has(subscriptionHash)) {
      subscription = classSubscriptions.get(subscriptionHash);
    } else {
      subscription = new _Subscription.Subscription(className, request.query.where, subscriptionHash);
      classSubscriptions.set(subscriptionHash, subscription);
    }

    // Add subscriptionInfo to client
    const subscriptionInfo = {
      subscription: subscription
    };
    // Add selected fields and sessionToken for this subscription if necessary
    if (request.query.fields) {
      subscriptionInfo.fields = request.query.fields;
    }
    if (request.sessionToken) {
      subscriptionInfo.sessionToken = request.sessionToken;
    }
    client.addSubscriptionInfo(request.requestId, subscriptionInfo);

    // Add clientId to subscription
    subscription.addClientSubscription(parseWebsocket.clientId, request.requestId);

    client.pushSubscribe(request.requestId);

    _logger2.default.verbose(`Create client ${parseWebsocket.clientId} new subscription: ${request.requestId}`);
    _logger2.default.verbose('Current client number: %d', this.clients.size);
    (0, _triggers.runLiveQueryEventHandlers)({
      event: 'subscribe',
      clients: this.clients.size,
      subscriptions: this.subscriptions.size
    });
  }

  _handleUpdateSubscription(parseWebsocket, request) {
    this._handleUnsubscribe(parseWebsocket, request, false);
    this._handleSubscribe(parseWebsocket, request);
  }

  _handleUnsubscribe(parseWebsocket, request, notifyClient = true) {
    // If we can not find this client, return error to client
    if (!parseWebsocket.hasOwnProperty('clientId')) {
      _Client.Client.pushError(parseWebsocket, 2, 'Can not find this client, make sure you connect to server before unsubscribing');
      _logger2.default.error('Can not find this client, make sure you connect to server before unsubscribing');
      return;
    }
    const requestId = request.requestId;
    const client = this.clients.get(parseWebsocket.clientId);
    if (typeof client === 'undefined') {
      _Client.Client.pushError(parseWebsocket, 2, 'Cannot find client with clientId ' + parseWebsocket.clientId + '. Make sure you connect to live query server before unsubscribing.');
      _logger2.default.error('Can not find this client ' + parseWebsocket.clientId);
      return;
    }

    const subscriptionInfo = client.getSubscriptionInfo(requestId);
    if (typeof subscriptionInfo === 'undefined') {
      _Client.Client.pushError(parseWebsocket, 2, 'Cannot find subscription with clientId ' + parseWebsocket.clientId + ' subscriptionId ' + requestId + '. Make sure you subscribe to live query server before unsubscribing.');
      _logger2.default.error('Can not find subscription with clientId ' + parseWebsocket.clientId + ' subscriptionId ' + requestId);
      return;
    }

    // Remove subscription from client
    client.deleteSubscriptionInfo(requestId);
    // Remove client from subscription
    const subscription = subscriptionInfo.subscription;
    const className = subscription.className;
    subscription.deleteClientSubscription(parseWebsocket.clientId, requestId);
    // If there is no client which is subscribing this subscription, remove it from subscriptions
    const classSubscriptions = this.subscriptions.get(className);
    if (!subscription.hasSubscribingClient()) {
      classSubscriptions.delete(subscription.hash);
    }
    // If there is no subscriptions under this class, remove it from subscriptions
    if (classSubscriptions.size === 0) {
      this.subscriptions.delete(className);
    }
    (0, _triggers.runLiveQueryEventHandlers)({
      event: 'unsubscribe',
      clients: this.clients.size,
      subscriptions: this.subscriptions.size
    });

    if (!notifyClient) {
      return;
    }

    client.pushUnsubscribe(request.requestId);

    _logger2.default.verbose(`Delete client: ${parseWebsocket.clientId} | subscription: ${request.requestId}`);
  }
}

exports.ParseLiveQueryServer = ParseLiveQueryServer;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9MaXZlUXVlcnkvUGFyc2VMaXZlUXVlcnlTZXJ2ZXIuanMiXSwibmFtZXMiOlsiUGFyc2VMaXZlUXVlcnlTZXJ2ZXIiLCJjb25zdHJ1Y3RvciIsInNlcnZlciIsImNvbmZpZyIsImNsaWVudHMiLCJNYXAiLCJzdWJzY3JpcHRpb25zIiwia2V5UGFpcnMiLCJrZXkiLCJPYmplY3QiLCJrZXlzIiwic2V0IiwibG9nZ2VyIiwidmVyYm9zZSIsIlBhcnNlIiwiZGlzYWJsZVNpbmdsZUluc3RhbmNlIiwic2VydmVyVVJMIiwiYXBwSWQiLCJhcHBsaWNhdGlvbklkIiwiamF2YXNjcmlwdEtleSIsImphdmFTY3JpcHRLZXkiLCJtYXN0ZXJLZXkiLCJpbml0aWFsaXplIiwicGFyc2VXZWJTb2NrZXRTZXJ2ZXIiLCJQYXJzZVdlYlNvY2tldFNlcnZlciIsInBhcnNlV2Vic29ja2V0IiwiX29uQ29ubmVjdCIsIndlYnNvY2tldFRpbWVvdXQiLCJzdWJzY3JpYmVyIiwiUGFyc2VQdWJTdWIiLCJjcmVhdGVTdWJzY3JpYmVyIiwic3Vic2NyaWJlIiwib24iLCJjaGFubmVsIiwibWVzc2FnZVN0ciIsIm1lc3NhZ2UiLCJKU09OIiwicGFyc2UiLCJlIiwiZXJyb3IiLCJfaW5mbGF0ZVBhcnNlT2JqZWN0IiwiX29uQWZ0ZXJTYXZlIiwiX29uQWZ0ZXJEZWxldGUiLCJzZXNzaW9uVG9rZW5DYWNoZSIsIlNlc3Npb25Ub2tlbkNhY2hlIiwiY2FjaGVUaW1lb3V0IiwiY3VycmVudFBhcnNlT2JqZWN0IiwiY2xhc3NOYW1lIiwicGFyc2VPYmplY3QiLCJfZmluaXNoRmV0Y2giLCJvcmlnaW5hbFBhcnNlT2JqZWN0IiwiZGVsZXRlZFBhcnNlT2JqZWN0IiwidG9KU09OIiwiaWQiLCJzaXplIiwiY2xhc3NTdWJzY3JpcHRpb25zIiwiZ2V0IiwiZGVidWciLCJzdWJzY3JpcHRpb24iLCJ2YWx1ZXMiLCJpc1N1YnNjcmlwdGlvbk1hdGNoZWQiLCJfbWF0Y2hlc1N1YnNjcmlwdGlvbiIsImNsaWVudElkIiwicmVxdWVzdElkcyIsIl8iLCJlbnRyaWVzIiwiY2xpZW50UmVxdWVzdElkcyIsImNsaWVudCIsInJlcXVlc3RJZCIsImFjbCIsImdldEFDTCIsIl9tYXRjaGVzQUNMIiwidGhlbiIsImlzTWF0Y2hlZCIsInB1c2hEZWxldGUiLCJpc09yaWdpbmFsU3Vic2NyaXB0aW9uTWF0Y2hlZCIsImlzQ3VycmVudFN1YnNjcmlwdGlvbk1hdGNoZWQiLCJvcmlnaW5hbEFDTENoZWNraW5nUHJvbWlzZSIsIlByb21pc2UiLCJhcyIsIm9yaWdpbmFsQUNMIiwiY3VycmVudEFDTENoZWNraW5nUHJvbWlzZSIsImN1cnJlbnRBQ0wiLCJ3aGVuIiwiaXNPcmlnaW5hbE1hdGNoZWQiLCJpc0N1cnJlbnRNYXRjaGVkIiwiaGFzaCIsInR5cGUiLCJmdW5jdGlvbk5hbWUiLCJyZXF1ZXN0IiwidHY0IiwidmFsaWRhdGUiLCJSZXF1ZXN0U2NoZW1hIiwib3AiLCJDbGllbnQiLCJwdXNoRXJyb3IiLCJfaGFuZGxlQ29ubmVjdCIsIl9oYW5kbGVTdWJzY3JpYmUiLCJfaGFuZGxlVXBkYXRlU3Vic2NyaXB0aW9uIiwiX2hhbmRsZVVuc3Vic2NyaWJlIiwiaW5mbyIsImhhcyIsImV2ZW50IiwiZGVsZXRlIiwic3Vic2NyaXB0aW9uSW5mbyIsInN1YnNjcmlwdGlvbkluZm9zIiwiZGVsZXRlQ2xpZW50U3Vic2NyaXB0aW9uIiwiaGFzU3Vic2NyaWJpbmdDbGllbnQiLCJxdWVyeSIsImdldFB1YmxpY1JlYWRBY2Nlc3MiLCJoYXNNYXN0ZXJLZXkiLCJnZXRTdWJzY3JpcHRpb25JbmZvIiwic3Vic2NyaXB0aW9uU2Vzc2lvblRva2VuIiwic2Vzc2lvblRva2VuIiwiZ2V0VXNlcklkIiwidXNlcklkIiwiZ2V0UmVhZEFjY2VzcyIsImlzU3Vic2NyaXB0aW9uU2Vzc2lvblRva2VuTWF0Y2hlZCIsInJlc29sdmUiLCJyZWplY3QiLCJhY2xfaGFzX3JvbGVzIiwicGVybWlzc2lvbnNCeUlkIiwic29tZSIsInN0YXJ0c1dpdGgiLCJ1c2VyIiwiVXNlciIsInJvbGVzUXVlcnkiLCJRdWVyeSIsIlJvbGUiLCJlcXVhbFRvIiwiZmluZCIsInVzZU1hc3RlcktleSIsInJvbGVzIiwicm9sZSIsImdldFJvbGVSZWFkQWNjZXNzIiwiY2F0Y2giLCJpc1JvbGVNYXRjaGVkIiwiY2xpZW50U2Vzc2lvblRva2VuIiwiX3ZhbGlkYXRlS2V5cyIsIl9oYXNNYXN0ZXJLZXkiLCJwdXNoQ29ubmVjdCIsInZhbGlkS2V5UGFpcnMiLCJoYXNPd25Qcm9wZXJ0eSIsImlzVmFsaWQiLCJzZWNyZXQiLCJzdWJzY3JpcHRpb25IYXNoIiwiU3Vic2NyaXB0aW9uIiwid2hlcmUiLCJmaWVsZHMiLCJhZGRTdWJzY3JpcHRpb25JbmZvIiwiYWRkQ2xpZW50U3Vic2NyaXB0aW9uIiwicHVzaFN1YnNjcmliZSIsIm5vdGlmeUNsaWVudCIsImRlbGV0ZVN1YnNjcmlwdGlvbkluZm8iLCJwdXNoVW5zdWJzY3JpYmUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7OztBQUNBOzs7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOztBQUNBOztBQUNBOztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUVBLE1BQU1BLG9CQUFOLENBQTJCO0FBRXpCO0FBT0FDLGNBQVlDLE1BQVosRUFBeUJDLE1BQXpCLEVBQXNDO0FBQ3BDLFNBQUtELE1BQUwsR0FBY0EsTUFBZDtBQUNBLFNBQUtFLE9BQUwsR0FBZSxJQUFJQyxHQUFKLEVBQWY7QUFDQSxTQUFLQyxhQUFMLEdBQXFCLElBQUlELEdBQUosRUFBckI7O0FBRUFGLGFBQVNBLFVBQVUsRUFBbkI7O0FBRUE7QUFDQSxVQUFNSSxXQUFXSixPQUFPSSxRQUFQLElBQW1CLEVBQXBDO0FBQ0EsU0FBS0EsUUFBTCxHQUFnQixJQUFJRixHQUFKLEVBQWhCO0FBQ0EsU0FBSyxNQUFNRyxHQUFYLElBQWtCQyxPQUFPQyxJQUFQLENBQVlILFFBQVosQ0FBbEIsRUFBeUM7QUFDdkMsV0FBS0Es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OUY7QUFDRDtBQTlpQndCOztRQWtqQnpCcEUsb0IsR0FBQUEsb0IiLCJmaWxlIjoiUGFyc2VMaXZlUXVlcnlTZXJ2ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHY0IGZyb20gJ3R2NCc7XG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgeyBTdWJzY3JpcHRpb24gfSBmcm9tICcuL1N1YnNjcmlwdGlvbic7XG5pbXBvcnQgeyBDbGllbnQgfSBmcm9tICcuL0NsaWVudCc7XG5pbXBvcnQgeyBQYXJzZVdlYlNvY2tldFNlcnZlciB9IGZyb20gJy4vUGFyc2VXZWJTb2NrZXRTZXJ2ZXInO1xuaW1wb3J0IGxvZ2dlciBmcm9tICcuLi9sb2dnZXInO1xuaW1wb3J0IFJlcXVlc3RTY2hlbWEgZnJvbSAnLi9SZXF1ZXN0U2NoZW1hJztcbmltcG9ydCB7IG1hdGNoZXNRdWVyeSwgcXVlcnlIYXNoIH0gZnJvbSAnLi9RdWVyeVRvb2xzJztcbmltcG9ydCB7IFBhcnNlUHViU3ViIH0gZnJvbSAnLi9QYXJzZVB1YlN1Yic7XG5pbXBvcnQgeyBTZXNzaW9uVG9rZW5DYWNoZSB9IGZyb20gJy4vU2Vzc2lvblRva2VuQ2FjaGUnO1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCB1dWlkIGZyb20gJ3V1aWQnO1xuaW1wb3J0IHsgcnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyB9IGZyb20gJy4uL3RyaWdnZXJzJztcblxuY2xhc3MgUGFyc2VMaXZlUXVlcnlTZXJ2ZXIge1xuICBjbGllbnRzOiBNYXA7XG4gIC8vIGNsYXNzTmFtZSAtPiAocXVlcnlIYXNoIC0+IHN1YnNjcmlwdGlvbilcbiAgc3Vic2NyaXB0aW9uczogT2JqZWN0O1xuICBwYXJzZVdlYlNvY2tldFNlcnZlcjogT2JqZWN0O1xuICBrZXlQYWlycyA6IGFueTtcbiAgLy8gVGhlIHN1YnNjcmliZXIgd2UgdXNlIHRvIGdldCBvYmplY3QgdXBkYXRlIGZyb20gcHVibGlzaGVyXG4gIHN1YnNjcmliZXI6IE9iamVjdDtcblxuICBjb25zdHJ1Y3RvcihzZXJ2ZXI6IGFueSwgY29uZmlnOiBhbnkpIHtcbiAgICB0aGlzLnNlcnZlciA9IHNlcnZlcjtcbiAgICB0aGlzLmNsaWVudHMgPSBuZXcgTWFwKCk7XG4gICAgdGhpcy5zdWJzY3JpcHRpb25zID0gbmV3IE1hcCgpO1xuXG4gICAgY29uZmlnID0gY29uZmlnIHx8IHt9O1xuXG4gICAgLy8gU3RvcmUga2V5cywgY29udmVydCBvYmogdG8gbWFwXG4gICAgY29uc3Qga2V5UGFpcnMgPSBjb25maWcua2V5UGFpcnMgfHwge307XG4gICAgdGhpcy5rZXlQYWlycyA9IG5ldyBNYXAoKTtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhrZXlQYWlycykpIHtcbiAgICAgIHRoaXMua2V5UGFpcnMuc2V0KGtleSwga2V5UGFpcnNba2V5XSk7XG4gICAgfVxuICAgIGxvZ2dlci52ZXJib3NlKCdTdXBwb3J0IGtleSBwYWlycycsIHRoaXMua2V5UGFpcnMpO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBQYXJzZVxuICAgIFBhcnNlLk9iamVjdC5kaXNhYmxlU2luZ2xlSW5zdGFuY2UoKTtcblxuICAgIGNvbnN0IHNlcnZlclVSTCA9IGNvbmZpZy5zZXJ2ZXJVUkwgfHwgUGFyc2Uuc2VydmVyVVJMO1xuICAgIFBhcnNlLnNlcnZlclVSTCA9IHNlcnZlclVSTDtcbiAgICBjb25zdCBhcHBJZCA9IGNvbmZpZy5hcHBJZCB8fCBQYXJzZS5hcHBsaWNhdGlvbklkO1xuICAgIGNvbnN0IGphdmFzY3JpcHRLZXkgPSBQYXJzZS5qYXZhU2NyaXB0S2V5O1xuICAgIGNvbnN0IG1hc3RlcktleSA9IGNvbmZpZy5tYXN0ZXJLZXkgfHwgUGFyc2UubWFzdGVyS2V5O1xuICAgIFBhcnNlLmluaXRpYWxpemUoYXBwSWQsIGphdmFzY3JpcHRLZXksIG1hc3RlcktleSk7XG5cbiAgICAvLyBJbml0aWFsaXplIHdlYnNvY2tldCBzZXJ2ZXJcbiAgICB0aGlzLnBhcnNlV2ViU29ja2V0U2VydmVyID0gbmV3IFBhcnNlV2ViU29ja2V0U2VydmVyKFxuICAgICAgc2VydmVyLFxuICAgICAgKHBhcnNlV2Vic29ja2V0KSA9PiB0aGlzLl9vbkNvbm5lY3QocGFyc2VXZWJzb2NrZXQpLFxuICAgICAgY29uZmlnLndlYnNvY2tldFRpbWVvdXRcbiAgICApO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBzdWJzY3JpYmVyXG4gICAgdGhpcy5zdWJzY3JpYmVyID0gUGFyc2VQdWJTdWIuY3JlYXRlU3Vic2NyaWJlcihjb25maWcpO1xuICAgIHRoaXMuc3Vic2NyaWJlci5zdWJzY3JpYmUoUGFyc2UuYXBwbGljYXRpb25JZCArICdhZnRlclNhdmUnKTtcbiAgICB0aGlzLnN1YnNjcmliZXIuc3Vic2NyaWJlKFBhcnNlLmFwcGxpY2F0aW9uSWQgKyAnYWZ0ZXJEZWxldGUnKTtcbiAgICAvLyBSZWdpc3RlciBtZXNzYWdlIGhhbmRsZXIgZm9yIHN1YnNjcmliZXIuIFdoZW4gcHVibGlzaGVyIGdldCBtZXNzYWdlcywgaXQgd2lsbCBwdWJsaXNoIG1lc3NhZ2VcbiAgICAvLyB0byB0aGUgc3Vic2NyaWJlcnMgYW5kIHRoZSBoYW5kbGVyIHdpbGwgYmUgY2FsbGVkLlxuICAgIHRoaXMuc3Vic2NyaWJlci5vbignbWVzc2FnZScsIChjaGFubmVsLCBtZXNzYWdlU3RyKSA9PiB7XG4gICAgICBsb2dnZXIudmVyYm9zZSgnU3Vic2NyaWJlIG1lc3NzYWdlICVqJywgbWVzc2FnZVN0cik7XG4gICAgICBsZXQgbWVzc2FnZTtcbiAgICAgIHRyeSB7XG4gICAgICAgIG1lc3NhZ2UgPSBKU09OLnBhcnNlKG1lc3NhZ2VTdHIpO1xuICAgICAgfSBjYXRjaChlKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcigndW5hYmxlIHRvIHBhcnNlIG1lc3NhZ2UnLCBtZXNzYWdlU3RyLCBlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdGhpcy5faW5mbGF0ZVBhcnNlT2JqZWN0KG1lc3NhZ2UpO1xuICAgICAgaWYgKGNoYW5uZWwgPT09IFBhcnNlLmFwcGxpY2F0aW9uSWQgKyAnYWZ0ZXJTYXZlJykge1xuICAgICAgICB0aGlzLl9vbkFmdGVyU2F2ZShtZXNzYWdlKTtcbiAgICAgIH0gZWxzZSBpZiAoY2hhbm5lbCA9PT0gUGFyc2UuYXBwbGljYXRpb25JZCArICdhZnRlckRlbGV0ZScpIHtcbiAgICAgICAgdGhpcy5fb25BZnRlckRlbGV0ZShtZXNzYWdlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcignR2V0IG1lc3NhZ2UgJXMgZnJvbSB1bmtub3duIGNoYW5uZWwgJWonLCBtZXNzYWdlLCBjaGFubmVsKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEluaXRpYWxpemUgc2Vzc2lvblRva2VuIGNhY2hlXG4gICAgdGhpcy5zZXNzaW9uVG9rZW5DYWNoZSA9IG5ldyBTZXNzaW9uVG9rZW5DYWNoZShjb25maWcuY2FjaGVUaW1lb3V0KTtcbiAgfVxuXG4gIC8vIE1lc3NhZ2UgaXMgdGhlIEpTT04gb2JqZWN0IGZyb20gcHVibGlzaGVyLiBNZXNzYWdlLmN1cnJlbnRQYXJzZU9iamVjdCBpcyB0aGUgUGFyc2VPYmplY3QgSlNPTiBhZnRlciBjaGFuZ2VzLlxuICAvLyBNZXNzYWdlLm9yaWdpbmFsUGFyc2VPYmplY3QgaXMgdGhlIG9yaWdpbmFsIFBhcnNlT2JqZWN0IEpTT04uXG4gIF9pbmZsYXRlUGFyc2VPYmplY3QobWVzc2FnZTogYW55KTogdm9pZCB7XG4gICAgLy8gSW5mbGF0ZSBtZXJnZWQgb2JqZWN0XG4gICAgY29uc3QgY3VycmVudFBhcnNlT2JqZWN0ID0gbWVzc2FnZS5jdXJyZW50UGFyc2VPYmplY3Q7XG4gICAgbGV0IGNsYXNzTmFtZSA9IGN1cnJlbnRQYXJzZU9iamVjdC5jbGFzc05hbWU7XG4gICAgbGV0IHBhcnNlT2JqZWN0ID0gbmV3IFBhcnNlLk9iamVjdChjbGFzc05hbWUpO1xuICAgIHBhcnNlT2JqZWN0Ll9maW5pc2hGZXRjaChjdXJyZW50UGFyc2VPYmplY3QpO1xuICAgIG1lc3NhZ2UuY3VycmVudFBhcnNlT2JqZWN0ID0gcGFyc2VPYmplY3Q7XG4gICAgLy8gSW5mbGF0ZSBvcmlnaW5hbCBvYmplY3RcbiAgICBjb25zdCBvcmlnaW5hbFBhcnNlT2JqZWN0ID0gbWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0O1xuICAgIGlmIChvcmlnaW5hbFBhcnNlT2JqZWN0KSB7XG4gICAgICBjbGFzc05hbWUgPSBvcmlnaW5hbFBhcnNlT2JqZWN0LmNsYXNzTmFtZTtcbiAgICAgIHBhcnNlT2JqZWN0ID0gbmV3IFBhcnNlLk9iamVjdChjbGFzc05hbWUpO1xuICAgICAgcGFyc2VPYmplY3QuX2ZpbmlzaEZldGNoKG9yaWdpbmFsUGFyc2VPYmplY3QpO1xuICAgICAgbWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0ID0gcGFyc2VPYmplY3Q7XG4gICAgfVxuICB9XG5cbiAgLy8gTWVzc2FnZSBpcyB0aGUgSlNPTiBvYmplY3QgZnJvbSBwdWJsaXNoZXIgYWZ0ZXIgaW5mbGF0ZWQuIE1lc3NhZ2UuY3VycmVudFBhcnNlT2JqZWN0IGlzIHRoZSBQYXJzZU9iamVjdCBhZnRlciBjaGFuZ2VzLlxuICAvLyBNZXNzYWdlLm9yaWdpbmFsUGFyc2VPYmplY3QgaXMgdGhlIG9yaWdpbmFsIFBhcnNlT2JqZWN0LlxuICBfb25BZnRlckRlbGV0ZShtZXNzYWdlOiBhbnkpOiB2b2lkIHtcbiAgICBsb2dnZXIudmVyYm9zZShQYXJzZS5hcHBsaWNhdGlvbklkICsgJ2FmdGVyRGVsZXRlIGlzIHRyaWdnZXJlZCcpO1xuXG4gICAgY29uc3QgZGVsZXRlZFBhcnNlT2JqZWN0ID0gbWVzc2FnZS5jdXJyZW50UGFyc2VPYmplY3QudG9KU09OKCk7XG4gICAgY29uc3QgY2xhc3NOYW1lID0gZGVsZXRlZFBhcnNlT2JqZWN0LmNsYXNzTmFtZTtcbiAgICBsb2dnZXIudmVyYm9zZSgnQ2xhc3NOYW1lOiAlaiB8IE9iamVjdElkOiAlcycsIGNsYXNzTmFtZSwgZGVsZXRlZFBhcnNlT2JqZWN0LmlkKTtcbiAgICBsb2dnZXIudmVyYm9zZSgnQ3VycmVudCBjbGllbnQgbnVtYmVyIDogJWQnLCB0aGlzLmNsaWVudHMuc2l6ZSk7XG5cbiAgICBjb25zdCBjbGFzc1N1YnNjcmlwdGlvbnMgPSB0aGlzLnN1YnNjcmlwdGlvbnMuZ2V0KGNsYXNzTmFtZSk7XG4gICAgaWYgKHR5cGVvZiBjbGFzc1N1YnNjcmlwdGlvbnMgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ0NhbiBub3QgZmluZCBzdWJzY3JpcHRpb25zIHVuZGVyIHRoaXMgY2xhc3MgJyArIGNsYXNzTmFtZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGZvciAoY29uc3Qgc3Vic2NyaXB0aW9uIG9mIGNsYXNzU3Vic2NyaXB0aW9ucy52YWx1ZXMoKSkge1xuICAgICAgY29uc3QgaXNTdWJzY3JpcHRpb25NYXRjaGVkID0gdGhpcy5fbWF0Y2hlc1N1YnNjcmlwdGlvbihkZWxldGVkUGFyc2VPYmplY3QsIHN1YnNjcmlwdGlvbik7XG4gICAgICBpZiAoIWlzU3Vic2NyaXB0aW9uTWF0Y2hlZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgW2NsaWVudElkLCByZXF1ZXN0SWRzXSBvZiBfLmVudHJpZXMoc3Vic2NyaXB0aW9uLmNsaWVudFJlcXVlc3RJZHMpKSB7XG4gICAgICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50cy5nZXQoY2xpZW50SWQpO1xuICAgICAgICBpZiAodHlwZW9mIGNsaWVudCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IHJlcXVlc3RJZCBvZiByZXF1ZXN0SWRzKSB7XG4gICAgICAgICAgY29uc3QgYWNsID0gbWVzc2FnZS5jdXJyZW50UGFyc2VPYmplY3QuZ2V0QUNMKCk7XG4gICAgICAgICAgLy8gQ2hlY2sgQUNMXG4gICAgICAgICAgdGhpcy5fbWF0Y2hlc0FDTChhY2wsIGNsaWVudCwgcmVxdWVzdElkKS50aGVuKChpc01hdGNoZWQpID0+IHtcbiAgICAgICAgICAgIGlmICghaXNNYXRjaGVkKSB7XG4gICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2xpZW50LnB1c2hEZWxldGUocmVxdWVzdElkLCBkZWxldGVkUGFyc2VPYmplY3QpO1xuICAgICAgICAgIH0sIChlcnJvcikgPT4ge1xuICAgICAgICAgICAgbG9nZ2VyLmVycm9yKCdNYXRjaGluZyBBQ0wgZXJyb3IgOiAnLCBlcnJvcik7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBNZXNzYWdlIGlzIHRoZSBKU09OIG9iamVjdCBmcm9tIHB1Ymxpc2hlciBhZnRlciBpbmZsYXRlZC4gTWVzc2FnZS5jdXJyZW50UGFyc2VPYmplY3QgaXMgdGhlIFBhcnNlT2JqZWN0IGFmdGVyIGNoYW5nZXMuXG4gIC8vIE1lc3NhZ2Uub3JpZ2luYWxQYXJzZU9iamVjdCBpcyB0aGUgb3JpZ2luYWwgUGFyc2VPYmplY3QuXG4gIF9vbkFmdGVyU2F2ZShtZXNzYWdlOiBhbnkpOiB2b2lkIHtcbiAgICBsb2dnZXIudmVyYm9zZShQYXJzZS5hcHBsaWNhdGlvbklkICsgJ2FmdGVyU2F2ZSBpcyB0cmlnZ2VyZWQnKTtcblxuICAgIGxldCBvcmlnaW5hbFBhcnNlT2JqZWN0ID0gbnVsbDtcbiAgICBpZiAobWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0KSB7XG4gICAgICBvcmlnaW5hbFBhcnNlT2JqZWN0ID0gbWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0LnRvSlNPTigpO1xuICAgIH1cbiAgICBjb25zdCBjdXJyZW50UGFyc2VPYmplY3QgPSBtZXNzYWdlLmN1cnJlbnRQYXJzZU9iamVjdC50b0pTT04oKTtcbiAgICBjb25zdCBjbGFzc05hbWUgPSBjdXJyZW50UGFyc2VPYmplY3QuY2xhc3NOYW1lO1xuICAgIGxvZ2dlci52ZXJib3NlKCdDbGFzc05hbWU6ICVzIHwgT2JqZWN0SWQ6ICVzJywgY2xhc3NOYW1lLCBjdXJyZW50UGFyc2VPYmplY3QuaWQpO1xuICAgIGxvZ2dlci52ZXJib3NlKCdDdXJyZW50IGNsaWVudCBudW1iZXIgOiAlZCcsIHRoaXMuY2xpZW50cy5zaXplKTtcblxuICAgIGNvbnN0IGNsYXNzU3Vic2NyaXB0aW9ucyA9IHRoaXMuc3Vic2NyaXB0aW9ucy5nZXQoY2xhc3NOYW1lKTtcbiAgICBpZiAodHlwZW9mIGNsYXNzU3Vic2NyaXB0aW9ucyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZygnQ2FuIG5vdCBmaW5kIHN1YnNjcmlwdGlvbnMgdW5kZXIgdGhpcyBjbGFzcyAnICsgY2xhc3NOYW1lKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChjb25zdCBzdWJzY3JpcHRpb24gb2YgY2xhc3NTdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgICBjb25zdCBpc09yaWdpbmFsU3Vic2NyaXB0aW9uTWF0Y2hlZCA9IHRoaXMuX21hdGNoZXNTdWJzY3JpcHRpb24ob3JpZ2luYWxQYXJzZU9iamVjdCwgc3Vic2NyaXB0aW9uKTtcbiAgICAgIGNvbnN0IGlzQ3VycmVudFN1YnNjcmlwdGlvbk1hdGNoZWQgPSB0aGlzLl9tYXRjaGVzU3Vic2NyaXB0aW9uKGN1cnJlbnRQYXJzZU9iamVjdCwgc3Vic2NyaXB0aW9uKTtcbiAgICAgIGZvciAoY29uc3QgW2NsaWVudElkLCByZXF1ZXN0SWRzXSBvZiBfLmVudHJpZXMoc3Vic2NyaXB0aW9uLmNsaWVudFJlcXVlc3RJZHMpKSB7XG4gICAgICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50cy5nZXQoY2xpZW50SWQpO1xuICAgICAgICBpZiAodHlwZW9mIGNsaWVudCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IHJlcXVlc3RJZCBvZiByZXF1ZXN0SWRzKSB7XG4gICAgICAgICAgLy8gU2V0IG9yaWduYWwgUGFyc2VPYmplY3QgQUNMIGNoZWNraW5nIHByb21pc2UsIGlmIHRoZSBvYmplY3QgZG9lcyBub3QgbWF0Y2hcbiAgICAgICAgICAvLyBzdWJzY3JpcHRpb24sIHdlIGRvIG5vdCBuZWVkIHRvIGNoZWNrIEFDTFxuICAgICAgICAgIGxldCBvcmlnaW5hbEFDTENoZWNraW5nUHJvbWlzZTtcbiAgICAgICAgICBpZiAoIWlzT3JpZ2luYWxTdWJzY3JpcHRpb25NYXRjaGVkKSB7XG4gICAgICAgICAgICBvcmlnaW5hbEFDTENoZWNraW5nUHJvbWlzZSA9IFBhcnNlLlByb21pc2UuYXMoZmFsc2UpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsZXQgb3JpZ2luYWxBQ0w7XG4gICAgICAgICAgICBpZiAobWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0KSB7XG4gICAgICAgICAgICAgIG9yaWdpbmFsQUNMID0gbWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0LmdldEFDTCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgb3JpZ2luYWxBQ0xDaGVja2luZ1Byb21pc2UgPSB0aGlzLl9tYXRjaGVzQUNMKG9yaWdpbmFsQUNMLCBjbGllbnQsIHJlcXVlc3RJZCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFNldCBjdXJyZW50IFBhcnNlT2JqZWN0IEFDTCBjaGVja2luZyBwcm9taXNlLCBpZiB0aGUgb2JqZWN0IGRvZXMgbm90IG1hdGNoXG4gICAgICAgICAgLy8gc3Vic2NyaXB0aW9uLCB3ZSBkbyBub3QgbmVlZCB0byBjaGVjayBBQ0xcbiAgICAgICAgICBsZXQgY3VycmVudEFDTENoZWNraW5nUHJvbWlzZTtcbiAgICAgICAgICBpZiAoIWlzQ3VycmVudFN1YnNjcmlwdGlvbk1hdGNoZWQpIHtcbiAgICAgICAgICAgIGN1cnJlbnRBQ0xDaGVja2luZ1Byb21pc2UgPSBQYXJzZS5Qcm9taXNlLmFzKGZhbHNlKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgY3VycmVudEFDTCA9IG1lc3NhZ2UuY3VycmVudFBhcnNlT2JqZWN0LmdldEFDTCgpO1xuICAgICAgICAgICAgY3VycmVudEFDTENoZWNraW5nUHJvbWlzZSA9IHRoaXMuX21hdGNoZXNBQ0woY3VycmVudEFDTCwgY2xpZW50LCByZXF1ZXN0SWQpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIFBhcnNlLlByb21pc2Uud2hlbihcbiAgICAgICAgICAgIG9yaWdpbmFsQUNMQ2hlY2tpbmdQcm9taXNlLFxuICAgICAgICAgICAgY3VycmVudEFDTENoZWNraW5nUHJvbWlzZVxuICAgICAgICAgICkudGhlbigoaXNPcmlnaW5hbE1hdGNoZWQsIGlzQ3VycmVudE1hdGNoZWQpID0+IHtcbiAgICAgICAgICAgIGxvZ2dlci52ZXJib3NlKCdPcmlnaW5hbCAlaiB8IEN1cnJlbnQgJWogfCBNYXRjaDogJXMsICVzLCAlcywgJXMgfCBRdWVyeTogJXMnLFxuICAgICAgICAgICAgICBvcmlnaW5hbFBhcnNlT2JqZWN0LFxuICAgICAgICAgICAgICBjdXJyZW50UGFyc2VPYmplY3QsXG4gICAgICAgICAgICAgIGlzT3JpZ2luYWxTdWJzY3JpcHRpb25NYXRjaGVkLFxuICAgICAgICAgICAgICBpc0N1cnJlbnRTdWJzY3JpcHRpb25NYXRjaGVkLFxuICAgICAgICAgICAgICBpc09yaWdpbmFsTWF0Y2hlZCxcbiAgICAgICAgICAgICAgaXNDdXJyZW50TWF0Y2hlZCxcbiAgICAgICAgICAgICAgc3Vic2NyaXB0aW9uLmhhc2hcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIC8vIERlY2lkZSBldmVudCB0eXBlXG4gICAgICAgICAgICBsZXQgdHlwZTtcbiAgICAgICAgICAgIGlmIChpc09yaWdpbmFsTWF0Y2hlZCAmJiBpc0N1cnJlbnRNYXRjaGVkKSB7XG4gICAgICAgICAgICAgIHR5cGUgPSAnVXBkYXRlJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNPcmlnaW5hbE1hdGNoZWQgJiYgIWlzQ3VycmVudE1hdGNoZWQpIHtcbiAgICAgICAgICAgICAgdHlwZSA9ICdMZWF2ZSc7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKCFpc09yaWdpbmFsTWF0Y2hlZCAmJiBpc0N1cnJlbnRNYXRjaGVkKSB7XG4gICAgICAgICAgICAgIGlmIChvcmlnaW5hbFBhcnNlT2JqZWN0KSB7XG4gICAgICAgICAgICAgICAgdHlwZSA9ICdFbnRlcic7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdHlwZSA9ICdDcmVhdGUnO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGZ1bmN0aW9uTmFtZSA9ICdwdXNoJyArIHR5cGU7XG4gICAgICAgICAgICBjbGllbnRbZnVuY3Rpb25OYW1lXShyZXF1ZXN0SWQsIGN1cnJlbnRQYXJzZU9iamVjdCk7XG4gICAgICAgICAgfSwgKGVycm9yKSA9PiB7XG4gICAgICAgICAgICBsb2dnZXIuZXJyb3IoJ01hdGNoaW5nIEFDTCBlcnJvciA6ICcsIGVycm9yKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIF9vbkNvbm5lY3QocGFyc2VXZWJzb2NrZXQ6IGFueSk6IHZvaWQge1xuICAgIHBhcnNlV2Vic29ja2V0Lm9uKCdtZXNzYWdlJywgKHJlcXVlc3QpID0+IHtcbiAgICAgIGlmICh0eXBlb2YgcmVxdWVzdCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXF1ZXN0ID0gSlNPTi5wYXJzZShyZXF1ZXN0KTtcbiAgICAgICAgfSBjYXRjaChlKSB7XG4gICAgICAgICAgbG9nZ2VyLmVycm9yKCd1bmFibGUgdG8gcGFyc2UgcmVxdWVzdCcsIHJlcXVlc3QsIGUpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgbG9nZ2VyLnZlcmJvc2UoJ1JlcXVlc3Q6ICVqJywgcmVxdWVzdCk7XG5cbiAgICAgIC8vIENoZWNrIHdoZXRoZXIgdGhpcyByZXF1ZXN0IGlzIGEgdmFsaWQgcmVxdWVzdCwgcmV0dXJuIGVycm9yIGRpcmVjdGx5IGlmIG5vdFxuICAgICAgaWYgKCF0djQudmFsaWRhdGUocmVxdWVzdCwgUmVxdWVzdFNjaGVtYVsnZ2VuZXJhbCddKSB8fCAhdHY0LnZhbGlkYXRlKHJlcXVlc3QsIFJlcXVlc3RTY2hlbWFbcmVxdWVzdC5vcF0pKSB7XG4gICAgICAgIENsaWVudC5wdXNoRXJyb3IocGFyc2VXZWJzb2NrZXQsIDEsIHR2NC5lcnJvci5tZXNzYWdlKTtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdDb25uZWN0IG1lc3NhZ2UgZXJyb3IgJXMnLCB0djQuZXJyb3IubWVzc2FnZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgc3dpdGNoKHJlcXVlc3Qub3ApIHtcbiAgICAgIGNhc2UgJ2Nvbm5lY3QnOlxuICAgICAgICB0aGlzLl9oYW5kbGVDb25uZWN0KHBhcnNlV2Vic29ja2V0LCByZXF1ZXN0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdzdWJzY3JpYmUnOlxuICAgICAgICB0aGlzLl9oYW5kbGVTdWJzY3JpYmUocGFyc2VXZWJzb2NrZXQsIHJlcXVlc3QpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICAgIHRoaXMuX2hhbmRsZVVwZGF0ZVN1YnNjcmlwdGlvbihwYXJzZVdlYnNvY2tldCwgcmVxdWVzdCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndW5zdWJzY3JpYmUnOlxuICAgICAgICB0aGlzLl9oYW5kbGVVbnN1YnNjcmliZShwYXJzZVdlYnNvY2tldCwgcmVxdWVzdCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgQ2xpZW50LnB1c2hFcnJvcihwYXJzZVdlYnNvY2tldCwgMywgJ0dldCB1bmtub3duIG9wZXJhdGlvbicpO1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ0dldCB1bmtub3duIG9wZXJhdGlvbicsIHJlcXVlc3Qub3ApO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcGFyc2VXZWJzb2NrZXQub24oJ2Rpc2Nvbm5lY3QnLCAoKSA9PiB7XG4gICAgICBsb2dnZXIuaW5mbyhgQ2xpZW50IGRpc2Nvbm5lY3Q6ICR7cGFyc2VXZWJzb2NrZXQuY2xpZW50SWR9YCk7XG4gICAgICBjb25zdCBjbGllbnRJZCA9IHBhcnNlV2Vic29ja2V0LmNsaWVudElkO1xuICAgICAgaWYgKCF0aGlzLmNsaWVudHMuaGFzKGNsaWVudElkKSkge1xuICAgICAgICBydW5MaXZlUXVlcnlFdmVudEhhbmRsZXJzKHtcbiAgICAgICAgICBldmVudDogJ3dzX2Rpc2Nvbm5lY3RfZXJyb3InLFxuICAgICAgICAgIGNsaWVudHM6IHRoaXMuY2xpZW50cy5zaXplLFxuICAgICAgICAgIHN1YnNjcmlwdGlvbnM6IHRoaXMuc3Vic2NyaXB0aW9ucy5zaXplLFxuICAgICAgICAgIGVycm9yOiBgVW5hYmxlIHRvIGZpbmQgY2xpZW50ICR7Y2xpZW50SWR9YFxuICAgICAgICB9KTtcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBDYW4gbm90IGZpbmQgY2xpZW50ICR7Y2xpZW50SWR9IG9uIGRpc2Nvbm5lY3RgKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICAvLyBEZWxldGUgY2xpZW50XG4gICAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudHMuZ2V0KGNsaWVudElkKTtcbiAgICAgIHRoaXMuY2xpZW50cy5kZWxldGUoY2xpZW50SWQpO1xuXG4gICAgICAvLyBEZWxldGUgY2xpZW50IGZyb20gc3Vic2NyaXB0aW9uc1xuICAgICAgZm9yIChjb25zdCBbcmVxdWVzdElkLCBzdWJzY3JpcHRpb25JbmZvXSBvZiBfLmVudHJpZXMoY2xpZW50LnN1YnNjcmlwdGlvbkluZm9zKSkge1xuICAgICAgICBjb25zdCBzdWJzY3JpcHRpb24gPSBzdWJzY3JpcHRpb25JbmZvLnN1YnNjcmlwdGlvbjtcbiAgICAgICAgc3Vic2NyaXB0aW9uLmRlbGV0ZUNsaWVudFN1YnNjcmlwdGlvbihjbGllbnRJZCwgcmVxdWVzdElkKTtcblxuICAgICAgICAvLyBJZiB0aGVyZSBpcyBubyBjbGllbnQgd2hpY2ggaXMgc3Vic2NyaWJpbmcgdGhpcyBzdWJzY3JpcHRpb24sIHJlbW92ZSBpdCBmcm9tIHN1YnNjcmlwdGlvbnNcbiAgICAgICAgY29uc3QgY2xhc3NTdWJzY3JpcHRpb25zID0gdGhpcy5zdWJzY3JpcHRpb25zLmdldChzdWJzY3JpcHRpb24uY2xhc3NOYW1lKTtcbiAgICAgICAgaWYgKCFzdWJzY3JpcHRpb24uaGFzU3Vic2NyaWJpbmdDbGllbnQoKSkge1xuICAgICAgICAgIGNsYXNzU3Vic2NyaXB0aW9ucy5kZWxldGUoc3Vic2NyaXB0aW9uLmhhc2gpO1xuICAgICAgICB9XG4gICAgICAgIC8vIElmIHRoZXJlIGlzIG5vIHN1YnNjcmlwdGlvbnMgdW5kZXIgdGhpcyBjbGFzcywgcmVtb3ZlIGl0IGZyb20gc3Vic2NyaXB0aW9uc1xuICAgICAgICBpZiAoY2xhc3NTdWJzY3JpcHRpb25zLnNpemUgPT09IDApIHtcbiAgICAgICAgICB0aGlzLnN1YnNjcmlwdGlvbnMuZGVsZXRlKHN1YnNjcmlwdGlvbi5jbGFzc05hbWUpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGxvZ2dlci52ZXJib3NlKCdDdXJyZW50IGNsaWVudHMgJWQnLCB0aGlzLmNsaWVudHMuc2l6ZSk7XG4gICAgICBsb2dnZXIudmVyYm9zZSgnQ3VycmVudCBzdWJzY3JpcHRpb25zICVkJywgdGhpcy5zdWJzY3JpcHRpb25zLnNpemUpO1xuICAgICAgcnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyh7XG4gICAgICAgIGV2ZW50OiAnd3NfZGlzY29ubmVjdCcsXG4gICAgICAgIGNsaWVudHM6IHRoaXMuY2xpZW50cy5zaXplLFxuICAgICAgICBzdWJzY3JpcHRpb25zOiB0aGlzLnN1YnNjcmlwdGlvbnMuc2l6ZVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBydW5MaXZlUXVlcnlFdmVudEhhbmRsZXJzKHtcbiAgICAgIGV2ZW50OiAnd3NfY29ubmVjdCcsXG4gICAgICBjbGllbnRzOiB0aGlzLmNsaWVudHMuc2l6ZSxcbiAgICAgIHN1YnNjcmlwdGlvbnM6IHRoaXMuc3Vic2NyaXB0aW9ucy5zaXplXG4gICAgfSk7XG4gIH1cblxuICBfbWF0Y2hlc1N1YnNjcmlwdGlvbihwYXJzZU9iamVjdDogYW55LCBzdWJzY3JpcHRpb246IGFueSk6IGJvb2xlYW4ge1xuICAgIC8vIE9iamVjdCBpcyB1bmRlZmluZWQgb3IgbnVsbCwgbm90IG1hdGNoXG4gICAgaWYgKCFwYXJzZU9iamVjdCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gbWF0Y2hlc1F1ZXJ5KHBhcnNlT2JqZWN0LCBzdWJzY3JpcHRpb24ucXVlcnkpO1xuICB9XG5cbiAgX21hdGNoZXNBQ0woYWNsOiBhbnksIGNsaWVudDogYW55LCByZXF1ZXN0SWQ6IG51bWJlcik6IGFueSB7XG4gICAgLy8gUmV0dXJuIHRydWUgZGlyZWN0bHkgaWYgQUNMIGlzbid0IHByZXNlbnQsIEFDTCBpcyBwdWJsaWMgcmVhZCwgb3IgY2xpZW50IGhhcyBtYXN0ZXIga2V5XG4gICAgaWYgKCFhY2wgfHwgYWNsLmdldFB1YmxpY1JlYWRBY2Nlc3MoKSB8fCBjbGllbnQuaGFzTWFzdGVyS2V5KSB7XG4gICAgICByZXR1cm4gUGFyc2UuUHJvbWlzZS5hcyh0cnVlKTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgc3Vic2NyaXB0aW9uIHNlc3Npb25Ub2tlbiBtYXRjaGVzIEFDTCBmaXJzdFxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbkluZm8gPSBjbGllbnQuZ2V0U3Vic2NyaXB0aW9uSW5mbyhyZXF1ZXN0SWQpO1xuICAgIGlmICh0eXBlb2Ygc3Vic2NyaXB0aW9uSW5mbyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHJldHVybiBQYXJzZS5Qcm9taXNlLmFzKGZhbHNlKTtcbiAgICB9XG5cbiAgICBjb25zdCBzdWJzY3JpcHRpb25TZXNzaW9uVG9rZW4gPSBzdWJzY3JpcHRpb25JbmZvLnNlc3Npb25Ub2tlbjtcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9uVG9rZW5DYWNoZS5nZXRVc2VySWQoc3Vic2NyaXB0aW9uU2Vzc2lvblRva2VuKS50aGVuKCh1c2VySWQpID0+IHtcbiAgICAgIHJldHVybiBhY2wuZ2V0UmVhZEFjY2Vzcyh1c2VySWQpO1xuICAgIH0pLnRoZW4oKGlzU3Vic2NyaXB0aW9uU2Vzc2lvblRva2VuTWF0Y2hlZCkgPT4ge1xuICAgICAgaWYgKGlzU3Vic2NyaXB0aW9uU2Vzc2lvblRva2VuTWF0Y2hlZCkge1xuICAgICAgICByZXR1cm4gUGFyc2UuUHJvbWlzZS5hcyh0cnVlKTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2hlY2sgaWYgdGhlIHVzZXIgaGFzIGFueSByb2xlcyB0aGF0IG1hdGNoIHRoZSBBQ0xcbiAgICAgIHJldHVybiBuZXcgUGFyc2UuUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cbiAgICAgICAgLy8gUmVzb2x2ZSBmYWxzZSByaWdodCBhd2F5IGlmIHRoZSBhY2wgZG9lc24ndCBoYXZlIGFueSByb2xlc1xuICAgICAgICBjb25zdCBhY2xfaGFzX3JvbGVzID0gT2JqZWN0LmtleXMoYWNsLnBlcm1pc3Npb25zQnlJZCkuc29tZShrZXkgPT4ga2V5LnN0YXJ0c1dpdGgoXCJyb2xlOlwiKSk7XG4gICAgICAgIGlmICghYWNsX2hhc19yb2xlcykge1xuICAgICAgICAgIHJldHVybiByZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc2Vzc2lvblRva2VuQ2FjaGUuZ2V0VXNlcklkKHN1YnNjcmlwdGlvblNlc3Npb25Ub2tlbilcbiAgICAgICAgICAudGhlbigodXNlcklkKSA9PiB7XG5cbiAgICAgICAgICAgIC8vIFBhc3MgYWxvbmcgYSBudWxsIGlmIHRoZXJlIGlzIG5vIHVzZXIgaWRcbiAgICAgICAgICAgIGlmICghdXNlcklkKSB7XG4gICAgICAgICAgICAgIHJldHVybiBQYXJzZS5Qcm9taXNlLmFzKG51bGwpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBQcmVwYXJlIGEgdXNlciBvYmplY3QgdG8gcXVlcnkgZm9yIHJvbGVzXG4gICAgICAgICAgICAvLyBUbyBlbGltaW5hdGUgYSBxdWVyeSBmb3IgdGhlIHVzZXIsIGNyZWF0ZSBvbmUgbG9jYWxseSB3aXRoIHRoZSBpZFxuICAgICAgICAgICAgdmFyIHVzZXIgPSBuZXcgUGFyc2UuVXNlcigpO1xuICAgICAgICAgICAgdXNlci5pZCA9IHVzZXJJZDtcbiAgICAgICAgICAgIHJldHVybiB1c2VyO1xuXG4gICAgICAgICAgfSlcbiAgICAgICAgICAudGhlbigodXNlcikgPT4ge1xuXG4gICAgICAgICAgICAvLyBQYXNzIGFsb25nIGFuIGVtcHR5IGFycmF5IChvZiByb2xlcykgaWYgbm8gdXNlclxuICAgICAgICAgICAgaWYgKCF1c2VyKSB7XG4gICAgICAgICAgICAgIHJldHVybiBQYXJzZS5Qcm9taXNlLmFzKFtdKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gVGhlbiBnZXQgdGhlIHVzZXIncyByb2xlc1xuICAgICAgICAgICAgdmFyIHJvbGVzUXVlcnkgPSBuZXcgUGFyc2UuUXVlcnkoUGFyc2UuUm9sZSk7XG4gICAgICAgICAgICByb2xlc1F1ZXJ5LmVxdWFsVG8oXCJ1c2Vyc1wiLCB1c2VyKTtcbiAgICAgICAgICAgIHJldHVybiByb2xlc1F1ZXJ5LmZpbmQoe3VzZU1hc3RlcktleTp0cnVlfSk7XG4gICAgICAgICAgfSkuXG4gICAgICAgICAgdGhlbigocm9sZXMpID0+IHtcblxuICAgICAgICAgICAgLy8gRmluYWxseSwgc2VlIGlmIGFueSBvZiB0aGUgdXNlcidzIHJvbGVzIGFsbG93IHRoZW0gcmVhZCBhY2Nlc3NcbiAgICAgICAgICAgIGZvciAoY29uc3Qgcm9sZSBvZiByb2xlcykge1xuICAgICAgICAgICAgICBpZiAoYWNsLmdldFJvbGVSZWFkQWNjZXNzKHJvbGUpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc29sdmUodHJ1ZSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlc29sdmUoZmFsc2UpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICB9KTtcblxuICAgICAgfSk7XG4gICAgfSkudGhlbigoaXNSb2xlTWF0Y2hlZCkgPT4ge1xuXG4gICAgICBpZihpc1JvbGVNYXRjaGVkKSB7XG4gICAgICAgIHJldHVybiBQYXJzZS5Qcm9taXNlLmFzKHRydWUpO1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayBjbGllbnQgc2Vzc2lvblRva2VuIG1hdGNoZXMgQUNMXG4gICAgICBjb25zdCBjbGllbnRTZXNzaW9uVG9rZW4gPSBjbGllbnQuc2Vzc2lvblRva2VuO1xuICAgICAgcmV0dXJuIHRoaXMuc2Vzc2lvblRva2VuQ2FjaGUuZ2V0VXNlcklkKGNsaWVudFNlc3Npb25Ub2tlbikudGhlbigodXNlcklkKSA9PiB7XG4gICAgICAgIHJldHVybiBhY2wuZ2V0UmVhZEFjY2Vzcyh1c2VySWQpO1xuICAgICAgfSk7XG4gICAgfSkudGhlbigoaXNNYXRjaGVkKSA9PiB7XG4gICAgICByZXR1cm4gUGFyc2UuUHJvbWlzZS5hcyhpc01hdGNoZWQpO1xuICAgIH0sICgpID0+IHtcbiAgICAgIHJldHVybiBQYXJzZS5Qcm9taXNlLmFzKGZhbHNlKTtcbiAgICB9KTtcbiAgfVxuXG4gIF9oYW5kbGVDb25uZWN0KHBhcnNlV2Vic29ja2V0OiBhbnksIHJlcXVlc3Q6IGFueSk6IGFueSB7XG4gICAgaWYgKCF0aGlzLl92YWxpZGF0ZUtleXMocmVxdWVzdCwgdGhpcy5rZXlQYWlycykpIHtcbiAgICAgIENsaWVudC5wdXNoRXJyb3IocGFyc2VXZWJzb2NrZXQsIDQsICdLZXkgaW4gcmVxdWVzdCBpcyBub3QgdmFsaWQnKTtcbiAgICAgIGxvZ2dlci5lcnJvcignS2V5IGluIHJlcXVlc3QgaXMgbm90IHZhbGlkJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGhhc01hc3RlcktleSA9IHRoaXMuX2hhc01hc3RlcktleShyZXF1ZXN0LCB0aGlzLmtleVBhaXJzKTtcbiAgICBjb25zdCBjbGllbnRJZCA9IHV1aWQoKTtcbiAgICBjb25zdCBjbGllbnQgPSBuZXcgQ2xpZW50KGNsaWVudElkLCBwYXJzZVdlYnNvY2tldCwgaGFzTWFzdGVyS2V5KTtcbiAgICBwYXJzZVdlYnNvY2tldC5jbGllbnRJZCA9IGNsaWVudElkO1xuICAgIHRoaXMuY2xpZW50cy5zZXQocGFyc2VXZWJzb2NrZXQuY2xpZW50SWQsIGNsaWVudCk7XG4gICAgbG9nZ2VyLmluZm8oYENyZWF0ZSBuZXcgY2xpZW50OiAke3BhcnNlV2Vic29ja2V0LmNsaWVudElkfWApO1xuICAgIGNsaWVudC5wdXNoQ29ubmVjdCgpO1xuICAgIHJ1bkxpdmVRdWVyeUV2ZW50SGFuZGxlcnMoe1xuICAgICAgZXZlbnQ6ICdjb25uZWN0JyxcbiAgICAgIGNsaWVudHM6IHRoaXMuY2xpZW50cy5zaXplLFxuICAgICAgc3Vic2NyaXB0aW9uczogdGhpcy5zdWJzY3JpcHRpb25zLnNpemVcbiAgICB9KTtcbiAgfVxuXG4gIF9oYXNNYXN0ZXJLZXkocmVxdWVzdDogYW55LCB2YWxpZEtleVBhaXJzOiBhbnkpOiBib29sZWFuIHtcbiAgICBpZighdmFsaWRLZXlQYWlycyB8fCB2YWxpZEtleVBhaXJzLnNpemUgPT0gMCB8fFxuICAgICAgIXZhbGlkS2V5UGFpcnMuaGFzKFwibWFzdGVyS2V5XCIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmKCFyZXF1ZXN0IHx8ICFyZXF1ZXN0Lmhhc093blByb3BlcnR5KFwibWFzdGVyS2V5XCIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiByZXF1ZXN0Lm1hc3RlcktleSA9PT0gdmFsaWRLZXlQYWlycy5nZXQoXCJtYXN0ZXJLZXlcIik7XG4gIH1cblxuICBfdmFsaWRhdGVLZXlzKHJlcXVlc3Q6IGFueSwgdmFsaWRLZXlQYWlyczogYW55KTogYm9vbGVhbiB7XG4gICAgaWYgKCF2YWxpZEtleVBhaXJzIHx8IHZhbGlkS2V5UGFpcnMuc2l6ZSA9PSAwKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgbGV0IGlzVmFsaWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IFtrZXksIHNlY3JldF0gb2YgdmFsaWRLZXlQYWlycykge1xuICAgICAgaWYgKCFyZXF1ZXN0W2tleV0gfHwgcmVxdWVzdFtrZXldICE9PSBzZWNyZXQpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpc1ZhbGlkID0gdHJ1ZTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICByZXR1cm4gaXNWYWxpZDtcbiAgfVxuXG4gIF9oYW5kbGVTdWJzY3JpYmUocGFyc2VXZWJzb2NrZXQ6IGFueSwgcmVxdWVzdDogYW55KTogYW55IHtcbiAgICAvLyBJZiB3ZSBjYW4gbm90IGZpbmQgdGhpcyBjbGllbnQsIHJldHVybiBlcnJvciB0byBjbGllbnRcbiAgICBpZiAoIXBhcnNlV2Vic29ja2V0Lmhhc093blByb3BlcnR5KCdjbGllbnRJZCcpKSB7XG4gICAgICBDbGllbnQucHVzaEVycm9yKHBhcnNlV2Vic29ja2V0LCAyLCAnQ2FuIG5vdCBmaW5kIHRoaXMgY2xpZW50LCBtYWtlIHN1cmUgeW91IGNvbm5lY3QgdG8gc2VydmVyIGJlZm9yZSBzdWJzY3JpYmluZycpO1xuICAgICAgbG9nZ2VyLmVycm9yKCdDYW4gbm90IGZpbmQgdGhpcyBjbGllbnQsIG1ha2Ugc3VyZSB5b3UgY29ubmVjdCB0byBzZXJ2ZXIgYmVmb3JlIHN1YnNjcmliaW5nJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50cy5nZXQocGFyc2VXZWJzb2NrZXQuY2xpZW50SWQpO1xuXG4gICAgLy8gR2V0IHN1YnNjcmlwdGlvbiBmcm9tIHN1YnNjcmlwdGlvbnMsIGNyZWF0ZSBvbmUgaWYgbmVjZXNzYXJ5XG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uSGFzaCA9IHF1ZXJ5SGFzaChyZXF1ZXN0LnF1ZXJ5KTtcbiAgICAvLyBBZGQgY2xhc3NOYW1lIHRvIHN1YnNjcmlwdGlvbnMgaWYgbmVjZXNzYXJ5XG4gICAgY29uc3QgY2xhc3NOYW1lID0gcmVxdWVzdC5xdWVyeS5jbGFzc05hbWU7XG4gICAgaWYgKCF0aGlzLnN1YnNjcmlwdGlvbnMuaGFzKGNsYXNzTmFtZSkpIHtcbiAgICAgIHRoaXMuc3Vic2NyaXB0aW9ucy5zZXQoY2xhc3NOYW1lLCBuZXcgTWFwKCkpO1xuICAgIH1cbiAgICBjb25zdCBjbGFzc1N1YnNjcmlwdGlvbnMgPSB0aGlzLnN1YnNjcmlwdGlvbnMuZ2V0KGNsYXNzTmFtZSk7XG4gICAgbGV0IHN1YnNjcmlwdGlvbjtcbiAgICBpZiAoY2xhc3NTdWJzY3JpcHRpb25zLmhhcyhzdWJzY3JpcHRpb25IYXNoKSkge1xuICAgICAgc3Vic2NyaXB0aW9uID0gY2xhc3NTdWJzY3JpcHRpb25zLmdldChzdWJzY3JpcHRpb25IYXNoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3Vic2NyaXB0aW9uID0gbmV3IFN1YnNjcmlwdGlvbihjbGFzc05hbWUsIHJlcXVlc3QucXVlcnkud2hlcmUsIHN1YnNjcmlwdGlvbkhhc2gpO1xuICAgICAgY2xhc3NTdWJzY3JpcHRpb25zLnNldChzdWJzY3JpcHRpb25IYXNoLCBzdWJzY3JpcHRpb24pO1xuICAgIH1cblxuICAgIC8vIEFkZCBzdWJzY3JpcHRpb25JbmZvIHRvIGNsaWVudFxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbkluZm8gPSB7XG4gICAgICBzdWJzY3JpcHRpb246IHN1YnNjcmlwdGlvblxuICAgIH07XG4gICAgLy8gQWRkIHNlbGVjdGVkIGZpZWxkcyBhbmQgc2Vzc2lvblRva2VuIGZvciB0aGlzIHN1YnNjcmlwdGlvbiBpZiBuZWNlc3NhcnlcbiAgICBpZiAocmVxdWVzdC5xdWVyeS5maWVsZHMpIHtcbiAgICAgIHN1YnNjcmlwdGlvbkluZm8uZmllbGRzID0gcmVxdWVzdC5xdWVyeS5maWVsZHM7XG4gICAgfVxuICAgIGlmIChyZXF1ZXN0LnNlc3Npb25Ub2tlbikge1xuICAgICAgc3Vic2NyaXB0aW9uSW5mby5zZXNzaW9uVG9rZW4gPSByZXF1ZXN0LnNlc3Npb25Ub2tlbjtcbiAgICB9XG4gICAgY2xpZW50LmFkZFN1YnNjcmlwdGlvbkluZm8ocmVxdWVzdC5yZXF1ZXN0SWQsIHN1YnNjcmlwdGlvbkluZm8pO1xuXG4gICAgLy8gQWRkIGNsaWVudElkIHRvIHN1YnNjcmlwdGlvblxuICAgIHN1YnNjcmlwdGlvbi5hZGRDbGllbnRTdWJzY3JpcHRpb24ocGFyc2VXZWJzb2NrZXQuY2xpZW50SWQsIHJlcXVlc3QucmVxdWVzdElkKTtcblxuICAgIGNsaWVudC5wdXNoU3Vic2NyaWJlKHJlcXVlc3QucmVxdWVzdElkKTtcblxuICAgIGxvZ2dlci52ZXJib3NlKGBDcmVhdGUgY2xpZW50ICR7cGFyc2VXZWJzb2NrZXQuY2xpZW50SWR9IG5ldyBzdWJzY3JpcHRpb246ICR7cmVxdWVzdC5yZXF1ZXN0SWR9YCk7XG4gICAgbG9nZ2VyLnZlcmJvc2UoJ0N1cnJlbnQgY2xpZW50IG51bWJlcjogJWQnLCB0aGlzLmNsaWVudHMuc2l6ZSk7XG4gICAgcnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyh7XG4gICAgICBldmVudDogJ3N1YnNjcmliZScsXG4gICAgICBjbGllbnRzOiB0aGlzLmNsaWVudHMuc2l6ZSxcbiAgICAgIHN1YnNjcmlwdGlvbnM6IHRoaXMuc3Vic2NyaXB0aW9ucy5zaXplXG4gICAgfSk7XG4gIH1cblxuICBfaGFuZGxlVXBkYXRlU3Vic2NyaXB0aW9uKHBhcnNlV2Vic29ja2V0OiBhbnksIHJlcXVlc3Q6IGFueSk6IGFueSB7XG4gICAgdGhpcy5faGFuZGxlVW5zdWJzY3JpYmUocGFyc2VXZWJzb2NrZXQsIHJlcXVlc3QsIGZhbHNlKTtcbiAgICB0aGlzLl9oYW5kbGVTdWJzY3JpYmUocGFyc2VXZWJzb2NrZXQsIHJlcXVlc3QpO1xuICB9XG5cbiAgX2hhbmRsZVVuc3Vic2NyaWJlKHBhcnNlV2Vic29ja2V0OiBhbnksIHJlcXVlc3Q6IGFueSwgbm90aWZ5Q2xpZW50OiBib29sID0gdHJ1ZSk6IGFueSB7XG4gICAgLy8gSWYgd2UgY2FuIG5vdCBmaW5kIHRoaXMgY2xpZW50LCByZXR1cm4gZXJyb3IgdG8gY2xpZW50XG4gICAgaWYgKCFwYXJzZVdlYnNvY2tldC5oYXNPd25Qcm9wZXJ0eSgnY2xpZW50SWQnKSkge1xuICAgICAgQ2xpZW50LnB1c2hFcnJvcihwYXJzZVdlYnNvY2tldCwgMiwgJ0NhbiBub3QgZmluZCB0aGlzIGNsaWVudCwgbWFrZSBzdXJlIHlvdSBjb25uZWN0IHRvIHNlcnZlciBiZWZvcmUgdW5zdWJzY3JpYmluZycpO1xuICAgICAgbG9nZ2VyLmVycm9yKCdDYW4gbm90IGZpbmQgdGhpcyBjbGllbnQsIG1ha2Ugc3VyZSB5b3UgY29ubmVjdCB0byBzZXJ2ZXIgYmVmb3JlIHVuc3Vic2NyaWJpbmcnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcmVxdWVzdElkID0gcmVxdWVzdC5yZXF1ZXN0SWQ7XG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnRzLmdldChwYXJzZVdlYnNvY2tldC5jbGllbnRJZCk7XG4gICAgaWYgKHR5cGVvZiBjbGllbnQgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBDbGllbnQucHVzaEVycm9yKHBhcnNlV2Vic29ja2V0LCAyLCAnQ2Fubm90IGZpbmQgY2xpZW50IHdpdGggY2xpZW50SWQgJyAgKyBwYXJzZVdlYnNvY2tldC5jbGllbnRJZCArXG4gICAgICAgICcuIE1ha2Ugc3VyZSB5b3UgY29ubmVjdCB0byBsaXZlIHF1ZXJ5IHNlcnZlciBiZWZvcmUgdW5zdWJzY3JpYmluZy4nKTtcbiAgICAgIGxvZ2dlci5lcnJvcignQ2FuIG5vdCBmaW5kIHRoaXMgY2xpZW50ICcgKyBwYXJzZVdlYnNvY2tldC5jbGllbnRJZCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uSW5mbyA9IGNsaWVudC5nZXRTdWJzY3JpcHRpb25JbmZvKHJlcXVlc3RJZCk7XG4gICAgaWYgKHR5cGVvZiBzdWJzY3JpcHRpb25JbmZvID09PSAndW5kZWZpbmVkJykge1xuICAgICAgQ2xpZW50LnB1c2hFcnJvcihwYXJzZVdlYnNvY2tldCwgMiwgJ0Nhbm5vdCBmaW5kIHN1YnNjcmlwdGlvbiB3aXRoIGNsaWVudElkICcgICsgcGFyc2VXZWJzb2NrZXQuY2xpZW50SWQgK1xuICAgICAgICAnIHN1YnNjcmlwdGlvbklkICcgKyByZXF1ZXN0SWQgKyAnLiBNYWtlIHN1cmUgeW91IHN1YnNjcmliZSB0byBsaXZlIHF1ZXJ5IHNlcnZlciBiZWZvcmUgdW5zdWJzY3JpYmluZy4nKTtcbiAgICAgIGxvZ2dlci5lcnJvcignQ2FuIG5vdCBmaW5kIHN1YnNjcmlwdGlvbiB3aXRoIGNsaWVudElkICcgKyBwYXJzZVdlYnNvY2tldC5jbGllbnRJZCArICAnIHN1YnNjcmlwdGlvbklkICcgKyByZXF1ZXN0SWQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFJlbW92ZSBzdWJzY3JpcHRpb24gZnJvbSBjbGllbnRcbiAgICBjbGllbnQuZGVsZXRlU3Vic2NyaXB0aW9uSW5mbyhyZXF1ZXN0SWQpO1xuICAgIC8vIFJlbW92ZSBjbGllbnQgZnJvbSBzdWJzY3JpcHRpb25cbiAgICBjb25zdCBzdWJzY3JpcHRpb24gPSBzdWJzY3JpcHRpb25JbmZvLnN1YnNjcmlwdGlvbjtcbiAgICBjb25zdCBjbGFzc05hbWUgPSBzdWJzY3JpcHRpb24uY2xhc3NOYW1lO1xuICAgIHN1YnNjcmlwdGlvbi5kZWxldGVDbGllbnRTdWJzY3JpcHRpb24ocGFyc2VXZWJzb2NrZXQuY2xpZW50SWQsIHJlcXVlc3RJZCk7XG4gICAgLy8gSWYgdGhlcmUgaXMgbm8gY2xpZW50IHdoaWNoIGlzIHN1YnNjcmliaW5nIHRoaXMgc3Vic2NyaXB0aW9uLCByZW1vdmUgaXQgZnJvbSBzdWJzY3JpcHRpb25zXG4gICAgY29uc3QgY2xhc3NTdWJzY3JpcHRpb25zID0gdGhpcy5zdWJzY3JpcHRpb25zLmdldChjbGFzc05hbWUpO1xuICAgIGlmICghc3Vic2NyaXB0aW9uLmhhc1N1YnNjcmliaW5nQ2xpZW50KCkpIHtcbiAgICAgIGNsYXNzU3Vic2NyaXB0aW9ucy5kZWxldGUoc3Vic2NyaXB0aW9uLmhhc2gpO1xuICAgIH1cbiAgICAvLyBJZiB0aGVyZSBpcyBubyBzdWJzY3JpcHRpb25zIHVuZGVyIHRoaXMgY2xhc3MsIHJlbW92ZSBpdCBmcm9tIHN1YnNjcmlwdGlvbnNcbiAgICBpZiAoY2xhc3NTdWJzY3JpcHRpb25zLnNpemUgPT09IDApIHtcbiAgICAgIHRoaXMuc3Vic2NyaXB0aW9ucy5kZWxldGUoY2xhc3NOYW1lKTtcbiAgICB9XG4gICAgcnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyh7XG4gICAgICBldmVudDogJ3Vuc3Vic2NyaWJlJyxcbiAgICAgIGNsaWVudHM6IHRoaXMuY2xpZW50cy5zaXplLFxuICAgICAgc3Vic2NyaXB0aW9uczogdGhpcy5zdWJzY3JpcHRpb25zLnNpemVcbiAgICB9KTtcblxuICAgIGlmICghbm90aWZ5Q2xpZW50KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY2xpZW50LnB1c2hVbnN1YnNjcmliZShyZXF1ZXN0LnJlcXVlc3RJZCk7XG5cbiAgICBsb2dnZXIudmVyYm9zZShgRGVsZXRlIGNsaWVudDogJHtwYXJzZVdlYnNvY2tldC5jbGllbnRJZH0gfCBzdWJzY3JpcHRpb246ICR7cmVxdWVzdC5yZXF1ZXN0SWR9YCk7XG4gIH1cbn1cblxuZXhwb3J0IHtcbiAgUGFyc2VMaXZlUXVlcnlTZXJ2ZXJcbn1cbiJdfQ==