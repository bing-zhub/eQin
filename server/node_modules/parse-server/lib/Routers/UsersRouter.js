'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.UsersRouter = undefined;

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _Config = require('../Config');

var _Config2 = _interopRequireDefault(_Config);

var _AccountLockout = require('../AccountLockout');

var _AccountLockout2 = _interopRequireDefault(_AccountLockout);

var _ClassesRouter = require('./ClassesRouter');

var _ClassesRouter2 = _interopRequireDefault(_ClassesRouter);

var _rest = require('../rest');

var _rest2 = _interopRequireDefault(_rest);

var _Auth = require('../Auth');

var _Auth2 = _interopRequireDefault(_Auth);

var _password = require('../password');

var _password2 = _interopRequireDefault(_password);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class UsersRouter extends _ClassesRouter2.default {

  className() {
    return '_User';
  }

  /**
   * Removes all "_" prefixed properties from an object, except "__type"
   * @param {Object} obj An object.
   */
  static removeHiddenProperties(obj) {
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        // Regexp comes from Parse.Object.prototype.validate
        if (key !== "__type" && !/^[A-Za-z][0-9A-Za-z_]*$/.test(key)) {
          delete obj[key];
        }
      }
    }
  }

  /**
   * Validates a password request in login and verifyPassword
   * @param {Object} req The request
   * @returns {Object} User object
   * @private
   */
  _authenticateUserFromRequest(req) {
    return new Promise((resolve, reject) => {
      // Use query parameters instead if provided in url
      let payload = req.body;
      if (!payload.username && req.query.username || !payload.email && req.query.email) {
        payload = req.query;
      }
      const {
        username,
        email,
        password
      } = payload;

      // TODO: use the right error codes / descriptions.
      if (!username && !email) {
        throw new _node2.default.Error(_node2.default.Error.USERNAME_MISSING, 'username/email is required.');
      }
      if (!password) {
        throw new _node2.default.Error(_node2.default.Error.PASSWORD_MISSING, 'password is required.');
      }
      if (typeof password !== 'string' || email && typeof email !== 'string' || username && typeof username !== 'string') {
        throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Invalid username/password.');
      }

      let user;
      let isValidPassword = false;
      let query;
      if (email && username) {
        query = { email, username };
      } else if (email) {
        query = { email };
      } else {
        query = { $or: [{ username }, { email: username }] };
      }
      return req.config.database.find('_User', query).then(results => {
        if (!results.length) {
          throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Invalid username/password.');
        }

        if (results.length > 1) {
          // corner case where user1 has username == user2 email
          req.config.loggerController.warn('There is a user which email is the same as another user\'s username, logging in based on username');
          user = results.filter(user => user.username === username)[0];
        } else {
          user = results[0];
        }

        return _password2.default.compare(password, user.password);
      }).then(correct => {
        isValidPassword = correct;
        const accountLockoutPolicy = new _AccountLockout2.default(user, req.config);
        return accountLockoutPolicy.handleLoginAttempt(isValidPassword);
      }).then(() => {
        if (!isValidPassword) {
          throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Invalid username/password.');
        }
        // Ensure the user isn't locked out
        // A locked out user won't be able to login
        // To lock a user out, just set the ACL to `masterKey` only  ({}).
        // Empty ACL is OK
        if (!req.auth.isMaster && user.ACL && Object.keys(user.ACL).length == 0) {
          throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Invalid username/password.');
        }
        if (req.config.verifyUserEmails && req.config.preventLoginWithUnverifiedEmail && !user.emailVerified) {
          throw new _node2.default.Error(_node2.default.Error.EMAIL_NOT_FOUND, 'User email is not verified.');
        }

        delete user.password;

        // Sometimes the authData still has null on that keys
        // https://github.com/parse-community/parse-server/issues/935
        if (user.authData) {
          Object.keys(user.authData).forEach(provider => {
            if (user.authData[provider] === null) {
              delete user.authData[provider];
            }
          });
          if (Object.keys(user.authData).length == 0) {
            delete user.authData;
          }
        }

        return resolve(user);
      }).catch(error => {
        return reject(error);
      });
    });
  }

  handleMe(req) {
    if (!req.info || !req.info.sessionToken) {
      throw new _node2.default.Error(_node2.default.Error.INVALID_SESSION_TOKEN, 'Invalid session token');
    }
    const sessionToken = req.info.sessionToken;
    return _rest2.default.find(req.config, _Auth2.default.master(req.config), '_Session', { sessionToken }, { include: 'user' }, req.info.clientSDK).then(response => {
      if (!response.results || response.results.length == 0 || !response.results[0].user) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_SESSION_TOKEN, 'Invalid session token');
      } else {
        const user = response.results[0].user;
        // Send token back on the login, because SDKs expect that.
        user.sessionToken = sessionToken;

        // Remove hidden properties.
        UsersRouter.removeHiddenProperties(user);

        return { response: user };
      }
    });
  }

  handleLogIn(req) {
    let user;
    return this._authenticateUserFromRequest(req).then(res => {

      user = res;

      // handle password expiry policy
      if (req.config.passwordPolicy && req.config.passwordPolicy.maxPasswordAge) {
        let changedAt = user._password_changed_at;

        if (!changedAt) {
          // password was created before expiry policy was enabled.
          // simply update _User object so that it will start enforcing from now
          changedAt = new Date();
          req.config.database.update('_User', { username: user.username }, { _password_changed_at: _node2.default._encode(changedAt) });
        } else {
          // check whether the password has expired
          if (changedAt.__type == 'Date') {
            changedAt = new Date(changedAt.iso);
          }
          // Calculate the expiry time.
          const expiresAt = new Date(changedAt.getTime() + 86400000 * req.config.passwordPolicy.maxPasswordAge);
          if (expiresAt < new Date()) // fail of current time is past password expiry time
            throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Your password has expired. Please reset your password.');
        }
      }

      // Remove hidden properties.
      UsersRouter.removeHiddenProperties(user);

      const {
        sessionData,
        createSession
      } = _Auth2.default.createSession(req.config, {
        userId: user.objectId, createdWith: {
          'action': 'login',
          'authProvider': 'password'
        }, installationId: req.info.installationId
      });

      user.sessionToken = sessionData.sessionToken;

      req.config.filesController.expandFilesInObject(req.config, user);

      return createSession();
    }).then(() => {
      return { response: user };
    });
  }

  handleVerifyPassword(req) {
    return this._authenticateUserFromRequest(req).then(user => {

      // Remove hidden properties.
      UsersRouter.removeHiddenProperties(user);

      return { response: user };
    }).catch(error => {
      throw error;
    });
  }

  handleLogOut(req) {
    const success = { response: {} };
    if (req.info && req.info.sessionToken) {
      return _rest2.default.find(req.config, _Auth2.default.master(req.config), '_Session', { sessionToken: req.info.sessionToken }, undefined, req.info.clientSDK).then(records => {
        if (records.results && records.results.length) {
          return _rest2.default.del(req.config, _Auth2.default.master(req.config), '_Session', records.results[0].objectId).then(() => {
            return Promise.resolve(success);
          });
        }
        return Promise.resolve(success);
      });
    }
    return Promise.resolve(success);
  }

  _throwOnBadEmailConfig(req) {
    try {
      _Config2.default.validateEmailConfiguration({
        emailAdapter: req.config.userController.adapter,
        appName: req.config.appName,
        publicServerURL: req.config.publicServerURL,
        emailVerifyTokenValidityDuration: req.config.emailVerifyTokenValidityDuration
      });
    } catch (e) {
      if (typeof e === 'string') {
        // Maybe we need a Bad Configuration error, but the SDKs won't understand it. For now, Internal Server Error.
        throw new _node2.default.Error(_node2.default.Error.INTERNAL_SERVER_ERROR, 'An appName, publicServerURL, and emailAdapter are required for password reset and email verification functionality.');
      } else {
        throw e;
      }
    }
  }

  handleResetRequest(req) {
    this._throwOnBadEmailConfig(req);

    const { email } = req.body;
    if (!email) {
      throw new _node2.default.Error(_node2.default.Error.EMAIL_MISSING, "you must provide an email");
    }
    if (typeof email !== 'string') {
      throw new _node2.default.Error(_node2.default.Error.INVALID_EMAIL_ADDRESS, 'you must provide a valid email string');
    }
    const userController = req.config.userController;
    return userController.sendPasswordResetEmail(email).then(() => {
      return Promise.resolve({
        response: {}
      });
    }, err => {
      if (err.code === _node2.default.Error.OBJECT_NOT_FOUND) {
        throw new _node2.default.Error(_node2.default.Error.EMAIL_NOT_FOUND, `No user found with email ${email}.`);
      } else {
        throw err;
      }
    });
  }

  handleVerificationEmailRequest(req) {
    this._throwOnBadEmailConfig(req);

    const { email } = req.body;
    if (!email) {
      throw new _node2.default.Error(_node2.default.Error.EMAIL_MISSING, 'you must provide an email');
    }
    if (typeof email !== 'string') {
      throw new _node2.default.Error(_node2.default.Error.INVALID_EMAIL_ADDRESS, 'you must provide a valid email string');
    }

    return req.config.database.find('_User', { email: email }).then(results => {
      if (!results.length || results.length < 1) {
        throw new _node2.default.Error(_node2.default.Error.EMAIL_NOT_FOUND, `No user found with email ${email}`);
      }
      const user = results[0];

      // remove password field, messes with saving on postgres
      delete user.password;

      if (user.emailVerified) {
        throw new _node2.default.Error(_node2.default.Error.OTHER_CAUSE, `Email ${email} is already verified.`);
      }

      const userController = req.config.userController;
      return userController.regenerateEmailVerifyToken(user).then(() => {
        userController.sendVerificationEmail(user);
        return { response: {} };
      });
    });
  }

  mountRoutes() {
    this.route('GET', '/users', req => {
      return this.handleFind(req);
    });
    this.route('POST', '/users', req => {
      return this.handleCreate(req);
    });
    this.route('GET', '/users/me', req => {
      return this.handleMe(req);
    });
    this.route('GET', '/users/:objectId', req => {
      return this.handleGet(req);
    });
    this.route('PUT', '/users/:objectId', req => {
      return this.handleUpdate(req);
    });
    this.route('DELETE', '/users/:objectId', req => {
      return this.handleDelete(req);
    });
    this.route('GET', '/login', req => {
      return this.handleLogIn(req);
    });
    this.route('POST', '/login', req => {
      return this.handleLogIn(req);
    });
    this.route('POST', '/logout', req => {
      return this.handleLogOut(req);
    });
    this.route('POST', '/requestPasswordReset', req => {
      return this.handleResetRequest(req);
    });
    this.route('POST', '/verificationEmailRequest', req => {
      return this.handleVerificationEmailRequest(req);
    });
    this.route('GET', '/verifyPassword', req => {
      return this.handleVerifyPassword(req);
    });
  }
}

