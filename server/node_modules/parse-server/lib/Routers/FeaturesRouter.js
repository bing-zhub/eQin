'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FeaturesRouter = undefined;

var _package = require('../../package.json');

var _PromiseRouter = require('../PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _middlewares = require('../middlewares');

var middleware = _interopRequireWildcard(_middlewares);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class FeaturesRouter extends _PromiseRouter2.default {
  mountRoutes() {
    this.route('GET', '/serverInfo', middleware.promiseEnforceMasterKeyAccess, req => {
      const features = {
        globalConfig: {
          create: true,
          read: true,
          update: true,
          delete: true
        },
        hooks: {
          create: true,
          read: true,
          update: true,
          delete: true
        },
        cloudCode: {
          jobs: true
        },
        logs: {
          level: true,
          size: true,
          order: true,
          until: true,
          from: true
        },
        push: {
          immediatePush: req.config.hasPushSupport,
          scheduledPush: req.config.hasPushScheduledSupport,
          storedPushData: req.config.hasPushSupport,
          pushAudiences: true,
          localization: true
        },
        schemas: {
          addField: true,
          removeField: true,
          addClass: true,
          removeClass: true,
          clearAllDataFromClass: true,
          exportClass: false,
          editClassLevelPermissions: true,
          editPointerPermissions: true
        }
      };

      return { response: {
          features: features,
          parseServerVersion: _package.version
        } };
    });
  }
}
exports.FeaturesRouter = FeaturesRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0ZlYXR1cmVzUm91dGVyLmpzIl0sIm5hbWVzIjpbIm1pZGRsZXdhcmUiLCJGZWF0dXJlc1JvdXRlciIsIlByb21pc2VSb3V0ZXIiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwicHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MiLCJyZXEiLCJmZWF0dXJlcyIsImdsb2JhbENvbmZpZyIsImNyZWF0ZSIsInJlYWQiLCJ1cGRhdGUiLCJkZWxldGUiLCJob29rcyIsImNsb3VkQ29kZSIsImpvYnMiLCJsb2dzIiwibGV2ZWwiLCJzaXplIiwib3JkZXIiLCJ1bnRpbCIsImZyb20iLCJwdXNoIiwiaW1tZWRpYXRlUHVzaCIsImNvbmZpZyIsImhhc1B1c2hTdXBwb3J0Iiwic2NoZWR1bGVkUHVzaCIsImhhc1B1c2hTY2hlZHVsZWRTdXBwb3J0Iiwic3RvcmVkUHVzaERhdGEiLCJwdXNoQXVkaWVuY2VzIiwibG9jYWxpemF0aW9uIiwic2NoZW1hcyIsImFkZEZpZWxkIiwicmVtb3ZlRmllbGQiLCJhZGRDbGFzcyIsInJlbW92ZUNsYXNzIiwiY2xlYXJBbGxEYXRhRnJvbUNsYXNzIiwiZXhwb3J0Q2xhc3MiLCJlZGl0Q2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiZWRpdFBvaW50ZXJQZXJtaXNzaW9ucyIsInJlc3BvbnNlIiwicGFyc2VTZXJ2ZXJWZXJzaW9uIiwidmVyc2lvbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOzs7O0FBQ0E7O0lBQVlBLFU7Ozs7OztBQUVMLE1BQU1DLGNBQU4sU0FBNkJDLHVCQUE3QixDQUEyQztBQUNoREMsZ0JBQWM7QUFDWixTQUFLQyxLQUFMLENBQVcsS0FBWCxFQUFpQixhQUFqQixFQUFnQ0osV0FBV0ssNkJBQTNDLEVBQTBFQyxPQUFPO0FBQy9FLFlBQU1DLFdBQVc7QUFDZkMsc0JBQWM7QUFDWkMsa0JBQVEsSUFESTtBQUVaQyxnQkFBTSxJQUZNO0FBR1pDLGtCQUFRLElBSEk7QUFJWkMsa0JBQVE7QUFKSSxTQURDO0FBT2ZDLGVBQU87QUFDTEosa0JBQVEsSUFESDtBQUVMQyxnQkFBTSxJQUZEO0FBR0xDLGtCQUFRLElBSEg7QUFJTEMsa0JBQVE7QUFKSCxTQVBRO0FBYWZFLG1CQUFXO0FBQ1RDLGdCQUFNO0FBREcsU0FiSTtBQWdCZkMsY0FBTTtBQUNKQyxpQkFBTyxJQURIO0FBRUpDLGdCQUFNLElBRkY7QUFHSkMsaUJBQU8sSUFISDtBQUlKQyxpQkFBTyxJQUpIO0FBS0pDLGdCQUFNO0FBTEYsU0FoQlM7QUF1QmZDLGNBQU07QUFDSkMseUJBQWVqQixJQUFJa0IsTUFBSixDQUFXQyxjQUR0QjtBQUVKQyx5QkFBZXBCLElBQUlrQixNQUFKLENBQVdHLHVCQUZ0QjtBQUdKQywwQkFBZ0J0QixJQUFJa0IsTUFBSixDQUFXQyxjQUh2QjtBQUlKSSx5QkFBZSxJQUpYO0FBS0pDLHdCQUFjO0FBTFYsU0F2QlM7QUE4QmZDLGlCQUFTO0FBQ1BDLG9CQUFVLElBREg7QUFFUEMsdUJBQWEsSUFGTjtBQUdQQyxvQkFBVSxJQUhIO0FBSVBDLHVCQUFhLElBSk47QUFLUEMsaUNBQXVCLElBTGhCO0FBTVBDLHVCQUFhLEtBTk47QUFPUEMscUNBQTJCLElBUHBCO0FBUVBDLGtDQUF3QjtBQVJqQjtBQTlCTSxPQUFqQjs7QUEwQ0EsYUFBTyxFQUFFQyxVQUFVO0FBQ2pCakMsb0JBQVVBLFFBRE87QUFFakJrQyw4QkFBb0JDO0FBRkgsU0FBWixFQUFQO0FBSUQsS0EvQ0Q7QUFnREQ7QUFsRCtDO1FBQXJDekMsYyxHQUFBQSxjIiwiZmlsZSI6IkZlYXR1cmVzUm91dGVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgdmVyc2lvbiB9ICAgICBmcm9tICcuLi8uLi9wYWNrYWdlLmpzb24nO1xuaW1wb3J0IFByb21pc2VSb3V0ZXIgICBmcm9tICcuLi9Qcm9taXNlUm91dGVyJztcbmltcG9ydCAqIGFzIG1pZGRsZXdhcmUgZnJvbSBcIi4uL21pZGRsZXdhcmVzXCI7XG5cbmV4cG9ydCBjbGFzcyBGZWF0dXJlc1JvdXRlciBleHRlbmRzIFByb21pc2VSb3V0ZXIge1xuICBtb3VudFJvdXRlcygpIHtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCcvc2VydmVySW5mbycsIG1pZGRsZXdhcmUucHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MsIHJlcSA9PiB7XG4gICAgICBjb25zdCBmZWF0dXJlcyA9IHtcbiAgICAgICAgZ2xvYmFsQ29uZmlnOiB7XG4gICAgICAgICAgY3JlYXRlOiB0cnVlLFxuICAgICAgICAgIHJlYWQ6IHRydWUsXG4gICAgICAgICAgdXBkYXRlOiB0cnVlLFxuICAgICAgICAgIGRlbGV0ZTogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgaG9va3M6IHtcbiAgICAgICAgICBjcmVhdGU6IHRydWUsXG4gICAgICAgICAgcmVhZDogdHJ1ZSxcbiAgICAgICAgICB1cGRhdGU6IHRydWUsXG4gICAgICAgICAgZGVsZXRlOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBjbG91ZENvZGU6IHtcbiAgICAgICAgICBqb2JzOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBsb2dzOiB7XG4gICAgICAgICAgbGV2ZWw6IHRydWUsXG4gICAgICAgICAgc2l6ZTogdHJ1ZSxcbiAgICAgICAgICBvcmRlcjogdHJ1ZSxcbiAgICAgICAgICB1bnRpbDogdHJ1ZSxcbiAgICAgICAgICBmcm9tOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBwdXNoOiB7XG4gICAgICAgICAgaW1tZWRpYXRlUHVzaDogcmVxLmNvbmZpZy5oYXNQdXNoU3VwcG9ydCxcbiAgICAgICAgICBzY2hlZHVsZWRQdXNoOiByZXEuY29uZmlnLmhhc1B1c2hTY2hlZHVsZWRTdXBwb3J0LFxuICAgICAgICAgIHN0b3JlZFB1c2hEYXRhOiByZXEuY29uZmlnLmhhc1B1c2hTdXBwb3J0LFxuICAgICAgICAgIHB1c2hBdWRpZW5jZXM6IHRydWUsXG4gICAgICAgICAgbG9jYWxpemF0aW9uOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBzY2hlbWFzOiB7XG4gICAgICAgICAgYWRkRmllbGQ6IHRydWUsXG4gICAgICAgICAgcmVtb3ZlRmllbGQ6IHRydWUsXG4gICAgICAgICAgYWRkQ2xhc3M6IHRydWUsXG4gICAgICAgICAgcmVtb3ZlQ2xhc3M6IHRydWUsXG4gICAgICAgICAgY2xlYXJBbGxEYXRhRnJvbUNsYXNzOiB0cnVlLFxuICAgICAgICAgIGV4cG9ydENsYXNzOiBmYWxzZSxcbiAgICAgICAgICBlZGl0Q2xhc3NMZXZlbFBlcm1pc3Npb25zOiB0cnVlLFxuICAgICAgICAgIGVkaXRQb2ludGVyUGVybWlzc2lvbnM6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICByZXR1cm4geyByZXNwb25zZToge1xuICAgICAgICBmZWF0dXJlczogZmVhdHVyZXMsXG4gICAgICAgIHBhcnNlU2VydmVyVmVyc2lvbjogdmVyc2lvbixcbiAgICAgIH0gfTtcbiAgICB9KTtcbiAgfVxufVxuIl19