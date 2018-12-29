'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PushController = undefined;

var _node = require('parse/node');

var _RestQuery = require('../RestQuery');

var _RestQuery2 = _interopRequireDefault(_RestQuery);

var _RestWrite = require('../RestWrite');

var _RestWrite2 = _interopRequireDefault(_RestWrite);

var _Auth = require('../Auth');

var _StatusHandler = require('../StatusHandler');

var _utils = require('../Push/utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class PushController {

  sendPush(body = {}, where = {}, config, auth, onPushStatusSaved = () => {}, now = new Date()) {
    if (!config.hasPushSupport) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Missing push configuration');
    }

    // Replace the expiration_time and push_time with a valid Unix epoch milliseconds time
    body.expiration_time = PushController.getExpirationTime(body);
    body.expiration_interval = PushController.getExpirationInterval(body);
    if (body.expiration_time && body.expiration_interval) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Both expiration_time and expiration_interval cannot be set');
    }

    // Immediate push
    if (body.expiration_interval && !body.hasOwnProperty('push_time')) {
      const ttlMs = body.expiration_interval * 1000;
      body.expiration_time = new Date(now.valueOf() + ttlMs).valueOf();
    }

    const pushTime = PushController.getPushTime(body);
    if (pushTime && pushTime.date !== 'undefined') {
      body['push_time'] = PushController.formatPushTime(pushTime);
    }

    // TODO: If the req can pass the checking, we return immediately instead of waiting
    // pushes to be sent. We probably change this behaviour in the future.
    let badgeUpdate = () => {
      return Promise.resolve();
    };

    if (body.data && body.data.badge) {
      const badge = body.data.badge;
      let restUpdate = {};
      if (typeof badge == 'string' && badge.toLowerCase() === 'increment') {
        restUpdate = { badge: { __op: 'Increment', amount: 1 } };
      } else if (typeof badge == 'object' && typeof badge.__op == 'string' && badge.__op.toLowerCase() == 'increment' && Number(badge.amount)) {
        restUpdate = { badge: { __op: 'Increment', amount: badge.amount } };
      } else if (Number(badge)) {
        restUpdate = { badge: badge };
      } else {
        throw "Invalid value for badge, expected number or 'Increment' or {increment: number}";
      }

      // Force filtering on only valid device tokens
      const updateWhere = (0, _utils.applyDeviceTokenExists)(where);
      badgeUpdate = () => {
        // Build a real RestQuery so we can use it in RestWrite
        const restQuery = new _RestQuery2.default(config, (0, _Auth.master)(config), '_Installation', updateWhere);
        return restQuery.buildRestWhere().then(() => {
          const write = new _RestWrite2.default(config, (0, _Auth.master)(config), '_Installation', restQuery.restWhere, restUpdate);
          write.runOptions.many = true;
          return write.execute();
        });
      };
    }
    const pushStatus = (0, _StatusHandler.pushStatusHandler)(config);
    return Promise.resolve().then(() => {
      return pushStatus.setInitial(body, where);
    }).then(() => {
      onPushStatusSaved(pushStatus.objectId);
      return badgeUpdate();
    }).then(() => {
      // Update audience lastUsed and timesUsed
      if (body.audience_id) {
        const audienceId = body.audience_id;

        var updateAudience = {
          lastUsed: { __type: "Date", iso: new Date().toISOString() },
          timesUsed: { __op: "Increment", "amount": 1 }
        };
        const write = new _RestWrite2.default(config, (0, _Auth.master)(config), '_Audience', { objectId: audienceId }, updateAudience);
        write.execute();
      }
      // Don't wait for the audience update promise to resolve.
      return Promise.resolve();
    }).then(() => {
      if (body.hasOwnProperty('push_time') && config.hasPushScheduledSupport) {
        return Promise.resolve();
      }
      return config.pushControllerQueue.enqueue(body, where, config, auth, pushStatus);
    }).catch(err => {
      return pushStatus.fail(err).then(() => {
        throw err;
      });
    });
  }

  /**
   * Get expiration time from the request body.
   * @param {Object} request A request object
   * @returns {Number|undefined} The expiration time if it exists in the request
   */
  static getExpirationTime(body = {}) {
    var hasExpirationTime = body.hasOwnProperty('expiration_time');
    if (!hasExpirationTime) {
      return;
    }
    var expirationTimeParam = body['expiration_time'];
    var expirationTime;
    if (typeof expirationTimeParam === 'number') {
      expirationTime = new Date(expirationTimeParam * 1000);
    } else if (typeof expirationTimeParam === 'string') {
      expirationTime = new Date(expirationTimeParam);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, body['expiration_time'] + ' is not valid time.');
    }
    // Check expirationTime is valid or not, if it is not valid, expirationTime is NaN
    if (!isFinite(expirationTime)) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, body['expiration_time'] + ' is not valid time.');
    }
    return expirationTime.valueOf();
  }

  static getExpirationInterval(body = {}) {
    const hasExpirationInterval = body.hasOwnProperty('expiration_interval');
    if (!hasExpirationInterval) {
      return;
    }

    var expirationIntervalParam = body['expiration_interval'];
    if (typeof expirationIntervalParam !== 'number' || expirationIntervalParam <= 0) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, `expiration_interval must be a number greater than 0`);
    }
    return expirationIntervalParam;
  }

  /**
   * Get push time from the request body.
   * @param {Object} request A request object
   * @returns {Number|undefined} The push time if it exists in the request
   */
  static getPushTime(body = {}) {
    var hasPushTime = body.hasOwnProperty('push_time');
    if (!hasPushTime) {
      return;
    }
    var pushTimeParam = body['push_time'];
    var date;
    var isLocalTime = true;

    if (typeof pushTimeParam === 'number') {
      date = new Date(pushTimeParam * 1000);
    } else if (typeof pushTimeParam === 'string') {
      isLocalTime = !PushController.pushTimeHasTimezoneComponent(pushTimeParam);
      date = new Date(pushTimeParam);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, body['push_time'] + ' is not valid time.');
    }
    // Check pushTime is valid or not, if it is not valid, pushTime is NaN
    if (!isFinite(date)) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, body['push_time'] + ' is not valid time.');
    }

    return {
      date,
      isLocalTime
    };
  }

  /**
   * Checks if a ISO8601 formatted date contains a timezone component
   * @param pushTimeParam {string}
   * @returns {boolean}
   */
  static pushTimeHasTimezoneComponent(pushTimeParam) {
    const offsetPattern = /(.+)([+-])\d\d:\d\d$/;
    return pushTimeParam.indexOf('Z') === pushTimeParam.length - 1 // 2007-04-05T12:30Z
    || offsetPattern.test(pushTimeParam); // 2007-04-05T12:30.000+02:00, 2007-04-05T12:30.000-02:00
  }

  /**
   * Converts a date to ISO format in UTC time and strips the timezone if `isLocalTime` is true
   * @param date {Date}
   * @param isLocalTime {boolean}
   * @returns {string}
   */
  static formatPushTime({ date, isLocalTime }) {
    if (isLocalTime) {
      // Strip 'Z'
      const isoString = date.toISOString();
      return isoString.substring(0, isoString.indexOf('Z'));
    }
    return date.toISOString();
  }
}

