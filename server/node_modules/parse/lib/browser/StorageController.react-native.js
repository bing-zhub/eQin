'use strict';

var _ParsePromise = require('./ParsePromise');

var _ParsePromise2 = _interopRequireDefault(_ParsePromise);

var _CoreManager = require('./CoreManager');

var _CoreManager2 = _interopRequireDefault(_CoreManager);

function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : { default: obj };
}

/**
 * Copyright (c) 2015-present, Parse, LLC.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * 
 */

var StorageController = {
  async: 1,

  getAsyncStorage: function () {
    return _CoreManager2.default.getAsyncStorage();
  },
  getItemAsync: function (path) {
    var p = new _ParsePromise2.default();
    this.getAsyncStorage().getItem(path, function (err, value) {
      if (err) {
        p.reject(err);
      } else {
        p.resolve(value);
      }
    });
    return p;
  },
  setItemAsync: function (path, value) {
    var p = new _ParsePromise2.default();
    this.getAsyncStorage().setItem(path, value, function (err) {
      if (err) {
        p.reject(err);
      } else {
        p.resolve(value);
      }
    });
    return p;
  },
  removeItemAsync: function (path) {
    var p = new _ParsePromise2.default();
    this.getAsyncStorage().removeItem(path, function (err) {
      if (err) {
        p.reject(err);
      } else {
        p.resolve();
      }
    });
    return p;
  },
  clear: function () {
    this.getAsyncStorage().clear();
  }
};

module.exports = StorageController;