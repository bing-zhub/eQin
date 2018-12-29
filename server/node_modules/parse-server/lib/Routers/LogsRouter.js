'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.LogsRouter = undefined;

var _node = require('parse/node');

var _PromiseRouter = require('../PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _middlewares = require('../middlewares');

var middleware = _interopRequireWildcard(_middlewares);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class LogsRouter extends _PromiseRouter2.default {

  mountRoutes() {
    this.route('GET', '/scriptlog', middleware.promiseEnforceMasterKeyAccess, this.validateRequest, req => {
      return this.handleGET(req);
    });
  }

  validateRequest(req) {
    if (!req.config || !req.config.loggerController) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Logger adapter is not available');
    }
  }

  // Returns a promise for a {response} object.
  // query params:
  // level (optional) Level of logging you want to query for (info || error)
  // from (optional) Start time for the search. Defaults to 1 week ago.
  // until (optional) End time for the search. Defaults to current time.
  // order (optional) Direction of results returned, either “asc” or “desc”. Defaults to “desc”.
  // size (optional) Number of rows returned by search. Defaults to 10
  // n same as size, overrides size if set
  handleGET(req) {
    const from = req.query.from;
    const until = req.query.until;
    let size = req.query.size;
    if (req.query.n) {
      size = req.query.n;
    }

    const order = req.query.order;
    const level = req.query.level;
    const options = {
      from,
      until,
      size,
      order,
      level
    };

    return req.config.loggerController.getLogs(options).then(result => {
      return Promise.resolve({
        response: result
      });
    });
  }
}

