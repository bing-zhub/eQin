'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _MongoCollection = require('./MongoCollection');

var _MongoCollection2 = _interopRequireDefault(_MongoCollection);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function mongoFieldToParseSchemaField(type) {
  if (type[0] === '*') {
    return {
      type: 'Pointer',
      targetClass: type.slice(1)
    };
  }
  if (type.startsWith('relation<')) {
    return {
      type: 'Relation',
      targetClass: type.slice('relation<'.length, type.length - 1)
    };
  }
  switch (type) {
    case 'number':
      return { type: 'Number' };
    case 'string':
      return { type: 'String' };
    case 'boolean':
      return { type: 'Boolean' };
    case 'date':
      return { type: 'Date' };
    case 'map':
    case 'object':
      return { type: 'Object' };
    case 'array':
      return { type: 'Array' };
    case 'geopoint':
      return { type: 'GeoPoint' };
    case 'file':
      return { type: 'File' };
    case 'bytes':
      return { type: 'Bytes' };
    case 'polygon':
      return { type: 'Polygon' };
  }
}

const nonFieldSchemaKeys = ['_id', '_metadata', '_client_permissions'];
function mongoSchemaFieldsToParseSchemaFields(schema) {
  var fieldNames = Object.keys(schema).filter(key => nonFieldSchemaKeys.indexOf(key) === -1);
  var response = fieldNames.reduce((obj, fieldName) => {
    obj[fieldName] = mongoFieldToParseSchemaField(schema[fieldName]);
    return obj;
  }, {});
  response.ACL = { type: 'ACL' };
  response.createdAt = { type: 'Date' };
  response.updatedAt = { type: 'Date' };
  response.objectId = { type: 'String' };
  return response;
}

const emptyCLPS = Object.freeze({
  find: {},
  get: {},
  create: {},
  update: {},
  delete: {},
  addField: {}
});

const defaultCLPS = Object.freeze({
  find: { '*': true },
  get: { '*': true },
  create: { '*': true },
  update: { '*': true },
  delete: { '*': true },
  addField: { '*': true }
});

function mongoSchemaToParseSchema(mongoSchema) {
  let clps = defaultCLPS;
  let indexes = {};
  if (mongoSchema._metadata) {
    if (mongoSchema._metadata.class_permissions) {
      clps = _extends({}, emptyCLPS, mongoSchema._metadata.class_permissions);
    }
    if (mongoSchema._metadata.indexes) {
      indexes = _extends({}, mongoSchema._metadata.indexes);
    }
  }
  return {
    className: mongoSchema._id,
    fields: mongoSchemaFieldsToParseSchemaFields(mongoSchema),
    classLevelPermissions: clps,
    indexes: indexes
  };
}

function _mongoSchemaQueryFromNameQuery(name, query) {
  const object = { _id: name };
  if (query) {
    Object.keys(query).forEach(key => {
      object[key] = query[key];
    });
  }
  return object;
}

// Returns a type suitable for inserting into mongo _SCHEMA collection.
// Does no validation. That is expected to be done in Parse Server.
function parseFieldTypeToMongoFieldType({ type, targetClass }) {
  switch (type) {
    case 'Pointer':
      return `*${targetClass}`;
    case 'Relation':
      return `relation<${targetClass}>`;
    case 'Number':
      return 'number';
    case 'String':
      return 'string';
    case 'Boolean':
      return 'boolean';
    case 'Date':
      return 'date';
    case 'Object':
      return 'object';
    case 'Array':
      return 'array';
    case 'GeoPoint':
      return 'geopoint';
    case 'File':
      return 'file';
    case 'Bytes':
      return 'bytes';
    case 'Polygon':
      return 'polygon';
  }
}

class MongoSchemaCollection {

  constructor(collection) {
    this._collection = collection;
  }

  _fetchAllSchemasFrom_SCHEMA() {
    return this._collection._rawFind({}).then(schemas => schemas.map(mongoSchemaToParseSchema));
  }

  _fetchOneSchemaFrom_SCHEMA(name) {
    return this._collection._rawFind(_mongoSchemaQueryFromNameQuery(name), { limit: 1 }).then(results => {
      if (results.length === 1) {
        return mongoSchemaToParseSchema(results[0]);
      } else {
        throw undefined;
      }
    });
  }

  // Atomically find and delete an object based on query.
  findAndDeleteSchema(name) {
    return this._collection._mongoCollection.findAndRemove(_mongoSchemaQueryFromNameQuery(name), []);
  }

  insertSchema(schema) {
    return this._collection.insertOne(schema).then(result => mongoSchemaToParseSchema(result.ops[0])).catch(error => {
      if (error.code === 11000) {
        //Mongo's duplicate key error
        throw new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'Class already exists.');
      } else {
        throw error;
      }
    });
  }

  updateSchema(name, update) {
    return this._collection.updateOne(_mongoSchemaQueryFromNameQuery(name), update);
  }

  upsertSchema(name, query, update) {
    return this._collection.upsertOne(_mongoSchemaQueryFromNameQuery(name, query), update);
  }

  // Add a field to the schema. If database does not support the field
  // type (e.g. mongo doesn't support more than one GeoPoint in a class) reject with an "Incorrect Type"
  // Parse error with a desciptive message. If the field already exists, this function must
  // not modify the schema, and must reject with DUPLICATE_VALUE error.
  // If this is called for a class that doesn't exist, this function must create that class.

  // TODO: throw an error if an unsupported field type is passed. Deciding whether a type is supported
  // should be the job of the adapter. Some adapters may not support GeoPoint at all. Others may
  // Support additional types that Mongo doesn't, like Money, or something.

  // TODO: don't spend an extra query on finding the schema if the type we are trying to add isn't a GeoPoint.
  addFieldIfNotExists(className, fieldName, type) {
    return this._fetchOneSchemaFrom_SCHEMA(className).then(schema => {
      // If a field with this name already exists, it will be handled elsewhere.
      if (schema.fields[fieldName] != undefined) {
        return;
      }
      // The schema exists. Check for existing GeoPoints.
      if (type.type === 'GeoPoint') {
        // Make sure there are not other geopoint fields
        if (Object.keys(schema.fields).some(existingField => schema.fields[existingField].type === 'GeoPoint')) {
          throw new _node2.default.Error(_node2.default.Error.INCORRECT_TYPE, 'MongoDB only supports one GeoPoint field in a class.');
        }
      }
      return;
    }, error => {
      // If error is undefined, the schema doesn't exist, and we can create the schema with the field.
      // If some other error, reject with it.
      if (error === undefined) {
        return;
      }
      throw error;
    }).then(() => {
      // We use $exists and $set to avoid overwriting the field type if it
      // already exists. (it could have added inbetween the last query and the update)
      return this.upsertSchema(className, { [fieldName]: { '$exists': false } }, { '$set': { [fieldName]: parseFieldTypeToMongoFieldType(type) } });
    });
  }
}

