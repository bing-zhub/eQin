'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FilesController = undefined;

var _cryptoUtils = require('../cryptoUtils');

var _AdaptableController = require('./AdaptableController');

var _AdaptableController2 = _interopRequireDefault(_AdaptableController);

var _FilesAdapter = require('../Adapters/Files/FilesAdapter');

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _mime = require('mime');

var _mime2 = _interopRequireDefault(_mime);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const legacyFilesRegex = new RegExp("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-.*"); // FilesController.js
class FilesController extends _AdaptableController2.default {

  getFileData(config, filename) {
    return this.adapter.getFileData(filename);
  }

  createFile(config, filename, data, contentType) {

    const extname = _path2.default.extname(filename);

    const hasExtension = extname.length > 0;

    if (!hasExtension && contentType && _mime2.default.getExtension(contentType)) {
      filename = filename + '.' + _mime2.default.getExtension(contentType);
    } else if (hasExtension && !contentType) {
      contentType = _mime2.default.getType(filename);
    }

    if (!this.options.preserveFileName) {
      filename = (0, _cryptoUtils.randomHexString)(32) + '_' + filename;
    }

    const location = this.adapter.getFileLocation(config, filename);
    return this.adapter.createFile(filename, data, contentType).then(() => {
      return Promise.resolve({
        url: location,
        name: filename
      });
    });
  }

  deleteFile(config, filename) {
    return this.adapter.deleteFile(filename);
  }

  /**
   * Find file references in REST-format object and adds the url key
   * with the current mount point and app id.
   * Object may be a single object or list of REST-format objects.
   */
  expandFilesInObject(config, object) {
    if (object instanceof Array) {
      object.map(obj => this.expandFilesInObject(config, obj));
      return;
    }
    if (typeof object !== 'object') {
      return;
    }
    for (const key in object) {
      const fileObject = object[key];
      if (fileObject && fileObject['__type'] === 'File') {
        if (fileObject['url']) {
          continue;
        }
        const filename = fileObject['name'];
        // all filenames starting with "tfss-" should be from files.parsetfss.com
        // all filenames starting with a "-" seperated UUID should be from files.parse.com
        // all other filenames have been migrated or created from Parse Server
        if (config.fileKey === undefined) {
          fileObject['url'] = this.adapter.getFileLocation(config, filename);
        } else {
          if (filename.indexOf('tfss-') === 0) {
            fileObject['url'] = 'http://files.parsetfss.com/' + config.fileKey + '/' + encodeURIComponent(filename);
          } else if (legacyFilesRegex.test(filename)) {
            fileObject['url'] = 'http://files.parse.com/' + config.fileKey + '/' + encodeURIComponent(filename);
          } else {
            fileObject['url'] = this.adapter.getFileLocation(config, filename);
          }
        }
      }
    }
  }

  expectedAdapterType() {
    return _FilesAdapter.FilesAdapter;
  }

  getFileStream(config, filename) {
    return this.adapter.getFileStream(filename);
  }
}

