'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GlobalConfigRouter = undefined;

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _PromiseRouter = require('../PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _middlewares = require('../middlewares');

var middleware = _interopRequireWildcard(_middlewares);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class GlobalConfigRouter extends _PromiseRouter2.default {
  getGlobalConfig(req) {
    return req.config.database.find('_GlobalConfig', { objectId: "1" }, { limit: 1 }).then(results => {
      if (results.length != 1) {
        // If there is no config in the database - return empty config.
        return { response: { params: {} } };
      }
      const globalConfig = results[0];
      return { response: { params: globalConfig.params } };
    });
  }

  updateGlobalConfig(req) {
    if (req.auth.isReadOnly) {
      throw new _node2.default.Error(_node2.default.Error.OPERATION_FORBIDDEN, 'read-only masterKey isn\'t allowed to update the config.');
    }
    const params = req.body.params;
    // Transform in dot notation to make sure it works
    const update = Object.keys(params).reduce((acc, key) => {
      acc[`params.${key}`] = params[key];
      return acc;
    }, {});
    return req.config.database.update('_GlobalConfig', { objectId: "1" }, update, { upsert: true }).then(() => ({ response: { result: true } }));
  }

  mountRoutes() {
    this.route('GET', '/config', req => {
      return this.getGlobalConfig(req);
    });
    this.route('PUT', '/config', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.updateGlobalConfig(req);
    });
  }
}

exports.GlobalConfigRouter = GlobalConfigRouter; // global_config.js

