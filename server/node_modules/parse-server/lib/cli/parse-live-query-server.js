'use strict';

var _parseLiveQueryServer = require('./definitions/parse-live-query-server');

var _parseLiveQueryServer2 = _interopRequireDefault(_parseLiveQueryServer);

var _runner = require('./utils/runner');

var _runner2 = _interopRequireDefault(_runner);

var _index = require('../index');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

(0, _runner2.default)({
  definitions: _parseLiveQueryServer2.default,
  start: function (program, options, logOptions) {
    logOptions();
    _index.ParseServer.createLiveQueryServer(undefined, options);
  }
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jbGkvcGFyc2UtbGl2ZS1xdWVyeS1zZXJ2ZXIuanMiXSwibmFtZXMiOlsiZGVmaW5pdGlvbnMiLCJzdGFydCIsInByb2dyYW0iLCJvcHRpb25zIiwibG9nT3B0aW9ucyIsIlBhcnNlU2VydmVyIiwiY3JlYXRlTGl2ZVF1ZXJ5U2VydmVyIiwidW5kZWZpbmVkIl0sIm1hcHBpbmdzIjoiOztBQUFBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUVBLHNCQUFPO0FBQ0xBLDZDQURLO0FBRUxDLFNBQU8sVUFBU0MsT0FBVCxFQUFrQkMsT0FBbEIsRUFBMkJDLFVBQTNCLEVBQXVDO0FBQzVDQTtBQUNBQyx1QkFBWUMscUJBQVosQ0FBa0NDLFNBQWxDLEVBQTZDSixPQUE3QztBQUNEO0FBTEksQ0FBUCIsImZpbGUiOiJwYXJzZS1saXZlLXF1ZXJ5LXNlcnZlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBkZWZpbml0aW9ucyBmcm9tICcuL2RlZmluaXRpb25zL3BhcnNlLWxpdmUtcXVlcnktc2VydmVyJztcbmltcG9ydCBydW5uZXIgZnJvbSAnLi91dGlscy9ydW5uZXInO1xuaW1wb3J0IHsgUGFyc2VTZXJ2ZXIgfSBmcm9tICcuLi9pbmRleCc7XG5cbnJ1bm5lcih7XG4gIGRlZmluaXRpb25zLFxuICBzdGFydDogZnVuY3Rpb24ocHJvZ3JhbSwgb3B0aW9ucywgbG9nT3B0aW9ucykge1xuICAgIGxvZ09wdGlvbnMoKTtcbiAgICBQYXJzZVNlcnZlci5jcmVhdGVMaXZlUXVlcnlTZXJ2ZXIodW5kZWZpbmVkLCBvcHRpb25zKTtcbiAgfVxufSlcbiJdfQ==