"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

/*eslint no-unused-vars: "off"*/
// Push Adapter
//
// Allows you to change the push notification mechanism.
//
// Adapter classes must implement the following functions:
// * getValidPushTypes()
// * send(devices, installations, pushStatus)
//
// Default is ParsePushAdapter, which uses GCM for
// android push and APNS for ios push.

class PushAdapter {
  send(body, installations, pushStatus) {}

  /**
   * Get an array of valid push types.
   * @returns {Array} An array of valid push types
   */
  getValidPushTypes() {
    return [];
  }
}

exports.PushAdapter = PushAdapter;
exports.default = PushAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9QdXNoL1B1c2hBZGFwdGVyLmpzIl0sIm5hbWVzIjpbIlB1c2hBZGFwdGVyIiwic2VuZCIsImJvZHkiLCJpbnN0YWxsYXRpb25zIiwicHVzaFN0YXR1cyIsImdldFZhbGlkUHVzaFR5cGVzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVPLE1BQU1BLFdBQU4sQ0FBa0I7QUFDdkJDLE9BQUtDLElBQUwsRUFBZ0JDLGFBQWhCLEVBQXNDQyxVQUF0QyxFQUFvRSxDQUFFOztBQUV0RTs7OztBQUlBQyxzQkFBOEI7QUFDNUIsV0FBTyxFQUFQO0FBQ0Q7QUFUc0I7O1FBQVpMLFcsR0FBQUEsVztrQkFZRUEsVyIsImZpbGUiOiJQdXNoQWRhcHRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEBmbG93XG4vKmVzbGludCBuby11bnVzZWQtdmFyczogXCJvZmZcIiovXG4vLyBQdXNoIEFkYXB0ZXJcbi8vXG4vLyBBbGxvd3MgeW91IHRvIGNoYW5nZSB0aGUgcHVzaCBub3RpZmljYXRpb24gbWVjaGFuaXNtLlxuLy9cbi8vIEFkYXB0ZXIgY2xhc3NlcyBtdXN0IGltcGxlbWVudCB0aGUgZm9sbG93aW5nIGZ1bmN0aW9uczpcbi8vICogZ2V0VmFsaWRQdXNoVHlwZXMoKVxuLy8gKiBzZW5kKGRldmljZXMsIGluc3RhbGxhdGlvbnMsIHB1c2hTdGF0dXMpXG4vL1xuLy8gRGVmYXVsdCBpcyBQYXJzZVB1c2hBZGFwdGVyLCB3aGljaCB1c2VzIEdDTSBmb3Jcbi8vIGFuZHJvaWQgcHVzaCBhbmQgQVBOUyBmb3IgaW9zIHB1c2guXG5cbmV4cG9ydCBjbGFzcyBQdXNoQWRhcHRlciB7XG4gIHNlbmQoYm9keTogYW55LCBpbnN0YWxsYXRpb25zOiBhbnlbXSwgcHVzaFN0YXR1czogYW55KTogP1Byb21pc2U8Kj4ge31cblxuICAvKipcbiAgICogR2V0IGFuIGFycmF5IG9mIHZhbGlkIHB1c2ggdHlwZXMuXG4gICAqIEByZXR1cm5zIHtBcnJheX0gQW4gYXJyYXkgb2YgdmFsaWQgcHVzaCB0eXBlc1xuICAgKi9cbiAgZ2V0VmFsaWRQdXNoVHlwZXMoKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBbXVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFB1c2hBZGFwdGVyO1xuIl19