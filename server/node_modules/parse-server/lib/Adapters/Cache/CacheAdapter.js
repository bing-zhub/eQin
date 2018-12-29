"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
/*eslint no-unused-vars: "off"*/
class CacheAdapter {
  /**
   * Get a value in the cache
   * @param key Cache key to get
   * @return Promise that will eventually resolve to the value in the cache.
   */
  get(key) {}

  /**
   * Set a value in the cache
   * @param key Cache key to set
   * @param value Value to set the key
   * @param ttl Optional TTL
   */
  put(key, value, ttl) {}

  /**
   * Remove a value from the cache.
   * @param key Cache key to remove
   */
  del(key) {}

  /**
   * Empty a cache
   */
  clear() {}
}
exports.CacheAdapter = CacheAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9DYWNoZS9DYWNoZUFkYXB0ZXIuanMiXSwibmFtZXMiOlsiQ2FjaGVBZGFwdGVyIiwiZ2V0Iiwia2V5IiwicHV0IiwidmFsdWUiLCJ0dGwiLCJkZWwiLCJjbGVhciJdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQTtBQUNPLE1BQU1BLFlBQU4sQ0FBbUI7QUFDeEI7Ozs7O0FBS0FDLE1BQUlDLEdBQUosRUFBUyxDQUFFOztBQUVYOzs7Ozs7QUFNQUMsTUFBSUQsR0FBSixFQUFTRSxLQUFULEVBQWdCQyxHQUFoQixFQUFxQixDQUFFOztBQUV2Qjs7OztBQUlBQyxNQUFJSixHQUFKLEVBQVMsQ0FBRTs7QUFFWDs7O0FBR0FLLFVBQVEsQ0FBRTtBQXpCYztRQUFiUCxZLEdBQUFBLFkiLCJmaWxlIjoiQ2FjaGVBZGFwdGVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyplc2xpbnQgbm8tdW51c2VkLXZhcnM6IFwib2ZmXCIqL1xuZXhwb3J0IGNsYXNzIENhY2hlQWRhcHRlciB7XG4gIC8qKlxuICAgKiBHZXQgYSB2YWx1ZSBpbiB0aGUgY2FjaGVcbiAgICogQHBhcmFtIGtleSBDYWNoZSBrZXkgdG8gZ2V0XG4gICAqIEByZXR1cm4gUHJvbWlzZSB0aGF0IHdpbGwgZXZlbnR1YWxseSByZXNvbHZlIHRvIHRoZSB2YWx1ZSBpbiB0aGUgY2FjaGUuXG4gICAqL1xuICBnZXQoa2V5KSB7fVxuXG4gIC8qKlxuICAgKiBTZXQgYSB2YWx1ZSBpbiB0aGUgY2FjaGVcbiAgICogQHBhcmFtIGtleSBDYWNoZSBrZXkgdG8gc2V0XG4gICAqIEBwYXJhbSB2YWx1ZSBWYWx1ZSB0byBzZXQgdGhlIGtleVxuICAgKiBAcGFyYW0gdHRsIE9wdGlvbmFsIFRUTFxuICAgKi9cbiAgcHV0KGtleSwgdmFsdWUsIHR0bCkge31cblxuICAvKipcbiAgICogUmVtb3ZlIGEgdmFsdWUgZnJvbSB0aGUgY2FjaGUuXG4gICAqIEBwYXJhbSBrZXkgQ2FjaGUga2V5IHRvIHJlbW92ZVxuICAgKi9cbiAgZGVsKGtleSkge31cblxuICAvKipcbiAgICogRW1wdHkgYSBjYWNoZVxuICAgKi9cbiAgY2xlYXIoKSB7fVxufVxuIl19