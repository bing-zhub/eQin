'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SchemaController = exports.VolatileClassesSchemas = exports.convertSchemaToAdapterSchema = exports.defaultColumns = exports.systemClasses = exports.buildMergedSchemaObject = exports.invalidClassNameMessage = exports.fieldNameIsValid = exports.classNameIsValid = exports.load = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _StorageAdapter = require('../Adapters/Storage/StorageAdapter');

var _DatabaseController = require('./DatabaseController');

var _DatabaseController2 = _interopRequireDefault(_DatabaseController);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }

// This class handles schema validation, persistence, and modification.
//
// Each individual Schema object should be immutable. The helpers to
// do things with the Schema just return a new schema when the schema
// is changed.
//
// The canonical place to store this Schema is in the database itself,
// in a _SCHEMA collection. This is not the right way to do it for an
// open source framework, but it's backward compatible, so we're
// keeping it this way for now.
//
// In API-handling code, you should only use the Schema class via the
// DatabaseController. This will let us replace the schema logic for
// different databases.
// TODO: hide all schema logic inside the database adapter.
// -disable-next
const Parse = require('parse/node').Parse;


const defaultColumns = Object.freeze({
  // Contain the default columns for every parse object type (except _Join collection)
  _Default: {
    "objectId": { type: 'String' },
    "createdAt": { type: 'Date' },
    "updatedAt": { type: 'Date' },
    "ACL": { type: 'ACL' }
  },
  // The additional default columns for the _User collection (in addition to DefaultCols)
  _User: {
    "username": { type: 'String' },
    "password": { type: 'String' },
    "email": { type: 'String' },
    "emailVerified": { type: 'Boolean' },
    "authData": { type: 'Object' }
  },
  // The additional default columns for the _Installation collection (in addition to DefaultCols)
  _Installation: {
    "installationId": { type: 'String' },
    "deviceToken": { type: 'String' },
    "channels": { type: 'Array' },
    "deviceType": { type: 'String' },
    "pushType": { type: 'String' },
    "GCMSenderId": { type: 'String' },
    "timeZone": { type: 'String' },
    "localeIdentifier": { type: 'String' },
    "badge": { type: 'Number' },
    "appVersion": { type: 'String' },
    "appName": { type: 'String' },
    "appIdentifier": { type: 'String' },
    "parseVersion": { type: 'String' }
  },
  // The additional default columns for the _Role collection (in addition to DefaultCols)
  _Role: {
    "name": { type: 'String' },
    "users": { type: 'Relation', targetClass: '_User' },
    "roles": { type: 'Relation', targetClass: '_Role' }
  },
  // The additional default columns for the _Session collection (in addition to DefaultCols)
  _Session: {
    "restricted": { type: 'Boolean' },
    "user": { type: 'Pointer', targetClass: '_User' },
    "installationId": { type: 'String' },
    "sessionToken": { type: 'String' },
    "expiresAt": { type: 'Date' },
    "createdWith": { type: 'Object' }
  },
  _Product: {
    "productIdentifier": { type: 'String' },
    "download": { type: 'File' },
    "downloadName": { type: 'String' },
    "icon": { type: 'File' },
    "order": { type: 'Number' },
    "title": { type: 'String' },
    "subtitle": { type: 'String' }
  },
  _PushStatus: {
    "pushTime": { type: 'String' },
    "source": { type: 'String' }, // rest or webui
    "query": { type: 'String' }, // the stringified JSON query
    "payload": { type: 'String' }, // the stringified JSON payload,
    "title": { type: 'String' },
    "expiry": { type: 'Number' },
    "expiration_interval": { type: 'Number' },
    "status": { type: 'String' },
    "numSent": { type: 'Number' },
    "numFailed": { type: 'Number' },
    "pushHash": { type: 'String' },
    "errorMessage": { type: 'Object' },
    "sentPerType": { type: 'Object' },
    "failedPerType": { type: 'Object' },
    "sentPerUTCOffset": { type: 'Object' },
    "failedPerUTCOffset": { type: 'Object' },
    "count": { type: 'Number' // tracks # of batches queued and pending
    } },
  _JobStatus: {
    "jobName": { type: 'String' },
    "source": { type: 'String' },
    "status": { type: 'String' },
    "message": { type: 'String' },
    "params": { type: 'Object' }, // params received when calling the job
    "finishedAt": { type: 'Date' }
  },
  _JobSchedule: {
    "jobName": { type: 'String' },
    "description": { type: 'String' },
    "params": { type: 'String' },
    "startAfter": { type: 'String' },
    "daysOfWeek": { type: 'Array' },
    "timeOfDay": { type: 'String' },
    "lastRun": { type: 'Number' },
    "repeatMinutes": { type: 'Number' }
  },
  _Hooks: {
    "functionName": { type: 'String' },
    "className": { type: 'String' },
    "triggerName": { type: 'String' },
    "url": { type: 'String' }
  },
  _GlobalConfig: {
    "objectId": { type: 'String' },
    "params": { type: 'Object' }
  },
  _Audience: {
    "objectId": { type: 'String' },
    "name": { type: 'String' },
    "query": { type: 'String' }, //storing query as JSON string to prevent "Nested keys should not contain the '$' or '.' characters" error
    "lastUsed": { type: 'Date' },
    "timesUsed": { type: 'Number' }
  }
});

const requiredColumns = Object.freeze({
  _Product: ["productIdentifier", "icon", "order", "title", "subtitle"],
  _Role: ["name", "ACL"]
});

const systemClasses = Object.freeze(['_User', '_Installation', '_Role', '_Session', '_Product', '_PushStatus', '_JobStatus', '_JobSchedule', '_Audience']);

const volatileClasses = Object.freeze(['_JobStatus', '_PushStatus', '_Hooks', '_GlobalConfig', '_JobSchedule', '_Audience']);

// 10 alpha numberic chars + uppercase
const userIdRegex = /^[a-zA-Z0-9]{10}$/;
// Anything that start with role
const roleRegex = /^role:.*/;
// * permission
const publicRegex = /^\*$/;

const requireAuthenticationRegex = /^requiresAuthentication$/;

const permissionKeyRegex = Object.freeze([userIdRegex, roleRegex, publicRegex, requireAuthenticationRegex]);

function verifyPermissionKey(key) {
  const result = permissionKeyRegex.reduce((isGood, regEx) => {
    isGood = isGood || key.match(regEx) != null;
    return isGood;
  }, false);
  if (!result) {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `'${key}' is not a valid key for class level permissions`);
  }
}

const CLPValidKeys = Object.freeze(['find', 'count', 'get', 'create', 'update', 'delete', 'addField', 'readUserFields', 'writeUserFields']);
function validateCLP(perms, fields) {
  if (!perms) {
    return;
  }
  Object.keys(perms).forEach(operation => {
    if (CLPValidKeys.indexOf(operation) == -1) {
      throw new Parse.Error(Parse.Error.INVALID_JSON, `${operation} is not a valid operation for class level permissions`);
    }
    if (!perms[operation]) {
      return;
    }

    if (operation === 'readUserFields' || operation === 'writeUserFields') {
      if (!Array.isArray(perms[operation])) {
        // -disable-next
        throw new Parse.Error(Parse.Error.INVALID_JSON, `'${perms[operation]}' is not a valid value for class level permissions ${operation}`);
      } else {
        perms[operation].forEach(key => {
          if (!fields[key] || fields[key].type != 'Pointer' || fields[key].targetClass != '_User') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `'${key}' is not a valid column for class level pointer permissions ${operation}`);
          }
        });
      }
      return;
    }

    // -disable-next
    Object.keys(perms[operation]).forEach(key => {
      verifyPermissionKey(key);
      // -disable-next
      const perm = perms[operation][key];
      if (perm !== true) {
        // -disable-next
        throw new Parse.Error(Parse.Error.INVALID_JSON, `'${perm}' is not a valid value for class level permissions ${operation}:${key}:${perm}`);
      }
    });
  });
}
const joinClassRegex = /^_Join:[A-Za-z0-9_]+:[A-Za-z0-9_]+/;
const classAndFieldRegex = /^[A-Za-z][A-Za-z0-9_]*$/;
function classNameIsValid(className) {
  // Valid classes must:
  return (
    // Be one of _User, _Installation, _Role, _Session OR
    systemClasses.indexOf(className) > -1 ||
    // Be a join table OR
    joinClassRegex.test(className) ||
    // Include only alpha-numeric and underscores, and not start with an underscore or number
    fieldNameIsValid(className)
  );
}

// Valid fields must be alpha-numeric, and not start with an underscore or number
function fieldNameIsValid(fieldName) {
  return classAndFieldRegex.test(fieldName);
}

// Checks that it's not trying to clobber one of the default fields of the class.
function fieldNameIsValidForClass(fieldName, className) {
  if (!fieldNameIsValid(fieldName)) {
    return false;
  }
  if (defaultColumns._Default[fieldName]) {
    return false;
  }
  if (defaultColumns[className] && defaultColumns[className][fieldName]) {
    return false;
  }
  return true;
}

function invalidClassNameMessage(className) {
  return 'Invalid classname: ' + className + ', classnames can only have alphanumeric characters and _, and must start with an alpha character ';
}

const invalidJsonError = new Parse.Error(Parse.Error.INVALID_JSON, "invalid JSON");
const validNonRelationOrPointerTypes = ['Number', 'String', 'Boolean', 'Date', 'Object', 'Array', 'GeoPoint', 'File', 'Bytes', 'Polygon'];
// Returns an error suitable for throwing if the type is invalid
const fieldTypeIsInvalid = ({ type, targetClass }) => {
  if (['Pointer', 'Relation'].indexOf(type) >= 0) {
    if (!targetClass) {
      return new Parse.Error(135, `type ${type} needs a class name`);
    } else if (typeof targetClass !== 'string') {
      return invalidJsonError;
    } else if (!classNameIsValid(targetClass)) {
      return new Parse.Error(Parse.Error.INVALID_CLASS_NAME, invalidClassNameMessage(targetClass));
    } else {
      return undefined;
    }
  }
  if (typeof type !== 'string') {
    return invalidJsonError;
  }
  if (validNonRelationOrPointerTypes.indexOf(type) < 0) {
    return new Parse.Error(Parse.Error.INCORRECT_TYPE, `invalid field type: ${type}`);
  }
  return undefined;
};

const convertSchemaToAdapterSchema = schema => {
  schema = injectDefaultSchema(schema);
  delete schema.fields.ACL;
  schema.fields._rperm = { type: 'Array' };
  schema.fields._wperm = { type: 'Array' };

  if (schema.className === '_User') {
    delete schema.fields.password;
    schema.fields._hashed_password = { type: 'String' };
  }

  return schema;
};

const convertAdapterSchemaToParseSchema = (_ref) => {
  let schema = _objectWithoutProperties(_ref, []);

  delete schema.fields._rperm;
  delete schema.fields._wperm;

  schema.fields.ACL = { type: 'ACL' };

  if (schema.className === '_User') {
    delete schema.fields.authData; //Auth data is implicit
    delete schema.fields._hashed_password;
    schema.fields.password = { type: 'String' };
  }

  if (schema.indexes && Object.keys(schema.indexes).length === 0) {
    delete schema.indexes;
  }

  return schema;
};

const injectDefaultSchema = ({ className, fields, classLevelPermissions, indexes }) => {
  const defaultSchema = {
    className,
    fields: _extends({}, defaultColumns._Default, defaultColumns[className] || {}, fields),
    classLevelPermissions
  };
  if (indexes && Object.keys(indexes).length !== 0) {
    defaultSchema.indexes = indexes;
  }
  return defaultSchema;
};

const _HooksSchema = { className: "_Hooks", fields: defaultColumns._Hooks };
const _GlobalConfigSchema = { className: "_GlobalConfig", fields: defaultColumns._GlobalConfig };
const _PushStatusSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: "_PushStatus",
  fields: {},
  classLevelPermissions: {}
}));
const _JobStatusSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: "_JobStatus",
  fields: {},
  classLevelPermissions: {}
}));
const _JobScheduleSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: "_JobSchedule",
  fields: {},
  classLevelPermissions: {}
}));
const _AudienceSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: "_Audience",
  fields: defaultColumns._Audience,
  classLevelPermissions: {}
}));
const VolatileClassesSchemas = [_HooksSchema, _JobStatusSchema, _JobScheduleSchema, _PushStatusSchema, _GlobalConfigSchema, _AudienceSchema];

const dbTypeMatchesObjectType = (dbType, objectType) => {
  if (dbType.type !== objectType.type) return false;
  if (dbType.targetClass !== objectType.targetClass) return false;
  if (dbType === objectType.type) return true;
  if (dbType.type === objectType.type) return true;
  return false;
};

const typeToString = type => {
  if (typeof type === 'string') {
    return type;
  }
  if (type.targetClass) {
    return `${type.type}<${type.targetClass}>`;
  }
  return `${type.type}`;
};

// Stores the entire schema of the app in a weird hybrid format somewhere between
// the mongo format and the Parse format. Soon, this will all be Parse format.
class SchemaController {

  constructor(databaseAdapter, schemaCache) {
    this._dbAdapter = databaseAdapter;
    this._cache = schemaCache;
    // this.data[className][fieldName] tells you the type of that field, in mongo format
    this.data = {};
    // this.perms[className][operation] tells you the acl-style permissions
    this.perms = {};
    // this.indexes[className][operation] tells you the indexes
    this.indexes = {};
  }

  reloadData(options = { clearCache: false }) {
    let promise = Promise.resolve();
    if (options.clearCache) {
      promise = promise.then(() => {
        return this._cache.clear();
      });
    }
    if (this.reloadDataPromise && !options.clearCache) {
      return this.reloadDataPromise;
    }
    this.reloadDataPromise = promise.then(() => {
      return this.getAllClasses(options).then(allSchemas => {
        const data = {};
        const perms = {};
        const indexes = {};
        allSchemas.forEach(schema => {
          data[schema.className] = injectDefaultSchema(schema).fields;
          perms[schema.className] = schema.classLevelPermissions;
          indexes[schema.className] = schema.indexes;
        });

        // Inject the in-memory classes
        volatileClasses.forEach(className => {
          const schema = injectDefaultSchema({ className, fields: {}, classLevelPermissions: {} });
          data[className] = schema.fields;
          perms[className] = schema.classLevelPermissions;
          indexes[className] = schema.indexes;
        });
        this.data = data;
        this.perms = perms;
        this.indexes = indexes;
        delete this.reloadDataPromise;
      }, err => {
        this.data = {};
        this.perms = {};
        this.indexes = {};
        delete this.reloadDataPromise;
        throw err;
      });
    }).then(() => {});
    return this.reloadDataPromise;
  }

  getAllClasses(options = { clearCache: false }) {
    let promise = Promise.resolve();
    if (options.clearCache) {
      promise = this._cache.clear();
    }
    return promise.then(() => {
      return this._cache.getAllClasses();
    }).then(allClasses => {
      if (allClasses && allClasses.length && !options.clearCache) {
        return Promise.resolve(allClasses);
      }
      return this._dbAdapter.getAllClasses().then(allSchemas => allSchemas.map(injectDefaultSchema)).then(allSchemas => {
        return this._cache.setAllClasses(allSchemas).then(() => {
          return allSchemas;
        });
      });
    });
  }

  getOneSchema(className, allowVolatileClasses = false, options = { clearCache: false }) {
    let promise = Promise.resolve();
    if (options.clearCache) {
      promise = this._cache.clear();
    }
    return promise.then(() => {
      if (allowVolatileClasses && volatileClasses.indexOf(className) > -1) {
        return Promise.resolve({
          className,
          fields: this.data[className],
          classLevelPermissions: this.perms[className],
          indexes: this.indexes[className]
        });
      }
      return this._cache.getOneSchema(className).then(cached => {
        if (cached && !options.clearCache) {
          return Promise.resolve(cached);
        }
        return this._dbAdapter.getClass(className).then(injectDefaultSchema).then(result => {
          return this._cache.setOneSchema(className, result).then(() => {
            return result;
          });
        });
      });
    });
  }

  // Create a new class that includes the three default fields.
  // ACL is an implicit column that does not get an entry in the
  // _SCHEMAS database. Returns a promise that resolves with the
  // created schema, in mongo format.
  // on success, and rejects with an error on fail. Ensure you
  // have authorization (master key, or client class creation
  // enabled) before calling this function.
  addClassIfNotExists(className, fields = {}, classLevelPermissions, indexes = {}) {
    var validationError = this.validateNewClass(className, fields, classLevelPermissions);
    if (validationError) {
      return Promise.reject(validationError);
    }

    return this._dbAdapter.createClass(className, convertSchemaToAdapterSchema({ fields, classLevelPermissions, indexes, className })).then(convertAdapterSchemaToParseSchema).then(res => {
      return this._cache.clear().then(() => {
        return Promise.resolve(res);
      });
    }).catch(error => {
      if (error && error.code === Parse.Error.DUPLICATE_VALUE) {
        throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} already exists.`);
      } else {
        throw error;
      }
    });
  }

  updateClass(className, submittedFields, classLevelPermissions, indexes, database) {
    return this.getOneSchema(className).then(schema => {
      const existingFields = schema.fields;
      Object.keys(submittedFields).forEach(name => {
        const field = submittedFields[name];
        if (existingFields[name] && field.__op !== 'Delete') {
          throw new Parse.Error(255, `Field ${name} exists, cannot update.`);
        }
        if (!existingFields[name] && field.__op === 'Delete') {
          throw new Parse.Error(255, `Field ${name} does not exist, cannot delete.`);
        }
      });

      delete existingFields._rperm;
      delete existingFields._wperm;
      const newSchema = buildMergedSchemaObject(existingFields, submittedFields);
      const defaultFields = defaultColumns[className] || defaultColumns._Default;
      const fullNewSchema = Object.assign({}, newSchema, defaultFields);
      const validationError = this.validateSchemaData(className, newSchema, classLevelPermissions, Object.keys(existingFields));
      if (validationError) {
        throw new Parse.Error(validationError.code, validationError.error);
      }

      // Finally we have checked to make sure the request is valid and we can start deleting fields.
      // Do all deletions first, then a single save to _SCHEMA collection to handle all additions.
      const deletedFields = [];
      const insertedFields = [];
      Object.keys(submittedFields).forEach(fieldName => {
        if (submittedFields[fieldName].__op === 'Delete') {
          deletedFields.push(fieldName);
        } else {
          insertedFields.push(fieldName);
        }
      });

      let deletePromise = Promise.resolve();
      if (deletedFields.length > 0) {
        deletePromise = this.deleteFields(deletedFields, className, database);
      }
      return deletePromise // Delete Everything
      .then(() => this.reloadData({ clearCache: true })) // Reload our Schema, so we have all the new values
      .then(() => {
        const promises = insertedFields.map(fieldName => {
          const type = submittedFields[fieldName];
          return this.enforceFieldExists(className, fieldName, type);
        });
        return Promise.all(promises);
      }).then(() => this.setPermissions(className, classLevelPermissions, newSchema)).then(() => this._dbAdapter.setIndexesWithSchemaFormat(className, indexes, schema.indexes, fullNewSchema)).then(() => this.reloadData({ clearCache: true }))
      //TODO: Move this logic into the database adapter
      .then(() => {
        const reloadedSchema = {
          className: className,
          fields: this.data[className],
          classLevelPermissions: this.perms[className]
        };
        if (this.indexes[className] && Object.keys(this.indexes[className]).length !== 0) {
          reloadedSchema.indexes = this.indexes[className];
        }
        return reloadedSchema;
      });
    }).catch(error => {
      if (error === undefined) {
        throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} does not exist.`);
      } else {
        throw error;
      }
    });
  }

  // Returns a promise that resolves successfully to the new schema
  // object or fails with a reason.
  enforceClassExists(className) {
    if (this.data[className]) {
      return Promise.resolve(this);
    }
    // We don't have this class. Update the schema
    return this.addClassIfNotExists(className)
    // The schema update succeeded. Reload the schema
    .then(() => this.reloadData({ clearCache: true })).catch(() => {
      // The schema update failed. This can be okay - it might
      // have failed because there's a race condition and a different
      // client is making the exact same schema update that we want.
      // So just reload the schema.
      return this.reloadData({ clearCache: true });
    }).then(() => {
      // Ensure that the schema now validates
      if (this.data[className]) {
        return this;
      } else {
        throw new Parse.Error(Parse.Error.INVALID_JSON, `Failed to add ${className}`);
      }
    }).catch(() => {
      // The schema still doesn't validate. Give up
      throw new Parse.Error(Parse.Error.INVALID_JSON, 'schema class name does not revalidate');
    });
  }

  validateNewClass(className, fields = {}, classLevelPermissions) {
    if (this.data[className]) {
      throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} already exists.`);
    }
    if (!classNameIsValid(className)) {
      return {
        code: Parse.Error.INVALID_CLASS_NAME,
        error: invalidClassNameMessage(className)
      };
    }
    return this.validateSchemaData(className, fields, classLevelPermissions, []);
  }

  validateSchemaData(className, fields, classLevelPermissions, existingFieldNames) {
    for (const fieldName in fields) {
      if (existingFieldNames.indexOf(fieldName) < 0) {
        if (!fieldNameIsValid(fieldName)) {
          return {
            code: Parse.Error.INVALID_KEY_NAME,
            error: 'invalid field name: ' + fieldName
          };
        }
        if (!fieldNameIsValidForClass(fieldName, className)) {
          return {
            code: 136,
            error: 'field ' + fieldName + ' cannot be added'
          };
        }
        const error = fieldTypeIsInvalid(fields[fieldName]);
        if (error) return { code: error.code, error: error.message };
      }
    }

    for (const fieldName in defaultColumns[className]) {
      fields[fieldName] = defaultColumns[className][fieldName];
    }

    const geoPoints = Object.keys(fields).filter(key => fields[key] && fields[key].type === 'GeoPoint');
    if (geoPoints.length > 1) {
      return {
        code: Parse.Error.INCORRECT_TYPE,
        error: 'currently, only one GeoPoint field may exist in an object. Adding ' + geoPoints[1] + ' when ' + geoPoints[0] + ' already exists.'
      };
    }
    validateCLP(classLevelPermissions, fields);
  }

  // Sets the Class-level permissions for a given className, which must exist.
  setPermissions(className, perms, newSchema) {
    if (typeof perms === 'undefined') {
      return Promise.resolve();
    }
    validateCLP(perms, newSchema);
    return this._dbAdapter.setClassLevelPermissions(className, perms);
  }

  // Returns a promise that resolves successfully to the new schema
  // object if the provided className-fieldName-type tuple is valid.
  // The className must already be validated.
  // If 'freeze' is true, refuse to update the schema for this field.
  enforceFieldExists(className, fieldName, type) {
    if (fieldName.indexOf(".") > 0) {
      // subdocument key (x.y) => ok if x is of type 'object'
      fieldName = fieldName.split(".")[0];
      type = 'Object';
    }
    if (!fieldNameIsValid(fieldName)) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, `Invalid field name: ${fieldName}.`);
    }

    // If someone tries to create a new field with null/undefined as the value, return;
    if (!type) {
      return Promise.resolve(this);
    }

    return this.reloadData().then(() => {
      const expectedType = this.getExpectedType(className, fieldName);
      if (typeof type === 'string') {
        type = { type };
      }

      if (expectedType) {
        if (!dbTypeMatchesObjectType(expectedType, type)) {
          throw new Parse.Error(Parse.Error.INCORRECT_TYPE, `schema mismatch for ${className}.${fieldName}; expected ${typeToString(expectedType)} but got ${typeToString(type)}`);
        }
        return this;
      }

      return this._dbAdapter.addFieldIfNotExists(className, fieldName, type).then(() => {
        // The update succeeded. Reload the schema
        return this.reloadData({ clearCache: true });
      }, error => {
        if (error.code == Parse.Error.INCORRECT_TYPE) {
          // Make sure that we throw errors when it is appropriate to do so.
          throw error;
        }
        // The update failed. This can be okay - it might have been a race
        // condition where another client updated the schema in the same
        // way that we wanted to. So, just reload the schema
        return this.reloadData({ clearCache: true });
      }).then(() => {
        // Ensure that the schema now validates
        const expectedType = this.getExpectedType(className, fieldName);
        if (typeof type === 'string') {
          type = { type };
        }
        if (!expectedType || !dbTypeMatchesObjectType(expectedType, type)) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, `Could not add field ${fieldName}`);
        }
        // Remove the cached schema
        this._cache.clear();
        return this;
      });
    });
  }

  // maintain compatibility
  deleteField(fieldName, className, database) {
    return this.deleteFields([fieldName], className, database);
  }

  // Delete fields, and remove that data from all objects. This is intended
  // to remove unused fields, if other writers are writing objects that include
  // this field, the field may reappear. Returns a Promise that resolves with
  // no object on success, or rejects with { code, error } on failure.
  // Passing the database and prefix is necessary in order to drop relation collections
  // and remove fields from objects. Ideally the database would belong to
  // a database adapter and this function would close over it or access it via member.
  deleteFields(fieldNames, className, database) {
    if (!classNameIsValid(className)) {
      throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, invalidClassNameMessage(className));
    }

    fieldNames.forEach(fieldName => {
      if (!fieldNameIsValid(fieldName)) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, `invalid field name: ${fieldName}`);
      }
      //Don't allow deleting the default fields.
      if (!fieldNameIsValidForClass(fieldName, className)) {
        throw new Parse.Error(136, `field ${fieldName} cannot be changed`);
      }
    });

    return this.getOneSchema(className, false, { clearCache: true }).catch(error => {
      if (error === undefined) {
        throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} does not exist.`);
      } else {
        throw error;
      }
    }).then(schema => {
      fieldNames.forEach(fieldName => {
        if (!schema.fields[fieldName]) {
          throw new Parse.Error(255, `Field ${fieldName} does not exist, cannot delete.`);
        }
      });

      const schemaFields = _extends({}, schema.fields);
      return database.adapter.deleteFields(className, schema, fieldNames).then(() => {
        return Promise.all(fieldNames.map(fieldName => {
          const field = schemaFields[fieldName];
          if (field && field.type === 'Relation') {
            //For relations, drop the _Join table
            return database.adapter.deleteClass(`_Join:${fieldName}:${className}`);
          }
          return Promise.resolve();
        }));
      });
    }).then(() => {
      this._cache.clear();
    });
  }

  // Validates an object provided in REST format.
  // Returns a promise that resolves to the new schema if this object is
  // valid.
  validateObject(className, object, query) {
    let geocount = 0;
    let promise = this.enforceClassExists(className);
    for (const fieldName in object) {
      if (object[fieldName] === undefined) {
        continue;
      }
      const expected = getType(object[fieldName]);
      if (expected === 'GeoPoint') {
        geocount++;
      }
      if (geocount > 1) {
        // Make sure all field validation operations run before we return.
        // If not - we are continuing to run logic, but already provided response from the server.
        return promise.then(() => {
          return Promise.reject(new Parse.Error(Parse.Error.INCORRECT_TYPE, 'there can only be one geopoint field in a class'));
        });
      }
      if (!expected) {
        continue;
      }
      if (fieldName === 'ACL') {
        // Every object has ACL implicitly.
        continue;
      }

      promise = promise.then(schema => schema.enforceFieldExists(className, fieldName, expected));
    }
    promise = thenValidateRequiredColumns(promise, className, object, query);
    return promise;
  }

  // Validates that all the properties are set for the object
  validateRequiredColumns(className, object, query) {
    const columns = requiredColumns[className];
    if (!columns || columns.length == 0) {
      return Promise.resolve(this);
    }

    const missingColumns = columns.filter(function (column) {
      if (query && query.objectId) {
        if (object[column] && typeof object[column] === "object") {
          // Trying to delete a required column
          return object[column].__op == 'Delete';
        }
        // Not trying to do anything there
        return false;
      }
      return !object[column];
    });

    if (missingColumns.length > 0) {
      throw new Parse.Error(Parse.Error.INCORRECT_TYPE, missingColumns[0] + ' is required.');
    }
    return Promise.resolve(this);
  }

  // Validates the base CLP for an operation
  testBaseCLP(className, aclGroup, operation) {
    if (!this.perms[className] || !this.perms[className][operation]) {
      return true;
    }
    const classPerms = this.perms[className];
    const perms = classPerms[operation];
    // Handle the public scenario quickly
    if (perms['*']) {
      return true;
    }
    // Check permissions against the aclGroup provided (array of userId/roles)
    if (aclGroup.some(acl => {
      return perms[acl] === true;
    })) {
      return true;
    }
    return false;
  }

  // Validates an operation passes class-level-permissions set in the schema
  validatePermission(className, aclGroup, operation) {

    if (this.testBaseCLP(className, aclGroup, operation)) {
      return Promise.resolve();
    }

    if (!this.perms[className] || !this.perms[className][operation]) {
      return true;
    }
    const classPerms = this.perms[className];
    const perms = classPerms[operation];

    // If only for authenticated users
    // make sure we have an aclGroup
    if (perms['requiresAuthentication']) {
      // If aclGroup has * (public)
      if (!aclGroup || aclGroup.length == 0) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Permission denied, user needs to be authenticated.');
      } else if (aclGroup.indexOf('*') > -1 && aclGroup.length == 1) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Permission denied, user needs to be authenticated.');
      }
      // requiresAuthentication passed, just move forward
      // probably would be wise at some point to rename to 'authenticatedUser'
      return Promise.resolve();
    }

    // No matching CLP, let's check the Pointer permissions
    // And handle those later
    const permissionField = ['get', 'find', 'count'].indexOf(operation) > -1 ? 'readUserFields' : 'writeUserFields';

    // Reject create when write lockdown
    if (permissionField == 'writeUserFields' && operation == 'create') {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `Permission denied for action ${operation} on class ${className}.`);
    }

    // Process the readUserFields later
    if (Array.isArray(classPerms[permissionField]) && classPerms[permissionField].length > 0) {
      return Promise.resolve();
    }
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `Permission denied for action ${operation} on class ${className}.`);
  }

  // Returns the expected type for a className+key combination
  // or undefined if the schema is not set
  getExpectedType(className, fieldName) {
    if (this.data && this.data[className]) {
      const expectedType = this.data[className][fieldName];
      return expectedType === 'map' ? 'Object' : expectedType;
    }
    return undefined;
  }

  // Checks if a given class is in the schema.
  hasClass(className) {
    return this.reloadData().then(() => !!this.data[className]);
  }
}