exports.default = GlobalConfigRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0dsb2JhbENvbmZpZ1JvdXRlci5qcyJdLCJuYW1lcyI6WyJtaWRkbGV3YXJlIiwiR2xvYmFsQ29uZmlnUm91dGVyIiwiUHJvbWlzZVJvdXRlciIsImdldEdsb2JhbENvbmZpZyIsInJlcSIsImNvbmZpZyIsImRhdGFiYXNlIiwiZmluZCIsIm9iamVjdElkIiwibGltaXQiLCJ0aGVuIiwicmVzdWx0cyIsImxlbmd0aCIsInJlc3BvbnNlIiwicGFyYW1zIiwiZ2xvYmFsQ29uZmlnIiwidXBkYXRlR2xvYmFsQ29uZmlnIiwiYXV0aCIsImlzUmVhZE9ubHkiLCJQYXJzZSIsIkVycm9yIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsImJvZHkiLCJ1cGRhdGUiLCJPYmplY3QiLCJrZXlzIiwicmVkdWNlIiwiYWNjIiwia2V5IiwidXBzZXJ0IiwicmVzdWx0IiwibW91bnRSb3V0ZXMiLCJyb3V0ZSIsInByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOztJQUFZQSxVOzs7Ozs7QUFFTCxNQUFNQyxrQkFBTixTQUFpQ0MsdUJBQWpDLENBQStDO0FBQ3BEQyxrQkFBZ0JDLEdBQWhCLEVBQXFCO0FBQ25CLFdBQU9BLElBQUlDLE1BQUosQ0FBV0MsUUFBWCxDQUFvQkMsSUFBcEIsQ0FBeUIsZUFBekIsRUFBMEMsRUFBRUMsVUFBVSxHQUFaLEVBQTFDLEVBQTZELEVBQUVDLE9BQU8sQ0FBVCxFQUE3RCxFQUEyRUMsSUFBM0UsQ0FBaUZDLE9BQUQsSUFBYTtBQUNsRyxVQUFJQSxRQUFRQyxNQUFSLElBQWtCLENBQXRCLEVBQXlCO0FBQ3ZCO0FBQ0EsZUFBTyxFQUFFQyxVQUFVLEVBQUVDLFFBQVEsRUFBVixFQUFaLEVBQVA7QUFDRDtBQUNELFlBQU1DLGVBQWVKLFFBQVEsQ0FBUixDQUFyQjtBQUNBLGFBQU8sRUFBRUUsVUFBVSxFQUFFQyxRQUFRQyxhQUFhRCxNQUF2QixFQUFaLEVBQVA7QUFDRCxLQVBNLENBQVA7QUFRRDs7QUFFREUscUJBQW1CWixHQUFuQixFQUF3QjtBQUN0QixRQUFJQSxJQUFJYSxJQUFKLENBQVNDLFVBQWIsRUFBeUI7QUFDdkIsWUFBTSxJQUFJQyxlQUFNQyxLQUFWLENBQWdCRCxlQUFNQyxLQUFOLENBQVlDLG1CQUE1QixFQUFpRCwwREFBakQsQ0FBTjtBQUNEO0FBQ0QsVUFBTVAsU0FBU1YsSUFBSWtCLElBQUosQ0FBU1IsTUFBeEI7QUFDQTtBQUNBLFVBQU1TLFNBQVNDLE9BQU9DLElBQVAsQ0FBWVgsTUFBWixFQUFvQlksTUFBcEIsQ0FBMkIsQ0FBQ0MsR0FBRCxFQUFNQyxHQUFOLEtBQWM7QUFDdERELFVBQUssVUFBU0MsR0FBSSxFQUFsQixJQUF1QmQsT0FBT2MsR0FBUCxDQUF2QjtBQUNBLGFBQU9ELEdBQVA7QUFDRCxLQUhjLEVBR1osRUFIWSxDQUFmO0FBSUEsV0FBT3ZCLElBQUlDLE1BQUosQ0FBV0MsUUFBWCxDQUFvQmlCLE1BQXBCLENBQTJCLGVBQTNCLEVBQTRDLEVBQUNmLFVBQVUsR0FBWCxFQUE1QyxFQUE2RGUsTUFBN0QsRUFBcUUsRUFBQ00sUUFBUSxJQUFULEVBQXJFLEVBQXFGbkIsSUFBckYsQ0FBMEYsT0FBTyxFQUFFRyxVQUFVLEVBQUVpQixRQUFRLElBQVYsRUFBWixFQUFQLENBQTFGLENBQVA7QUFDRDs7QUFFREMsZ0JBQWM7QUFDWixTQUFLQyxLQUFMLENBQVcsS0FBWCxFQUFrQixTQUFsQixFQUE2QjVCLE9BQU87QUFBRSxhQUFPLEtBQUtELGVBQUwsQ0FBcUJDLEdBQXJCLENBQVA7QUFBa0MsS0FBeEU7QUFDQSxTQUFLNEIsS0FBTCxDQUFXLEtBQVgsRUFBa0IsU0FBbEIsRUFBNkJoQyxXQUFXaUMsNkJBQXhDLEVBQXVFN0IsT0FBTztBQUFFLGFBQU8sS0FBS1ksa0JBQUwsQ0FBd0JaLEdBQXhCLENBQVA7QUFBcUMsS0FBckg7QUFDRDtBQTVCbUQ7O1FBQXpDSCxrQixHQUFBQSxrQixFQUxiOztrQkFvQ2VBLGtCIiwiZmlsZSI6Ikdsb2JhbENvbmZpZ1JvdXRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIGdsb2JhbF9jb25maWcuanNcbmltcG9ydCBQYXJzZSAgICAgICAgICAgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgUHJvbWlzZVJvdXRlciAgIGZyb20gJy4uL1Byb21pc2VSb3V0ZXInO1xuaW1wb3J0ICogYXMgbWlkZGxld2FyZSBmcm9tIFwiLi4vbWlkZGxld2FyZXNcIjtcblxuZXhwb3J0IGNsYXNzIEdsb2JhbENvbmZpZ1JvdXRlciBleHRlbmRzIFByb21pc2VSb3V0ZXIge1xuICBnZXRHbG9iYWxDb25maWcocmVxKSB7XG4gICAgcmV0dXJuIHJlcS5jb25maWcuZGF0YWJhc2UuZmluZCgnX0dsb2JhbENvbmZpZycsIHsgb2JqZWN0SWQ6IFwiMVwiIH0sIHsgbGltaXQ6IDEgfSkudGhlbigocmVzdWx0cykgPT4ge1xuICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoICE9IDEpIHtcbiAgICAgICAgLy8gSWYgdGhlcmUgaXMgbm8gY29uZmlnIGluIHRoZSBkYXRhYmFzZSAtIHJldHVybiBlbXB0eSBjb25maWcuXG4gICAgICAgIHJldHVybiB7IHJlc3BvbnNlOiB7IHBhcmFtczoge30gfSB9O1xuICAgICAgfVxuICAgICAgY29uc3QgZ2xvYmFsQ29uZmlnID0gcmVzdWx0c1swXTtcbiAgICAgIHJldHVybiB7IHJlc3BvbnNlOiB7IHBhcmFtczogZ2xvYmFsQ29uZmlnLnBhcmFtcyB9IH07XG4gICAgfSk7XG4gIH1cblxuICB1cGRhdGVHbG9iYWxDb25maWcocmVxKSB7XG4gICAgaWYgKHJlcS5hdXRoLmlzUmVhZE9ubHkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLCAncmVhZC1vbmx5IG1hc3RlcktleSBpc25cXCd0IGFsbG93ZWQgdG8gdXBkYXRlIHRoZSBjb25maWcuJyk7XG4gICAgfVxuICAgIGNvbnN0IHBhcmFtcyA9IHJlcS5ib2R5LnBhcmFtcztcbiAgICAvLyBUcmFuc2Zvcm0gaW4gZG90IG5vdGF0aW9uIHRvIG1ha2Ugc3VyZSBpdCB3b3Jrc1xuICAgIGNvbnN0IHVwZGF0ZSA9IE9iamVjdC5rZXlzKHBhcmFtcykucmVkdWNlKChhY2MsIGtleSkgPT4ge1xuICAgICAgYWNjW2BwYXJhbXMuJHtrZXl9YF0gPSBwYXJhbXNba2V5XTtcbiAgICAgIHJldHVybiBhY2M7XG4gICAgfSwge30pO1xuICAgIHJldHVybiByZXEuY29uZmlnLmRhdGFiYXNlLnVwZGF0ZSgnX0dsb2JhbENvbmZpZycsIHtvYmplY3RJZDogXCIxXCJ9LCB1cGRhdGUsIHt1cHNlcnQ6IHRydWV9KS50aGVuKCgpID0+ICh7IHJlc3BvbnNlOiB7IHJlc3VsdDogdHJ1ZSB9IH0pKTtcbiAgfVxuXG4gIG1vdW50Um91dGVzKCkge1xuICAgIHRoaXMucm91dGUoJ0dFVCcsICcvY29uZmlnJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuZ2V0R2xvYmFsQ29uZmlnKHJlcSkgfSk7XG4gICAgdGhpcy5yb3V0ZSgnUFVUJywgJy9jb25maWcnLCBtaWRkbGV3YXJlLnByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzLCByZXEgPT4geyByZXR1cm4gdGhpcy51cGRhdGVHbG9iYWxDb25maWcocmVxKSB9KTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBHbG9iYWxDb25maWdSb3V0ZXI7XG4iXX0=