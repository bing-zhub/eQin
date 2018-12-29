'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _classCallCheck2 = require('babel-runtime/helpers/classCallCheck');

var _classCallCheck3 = _interopRequireDefault(_classCallCheck2);

var _createClass2 = require('babel-runtime/helpers/createClass');

var _createClass3 = _interopRequireDefault(_createClass2);

var _CoreManager = require('./CoreManager');

var _CoreManager2 = _interopRequireDefault(_CoreManager);

var _ParsePromise = require('./ParsePromise');

var _ParsePromise2 = _interopRequireDefault(_ParsePromise);

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

var FIELD_TYPES = ['String', 'Number', 'Boolean', 'Date', 'File', 'GeoPoint', 'Polygon', 'Array', 'Object', 'Pointer', 'Relation'];

/**
 * A Parse.Schema object is for handling schema data from Parse.
 * <p>All the schemas methods require MasterKey.
 *
 * <pre>
 * const schema = new Parse.Schema('MyClass');
 * schema.addString('field');
 * schema.addIndex('index_name', {'field', 1});
 * schema.save();
 * </pre>
 * </p>
 * @alias Parse.Schema
 */

var ParseSchema = function () {

  /**
   * @param {String} className Parse Class string.
   */
  function ParseSchema(className) {
    (0, _classCallCheck3.default)(this, ParseSchema);

    if (typeof className === 'string') {
      if (className === 'User' && _CoreManager2.default.get('PERFORM_USER_REWRITE')) {
        this.className = '_User';
      } else {
        this.className = className;
      }
    }

    this._fields = {};
    this._indexes = {};
  }

  /**
   * Static method to get all schemas
   *
   * @param {Object} options A Backbone-style options object.
   * Valid options are:<ul>
   *   <li>success: A Backbone-style success callback
   *   <li>error: An Backbone-style error callback.
   *   <li>useMasterKey: In Cloud Code and Node only, causes the Master Key to
   *     be used for this request.
   *   <li>sessionToken: A valid session token, used for making a request on
   *       behalf of a specific user.
   * </ul>
   *
   * @return {Parse.Promise} A promise that is resolved with the result when
   * the query completes.
   */

  (0, _createClass3.default)(ParseSchema, [{
    key: 'get',

    /**
     * Get the Schema from Parse
     *
     * @param {Object} options A Backbone-style options object.
     * Valid options are:<ul>
     *   <li>success: A Backbone-style success callback
     *   <li>error: An Backbone-style error callback.
     *   <li>useMasterKey: In Cloud Code and Node only, causes the Master Key to
     *     be used for this request.
     *   <li>sessionToken: A valid session token, used for making a request on
     *       behalf of a specific user.
     * </ul>
     *
     * @return {Parse.Promise} A promise that is resolved with the result when
     * the query completes.
     */
    value: function (options) {
      this.assertClassName();

      options = options || {};
      var controller = _CoreManager2.default.getSchemaController();

      return controller.get(this.className, options).then(function (response) {
        if (!response) {
          throw new Error('Schema not found.');
        }
        return response;
      })._thenRunCallbacks(options);
    }

    /**
     * Create a new Schema on Parse
     *
     * @param {Object} options A Backbone-style options object.
     * Valid options are:<ul>
     *   <li>success: A Backbone-style success callback
     *   <li>error: An Backbone-style error callback.
     *   <li>useMasterKey: In Cloud Code and Node only, causes the Master Key to
     *     be used for this request.
     *   <li>sessionToken: A valid session token, used for making a request on
     *       behalf of a specific user.
     * </ul>
     *
     * @return {Parse.Promise} A promise that is resolved with the result when
     * the query completes.
     */

  }, {
    key: 'save',
    value: function (options) {
      this.assertClassName();

      options = options || {};
      var controller = _CoreManager2.default.getSchemaController();
      var params = {
        className: this.className,
        fields: this._fields,
        indexes: this._indexes
      };

      return controller.create(this.className, params, options).then(function (response) {
        return response;
      })._thenRunCallbacks(options);
    }

    /**
     * Update a Schema on Parse
     *
     * @param {Object} options A Backbone-style options object.
     * Valid options are:<ul>
     *   <li>success: A Backbone-style success callback
     *   <li>error: An Backbone-style error callback.
     *   <li>useMasterKey: In Cloud Code and Node only, causes the Master Key to
     *     be used for this request.
     *   <li>sessionToken: A valid session token, used for making a request on
     *       behalf of a specific user.
     * </ul>
     *
     * @return {Parse.Promise} A promise that is resolved with the result when
     * the query completes.
     */

  }, {
    key: 'update',
    value: function (options) {
      this.assertClassName();

      options = options || {};
      var controller = _CoreManager2.default.getSchemaController();
      var params = {
        className: this.className,
        fields: this._fields,
        indexes: this._indexes
      };

      this._fields = {};
      this._indexes = {};

      return controller.update(this.className, params, options).then(function (response) {
        return response;
      })._thenRunCallbacks(options);
    }

    /**
     * Removing a Schema from Parse
     * Can only be used on Schema without objects
     *
     * @param {Object} options A Backbone-style options object.
     * Valid options are:<ul>
     *   <li>success: A Backbone-style success callback
     *   <li>error: An Backbone-style error callback.
     *   <li>useMasterKey: In Cloud Code and Node only, causes the Master Key to
     *     be used for this request.
     *   <li>sessionToken: A valid session token, used for making a request on
     *       behalf of a specific user.
     * </ul>
     *
     * @return {Parse.Promise} A promise that is resolved with the result when
     * the query completes.
     */

  }, {
    key: 'delete',
    value: function (options) {
      this.assertClassName();

      options = options || {};
      var controller = _CoreManager2.default.getSchemaController();

      return controller.delete(this.className, options).then(function (response) {
        return response;
      })._thenRunCallbacks(options);
    }

    /**
     * Removes all objects from a Schema (class) in Parse.
     * EXERCISE CAUTION, running this will delete all objects for this schema and cannot be reversed
     *
     * @param {Object} options A Backbone-style options object.
     * Valid options are:<ul>
     *   <li>success: A Backbone-style success callback
     *   <li>error: An Backbone-style error callback.
     *   <li>useMasterKey: In Cloud Code and Node only, causes the Master Key to
     *     be used for this request.
     *   <li>sessionToken: A valid session token, used for making a request on
     *       behalf of a specific user.
     * </ul>
     *
     * @return {Parse.Promise} A promise that is resolved with the result when
     * the query completes.
     */

  }, {
    key: 'purge',
    value: function (options) {
      this.assertClassName();

      var controller = _CoreManager2.default.getSchemaController();

      return controller.purge(this.className).then(function (response) {
        return response;
      })._thenRunCallbacks(options);
    }

    /**
     * Assert if ClassName has been filled
     * @private
     */

  }, {
    key: 'assertClassName',
    value: function () {
      if (!this.className) {
        throw new Error('You must set a Class Name before making any request.');
      }
    }

    /**
     * Adding a Field to Create / Update a Schema
     *
     * @param {String} name Name of the field that will be created on Parse
     * @param {String} type TheCan be a (String|Number|Boolean|Date|Parse.File|Parse.GeoPoint|Array|Object|Pointer|Parse.Relation)
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addField',
    value: function (name, type) {
      type = type || 'String';

      if (!name) {
        throw new Error('field name may not be null.');
      }
      if (FIELD_TYPES.indexOf(type) === -1) {
        throw new Error(type + ' is not a valid type.');
      }

      this._fields[name] = { type: type };

      return this;
    }

    /**
     * Adding an Index to Create / Update a Schema
     *
     * @param {String} name Name of the field that will be created on Parse
     * @param {String} type Can be a (String|Number|Boolean|Date|Parse.File|Parse.GeoPoint|Array|Object|Pointer|Parse.Relation)
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addIndex',
    value: function (name, index) {
      if (!name) {
        throw new Error('index name may not be null.');
      }
      if (!index) {
        throw new Error('index may not be null.');
      }

      this._indexes[name] = index;

      return this;
    }

    /**
     * Adding String Field
     *
     * @param {String} name Name of the field that will be created on Parse
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addString',
    value: function (name) {
      return this.addField(name, 'String');
    }

    /**
     * Adding Number Field
     *
     * @param {String} name Name of the field that will be created on Parse
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addNumber',
    value: function (name) {
      return this.addField(name, 'Number');
    }

    /**
     * Adding Boolean Field
     *
     * @param {String} name Name of the field that will be created on Parse
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addBoolean',
    value: function (name) {
      return this.addField(name, 'Boolean');
    }

    /**
     * Adding Date Field
     *
     * @param {String} name Name of the field that will be created on Parse
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addDate',
    value: function (name) {
      return this.addField(name, 'Date');
    }

    /**
     * Adding File Field
     *
     * @param {String} name Name of the field that will be created on Parse
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addFile',
    value: function (name) {
      return this.addField(name, 'File');
    }

    /**
     * Adding GeoPoint Field
     *
     * @param {String} name Name of the field that will be created on Parse
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addGeoPoint',
    value: function (name) {
      return this.addField(name, 'GeoPoint');
    }

    /**
     * Adding Polygon Field
     *
     * @param {String} name Name of the field that will be created on Parse
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addPolygon',
    value: function (name) {
      return this.addField(name, 'Polygon');
    }

    /**
     * Adding Array Field
     *
     * @param {String} name Name of the field that will be created on Parse
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addArray',
    value: function (name) {
      return this.addField(name, 'Array');
    }

    /**
     * Adding Object Field
     *
     * @param {String} name Name of the field that will be created on Parse
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addObject',
    value: function (name) {
      return this.addField(name, 'Object');
    }

    /**
     * Adding Pointer Field
     *
     * @param {String} name Name of the field that will be created on Parse
     * @param {String} targetClass Name of the target Pointer Class
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addPointer',
    value: function (name, targetClass) {
      if (!name) {
        throw new Error('field name may not be null.');
      }
      if (!targetClass) {
        throw new Error('You need to set the targetClass of the Pointer.');
      }

      this._fields[name] = {
        type: 'Pointer',
        targetClass: targetClass
      };

      return this;
    }

    /**
     * Adding Relation Field
     *
     * @param {String} name Name of the field that will be created on Parse
     * @param {String} targetClass Name of the target Pointer Class
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'addRelation',
    value: function (name, targetClass) {
      if (!name) {
        throw new Error('field name may not be null.');
      }
      if (!targetClass) {
        throw new Error('You need to set the targetClass of the Relation.');
      }

      this._fields[name] = {
        type: 'Relation',
        targetClass: targetClass
      };

      return this;
    }

    /**
     * Deleting a Field to Update on a Schema
     *
     * @param {String} name Name of the field that will be created on Parse
     * @param {String} targetClass Name of the target Pointer Class
     * @return {Parse.Schema} Returns the schema, so you can chain this call.
     */

  }, {
    key: 'deleteField',
    value: function (name) {
      this._fields[name] = { __op: 'Delete' };
    }

    /**
    * Deleting an Index to Update on a Schema
    *
    * @param {String} name Name of the field that will be created on Parse
    * @param {String} targetClass Name of the target Pointer Class
    * @return {Parse.Schema} Returns the schema, so you can chain this call.
    */

  }, {
    key: 'deleteIndex',
    value: function (name) {
      this._indexes[name] = { __op: 'Delete' };
    }
  }], [{
    key: 'all',
    value: function (options) {
      options = options || {};
      var controller = _CoreManager2.default.getSchemaController();

      return controller.get('', options).then(function (response) {
        if (response.results.length === 0) {
          throw new Error('Schema not found.');
        }
        return response.results;
      })._thenRunCallbacks(options);
    }
  }]);
  return ParseSchema;
}();

var DefaultController = {
  send: function (className, method, params, options) {
    var RESTController = _CoreManager2.default.getRESTController();
    var requestOptions = { useMasterKey: true };
    if (options.hasOwnProperty('sessionToken')) {
      requestOptions.sessionToken = options.sessionToken;
    }
    return RESTController.request(method, 'schemas/' + className, params, requestOptions);
  },
  get: function (className, options) {
    return this.send(className, 'GET', {}, options);
  },
  create: function (className, params, options) {
    return this.send(className, 'POST', params, options);
  },
  update: function (className, params, options) {
    return this.send(className, 'PUT', params, options);
  },
  delete: function (className, options) {
    return this.send(className, 'DELETE', {}, options);
  },
  purge: function (className) {
    var RESTController = _CoreManager2.default.getRESTController();
    return RESTController.request('DELETE', 'purge/' + className, {}, { useMasterKey: true });
  }
};

_CoreManager2.default.setSchemaController(DefaultController);

exports.default = ParseSchema;