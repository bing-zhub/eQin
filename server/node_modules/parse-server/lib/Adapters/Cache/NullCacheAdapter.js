"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
class NullCacheAdapter {

  constructor() {}

  get() {
    return new Promise(resolve => {
      return resolve(null);
    });
  }

  put() {
    return Promise.resolve();
  }

  del() {
    return Promise.resolve();
  }

  clear() {
    return Promise.resolve();
  }
}

exports.NullCacheAdapter = NullCacheAdapter;
exports.default = NullCacheAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9DYWNoZS9OdWxsQ2FjaGVBZGFwdGVyLmpzIl0sIm5hbWVzIjpbIk51bGxDYWNoZUFkYXB0ZXIiLCJjb25zdHJ1Y3RvciIsImdldCIsIlByb21pc2UiLCJyZXNvbHZlIiwicHV0IiwiZGVsIiwiY2xlYXIiXSwibWFwcGluZ3MiOiI7Ozs7O0FBQU8sTUFBTUEsZ0JBQU4sQ0FBdUI7O0FBRTVCQyxnQkFBYyxDQUFFOztBQUVoQkMsUUFBTTtBQUNKLFdBQU8sSUFBSUMsT0FBSixDQUFhQyxPQUFELElBQWE7QUFDOUIsYUFBT0EsUUFBUSxJQUFSLENBQVA7QUFDRCxLQUZNLENBQVA7QUFHRDs7QUFFREMsUUFBTTtBQUNKLFdBQU9GLFFBQVFDLE9BQVIsRUFBUDtBQUNEOztBQUVERSxRQUFNO0FBQ0osV0FBT0gsUUFBUUMsT0FBUixFQUFQO0FBQ0Q7O0FBRURHLFVBQVE7QUFDTixXQUFPSixRQUFRQyxPQUFSLEVBQVA7QUFDRDtBQXBCMkI7O1FBQWpCSixnQixHQUFBQSxnQjtrQkF1QkVBLGdCIiwiZmlsZSI6Ik51bGxDYWNoZUFkYXB0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgY2xhc3MgTnVsbENhY2hlQWRhcHRlciB7XG5cbiAgY29uc3RydWN0b3IoKSB7fVxuXG4gIGdldCgpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHJldHVybiByZXNvbHZlKG51bGwpO1xuICAgIH0pXG4gIH1cblxuICBwdXQoKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgZGVsKCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIGNsZWFyKCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBOdWxsQ2FjaGVBZGFwdGVyO1xuIl19