'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SessionsRouter = undefined;

var _ClassesRouter = require('./ClassesRouter');

var _ClassesRouter2 = _interopRequireDefault(_ClassesRouter);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _rest = require('../rest');

var _rest2 = _interopRequireDefault(_rest);

var _Auth = require('../Auth');

var _Auth2 = _interopRequireDefault(_Auth);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class SessionsRouter extends _ClassesRouter2.default {

  className() {
    return '_Session';
  }

  handleMe(req) {
    // TODO: Verify correct behavior
    if (!req.info || !req.info.sessionToken) {
      throw new _node2.default.Error(_node2.default.Error.INVALID_SESSION_TOKEN, 'Session token required.');
    }
    return _rest2.default.find(req.config, _Auth2.default.master(req.config), '_Session', { sessionToken: req.info.sessionToken }, undefined, req.info.clientSDK).then(response => {
      if (!response.results || response.results.length == 0) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_SESSION_TOKEN, 'Session token not found.');
      }
      return {
        response: response.results[0]
      };
    });
  }

  handleUpdateToRevocableSession(req) {
    const config = req.config;
    const user = req.auth.user;
    // Issue #2720
    // Calling without a session token would result in a not found user
    if (!user) {
      throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'invalid session');
    }
    const {
      sessionData,
      createSession
    } = _Auth2.default.createSession(config, {
      userId: user.id,
      createdWith: {
        'action': 'upgrade'
      },
      installationId: req.auth.installationId
    });

    return createSession().then(() => {
      // delete the session token, use the db to skip beforeSave
      return config.database.update('_User', {
        objectId: user.id
      }, {
        sessionToken: { __op: 'Delete' }
      });
    }).then(() => {
      return Promise.resolve({ response: sessionData });
    });
  }

  mountRoutes() {
    this.route('GET', '/sessions/me', req => {
      return this.handleMe(req);
    });
    this.route('GET', '/sessions', req => {
      return this.handleFind(req);
    });
    this.route('GET', '/sessions/:objectId', req => {
      return this.handleGet(req);
    });
    this.route('POST', '/sessions', req => {
      return this.handleCreate(req);
    });
    this.route('PUT', '/sessions/:objectId', req => {
      return this.handleUpdate(req);
    });
    this.route('DELETE', '/sessions/:objectId', req => {
      return this.handleDelete(req);
    });
    this.route('POST', '/upgradeToRevocableSession', req => {
      return this.handleUpdateToRevocableSession(req);
    });
  }
}

