'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Types = undefined;
exports.addFunction = addFunction;
exports.addJob = addJob;
exports.addTrigger = addTrigger;
exports.addLiveQueryEventHandler = addLiveQueryEventHandler;
exports.removeFunction = removeFunction;
exports.removeTrigger = removeTrigger;
exports._unregisterAll = _unregisterAll;
exports.getTrigger = getTrigger;
exports.triggerExists = triggerExists;
exports.getFunction = getFunction;
exports.getJob = getJob;
exports.getJobs = getJobs;
exports.getValidator = getValidator;
exports.getRequestObject = getRequestObject;
exports.getRequestQueryObject = getRequestQueryObject;
exports.getResponseObject = getResponseObject;
exports.maybeRunAfterFindTrigger = maybeRunAfterFindTrigger;
exports.maybeRunQueryTrigger = maybeRunQueryTrigger;
exports.maybeRunTrigger = maybeRunTrigger;
exports.inflate = inflate;
exports.runLiveQueryEventHandlers = runLiveQueryEventHandlers;

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _logger = require('./logger');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// triggers.js
const Types = exports.Types = {
  beforeSave: 'beforeSave',
  afterSave: 'afterSave',
  beforeDelete: 'beforeDelete',
  afterDelete: 'afterDelete',
  beforeFind: 'beforeFind',
  afterFind: 'afterFind'
};

const baseStore = function () {
  const Validators = {};
  const Functions = {};
  const Jobs = {};
  const LiveQuery = [];
  const Triggers = Object.keys(Types).reduce(function (base, key) {
    base[key] = {};
    return base;
  }, {});

  return Object.freeze({
    Functions,
    Jobs,
    Validators,
    Triggers,
    LiveQuery
  });
};

function validateClassNameForTriggers(className, type) {
  const restrictedClassNames = ['_Session'];
  if (restrictedClassNames.indexOf(className) != -1) {
    throw `Triggers are not supported for ${className} class.`;
  }
  if (type == Types.beforeSave && className === '_PushStatus') {
    // _PushStatus uses undocumented nested key increment ops
    // allowing beforeSave would mess up the objects big time
    // TODO: Allow proper documented way of using nested increment ops
    throw 'Only afterSave is allowed on _PushStatus';
  }
  return className;
}

const _triggerStore = {};

function addFunction(functionName, handler, validationHandler, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].Functions[functionName] = handler;
  _triggerStore[applicationId].Validators[functionName] = validationHandler;
}

function addJob(jobName, handler, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].Jobs[jobName] = handler;
}

function addTrigger(type, className, handler, applicationId) {
  validateClassNameForTriggers(className, type);
  applicationId = applicationId || _node2.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].Triggers[type][className] = handler;
}

function addLiveQueryEventHandler(handler, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].LiveQuery.push(handler);
}

function removeFunction(functionName, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  delete _triggerStore[applicationId].Functions[functionName];
}

function removeTrigger(type, className, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  delete _triggerStore[applicationId].Triggers[type][className];
}

function _unregisterAll() {
  Object.keys(_triggerStore).forEach(appId => delete _triggerStore[appId]);
}

function getTrigger(className, triggerType, applicationId) {
  if (!applicationId) {
    throw "Missing ApplicationID";
  }
  var manager = _triggerStore[applicationId];
  if (manager && manager.Triggers && manager.Triggers[triggerType] && manager.Triggers[triggerType][className]) {
    return manager.Triggers[triggerType][className];
  }
  return undefined;
}

function triggerExists(className, type, applicationId) {
  return getTrigger(className, type, applicationId) != undefined;
}

function getFunction(functionName, applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Functions) {
    return manager.Functions[functionName];
  }
  return undefined;
}

function getJob(jobName, applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Jobs) {
    return manager.Jobs[jobName];
  }
  return undefined;
}

function getJobs(applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Jobs) {
    return manager.Jobs;
  }
  return undefined;
}

function getValidator(functionName, applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Validators) {
    return manager.Validators[functionName];
  }
  return undefined;
}

function getRequestObject(triggerType, auth, parseObject, originalParseObject, config) {
  var request = {
    triggerName: triggerType,
    object: parseObject,
    master: false,
    log: config.loggerController,
    headers: config.headers,
    ip: config.ip
  };

  if (originalParseObject) {
    request.original = originalParseObject;
  }

  if (!auth) {
    return request;
  }
  if (auth.isMaster) {
    request['master'] = true;
  }
  if (auth.user) {
    request['user'] = auth.user;
  }
  if (auth.installationId) {
    request['installationId'] = auth.installationId;
  }
  return request;
}

function getRequestQueryObject(triggerType, auth, query, count, config, isGet) {
  isGet = !!isGet;

  var request = {
    triggerName: triggerType,
    query,
    master: false,
    count,
    log: config.loggerController,
    isGet,
    headers: config.headers,
    ip: config.ip
  };

  if (!auth) {
    return request;
  }
  if (auth.isMaster) {
    request['master'] = true;
  }
  if (auth.user) {
    request['user'] = auth.user;
  }
  if (auth.installationId) {
    request['installationId'] = auth.installationId;
  }
  return request;
}

// Creates the response object, and uses the request object to pass data
// The API will call this with REST API formatted objects, this will
// transform them to Parse.Object instances expected by Cloud Code.
// Any changes made to the object in a beforeSave will be included.
function getResponseObject(request, resolve, reject) {
  return {
    success: function (response) {
      if (request.triggerName === Types.afterFind) {
        if (!response) {
          response = request.objects;
        }
        response = response.map(object => {
          return object.toJSON();
        });
        return resolve(response);
      }
      // Use the JSON response
      if (response && !request.object.equals(response) && request.triggerName === Types.beforeSave) {
        return resolve(response);
      }
      response = {};
      if (request.triggerName === Types.beforeSave) {
        response['object'] = request.object._getSaveJSON();
      }
      return resolve(response);
    },
    error: function (code, message) {
      if (!message) {
        if (code instanceof _node2.default.Error) {
          return reject(code);
        }
        message = code;
        code = _node2.default.Error.SCRIPT_FAILED;
      }
      var scriptError = new _node2.default.Error(code, message);
      return reject(scriptError);
    }
  };
}

function userIdForLog(auth) {
  return auth && auth.user ? auth.user.id : undefined;
}

function logTriggerAfterHook(triggerType, className, input, auth) {
  const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(input));
  _logger.logger.info(`${triggerType} triggered for ${className} for user ${userIdForLog(auth)}:\n  Input: ${cleanInput}`, {
    className,
    triggerType,
    user: userIdForLog(auth)
  });
}

function logTriggerSuccessBeforeHook(triggerType, className, input, result, auth) {
  const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(input));
  const cleanResult = _logger.logger.truncateLogMessage(JSON.stringify(result));
  _logger.logger.info(`${triggerType} triggered for ${className} for user ${userIdForLog(auth)}:\n  Input: ${cleanInput}\n  Result: ${cleanResult}`, {
    className,
    triggerType,
    user: userIdForLog(auth)
  });
}

function logTriggerErrorBeforeHook(triggerType, className, input, auth, error) {
  const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(input));
  _logger.logger.error(`${triggerType} failed for ${className} for user ${userIdForLog(auth)}:\n  Input: ${cleanInput}\n  Error: ${JSON.stringify(error)}`, {
    className,
    triggerType,
    error,
    user: userIdForLog(auth)
  });
}

