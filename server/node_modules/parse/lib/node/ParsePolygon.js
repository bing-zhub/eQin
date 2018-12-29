'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _classCallCheck2 = require('babel-runtime/helpers/classCallCheck');

var _classCallCheck3 = _interopRequireDefault(_classCallCheck2);

var _createClass2 = require('babel-runtime/helpers/createClass');

var _createClass3 = _interopRequireDefault(_createClass2);

var _ParseGeoPoint = require('./ParseGeoPoint');

var _ParseGeoPoint2 = _interopRequireDefault(_ParseGeoPoint);

function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : { default: obj };
}

/**
 * Creates a new Polygon with any of the following forms:<br>
 *   <pre>
 *   new Polygon([[0,0],[0,1],[1,1],[1,0]])
 *   new Polygon([GeoPoint, GeoPoint, GeoPoint])
 *   </pre>
 *
 * <p>Represents a coordinates that may be associated
 * with a key in a ParseObject or used as a reference point for geo queries.
 * This allows proximity-based queries on the key.</p>
 *
 * <p>Example:<pre>
 *   var polygon = new Parse.Polygon([[0,0],[0,1],[1,1],[1,0]]);
 *   var object = new Parse.Object("PlaceObject");
 *   object.set("area", polygon);
 *   object.save();</pre></p>
 * @alias Parse.Polygon
 */
var ParsePolygon = function () {

  /**
   * @param {(Number[][]|Parse.GeoPoint[])} coordinates An Array of coordinate pairs
   */
  function ParsePolygon(arg1) {
    (0, _classCallCheck3.default)(this, ParsePolygon);

    this._coordinates = ParsePolygon._validate(arg1);
  }

  /**
   * Coordinates value for this Polygon.
   * Throws an exception if not valid type.
   * @property coordinates
   * @type Array
   */

  (0, _createClass3.default)(ParsePolygon, [{
    key: 'toJSON',

    /**
     * Returns a JSON representation of the Polygon, suitable for Parse.
     * @return {Object}
     */
    value: function () {
      ParsePolygon._validate(this._coordinates);
      return {
        __type: 'Polygon',
        coordinates: this._coordinates
      };
    }

    /**
     * Checks if two polygons are equal
     * @param {(Parse.Polygon|Object)} other
     * @returns {Boolean}
     */

  }, {
    key: 'equals',
    value: function (other) {
      if (!(other instanceof ParsePolygon) || this.coordinates.length !== other.coordinates.length) {
        return false;
      }
      var isEqual = true;

      for (var i = 1; i < this._coordinates.length; i += 1) {
        if (this._coordinates[i][0] != other.coordinates[i][0] || this._coordinates[i][1] != other.coordinates[i][1]) {
          isEqual = false;
          break;
        }
      }
      return isEqual;
    }

    /**
     *
     * @param {Parse.GeoPoint} point
     * @returns {Boolean} Returns if the point is contained in the polygon
     */

  }, {
    key: 'containsPoint',
    value: function (point) {
      var minX = this._coordinates[0][0];
      var maxX = this._coordinates[0][0];
      var minY = this._coordinates[0][1];
      var maxY = this._coordinates[0][1];

      for (var i = 1; i < this._coordinates.length; i += 1) {
        var p = this._coordinates[i];
        minX = Math.min(p[0], minX);
        maxX = Math.max(p[0], maxX);
        minY = Math.min(p[1], minY);
        maxY = Math.max(p[1], maxY);
      }

      var outside = point.latitude < minX || point.latitude > maxX || point.longitude < minY || point.longitude > maxY;
      if (outside) {
        return false;
      }

      var inside = false;
      for (var _i = 0, j = this._coordinates.length - 1; _i < this._coordinates.length; j = _i++) {
        var startX = this._coordinates[_i][0];
        var startY = this._coordinates[_i][1];
        var endX = this._coordinates[j][0];
        var endY = this._coordinates[j][1];

        var intersect = startY > point.longitude != endY > point.longitude && point.latitude < (endX - startX) * (point.longitude - startY) / (endY - startY) + startX;

        if (intersect) {
          inside = !inside;
        }
      }
      return inside;
    }

    /**
     * Validates that the list of coordinates can form a valid polygon
     * @param {Array} coords the list of coordinated to validate as a polygon
     * @throws {TypeError}
     */

  }, {
    key: 'coordinates',
    get: function () {
      return this._coordinates;
    },
    set: function (coords) {
      this._coordinates = ParsePolygon._validate(coords);
    }
  }], [{
    key: '_validate',
    value: function (coords) {
      if (!Array.isArray(coords)) {
        throw new TypeError('Coordinates must be an Array');
      }
      if (coords.length < 3) {
        throw new TypeError('Polygon must have at least 3 GeoPoints or Points');
      }
      var points = [];
      for (var i = 0; i < coords.length; i += 1) {
        var coord = coords[i];
        var geoPoint = void 0;
        if (coord instanceof _ParseGeoPoint2.default) {
          geoPoint = coord;
        } else if (Array.isArray(coord) && coord.length === 2) {
          geoPoint = new _ParseGeoPoint2.default(coord[0], coord[1]);
        } else {
          throw new TypeError('Coordinates must be an Array of GeoPoints or Points');
        }
        points.push([geoPoint.latitude, geoPoint.longitude]);
      }
      return points;
    }
  }]);
  return ParsePolygon;
}(); /**
      * Copyright (c) 2015-present, Parse, LLC.
      * All rights reserved.
      *
      * This source code is licensed under the BSD-style license found in the
      * LICENSE file in the root directory of this source tree. An additional grant
      * of patent rights can be found in the PATENTS file in the same directory.
      *
      * 
      */

exports.default = ParsePolygon;