exports.SessionsRouter = SessionsRouter;
exports.default = SessionsRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1Nlc3Npb25zUm91dGVyLmpzIl0sIm5hbWVzIjpbIlNlc3Npb25zUm91dGVyIiwiQ2xhc3Nlc1JvdXRlciIsImNsYXNzTmFtZSIsImhhbmRsZU1lIiwicmVxIiwiaW5mbyIsInNlc3Npb25Ub2tlbiIsIlBhcnNlIiwiRXJyb3IiLCJJTlZBTElEX1NFU1NJT05fVE9LRU4iLCJyZXN0IiwiZmluZCIsImNvbmZpZyIsIkF1dGgiLCJtYXN0ZXIiLCJ1bmRlZmluZWQiLCJjbGllbnRTREsiLCJ0aGVuIiwicmVzcG9uc2UiLCJyZXN1bHRzIiwibGVuZ3RoIiwiaGFuZGxlVXBkYXRlVG9SZXZvY2FibGVTZXNzaW9uIiwidXNlciIsImF1dGgiLCJPQkpFQ1RfTk9UX0ZPVU5EIiwic2Vzc2lvbkRhdGEiLCJjcmVhdGVTZXNzaW9uIiwidXNlcklkIiwiaWQiLCJjcmVhdGVkV2l0aCIsImluc3RhbGxhdGlvbklkIiwiZGF0YWJhc2UiLCJ1cGRhdGUiLCJvYmplY3RJZCIsIl9fb3AiLCJQcm9taXNlIiwicmVzb2x2ZSIsIm1vdW50Um91dGVzIiwicm91dGUiLCJoYW5kbGVGaW5kIiwiaGFuZGxlR2V0IiwiaGFuZGxlQ3JlYXRlIiwiaGFuZGxlVXBkYXRlIiwiaGFuZGxlRGVsZXRlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7Ozs7OztBQUVPLE1BQU1BLGNBQU4sU0FBNkJDLHVCQUE3QixDQUEyQzs7QUFFaERDLGNBQVk7QUFDVixXQUFPLFVBQVA7QUFDRDs7QUFFREMsV0FBU0MsR0FBVCxFQUFjO0FBQ1o7QUFDQSxRQUFJLENBQUNBLElBQUlDLElBQUwsSUFBYSxDQUFDRCxJQUFJQyxJQUFKLENBQVNDLFlBQTNCLEVBQXlDO0FBQ3ZDLFlBQU0sSUFBSUMsZUFBTUMsS0FBVixDQUFnQkQsZUFBTUMsS0FBTixDQUFZQyxxQkFBNUIsRUFDSix5QkFESSxDQUFOO0FBRUQ7QUFDRCxXQUFPQyxlQUFL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LE9BQU87QUFBRSxhQUFPLEtBQUtpQiw4QkFBTCxDQUFvQ2pCLEdBQXBDLENBQVA7QUFBa0QsS0FBNUc7QUFDRDtBQS9EK0M7O1FBQXJDSixjLEdBQUFBLGM7a0JBa0VFQSxjIiwiZmlsZSI6IlNlc3Npb25zUm91dGVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiXG5pbXBvcnQgQ2xhc3Nlc1JvdXRlciBmcm9tICcuL0NsYXNzZXNSb3V0ZXInO1xuaW1wb3J0IFBhcnNlICAgICAgICAgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgcmVzdCAgICAgICAgICBmcm9tICcuLi9yZXN0JztcbmltcG9ydCBBdXRoICAgICAgICAgIGZyb20gJy4uL0F1dGgnO1xuXG5leHBvcnQgY2xhc3MgU2Vzc2lvbnNSb3V0ZXIgZXh0ZW5kcyBDbGFzc2VzUm91dGVyIHtcblxuICBjbGFzc05hbWUoKSB7XG4gICAgcmV0dXJuICdfU2Vzc2lvbic7XG4gIH1cblxuICBoYW5kbGVNZShyZXEpIHtcbiAgICAvLyBUT0RPOiBWZXJpZnkgY29ycmVjdCBiZWhhdmlvclxuICAgIGlmICghcmVxLmluZm8gfHwgIXJlcS5pbmZvLnNlc3Npb25Ub2tlbikge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTixcbiAgICAgICAgJ1Nlc3Npb24gdG9rZW4gcmVxdWlyZWQuJyk7XG4gICAgfVxuICAgIHJldHVybiByZXN0LmZpbmQocmVxLmNvbmZpZywgQXV0aC5tYXN0ZXIocmVxLmNvbmZpZyksICdfU2Vzc2lvbicsIHsgc2Vzc2lvblRva2VuOiByZXEuaW5mby5zZXNzaW9uVG9rZW4gfSwgdW5kZWZpbmVkLCByZXEuaW5mby5jbGllbnRTREspXG4gICAgICAudGhlbigocmVzcG9uc2UpID0+IHtcbiAgICAgICAgaWYgKCFyZXNwb25zZS5yZXN1bHRzIHx8IHJlc3BvbnNlLnJlc3VsdHMubGVuZ3RoID09IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9TRVNTSU9OX1RPS0VOLFxuICAgICAgICAgICAgJ1Nlc3Npb24gdG9rZW4gbm90IGZvdW5kLicpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgcmVzcG9uc2U6IHJlc3BvbnNlLnJlc3VsdHNbMF1cbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICB9XG5cbiAgaGFuZGxlVXBkYXRlVG9SZXZvY2FibGVTZXNzaW9uKHJlcSkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHJlcS5jb25maWc7XG4gICAgY29uc3QgdXNlciA9IHJlcS5hdXRoLnVzZXI7XG4gICAgLy8gSXNzdWUgIzI3MjBcbiAgICAvLyBDYWxsaW5nIHdpdGhvdXQgYSBzZXNzaW9uIHRva2VuIHdvdWxkIHJlc3VsdCBpbiBhIG5vdCBmb3VuZCB1c2VyXG4gICAgaWYgKCF1c2VyKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ2ludmFsaWQgc2Vzc2lvbicpO1xuICAgIH1cbiAgICBjb25zdCB7XG4gICAgICBzZXNzaW9uRGF0YSxcbiAgICAgIGNyZWF0ZVNlc3Npb25cbiAgICB9ID0gQXV0aC5jcmVhdGVTZXNzaW9uKGNvbmZpZywge1xuICAgICAgdXNlcklkOiB1c2VyLmlkLFxuICAgICAgY3JlYXRlZFdpdGg6IHtcbiAgICAgICAgJ2FjdGlvbic6ICd1cGdyYWRlJyxcbiAgICAgIH0sXG4gICAgICBpbnN0YWxsYXRpb25JZDogcmVxLmF1dGguaW5zdGFsbGF0aW9uSWQsXG4gICAgfSk7XG5cbiAgICByZXR1cm4gY3JlYXRlU2Vzc2lvbigpLnRoZW4oKCkgPT4ge1xuICAgICAgLy8gZGVsZXRlIHRoZSBzZXNzaW9uIHRva2VuLCB1c2UgdGhlIGRiIHRvIHNraXAgYmVmb3JlU2F2ZVxuICAgICAgcmV0dXJuIGNvbmZpZy5kYXRhYmFzZS51cGRhdGUoJ19Vc2VyJywge1xuICAgICAgICBvYmplY3RJZDogdXNlci5pZFxuICAgICAgfSwge1xuICAgICAgICBzZXNzaW9uVG9rZW46IHtfX29wOiAnRGVsZXRlJ31cbiAgICAgIH0pO1xuICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7IHJlc3BvbnNlOiBzZXNzaW9uRGF0YSB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIG1vdW50Um91dGVzKCkge1xuICAgIHRoaXMucm91dGUoJ0dFVCcsJy9zZXNzaW9ucy9tZScsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZU1lKHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ0dFVCcsICcvc2Vzc2lvbnMnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVGaW5kKHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ0dFVCcsICcvc2Vzc2lvbnMvOm9iamVjdElkJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlR2V0KHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ1BPU1QnLCAnL3Nlc3Npb25zJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlQ3JlYXRlKHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ1BVVCcsICcvc2Vzc2lvbnMvOm9iamVjdElkJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlVXBkYXRlKHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ0RFTEVURScsICcvc2Vzc2lvbnMvOm9iamVjdElkJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlRGVsZXRlKHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ1BPU1QnLCAnL3VwZ3JhZGVUb1Jldm9jYWJsZVNlc3Npb24nLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVVcGRhdGVUb1Jldm9jYWJsZVNlc3Npb24ocmVxKTsgfSlcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBTZXNzaW9uc1JvdXRlcjtcbiJdfQ==