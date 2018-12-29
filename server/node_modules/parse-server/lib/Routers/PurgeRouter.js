'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PurgeRouter = undefined;

var _PromiseRouter = require('../PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _middlewares = require('../middlewares');

var middleware = _interopRequireWildcard(_middlewares);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class PurgeRouter extends _PromiseRouter2.default {

  handlePurge(req) {
    if (req.auth.isReadOnly) {
      throw new _node2.default.Error(_node2.default.Error.OPERATION_FORBIDDEN, 'read-only masterKey isn\'t allowed to purge a schema.');
    }
    return req.config.database.purgeCollection(req.params.className).then(() => {
      var cacheAdapter = req.config.cacheController;
      if (req.params.className == '_Session') {
        cacheAdapter.user.clear();
      } else if (req.params.className == '_Role') {
        cacheAdapter.role.clear();
      }
      return { response: {} };
    }).catch(error => {
      if (!error || error && error.code === _node2.default.Error.OBJECT_NOT_FOUND) {
        return { response: {} };
      }
      throw error;
    });
  }

  mountRoutes() {
    this.route('DELETE', '/purge/:className', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.handlePurge(req);
    });
  }
}

exports.PurgeRouter = PurgeRouter;
exports.default = PurgeRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1B1cmdlUm91dGVyLmpzIl0sIm5hbWVzIjpbIm1pZGRsZXdhcmUiLCJQdXJnZVJvdXRlciIsIlByb21pc2VSb3V0ZXIiLCJoYW5kbGVQdXJnZSIsInJlcSIsImF1dGgiLCJpc1JlYWRPbmx5IiwiUGFyc2UiLCJFcnJvciIsIk9QRVJBVElPTl9GT1JCSURERU4iLCJjb25maWciLCJkYXRhYmFzZSIsInB1cmdlQ29sbGVjdGlvbiIsInBhcmFtcyIsImNsYXNzTmFtZSIsInRoZW4iLCJjYWNoZUFkYXB0ZXIiLCJjYWNoZUNvbnRyb2xsZXIiLCJ1c2VyIiwiY2xlYXIiLCJyb2xlIiwicmVzcG9uc2UiLCJjYXRjaCIsImVycm9yIiwiY29kZSIsIk9CSkVDVF9OT1RfRk9VTkQiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwicHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7OztBQUNBOztJQUFZQSxVOztBQUNaOzs7Ozs7OztBQUVPLE1BQU1DLFdBQU4sU0FBMEJDLHVCQUExQixDQUF3Qzs7QUFFN0NDLGNBQVlDLEdBQVosRUFBaUI7QUFDZixRQUFJQSxJQUFJQyxJQUFKLENBQVNDLFVBQWIsRUFBeUI7QUFDdkIsWUFBTSxJQUFJQyxlQUFNQyxLQUFWLENBQWdCRCxlQUFNQyxLQUFOLENBQVlDLG1CQUE1QixFQUFpRCx1REFBakQsQ0FBTjtBQUNEO0FBQ0QsV0FBT0wsSUFBSU0sTUFBSixDQUFXQyxRQUFYLENBQW9CQyxlQUFwQixDQUFvQ1IsSUFBSVMsTUFBSixDQUFXQyxTQUEvQyxFQUNKQyxJQURJLENBQ0MsTUFBTTtBQUNWLFVBQUlDLGVBQWVaLElBQUlNLE1BQUosQ0FBV08sZUFBOUI7QUFDQSxVQUFJYixJQUFJUyxNQUFKLENBQVdDLFNBQVgsSUFBd0IsVUFBNUIsRUFBd0M7QUFDdENFLHFCQUFhRSxJQUFiLENBQWtCQyxLQUFsQjtBQUNELE9BRkQsTUFFTyxJQUFJZixJQUFJUyxNQUFKLENBQVdDLFNBQVgsSUFBd0IsT0FBNUIsRUFBcUM7QUFDMUNFLHFCQUFhSSxJQUFiLENBQWtCRCxLQUFsQjtBQUNEO0FBQ0QsYUFBTyxFQUFDRSxVQUFVLEVBQVgsRUFBUDtBQUNELEtBVEksRUFTRkMsS0FURSxDQVNLQyxLQUFELElBQVc7QUFDbEIsVUFBSSxDQUFDQSxLQUFELElBQVdBLFNBQVNBLE1BQU1DLElBQU4sS0FBZWpCLGVBQU1DLEtBQU4sQ0FBWWlCLGdCQUFuRCxFQUFzRTtBQUNwRSxlQUFPLEVBQUNKLFVBQVUsRUFBWCxFQUFQO0FBQ0Q7QUFDRCxZQUFNRSxLQUFOO0FBQ0QsS0FkSSxDQUFQO0FBZUQ7O0FBRURHLGdCQUFjO0FBQ1osU0FBS0MsS0FBTCxDQUFXLFFBQVgsRUFBc0IsbUJBQXRCLEVBQTJDM0IsV0FBVzRCLDZCQUF0RCxFQUFzRnhCLEdBQUQsSUFBUztBQUFFLGFBQU8sS0FBS0QsV0FBTCxDQUFpQkMsR0FBakIsQ0FBUDtBQUErQixLQUEvSDtBQUNEO0FBekI0Qzs7UUFBbENILFcsR0FBQUEsVztrQkE0QkVBLFciLCJmaWxlIjoiUHVyZ2VSb3V0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgUHJvbWlzZVJvdXRlciBmcm9tICcuLi9Qcm9taXNlUm91dGVyJztcbmltcG9ydCAqIGFzIG1pZGRsZXdhcmUgZnJvbSAnLi4vbWlkZGxld2FyZXMnO1xuaW1wb3J0IFBhcnNlIGZyb20gJ3BhcnNlL25vZGUnO1xuXG5leHBvcnQgY2xhc3MgUHVyZ2VSb3V0ZXIgZXh0ZW5kcyBQcm9taXNlUm91dGVyIHtcblxuICBoYW5kbGVQdXJnZShyZXEpIHtcbiAgICBpZiAocmVxLmF1dGguaXNSZWFkT25seSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sICdyZWFkLW9ubHkgbWFzdGVyS2V5IGlzblxcJ3QgYWxsb3dlZCB0byBwdXJnZSBhIHNjaGVtYS4nKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlcS5jb25maWcuZGF0YWJhc2UucHVyZ2VDb2xsZWN0aW9uKHJlcS5wYXJhbXMuY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICB2YXIgY2FjaGVBZGFwdGVyID0gcmVxLmNvbmZpZy5jYWNoZUNvbnRyb2xsZXI7XG4gICAgICAgIGlmIChyZXEucGFyYW1zLmNsYXNzTmFtZSA9PSAnX1Nlc3Npb24nKSB7XG4gICAgICAgICAgY2FjaGVBZGFwdGVyLnVzZXIuY2xlYXIoKTtcbiAgICAgICAgfSBlbHNlIGlmIChyZXEucGFyYW1zLmNsYXNzTmFtZSA9PSAnX1JvbGUnKSB7XG4gICAgICAgICAgY2FjaGVBZGFwdGVyLnJvbGUuY2xlYXIoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge3Jlc3BvbnNlOiB7fX07XG4gICAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgaWYgKCFlcnJvciB8fCAoZXJyb3IgJiYgZXJyb3IuY29kZSA9PT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCkpIHtcbiAgICAgICAgICByZXR1cm4ge3Jlc3BvbnNlOiB7fX07XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcbiAgfVxuXG4gIG1vdW50Um91dGVzKCkge1xuICAgIHRoaXMucm91dGUoJ0RFTEVURScsICAnL3B1cmdlLzpjbGFzc05hbWUnLCBtaWRkbGV3YXJlLnByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzLCAocmVxKSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZVB1cmdlKHJlcSk7IH0pO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFB1cmdlUm91dGVyO1xuIl19