exports.PushController = PushController;
exports.default = PushController;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9QdXNoQ29udHJvbGxlci5qcyJdLCJuYW1lcyI6WyJQdXNoQ29udHJvbGxlciIsInNlbmRQdXNoIiwiYm9keSIsIndoZXJlIiwiY29uZmlnIiwiYXV0aCIsIm9uUHVzaFN0YXR1c1NhdmVkIiwibm93IiwiRGF0ZSIsImhhc1B1c2hTdXBwb3J0IiwiUGFyc2UiLCJFcnJvciIsIlBVU0hfTUlTQ09ORklHVVJFRCIsImV4cGlyYXRpb25fdGltZSIsImdldEV4cGlyYXRpb25UaW1lIiwiZXhwaXJhdGlvbl9pbnRlcnZhbCIsImdldEV4cGlyYXRpb25JbnRlcnZhbCIsImhhc093blByb3BlcnR5IiwidHRsTXMiLCJ2YWx1ZU9mIiwicHVzaFRpbWUiLCJnZXRQdXNoVGltZSIsImRhdGUiLCJmb3JtYXRQdXNoVGltZSIsImJhZGdlVXBkYXRlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJkYXRhIiwiYmFkZ2UiLCJyZXN0VXBkYXRlIiwidG9Mb3dlckNhc2UiLCJfX29wIiwiYW1vdW50IiwiTnVtYmVyIiwidXBkYXRlV2hlcmUiLCJyZXN0UXVlcnkiLCJSZXN0UXVlcnkiLCJidWlsZFJlc3RXaGVyZSIsInRoZW4iLCJ3cml0ZSIsIlJlc3RXcml0ZSIsInJlc3RXaGVyZSIsInJ1bk9wdGlvbnMiLCJtYW55IiwiZXhlY3V0ZSIsInB1c2hTdGF0dXMiLCJzZXRJbml0aWFsIiwib2JqZWN0SWQiLCJhdWRpZW5jZV9pZCIsImF1ZGllbmNlSWQiLCJ1cGRhdGVBdWRpZW5jZSIsImxhc3RVc2VkIiwiX190eXBlIiwiaXNvIiwidG9JU09TdHJpbmciLCJ0aW1lc1VzZWQiLCJoYXNQdXNoU2NoZWR1bGVkU3VwcG9ydCIsInB1c2hDb250cm9sbGVyUXVldWUiLCJlbnF1ZXVlIiwiY2F0Y2giLCJlcnIiLCJmYWlsIiwiaGFzRXhwaXJhdGlvblRpbWUiLCJleHBpcmF0aW9uVGltZVBhcmFtIiwiZXhwaXJhdGlvblRpbWUiLCJpc0Zpbml0ZSIsImhhc0V4cGlyYXRpb25JbnRlcnZhbCIsImV4cGlyYXRpb25JbnRlcnZhbFBhcmFtIiwiaGFzUHVzaFRpbWUiLCJwdXNoVGltZVBhcmFtIiwiaXNMb2NhbFRpbWUiLCJwdXNoVGltZUhhc1RpbWV6b25lQ29tcG9uZW50Iiwib2Zmc2V0UGF0dGVybiIsImluZGV4T2YiLCJsZW5ndGgiLCJ0ZXN0IiwiaXNvU3RyaW5nIiwic3Vic3RyaW5nIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOztBQUNBOztBQUNBOzs7O0FBRU8sTUFBTUEsY0FBTixDQUFxQjs7QUFFMUJDLFdBQVNDLE9BQU8sRUFBaEIsRUFBb0JDLFFBQVEsRUFBNUIsRUFBZ0NDLE1BQWhDLEVBQXdDQyxJQUF4QyxFQUE4Q0Msb0JBQW9CLE1BQU0sQ0FBRSxDQUExRSxFQUE0RUMsTUFBTSxJQUFJQyxJQUFKLEVBQWxGLEVBQThGO0FBQzVGLFFBQUksQ0FBQ0osT0FBT0ssY0FBWixFQUE0QjtBQUMxQixZQUFNLElBQUlDLFlBQU1DLEtBQVYsQ0FBZ0JELFlBQU1DLEtBQU4sQ0FBWUMsa0JBQTVCLEVBQ0osNEJBREksQ0FBTjtBQUVEOztBQUVEO0FBQ0FWLFNBQUtXLGVBQUwsR0FBdUJiLGVBQWVjLGlCQUFmLENBQWlDWixJQUFqQyxDQUF2QjtBQUNBQSxTQUFLYSxtQkFBTCxHQUEyQmYsZUFBZWdCLHFCQUFmLENBQXFDZCxJQUFyQyxDQUEzQjtBQUNBLFFBQUlBLEtBQUtXLGVBQUwsSUFBd0JYLEtBQUthLG1CQUFqQyxFQUFzRDtBQUNwRCxZQUFNLElBQUlMLFlBQU1DLEtBQVYsQ0FDSkQsWUFBTUMsS0FBTixDQUFZQyxrQkFEUixFQUVKLDREQUZJLENBQU47QUFHRDs7QUFFRDtBQUNBLFFBQUlWLEtBQUthLG1CQUFMLElBQTRCLENBQUNiLEtBQUtlLGNBQUwsQ0FBb0IsV0FBcEIsQ0FBakMsRUFBbUU7QUFDakUsWUFBTUMsUUFBUWhCLEtBQUthLG1CQUFMLEdBQTJCLElBQXpDO0FBQ0FiLFdBQUtXLGVBQUws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LENBQW9CLENBQXBCLEVBQXVCRCxVQUFVSCxPQUFWLENBQWtCLEdBQWxCLENBQXZCLENBQVA7QUFDRDtBQUNELFdBQU9uRCxLQUFLZ0MsV0FBTCxFQUFQO0FBQ0Q7QUFoTXlCOztRQUFmdEQsYyxHQUFBQSxjO2tCQW1NRUEsYyIsImZpbGUiOiJQdXNoQ29udHJvbGxlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFBhcnNlIH0gICAgICAgICAgICAgIGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IFJlc3RRdWVyeSAgICAgICAgICAgICAgZnJvbSAnLi4vUmVzdFF1ZXJ5JztcbmltcG9ydCBSZXN0V3JpdGUgICAgICAgICAgICAgIGZyb20gJy4uL1Jlc3RXcml0ZSc7XG5pbXBvcnQgeyBtYXN0ZXIgfSAgICAgICAgICAgICBmcm9tICcuLi9BdXRoJztcbmltcG9ydCB7IHB1c2hTdGF0dXNIYW5kbGVyIH0gIGZyb20gJy4uL1N0YXR1c0hhbmRsZXInO1xuaW1wb3J0IHsgYXBwbHlEZXZpY2VUb2tlbkV4aXN0cyB9IGZyb20gJy4uL1B1c2gvdXRpbHMnO1xuXG5leHBvcnQgY2xhc3MgUHVzaENvbnRyb2xsZXIge1xuXG4gIHNlbmRQdXNoKGJvZHkgPSB7fSwgd2hlcmUgPSB7fSwgY29uZmlnLCBhdXRoLCBvblB1c2hTdGF0dXNTYXZlZCA9ICgpID0+IHt9LCBub3cgPSBuZXcgRGF0ZSgpKSB7XG4gICAgaWYgKCFjb25maWcuaGFzUHVzaFN1cHBvcnQpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgICdNaXNzaW5nIHB1c2ggY29uZmlndXJhdGlvbicpO1xuICAgIH1cblxuICAgIC8vIFJlcGxhY2UgdGhlIGV4cGlyYXRpb25fdGltZSBhbmQgcHVzaF90aW1lIHdpdGggYSB2YWxpZCBVbml4IGVwb2NoIG1pbGxpc2Vjb25kcyB0aW1lXG4gICAgYm9keS5leHBpcmF0aW9uX3RpbWUgPSBQdXNoQ29udHJvbGxlci5nZXRFeHBpcmF0aW9uVGltZShib2R5KTtcbiAgICBib2R5LmV4cGlyYXRpb25faW50ZXJ2YWwgPSBQdXNoQ29udHJvbGxlci5nZXRFeHBpcmF0aW9uSW50ZXJ2YWwoYm9keSk7XG4gICAgaWYgKGJvZHkuZXhwaXJhdGlvbl90aW1lICYmIGJvZHkuZXhwaXJhdGlvbl9pbnRlcnZhbCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgICdCb3RoIGV4cGlyYXRpb25fdGltZSBhbmQgZXhwaXJhdGlvbl9pbnRlcnZhbCBjYW5ub3QgYmUgc2V0Jyk7XG4gICAgfVxuXG4gICAgLy8gSW1tZWRpYXRlIHB1c2hcbiAgICBpZiAoYm9keS5leHBpcmF0aW9uX2ludGVydmFsICYmICFib2R5Lmhhc093blByb3BlcnR5KCdwdXNoX3RpbWUnKSkge1xuICAgICAgY29uc3QgdHRsTXMgPSBib2R5LmV4cGlyYXRpb25faW50ZXJ2YWwgKiAxMDAwO1xuICAgICAgYm9keS5leHBpcmF0aW9uX3RpbWUgPSAobmV3IERhdGUobm93LnZhbHVlT2YoKSArIHR0bE1zKSkudmFsdWVPZigpO1xuICAgIH1cblxuICAgIGNvbnN0IHB1c2hUaW1lID0gUHVzaENvbnRyb2xsZXIuZ2V0UHVzaFRpbWUoYm9keSk7XG4gICAgaWYgKHB1c2hUaW1lICYmIHB1c2hUaW1lLmRhdGUgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBib2R5WydwdXNoX3RpbWUnXSA9IFB1c2hDb250cm9sbGVyLmZvcm1hdFB1c2hUaW1lKHB1c2hUaW1lKTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBJZiB0aGUgcmVxIGNhbiBwYXNzIHRoZSBjaGVja2luZywgd2UgcmV0dXJuIGltbWVkaWF0ZWx5IGluc3RlYWQgb2Ygd2FpdGluZ1xuICAgIC8vIHB1c2hlcyB0byBiZSBzZW50LiBXZSBwcm9iYWJseSBjaGFuZ2UgdGhpcyBiZWhhdmlvdXIgaW4gdGhlIGZ1dHVyZS5cbiAgICBsZXQgYmFkZ2VVcGRhdGUgPSAoKSA9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgaWYgKGJvZHkuZGF0YSAmJiBib2R5LmRhdGEuYmFkZ2UpIHtcbiAgICAgIGNvbnN0IGJhZGdlID0gYm9keS5kYXRhLmJhZGdlO1xuICAgICAgbGV0IHJlc3RVcGRhdGUgPSB7fTtcbiAgICAgIGlmICh0eXBlb2YgYmFkZ2UgPT0gJ3N0cmluZycgJiYgYmFkZ2UudG9Mb3dlckNhc2UoKSA9PT0gJ2luY3JlbWVudCcpIHtcbiAgICAgICAgcmVzdFVwZGF0ZSA9IHsgYmFkZ2U6IHsgX19vcDogJ0luY3JlbWVudCcsIGFtb3VudDogMSB9IH1cbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGJhZGdlID09ICdvYmplY3QnICYmIHR5cGVvZiBiYWRnZS5fX29wID09ICdzdHJpbmcnICYmXG4gICAgICAgICAgICAgICAgIGJhZGdlLl9fb3AudG9Mb3dlckNhc2UoKSA9PSAnaW5jcmVtZW50JyAmJiBOdW1iZXIoYmFkZ2UuYW1vdW50KSkge1xuICAgICAgICByZXN0VXBkYXRlID0geyBiYWRnZTogeyBfX29wOiAnSW5jcmVtZW50JywgYW1vdW50OiBiYWRnZS5hbW91bnQgfSB9XG4gICAgICB9IGVsc2UgaWYgKE51bWJlcihiYWRnZSkpIHtcbiAgICAgICAgcmVzdFVwZGF0ZSA9IHsgYmFkZ2U6IGJhZGdlIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IFwiSW52YWxpZCB2YWx1ZSBmb3IgYmFkZ2UsIGV4cGVjdGVkIG51bWJlciBvciAnSW5jcmVtZW50JyBvciB7aW5jcmVtZW50OiBudW1iZXJ9XCI7XG4gICAgICB9XG5cbiAgICAgIC8vIEZvcmNlIGZpbHRlcmluZyBvbiBvbmx5IHZhbGlkIGRldmljZSB0b2tlbnNcbiAgICAgIGNvbnN0IHVwZGF0ZVdoZXJlID0gYXBwbHlEZXZpY2VUb2tlbkV4aXN0cyh3aGVyZSk7XG4gICAgICBiYWRnZVVwZGF0ZSA9ICgpID0+IHtcbiAgICAgICAgLy8gQnVpbGQgYSByZWFsIFJlc3RRdWVyeSBzbyB3ZSBjYW4gdXNlIGl0IGluIFJlc3RXcml0ZVxuICAgICAgICBjb25zdCByZXN0UXVlcnkgPSBuZXcgUmVzdFF1ZXJ5KGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfSW5zdGFsbGF0aW9uJywgdXBkYXRlV2hlcmUpO1xuICAgICAgICByZXR1cm4gcmVzdFF1ZXJ5LmJ1aWxkUmVzdFdoZXJlKCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgY29uc3Qgd3JpdGUgPSBuZXcgUmVzdFdyaXRlKGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfSW5zdGFsbGF0aW9uJywgcmVzdFF1ZXJ5LnJlc3RXaGVyZSwgcmVzdFVwZGF0ZSk7XG4gICAgICAgICAgd3JpdGUucnVuT3B0aW9ucy5tYW55ID0gdHJ1ZTtcbiAgICAgICAgICByZXR1cm4gd3JpdGUuZXhlY3V0ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgcHVzaFN0YXR1cyA9IHB1c2hTdGF0dXNIYW5kbGVyKGNvbmZpZyk7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHB1c2hTdGF0dXMuc2V0SW5pdGlhbChib2R5LCB3aGVyZSk7XG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICBvblB1c2hTdGF0dXNTYXZlZChwdXNoU3RhdHVzLm9iamVjdElkKTtcbiAgICAgIHJldHVybiBiYWRnZVVwZGF0ZSgpO1xuICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgLy8gVXBkYXRlIGF1ZGllbmNlIGxhc3RVc2VkIGFuZCB0aW1lc1VzZWRcbiAgICAgIGlmIChib2R5LmF1ZGllbmNlX2lkKSB7XG4gICAgICAgIGNvbnN0IGF1ZGllbmNlSWQgPSBib2R5LmF1ZGllbmNlX2lkO1xuXG4gICAgICAgIHZhciB1cGRhdGVBdWRpZW5jZSA9IHtcbiAgICAgICAgICBsYXN0VXNlZDogeyBfX3R5cGU6IFwiRGF0ZVwiLCBpc286IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9LFxuICAgICAgICAgIHRpbWVzVXNlZDogeyBfX29wOiBcIkluY3JlbWVudFwiLCBcImFtb3VudFwiOiAxIH1cbiAgICAgICAgfTtcbiAgICAgICAgY29uc3Qgd3JpdGUgPSBuZXcgUmVzdFdyaXRlKGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfQXVkaWVuY2UnLCB7b2JqZWN0SWQ6IGF1ZGllbmNlSWR9LCB1cGRhdGVBdWRpZW5jZSk7XG4gICAgICAgIHdyaXRlLmV4ZWN1dGUoKTtcbiAgICAgIH1cbiAgICAgIC8vIERvbid0IHdhaXQgZm9yIHRoZSBhdWRpZW5jZSB1cGRhdGUgcHJvbWlzZSB0byByZXNvbHZlLlxuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgaWYgKGJvZHkuaGFzT3duUHJvcGVydHkoJ3B1c2hfdGltZScpICYmIGNvbmZpZy5oYXNQdXNoU2NoZWR1bGVkU3VwcG9ydCkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gY29uZmlnLnB1c2hDb250cm9sbGVyUXVldWUuZW5xdWV1ZShib2R5LCB3aGVyZSwgY29uZmlnLCBhdXRoLCBwdXNoU3RhdHVzKTtcbiAgICB9KS5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICByZXR1cm4gcHVzaFN0YXR1cy5mYWlsKGVycikudGhlbigoKSA9PiB7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBleHBpcmF0aW9uIHRpbWUgZnJvbSB0aGUgcmVxdWVzdCBib2R5LlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCBBIHJlcXVlc3Qgb2JqZWN0XG4gICAqIEByZXR1cm5zIHtOdW1iZXJ8dW5kZWZpbmVkfSBUaGUgZXhwaXJhdGlvbiB0aW1lIGlmIGl0IGV4aXN0cyBpbiB0aGUgcmVxdWVzdFxuICAgKi9cbiAgc3RhdGljIGdldEV4cGlyYXRpb25UaW1lKGJvZHkgPSB7fSkge1xuICAgIHZhciBoYXNFeHBpcmF0aW9uVGltZSA9IGJvZHkuaGFzT3duUHJvcGVydHkoJ2V4cGlyYXRpb25fdGltZScpO1xuICAgIGlmICghaGFzRXhwaXJhdGlvblRpbWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIGV4cGlyYXRpb25UaW1lUGFyYW0gPSBib2R5WydleHBpcmF0aW9uX3RpbWUnXTtcbiAgICB2YXIgZXhwaXJhdGlvblRpbWU7XG4gICAgaWYgKHR5cGVvZiBleHBpcmF0aW9uVGltZVBhcmFtID09PSAnbnVtYmVyJykge1xuICAgICAgZXhwaXJhdGlvblRpbWUgPSBuZXcgRGF0ZShleHBpcmF0aW9uVGltZVBhcmFtICogMTAwMCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZXhwaXJhdGlvblRpbWVQYXJhbSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGV4cGlyYXRpb25UaW1lID0gbmV3IERhdGUoZXhwaXJhdGlvblRpbWVQYXJhbSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ2V4cGlyYXRpb25fdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgZXhwaXJhdGlvblRpbWUgaXMgdmFsaWQgb3Igbm90LCBpZiBpdCBpcyBub3QgdmFsaWQsIGV4cGlyYXRpb25UaW1lIGlzIE5hTlxuICAgIGlmICghaXNGaW5pdGUoZXhwaXJhdGlvblRpbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICBib2R5WydleHBpcmF0aW9uX3RpbWUnXSArICcgaXMgbm90IHZhbGlkIHRpbWUuJyk7XG4gICAgfVxuICAgIHJldHVybiBleHBpcmF0aW9uVGltZS52YWx1ZU9mKCk7XG4gIH1cblxuICBzdGF0aWMgZ2V0RXhwaXJhdGlvbkludGVydmFsKGJvZHkgPSB7fSkge1xuICAgIGNvbnN0IGhhc0V4cGlyYXRpb25JbnRlcnZhbCA9IGJvZHkuaGFzT3duUHJvcGVydHkoJ2V4cGlyYXRpb25faW50ZXJ2YWwnKTtcbiAgICBpZiAoIWhhc0V4cGlyYXRpb25JbnRlcnZhbCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbSA9IGJvZHlbJ2V4cGlyYXRpb25faW50ZXJ2YWwnXTtcbiAgICBpZiAodHlwZW9mIGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtICE9PSAnbnVtYmVyJyB8fCBleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbSA8PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICBgZXhwaXJhdGlvbl9pbnRlcnZhbCBtdXN0IGJlIGEgbnVtYmVyIGdyZWF0ZXIgdGhhbiAwYCk7XG4gICAgfVxuICAgIHJldHVybiBleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgcHVzaCB0aW1lIGZyb20gdGhlIHJlcXVlc3QgYm9keS5cbiAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgQSByZXF1ZXN0IG9iamVjdFxuICAgKiBAcmV0dXJucyB7TnVtYmVyfHVuZGVmaW5lZH0gVGhlIHB1c2ggdGltZSBpZiBpdCBleGlzdHMgaW4gdGhlIHJlcXVlc3RcbiAgICovXG4gIHN0YXRpYyBnZXRQdXNoVGltZShib2R5ID0ge30pIHtcbiAgICB2YXIgaGFzUHVzaFRpbWUgPSBib2R5Lmhhc093blByb3BlcnR5KCdwdXNoX3RpbWUnKTtcbiAgICBpZiAoIWhhc1B1c2hUaW1lKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBwdXNoVGltZVBhcmFtID0gYm9keVsncHVzaF90aW1lJ107XG4gICAgdmFyIGRhdGU7XG4gICAgdmFyIGlzTG9jYWxUaW1lID0gdHJ1ZTtcblxuICAgIGlmICh0eXBlb2YgcHVzaFRpbWVQYXJhbSA9PT0gJ251bWJlcicpIHtcbiAgICAgIGRhdGUgPSBuZXcgRGF0ZShwdXNoVGltZVBhcmFtICogMTAwMCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcHVzaFRpbWVQYXJhbSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGlzTG9jYWxUaW1lID0gIVB1c2hDb250cm9sbGVyLnB1c2hUaW1lSGFzVGltZXpvbmVDb21wb25lbnQocHVzaFRpbWVQYXJhbSk7XG4gICAgICBkYXRlID0gbmV3IERhdGUocHVzaFRpbWVQYXJhbSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ3B1c2hfdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgcHVzaFRpbWUgaXMgdmFsaWQgb3Igbm90LCBpZiBpdCBpcyBub3QgdmFsaWQsIHB1c2hUaW1lIGlzIE5hTlxuICAgIGlmICghaXNGaW5pdGUoZGF0ZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ3B1c2hfdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGF0ZSxcbiAgICAgIGlzTG9jYWxUaW1lLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgSVNPODYwMSBmb3JtYXR0ZWQgZGF0ZSBjb250YWlucyBhIHRpbWV6b25lIGNvbXBvbmVudFxuICAgKiBAcGFyYW0gcHVzaFRpbWVQYXJhbSB7c3RyaW5nfVxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAgICovXG4gIHN0YXRpYyBwdXNoVGltZUhhc1RpbWV6b25lQ29tcG9uZW50KHB1c2hUaW1lUGFyYW06IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IG9mZnNldFBhdHRlcm4gPSAvKC4rKShbKy1dKVxcZFxcZDpcXGRcXGQkLztcbiAgICByZXR1cm4gcHVzaFRpbWVQYXJhbS5pbmRleE9mKCdaJykgPT09IHB1c2hUaW1lUGFyYW0ubGVuZ3RoIC0gMSAvLyAyMDA3LTA0LTA1VDEyOjMwWlxuICAgICAgfHwgb2Zmc2V0UGF0dGVybi50ZXN0KHB1c2hUaW1lUGFyYW0pOyAvLyAyMDA3LTA0LTA1VDEyOjMwLjAwMCswMjowMCwgMjAwNy0wNC0wNVQxMjozMC4wMDAtMDI6MDBcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIGRhdGUgdG8gSVNPIGZvcm1hdCBpbiBVVEMgdGltZSBhbmQgc3RyaXBzIHRoZSB0aW1lem9uZSBpZiBgaXNMb2NhbFRpbWVgIGlzIHRydWVcbiAgICogQHBhcmFtIGRhdGUge0RhdGV9XG4gICAqIEBwYXJhbSBpc0xvY2FsVGltZSB7Ym9vbGVhbn1cbiAgICogQHJldHVybnMge3N0cmluZ31cbiAgICovXG4gIHN0YXRpYyBmb3JtYXRQdXNoVGltZSh7IGRhdGUsIGlzTG9jYWxUaW1lIH06IHsgZGF0ZTogRGF0ZSwgaXNMb2NhbFRpbWU6IGJvb2xlYW4gfSkge1xuICAgIGlmIChpc0xvY2FsVGltZSkgeyAvLyBTdHJpcCAnWidcbiAgICAgIGNvbnN0IGlzb1N0cmluZyA9IGRhdGUudG9JU09TdHJpbmcoKTtcbiAgICAgIHJldHVybiBpc29TdHJpbmcuc3Vic3RyaW5nKDAsIGlzb1N0cmluZy5pbmRleE9mKCdaJykpO1xuICAgIH1cbiAgICByZXR1cm4gZGF0ZS50b0lTT1N0cmluZygpO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFB1c2hDb250cm9sbGVyO1xuIl19