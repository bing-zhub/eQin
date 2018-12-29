'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AccountLockout = undefined;

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class AccountLockout {
  constructor(user, config) {
    this._user = user;
    this._config = config;
  }

  /**
   * set _failed_login_count to value
   */
  _setFailedLoginCount(value) {
    const query = {
      username: this._user.username
    };

    const updateFields = {
      _failed_login_count: value
    };

    return this._config.database.update('_User', query, updateFields);
  }

  /**
   * check if the _failed_login_count field has been set
   */
  _isFailedLoginCountSet() {
    const query = {
      username: this._user.username,
      _failed_login_count: { $exists: true }
    };

    return this._config.database.find('_User', query).then(users => {
      if (Array.isArray(users) && users.length > 0) {
        return true;
      } else {
        return false;
      }
    });
  }

  /**
   * if _failed_login_count is NOT set then set it to 0
   * else do nothing
   */
  _initFailedLoginCount() {
    return this._isFailedLoginCountSet().then(failedLoginCountIsSet => {
      if (!failedLoginCountIsSet) {
        return this._setFailedLoginCount(0);
      }
    });
  }

  /**
   * increment _failed_login_count by 1
   */
  _incrementFailedLoginCount() {
    const query = {
      username: this._user.username
    };

    const updateFields = { _failed_login_count: { __op: 'Increment', amount: 1 } };

    return this._config.database.update('_User', query, updateFields);
  }

  /**
   * if the failed login count is greater than the threshold
   * then sets lockout expiration to 'currenttime + accountPolicy.duration', i.e., account is locked out for the next 'accountPolicy.duration' minutes
   * else do nothing
   */
  _setLockoutExpiration() {
    const query = {
      username: this._user.username,
      _failed_login_count: { $gte: this._config.accountLockout.threshold }
    };

    const now = new Date();

    const updateFields = {
      _account_lockout_expires_at: _node2.default._encode(new Date(now.getTime() + this._config.accountLockout.duration * 60 * 1000))
    };

    return this._config.database.update('_User', query, updateFields).catch(err => {
      if (err && err.code && err.message && err.code === 101 && err.message === 'Object not found.') {
        return; // nothing to update so we are good
      } else {
        throw err; // unknown error
      }
    });
  }

  /**
   * if _account_lockout_expires_at > current_time and _failed_login_count > threshold
   *   reject with account locked error
   * else
   *   resolve
   */
  _notLocked() {
    const query = {
      username: this._user.username,
      _account_lockout_expires_at: { $gt: _node2.default._encode(new Date()) },
      _failed_login_count: { $gte: this._config.accountLockout.threshold }
    };

    return this._config.database.find('_User', query).then(users => {
      if (Array.isArray(users) && users.length > 0) {
        throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Your account is locked due to multiple failed login attempts. Please try again after ' + this._config.accountLockout.duration + ' minute(s)');
      }
    });
  }

  /**
   * set and/or increment _failed_login_count
   * if _failed_login_count > threshold
   *   set the _account_lockout_expires_at to current_time + accountPolicy.duration
   * else
   *   do nothing
   */
  _handleFailedLoginAttempt() {
    return this._initFailedLoginCount().then(() => {
      return this._incrementFailedLoginCount();
    }).then(() => {
      return this._setLockoutExpiration();
    });
  }

  /**
   * handle login attempt if the Account Lockout Policy is enabled
   */
  handleLoginAttempt(loginSuccessful) {
    if (!this._config.accountLockout) {
      return Promise.resolve();
    }
    return this._notLocked().then(() => {
      if (loginSuccessful) {
        return this._setFailedLoginCount(0);
      } else {
        return this._handleFailedLoginAttempt();
      }
    });
  }

}

exports.AccountLockout = AccountLockout; // This class handles the Account Lockout Policy settings.