function maybeRunAfterFindTrigger(triggerType, auth, className, objects, config) {
  return new Promise((resolve, reject) => {
    const trigger = getTrigger(className, triggerType, config.applicationId);
    if (!trigger) {
      return resolve();
    }
    const request = getRequestObject(triggerType, auth, null, null, config);
    const response = getResponseObject(request, object => {
      resolve(object);
    }, error => {
      reject(error);
    });
    logTriggerSuccessBeforeHook(triggerType, className, 'AfterFind', JSON.stringify(objects), auth);
    request.objects = objects.map(object => {
      //setting the class name to transform into parse object
      object.className = className;
      return _node2.default.Object.fromJSON(object);
    });
    const triggerPromise = trigger(request, response);
    if (triggerPromise && typeof triggerPromise.then === "function") {
      return triggerPromise.then(promiseResults => {
        if (promiseResults) {
          resolve(promiseResults);
        } else {
          return reject(new _node2.default.Error(_node2.default.Error.SCRIPT_FAILED, "AfterFind expect results to be returned in the promise"));
        }
      });
    }
  }).then(results => {
    logTriggerAfterHook(triggerType, className, JSON.stringify(results), auth);
    return results;
  });
}

function maybeRunQueryTrigger(triggerType, className, restWhere, restOptions, config, auth, isGet) {
  const trigger = getTrigger(className, triggerType, config.applicationId);
  if (!trigger) {
    return Promise.resolve({
      restWhere,
      restOptions
    });
  }

  const parseQuery = new _node2.default.Query(className);
  if (restWhere) {
    parseQuery._where = restWhere;
  }
  let count = false;
  if (restOptions) {
    if (restOptions.include && restOptions.include.length > 0) {
      parseQuery._include = restOptions.include.split(',');
    }
    if (restOptions.skip) {
      parseQuery._skip = restOptions.skip;
    }
    if (restOptions.limit) {
      parseQuery._limit = restOptions.limit;
    }
    count = !!restOptions.count;
  }
  const requestObject = getRequestQueryObject(triggerType, auth, parseQuery, count, config, isGet);
  return Promise.resolve().then(() => {
    return trigger(requestObject);
  }).then(result => {
    let queryResult = parseQuery;
    if (result && result instanceof _node2.default.Query) {
      queryResult = result;
    }
    const jsonQuery = queryResult.toJSON();
    if (jsonQuery.where) {
      restWhere = jsonQuery.where;
    }
    if (jsonQuery.limit) {
      restOptions = restOptions || {};
      restOptions.limit = jsonQuery.limit;
    }
    if (jsonQuery.skip) {
      restOptions = restOptions || {};
      restOptions.skip = jsonQuery.skip;
    }
    if (jsonQuery.include) {
      restOptions = restOptions || {};
      restOptions.include = jsonQuery.include;
    }
    if (jsonQuery.keys) {
      restOptions = restOptions || {};
      restOptions.keys = jsonQuery.keys;
    }
    if (jsonQuery.order) {
      restOptions = restOptions || {};
      restOptions.order = jsonQuery.order;
    }
    if (requestObject.readPreference) {
      restOptions = restOptions || {};
      restOptions.readPreference = requestObject.readPreference;
    }
    if (requestObject.includeReadPreference) {
      restOptions = restOptions || {};
      restOptions.includeReadPreference = requestObject.includeReadPreference;
    }
    if (requestObject.subqueryReadPreference) {
      restOptions = restOptions || {};
      restOptions.subqueryReadPreference = requestObject.subqueryReadPreference;
    }
    return {
      restWhere,
      restOptions
    };
  }, err => {
    if (typeof err === 'string') {
      throw new _node2.default.Error(1, err);
    } else {
      throw err;
    }
  });
}

// To be used as part of the promise chain when saving/deleting an object
// Will resolve successfully if no trigger is configured
// Resolves to an object, empty or containing an object key. A beforeSave
// trigger will set the object key to the rest format object to save.
// originalParseObject is optional, we only need that for before/afterSave functions
function maybeRunTrigger(triggerType, auth, parseObject, originalParseObject, config) {
  if (!parseObject) {
    return Promise.resolve({});
  }
  return new Promise(function (resolve, reject) {
    var trigger = getTrigger(parseObject.className, triggerType, config.applicationId);
    if (!trigger) return resolve();
    var request = getRequestObject(triggerType, auth, parseObject, originalParseObject, config);
    var response = getResponseObject(request, object => {
      logTriggerSuccessBeforeHook(triggerType, parseObject.className, parseObject.toJSON(), object, auth);
      resolve(object);
    }, error => {
      logTriggerErrorBeforeHook(triggerType, parseObject.className, parseObject.toJSON(), auth, error);
      reject(error);
    });
    // Force the current Parse app before the trigger
    _node2.default.applicationId = config.applicationId;
    _node2.default.javascriptKey = config.javascriptKey || '';
    _node2.default.masterKey = config.masterKey;

    // AfterSave and afterDelete triggers can return a promise, which if they
    // do, needs to be resolved before this promise is resolved,
    // so trigger execution is synced with RestWrite.execute() call.
    // If triggers do not return a promise, they can run async code parallel
    // to the RestWrite.execute() call.
    var triggerPromise = trigger(request, response);
    if (triggerType === Types.afterSave || triggerType === Types.afterDelete) {
      logTriggerAfterHook(triggerType, parseObject.className, parseObject.toJSON(), auth);
      if (triggerPromise && typeof triggerPromise.then === "function") {
        return triggerPromise.then(resolve, resolve);
      } else {
        return resolve();
      }
    }
  });
}

// Converts a REST-format object to a Parse.Object
// data is either className or an object
function inflate(data, restObject) {
  var copy = typeof data == 'object' ? data : { className: data };
  for (var key in restObject) {
    copy[key] = restObject[key];
  }
  return _node2.default.Object.fromJSON(copy);
}

