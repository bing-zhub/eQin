'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ParseServer = exports.PushWorker = exports.TestUtils = exports.LRUCacheAdapter = exports.RedisCacheAdapter = exports.NullCacheAdapter = exports.InMemoryCacheAdapter = exports.FileSystemAdapter = exports.GCSAdapter = exports.S3Adapter = undefined;

var _ParseServer2 = require('./ParseServer');

var _ParseServer3 = _interopRequireDefault(_ParseServer2);

var _s3FilesAdapter = require('@parse/s3-files-adapter');

var _s3FilesAdapter2 = _interopRequireDefault(_s3FilesAdapter);

var _fsFilesAdapter = require('@parse/fs-files-adapter');

var _fsFilesAdapter2 = _interopRequireDefault(_fsFilesAdapter);

var _InMemoryCacheAdapter = require('./Adapters/Cache/InMemoryCacheAdapter');

var _InMemoryCacheAdapter2 = _interopRequireDefault(_InMemoryCacheAdapter);

var _NullCacheAdapter = require('./Adapters/Cache/NullCacheAdapter');

var _NullCacheAdapter2 = _interopRequireDefault(_NullCacheAdapter);

var _RedisCacheAdapter = require('./Adapters/Cache/RedisCacheAdapter');

var _RedisCacheAdapter2 = _interopRequireDefault(_RedisCacheAdapter);

var _LRUCache = require('./Adapters/Cache/LRUCache.js');

var _LRUCache2 = _interopRequireDefault(_LRUCache);

var _TestUtils = require('./TestUtils');

var TestUtils = _interopRequireWildcard(_TestUtils);

var _deprecated = require('./deprecated');

var _logger = require('./logger');

var _PushWorker = require('./Push/PushWorker');

var _Options = require('./Options');

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// Factory function
const _ParseServer = function (options) {
  const server = new _ParseServer3.default(options);
  return server.app;
};
// Mount the create liveQueryServer
_ParseServer.createLiveQueryServer = _ParseServer3.default.createLiveQueryServer;
_ParseServer.start = _ParseServer3.default.start;

const GCSAdapter = (0, _deprecated.useExternal)('GCSAdapter', '@parse/gcs-files-adapter');

Object.defineProperty(module.exports, 'logger', {
  get: _logger.getLogger
});