exports.UsersRouter = UsersRouter; // These methods handle the User-related routes.

exports.default = UsersRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1VzZXJzUm91dGVyLmpzIl0sIm5hbWVzIjpbIlVzZXJzUm91dGVyIiwiQ2xhc3Nlc1JvdXRlciIsImNsYXNzTmFtZSIsInJlbW92ZUhpZGRlblByb3BlcnRpZXMiLCJvYmoiLCJrZXkiLCJoYXNPd25Qcm9wZXJ0eSIsInRlc3QiLCJfYXV0aGVudGljYXRlVXNlckZyb21SZXF1ZXN0IiwicmVxIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJwYXlsb2FkIiwiYm9keSIsInVzZXJuYW1lIiwicXVlcnkiLCJlbWFpbCIsInBhc3N3b3JkIiwiUGFyc2UiLCJFcnJvciIsIlVTRVJOQU1FX01JU1NJTkciLCJQQVNTV09SRF9NSVNTSU5HIiwiT0JKRUNUX05PVF9GT1VORCIsInVzZXIiLCJpc1ZhbGlkUGFzc3dvcmQiLCIkb3IiLCJjb25maWciLCJkYXRhYmFzZSIsImZpbmQiLCJ0aGVuIiwicmVzdWx0cyIsImxlbmd0aCIsImxvZ2dlckNvbnRyb2xsZXIiLCJ3YXJuIiwiZmlsdGVyIiwicGFzc3dvcmRDcnlwdG8iLCJjb21wYXJlIiwiY29ycmVjdCIsImFjY291bnRMb2Nrb3V0UG9saWN5IiwiQWNjb3VudExvY2tvdXQiLCJoYW5kbGVMb2dpbkF0dGVtcHQiLCJhdXRoIiwiaXNNYXN0ZXIiLCJBQ0wiLCJPYmplY3QiLCJrZXlzIiwidmVyaWZ5VXNlckVtYWlscyIsInByZXZlbnRMb2dpbldpdGhVbnZlcmlmaWVkRW1haWwiLCJlbWFpbFZlcmlmaWVkIiwiRU1BSUxfTk9UX0ZPVU5EIiwiYXV0aERhdGEiLCJmb3JFYWNoIiwicHJvdmlkZXIiLCJjYXRjaCIsImVycm9yIiwiaGFuZGxlTWUiLCJpbmZvIiwic2Vzc2lvblRva2VuIiwiSU5WQUxJRF9TRVNTSU9OX1RPS0VOIiwicmVzdCIsIkF1dGgiLCJtYXN0ZXIiLCJpbmNsdWRlIiwiY2xpZW50U0RLIiwicmVzcG9uc2UiLCJoYW5kbGVMb2dJbiIsInJlcyIsInBhc3N3b3JkUG9saWN5IiwibWF4UGFzc3dvcmRBZ2UiLCJjaGFuZ2VkQXQiLCJfcGFzc3dvcmRfY2hhbmdlZF9hdCIsIkRhdGUiLCJ1cGRhdGUiLCJfZW5jb2RlIiwiX190eXBlIiwiaXNvIiwiZXhwaXJlc0F0IiwiZ2V0VGltZSIsInNlc3Npb25EYXRhIiwiY3JlYXRlU2Vzc2lvbiIsInVzZXJJZCIsIm9iamVjdElkIiwiY3JlYXRlZFdpdGgiLCJpbnN0YWxsYXRpb25JZCIsImZpbGVzQ29udHJvbGxlciIsImV4cGFuZEZpbGVzSW5PYmplY3QiLCJoYW5kbGVWZXJpZnlQYXNzd29yZCIsImhhbmRsZUxvZ091dCIsInN1Y2Nlc3MiLCJ1bmRlZmluZWQiLCJyZWNvcmRzIiwiZGVsIiwiX3Rocm93T25CYWRFbWFpbENvbmZpZyIsIkNvbmZpZyIsInZhbGlkYXRlRW1haWxDb25maWd1cmF0aW9uIiwiZW1haWxBZGFwdGVyIiwidXNlckNvbnRyb2xsZXIiLCJhZGFwdGVyIiwiYXBwTmFtZSIsInB1YmxpY1NlcnZlclVSTCIsImVtYWlsVmVyaWZ5VG9rZW5WYWxpZGl0eUR1cmF0aW9uIiwiZSIsIklOVEVSTkFMX1NFUlZFUl9FUlJPUiIsImhhbmRsZVJlc2V0UmVxdWVzdCIsIkVNQUlMX01JU1NJTkciLCJJTlZBTElEX0VNQUlMX0FERFJFU1MiLCJzZW5kUGFzc3dvcmRSZXNldEVtYWlsIiwiZXJyIiwiY29kZSIsImhhbmRsZVZlcmlmaWNhdGlvbkVtYWlsUmVxdWVzdCIsIk9USEVSX0NBVVNFIiwicmVnZW5lcmF0ZUVtYWlsVmVyaWZ5VG9rZW4iLCJzZW5kVmVyaWZpY2F0aW9uRW1haWwiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwiaGFuZGxlRmluZCIsImhhbmRsZUNyZWF0ZSIsImhhbmRsZUdldCIsImhhbmRsZVVwZGF0ZSIsImhhbmRsZURlbGV0ZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUVBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7Ozs7QUFFTyxNQUFNQSxXQUFO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QU87QUFBRSxhQUFPLEtBQUsrRyxZQUFMLENBQWtCL0csR0FBbEIsQ0FBUDtBQUFnQyxLQUFsRjtBQUNBLFNBQUswRyxLQUFMLENBQVcsS0FBWCxFQUFrQixRQUFsQixFQUE0QjFHLE9BQU87QUFBRSxhQUFPLEtBQUt5RCxXQUFMLENBQWlCekQsR0FBakIsQ0FBUDtBQUErQixLQUFwRTtBQUNBLFNBQUswRyxLQUFMLENBQVcsTUFBWCxFQUFtQixRQUFuQixFQUE2QjFHLE9BQU87QUFBRSxhQUFPLEtBQUt5RCxXQUFMLENBQWlCekQsR0FBakIsQ0FBUDtBQUErQixLQUFyRTtBQUNBLFNBQUswRyxLQUFMLENBQVcsTUFBWCxFQUFtQixTQUFuQixFQUE4QjFHLE9BQU87QUFBRSxhQUFPLEtBQUsrRSxZQUFMLENBQWtCL0UsR0FBbEIsQ0FBUDtBQUFnQyxLQUF2RTtBQUNBLFNBQUswRyxLQUFMLENBQVcsTUFBWCxFQUFtQix1QkFBbkIsRUFBNEMxRyxPQUFPO0FBQUUsYUFBTyxLQUFLK0Ysa0JBQUwsQ0FBd0IvRixHQUF4QixDQUFQO0FBQXNDLEtBQTNGO0FBQ0EsU0FBSzBHLEtBQUwsQ0FBVyxNQUFYLEVBQW1CLDJCQUFuQixFQUFnRDFHLE9BQU87QUFBRSxhQUFPLEtBQUtxRyw4QkFBTCxDQUFvQ3JHLEdBQXBDLENBQVA7QUFBa0QsS0FBM0c7QUFDQSxTQUFLMEcsS0FBTCxDQUFXLEtBQVgsRUFBa0IsaUJBQWxCLEVBQXFDMUcsT0FBTztBQUFFLGFBQU8sS0FBSzhFLG9CQUFMLENBQTBCOUUsR0FBMUIsQ0FBUDtBQUF3QyxLQUF0RjtBQUNEO0FBL1Q0Qzs7UUFBbENULFcsR0FBQUEsVyxFQVZiOztrQkE0VWVBLFciLCJmaWxlIjoiVXNlcnNSb3V0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBUaGVzZSBtZXRob2RzIGhhbmRsZSB0aGUgVXNlci1yZWxhdGVkIHJvdXRlcy5cblxuaW1wb3J0IFBhcnNlIGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IENvbmZpZyBmcm9tICcuLi9Db25maWcnO1xuaW1wb3J0IEFjY291bnRMb2Nrb3V0IGZyb20gJy4uL0FjY291bnRMb2Nrb3V0JztcbmltcG9ydCBDbGFzc2VzUm91dGVyIGZyb20gJy4vQ2xhc3Nlc1JvdXRlcic7XG5pbXBvcnQgcmVzdCBmcm9tICcuLi9yZXN0JztcbmltcG9ydCBBdXRoIGZyb20gJy4uL0F1dGgnO1xuaW1wb3J0IHBhc3N3b3JkQ3J5cHRvIGZyb20gJy4uL3Bhc3N3b3JkJztcblxuZXhwb3J0IGNsYXNzIFVzZXJzUm91dGVyIGV4dGVuZHMgQ2xhc3Nlc1JvdXRlciB7XG5cbiAgY2xhc3NOYW1lKCkge1xuICAgIHJldHVybiAnX1VzZXInO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYWxsIFwiX1wiIHByZWZpeGVkIHByb3BlcnRpZXMgZnJvbSBhbiBvYmplY3QsIGV4Y2VwdCBcIl9fdHlwZVwiXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmogQW4gb2JqZWN0LlxuICAgKi9cbiAgc3RhdGljIHJlbW92ZUhpZGRlblByb3BlcnRpZXMob2JqKSB7XG4gICAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgICAgaWYgKG9iai5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgIC8vIFJlZ2V4cCBjb21lcyBmcm9tIFBhcnNlLk9iamVjdC5wcm90b3R5cGUudmFsaWRhdGVcbiAgICAgICAgaWYgKGtleSAhPT0gXCJfX3R5cGVcIiAmJiAhKC9eW0EtWmEtel1bMC05QS1aYS16X10qJC8pLnRlc3Qoa2V5KSkge1xuICAgICAgICAgIGRlbGV0ZSBvYmpba2V5XTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSBwYXNzd29yZCByZXF1ZXN0IGluIGxvZ2luIGFuZCB2ZXJpZnlQYXNzd29yZFxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxIFRoZSByZXF1ZXN0XG4gICAqIEByZXR1cm5zIHtPYmplY3R9IFVzZXIgb2JqZWN0XG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBfYXV0aGVudGljYXRlVXNlckZyb21SZXF1ZXN0KHJlcSkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAvLyBVc2UgcXVlcnkgcGFyYW1ldGVycyBpbnN0ZWFkIGlmIHByb3ZpZGVkIGluIHVybFxuICAgICAgbGV0IHBheWxvYWQgPSByZXEuYm9keTtcbiAgICAgIGlmICghcGF5bG9hZC51c2VybmFtZSAmJiByZXEucXVlcnkudXNlcm5hbWUgfHwgIXBheWxvYWQuZW1haWwgJiYgcmVxLnF1ZXJ5LmVtYWlsKSB7XG4gICAgICAgIHBheWxvYWQgPSByZXEucXVlcnk7XG4gICAgICB9XG4gICAgICBjb25zdCB7XG4gICAgICAgIHVzZXJuYW1lLFxuICAgICAgICBlbWFpbCxcbiAgICAgICAgcGFzc3dvcmQsXG4gICAgICB9ID0gcGF5bG9hZDtcblxuICAgICAgLy8gVE9ETzogdXNlIHRoZSByaWdodCBlcnJvciBjb2RlcyAvIGRlc2NyaXB0aW9ucy5cbiAgICAgIGlmICghdXNlcm5hbWUgJiYgIWVtYWlsKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5VU0VSTkFNRV9NSVNTSU5HLCAndXNlcm5hbWUvZW1haWwgaXMgcmVxdWlyZWQuJyk7XG4gICAgICB9XG4gICAgICBpZiAoIXBhc3N3b3JkKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QQVNTV09SRF9NSVNTSU5HLCAncGFzc3dvcmQgaXMgcmVxdWlyZWQuJyk7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIHBhc3N3b3JkICE9PSAnc3RyaW5nJ1xuICAgICAgICB8fCBlbWFpbCAmJiB0eXBlb2YgZW1haWwgIT09ICdzdHJpbmcnXG4gICAgICAgIHx8IHVzZXJuYW1lICYmIHR5cGVvZiB1c2VybmFtZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdJbnZhbGlkIHVzZXJuYW1lL3Bhc3N3b3JkLicpO1xuICAgICAgfVxuXG4gICAgICBsZXQgdXNlcjtcbiAgICAgIGxldCBpc1ZhbGlkUGFzc3dvcmQgPSBmYWxzZTtcbiAgICAgIGxldCBxdWVyeTtcbiAgICAgIGlmIChlbWFpbCAmJiB1c2VybmFtZSkge1xuICAgICAgICBxdWVyeSA9IHsgZW1haWwsIHVzZXJuYW1lIH07XG4gICAgICB9IGVsc2UgaWYgKGVtYWlsKSB7XG4gICAgICAgIHF1ZXJ5ID0geyBlbWFpbCB9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcXVlcnkgPSB7ICRvcjogW3sgdXNlcm5hbWUgfSwgeyBlbWFpbDogdXNlcm5hbWUgfV0gfTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXEuY29uZmlnLmRhdGFiYXNlLmZpbmQoJ19Vc2VyJywgcXVlcnkpXG4gICAgICAgIC50aGVuKChyZXN1bHRzKSA9PiB7XG4gICAgICAgICAgaWYgKCFyZXN1bHRzLmxlbmd0aCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdJbnZhbGlkIHVzZXJuYW1lL3Bhc3N3b3JkLicpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDEpIHsgLy8gY29ybmVyIGNhc2Ugd2hlcmUgdXNlcjEgaGFzIHVzZXJuYW1lID09IHVzZXIyIGVtYWlsXG4gICAgICAgICAgICByZXEuY29uZmlnLmxvZ2dlckNvbnRyb2xsZXIud2FybignVGhlcmUgaXMgYSB1c2VyIHdoaWNoIGVtYWlsIGlzIHRoZSBzYW1lIGFzIGFub3RoZXIgdXNlclxcJ3MgdXNlcm5hbWUsIGxvZ2dpbmcgaW4gYmFzZWQgb24gdXNlcm5hbWUnKTtcbiAgICAgICAgICAgIHVzZXIgPSByZXN1bHRzLmZpbHRlcigodXNlcikgPT4gdXNlci51c2VybmFtZSA9PT0gdXNlcm5hbWUpWzBdO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB1c2VyID0gcmVzdWx0c1swXTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gcGFzc3dvcmRDcnlwdG8uY29tcGFyZShwYXNzd29yZCwgdXNlci5wYXNzd29yZCk7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKChjb3JyZWN0KSA9PiB7XG4gICAgICAgICAgaXNWYWxpZFBhc3N3b3JkID0gY29ycmVjdDtcbiAgICAgICAgICBjb25zdCBhY2NvdW50TG9ja291dFBvbGljeSA9IG5ldyBBY2NvdW50TG9ja291dCh1c2VyLCByZXEuY29uZmlnKTtcbiAgICAgICAgICByZXR1cm4gYWNjb3VudExvY2tvdXRQb2xpY3kuaGFuZGxlTG9naW5BdHRlbXB0KGlzVmFsaWRQYXNzd29yZCk7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICBpZiAoIWlzVmFsaWRQYXNzd29yZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdJbnZhbGlkIHVzZXJuYW1lL3Bhc3N3b3JkLicpO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBFbnN1cmUgdGhlIHVzZXIgaXNuJ3QgbG9ja2VkIG91dFxuICAgICAgICAgIC8vIEEgbG9ja2VkIG91dCB1c2VyIHdvbid0IGJlIGFibGUgdG8gbG9naW5cbiAgICAgICAgICAvLyBUbyBsb2NrIGEgdXNlciBvdXQsIGp1c3Qgc2V0IHRoZSBBQ0wgdG8gYG1hc3RlcktleWAgb25seSAgKHt9KS5cbiAgICAgICAgICAvLyBFbXB0eSBBQ0wgaXMgT0tcbiAgICAgICAgICBpZiAoIXJlcS5hdXRoLmlzTWFzdGVyICYmIHVzZXIuQUNMICYmIE9iamVjdC5rZXlzKHVzZXIuQUNMKS5sZW5ndGggPT0gMCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdJbnZhbGlkIHVzZXJuYW1lL3Bhc3N3b3JkLicpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAocmVxLmNvbmZpZy52ZXJpZnlVc2VyRW1haWxzICYmIHJlcS5jb25maWcucHJldmVudExvZ2luV2l0aFVudmVyaWZpZWRFbWFpbCAmJiAhdXNlci5lbWFpbFZlcmlmaWVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRU1BSUxfTk9UX0ZPVU5ELCAnVXNlciBlbWFpbCBpcyBub3QgdmVyaWZpZWQuJyk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZGVsZXRlIHVzZXIucGFzc3dvcmQ7XG5cbiAgICAgICAgICAvLyBTb21ldGltZXMgdGhlIGF1dGhEYXRhIHN0aWxsIGhhcyBudWxsIG9uIHRoYXQga2V5c1xuICAgICAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9wYXJzZS1jb21tdW5pdHkvcGFyc2Utc2VydmVyL2lzc3Vlcy85MzVcbiAgICAgICAgICBpZiAodXNlci5hdXRoRGF0YSkge1xuICAgICAgICAgICAgT2JqZWN0LmtleXModXNlci5hdXRoRGF0YSkuZm9yRWFjaCgocHJvdmlkZXIpID0+IHtcbiAgICAgICAgICAgICAgaWYgKHVzZXIuYXV0aERhdGFbcHJvdmlkZXJdID09PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHVzZXIuYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyh1c2VyLmF1dGhEYXRhKS5sZW5ndGggPT0gMCkge1xuICAgICAgICAgICAgICBkZWxldGUgdXNlci5hdXRoRGF0YTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gcmVzb2x2ZSh1c2VyKTtcbiAgICAgICAgfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChlcnJvcik7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgaGFuZGxlTWUocmVxKSB7XG4gICAgaWYgKCFyZXEuaW5mbyB8fCAhcmVxLmluZm8uc2Vzc2lvblRva2VuKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9TRVNTSU9OX1RPS0VOLCAnSW52YWxpZCBzZXNzaW9uIHRva2VuJyk7XG4gICAgfVxuICAgIGNvbnN0IHNlc3Npb25Ub2tlbiA9IHJlcS5pbmZvLnNlc3Npb25Ub2tlbjtcbiAgICByZXR1cm4gcmVzdC5maW5kKHJlcS5jb25maWcsIEF1dGgubWFzdGVyKHJlcS5jb25maWcpLCAnX1Nlc3Npb24nLFxuICAgICAgeyBzZXNzaW9uVG9rZW4gfSxcbiAgICAgIHsgaW5jbHVkZTogJ3VzZXInIH0sIHJlcS5pbmZvLmNsaWVudFNESylcbiAgICAgIC50aGVuKChyZXNwb25zZSkgPT4ge1xuICAgICAgICBpZiAoIXJlc3BvbnNlLnJlc3VsdHMgfHxcbiAgICAgICAgICByZXNwb25zZS5yZXN1bHRzLmxlbmd0aCA9PSAwIHx8XG4gICAgICAgICAgIXJlc3BvbnNlLnJlc3VsdHNbMF0udXNlcikge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1NFU1NJT05fVE9LRU4sICdJbnZhbGlkIHNlc3Npb24gdG9rZW4nKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCB1c2VyID0gcmVzcG9uc2UucmVzdWx0c1swXS51c2VyO1xuICAgICAgICAgIC8vIFNlbmQgdG9rZW4gYmFjayBvbiB0aGUgbG9naW4sIGJlY2F1c2UgU0RLcyBleHBlY3QgdGhhdC5cbiAgICAgICAgICB1c2VyLnNlc3Npb25Ub2tlbiA9IHNlc3Npb25Ub2tlbjtcblxuICAgICAgICAgIC8vIFJlbW92ZSBoaWRkZW4gcHJvcGVydGllcy5cbiAgICAgICAgICBVc2Vyc1JvdXRlci5yZW1vdmVIaWRkZW5Qcm9wZXJ0aWVzKHVzZXIpO1xuXG4gICAgICAgICAgcmV0dXJuIHsgcmVzcG9uc2U6IHVzZXIgfTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICBoYW5kbGVMb2dJbihyZXEpIHtcbiAgICBsZXQgdXNlcjtcbiAgICByZXR1cm4gdGhpcy5fYXV0aGVudGljYXRlVXNlckZyb21SZXF1ZXN0KHJlcSlcbiAgICAgIC50aGVuKChyZXMpID0+IHtcblxuICAgICAgICB1c2VyID0gcmVzO1xuXG4gICAgICAgIC8vIGhhbmRsZSBwYXNzd29yZCBleHBpcnkgcG9saWN5XG4gICAgICAgIGlmIChyZXEuY29uZmlnLnBhc3N3b3JkUG9saWN5ICYmIHJlcS5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRBZ2UpIHtcbiAgICAgICAgICBsZXQgY2hhbmdlZEF0ID0gdXNlci5fcGFzc3dvcmRfY2hhbmdlZF9hdDtcblxuICAgICAgICAgIGlmICghY2hhbmdlZEF0KSB7XG4gICAgICAgICAgICAvLyBwYXNzd29yZCB3YXMgY3JlYXRlZCBiZWZvcmUgZXhwaXJ5IHBvbGljeSB3YXMgZW5hYmxlZC5cbiAgICAgICAgICAgIC8vIHNpbXBseSB1cGRhdGUgX1VzZXIgb2JqZWN0IHNvIHRoYXQgaXQgd2lsbCBzdGFydCBlbmZvcmNpbmcgZnJvbSBub3dcbiAgICAgICAgICAgIGNoYW5nZWRBdCA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICByZXEuY29uZmlnLmRhdGFiYXNlLnVwZGF0ZSgnX1VzZXInLCB7IHVzZXJuYW1lOiB1c2VyLnVzZXJuYW1lIH0sXG4gICAgICAgICAgICAgIHsgX3Bhc3N3b3JkX2NoYW5nZWRfYXQ6IFBhcnNlLl9lbmNvZGUoY2hhbmdlZEF0KSB9KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gY2hlY2sgd2hldGhlciB0aGUgcGFzc3dvcmQgaGFzIGV4cGlyZWRcbiAgICAgICAgICAgIGlmIChjaGFuZ2VkQXQuX190eXBlID09ICdEYXRlJykge1xuICAgICAgICAgICAgICBjaGFuZ2VkQXQgPSBuZXcgRGF0ZShjaGFuZ2VkQXQuaXNvKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIENhbGN1bGF0ZSB0aGUgZXhwaXJ5IHRpbWUuXG4gICAgICAgICAgICBjb25zdCBleHBpcmVzQXQgPSBuZXcgRGF0ZShjaGFuZ2VkQXQuZ2V0VGltZSgpICsgODY0MDAwMDAgKiByZXEuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkQWdlKTtcbiAgICAgICAgICAgIGlmIChleHBpcmVzQXQgPCBuZXcgRGF0ZSgpKSAvLyBmYWlsIG9mIGN1cnJlbnQgdGltZSBpcyBwYXN0IHBhc3N3b3JkIGV4cGlyeSB0aW1lXG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELCAnWW91ciBwYXNzd29yZCBoYXMgZXhwaXJlZC4gUGxlYXNlIHJlc2V0IHlvdXIgcGFzc3dvcmQuJyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVtb3ZlIGhpZGRlbiBwcm9wZXJ0aWVzLlxuICAgICAgICBVc2Vyc1JvdXRlci5yZW1vdmVIaWRkZW5Qcm9wZXJ0aWVzKHVzZXIpO1xuXG4gICAgICAgIGNvbnN0IHtcbiAgICAgICAgICBzZXNzaW9uRGF0YSxcbiAgICAgICAgICBjcmVhdGVTZXNzaW9uXG4gICAgICAgIH0gPSBBdXRoLmNyZWF0ZVNlc3Npb24ocmVxLmNvbmZpZywge1xuICAgICAgICAgIHVzZXJJZDogdXNlci5vYmplY3RJZCwgY3JlYXRlZFdpdGg6IHtcbiAgICAgICAgICAgICdhY3Rpb24nOiAnbG9naW4nLFxuICAgICAgICAgICAgJ2F1dGhQcm92aWRlcic6ICdwYXNzd29yZCdcbiAgICAgICAgICB9LCBpbnN0YWxsYXRpb25JZDogcmVxLmluZm8uaW5zdGFsbGF0aW9uSWRcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdXNlci5zZXNzaW9uVG9rZW4gPSBzZXNzaW9uRGF0YS5zZXNzaW9uVG9rZW47XG5cbiAgICAgICAgcmVxLmNvbmZpZy5maWxlc0NvbnRyb2xsZXIuZXhwYW5kRmlsZXNJbk9iamVjdChyZXEuY29uZmlnLCB1c2VyKTtcblxuICAgICAgICByZXR1cm4gY3JlYXRlU2Vzc2lvbigpO1xuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHsgcmVzcG9uc2U6IHVzZXIgfTtcbiAgICAgIH0pO1xuICB9XG5cbiAgaGFuZGxlVmVyaWZ5UGFzc3dvcmQocmVxKSB7XG4gICAgcmV0dXJuIHRoaXMuX2F1dGhlbnRpY2F0ZVVzZXJGcm9tUmVxdWVzdChyZXEpXG4gICAgICAudGhlbigodXNlcikgPT4ge1xuXG4gICAgICAgIC8vIFJlbW92ZSBoaWRkZW4gcHJvcGVydGllcy5cbiAgICAgICAgVXNlcnNSb3V0ZXIucmVtb3ZlSGlkZGVuUHJvcGVydGllcyh1c2VyKTtcblxuICAgICAgICByZXR1cm4geyByZXNwb25zZTogdXNlciB9O1xuICAgICAgfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSk7XG4gIH1cblxuICBoYW5kbGVMb2dPdXQocmVxKSB7XG4gICAgY29uc3Qgc3VjY2VzcyA9IHsgcmVzcG9uc2U6IHt9IH07XG4gICAgaWYgKHJlcS5pbmZvICYmIHJlcS5pbmZvLnNlc3Npb25Ub2tlbikge1xuICAgICAgcmV0dXJuIHJlc3QuZmluZChyZXEuY29uZmlnLCBBdXRoLm1hc3RlcihyZXEuY29uZmlnKSwgJ19TZXNzaW9uJyxcbiAgICAgICAgeyBzZXNzaW9uVG9rZW46IHJlcS5pbmZvLnNlc3Npb25Ub2tlbiB9LCB1bmRlZmluZWQsIHJlcS5pbmZvLmNsaWVudFNES1xuICAgICAgKS50aGVuKChyZWNvcmRzKSA9PiB7XG4gICAgICAgIGlmIChyZWNvcmRzLnJlc3VsdHMgJiYgcmVjb3Jkcy5yZXN1bHRzLmxlbmd0aCkge1xuICAgICAgICAgIHJldHVybiByZXN0LmRlbChyZXEuY29uZmlnLCBBdXRoLm1hc3RlcihyZXEuY29uZmlnKSwgJ19TZXNzaW9uJyxcbiAgICAgICAgICAgIHJlY29yZHMucmVzdWx0c1swXS5vYmplY3RJZFxuICAgICAgICAgICkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHN1Y2Nlc3MpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoc3VjY2Vzcyk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShzdWNjZXNzKTtcbiAgfVxuXG4gIF90aHJvd09uQmFkRW1haWxDb25maWcocmVxKSB7XG4gICAgdHJ5IHtcbiAgICAgIENvbmZpZy52YWxpZGF0ZUVtYWlsQ29uZmlndXJhdGlvbih7XG4gICAgICAgIGVtYWlsQWRhcHRlcjogcmVxLmNvbmZpZy51c2VyQ29udHJvbGxlci5hZGFwdGVyLFxuICAgICAgICBhcHBOYW1lOiByZXEuY29uZmlnLmFwcE5hbWUsXG4gICAgICAgIHB1YmxpY1NlcnZlclVSTDogcmVxLmNvbmZpZy5wdWJsaWNTZXJ2ZXJVUkwsXG4gICAgICAgIGVtYWlsVmVyaWZ5VG9rZW5WYWxpZGl0eUR1cmF0aW9uOiByZXEuY29uZmlnLmVtYWlsVmVyaWZ5VG9rZW5WYWxpZGl0eUR1cmF0aW9uXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAodHlwZW9mIGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIC8vIE1heWJlIHdlIG5lZWQgYSBCYWQgQ29uZmlndXJhdGlvbiBlcnJvciwgYnV0IHRoZSBTREtzIHdvbid0IHVuZGVyc3RhbmQgaXQuIEZvciBub3csIEludGVybmFsIFNlcnZlciBFcnJvci5cbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUiwgJ0FuIGFwcE5hbWUsIHB1YmxpY1NlcnZlclVSTCwgYW5kIGVtYWlsQWRhcHRlciBhcmUgcmVxdWlyZWQgZm9yIHBhc3N3b3JkIHJlc2V0IGFuZCBlbWFpbCB2ZXJpZmljYXRpb24gZnVuY3Rpb25hbGl0eS4nKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaGFuZGxlUmVzZXRSZXF1ZXN0KHJlcSkge1xuICAgIHRoaXMuX3Rocm93T25CYWRFbWFpbENvbmZpZyhyZXEpO1xuXG4gICAgY29uc3QgeyBlbWFpbCB9ID0gcmVxLmJvZHk7XG4gICAgaWYgKCFlbWFpbCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkVNQUlMX01JU1NJTkcsIFwieW91IG11c3QgcHJvdmlkZSBhbiBlbWFpbFwiKTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBlbWFpbCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0VNQUlMX0FERFJFU1MsICd5b3UgbXVzdCBwcm92aWRlIGEgdmFsaWQgZW1haWwgc3RyaW5nJyk7XG4gICAgfVxuICAgIGNvbnN0IHVzZXJDb250cm9sbGVyID0gcmVxLmNvbmZpZy51c2VyQ29udHJvbGxlcjtcbiAgICByZXR1cm4gdXNlckNvbnRyb2xsZXIuc2VuZFBhc3N3b3JkUmVzZXRFbWFpbChlbWFpbCkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAgICAgICAgcmVzcG9uc2U6IHt9XG4gICAgICB9KTtcbiAgICB9LCBlcnIgPT4ge1xuICAgICAgaWYgKGVyci5jb2RlID09PSBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5EKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5FTUFJTF9OT1RfRk9VTkQsIGBObyB1c2VyIGZvdW5kIHdpdGggZW1haWwgJHtlbWFpbH0uYCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBoYW5kbGVWZXJpZmljYXRpb25FbWFpbFJlcXVlc3QocmVxKSB7XG4gICAgdGhpcy5fdGhyb3dPbkJhZEVtYWlsQ29uZmlnKHJlcSk7XG5cbiAgICBjb25zdCB7IGVtYWlsIH0gPSByZXEuYm9keTtcbiAgICBpZiAoIWVtYWlsKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRU1BSUxfTUlTU0lORywgJ3lvdSBtdXN0IHByb3ZpZGUgYW4gZW1haWwnKTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBlbWFpbCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0VNQUlMX0FERFJFU1MsICd5b3UgbXVzdCBwcm92aWRlIGEgdmFsaWQgZW1haWwgc3RyaW5nJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlcS5jb25maWcuZGF0YWJhc2UuZmluZCgnX1VzZXInLCB7IGVtYWlsOiBlbWFpbCB9KS50aGVuKChyZXN1bHRzKSA9PiB7XG4gICAgICBpZiAoIXJlc3VsdHMubGVuZ3RoIHx8IHJlc3VsdHMubGVuZ3RoIDwgMSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRU1BSUxfTk9UX0ZPVU5ELCBgTm8gdXNlciBmb3VuZCB3aXRoIGVtYWlsICR7ZW1haWx9YCk7XG4gICAgICB9XG4gICAgICBjb25zdCB1c2VyID0gcmVzdWx0c1swXTtcblxuICAgICAgLy8gcmVtb3ZlIHBhc3N3b3JkIGZpZWxkLCBtZXNzZXMgd2l0aCBzYXZpbmcgb24gcG9zdGdyZXNcbiAgICAgIGRlbGV0ZSB1c2VyLnBhc3N3b3JkO1xuXG4gICAgICBpZiAodXNlci5lbWFpbFZlcmlmaWVkKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PVEhFUl9DQVVTRSwgYEVtYWlsICR7ZW1haWx9IGlzIGFscmVhZHkgdmVyaWZpZWQuYCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHVzZXJDb250cm9sbGVyID0gcmVxLmNvbmZpZy51c2VyQ29udHJvbGxlcjtcbiAgICAgIHJldHVybiB1c2VyQ29udHJvbGxlci5yZWdlbmVyYXRlRW1haWxWZXJpZnlUb2tlbih1c2VyKS50aGVuKCgpID0+IHtcbiAgICAgICAgdXNlckNvbnRyb2xsZXIuc2VuZFZlcmlmaWNhdGlvbkVtYWlsKHVzZXIpO1xuICAgICAgICByZXR1cm4geyByZXNwb25zZToge30gfTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cblxuICBtb3VudFJvdXRlcygpIHtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCAnL3VzZXJzJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlRmluZChyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdQT1NUJywgJy91c2VycycsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZUNyZWF0ZShyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCAnL3VzZXJzL21lJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlTWUocmVxKTsgfSk7XG4gICAgdGhpcy5yb3V0ZSgnR0VUJywgJy91c2Vycy86b2JqZWN0SWQnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVHZXQocmVxKTsgfSk7XG4gICAgdGhpcy5yb3V0ZSgnUFVUJywgJy91c2Vycy86b2JqZWN0SWQnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVVcGRhdGUocmVxKTsgfSk7XG4gICAgdGhpcy5yb3V0ZSgnREVMRVRFJywgJy91c2Vycy86b2JqZWN0SWQnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVEZWxldGUocmVxKTsgfSk7XG4gICAgdGhpcy5yb3V0ZSgnR0VUJywgJy9sb2dpbicsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZUxvZ0luKHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ1BPU1QnLCAnL2xvZ2luJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlTG9nSW4ocmVxKTsgfSk7XG4gICAgdGhpcy5yb3V0ZSgnUE9TVCcsICcvbG9nb3V0JywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlTG9nT3V0KHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ1BPU1QnLCAnL3JlcXVlc3RQYXNzd29yZFJlc2V0JywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlUmVzZXRSZXF1ZXN0KHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ1BPU1QnLCAnL3ZlcmlmaWNhdGlvbkVtYWlsUmVxdWVzdCcsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZVZlcmlmaWNhdGlvbkVtYWlsUmVxdWVzdChyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCAnL3ZlcmlmeVBhc3N3b3JkJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlVmVyaWZ5UGFzc3dvcmQocmVxKTsgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgVXNlcnNSb3V0ZXI7XG4iXX0=