// Exported for testing reasons and because we haven't moved all mongo schema format
// related logic into the database adapter yet.
MongoSchemaCollection._TESTmongoSchemaToParseSchema = mongoSchemaToParseSchema;
MongoSchemaCollection.parseFieldTypeToMongoFieldType = parseFieldTypeToMongoFieldType;

exports.default = MongoSchemaCollection;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL01vbmdvL01vbmdvU2NoZW1hQ29sbGVjdGlvbi5qcyJdLCJuYW1lcyI6WyJtb25nb0ZpZWxkVG9QYXJzZVNjaGVtYUZpZWxkIiwidHlwZSIsInRhcmdldENsYXNzIiwic2xpY2UiLCJzdGFydHNXaXRoIiwibGVuZ3RoIiwibm9uRmllbGRTY2hlbWFLZXlzIiwibW9uZ29TY2hlbWFGaWVsZHNUb1BhcnNlU2NoZW1hRmllbGRzIiwic2NoZW1hIiwiZmllbGROYW1lcyIsIk9iamVjdCIsImtleXMiLCJmaWx0ZXIiLCJrZXkiLCJpbmRleE9mIiwicmVzcG9uc2UiLCJyZWR1Y2UiLCJvYmoiLCJmaWVsZE5hbWUiLCJBQ0wiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJvYmplY3RJZCIsImVtcHR5Q0xQUyIsImZyZWV6ZSIsImZpbmQiLCJnZXQiLCJjcmVhdGUiLCJ1cGRhdGUiLCJkZWxldGUiLCJhZGRGaWVsZCIsImRlZmF1bHRDTFBTIiwibW9uZ29TY2hlbWFUb1BhcnNlU2NoZW1hIiwibW9uZ29TY2hlbWEiLCJjbHBzIiwiaW5kZXhlcyIsIl9tZXRhZGF0YSIsImNsYXNzX3Blcm1pc3Npb25zIiwiY2xhc3NOYW1lIiwiX2lkIiwiZmllbGRzIiwiY2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiX21vbmdvU2NoZW1hUXVlcnlGcm9tTmFtZVF1ZXJ5IiwibmFtZSIsInF1ZXJ5Iiwib2JqZWN0IiwiZm9yRWFjaCIsInBhcnNlRmllbGRUeXBlVG9Nb25nb0ZpZWxkVHlwZSIsIk1vbmdvU2NoZW1hQ29sbGVjdGlvbiIsImNvbnN0cnVjdG9yIiwiY29sbGVjdGlvbiIsIl9jb2xsZWN0aW9uIiwiX2ZldGNoQWxsU2NoZW1hc0Zyb21fU0NIRU1BIiwiX3Jhd0ZpbmQiLCJ0aGVuIiwic2NoZW1hcyIsIm1hcCIsIl9mZXRjaE9uZVNjaGVtYUZyb21fU0NIRU1BIiwibGltaXQiLCJyZXN1bHRzIiwidW5kZWZpbmVkIiwiZmluZEFuZERlbGV0ZVNjaGVtYSIsIl9tb25nb0NvbGxlY3Rpb24iLCJmaW5kQW5kUmVtb3ZlIiwiaW5zZXJ0U2NoZW1hIiwiaW5zZXJ0T25lIiwicmVzdWx0Iiwib3BzIiwiY2F0Y2giLCJlcnJvciIsImNvZGUiLCJQYXJzZSIsIkVycm9yIiwiRFVQTElDQVRFX1ZBTFVFIiwidXBkYXRlU2NoZW1hIiwidXBkYXRlT25lIiwidXBzZXJ0U2NoZW1hIiwidXBzZXJ0T25lIiwiYWRkRmllbGRJZk5vdEV4aXN0cyIsInNvbWUiLCJleGlzdGluZ0ZpZWxkIiwiSU5DT1JSRUNUX1RZUEUiLCJfVEVTVG1vbmdvU2NoZW1hVG9QYXJzZVNjaGVtYSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFBQTs7OztBQUNBOzs7Ozs7QUFFQSxTQUFTQSw0QkFBVCxDQUFzQ0MsSUFBdEMsRUFBNEM7QUFDMUMsTUFBSUEsS0FBSyxDQUFMLE1BQVksR0FBaEIsRUFBcUI7QUFDbkIsV0FBTztBQUNMQSxZQUFNLFNBREQ7QUFFTEMsbUJBQWFELEtBQUtFLEtBQUwsQ0FBVyxDQUFYO0FBRlIsS0FBUDtBQUlEO0FBQ0QsTUFBSUYsS0FBS0csVUFBTCxDQUFnQixXQUFoQixDQUFKLEVBQWtDO0FBQ2hDLFdBQU87QUFDTEgsWUFBTSxVQUREO0FBRUxDLG1CQUFhRCxLQUFLRSxLQUFMLENBQVcsWUFBWUUsTUFBdkIsRUFBK0JKLEtBQUtJLE1BQUwsR0FBYyxDQUE3QztBQUZSLEtBQVA7QUFJRDtBQUNELFVBQVFKLElBQVI7QUFDQSxTQUFLLFFBQUw7QUFBaUIsYUFBTyxFQUFDQSxNQUFNLFFBQVAsRUFBUDtBQUNqQixTQUFLLFFBQUw7QUFBaUIsYUFBTyxFQUFDQSxNQUFNLFFBQVAsRUFBUDtBQUNqQixTQUFLLFNBQUw7QUFBaUIsYUFBTyxFQUFDQSxNQUFNLFNBQVAsRUFBUDtBQUNqQixTQUFLLE1BQUw7QUFBaUIsYUFBTyxFQUFDQSxNQUFNLE1BQVAsRUFBUDtBQUNqQixTQUFLLEtBQUw7QUFDQSxTQUFLLFFBQUw7QUFBaUIsYUFBTyxFQUFDQSxNQUFNLFFBQVAsRUFBUDtBQUNqQixTQUFLLE9BQUw7QUFBaUIsYUFBTyxFQUFDQSxNQUFNLE9BQVAsRUFBUDtBQUNqQixTQUFLLFVBQUw7QUFBaUIsYUFBTyxFQUFDQSxNQUFNLFVBQVAsRUFBUDtBQUNqQixTQUFLLE1BQUw7QUFBaUIsYUFBTyxFQUFDQSxNQUFNLE1BQVAsRUFBUDtBQUNqQixTQUFLLE9BQUw7QUFBaUIsYUFBTyxFQUFDQSxNQUFNLE9BQVAsRUFBUDtBQUNqQixTQUFLLFNBQUw7QUFBaUIsYUFBTyxFQUFDQSxNQUFNLFNBQVAsRUFBUDtBQVhqQjtBQWFEOztBQUVELE1BQU1LLHFCQUFxQixDQUFDLEtBQUQsRUFBUSxXQUFSLEVBQXFCLHFCQUFyQixDQUEzQjtBQUNBLFNBQVNDLG9DQUFULENBQThDQyxNQUE5QyxFQUFzRDtBQUNwRCxNQUFJQyxhQUFhQyxPQUFPQyxJQUFQLENBQVlILE1BQVosRUFBb0JJLE1BQXBCLENBQTJCQyxPQUFPUCxtQkFBbUJRLE9BQW5CLENBQTJCRCxHQUEzQixNQUFvQyxDQUFDLENBQXZFLENBQWpCO0FBQ0EsTUFBSUUsV0FBV04sV0FBV08sTUFBWCxDQUFrQixDQUFDQyxHQUFELEVBQU1DLFNBQU4sS0FBb0I7QUFDbkRELFFBQUlDLFNBQUosSUFBaUJsQiw2QkFBNkJRLE9BQU9VLFNBQVAsQ0FBN0IsQ0FBakI7QUFDQSxXQUFPRCxHQUFQO0FBQ0QsR0FIYyxFQUdaLEVBSFksQ0FBZjtBQUlBRixXQUFTSSxHQUFULEdBQWUsRUFBQ2xCLE1BQU0sS0FBUCxFQUFmO0FBQ0FjLFdBQVNLLFNBQVQsR0FBcUIsRUFBQ25CLE1BQU0sTUFBUCxFQUFyQjtBQUNBYyxXQUFTTSxTQUFULEdBQXFCLEVBQUNwQixNQUFNLE1BQVAsRUFBckI7QUFDQWMsV0FBU08sUUFBVCxHQUFvQixFQUFDckIsTUFBTSxRQUFQLEVBQXBCO0FBQ0EsU0FBT2MsUUFBUDtBQUNEOztBQUVELE1BQU1RLFlBQVliLE9BQU9jLE1BQVAsQ0FBYztBQUM5QkMsUUFBTSxFQUR3QjtBQUU5QkMsT0FBSyxFQUZ5QjtBQUc5QkMsVUFBUSxFQUhzQjtBQUk5QkMsVUFBUSxFQUpzQjtBQUs5QkMsVUFBUSxFQUxzQjtBQU05QkMsWUFBVTtBQU5vQixDQUFkLENBQWxCOztBQVNBLE1BQU1DLGNBQWNyQixPQUFPYyxNQUFQLENBQWM7QUFDaENDLFFBQU0sRUFBQyxLQUFLLElBQU4sRUFEMEI7QUFFaENDLE9BQUssRUFBQyxLQUFLLElBQU4sRUFGMkI7QUFHaENDLFVBQVEsRUFBQyxLQUFLLElBQU4sRUFId0I7QUFJaENDLFVBQVEsRUFBQyxLQUFLLElBQU4sRUFKd0I7QUFLaENDLFVBQVEsRUFBQyxLQUFLLElBQU4sRUFMd0I7QUFNaENDLFlBQVUsRUFBQyxLQUFLLElBQU47QUFOc0IsQ0FBZCxDQUFwQjs7QUFTQSxTQUFTRSx3QkFBVCxDQUFrQ0MsV0FBbEMsRUFBK0M7QUFDN0MsTUFBSUMsT0FBT0gsV0FBWDtBQUNBLE1BQUlJLFVBQVUsRUFBZDtBQUNBLE1BQUlGLFlBQVlHLFNBQWhCLEVBQTJCO0FBQ3pCLFFBQUlILFlBQVlHLFNBQVosQ0FBc0JDLGlCQUExQixFQUE2QztBQUMzQ0gsMEJBQVdYLFNBQVgsRUFBeUJVLFlBQVlHLFNBQVosQ0FBc0JDLGlCQUEvQztBQUNEO0FBQ0QsUUFBSUosWUFBWUcsU0FBWixDQUFzQkQsT0FBMUIsRUFBbUM7QUFDakNBLDZCQUFjRixZQUFZRyxTQUFaLENBQXNCRCxPQUFwQztBQUNEO0FBQ0Y7QUFDRCxTQUFPO0FBQ0xHLGVBQVdMLFlBQVlNLEdBRGxCO0FBRUxDLFlBQVFqQyxxQ0FBcUMwQixXQUFyQyxDQUZIO0FBR0xRLDJCQUF1QlAsSUFIbEI7QUFJTEMsYUFBU0E7QUFKSixHQUFQO0FBTUQ7O0FBRUQsU0FBU08sOEJBQVQsQ0FBd0NDLElBQXhDLEVBQXNEQyxLQUF0RCxFQUE2RDtBQUMzRCxRQUFNQyxTQUFTLEVBQUVOLEtBQUtJLElBQVAsRUFBZjtBQUNBLE1BQUlDLEtBQUosRUFBVztBQUNUbEMsV0FBT0MsSUFBUCxDQUFZaUMsS0FBWixFQUFtQkUsT0FBbkIsQ0FBMkJqQyxPQUFPO0FBQ2hDZ0MsYUFBT2hDLEdBQVAsSUFBYytCLE1BQU0vQixHQUFOLENBQWQ7QUFDRCxLQUZEO0FBR0Q7QUFDRCxTQUFPZ0MsTUFBUDtBQUNEOztBQUdEO0FBQ0E7QUFDQSxTQUFTRSw4QkFBVCxDQUF3QyxFQUFFOUMsSUFBRixFQUFRQyxXQUFSLEVBQXhDLEVBQStEO0FBQzdELFVBQVFELElBQVI7QUFDQSxTQUFLLFNBQUw7QUFBaUIsYUFBUSxJQUFHQyxXQUFZLEVBQXZCO0FBQ2pCLFNBQUssVUFBTDtBQUFpQixhQUFRLFlBQVdBLFdBQVksR0FBL0I7QUFDakIsU0FBSyxRQUFMO0FBQWlCLGFBQU8sUUFBUDtBQUNqQixTQUFLLFFBQUw7QUFBaUIsYUFBTyxRQUFQO0FBQ2pCLFNBQUssU0FBTDtBQUFpQixhQUFPLFNBQVA7QUFDakIsU0FBSyxNQUFMO0FBQWlCLGFBQU8sTUFBUDtBQUNqQixTQUFLLFFBQUw7QUFBaUIsYUFBTyxRQUFQO0FBQ2pCLFNBQUssT0FBTDtBQUFpQixhQUFPLE9BQVA7QUFDakIsU0FBSyxVQUFMO0FBQWlCLGFBQU8sVUFBUDtBQUNqQixTQUFLLE1BQUw7QUFBaUIsYUFBTyxNQUFQO0FBQ2pCLFNBQUssT0FBTDtBQUFpQixhQUFPLE9BQVA7QUFDakIsU0FBSyxTQUFMO0FBQWlCLGFBQU8sU0FBUDtBQVpqQjtBQWNEOztBQUVELE1BQU04QyxxQkFBTixDQUE0Qjs7QUFHMUJDLGNBQVlDLFVBQVosRUFBeUM7QUFDdkMsU0FBS0MsV0FBTCxHQUFtQkQsVUFBbkI7QUFDRDs7QUFFREUsZ0NBQThCO0FBQzVCLFdBQU8sS0FBS0QsV0FBTCxDQUFpQkUsUUFBakIsQ0FBMEIsRUFBMUIsRUFDSkMsSUFESSxDQUNDQyxXQUFXQSxRQUFRQyxHQUFSLENBQVl4Qix3QkFBWixDQURaLENBQVA7QUFFRDs7QUFFRHlCLDZCQUEyQmQsSUFBM0IsRUFBeUM7QUFDdkMsV0FBTyxLQUFLUSxXQUFMLENBQWlCRSxRQUFqQixDQUEwQlgsK0JBQStCQyxJQUEvQixDQUExQixFQUFnRSxFQUFFZSxPQUFPLENBQVQsRUFBaEUsRUFBOEVKLElBQTlFLENBQW1GSyxXQUFXO0FBQ25HLFVBQUlBLFFBQVF0RCxNQUFSLEtBQW1CLENBQXZCLEVBQTBCO0FBQ3hCLGVBQU8yQix5QkFBeUIyQixRQUFRLENBQVIsQ0FBekIsQ0FBUDtBQUNELE9BRkQsTUFFTztBQUNMLGNBQU1DLFNBQU47QUFDRDtBQUNGLEtBTk0sQ0FBUDtBQU9EOztBQUVEO0FBQ0FDLHNCQUFvQmxCLElBQXBCLEVBQWtDO0FBQ2hDLFdBQU8sS0FBS1EsV0FBTCxDQUFpQlcsZ0JBQWpCLENBQWtDQyxhQUFsQyxDQUFnRHJCLCtCQUErQkMsSUFBL0IsQ0FBaEQsRUFBc0YsRUFBdEYsQ0FBUDtBQUNEOztBQUVEcUIsZUFBYXhELE1BQWIsRUFBMEI7QUFDeEIsV0FBTyxLQUFLMkMsV0FBTCxDQUFpQmMsU0FBakIsQ0FBMkJ6RCxNQUEzQixFQUNKOEMsSUFESSxDQUNDWSxVQUFVbEMseUJBQXlCa0MsT0FBT0MsR0FBUCxDQUFXLENBQVgsQ0FBekIsQ0FEWCxFQUVKQyxLQUZJLENBRUVDLFNBQVM7QUFDZCxVQUFJQSxNQUFNQyxJQUFOLEtBQWUsS0FBbkIsRUFBMEI7QUFBRTtBQUMxQixjQUFNLElBQUlDLGVBQU1DLEtBQVYsQ0FBZ0JELGVBQU1DLEtBQU4sQ0FBWUMsZUFBNUIsRUFBNkMsdUJBQTdDLENBQU47QUFDRCxPQUZELE1BRU87QUFDTCxjQUFNSixLQUFOO0FBQ0Q7QUFDRixLQVJJLENBQVA7QUFTRDs7QUFFREssZUFBYS9CLElBQWIsRUFBMkJmLE1BQTNCLEVBQW1DO0FBQ2pDLFdBQU8sS0FBS3VCLFdBQUwsQ0FBaUJ3QixTQUFqQixDQUEyQmpDLCtCQUErQkMsSUFBL0IsQ0FBM0IsRUFBaUVmLE1BQWpFLENBQVA7QUFDRDs7QUFFRGdELGVBQWFqQyxJQUFiLEVBQTJCQyxLQUEzQixFQUEwQ2hCLE1BQTFDLEVBQWtEO0FBQ2hELFdBQU8sS0FBS3VCLFdBQUwsQ0FBaUIwQixTQUFqQixDQUEyQm5DLCtCQUErQkMsSUFBL0IsRUFBcUNDLEtBQXJDLENBQTNCLEVBQXdFaEIsTUFBeEUsQ0FBUDtBQUNEOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0FrRCxzQkFBb0J4QyxTQUFwQixFQUF1Q3BCLFNBQXZDLEVBQTBEakIsSUFBMUQsRUFBd0U7QUFDdEUsV0FBTyxLQUFLd0QsMEJBQUwsQ0FBZ0NuQixTQUFoQyxFQUNKZ0IsSUFESSxDQUNDOUMsVUFBVTtBQUNkO0FBQ0EsVUFBSUEsT0FBT2dDLE1BQVAsQ0FBY3RCLFNBQWQsS0FBNEIwQyxTQUFoQyxFQUEyQztBQUN6QztBQUNEO0FBQ0Q7QUFDQSxVQUFJM0QsS0FBS0EsSUFBTCxLQUFjLFVBQWxCLEVBQThCO0FBQzlCO0FBQ0UsWUFBSVMsT0FBT0MsSUFBUCxDQUFZSCxPQUFPZ0MsTUFBbkIsRUFBMkJ1QyxJQUEzQixDQUFnQ0MsaUJBQWlCeEUsT0FBT2dDLE1BQVAsQ0FBY3dDLGFBQWQsRUFBNkIvRSxJQUE3QixLQUFzQyxVQUF2RixDQUFKLEVBQXdHO0FBQ3RHLGdCQUFNLElBQUlzRSxlQUFNQyxLQUFWLENBQWdCRCxlQUFNQyxLQUFOLENBQVlTLGNBQTVCLEVBQTRDLHNEQUE1QyxDQUFOO0FBQ0Q7QUFDRjtBQUNEO0FBQ0QsS0FkSSxFQWNGWixTQUFTO0FBQ1o7QUFDQTtBQUNFLFVBQUlBLFVBQVVULFNBQWQsRUFBeUI7QUFDdkI7QUFDRDtBQUNELFlBQU1TLEtBQU47QUFDRCxLQXJCSSxFQXNCSmYsSUF0QkksQ0FzQkMsTUFBTTtBQUNaO0FBQ0E7QUFDRSxhQUFPLEtBQUtzQixZQUFMLENBQ0x0QyxTQURLLEVBRUwsRUFBRSxDQUFDcEIsU0FBRCxHQUFhLEVBQUUsV0FBVyxLQUFiLEVBQWYsRUFGSyxFQUdMLEVBQUUsUUFBUyxFQUFFLENBQUNBLFNBQUQsR0FBYTZCLCtCQUErQjlDLElBQS9CLENBQWYsRUFBWCxFQUhLLENBQVA7QUFLRCxLQTlCSSxDQUFQO0FBK0JEO0FBMUZ5Qjs7QUE2RjVCO0FBQ0E7QUFDQStDLHNCQUFzQmtDLDZCQUF0QixHQUFzRGxELHdCQUF0RDtBQUNBZ0Isc0JBQXNCRCw4QkFBdEIsR0FBdURBLDhCQUF2RDs7a0JBRWVDLHFCIiwiZmlsZSI6Ik1vbmdvU2NoZW1hQ29sbGVjdGlvbi5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBNb25nb0NvbGxlY3Rpb24gZnJvbSAnLi9Nb25nb0NvbGxlY3Rpb24nO1xuaW1wb3J0IFBhcnNlICAgICAgICAgICBmcm9tICdwYXJzZS9ub2RlJztcblxuZnVuY3Rpb24gbW9uZ29GaWVsZFRvUGFyc2VTY2hlbWFGaWVsZCh0eXBlKSB7XG4gIGlmICh0eXBlWzBdID09PSAnKicpIHtcbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogJ1BvaW50ZXInLFxuICAgICAgdGFyZ2V0Q2xhc3M6IHR5cGUuc2xpY2UoMSksXG4gICAgfTtcbiAgfVxuICBpZiAodHlwZS5zdGFydHNXaXRoKCdyZWxhdGlvbjwnKSkge1xuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiAnUmVsYXRpb24nLFxuICAgICAgdGFyZ2V0Q2xhc3M6IHR5cGUuc2xpY2UoJ3JlbGF0aW9uPCcubGVuZ3RoLCB0eXBlLmxlbmd0aCAtIDEpLFxuICAgIH07XG4gIH1cbiAgc3dpdGNoICh0eXBlKSB7XG4gIGNhc2UgJ251bWJlcic6ICAgcmV0dXJuIHt0eXBlOiAnTnVtYmVyJ307XG4gIGNhc2UgJ3N0cmluZyc6ICAgcmV0dXJuIHt0eXBlOiAnU3RyaW5nJ307XG4gIGNhc2UgJ2Jvb2xlYW4nOiAgcmV0dXJuIHt0eXBlOiAnQm9vbGVhbid9O1xuICBjYXNlICdkYXRlJzogICAgIHJldHVybiB7dHlwZTogJ0RhdGUnfTtcbiAgY2FzZSAnbWFwJzpcbiAgY2FzZSAnb2JqZWN0JzogICByZXR1cm4ge3R5cGU6ICdPYmplY3QnfTtcbiAgY2FzZSAnYXJyYXknOiAgICByZXR1cm4ge3R5cGU6ICdBcnJheSd9O1xuICBjYXNlICdnZW9wb2ludCc6IHJldHVybiB7dHlwZTogJ0dlb1BvaW50J307XG4gIGNhc2UgJ2ZpbGUnOiAgICAgcmV0dXJuIHt0eXBlOiAnRmlsZSd9O1xuICBjYXNlICdieXRlcyc6ICAgIHJldHVybiB7dHlwZTogJ0J5dGVzJ307XG4gIGNhc2UgJ3BvbHlnb24nOiAgcmV0dXJuIHt0eXBlOiAnUG9seWdvbid9O1xuICB9XG59XG5cbmNvbnN0IG5vbkZpZWxkU2NoZW1hS2V5cyA9IFsnX2lkJywgJ19tZXRhZGF0YScsICdfY2xpZW50X3Blcm1pc3Npb25zJ107XG5mdW5jdGlvbiBtb25nb1NjaGVtYUZpZWxkc1RvUGFyc2VTY2hlbWFGaWVsZHMoc2NoZW1hKSB7XG4gIHZhciBmaWVsZE5hbWVzID0gT2JqZWN0LmtleXMoc2NoZW1hKS5maWx0ZXIoa2V5ID0+IG5vbkZpZWxkU2NoZW1hS2V5cy5pbmRleE9mKGtleSkgPT09IC0xKTtcbiAgdmFyIHJlc3BvbnNlID0gZmllbGROYW1lcy5yZWR1Y2UoKG9iaiwgZmllbGROYW1lKSA9PiB7XG4gICAgb2JqW2ZpZWxkTmFtZV0gPSBtb25nb0ZpZWxkVG9QYXJzZVNjaGVtYUZpZWxkKHNjaGVtYVtmaWVsZE5hbWVdKVxuICAgIHJldHVybiBvYmo7XG4gIH0sIHt9KTtcbiAgcmVzcG9uc2UuQUNMID0ge3R5cGU6ICdBQ0wnfTtcbiAgcmVzcG9uc2UuY3JlYXRlZEF0ID0ge3R5cGU6ICdEYXRlJ307XG4gIHJlc3BvbnNlLnVwZGF0ZWRBdCA9IHt0eXBlOiAnRGF0ZSd9O1xuICByZXNwb25zZS5vYmplY3RJZCA9IHt0eXBlOiAnU3RyaW5nJ307XG4gIHJldHVybiByZXNwb25zZTtcbn1cblxuY29uc3QgZW1wdHlDTFBTID0gT2JqZWN0LmZyZWV6ZSh7XG4gIGZpbmQ6IHt9LFxuICBnZXQ6IHt9LFxuICBjcmVhdGU6IHt9LFxuICB1cGRhdGU6IHt9LFxuICBkZWxldGU6IHt9LFxuICBhZGRGaWVsZDoge30sXG59KTtcblxuY29uc3QgZGVmYXVsdENMUFMgPSBPYmplY3QuZnJlZXplKHtcbiAgZmluZDogeycqJzogdHJ1ZX0sXG4gIGdldDogeycqJzogdHJ1ZX0sXG4gIGNyZWF0ZTogeycqJzogdHJ1ZX0sXG4gIHVwZGF0ZTogeycqJzogdHJ1ZX0sXG4gIGRlbGV0ZTogeycqJzogdHJ1ZX0sXG4gIGFkZEZpZWxkOiB7JyonOiB0cnVlfSxcbn0pO1xuXG5mdW5jdGlvbiBtb25nb1NjaGVtYVRvUGFyc2VTY2hlbWEobW9uZ29TY2hlbWEpIHtcbiAgbGV0IGNscHMgPSBkZWZhdWx0Q0xQUztcbiAgbGV0IGluZGV4ZXMgPSB7fVxuICBpZiAobW9uZ29TY2hlbWEuX21ldGFkYXRhKSB7XG4gICAgaWYgKG1vbmdvU2NoZW1hLl9tZXRhZGF0YS5jbGFzc19wZXJtaXNzaW9ucykge1xuICAgICAgY2xwcyA9IHsuLi5lbXB0eUNMUFMsIC4uLm1vbmdvU2NoZW1hLl9tZXRhZGF0YS5jbGFzc19wZXJtaXNzaW9uc307XG4gICAgfVxuICAgIGlmIChtb25nb1NjaGVtYS5fbWV0YWRhdGEuaW5kZXhlcykge1xuICAgICAgaW5kZXhlcyA9IHsuLi5tb25nb1NjaGVtYS5fbWV0YWRhdGEuaW5kZXhlc307XG4gICAgfVxuICB9XG4gIHJldHVybiB7XG4gICAgY2xhc3NOYW1lOiBtb25nb1NjaGVtYS5faWQsXG4gICAgZmllbGRzOiBtb25nb1NjaGVtYUZpZWxkc1RvUGFyc2VTY2hlbWFGaWVsZHMobW9uZ29TY2hlbWEpLFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogY2xwcyxcbiAgICBpbmRleGVzOiBpbmRleGVzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBfbW9uZ29TY2hlbWFRdWVyeUZyb21OYW1lUXVlcnkobmFtZTogc3RyaW5nLCBxdWVyeSkge1xuICBjb25zdCBvYmplY3QgPSB7IF9pZDogbmFtZSB9O1xuICBpZiAocXVlcnkpIHtcbiAgICBPYmplY3Qua2V5cyhxdWVyeSkuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgb2JqZWN0W2tleV0gPSBxdWVyeVtrZXldO1xuICAgIH0pO1xuICB9XG4gIHJldHVybiBvYmplY3Q7XG59XG5cblxuLy8gUmV0dXJucyBhIHR5cGUgc3VpdGFibGUgZm9yIGluc2VydGluZyBpbnRvIG1vbmdvIF9TQ0hFTUEgY29sbGVjdGlvbi5cbi8vIERvZXMgbm8gdmFsaWRhdGlvbi4gVGhhdCBpcyBleHBlY3RlZCB0byBiZSBkb25lIGluIFBhcnNlIFNlcnZlci5cbmZ1bmN0aW9uIHBhcnNlRmllbGRUeXBlVG9Nb25nb0ZpZWxkVHlwZSh7IHR5cGUsIHRhcmdldENsYXNzIH0pIHtcbiAgc3dpdGNoICh0eXBlKSB7XG4gIGNhc2UgJ1BvaW50ZXInOiAgcmV0dXJuIGAqJHt0YXJnZXRDbGFzc31gO1xuICBjYXNlICdSZWxhdGlvbic6IHJldHVybiBgcmVsYXRpb248JHt0YXJnZXRDbGFzc30+YDtcbiAgY2FzZSAnTnVtYmVyJzogICByZXR1cm4gJ251bWJlcic7XG4gIGNhc2UgJ1N0cmluZyc6ICAgcmV0dXJuICdzdHJpbmcnO1xuICBjYXNlICdCb29sZWFuJzogIHJldHVybiAnYm9vbGVhbic7XG4gIGNhc2UgJ0RhdGUnOiAgICAgcmV0dXJuICdkYXRlJztcbiAgY2FzZSAnT2JqZWN0JzogICByZXR1cm4gJ29iamVjdCc7XG4gIGNhc2UgJ0FycmF5JzogICAgcmV0dXJuICdhcnJheSc7XG4gIGNhc2UgJ0dlb1BvaW50JzogcmV0dXJuICdnZW9wb2ludCc7XG4gIGNhc2UgJ0ZpbGUnOiAgICAgcmV0dXJuICdmaWxlJztcbiAgY2FzZSAnQnl0ZXMnOiAgICByZXR1cm4gJ2J5dGVzJztcbiAgY2FzZSAnUG9seWdvbic6ICByZXR1cm4gJ3BvbHlnb24nO1xuICB9XG59XG5cbmNsYXNzIE1vbmdvU2NoZW1hQ29sbGVjdGlvbiB7XG4gIF9jb2xsZWN0aW9uOiBNb25nb0NvbGxlY3Rpb247XG5cbiAgY29uc3RydWN0b3IoY29sbGVjdGlvbjogTW9uZ29Db2xsZWN0aW9uKSB7XG4gICAgdGhpcy5fY29sbGVjdGlvbiA9IGNvbGxlY3Rpb247XG4gIH1cblxuICBfZmV0Y2hBbGxTY2hlbWFzRnJvbV9TQ0hFTUEoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbGxlY3Rpb24uX3Jhd0ZpbmQoe30pXG4gICAgICAudGhlbihzY2hlbWFzID0+IHNjaGVtYXMubWFwKG1vbmdvU2NoZW1hVG9QYXJzZVNjaGVtYSkpO1xuICB9XG5cbiAgX2ZldGNoT25lU2NoZW1hRnJvbV9TQ0hFTUEobmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbGxlY3Rpb24uX3Jhd0ZpbmQoX21vbmdvU2NoZW1hUXVlcnlGcm9tTmFtZVF1ZXJ5KG5hbWUpLCB7IGxpbWl0OiAxIH0pLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICBpZiAocmVzdWx0cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgcmV0dXJuIG1vbmdvU2NoZW1hVG9QYXJzZVNjaGVtYShyZXN1bHRzWzBdKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIEF0b21pY2FsbHkgZmluZCBhbmQgZGVsZXRlIGFuIG9iamVjdCBiYXNlZCBvbiBxdWVyeS5cbiAgZmluZEFuZERlbGV0ZVNjaGVtYShuYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLmZpbmRBbmRSZW1vdmUoX21vbmdvU2NoZW1hUXVlcnlGcm9tTmFtZVF1ZXJ5KG5hbWUpLCBbXSk7XG4gIH1cblxuICBpbnNlcnRTY2hlbWEoc2NoZW1hOiBhbnkpIHtcbiAgICByZXR1cm4gdGhpcy5fY29sbGVjdGlvbi5pbnNlcnRPbmUoc2NoZW1hKVxuICAgICAgLnRoZW4ocmVzdWx0ID0+IG1vbmdvU2NoZW1hVG9QYXJzZVNjaGVtYShyZXN1bHQub3BzWzBdKSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSAxMTAwMCkgeyAvL01vbmdvJ3MgZHVwbGljYXRlIGtleSBlcnJvclxuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsICdDbGFzcyBhbHJlYWR5IGV4aXN0cy4nKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgfVxuXG4gIHVwZGF0ZVNjaGVtYShuYW1lOiBzdHJpbmcsIHVwZGF0ZSkge1xuICAgIHJldHVybiB0aGlzLl9jb2xsZWN0aW9uLnVwZGF0ZU9uZShfbW9uZ29TY2hlbWFRdWVyeUZyb21OYW1lUXVlcnkobmFtZSksIHVwZGF0ZSk7XG4gIH1cblxuICB1cHNlcnRTY2hlbWEobmFtZTogc3RyaW5nLCBxdWVyeTogc3RyaW5nLCB1cGRhdGUpIHtcbiAgICByZXR1cm4gdGhpcy5fY29sbGVjdGlvbi51cHNlcnRPbmUoX21vbmdvU2NoZW1hUXVlcnlGcm9tTmFtZVF1ZXJ5KG5hbWUsIHF1ZXJ5KSwgdXBkYXRlKTtcbiAgfVxuXG4gIC8vIEFkZCBhIGZpZWxkIHRvIHRoZSBzY2hlbWEuIElmIGRhdGFiYXNlIGRvZXMgbm90IHN1cHBvcnQgdGhlIGZpZWxkXG4gIC8vIHR5cGUgKGUuZy4gbW9uZ28gZG9lc24ndCBzdXBwb3J0IG1vcmUgdGhhbiBvbmUgR2VvUG9pbnQgaW4gYSBjbGFzcykgcmVqZWN0IHdpdGggYW4gXCJJbmNvcnJlY3QgVHlwZVwiXG4gIC8vIFBhcnNlIGVycm9yIHdpdGggYSBkZXNjaXB0aXZlIG1lc3NhZ2UuIElmIHRoZSBmaWVsZCBhbHJlYWR5IGV4aXN0cywgdGhpcyBmdW5jdGlvbiBtdXN0XG4gIC8vIG5vdCBtb2RpZnkgdGhlIHNjaGVtYSwgYW5kIG11c3QgcmVqZWN0IHdpdGggRFVQTElDQVRFX1ZBTFVFIGVycm9yLlxuICAvLyBJZiB0aGlzIGlzIGNhbGxlZCBmb3IgYSBjbGFzcyB0aGF0IGRvZXNuJ3QgZXhpc3QsIHRoaXMgZnVuY3Rpb24gbXVzdCBjcmVhdGUgdGhhdCBjbGFzcy5cblxuICAvLyBUT0RPOiB0aHJvdyBhbiBlcnJvciBpZiBhbiB1bnN1cHBvcnRlZCBmaWVsZCB0eXBlIGlzIHBhc3NlZC4gRGVjaWRpbmcgd2hldGhlciBhIHR5cGUgaXMgc3VwcG9ydGVkXG4gIC8vIHNob3VsZCBiZSB0aGUgam9iIG9mIHRoZSBhZGFwdGVyLiBTb21lIGFkYXB0ZXJzIG1heSBub3Qgc3VwcG9ydCBHZW9Qb2ludCBhdCBhbGwuIE90aGVycyBtYXlcbiAgLy8gU3VwcG9ydCBhZGRpdGlvbmFsIHR5cGVzIHRoYXQgTW9uZ28gZG9lc24ndCwgbGlrZSBNb25leSwgb3Igc29tZXRoaW5nLlxuXG4gIC8vIFRPRE86IGRvbid0IHNwZW5kIGFuIGV4dHJhIHF1ZXJ5IG9uIGZpbmRpbmcgdGhlIHNjaGVtYSBpZiB0aGUgdHlwZSB3ZSBhcmUgdHJ5aW5nIHRvIGFkZCBpc24ndCBhIEdlb1BvaW50LlxuICBhZGRGaWVsZElmTm90RXhpc3RzKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZE5hbWU6IHN0cmluZywgdHlwZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoT25lU2NoZW1hRnJvbV9TQ0hFTUEoY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oc2NoZW1hID0+IHtcbiAgICAgICAgLy8gSWYgYSBmaWVsZCB3aXRoIHRoaXMgbmFtZSBhbHJlYWR5IGV4aXN0cywgaXQgd2lsbCBiZSBoYW5kbGVkIGVsc2V3aGVyZS5cbiAgICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgLy8gVGhlIHNjaGVtYSBleGlzdHMuIENoZWNrIGZvciBleGlzdGluZyBHZW9Qb2ludHMuXG4gICAgICAgIGlmICh0eXBlLnR5cGUgPT09ICdHZW9Qb2ludCcpIHtcbiAgICAgICAgLy8gTWFrZSBzdXJlIHRoZXJlIGFyZSBub3Qgb3RoZXIgZ2VvcG9pbnQgZmllbGRzXG4gICAgICAgICAgaWYgKE9iamVjdC5rZXlzKHNjaGVtYS5maWVsZHMpLnNvbWUoZXhpc3RpbmdGaWVsZCA9PiBzY2hlbWEuZmllbGRzW2V4aXN0aW5nRmllbGRdLnR5cGUgPT09ICdHZW9Qb2ludCcpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsICdNb25nb0RCIG9ubHkgc3VwcG9ydHMgb25lIEdlb1BvaW50IGZpZWxkIGluIGEgY2xhc3MuJyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH0sIGVycm9yID0+IHtcbiAgICAgIC8vIElmIGVycm9yIGlzIHVuZGVmaW5lZCwgdGhlIHNjaGVtYSBkb2Vzbid0IGV4aXN0LCBhbmQgd2UgY2FuIGNyZWF0ZSB0aGUgc2NoZW1hIHdpdGggdGhlIGZpZWxkLlxuICAgICAgLy8gSWYgc29tZSBvdGhlciBlcnJvciwgcmVqZWN0IHdpdGggaXQuXG4gICAgICAgIGlmIChlcnJvciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgIC8vIFdlIHVzZSAkZXhpc3RzIGFuZCAkc2V0IHRvIGF2b2lkIG92ZXJ3cml0aW5nIHRoZSBmaWVsZCB0eXBlIGlmIGl0XG4gICAgICAvLyBhbHJlYWR5IGV4aXN0cy4gKGl0IGNvdWxkIGhhdmUgYWRkZWQgaW5iZXR3ZWVuIHRoZSBsYXN0IHF1ZXJ5IGFuZCB0aGUgdXBkYXRlKVxuICAgICAgICByZXR1cm4gdGhpcy51cHNlcnRTY2hlbWEoXG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIHsgW2ZpZWxkTmFtZV06IHsgJyRleGlzdHMnOiBmYWxzZSB9IH0sXG4gICAgICAgICAgeyAnJHNldCcgOiB7IFtmaWVsZE5hbWVdOiBwYXJzZUZpZWxkVHlwZVRvTW9uZ29GaWVsZFR5cGUodHlwZSkgfSB9XG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgfVxufVxuXG4vLyBFeHBvcnRlZCBmb3IgdGVzdGluZyByZWFzb25zIGFuZCBiZWNhdXNlIHdlIGhhdmVuJ3QgbW92ZWQgYWxsIG1vbmdvIHNjaGVtYSBmb3JtYXRcbi8vIHJlbGF0ZWQgbG9naWMgaW50byB0aGUgZGF0YWJhc2UgYWRhcHRlciB5ZXQuXG5Nb25nb1NjaGVtYUNvbGxlY3Rpb24uX1RFU1Rtb25nb1NjaGVtYVRvUGFyc2VTY2hlbWEgPSBtb25nb1NjaGVtYVRvUGFyc2VTY2hlbWFcbk1vbmdvU2NoZW1hQ29sbGVjdGlvbi5wYXJzZUZpZWxkVHlwZVRvTW9uZ29GaWVsZFR5cGUgPSBwYXJzZUZpZWxkVHlwZVRvTW9uZ29GaWVsZFR5cGVcblxuZXhwb3J0IGRlZmF1bHQgTW9uZ29TY2hlbWFDb2xsZWN0aW9uXG4iXX0=