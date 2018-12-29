'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RolesRouter = undefined;

var _ClassesRouter = require('./ClassesRouter');

var _ClassesRouter2 = _interopRequireDefault(_ClassesRouter);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class RolesRouter extends _ClassesRouter2.default {
  className() {
    return '_Role';
  }

  mountRoutes() {
    this.route('GET', '/roles', req => {
      return this.handleFind(req);
    });
    this.route('GET', '/roles/:objectId', req => {
      return this.handleGet(req);
    });
    this.route('POST', '/roles', req => {
      return this.handleCreate(req);
    });
    this.route('PUT', '/roles/:objectId', req => {
      return this.handleUpdate(req);
    });
    this.route('DELETE', '/roles/:objectId', req => {
      return this.handleDelete(req);
    });
  }
}

exports.RolesRouter = RolesRouter;
exports.default = RolesRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1JvbGVzUm91dGVyLmpzIl0sIm5hbWVzIjpbIlJvbGVzUm91dGVyIiwiQ2xhc3Nlc1JvdXRlciIsImNsYXNzTmFtZSIsIm1vdW50Um91dGVzIiwicm91dGUiLCJyZXEiLCJoYW5kbGVGaW5kIiwiaGFuZGxlR2V0IiwiaGFuZGxlQ3JlYXRlIiwiaGFuZGxlVXBkYXRlIiwiaGFuZGxlRGVsZXRlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQ0E7Ozs7OztBQUVPLE1BQU1BLFdBQU4sU0FBMEJDLHVCQUExQixDQUF3QztBQUM3Q0MsY0FBWTtBQUNWLFdBQU8sT0FBUDtBQUNEOztBQUVEQyxnQkFBYztBQUNaLFNBQUtDLEtBQUwsQ0FBVyxLQUFYLEVBQWlCLFFBQWpCLEVBQTJCQyxPQUFPO0FBQUUsYUFBTyxLQUFLQyxVQUFMLENBQWdCRCxHQUFoQixDQUFQO0FBQThCLEtBQWxFO0FBQ0EsU0FBS0QsS0FBTCxDQUFXLEtBQVgsRUFBaUIsa0JBQWpCLEVBQXFDQyxPQUFPO0FBQUUsYUFBTyxLQUFLRSxTQUFMLENBQWVGLEdBQWYsQ0FBUDtBQUE2QixLQUEzRTtBQUNBLFNBQUtELEtBQUwsQ0FBVyxNQUFYLEVBQWtCLFFBQWxCLEVBQTRCQyxPQUFPO0FBQUUsYUFBTyxLQUFLRyxZQUFMLENBQWtCSCxHQUFsQixDQUFQO0FBQWdDLEtBQXJFO0FBQ0EsU0FBS0QsS0FBTCxDQUFXLEtBQVgsRUFBaUIsa0JBQWpCLEVBQXFDQyxPQUFPO0FBQUUsYUFBTyxLQUFLSSxZQUFMLENBQWtCSixHQUFsQixDQUFQO0FBQWdDLEtBQTlFO0FBQ0EsU0FBS0QsS0FBTCxDQUFXLFFBQVgsRUFBb0Isa0JBQXBCLEVBQXdDQyxPQUFPO0FBQUUsYUFBTyxLQUFLSyxZQUFMLENBQWtCTCxHQUFsQixDQUFQO0FBQWdDLEtBQWpGO0FBQ0Q7QUFYNEM7O1FBQWxDTCxXLEdBQUFBLFc7a0JBY0VBLFciLCJmaWxlIjoiUm9sZXNSb3V0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJcbmltcG9ydCBDbGFzc2VzUm91dGVyIGZyb20gJy4vQ2xhc3Nlc1JvdXRlcic7XG5cbmV4cG9ydCBjbGFzcyBSb2xlc1JvdXRlciBleHRlbmRzIENsYXNzZXNSb3V0ZXIge1xuICBjbGFzc05hbWUoKSB7XG4gICAgcmV0dXJuICdfUm9sZSc7XG4gIH1cblxuICBtb3VudFJvdXRlcygpIHtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCcvcm9sZXMnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVGaW5kKHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ0dFVCcsJy9yb2xlcy86b2JqZWN0SWQnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVHZXQocmVxKTsgfSk7XG4gICAgdGhpcy5yb3V0ZSgnUE9TVCcsJy9yb2xlcycsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZUNyZWF0ZShyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdQVVQnLCcvcm9sZXMvOm9iamVjdElkJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlVXBkYXRlKHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ0RFTEVURScsJy9yb2xlcy86b2JqZWN0SWQnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVEZWxldGUocmVxKTsgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUm9sZXNSb3V0ZXI7XG4iXX0=