exports.default = SchemaController; // Returns a promise for a new Schema.

const load = (dbAdapter, schemaCache, options) => {
  const schema = new SchemaController(dbAdapter, schemaCache);
  return schema.reloadData(options).then(() => schema);
};

// Builds a new schema (in schema API response format) out of an
// existing mongo schema + a schemas API put request. This response
// does not include the default fields, as it is intended to be passed
// to mongoSchemaFromFieldsAndClassName. No validation is done here, it
// is done in mongoSchemaFromFieldsAndClassName.
function buildMergedSchemaObject(existingFields, putRequest) {
  const newSchema = {};
  // -disable-next
  const sysSchemaField = Object.keys(defaultColumns).indexOf(existingFields._id) === -1 ? [] : Object.keys(defaultColumns[existingFields._id]);
  for (const oldField in existingFields) {
    if (oldField !== '_id' && oldField !== 'ACL' && oldField !== 'updatedAt' && oldField !== 'createdAt' && oldField !== 'objectId') {
      if (sysSchemaField.length > 0 && sysSchemaField.indexOf(oldField) !== -1) {
        continue;
      }
      const fieldIsDeleted = putRequest[oldField] && putRequest[oldField].__op === 'Delete';
      if (!fieldIsDeleted) {
        newSchema[oldField] = existingFields[oldField];
      }
    }
  }
  for (const newField in putRequest) {
    if (newField !== 'objectId' && putRequest[newField].__op !== 'Delete') {
      if (sysSchemaField.length > 0 && sysSchemaField.indexOf(newField) !== -1) {
        continue;
      }
      newSchema[newField] = putRequest[newField];
    }
  }
  return newSchema;
}

// Given a schema promise, construct another schema promise that
// validates this field once the schema loads.
function thenValidateRequiredColumns(schemaPromise, className, object, query) {
  return schemaPromise.then(schema => {
    return schema.validateRequiredColumns(className, object, query);
  });
}

// Gets the type from a REST API formatted object, where 'type' is
// extended past javascript types to include the rest of the Parse
// type system.
// The output should be a valid schema value.
// TODO: ensure that this is compatible with the format used in Open DB
function getType(obj) {
  const type = typeof obj;
  switch (type) {
    case 'boolean':
      return 'Boolean';
    case 'string':
      return 'String';
    case 'number':
      return 'Number';
    case 'map':
    case 'object':
      if (!obj) {
        return undefined;
      }
      return getObjectType(obj);
    case 'function':
    case 'symbol':
    case 'undefined':
    default:
      throw 'bad obj: ' + obj;
  }
}

// This gets the type for non-JSON types like pointers and files, but
// also gets the appropriate type for $ operators.
// Returns null if the type is unknown.
function getObjectType(obj) {
  if (obj instanceof Array) {
    return 'Array';
  }
  if (obj.__type) {
    switch (obj.__type) {
      case 'Pointer':
        if (obj.className) {
          return {
            type: 'Pointer',
            targetClass: obj.className
          };
        }
        break;
      case 'Relation':
        if (obj.className) {
          return {
            type: 'Relation',
            targetClass: obj.className
          };
        }
        break;
      case 'File':
        if (obj.name) {
          return 'File';
        }
        break;
      case 'Date':
        if (obj.iso) {
          return 'Date';
        }
        break;
      case 'GeoPoint':
        if (obj.latitude != null && obj.longitude != null) {
          return 'GeoPoint';
        }
        break;
      case 'Bytes':
        if (obj.base64) {
          return 'Bytes';
        }
        break;
      case 'Polygon':
        if (obj.coordinates) {
          return 'Polygon';
        }
        break;
    }
    throw new Parse.Error(Parse.Error.INCORRECT_TYPE, "This is not a valid " + obj.__type);
  }
  if (obj['$ne']) {
    return getObjectType(obj['$ne']);
  }
  if (obj.__op) {
    switch (obj.__op) {
      case 'Increment':
        return 'Number';
      case 'Delete':
        return null;
      case 'Add':
      case 'AddUnique':
      case 'Remove':
        return 'Array';
      case 'AddRelation':
      case 'RemoveRelation':
        return {
          type: 'Relation',
          targetClass: obj.objects[0].className
        };
      case 'Batch':
        return getObjectType(obj.ops[0]);
      default:
        throw 'unexpected op: ' + obj.__op;
    }
  }
  return 'Object';
}