exports.default = AccountLockout;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9BY2NvdW50TG9ja291dC5qcyJdLCJuYW1lcyI6WyJBY2NvdW50TG9ja291dCIsImNvbnN0cnVjdG9yIiwidXNlciIsImNvbmZpZyIsIl91c2VyIiwiX2NvbmZpZyIsIl9zZXRGYWlsZWRMb2dpbkNvdW50IiwidmFsdWUiLCJxdWVyeSIsInVzZXJuYW1lIiwidXBkYXRlRmllbGRzIiwiX2ZhaWxlZF9sb2dpbl9jb3VudCIsImRhdGFiYXNlIiwidXBkYXRlIiwiX2lzRmFpbGVkTG9naW5Db3VudFNldCIsIiRleGlzdHMiLCJmaW5kIiwidGhlbiIsInVzZXJzIiwiQXJyYXkiLCJpc0FycmF5IiwibGVuZ3RoIiwiX2luaXRGYWlsZWRMb2dpbkNvdW50IiwiZmFpbGVkTG9naW5Db3VudElzU2V0IiwiX2luY3JlbWVudEZhaWxlZExvZ2luQ291bnQiLCJfX29wIiwiYW1vdW50IiwiX3NldExvY2tvdXRFeHBpcmF0aW9uIiwiJGd0ZSIsImFjY291bnRMb2Nrb3V0IiwidGhyZXNob2xkIiwibm93IiwiRGF0ZSIsIl9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCIsIlBhcnNlIiwiX2VuY29kZSIsImdldFRpbWUiLCJkdXJhdGlvbiIsImNhdGNoIiwiZXJyIiwiY29kZSIsIm1lc3NhZ2UiLCJfbm90TG9ja2VkIiwiJGd0IiwiRXJyb3IiLCJPQkpFQ1RfTk9UX0ZPVU5EIiwiX2hhbmRsZUZhaWxlZExvZ2luQXR0ZW1wdCIsImhhbmRsZUxvZ2luQXR0ZW1wdCIsImxvZ2luU3VjY2Vzc2Z1bCIsIlByb21pc2UiLCJyZXNvbHZlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQ0E7Ozs7OztBQUVPLE1BQU1BLGNBQU4sQ0FBcUI7QUFDMUJDLGNBQVlDLElBQVosRUFBa0JDLE1BQWxCLEVBQTBCO0FBQ3hCLFNBQUtDLEtBQUwsR0FBYUYsSUFBYjtBQUNBLFNBQUtHLE9BQUwsR0FBZUYsTUFBZjtBQUNEOztBQUVEOzs7QUFHQUcsdUJBQXFCQyxLQUFyQixFQUE0QjtB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IHRoZSBBY2NvdW50IExvY2tvdXQgUG9saWN5IHNldHRpbmdzLlxuaW1wb3J0IFBhcnNlIGZyb20gJ3BhcnNlL25vZGUnO1xuXG5leHBvcnQgY2xhc3MgQWNjb3VudExvY2tvdXQge1xuICBjb25zdHJ1Y3Rvcih1c2VyLCBjb25maWcpIHtcbiAgICB0aGlzLl91c2VyID0gdXNlcjtcbiAgICB0aGlzLl9jb25maWcgPSBjb25maWc7XG4gIH1cblxuICAvKipcbiAgICogc2V0IF9mYWlsZWRfbG9naW5fY291bnQgdG8gdmFsdWVcbiAgICovXG4gIF9zZXRGYWlsZWRMb2dpbkNvdW50KHZhbHVlKSB7XG4gICAgY29uc3QgcXVlcnkgPSB7XG4gICAgICB1c2VybmFtZTogdGhpcy5fdXNlci51c2VybmFtZVxuICAgIH07XG5cbiAgICBjb25zdCB1cGRhdGVGaWVsZHMgPSB7XG4gICAgICBfZmFpbGVkX2xvZ2luX2NvdW50OiB2YWx1ZVxuICAgIH07XG5cbiAgICByZXR1cm4gdGhpcy5fY29uZmlnLmRhdGFiYXNlLnVwZGF0ZSgnX1VzZXInLCBxdWVyeSwgdXBkYXRlRmllbGRzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBjaGVjayBpZiB0aGUgX2ZhaWxlZF9sb2dpbl9jb3VudCBmaWVsZCBoYXMgYmVlbiBzZXRcbiAgICovXG4gIF9pc0ZhaWxlZExvZ2luQ291bnRTZXQoKSB7XG4gICAgY29uc3QgcXVlcnkgPSB7XG4gICAgICB1c2VybmFtZTogdGhpcy5fdXNlci51c2VybmFtZSxcbiAgICAgIF9mYWlsZWRfbG9naW5fY291bnQ6IHsgJGV4aXN0czogdHJ1ZSB9XG4gICAgfTtcblxuICAgIHJldHVybiB0aGlzLl9jb25maWcuZGF0YWJhc2UuZmluZCgnX1VzZXInLCBxdWVyeSlcbiAgICAgIC50aGVuKHVzZXJzID0+IHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodXNlcnMpICYmIHVzZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIGlmIF9mYWlsZWRfbG9naW5fY291bnQgaXMgTk9UIHNldCB0aGVuIHNldCBpdCB0byAwXG4gICAqIGVsc2UgZG8gbm90aGluZ1xuICAgKi9cbiAgX2luaXRGYWlsZWRMb2dpbkNvdW50KCkge1xuICAgIHJldHVybiB0aGlzLl9pc0ZhaWxlZExvZ2luQ291bnRTZXQoKVxuICAgICAgLnRoZW4oZmFpbGVkTG9naW5Db3VudElzU2V0ID0+IHtcbiAgICAgICAgaWYgKCFmYWlsZWRMb2dpbkNvdW50SXNTZXQpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5fc2V0RmFpbGVkTG9naW5Db3VudCgwKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogaW5jcmVtZW50IF9mYWlsZWRfbG9naW5fY291bnQgYnkgMVxuICAgKi9cbiAgX2luY3JlbWVudEZhaWxlZExvZ2luQ291bnQoKSB7XG4gICAgY29uc3QgcXVlcnkgPSB7XG4gICAgICB1c2VybmFtZTogdGhpcy5fdXNlci51c2VybmFtZVxuICAgIH07XG5cbiAgICBjb25zdCB1cGRhdGVGaWVsZHMgPSB7X2ZhaWxlZF9sb2dpbl9jb3VudDoge19fb3A6ICdJbmNyZW1lbnQnLCBhbW91bnQ6IDF9fTtcblxuICAgIHJldHVybiB0aGlzLl9jb25maWcuZGF0YWJhc2UudXBkYXRlKCdfVXNlcicsIHF1ZXJ5LCB1cGRhdGVGaWVsZHMpO1xuICB9XG5cbiAgLyoqXG4gICAqIGlmIHRoZSBmYWlsZWQgbG9naW4gY291bnQgaXMgZ3JlYXRlciB0aGFuIHRoZSB0aHJlc2hvbGRcbiAgICogdGhlbiBzZXRzIGxvY2tvdXQgZXhwaXJhdGlvbiB0byAnY3VycmVudHRpbWUgKyBhY2NvdW50UG9saWN5LmR1cmF0aW9uJywgaS5lLiwgYWNjb3VudCBpcyBsb2NrZWQgb3V0IGZvciB0aGUgbmV4dCAnYWNjb3VudFBvbGljeS5kdXJhdGlvbicgbWludXRlc1xuICAgKiBlbHNlIGRvIG5vdGhpbmdcbiAgICovXG4gIF9zZXRMb2Nrb3V0RXhwaXJhdGlvbigpIHtcbiAgICBjb25zdCBxdWVyeSA9IHtcbiAgICAgIHVzZXJuYW1lOiB0aGlzLl91c2VyLnVzZXJuYW1lLFxuICAgICAgX2ZhaWxlZF9sb2dpbl9jb3VudDogeyAkZ3RlOiB0aGlzLl9jb25maWcuYWNjb3VudExvY2tvdXQudGhyZXNob2xkIH1cbiAgICB9O1xuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcblxuICAgIGNvbnN0IHVwZGF0ZUZpZWxkcyA9IHtcbiAgICAgIF9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdDogUGFyc2UuX2VuY29kZShuZXcgRGF0ZShub3cuZ2V0VGltZSgpICsgdGhpcy5fY29uZmlnLmFjY291bnRMb2Nrb3V0LmR1cmF0aW9uICogNjAgKiAxMDAwKSlcbiAgICB9O1xuXG4gICAgcmV0dXJuIHRoaXMuX2NvbmZpZy5kYXRhYmFzZS51cGRhdGUoJ19Vc2VyJywgcXVlcnksIHVwZGF0ZUZpZWxkcylcbiAgICAgIC5jYXRjaChlcnIgPT4ge1xuICAgICAgICBpZiAoZXJyICYmIGVyci5jb2RlICYmIGVyci5tZXNzYWdlICYmIGVyci5jb2RlID09PSAxMDEgJiYgZXJyLm1lc3NhZ2UgPT09ICdPYmplY3Qgbm90IGZvdW5kLicpIHtcbiAgICAgICAgICByZXR1cm47IC8vIG5vdGhpbmcgdG8gdXBkYXRlIHNvIHdlIGFyZSBnb29kXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyOyAvLyB1bmtub3duIGVycm9yXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIGlmIF9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCA+IGN1cnJlbnRfdGltZSBhbmQgX2ZhaWxlZF9sb2dpbl9jb3VudCA+IHRocmVzaG9sZFxuICAgKiAgIHJlamVjdCB3aXRoIGFjY291bnQgbG9ja2VkIGVycm9yXG4gICAqIGVsc2VcbiAgICogICByZXNvbHZlXG4gICAqL1xuICBfbm90TG9ja2VkKCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0ge1xuICAgICAgdXNlcm5hbWU6IHRoaXMuX3VzZXIudXNlcm5hbWUsXG4gICAgICBfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQ6IHsgJGd0OiBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKCkpIH0sXG4gICAgICBfZmFpbGVkX2xvZ2luX2NvdW50OiB7JGd0ZTogdGhpcy5fY29uZmlnLmFjY291bnRMb2Nrb3V0LnRocmVzaG9sZH1cbiAgICB9O1xuXG4gICAgcmV0dXJuIHRoaXMuX2NvbmZpZy5kYXRhYmFzZS5maW5kKCdfVXNlcicsIHF1ZXJ5KVxuICAgICAgLnRoZW4odXNlcnMgPT4ge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh1c2VycykgJiYgdXNlcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELCAnWW91ciBhY2NvdW50IGlzIGxvY2tlZCBkdWUgdG8gbXVsdGlwbGUgZmFpbGVkIGxvZ2luIGF0dGVtcHRzLiBQbGVhc2UgdHJ5IGFnYWluIGFmdGVyICcgKyB0aGlzLl9jb25maWcuYWNjb3VudExvY2tvdXQuZHVyYXRpb24gKyAnIG1pbnV0ZShzKScpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBzZXQgYW5kL29yIGluY3JlbWVudCBfZmFpbGVkX2xvZ2luX2NvdW50XG4gICAqIGlmIF9mYWlsZWRfbG9naW5fY291bnQgPiB0aHJlc2hvbGRcbiAgICogICBzZXQgdGhlIF9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCB0byBjdXJyZW50X3RpbWUgKyBhY2NvdW50UG9saWN5LmR1cmF0aW9uXG4gICAqIGVsc2VcbiAgICogICBkbyBub3RoaW5nXG4gICAqL1xuICBfaGFuZGxlRmFpbGVkTG9naW5BdHRlbXB0KCkge1xuICAgIHJldHVybiB0aGlzLl9pbml0RmFpbGVkTG9naW5Db3VudCgpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLl9pbmNyZW1lbnRGYWlsZWRMb2dpbkNvdW50KCk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5fc2V0TG9ja291dEV4cGlyYXRpb24oKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIGhhbmRsZSBsb2dpbiBhdHRlbXB0IGlmIHRoZSBBY2NvdW50IExvY2tvdXQgUG9saWN5IGlzIGVuYWJsZWRcbiAgICovXG4gIGhhbmRsZUxvZ2luQXR0ZW1wdChsb2dpblN1Y2Nlc3NmdWwpIHtcbiAgICBpZiAoIXRoaXMuX2NvbmZpZy5hY2NvdW50TG9ja291dCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fbm90TG9ja2VkKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKGxvZ2luU3VjY2Vzc2Z1bCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLl9zZXRGYWlsZWRMb2dpbkNvdW50KDApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiB0aGlzLl9oYW5kbGVGYWlsZWRMb2dpbkF0dGVtcHQoKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxufVxuXG5leHBvcnQgZGVmYXVsdCBBY2NvdW50TG9ja291dDtcbiJdfQ==