exports.default = _ParseServer3.default;
exports.S3Adapter = _s3FilesAdapter2.default;
exports.GCSAdapter = GCSAdapter;
exports.FileSystemAdapter = _fsFilesAdapter2.default;
exports.InMemoryCacheAdapter = _InMemoryCacheAdapter2.default;
exports.NullCacheAdapter = _NullCacheAdapter2.default;
exports.RedisCacheAdapter = _RedisCacheAdapter2.default;
exports.LRUCacheAdapter = _LRUCache2.default;
exports.TestUtils = TestUtils;
exports.PushWorker = _PushWorker.PushWorker;
exports.ParseServer = _ParseServer;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9pbmRleC5qcyJdLCJuYW1lcyI6WyJUZXN0VXRpbHMiLCJfUGFyc2VTZXJ2ZXIiLCJvcHRpb25zIiwic2VydmVyIiwiUGFyc2VTZXJ2ZXIiLCJhcHAiLCJjcmVhdGVMaXZlUXVlcnlTZXJ2ZXIiLCJzdGFydCIsIkdDU0FkYXB0ZXIiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsIm1vZHVsZSIsImV4cG9ydHMiLCJnZXQiLCJnZXRMb2dnZXIiLCJTM0FkYXB0ZXIiLCJGaWxlU3lzdGVtQWRhcHRlciIsIkluTWVtb3J5Q2FjaGVBZGFwdGVyIiwiTnVsbENhY2hlQWRhcHRlciIsIlJlZGlzQ2FjaGVBZGFwdGVyIiwiTFJVQ2FjaGVBZGFwdGVyIiwiUHVzaFdvcmtlciJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7O0lBQVlBLFM7O0FBQ1o7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7OztBQUVBO0FBQ0EsTUFBTUMsZUFBZSxVQUFTQyxPQUFULEVBQXNDO0FBQ3pELFFBQU1DLFNBQVMsSUFBSUMscUJBQUosQ0FBZ0JGLE9BQWhCLENBQWY7QUFDQSxTQUFPQyxPQUFPRSxHQUFkO0FBQ0QsQ0FIRDtBQUlBO0FBQ0FKLGFBQWFLLHFCQUFiLEdBQXFDRixzQkFBWUUscUJBQWpEO0FBQ0FMLGFBQWFNLEtBQWIsR0FBcUJILHNCQUFZRyxLQUFqQzs7QUFFQSxNQUFNQyxhQUFhLDZCQUFZLFlBQVosRUFBMEIsMEJBQTFCLENBQW5COztBQUVBQyxPQUFPQyxjQUFQLENBQXNCQyxPQUFPQyxPQUE3QixFQUFzQyxRQUF0QyxFQUFnRDtBQUM5Q0MsT0FBS0M7QUFEeUMsQ0FBaEQ7O2tCQUllVixxQjtRQUViVyxTLEdBQUFBLHdCO1FBQ0FQLFUsR0FBQUEsVTtRQUNBUSxpQixHQUFBQSx3QjtRQUNBQyxvQixHQUFBQSw4QjtRQUNBQyxnQixHQUFBQSwwQjtRQUNBQyxpQixHQUFBQSwyQjtRQUNBQyxlLEdBQUFBLGtCO1FBQ0FwQixTLEdBQUFBLFM7UUFDQXFCLFUsR0FBQUEsc0I7UUFDZ0JqQixXLEdBQWhCSCxZIiwiZmlsZSI6ImluZGV4LmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IFBhcnNlU2VydmVyICAgICAgICAgIGZyb20gJy4vUGFyc2VTZXJ2ZXInO1xuaW1wb3J0IFMzQWRhcHRlciAgICAgICAgICAgIGZyb20gJ0BwYXJzZS9zMy1maWxlcy1hZGFwdGVyJ1xuaW1wb3J0IEZpbGVTeXN0ZW1BZGFwdGVyICAgIGZyb20gJ0BwYXJzZS9mcy1maWxlcy1hZGFwdGVyJ1xuaW1wb3J0IEluTWVtb3J5Q2FjaGVBZGFwdGVyIGZyb20gJy4vQWRhcHRlcnMvQ2FjaGUvSW5NZW1vcnlDYWNoZUFkYXB0ZXInXG5pbXBvcnQgTnVsbENhY2hlQWRhcHRlciAgICAgZnJvbSAnLi9BZGFwdGVycy9DYWNoZS9OdWxsQ2FjaGVBZGFwdGVyJ1xuaW1wb3J0IFJlZGlzQ2FjaGVBZGFwdGVyICAgIGZyb20gJy4vQWRhcHRlcnMvQ2FjaGUvUmVkaXNDYWNoZUFkYXB0ZXInXG5pbXBvcnQgTFJVQ2FjaGVBZGFwdGVyICAgICAgZnJvbSAnLi9BZGFwdGVycy9DYWNoZS9MUlVDYWNoZS5qcydcbmltcG9ydCAqIGFzIFRlc3RVdGlscyAgICAgICBmcm9tICcuL1Rlc3RVdGlscyc7XG5pbXBvcnQgeyB1c2VFeHRlcm5hbCB9ICAgICAgZnJvbSAnLi9kZXByZWNhdGVkJztcbmltcG9ydCB7IGdldExvZ2dlciB9ICAgICAgICBmcm9tICcuL2xvZ2dlcic7XG5pbXBvcnQgeyBQdXNoV29ya2VyIH0gICAgICAgZnJvbSAnLi9QdXNoL1B1c2hXb3JrZXInO1xuaW1wb3J0IHsgUGFyc2VTZXJ2ZXJPcHRpb25zIH0gICAgZnJvbSAnLi9PcHRpb25zJztcblxuLy8gRmFjdG9yeSBmdW5jdGlvblxuY29uc3QgX1BhcnNlU2VydmVyID0gZnVuY3Rpb24ob3B0aW9uczogUGFyc2VTZXJ2ZXJPcHRpb25zKSB7XG4gIGNvbnN0IHNlcnZlciA9IG5ldyBQYXJzZVNlcnZlcihvcHRpb25zKTtcbiAgcmV0dXJuIHNlcnZlci5hcHA7XG59XG4vLyBNb3VudCB0aGUgY3JlYXRlIGxpdmVRdWVyeVNlcnZlclxuX1BhcnNlU2VydmVyLmNyZWF0ZUxpdmVRdWVyeVNlcnZlciA9IFBhcnNlU2VydmVyLmNyZWF0ZUxpdmVRdWVyeVNlcnZlcjtcbl9QYXJzZVNlcnZlci5zdGFydCA9IFBhcnNlU2VydmVyLnN0YXJ0O1xuXG5jb25zdCBHQ1NBZGFwdGVyID0gdXNlRXh0ZXJuYWwoJ0dDU0FkYXB0ZXInLCAnQHBhcnNlL2djcy1maWxlcy1hZGFwdGVyJyk7XG5cbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShtb2R1bGUuZXhwb3J0cywgJ2xvZ2dlcicsIHtcbiAgZ2V0OiBnZXRMb2dnZXJcbn0pO1xuXG5leHBvcnQgZGVmYXVsdCBQYXJzZVNlcnZlcjtcbmV4cG9ydCB7XG4gIFMzQWRhcHRlcixcbiAgR0NTQWRhcHRlcixcbiAgRmlsZVN5c3RlbUFkYXB0ZXIsXG4gIEluTWVtb3J5Q2FjaGVBZGFwdGVyLFxuICBOdWxsQ2FjaGVBZGFwdGVyLFxuICBSZWRpc0NhY2hlQWRhcHRlcixcbiAgTFJVQ2FjaGVBZGFwdGVyLFxuICBUZXN0VXRpbHMsXG4gIFB1c2hXb3JrZXIsXG4gIF9QYXJzZVNlcnZlciBhcyBQYXJzZVNlcnZlclxufTtcbiJdfQ==