'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ParseWebSocket = exports.ParseWebSocketServer = undefined;

var _logger = require('../logger');

var _logger2 = _interopRequireDefault(_logger);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const typeMap = new Map([['disconnect', 'close']]);
const getWS = function () {
  try {
    return require('uws');
  } catch (e) {
    return require('ws');
  }
};

class ParseWebSocketServer {

  constructor(server, onConnect, websocketTimeout = 10 * 1000) {
    const WebSocketServer = getWS().Server;
    const wss = new WebSocketServer({ server: server });
    wss.on('listening', () => {
      _logger2.default.info('Parse LiveQuery Server starts running');
    });
    wss.on('connection', ws => {
      onConnect(new ParseWebSocket(ws));
      // Send ping to client periodically
      const pingIntervalId = setInterval(() => {
        if (ws.readyState == ws.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingIntervalId);
        }
      }, websocketTimeout);
    });
    this.server = wss;
  }
}

exports.ParseWebSocketServer = ParseWebSocketServer;
class ParseWebSocket {

  constructor(ws) {
    this.ws = ws;
  }

  on(type, callback) {
    const wsType = typeMap.has(type) ? typeMap.get(type) : type;
    this.ws.on(wsType, callback);
  }

  send(message) {
    this.ws.send(message);
  }
}
exports.ParseWebSocket = ParseWebSocket;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9MaXZlUXVlcnkvUGFyc2VXZWJTb2NrZXRTZXJ2ZXIuanMiXSwibmFtZXMiOlsidHlwZU1hcCIsIk1hcCIsImdldFdTIiwicmVxdWlyZSIsImUiLCJQYXJzZVdlYlNvY2tldFNlcnZlciIsImNvbnN0cnVjdG9yIiwic2VydmVyIiwib25Db25uZWN0Iiwid2Vic29ja2V0VGltZW91dCIsIldlYlNvY2tldFNlcnZlciIsIlNlcnZlciIsIndzcyIsIm9uIiwibG9nZ2VyIiwiaW5mbyIsIndzIiwiUGFyc2VXZWJTb2NrZXQiLCJwaW5nSW50ZXJ2YWxJZCIsInNldEludGVydmFsIiwicmVhZHlTdGF0ZSIsIk9QRU4iLCJwaW5nIiwiY2xlYXJJbnRlcnZhbCIsInR5cGUiLCJjYWxsYmFjayIsIndzVHlwZSIsImhhcyIsImdldCIsInNlbmQiLCJtZXNzYWdlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7Ozs7OztBQUVBLE1BQU1BLFVBQVUsSUFBSUMsR0FBSixDQUFRLENBQUMsQ0FBQyxZQUFELEVBQWUsT0FBZixDQUFELENBQVIsQ0FBaEI7QUFDQSxNQUFNQyxRQUFRLFlBQVc7QUFDdkIsTUFBSTtBQUNGLFdBQU9DLFFBQVEsS0FBUixDQUFQO0FBQ0QsR0FGRCxDQUVFLE9BQU1DLENBQU4sRUFBUztBQUNULFdBQU9ELFFBQVEsSUFBUixDQUFQO0FBQ0Q7QUFDRixDQU5EOztBQVFPLE1BQU1FLG9CQUFOLENBQTJCOztBQUdoQ0MsY0FBWUMsTUFBWixFQUF5QkMsU0FBekIsRUFBOENDLG1CQUEyQixLQUFLLElBQTlFLEVBQW9GO0FBQ2xGLFVBQU1DLGtCQUFrQlIsUUFBUVMsTUFBaEM7QUFDQSxVQUFNQyxNQUFNLElBQUlGLGVBQUosQ0FBb0IsRUFBRUgsUUFBUUEsTUFBVixFQUFwQixDQUFaO0FBQ0FLLFFBQUlDLEVBQUosQ0FBTyxXQUFQLEVBQW9CLE1BQU07QUFDeEJDLHVCQUFPQyxJQUFQLENBQVksdUNBQVo7QUFDRCxLQUZEO0FBR0FILFFBQUlDLEVBQUosQ0FBTyxZQUFQLEVBQXNCRyxFQUFELElBQVE7QUFDM0JSLGdCQUFVLElBQUlTLGNBQUosQ0FBbUJELEVBQW5CLENBQVY7QUFDQTtBQUNBLFlBQU1FLGlCQUFpQkMsWUFBWSxNQUFNO0FBQ3ZDLFlBQUlILEdBQUdJLFVBQUgsSUFBaUJKLEdBQUdLLElBQXhCLEVBQThCO0FBQzVCTCxhQUFHTSxJQUFIO0FBQ0QsU0FGRCxNQUVPO0FBQ0xDLHdCQUFjTCxjQUFkO0FBQ0Q7QUFDRixPQU5zQixFQU1wQlQsZ0JBTm9CLENBQXZCO0FBT0QsS0FWRDtBQVdBLFNBQUtGLE1BQUwsR0FBY0ssR0FBZDtBQUNEO0FBckIrQjs7UUFBckJQLG9CLEdBQUFBLG9CO0FBd0JOLE1BQU1ZLGNBQU4sQ0FBcUI7O0FBRzFCWCxjQUFZVSxFQUFaLEVBQXFCO0FBQ25CLFNBQUtBLEVBQUwsR0FBVUEsRUFBVjtBQUNEOztBQUVESCxLQUFHVyxJQUFILEVBQWlCQyxRQUFqQixFQUFpQztBQUMvQixVQUFNQyxTQUFTMUIsUUFBUTJCLEdBQVIsQ0FBWUgsSUFBWixJQUFvQnhCLFFBQVE0QixHQUFSLENBQVlKLElBQVosQ0FBcEIsR0FBd0NBLElBQXZEO0FBQ0EsU0FBS1IsRUFBTCxDQUFRSCxFQUFSLENBQVdhLE1BQVgsRUFBbUJELFFBQW5CO0FBQ0Q7O0FBRURJLE9BQUtDLE9BQUwsRUFBeUI7QUFDdkIsU0FBS2QsRUFBTCxDQUFRYSxJQUFSLENBQWFDLE9BQWI7QUFDRDtBQWR5QjtRQUFmYixjLEdBQUFBLGMiLCJmaWxlIjoiUGFyc2VXZWJTb2NrZXRTZXJ2ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbG9nZ2VyIGZyb20gJy4uL2xvZ2dlcic7XG5cbmNvbnN0IHR5cGVNYXAgPSBuZXcgTWFwKFtbJ2Rpc2Nvbm5lY3QnLCAnY2xvc2UnXV0pO1xuY29uc3QgZ2V0V1MgPSBmdW5jdGlvbigpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gcmVxdWlyZSgndXdzJyk7XG4gIH0gY2F0Y2goZSkge1xuICAgIHJldHVybiByZXF1aXJlKCd3cycpO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBQYXJzZVdlYlNvY2tldFNlcnZlciB7XG4gIHNlcnZlcjogT2JqZWN0O1xuXG4gIGNvbnN0cnVjdG9yKHNlcnZlcjogYW55LCBvbkNvbm5lY3Q6IEZ1bmN0aW9uLCB3ZWJzb2NrZXRUaW1lb3V0OiBudW1iZXIgPSAxMCAqIDEwMDApIHtcbiAgICBjb25zdCBXZWJTb2NrZXRTZXJ2ZXIgPSBnZXRXUygpLlNlcnZlcjtcbiAgICBjb25zdCB3c3MgPSBuZXcgV2ViU29ja2V0U2VydmVyKHsgc2VydmVyOiBzZXJ2ZXIgfSk7XG4gICAgd3NzLm9uKCdsaXN0ZW5pbmcnLCAoKSA9PiB7XG4gICAgICBsb2dnZXIuaW5mbygnUGFyc2UgTGl2ZVF1ZXJ5IFNlcnZlciBzdGFydHMgcnVubmluZycpO1xuICAgIH0pO1xuICAgIHdzcy5vbignY29ubmVjdGlvbicsICh3cykgPT4ge1xuICAgICAgb25Db25uZWN0KG5ldyBQYXJzZVdlYlNvY2tldCh3cykpO1xuICAgICAgLy8gU2VuZCBwaW5nIHRvIGNsaWVudCBwZXJpb2RpY2FsbHlcbiAgICAgIGNvbnN0IHBpbmdJbnRlcnZhbElkID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICBpZiAod3MucmVhZHlTdGF0ZSA9PSB3cy5PUEVOKSB7XG4gICAgICAgICAgd3MucGluZygpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNsZWFySW50ZXJ2YWwocGluZ0ludGVydmFsSWQpO1xuICAgICAgICB9XG4gICAgICB9LCB3ZWJzb2NrZXRUaW1lb3V0KTtcbiAgICB9KTtcbiAgICB0aGlzLnNlcnZlciA9IHdzcztcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgUGFyc2VXZWJTb2NrZXQge1xuICB3czogYW55O1xuXG4gIGNvbnN0cnVjdG9yKHdzOiBhbnkpIHtcbiAgICB0aGlzLndzID0gd3M7XG4gIH1cblxuICBvbih0eXBlOiBzdHJpbmcsIGNhbGxiYWNrKTogdm9pZCB7XG4gICAgY29uc3Qgd3NUeXBlID0gdHlwZU1hcC5oYXModHlwZSkgPyB0eXBlTWFwLmdldCh0eXBlKSA6IHR5cGU7XG4gICAgdGhpcy53cy5vbih3c1R5cGUsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIHNlbmQobWVzc2FnZTogYW55KTogdm9pZCB7XG4gICAgdGhpcy53cy5zZW5kKG1lc3NhZ2UpO1xuICB9XG59XG4iXX0=