exports.LogsRouter = LogsRouter;
exports.default = LogsRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0xvZ3NSb3V0ZXIuanMiXSwibmFtZXMiOlsibWlkZGxld2FyZSIsIkxvZ3NSb3V0ZXIiLCJQcm9taXNlUm91dGVyIiwibW91bnRSb3V0ZXMiLCJyb3V0ZSIsInByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzIiwidmFsaWRhdGVSZXF1ZXN0IiwicmVxIiwiaGFuZGxlR0VUIiwiY29uZmlnIiwibG9nZ2VyQ29udHJvbGxlciIsIlBhcnNlIiwiRXJyb3IiLCJQVVNIX01JU0NPTkZJR1VSRUQiLCJmcm9tIiwicXVlcnkiLCJ1bnRpbCIsInNpemUiLCJuIiwib3JkZXIiLCJsZXZlbCIsIm9wdGlvbnMiLCJnZXRMb2dzIiwidGhlbiIsInJlc3VsdCIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVzcG9uc2UiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7QUFDQTs7OztBQUNBOztJQUFZQSxVOzs7Ozs7QUFFTCxNQUFNQyxVQUFOLFNBQXlCQyx1QkFBekIsQ0FBdUM7O0FBRTVDQyxnQkFBYztBQUNaLFNBQUtDLEtBQUwsQ0FBVyxLQUFYLEVBQWlCLFlBQWpCLEVBQStCSixXQUFXSyw2QkFBMUMsRUFBeUUsS0FBS0MsZUFBOUUsRUFBaUdDLEdBQUQsSUFBUztBQUN2RyxhQUFPLEtBQUtDLFNBQUwsQ0FBZUQsR0FBZixDQUFQO0FBQ0QsS0FGRDtBQUdEOztBQUVERCxrQkFBZ0JDLEdBQWhCLEVBQXFCO0FBQ25CLFFBQUksQ0FBQ0EsSUFBSUUsTUFBTCxJQUFlLENBQUNGLElBQUlFLE1BQUosQ0FBV0MsZ0JBQS9CLEVBQWlEO0FBQy9DLFlBQU0sSUFBSUMsWUFBTUMsS0FBVixDQUFnQkQsWUFBTUMsS0FBTixDQUFZQyxrQkFBNUIsRUFDSixpQ0FESSxDQUFOO0FBRUQ7QUFDRjs7QUFFRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0FMLFlBQVVELEdBQVYsRUFBZTtBQUNiLFVBQU1PLE9BQU9QLElBQUlRLEtBQUosQ0FBVUQsSUFBdkI7QUFDQSxVQUFNRSxRQUFRVCxJQUFJUSxLQUFKLENBQVVDLEtBQXhCO0FBQ0EsUUFBSUMsT0FBT1YsSUFBSVEsS0FBSixDQUFVRSxJQUFyQjtBQUNBLFFBQUlWLElBQUlRLEtBQUosQ0FBVUcsQ0FBZCxFQUFpQjtBQUNmRCxhQUFPVixJQUFJUSxLQUFKLENBQVVHLENBQWpCO0FBQ0Q7O0FBRUQsVUFBTUMsUUFBUVosSUFBSVEsS0FBSixDQUFVSSxLQUF4QjtBQUNBLFVBQU1DLFFBQVFiLElBQUlRLEtBQUosQ0FBVUssS0FBeEI7QUFDQSxVQUFNQyxVQUFVO0FBQ2RQLFVBRGM7QUFFZEUsV0FGYztBQUdkQyxVQUhjO0FBSWRFLFdBSmM7QUFLZEM7QUFMYyxLQUFoQjs7QUFRQSxXQUFPYixJQUFJRSxNQUFKLENBQVdDLGdCQUFYLENBQTRCWSxPQUE1QixDQUFvQ0QsT0FBcEMsRUFBNkNFLElBQTdDLENBQW1EQyxNQUFELElBQVk7QUFDbkUsYUFBT0MsUUFBUUMsT0FBUixDQUFnQjtBQUNyQkMsa0JBQVVIO0FBRFcsT0FBaEIsQ0FBUDtBQUdELEtBSk0sQ0FBUDtBQUtEO0FBOUMyQzs7UUFBakN2QixVLEdBQUFBLFU7a0JBaURFQSxVIiwiZmlsZSI6IkxvZ3NSb3V0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBQYXJzZSB9IGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IFByb21pc2VSb3V0ZXIgZnJvbSAnLi4vUHJvbWlzZVJvdXRlcic7XG5pbXBvcnQgKiBhcyBtaWRkbGV3YXJlIGZyb20gXCIuLi9taWRkbGV3YXJlc1wiO1xuXG5leHBvcnQgY2xhc3MgTG9nc1JvdXRlciBleHRlbmRzIFByb21pc2VSb3V0ZXIge1xuXG4gIG1vdW50Um91dGVzKCkge1xuICAgIHRoaXMucm91dGUoJ0dFVCcsJy9zY3JpcHRsb2cnLCBtaWRkbGV3YXJlLnByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzLCB0aGlzLnZhbGlkYXRlUmVxdWVzdCwgIChyZXEpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZUdFVChyZXEpO1xuICAgIH0pO1xuICB9XG5cbiAgdmFsaWRhdGVSZXF1ZXN0KHJlcSkge1xuICAgIGlmICghcmVxLmNvbmZpZyB8fCAhcmVxLmNvbmZpZy5sb2dnZXJDb250cm9sbGVyKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICAnTG9nZ2VyIGFkYXB0ZXIgaXMgbm90IGF2YWlsYWJsZScpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhIHtyZXNwb25zZX0gb2JqZWN0LlxuICAvLyBxdWVyeSBwYXJhbXM6XG4gIC8vIGxldmVsIChvcHRpb25hbCkgTGV2ZWwgb2YgbG9nZ2luZyB5b3Ugd2FudCB0byBxdWVyeSBmb3IgKGluZm8gfHwgZXJyb3IpXG4gIC8vIGZyb20gKG9wdGlvbmFsKSBTdGFydCB0aW1lIGZvciB0aGUgc2VhcmNoLiBEZWZhdWx0cyB0byAxIHdlZWsgYWdvLlxuICAvLyB1bnRpbCAob3B0aW9uYWwpIEVuZCB0aW1lIGZvciB0aGUgc2VhcmNoLiBEZWZhdWx0cyB0byBjdXJyZW50IHRpbWUuXG4gIC8vIG9yZGVyIChvcHRpb25hbCkgRGlyZWN0aW9uIG9mIHJlc3VsdHMgcmV0dXJuZWQsIGVpdGhlciDigJxhc2PigJ0gb3Ig4oCcZGVzY+KAnS4gRGVmYXVsdHMgdG8g4oCcZGVzY+KAnS5cbiAgLy8gc2l6ZSAob3B0aW9uYWwpIE51bWJlciBvZiByb3dzIHJldHVybmVkIGJ5IHNlYXJjaC4gRGVmYXVsdHMgdG8gMTBcbiAgLy8gbiBzYW1lIGFzIHNpemUsIG92ZXJyaWRlcyBzaXplIGlmIHNldFxuICBoYW5kbGVHRVQocmVxKSB7XG4gICAgY29uc3QgZnJvbSA9IHJlcS5xdWVyeS5mcm9tO1xuICAgIGNvbnN0IHVudGlsID0gcmVxLnF1ZXJ5LnVudGlsO1xuICAgIGxldCBzaXplID0gcmVxLnF1ZXJ5LnNpemU7XG4gICAgaWYgKHJlcS5xdWVyeS5uKSB7XG4gICAgICBzaXplID0gcmVxLnF1ZXJ5Lm47XG4gICAgfVxuXG4gICAgY29uc3Qgb3JkZXIgPSByZXEucXVlcnkub3JkZXJcbiAgICBjb25zdCBsZXZlbCA9IHJlcS5xdWVyeS5sZXZlbDtcbiAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgZnJvbSxcbiAgICAgIHVudGlsLFxuICAgICAgc2l6ZSxcbiAgICAgIG9yZGVyLFxuICAgICAgbGV2ZWxcbiAgICB9O1xuXG4gICAgcmV0dXJuIHJlcS5jb25maWcubG9nZ2VyQ29udHJvbGxlci5nZXRMb2dzKG9wdGlvbnMpLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICAgIHJlc3BvbnNlOiByZXN1bHRcbiAgICAgIH0pO1xuICAgIH0pXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgTG9nc1JvdXRlcjtcbiJdfQ==