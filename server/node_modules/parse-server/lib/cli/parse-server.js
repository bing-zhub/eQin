'use strict';

var _index = require('../index');

var _index2 = _interopRequireDefault(_index);

var _parseServer = require('./definitions/parse-server');

var _parseServer2 = _interopRequireDefault(_parseServer);

var _cluster = require('cluster');

var _cluster2 = _interopRequireDefault(_cluster);

var _os = require('os');

var _os2 = _interopRequireDefault(_os);

var _runner = require('./utils/runner');

var _runner2 = _interopRequireDefault(_runner);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const help = function () {
  console.log('  Get Started guide:');
  console.log('');
  console.log('    Please have a look at the get started guide!');
  console.log('    http://docs.parseplatform.org/parse-server/guide/');
  console.log('');
  console.log('');
  console.log('  Usage with npm start');
  console.log('');
  console.log('    $ npm start -- path/to/config.json');
  console.log('    $ npm start -- --appId APP_ID --masterKey MASTER_KEY --serverURL serverURL');
  console.log('    $ npm start -- --appId APP_ID --masterKey MASTER_KEY --serverURL serverURL');
  console.log('');
  console.log('');
  console.log('  Usage:');
  console.log('');
  console.log('    $ parse-server path/to/config.json');
  console.log('    $ parse-server -- --appId APP_ID --masterKey MASTER_KEY --serverURL serverURL');
  console.log('    $ parse-server -- --appId APP_ID --masterKey MASTER_KEY --serverURL serverURL');
  console.log('');
}; /* eslint-disable no-console */


(0, _runner2.default)({
  definitions: _parseServer2.default,
  help,
  usage: '[options] <path/to/configuration.json>',
  start: function (program, options, logOptions) {
    if (!options.appId || !options.masterKey) {
      program.outputHelp();
      console.error("");
      console.error('\u001b[31mERROR: appId and masterKey are required\u001b[0m');
      console.error("");
      process.exit(1);
    }

    if (options["liveQuery.classNames"]) {
      options.liveQuery = options.liveQuery || {};
      options.liveQuery.classNames = options["liveQuery.classNames"];
      delete options["liveQuery.classNames"];
    }
    if (options["liveQuery.redisURL"]) {
      options.liveQuery = options.liveQuery || {};
      options.liveQuery.redisURL = options["liveQuery.redisURL"];
      delete options["liveQuery.redisURL"];
    }

    if (options.cluster) {
      const numCPUs = typeof options.cluster === 'number' ? options.cluster : _os2.default.cpus().length;
      if (_cluster2.default.isMaster) {
        logOptions();
        for (let i = 0; i < numCPUs; i++) {
          _cluster2.default.fork();
        }
        _cluster2.default.on('exit', (worker, code) => {
          console.log(`worker ${worker.process.pid} died (${code})... Restarting`);
          _cluster2.default.fork();
        });
      } else {
        _index2.default.start(options, () => {
          console.log('[' + process.pid + '] parse-server running on ' + options.serverURL);
        });
      }
    } else {
      _index2.default.start(options, () => {
        logOptions();
        console.log('');
        console.log('[' + process.pid + '] parse-server running on ' + options.serverURL);
      });
    }
  }
});

