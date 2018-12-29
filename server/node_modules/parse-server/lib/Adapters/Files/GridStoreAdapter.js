'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GridStoreAdapter = undefined;

var _mongodb = require('mongodb');

var _FilesAdapter = require('./FilesAdapter');

var _defaults = require('../../defaults');

var _defaults2 = _interopRequireDefault(_defaults);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class GridStoreAdapter extends _FilesAdapter.FilesAdapter {

  constructor(mongoDatabaseURI = _defaults2.default.DefaultMongoURI) {
    super();
    this._databaseURI = mongoDatabaseURI;
  }

  _connect() {
    if (!this._connectionPromise) {
      this._connectionPromise = _mongodb.MongoClient.connect(this._databaseURI).then(client => client.db(client.s.options.dbName));
    }
    return this._connectionPromise;
  }

  // For a given config object, filename, and data, store a file
  // Returns a promise
  createFile(filename, data) {
    return this._connect().then(database => {
      const gridStore = new _mongodb.GridStore(database, filename, 'w');
      return gridStore.open();
    }).then(gridStore => {
      return gridStore.write(data);
    }).then(gridStore => {
      return gridStore.close();
    });
  }

  deleteFile(filename) {
    return this._connect().then(database => {
      const gridStore = new _mongodb.GridStore(database, filename, 'r');
      return gridStore.open();
    }).then(gridStore => {
      return gridStore.unlink();
    }).then(gridStore => {
      return gridStore.close();
    });
  }

  getFileData(filename) {
    return this._connect().then(database => {
      return _mongodb.GridStore.exist(database, filename).then(() => {
        const gridStore = new _mongodb.GridStore(database, filename, 'r');
        return gridStore.open();
      });
    }).then(gridStore => {
      return gridStore.read();
    });
  }

  getFileLocation(config, filename) {
    return config.mount + '/files/' + config.applicationId + '/' + encodeURIComponent(filename);
  }

  getFileStream(filename) {
    return this._connect().then(database => {
      return _mongodb.GridStore.exist(database, filename).then(() => {
        const gridStore = new _mongodb.GridStore(database, filename, 'r');
        return gridStore.open();
      });
    });
  }
}

exports.GridStoreAdapter = GridStoreAdapter; /**
                                              GridStoreAdapter
                                              Stores files in Mongo using GridStore
                                              Requires the database adapter to be based on mongoclient
                                             
                                               weak
                                              */

// -disable-next

