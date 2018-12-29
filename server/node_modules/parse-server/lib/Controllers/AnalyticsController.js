'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AnalyticsController = undefined;

var _AdaptableController = require('./AdaptableController');

var _AdaptableController2 = _interopRequireDefault(_AdaptableController);

var _AnalyticsAdapter = require('../Adapters/Analytics/AnalyticsAdapter');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class AnalyticsController extends _AdaptableController2.default {
  appOpened(req) {
    return Promise.resolve().then(() => {
      return this.adapter.appOpened(req.body, req);
    }).then(response => {
      return { response: response || {} };
    }).catch(() => {
      return { response: {} };
    });
  }

  trackEvent(req) {
    return Promise.resolve().then(() => {
      return this.adapter.trackEvent(req.params.eventName, req.body, req);
    }).then(response => {
      return { response: response || {} };
    }).catch(() => {
      return { response: {} };
    });
  }

  expectedAdapterType() {
    return _AnalyticsAdapter.AnalyticsAdapter;
  }
}

exports.AnalyticsController = AnalyticsController;
exports.default = AnalyticsController;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9BbmFseXRpY3NDb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbIkFuYWx5dGljc0NvbnRyb2xsZXIiLCJBZGFwdGFibGVDb250cm9sbGVyIiwiYXBwT3BlbmVkIiwicmVxIiwiUHJvbWlzZSIsInJlc29sdmUiLCJ0aGVuIiwiYWRhcHRlciIsImJvZHkiLCJyZXNwb25zZSIsImNhdGNoIiwidHJhY2tFdmVudCIsInBhcmFtcyIsImV2ZW50TmFtZSIsImV4cGVjdGVkQWRhcHRlclR5cGUiLCJBbmFseXRpY3NBZGFwdGVyIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7Ozs7QUFDQTs7OztBQUVPLE1BQU1BLG1CQUFOLFNBQWtDQyw2QkFBbEMsQ0FBc0Q7QUFDM0RDLFlBQVVDLEdBQVYsRUFBZTtBQUNiLFdBQU9DLFFBQVFDLE9BQVIsR0FBa0JDLElBQWxCLENBQXVCLE1BQU07QUFDbEMsYUFBTyxLQUFLQyxPQUFMLENBQWFMLFNBQWIsQ0FBdUJDLElBQUlLLElBQTNCLEVBQWlDTCxHQUFqQyxDQUFQO0FBQ0QsS0FGTSxFQUVKRyxJQUZJLENBRUVHLFFBQUQsSUFBYztBQUNwQixhQUFPLEVBQUVBLFVBQVVBLFlBQVksRUFBeEIsRUFBUDtBQUNELEtBSk0sRUFJSkMsS0FKSSxDQUlFLE1BQU07QUFDYixhQUFPLEVBQUVELFVBQVUsRUFBWixFQUFQO0FBQ0QsS0FOTSxDQUFQO0FBT0Q7O0FBRURFLGFBQVdSLEdBQVgsRUFBZ0I7QUFDZCxXQUFPQyxRQUFRQyxPQUFSLEdBQWtCQyxJQUFsQixDQUF1QixNQUFNO0FBQ2xDLGFBQU8sS0FBS0MsT0FBTCxDQUFhSSxVQUFiLENBQXdCUixJQUFJUyxNQUFKLENBQVdDLFNBQW5DLEVBQThDVixJQUFJSyxJQUFsRCxFQUF3REwsR0FBeEQsQ0FBUDtBQUNELEtBRk0sRUFFSkcsSUFGSSxDQUVFRyxRQUFELElBQWM7QUFDcEIsYUFBTyxFQUFFQSxVQUFVQSxZQUFZLEVBQXhCLEVBQVA7QUFDRCxLQUpNLEVBSUpDLEtBSkksQ0FJRSxNQUFNO0FBQ2IsYUFBTyxFQUFFRCxVQUFVLEVBQVosRUFBUDtBQUNELEtBTk0sQ0FBUDtBQU9EOztBQUVESyx3QkFBc0I7QUFDcEIsV0FBT0Msa0NBQVA7QUFDRDtBQXZCMEQ7O1FBQWhEZixtQixHQUFBQSxtQjtrQkEwQkVBLG1CIiwiZmlsZSI6IkFuYWx5dGljc0NvbnRyb2xsZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgQWRhcHRhYmxlQ29udHJvbGxlciBmcm9tICcuL0FkYXB0YWJsZUNvbnRyb2xsZXInO1xuaW1wb3J0IHsgQW5hbHl0aWNzQWRhcHRlciB9IGZyb20gJy4uL0FkYXB0ZXJzL0FuYWx5dGljcy9BbmFseXRpY3NBZGFwdGVyJztcblxuZXhwb3J0IGNsYXNzIEFuYWx5dGljc0NvbnRyb2xsZXIgZXh0ZW5kcyBBZGFwdGFibGVDb250cm9sbGVyIHtcbiAgYXBwT3BlbmVkKHJlcSkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuYXBwT3BlbmVkKHJlcS5ib2R5LCByZXEpO1xuICAgIH0pLnRoZW4oKHJlc3BvbnNlKSA9PiB7XG4gICAgICByZXR1cm4geyByZXNwb25zZTogcmVzcG9uc2UgfHwge30gfTtcbiAgICB9KS5jYXRjaCgoKSA9PiB7XG4gICAgICByZXR1cm4geyByZXNwb25zZToge30gfTtcbiAgICB9KTtcbiAgfVxuXG4gIHRyYWNrRXZlbnQocmVxKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci50cmFja0V2ZW50KHJlcS5wYXJhbXMuZXZlbnROYW1lLCByZXEuYm9keSwgcmVxKTtcbiAgICB9KS50aGVuKChyZXNwb25zZSkgPT4ge1xuICAgICAgcmV0dXJuIHsgcmVzcG9uc2U6IHJlc3BvbnNlIHx8IHt9IH07XG4gICAgfSkuY2F0Y2goKCkgPT4ge1xuICAgICAgcmV0dXJuIHsgcmVzcG9uc2U6IHt9IH07XG4gICAgfSk7XG4gIH1cblxuICBleHBlY3RlZEFkYXB0ZXJUeXBlKCkge1xuICAgIHJldHVybiBBbmFseXRpY3NBZGFwdGVyO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IEFuYWx5dGljc0NvbnRyb2xsZXI7XG4iXX0=