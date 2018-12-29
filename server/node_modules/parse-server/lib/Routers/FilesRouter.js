'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FilesRouter = undefined;

var _express = require('express');

var _express2 = _interopRequireDefault(_express);

var _bodyParser = require('body-parser');

var _bodyParser2 = _interopRequireDefault(_bodyParser);

var _middlewares = require('../middlewares');

var Middlewares = _interopRequireWildcard(_middlewares);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _Config = require('../Config');

var _Config2 = _interopRequireDefault(_Config);

var _mime = require('mime');

var _mime2 = _interopRequireDefault(_mime);

var _logger = require('../logger');

var _logger2 = _interopRequireDefault(_logger);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class FilesRouter {

  expressRouter({ maxUploadSize = '20Mb' } = {}) {
    var router = _express2.default.Router();
    router.get('/files/:appId/:filename', this.getHandler);

    router.post('/files', function (req, res, next) {
      next(new _node2.default.Error(_node2.default.Error.INVALID_FILE_NAME, 'Filename not provided.'));
    });

    router.post('/files/:filename', Middlewares.allowCrossDomain, _bodyParser2.default.raw({ type: () => {
        return true;
      }, limit: maxUploadSize }), // Allow uploads without Content-Type, or with any Content-Type.
    Middlewares.handleParseHeaders, this.createHandler);

    router.delete('/files/:filename', Middlewares.allowCrossDomain, Middlewares.handleParseHeaders, Middlewares.enforceMasterKeyAccess, this.deleteHandler);
    return router;
  }

  getHandler(req, res) {
    const config = _Config2.default.get(req.params.appId);
    const filesController = config.filesController;
    const filename = req.params.filename;
    const contentType = _mime2.default.getType(filename);
    if (isFileStreamable(req, filesController)) {
      filesController.getFileStream(config, filename).then(stream => {
        handleFileStream(stream, req, res, contentType);
      }).catch(() => {
        res.status(404);
        res.set('Content-Type', 'text/plain');
        res.end('File not found.');
      });
    } else {
      filesController.getFileData(config, filename).then(data => {
        res.status(200);
        res.set('Content-Type', contentType);
        res.set('Content-Length', data.length);
        res.end(data);
      }).catch(() => {
        res.status(404);
        res.set('Content-Type', 'text/plain');
        res.end('File not found.');
      });
    }
  }

  createHandler(req, res, next) {
    if (!req.body || !req.body.length) {
      next(new _node2.default.Error(_node2.default.Error.FILE_SAVE_ERROR, 'Invalid file upload.'));
      return;
    }

    if (req.params.filename.length > 128) {
      next(new _node2.default.Error(_node2.default.Error.INVALID_FILE_NAME, 'Filename too long.'));
      return;
    }

    if (!req.params.filename.match(/^[_a-zA-Z0-9][a-zA-Z0-9@\.\ ~_-]*$/)) {
      next(new _node2.default.Error(_node2.default.Error.INVALID_FILE_NAME, 'Filename contains invalid characters.'));
      return;
    }

    const filename = req.params.filename;
    const contentType = req.get('Content-type');
    const config = req.config;
    const filesController = config.filesController;

    filesController.createFile(config, filename, req.body, contentType).then(result => {
      res.status(201);
      res.set('Location', result.url);
      res.json(result);
    }).catch(e => {
      _logger2.default.error(e.message, e);
      next(new _node2.default.Error(_node2.default.Error.FILE_SAVE_ERROR, 'Could not store file.'));
    });
  }

  deleteHandler(req, res, next) {
    const filesController = req.config.filesController;
    filesController.deleteFile(req.config, req.params.filename).then(() => {
      res.status(200);
      // TODO: return useful JSON here?
      res.end();
    }).catch(() => {
      next(new _node2.default.Error(_node2.default.Error.FILE_DELETE_ERROR, 'Could not delete file.'));
    });
  }
}