/* eslint-enable no-console */
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jbGkvcGFyc2Utc2VydmVyLmpzIl0sIm5hbWVzIjpbImhlbHAiLCJjb25zb2xlIiwibG9nIiwiZGVmaW5pdGlvbnMiLCJ1c2FnZSIsInN0YXJ0IiwicHJvZ3JhbSIsIm9wdGlvbnMiLCJsb2dPcHRpb25zIiwiYXBwSWQiLCJtYXN0ZXJLZXkiLCJvdXRwdXRIZWxwIiwiZXJyb3IiLCJwcm9jZXNzIiwiZXhpdCIsImxpdmVRdWVyeSIsImNsYXNzTmFtZXMiLCJyZWRpc1VSTCIsImNsdXN0ZXIiLCJudW1DUFVzIiwib3MiLCJjcHVzIiwibGVuZ3RoIiwiaXNNYXN0ZXIiLCJpIiwiZm9yayIsIm9uIiwid29ya2VyIiwiY29kZSIsInBpZCIsIlBhcnNlU2VydmVyIiwic2VydmVyVVJMIl0sIm1hcHBpbmdzIjoiOztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7Ozs7OztBQUVBLE1BQU1BLE9BQU8sWUFBVTtBQUNyQkMsVUFBUUMsR0FBUixDQUFZLHNCQUFaO0FBQ0FELFVBQVFDLEdBQVIsQ0FBWSxFQUFaO0FBQ0FELFVBQVFDLEdBQVIsQ0FBWSxrREFBWjtBQUNBRCxVQUFRQyxHQUFSLENBQVksdURBQVo7QUFDQUQsVUFBUUMsR0FBUixDQUFZLEVBQVo7QUFDQUQsVUFBUUMsR0FBUixDQUFZLEVBQVo7QUFDQUQsVUFBUUMsR0FBUixDQUFZLHdCQUFaO0FBQ0FELFVBQVFDLEdBQVIsQ0FBWSxFQUFaO0FBQ0FELFVBQVFDLEdBQVIsQ0FBWSx3Q0FBWjtBQUNBRCxVQUFRQyxHQUFSLENBQVksZ0ZBQVo7QUFDQUQsVUFBUUMsR0FBUixDQUFZLGdGQUFaO0FBQ0FELFVBQVFDLEdBQVIsQ0FBWSxFQUFaO0FBQ0FELFVBQVFDLEdBQVIsQ0FBWSxFQUFaO0FBQ0FELFVBQVFDLEdBQVIsQ0FBWSxVQUFaO0FBQ0FELFVBQVFDLEdBQVIsQ0FBWSxFQUFaO0FBQ0FELFVBQVFDLEdBQVIsQ0FBWSx3Q0FBWjtBQUNBRCxVQUFRQyxHQUFSLENBQVksbUZBQVo7QUFDQUQsVUFBUUMsR0FBUixDQUFZLG1GQUFaO0FBQ0FELFVBQVFDLEdBQVIsQ0FBWSxFQUFaO0FBQ0QsQ0FwQkQsQyxDQVBBOzs7QUE2QkEsc0JBQU87QUFDTEMsb0NBREs7QUFFTEgsTUFGSztBQUdMSSxTQUFPLHdDQUhGO0FBSUxDLFNBQU8sVUFBU0MsT0FBVCxFQUFrQkMsT0FBbEIsRUFBMkJDLFVBQTNCLEVBQXVDO0FBQzVDLFFBQUksQ0FBQ0QsUUFBUUUsS0FBVCxJQUFrQixDQUFDRixRQUFRRyxTQUEvQixFQUEwQztBQUN4Q0osY0FBUUssVUFBUjtBQUNBVixjQUFRVyxLQUFSLENBQWMsRUFBZDtBQUNBWCxjQUFRVyxLQUFSLENBQWMsNERBQWQ7QUFDQVgsY0FBUVcsS0FBUixDQUFjLEVBQWQ7QUFDQUMsY0FBUUMsSUFBUixDQUFhLENBQWI7QUFDRDs7QUFFRCxRQUFJUCxRQUFRLHNCQUFSLENBQUosRUFBcUM7QUFDbkNBLGNBQVFRLFNBQVIsR0FBb0JSLFFBQVFRLFNBQVIsSUFBcUIsRUFBekM7QUFDQVIsY0FBUVEsU0FBUixDQUFrQkMsVUFBbEIsR0FBK0JULFFBQVEsc0JBQVIsQ0FBL0I7QUFDQSxhQUFPQSxRQUFRLHNCQUFSLENBQVA7QUFDRDtBQUNELFFBQUlBLFFBQVEsb0JBQVIsQ0FBSixFQUFtQztBQUNqQ0EsY0FBUVEsU0FBUixHQUFvQlIsUUFBUVEsU0FBUixJQUFxQixFQUF6QztBQUNBUixjQUFRUSxTQUFSLENBQWtCRSxRQUFsQixHQUE2QlYsUUFBUSxvQkFBUixDQUE3QjtBQUNBLGFBQU9BLFFBQVEsb0JBQVIsQ0FBUDtBQUNEOztBQUVELFFBQUlBLFFBQVFXLE9BQVosRUFBcUI7QUFDbkIsWUFBTUMsVUFBVSxPQUFPWixRQUFRVyxPQUFmLEtBQTJCLFFBQTNCLEdBQXNDWCxRQUFRVyxPQUE5QyxHQUF3REUsYUFBR0MsSUFBSCxHQUFVQyxNQUFsRjtBQUNBLFVBQUlKLGtCQUFRSyxRQUFaLEVBQXNCO0FBQ3BCZjtBQUNBLGFBQUksSUFBSWdCLElBQUksQ0FBWixFQUFlQSxJQUFJTCxPQUFuQixFQUE0QkssR0FBNUIsRUFBaUM7QUFDL0JOLDRCQUFRTyxJQUFSO0FBQ0Q7QUFDRFAsMEJBQVFRLEVBQVIsQ0FBVyxNQUFYLEVBQW1CLENBQUNDLE1BQUQsRUFBU0MsSUFBVCxLQUFrQjtBQUNuQzNCLGtCQUFRQyxHQUFSLENBQWEsVUFBU3lCLE9BQU9kLE9BQVAsQ0FBZWdCLEdBQUksVUFBU0QsSUFBSyxpQkFBdkQ7QUFDQVYsNEJBQVFPLElBQVI7QUFDRCxTQUhEO0FBSUQsT0FURCxNQVNPO0FBQ0xLLHdCQUFZekIsS0FBWixDQUFrQkUsT0FBbEIsRUFBMkIsTUFBTTtBQUMvQk4sa0JBQVFDLEdBQVIsQ0FBWSxNQUFNVyxRQUFRZ0IsR0FBZCxHQUFvQiw0QkFBcEIsR0FBbUR0QixRQUFRd0IsU0FBdkU7QUFDRCxTQUZEO0FBR0Q7QUFDRixLQWhCRCxNQWdCTztBQUNMRCxzQkFBWXpCLEtBQVosQ0FBa0JFLE9BQWxCLEVBQTJCLE1BQU07QUFDL0JDO0FBQ0FQLGdCQUFRQyxHQUFSLENBQVksRUFBWjtBQUNBRCxnQkFBUUMsR0FBUixDQUFZLE1BQU1XLFFBQVFnQixHQUFkLEdBQW9CLDRCQUFwQixHQUFtRHRCLFFBQVF3QixTQUF2RTtBQUNELE9BSkQ7QUFLRDtBQUNGO0FBL0NJLENBQVA7O0FBa0RBIiwiZmlsZSI6InBhcnNlLXNlcnZlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8qIGVzbGludC1kaXNhYmxlIG5vLWNvbnNvbGUgKi9cbmltcG9ydCBQYXJzZVNlcnZlciBmcm9tICcuLi9pbmRleCc7XG5pbXBvcnQgZGVmaW5pdGlvbnMgZnJvbSAnLi9kZWZpbml0aW9ucy9wYXJzZS1zZXJ2ZXInO1xuaW1wb3J0IGNsdXN0ZXIgZnJvbSAnY2x1c3Rlcic7XG5pbXBvcnQgb3MgZnJvbSAnb3MnO1xuaW1wb3J0IHJ1bm5lciBmcm9tICcuL3V0aWxzL3J1bm5lcic7XG5cbmNvbnN0IGhlbHAgPSBmdW5jdGlvbigpe1xuICBjb25zb2xlLmxvZygnICBHZXQgU3RhcnRlZCBndWlkZTonKTtcbiAgY29uc29sZS5sb2coJycpO1xuICBjb25zb2xlLmxvZygnICAgIFBsZWFzZSBoYXZlIGEgbG9vayBhdCB0aGUgZ2V0IHN0YXJ0ZWQgZ3VpZGUhJyk7XG4gIGNvbnNvbGUubG9nKCcgICAgaHR0cDovL2RvY3MucGFyc2VwbGF0Zm9ybS5vcmcvcGFyc2Utc2VydmVyL2d1aWRlLycpO1xuICBjb25zb2xlLmxvZygnJyk7XG4gIGNvbnNvbGUubG9nKCcnKTtcbiAgY29uc29sZS5sb2coJyAgVXNhZ2Ugd2l0aCBucG0gc3RhcnQnKTtcbiAgY29uc29sZS5sb2coJycpO1xuICBjb25zb2xlLmxvZygnICAgICQgbnBtIHN0YXJ0IC0tIHBhdGgvdG8vY29uZmlnLmpzb24nKTtcbiAgY29uc29sZS5sb2coJyAgICAkIG5wbSBzdGFydCAtLSAtLWFwcElkIEFQUF9JRCAtLW1hc3RlcktleSBNQVNURVJfS0VZIC0tc2VydmVyVVJMIHNlcnZlclVSTCcpO1xuICBjb25zb2xlLmxvZygnICAgICQgbnBtIHN0YXJ0IC0tIC0tYXBwSWQgQVBQX0lEIC0tbWFzdGVyS2V5IE1BU1RFUl9LRVkgLS1zZXJ2ZXJVUkwgc2VydmVyVVJMJyk7XG4gIGNvbnNvbGUubG9nKCcnKTtcbiAgY29uc29sZS5sb2coJycpO1xuICBjb25zb2xlLmxvZygnICBVc2FnZTonKTtcbiAgY29uc29sZS5sb2coJycpO1xuICBjb25zb2xlLmxvZygnICAgICQgcGFyc2Utc2VydmVyIHBhdGgvdG8vY29uZmlnLmpzb24nKTtcbiAgY29uc29sZS5sb2coJyAgICAkIHBhcnNlLXNlcnZlciAtLSAtLWFwcElkIEFQUF9JRCAtLW1hc3RlcktleSBNQVNURVJfS0VZIC0tc2VydmVyVVJMIHNlcnZlclVSTCcpO1xuICBjb25zb2xlLmxvZygnICAgICQgcGFyc2Utc2VydmVyIC0tIC0tYXBwSWQgQVBQX0lEIC0tbWFzdGVyS2V5IE1BU1RFUl9LRVkgLS1zZXJ2ZXJVUkwgc2VydmVyVVJMJyk7XG4gIGNvbnNvbGUubG9nKCcnKTtcbn07XG5cbnJ1bm5lcih7XG4gIGRlZmluaXRpb25zLFxuICBoZWxwLFxuICB1c2FnZTogJ1tvcHRpb25zXSA8cGF0aC90by9jb25maWd1cmF0aW9uLmpzb24+JyxcbiAgc3RhcnQ6IGZ1bmN0aW9uKHByb2dyYW0sIG9wdGlvbnMsIGxvZ09wdGlvbnMpIHtcbiAgICBpZiAoIW9wdGlvbnMuYXBwSWQgfHwgIW9wdGlvbnMubWFzdGVyS2V5KSB7XG4gICAgICBwcm9ncmFtLm91dHB1dEhlbHAoKTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJcIik7XG4gICAgICBjb25zb2xlLmVycm9yKCdcXHUwMDFiWzMxbUVSUk9SOiBhcHBJZCBhbmQgbWFzdGVyS2V5IGFyZSByZXF1aXJlZFxcdTAwMWJbMG0nKTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJcIik7XG4gICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgfVxuXG4gICAgaWYgKG9wdGlvbnNbXCJsaXZlUXVlcnkuY2xhc3NOYW1lc1wiXSkge1xuICAgICAgb3B0aW9ucy5saXZlUXVlcnkgPSBvcHRpb25zLmxpdmVRdWVyeSB8fCB7fTtcbiAgICAgIG9wdGlvbnMubGl2ZVF1ZXJ5LmNsYXNzTmFtZXMgPSBvcHRpb25zW1wibGl2ZVF1ZXJ5LmNsYXNzTmFtZXNcIl07XG4gICAgICBkZWxldGUgb3B0aW9uc1tcImxpdmVRdWVyeS5jbGFzc05hbWVzXCJdO1xuICAgIH1cbiAgICBpZiAob3B0aW9uc1tcImxpdmVRdWVyeS5yZWRpc1VSTFwiXSkge1xuICAgICAgb3B0aW9ucy5saXZlUXVlcnkgPSBvcHRpb25zLmxpdmVRdWVyeSB8fCB7fTtcbiAgICAgIG9wdGlvbnMubGl2ZVF1ZXJ5LnJlZGlzVVJMID0gb3B0aW9uc1tcImxpdmVRdWVyeS5yZWRpc1VSTFwiXTtcbiAgICAgIGRlbGV0ZSBvcHRpb25zW1wibGl2ZVF1ZXJ5LnJlZGlzVVJMXCJdO1xuICAgIH1cblxuICAgIGlmIChvcHRpb25zLmNsdXN0ZXIpIHtcbiAgICAgIGNvbnN0IG51bUNQVXMgPSB0eXBlb2Ygb3B0aW9ucy5jbHVzdGVyID09PSAnbnVtYmVyJyA/IG9wdGlvbnMuY2x1c3RlciA6IG9zLmNwdXMoKS5sZW5ndGg7XG4gICAgICBpZiAoY2x1c3Rlci5pc01hc3Rlcikge1xuICAgICAgICBsb2dPcHRpb25zKCk7XG4gICAgICAgIGZvcihsZXQgaSA9IDA7IGkgPCBudW1DUFVzOyBpKyspIHtcbiAgICAgICAgICBjbHVzdGVyLmZvcmsoKTtcbiAgICAgICAgfVxuICAgICAgICBjbHVzdGVyLm9uKCdleGl0JywgKHdvcmtlciwgY29kZSkgPT4ge1xuICAgICAgICAgIGNvbnNvbGUubG9nKGB3b3JrZXIgJHt3b3JrZXIucHJvY2Vzcy5waWR9IGRpZWQgKCR7Y29kZX0pLi4uIFJlc3RhcnRpbmdgKTtcbiAgICAgICAgICBjbHVzdGVyLmZvcmsoKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBQYXJzZVNlcnZlci5zdGFydChvcHRpb25zLCAoKSA9PiB7XG4gICAgICAgICAgY29uc29sZS5sb2coJ1snICsgcHJvY2Vzcy5waWQgKyAnXSBwYXJzZS1zZXJ2ZXIgcnVubmluZyBvbiAnICsgb3B0aW9ucy5zZXJ2ZXJVUkwpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgUGFyc2VTZXJ2ZXIuc3RhcnQob3B0aW9ucywgKCkgPT4ge1xuICAgICAgICBsb2dPcHRpb25zKCk7XG4gICAgICAgIGNvbnNvbGUubG9nKCcnKTtcbiAgICAgICAgY29uc29sZS5sb2coJ1snICsgcHJvY2Vzcy5waWQgKyAnXSBwYXJzZS1zZXJ2ZXIgcnVubmluZyBvbiAnICsgb3B0aW9ucy5zZXJ2ZXJVUkwpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG59KTtcblxuLyogZXNsaW50LWVuYWJsZSBuby1jb25zb2xlICovXG4iXX0=