exports.FilesController = FilesController;
exports.default = FilesController;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9GaWxlc0NvbnRyb2xsZXIuanMiXSwibmFtZXMiOlsibGVnYWN5RmlsZXNSZWdleCIsIlJlZ0V4cCIsIkZpbGVzQ29udHJvbGxlciIsIkFkYXB0YWJsZUNvbnRyb2xsZXIiLCJnZXRGaWxlRGF0YSIsImNvbmZpZyIsImZpbGVuYW1lIiwiYWRhcHRlciIsImNyZWF0ZUZpbGUiLCJkYXRhIiwiY29udGVudFR5cGUiLCJleHRuYW1lIiwicGF0aCIsImhhc0V4dGVuc2lvbiIsImxlbmd0aCIsIm1pbWUiLCJnZXRFeHRlbnNpb24iLCJnZXRUeXBlIiwib3B0aW9ucyIsInByZXNlcnZlRmlsZU5hbWUiLCJsb2NhdGlvbiIsImdldEZpbGVMb2NhdGlvbiIsInRoZW4iLCJQcm9taXNlIiwicmVzb2x2ZSIsInVybCIsIm5hbWUiLCJkZWxldGVGaWxlIiwiZXhwYW5kRmlsZXNJbk9iamVjdCIsIm9iamVjdCIsIkFycmF5IiwibWFwIiwib2JqIiwia2V5IiwiZmlsZU9iamVjdCIsImZpbGVLZXkiLCJ1bmRlZmluZWQiLCJpbmRleE9mIiwiZW5jb2RlVVJJQ29tcG9uZW50IiwidGVzdCIsImV4cGVjdGVkQWRhcHRlclR5cGUiLCJGaWxlc0FkYXB0ZXIiLCJnZXRGaWxlU3RyZWFtIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQ0E7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7OztBQUNBOzs7Ozs7QUFFQSxNQUFNQSxtQkFBbUIsSUFBSUMsTUFBSixDQUFXLGlGQUFYLENBQXpCLEMsQ0FQQTtBQVNPLE1BQU1DLGVBQU4sU0FBOEJDLDZCQUE5QixDQUFrRDs7QUFFdkRDLGNBQVlDLE1BQVosRUFBb0JDLFFBQXBCLEVBQThCO0FBQzVCLFdBQU8sS0FBS0MsT0FBTCxDQUFhSCxXQUFiLENBQXlCRSxRQUF6QixDQUFQO0FBQ0Q7O0FBRURFLGFBQVdILE1BQVgsRUFBbUJDLFFBQW5CLEVBQTZCRyxJQUE3QixFQUFtQ0MsV0FBbkMsRUFBZ0Q7O0FBRTlD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QUVEQyxnQkFBY3JDLE1BQWQsRUFBc0JDLFFBQXRCLEVBQWdDO0FBQzlCLFdBQU8sS0FBS0MsT0FBTCxDQUFhbUMsYUFBYixDQUEyQnBDLFFBQTNCLENBQVA7QUFDRDtBQS9Fc0Q7O1FBQTVDSixlLEdBQUFBLGU7a0JBa0ZFQSxlIiwiZmlsZSI6IkZpbGVzQ29udHJvbGxlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEZpbGVzQ29udHJvbGxlci5qc1xuaW1wb3J0IHsgcmFuZG9tSGV4U3RyaW5nIH0gZnJvbSAnLi4vY3J5cHRvVXRpbHMnO1xuaW1wb3J0IEFkYXB0YWJsZUNvbnRyb2xsZXIgZnJvbSAnLi9BZGFwdGFibGVDb250cm9sbGVyJztcbmltcG9ydCB7IEZpbGVzQWRhcHRlciB9IGZyb20gJy4uL0FkYXB0ZXJzL0ZpbGVzL0ZpbGVzQWRhcHRlcic7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBtaW1lIGZyb20gJ21pbWUnO1xuXG5jb25zdCBsZWdhY3lGaWxlc1JlZ2V4ID0gbmV3IFJlZ0V4cChcIl5bMC05YS1mQS1GXXs4fS1bMC05YS1mQS1GXXs0fS1bMC05YS1mQS1GXXs0fS1bMC05YS1mQS1GXXs0fS1bMC05YS1mQS1GXXsxMn0tLipcIik7XG5cbmV4cG9ydCBjbGFzcyBGaWxlc0NvbnRyb2xsZXIgZXh0ZW5kcyBBZGFwdGFibGVDb250cm9sbGVyIHtcblxuICBnZXRGaWxlRGF0YShjb25maWcsIGZpbGVuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5nZXRGaWxlRGF0YShmaWxlbmFtZSk7XG4gIH1cblxuICBjcmVhdGVGaWxlKGNvbmZpZywgZmlsZW5hbWUsIGRhdGEsIGNvbnRlbnRUeXBlKSB7XG5cbiAgICBjb25zdCBleHRuYW1lID0gcGF0aC5leHRuYW1lKGZpbGVuYW1lKTtcblxuICAgIGNvbnN0IGhhc0V4dGVuc2lvbiA9IGV4dG5hbWUubGVuZ3RoID4gMDtcblxuICAgIGlmICghaGFzRXh0ZW5zaW9uICYmIGNvbnRlbnRUeXBlICYmIG1pbWUuZ2V0RXh0ZW5zaW9uKGNvbnRlbnRUeXBlKSkge1xuICAgICAgZmlsZW5hbWUgPSBmaWxlbmFtZSArICcuJyArIG1pbWUuZ2V0RXh0ZW5zaW9uKGNvbnRlbnRUeXBlKTtcbiAgICB9IGVsc2UgaWYgKGhhc0V4dGVuc2lvbiAmJiAhY29udGVudFR5cGUpIHtcbiAgICAgIGNvbnRlbnRUeXBlID0gbWltZS5nZXRUeXBlKGZpbGVuYW1lKTtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMub3B0aW9ucy5wcmVzZXJ2ZUZpbGVOYW1lKSB7XG4gICAgICBmaWxlbmFtZSA9IHJhbmRvbUhleFN0cmluZygzMikgKyAnXycgKyBmaWxlbmFtZTtcbiAgICB9XG5cbiAgICBjb25zdCBsb2NhdGlvbiA9IHRoaXMuYWRhcHRlci5nZXRGaWxlTG9jYXRpb24oY29uZmlnLCBmaWxlbmFtZSk7XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5jcmVhdGVGaWxlKGZpbGVuYW1lLCBkYXRhLCBjb250ZW50VHlwZSkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAgICAgICAgdXJsOiBsb2NhdGlvbixcbiAgICAgICAgbmFtZTogZmlsZW5hbWVcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZGVsZXRlRmlsZShjb25maWcsIGZpbGVuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5kZWxldGVGaWxlKGZpbGVuYW1lKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kIGZpbGUgcmVmZXJlbmNlcyBpbiBSRVNULWZvcm1hdCBvYmplY3QgYW5kIGFkZHMgdGhlIHVybCBrZXlcbiAgICogd2l0aCB0aGUgY3VycmVudCBtb3VudCBwb2ludCBhbmQgYXBwIGlkLlxuICAgKiBPYmplY3QgbWF5IGJlIGEgc2luZ2xlIG9iamVjdCBvciBsaXN0IG9mIFJFU1QtZm9ybWF0IG9iamVjdHMuXG4gICAqL1xuICBleHBhbmRGaWxlc0luT2JqZWN0KGNvbmZpZywgb2JqZWN0KSB7XG4gICAgaWYgKG9iamVjdCBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICBvYmplY3QubWFwKChvYmopID0+IHRoaXMuZXhwYW5kRmlsZXNJbk9iamVjdChjb25maWcsIG9iaikpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIG9iamVjdCAhPT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChjb25zdCBrZXkgaW4gb2JqZWN0KSB7XG4gICAgICBjb25zdCBmaWxlT2JqZWN0ID0gb2JqZWN0W2tleV07XG4gICAgICBpZiAoZmlsZU9iamVjdCAmJiBmaWxlT2JqZWN0WydfX3R5cGUnXSA9PT0gJ0ZpbGUnKSB7XG4gICAgICAgIGlmIChmaWxlT2JqZWN0Wyd1cmwnXSkge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGZpbGVuYW1lID0gZmlsZU9iamVjdFsnbmFtZSddO1xuICAgICAgICAvLyBhbGwgZmlsZW5hbWVzIHN0YXJ0aW5nIHdpdGggXCJ0ZnNzLVwiIHNob3VsZCBiZSBmcm9tIGZpbGVzLnBhcnNldGZzcy5jb21cbiAgICAgICAgLy8gYWxsIGZpbGVuYW1lcyBzdGFydGluZyB3aXRoIGEgXCItXCIgc2VwZXJhdGVkIFVVSUQgc2hvdWxkIGJlIGZyb20gZmlsZXMucGFyc2UuY29tXG4gICAgICAgIC8vIGFsbCBvdGhlciBmaWxlbmFtZXMgaGF2ZSBiZWVuIG1pZ3JhdGVkIG9yIGNyZWF0ZWQgZnJvbSBQYXJzZSBTZXJ2ZXJcbiAgICAgICAgaWYgKGNvbmZpZy5maWxlS2V5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBmaWxlT2JqZWN0Wyd1cmwnXSA9IHRoaXMuYWRhcHRlci5nZXRGaWxlTG9jYXRpb24oY29uZmlnLCBmaWxlbmFtZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKGZpbGVuYW1lLmluZGV4T2YoJ3Rmc3MtJykgPT09IDApIHtcbiAgICAgICAgICAgIGZpbGVPYmplY3RbJ3VybCddID0gJ2h0dHA6Ly9maWxlcy5wYXJzZXRmc3MuY29tLycgKyBjb25maWcuZmlsZUtleSArICcvJyArIGVuY29kZVVSSUNvbXBvbmVudChmaWxlbmFtZSk7XG4gICAgICAgICAgfSBlbHNlIGlmIChsZWdhY3lGaWxlc1JlZ2V4LnRlc3QoZmlsZW5hbWUpKSB7XG4gICAgICAgICAgICBmaWxlT2JqZWN0Wyd1cmwnXSA9ICdodHRwOi8vZmlsZXMucGFyc2UuY29tLycgKyBjb25maWcuZmlsZUtleSArICcvJyArIGVuY29kZVVSSUNvbXBvbmVudChmaWxlbmFtZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZpbGVPYmplY3RbJ3VybCddID0gdGhpcy5hZGFwdGVyLmdldEZpbGVMb2NhdGlvbihjb25maWcsIGZpbGVuYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBleHBlY3RlZEFkYXB0ZXJUeXBlKCkge1xuICAgIHJldHVybiBGaWxlc0FkYXB0ZXI7XG4gIH1cblxuICBnZXRGaWxlU3RyZWFtKGNvbmZpZywgZmlsZW5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmdldEZpbGVTdHJlYW0oZmlsZW5hbWUpO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IEZpbGVzQ29udHJvbGxlcjtcbiJdfQ==