exports.FilesRouter = FilesRouter;
function isFileStreamable(req, filesController) {
  return req.get('Range') && typeof filesController.adapter.getFileStream === 'function';
}

function getRange(req) {
  const parts = req.get('Range').replace(/bytes=/, "").split("-");
  return { start: parseInt(parts[0], 10), end: parseInt(parts[1], 10) };
}

// handleFileStream is licenced under Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/).
// Author: LEROIB at weightingformypizza (https://weightingformypizza.wordpress.com/2015/06/24/stream-html5-media-content-like-video-audio-from-mongodb-using-express-and-gridstore/).
function handleFileStream(stream, req, res, contentType) {
  const buffer_size = 1024 * 1024; //1024Kb
  // Range request, partiall stream the file
  let {
    start, end
  } = getRange(req);

  const notEnded = !end && end !== 0;
  const notStarted = !start && start !== 0;
  // No end provided, we want all bytes
  if (notEnded) {
    end = stream.length - 1;
  }
  // No start provided, we're reading backwards
  if (notStarted) {
    start = stream.length - end;
    end = start + end - 1;
  }

  // Data exceeds the buffer_size, cap
  if (end - start >= buffer_size) {
    end = start + buffer_size - 1;
  }

  const contentLength = end - start + 1;

  res.writeHead(206, {
    'Content-Range': 'bytes ' + start + '-' + end + '/' + stream.length,
    'Accept-Ranges': 'bytes',
    'Content-Length': contentLength,
    'Content-Type': contentType
  });

  stream.seek(start, function () {
    // get gridFile stream
    const gridFileStream = stream.stream(true);
    let bufferAvail = 0;
    let remainingBytesToWrite = contentLength;
    let totalBytesWritten = 0;
    // write to response
    gridFileStream.on('data', function (data) {
      bufferAvail += data.length;
      if (bufferAvail > 0) {
        // slice returns the same buffer if overflowing
        // safe to call in any case
        const buffer = data.slice(0, remainingBytesToWrite);
        // write the buffer
        res.write(buffer);
        // increment total
        totalBytesWritten += buffer.length;
        // decrement remaining
        remainingBytesToWrite -= data.length;
        // decrement the avaialbe buffer
        bufferAvail -= buffer.length;
      }
      // in case of small slices, all values will be good at that point
      // we've written enough, end...
      if (totalBytesWritten >= contentLength) {
        stream.close();
        res.end();
        this.destroy();
      }
    });
  });
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0ZpbGVzUm91dGVyLmpzIl0sIm5hbWVzIjpbIk1pZGRsZXdhcmVzIiwiRmlsZXNSb3V0ZXIiLCJleHByZXNzUm91dGVyIiwibWF4VXBsb2FkU2l6ZSIsInJvdXRlciIsImV4cHJlc3MiLCJSb3V0ZXIiLCJnZXQiLCJnZXRIYW5kbGVyIiwicG9zdCIsInJlcSIsInJlcyIsIm5leHQiLCJQYXJzZSIsIkVycm9yIiwiSU5WQUxJRF9GSUxFX05BTUUiLCJhbGxvd0Nyb3NzRG9tYWluIiwiQm9keVBhcnNlciIsInJhdyIsInR5cGUiLCJsaW1pdCIsImhhbmRsZVBhcnNlSGVhZGVycyIsImNyZWF0ZUhhbmRsZXIiLCJkZWxldGUiLCJlbmZvcmNlTWFzdGVyS2V5QWNjZXNzIiwiZGVsZXRlSGFuZGxlciIsImNvbmZpZyIsIkNvbmZpZyIsInBhcmFtcyIsImFwcElkIiwiZmlsZXNDb250cm9sbGVyIiwiZmlsZW5hbWUiLCJjb250ZW50VHlwZSIsIm1pbWUiLCJnZXRUeXBlIiwiaXNGaWxlU3RyZWFtYWJsZSIsImdldEZpbGVTdHJlYW0iLCJ0aGVuIiwic3RyZWFtIiwiaGFuZGxlRmlsZVN0cmVhbSIsImNhdGNoIiwic3RhdHVzIiwic2V0IiwiZW5kIiwiZ2V0RmlsZURhdGEiLCJkYXRhIiwibGVuZ3RoIiwiYm9keSIsIkZJTEVfU0FWRV9FUlJPUiIsIm1hdGNoIiwiY3JlYXRlRmlsZSIsInJlc3VsdCIsInVybCIsImpzb24iLCJlIiwibG9nZ2VyIiwiZXJyb3IiLCJtZXNzYWdlIiwiZGVsZXRlRmlsZSIsIkZJTEVfREVMRVRFX0VSUk9SIiwiYWRhcHRlciIsImdldFJhbmdlIiwicGFydHMiLCJyZXBsYWNlIiwic3BsaXQiLCJzdGFydCIsInBhcnNlSW50IiwiYnVmZmVyX3NpemUiLCJub3RFbmRlZCIsIm5vdFN0YXJ0ZWQiLCJjb250ZW50TGVuZ3RoIiwid3JpdGVIZWFkIiwic2VlayIsImdyaWRGaWxlU3RyZWFtIiwiYnVmZmVyQXZhaWwiLCJyZW1haW5pbmdCeXRlc1RvV3JpdGUiLCJ0b3RhbEJ5dGVzV3JpdHRlbiIsIm9uIiwiYnVmZmVyIiwic2xpY2UiLCJ3cml0ZSIsImNsb3NlIiwiZGVzdHJveSJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7QUFDQTs7SUFBWUEsVzs7QUFDWjs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7Ozs7Ozs7QUFFTyxNQUFNQyxXQUFOLENBQWtCOztBQUV2QkMsZ0JBQWMsRUFBRUMsZ0JBQWdCLE1BQWxCLEtBQTZCLEVBQTNDLEVBQStDO0FBQzdDLFFBQUlDLFNBQVNDLGtCQUFRQyxNQUFSLEVBQWI7QUFDQUYsV0FBT0csR0FBUCxDQUFXLHlCQUFYLEVBQXNDLEtBQUtDLFVBQTNDOztBQUVBSixXQUFPSyxJQUFQLENBQVksUUFBWixFQUFzQixVQUFTQyxHQUFULEVBQWNDLEdBQWQsRUFBbUJDLElBQW5CLEVBQXlCO0FBQzdDQSxXQUFLLElBQUlDLGVBQU1DLEtBQVYsQ0FBZ0JELGVBQU1DLEtBQU4sQ0FBWUMsaUJBQTVCLEVBQ0gsd0JBREcsQ0FBTDtBQUVELEtBSEQ7O0FBS0FYLFdBQU9LLElBQVAsQ0FBWSxrQkFBWixFQUNFVCxZQUFZZ0IsZ0JBRGQsRUFFRUMscUJBQVdDLEdBQVgsQ0FBZSxFQUFDQyxNQUFNLE1BQU07QUFBRSxlQUFPLElBQVA7QUFBYyxPQUE3QixFQUErQkMsT0FBT2pCLGFBQXRDLEVBQWYsQ0FGRixFQUV5RTtBQUN2RUgsZ0JBQVlxQixrQkFIZCxFQUlFLEtBQUtDLGFBSlA7O0FBT0FsQixXQUFPbUIsTUFBUCxDQUFjLGtCQUFkLEVBQ0V2QixZQUFZZ0IsZ0JBRGQsRUFFRWhCLFlBQVlxQixrQkFGZCxFQUdFckIsWUFBWXdCLHNCQUhkLEVBSUUsS0FBS0MsYUFKUDtBQU1BLFdBQU9yQixNQUFQO0FBQ0Q7O0FBRURJLGFBQVdFLEdBQVgsRUFBZ0JDLEdBQWhCLEVBQXFCO0FBQ25CLFVBQU1lLFNBQVNDLGlCQUFPcEIsR0FBUCxDQUFXRyxJQUFJa0IsTUFBSixD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LE1BQVAsQ0FBYyxJQUFkLENBQXZCO0FBQ0EsUUFBSW9DLGNBQWMsQ0FBbEI7QUFDQSxRQUFJQyx3QkFBd0JMLGFBQTVCO0FBQ0EsUUFBSU0sb0JBQW9CLENBQXhCO0FBQ0E7QUFDQUgsbUJBQWVJLEVBQWYsQ0FBa0IsTUFBbEIsRUFBMEIsVUFBVWhDLElBQVYsRUFBZ0I7QUFDeEM2QixxQkFBZTdCLEtBQUtDLE1BQXBCO0FBQ0EsVUFBSTRCLGNBQWMsQ0FBbEIsRUFBcUI7QUFDbkI7QUFDQTtBQUNBLGNBQU1JLFNBQVNqQyxLQUFLa0MsS0FBTCxDQUFXLENBQVgsRUFBY0oscUJBQWQsQ0FBZjtBQUNBO0FBQ0FoRSxZQUFJcUUsS0FBSixDQUFVRixNQUFWO0FBQ0E7QUFDQUYsNkJBQXFCRSxPQUFPaEMsTUFBNUI7QUFDQTtBQUNBNkIsaUNBQXlCOUIsS0FBS0MsTUFBOUI7QUFDQTtBQUNBNEIsdUJBQWVJLE9BQU9oQyxNQUF0QjtBQUNEO0FBQ0Q7QUFDQTtBQUNBLFVBQUk4QixxQkFBcUJOLGFBQXpCLEVBQXdDO0FBQ3RDaEMsZUFBTzJDLEtBQVA7QUFDQXRFLFlBQUlnQyxHQUFKO0FBQ0EsYUFBS3VDLE9BQUw7QUFDRDtBQUNGLEtBdEJEO0FBdUJELEdBOUJEO0FBK0JEIiwiZmlsZSI6IkZpbGVzUm91dGVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGV4cHJlc3MgICAgICAgICAgICAgZnJvbSAnZXhwcmVzcyc7XG5pbXBvcnQgQm9keVBhcnNlciAgICAgICAgICBmcm9tICdib2R5LXBhcnNlcic7XG5pbXBvcnQgKiBhcyBNaWRkbGV3YXJlcyAgICBmcm9tICcuLi9taWRkbGV3YXJlcyc7XG5pbXBvcnQgUGFyc2UgICAgICAgICAgICAgICBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCBDb25maWcgICAgICAgICAgICAgIGZyb20gJy4uL0NvbmZpZyc7XG5pbXBvcnQgbWltZSAgICAgICAgICAgICAgICBmcm9tICdtaW1lJztcbmltcG9ydCBsb2dnZXIgICAgICAgICAgICAgIGZyb20gJy4uL2xvZ2dlcic7XG5cbmV4cG9ydCBjbGFzcyBGaWxlc1JvdXRlciB7XG5cbiAgZXhwcmVzc1JvdXRlcih7IG1heFVwbG9hZFNpemUgPSAnMjBNYicgfSA9IHt9KSB7XG4gICAgdmFyIHJvdXRlciA9IGV4cHJlc3MuUm91dGVyKCk7XG4gICAgcm91dGVyLmdldCgnL2ZpbGVzLzphcHBJZC86ZmlsZW5hbWUnLCB0aGlzLmdldEhhbmRsZXIpO1xuXG4gICAgcm91dGVyLnBvc3QoJy9maWxlcycsIGZ1bmN0aW9uKHJlcSwgcmVzLCBuZXh0KSB7XG4gICAgICBuZXh0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0ZJTEVfTkFNRSxcbiAgICAgICAgJ0ZpbGVuYW1lIG5vdCBwcm92aWRlZC4nKSk7XG4gICAgfSk7XG5cbiAgICByb3V0ZXIucG9zdCgnL2ZpbGVzLzpmaWxlbmFtZScsXG4gICAgICBNaWRkbGV3YXJlcy5hbGxvd0Nyb3NzRG9tYWluLFxuICAgICAgQm9keVBhcnNlci5yYXcoe3R5cGU6ICgpID0+IHsgcmV0dXJuIHRydWU7IH0sIGxpbWl0OiBtYXhVcGxvYWRTaXplIH0pLCAvLyBBbGxvdyB1cGxvYWRzIHdpdGhvdXQgQ29udGVudC1UeXBlLCBvciB3aXRoIGFueSBDb250ZW50LVR5cGUuXG4gICAgICBNaWRkbGV3YXJlcy5oYW5kbGVQYXJzZUhlYWRlcnMsXG4gICAgICB0aGlzLmNyZWF0ZUhhbmRsZXJcbiAgICApO1xuXG4gICAgcm91dGVyLmRlbGV0ZSgnL2ZpbGVzLzpmaWxlbmFtZScsXG4gICAgICBNaWRkbGV3YXJlcy5hbGxvd0Nyb3NzRG9tYWluLFxuICAgICAgTWlkZGxld2FyZXMuaGFuZGxlUGFyc2VIZWFkZXJzLFxuICAgICAgTWlkZGxld2FyZXMuZW5mb3JjZU1hc3RlcktleUFjY2VzcyxcbiAgICAgIHRoaXMuZGVsZXRlSGFuZGxlclxuICAgICk7XG4gICAgcmV0dXJuIHJvdXRlcjtcbiAgfVxuXG4gIGdldEhhbmRsZXIocmVxLCByZXMpIHtcbiAgICBjb25zdCBjb25maWcgPSBDb25maWcuZ2V0KHJlcS5wYXJhbXMuYXBwSWQpO1xuICAgIGNvbnN0IGZpbGVzQ29udHJvbGxlciA9IGNvbmZpZy5maWxlc0NvbnRyb2xsZXI7XG4gICAgY29uc3QgZmlsZW5hbWUgPSByZXEucGFyYW1zLmZpbGVuYW1lO1xuICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gbWltZS5nZXRUeXBlKGZpbGVuYW1lKTtcbiAgICBpZiAoaXNGaWxlU3RyZWFtYWJsZShyZXEsIGZpbGVzQ29udHJvbGxlcikpIHtcbiAgICAgIGZpbGVzQ29udHJvbGxlci5nZXRGaWxlU3RyZWFtKGNvbmZpZywgZmlsZW5hbWUpLnRoZW4oKHN0cmVhbSkgPT4ge1xuICAgICAgICBoYW5kbGVGaWxlU3RyZWFtKHN0cmVhbSwgcmVxLCByZXMsIGNvbnRlbnRUeXBlKTtcbiAgICAgIH0pLmNhdGNoKCgpID0+IHtcbiAgICAgICAgcmVzLnN0YXR1cyg0MDQpO1xuICAgICAgICByZXMuc2V0KCdDb250ZW50LVR5cGUnLCAndGV4dC9wbGFpbicpO1xuICAgICAgICByZXMuZW5kKCdGaWxlIG5vdCBmb3VuZC4nKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBmaWxlc0NvbnRyb2xsZXIuZ2V0RmlsZURhdGEoY29uZmlnLCBmaWxlbmFtZSkudGhlbigoZGF0YSkgPT4ge1xuICAgICAgICByZXMuc3RhdHVzKDIwMCk7XG4gICAgICAgIHJlcy5zZXQoJ0NvbnRlbnQtVHlwZScsIGNvbnRlbnRUeXBlKTtcbiAgICAgICAgcmVzLnNldCgnQ29udGVudC1MZW5ndGgnLCBkYXRhLmxlbmd0aCk7XG4gICAgICAgIHJlcy5lbmQoZGF0YSk7XG4gICAgICB9KS5jYXRjaCgoKSA9PiB7XG4gICAgICAgIHJlcy5zdGF0dXMoNDA0KTtcbiAgICAgICAgcmVzLnNldCgnQ29udGVudC1UeXBlJywgJ3RleHQvcGxhaW4nKTtcbiAgICAgICAgcmVzLmVuZCgnRmlsZSBub3QgZm91bmQuJyk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBjcmVhdGVIYW5kbGVyKHJlcSwgcmVzLCBuZXh0KSB7XG4gICAgaWYgKCFyZXEuYm9keSB8fCAhcmVxLmJvZHkubGVuZ3RoKSB7XG4gICAgICBuZXh0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5GSUxFX1NBVkVfRVJST1IsXG4gICAgICAgICdJbnZhbGlkIGZpbGUgdXBsb2FkLicpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAocmVxLnBhcmFtcy5maWxlbmFtZS5sZW5ndGggPiAxMjgpIHtcbiAgICAgIG5leHQobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfRklMRV9OQU1FLFxuICAgICAgICAnRmlsZW5hbWUgdG9vIGxvbmcuJykpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghcmVxLnBhcmFtcy5maWxlbmFtZS5tYXRjaCgvXltfYS16QS1aMC05XVthLXpBLVowLTlAXFwuXFwgfl8tXSokLykpIHtcbiAgICAgIG5leHQobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfRklMRV9OQU1FLFxuICAgICAgICAnRmlsZW5hbWUgY29udGFpbnMgaW52YWxpZCBjaGFyYWN0ZXJzLicpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlbmFtZSA9IHJlcS5wYXJhbXMuZmlsZW5hbWU7XG4gICAgY29uc3QgY29udGVudFR5cGUgPSByZXEuZ2V0KCdDb250ZW50LXR5cGUnKTtcbiAgICBjb25zdCBjb25maWcgPSByZXEuY29uZmlnO1xuICAgIGNvbnN0IGZpbGVzQ29udHJvbGxlciA9IGNvbmZpZy5maWxlc0NvbnRyb2xsZXI7XG5cbiAgICBmaWxlc0NvbnRyb2xsZXIuY3JlYXRlRmlsZShjb25maWcsIGZpbGVuYW1lLCByZXEuYm9keSwgY29udGVudFR5cGUpLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgcmVzLnN0YXR1cygyMDEpO1xuICAgICAgcmVzLnNldCgnTG9jYXRpb24nLCByZXN1bHQudXJsKTtcbiAgICAgIHJlcy5qc29uKHJlc3VsdCk7XG4gICAgfSkuY2F0Y2goKGUpID0+IHtcbiAgICAgIGxvZ2dlci5lcnJvcihlLm1lc3NhZ2UsIGUpO1xuICAgICAgbmV4dChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRklMRV9TQVZFX0VSUk9SLCAnQ291bGQgbm90IHN0b3JlIGZpbGUuJykpO1xuICAgIH0pO1xuICB9XG5cbiAgZGVsZXRlSGFuZGxlcihyZXEsIHJlcywgbmV4dCkge1xuICAgIGNvbnN0IGZpbGVzQ29udHJvbGxlciA9IHJlcS5jb25maWcuZmlsZXNDb250cm9sbGVyO1xuICAgIGZpbGVzQ29udHJvbGxlci5kZWxldGVGaWxlKHJlcS5jb25maWcsIHJlcS5wYXJhbXMuZmlsZW5hbWUpLnRoZW4oKCkgPT4ge1xuICAgICAgcmVzLnN0YXR1cygyMDApO1xuICAgICAgLy8gVE9ETzogcmV0dXJuIHVzZWZ1bCBKU09OIGhlcmU/XG4gICAgICByZXMuZW5kKCk7XG4gICAgfSkuY2F0Y2goKCkgPT4ge1xuICAgICAgbmV4dChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRklMRV9ERUxFVEVfRVJST1IsXG4gICAgICAgICdDb3VsZCBub3QgZGVsZXRlIGZpbGUuJykpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIGlzRmlsZVN0cmVhbWFibGUocmVxLCBmaWxlc0NvbnRyb2xsZXIpe1xuICByZXR1cm4gIHJlcS5nZXQoJ1JhbmdlJykgJiYgdHlwZW9mIGZpbGVzQ29udHJvbGxlci5hZGFwdGVyLmdldEZpbGVTdHJlYW0gPT09ICdmdW5jdGlvbic7XG59XG5cbmZ1bmN0aW9uIGdldFJhbmdlKHJlcSkge1xuICBjb25zdCBwYXJ0cyA9IHJlcS5nZXQoJ1JhbmdlJykucmVwbGFjZSgvYnl0ZXM9LywgXCJcIikuc3BsaXQoXCItXCIpO1xuICByZXR1cm4geyBzdGFydDogcGFyc2VJbnQocGFydHNbMF0sIDEwKSwgZW5kOiBwYXJzZUludChwYXJ0c1sxXSwgMTApIH07XG59XG5cbi8vIGhhbmRsZUZpbGVTdHJlYW0gaXMgbGljZW5jZWQgdW5kZXIgQ3JlYXRpdmUgQ29tbW9ucyBBdHRyaWJ1dGlvbiA0LjAgSW50ZXJuYXRpb25hbCBMaWNlbnNlIChodHRwczovL2NyZWF0aXZlY29tbW9ucy5vcmcvbGljZW5zZXMvYnkvNC4wLykuXG4vLyBBdXRob3I6IExFUk9JQiBhdCB3ZWlnaHRpbmdmb3JteXBpenphIChodHRwczovL3dlaWdodGluZ2Zvcm15cGl6emEud29yZHByZXNzLmNvbS8yMDE1LzA2LzI0L3N0cmVhbS1odG1sNS1tZWRpYS1jb250ZW50LWxpa2UtdmlkZW8tYXVkaW8tZnJvbS1tb25nb2RiLXVzaW5nLWV4cHJlc3MtYW5kLWdyaWRzdG9yZS8pLlxuZnVuY3Rpb24gaGFuZGxlRmlsZVN0cmVhbShzdHJlYW0sIHJlcSwgcmVzLCBjb250ZW50VHlwZSkge1xuICBjb25zdCBidWZmZXJfc2l6ZSA9IDEwMjQgKiAxMDI0OyAvLzEwMjRLYlxuICAvLyBSYW5nZSByZXF1ZXN0LCBwYXJ0aWFsbCBzdHJlYW0gdGhlIGZpbGVcbiAgbGV0IHtcbiAgICBzdGFydCwgZW5kXG4gIH0gPSBnZXRSYW5nZShyZXEpO1xuXG4gIGNvbnN0IG5vdEVuZGVkID0gKCFlbmQgJiYgZW5kICE9PSAwKTtcbiAgY29uc3Qgbm90U3RhcnRlZCA9ICghc3RhcnQgJiYgc3RhcnQgIT09IDApO1xuICAvLyBObyBlbmQgcHJvdmlkZWQsIHdlIHdhbnQgYWxsIGJ5dGVzXG4gIGlmIChub3RFbmRlZCkge1xuICAgIGVuZCA9IHN0cmVhbS5sZW5ndGggLSAxO1xuICB9XG4gIC8vIE5vIHN0YXJ0IHByb3ZpZGVkLCB3ZSdyZSByZWFkaW5nIGJhY2t3YXJkc1xuICBpZiAobm90U3RhcnRlZCkge1xuICAgIHN0YXJ0ID0gc3RyZWFtLmxlbmd0aCAtIGVuZDtcbiAgICBlbmQgPSBzdGFydCArIGVuZCAtIDE7XG4gIH1cblxuICAvLyBEYXRhIGV4Y2VlZHMgdGhlIGJ1ZmZlcl9zaXplLCBjYXBcbiAgaWYgKGVuZCAtIHN0YXJ0ID49IGJ1ZmZlcl9zaXplKSB7XG4gICAgZW5kID0gc3RhcnQgKyBidWZmZXJfc2l6ZSAtIDE7XG4gIH1cblxuICBjb25zdCBjb250ZW50TGVuZ3RoID0gKGVuZCAtIHN0YXJ0KSArIDE7XG5cbiAgcmVzLndyaXRlSGVhZCgyMDYsIHtcbiAgICAnQ29udGVudC1SYW5nZSc6ICdieXRlcyAnICsgc3RhcnQgKyAnLScgKyBlbmQgKyAnLycgKyBzdHJlYW0ubGVuZ3RoLFxuICAgICdBY2NlcHQtUmFuZ2VzJzogJ2J5dGVzJyxcbiAgICAnQ29udGVudC1MZW5ndGgnOiBjb250ZW50TGVuZ3RoLFxuICAgICdDb250ZW50LVR5cGUnOiBjb250ZW50VHlwZSxcbiAgfSk7XG5cbiAgc3RyZWFtLnNlZWsoc3RhcnQsIGZ1bmN0aW9uICgpIHtcbiAgICAvLyBnZXQgZ3JpZEZpbGUgc3RyZWFtXG4gICAgY29uc3QgZ3JpZEZpbGVTdHJlYW0gPSBzdHJlYW0uc3RyZWFtKHRydWUpO1xuICAgIGxldCBidWZmZXJBdmFpbCA9IDA7XG4gICAgbGV0IHJlbWFpbmluZ0J5dGVzVG9Xcml0ZSA9IGNvbnRlbnRMZW5ndGg7XG4gICAgbGV0IHRvdGFsQnl0ZXNXcml0dGVuID0gMDtcbiAgICAvLyB3cml0ZSB0byByZXNwb25zZVxuICAgIGdyaWRGaWxlU3RyZWFtLm9uKCdkYXRhJywgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgIGJ1ZmZlckF2YWlsICs9IGRhdGEubGVuZ3RoO1xuICAgICAgaWYgKGJ1ZmZlckF2YWlsID4gMCkge1xuICAgICAgICAvLyBzbGljZSByZXR1cm5zIHRoZSBzYW1lIGJ1ZmZlciBpZiBvdmVyZmxvd2luZ1xuICAgICAgICAvLyBzYWZlIHRvIGNhbGwgaW4gYW55IGNhc2VcbiAgICAgICAgY29uc3QgYnVmZmVyID0gZGF0YS5zbGljZSgwLCByZW1haW5pbmdCeXRlc1RvV3JpdGUpO1xuICAgICAgICAvLyB3cml0ZSB0aGUgYnVmZmVyXG4gICAgICAgIHJlcy53cml0ZShidWZmZXIpO1xuICAgICAgICAvLyBpbmNyZW1lbnQgdG90YWxcbiAgICAgICAgdG90YWxCeXRlc1dyaXR0ZW4gKz0gYnVmZmVyLmxlbmd0aDtcbiAgICAgICAgLy8gZGVjcmVtZW50IHJlbWFpbmluZ1xuICAgICAgICByZW1haW5pbmdCeXRlc1RvV3JpdGUgLT0gZGF0YS5sZW5ndGg7XG4gICAgICAgIC8vIGRlY3JlbWVudCB0aGUgYXZhaWFsYmUgYnVmZmVyXG4gICAgICAgIGJ1ZmZlckF2YWlsIC09IGJ1ZmZlci5sZW5ndGg7XG4gICAgICB9XG4gICAgICAvLyBpbiBjYXNlIG9mIHNtYWxsIHNsaWNlcywgYWxsIHZhbHVlcyB3aWxsIGJlIGdvb2QgYXQgdGhhdCBwb2ludFxuICAgICAgLy8gd2UndmUgd3JpdHRlbiBlbm91Z2gsIGVuZC4uLlxuICAgICAgaWYgKHRvdGFsQnl0ZXNXcml0dGVuID49IGNvbnRlbnRMZW5ndGgpIHtcbiAgICAgICAgc3RyZWFtLmNsb3NlKCk7XG4gICAgICAgIHJlcy5lbmQoKTtcbiAgICAgICAgdGhpcy5kZXN0cm95KCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xufVxuIl19