exports.load = load;
exports.classNameIsValid = classNameIsValid;
exports.fieldNameIsValid = fieldNameIsValid;
exports.invalidClassNameMessage = invalidClassNameMessage;
exports.buildMergedSchemaObject = buildMergedSchemaObject;
exports.systemClasses = systemClasses;
exports.defaultColumns = defaultColumns;
exports.convertSchemaToAdapterSchema = convertSchemaToAdapterSchema;
exports.VolatileClassesSchemas = VolatileClassesSchemas;
exports.SchemaController = SchemaController;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9TY2hlbWFDb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbIlBhcnNlIiwicmVxdWlyZSIsImRlZmF1bHRDb2x1bW5zIiwiT2JqZWN0IiwiZnJlZXplIiwiX0RlZmF1bHQiLCJ0eXBlIiwiX1VzZXIiLCJfSW5zdGFsbGF0aW9uIiwiX1JvbGUiLCJ0YXJnZXRDbGFzcyIsIl9TZXNzaW9uIiwiX1Byb2R1Y3QiLCJfUHVzaFN0YXR1cyIsIl9Kb2JTdGF0dXMiLCJfSm9iU2NoZWR1bGUiLCJfSG9va3MiLCJfR2xvYmFsQ29uZmlnIiwiX0F1ZGllbmNlIiwicmVxdWlyZWRDb2x1bW5zIiwic3lzdGVtQ2xhc3NlcyIsInZvbGF0aWxlQ2xhc3NlcyIsInVzZXJJZFJlZ2V4Iiwicm9sZVJlZ2V4IiwicHVibGljUmVnZXgiLCJyZXF1aXJlQXV0aGVudGljYXRpb25SZWdleCIsInBlcm1pc3Npb25LZXlSZWdleCIsInZlcmlmeVBlcm1pc3Npb25LZXkiLCJrZXkiLCJyZXN1bHQiLCJyZWR1Y2UiLCJpc0dvb2QiLCJyZWdFeCIsIm1hdGNoIiwiRXJyb3IiLCJJTlZBTElEX0pTT04iLCJDTFBWYWxpZEtleXMiLCJ2YWxpZGF0ZUNMUCIsInBlcm1zIiwiZmllbGRzIiwia2V5cyIsImZvckVhY2giLCJvcGVyYXRpb24iLCJpbmRleE9mIiwiQXJyYXkiLCJpc0FycmF5IiwicGVybSIsImpvaW5DbGFzc1JlZ2V4IiwiY2xhc3NBbmRGaWVsZFJlZ2V4IiwiY2xhc3NOYW1lSXNWYWxpZCIsImNsYXNzTmFtZSIsInRlc3QiLCJmaWVsZE5hbWVJc1ZhbGlkIiwiZmllbGROYW1lIiwiZmllbGROYW1lSXNWYWxpZEZvckNsYXNzIiwiaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UiLCJpbnZhbGlkSnNvbkVycm9yIiwidmFsaWROb25SZWxhdGlvbk9yUG9pbnRlclR5cGVzIiwiZmllbGRUeXBlSXNJbnZhbGlkIiwiSU5WQUxJRF9DTEFTU19OQU1FIiwidW5kZWZpbmVkIiwiSU5DT1JSRUNUX1RZUEUiLCJjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hIiwic2NoZW1hIiwiaW5qZWN0RGVmYXVsdFNjaGVtYSIsIkFDTCIsIl9ycGVybSIsIl93cGVybSIsInBhc3N3b3JkIiwiX2hhc2hlZF9wYXNzd29yZCIsImNvbnZlcnRBZGFwdGVyU2NoZW1hVG9QYXJzZVNjaGVtYSIsImF1dGhEYXRhIiwiaW5kZXhlcyIsImxlbmd0aCIsImNsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsImRlZmF1bHRTY2hlbWEiLCJfSG9va3NTY2hlbWEiLCJfR2xvYmFsQ29uZmlnU2NoZW1hIiwiX1B1c2hTdGF0dXNTY2hlbWEiLCJfSm9iU3RhdHVzU2NoZW1hIiwiX0pvYlNjaGVkdWxlU2NoZW1hIiwiX0F1ZGllbmNlU2NoZW1hIiwiVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyIsImRiVHlwZU1hdGNoZXNPYmplY3RUeXBlIiwiZGJUeXBlIiwib2JqZWN0VHlwZSIsInR5cGVUb1N0cmluZyIsIlNjaGVtYUNvbnRyb2xsZXIiLCJjb25zdHJ1Y3RvciIsImRhdGFiYXNlQWRhcHRlciIsInNjaGVtYUNhY2hlIiwiX2RiQWRhcHRlciIsIl9jYWNoZSIsImRhdGEiLCJyZWxvYWREYXRhIiwib3B0aW9ucyIsImNsZWFyQ2FjaGUiLCJwcm9taXNlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJ0aGVuIiwiY2xlYXIiLCJyZWxvYWREYXRhUHJvbWlzZSIsImdldEFsbENsYXNzZXMiLCJhbGxTY2hlbWFzIiwiZXJyIiwiYWxsQ2xhc3NlcyIsIm1hcCIsInNldEFsbENsYXNzZXMiLCJnZXRPbmVTY2hlbWEiLCJhbGxvd1ZvbGF0aWxlQ2xhc3NlcyIsImNhY2hlZCIsImdldENsYXNzIiwic2V0T25lU2NoZW1hIiwiYWRkQ2xhc3NJZk5vdEV4aXN0cyIsInZhbGlkYXRpb25FcnJvciIsInZhbGlkYXRlTmV3Q2xhc3MiLCJyZWplY3QiLCJjcmVhdGVDbGFzcyIsInJlcyIsImNhdGNoIiwiZXJyb3IiLCJjb2RlIiwiRFVQTElDQVRFX1ZBTFVFIiwidXBkYXRlQ2xhc3MiLCJzdWJtaXR0ZWRGaWVsZHMiLCJkYXRhYmFzZSIsImV4aXN0aW5nRmllbGRzIiwibmFtZSIsImZpZWxkIiwiX19vcCIsIm5ld1NjaGVtYSIsImJ1aWxkTWVyZ2VkU2NoZW1hT2JqZWN0IiwiZGVmYXVsdEZpZWxkcyIsImZ1bGxOZXdTY2hlbWEiLCJhc3NpZ24iLCJ2YWxpZGF0ZVNjaGVtYURhdGEiLCJkZWxldGVkRmllbGRzIiwiaW5zZXJ0ZWRGaWVsZHMiLCJwdXNoIiwiZGVsZXRlUHJvbWlzZSIsImRlbGV0ZUZpZWxkcyIsInByb21pc2VzIiwiZW5mb3JjZUZpZWxkRXhpc3RzIiwiYWxsIiwic2V0UGVybWlzc2lvbnMiLCJzZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdCIsInJlbG9hZGVkU2NoZW1hIiwiZW5mb3JjZUNsYXNzRXhpc3RzIiwiZXhpc3RpbmdGaWVsZE5hbWVzIiwiSU5WQUxJRF9LRVlfTkFNRSIsIm1lc3NhZ2UiLCJnZW9Qb2ludHMiLCJmaWx0ZXIiLCJzZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJzcGxpdCIsImV4cGVjdGVkVHlwZSIsImdldEV4cGVjdGVkVHlwZSIsImFkZEZpZWxkSWZOb3RFeGlzdHMiLCJkZWxldGVGaWVsZCIsImZpZWxkTmFtZXMiLCJzY2hlbWFGaWVsZHMiLCJhZGFwdGVyIiwiZGVsZXRlQ2xhc3MiLCJ2YWxpZGF0ZU9iamVjdCIsIm9iamVjdCIsInF1ZXJ5IiwiZ2VvY291bnQiLCJleHBlY3RlZCIsImdldFR5cGUiLCJ0aGVuVmFsaWRhdGVSZXF1aXJlZENvbHVtbnMiLCJ2YWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyIsImNvbHVtbnMiLCJtaXNzaW5nQ29sdW1ucyIsImNvbHVtbiIsIm9iamVjdElkIiwidGVzdEJhc2VDTFAiLCJhY2xHcm91cCIsImNsYXNzUGVybXMiLCJzb21lIiwiYWNsIiwidmFsaWRhdGVQZXJtaXNzaW9uIiwiT0JKRUNUX05PVF9GT1VORCIsInBlcm1pc3Npb25GaWVsZCIsIk9QRVJBVElPTl9GT1JCSURERU4iLCJoYXNDbGFzcyIsImxvYWQiLCJkYkFkYXB0ZXIiLCJwdXRSZXF1ZXN0Iiwic3lzU2NoZW1hRmllbGQiLCJfaWQiLCJvbGRGaWVsZCIsImZpZWxkSXNEZWxldGVkIiwibmV3RmllbGQiLCJzY2hlbWFQcm9taXNlIiwib2JqIiwiZ2V0T2JqZWN0VHlwZSIsIl9fdHlwZSIsImlzbyIsImxhdGl0dWRlIiwibG9uZ2l0dWRlIiwiYmFzZTY0IiwiY29vcmRpbmF0ZXMiLCJvYmplY3RzIiwib3BzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFrQkE7O0FBQ0E7Ozs7Ozs7O0FBbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsTUFBTUEsUUFBUUMsUUFBUSxZQUFSLEVBQXNCRCxLQUFwQzs7O0FBV0EsTUFBTUUsaUJBQTJDQyxPQUFPQyxNQUFQLENBQWM7QUFDN0Q7QUFDQUMsWUFBVTtBQUNSLGdCQUFhLEVBQUNDLE1BQUssUUFBTixFQURMO0FBRVIsaUJBQWEsRUFBQ0EsTUFBSyxNQUFOLEVBRkw7QUFHUixpQkFBYSxFQUFDQSxNQUFLLE1BQU4sRUFITDtBQUlSLFdBQWEsRUFBQ0EsTUFBSyxLQUFOO0FBSkwsR0FGbUQ7QUFRN0Q7QUFDQUMsU0FBTztBQUNMLGdCQUFpQixFQUFDRCxNQUFLLFFBQU4sRUFEWjtBQUVMLGdCQUFpQixFQUFDQSxNQUFLLFFBQU4sRUFGWjtBQUdMLGFBQWlCLEVBQUNBLE1BQUssUUFBTixFQUhaO0FBSUwscUJBQWlCLEVBQUNBLE1BQUssU0FBTixFQUpaO0FBS0wsZ0JBQWlCLEVBQUNBLE1BQUssUUFBTjtBQUxaLEdBVHNEO0FBZ0I3RDtBQUNBRSxpQkFBZTtBQUNiLHNCQUFvQixFQUFDRixNQUFLLFFBQU4sRUFEUDtBQUViLG1CQUFvQixFQUFDQSxNQUFLLFFBQU4sRUFGUDtBQUdiLGdCQUFvQixFQUFDQSxNQUFLLE9BQU4sRUFIUDtBQUliLGtCQUFvQixFQUFDQSxNQUFLLFFBQU4sRUFKUDtBQUtiLGdCQUFvQixFQUFDQSxNQUFLLFFBQU4sRUFMUDtBQU1iLG1CQUFvQixFQUFDQSxNQUFLLFFBQU4sRUFOUDtBQU9iLGdCQUFvQixFQUFDQSxNQUFLLFFBQU4sRUFQUDtBQVFiLHdCQUFvQixFQUFDQSxNQUFLLFFBQU4sRUFSUDtBQVNiLGFBQW9CLEVBQUNBLE1BQUssUUFBTixFQVRQO0FBVWIsa0JBQW9CLEVBQUNBLE1BQUssUUFBTixFQVZQO0FBV2IsZUFBb0IsRUFBQ0EsTUFBSyxRQUFOLEVBWFA7QUFZYixxQkFBb0IsRUFBQ0EsTUFBSyxRQUFOLEVBWlA7QUFhYixvQkFBb0IsRUFBQ0EsTUFBSyxRQUFOO0FBYlAsR0FqQjhDO0FBZ0M3RDtBQUNBRyxTQUFPO0FBQ0wsWUFBUyxFQUFDSCxNQUFLLFFBQU4sRUFESjtBQUVMLGFBQVMsRUFBQ0EsTUFBSyxVQUFOLEVBQWtCSSxhQUFZLE9BQTlCLEVBRko7QUFHTCxhQUFTLEVBQUNKLE1BQUssVUFBTixFQUFrQkksYUFBWSxPQUE5QjtBQUhKLEdBakNzRDtBQXNDN0Q7QUFDQUMsWUFBVTtBQUNSLGtCQUFrQixFQUFDTCxNQUFLLFNBQU4sRUFEVjtBQUVSLFlBQWtCLEVBQUNBLE1BQUssU0FBTixFQUFpQkksYUFBWSxPQUE3QixFQUZWO0FBR1Isc0JBQWtCLEVBQUNKLE1BQUssUUFBTixFQUhWO0FBSVIsb0JBQWtCLEVBQUNBLE1BQUssUUFBTixFQUpWO0FBS1IsaUJBQWtCLEVBQUNBLE1BQUssTUFBTixFQUxWO0FBTVIsbUJBQWtCLEVBQUNBLE1BQUssUUFBTjtBQU5WLEdBdkNtRDtBQStDN0RNLFlBQVU7QUFDUix5QkFBc0IsRUFBQ04sTUFBSyxRQUFOLEVBRGQ7QUFFUixnQkFBc0IsRUFBQ0EsTUFBSyxNQUFOLEVBRmQ7QUFHUixvQkFBc0IsRUFBQ0EsTUFBSyxRQUFOLEVBSGQ7QUFJUixZQUFzQixFQUFDQSxNQUFLLE1BQU4sRUFKZDtBQUtSLGFBQXNCLEVBQUNBLE1BQUssUUFBTixFQUxkO0FBTVIsYUFBc0IsRUFBQ0EsTUFBSyxRQUFOLEVBTmQ7QUFPUixnQkFBc0IsRUFBQ0EsTUFBSyxRQUFOO0FBUGQsR0EvQ21EO0FBd0Q3RE8sZUFBYTtBQUNYLGdCQUF1QixFQUFDUCxNQUFLLFFBQU4sRUFEWjtBQUVYLGNBQXVCLEVBQUNBLE1BQUssUUFBTixFQUZaLEVBRTZCO0FBQ3hDLGFBQXVCLEVBQUNBLE1BQUssUUFBTixFQUhaLEVBRzZCO0FBQ3hDLGVBQXVCLEVBQUNBLE1BQUssUUFBTixFQUpaLEVBSTZCO0FBQ3hDLGFBQXVCLEVBQUNBLE1BQUssUUFBTixFQUxaO0FBTVgsY0FBdUIsRUFBQ0EsTUFBSyxRQUFOLEVBTlo7QUFPWCwyQkFBdUIsRUFBQ0EsTUFBSyxRQUFOLEVBUFo7QUFRWCxjQUF1QixFQUFDQSxNQUFLLFFBQU4sRUFSWjtBQVNYLGVBQXVCLEVBQUNBLE1BQUssUUFBTixFQVRaO0FBVVgsaUJBQXVCLEVBQUNBLE1BQUssUUFBTixFQVZaO0FBV1gsZ0JBQXVCLEVBQUNBLE1BQUssUUFBTixFQVhaO0FBWVgsb0JBQXVCLEVBQUNBLE1BQUssUUFBTixFQVpaO0FBYVgsbUJBQXVCLEVBQUNBLE1BQUssUUFBTixFQWJaO0FBY1gscUJBQXVCLEVBQUNBLE1BQUssUUFBTixFQWRaO0FBZVgsd0JBQXVCLEVBQUNBLE1BQUssUUFBTixFQWZaO0FBZ0JYLDBCQUF1QixFQUFDQSxNQUFLLFFBQU4sRUFoQlo7QUFpQlgsYUFBdUIsRUFBQ0EsTUFBSyxRQUFOLENBQWdCO0FBQWhCLEtBakJaLEVBeERnRDtBQTJFN0RRLGNBQVk7QUFDVixlQUFjLEVBQUNSLE1BQU0sUUFBUCxFQURKO0FBRVYsY0FBYyxFQUFDQSxNQUFNLFFBQVAsRUFGSjtBQUdWLGNBQWMsRUFBQ0EsTUFBTSxRQUFQLEVBSEo7QUFJVixlQUFjLEVBQUNBLE1BQU0sUUFBUCxFQUpKO0FBS1YsY0FBYyxFQUFDQSxNQUFNLFFBQVAsRUFMSixFQUtzQjtBQUNoQyxrQkFBYyxFQUFDQSxNQUFNLE1BQVA7QUFOSixHQTNFaUQ7QUFtRjdEUyxnQkFBYztBQUNaLGVBQWdCLEVBQUNULE1BQUssUUFBTixFQURKO0FBRVosbUJBQWdCLEVBQUNBLE1BQUssUUFBTixFQUZKO0FBR1osY0FBZ0IsRUFBQ0EsTUFBSyxRQUFOLEVBSEo7QUFJWixrQkFBZ0IsRUFBQ0EsTUFBSyxRQUFOLEVBSko7QUFLWixrQkFBZ0IsRUFBQ0EsTUFBSyxPQUFOLEVBTEo7QUFNWixpQkFBZ0IsRUFBQ0EsTUFBSyxRQUFOLEVBTko7QUFPWixlQUFnQixFQUFDQSxNQUFLLFFBQU4sRUFQSjtBQVFaLHFCQUFnQixFQUFDQSxNQUFLLFFBQU47QUFSSixHQW5GK0M7QUE2RjdEVSxVQUFRO0FBQ04sb0JBQWdCLEVBQUNWLE1BQUssUUFBTixFQURWO0FBRU4saUJBQWdCLEVBQUNBLE1BQUssUUFBTixFQUZWO0FBR04sbUJBQWdCLEVBQUNBLE1BQUssUUFBTixFQUhWO0FBSU4sV0FBZ0IsRUFBQ0EsTUFBSyxRQUFOO0FBSlYsR0E3RnFEO0FBbUc3RFcsaUJBQWU7QUFDYixnQkFBWSxFQUFDWCxNQUFNLFFBQVAsRUFEQztBQUViLGNBQVksRUFBQ0EsTUFBTSxRQUFQO0FBRkMsR0FuRzhDO0FBdUc3RFksYUFBVztBQUNULGdCQUFhLEVBQUNaLE1BQUssUUFBTixFQURKO0FBRVQsWUFBYSxFQUFDQSxNQUFLLFFBQU4sRUFGSjtBQUdULGFBQWEsRUFBQ0EsTUFBSyxRQUFOLEVBSEosRUFHcUI7QUFDOUIsZ0JBQWEsRUFBQ0EsTUFBSyxNQUFOLEVBSko7QUFLVCxpQkFBYSxFQUFDQSxNQUFLLFFBQU47QUFMSjtBQXZHa0QsQ0FBZCxDQUFqRDs7QUFnSEEsTUFBTWEsa0JBQWtCaEIsT0FBT0MsTUFBUCxDQUFjO0FBQ3BDUSxZQUFVLENBQUMsbUJBQUQsRUFBc0IsTUFBdEIsRUFBOEIsT0FBOUIsRUFBdUMsT0FBdkMsRUFBZ0QsVUFBaEQsQ0FEMEI7QUFFcENILFNBQU8sQ0FBQyxNQUFELEVBQVMsS0FBVDtBQUY2QixDQUFkLENBQXhCOztBQUtBLE1BQU1XLGdCQUFnQmpCLE9BQU9DLE1BQVAsQ0FBYyxDQUFDLE9BQUQsRUFBVSxlQUFWLEVBQTJCLE9BQTNCLEVBQW9DLFVBQXBDLEVBQWdELFVBQWhELEVBQTRELGFBQTVELEVBQTJFLFlBQTNFLEVBQXlGLGNBQXpGLEVBQXlHLFdBQXpHLENBQWQsQ0FBdEI7O0FBRUEsTUFBTWlCLGtCQUFrQmxCLE9BQU9DLE1BQVAsQ0FBYyxDQUFDLFlBQUQsRUFBZSxhQUFmLEVBQThCLFFBQTlCLEVBQXdDLGVBQXhDLEVBQXlELGNBQXpELEVBQXlFLFdBQXpFLENBQWQsQ0FBeEI7O0FBRUE7QUFDQSxNQUFNa0IsY0FBYyxtQkFBcEI7QUFDQTtBQUNBLE1BQU1DLFlBQVksVUFBbEI7QUFDQTtBQUNBLE1BQU1DLGNBQWMsTUFBcEI7O0FBRUEsTUFBTUMsNkJBQTZCLDBCQUFuQzs7QUFFQSxNQUFNQyxxQkFBcUJ2QixPQUFPQyxNQUFQLENBQWMsQ0FBQ2tCLFdBQUQsRUFBY0MsU0FBZCxFQUF5QkMsV0FBekIsRUFBc0NDLDBCQUF0QyxDQUFkLENBQTNCOztBQUVBLFNBQVNFLG1CQUFULENBQTZCQyxHQUE3QixFQUFrQztBQUNoQyxRQUFNQyxTQUFTSCxtQkFBbUJJLE1BQW5CLENBQTBCLENBQUNDLE1BQUQsRUFBU0MsS0FBVCxLQUFtQjtBQUMxREQsYUFBU0EsVUFBVUgsSUFBSUssS0FBSixDQUFVRCxLQUFWLEtBQW9CLElBQXZDO0FBQ0EsV0FBT0QsTUFBUDtBQUNELEdBSGMsRUFHWixLQUhZLENBQWY7QUFJQSxNQUFJLENBQUNGLE1BQUwsRUFBYTtBQUNYLFVBQU0sSUFBSTdCLE1BQU1rQyxLQUFWLENBQWdCbEMsTUFBTWtDLEtBQU4sQ0FBWUMsWUFBNUIsRUFBMkMsSUFBR1AsR0FBSSxrREFBbEQsQ0FBTjtBQUNEO0FBQ0Y7O0FBRUQsTUFBTVEsZUFBZWpDLE9BQU9DLE1BQVAsQ0FBYyxDQUFDLE1BQUQsRUFBUyxPQUFULEVBQWtCLEtBQWxCLEVBQXlCLFFBQXpCLEVBQW1DLFFBQW5DLEVBQTZDLFFBQTdDLEVBQXVELFVBQXZELEVBQW1FLGdCQUFuRSxFQUFxRixpQkFBckYsQ0FBZCxDQUFyQjtBQUNBLFNBQVNpQyxXQUFULENBQXFCQyxLQUFyQixFQUFtREMsTUFBbkQsRUFBeUU7QUFDdkUsTUFBSSxDQUFDRCxLQUFMLEVBQVk7QUFDVjtBQUNEO0FBQ0RuQyxTQUFPcUMsSUFBUCxDQUFZRixLQUFaLEVBQW1CRyxPQUFuQixDQUE0QkMsU0FBRCxJQUFlO0FBQ3hDLFFBQUlOLGFBQWFPLE9BQWIsQ0FBcUJELFNBQXJCLEtBQW1DLENBQUMsQ0FBeEMsRUFBMkM7QUFDekMsWUFBTSxJQUFJMUMsTUFBTWtDLEtBQVYsQ0FBZ0JsQyxNQUFNa0MsS0FBTixDQUFZQyxZQUE1QixFQUEyQyxHQUFFTyxTQUFVLHVEQUF2RCxDQUFOO0FBQ0Q7QUFDRCxRQUFJLENBQUNKLE1BQU1JLFNBQU4sQ0FBTCxFQUF1QjtBQUNyQjtBQUNEOztBQUVELFFBQUlBLGNBQWMsZ0JBQWQsSUFBa0NBLGNBQWMsaUJBQXBELEVBQXVFO0FBQ3JFLFVBQUksQ0FBQ0UsTUFBTUMsT0FBTixDQUFjUCxNQUFNSSxTQUFOLENBQWQsQ0FBTCxFQUFzQztBQUNwQztBQUNBLGNBQU0sSUFBSTFDLE1BQU1rQyxLQUFWLENBQWdCbEMsTUFBTWtDLEtBQU4sQ0FBWUMsWUFBNUIsRUFBMkMsSUFBR0csTUFBTUksU0FBTixDQUFpQixzREFBcURBLFNBQVUsRUFBOUgsQ0FBTjtBQUNELE9BSEQsTUFHTztBQUNMSixjQUFNSSxTQUFOLEVBQWlCRCxPQUFqQixDQUEwQmIsR0FBRCxJQUFTO0FBQ2hDLGNBQUksQ0FBQ1csT0FBT1gsR0FBUCxDQUFELElBQWdCVyxPQUFPWCxHQUFQLEVBQVl0QixJQUFaLElBQW9CLFNBQXBDLElBQWlEaUMsT0FBT1gsR0FBUCxFQUFZbEIsV0FBWixJQUEyQixPQUFoRixFQUF5RjtBQUN2RixrQkFBTSxJQUFJVixNQUFNa0MsS0FBVixDQUFnQmxDLE1BQU1rQyxLQUFOLENBQVlDLFlBQTVCLEVBQTJDLElBQUdQLEdBQUksK0RBQThEYyxTQUFVLEVBQTFILENBQU47QUFDRDtBQUNGLFNBSkQ7QUFLRDtBQUNEO0FBQ0Q7O0FBRUQ7QUFDQXZDLFdBQU9xQyxJQUFQLENBQVlGLE1BQU1JLFNBQU4sQ0FBWixFQUE4QkQsT0FBOUIsQ0FBdUNiLEdBQUQsSUFBUztBQUM3Q0QsMEJBQW9CQyxHQUFwQjtBQUNBO0FBQ0EsWUFBTWtCLE9BQU9SLE1BQU1JLFNBQU4sRUFBaUJkLEdBQWpCLENBQWI7QUFDQSxVQUFJa0IsU0FBUyxJQUFiLEVBQW1CO0FBQ2pCO0FBQ0EsY0FBTSxJQUFJOUMsTUFBTWtDLEtBQVYsQ0FBZ0JsQyxNQUFNa0MsS0FBTixDQUFZQyxZQUE1QixFQUEyQyxJQUFHVyxJQUFLLHNEQUFxREosU0FBVSxJQUFHZCxHQUFJLElBQUdrQixJQUFLLEVBQWpJLENBQU47QUFDRDtBQUNGLEtBUkQ7QUFTRCxHQWhDRDtBQWlDRDtBQUNELE1BQU1DLGlCQUFpQixvQ0FBdkI7QUFDQSxNQUFNQyxxQkFBcUIseUJBQTNCO0FBQ0EsU0FBU0MsZ0JBQVQsQ0FBMEJDLFNBQTFCLEVBQXNEO0FBQ3BEO0FBQ0E7QUFDRTtBQUNBOUIsa0JBQWN1QixPQUFkLENBQXNCTyxTQUF0QixJQUFtQyxDQUFDLENBQXBDO0FBQ0E7QUFDQUgsbUJBQWVJLElBQWYsQ0FBb0JELFNBQXBCLENBRkE7QUFHQTtBQUNBRSxxQkFBaUJGLFNBQWpCO0FBTkY7QUFRRDs7QUFFRDtBQUNBLFNBQVNFLGdCQUFULENBQTBCQyxTQUExQixFQUFzRDtBQUNwRCxTQUFPTCxtQkFBbUJHLElBQW5CLENBQXdCRSxTQUF4QixDQUFQO0FBQ0Q7O0FBRUQ7QUFDQSxTQUFTQyx3QkFBVCxDQUFrQ0QsU0FBbEMsRUFBcURILFNBQXJELEVBQWlGO0FBQy9FLE1BQUksQ0FBQ0UsaUJBQWlCQyxTQUFqQixDQUFMLEVBQWtDO0FBQ2hDLFdBQU8sS0FBUDtBQUNEO0FBQ0QsTUFBSW5ELGVBQWVHLFFBQWYsQ0FBd0JnRCxTQUF4QixDQUFKLEVBQXdDO0FBQ3RDLFdBQU8sS0FBUDtBQUNEO0FBQ0QsTUFBSW5ELGVBQWVnRCxTQUFmLEtBQTZCaEQsZUFBZWdELFNBQWYsRUFBMEJHLFNBQTFCLENBQWpDLEVBQXVFO0FBQ3JFLFdBQU8sS0FBUDtBQUNEO0FBQ0QsU0FBTyxJQUFQO0FBQ0Q7O0FBRUQsU0FBU0UsdUJBQVQsQ0FBaUNMLFNBQWpDLEVBQTREO0FBQzFELFNBQU8sd0JBQXdCQSxTQUF4QixHQUFvQyxtR0FBM0M7QUFDRDs7QUFFRCxNQUFNTSxtQkFBbUIsSUFBSXhELE1BQU1rQyxLQUFWLENBQWdCbEMsTUFBTWtDLEtBQU4sQ0FBWUMsWUFBNUIsRUFBMEMsY0FBMUMsQ0FBekI7QUFDQSxNQUFNc0IsaUNBQWlDLENBQ3JDLFFBRHFDLEVBRXJDLFFBRnFDLEVBR3JDLFNBSHFDLEVBSXJDLE1BSnFDLEVBS3JDLFFBTHFDLEVBTXJDLE9BTnFDLEVBT3JDLFVBUHFDLEVBUXJDLE1BUnFDLEVBU3JDLE9BVHFDLEVBVXJDLFNBVnFDLENBQXZDO0FBWUE7QUFDQSxNQUFNQyxxQkFBcUIsQ0FBQyxFQUFFcEQsSUFBRixFQUFRSSxXQUFSLEVBQUQsS0FBMkI7QUFDcEQsTUFBSSxDQUFDLFNBQUQsRUFBWSxVQUFaLEVBQXdCaUMsT0FBeEIsQ0FBZ0NyQyxJQUFoQyxLQUF5QyxDQUE3QyxFQUFnRDtBQUM5QyxRQUFJLENBQUNJLFdBQUwsRUFBa0I7QUFDaEIsYUFBTyxJQUFJVixNQUFNa0MsS0FBVixDQUFnQixHQUFoQixFQUFzQixRQUFPNUIsSUFBSyxxQkFBbEMsQ0FBUDtBQUNELEtBRkQsTUFFTyxJQUFJLE9BQU9JLFdBQVAsS0FBdUIsUUFBM0IsRUFBcUM7QUFDMUMsYUFBTzhDLGdCQUFQO0FBQ0QsS0FGTSxNQUVBLElBQUksQ0FBQ1AsaUJBQWlCdkMsV0FBakIsQ0FBTCxFQUFvQztBQUN6QyxhQUFPLElBQUlWLE1BQU1rQyxLQUFWLENBQWdCbEMsTUFBTWtDLEtBQU4sQ0FBWXlCLGtCQUE1QixFQUFnREosd0JBQXdCN0MsV0FBeEIsQ0FBaEQsQ0FBUDtBQUNELEtBRk0sTUFFQTtBQUNMLGFBQU9rRCxTQUFQO0FBQ0Q7QUFDRjtBQUNELE1BQUksT0FBT3RELElBQVAsS0FBZ0IsUUFBcEIsRUFBOEI7QUFDNUIsV0FBT2tELGdCQUFQO0FBQ0Q7QUFDRCxNQUFJQywrQkFBK0JkLE9BQS9CLENBQXVDckMsSUFBdkMsSUFBK0MsQ0FBbkQsRUFBc0Q7QUFDcEQsV0FBTyxJQUFJTixNQUFNa0MsS0FBVixDQUFnQmxDLE1BQU1rQyxLQUFOLENBQVkyQixjQUE1QixFQUE2Qyx1QkFBc0J2RCxJQUFLLEVBQXhFLENBQVA7QUFDRDtBQUNELFNBQU9zRCxTQUFQO0FBQ0QsQ0FuQkQ7O0FBcUJBLE1BQU1FLCtCQUFnQ0MsTUFBRCxJQUFpQjtBQUNwREEsV0FBU0Msb0JBQW9CRCxNQUFwQixDQUFUO0FBQ0EsU0FBT0EsT0FBT3hCLE1BQVAsQ0FBYzBCLEdBQXJCO0FBQ0FGLFNBQU94QixNQUFQLENBQWMyQixNQUFkLEdBQXVCLEVBQUU1RCxNQUFNLE9BQVIsRUFBdkI7QUFDQXlELFNBQU94QixNQUFQLENBQWM0QixNQUFkLEdBQXVCLEVBQUU3RCxNQUFNLE9BQVIsRUFBdkI7O0FBRUEsTUFBSXlELE9BQU9iLFNBQVAsS0FBcUIsT0FBekIsRUFBa0M7QUFDaEMsV0FBT2EsT0FBT3hCLE1BQVAsQ0FBYzZCLFFBQXJCO0FBQ0FMLFdBQU94QixNQUFQLENBQWM4QixnQkFBZCxHQUFpQyxFQUFFL0QsTUFBTSxRQUFSLEVBQWpDO0FBQ0Q7O0FBRUQsU0FBT3lELE1BQVA7QUFDRCxDQVpEOztBQWNBLE1BQU1PLG9DQUFvQyxVQUFpQjtBQUFBLE1BQVpQLE1BQVk7O0FBQ3pELFNBQU9BLE9BQU94QixNQUFQLENBQWMyQixNQUFyQjtBQUNBLFNBQU9ILE9BQU94QixNQUFQLENBQWM0QixNQUFyQjs7QUFFQUosU0FBT3hCLE1BQVAsQ0FBYzBCLEdBQWQsR0FBb0IsRUFBRTNELE1BQU0sS0FBUixFQUFwQjs7QUFFQSxNQUFJeUQsT0FBT2IsU0FBUCxLQUFxQixPQUF6QixFQUFrQztBQUNoQyxXQUFPYSxPQUFPeEIsTUFBUCxDQUFjZ0MsUUFBckIsQ0FEZ0MsQ0FDRDtBQUMvQixXQUFPUixPQUFPeEIsTUFBUCxDQUFjOEIsZ0JBQXJCO0FBQ0FOLFdBQU94QixNQUFQLENBQWM2QixRQUFkLEdBQXlCLEVBQUU5RCxNQUFNLFFBQVIsRUFBekI7QUFDRDs7QUFFRCxNQUFJeUQsT0FBT1MsT0FBUCxJQUFrQnJFLE9BQU9xQyxJQUFQLENBQVl1QixPQUFPUyxPQUFuQixFQUE0QkMsTUFBNUIsS0FBdUMsQ0FBN0QsRUFBZ0U7QUFDOUQsV0FBT1YsT0FBT1MsT0FBZDtBQUNEOztBQUVELFNBQU9ULE1BQVA7QUFDRCxDQWpCRDs7QUFtQkEsTUFBTUMsc0JBQXNCLENBQUMsRUFBQ2QsU0FBRCxFQUFZWCxNQUFaLEVBQW9CbUMscUJBQXBCLEVBQTJDRixPQUEzQyxFQUFELEtBQWlFO0FBQzNGLFFBQU1HLGdCQUF3QjtBQUM1QnpCLGFBRDRCO0FBRTVCWCx5QkFDS3JDLGVBQWVHLFFBRHBCLEVBRU1ILGVBQWVnRCxTQUFmLEtBQTZCLEVBRm5DLEVBR0tYLE1BSEwsQ0FGNEI7QUFPNUJtQztBQVA0QixHQUE5QjtBQVNBLE1BQUlGLFdBQVdyRSxPQUFPcUMsSUFBUCxDQUFZZ0MsT0FBWixFQUFxQkMsTUFBckIsS0FBZ0MsQ0FBL0MsRUFBa0Q7QUFDaERFLGtCQUFjSCxPQUFkLEdBQXdCQSxPQUF4QjtBQUNEO0FBQ0QsU0FBT0csYUFBUDtBQUNELENBZEQ7O0FBZ0JBLE1BQU1DLGVBQWdCLEVBQUMxQixXQUFXLFFBQVosRUFBc0JYLFFBQVFyQyxlQUFlYyxNQUE3QyxFQUF0QjtBQUNBLE1BQU02RCxzQkFBc0IsRUFBRTNCLFdBQVcsZUFBYixFQUE4QlgsUUFBUXJDLGVBQWVlLGFBQXJELEVBQTVCO0FBQ0EsTUFBTTZELG9CQUFvQmhCLDZCQUE2QkUsb0JBQW9CO0FBQ3pFZCxhQUFXLGFBRDhEO0FBRXpFWCxVQUFRLEVBRmlFO0FBR3pFbUMseUJBQXVCO0FBSGtELENBQXBCLENBQTdCLENBQTFCO0FBS0EsTUFBTUssbUJBQW1CakIsNkJBQTZCRSxvQkFBb0I7QUFDeEVkLGFBQVcsWUFENkQ7QUFFeEVYLFVBQVEsRUFGZ0U7QUFHeEVtQyx5QkFBdUI7QUFIaUQsQ0FBcEIsQ0FBN0IsQ0FBekI7QUFLQSxNQUFNTSxxQkFBcUJsQiw2QkFBNkJFLG9CQUFvQjtBQUMxRWQsYUFBVyxjQUQrRDtBQUUxRVgsVUFBUSxFQUZrRTtBQUcxRW1DLHlCQUF1QjtBQUhtRCxDQUFwQixDQUE3QixDQUEzQjtBQUtBLE1BQU1PLGtCQUFrQm5CLDZCQUE2QkUsb0JBQW9CO0FBQ3ZFZCxhQUFXLFdBRDREO0FBRXZFWCxVQUFRckMsZUFBZWdCLFNBRmdEO0FBR3ZFd0QseUJBQXVCO0FBSGdELENBQXBCLENBQTdCLENBQXhCO0FBS0EsTUFBTVEseUJBQXlCLENBQUNOLFlBQUQsRUFBZUcsZ0JBQWYsRUFBaUNDLGtCQUFqQyxFQUFxREYsaUJBQXJELEVBQXdFRCxtQkFBeEUsRUFBNkZJLGVBQTdGLENBQS9COztBQUVBLE1BQU1FLDBCQUEwQixDQUFDQyxNQUFELEVBQStCQyxVQUEvQixLQUEyRDtBQUN6RixNQUFJRCxPQUFPOUUsSUFBUCxLQUFnQitFLFdBQVcvRSxJQUEvQixFQUFxQyxPQUFPLEtBQVA7QUFDckMsTUFBSThFLE9BQU8xRSxXQUFQLEtBQXVCMkUsV0FBVzNFLFdBQXRDLEVBQW1ELE9BQU8sS0FBUDtBQUNuRCxNQUFJMEUsV0FBV0MsV0FBVy9FLElBQTFCLEVBQWdDLE9BQU8sSUFBUDtBQUNoQyxNQUFJOEUsT0FBTzlFLElBQVAsS0FBZ0IrRSxXQUFXL0UsSUFBL0IsRUFBcUMsT0FBTyxJQUFQO0FBQ3JDLFNBQU8sS0FBUDtBQUNELENBTkQ7O0FBUUEsTUFBTWdGLGVBQWdCaEYsSUFBRCxJQUF3QztBQUMzRCxNQUFJLE9BQU9BLElBQVAsS0FBZ0IsUUFBcEIsRUFBOEI7QUFDNUIsV0FBT0EsSUFBUDtBQUNEO0FBQ0QsTUFBSUEsS0FBS0ksV0FBVCxFQUFzQjtBQUNwQixXQUFRLEdBQUVKLEtBQUtBLElBQUssSUFBR0EsS0FBS0ksV0FBWSxHQUF4QztBQUNEO0FBQ0QsU0FBUSxHQUFFSixLQUFLQSxJQUFLLEVBQXBCO0FBQ0QsQ0FSRDs7QUFVQTtBQUNBO0FBQ2UsTUFBTWlGLGdCQUFOLENBQXVCOztBQVFwQ0MsY0FBWUMsZUFBWixFQUE2Q0MsV0FBN0MsRUFBK0Q7QUFDN0QsU0FBS0MsVUFBTCxHQUFrQkYsZUFBbEI7QUFDQSxTQUFLRyxNQUFMLEdBQWNGLFdBQWQ7QUFDQTtBQUNBLFNBQUtHLElBQUwsR0FBWSxFQUFaO0FBQ0E7QUFDQSxTQUFLdkQsS0FBTCxHQUFhLEVBQWI7QUFDQTtBQUNBLFNBQUtrQyxPQUFMLEdBQWUsRUFBZjtBQUNEOztBQUVEc0IsYUFBV0MsVUFBNkIsRUFBQ0MsWUFBWSxLQUFiLEVBQXhDLEVBQTJFO0FBQ3pFLFFBQUlDLFVBQVVDLFFBQVFDLE9BQVIsRUFBZDtBQUNBLFFBQUlKLFFBQVFDLFVBQVosRUFBd0I7QUFDdEJDLGdCQUFVQSxRQUFRRyxJQUFSLENBQWEsTUFBTTtBQUMzQixlQUFPLEtBQUtSLE1BQUwsQ0FBWVMsS0FBWixFQUFQO0FBQ0QsT0FGUyxDQUFWO0FBR0Q7QUFDRCxRQUFJLEtBQUtDLGlCQUFMLElBQTBCLENBQUNQLFFBQVFDLFVBQXZDLEVBQW1EO0FBQ2pELGFBQU8sS0FBS00saUJBQVo7QUFDRDtBQUNELFNBQUtBLGlCQUFMLEdBQXlCTCxRQUFRRyxJQUFSLENBQWEsTUFBTTtBQUMxQyxhQUFPLEtBQUtHLGFBQUwsQ0FBbUJSLE9BQW5CLEVBQTRCSyxJQUE1QixDQUFrQ0ksVUFBRCxJQUFnQjtBQUN0RCxjQUFNWCxPQUFPLEVBQWI7QUFDQSxjQUFNdkQsUUFBUSxFQUFkO0FBQ0EsY0FBTWtDLFVBQVUsRUFBaEI7QUFDQWdDLG1CQUFXL0QsT0FBWCxDQUFtQnNCLFVBQVU7QUFDM0I4QixlQUFLOUIsT0FBT2IsU0FBWixJQUF5QmMsb0JBQW9CRCxNQUFwQixFQUE0QnhCLE1BQXJEO0FBQ0FELGdCQUFNeUIsT0FBT2IsU0FBYixJQUEwQmEsT0FBT1cscUJBQWpDO0FBQ0FGLGtCQUFRVCxPQUFPYixTQUFmLElBQTRCYSxPQUFPUyxPQUFuQztBQUNELFNBSkQ7O0FBTUE7QUFDQW5ELHdCQUFnQm9CLE9BQWhCLENBQXdCUyxhQUFhO0FBQ25DLGdCQUFNYSxTQUFTQyxvQkFBb0IsRUFBRWQsU0FBRixFQUFhWCxRQUFRLEVBQXJCLEVBQXlCbUMsdUJBQXVCLEVBQWhELEVBQXBCLENBQWY7QUFDQW1CLGVBQUszQyxTQUFMLElBQWtCYSxPQUFPeEIsTUFBekI7QUFDQUQsZ0JBQU1ZLFNBQU4sSUFBbUJhLE9BQU9XLHFCQUExQjtBQUNBRixrQkFBUXRCLFNBQVIsSUFBcUJhLE9BQU9TLE9BQTVCO0FBQ0QsU0FMRDtBQU1BLGFBQUtxQixJQUFMLEdBQVlBLElBQVo7QUFDQSxhQUFLdkQsS0FBTCxHQUFhQSxLQUFiO0FBQ0EsYUFBS2tDLE9BQUwsR0FBZUEsT0FBZjtBQUNBLGVBQU8sS0FBSzhCLGlCQUFaO0FBQ0QsT0FyQk0sRUFxQkhHLEdBQUQsSUFBUztBQUNWLGFBQUtaLElBQUwsR0FBWSxFQUFaO0FBQ0EsYUFBS3ZELEtBQUwsR0FBYSxFQUFiO0FBQ0EsYUFBS2tDLE9BQUwsR0FBZSxFQUFmO0FBQ0EsZUFBTyxLQUFLOEIsaUJBQVo7QUFDQSxjQUFNRyxHQUFOO0FBQ0QsT0EzQk0sQ0FBUDtBQTRCRCxLQTdCd0IsRUE2QnRCTCxJQTdCc0IsQ0E2QmpCLE1BQU0sQ0FBRSxDQTdCUyxDQUF6QjtBQThCQSxXQUFPLEtBQUtFLGlCQUFaO0FBQ0Q7O0FBRURDLGdCQUFjUixVQUE2QixFQUFDQyxZQUFZLEtBQWIsRUFBM0MsRUFBd0Y7QUFDdEYsUUFBSUMsVUFBVUMsUUFBUUMsT0FBUixFQUFkO0FBQ0EsUUFBSUosUUFBUUMsVUFBWixFQUF3QjtBQUN0QkMsZ0JBQVUsS0FBS0wsTUFBTCxDQUFZUyxLQUFaLEVBQVY7QUFDRDtBQUNELFdBQU9KLFFBQVFHLElBQVIsQ0FBYSxNQUFNO0FBQ3hCLGFBQU8sS0FBS1IsTUFBTCxDQUFZVyxhQUFaLEVBQVA7QUFDRCxLQUZNLEVBRUpILElBRkksQ0FFRU0sVUFBRCxJQUFnQjtBQUN0QixVQUFJQSxjQUFjQSxXQUFXakMsTUFBekIsSUFBbUMsQ0FBQ3NCLFFBQVFDLFVBQWhELEVBQTREO0FBQzFELGVBQU9FLFFBQVFDLE9BQVIsQ0FBZ0JPLFVBQWhCLENBQVA7QUFDRDtBQUNELGFBQU8sS0FBS2YsVUFBTCxDQUFnQlksYUFBaEIsR0FDSkgsSUFESSxDQUNDSSxjQUFjQSxXQUFXRyxHQUFYLENBQWUzQyxtQkFBZixDQURmLEVBRUpvQyxJQUZJLENBRUNJLGNBQWM7QUFDbEIsZUFBTyxLQUFLWixNQUFMLENBQVlnQixhQUFaLENBQTBCSixVQUExQixFQUFzQ0osSUFBdEMsQ0FBMkMsTUFBTTtBQUN0RCxpQkFBT0ksVUFBUDtBQUNELFNBRk0sQ0FBUDtBQUdELE9BTkksQ0FBUDtBQU9ELEtBYk0sQ0FBUDtBQWNEOztBQUVESyxlQUFhM0QsU0FBYixFQUFnQzRELHVCQUFnQyxLQUFoRSxFQUF1RWYsVUFBNkIsRUFBQ0MsWUFBWSxLQUFiLEVBQXBHLEVBQTBJO0FBQ3hJLFFBQUlDLFVBQVVDLFFBQVFDLE9BQVIsRUFBZDtBQUNBLFFBQUlKLFFBQVFDLFVBQVosRUFBd0I7QUFDdEJDLGdCQUFVLEtBQUtMLE1BQUwsQ0FBWVMsS0FBWixFQUFWO0FBQ0Q7QUFDRCxXQUFPSixRQUFRRyxJQUFSLENBQWEsTUFBTTtBQUN4QixVQUFJVSx3QkFBd0J6RixnQkFBZ0JzQixPQUFoQixDQUF3Qk8sU0FBeEIsSUFBcUMsQ0FBQyxDQUFsRSxFQUFxRTtBQUNuRSxlQUFPZ0QsUUFBUUMsT0FBUixDQUFnQjtBQUNyQmpELG1CQURxQjtBQUVyQlgsa0JBQVEsS0FBS3NELElBQUwsQ0FBVTNDLFNBQVYsQ0FGYTtBQUdyQndCLGlDQUF1QixLQUFLcEMsS0FBTCxDQUFXWSxTQUFYLENBSEY7QUFJckJzQixtQkFBUyxLQUFLQSxPQUFMLENBQWF0QixTQUFiO0FBSlksU0FBaEIsQ0FBUDtBQU1EO0FBQ0QsYUFBTyxLQUFLMEMsTUFBTCxDQUFZaUIsWUFBWixDQUF5QjNELFNBQXpCLEVBQW9Da0QsSUFBcEMsQ0FBMENXLE1BQUQsSUFBWTtBQUMxRCxZQUFJQSxVQUFVLENBQUNoQixRQUFRQyxVQUF2QixFQUFtQztBQUNqQyxpQkFBT0UsUUFBUUMsT0FBUixDQUFnQlksTUFBaEIsQ0FBUDtBQUNEO0FBQ0QsZUFBTyxLQUFLcEIsVUFBTCxDQUFnQnFCLFFBQWhCLENBQXlCOUQsU0FBekIsRUFDSmtELElBREksQ0FDQ3BDLG1CQURELEVBRUpvQyxJQUZJLENBRUV2RSxNQUFELElBQVk7QUFDaEIsaUJBQU8sS0FBSytELE1BQUwsQ0FBWXFCLFlBQVosQ0FBeUIvRCxTQUF6QixFQUFvQ3JCLE1BQXBDLEVBQTRDdUUsSUFBNUMsQ0FBaUQsTUFBTTtBQUM1RCxtQkFBT3ZFLE1BQVA7QUFDRCxXQUZNLENBQVA7QUFHRCxTQU5JLENBQVA7QUFPRCxPQVhNLENBQVA7QUFZRCxLQXJCTSxDQUFQO0FBc0JEOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0FxRixzQkFBb0JoRSxTQUFwQixFQUF1Q1gsU0FBdUIsRUFBOUQsRUFBa0VtQyxxQkFBbEUsRUFBOEZGLFVBQWUsRUFBN0csRUFBZ0k7QUFDOUgsUUFBSTJDLGtCQUFrQixLQUFLQyxnQkFBTCxDQUFzQmxFLFNBQXRCLEVBQWlDWCxNQUFqQyxFQUF5Q21DLHFCQUF6QyxDQUF0QjtBQUNBLFFBQUl5QyxlQUFKLEVBQXFCO0FBQ25CLGFBQU9qQixRQUFRbUIsTUFBUixDQUFlRixlQUFmLENBQVA7QUFDRDs7QUFFRCxXQUFPLEtBQUt4QixVQUFMLENBQWdCMkIsV0FBaEIsQ0FBNEJwRSxTQUE1QixFQUF1Q1ksNkJBQTZCLEVBQUV2QixNQUFGLEVBQVVtQyxxQkFBVixFQUFpQ0YsT0FBakMsRUFBMEN0QixTQUExQyxFQUE3QixDQUF2QyxFQUNKa0QsSUFESSxDQUNDOUIsaUNBREQsRUFFSjhCLElBRkksQ0FFRW1CLEdBQUQsSUFBUztBQUNiLGFBQU8sS0FBSzNCLE1BQUwsQ0FBWVMsS0FBWixHQUFvQkQsSUFBcEIsQ0FBeUIsTUFBTTtBQUNwQyxlQUFPRixRQUFRQyxPQUFSLENBQWdCb0IsR0FBaEIsQ0FBUDtBQUNELE9BRk0sQ0FBUDtBQUdELEtBTkksRUFPSkMsS0FQSSxDQU9FQyxTQUFTO0FBQ2QsVUFBSUEsU0FBU0EsTUFBTUMsSUFBTixLQUFlMUgsTUFBTWtDLEtBQU4sQ0FBWXlGLGVBQXhDLEVBQXlEO0FBQ3ZELGNBQU0sSUFBSTNILE1BQU1rQyxLQUFWLENBQWdCbEMsTUFBTWtDLEtBQU4sQ0FBWXlCLGtCQUE1QixFQUFpRCxTQUFRVCxTQUFVLGtCQUFuRSxDQUFOO0FBQ0QsT0FGRCxNQUVPO0FBQ0wsY0FBTXVFLEtBQU47QUFDRDtBQUNGLEtBYkksQ0FBUDtBQWNEOztBQUVERyxjQUFZMUUsU0FBWixFQUErQjJFLGVBQS9CLEVBQThEbkQscUJBQTlELEVBQTBGRixPQUExRixFQUF3R3NELFFBQXhHLEVBQXNJO0FBQ3BJLFdBQU8sS0FBS2pCLFlBQUwsQ0FBa0IzRCxTQUFsQixFQUNKa0QsSUFESSxDQUNDckMsVUFBVTtBQUNkLFlBQU1nRSxpQkFBaUJoRSxPQUFPeEIsTUFBOUI7QUFDQXBDLGFBQU9xQyxJQUFQLENBQVlxRixlQUFaLEVBQTZCcEYsT0FBN0IsQ0FBcUN1RixRQUFRO0FBQzNDLGNBQU1DLFFBQVFKLGdCQUFnQkcsSUFBaEIsQ0FBZDtBQUNBLFlBQUlELGVBQWVDLElBQWYsS0FBd0JDLE1BQU1DLElBQU4sS0FBZSxRQUEzQyxFQUFxRDtBQUNuRCxnQkFBTSxJQUFJbEksTUFBTWtDLEtBQVYsQ0FBZ0IsR0FBaEIsRUFBc0IsU0FBUThGLElBQUsseUJBQW5DLENBQU47QUFDRDtBQUNELFlBQUksQ0FBQ0QsZUFBZUMsSUFBZixDQUFELElBQXlCQyxNQUFNQyxJQUFOLEtBQWUsUUFBNUMsRUFBc0Q7QUFDcEQsZ0JBQU0sSUFBSWxJLE1BQU1rQyxLQUFWLENBQWdCLEdBQWhCLEVBQXNCLFNBQVE4RixJQUFLLGlDQUFuQyxDQUFOO0FBQ0Q7QUFDRixPQVJEOztBQVVBLGFBQU9ELGVBQWU3RCxNQUF0QjtBQUNBLGFBQU82RCxlQUFlNUQsTUFBdEI7QUFDQSxZQUFNZ0UsWUFBWUMsd0JBQXdCTCxjQUF4QixFQUF3Q0YsZUFBeEMsQ0FBbEI7QUFDQSxZQUFNUSxnQkFBZ0JuSSxlQUFlZ0QsU0FBZixLQUE2QmhELGVBQWVHLFFBQWxFO0FBQ0EsWUFBTWlJLGdCQUFnQm5JLE9BQU9vSSxNQUFQLENBQWMsRUFBZCxFQUFrQkosU0FBbEIsRUFBNkJFLGFBQTdCLENBQXRCO0FBQ0EsWUFBTWxCLGtCQUFrQixLQUFLcUIsa0JBQUwsQ0FBd0J0RixTQUF4QixFQUFtQ2lGLFNBQW5DLEVBQThDekQscUJBQTlDLEVBQXFFdkUsT0FBT3FDLElBQVAsQ0FBWXVGLGNBQVosQ0FBckUsQ0FBeEI7QUFDQSxVQUFJWixlQUFKLEVBQXFCO0FBQ25CLGNBQU0sSUFBSW5ILE1BQU1rQyxLQUFWLENBQWdCaUYsZ0JBQWdCTyxJQUFoQyxFQUFzQ1AsZ0JBQWdCTSxLQUF0RCxDQUFOO0FBQ0Q7O0FBRUQ7QUFDQTtBQUNBLFlBQU1nQixnQkFBMEIsRUFBaEM7QUFDQSxZQUFNQyxpQkFBaUIsRUFBdkI7QUFDQXZJLGFBQU9xQyxJQUFQLENBQVlxRixlQUFaLEVBQTZCcEYsT0FBN0IsQ0FBcUNZLGFBQWE7QUFDaEQsWUFBSXdFLGdCQUFnQnhFLFNBQWhCLEVBQTJCNkUsSUFBM0IsS0FBb0MsUUFBeEMsRUFBa0Q7QUFDaERPLHdCQUFjRSxJQUFkLENBQW1CdEYsU0FBbkI7QUFDRCxTQUZELE1BRU87QUFDTHFGLHlCQUFlQyxJQUFmLENBQW9CdEYsU0FBcEI7QUFDRDtBQUNGLE9BTkQ7O0FBUUEsVUFBSXVGLGdCQUFnQjFDLFFBQVFDLE9BQVIsRUFBcEI7QUFDQSxVQUFJc0MsY0FBY2hFLE1BQWQsR0FBdUIsQ0FBM0IsRUFBOEI7QUFDNUJtRSx3QkFBZ0IsS0FBS0MsWUFBTCxDQUFrQkosYUFBbEIsRUFBaUN2RixTQUFqQyxFQUE0QzRFLFFBQTVDLENBQWhCO0FBQ0Q7QUFDRCxhQUFPYyxjQUFjO0FBQWQsT0FDSnhDLElBREksQ0FDQyxNQUFNLEtBQUtOLFVBQUwsQ0FBZ0IsRUFBRUUsWUFBWSxJQUFkLEVBQWhCLENBRFAsRUFDOEM7QUFEOUMsT0FFSkksSUFGSSxDQUVDLE1BQU07QUFDVixjQUFNMEMsV0FBV0osZUFBZS9CLEdBQWYsQ0FBbUJ0RCxhQUFhO0FBQy9DLGdCQUFNL0MsT0FBT3VILGdCQUFnQnhFLFNBQWhCLENBQWI7QUFDQSxpQkFBTyxLQUFLMEYsa0JBQUwsQ0FBd0I3RixTQUF4QixFQUFtQ0csU0FBbkMsRUFBOEMvQyxJQUE5QyxDQUFQO0FBQ0QsU0FIZ0IsQ0FBakI7QUFJQSxlQUFPNEYsUUFBUThDLEdBQVIsQ0FBWUYsUUFBWixDQUFQO0FBQ0QsT0FSSSxFQVNKMUMsSUFUSSxDQVNDLE1BQU0sS0FBSzZDLGNBQUwsQ0FBb0IvRixTQUFwQixFQUErQndCLHFCQUEvQixFQUFzRHlELFNBQXRELENBVFAsRUFVSi9CLElBVkksQ0FVQyxNQUFNLEtBQUtULFVBQUwsQ0FBZ0J1RCwwQkFBaEIsQ0FBMkNoRyxTQUEzQyxFQUFzRHNCLE9BQXRELEVBQStEVCxPQUFPUyxPQUF0RSxFQUErRThELGFBQS9FLENBVlAsRUFXSmxDLElBWEksQ0FXQyxNQUFNLEtBQUtOLFVBQUwsQ0FBZ0IsRUFBRUUsWUFBWSxJQUFkLEVBQWhCLENBWFA7QUFZUDtBQVpPLE9BYUpJLElBYkksQ0FhQyxNQUFNO0FBQ1YsY0FBTStDLGlCQUF5QjtBQUM3QmpHLHFCQUFXQSxTQURrQjtBQUU3Qlgsa0JBQVEsS0FBS3NELElBQUwsQ0FBVTNDLFNBQVYsQ0FGcUI7QUFHN0J3QixpQ0FBdUIsS0FBS3BDLEtBQUwsQ0FBV1ksU0FBWDtBQUhNLFNBQS9CO0FBS0EsWUFBSSxLQUFLc0IsT0FBTCxDQUFhdEIsU0FBYixLQUEyQi9DLE9BQU9xQyxJQUFQLENBQVksS0FBS2dDLE9BQUwsQ0FBYXRCLFNBQWIsQ0FBWixFQUFxQ3VCLE1BQXJDLEtBQWdELENBQS9FLEVBQWtGO0FBQ2hGMEUseUJBQWUzRSxPQUFmLEdBQXlCLEtBQUtBLE9BQUwsQ0FBYXRCLFNBQWIsQ0FBekI7QUFDRDtBQUNELGVBQU9pRyxjQUFQO0FBQ0QsT0F2QkksQ0FBUDtBQXdCRCxLQS9ESSxFQWdFSjNCLEtBaEVJLENBZ0VFQyxTQUFTO0FBQ2QsVUFBSUEsVUFBVTdELFNBQWQsRUFBeUI7QUFDdkIsY0FBTSxJQUFJNUQsTUFBTWtDLEtBQVYsQ0FBZ0JsQyxNQUFNa0MsS0FBTixDQUFZeUIsa0JBQTVCLEVBQWlELFNBQVFULFNBQVUsa0JBQW5FLENBQU47QUFDRCxPQUZELE1BRU87QUFDTCxjQUFNdUUsS0FBTjtBQUNEO0FBQ0YsS0F0RUksQ0FBUDtBQXVFRDs7QUFFRDtBQUNBO0FBQ0EyQixxQkFBbUJsRyxTQUFuQixFQUFpRTtBQUMvRCxRQUFJLEtBQUsyQyxJQUFMLENBQVUzQyxTQUFWLENBQUosRUFBMEI7QUFDeEIsYUFBT2dELFFBQVFDLE9BQVIsQ0FBZ0IsSUFBaEIsQ0FBUDtBQUNEO0FBQ0Q7QUFDQSxXQUFPLEtBQUtlLG1CQUFMLENBQXlCaEUsU0FBekI7QUFDUDtBQURPLEtBRUprRCxJQUZJLENBRUMsTUFBTSxLQUFLTixVQUFMLENBQWdCLEVBQUVFLFlBQVksSUFBZCxFQUFoQixDQUZQLEVBR0p3QixLQUhJLENBR0UsTUFBTTtBQUNiO0FBQ0E7QUFDQTtBQUNBO0FBQ0UsYUFBTyxLQUFLMUIsVUFBTCxDQUFnQixFQUFFRSxZQUFZLElBQWQsRUFBaEIsQ0FBUDtBQUNELEtBVEksRUFVSkksSUFWSSxDQVVDLE1BQU07QUFDWjtBQUNFLFVBQUksS0FBS1AsSUFBTCxDQUFVM0MsU0FBVixDQUFKLEVBQTBCO0FBQ3hCLGVBQU8sSUFBUDtBQUNELE9BRkQsTUFFTztBQUNMLGNBQU0sSUFBSWxELE1BQU1rQyxLQUFWLENBQWdCbEMsTUFBTWtDLEtBQU4sQ0FBWUMsWUFBNUIsRUFBMkMsaUJBQWdCZSxTQUFVLEVBQXJFLENBQU47QUFDRDtBQUNGLEtBakJJLEVBa0JKc0UsS0FsQkksQ0FrQkUsTUFBTTtBQUNiO0FBQ0UsWUFBTSxJQUFJeEgsTUFBTWtDLEtBQVYsQ0FBZ0JsQyxNQUFNa0MsS0FBTixDQUFZQyxZQUE1QixFQUEwQyx1Q0FBMUMsQ0FBTjtBQUNELEtBckJJLENBQVA7QUFzQkQ7O0FBRURpRixtQkFBaUJsRSxTQUFqQixFQUFvQ1gsU0FBdUIsRUFBM0QsRUFBK0RtQyxxQkFBL0QsRUFBZ0c7QUFDOUYsUUFBSSxLQUFLbUIsSUFBTCxDQUFVM0MsU0FBVixDQUFKLEVBQTBCO0FBQ3hCLFlBQU0sSUFBSWxELE1BQU1rQyxLQUFWLENBQWdCbEMsTUFBTWtDLEtBQU4sQ0FBWXlCLGtCQUE1QixFQUFpRCxTQUFRVCxTQUFVLGtCQUFuRSxDQUFOO0FBQ0Q7QUFDRCxRQUFJLENBQUNELGlCQUFpQkMsU0FBakIsQ0FBTCxFQUFrQztBQUNoQyxhQUFPO0FBQ0x3RSxjQUFNMUgsTUFBTWtDLEtBQU4sQ0FBWXlCLGtCQURiO0FBRUw4RCxlQUFPbEUsd0JBQXdCTCxTQUF4QjtBQUZGLE9BQVA7QUFJRDtBQUNELFdBQU8sS0FBS3NGLGtCQUFMLENBQXdCdEYsU0FBeEIsRUFBbUNYLE1BQW5DLEVBQTJDbUMscUJBQTNDLEVBQWtFLEVBQWxFLENBQVA7QUFDRDs7QUFFRDhELHFCQUFtQnRGLFNBQW5CLEVBQXNDWCxNQUF0QyxFQUE0RG1DLHFCQUE1RCxFQUEwRzJFLGtCQUExRyxFQUE2STtBQUMzSSxTQUFLLE1BQU1oRyxTQUFYLElBQXdCZCxNQUF4QixFQUFnQztBQUM5QixVQUFJOEcsbUJBQW1CMUcsT0FBbkIsQ0FBMkJVLFNBQTNCLElBQXdDLENBQTVDLEVBQStDO0FBQzdDLFlBQUksQ0FBQ0QsaUJBQWlCQyxTQUFqQixDQUFMLEVBQWtDO0FBQ2hDLGlCQUFPO0FBQ0xxRSxrQkFBTTFILE1BQU1rQyxLQUFOLENBQVlvSCxnQkFEYjtBQUVMN0IsbUJBQU8seUJBQXlCcEU7QUFGM0IsV0FBUDtBQUlEO0FBQ0QsWUFBSSxDQUFDQyx5QkFBeUJELFNBQXpCLEVBQW9DSCxTQUFwQyxDQUFMLEVBQXFEO0FBQ25ELGlCQUFPO0FBQ0x3RSxrQkFBTSxHQUREO0FBRUxELG1CQUFPLFdBQVdwRSxTQUFYLEdBQXVCO0FBRnpCLFdBQVA7QUFJRDtBQUNELGNBQU1vRSxRQUFRL0QsbUJBQW1CbkIsT0FBT2MsU0FBUCxDQUFuQixDQUFkO0FBQ0EsWUFBSW9FLEtBQUosRUFBVyxPQUFPLEVBQUVDLE1BQU1ELE1BQU1DLElBQWQsRUFBb0JELE9BQU9BLE1BQU04QixPQUFqQyxFQUFQO0FBQ1o7QUFDRjs7QUFFRCxTQUFLLE1BQU1sRyxTQUFYLElBQXdCbkQsZUFBZWdELFNBQWYsQ0FBeEIsRUFBbUQ7QUFDakRYLGFBQU9jLFNBQVAsSUFBb0JuRCxlQUFlZ0QsU0FBZixFQUEwQkcsU0FBMUIsQ0FBcEI7QUFDRDs7QUFFRCxVQUFNbUcsWUFBWXJKLE9BQU9xQyxJQUFQLENBQVlELE1BQVosRUFBb0JrSCxNQUFwQixDQUEyQjdILE9BQU9XLE9BQU9YLEdBQVAsS0FBZVcsT0FBT1gsR0FBUCxFQUFZdEIsSUFBWixLQUFxQixVQUF0RSxDQUFsQjtBQUNBLFFBQUlrSixVQUFVL0UsTUFBVixHQUFtQixDQUF2QixFQUEwQjtBQUN4QixhQUFPO0FBQ0xpRCxjQUFNMUgsTUFBTWtDLEtBQU4sQ0FBWTJCLGNBRGI7QUFFTDRELGVBQU8sdUVBQXVFK0IsVUFBVSxDQUFWLENBQXZFLEdBQXNGLFFBQXRGLEdBQWlHQSxVQUFVLENBQVYsQ0FBakcsR0FBZ0g7QUFGbEgsT0FBUDtBQUlEO0FBQ0RuSCxnQkFBWXFDLHFCQUFaLEVBQW1DbkMsTUFBbkM7QUFDRDs7QUFFRDtBQUNBMEcsaUJBQWUvRixTQUFmLEVBQWtDWixLQUFsQyxFQUE4QzZGLFNBQTlDLEVBQXVFO0FBQ3JFLFFBQUksT0FBTzdGLEtBQVAsS0FBaUIsV0FBckIsRUFBa0M7QUFDaEMsYUFBTzRELFFBQVFDLE9BQVIsRUFBUDtBQUNEO0FBQ0Q5RCxnQkFBWUMsS0FBWixFQUFtQjZGLFNBQW5CO0FBQ0EsV0FBTyxLQUFLeEMsVUFBTCxDQUFnQitELHdCQUFoQixDQUF5Q3hHLFNBQXpDLEVBQW9EWixLQUFwRCxDQUFQO0FBQ0Q7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQXlHLHFCQUFtQjdGLFNBQW5CLEVBQXNDRyxTQUF0QyxFQUF5RC9DLElBQXpELEVBQXFGO0FBQ25GLFFBQUkrQyxVQUFVVixPQUFWLENBQWtCLEdBQWxCLElBQXlCLENBQTdCLEVBQWdDO0FBQzlCO0FBQ0FVLGtCQUFZQSxVQUFVc0csS0FBVixDQUFnQixHQUFoQixFQUFzQixDQUF0QixDQUFaO0FBQ0FySixhQUFPLFFBQVA7QUFDRDtBQUNELFFBQUksQ0FBQzhDLGlCQUFpQkMsU0FBakIsQ0FBTCxFQUFrQztBQUNoQyxZQUFNLElBQUlyRCxNQUFNa0MsS0FBVixDQUFnQmxDLE1BQU1rQyxLQUFOLENBQVlvSCxnQkFBNUIsRUFBK0MsdUJBQXNCakcsU0FBVSxHQUEvRSxDQUFOO0FBQ0Q7O0FBRUQ7QUFDQSxRQUFJLENBQUMvQyxJQUFMLEVBQVc7QUFDVCxhQUFPNEYsUUFBUUMsT0FBUixDQUFnQixJQUFoQixDQUFQO0FBQ0Q7O0FBRUQsV0FBTyxLQUFLTCxVQUFMLEdBQWtCTSxJQUFsQixDQUF1QixNQUFNO0FBQ2xDLFlBQU13RCxlQUFlLEtBQUtDLGVBQUwsQ0FBcUIzRyxTQUFyQixFQUFnQ0csU0FBaEMsQ0FBckI7QUFDQSxVQUFJLE9BQU8vQyxJQUFQLEtBQWdCLFFBQXBCLEVBQThCO0FBQzVCQSxlQUFPLEVBQUVBLElBQUYsRUFBUDtBQUNEOztBQUVELFVBQUlzSixZQUFKLEVBQWtCO0FBQ2hCLFlBQUksQ0FBQ3pFLHdCQUF3QnlFLFlBQXhCLEVBQXNDdEosSUFBdEMsQ0FBTCxFQUFrRDtBQUNoRCxnQkFBTSxJQUFJTixNQUFNa0MsS0FBVixDQUNKbEMsTUFBTWtDLEtBQU4sQ0FBWTJCLGNBRFIsRUFFSCx1QkFBc0JYLFNBQVUsSUFBR0csU0FBVSxjQUFhaUMsYUFBYXNFLFlBQWIsQ0FBMkIsWUFBV3RFLGFBQWFoRixJQUFiLENBQW1CLEVBRmhILENBQU47QUFJRDtBQUNELGVBQU8sSUFBUDtBQUNEOztBQUVELGFBQU8sS0FBS3FGLFVBQUwsQ0FBZ0JtRSxtQkFBaEIsQ0FBb0M1RyxTQUFwQyxFQUErQ0csU0FBL0MsRUFBMEQvQyxJQUExRCxFQUFnRThGLElBQWhFLENBQXFFLE1BQU07QUFDaEY7QUFDQSxlQUFPLEtBQUtOLFVBQUwsQ0FBZ0IsRUFBRUUsWUFBWSxJQUFkLEVBQWhCLENBQVA7QUFDRCxPQUhNLEVBR0h5QixLQUFELElBQVc7QUFDWixZQUFJQSxNQUFNQyxJQUFOLElBQWMxSCxNQUFNa0MsS0FBTixDQUFZMkIsY0FBOUIsRUFBOEM7QUFDNUM7QUFDQSxnQkFBTTRELEtBQU47QUFDRDtBQUNEO0FBQ0E7QUFDQTtBQUNBLGVBQU8sS0FBSzNCLFVBQUwsQ0FBZ0IsRUFBRUUsWUFBWSxJQUFkLEVBQWhCLENBQVA7QUFDRCxPQVpNLEVBWUpJLElBWkksQ0FZQyxNQUFNO0FBQ1o7QUFDQSxjQUFNd0QsZUFBZSxLQUFLQyxlQUFMLENBQXFCM0csU0FBckIsRUFBZ0NHLFNBQWhDLENBQXJCO0FBQ0EsWUFBSSxPQUFPL0MsSUFBUCxLQUFnQixRQUFwQixFQUE4QjtBQUM1QkEsaUJBQU8sRUFBRUEsSUFBRixFQUFQO0FBQ0Q7QUFDRCxZQUFJLENBQUNzSixZQUFELElBQWlCLENBQUN6RSx3QkFBd0J5RSxZQUF4QixFQUFzQ3RKLElBQXRDLENBQXRCLEVBQW1FO0FBQ2pFLGdCQUFNLElBQUlOLE1BQU1rQyxLQUFWLENBQWdCbEMsTUFBTWtDLEtBQU4sQ0FBWUMsWUFBNUIsRUFBMkMsdUJBQXNCa0IsU0FBVSxFQUEzRSxDQUFOO0FBQ0Q7QUFDRDtBQUNBLGFBQUt1QyxNQUFMLENBQVlTLEtBQVo7QUFDQSxlQUFPLElBQVA7QUFDRCxPQXhCTSxDQUFQO0FBeUJELEtBekNNLENBQVA7QUEwQ0Q7O0FBRUQ7QUFDQTBELGNBQVkxRyxTQUFaLEVBQStCSCxTQUEvQixFQUFrRDRFLFFBQWxELEVBQWdGO0FBQzlFLFdBQU8sS0FBS2UsWUFBTCxDQUFrQixDQUFDeEYsU0FBRCxDQUFsQixFQUErQkgsU0FBL0IsRUFBMEM0RSxRQUExQyxDQUFQO0FBQ0Q7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQWUsZUFBYW1CLFVBQWIsRUFBd0M5RyxTQUF4QyxFQUEyRDRFLFFBQTNELEVBQXlGO0FBQ3ZGLFFBQUksQ0FBQzdFLGlCQUFpQkMsU0FBakIsQ0FBTCxFQUFrQztBQUNoQyxZQUFNLElBQUlsRCxNQUFNa0MsS0FBVixDQUFnQmxDLE1BQU1rQyxLQUFOLENBQVl5QixrQkFBNUIsRUFBZ0RKLHdCQUF3QkwsU0FBeEIsQ0FBaEQsQ0FBTjtBQUNEOztBQUVEOEcsZUFBV3ZILE9BQVgsQ0FBbUJZLGFBQWE7QUFDOUIsVUFBSSxDQUFDRCxpQkFBaUJDLFNBQWpCLENBQUwsRUFBa0M7QUFDaEMsY0FBTSxJQUFJckQsTUFBTWtDLEtBQVYsQ0FBZ0JsQyxNQUFNa0MsS0FBTixDQUFZb0gsZ0JBQTVCLEVBQStDLHVCQUFzQmpHLFNBQVUsRUFBL0UsQ0FBTjtBQUNEO0FBQ0Q7QUFDQSxVQUFJLENBQUNDLHlCQUF5QkQsU0FBekIsRUFBb0NILFNBQXBDLENBQUwsRUFBcUQ7QUFDbkQsY0FBTSxJQUFJbEQsTUFBTWtDLEtBQVYsQ0FBZ0IsR0FBaEIsRUFBc0IsU0FBUW1CLFNBQVUsb0JBQXhDLENBQU47QUFDRDtBQUNGLEtBUkQ7O0FBVUEsV0FBTyxLQUFLd0QsWUFBTCxDQUFrQjNELFNBQWxCLEVBQTZCLEtBQTdCLEVBQW9DLEVBQUM4QyxZQUFZLElBQWIsRUFBcEMsRUFDSndCLEtBREksQ0FDRUMsU0FBUztBQUNkLFVBQUlBLFVBQVU3RCxTQUFkLEVBQXlCO0FBQ3ZCLGNBQU0sSUFBSTVELE1BQU1rQyxLQUFWLENBQWdCbEMsTUFBTWtDLEtBQU4sQ0FBWXlCLGtCQUE1QixFQUFpRCxTQUFRVCxTQUFVLGtCQUFuRSxDQUFOO0FBQ0QsT0FGRCxNQUVPO0FBQ0wsY0FBTXVFLEtBQU47QUFDRDtBQUNGLEtBUEksRUFRSnJCLElBUkksQ0FRQ3JDLFVBQVU7QUFDZGlHLGlCQUFXdkgsT0FBWCxDQUFtQlksYUFBYTtBQUM5QixZQUFJLENBQUNVLE9BQU94QixNQUFQLENBQWNjLFNBQWQsQ0FBTCxFQUErQjtBQUM3QixnQkFBTSxJQUFJckQsTUFBTWtDLEtBQVYsQ0FBZ0IsR0FBaEIsRUFBc0IsU0FBUW1CLFNBQVUsaUNBQXhDLENBQU47QUFDRDtBQUNGLE9BSkQ7O0FBTUEsWUFBTTRHLDRCQUFvQmxHLE9BQU94QixNQUEzQixDQUFOO0FBQ0EsYUFBT3VGLFNBQVNvQyxPQUFULENBQWlCckIsWUFBakIsQ0FBOEIzRixTQUE5QixFQUF5Q2EsTUFBekMsRUFBaURpRyxVQUFqRCxFQUNKNUQsSUFESSxDQUNDLE1BQU07QUFDVixlQUFPRixRQUFROEMsR0FBUixDQUFZZ0IsV0FBV3JELEdBQVgsQ0FBZXRELGFBQWE7QUFDN0MsZ0JBQU00RSxRQUFRZ0MsYUFBYTVHLFNBQWIsQ0FBZDtBQUNBLGNBQUk0RSxTQUFTQSxNQUFNM0gsSUFBTixLQUFlLFVBQTVCLEVBQXdDO0FBQ3hDO0FBQ0UsbUJBQU93SCxTQUFTb0MsT0FBVCxDQUFpQkMsV0FBakIsQ0FBOEIsU0FBUTlHLFNBQVUsSUFBR0gsU0FBVSxFQUE3RCxDQUFQO0FBQ0Q7QUFDRCxpQkFBT2dELFFBQVFDLE9BQVIsRUFBUDtBQUNELFNBUGtCLENBQVosQ0FBUDtBQVFELE9BVkksQ0FBUDtBQVdELEtBM0JJLEVBMkJGQyxJQTNCRSxDQTJCRyxNQUFNO0FBQ1osV0FBS1IsTUFBTCxDQUFZUyxLQUFaO0FBQ0QsS0E3QkksQ0FBUDtBQThCRDs7QUFFRDtBQUNBO0FBQ0E7QUFDQStELGlCQUFlbEgsU0FBZixFQUFrQ21ILE1BQWxDLEVBQStDQyxLQUEvQyxFQUEyRDtBQUN6RCxRQUFJQyxXQUFXLENBQWY7QUFDQSxRQUFJdEUsVUFBVSxLQUFLbUQsa0JBQUwsQ0FBd0JsRyxTQUF4QixDQUFkO0FBQ0EsU0FBSyxNQUFNRyxTQUFYLElBQXdCZ0gsTUFBeEIsRUFBZ0M7QUFDOUIsVUFBSUEsT0FBT2hILFNBQVAsTUFBc0JPLFNBQTFCLEVBQXFDO0FBQ25DO0FBQ0Q7QUFDRCxZQUFNNEcsV0FBV0MsUUFBUUosT0FBT2hILFNBQVAsQ0FBUixDQUFqQjtBQUNBLFVBQUltSCxhQUFhLFVBQWpCLEVBQTZCO0FBQzNCRDtBQUNEO0FBQ0QsVUFBSUEsV0FBVyxDQUFmLEVBQWtCO0FBQ2hCO0FBQ0E7QUFDQSxlQUFPdEUsUUFBUUcsSUFBUixDQUFhLE1BQU07QUFDeEIsaUJBQU9GLFFBQVFtQixNQUFSLENBQWUsSUFBSXJILE1BQU1rQyxLQUFWLENBQWdCbEMsTUFBTWtDLEtBQU4sQ0FBWTJCLGNBQTVCLEVBQ3BCLGlEQURvQixDQUFmLENBQVA7QUFFRCxTQUhNLENBQVA7QUFJRDtBQUNELFVBQUksQ0FBQzJHLFFBQUwsRUFBZTtBQUNiO0FBQ0Q7QUFDRCxVQUFJbkgsY0FBYyxLQUFsQixFQUF5QjtBQUN2QjtBQUNBO0FBQ0Q7O0FBRUQ0QyxnQkFBVUEsUUFBUUcsSUFBUixDQUFhckMsVUFBVUEsT0FBT2dGLGtCQUFQLENBQTBCN0YsU0FBMUIsRUFBcUNHLFNBQXJDLEVBQWdEbUgsUUFBaEQsQ0FBdkIsQ0FBVjtBQUNEO0FBQ0R2RSxjQUFVeUUsNEJBQTRCekUsT0FBNUIsRUFBcUMvQyxTQUFyQyxFQUFnRG1ILE1BQWhELEVBQXdEQyxLQUF4RCxDQUFWO0FBQ0EsV0FBT3JFLE9BQVA7QUFDRDs7QUFFRDtBQUNBMEUsMEJBQXdCekgsU0FBeEIsRUFBMkNtSCxNQUEzQyxFQUF3REMsS0FBeEQsRUFBb0U7QUFDbEUsVUFBTU0sVUFBVXpKLGdCQUFnQitCLFNBQWhCLENBQWhCO0FBQ0EsUUFBSSxDQUFDMEgsT0FBRCxJQUFZQSxRQUFRbkcsTUFBUixJQUFrQixDQUFsQyxFQUFxQztBQUNuQyxhQUFPeUIsUUFBUUMsT0FBUixDQUFnQixJQUFoQixDQUFQO0FBQ0Q7O0FBRUQsVUFBTTBFLGlCQUFpQkQsUUFBUW5CLE1BQVIsQ0FBZSxVQUFTcUIsTUFBVCxFQUFnQjtBQUNwRCxVQUFJUixTQUFTQSxNQUFNUyxRQUFuQixFQUE2QjtBQUMzQixZQUFJVixPQUFPUyxNQUFQLEtBQWtCLE9BQU9ULE9BQU9TLE1BQVAsQ0FBUCxLQUEwQixRQUFoRCxFQUEwRDtBQUN4RDtBQUNBLGlCQUFPVCxPQUFPUyxNQUFQLEVBQWU1QyxJQUFmLElBQXVCLFFBQTlCO0FBQ0Q7QUFDRDtBQUNBLGVBQU8sS0FBUDtBQUNEO0FBQ0QsYUFBTyxDQUFDbUMsT0FBT1MsTUFBUCxDQUFSO0FBQ0QsS0FWc0IsQ0FBdkI7O0FBWUEsUUFBSUQsZUFBZXBHLE1BQWYsR0FBd0IsQ0FBNUIsRUFBK0I7QUFDN0IsWUFBTSxJQUFJekUsTUFBTWtDLEtBQVYsQ0FDSmxDLE1BQU1rQyxLQUFOLENBQVkyQixjQURSLEVBRUpnSCxlQUFlLENBQWYsSUFBb0IsZUFGaEIsQ0FBTjtBQUdEO0FBQ0QsV0FBTzNFLFFBQVFDLE9BQVIsQ0FBZ0IsSUFBaEIsQ0FBUDtBQUNEOztBQUVEO0FBQ0E2RSxjQUFZOUgsU0FBWixFQUErQitILFFBQS9CLEVBQW1EdkksU0FBbkQsRUFBc0U7QUFDcEUsUUFBSSxDQUFDLEtBQUtKLEtBQUwsQ0FBV1ksU0FBWCxDQUFELElBQTBCLENBQUMsS0FBS1osS0FBTCxDQUFXWSxTQUFYLEVBQXNCUixTQUF0QixDQUEvQixFQUFpRTtBQUMvRCxhQUFPLElBQVA7QUFDRDtBQUNELFVBQU13SSxhQUFhLEtBQUs1SSxLQUFMLENBQVdZLFNBQVgsQ0FBbkI7QUFDQSxVQUFNWixRQUFRNEksV0FBV3hJLFNBQVgsQ0FBZDtBQUNBO0FBQ0EsUUFBSUosTUFBTSxHQUFOLENBQUosRUFBZ0I7QUFDZCxhQUFPLElBQVA7QUFDRDtBQUNEO0FBQ0EsUUFBSTJJLFNBQVNFLElBQVQsQ0FBY0MsT0FBTztBQUFFLGFBQU85SSxNQUFNOEksR0FBTixNQUFlLElBQXRCO0FBQTRCLEtBQW5ELENBQUosRUFBMEQ7QUFDeEQsYUFBTyxJQUFQO0FBQ0Q7QUFDRCxXQUFPLEtBQVA7QUFDRDs7QUFFRDtBQUNBQyxxQkFBbUJuSSxTQUFuQixFQUFzQytILFFBQXRDLEVBQTBEdkksU0FBMUQsRUFBNkU7O0FBRTNFLFFBQUksS0FBS3NJLFdBQUwsQ0FBaUI5SCxTQUFqQixFQUE0QitILFFBQTVCLEVBQXNDdkksU0FBdEMsQ0FBSixFQUFzRDtBQUNwRCxhQUFPd0QsUUFBUUMsT0FBUixFQUFQO0FBQ0Q7O0FBRUQsUUFBSSxDQUFDLEtBQUs3RCxLQUFMLENBQVdZLFNBQVgsQ0FBRCxJQUEwQixDQUFDLEtBQUtaLEtBQUwsQ0FBV1ksU0FBWCxFQUFzQlIsU0FBdEIsQ0FBL0IsRUFBaUU7QUFDL0QsYUFBTyxJQUFQO0FBQ0Q7QUFDRCxVQUFNd0ksYUFBYSxLQUFLNUksS0FBTCxDQUFXWSxTQUFYLENBQW5CO0FBQ0EsVUFBTVosUUFBUTRJLFdBQVd4SSxTQUFYLENBQWQ7O0FBRUE7QUFDQTtBQUNBLFFBQUlKLE1BQU0sd0JBQU4sQ0FBSixFQUFxQztBQUNuQztBQUNBLFVBQUksQ0FBQzJJLFFBQUQsSUFBYUEsU0FBU3hHLE1BQVQsSUFBbUIsQ0FBcEMsRUFBdUM7QUFDckMsY0FBTSxJQUFJekUsTUFBTWtDLEtBQVYsQ0FBZ0JsQyxNQUFNa0MsS0FBTixDQUFZb0osZ0JBQTVCLEVBQ0osb0RBREksQ0FBTjtBQUVELE9BSEQsTUFHTyxJQUFJTCxTQUFTdEksT0FBVCxDQUFpQixHQUFqQixJQUF3QixDQUFDLENBQXpCLElBQThCc0ksU0FBU3hHLE1BQVQsSUFBbUIsQ0FBckQsRUFBd0Q7QUFDN0QsY0FBTSxJQUFJekUsTUFBTWtDLEtBQVYsQ0FBZ0JsQyxNQUFNa0MsS0FBTixDQUFZb0osZ0JBQTVCLEVBQ0osb0RBREksQ0FBTjtBQUVEO0FBQ0Q7QUFDQTtBQUNBLGFBQU9wRixRQUFRQyxPQUFSLEVBQVA7QUFDRDs7QUFFRDtBQUNBO0FBQ0EsVUFBTW9GLGtCQUFrQixDQUFDLEtBQUQsRUFBUSxNQUFSLEVBQWdCLE9BQWhCLEVBQXlCNUksT0FBekIsQ0FBaUNELFNBQWpDLElBQThDLENBQUMsQ0FBL0MsR0FBbUQsZ0JBQW5ELEdBQXNFLGlCQUE5Rjs7QUFFQTtBQUNBLFFBQUk2SSxtQkFBbUIsaUJBQW5CLElBQXdDN0ksYUFBYSxRQUF6RCxFQUFtRTtBQUNqRSxZQUFNLElBQUkxQyxNQUFNa0MsS0FBVixDQUFnQmxDLE1BQU1rQyxLQUFOLENBQVlzSixtQkFBNUIsRUFDSCxnQ0FBK0I5SSxTQUFVLGFBQVlRLFNBQVUsR0FENUQsQ0FBTjtBQUVEOztBQUVEO0FBQ0EsUUFBSU4sTUFBTUMsT0FBTixDQUFjcUksV0FBV0ssZUFBWCxDQUFkLEtBQThDTCxXQUFXSyxlQUFYLEVBQTRCOUcsTUFBNUIsR0FBcUMsQ0FBdkYsRUFBMEY7QUFDeEYsYUFBT3lCLFFBQVFDLE9BQVIsRUFBUDtBQUNEO0FBQ0QsVUFBTSxJQUFJbkcsTUFBTWtDLEtBQVYsQ0FBZ0JsQyxNQUFNa0MsS0FBTixDQUFZc0osbUJBQTVCLEVBQ0gsZ0NBQStCOUksU0FBVSxhQUFZUSxTQUFVLEdBRDVELENBQU47QUFFRDs7QUFFRDtBQUNBO0FBQ0EyRyxrQkFBZ0IzRyxTQUFoQixFQUFtQ0csU0FBbkMsRUFBK0U7QUFDN0UsUUFBSSxLQUFLd0MsSUFBTCxJQUFhLEtBQUtBLElBQUwsQ0FBVTNDLFNBQVYsQ0FBakIsRUFBdUM7QUFDckMsWUFBTTBHLGVBQWUsS0FBSy9ELElBQUwsQ0FBVTNDLFNBQVYsRUFBcUJHLFNBQXJCLENBQXJCO0FBQ0EsYUFBT3VHLGlCQUFpQixLQUFqQixHQUF5QixRQUF6QixHQUFvQ0EsWUFBM0M7QUFDRDtBQUNELFdBQU9oRyxTQUFQO0FBQ0Q7O0FBRUQ7QUFDQTZILFdBQVN2SSxTQUFULEVBQTRCO0FBQzFCLFdBQU8sS0FBSzRDLFVBQUwsR0FBa0JNLElBQWxCLENBQXVCLE1BQU0sQ0FBQyxDQUFFLEtBQUtQLElBQUwsQ0FBVTNDLFNBQVYsQ0FBaEMsQ0FBUDtBQUNEO0FBcmpCbUM7O2tCQUFqQnFDLGdCLEVBd2pCckI7O0FBQ0EsTUFBTW1HLE9BQU8sQ0FBQ0MsU0FBRCxFQUE0QmpHLFdBQTVCLEVBQThDSyxPQUE5QyxLQUEwRjtBQUNyRyxRQUFNaEMsU0FBUyxJQUFJd0IsZ0JBQUosQ0FBcUJvRyxTQUFyQixFQUFnQ2pHLFdBQWhDLENBQWY7QUFDQSxTQUFPM0IsT0FBTytCLFVBQVAsQ0FBa0JDLE9BQWxCLEVBQTJCSyxJQUEzQixDQUFnQyxNQUFNckMsTUFBdEMsQ0FBUDtBQUNELENBSEQ7O0FBS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVNxRSx1QkFBVCxDQUFpQ0wsY0FBakMsRUFBK0Q2RCxVQUEvRCxFQUE4RjtBQUM1RixRQUFNekQsWUFBWSxFQUFsQjtBQUNBO0FBQ0EsUUFBTTBELGlCQUFpQjFMLE9BQU9xQyxJQUFQLENBQVl0QyxjQUFaLEVBQTRCeUMsT0FBNUIsQ0FBb0NvRixlQUFlK0QsR0FBbkQsTUFBNEQsQ0FBQyxDQUE3RCxHQUFpRSxFQUFqRSxHQUFzRTNMLE9BQU9xQyxJQUFQLENBQVl0QyxlQUFlNkgsZUFBZStELEdBQTlCLENBQVosQ0FBN0Y7QUFDQSxPQUFLLE1BQU1DLFFBQVgsSUFBdUJoRSxjQUF2QixFQUF1QztBQUNyQyxRQUFJZ0UsYUFBYSxLQUFiLElBQXNCQSxhQUFhLEtBQW5DLElBQTZDQSxhQUFhLFdBQTFELElBQXlFQSxhQUFhLFdBQXRGLElBQXFHQSxhQUFhLFVBQXRILEVBQWtJO0FBQ2hJLFVBQUlGLGVBQWVwSCxNQUFmLEdBQXdCLENBQXhCLElBQTZCb0gsZUFBZWxKLE9BQWYsQ0FBdUJvSixRQUF2QixNQUFxQyxDQUFDLENBQXZFLEVBQTBFO0FBQ3hFO0FBQ0Q7QUFDRCxZQUFNQyxpQkFBaUJKLFdBQVdHLFFBQVgsS0FBd0JILFdBQVdHLFFBQVgsRUFBcUI3RCxJQUFyQixLQUE4QixRQUE3RTtBQUNBLFVBQUksQ0FBQzhELGNBQUwsRUFBcUI7QUFDbkI3RCxrQkFBVTRELFFBQVYsSUFBc0JoRSxlQUFlZ0UsUUFBZixDQUF0QjtBQUNEO0FBQ0Y7QUFDRjtBQUNELE9BQUssTUFBTUUsUUFBWCxJQUF1QkwsVUFBdkIsRUFBbUM7QUFDakMsUUFBSUssYUFBYSxVQUFiLElBQTJCTCxXQUFXSyxRQUFYLEVBQXFCL0QsSUFBckIsS0FBOEIsUUFBN0QsRUFBdUU7QUFDckUsVUFBSTJELGVBQWVwSCxNQUFmLEdBQXdCLENBQXhCLElBQTZCb0gsZUFBZWxKLE9BQWYsQ0FBdUJzSixRQUF2QixNQUFxQyxDQUFDLENBQXZFLEVBQTBFO0FBQ3hFO0FBQ0Q7QUFDRDlELGdCQUFVOEQsUUFBVixJQUFzQkwsV0FBV0ssUUFBWCxDQUF0QjtBQUNEO0FBQ0Y7QUFDRCxTQUFPOUQsU0FBUDtBQUNEOztBQUVEO0FBQ0E7QUFDQSxTQUFTdUMsMkJBQVQsQ0FBcUN3QixhQUFyQyxFQUFvRGhKLFNBQXBELEVBQStEbUgsTUFBL0QsRUFBdUVDLEtBQXZFLEVBQThFO0FBQzVFLFNBQU80QixjQUFjOUYsSUFBZCxDQUFvQnJDLE1BQUQsSUFBWTtBQUNwQyxXQUFPQSxPQUFPNEcsdUJBQVAsQ0FBK0J6SCxTQUEvQixFQUEwQ21ILE1BQTFDLEVBQWtEQyxLQUFsRCxDQUFQO0FBQ0QsR0FGTSxDQUFQO0FBR0Q7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVNHLE9BQVQsQ0FBaUIwQixHQUFqQixFQUFvRDtBQUNsRCxRQUFNN0wsT0FBTyxPQUFPNkwsR0FBcEI7QUFDQSxVQUFPN0wsSUFBUDtBQUNBLFNBQUssU0FBTDtBQUNFLGFBQU8sU0FBUDtBQUNGLFNBQUssUUFBTDtBQUNFLGFBQU8sUUFBUDtBQUNGLFNBQUssUUFBTDtBQUNFLGFBQU8sUUFBUDtBQUNGLFNBQUssS0FBTDtBQUNBLFNBQUssUUFBTDtBQUNFLFVBQUksQ0FBQzZMLEdBQUwsRUFBVTtBQUNSLGVBQU92SSxTQUFQO0FBQ0Q7QUFDRCxhQUFPd0ksY0FBY0QsR0FBZCxDQUFQO0FBQ0YsU0FBSyxVQUFMO0FBQ0EsU0FBSyxRQUFMO0FBQ0EsU0FBSyxXQUFMO0FBQ0E7QUFDRSxZQUFNLGNBQWNBLEdBQXBCO0FBakJGO0FBbUJEOztBQUVEO0FBQ0E7QUFDQTtBQUNBLFNBQVNDLGFBQVQsQ0FBdUJELEdBQXZCLEVBQXFEO0FBQ25ELE1BQUlBLGVBQWV2SixLQUFuQixFQUEwQjtBQUN4QixXQUFPLE9BQVA7QUFDRDtBQUNELE1BQUl1SixJQUFJRSxNQUFSLEVBQWU7QUFDYixZQUFPRixJQUFJRSxNQUFYO0FBQ0EsV0FBSyxTQUFMO0FBQ0UsWUFBR0YsSUFBSWpKLFNBQVAsRUFBa0I7QUFDaEIsaUJBQU87QUFDTDVDLGtCQUFNLFNBREQ7QUFFTEkseUJBQWF5TCxJQUFJako7QUFGWixXQUFQO0FBSUQ7QUFDRDtBQUNGLFdBQUssVUFBTDtBQUNFLFlBQUdpSixJQUFJakosU0FBUCxFQUFrQjtBQUNoQixpQkFBTztBQUNMNUMsa0JBQU0sVUFERDtBQUVMSSx5QkFBYXlMLElBQUlqSjtBQUZaLFdBQVA7QUFJRDtBQUNEO0FBQ0YsV0FBSyxNQUFMO0FBQ0UsWUFBR2lKLElBQUluRSxJQUFQLEVBQWE7QUFDWCxpQkFBTyxNQUFQO0FBQ0Q7QUFDRDtBQUNGLFdBQUssTUFBTDtBQUNFLFlBQUdtRSxJQUFJRyxHQUFQLEVBQVk7QUFDVixpQkFBTyxNQUFQO0FBQ0Q7QUFDRDtBQUNGLFdBQUssVUFBTDtBQUNFLFlBQUdILElBQUlJLFFBQUosSUFBZ0IsSUFBaEIsSUFBd0JKLElBQUlLLFNBQUosSUFBaUIsSUFBNUMsRUFBa0Q7QUFDaEQsaUJBQU8sVUFBUDtBQUNEO0FBQ0Q7QUFDRixXQUFLLE9BQUw7QUFDRSxZQUFHTCxJQUFJTSxNQUFQLEVBQWU7QUFDYixpQkFBTyxPQUFQO0FBQ0Q7QUFDRDtBQUNGLFdBQUssU0FBTDtBQUNFLFlBQUdOLElBQUlPLFdBQVAsRUFBb0I7QUFDbEIsaUJBQU8sU0FBUDtBQUNEO0FBQ0Q7QUF6Q0Y7QUEyQ0EsVUFBTSxJQUFJMU0sTUFBTWtDLEtBQVYsQ0FBZ0JsQyxNQUFNa0MsS0FBTixDQUFZMkIsY0FBNUIsRUFBNEMseUJBQXlCc0ksSUFBSUUsTUFBekUsQ0FBTjtBQUNEO0FBQ0QsTUFBSUYsSUFBSSxLQUFKLENBQUosRUFBZ0I7QUFDZCxXQUFPQyxjQUFjRCxJQUFJLEtBQUosQ0FBZCxDQUFQO0FBQ0Q7QUFDRCxNQUFJQSxJQUFJakUsSUFBUixFQUFjO0FBQ1osWUFBT2lFLElBQUlqRSxJQUFYO0FBQ0EsV0FBSyxXQUFMO0FBQ0UsZUFBTyxRQUFQO0FBQ0YsV0FBSyxRQUFMO0FBQ0UsZUFBTyxJQUFQO0FBQ0YsV0FBSyxLQUFMO0FBQ0EsV0FBSyxXQUFMO0FBQ0EsV0FBSyxRQUFMO0FBQ0UsZUFBTyxPQUFQO0FBQ0YsV0FBSyxhQUFMO0FBQ0EsV0FBSyxnQkFBTDtBQUNFLGVBQU87QUFDTDVILGdCQUFNLFVBREQ7QUFFTEksdUJBQWF5TCxJQUFJUSxPQUFKLENBQVksQ0FBWixFQUFleko7QUFGdkIsU0FBUDtBQUlGLFdBQUssT0FBTDtBQUNFLGVBQU9rSixjQUFjRCxJQUFJUyxHQUFKLENBQVEsQ0FBUixDQUFkLENBQVA7QUFDRjtBQUNFLGNBQU0sb0JBQW9CVCxJQUFJakUsSUFBOUI7QUFsQkY7QUFvQkQ7QUFDRCxTQUFPLFFBQVA7QUFDRDs7UUFHQ3dELEksR0FBQUEsSTtRQUNBekksZ0IsR0FBQUEsZ0I7UUFDQUcsZ0IsR0FBQUEsZ0I7UUFDQUcsdUIsR0FBQUEsdUI7UUFDQTZFLHVCLEdBQUFBLHVCO1FBQ0FoSCxhLEdBQUFBLGE7UUFDQWxCLGMsR0FBQUEsYztRQUNBNEQsNEIsR0FBQUEsNEI7UUFDQW9CLHNCLEdBQUFBLHNCO1FBQ0FLLGdCLEdBQUFBLGdCIiwiZmlsZSI6IlNjaGVtYUNvbnRyb2xsZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAZmxvd1xuLy8gVGhpcyBjbGFzcyBoYW5kbGVzIHNjaGVtYSB2YWxpZGF0aW9uLCBwZXJzaXN0ZW5jZSwgYW5kIG1vZGlmaWNhdGlvbi5cbi8vXG4vLyBFYWNoIGluZGl2aWR1YWwgU2NoZW1hIG9iamVjdCBzaG91bGQgYmUgaW1tdXRhYmxlLiBUaGUgaGVscGVycyB0b1xuLy8gZG8gdGhpbmdzIHdpdGggdGhlIFNjaGVtYSBqdXN0IHJldHVybiBhIG5ldyBzY2hlbWEgd2hlbiB0aGUgc2NoZW1hXG4vLyBpcyBjaGFuZ2VkLlxuLy9cbi8vIFRoZSBjYW5vbmljYWwgcGxhY2UgdG8gc3RvcmUgdGhpcyBTY2hlbWEgaXMgaW4gdGhlIGRhdGFiYXNlIGl0c2VsZixcbi8vIGluIGEgX1NDSEVNQSBjb2xsZWN0aW9uLiBUaGlzIGlzIG5vdCB0aGUgcmlnaHQgd2F5IHRvIGRvIGl0IGZvciBhblxuLy8gb3BlbiBzb3VyY2UgZnJhbWV3b3JrLCBidXQgaXQncyBiYWNrd2FyZCBjb21wYXRpYmxlLCBzbyB3ZSdyZVxuLy8ga2VlcGluZyBpdCB0aGlzIHdheSBmb3Igbm93LlxuLy9cbi8vIEluIEFQSS1oYW5kbGluZyBjb2RlLCB5b3Ugc2hvdWxkIG9ubHkgdXNlIHRoZSBTY2hlbWEgY2xhc3MgdmlhIHRoZVxuLy8gRGF0YWJhc2VDb250cm9sbGVyLiBUaGlzIHdpbGwgbGV0IHVzIHJlcGxhY2UgdGhlIHNjaGVtYSBsb2dpYyBmb3Jcbi8vIGRpZmZlcmVudCBkYXRhYmFzZXMuXG4vLyBUT0RPOiBoaWRlIGFsbCBzY2hlbWEgbG9naWMgaW5zaWRlIHRoZSBkYXRhYmFzZSBhZGFwdGVyLlxuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5jb25zdCBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKS5QYXJzZTtcbmltcG9ydCB7IFN0b3JhZ2VBZGFwdGVyIH0gICAgIGZyb20gJy4uL0FkYXB0ZXJzL1N0b3JhZ2UvU3RvcmFnZUFkYXB0ZXInO1xuaW1wb3J0IERhdGFiYXNlQ29udHJvbGxlciAgICAgZnJvbSAnLi9EYXRhYmFzZUNvbnRyb2xsZXInO1xuaW1wb3J0IHR5cGUge1xuICBTY2hlbWEsXG4gIFNjaGVtYUZpZWxkcyxcbiAgQ2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICBTY2hlbWFGaWVsZCxcbiAgTG9hZFNjaGVtYU9wdGlvbnMsXG59IGZyb20gJy4vdHlwZXMnO1xuXG5jb25zdCBkZWZhdWx0Q29sdW1uczoge1tzdHJpbmddOiBTY2hlbWFGaWVsZHN9ID0gT2JqZWN0LmZyZWV6ZSh7XG4gIC8vIENvbnRhaW4gdGhlIGRlZmF1bHQgY29sdW1ucyBmb3IgZXZlcnkgcGFyc2Ugb2JqZWN0IHR5cGUgKGV4Y2VwdCBfSm9pbiBjb2xsZWN0aW9uKVxuICBfRGVmYXVsdDoge1xuICAgIFwib2JqZWN0SWRcIjogIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImNyZWF0ZWRBdFwiOiB7dHlwZTonRGF0ZSd9LFxuICAgIFwidXBkYXRlZEF0XCI6IHt0eXBlOidEYXRlJ30sXG4gICAgXCJBQ0xcIjogICAgICAge3R5cGU6J0FDTCd9LFxuICB9LFxuICAvLyBUaGUgYWRkaXRpb25hbCBkZWZhdWx0IGNvbHVtbnMgZm9yIHRoZSBfVXNlciBjb2xsZWN0aW9uIChpbiBhZGRpdGlvbiB0byBEZWZhdWx0Q29scylcbiAgX1VzZXI6IHtcbiAgICBcInVzZXJuYW1lXCI6ICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwicGFzc3dvcmRcIjogICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJlbWFpbFwiOiAgICAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImVtYWlsVmVyaWZpZWRcIjoge3R5cGU6J0Jvb2xlYW4nfSxcbiAgICBcImF1dGhEYXRhXCI6ICAgICAge3R5cGU6J09iamVjdCd9XG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9JbnN0YWxsYXRpb24gY29sbGVjdGlvbiAoaW4gYWRkaXRpb24gdG8gRGVmYXVsdENvbHMpXG4gIF9JbnN0YWxsYXRpb246IHtcbiAgICBcImluc3RhbGxhdGlvbklkXCI6ICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiZGV2aWNlVG9rZW5cIjogICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJjaGFubmVsc1wiOiAgICAgICAgIHt0eXBlOidBcnJheSd9LFxuICAgIFwiZGV2aWNlVHlwZVwiOiAgICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJwdXNoVHlwZVwiOiAgICAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcIkdDTVNlbmRlcklkXCI6ICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwidGltZVpvbmVcIjogICAgICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJsb2NhbGVJZGVudGlmaWVyXCI6IHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImJhZGdlXCI6ICAgICAgICAgICAge3R5cGU6J051bWJlcid9LFxuICAgIFwiYXBwVmVyc2lvblwiOiAgICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJhcHBOYW1lXCI6ICAgICAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImFwcElkZW50aWZpZXJcIjogICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwicGFyc2VWZXJzaW9uXCI6ICAgICB7dHlwZTonU3RyaW5nJ30sXG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9Sb2xlIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfUm9sZToge1xuICAgIFwibmFtZVwiOiAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwidXNlcnNcIjoge3R5cGU6J1JlbGF0aW9uJywgdGFyZ2V0Q2xhc3M6J19Vc2VyJ30sXG4gICAgXCJyb2xlc1wiOiB7dHlwZTonUmVsYXRpb24nLCB0YXJnZXRDbGFzczonX1JvbGUnfVxuICB9LFxuICAvLyBUaGUgYWRkaXRpb25hbCBkZWZhdWx0IGNvbHVtbnMgZm9yIHRoZSBfU2Vzc2lvbiBjb2xsZWN0aW9uIChpbiBhZGRpdGlvbiB0byBEZWZhdWx0Q29scylcbiAgX1Nlc3Npb246IHtcbiAgICBcInJlc3RyaWN0ZWRcIjogICAgIHt0eXBlOidCb29sZWFuJ30sXG4gICAgXCJ1c2VyXCI6ICAgICAgICAgICB7dHlwZTonUG9pbnRlcicsIHRhcmdldENsYXNzOidfVXNlcid9LFxuICAgIFwiaW5zdGFsbGF0aW9uSWRcIjoge3R5cGU6J1N0cmluZyd9LFxuICAgIFwic2Vzc2lvblRva2VuXCI6ICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiZXhwaXJlc0F0XCI6ICAgICAge3R5cGU6J0RhdGUnfSxcbiAgICBcImNyZWF0ZWRXaXRoXCI6ICAgIHt0eXBlOidPYmplY3QnfVxuICB9LFxuICBfUHJvZHVjdDoge1xuICAgIFwicHJvZHVjdElkZW50aWZpZXJcIjogIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImRvd25sb2FkXCI6ICAgICAgICAgICB7dHlwZTonRmlsZSd9LFxuICAgIFwiZG93bmxvYWROYW1lXCI6ICAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImljb25cIjogICAgICAgICAgICAgICB7dHlwZTonRmlsZSd9LFxuICAgIFwib3JkZXJcIjogICAgICAgICAgICAgIHt0eXBlOidOdW1iZXInfSxcbiAgICBcInRpdGxlXCI6ICAgICAgICAgICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJzdWJ0aXRsZVwiOiAgICAgICAgICAge3R5cGU6J1N0cmluZyd9LFxuICB9LFxuICBfUHVzaFN0YXR1czoge1xuICAgIFwicHVzaFRpbWVcIjogICAgICAgICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJzb3VyY2VcIjogICAgICAgICAgICAgIHt0eXBlOidTdHJpbmcnfSwgLy8gcmVzdCBvciB3ZWJ1aVxuICAgIFwicXVlcnlcIjogICAgICAgICAgICAgICB7dHlwZTonU3RyaW5nJ30sIC8vIHRoZSBzdHJpbmdpZmllZCBKU09OIHF1ZXJ5XG4gICAgXCJwYXlsb2FkXCI6ICAgICAgICAgICAgIHt0eXBlOidTdHJpbmcnfSwgLy8gdGhlIHN0cmluZ2lmaWVkIEpTT04gcGF5bG9hZCxcbiAgICBcInRpdGxlXCI6ICAgICAgICAgICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiZXhwaXJ5XCI6ICAgICAgICAgICAgICB7dHlwZTonTnVtYmVyJ30sXG4gICAgXCJleHBpcmF0aW9uX2ludGVydmFsXCI6IHt0eXBlOidOdW1iZXInfSxcbiAgICBcInN0YXR1c1wiOiAgICAgICAgICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwibnVtU2VudFwiOiAgICAgICAgICAgICB7dHlwZTonTnVtYmVyJ30sXG4gICAgXCJudW1GYWlsZWRcIjogICAgICAgICAgIHt0eXBlOidOdW1iZXInfSxcbiAgICBcInB1c2hIYXNoXCI6ICAgICAgICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiZXJyb3JNZXNzYWdlXCI6ICAgICAgICB7dHlwZTonT2JqZWN0J30sXG4gICAgXCJzZW50UGVyVHlwZVwiOiAgICAgICAgIHt0eXBlOidPYmplY3QnfSxcbiAgICBcImZhaWxlZFBlclR5cGVcIjogICAgICAge3R5cGU6J09iamVjdCd9LFxuICAgIFwic2VudFBlclVUQ09mZnNldFwiOiAgICB7dHlwZTonT2JqZWN0J30sXG4gICAgXCJmYWlsZWRQZXJVVENPZmZzZXRcIjogIHt0eXBlOidPYmplY3QnfSxcbiAgICBcImNvdW50XCI6ICAgICAgICAgICAgICAge3R5cGU6J051bWJlcid9IC8vIHRyYWNrcyAjIG9mIGJhdGNoZXMgcXVldWVkIGFuZCBwZW5kaW5nXG4gIH0sXG4gIF9Kb2JTdGF0dXM6IHtcbiAgICBcImpvYk5hbWVcIjogICAge3R5cGU6ICdTdHJpbmcnfSxcbiAgICBcInNvdXJjZVwiOiAgICAge3R5cGU6ICdTdHJpbmcnfSxcbiAgICBcInN0YXR1c1wiOiAgICAge3R5cGU6ICdTdHJpbmcnfSxcbiAgICBcIm1lc3NhZ2VcIjogICAge3R5cGU6ICdTdHJpbmcnfSxcbiAgICBcInBhcmFtc1wiOiAgICAge3R5cGU6ICdPYmplY3QnfSwgLy8gcGFyYW1zIHJlY2VpdmVkIHdoZW4gY2FsbGluZyB0aGUgam9iXG4gICAgXCJmaW5pc2hlZEF0XCI6IHt0eXBlOiAnRGF0ZSd9XG4gIH0sXG4gIF9Kb2JTY2hlZHVsZToge1xuICAgIFwiam9iTmFtZVwiOiAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImRlc2NyaXB0aW9uXCI6ICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJwYXJhbXNcIjogICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwic3RhcnRBZnRlclwiOiAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImRheXNPZldlZWtcIjogICB7dHlwZTonQXJyYXknfSxcbiAgICBcInRpbWVPZkRheVwiOiAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJsYXN0UnVuXCI6ICAgICAge3R5cGU6J051bWJlcid9LFxuICAgIFwicmVwZWF0TWludXRlc1wiOnt0eXBlOidOdW1iZXInfVxuICB9LFxuICBfSG9va3M6IHtcbiAgICBcImZ1bmN0aW9uTmFtZVwiOiB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJjbGFzc05hbWVcIjogICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwidHJpZ2dlck5hbWVcIjogIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcInVybFwiOiAgICAgICAgICB7dHlwZTonU3RyaW5nJ31cbiAgfSxcbiAgX0dsb2JhbENvbmZpZzoge1xuICAgIFwib2JqZWN0SWRcIjoge3R5cGU6ICdTdHJpbmcnfSxcbiAgICBcInBhcmFtc1wiOiAgIHt0eXBlOiAnT2JqZWN0J31cbiAgfSxcbiAgX0F1ZGllbmNlOiB7XG4gICAgXCJvYmplY3RJZFwiOiAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwibmFtZVwiOiAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcInF1ZXJ5XCI6ICAgICB7dHlwZTonU3RyaW5nJ30sIC8vc3RvcmluZyBxdWVyeSBhcyBKU09OIHN0cmluZyB0byBwcmV2ZW50IFwiTmVzdGVkIGtleXMgc2hvdWxkIG5vdCBjb250YWluIHRoZSAnJCcgb3IgJy4nIGNoYXJhY3RlcnNcIiBlcnJvclxuICAgIFwibGFzdFVzZWRcIjogIHt0eXBlOidEYXRlJ30sXG4gICAgXCJ0aW1lc1VzZWRcIjoge3R5cGU6J051bWJlcid9XG4gIH1cbn0pO1xuXG5jb25zdCByZXF1aXJlZENvbHVtbnMgPSBPYmplY3QuZnJlZXplKHtcbiAgX1Byb2R1Y3Q6IFtcInByb2R1Y3RJZGVudGlmaWVyXCIsIFwiaWNvblwiLCBcIm9yZGVyXCIsIFwidGl0bGVcIiwgXCJzdWJ0aXRsZVwiXSxcbiAgX1JvbGU6IFtcIm5hbWVcIiwgXCJBQ0xcIl1cbn0pO1xuXG5jb25zdCBzeXN0ZW1DbGFzc2VzID0gT2JqZWN0LmZyZWV6ZShbJ19Vc2VyJywgJ19JbnN0YWxsYXRpb24nLCAnX1JvbGUnLCAnX1Nlc3Npb24nLCAnX1Byb2R1Y3QnLCAnX1B1c2hTdGF0dXMnLCAnX0pvYlN0YXR1cycsICdfSm9iU2NoZWR1bGUnLCAnX0F1ZGllbmNlJ10pO1xuXG5jb25zdCB2b2xhdGlsZUNsYXNzZXMgPSBPYmplY3QuZnJlZXplKFsnX0pvYlN0YXR1cycsICdfUHVzaFN0YXR1cycsICdfSG9va3MnLCAnX0dsb2JhbENvbmZpZycsICdfSm9iU2NoZWR1bGUnLCAnX0F1ZGllbmNlJ10pO1xuXG4vLyAxMCBhbHBoYSBudW1iZXJpYyBjaGFycyArIHVwcGVyY2FzZVxuY29uc3QgdXNlcklkUmVnZXggPSAvXlthLXpBLVowLTldezEwfSQvO1xuLy8gQW55dGhpbmcgdGhhdCBzdGFydCB3aXRoIHJvbGVcbmNvbnN0IHJvbGVSZWdleCA9IC9ecm9sZTouKi87XG4vLyAqIHBlcm1pc3Npb25cbmNvbnN0IHB1YmxpY1JlZ2V4ID0gL15cXCokL1xuXG5jb25zdCByZXF1aXJlQXV0aGVudGljYXRpb25SZWdleCA9IC9ecmVxdWlyZXNBdXRoZW50aWNhdGlvbiQvXG5cbmNvbnN0IHBlcm1pc3Npb25LZXlSZWdleCA9IE9iamVjdC5mcmVlemUoW3VzZXJJZFJlZ2V4LCByb2xlUmVnZXgsIHB1YmxpY1JlZ2V4LCByZXF1aXJlQXV0aGVudGljYXRpb25SZWdleF0pO1xuXG5mdW5jdGlvbiB2ZXJpZnlQZXJtaXNzaW9uS2V5KGtleSkge1xuICBjb25zdCByZXN1bHQgPSBwZXJtaXNzaW9uS2V5UmVnZXgucmVkdWNlKChpc0dvb2QsIHJlZ0V4KSA9PiB7XG4gICAgaXNHb29kID0gaXNHb29kIHx8IGtleS5tYXRjaChyZWdFeCkgIT0gbnVsbDtcbiAgICByZXR1cm4gaXNHb29kO1xuICB9LCBmYWxzZSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYCcke2tleX0nIGlzIG5vdCBhIHZhbGlkIGtleSBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnNgKTtcbiAgfVxufVxuXG5jb25zdCBDTFBWYWxpZEtleXMgPSBPYmplY3QuZnJlZXplKFsnZmluZCcsICdjb3VudCcsICdnZXQnLCAnY3JlYXRlJywgJ3VwZGF0ZScsICdkZWxldGUnLCAnYWRkRmllbGQnLCAncmVhZFVzZXJGaWVsZHMnLCAnd3JpdGVVc2VyRmllbGRzJ10pO1xuZnVuY3Rpb24gdmFsaWRhdGVDTFAocGVybXM6IENsYXNzTGV2ZWxQZXJtaXNzaW9ucywgZmllbGRzOiBTY2hlbWFGaWVsZHMpIHtcbiAgaWYgKCFwZXJtcykge1xuICAgIHJldHVybjtcbiAgfVxuICBPYmplY3Qua2V5cyhwZXJtcykuZm9yRWFjaCgob3BlcmF0aW9uKSA9PiB7XG4gICAgaWYgKENMUFZhbGlkS2V5cy5pbmRleE9mKG9wZXJhdGlvbikgPT0gLTEpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sIGAke29wZXJhdGlvbn0gaXMgbm90IGEgdmFsaWQgb3BlcmF0aW9uIGZvciBjbGFzcyBsZXZlbCBwZXJtaXNzaW9uc2ApO1xuICAgIH1cbiAgICBpZiAoIXBlcm1zW29wZXJhdGlvbl0pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAob3BlcmF0aW9uID09PSAncmVhZFVzZXJGaWVsZHMnIHx8IG9wZXJhdGlvbiA9PT0gJ3dyaXRlVXNlckZpZWxkcycpIHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShwZXJtc1tvcGVyYXRpb25dKSkge1xuICAgICAgICAvLyBAZmxvdy1kaXNhYmxlLW5leHRcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYCcke3Blcm1zW29wZXJhdGlvbl19JyBpcyBub3QgYSB2YWxpZCB2YWx1ZSBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnMgJHtvcGVyYXRpb259YCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwZXJtc1tvcGVyYXRpb25dLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgICAgIGlmICghZmllbGRzW2tleV0gfHwgZmllbGRzW2tleV0udHlwZSAhPSAnUG9pbnRlcicgfHwgZmllbGRzW2tleV0udGFyZ2V0Q2xhc3MgIT0gJ19Vc2VyJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYCcke2tleX0nIGlzIG5vdCBhIHZhbGlkIGNvbHVtbiBmb3IgY2xhc3MgbGV2ZWwgcG9pbnRlciBwZXJtaXNzaW9ucyAke29wZXJhdGlvbn1gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgIE9iamVjdC5rZXlzKHBlcm1zW29wZXJhdGlvbl0pLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgdmVyaWZ5UGVybWlzc2lvbktleShrZXkpO1xuICAgICAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gICAgICBjb25zdCBwZXJtID0gcGVybXNbb3BlcmF0aW9uXVtrZXldO1xuICAgICAgaWYgKHBlcm0gIT09IHRydWUpIHtcbiAgICAgICAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sIGAnJHtwZXJtfScgaXMgbm90IGEgdmFsaWQgdmFsdWUgZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zICR7b3BlcmF0aW9ufToke2tleX06JHtwZXJtfWApO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbn1cbmNvbnN0IGpvaW5DbGFzc1JlZ2V4ID0gL15fSm9pbjpbQS1aYS16MC05X10rOltBLVphLXowLTlfXSsvO1xuY29uc3QgY2xhc3NBbmRGaWVsZFJlZ2V4ID0gL15bQS1aYS16XVtBLVphLXowLTlfXSokLztcbmZ1bmN0aW9uIGNsYXNzTmFtZUlzVmFsaWQoY2xhc3NOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgLy8gVmFsaWQgY2xhc3NlcyBtdXN0OlxuICByZXR1cm4gKFxuICAgIC8vIEJlIG9uZSBvZiBfVXNlciwgX0luc3RhbGxhdGlvbiwgX1JvbGUsIF9TZXNzaW9uIE9SXG4gICAgc3lzdGVtQ2xhc3Nlcy5pbmRleE9mKGNsYXNzTmFtZSkgPiAtMSB8fFxuICAgIC8vIEJlIGEgam9pbiB0YWJsZSBPUlxuICAgIGpvaW5DbGFzc1JlZ2V4LnRlc3QoY2xhc3NOYW1lKSB8fFxuICAgIC8vIEluY2x1ZGUgb25seSBhbHBoYS1udW1lcmljIGFuZCB1bmRlcnNjb3JlcywgYW5kIG5vdCBzdGFydCB3aXRoIGFuIHVuZGVyc2NvcmUgb3IgbnVtYmVyXG4gICAgZmllbGROYW1lSXNWYWxpZChjbGFzc05hbWUpXG4gICk7XG59XG5cbi8vIFZhbGlkIGZpZWxkcyBtdXN0IGJlIGFscGhhLW51bWVyaWMsIGFuZCBub3Qgc3RhcnQgd2l0aCBhbiB1bmRlcnNjb3JlIG9yIG51bWJlclxuZnVuY3Rpb24gZmllbGROYW1lSXNWYWxpZChmaWVsZE5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gY2xhc3NBbmRGaWVsZFJlZ2V4LnRlc3QoZmllbGROYW1lKTtcbn1cblxuLy8gQ2hlY2tzIHRoYXQgaXQncyBub3QgdHJ5aW5nIHRvIGNsb2JiZXIgb25lIG9mIHRoZSBkZWZhdWx0IGZpZWxkcyBvZiB0aGUgY2xhc3MuXG5mdW5jdGlvbiBmaWVsZE5hbWVJc1ZhbGlkRm9yQ2xhc3MoZmllbGROYW1lOiBzdHJpbmcsIGNsYXNzTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmICghZmllbGROYW1lSXNWYWxpZChmaWVsZE5hbWUpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmIChkZWZhdWx0Q29sdW1ucy5fRGVmYXVsdFtmaWVsZE5hbWVdKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmIChkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdICYmIGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV1bZmllbGROYW1lXSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UoY2xhc3NOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gJ0ludmFsaWQgY2xhc3NuYW1lOiAnICsgY2xhc3NOYW1lICsgJywgY2xhc3NuYW1lcyBjYW4gb25seSBoYXZlIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzIGFuZCBfLCBhbmQgbXVzdCBzdGFydCB3aXRoIGFuIGFscGhhIGNoYXJhY3RlciAnO1xufVxuXG5jb25zdCBpbnZhbGlkSnNvbkVycm9yID0gbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgXCJpbnZhbGlkIEpTT05cIik7XG5jb25zdCB2YWxpZE5vblJlbGF0aW9uT3JQb2ludGVyVHlwZXMgPSBbXG4gICdOdW1iZXInLFxuICAnU3RyaW5nJyxcbiAgJ0Jvb2xlYW4nLFxuICAnRGF0ZScsXG4gICdPYmplY3QnLFxuICAnQXJyYXknLFxuICAnR2VvUG9pbnQnLFxuICAnRmlsZScsXG4gICdCeXRlcycsXG4gICdQb2x5Z29uJ1xuXTtcbi8vIFJldHVybnMgYW4gZXJyb3Igc3VpdGFibGUgZm9yIHRocm93aW5nIGlmIHRoZSB0eXBlIGlzIGludmFsaWRcbmNvbnN0IGZpZWxkVHlwZUlzSW52YWxpZCA9ICh7IHR5cGUsIHRhcmdldENsYXNzIH0pID0+IHtcbiAgaWYgKFsnUG9pbnRlcicsICdSZWxhdGlvbiddLmluZGV4T2YodHlwZSkgPj0gMCkge1xuICAgIGlmICghdGFyZ2V0Q2xhc3MpIHtcbiAgICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoMTM1LCBgdHlwZSAke3R5cGV9IG5lZWRzIGEgY2xhc3MgbmFtZWApO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHRhcmdldENsYXNzICE9PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGludmFsaWRKc29uRXJyb3I7XG4gICAgfSBlbHNlIGlmICghY2xhc3NOYW1lSXNWYWxpZCh0YXJnZXRDbGFzcykpIHtcbiAgICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLCBpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZSh0YXJnZXRDbGFzcykpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuICBpZiAodHlwZW9mIHR5cGUgIT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGludmFsaWRKc29uRXJyb3I7XG4gIH1cbiAgaWYgKHZhbGlkTm9uUmVsYXRpb25PclBvaW50ZXJUeXBlcy5pbmRleE9mKHR5cGUpIDwgMCkge1xuICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsIGBpbnZhbGlkIGZpZWxkIHR5cGU6ICR7dHlwZX1gKTtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5jb25zdCBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hID0gKHNjaGVtYTogYW55KSA9PiB7XG4gIHNjaGVtYSA9IGluamVjdERlZmF1bHRTY2hlbWEoc2NoZW1hKTtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuQUNMO1xuICBzY2hlbWEuZmllbGRzLl9ycGVybSA9IHsgdHlwZTogJ0FycmF5JyB9O1xuICBzY2hlbWEuZmllbGRzLl93cGVybSA9IHsgdHlwZTogJ0FycmF5JyB9O1xuXG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMucGFzc3dvcmQ7XG4gICAgc2NoZW1hLmZpZWxkcy5faGFzaGVkX3Bhc3N3b3JkID0geyB0eXBlOiAnU3RyaW5nJyB9O1xuICB9XG5cbiAgcmV0dXJuIHNjaGVtYTtcbn1cblxuY29uc3QgY29udmVydEFkYXB0ZXJTY2hlbWFUb1BhcnNlU2NoZW1hID0gKHsuLi5zY2hlbWF9KSA9PiB7XG4gIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl9ycGVybTtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX3dwZXJtO1xuXG4gIHNjaGVtYS5maWVsZHMuQUNMID0geyB0eXBlOiAnQUNMJyB9O1xuXG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuYXV0aERhdGE7IC8vQXV0aCBkYXRhIGlzIGltcGxpY2l0XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX2hhc2hlZF9wYXNzd29yZDtcbiAgICBzY2hlbWEuZmllbGRzLnBhc3N3b3JkID0geyB0eXBlOiAnU3RyaW5nJyB9O1xuICB9XG5cbiAgaWYgKHNjaGVtYS5pbmRleGVzICYmIE9iamVjdC5rZXlzKHNjaGVtYS5pbmRleGVzKS5sZW5ndGggPT09IDApIHtcbiAgICBkZWxldGUgc2NoZW1hLmluZGV4ZXM7XG4gIH1cblxuICByZXR1cm4gc2NoZW1hO1xufVxuXG5jb25zdCBpbmplY3REZWZhdWx0U2NoZW1hID0gKHtjbGFzc05hbWUsIGZpZWxkcywgY2xhc3NMZXZlbFBlcm1pc3Npb25zLCBpbmRleGVzfTogU2NoZW1hKSA9PiB7XG4gIGNvbnN0IGRlZmF1bHRTY2hlbWE6IFNjaGVtYSA9IHtcbiAgICBjbGFzc05hbWUsXG4gICAgZmllbGRzOiB7XG4gICAgICAuLi5kZWZhdWx0Q29sdW1ucy5fRGVmYXVsdCxcbiAgICAgIC4uLihkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdIHx8IHt9KSxcbiAgICAgIC4uLmZpZWxkcyxcbiAgICB9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgfTtcbiAgaWYgKGluZGV4ZXMgJiYgT2JqZWN0LmtleXMoaW5kZXhlcykubGVuZ3RoICE9PSAwKSB7XG4gICAgZGVmYXVsdFNjaGVtYS5pbmRleGVzID0gaW5kZXhlcztcbiAgfVxuICByZXR1cm4gZGVmYXVsdFNjaGVtYTtcbn07XG5cbmNvbnN0IF9Ib29rc1NjaGVtYSA9ICB7Y2xhc3NOYW1lOiBcIl9Ib29rc1wiLCBmaWVsZHM6IGRlZmF1bHRDb2x1bW5zLl9Ib29rc307XG5jb25zdCBfR2xvYmFsQ29uZmlnU2NoZW1hID0geyBjbGFzc05hbWU6IFwiX0dsb2JhbENvbmZpZ1wiLCBmaWVsZHM6IGRlZmF1bHRDb2x1bW5zLl9HbG9iYWxDb25maWcgfVxuY29uc3QgX1B1c2hTdGF0dXNTY2hlbWEgPSBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKGluamVjdERlZmF1bHRTY2hlbWEoe1xuICBjbGFzc05hbWU6IFwiX1B1c2hTdGF0dXNcIixcbiAgZmllbGRzOiB7fSxcbiAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fVxufSkpO1xuY29uc3QgX0pvYlN0YXR1c1NjaGVtYSA9IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoaW5qZWN0RGVmYXVsdFNjaGVtYSh7XG4gIGNsYXNzTmFtZTogXCJfSm9iU3RhdHVzXCIsXG4gIGZpZWxkczoge30sXG4gIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge31cbn0pKTtcbmNvbnN0IF9Kb2JTY2hlZHVsZVNjaGVtYSA9IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoaW5qZWN0RGVmYXVsdFNjaGVtYSh7XG4gIGNsYXNzTmFtZTogXCJfSm9iU2NoZWR1bGVcIixcbiAgZmllbGRzOiB7fSxcbiAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fVxufSkpO1xuY29uc3QgX0F1ZGllbmNlU2NoZW1hID0gY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYShpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgY2xhc3NOYW1lOiBcIl9BdWRpZW5jZVwiLFxuICBmaWVsZHM6IGRlZmF1bHRDb2x1bW5zLl9BdWRpZW5jZSxcbiAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fVxufSkpO1xuY29uc3QgVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyA9IFtfSG9va3NTY2hlbWEsIF9Kb2JTdGF0dXNTY2hlbWEsIF9Kb2JTY2hlZHVsZVNjaGVtYSwgX1B1c2hTdGF0dXNTY2hlbWEsIF9HbG9iYWxDb25maWdTY2hlbWEsIF9BdWRpZW5jZVNjaGVtYV07XG5cbmNvbnN0IGRiVHlwZU1hdGNoZXNPYmplY3RUeXBlID0gKGRiVHlwZTogU2NoZW1hRmllbGQgfCBzdHJpbmcsIG9iamVjdFR5cGU6IFNjaGVtYUZpZWxkKSA9PiB7XG4gIGlmIChkYlR5cGUudHlwZSAhPT0gb2JqZWN0VHlwZS50eXBlKSByZXR1cm4gZmFsc2U7XG4gIGlmIChkYlR5cGUudGFyZ2V0Q2xhc3MgIT09IG9iamVjdFR5cGUudGFyZ2V0Q2xhc3MpIHJldHVybiBmYWxzZTtcbiAgaWYgKGRiVHlwZSA9PT0gb2JqZWN0VHlwZS50eXBlKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKGRiVHlwZS50eXBlID09PSBvYmplY3RUeXBlLnR5cGUpIHJldHVybiB0cnVlO1xuICByZXR1cm4gZmFsc2U7XG59XG5cbmNvbnN0IHR5cGVUb1N0cmluZyA9ICh0eXBlOiBTY2hlbWFGaWVsZCB8IHN0cmluZyk6IHN0cmluZyA9PiB7XG4gIGlmICh0eXBlb2YgdHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gdHlwZTtcbiAgfVxuICBpZiAodHlwZS50YXJnZXRDbGFzcykge1xuICAgIHJldHVybiBgJHt0eXBlLnR5cGV9PCR7dHlwZS50YXJnZXRDbGFzc30+YDtcbiAgfVxuICByZXR1cm4gYCR7dHlwZS50eXBlfWA7XG59XG5cbi8vIFN0b3JlcyB0aGUgZW50aXJlIHNjaGVtYSBvZiB0aGUgYXBwIGluIGEgd2VpcmQgaHlicmlkIGZvcm1hdCBzb21ld2hlcmUgYmV0d2VlblxuLy8gdGhlIG1vbmdvIGZvcm1hdCBhbmQgdGhlIFBhcnNlIGZvcm1hdC4gU29vbiwgdGhpcyB3aWxsIGFsbCBiZSBQYXJzZSBmb3JtYXQuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTY2hlbWFDb250cm9sbGVyIHtcbiAgX2RiQWRhcHRlcjogU3RvcmFnZUFkYXB0ZXI7XG4gIGRhdGE6IGFueTtcbiAgcGVybXM6IGFueTtcbiAgaW5kZXhlczogYW55O1xuICBfY2FjaGU6IGFueTtcbiAgcmVsb2FkRGF0YVByb21pc2U6IFByb21pc2U8YW55PjtcblxuICBjb25zdHJ1Y3RvcihkYXRhYmFzZUFkYXB0ZXI6IFN0b3JhZ2VBZGFwdGVyLCBzY2hlbWFDYWNoZTogYW55KSB7XG4gICAgdGhpcy5fZGJBZGFwdGVyID0gZGF0YWJhc2VBZGFwdGVyO1xuICAgIHRoaXMuX2NhY2hlID0gc2NoZW1hQ2FjaGU7XG4gICAgLy8gdGhpcy5kYXRhW2NsYXNzTmFtZV1bZmllbGROYW1lXSB0ZWxscyB5b3UgdGhlIHR5cGUgb2YgdGhhdCBmaWVsZCwgaW4gbW9uZ28gZm9ybWF0XG4gICAgdGhpcy5kYXRhID0ge307XG4gICAgLy8gdGhpcy5wZXJtc1tjbGFzc05hbWVdW29wZXJhdGlvbl0gdGVsbHMgeW91IHRoZSBhY2wtc3R5bGUgcGVybWlzc2lvbnNcbiAgICB0aGlzLnBlcm1zID0ge307XG4gICAgLy8gdGhpcy5pbmRleGVzW2NsYXNzTmFtZV1bb3BlcmF0aW9uXSB0ZWxscyB5b3UgdGhlIGluZGV4ZXNcbiAgICB0aGlzLmluZGV4ZXMgPSB7fTtcbiAgfVxuXG4gIHJlbG9hZERhdGEob3B0aW9uczogTG9hZFNjaGVtYU9wdGlvbnMgPSB7Y2xlYXJDYWNoZTogZmFsc2V9KTogUHJvbWlzZTxhbnk+IHtcbiAgICBsZXQgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgIGlmIChvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgIHByb21pc2UgPSBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAodGhpcy5yZWxvYWREYXRhUHJvbWlzZSAmJiAhb3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgICB9XG4gICAgdGhpcy5yZWxvYWREYXRhUHJvbWlzZSA9IHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5nZXRBbGxDbGFzc2VzKG9wdGlvbnMpLnRoZW4oKGFsbFNjaGVtYXMpID0+IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IHt9O1xuICAgICAgICBjb25zdCBwZXJtcyA9IHt9O1xuICAgICAgICBjb25zdCBpbmRleGVzID0ge307XG4gICAgICAgIGFsbFNjaGVtYXMuZm9yRWFjaChzY2hlbWEgPT4ge1xuICAgICAgICAgIGRhdGFbc2NoZW1hLmNsYXNzTmFtZV0gPSBpbmplY3REZWZhdWx0U2NoZW1hKHNjaGVtYSkuZmllbGRzO1xuICAgICAgICAgIHBlcm1zW3NjaGVtYS5jbGFzc05hbWVdID0gc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucztcbiAgICAgICAgICBpbmRleGVzW3NjaGVtYS5jbGFzc05hbWVdID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEluamVjdCB0aGUgaW4tbWVtb3J5IGNsYXNzZXNcbiAgICAgICAgdm9sYXRpbGVDbGFzc2VzLmZvckVhY2goY2xhc3NOYW1lID0+IHtcbiAgICAgICAgICBjb25zdCBzY2hlbWEgPSBpbmplY3REZWZhdWx0U2NoZW1hKHsgY2xhc3NOYW1lLCBmaWVsZHM6IHt9LCBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9IH0pO1xuICAgICAgICAgIGRhdGFbY2xhc3NOYW1lXSA9IHNjaGVtYS5maWVsZHM7XG4gICAgICAgICAgcGVybXNbY2xhc3NOYW1lXSA9IHNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnM7XG4gICAgICAgICAgaW5kZXhlc1tjbGFzc05hbWVdID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgICAgICB0aGlzLnBlcm1zID0gcGVybXM7XG4gICAgICAgIHRoaXMuaW5kZXhlcyA9IGluZGV4ZXM7XG4gICAgICAgIGRlbGV0ZSB0aGlzLnJlbG9hZERhdGFQcm9taXNlO1xuICAgICAgfSwgKGVycikgPT4ge1xuICAgICAgICB0aGlzLmRhdGEgPSB7fTtcbiAgICAgICAgdGhpcy5wZXJtcyA9IHt9O1xuICAgICAgICB0aGlzLmluZGV4ZXMgPSB7fTtcbiAgICAgICAgZGVsZXRlIHRoaXMucmVsb2FkRGF0YVByb21pc2U7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH0pXG4gICAgfSkudGhlbigoKSA9PiB7fSk7XG4gICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YVByb21pc2U7XG4gIH1cblxuICBnZXRBbGxDbGFzc2VzKG9wdGlvbnM6IExvYWRTY2hlbWFPcHRpb25zID0ge2NsZWFyQ2FjaGU6IGZhbHNlfSk6IFByb21pc2U8QXJyYXk8U2NoZW1hPj4ge1xuICAgIGxldCBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgaWYgKG9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgcHJvbWlzZSA9IHRoaXMuX2NhY2hlLmNsZWFyKCk7XG4gICAgfVxuICAgIHJldHVybiBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLmdldEFsbENsYXNzZXMoKVxuICAgIH0pLnRoZW4oKGFsbENsYXNzZXMpID0+IHtcbiAgICAgIGlmIChhbGxDbGFzc2VzICYmIGFsbENsYXNzZXMubGVuZ3RoICYmICFvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShhbGxDbGFzc2VzKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzLl9kYkFkYXB0ZXIuZ2V0QWxsQ2xhc3NlcygpXG4gICAgICAgIC50aGVuKGFsbFNjaGVtYXMgPT4gYWxsU2NoZW1hcy5tYXAoaW5qZWN0RGVmYXVsdFNjaGVtYSkpXG4gICAgICAgIC50aGVuKGFsbFNjaGVtYXMgPT4ge1xuICAgICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5zZXRBbGxDbGFzc2VzKGFsbFNjaGVtYXMpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGFsbFNjaGVtYXM7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pXG4gICAgfSk7XG4gIH1cblxuICBnZXRPbmVTY2hlbWEoY2xhc3NOYW1lOiBzdHJpbmcsIGFsbG93Vm9sYXRpbGVDbGFzc2VzOiBib29sZWFuID0gZmFsc2UsIG9wdGlvbnM6IExvYWRTY2hlbWFPcHRpb25zID0ge2NsZWFyQ2FjaGU6IGZhbHNlfSk6IFByb21pc2U8U2NoZW1hPiB7XG4gICAgbGV0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICBpZiAob3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICBwcm9taXNlID0gdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICBpZiAoYWxsb3dWb2xhdGlsZUNsYXNzZXMgJiYgdm9sYXRpbGVDbGFzc2VzLmluZGV4T2YoY2xhc3NOYW1lKSA+IC0xKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBmaWVsZHM6IHRoaXMuZGF0YVtjbGFzc05hbWVdLFxuICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogdGhpcy5wZXJtc1tjbGFzc05hbWVdLFxuICAgICAgICAgIGluZGV4ZXM6IHRoaXMuaW5kZXhlc1tjbGFzc05hbWVdXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLmdldE9uZVNjaGVtYShjbGFzc05hbWUpLnRoZW4oKGNhY2hlZCkgPT4ge1xuICAgICAgICBpZiAoY2FjaGVkICYmICFvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGNhY2hlZCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlci5nZXRDbGFzcyhjbGFzc05hbWUpXG4gICAgICAgICAgLnRoZW4oaW5qZWN0RGVmYXVsdFNjaGVtYSlcbiAgICAgICAgICAudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY2FjaGUuc2V0T25lU2NoZW1hKGNsYXNzTmFtZSwgcmVzdWx0KS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIENyZWF0ZSBhIG5ldyBjbGFzcyB0aGF0IGluY2x1ZGVzIHRoZSB0aHJlZSBkZWZhdWx0IGZpZWxkcy5cbiAgLy8gQUNMIGlzIGFuIGltcGxpY2l0IGNvbHVtbiB0aGF0IGRvZXMgbm90IGdldCBhbiBlbnRyeSBpbiB0aGVcbiAgLy8gX1NDSEVNQVMgZGF0YWJhc2UuIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGVcbiAgLy8gY3JlYXRlZCBzY2hlbWEsIGluIG1vbmdvIGZvcm1hdC5cbiAgLy8gb24gc3VjY2VzcywgYW5kIHJlamVjdHMgd2l0aCBhbiBlcnJvciBvbiBmYWlsLiBFbnN1cmUgeW91XG4gIC8vIGhhdmUgYXV0aG9yaXphdGlvbiAobWFzdGVyIGtleSwgb3IgY2xpZW50IGNsYXNzIGNyZWF0aW9uXG4gIC8vIGVuYWJsZWQpIGJlZm9yZSBjYWxsaW5nIHRoaXMgZnVuY3Rpb24uXG4gIGFkZENsYXNzSWZOb3RFeGlzdHMoY2xhc3NOYW1lOiBzdHJpbmcsIGZpZWxkczogU2NoZW1hRmllbGRzID0ge30sIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogYW55LCBpbmRleGVzOiBhbnkgPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHZhciB2YWxpZGF0aW9uRXJyb3IgPSB0aGlzLnZhbGlkYXRlTmV3Q2xhc3MoY2xhc3NOYW1lLCBmaWVsZHMsIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyk7XG4gICAgaWYgKHZhbGlkYXRpb25FcnJvcikge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KHZhbGlkYXRpb25FcnJvcik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlci5jcmVhdGVDbGFzcyhjbGFzc05hbWUsIGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoeyBmaWVsZHMsIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgaW5kZXhlcywgY2xhc3NOYW1lIH0pKVxuICAgICAgLnRoZW4oY29udmVydEFkYXB0ZXJTY2hlbWFUb1BhcnNlU2NoZW1hKVxuICAgICAgLnRoZW4oKHJlcykgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5fY2FjaGUuY2xlYXIoKS50aGVuKCgpID0+IHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlcyk7XG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvciAmJiBlcnJvci5jb2RlID09PSBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLCBgQ2xhc3MgJHtjbGFzc05hbWV9IGFscmVhZHkgZXhpc3RzLmApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIHVwZGF0ZUNsYXNzKGNsYXNzTmFtZTogc3RyaW5nLCBzdWJtaXR0ZWRGaWVsZHM6IFNjaGVtYUZpZWxkcywgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBhbnksIGluZGV4ZXM6IGFueSwgZGF0YWJhc2U6IERhdGFiYXNlQ29udHJvbGxlcikge1xuICAgIHJldHVybiB0aGlzLmdldE9uZVNjaGVtYShjbGFzc05hbWUpXG4gICAgICAudGhlbihzY2hlbWEgPT4ge1xuICAgICAgICBjb25zdCBleGlzdGluZ0ZpZWxkcyA9IHNjaGVtYS5maWVsZHM7XG4gICAgICAgIE9iamVjdC5rZXlzKHN1Ym1pdHRlZEZpZWxkcykuZm9yRWFjaChuYW1lID0+IHtcbiAgICAgICAgICBjb25zdCBmaWVsZCA9IHN1Ym1pdHRlZEZpZWxkc1tuYW1lXTtcbiAgICAgICAgICBpZiAoZXhpc3RpbmdGaWVsZHNbbmFtZV0gJiYgZmllbGQuX19vcCAhPT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigyNTUsIGBGaWVsZCAke25hbWV9IGV4aXN0cywgY2Fubm90IHVwZGF0ZS5gKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKCFleGlzdGluZ0ZpZWxkc1tuYW1lXSAmJiBmaWVsZC5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDI1NSwgYEZpZWxkICR7bmFtZX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBkZWxldGUuYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBkZWxldGUgZXhpc3RpbmdGaWVsZHMuX3JwZXJtO1xuICAgICAgICBkZWxldGUgZXhpc3RpbmdGaWVsZHMuX3dwZXJtO1xuICAgICAgICBjb25zdCBuZXdTY2hlbWEgPSBidWlsZE1lcmdlZFNjaGVtYU9iamVjdChleGlzdGluZ0ZpZWxkcywgc3VibWl0dGVkRmllbGRzKTtcbiAgICAgICAgY29uc3QgZGVmYXVsdEZpZWxkcyA9IGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0gfHwgZGVmYXVsdENvbHVtbnMuX0RlZmF1bHQ7XG4gICAgICAgIGNvbnN0IGZ1bGxOZXdTY2hlbWEgPSBPYmplY3QuYXNzaWduKHt9LCBuZXdTY2hlbWEsIGRlZmF1bHRGaWVsZHMpO1xuICAgICAgICBjb25zdCB2YWxpZGF0aW9uRXJyb3IgPSB0aGlzLnZhbGlkYXRlU2NoZW1hRGF0YShjbGFzc05hbWUsIG5ld1NjaGVtYSwgY2xhc3NMZXZlbFBlcm1pc3Npb25zLCBPYmplY3Qua2V5cyhleGlzdGluZ0ZpZWxkcykpO1xuICAgICAgICBpZiAodmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKHZhbGlkYXRpb25FcnJvci5jb2RlLCB2YWxpZGF0aW9uRXJyb3IuZXJyb3IpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmluYWxseSB3ZSBoYXZlIGNoZWNrZWQgdG8gbWFrZSBzdXJlIHRoZSByZXF1ZXN0IGlzIHZhbGlkIGFuZCB3ZSBjYW4gc3RhcnQgZGVsZXRpbmcgZmllbGRzLlxuICAgICAgICAvLyBEbyBhbGwgZGVsZXRpb25zIGZpcnN0LCB0aGVuIGEgc2luZ2xlIHNhdmUgdG8gX1NDSEVNQSBjb2xsZWN0aW9uIHRvIGhhbmRsZSBhbGwgYWRkaXRpb25zLlxuICAgICAgICBjb25zdCBkZWxldGVkRmllbGRzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICBjb25zdCBpbnNlcnRlZEZpZWxkcyA9IFtdO1xuICAgICAgICBPYmplY3Qua2V5cyhzdWJtaXR0ZWRGaWVsZHMpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgICAgICBpZiAoc3VibWl0dGVkRmllbGRzW2ZpZWxkTmFtZV0uX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgICAgIGRlbGV0ZWRGaWVsZHMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpbnNlcnRlZEZpZWxkcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBsZXQgZGVsZXRlUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICBpZiAoZGVsZXRlZEZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgZGVsZXRlUHJvbWlzZSA9IHRoaXMuZGVsZXRlRmllbGRzKGRlbGV0ZWRGaWVsZHMsIGNsYXNzTmFtZSwgZGF0YWJhc2UpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkZWxldGVQcm9taXNlIC8vIERlbGV0ZSBFdmVyeXRoaW5nXG4gICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KSkgLy8gUmVsb2FkIG91ciBTY2hlbWEsIHNvIHdlIGhhdmUgYWxsIHRoZSBuZXcgdmFsdWVzXG4gICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBpbnNlcnRlZEZpZWxkcy5tYXAoZmllbGROYW1lID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgdHlwZSA9IHN1Ym1pdHRlZEZpZWxkc1tmaWVsZE5hbWVdO1xuICAgICAgICAgICAgICByZXR1cm4gdGhpcy5lbmZvcmNlRmllbGRFeGlzdHMoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHR5cGUpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5zZXRQZXJtaXNzaW9ucyhjbGFzc05hbWUsIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgbmV3U2NoZW1hKSlcbiAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLl9kYkFkYXB0ZXIuc2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQoY2xhc3NOYW1lLCBpbmRleGVzLCBzY2hlbWEuaW5kZXhlcywgZnVsbE5ld1NjaGVtYSkpXG4gICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KSlcbiAgICAgICAgLy9UT0RPOiBNb3ZlIHRoaXMgbG9naWMgaW50byB0aGUgZGF0YWJhc2UgYWRhcHRlclxuICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHJlbG9hZGVkU2NoZW1hOiBTY2hlbWEgPSB7XG4gICAgICAgICAgICAgIGNsYXNzTmFtZTogY2xhc3NOYW1lLFxuICAgICAgICAgICAgICBmaWVsZHM6IHRoaXMuZGF0YVtjbGFzc05hbWVdLFxuICAgICAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHRoaXMucGVybXNbY2xhc3NOYW1lXSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBpZiAodGhpcy5pbmRleGVzW2NsYXNzTmFtZV0gJiYgT2JqZWN0LmtleXModGhpcy5pbmRleGVzW2NsYXNzTmFtZV0pLmxlbmd0aCAhPT0gMCkge1xuICAgICAgICAgICAgICByZWxvYWRlZFNjaGVtYS5pbmRleGVzID0gdGhpcy5pbmRleGVzW2NsYXNzTmFtZV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gcmVsb2FkZWRTY2hlbWE7XG4gICAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLCBgQ2xhc3MgJHtjbGFzc05hbWV9IGRvZXMgbm90IGV4aXN0LmApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9KVxuICB9XG5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBzdWNjZXNzZnVsbHkgdG8gdGhlIG5ldyBzY2hlbWFcbiAgLy8gb2JqZWN0IG9yIGZhaWxzIHdpdGggYSByZWFzb24uXG4gIGVuZm9yY2VDbGFzc0V4aXN0cyhjbGFzc05hbWU6IHN0cmluZyk6IFByb21pc2U8U2NoZW1hQ29udHJvbGxlcj4ge1xuICAgIGlmICh0aGlzLmRhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzKTtcbiAgICB9XG4gICAgLy8gV2UgZG9uJ3QgaGF2ZSB0aGlzIGNsYXNzLiBVcGRhdGUgdGhlIHNjaGVtYVxuICAgIHJldHVybiB0aGlzLmFkZENsYXNzSWZOb3RFeGlzdHMoY2xhc3NOYW1lKVxuICAgIC8vIFRoZSBzY2hlbWEgdXBkYXRlIHN1Y2NlZWRlZC4gUmVsb2FkIHRoZSBzY2hlbWFcbiAgICAgIC50aGVuKCgpID0+IHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSkpXG4gICAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgLy8gVGhlIHNjaGVtYSB1cGRhdGUgZmFpbGVkLiBUaGlzIGNhbiBiZSBva2F5IC0gaXQgbWlnaHRcbiAgICAgIC8vIGhhdmUgZmFpbGVkIGJlY2F1c2UgdGhlcmUncyBhIHJhY2UgY29uZGl0aW9uIGFuZCBhIGRpZmZlcmVudFxuICAgICAgLy8gY2xpZW50IGlzIG1ha2luZyB0aGUgZXhhY3Qgc2FtZSBzY2hlbWEgdXBkYXRlIHRoYXQgd2Ugd2FudC5cbiAgICAgIC8vIFNvIGp1c3QgcmVsb2FkIHRoZSBzY2hlbWEuXG4gICAgICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pO1xuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgIC8vIEVuc3VyZSB0aGF0IHRoZSBzY2hlbWEgbm93IHZhbGlkYXRlc1xuICAgICAgICBpZiAodGhpcy5kYXRhW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgRmFpbGVkIHRvIGFkZCAke2NsYXNzTmFtZX1gKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAvLyBUaGUgc2NoZW1hIHN0aWxsIGRvZXNuJ3QgdmFsaWRhdGUuIEdpdmUgdXBcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ3NjaGVtYSBjbGFzcyBuYW1lIGRvZXMgbm90IHJldmFsaWRhdGUnKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgdmFsaWRhdGVOZXdDbGFzcyhjbGFzc05hbWU6IHN0cmluZywgZmllbGRzOiBTY2hlbWFGaWVsZHMgPSB7fSwgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBhbnkpOiBhbnkge1xuICAgIGlmICh0aGlzLmRhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSwgYENsYXNzICR7Y2xhc3NOYW1lfSBhbHJlYWR5IGV4aXN0cy5gKTtcbiAgICB9XG4gICAgaWYgKCFjbGFzc05hbWVJc1ZhbGlkKGNsYXNzTmFtZSkpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgZXJyb3I6IGludmFsaWRDbGFzc05hbWVNZXNzYWdlKGNsYXNzTmFtZSksXG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy52YWxpZGF0ZVNjaGVtYURhdGEoY2xhc3NOYW1lLCBmaWVsZHMsIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgW10pO1xuICB9XG5cbiAgdmFsaWRhdGVTY2hlbWFEYXRhKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZHM6IFNjaGVtYUZpZWxkcywgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBDbGFzc0xldmVsUGVybWlzc2lvbnMsIGV4aXN0aW5nRmllbGROYW1lczogQXJyYXk8c3RyaW5nPikge1xuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIGZpZWxkcykge1xuICAgICAgaWYgKGV4aXN0aW5nRmllbGROYW1lcy5pbmRleE9mKGZpZWxkTmFtZSkgPCAwKSB7XG4gICAgICAgIGlmICghZmllbGROYW1lSXNWYWxpZChmaWVsZE5hbWUpKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsXG4gICAgICAgICAgICBlcnJvcjogJ2ludmFsaWQgZmllbGQgbmFtZTogJyArIGZpZWxkTmFtZSxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGlmICghZmllbGROYW1lSXNWYWxpZEZvckNsYXNzKGZpZWxkTmFtZSwgY2xhc3NOYW1lKSkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb2RlOiAxMzYsXG4gICAgICAgICAgICBlcnJvcjogJ2ZpZWxkICcgKyBmaWVsZE5hbWUgKyAnIGNhbm5vdCBiZSBhZGRlZCcsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBlcnJvciA9IGZpZWxkVHlwZUlzSW52YWxpZChmaWVsZHNbZmllbGROYW1lXSk7XG4gICAgICAgIGlmIChlcnJvcikgcmV0dXJuIHsgY29kZTogZXJyb3IuY29kZSwgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdKSB7XG4gICAgICBmaWVsZHNbZmllbGROYW1lXSA9IGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV1bZmllbGROYW1lXTtcbiAgICB9XG5cbiAgICBjb25zdCBnZW9Qb2ludHMgPSBPYmplY3Qua2V5cyhmaWVsZHMpLmZpbHRlcihrZXkgPT4gZmllbGRzW2tleV0gJiYgZmllbGRzW2tleV0udHlwZSA9PT0gJ0dlb1BvaW50Jyk7XG4gICAgaWYgKGdlb1BvaW50cy5sZW5ndGggPiAxKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb2RlOiBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgICAgZXJyb3I6ICdjdXJyZW50bHksIG9ubHkgb25lIEdlb1BvaW50IGZpZWxkIG1heSBleGlzdCBpbiBhbiBvYmplY3QuIEFkZGluZyAnICsgZ2VvUG9pbnRzWzFdICsgJyB3aGVuICcgKyBnZW9Qb2ludHNbMF0gKyAnIGFscmVhZHkgZXhpc3RzLicsXG4gICAgICB9O1xuICAgIH1cbiAgICB2YWxpZGF0ZUNMUChjbGFzc0xldmVsUGVybWlzc2lvbnMsIGZpZWxkcyk7XG4gIH1cblxuICAvLyBTZXRzIHRoZSBDbGFzcy1sZXZlbCBwZXJtaXNzaW9ucyBmb3IgYSBnaXZlbiBjbGFzc05hbWUsIHdoaWNoIG11c3QgZXhpc3QuXG4gIHNldFBlcm1pc3Npb25zKGNsYXNzTmFtZTogc3RyaW5nLCBwZXJtczogYW55LCBuZXdTY2hlbWE6IFNjaGVtYUZpZWxkcykge1xuICAgIGlmICh0eXBlb2YgcGVybXMgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuICAgIHZhbGlkYXRlQ0xQKHBlcm1zLCBuZXdTY2hlbWEpO1xuICAgIHJldHVybiB0aGlzLl9kYkFkYXB0ZXIuc2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZSwgcGVybXMpO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBzdWNjZXNzZnVsbHkgdG8gdGhlIG5ldyBzY2hlbWFcbiAgLy8gb2JqZWN0IGlmIHRoZSBwcm92aWRlZCBjbGFzc05hbWUtZmllbGROYW1lLXR5cGUgdHVwbGUgaXMgdmFsaWQuXG4gIC8vIFRoZSBjbGFzc05hbWUgbXVzdCBhbHJlYWR5IGJlIHZhbGlkYXRlZC5cbiAgLy8gSWYgJ2ZyZWV6ZScgaXMgdHJ1ZSwgcmVmdXNlIHRvIHVwZGF0ZSB0aGUgc2NoZW1hIGZvciB0aGlzIGZpZWxkLlxuICBlbmZvcmNlRmllbGRFeGlzdHMoY2xhc3NOYW1lOiBzdHJpbmcsIGZpZWxkTmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmcgfCBTY2hlbWFGaWVsZCkge1xuICAgIGlmIChmaWVsZE5hbWUuaW5kZXhPZihcIi5cIikgPiAwKSB7XG4gICAgICAvLyBzdWJkb2N1bWVudCBrZXkgKHgueSkgPT4gb2sgaWYgeCBpcyBvZiB0eXBlICdvYmplY3QnXG4gICAgICBmaWVsZE5hbWUgPSBmaWVsZE5hbWUuc3BsaXQoXCIuXCIpWyAwIF07XG4gICAgICB0eXBlID0gJ09iamVjdCc7XG4gICAgfVxuICAgIGlmICghZmllbGROYW1lSXNWYWxpZChmaWVsZE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgYEludmFsaWQgZmllbGQgbmFtZTogJHtmaWVsZE5hbWV9LmApO1xuICAgIH1cblxuICAgIC8vIElmIHNvbWVvbmUgdHJpZXMgdG8gY3JlYXRlIGEgbmV3IGZpZWxkIHdpdGggbnVsbC91bmRlZmluZWQgYXMgdGhlIHZhbHVlLCByZXR1cm47XG4gICAgaWYgKCF0eXBlKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGEoKS50aGVuKCgpID0+IHtcbiAgICAgIGNvbnN0IGV4cGVjdGVkVHlwZSA9IHRoaXMuZ2V0RXhwZWN0ZWRUeXBlKGNsYXNzTmFtZSwgZmllbGROYW1lKTtcbiAgICAgIGlmICh0eXBlb2YgdHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgdHlwZSA9IHsgdHlwZSB9O1xuICAgICAgfVxuXG4gICAgICBpZiAoZXhwZWN0ZWRUeXBlKSB7XG4gICAgICAgIGlmICghZGJUeXBlTWF0Y2hlc09iamVjdFR5cGUoZXhwZWN0ZWRUeXBlLCB0eXBlKSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgICAgICAgYHNjaGVtYSBtaXNtYXRjaCBmb3IgJHtjbGFzc05hbWV9LiR7ZmllbGROYW1lfTsgZXhwZWN0ZWQgJHt0eXBlVG9TdHJpbmcoZXhwZWN0ZWRUeXBlKX0gYnV0IGdvdCAke3R5cGVUb1N0cmluZyh0eXBlKX1gXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlci5hZGRGaWVsZElmTm90RXhpc3RzKGNsYXNzTmFtZSwgZmllbGROYW1lLCB0eXBlKS50aGVuKCgpID0+IHtcbiAgICAgICAgLy8gVGhlIHVwZGF0ZSBzdWNjZWVkZWQuIFJlbG9hZCB0aGUgc2NoZW1hXG4gICAgICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pO1xuICAgICAgfSwgKGVycm9yKSA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09IFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFKSB7XG4gICAgICAgICAgLy8gTWFrZSBzdXJlIHRoYXQgd2UgdGhyb3cgZXJyb3JzIHdoZW4gaXQgaXMgYXBwcm9wcmlhdGUgdG8gZG8gc28uXG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgICAgLy8gVGhlIHVwZGF0ZSBmYWlsZWQuIFRoaXMgY2FuIGJlIG9rYXkgLSBpdCBtaWdodCBoYXZlIGJlZW4gYSByYWNlXG4gICAgICAgIC8vIGNvbmRpdGlvbiB3aGVyZSBhbm90aGVyIGNsaWVudCB1cGRhdGVkIHRoZSBzY2hlbWEgaW4gdGhlIHNhbWVcbiAgICAgICAgLy8gd2F5IHRoYXQgd2Ugd2FudGVkIHRvLiBTbywganVzdCByZWxvYWQgdGhlIHNjaGVtYVxuICAgICAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KTtcbiAgICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgICAvLyBFbnN1cmUgdGhhdCB0aGUgc2NoZW1hIG5vdyB2YWxpZGF0ZXNcbiAgICAgICAgY29uc3QgZXhwZWN0ZWRUeXBlID0gdGhpcy5nZXRFeHBlY3RlZFR5cGUoY2xhc3NOYW1lLCBmaWVsZE5hbWUpO1xuICAgICAgICBpZiAodHlwZW9mIHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgdHlwZSA9IHsgdHlwZSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmICghZXhwZWN0ZWRUeXBlIHx8ICFkYlR5cGVNYXRjaGVzT2JqZWN0VHlwZShleHBlY3RlZFR5cGUsIHR5cGUpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYENvdWxkIG5vdCBhZGQgZmllbGQgJHtmaWVsZE5hbWV9YCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gUmVtb3ZlIHRoZSBjYWNoZWQgc2NoZW1hXG4gICAgICAgIHRoaXMuX2NhY2hlLmNsZWFyKCk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBtYWludGFpbiBjb21wYXRpYmlsaXR5XG4gIGRlbGV0ZUZpZWxkKGZpZWxkTmFtZTogc3RyaW5nLCBjbGFzc05hbWU6IHN0cmluZywgZGF0YWJhc2U6IERhdGFiYXNlQ29udHJvbGxlcikge1xuICAgIHJldHVybiB0aGlzLmRlbGV0ZUZpZWxkcyhbZmllbGROYW1lXSwgY2xhc3NOYW1lLCBkYXRhYmFzZSk7XG4gIH1cblxuICAvLyBEZWxldGUgZmllbGRzLCBhbmQgcmVtb3ZlIHRoYXQgZGF0YSBmcm9tIGFsbCBvYmplY3RzLiBUaGlzIGlzIGludGVuZGVkXG4gIC8vIHRvIHJlbW92ZSB1bnVzZWQgZmllbGRzLCBpZiBvdGhlciB3cml0ZXJzIGFyZSB3cml0aW5nIG9iamVjdHMgdGhhdCBpbmNsdWRlXG4gIC8vIHRoaXMgZmllbGQsIHRoZSBmaWVsZCBtYXkgcmVhcHBlYXIuIFJldHVybnMgYSBQcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aFxuICAvLyBubyBvYmplY3Qgb24gc3VjY2Vzcywgb3IgcmVqZWN0cyB3aXRoIHsgY29kZSwgZXJyb3IgfSBvbiBmYWlsdXJlLlxuICAvLyBQYXNzaW5nIHRoZSBkYXRhYmFzZSBhbmQgcHJlZml4IGlzIG5lY2Vzc2FyeSBpbiBvcmRlciB0byBkcm9wIHJlbGF0aW9uIGNvbGxlY3Rpb25zXG4gIC8vIGFuZCByZW1vdmUgZmllbGRzIGZyb20gb2JqZWN0cy4gSWRlYWxseSB0aGUgZGF0YWJhc2Ugd291bGQgYmVsb25nIHRvXG4gIC8vIGEgZGF0YWJhc2UgYWRhcHRlciBhbmQgdGhpcyBmdW5jdGlvbiB3b3VsZCBjbG9zZSBvdmVyIGl0IG9yIGFjY2VzcyBpdCB2aWEgbWVtYmVyLlxuICBkZWxldGVGaWVsZHMoZmllbGROYW1lczogQXJyYXk8c3RyaW5nPiwgY2xhc3NOYW1lOiBzdHJpbmcsIGRhdGFiYXNlOiBEYXRhYmFzZUNvbnRyb2xsZXIpIHtcbiAgICBpZiAoIWNsYXNzTmFtZUlzVmFsaWQoY2xhc3NOYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSwgaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UoY2xhc3NOYW1lKSk7XG4gICAgfVxuXG4gICAgZmllbGROYW1lcy5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICBpZiAoIWZpZWxkTmFtZUlzVmFsaWQoZmllbGROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgYGludmFsaWQgZmllbGQgbmFtZTogJHtmaWVsZE5hbWV9YCk7XG4gICAgICB9XG4gICAgICAvL0Rvbid0IGFsbG93IGRlbGV0aW5nIHRoZSBkZWZhdWx0IGZpZWxkcy5cbiAgICAgIGlmICghZmllbGROYW1lSXNWYWxpZEZvckNsYXNzKGZpZWxkTmFtZSwgY2xhc3NOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTM2LCBgZmllbGQgJHtmaWVsZE5hbWV9IGNhbm5vdCBiZSBjaGFuZ2VkYCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGhpcy5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCBmYWxzZSwge2NsZWFyQ2FjaGU6IHRydWV9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLCBgQ2xhc3MgJHtjbGFzc05hbWV9IGRvZXMgbm90IGV4aXN0LmApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLnRoZW4oc2NoZW1hID0+IHtcbiAgICAgICAgZmllbGROYW1lcy5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgaWYgKCFzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigyNTUsIGBGaWVsZCAke2ZpZWxkTmFtZX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBkZWxldGUuYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBzY2hlbWFGaWVsZHMgPSB7IC4uLnNjaGVtYS5maWVsZHMgfTtcbiAgICAgICAgcmV0dXJuIGRhdGFiYXNlLmFkYXB0ZXIuZGVsZXRlRmllbGRzKGNsYXNzTmFtZSwgc2NoZW1hLCBmaWVsZE5hbWVzKVxuICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChmaWVsZE5hbWVzLm1hcChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBmaWVsZCA9IHNjaGVtYUZpZWxkc1tmaWVsZE5hbWVdO1xuICAgICAgICAgICAgICBpZiAoZmllbGQgJiYgZmllbGQudHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgICAgICAgICAvL0ZvciByZWxhdGlvbnMsIGRyb3AgdGhlIF9Kb2luIHRhYmxlXG4gICAgICAgICAgICAgICAgcmV0dXJuIGRhdGFiYXNlLmFkYXB0ZXIuZGVsZXRlQ2xhc3MoYF9Kb2luOiR7ZmllbGROYW1lfToke2NsYXNzTmFtZX1gKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgICAgICB9KSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KS50aGVuKCgpID0+IHtcbiAgICAgICAgdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gVmFsaWRhdGVzIGFuIG9iamVjdCBwcm92aWRlZCBpbiBSRVNUIGZvcm1hdC5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgbmV3IHNjaGVtYSBpZiB0aGlzIG9iamVjdCBpc1xuICAvLyB2YWxpZC5cbiAgdmFsaWRhdGVPYmplY3QoY2xhc3NOYW1lOiBzdHJpbmcsIG9iamVjdDogYW55LCBxdWVyeTogYW55KSB7XG4gICAgbGV0IGdlb2NvdW50ID0gMDtcbiAgICBsZXQgcHJvbWlzZSA9IHRoaXMuZW5mb3JjZUNsYXNzRXhpc3RzKGNsYXNzTmFtZSk7XG4gICAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gb2JqZWN0KSB7XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGV4cGVjdGVkID0gZ2V0VHlwZShvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICBpZiAoZXhwZWN0ZWQgPT09ICdHZW9Qb2ludCcpIHtcbiAgICAgICAgZ2VvY291bnQrKztcbiAgICAgIH1cbiAgICAgIGlmIChnZW9jb3VudCA+IDEpIHtcbiAgICAgICAgLy8gTWFrZSBzdXJlIGFsbCBmaWVsZCB2YWxpZGF0aW9uIG9wZXJhdGlvbnMgcnVuIGJlZm9yZSB3ZSByZXR1cm4uXG4gICAgICAgIC8vIElmIG5vdCAtIHdlIGFyZSBjb250aW51aW5nIHRvIHJ1biBsb2dpYywgYnV0IGFscmVhZHkgcHJvdmlkZWQgcmVzcG9uc2UgZnJvbSB0aGUgc2VydmVyLlxuICAgICAgICByZXR1cm4gcHJvbWlzZS50aGVuKCgpID0+IHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgICAgICAgJ3RoZXJlIGNhbiBvbmx5IGJlIG9uZSBnZW9wb2ludCBmaWVsZCBpbiBhIGNsYXNzJykpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmICghZXhwZWN0ZWQpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoZmllbGROYW1lID09PSAnQUNMJykge1xuICAgICAgICAvLyBFdmVyeSBvYmplY3QgaGFzIEFDTCBpbXBsaWNpdGx5LlxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgcHJvbWlzZSA9IHByb21pc2UudGhlbihzY2hlbWEgPT4gc2NoZW1hLmVuZm9yY2VGaWVsZEV4aXN0cyhjbGFzc05hbWUsIGZpZWxkTmFtZSwgZXhwZWN0ZWQpKTtcbiAgICB9XG4gICAgcHJvbWlzZSA9IHRoZW5WYWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyhwcm9taXNlLCBjbGFzc05hbWUsIG9iamVjdCwgcXVlcnkpO1xuICAgIHJldHVybiBwcm9taXNlO1xuICB9XG5cbiAgLy8gVmFsaWRhdGVzIHRoYXQgYWxsIHRoZSBwcm9wZXJ0aWVzIGFyZSBzZXQgZm9yIHRoZSBvYmplY3RcbiAgdmFsaWRhdGVSZXF1aXJlZENvbHVtbnMoY2xhc3NOYW1lOiBzdHJpbmcsIG9iamVjdDogYW55LCBxdWVyeTogYW55KSB7XG4gICAgY29uc3QgY29sdW1ucyA9IHJlcXVpcmVkQ29sdW1uc1tjbGFzc05hbWVdO1xuICAgIGlmICghY29sdW1ucyB8fCBjb2x1bW5zLmxlbmd0aCA9PSAwKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMpO1xuICAgIH1cblxuICAgIGNvbnN0IG1pc3NpbmdDb2x1bW5zID0gY29sdW1ucy5maWx0ZXIoZnVuY3Rpb24oY29sdW1uKXtcbiAgICAgIGlmIChxdWVyeSAmJiBxdWVyeS5vYmplY3RJZCkge1xuICAgICAgICBpZiAob2JqZWN0W2NvbHVtbl0gJiYgdHlwZW9mIG9iamVjdFtjb2x1bW5dID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgICAgLy8gVHJ5aW5nIHRvIGRlbGV0ZSBhIHJlcXVpcmVkIGNvbHVtblxuICAgICAgICAgIHJldHVybiBvYmplY3RbY29sdW1uXS5fX29wID09ICdEZWxldGUnO1xuICAgICAgICB9XG4gICAgICAgIC8vIE5vdCB0cnlpbmcgdG8gZG8gYW55dGhpbmcgdGhlcmVcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuICFvYmplY3RbY29sdW1uXVxuICAgIH0pO1xuXG4gICAgaWYgKG1pc3NpbmdDb2x1bW5zLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgIG1pc3NpbmdDb2x1bW5zWzBdICsgJyBpcyByZXF1aXJlZC4nKTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzKTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlcyB0aGUgYmFzZSBDTFAgZm9yIGFuIG9wZXJhdGlvblxuICB0ZXN0QmFzZUNMUChjbGFzc05hbWU6IHN0cmluZywgYWNsR3JvdXA6IHN0cmluZ1tdLCBvcGVyYXRpb246IHN0cmluZykge1xuICAgIGlmICghdGhpcy5wZXJtc1tjbGFzc05hbWVdIHx8ICF0aGlzLnBlcm1zW2NsYXNzTmFtZV1bb3BlcmF0aW9uXSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGNvbnN0IGNsYXNzUGVybXMgPSB0aGlzLnBlcm1zW2NsYXNzTmFtZV07XG4gICAgY29uc3QgcGVybXMgPSBjbGFzc1Blcm1zW29wZXJhdGlvbl07XG4gICAgLy8gSGFuZGxlIHRoZSBwdWJsaWMgc2NlbmFyaW8gcXVpY2tseVxuICAgIGlmIChwZXJtc1snKiddKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgcGVybWlzc2lvbnMgYWdhaW5zdCB0aGUgYWNsR3JvdXAgcHJvdmlkZWQgKGFycmF5IG9mIHVzZXJJZC9yb2xlcylcbiAgICBpZiAoYWNsR3JvdXAuc29tZShhY2wgPT4geyByZXR1cm4gcGVybXNbYWNsXSA9PT0gdHJ1ZSB9KSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlcyBhbiBvcGVyYXRpb24gcGFzc2VzIGNsYXNzLWxldmVsLXBlcm1pc3Npb25zIHNldCBpbiB0aGUgc2NoZW1hXG4gIHZhbGlkYXRlUGVybWlzc2lvbihjbGFzc05hbWU6IHN0cmluZywgYWNsR3JvdXA6IHN0cmluZ1tdLCBvcGVyYXRpb246IHN0cmluZykge1xuXG4gICAgaWYgKHRoaXMudGVzdEJhc2VDTFAoY2xhc3NOYW1lLCBhY2xHcm91cCwgb3BlcmF0aW9uKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5wZXJtc1tjbGFzc05hbWVdIHx8ICF0aGlzLnBlcm1zW2NsYXNzTmFtZV1bb3BlcmF0aW9uXSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGNvbnN0IGNsYXNzUGVybXMgPSB0aGlzLnBlcm1zW2NsYXNzTmFtZV07XG4gICAgY29uc3QgcGVybXMgPSBjbGFzc1Blcm1zW29wZXJhdGlvbl07XG5cbiAgICAvLyBJZiBvbmx5IGZvciBhdXRoZW50aWNhdGVkIHVzZXJzXG4gICAgLy8gbWFrZSBzdXJlIHdlIGhhdmUgYW4gYWNsR3JvdXBcbiAgICBpZiAocGVybXNbJ3JlcXVpcmVzQXV0aGVudGljYXRpb24nXSkge1xuICAgICAgLy8gSWYgYWNsR3JvdXAgaGFzICogKHB1YmxpYylcbiAgICAgIGlmICghYWNsR3JvdXAgfHwgYWNsR3JvdXAubGVuZ3RoID09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsXG4gICAgICAgICAgJ1Blcm1pc3Npb24gZGVuaWVkLCB1c2VyIG5lZWRzIHRvIGJlIGF1dGhlbnRpY2F0ZWQuJyk7XG4gICAgICB9IGVsc2UgaWYgKGFjbEdyb3VwLmluZGV4T2YoJyonKSA+IC0xICYmIGFjbEdyb3VwLmxlbmd0aCA9PSAxKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELFxuICAgICAgICAgICdQZXJtaXNzaW9uIGRlbmllZCwgdXNlciBuZWVkcyB0byBiZSBhdXRoZW50aWNhdGVkLicpO1xuICAgICAgfVxuICAgICAgLy8gcmVxdWlyZXNBdXRoZW50aWNhdGlvbiBwYXNzZWQsIGp1c3QgbW92ZSBmb3J3YXJkXG4gICAgICAvLyBwcm9iYWJseSB3b3VsZCBiZSB3aXNlIGF0IHNvbWUgcG9pbnQgdG8gcmVuYW1lIHRvICdhdXRoZW50aWNhdGVkVXNlcidcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICAvLyBObyBtYXRjaGluZyBDTFAsIGxldCdzIGNoZWNrIHRoZSBQb2ludGVyIHBlcm1pc3Npb25zXG4gICAgLy8gQW5kIGhhbmRsZSB0aG9zZSBsYXRlclxuICAgIGNvbnN0IHBlcm1pc3Npb25GaWVsZCA9IFsnZ2V0JywgJ2ZpbmQnLCAnY291bnQnXS5pbmRleE9mKG9wZXJhdGlvbikgPiAtMSA/ICdyZWFkVXNlckZpZWxkcycgOiAnd3JpdGVVc2VyRmllbGRzJztcblxuICAgIC8vIFJlamVjdCBjcmVhdGUgd2hlbiB3cml0ZSBsb2NrZG93blxuICAgIGlmIChwZXJtaXNzaW9uRmllbGQgPT0gJ3dyaXRlVXNlckZpZWxkcycgJiYgb3BlcmF0aW9uID09ICdjcmVhdGUnKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgYFBlcm1pc3Npb24gZGVuaWVkIGZvciBhY3Rpb24gJHtvcGVyYXRpb259IG9uIGNsYXNzICR7Y2xhc3NOYW1lfS5gKTtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIHRoZSByZWFkVXNlckZpZWxkcyBsYXRlclxuICAgIGlmIChBcnJheS5pc0FycmF5KGNsYXNzUGVybXNbcGVybWlzc2lvbkZpZWxkXSkgJiYgY2xhc3NQZXJtc1twZXJtaXNzaW9uRmllbGRdLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICBgUGVybWlzc2lvbiBkZW5pZWQgZm9yIGFjdGlvbiAke29wZXJhdGlvbn0gb24gY2xhc3MgJHtjbGFzc05hbWV9LmApO1xuICB9XG5cbiAgLy8gUmV0dXJucyB0aGUgZXhwZWN0ZWQgdHlwZSBmb3IgYSBjbGFzc05hbWUra2V5IGNvbWJpbmF0aW9uXG4gIC8vIG9yIHVuZGVmaW5lZCBpZiB0aGUgc2NoZW1hIGlzIG5vdCBzZXRcbiAgZ2V0RXhwZWN0ZWRUeXBlKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZE5hbWU6IHN0cmluZyk6ID8oU2NoZW1hRmllbGQgfCBzdHJpbmcpIHtcbiAgICBpZiAodGhpcy5kYXRhICYmIHRoaXMuZGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICBjb25zdCBleHBlY3RlZFR5cGUgPSB0aGlzLmRhdGFbY2xhc3NOYW1lXVtmaWVsZE5hbWVdXG4gICAgICByZXR1cm4gZXhwZWN0ZWRUeXBlID09PSAnbWFwJyA/ICdPYmplY3QnIDogZXhwZWN0ZWRUeXBlO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8gQ2hlY2tzIGlmIGEgZ2l2ZW4gY2xhc3MgaXMgaW4gdGhlIHNjaGVtYS5cbiAgaGFzQ2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKCkudGhlbigoKSA9PiAhISh0aGlzLmRhdGFbY2xhc3NOYW1lXSkpO1xuICB9XG59XG5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhIG5ldyBTY2hlbWEuXG5jb25zdCBsb2FkID0gKGRiQWRhcHRlcjogU3RvcmFnZUFkYXB0ZXIsIHNjaGVtYUNhY2hlOiBhbnksIG9wdGlvbnM6IGFueSk6IFByb21pc2U8U2NoZW1hQ29udHJvbGxlcj4gPT4ge1xuICBjb25zdCBzY2hlbWEgPSBuZXcgU2NoZW1hQ29udHJvbGxlcihkYkFkYXB0ZXIsIHNjaGVtYUNhY2hlKTtcbiAgcmV0dXJuIHNjaGVtYS5yZWxvYWREYXRhKG9wdGlvbnMpLnRoZW4oKCkgPT4gc2NoZW1hKTtcbn1cblxuLy8gQnVpbGRzIGEgbmV3IHNjaGVtYSAoaW4gc2NoZW1hIEFQSSByZXNwb25zZSBmb3JtYXQpIG91dCBvZiBhblxuLy8gZXhpc3RpbmcgbW9uZ28gc2NoZW1hICsgYSBzY2hlbWFzIEFQSSBwdXQgcmVxdWVzdC4gVGhpcyByZXNwb25zZVxuLy8gZG9lcyBub3QgaW5jbHVkZSB0aGUgZGVmYXVsdCBmaWVsZHMsIGFzIGl0IGlzIGludGVuZGVkIHRvIGJlIHBhc3NlZFxuLy8gdG8gbW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lLiBObyB2YWxpZGF0aW9uIGlzIGRvbmUgaGVyZSwgaXRcbi8vIGlzIGRvbmUgaW4gbW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lLlxuZnVuY3Rpb24gYnVpbGRNZXJnZWRTY2hlbWFPYmplY3QoZXhpc3RpbmdGaWVsZHM6IFNjaGVtYUZpZWxkcywgcHV0UmVxdWVzdDogYW55KTogU2NoZW1hRmllbGRzIHtcbiAgY29uc3QgbmV3U2NoZW1hID0ge307XG4gIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICBjb25zdCBzeXNTY2hlbWFGaWVsZCA9IE9iamVjdC5rZXlzKGRlZmF1bHRDb2x1bW5zKS5pbmRleE9mKGV4aXN0aW5nRmllbGRzLl9pZCkgPT09IC0xID8gW10gOiBPYmplY3Qua2V5cyhkZWZhdWx0Q29sdW1uc1tleGlzdGluZ0ZpZWxkcy5faWRdKTtcbiAgZm9yIChjb25zdCBvbGRGaWVsZCBpbiBleGlzdGluZ0ZpZWxkcykge1xuICAgIGlmIChvbGRGaWVsZCAhPT0gJ19pZCcgJiYgb2xkRmllbGQgIT09ICdBQ0wnICYmICBvbGRGaWVsZCAhPT0gJ3VwZGF0ZWRBdCcgJiYgb2xkRmllbGQgIT09ICdjcmVhdGVkQXQnICYmIG9sZEZpZWxkICE9PSAnb2JqZWN0SWQnKSB7XG4gICAgICBpZiAoc3lzU2NoZW1hRmllbGQubGVuZ3RoID4gMCAmJiBzeXNTY2hlbWFGaWVsZC5pbmRleE9mKG9sZEZpZWxkKSAhPT0gLTEpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBmaWVsZElzRGVsZXRlZCA9IHB1dFJlcXVlc3Rbb2xkRmllbGRdICYmIHB1dFJlcXVlc3Rbb2xkRmllbGRdLl9fb3AgPT09ICdEZWxldGUnXG4gICAgICBpZiAoIWZpZWxkSXNEZWxldGVkKSB7XG4gICAgICAgIG5ld1NjaGVtYVtvbGRGaWVsZF0gPSBleGlzdGluZ0ZpZWxkc1tvbGRGaWVsZF07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGZvciAoY29uc3QgbmV3RmllbGQgaW4gcHV0UmVxdWVzdCkge1xuICAgIGlmIChuZXdGaWVsZCAhPT0gJ29iamVjdElkJyAmJiBwdXRSZXF1ZXN0W25ld0ZpZWxkXS5fX29wICE9PSAnRGVsZXRlJykge1xuICAgICAgaWYgKHN5c1NjaGVtYUZpZWxkLmxlbmd0aCA+IDAgJiYgc3lzU2NoZW1hRmllbGQuaW5kZXhPZihuZXdGaWVsZCkgIT09IC0xKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgbmV3U2NoZW1hW25ld0ZpZWxkXSA9IHB1dFJlcXVlc3RbbmV3RmllbGRdO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbmV3U2NoZW1hO1xufVxuXG4vLyBHaXZlbiBhIHNjaGVtYSBwcm9taXNlLCBjb25zdHJ1Y3QgYW5vdGhlciBzY2hlbWEgcHJvbWlzZSB0aGF0XG4vLyB2YWxpZGF0ZXMgdGhpcyBmaWVsZCBvbmNlIHRoZSBzY2hlbWEgbG9hZHMuXG5mdW5jdGlvbiB0aGVuVmFsaWRhdGVSZXF1aXJlZENvbHVtbnMoc2NoZW1hUHJvbWlzZSwgY2xhc3NOYW1lLCBvYmplY3QsIHF1ZXJ5KSB7XG4gIHJldHVybiBzY2hlbWFQcm9taXNlLnRoZW4oKHNjaGVtYSkgPT4ge1xuICAgIHJldHVybiBzY2hlbWEudmFsaWRhdGVSZXF1aXJlZENvbHVtbnMoY2xhc3NOYW1lLCBvYmplY3QsIHF1ZXJ5KTtcbiAgfSk7XG59XG5cbi8vIEdldHMgdGhlIHR5cGUgZnJvbSBhIFJFU1QgQVBJIGZvcm1hdHRlZCBvYmplY3QsIHdoZXJlICd0eXBlJyBpc1xuLy8gZXh0ZW5kZWQgcGFzdCBqYXZhc2NyaXB0IHR5cGVzIHRvIGluY2x1ZGUgdGhlIHJlc3Qgb2YgdGhlIFBhcnNlXG4vLyB0eXBlIHN5c3RlbS5cbi8vIFRoZSBvdXRwdXQgc2hvdWxkIGJlIGEgdmFsaWQgc2NoZW1hIHZhbHVlLlxuLy8gVE9ETzogZW5zdXJlIHRoYXQgdGhpcyBpcyBjb21wYXRpYmxlIHdpdGggdGhlIGZvcm1hdCB1c2VkIGluIE9wZW4gREJcbmZ1bmN0aW9uIGdldFR5cGUob2JqOiBhbnkpOiA/KFNjaGVtYUZpZWxkIHwgc3RyaW5nKSB7XG4gIGNvbnN0IHR5cGUgPSB0eXBlb2Ygb2JqO1xuICBzd2l0Y2godHlwZSkge1xuICBjYXNlICdib29sZWFuJzpcbiAgICByZXR1cm4gJ0Jvb2xlYW4nO1xuICBjYXNlICdzdHJpbmcnOlxuICAgIHJldHVybiAnU3RyaW5nJztcbiAgY2FzZSAnbnVtYmVyJzpcbiAgICByZXR1cm4gJ051bWJlcic7XG4gIGNhc2UgJ21hcCc6XG4gIGNhc2UgJ29iamVjdCc6XG4gICAgaWYgKCFvYmopIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHJldHVybiBnZXRPYmplY3RUeXBlKG9iaik7XG4gIGNhc2UgJ2Z1bmN0aW9uJzpcbiAgY2FzZSAnc3ltYm9sJzpcbiAgY2FzZSAndW5kZWZpbmVkJzpcbiAgZGVmYXVsdDpcbiAgICB0aHJvdyAnYmFkIG9iajogJyArIG9iajtcbiAgfVxufVxuXG4vLyBUaGlzIGdldHMgdGhlIHR5cGUgZm9yIG5vbi1KU09OIHR5cGVzIGxpa2UgcG9pbnRlcnMgYW5kIGZpbGVzLCBidXRcbi8vIGFsc28gZ2V0cyB0aGUgYXBwcm9wcmlhdGUgdHlwZSBmb3IgJCBvcGVyYXRvcnMuXG4vLyBSZXR1cm5zIG51bGwgaWYgdGhlIHR5cGUgaXMgdW5rbm93bi5cbmZ1bmN0aW9uIGdldE9iamVjdFR5cGUob2JqKTogPyhTY2hlbWFGaWVsZCB8IHN0cmluZykge1xuICBpZiAob2JqIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICByZXR1cm4gJ0FycmF5JztcbiAgfVxuICBpZiAob2JqLl9fdHlwZSl7XG4gICAgc3dpdGNoKG9iai5fX3R5cGUpIHtcbiAgICBjYXNlICdQb2ludGVyJyA6XG4gICAgICBpZihvYmouY2xhc3NOYW1lKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogJ1BvaW50ZXInLFxuICAgICAgICAgIHRhcmdldENsYXNzOiBvYmouY2xhc3NOYW1lXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ1JlbGF0aW9uJyA6XG4gICAgICBpZihvYmouY2xhc3NOYW1lKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogJ1JlbGF0aW9uJyxcbiAgICAgICAgICB0YXJnZXRDbGFzczogb2JqLmNsYXNzTmFtZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdGaWxlJyA6XG4gICAgICBpZihvYmoubmFtZSkge1xuICAgICAgICByZXR1cm4gJ0ZpbGUnO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnRGF0ZScgOlxuICAgICAgaWYob2JqLmlzbykge1xuICAgICAgICByZXR1cm4gJ0RhdGUnO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnR2VvUG9pbnQnIDpcbiAgICAgIGlmKG9iai5sYXRpdHVkZSAhPSBudWxsICYmIG9iai5sb25naXR1ZGUgIT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gJ0dlb1BvaW50JztcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ0J5dGVzJyA6XG4gICAgICBpZihvYmouYmFzZTY0KSB7XG4gICAgICAgIHJldHVybiAnQnl0ZXMnO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnUG9seWdvbicgOlxuICAgICAgaWYob2JqLmNvb3JkaW5hdGVzKSB7XG4gICAgICAgIHJldHVybiAnUG9seWdvbic7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLCBcIlRoaXMgaXMgbm90IGEgdmFsaWQgXCIgKyBvYmouX190eXBlKTtcbiAgfVxuICBpZiAob2JqWyckbmUnXSkge1xuICAgIHJldHVybiBnZXRPYmplY3RUeXBlKG9ialsnJG5lJ10pO1xuICB9XG4gIGlmIChvYmouX19vcCkge1xuICAgIHN3aXRjaChvYmouX19vcCkge1xuICAgIGNhc2UgJ0luY3JlbWVudCc6XG4gICAgICByZXR1cm4gJ051bWJlcic7XG4gICAgY2FzZSAnRGVsZXRlJzpcbiAgICAgIHJldHVybiBudWxsO1xuICAgIGNhc2UgJ0FkZCc6XG4gICAgY2FzZSAnQWRkVW5pcXVlJzpcbiAgICBjYXNlICdSZW1vdmUnOlxuICAgICAgcmV0dXJuICdBcnJheSc7XG4gICAgY2FzZSAnQWRkUmVsYXRpb24nOlxuICAgIGNhc2UgJ1JlbW92ZVJlbGF0aW9uJzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICdSZWxhdGlvbicsXG4gICAgICAgIHRhcmdldENsYXNzOiBvYmoub2JqZWN0c1swXS5jbGFzc05hbWVcbiAgICAgIH1cbiAgICBjYXNlICdCYXRjaCc6XG4gICAgICByZXR1cm4gZ2V0T2JqZWN0VHlwZShvYmoub3BzWzBdKTtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgJ3VuZXhwZWN0ZWQgb3A6ICcgKyBvYmouX19vcDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuICdPYmplY3QnO1xufVxuXG5leHBvcnQge1xuICBsb2FkLFxuICBjbGFzc05hbWVJc1ZhbGlkLFxuICBmaWVsZE5hbWVJc1ZhbGlkLFxuICBpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZSxcbiAgYnVpbGRNZXJnZWRTY2hlbWFPYmplY3QsXG4gIHN5c3RlbUNsYXNzZXMsXG4gIGRlZmF1bHRDb2x1bW5zLFxuICBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hLFxuICBWb2xhdGlsZUNsYXNzZXNTY2hlbWFzLFxuICBTY2hlbWFDb250cm9sbGVyLFxufTtcbiJdfQ==