exports.default = GridStoreAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9GaWxlcy9HcmlkU3RvcmVBZGFwdGVyLmpzIl0sIm5hbWVzIjpbIkdyaWRTdG9yZUFkYXB0ZXIiLCJGaWxlc0FkYXB0ZXIiLCJjb25zdHJ1Y3RvciIsIm1vbmdvRGF0YWJhc2VVUkkiLCJkZWZhdWx0cyIsIkRlZmF1bHRNb25nb1VSSSIsIl9kYXRhYmFzZVVSSSIsIl9jb25uZWN0IiwiX2Nvbm5lY3Rpb25Qcm9taXNlIiwiTW9uZ29DbGllbnQiLCJjb25uZWN0IiwidGhlbiIsImNsaWVudCIsImRiIiwicyIsIm9wdGlvbnMiLCJkYk5hbWUiLCJjcmVhdGVGaWxlIiwiZmlsZW5hbWUiLCJkYXRhIiwiZGF0YWJhc2UiLCJncmlkU3RvcmUiLCJHcmlkU3RvcmUiLCJvcGVuIiwid3JpdGUiLCJjbG9zZSIsImRlbGV0ZUZpbGUiLCJ1bmxpbmsiLCJnZXRGaWxlRGF0YSIsImV4aXN0IiwicmVhZCIsImdldEZpbGVMb2NhdGlvbiIsImNvbmZpZyIsIm1vdW50IiwiYXBwbGljYXRpb25JZCIsImVuY29kZVVSSUNvbXBvbmVudCIsImdldEZpbGVTdHJlYW0iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFTQTs7QUFDQTs7QUFDQTs7Ozs7O0FBRU8sTUFBTUEsZ0JBQU4sU0FBK0JDLDBCQUEvQixDQUE0Qzs7QUFJakRDLGNBQVlDLG1CQUFtQkMsbUJBQVNDLGVBQXhDLEVBQXlEO0FBQ3ZEO0FBQ0EsU0FBS0MsWUFBTCxHQUFvQkgsZ0JBQXBCO0FBQ0Q7O0FBRURJLGFBQVc7QUFDVCxRQUFJLENBQUMsS0FBS0Msa0JBQVYsRUFBOEI7QUFDNUIsV0FBS0Esa0JBQUwsR0FBMEJDLHFCQUFZQyxPQUFaLENBQW9CLEtBQUtKLFlBQXpCLEVBQ3ZCSyxJQUR1QixDQUNqQkMsTUFBRCxJQUFZQSxPQUFPQyxFQUFQLENBQVVELE9BQU9FLENBQVAsQ0FBU0MsT0FBVCxDQUFpQkMsTUFBM0IsQ0FETSxDQUExQjtBQUVEO0FBQ0QsV0FBTyxLQUFLUixrQkFBWjtBQUNEOztBQUVEO0FBQ0E7QUFDQVMsYUFBV0MsUUFBWCxFQUE2QkMsSUFBN0IsRUFBbUM7QUFDakMsV0FBTyxLQUFLWixRQUFMLEdBQWdCSSxJQUFoQixDQUFzQlMsUUFBRCxJQUFjO0FBQ3hDLFlBQU1DLFlBQVksSUFBSUMsa0JBQUosQ0FBY0YsUUFBZCxFQUF3QkYsUUFBeEIsRUFBa0MsR0FBbEMsQ0FBbEI7QUFDQSxhQUFPRyxVQUFVRSxJQUFWLEVBQVA7QUFDRCxLQUhNLEVBR0paLElBSEksQ0FHQ1UsYUFBYTtBQUNuQixhQUFPQSxVQUFVRyxLQUFWLENBQWdCTCxJQUFoQixDQUFQO0FBQ0QsS0FMTSxFQUtKUixJQUxJLENBS0NVLGFBQWE7QUFDbkIsYUFBT0EsVUFBVUksS0FBVixFQUFQO0FBQ0QsS0FQTSxDQUFQO0FBUUQ7O0FBRURDLGFBQVdSLFFBQVgsRUFBNkI7QUFDM0IsV0FBTyxLQUFLWCxRQUFMLEdBQWdCSSxJQUFoQixDQUFxQlMsWUFBWTtBQUN0QyxZQUFNQyxZQUFZLElBQUlDLGtCQUFKLENBQWNGLFFBQWQsRUFBd0JGLFFBQXhCLEVBQWtDLEdBQWxDLENBQWxCO0FBQ0EsYUFBT0csVUFBVUUsSUFBVixFQUFQO0FBQ0QsS0FITSxFQUdKWixJQUhJLENBR0VVLFNBQUQsSUFBZTtBQUNyQixhQUFPQSxVQUFVTSxNQUFWLEVBQVA7QUFDRCxLQUxNLEVBS0poQixJQUxJLENBS0VVLFNBQUQsSUFBZTtBQUNyQixhQUFPQSxVQUFVSSxLQUFWLEVBQVA7QUFDRCxLQVBNLENBQVA7QUFRRDs7QUFFREcsY0FBWVYsUUFBWixFQUE4QjtBQUM1QixXQUFPLEtBQUtYLFFBQUwsR0FBZ0JJLElBQWhCLENBQXFCUyxZQUFZO0FBQ3RDLGFBQU9FLG1CQUFVTyxLQUFWLENBQWdCVCxRQUFoQixFQUEwQkYsUUFBMUIsRUFDSlAsSUFESSxDQUNDLE1BQU07QUFDVixjQUFNVSxZQUFZLElBQUlDLGtCQUFKLENBQWNGLFFBQWQsRUFBd0JGLFFBQXhCLEVBQWtDLEdBQWxDLENBQWxCO0FBQ0EsZUFBT0csVUFBVUUsSUFBVixFQUFQO0FBQ0QsT0FKSSxDQUFQO0FBS0QsS0FOTSxFQU1KWixJQU5JLENBTUNVLGFBQWE7QUFDbkIsYUFBT0EsVUFBVVMsSUFBVixFQUFQO0FBQ0QsS0FSTSxDQUFQO0FBU0Q7O0FBRURDLGtCQUFnQkMsTUFBaEIsRUFBd0JkLFFBQXhCLEVBQWtDO0FBQ2hDLFdBQVFjLE9BQU9DLEtBQVAsR0FBZSxTQUFmLEdBQTJCRCxPQUFPRSxhQUFsQyxHQUFrRCxHQUFsRCxHQUF3REMsbUJBQW1CakIsUUFBbkIsQ0FBaEU7QUFDRDs7QUFFRGtCLGdCQUFjbEIsUUFBZCxFQUFnQztBQUM5QixXQUFPLEtBQUtYLFFBQUwsR0FBZ0JJLElBQWhCLENBQXFCUyxZQUFZO0FBQ3RDLGFBQU9FLG1CQUFVTyxLQUFWLENBQWdCVCxRQUFoQixFQUEwQkYsUUFBMUIsRUFBb0NQLElBQXBDLENBQXlDLE1BQU07QUFDcEQsY0FBTVUsWUFBWSxJQUFJQyxrQkFBSixDQUFjRixRQUFkLEVBQXdCRixRQUF4QixFQUFrQyxHQUFsQyxDQUFsQjtBQUNBLGVBQU9HLFVBQVVFLElBQVYsRUFBUDtBQUNELE9BSE0sQ0FBUDtBQUlELEtBTE0sQ0FBUDtBQU1EO0FBaEVnRDs7UUFBdEN2QixnQixHQUFBQSxnQixFQWJiOzs7Ozs7OztBQVFBOztrQkF3RWVBLGdCIiwiZmlsZSI6IkdyaWRTdG9yZUFkYXB0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiBHcmlkU3RvcmVBZGFwdGVyXG4gU3RvcmVzIGZpbGVzIGluIE1vbmdvIHVzaW5nIEdyaWRTdG9yZVxuIFJlcXVpcmVzIHRoZSBkYXRhYmFzZSBhZGFwdGVyIHRvIGJlIGJhc2VkIG9uIG1vbmdvY2xpZW50XG5cbiBAZmxvdyB3ZWFrXG4gKi9cblxuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgeyBNb25nb0NsaWVudCwgR3JpZFN0b3JlLCBEYn0gZnJvbSAnbW9uZ29kYic7XG5pbXBvcnQgeyBGaWxlc0FkYXB0ZXIgfSAgICAgICAgICAgICAgZnJvbSAnLi9GaWxlc0FkYXB0ZXInO1xuaW1wb3J0IGRlZmF1bHRzICAgICAgICAgICAgICAgICAgICAgIGZyb20gJy4uLy4uL2RlZmF1bHRzJztcblxuZXhwb3J0IGNsYXNzIEdyaWRTdG9yZUFkYXB0ZXIgZXh0ZW5kcyBGaWxlc0FkYXB0ZXIge1xuICBfZGF0YWJhc2VVUkk6IHN0cmluZztcbiAgX2Nvbm5lY3Rpb25Qcm9taXNlOiBQcm9taXNlPERiPjtcblxuICBjb25zdHJ1Y3Rvcihtb25nb0RhdGFiYXNlVVJJID0gZGVmYXVsdHMuRGVmYXVsdE1vbmdvVVJJKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLl9kYXRhYmFzZVVSSSA9IG1vbmdvRGF0YWJhc2VVUkk7XG4gIH1cblxuICBfY29ubmVjdCgpIHtcbiAgICBpZiAoIXRoaXMuX2Nvbm5lY3Rpb25Qcm9taXNlKSB7XG4gICAgICB0aGlzLl9jb25uZWN0aW9uUHJvbWlzZSA9IE1vbmdvQ2xpZW50LmNvbm5lY3QodGhpcy5fZGF0YWJhc2VVUkkpXG4gICAgICAgIC50aGVuKChjbGllbnQpID0+IGNsaWVudC5kYihjbGllbnQucy5vcHRpb25zLmRiTmFtZSkpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fY29ubmVjdGlvblByb21pc2U7XG4gIH1cblxuICAvLyBGb3IgYSBnaXZlbiBjb25maWcgb2JqZWN0LCBmaWxlbmFtZSwgYW5kIGRhdGEsIHN0b3JlIGEgZmlsZVxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZVxuICBjcmVhdGVGaWxlKGZpbGVuYW1lOiBzdHJpbmcsIGRhdGEpIHtcbiAgICByZXR1cm4gdGhpcy5fY29ubmVjdCgpLnRoZW4oKGRhdGFiYXNlKSA9PiB7XG4gICAgICBjb25zdCBncmlkU3RvcmUgPSBuZXcgR3JpZFN0b3JlKGRhdGFiYXNlLCBmaWxlbmFtZSwgJ3cnKTtcbiAgICAgIHJldHVybiBncmlkU3RvcmUub3BlbigpO1xuICAgIH0pLnRoZW4oZ3JpZFN0b3JlID0+IHtcbiAgICAgIHJldHVybiBncmlkU3RvcmUud3JpdGUoZGF0YSk7XG4gICAgfSkudGhlbihncmlkU3RvcmUgPT4ge1xuICAgICAgcmV0dXJuIGdyaWRTdG9yZS5jbG9zZSgpO1xuICAgIH0pO1xuICB9XG5cbiAgZGVsZXRlRmlsZShmaWxlbmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Nvbm5lY3QoKS50aGVuKGRhdGFiYXNlID0+IHtcbiAgICAgIGNvbnN0IGdyaWRTdG9yZSA9IG5ldyBHcmlkU3RvcmUoZGF0YWJhc2UsIGZpbGVuYW1lLCAncicpO1xuICAgICAgcmV0dXJuIGdyaWRTdG9yZS5vcGVuKCk7XG4gICAgfSkudGhlbigoZ3JpZFN0b3JlKSA9PiB7XG4gICAgICByZXR1cm4gZ3JpZFN0b3JlLnVubGluaygpO1xuICAgIH0pLnRoZW4oKGdyaWRTdG9yZSkgPT4ge1xuICAgICAgcmV0dXJuIGdyaWRTdG9yZS5jbG9zZSgpO1xuICAgIH0pO1xuICB9XG5cbiAgZ2V0RmlsZURhdGEoZmlsZW5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLl9jb25uZWN0KCkudGhlbihkYXRhYmFzZSA9PiB7XG4gICAgICByZXR1cm4gR3JpZFN0b3JlLmV4aXN0KGRhdGFiYXNlLCBmaWxlbmFtZSlcbiAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGdyaWRTdG9yZSA9IG5ldyBHcmlkU3RvcmUoZGF0YWJhc2UsIGZpbGVuYW1lLCAncicpO1xuICAgICAgICAgIHJldHVybiBncmlkU3RvcmUub3BlbigpO1xuICAgICAgICB9KTtcbiAgICB9KS50aGVuKGdyaWRTdG9yZSA9PiB7XG4gICAgICByZXR1cm4gZ3JpZFN0b3JlLnJlYWQoKTtcbiAgICB9KTtcbiAgfVxuXG4gIGdldEZpbGVMb2NhdGlvbihjb25maWcsIGZpbGVuYW1lKSB7XG4gICAgcmV0dXJuIChjb25maWcubW91bnQgKyAnL2ZpbGVzLycgKyBjb25maWcuYXBwbGljYXRpb25JZCArICcvJyArIGVuY29kZVVSSUNvbXBvbmVudChmaWxlbmFtZSkpO1xuICB9XG5cbiAgZ2V0RmlsZVN0cmVhbShmaWxlbmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Nvbm5lY3QoKS50aGVuKGRhdGFiYXNlID0+IHtcbiAgICAgIHJldHVybiBHcmlkU3RvcmUuZXhpc3QoZGF0YWJhc2UsIGZpbGVuYW1lKS50aGVuKCgpID0+IHtcbiAgICAgICAgY29uc3QgZ3JpZFN0b3JlID0gbmV3IEdyaWRTdG9yZShkYXRhYmFzZSwgZmlsZW5hbWUsICdyJyk7XG4gICAgICAgIHJldHVybiBncmlkU3RvcmUub3BlbigpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgR3JpZFN0b3JlQWRhcHRlcjtcbiJdfQ==