function runLiveQueryEventHandlers(data, applicationId = _node2.default.applicationId) {
  if (!_triggerStore || !_triggerStore[applicationId] || !_triggerStore[applicationId].LiveQuery) {
    return;
  }
  _triggerStore[applicationId].LiveQuery.forEach(handler => handler(data));
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy90cmlnZ2Vycy5qcyJdLCJuYW1lcyI6WyJhZGRGdW5jdGlvbiIsImFkZEpvYiIsImFkZFRyaWdnZXIiLCJhZGRMaXZlUXVlcnlFdmVudEhhbmRsZXIiLCJyZW1vdmVGdW5jdGlvbiIsInJlbW92ZVRyaWdnZXIiLCJfdW5yZWdpc3RlckFsbCIsImdldFRyaWdnZXIiLCJ0cmlnZ2VyRXhpc3RzIiwiZ2V0RnVuY3Rpb24iLCJnZXRKb2IiLCJnZXRKb2JzIiwiZ2V0VmFsaWRhdG9yIiwiZ2V0UmVxdWVzdE9iamVjdCIsImdldFJlcXVlc3RRdWVyeU9iamVjdCIsImdldFJlc3BvbnNlT2JqZWN0IiwibWF5YmVSdW5BZnRlckZpbmRUcmlnZ2VyIiwibWF5YmVSdW5RdWVyeVRyaWdnZXIiLCJtYXliZVJ1blRyaWdnZXIiLCJpbmZsYXRlIiwicnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyIsIlR5cGVzIiwiYmVmb3JlU2F2ZSIsImFmdGVyU2F2ZSIsImJlZm9yZURlbGV0ZSIsImFmdGVyRGVsZXRlIiwiYmVmb3JlRmluZCIsImFmdGVyRmluZCIsImJhc2VTdG9yZSIsIlZhbGlkYXRvcnMiLCJGdW5jdGlvbnMiLCJKb2JzIiwiTGl2ZVF1ZXJ5IiwiVHJpZ2dlcnMiLCJPYmplY3QiLCJrZXlzIiwicmVkdWNlIiwiYmFzZSIsImtleSIsImZyZWV6ZSIsInZhbGlkYXRlQ2xhc3NOYW1lRm9yVHJpZ2dlcnMiLCJjbGFzc05hbWUiLCJ0eXBlIiwicmVzdHJpY3RlZENsYXNzTmFtZXMiLCJpbmRleE9mIiwiX3RyaWdnZXJTdG9yZSIsImZ1bmN0aW9uTmFtZSIsImhhbmRsZXIiLCJ2YWxpZGF0aW9uSGFuZGxlciIsImFwcGxpY2F0aW9uSWQiLCJQYXJzZSIsImpvYk5hbWUiLCJwdXNoIiwiZm9yRWFjaCIsImFwcElkIiwidHJpZ2dlclR5cGUiLCJtYW5hZ2VyIiwidW5kZWZpbmVkIiwiYXV0aCIsInBhcnNlT2JqZWN0Iiwib3JpZ2luYWxQYXJzZU9iamVjdCIsImNvbmZpZyIsInJlcXVlc3QiLCJ0cmlnZ2VyTmFtZSIsIm9iamVjdCIsIm1hc3RlciIsImxvZyIsImxvZ2dlckNvbnRyb2xsZXIiLCJoZWFkZXJzIiwiaXAiLCJvcmlnaW5hbCIsImlzTWFzdGVyIiwidXNlciIsImluc3RhbGxhdGlvbklkIiwicXVlcnkiLCJjb3VudCIsImlzR2V0IiwicmVzb2x2ZSIsInJlamVjdCIsInN1Y2Nlc3MiLCJyZXNwb25zZSIsIm9iamVjdHMiLCJtYXAiLCJ0b0pTT04iLCJlcXVhbHMiLCJfZ2V0U2F2ZUpTT04iLCJlcnJvciIsImNvZGUiLCJtZXNzYWdlIiwiRXJyb3IiLCJTQ1JJUFRfRkFJTEVEIiwic2NyaXB0RXJyb3IiLCJ1c2VySWRGb3JMb2ciLCJpZCIsImxvZ1RyaWdnZXJBZnRlckhvb2siLCJpbnB1dCIsImNsZWFuSW5wdXQiLCJsb2dnZXIiLCJ0cnVuY2F0ZUxvZ01lc3NhZ2UiLCJKU09OIiwic3RyaW5naWZ5IiwiaW5mbyIsImxvZ1RyaWdnZXJTdWNjZXNzQmVmb3JlSG9vayIsInJlc3VsdCIsImNsZWFuUmVzdWx0IiwibG9nVHJpZ2dlckVycm9yQmVmb3JlSG9vayIsIlByb21pc2UiLCJ0cmlnZ2VyIiwiZnJvbUpTT04iLCJ0cmlnZ2VyUHJvbWlzZSIsInRoZW4iLCJwcm9taXNlUmVzdWx0cyIsInJlc3VsdHMiLCJyZXN0V2hlcmUiLCJyZXN0T3B0aW9ucyIsInBhcnNlUXVlcnkiLCJRdWVyeSIsIl93aGVyZSIsImluY2x1ZGUiLCJsZW5ndGgiLCJfaW5jbHVkZSIsInNwbGl0Iiwic2tpcCIsIl9za2lwIiwibGltaXQiLCJfbGltaXQiLCJyZXF1ZXN0T2JqZWN0IiwicXVlcnlSZXN1bHQiLCJqc29uUXVlcnkiLCJ3aGVyZSIsIm9yZGVyIiwicmVhZFByZWZlcmVuY2UiLCJpbmNsdWRlUmVhZFByZWZlcmVuY2UiLCJzdWJxdWVyeVJlYWRQcmVmZXJlbmNlIiwiZXJyIiwiamF2YXNjcmlwdEtleSIsIm1hc3RlcktleSIsImRhdGEiLCJyZXN0T2JqZWN0IiwiY29w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QUFaLEVBQXhELEVBQThFekIsSUFBOUU7QUFDQSxVQUFHbUQsa0JBQWtCLE9BQU9BLGVBQWVDLElBQXRCLEtBQStCLFVBQXBELEVBQWdFO0FBQzlELGVBQU9ELGVBQWVDLElBQWYsQ0FBb0JqQyxPQUFwQixFQUE2QkEsT0FBN0IsQ0FBUDtBQUNELE9BRkQsTUFHSztBQUNILGVBQU9BLFNBQVA7QUFDRDtBQUNGO0FBQ0YsR0FsQ00sQ0FBUDtBQW1DRDs7QUFFRDtBQUNBO0FBQ08sU0FBUzFELE9BQVQsQ0FBaUJzSCxJQUFqQixFQUF1QkMsVUFBdkIsRUFBbUM7QUFDeEMsTUFBSUMsT0FBTyxPQUFPRixJQUFQLElBQWUsUUFBZixHQUEwQkEsSUFBMUIsR0FBaUMsRUFBQ2hHLFdBQVdnRyxJQUFaLEVBQTVDO0FBQ0EsT0FBSyxJQUFJbkcsR0FBVCxJQUFnQm9HLFVBQWhCLEVBQTRCO0FBQzFCQyxTQUFLckcsR0FBTCxJQUFZb0csV0FBV3BHLEdBQVgsQ0FBWjtBQUNEO0FBQ0QsU0FBT1ksZUFBTWhCLE1BQU4sQ0FBYTBFLFFBQWIsQ0FBc0IrQixJQUF0QixDQUFQO0FBQ0Q7O0FBRU0sU0FBU3ZILHlCQUFULENBQW1DcUgsSUFBbkMsRUFBeUN4RixnQkFBZ0JDLGVBQU1ELGFBQS9ELEVBQThFO0FBQ25GLE1BQUksQ0FBQ0osYUFBRCxJQUFrQixDQUFDQSxjQUFjSSxhQUFkLENBQW5CLElBQW1ELENBQUNKLGNBQWNJLGFBQWQsRUFBNkJqQixTQUFyRixFQUFnRztBQUFFO0FBQVM7QUFDM0dhLGdCQUFjSSxhQUFkLEVBQTZCakIsU0FBN0IsQ0FBdUNxQixPQUF2QyxDQUFnRE4sT0FBRCxJQUFhQSxRQUFRMEYsSUFBUixDQUE1RDtBQUNEIiwiZmlsZSI6InRyaWdnZXJzLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLy8gdHJpZ2dlcnMuanNcbmltcG9ydCBQYXJzZSAgICBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4vbG9nZ2VyJztcblxuZXhwb3J0IGNvbnN0IFR5cGVzID0ge1xuICBiZWZvcmVTYXZlOiAnYmVmb3JlU2F2ZScsXG4gIGFmdGVyU2F2ZTogJ2FmdGVyU2F2ZScsXG4gIGJlZm9yZURlbGV0ZTogJ2JlZm9yZURlbGV0ZScsXG4gIGFmdGVyRGVsZXRlOiAnYWZ0ZXJEZWxldGUnLFxuICBiZWZvcmVGaW5kOiAnYmVmb3JlRmluZCcsXG4gIGFmdGVyRmluZDogJ2FmdGVyRmluZCdcbn07XG5cbmNvbnN0IGJhc2VTdG9yZSA9IGZ1bmN0aW9uKCkge1xuICBjb25zdCBWYWxpZGF0b3JzID0ge307XG4gIGNvbnN0IEZ1bmN0aW9ucyA9IHt9O1xuICBjb25zdCBKb2JzID0ge307XG4gIGNvbnN0IExpdmVRdWVyeSA9IFtdO1xuICBjb25zdCBUcmlnZ2VycyA9IE9iamVjdC5rZXlzKFR5cGVzKS5yZWR1Y2UoZnVuY3Rpb24oYmFzZSwga2V5KXtcbiAgICBiYXNlW2tleV0gPSB7fTtcbiAgICByZXR1cm4gYmFzZTtcbiAgfSwge30pO1xuXG4gIHJldHVybiBPYmplY3QuZnJlZXplKHtcbiAgICBGdW5jdGlvbnMsXG4gICAgSm9icyxcbiAgICBWYWxpZGF0b3JzLFxuICAgIFRyaWdnZXJzLFxuICAgIExpdmVRdWVyeSxcbiAgfSk7XG59O1xuXG5mdW5jdGlvbiB2YWxpZGF0ZUNsYXNzTmFtZUZvclRyaWdnZXJzKGNsYXNzTmFtZSwgdHlwZSkge1xuICBjb25zdCByZXN0cmljdGVkQ2xhc3NOYW1lcyA9IFsgJ19TZXNzaW9uJyBdO1xuICBpZiAocmVzdHJpY3RlZENsYXNzTmFtZXMuaW5kZXhPZihjbGFzc05hbWUpICE9IC0xKSB7XG4gICAgdGhyb3cgYFRyaWdnZXJzIGFyZSBub3Qgc3VwcG9ydGVkIGZvciAke2NsYXNzTmFtZX0gY2xhc3MuYDtcbiAgfVxuICBpZiAodHlwZSA9PSBUeXBlcy5iZWZvcmVTYXZlICYmIGNsYXNzTmFtZSA9PT0gJ19QdXNoU3RhdHVzJykge1xuICAgIC8vIF9QdXNoU3RhdHVzIHVzZXMgdW5kb2N1bWVudGVkIG5lc3RlZCBrZXkgaW5jcmVtZW50IG9wc1xuICAgIC8vIGFsbG93aW5nIGJlZm9yZVNhdmUgd291bGQgbWVzcyB1cCB0aGUgb2JqZWN0cyBiaWcgdGltZVxuICAgIC8vIFRPRE86IEFsbG93IHByb3BlciBkb2N1bWVudGVkIHdheSBvZiB1c2luZyBuZXN0ZWQgaW5jcmVtZW50IG9wc1xuICAgIHRocm93ICdPbmx5IGFmdGVyU2F2ZSBpcyBhbGxvd2VkIG9uIF9QdXNoU3RhdHVzJztcbiAgfVxuICByZXR1cm4gY2xhc3NOYW1lO1xufVxuXG5jb25zdCBfdHJpZ2dlclN0b3JlID0ge307XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRGdW5jdGlvbihmdW5jdGlvbk5hbWUsIGhhbmRsZXIsIHZhbGlkYXRpb25IYW5kbGVyLCBhcHBsaWNhdGlvbklkKSB7XG4gIGFwcGxpY2F0aW9uSWQgPSBhcHBsaWNhdGlvbklkIHx8IFBhcnNlLmFwcGxpY2F0aW9uSWQ7XG4gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0gPSAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXSB8fCBiYXNlU3RvcmUoKTtcbiAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXS5GdW5jdGlvbnNbZnVuY3Rpb25OYW1lXSA9IGhhbmRsZXI7XG4gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0uVmFsaWRhdG9yc1tmdW5jdGlvbk5hbWVdID0gdmFsaWRhdGlvbkhhbmRsZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRKb2Ioam9iTmFtZSwgaGFuZGxlciwgYXBwbGljYXRpb25JZCkge1xuICBhcHBsaWNhdGlvbklkID0gYXBwbGljYXRpb25JZCB8fCBQYXJzZS5hcHBsaWNhdGlvbklkO1xuICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdID0gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0gfHwgYmFzZVN0b3JlKCk7XG4gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0uSm9ic1tqb2JOYW1lXSA9IGhhbmRsZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRUcmlnZ2VyKHR5cGUsIGNsYXNzTmFtZSwgaGFuZGxlciwgYXBwbGljYXRpb25JZCkge1xuICB2YWxpZGF0ZUNsYXNzTmFtZUZvclRyaWdnZXJzKGNsYXNzTmFtZSwgdHlwZSk7XG4gIGFwcGxpY2F0aW9uSWQgPSBhcHBsaWNhdGlvbklkIHx8IFBhcnNlLmFwcGxpY2F0aW9uSWQ7XG4gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0gPSAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXSB8fCBiYXNlU3RvcmUoKTtcbiAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXS5UcmlnZ2Vyc1t0eXBlXVtjbGFzc05hbWVdID0gaGFuZGxlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZExpdmVRdWVyeUV2ZW50SGFuZGxlcihoYW5kbGVyLCBhcHBsaWNhdGlvbklkKSB7XG4gIGFwcGxpY2F0aW9uSWQgPSBhcHBsaWNhdGlvbklkIHx8IFBhcnNlLmFwcGxpY2F0aW9uSWQ7XG4gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0gPSAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXSB8fCBiYXNlU3RvcmUoKTtcbiAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXS5MaXZlUXVlcnkucHVzaChoYW5kbGVyKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUZ1bmN0aW9uKGZ1bmN0aW9uTmFtZSwgYXBwbGljYXRpb25JZCkge1xuICBhcHBsaWNhdGlvbklkID0gYXBwbGljYXRpb25JZCB8fCBQYXJzZS5hcHBsaWNhdGlvbklkO1xuICBkZWxldGUgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXS5GdW5jdGlvbnNbZnVuY3Rpb25OYW1lXVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlVHJpZ2dlcih0eXBlLCBjbGFzc05hbWUsIGFwcGxpY2F0aW9uSWQpIHtcbiAgYXBwbGljYXRpb25JZCA9IGFwcGxpY2F0aW9uSWQgfHwgUGFyc2UuYXBwbGljYXRpb25JZDtcbiAgZGVsZXRlIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0uVHJpZ2dlcnNbdHlwZV1bY2xhc3NOYW1lXVxufVxuXG5leHBvcnQgZnVuY3Rpb24gX3VucmVnaXN0ZXJBbGwoKSB7XG4gIE9iamVjdC5rZXlzKF90cmlnZ2VyU3RvcmUpLmZvckVhY2goYXBwSWQgPT4gZGVsZXRlIF90cmlnZ2VyU3RvcmVbYXBwSWRdKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFRyaWdnZXIoY2xhc3NOYW1lLCB0cmlnZ2VyVHlwZSwgYXBwbGljYXRpb25JZCkge1xuICBpZiAoIWFwcGxpY2F0aW9uSWQpIHtcbiAgICB0aHJvdyBcIk1pc3NpbmcgQXBwbGljYXRpb25JRFwiO1xuICB9XG4gIHZhciBtYW5hZ2VyID0gX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXVxuICBpZiAobWFuYWdlclxuICAgICYmIG1hbmFnZXIuVHJpZ2dlcnNcbiAgICAmJiBtYW5hZ2VyLlRyaWdnZXJzW3RyaWdnZXJUeXBlXVxuICAgICYmIG1hbmFnZXIuVHJpZ2dlcnNbdHJpZ2dlclR5cGVdW2NsYXNzTmFtZV0pIHtcbiAgICByZXR1cm4gbWFuYWdlci5UcmlnZ2Vyc1t0cmlnZ2VyVHlwZV1bY2xhc3NOYW1lXTtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdHJpZ2dlckV4aXN0cyhjbGFzc05hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nLCBhcHBsaWNhdGlvbklkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIChnZXRUcmlnZ2VyKGNsYXNzTmFtZSwgdHlwZSwgYXBwbGljYXRpb25JZCkgIT0gdW5kZWZpbmVkKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEZ1bmN0aW9uKGZ1bmN0aW9uTmFtZSwgYXBwbGljYXRpb25JZCkge1xuICB2YXIgbWFuYWdlciA9IF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF07XG4gIGlmIChtYW5hZ2VyICYmIG1hbmFnZXIuRnVuY3Rpb25zKSB7XG4gICAgcmV0dXJuIG1hbmFnZXIuRnVuY3Rpb25zW2Z1bmN0aW9uTmFtZV07XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEpvYihqb2JOYW1lLCBhcHBsaWNhdGlvbklkKSB7XG4gIHZhciBtYW5hZ2VyID0gX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXTtcbiAgaWYgKG1hbmFnZXIgJiYgbWFuYWdlci5Kb2JzKSB7XG4gICAgcmV0dXJuIG1hbmFnZXIuSm9ic1tqb2JOYW1lXTtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0Sm9icyhhcHBsaWNhdGlvbklkKSB7XG4gIHZhciBtYW5hZ2VyID0gX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXTtcbiAgaWYgKG1hbmFnZXIgJiYgbWFuYWdlci5Kb2JzKSB7XG4gICAgcmV0dXJuIG1hbmFnZXIuSm9icztcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRWYWxpZGF0b3IoZnVuY3Rpb25OYW1lLCBhcHBsaWNhdGlvbklkKSB7XG4gIHZhciBtYW5hZ2VyID0gX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXTtcbiAgaWYgKG1hbmFnZXIgJiYgbWFuYWdlci5WYWxpZGF0b3JzKSB7XG4gICAgcmV0dXJuIG1hbmFnZXIuVmFsaWRhdG9yc1tmdW5jdGlvbk5hbWVdO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRSZXF1ZXN0T2JqZWN0KHRyaWdnZXJUeXBlLCBhdXRoLCBwYXJzZU9iamVjdCwgb3JpZ2luYWxQYXJzZU9iamVjdCwgY29uZmlnKSB7XG4gIHZhciByZXF1ZXN0ID0ge1xuICAgIHRyaWdnZXJOYW1lOiB0cmlnZ2VyVHlwZSxcbiAgICBvYmplY3Q6IHBhcnNlT2JqZWN0LFxuICAgIG1hc3RlcjogZmFsc2UsXG4gICAgbG9nOiBjb25maWcubG9nZ2VyQ29udHJvbGxlcixcbiAgICBoZWFkZXJzOiBjb25maWcuaGVhZGVycyxcbiAgICBpcDogY29uZmlnLmlwLFxuICB9O1xuXG4gIGlmIChvcmlnaW5hbFBhcnNlT2JqZWN0KSB7XG4gICAgcmVxdWVzdC5vcmlnaW5hbCA9IG9yaWdpbmFsUGFyc2VPYmplY3Q7XG4gIH1cblxuICBpZiAoIWF1dGgpIHtcbiAgICByZXR1cm4gcmVxdWVzdDtcbiAgfVxuICBpZiAoYXV0aC5pc01hc3Rlcikge1xuICAgIHJlcXVlc3RbJ21hc3RlciddID0gdHJ1ZTtcbiAgfVxuICBpZiAoYXV0aC51c2VyKSB7XG4gICAgcmVxdWVzdFsndXNlciddID0gYXV0aC51c2VyO1xuICB9XG4gIGlmIChhdXRoLmluc3RhbGxhdGlvbklkKSB7XG4gICAgcmVxdWVzdFsnaW5zdGFsbGF0aW9uSWQnXSA9IGF1dGguaW5zdGFsbGF0aW9uSWQ7XG4gIH1cbiAgcmV0dXJuIHJlcXVlc3Q7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRSZXF1ZXN0UXVlcnlPYmplY3QodHJpZ2dlclR5cGUsIGF1dGgsIHF1ZXJ5LCBjb3VudCwgY29uZmlnLCBpc0dldCkge1xuICBpc0dldCA9ICEhaXNHZXQ7XG5cbiAgdmFyIHJlcXVlc3QgPSB7XG4gICAgdHJpZ2dlck5hbWU6IHRyaWdnZXJUeXBlLFxuICAgIHF1ZXJ5LFxuICAgIG1hc3RlcjogZmFsc2UsXG4gICAgY291bnQsXG4gICAgbG9nOiBjb25maWcubG9nZ2VyQ29udHJvbGxlcixcbiAgICBpc0dldCxcbiAgICBoZWFkZXJzOiBjb25maWcuaGVhZGVycyxcbiAgICBpcDogY29uZmlnLmlwLFxuICB9O1xuXG4gIGlmICghYXV0aCkge1xuICAgIHJldHVybiByZXF1ZXN0O1xuICB9XG4gIGlmIChhdXRoLmlzTWFzdGVyKSB7XG4gICAgcmVxdWVzdFsnbWFzdGVyJ10gPSB0cnVlO1xuICB9XG4gIGlmIChhdXRoLnVzZXIpIHtcbiAgICByZXF1ZXN0Wyd1c2VyJ10gPSBhdXRoLnVzZXI7XG4gIH1cbiAgaWYgKGF1dGguaW5zdGFsbGF0aW9uSWQpIHtcbiAgICByZXF1ZXN0WydpbnN0YWxsYXRpb25JZCddID0gYXV0aC5pbnN0YWxsYXRpb25JZDtcbiAgfVxuICByZXR1cm4gcmVxdWVzdDtcbn1cblxuLy8gQ3JlYXRlcyB0aGUgcmVzcG9uc2Ugb2JqZWN0LCBhbmQgdXNlcyB0aGUgcmVxdWVzdCBvYmplY3QgdG8gcGFzcyBkYXRhXG4vLyBUaGUgQVBJIHdpbGwgY2FsbCB0aGlzIHdpdGggUkVTVCBBUEkgZm9ybWF0dGVkIG9iamVjdHMsIHRoaXMgd2lsbFxuLy8gdHJhbnNmb3JtIHRoZW0gdG8gUGFyc2UuT2JqZWN0IGluc3RhbmNlcyBleHBlY3RlZCBieSBDbG91ZCBDb2RlLlxuLy8gQW55IGNoYW5nZXMgbWFkZSB0byB0aGUgb2JqZWN0IGluIGEgYmVmb3JlU2F2ZSB3aWxsIGJlIGluY2x1ZGVkLlxuZXhwb3J0IGZ1bmN0aW9uIGdldFJlc3BvbnNlT2JqZWN0KHJlcXVlc3QsIHJlc29sdmUsIHJlamVjdCkge1xuICByZXR1cm4ge1xuICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICBpZiAocmVxdWVzdC50cmlnZ2VyTmFtZSA9PT0gVHlwZXMuYWZ0ZXJGaW5kKSB7XG4gICAgICAgIGlmKCFyZXNwb25zZSl7XG4gICAgICAgICAgcmVzcG9uc2UgPSByZXF1ZXN0Lm9iamVjdHM7XG4gICAgICAgIH1cbiAgICAgICAgcmVzcG9uc2UgPSByZXNwb25zZS5tYXAob2JqZWN0ID0+IHtcbiAgICAgICAgICByZXR1cm4gb2JqZWN0LnRvSlNPTigpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc29sdmUocmVzcG9uc2UpO1xuICAgICAgfVxuICAgICAgLy8gVXNlIHRoZSBKU09OIHJlc3BvbnNlXG4gICAgICBpZiAocmVzcG9uc2UgJiYgIXJlcXVlc3Qub2JqZWN0LmVxdWFscyhyZXNwb25zZSlcbiAgICAgICAgICAmJiByZXF1ZXN0LnRyaWdnZXJOYW1lID09PSBUeXBlcy5iZWZvcmVTYXZlKSB7XG4gICAgICAgIHJldHVybiByZXNvbHZlKHJlc3BvbnNlKTtcbiAgICAgIH1cbiAgICAgIHJlc3BvbnNlID0ge307XG4gICAgICBpZiAocmVxdWVzdC50cmlnZ2VyTmFtZSA9PT0gVHlwZXMuYmVmb3JlU2F2ZSkge1xuICAgICAgICByZXNwb25zZVsnb2JqZWN0J10gPSByZXF1ZXN0Lm9iamVjdC5fZ2V0U2F2ZUpTT04oKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXNvbHZlKHJlc3BvbnNlKTtcbiAgICB9LFxuICAgIGVycm9yOiBmdW5jdGlvbihjb2RlLCBtZXNzYWdlKSB7XG4gICAgICBpZiAoIW1lc3NhZ2UpIHtcbiAgICAgICAgaWYgKGNvZGUgaW5zdGFuY2VvZiBQYXJzZS5FcnJvcikge1xuICAgICAgICAgIHJldHVybiByZWplY3QoY29kZSlcbiAgICAgICAgfVxuICAgICAgICBtZXNzYWdlID0gY29kZTtcbiAgICAgICAgY29kZSA9IFBhcnNlLkVycm9yLlNDUklQVF9GQUlMRUQ7XG4gICAgICB9XG4gICAgICB2YXIgc2NyaXB0RXJyb3IgPSBuZXcgUGFyc2UuRXJyb3IoY29kZSwgbWVzc2FnZSk7XG4gICAgICByZXR1cm4gcmVqZWN0KHNjcmlwdEVycm9yKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gdXNlcklkRm9yTG9nKGF1dGgpIHtcbiAgcmV0dXJuIChhdXRoICYmIGF1dGgudXNlcikgPyBhdXRoLnVzZXIuaWQgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGxvZ1RyaWdnZXJBZnRlckhvb2sodHJpZ2dlclR5cGUsIGNsYXNzTmFtZSwgaW5wdXQsIGF1dGgpIHtcbiAgY29uc3QgY2xlYW5JbnB1dCA9IGxvZ2dlci50cnVuY2F0ZUxvZ01lc3NhZ2UoSlNPTi5zdHJpbmdpZnkoaW5wdXQpKTtcbiAgbG9nZ2VyLmluZm8oYCR7dHJpZ2dlclR5cGV9IHRyaWdnZXJlZCBmb3IgJHtjbGFzc05hbWV9IGZvciB1c2VyICR7dXNlcklkRm9yTG9nKGF1dGgpfTpcXG4gIElucHV0OiAke2NsZWFuSW5wdXR9YCwge1xuICAgIGNsYXNzTmFtZSxcbiAgICB0cmlnZ2VyVHlwZSxcbiAgICB1c2VyOiB1c2VySWRGb3JMb2coYXV0aClcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGxvZ1RyaWdnZXJTdWNjZXNzQmVmb3JlSG9vayh0cmlnZ2VyVHlwZSwgY2xhc3NOYW1lLCBpbnB1dCwgcmVzdWx0LCBhdXRoKSB7XG4gIGNvbnN0IGNsZWFuSW5wdXQgPSBsb2dnZXIudHJ1bmNhdGVMb2dNZXNzYWdlKEpTT04uc3RyaW5naWZ5KGlucHV0KSk7XG4gIGNvbnN0IGNsZWFuUmVzdWx0ID0gbG9nZ2VyLnRydW5jYXRlTG9nTWVzc2FnZShKU09OLnN0cmluZ2lmeShyZXN1bHQpKTtcbiAgbG9nZ2VyLmluZm8oYCR7dHJpZ2dlclR5cGV9IHRyaWdnZXJlZCBmb3IgJHtjbGFzc05hbWV9IGZvciB1c2VyICR7dXNlcklkRm9yTG9nKGF1dGgpfTpcXG4gIElucHV0OiAke2NsZWFuSW5wdXR9XFxuICBSZXN1bHQ6ICR7Y2xlYW5SZXN1bHR9YCwge1xuICAgIGNsYXNzTmFtZSxcbiAgICB0cmlnZ2VyVHlwZSxcbiAgICB1c2VyOiB1c2VySWRGb3JMb2coYXV0aClcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGxvZ1RyaWdnZXJFcnJvckJlZm9yZUhvb2sodHJpZ2dlclR5cGUsIGNsYXNzTmFtZSwgaW5wdXQsIGF1dGgsIGVycm9yKSB7XG4gIGNvbnN0IGNsZWFuSW5wdXQgPSBsb2dnZXIudHJ1bmNhdGVMb2dNZXNzYWdlKEpTT04uc3RyaW5naWZ5KGlucHV0KSk7XG4gIGxvZ2dlci5lcnJvcihgJHt0cmlnZ2VyVHlwZX0gZmFpbGVkIGZvciAke2NsYXNzTmFtZX0gZm9yIHVzZXIgJHt1c2VySWRGb3JMb2coYXV0aCl9OlxcbiAgSW5wdXQ6ICR7Y2xlYW5JbnB1dH1cXG4gIEVycm9yOiAke0pTT04uc3RyaW5naWZ5KGVycm9yKX1gLCB7XG4gICAgY2xhc3NOYW1lLFxuICAgIHRyaWdnZXJUeXBlLFxuICAgIGVycm9yLFxuICAgIHVzZXI6IHVzZXJJZEZvckxvZyhhdXRoKVxuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1heWJlUnVuQWZ0ZXJGaW5kVHJpZ2dlcih0cmlnZ2VyVHlwZSwgYXV0aCwgY2xhc3NOYW1lLCBvYmplY3RzLCBjb25maWcpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCB0cmlnZ2VyID0gZ2V0VHJpZ2dlcihjbGFzc05hbWUsIHRyaWdnZXJUeXBlLCBjb25maWcuYXBwbGljYXRpb25JZCk7XG4gICAgaWYgKCF0cmlnZ2VyKSB7XG4gICAgICByZXR1cm4gcmVzb2x2ZSgpO1xuICAgIH1cbiAgICBjb25zdCByZXF1ZXN0ID0gZ2V0UmVxdWVzdE9iamVjdCh0cmlnZ2VyVHlwZSwgYXV0aCwgbnVsbCwgbnVsbCwgY29uZmlnKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGdldFJlc3BvbnNlT2JqZWN0KHJlcXVlc3QsXG4gICAgICBvYmplY3QgPT4ge1xuICAgICAgICByZXNvbHZlKG9iamVjdCk7XG4gICAgICB9LFxuICAgICAgZXJyb3IgPT4ge1xuICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgfSk7XG4gICAgbG9nVHJpZ2dlclN1Y2Nlc3NCZWZvcmVIb29rKHRyaWdnZXJUeXBlLCBjbGFzc05hbWUsICdBZnRlckZpbmQnLCBKU09OLnN0cmluZ2lmeShvYmplY3RzKSwgYXV0aCk7XG4gICAgcmVxdWVzdC5vYmplY3RzID0gb2JqZWN0cy5tYXAob2JqZWN0ID0+IHtcbiAgICAgIC8vc2V0dGluZyB0aGUgY2xhc3MgbmFtZSB0byB0cmFuc2Zvcm0gaW50byBwYXJzZSBvYmplY3RcbiAgICAgIG9iamVjdC5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG4gICAgICByZXR1cm4gUGFyc2UuT2JqZWN0LmZyb21KU09OKG9iamVjdCk7XG4gICAgfSk7XG4gICAgY29uc3QgdHJpZ2dlclByb21pc2UgPSB0cmlnZ2VyKHJlcXVlc3QsIHJlc3BvbnNlKTtcbiAgICBpZiAodHJpZ2dlclByb21pc2UgJiYgdHlwZW9mIHRyaWdnZXJQcm9taXNlLnRoZW4gPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIHRyaWdnZXJQcm9taXNlLnRoZW4ocHJvbWlzZVJlc3VsdHMgPT4ge1xuICAgICAgICBpZihwcm9taXNlUmVzdWx0cykge1xuICAgICAgICAgIHJlc29sdmUocHJvbWlzZVJlc3VsdHMpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5TQ1JJUFRfRkFJTEVELCBcIkFmdGVyRmluZCBleHBlY3QgcmVzdWx0cyB0byBiZSByZXR1cm5lZCBpbiB0aGUgcHJvbWlzZVwiKSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfSkudGhlbigocmVzdWx0cykgPT4ge1xuICAgIGxvZ1RyaWdnZXJBZnRlckhvb2sodHJpZ2dlclR5cGUsIGNsYXNzTmFtZSwgSlNPTi5zdHJpbmdpZnkocmVzdWx0cyksIGF1dGgpO1xuICAgIHJldHVybiByZXN1bHRzO1xuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1heWJlUnVuUXVlcnlUcmlnZ2VyKHRyaWdnZXJUeXBlLCBjbGFzc05hbWUsIHJlc3RXaGVyZSwgcmVzdE9wdGlvbnMsIGNvbmZpZywgYXV0aCwgaXNHZXQpIHtcbiAgY29uc3QgdHJpZ2dlciA9IGdldFRyaWdnZXIoY2xhc3NOYW1lLCB0cmlnZ2VyVHlwZSwgY29uZmlnLmFwcGxpY2F0aW9uSWQpO1xuICBpZiAoIXRyaWdnZXIpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAgICAgIHJlc3RXaGVyZSxcbiAgICAgIHJlc3RPcHRpb25zXG4gICAgfSk7XG4gIH1cblxuICBjb25zdCBwYXJzZVF1ZXJ5ID0gbmV3IFBhcnNlLlF1ZXJ5KGNsYXNzTmFtZSk7XG4gIGlmIChyZXN0V2hlcmUpIHtcbiAgICBwYXJzZVF1ZXJ5Ll93aGVyZSA9IHJlc3RXaGVyZTtcbiAgfVxuICBsZXQgY291bnQgPSBmYWxzZTtcbiAgaWYgKHJlc3RPcHRpb25zKSB7XG4gICAgaWYgKHJlc3RPcHRpb25zLmluY2x1ZGUgJiYgcmVzdE9wdGlvbnMuaW5jbHVkZS5sZW5ndGggPiAwKSB7XG4gICAgICBwYXJzZVF1ZXJ5Ll9pbmNsdWRlID0gcmVzdE9wdGlvbnMuaW5jbHVkZS5zcGxpdCgnLCcpO1xuICAgIH1cbiAgICBpZiAocmVzdE9wdGlvbnMuc2tpcCkge1xuICAgICAgcGFyc2VRdWVyeS5fc2tpcCA9IHJlc3RPcHRpb25zLnNraXA7XG4gICAgfVxuICAgIGlmIChyZXN0T3B0aW9ucy5saW1pdCkge1xuICAgICAgcGFyc2VRdWVyeS5fbGltaXQgPSByZXN0T3B0aW9ucy5saW1pdDtcbiAgICB9XG4gICAgY291bnQgPSAhIXJlc3RPcHRpb25zLmNvdW50O1xuICB9XG4gIGNvbnN0IHJlcXVlc3RPYmplY3QgPSBnZXRSZXF1ZXN0UXVlcnlPYmplY3QodHJpZ2dlclR5cGUsIGF1dGgsIHBhcnNlUXVlcnksIGNvdW50LCBjb25maWcsIGlzR2V0KTtcbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0cmlnZ2VyKHJlcXVlc3RPYmplY3QpO1xuICB9KS50aGVuKChyZXN1bHQpID0+IHtcbiAgICBsZXQgcXVlcnlSZXN1bHQgPSBwYXJzZVF1ZXJ5O1xuICAgIGlmIChyZXN1bHQgJiYgcmVzdWx0IGluc3RhbmNlb2YgUGFyc2UuUXVlcnkpIHtcbiAgICAgIHF1ZXJ5UmVzdWx0ID0gcmVzdWx0O1xuICAgIH1cbiAgICBjb25zdCBqc29uUXVlcnkgPSBxdWVyeVJlc3VsdC50b0pTT04oKTtcbiAgICBpZiAoanNvblF1ZXJ5LndoZXJlKSB7XG4gICAgICByZXN0V2hlcmUgPSBqc29uUXVlcnkud2hlcmU7XG4gICAgfVxuICAgIGlmIChqc29uUXVlcnkubGltaXQpIHtcbiAgICAgIHJlc3RPcHRpb25zID0gcmVzdE9wdGlvbnMgfHwge307XG4gICAgICByZXN0T3B0aW9ucy5saW1pdCA9IGpzb25RdWVyeS5saW1pdDtcbiAgICB9XG4gICAgaWYgKGpzb25RdWVyeS5za2lwKSB7XG4gICAgICByZXN0T3B0aW9ucyA9IHJlc3RPcHRpb25zIHx8IHt9O1xuICAgICAgcmVzdE9wdGlvbnMuc2tpcCA9IGpzb25RdWVyeS5za2lwO1xuICAgIH1cbiAgICBpZiAoanNvblF1ZXJ5LmluY2x1ZGUpIHtcbiAgICAgIHJlc3RPcHRpb25zID0gcmVzdE9wdGlvbnMgfHwge307XG4gICAgICByZXN0T3B0aW9ucy5pbmNsdWRlID0ganNvblF1ZXJ5LmluY2x1ZGU7XG4gICAgfVxuICAgIGlmIChqc29uUXVlcnkua2V5cykge1xuICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgIHJlc3RPcHRpb25zLmtleXMgPSBqc29uUXVlcnkua2V5cztcbiAgICB9XG4gICAgaWYgKGpzb25RdWVyeS5vcmRlcikge1xuICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgIHJlc3RPcHRpb25zLm9yZGVyID0ganNvblF1ZXJ5Lm9yZGVyO1xuICAgIH1cbiAgICBpZiAocmVxdWVzdE9iamVjdC5yZWFkUHJlZmVyZW5jZSkge1xuICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgIHJlc3RPcHRpb25zLnJlYWRQcmVmZXJlbmNlID0gcmVxdWVzdE9iamVjdC5yZWFkUHJlZmVyZW5jZTtcbiAgICB9XG4gICAgaWYgKHJlcXVlc3RPYmplY3QuaW5jbHVkZVJlYWRQcmVmZXJlbmNlKSB7XG4gICAgICByZXN0T3B0aW9ucyA9IHJlc3RPcHRpb25zIHx8IHt9O1xuICAgICAgcmVzdE9wdGlvbnMuaW5jbHVkZVJlYWRQcmVmZXJlbmNlID0gcmVxdWVzdE9iamVjdC5pbmNsdWRlUmVhZFByZWZlcmVuY2U7XG4gICAgfVxuICAgIGlmIChyZXF1ZXN0T2JqZWN0LnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UpIHtcbiAgICAgIHJlc3RPcHRpb25zID0gcmVzdE9wdGlvbnMgfHwge307XG4gICAgICByZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlID0gcmVxdWVzdE9iamVjdC5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgcmVzdFdoZXJlLFxuICAgICAgcmVzdE9wdGlvbnNcbiAgICB9O1xuICB9LCAoZXJyKSA9PiB7XG4gICAgaWYgKHR5cGVvZiBlcnIgPT09ICdzdHJpbmcnKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMSwgZXJyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfSk7XG59XG5cbi8vIFRvIGJlIHVzZWQgYXMgcGFydCBvZiB0aGUgcHJvbWlzZSBjaGFpbiB3aGVuIHNhdmluZy9kZWxldGluZyBhbiBvYmplY3Rcbi8vIFdpbGwgcmVzb2x2ZSBzdWNjZXNzZnVsbHkgaWYgbm8gdHJpZ2dlciBpcyBjb25maWd1cmVkXG4vLyBSZXNvbHZlcyB0byBhbiBvYmplY3QsIGVtcHR5IG9yIGNvbnRhaW5pbmcgYW4gb2JqZWN0IGtleS4gQSBiZWZvcmVTYXZlXG4vLyB0cmlnZ2VyIHdpbGwgc2V0IHRoZSBvYmplY3Qga2V5IHRvIHRoZSByZXN0IGZvcm1hdCBvYmplY3QgdG8gc2F2ZS5cbi8vIG9yaWdpbmFsUGFyc2VPYmplY3QgaXMgb3B0aW9uYWwsIHdlIG9ubHkgbmVlZCB0aGF0IGZvciBiZWZvcmUvYWZ0ZXJTYXZlIGZ1bmN0aW9uc1xuZXhwb3J0IGZ1bmN0aW9uIG1heWJlUnVuVHJpZ2dlcih0cmlnZ2VyVHlwZSwgYXV0aCwgcGFyc2VPYmplY3QsIG9yaWdpbmFsUGFyc2VPYmplY3QsIGNvbmZpZykge1xuICBpZiAoIXBhcnNlT2JqZWN0KSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7fSk7XG4gIH1cbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICB2YXIgdHJpZ2dlciA9IGdldFRyaWdnZXIocGFyc2VPYmplY3QuY2xhc3NOYW1lLCB0cmlnZ2VyVHlwZSwgY29uZmlnLmFwcGxpY2F0aW9uSWQpO1xuICAgIGlmICghdHJpZ2dlcikgcmV0dXJuIHJlc29sdmUoKTtcbiAgICB2YXIgcmVxdWVzdCA9IGdldFJlcXVlc3RPYmplY3QodHJpZ2dlclR5cGUsIGF1dGgsIHBhcnNlT2JqZWN0LCBvcmlnaW5hbFBhcnNlT2JqZWN0LCBjb25maWcpO1xuICAgIHZhciByZXNwb25zZSA9IGdldFJlc3BvbnNlT2JqZWN0KHJlcXVlc3QsIChvYmplY3QpID0+IHtcbiAgICAgIGxvZ1RyaWdnZXJTdWNjZXNzQmVmb3JlSG9vayhcbiAgICAgICAgdHJpZ2dlclR5cGUsIHBhcnNlT2JqZWN0LmNsYXNzTmFtZSwgcGFyc2VPYmplY3QudG9KU09OKCksIG9iamVjdCwgYXV0aCk7XG4gICAgICByZXNvbHZlKG9iamVjdCk7XG4gICAgfSwgKGVycm9yKSA9PiB7XG4gICAgICBsb2dUcmlnZ2VyRXJyb3JCZWZvcmVIb29rKFxuICAgICAgICB0cmlnZ2VyVHlwZSwgcGFyc2VPYmplY3QuY2xhc3NOYW1lLCBwYXJzZU9iamVjdC50b0pTT04oKSwgYXV0aCwgZXJyb3IpO1xuICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICB9KTtcbiAgICAvLyBGb3JjZSB0aGUgY3VycmVudCBQYXJzZSBhcHAgYmVmb3JlIHRoZSB0cmlnZ2VyXG4gICAgUGFyc2UuYXBwbGljYXRpb25JZCA9IGNvbmZpZy5hcHBsaWNhdGlvbklkO1xuICAgIFBhcnNlLmphdmFzY3JpcHRLZXkgPSBjb25maWcuamF2YXNjcmlwdEtleSB8fCAnJztcbiAgICBQYXJzZS5tYXN0ZXJLZXkgPSBjb25maWcubWFzdGVyS2V5O1xuXG4gICAgLy8gQWZ0ZXJTYXZlIGFuZCBhZnRlckRlbGV0ZSB0cmlnZ2VycyBjYW4gcmV0dXJuIGEgcHJvbWlzZSwgd2hpY2ggaWYgdGhleVxuICAgIC8vIGRvLCBuZWVkcyB0byBiZSByZXNvbHZlZCBiZWZvcmUgdGhpcyBwcm9taXNlIGlzIHJlc29sdmVkLFxuICAgIC8vIHNvIHRyaWdnZXIgZXhlY3V0aW9uIGlzIHN5bmNlZCB3aXRoIFJlc3RXcml0ZS5leGVjdXRlKCkgY2FsbC5cbiAgICAvLyBJZiB0cmlnZ2VycyBkbyBub3QgcmV0dXJuIGEgcHJvbWlzZSwgdGhleSBjYW4gcnVuIGFzeW5jIGNvZGUgcGFyYWxsZWxcbiAgICAvLyB0byB0aGUgUmVzdFdyaXRlLmV4ZWN1dGUoKSBjYWxsLlxuICAgIHZhciB0cmlnZ2VyUHJvbWlzZSA9IHRyaWdnZXIocmVxdWVzdCwgcmVzcG9uc2UpO1xuICAgIGlmKHRyaWdnZXJUeXBlID09PSBUeXBlcy5hZnRlclNhdmUgfHwgdHJpZ2dlclR5cGUgPT09IFR5cGVzLmFmdGVyRGVsZXRlKVxuICAgIHtcbiAgICAgIGxvZ1RyaWdnZXJBZnRlckhvb2sodHJpZ2dlclR5cGUsIHBhcnNlT2JqZWN0LmNsYXNzTmFtZSwgcGFyc2VPYmplY3QudG9KU09OKCksIGF1dGgpO1xuICAgICAgaWYodHJpZ2dlclByb21pc2UgJiYgdHlwZW9mIHRyaWdnZXJQcm9taXNlLnRoZW4gPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICByZXR1cm4gdHJpZ2dlclByb21pc2UudGhlbihyZXNvbHZlLCByZXNvbHZlKTtcbiAgICAgIH1cbiAgICAgIGVsc2Uge1xuICAgICAgICByZXR1cm4gcmVzb2x2ZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG59XG5cbi8vIENvbnZlcnRzIGEgUkVTVC1mb3JtYXQgb2JqZWN0IHRvIGEgUGFyc2UuT2JqZWN0XG4vLyBkYXRhIGlzIGVpdGhlciBjbGFzc05hbWUgb3IgYW4gb2JqZWN0XG5leHBvcnQgZnVuY3Rpb24gaW5mbGF0ZShkYXRhLCByZXN0T2JqZWN0KSB7XG4gIHZhciBjb3B5ID0gdHlwZW9mIGRhdGEgPT0gJ29iamVjdCcgPyBkYXRhIDoge2NsYXNzTmFtZTogZGF0YX07XG4gIGZvciAodmFyIGtleSBpbiByZXN0T2JqZWN0KSB7XG4gICAgY29weVtrZXldID0gcmVzdE9iamVjdFtrZXldO1xuICB9XG4gIHJldHVybiBQYXJzZS5PYmplY3QuZnJvbUpTT04oY29weSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBydW5MaXZlUXVlcnlFdmVudEhhbmRsZXJzKGRhdGEsIGFwcGxpY2F0aW9uSWQgPSBQYXJzZS5hcHBsaWNhdGlvbklkKSB7XG4gIGlmICghX3RyaWdnZXJTdG9yZSB8fCAhX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXSB8fCAhX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXS5MaXZlUXVlcnkpIHsgcmV0dXJuOyB9XG4gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0uTGl2ZVF1ZXJ5LmZvckVhY2goKGhhbmRsZXIpID0+IGhhbmRsZXIoZGF0YSkpO1xufVxuIl19