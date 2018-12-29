'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.LRUCache = undefined;

var _lruCache = require('lru-cache');

var _lruCache2 = _interopRequireDefault(_lruCache);

var _defaults = require('../../defaults');

var _defaults2 = _interopRequireDefault(_defaults);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class LRUCache {
  constructor({
    ttl = _defaults2.default.cacheTTL,
    maxSize = _defaults2.default.cacheMaxSize
  }) {
    this.cache = new _lruCache2.default({
      max: maxSize,
      maxAge: ttl
    });
  }

  get(key) {
    return this.cache.get(key) || null;
  }

  put(key, value, ttl = this.ttl) {
    this.cache.set(key, value, ttl);
  }

  del(key) {
    this.cache.del(key);
  }

  clear() {
    this.cache.reset();
  }

}

exports.LRUCache = LRUCache;
exports.default = LRUCache;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9DYWNoZS9MUlVDYWNoZS5qcyJdLCJuYW1lcyI6WyJMUlVDYWNoZSIsImNvbnN0cnVjdG9yIiwidHRsIiwiZGVmYXVsdHMiLCJjYWNoZVRUTCIsIm1heFNpemUiLCJjYWNoZU1heFNpemUiLCJjYWNoZSIsIkxSVSIsIm1heCIsIm1heEFnZSIsImdldCIsImtleSIsInB1dCIsInZhbHVlIiwic2V0IiwiZGVsIiwiY2xlYXIiLCJyZXNldCJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7OztBQUVPLE1BQU1BLFFBQU4sQ0FBZTtBQUNwQkMsY0FBWTtBQUNWQyxVQUFNQyxtQkFBU0MsUUFETDtBQUVWQyxjQUFVRixtQkFBU0c7QUFGVCxHQUFaLEVBR0c7QUFDRCxTQUFLQyxLQUFMLEdBQWEsSUFBSUMsa0JBQUosQ0FBUTtBQUNuQkMsV0FBS0osT0FEYztBQUVuQkssY0FBUVI7QUFGVyxLQUFSLENBQWI7QUFJRDs7QUFFRFMsTUFBSUMsR0FBSixFQUFTO0FBQ1AsV0FBTyxLQUFLTCxLQUFMLENBQVdJLEdBQVgsQ0FBZUMsR0FBZixLQUF1QixJQUE5QjtBQUNEOztBQUVEQyxNQUFJRCxHQUFKLEVBQVNFLEtBQVQsRUFBZ0JaLE1BQU0sS0FBS0EsR0FBM0IsRUFBZ0M7QUFDOUIsU0FBS0ssS0FBTCxDQUFXUSxHQUFYLENBQWVILEdBQWYsRUFBb0JFLEtBQXBCLEVBQTJCWixHQUEzQjtBQUNEOztBQUVEYyxNQUFJSixHQUFKLEVBQVM7QUFDUCxTQUFLTCxLQUFMLENBQVdTLEdBQVgsQ0FBZUosR0FBZjtBQUNEOztBQUVESyxVQUFRO0FBQ04sU0FBS1YsS0FBTCxDQUFXVyxLQUFYO0FBQ0Q7O0FBekJtQjs7UUFBVGxCLFEsR0FBQUEsUTtrQkE2QkVBLFEiLCJmaWxlIjoiTFJVQ2FjaGUuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgTFJVIGZyb20gJ2xydS1jYWNoZSc7XG5pbXBvcnQgZGVmYXVsdHMgIGZyb20gJy4uLy4uL2RlZmF1bHRzJztcblxuZXhwb3J0IGNsYXNzIExSVUNhY2hlIHtcbiAgY29uc3RydWN0b3Ioe1xuICAgIHR0bCA9IGRlZmF1bHRzLmNhY2hlVFRMLFxuICAgIG1heFNpemUgPSBkZWZhdWx0cy5jYWNoZU1heFNpemUsXG4gIH0pIHtcbiAgICB0aGlzLmNhY2hlID0gbmV3IExSVSh7XG4gICAgICBtYXg6IG1heFNpemUsXG4gICAgICBtYXhBZ2U6IHR0bFxuICAgIH0pO1xuICB9XG5cbiAgZ2V0KGtleSkge1xuICAgIHJldHVybiB0aGlzLmNhY2hlLmdldChrZXkpIHx8IG51bGw7XG4gIH1cblxuICBwdXQoa2V5LCB2YWx1ZSwgdHRsID0gdGhpcy50dGwpIHtcbiAgICB0aGlzLmNhY2hlLnNldChrZXksIHZhbHVlLCB0dGwpO1xuICB9XG5cbiAgZGVsKGtleSkge1xuICAgIHRoaXMuY2FjaGUuZGVsKGtleSk7XG4gIH1cblxuICBjbGVhcigpIHtcbiAgICB0aGlzLmNhY2hlLnJlc2V0KCk7XG4gIH1cblxufVxuXG5leHBvcnQgZGVmYXVsdCBMUlVDYWNoZTtcbiJdfQ==