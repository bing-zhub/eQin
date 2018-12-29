'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _node = require('parse/node');

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _intersect = require('intersect');

var _intersect2 = _interopRequireDefault(_intersect);

var _deepcopy = require('deepcopy');

var _deepcopy2 = _interopRequireDefault(_deepcopy);

var _logger = require('../logger');

var _logger2 = _interopRequireDefault(_logger);

var _SchemaController = require('./SchemaController');

var SchemaController = _interopRequireWildcard(_SchemaController);

var _StorageAdapter = require('../Adapters/Storage/StorageAdapter');

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }
// A database adapter that works with data exported from the hosted
// Parse database.

// -disable-next

// -disable-next

// -disable-next

// -disable-next


function addWriteACL(query, acl) {
  const newQuery = _lodash2.default.cloneDeep(query);
  //Can't be any existing '_wperm' query, we don't allow client queries on that, no need to $and
  newQuery._wperm = { "$in": [null, ...acl] };
  return newQuery;
}

function addReadACL(query, acl) {
  const newQuery = _lodash2.default.cloneDeep(query);
  //Can't be any existing '_rperm' query, we don't allow client queries on that, no need to $and
  newQuery._rperm = { "$in": [null, "*", ...acl] };
  return newQuery;
}

// Transforms a REST API formatted ACL object to our two-field mongo format.
const transformObjectACL = (_ref) => {
  let { ACL } = _ref,
      result = _objectWithoutProperties(_ref, ['ACL']);

  if (!ACL) {
    return result;
  }

  result._wperm = [];
  result._rperm = [];

  for (const entry in ACL) {
    if (ACL[entry].read) {
      result._rperm.push(entry);
    }
    if (ACL[entry].write) {
      result._wperm.push(entry);
    }
  }
  return result;
};

const specialQuerykeys = ['$and', '$or', '$nor', '_rperm', '_wperm', '_perishable_token', '_email_verify_token', '_email_verify_token_expires_at', '_account_lockout_expires_at', '_failed_login_count'];

const isSpecialQueryKey = key => {
  return specialQuerykeys.indexOf(key) >= 0;
};

const validateQuery = query => {
  if (query.ACL) {
    throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Cannot query on ACL.');
  }

  if (query.$or) {
    if (query.$or instanceof Array) {
      query.$or.forEach(validateQuery);

      /* In MongoDB, $or queries which are not alone at the top level of the
       * query can not make efficient use of indexes due to a long standing
       * bug known as SERVER-13732.
       *
       * This block restructures queries in which $or is not the sole top
       * level element by moving all other top-level predicates inside every
       * subdocument of the $or predicate, allowing MongoDB's query planner
       * to make full use of the most relevant indexes.
       *
       * EG:      {$or: [{a: 1}, {a: 2}], b: 2}
       * Becomes: {$or: [{a: 1, b: 2}, {a: 2, b: 2}]}
       *
       * The only exceptions are $near and $nearSphere operators, which are
       * constrained to only 1 operator per query. As a result, these ops
       * remain at the top level
       *
       * https://jira.mongodb.org/browse/SERVER-13732
       * https://github.com/parse-community/parse-server/issues/3767
       */
      Object.keys(query).forEach(key => {
        const noCollisions = !query.$or.some(subq => subq.hasOwnProperty(key));
        let hasNears = false;
        if (query[key] != null && typeof query[key] == 'object') {
          hasNears = '$near' in query[key] || '$nearSphere' in query[key];
        }
        if (key != '$or' && noCollisions && !hasNears) {
          query.$or.forEach(subquery => {
            subquery[key] = query[key];
          });
          delete query[key];
        }
      });
      query.$or.forEach(validateQuery);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Bad $or format - use an array value.');
    }
  }

  if (query.$and) {
    if (query.$and instanceof Array) {
      query.$and.forEach(validateQuery);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Bad $and format - use an array value.');
    }
  }

  if (query.$nor) {
    if (query.$nor instanceof Array && query.$nor.length > 0) {
      query.$nor.forEach(validateQuery);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Bad $nor format - use an array of at least 1 value.');
    }
  }

  Object.keys(query).forEach(key => {
    if (query && query[key] && query[key].$regex) {
      if (typeof query[key].$options === 'string') {
        if (!query[key].$options.match(/^[imxs]+$/)) {
          throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, `Bad $options value for query: ${query[key].$options}`);
        }
      }
    }
    if (!isSpecialQueryKey(key) && !key.match(/^[a-zA-Z][a-zA-Z0-9_\.]*$/)) {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid key name: ${key}`);
    }
  });
};

// Filters out any data that shouldn't be on this REST-formatted object.
const filterSensitiveData = (isMaster, aclGroup, className, object) => {
  if (className !== '_User') {
    return object;
  }

  object.password = object._hashed_password;
  delete object._hashed_password;

  delete object.sessionToken;

  if (isMaster) {
    return object;
  }
  delete object._email_verify_token;
  delete object._perishable_token;
  delete object._perishable_token_expires_at;
  delete object._tombstone;
  delete object._email_verify_token_expires_at;
  delete object._failed_login_count;
  delete object._account_lockout_expires_at;
  delete object._password_changed_at;
  delete object._password_history;

  if (aclGroup.indexOf(object.objectId) > -1) {
    return object;
  }
  delete object.authData;
  return object;
};

// Runs an update on the database.
// Returns a promise for an object with the new values for field
// modifications that don't know their results ahead of time, like
// 'increment'.
// Options:
//   acl:  a list of strings. If the object to be updated has an ACL,
//         one of the provided strings must provide the caller with
//         write permissions.
const specialKeysForUpdate = ['_hashed_password', '_perishable_token', '_email_verify_token', '_email_verify_token_expires_at', '_account_lockout_expires_at', '_failed_login_count', '_perishable_token_expires_at', '_password_changed_at', '_password_history'];

const isSpecialUpdateKey = key => {
  return specialKeysForUpdate.indexOf(key) >= 0;
};

function expandResultOnKeyPath(object, key, value) {
  if (key.indexOf('.') < 0) {
    object[key] = value[key];
    return object;
  }
  const path = key.split('.');
  const firstKey = path[0];
  const nextPath = path.slice(1).join('.');
  object[firstKey] = expandResultOnKeyPath(object[firstKey] || {}, nextPath, value[firstKey]);
  delete object[key];
  return object;
}

function sanitizeDatabaseResult(originalObject, result) {
  const response = {};
  if (!result) {
    return Promise.resolve(response);
  }
  Object.keys(originalObject).forEach(key => {
    const keyUpdate = originalObject[key];
    // determine if that was an op
    if (keyUpdate && typeof keyUpdate === 'object' && keyUpdate.__op && ['Add', 'AddUnique', 'Remove', 'Increment'].indexOf(keyUpdate.__op) > -1) {
      // only valid ops that produce an actionable result
      // the op may have happend on a keypath
      expandResultOnKeyPath(response, key, result);
    }
  });
  return Promise.resolve(response);
}

function joinTableName(className, key) {
  return `_Join:${key}:${className}`;
}

const flattenUpdateOperatorsForCreate = object => {
  for (const key in object) {
    if (object[key] && object[key].__op) {
      switch (object[key].__op) {
        case 'Increment':
          if (typeof object[key].amount !== 'number') {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }
          object[key] = object[key].amount;
          break;
        case 'Add':
          if (!(object[key].objects instanceof Array)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }
          object[key] = object[key].objects;
          break;
        case 'AddUnique':
          if (!(object[key].objects instanceof Array)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }
          object[key] = object[key].objects;
          break;
        case 'Remove':
          if (!(object[key].objects instanceof Array)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }
          object[key] = [];
          break;
        case 'Delete':
          delete object[key];
          break;
        default:
          throw new _node.Parse.Error(_node.Parse.Error.COMMAND_UNAVAILABLE, `The ${object[key].__op} operator is not supported yet.`);
      }
    }
  }
};

const transformAuthData = (className, object, schema) => {
  if (object.authData && className === '_User') {
    Object.keys(object.authData).forEach(provider => {
      const providerData = object.authData[provider];
      const fieldName = `_auth_data_${provider}`;
      if (providerData == null) {
        object[fieldName] = {
          __op: 'Delete'
        };
      } else {
        object[fieldName] = providerData;
        schema.fields[fieldName] = { type: 'Object' };
      }
    });
    delete object.authData;
  }
};
// Transforms a Database format ACL to a REST API format ACL
const untransformObjectACL = (_ref2) => {
  let { _rperm, _wperm } = _ref2,
      output = _objectWithoutProperties(_ref2, ['_rperm', '_wperm']);

  if (_rperm || _wperm) {
    output.ACL = {};

    (_rperm || []).forEach(entry => {
      if (!output.ACL[entry]) {
        output.ACL[entry] = { read: true };
      } else {
        output.ACL[entry]['read'] = true;
      }
    });

    (_wperm || []).forEach(entry => {
      if (!output.ACL[entry]) {
        output.ACL[entry] = { write: true };
      } else {
        output.ACL[entry]['write'] = true;
      }
    });
  }
  return output;
};

/**
 * When querying, the fieldName may be compound, extract the root fieldName
 *     `temperature.celsius` becomes `temperature`
 * @param {string} fieldName that may be a compound field name
 * @returns {string} the root name of the field
 */
const getRootFieldName = fieldName => {
  return fieldName.split('.')[0];
};

const relationSchema = { fields: { relatedId: { type: 'String' }, owningId: { type: 'String' } } };

class DatabaseController {

  constructor(adapter, schemaCache) {
    this.adapter = adapter;
    this.schemaCache = schemaCache;
    // We don't want a mutable this.schema, because then you could have
    // one request that uses different schemas for different parts of
    // it. Instead, use loadSchema to get a schema.
    this.schemaPromise = null;
  }

  collectionExists(className) {
    return this.adapter.classExists(className);
  }

  purgeCollection(className) {
    return this.loadSchema().then(schemaController => schemaController.getOneSchema(className)).then(schema => this.adapter.deleteObjectsByQuery(className, schema, {}));
  }

  validateClassName(className) {
    if (!SchemaController.classNameIsValid(className)) {
      return Promise.reject(new _node.Parse.Error(_node.Parse.Error.INVALID_CLASS_NAME, 'invalid className: ' + className));
    }
    return Promise.resolve();
  }

  // Returns a promise for a schemaController.
  loadSchema(options = { clearCache: false }) {
    if (this.schemaPromise != null) {
      return this.schemaPromise;
    }
    this.schemaPromise = SchemaController.load(this.adapter, this.schemaCache, options);
    this.schemaPromise.then(() => delete this.schemaPromise, () => delete this.schemaPromise);
    return this.loadSchema(options);
  }

  // Returns a promise for the classname that is related to the given
  // classname through the key.
  // TODO: make this not in the DatabaseController interface
  redirectClassNameForKey(className, key) {
    return this.loadSchema().then(schema => {
      var t = schema.getExpectedType(className, key);
      if (t != null && typeof t !== 'string' && t.type === 'Relation') {
        return t.targetClass;
      }
      return className;
    });
  }

  // Uses the schema to validate the object (REST API format).
  // Returns a promise that resolves to the new schema.
  // This does not update this.schema, because in a situation like a
  // batch request, that could confuse other users of the schema.
  validateObject(className, object, query, { acl }) {
    let schema;
    const isMaster = acl === undefined;
    var aclGroup = acl || [];
    return this.loadSchema().then(s => {
      schema = s;
      if (isMaster) {
        return Promise.resolve();
      }
      return this.canAddField(schema, className, object, aclGroup);
    }).then(() => {
      return schema.validateObject(className, object, query);
    });
  }

  update(className, query, update, {
    acl,
    many,
    upsert
  } = {}, skipSanitization = false) {
    const originalQuery = query;
    const originalUpdate = update;
    // Make a copy of the object, so we don't mutate the incoming data.
    update = (0, _deepcopy2.default)(update);
    var relationUpdates = [];
    var isMaster = acl === undefined;
    var aclGroup = acl || [];
    return this.loadSchema().then(schemaController => {
      return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'update')).then(() => {
        relationUpdates = this.collectRelationUpdates(className, originalQuery.objectId, update);
        if (!isMaster) {
          query = this.addPointerPermissions(schemaController, className, 'update', query, aclGroup);
        }
        if (!query) {
          return Promise.resolve();
        }
        if (acl) {
          query = addWriteACL(query, acl);
        }
        validateQuery(query);
        return schemaController.getOneSchema(className, true).catch(error => {
          // If the schema doesn't exist, pretend it exists with no fields. This behavior
          // will likely need revisiting.
          if (error === undefined) {
            return { fields: {} };
          }
          throw error;
        }).then(schema => {
          Object.keys(update).forEach(fieldName => {
            if (fieldName.match(/^authData\.([a-zA-Z0-9_]+)\.id$/)) {
              throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid field name for update: ${fieldName}`);
            }
            const rootFieldName = getRootFieldName(fieldName);
            if (!SchemaController.fieldNameIsValid(rootFieldName) && !isSpecialUpdateKey(rootFieldName)) {
              throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid field name for update: ${fieldName}`);
            }
          });
          for (const updateOperation in update) {
            if (update[updateOperation] && typeof update[updateOperation] === 'object' && Object.keys(update[updateOperation]).some(innerKey => innerKey.includes('$') || innerKey.includes('.'))) {
              throw new _node.Parse.Error(_node.Parse.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
            }
          }
          update = transformObjectACL(update);
          transformAuthData(className, update, schema);
          if (many) {
            return this.adapter.updateObjectsByQuery(className, schema, query, update);
          } else if (upsert) {
            return this.adapter.upsertOneObject(className, schema, query, update);
          } else {
            return this.adapter.findOneAndUpdate(className, schema, query, update);
          }
        });
      }).then(result => {
        if (!result) {
          throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
        }
        return this.handleRelationUpdates(className, originalQuery.objectId, update, relationUpdates).then(() => {
          return result;
        });
      }).then(result => {
        if (skipSanitization) {
          return Promise.resolve(result);
        }
        return sanitizeDatabaseResult(originalUpdate, result);
      });
    });
  }

  // Collect all relation-updating operations from a REST-format update.
  // Returns a list of all relation updates to perform
  // This mutates update.
  collectRelationUpdates(className, objectId, update) {
    var ops = [];
    var deleteMe = [];
    objectId = update.objectId || objectId;

    var process = (op, key) => {
      if (!op) {
        return;
      }
      if (op.__op == 'AddRelation') {
        ops.push({ key, op });
        deleteMe.push(key);
      }

      if (op.__op == 'RemoveRelation') {
        ops.push({ key, op });
        deleteMe.push(key);
      }

      if (op.__op == 'Batch') {
        for (var x of op.ops) {
          process(x, key);
        }
      }
    };

    for (const key in update) {
      process(update[key], key);
    }
    for (const key of deleteMe) {
      delete update[key];
    }
    return ops;
  }

  // Processes relation-updating operations from a REST-format update.
  // Returns a promise that resolves when all updates have been performed
  handleRelationUpdates(className, objectId, update, ops) {
    var pending = [];
    objectId = update.objectId || objectId;
    ops.forEach(({ key, op }) => {
      if (!op) {
        return;
      }
      if (op.__op == 'AddRelation') {
        for (const object of op.objects) {
          pending.push(this.addRelation(key, className, objectId, object.objectId));
        }
      }

      if (op.__op == 'RemoveRelation') {
        for (const object of op.objects) {
          pending.push(this.removeRelation(key, className, objectId, object.objectId));
        }
      }
    });

    return Promise.all(pending);
  }

  // Adds a relation.
  // Returns a promise that resolves successfully iff the add was successful.
  addRelation(key, fromClassName, fromId, toId) {
    const doc = {
      relatedId: toId,
      owningId: fromId
    };
    return this.adapter.upsertOneObject(`_Join:${key}:${fromClassName}`, relationSchema, doc, doc);
  }

  // Removes a relation.
  // Returns a promise that resolves successfully iff the remove was
  // successful.
  removeRelation(key, fromClassName, fromId, toId) {
    var doc = {
      relatedId: toId,
      owningId: fromId
    };
    return this.adapter.deleteObjectsByQuery(`_Join:${key}:${fromClassName}`, relationSchema, doc).catch(error => {
      // We don't care if they try to delete a non-existent relation.
      if (error.code == _node.Parse.Error.OBJECT_NOT_FOUND) {
        return;
      }
      throw error;
    });
  }

  // Removes objects matches this query from the database.
  // Returns a promise that resolves successfully iff the object was
  // deleted.
  // Options:
  //   acl:  a list of strings. If the object to be updated has an ACL,
  //         one of the provided strings must provide the caller with
  //         write permissions.
  destroy(className, query, { acl } = {}) {
    const isMaster = acl === undefined;
    const aclGroup = acl || [];

    return this.loadSchema().then(schemaController => {
      return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'delete')).then(() => {
        if (!isMaster) {
          query = this.addPointerPermissions(schemaController, className, 'delete', query, aclGroup);
          if (!query) {
            throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
          }
        }
        // delete by query
        if (acl) {
          query = addWriteACL(query, acl);
        }
        validateQuery(query);
        return schemaController.getOneSchema(className).catch(error => {
          // If the schema doesn't exist, pretend it exists with no fields. This behavior
          // will likely need revisiting.
          if (error === undefined) {
            return { fields: {} };
          }
          throw error;
        }).then(parseFormatSchema => this.adapter.deleteObjectsByQuery(className, parseFormatSchema, query)).catch(error => {
          // When deleting sessions while changing passwords, don't throw an error if they don't have any sessions.
          if (className === "_Session" && error.code === _node.Parse.Error.OBJECT_NOT_FOUND) {
            return Promise.resolve({});
          }
          throw error;
        });
      });
    });
  }

  // Inserts an object into the database.
  // Returns a promise that resolves successfully iff the object saved.
  create(className, object, { acl } = {}) {
    // Make a copy of the object, so we don't mutate the incoming data.
    const originalObject = object;
    object = transformObjectACL(object);

    object.createdAt = { iso: object.createdAt, __type: 'Date' };
    object.updatedAt = { iso: object.updatedAt, __type: 'Date' };

    var isMaster = acl === undefined;
    var aclGroup = acl || [];
    const relationUpdates = this.collectRelationUpdates(className, null, object);
    return this.validateClassName(className).then(() => this.loadSchema()).then(schemaController => {
      return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'create')).then(() => schemaController.enforceClassExists(className)).then(() => schemaController.reloadData()).then(() => schemaController.getOneSchema(className, true)).then(schema => {
        transformAuthData(className, object, schema);
        flattenUpdateOperatorsForCreate(object);
        return this.adapter.createObject(className, SchemaController.convertSchemaToAdapterSchema(schema), object);
      }).then(result => {
        return this.handleRelationUpdates(className, object.objectId, object, relationUpdates).then(() => {
          return sanitizeDatabaseResult(originalObject, result.ops[0]);
        });
      });
    });
  }

  canAddField(schema, className, object, aclGroup) {
    const classSchema = schema.data[className];
    if (!classSchema) {
      return Promise.resolve();
    }
    const fields = Object.keys(object);
    const schemaFields = Object.keys(classSchema);
    const newKeys = fields.filter(field => {
      // Skip fields that are unset
      if (object[field] && object[field].__op && object[field].__op === 'Delete') {
        return false;
      }
      return schemaFields.indexOf(field) < 0;
    });
    if (newKeys.length > 0) {
      return schema.validatePermission(className, aclGroup, 'addField');
    }
    return Promise.resolve();
  }

  // Won't delete collections in the system namespace
  /**
   * Delete all classes and clears the schema cache
   *
   * @param {boolean} fast set to true if it's ok to just delete rows and not indexes
   * @returns {Promise<void>} when the deletions completes
   */
  deleteEverything(fast = false) {
    this.schemaPromise = null;
    return Promise.all([this.adapter.deleteAllClasses(fast), this.schemaCache.clear()]);
  }

  // Returns a promise for a list of related ids given an owning id.
  // className here is the owning className.
  relatedIds(className, key, owningId, queryOptions) {
    const { skip, limit, sort } = queryOptions;
    const findOptions = {};
    if (sort && sort.createdAt && this.adapter.canSortOnJoinTables) {
      findOptions.sort = { '_id': sort.createdAt };
      findOptions.limit = limit;
      findOptions.skip = skip;
      queryOptions.skip = 0;
    }
    return this.adapter.find(joinTableName(className, key), relationSchema, { owningId }, findOptions).then(results => results.map(result => result.relatedId));
  }

  // Returns a promise for a list of owning ids given some related ids.
  // className here is the owning className.
  owningIds(className, key, relatedIds) {
    return this.adapter.find(joinTableName(className, key), relationSchema, { relatedId: { '$in': relatedIds } }, {}).then(results => results.map(result => result.owningId));
  }

  // Modifies query so that it no longer has $in on relation fields, or
  // equal-to-pointer constraints on relation fields.
  // Returns a promise that resolves when query is mutated
  reduceInRelation(className, query, schema) {
    // Search for an in-relation or equal-to-relation
    // Make it sequential for now, not sure of paralleization side effects
    if (query['$or']) {
      const ors = query['$or'];
      return Promise.all(ors.map((aQuery, index) => {
        return this.reduceInRelation(className, aQuery, schema).then(aQuery => {
          query['$or'][index] = aQuery;
        });
      })).then(() => {
        return Promise.resolve(query);
      });
    }

    const promises = Object.keys(query).map(key => {
      const t = schema.getExpectedType(className, key);
      if (!t || t.type !== 'Relation') {
        return Promise.resolve(query);
      }
      let queries = null;
      if (query[key] && (query[key]['$in'] || query[key]['$ne'] || query[key]['$nin'] || query[key].__type == 'Pointer')) {
        // Build the list of queries
        queries = Object.keys(query[key]).map(constraintKey => {
          let relatedIds;
          let isNegation = false;
          if (constraintKey === 'objectId') {
            relatedIds = [query[key].objectId];
          } else if (constraintKey == '$in') {
            relatedIds = query[key]['$in'].map(r => r.objectId);
          } else if (constraintKey == '$nin') {
            isNegation = true;
            relatedIds = query[key]['$nin'].map(r => r.objectId);
          } else if (constraintKey == '$ne') {
            isNegation = true;
            relatedIds = [query[key]['$ne'].objectId];
          } else {
            return;
          }
          return {
            isNegation,
            relatedIds
          };
        });
      } else {
        queries = [{ isNegation: false, relatedIds: [] }];
      }

      // remove the current queryKey as we don,t need it anymore
      delete query[key];
      // execute each query independently to build the list of
      // $in / $nin
      const promises = queries.map(q => {
        if (!q) {
          return Promise.resolve();
        }
        return this.owningIds(className, key, q.relatedIds).then(ids => {
          if (q.isNegation) {
            this.addNotInObjectIdsIds(ids, query);
          } else {
            this.addInObjectIdsIds(ids, query);
          }
          return Promise.resolve();
        });
      });

      return Promise.all(promises).then(() => {
        return Promise.resolve();
      });
    });

    return Promise.all(promises).then(() => {
      return Promise.resolve(query);
    });
  }

  // Modifies query so that it no longer has $relatedTo
  // Returns a promise that resolves when query is mutated
  reduceRelationKeys(className, query, queryOptions) {

    if (query['$or']) {
      return Promise.all(query['$or'].map(aQuery => {
        return this.reduceRelationKeys(className, aQuery, queryOptions);
      }));
    }

    var relatedTo = query['$relatedTo'];
    if (relatedTo) {
      return this.relatedIds(relatedTo.object.className, relatedTo.key, relatedTo.object.objectId, queryOptions).then(ids => {
        delete query['$relatedTo'];
        this.addInObjectIdsIds(ids, query);
        return this.reduceRelationKeys(className, query, queryOptions);
      }).then(() => {});
    }
  }

  addInObjectIdsIds(ids = null, query) {
    const idsFromString = typeof query.objectId === 'string' ? [query.objectId] : null;
    const idsFromEq = query.objectId && query.objectId['$eq'] ? [query.objectId['$eq']] : null;
    const idsFromIn = query.objectId && query.objectId['$in'] ? query.objectId['$in'] : null;

    // -disable-next
    const allIds = [idsFromString, idsFromEq, idsFromIn, ids].filter(list => list !== null);
    const totalLength = allIds.reduce((memo, list) => memo + list.length, 0);

    let idsIntersection = [];
    if (totalLength > 125) {
      idsIntersection = _intersect2.default.big(allIds);
    } else {
      idsIntersection = (0, _intersect2.default)(allIds);
    }

    // Need to make sure we don't clobber existing shorthand $eq constraints on objectId.
    if (!('objectId' in query)) {
      query.objectId = {
        $in: undefined
      };
    } else if (typeof query.objectId === 'string') {
      query.objectId = {
        $in: undefined,
        $eq: query.objectId
      };
    }
    query.objectId['$in'] = idsIntersection;

    return query;
  }

  addNotInObjectIdsIds(ids = [], query) {
    const idsFromNin = query.objectId && query.objectId['$nin'] ? query.objectId['$nin'] : [];
    let allIds = [...idsFromNin, ...ids].filter(list => list !== null);

    // make a set and spread to remove duplicates
    allIds = [...new Set(allIds)];

    // Need to make sure we don't clobber existing shorthand $eq constraints on objectId.
    if (!('objectId' in query)) {
      query.objectId = {
        $nin: undefined
      };
    } else if (typeof query.objectId === 'string') {
      query.objectId = {
        $nin: undefined,
        $eq: query.objectId
      };
    }

    query.objectId['$nin'] = allIds;
    return query;
  }

  // Runs a query on the database.
  // Returns a promise that resolves to a list of items.
  // Options:
  //   skip    number of results to skip.
  //   limit   limit to this number of results.
  //   sort    an object where keys are the fields to sort by.
  //           the value is +1 for ascending, -1 for descending.
  //   count   run a count instead of returning results.
  //   acl     restrict this operation with an ACL for the provided array
  //           of user objectIds and roles. acl: null means no user.
  //           when this field is not present, don't do anything regarding ACLs.
  // TODO: make userIds not needed here. The db adapter shouldn't know
  // anything about users, ideally. Then, improve the format of the ACL
  // arg to work like the others.
  find(className, query, {
    skip,
    limit,
    acl,
    sort = {},
    count,
    keys,
    op,
    distinct,
    pipeline,
    readPreference,
    isWrite
  } = {}) {
    const isMaster = acl === undefined;
    const aclGroup = acl || [];
    op = op || (typeof query.objectId == 'string' && Object.keys(query).length === 1 ? 'get' : 'find');
    // Count operation if counting
    op = count === true ? 'count' : op;

    let classExists = true;
    return this.loadSchema().then(schemaController => {
      //Allow volatile classes if querying with Master (for _PushStatus)
      //TODO: Move volatile classes concept into mongo adapter, postgres adapter shouldn't care
      //that api.parse.com breaks when _PushStatus exists in mongo.
      return schemaController.getOneSchema(className, isMaster).catch(error => {
        // Behavior for non-existent classes is kinda weird on Parse.com. Probably doesn't matter too much.
        // For now, pretend the class exists but has no objects,
        if (error === undefined) {
          classExists = false;
          return { fields: {} };
        }
        throw error;
      }).then(schema => {
        // Parse.com treats queries on _created_at and _updated_at as if they were queries on createdAt and updatedAt,
        // so duplicate that behavior here. If both are specified, the correct behavior to match Parse.com is to
        // use the one that appears first in the sort list.
        if (sort._created_at) {
          sort.createdAt = sort._created_at;
          delete sort._created_at;
        }
        if (sort._updated_at) {
          sort.updatedAt = sort._updated_at;
          delete sort._updated_at;
        }
        const queryOptions = { skip, limit, sort, keys, readPreference };
        Object.keys(sort).forEach(fieldName => {
          if (fieldName.match(/^authData\.([a-zA-Z0-9_]+)\.id$/)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Cannot sort by ${fieldName}`);
          }
          const rootFieldName = getRootFieldName(fieldName);
          if (!SchemaController.fieldNameIsValid(rootFieldName)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid field name: ${fieldName}.`);
          }
        });
        return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, op)).then(() => this.reduceRelationKeys(className, query, queryOptions)).then(() => this.reduceInRelation(className, query, schemaController)).then(() => {
          if (!isMaster) {
            query = this.addPointerPermissions(schemaController, className, op, query, aclGroup);
          }
          if (!query) {
            if (op == 'get') {
              throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
            } else {
              return [];
            }
          }
          if (!isMaster) {
            if (isWrite) {
              query = addWriteACL(query, aclGroup);
            } else {
              query = addReadACL(query, aclGroup);
            }
          }
          validateQuery(query);
          if (count) {
            if (!classExists) {
              return 0;
            } else {
              return this.adapter.count(className, schema, query, readPreference);
            }
          } else if (distinct) {
            if (!classExists) {
              return [];
            } else {
              return this.adapter.distinct(className, schema, query, distinct);
            }
          } else if (pipeline) {
            if (!classExists) {
              return [];
            } else {
              return this.adapter.aggregate(className, schema, pipeline, readPreference);
            }
          } else {
            return this.adapter.find(className, schema, query, queryOptions).then(objects => objects.map(object => {
              object = untransformObjectACL(object);
              return filterSensitiveData(isMaster, aclGroup, className, object);
            })).catch(error => {
              throw new _node.Parse.Error(_node.Parse.Error.INTERNAL_SERVER_ERROR, error);
            });
          }
        });
      });
    });
  }

  deleteSchema(className) {
    return this.loadSchema({ clearCache: true }).then(schemaController => schemaController.getOneSchema(className, true)).catch(error => {
      if (error === undefined) {
        return { fields: {} };
      } else {
        throw error;
      }
    }).then(schema => {
      return this.collectionExists(className).then(() => this.adapter.count(className, { fields: {} })).then(count => {
        if (count > 0) {
          throw new _node.Parse.Error(255, `Class ${className} is not empty, contains ${count} objects, cannot drop schema.`);
        }
        return this.adapter.deleteClass(className);
      }).then(wasParseCollection => {
        if (wasParseCollection) {
          const relationFieldNames = Object.keys(schema.fields).filter(fieldName => schema.fields[fieldName].type === 'Relation');
          return Promise.all(relationFieldNames.map(name => this.adapter.deleteClass(joinTableName(className, name)))).then(() => {
            return;
          });
        } else {
          return Promise.resolve();
        }
      });
    });
  }

  addPointerPermissions(schema, className, operation, query, aclGroup = []) {
    // Check if class has public permission for operation
    // If the BaseCLP pass, let go through
    if (schema.testBaseCLP(className, aclGroup, operation)) {
      return query;
    }
    const perms = schema.perms[className];
    const field = ['get', 'find'].indexOf(operation) > -1 ? 'readUserFields' : 'writeUserFields';
    const userACL = aclGroup.filter(acl => {
      return acl.indexOf('role:') != 0 && acl != '*';
    });
    // the ACL should have exactly 1 user
    if (perms && perms[field] && perms[field].length > 0) {
      // No user set return undefined
      // If the length is > 1, that means we didn't de-dupe users correctly
      if (userACL.length != 1) {
        return;
      }
      const userId = userACL[0];
      const userPointer = {
        "__type": "Pointer",
        "className": "_User",
        "objectId": userId
      };

      const permFields = perms[field];
      const ors = permFields.map(key => {
        const q = {
          [key]: userPointer
        };
        // if we already have a constraint on the key, use the $and
        if (query.hasOwnProperty(key)) {
          return { '$and': [q, query] };
        }
        // otherwise just add the constaint
        return Object.assign({}, query, {
          [`${key}`]: userPointer
        });
      });
      if (ors.length > 1) {
        return { '$or': ors };
      }
      return ors[0];
    } else {
      return query;
    }
  }

  // TODO: create indexes on first creation of a _User object. Otherwise it's impossible to
  // have a Parse app without it having a _User collection.
  performInitialization() {
    const requiredUserFields = { fields: _extends({}, SchemaController.defaultColumns._Default, SchemaController.defaultColumns._User) };
    const requiredRoleFields = { fields: _extends({}, SchemaController.defaultColumns._Default, SchemaController.defaultColumns._Role) };

    const userClassPromise = this.loadSchema().then(schema => schema.enforceClassExists('_User'));
    const roleClassPromise = this.loadSchema().then(schema => schema.enforceClassExists('_Role'));

    const usernameUniqueness = userClassPromise.then(() => this.adapter.ensureUniqueness('_User', requiredUserFields, ['username'])).catch(error => {
      _logger2.default.warn('Unable to ensure uniqueness for usernames: ', error);
      throw error;
    });

    const emailUniqueness = userClassPromise.then(() => this.adapter.ensureUniqueness('_User', requiredUserFields, ['email'])).catch(error => {
      _logger2.default.warn('Unable to ensure uniqueness for user email addresses: ', error);
      throw error;
    });

    const roleUniqueness = roleClassPromise.then(() => this.adapter.ensureUniqueness('_Role', requiredRoleFields, ['name'])).catch(error => {
      _logger2.default.warn('Unable to ensure uniqueness for role name: ', error);
      throw error;
    });

    const indexPromise = this.adapter.updateSchemaWithIndexes();

    // Create tables for volatile classes
    const adapterInit = this.adapter.performInitialization({ VolatileClassesSchemas: SchemaController.VolatileClassesSchemas });
    return Promise.all([usernameUniqueness, emailUniqueness, roleUniqueness, adapterInit, indexPromise]);
  }

}

module.exports = DatabaseController;
// Expose validateQuery for tests
module.exports._validateQuery = validateQuery;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9EYXRhYmFzZUNvbnRyb2xsZXIuanMiXSwibmFtZXMiOlsiU2NoZW1hQ29udHJvbGxlciIsImFkZFdyaXRlQUNMIiwicXVlcnkiLCJhY2wiLCJuZXdRdWVyeSIsIl8iLCJjbG9uZURlZXAiLCJfd3Blcm0iLCJhZGRSZWFkQUNMIiwiX3JwZXJtIiwidHJhbnNmb3JtT2JqZWN0QUNMIiwiQUNMIiwicmVzdWx0IiwiZW50cnkiLCJyZWFkIiwicHVzaCIsIndyaXRlIiwic3BlY2lhbFF1ZXJ5a2V5cyIsImlzU3BlY2lhbFF1ZXJ5S2V5Iiwia2V5IiwiaW5kZXhPZiIsInZhbGlkYXRlUXVlcnkiLCJQYXJzZSIsIkVycm9yIiwiSU5WQUxJRF9RVUVSWSIsIiRvciIsIkFycmF5IiwiZm9yRWFjaCIsIk9iamVjdCIsImtleXMiLCJub0NvbGxpc2lvbnMiLCJzb21lIiwic3VicSIsImhhc093blByb3BlcnR5IiwiaGFzTmVhcnMiLCJzdWJxdWVyeSIsIiRhbmQiLCIkbm9yIiwibGVuZ3RoIiwiJHJlZ2V4IiwiJG9wdGlvbnMiLCJtYXRjaCIsIklOVkFMSURfS0VZX05BTUUiLCJmaWx0ZXJTZW5zaXRpdmVEYXRhIiwiaXNNYXN0ZXIiLCJhY2xHcm91cCIsImNsYXNzTmFtZSIsIm9iamVjdCIsInBhc3N3b3JkIiwiX2hhc2hlZF9wYXNzd29yZCIsInNlc3Npb25Ub2tlbiIsIl9lbWFpbF92ZXJpZnlfdG9rZW4iLCJfcGVyaXNoYWJsZV90b2tlbiIsIl9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQiLCJfdG9tYnN0b25lIiwiX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0IiwiX2ZhaWxlZF9sb2dpbl9jb3VudCIsIl9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCIsIl9wYXNzd29yZF9jaGFuZ2VkX2F0IiwiX3Bhc3N3b3JkX2hpc3RvcnkiLCJvYmplY3RJZCIsImF1dGhEYXRhIiwic3BlY2lhbEtleXNGb3JVcGRhdGUiLCJpc1NwZWNpYWxVcGRhdGVLZXkiLCJleHBhbmRSZXN1bHRPbktleVBhdGgiLCJ2YWx1ZSIsInBhdGgiLCJzcGxpdCIsImZpcnN0S2V5IiwibmV4dFBhdGgiLCJzbGljZSIsImpvaW4iLCJzYW5pdGl6ZURhdGFiYXNlUmVzdWx0Iiwib3JpZ2luYWxPYmplY3QiLCJyZXNwb25zZSIsIlByb21pc2UiLCJyZXNvbHZlIiwia2V5VXBkYXRlIiwiX19vcCIsImpvaW5UYWJsZU5hbWUiLCJmbGF0dGVuVXBkYXRlT3BlcmF0b3JzRm9yQ3JlYXRlIiwiYW1vdW50IiwiSU5WQUxJRF9KU09OIiwib2JqZWN0cyIsIkNPTU1BTkRfVU5BVkFJTEFCTEUiLCJ0cmFuc2Zvcm1BdXRoRGF0YSIsInNjaGVtYSIsInByb3ZpZGVyIiwicHJvdmlkZXJEYXRhIiwiZmllbGROYW1lIiwiZmllbGRzIiwidHlwZSIsInVudHJhbnNmb3JtT2JqZWN0QUNMIiwib3V0cHV0IiwiZ2V0Um9vdEZpZWxkTmFtZSIsInJlbGF0aW9uU2NoZW1hIiwicmVsYXRlZElkIiwib3duaW5nSWQiLCJEYXRhYmFzZUNvbnRyb2xsZXIiLCJjb25zdHJ1Y3RvciIsImFkYXB0ZXIiLCJzY2hlbWFDYWNoZSIsInNjaGVtYVByb21pc2UiLCJjb2xsZWN0aW9uRXhpc3RzIiwiY2xhc3NFeGlzdHMiLCJwdXJnZUNvbGxlY3Rpb24iLCJsb2FkU2NoZW1hIiwidGhlbiIsInNjaGVtYUNvbnRyb2xsZXIiLCJnZXRPbmVTY2hlbWEiLCJkZWxldGVPYmplY3RzQnlRdWVyeSIsInZhbGlkYXRlQ2xhc3NOYW1lIiwiY2xhc3NOYW1lSXNWYWxpZCIsInJlamVjdCIsIklOVkFMSURfQ0xBU1NfTkFNRSIsIm9wdGlvbnMiLCJjbGVhckNhY2hlIiwibG9hZCIsInJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5IiwidCIsImdldEV4cGVjdGVkVHlwZSIsInRhcmdldENsYXNzIiwidmFsaWRhdGVPYmplY3QiLCJ1bmRlZmluZWQiLCJzIiwiY2FuQWRkRmllbGQiLCJ1cGRhdGUiLCJtYW55IiwidXBzZXJ0Iiwic2tpcFNhbml0aXphdGlvbiIsIm9yaWdpbmFsUXVlcnkiLCJvcmlnaW5hbFVwZGF0ZSIsInJlbGF0aW9uVXBkYXRlcyIsInZhbGlkYXRlUGVybWlzc2lvbiIsImNvbGxlY3RSZWxhdGlvblVwZGF0ZXMiLCJhZGRQb2ludGVyUGVybWlzc2lvbnMiLCJjYXRjaCIsImVycm9yIiwicm9vdEZpZWxkTmFtZSIsImZpZWxkTmFtZUlzVmFsaWQiLCJ1cGRhdGVPcGVyYXRpb24iLCJpbm5lcktleSIsImluY2x1ZGVzIiwiSU5WQUxJRF9ORVNURURfS0VZIiwidXBkYXRlT2JqZWN0c0J5UXVlcnkiLCJ1cHNlcnRPbmVPYmplY3QiLCJmaW5kT25lQW5kVXBkYXRlIiwiT0JKRUNUX05PVF9GT1VORCIsImhhbmRsZVJlbGF0aW9uVXBkYXRlcyIsIm9wcyIsImRlbGV0ZU1lIiwicHJvY2VzcyIsIm9wIiwieCIsInBlbmRpbmciLCJhZGRSZWxhdGlvbiIsInJlbW92ZVJlbGF0aW9uIiwiYWxsIiwiZnJvbUNsYXNzTmFtZSIsImZyb21JZCIsInRvSWQiLCJkb2MiLCJjb2RlIiwiZGVzdHJveSIsInBhcnNlRm9ybWF0U2NoZW1hIiwiY3JlYXRlIiwiY3JlYXRlZEF0IiwiaXNvIiwiX190eXBlIiwidXBkYXRlZEF0IiwiZW5mb3JjZUNsYXNzRXhpc3RzIiwicmVsb2FkRGF0YSIsImNyZWF0ZU9iamVjdCIsImNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEiLCJjbGFzc1NjaGVtYSIsImRhdGEiLCJzY2hlbWFGaWVsZHMiLCJuZXdLZXlzIiwiZmlsdGVyIiwiZmllbGQiLCJkZWxldGVFdmVyeXRoaW5nIiwiZmFzdCIsImRlbGV0ZUFsbENsYXNzZXMiLCJjbGVhciIsInJlbGF0ZWRJZHMiLCJxdWVyeU9wdGlvbnMiLCJza2lwIiwibGltaXQiLCJzb3J0IiwiZmluZE9wdGlvbnMiLCJjYW5Tb3J0T25Kb2luVGFibGVzIiwiZmluZCIsInJlc3VsdHMiLCJtYXAiLCJvd25pbmdJZHMiLCJyZWR1Y2VJblJlbGF0aW9uIiwib3JzIiwiYVF1ZXJ5IiwiaW5kZXgiLCJwcm9taXNlcyIsInF1ZXJpZXMiLCJjb25zdHJhaW50S2V5IiwiaXNOZWdhdGlvbiIsInIiLCJxIiwiaWRzIiwiYWRkTm90SW5PYmplY3RJZHNJZHMiLCJhZGRJbk9iamVjdElkc0lkcyIsInJlZHVjZVJlbGF0aW9uS2V5cyIsInJlbGF0ZWRUbyIsImlkc0Zyb21TdHJpbmciLCJpZHNGcm9tRXEiLCJpZHNGcm9tSW4iLCJhbGxJZHMiLCJsaXN0IiwidG90YWxMZW5ndGgiLCJyZWR1Y2UiLCJtZW1vIiwiaWRzSW50ZXJzZWN0aW9uIiwiaW50ZXJzZWN0IiwiYmlnIiwiJGluIiwiJGVxIiwiaWRzRnJvbU5pbiIsIlNldCIsIiRuaW4iLCJjb3VudCIsImRpc3RpbmN0IiwicGlwZWxpbmUiLCJyZWFkUHJlZmVyZW5jZSIsImlzV3JpdGUiLCJfY3JlYXRlZF9hdCIsIl91cGRhdGVkX2F0IiwiYWdncmVnYXRlIiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwiZGVsZXRlU2NoZW1hIiwiZGVsZXRlQ2xhc3MiLCJ3YXNQYXJzZUNvbGxlY3Rpb24iLCJyZWxhdGlvbkZpZWxkTmFtZXMiLCJuYW1lIiwib3BlcmF0aW9uIiwidGVzdEJhc2VDTFAiLCJwZXJtcyIsInVzZXJBQ0wiLCJ1c2VySWQiLCJ1c2VyUG9pbnRlciIsInBlcm1GaWVsZHMiLCJhc3NpZ24iLCJwZXJmb3JtSW5pdGlhbGl6YXRpb24iLCJyZXF1aXJlZFVzZXJGaWVsZHMiLCJkZWZhdWx0Q29sdW1ucyIsIl9EZWZhdWx0IiwiX1VzZXIiLCJyZXF1aXJlZFJvbGVGaWVsZHMiLCJfUm9sZSIsInVzZXJDbGFzc1Byb21pc2UiLCJyb2xlQ2xhc3NQcm9taXNlIiwidXNlcm5hbWVVbmlxdWVuZXNzIiwiZW5zdXJlVW5pcXVlbmVzcyIsImxvZ2dlciIsIndhcm4iLCJlbWFpbFVuaXF1ZW5lc3MiLCJyb2xlVW5pcXVlbmVzcyIsImluZGV4UHJvbWlzZSIsInVwZGF0ZVNjaGVtYVdpdGhJbmRleGVzIiwiYWRhcHRlckluaXQiLCJWb2xhdGlsZUNsYXNzZXNTY2hlbWFzIiwibW9kdWxlIiwiZXhwb3J0cyIsIl92YWxpZGF0ZVF1ZXJ5Il0sIm1hcHBpbmdzIjoiOzs7O0FBS0E7O0FBRUE7Ozs7QUFFQTs7OztBQUVBOzs7O0FBQ0E7Ozs7QUFDQTs7SUFBWUEsZ0I7O0FBQ1o7Ozs7Ozs7QUFiQTtBQUNBOztBQUVBOztBQUVBOztBQUVBOztBQUVBOzs7QUFRQSxTQUFTQyxXQUFULENBQXFCQyxLQUFyQixFQUE0QkMsR0FBNUIsRUFBaUM7QUFDL0IsUUFBTUMsV0FBV0MsaUJBQUVDLFNBQUYsQ0FBWUosS0FBWixDQUFqQjtBQUNBO0FBQ0FFLFdBQVNHLE1BQVQsR0FBa0IsRUFBRSxPQUFRLENBQUMsSUFBRCxFQUFPLEdBQUdKLEdBQVYsQ0FBVixFQUFsQjtBQUNBLFNBQU9DLFFBQVA7QUFDRDs7QUFFRCxTQUFTSSxVQUFULENBQW9CTixLQUFwQixFQUEyQkMsR0FBM0IsRUFBZ0M7QUFDOUIsUUFBTUMsV0FBV0MsaUJBQUVDLFNBQUYsQ0FBWUosS0FBWixDQUFqQjtBQUNBO0FBQ0FFLFdBQVNLLE1BQVQsR0FBa0IsRUFBQyxPQUFPLENBQUMsSUFBRCxFQUFPLEdBQVAsRUFBWSxHQUFHTixHQUFmLENBQVIsRUFBbEI7QUFDQSxTQUFPQyxRQUFQO0FBQ0Q7O0FBRUQ7QUFDQSxNQUFNTSxxQkFBcUIsVUFBd0I7QUFBQSxNQUF2QixFQUFFQyxHQUFGLEVBQXVCO0FBQUEsTUFBYkMsTUFBYTs7QUFDakQsTUFBSSxDQUFDRCxHQUFMLEVBQVU7QUFDUixXQUFPQyxNQUFQO0FBQ0Q7O0FBRURBLFNBQU9MLE1BQVAsR0FBZ0IsRUFBaEI7QUFDQUssU0FBT0gsTUFBUCxHQUFnQixFQUFoQjs7QUFFQSxPQUFLLE1BQU1JLEtBQVgsSUFBb0JGLEdBQXBCLEVBQXlCO0FBQ3ZCLFFBQUlBLElBQUlFLEtBQUosRUFBV0MsSUFBZixFQUFxQjtBQUNuQkYsYUFBT0gsTUFBUCxDQUFjTSxJQUFkLENBQW1CRixLQUFuQjtBQUNEO0FB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QTNDLEVBQW5DLENBQXBCO0FBQ0EsV0FBTy9MLFFBQVFrRixHQUFSLENBQVksQ0FBQ29HLGtCQUFELEVBQXFCSSxlQUFyQixFQUFzQ0MsY0FBdEMsRUFBc0RHLFdBQXRELEVBQW1FRixZQUFuRSxDQUFaLENBQVA7QUFDRDs7QUFseEJzQjs7QUF1eEJ6QkksT0FBT0MsT0FBUCxHQUFpQjFLLGtCQUFqQjtBQUNBO0FBQ0F5SyxPQUFPQyxPQUFQLENBQWVDLGNBQWYsR0FBZ0N4UCxhQUFoQyIsImZpbGUiOiJEYXRhYmFzZUNvbnRyb2xsZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyLvu78vLyBAZmxvd1xuLy8gQSBkYXRhYmFzZSBhZGFwdGVyIHRoYXQgd29ya3Mgd2l0aCBkYXRhIGV4cG9ydGVkIGZyb20gdGhlIGhvc3RlZFxuLy8gUGFyc2UgZGF0YWJhc2UuXG5cbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuaW1wb3J0IHsgUGFyc2UgfSAgICAgICAgICAgICAgZnJvbSAncGFyc2Uvbm9kZSc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBfICAgICAgICAgICAgICAgICAgICAgIGZyb20gJ2xvZGFzaCc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBpbnRlcnNlY3QgICAgICAgICAgICAgIGZyb20gJ2ludGVyc2VjdCc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBkZWVwY29weSAgICAgICAgICAgICAgIGZyb20gJ2RlZXBjb3B5JztcbmltcG9ydCBsb2dnZXIgICAgICAgICAgICAgICAgIGZyb20gJy4uL2xvZ2dlcic7XG5pbXBvcnQgKiBhcyBTY2hlbWFDb250cm9sbGVyICAgICAgIGZyb20gJy4vU2NoZW1hQ29udHJvbGxlcic7XG5pbXBvcnQgeyBTdG9yYWdlQWRhcHRlciB9ICAgICBmcm9tICcuLi9BZGFwdGVycy9TdG9yYWdlL1N0b3JhZ2VBZGFwdGVyJztcbmltcG9ydCB0eXBlIHsgUXVlcnlPcHRpb25zLFxuICBGdWxsUXVlcnlPcHRpb25zIH0gICAgICAgICAgZnJvbSAnLi4vQWRhcHRlcnMvU3RvcmFnZS9TdG9yYWdlQWRhcHRlcic7XG5cbmZ1bmN0aW9uIGFkZFdyaXRlQUNMKHF1ZXJ5LCBhY2wpIHtcbiAgY29uc3QgbmV3UXVlcnkgPSBfLmNsb25lRGVlcChxdWVyeSk7XG4gIC8vQ2FuJ3QgYmUgYW55IGV4aXN0aW5nICdfd3Blcm0nIHF1ZXJ5LCB3ZSBkb24ndCBhbGxvdyBjbGllbnQgcXVlcmllcyBvbiB0aGF0LCBubyBuZWVkIHRvICRhbmRcbiAgbmV3UXVlcnkuX3dwZXJtID0geyBcIiRpblwiIDogW251bGwsIC4uLmFjbF19O1xuICByZXR1cm4gbmV3UXVlcnk7XG59XG5cbmZ1bmN0aW9uIGFkZFJlYWRBQ0wocXVlcnksIGFjbCkge1xuICBjb25zdCBuZXdRdWVyeSA9IF8uY2xvbmVEZWVwKHF1ZXJ5KTtcbiAgLy9DYW4ndCBiZSBhbnkgZXhpc3RpbmcgJ19ycGVybScgcXVlcnksIHdlIGRvbid0IGFsbG93IGNsaWVudCBxdWVyaWVzIG9uIHRoYXQsIG5vIG5lZWQgdG8gJGFuZFxuICBuZXdRdWVyeS5fcnBlcm0gPSB7XCIkaW5cIjogW251bGwsIFwiKlwiLCAuLi5hY2xdfTtcbiAgcmV0dXJuIG5ld1F1ZXJ5O1xufVxuXG4vLyBUcmFuc2Zvcm1zIGEgUkVTVCBBUEkgZm9ybWF0dGVkIEFDTCBvYmplY3QgdG8gb3VyIHR3by1maWVsZCBtb25nbyBmb3JtYXQuXG5jb25zdCB0cmFuc2Zvcm1PYmplY3RBQ0wgPSAoeyBBQ0wsIC4uLnJlc3VsdCB9KSA9PiB7XG4gIGlmICghQUNMKSB7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHJlc3VsdC5fd3Blcm0gPSBbXTtcbiAgcmVzdWx0Ll9ycGVybSA9IFtdO1xuXG4gIGZvciAoY29uc3QgZW50cnkgaW4gQUNMKSB7XG4gICAgaWYgKEFDTFtlbnRyeV0ucmVhZCkge1xuICAgICAgcmVzdWx0Ll9ycGVybS5wdXNoKGVudHJ5KTtcbiAgICB9XG4gICAgaWYgKEFDTFtlbnRyeV0ud3JpdGUpIHtcbiAgICAgIHJlc3VsdC5fd3Blcm0ucHVzaChlbnRyeSk7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmNvbnN0IHNwZWNpYWxRdWVyeWtleXMgPSBbJyRhbmQnLCAnJG9yJywgJyRub3InLCAnX3JwZXJtJywgJ193cGVybScsICdfcGVyaXNoYWJsZV90b2tlbicsICdfZW1haWxfdmVyaWZ5X3Rva2VuJywgJ19lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCcsICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnLCAnX2ZhaWxlZF9sb2dpbl9jb3VudCddO1xuXG5jb25zdCBpc1NwZWNpYWxRdWVyeUtleSA9IGtleSA9PiB7XG4gIHJldHVybiBzcGVjaWFsUXVlcnlrZXlzLmluZGV4T2Yoa2V5KSA+PSAwO1xufVxuXG5jb25zdCB2YWxpZGF0ZVF1ZXJ5ID0gKHF1ZXJ5OiBhbnkpOiB2b2lkID0+IHtcbiAgaWYgKHF1ZXJ5LkFDTCkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCAnQ2Fubm90IHF1ZXJ5IG9uIEFDTC4nKTtcbiAgfVxuXG4gIGlmIChxdWVyeS4kb3IpIHtcbiAgICBpZiAocXVlcnkuJG9yIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgIHF1ZXJ5LiRvci5mb3JFYWNoKHZhbGlkYXRlUXVlcnkpO1xuXG4gICAgICAvKiBJbiBNb25nb0RCLCAkb3IgcXVlcmllcyB3aGljaCBhcmUgbm90IGFsb25lIGF0IHRoZSB0b3AgbGV2ZWwgb2YgdGhlXG4gICAgICAgKiBxdWVyeSBjYW4gbm90IG1ha2UgZWZmaWNpZW50IHVzZSBvZiBpbmRleGVzIGR1ZSB0byBhIGxvbmcgc3RhbmRpbmdcbiAgICAgICAqIGJ1ZyBrbm93biBhcyBTRVJWRVItMTM3MzIuXG4gICAgICAgKlxuICAgICAgICogVGhpcyBibG9jayByZXN0cnVjdHVyZXMgcXVlcmllcyBpbiB3aGljaCAkb3IgaXMgbm90IHRoZSBzb2xlIHRvcFxuICAgICAgICogbGV2ZWwgZWxlbWVudCBieSBtb3ZpbmcgYWxsIG90aGVyIHRvcC1sZXZlbCBwcmVkaWNhdGVzIGluc2lkZSBldmVyeVxuICAgICAgICogc3ViZG9jdW1lbnQgb2YgdGhlICRvciBwcmVkaWNhdGUsIGFsbG93aW5nIE1vbmdvREIncyBxdWVyeSBwbGFubmVyXG4gICAgICAgKiB0byBtYWtlIGZ1bGwgdXNlIG9mIHRoZSBtb3N0IHJlbGV2YW50IGluZGV4ZXMuXG4gICAgICAgKlxuICAgICAgICogRUc6ICAgICAgeyRvcjogW3thOiAxfSwge2E6IDJ9XSwgYjogMn1cbiAgICAgICAqIEJlY29tZXM6IHskb3I6IFt7YTogMSwgYjogMn0sIHthOiAyLCBiOiAyfV19XG4gICAgICAgKlxuICAgICAgICogVGhlIG9ubHkgZXhjZXB0aW9ucyBhcmUgJG5lYXIgYW5kICRuZWFyU3BoZXJlIG9wZXJhdG9ycywgd2hpY2ggYXJlXG4gICAgICAgKiBjb25zdHJhaW5lZCB0byBvbmx5IDEgb3BlcmF0b3IgcGVyIHF1ZXJ5LiBBcyBhIHJlc3VsdCwgdGhlc2Ugb3BzXG4gICAgICAgKiByZW1haW4gYXQgdGhlIHRvcCBsZXZlbFxuICAgICAgICpcbiAgICAgICAqIGh0dHBzOi8vamlyYS5tb25nb2RiLm9yZy9icm93c2UvU0VSVkVSLTEzNzMyXG4gICAgICAgKiBodHRwczovL2dpdGh1Yi5jb20vcGFyc2UtY29tbXVuaXR5L3BhcnNlLXNlcnZlci9pc3N1ZXMvMzc2N1xuICAgICAgICovXG4gICAgICBPYmplY3Qua2V5cyhxdWVyeSkuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICBjb25zdCBub0NvbGxpc2lvbnMgPSAhcXVlcnkuJG9yLnNvbWUoc3VicSA9PiBzdWJxLmhhc093blByb3BlcnR5KGtleSkpXG4gICAgICAgIGxldCBoYXNOZWFycyA9IGZhbHNlXG4gICAgICAgIGlmIChxdWVyeVtrZXldICE9IG51bGwgJiYgdHlwZW9mIHF1ZXJ5W2tleV0gPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICBoYXNOZWFycyA9ICgnJG5lYXInIGluIHF1ZXJ5W2tleV0gfHwgJyRuZWFyU3BoZXJlJyBpbiBxdWVyeVtrZXldKVxuICAgICAgICB9XG4gICAgICAgIGlmIChrZXkgIT0gJyRvcicgJiYgbm9Db2xsaXNpb25zICYmICFoYXNOZWFycykge1xuICAgICAgICAgIHF1ZXJ5LiRvci5mb3JFYWNoKHN1YnF1ZXJ5ID0+IHtcbiAgICAgICAgICAgIHN1YnF1ZXJ5W2tleV0gPSBxdWVyeVtrZXldO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGRlbGV0ZSBxdWVyeVtrZXldO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHF1ZXJ5LiRvci5mb3JFYWNoKHZhbGlkYXRlUXVlcnkpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgJ0JhZCAkb3IgZm9ybWF0IC0gdXNlIGFuIGFycmF5IHZhbHVlLicpO1xuICAgIH1cbiAgfVxuXG4gIGlmIChxdWVyeS4kYW5kKSB7XG4gICAgaWYgKHF1ZXJ5LiRhbmQgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgcXVlcnkuJGFuZC5mb3JFYWNoKHZhbGlkYXRlUXVlcnkpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgJ0JhZCAkYW5kIGZvcm1hdCAtIHVzZSBhbiBhcnJheSB2YWx1ZS4nKTtcbiAgICB9XG4gIH1cblxuICBpZiAocXVlcnkuJG5vcikge1xuICAgIGlmIChxdWVyeS4kbm9yIGluc3RhbmNlb2YgQXJyYXkgJiYgcXVlcnkuJG5vci5sZW5ndGggPiAwKSB7XG4gICAgICBxdWVyeS4kbm9yLmZvckVhY2godmFsaWRhdGVRdWVyeSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCAnQmFkICRub3IgZm9ybWF0IC0gdXNlIGFuIGFycmF5IG9mIGF0IGxlYXN0IDEgdmFsdWUuJyk7XG4gICAgfVxuICB9XG5cbiAgT2JqZWN0LmtleXMocXVlcnkpLmZvckVhY2goa2V5ID0+IHtcbiAgICBpZiAocXVlcnkgJiYgcXVlcnlba2V5XSAmJiBxdWVyeVtrZXldLiRyZWdleCkge1xuICAgICAgaWYgKHR5cGVvZiBxdWVyeVtrZXldLiRvcHRpb25zID09PSAnc3RyaW5nJykge1xuICAgICAgICBpZiAoIXF1ZXJ5W2tleV0uJG9wdGlvbnMubWF0Y2goL15baW14c10rJC8pKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksIGBCYWQgJG9wdGlvbnMgdmFsdWUgZm9yIHF1ZXJ5OiAke3F1ZXJ5W2tleV0uJG9wdGlvbnN9YCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKCFpc1NwZWNpYWxRdWVyeUtleShrZXkpICYmICFrZXkubWF0Y2goL15bYS16QS1aXVthLXpBLVowLTlfXFwuXSokLykpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCBgSW52YWxpZCBrZXkgbmFtZTogJHtrZXl9YCk7XG4gICAgfVxuICB9KTtcbn1cblxuLy8gRmlsdGVycyBvdXQgYW55IGRhdGEgdGhhdCBzaG91bGRuJ3QgYmUgb24gdGhpcyBSRVNULWZvcm1hdHRlZCBvYmplY3QuXG5jb25zdCBmaWx0ZXJTZW5zaXRpdmVEYXRhID0gKGlzTWFzdGVyLCBhY2xHcm91cCwgY2xhc3NOYW1lLCBvYmplY3QpID0+IHtcbiAgaWYgKGNsYXNzTmFtZSAhPT0gJ19Vc2VyJykge1xuICAgIHJldHVybiBvYmplY3Q7XG4gIH1cblxuICBvYmplY3QucGFzc3dvcmQgPSBvYmplY3QuX2hhc2hlZF9wYXNzd29yZDtcbiAgZGVsZXRlIG9iamVjdC5faGFzaGVkX3Bhc3N3b3JkO1xuXG4gIGRlbGV0ZSBvYmplY3Quc2Vzc2lvblRva2VuO1xuXG4gIGlmIChpc01hc3Rlcikge1xuICAgIHJldHVybiBvYmplY3Q7XG4gIH1cbiAgZGVsZXRlIG9iamVjdC5fZW1haWxfdmVyaWZ5X3Rva2VuO1xuICBkZWxldGUgb2JqZWN0Ll9wZXJpc2hhYmxlX3Rva2VuO1xuICBkZWxldGUgb2JqZWN0Ll9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQ7XG4gIGRlbGV0ZSBvYmplY3QuX3RvbWJzdG9uZTtcbiAgZGVsZXRlIG9iamVjdC5fZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQ7XG4gIGRlbGV0ZSBvYmplY3QuX2ZhaWxlZF9sb2dpbl9jb3VudDtcbiAgZGVsZXRlIG9iamVjdC5fYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQ7XG4gIGRlbGV0ZSBvYmplY3QuX3Bhc3N3b3JkX2NoYW5nZWRfYXQ7XG4gIGRlbGV0ZSBvYmplY3QuX3Bhc3N3b3JkX2hpc3Rvcnk7XG5cbiAgaWYgKChhY2xHcm91cC5pbmRleE9mKG9iamVjdC5vYmplY3RJZCkgPiAtMSkpIHtcbiAgICByZXR1cm4gb2JqZWN0O1xuICB9XG4gIGRlbGV0ZSBvYmplY3QuYXV0aERhdGE7XG4gIHJldHVybiBvYmplY3Q7XG59O1xuXG5pbXBvcnQgdHlwZSB7IExvYWRTY2hlbWFPcHRpb25zIH0gZnJvbSAnLi90eXBlcyc7XG5cbi8vIFJ1bnMgYW4gdXBkYXRlIG9uIHRoZSBkYXRhYmFzZS5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhbiBvYmplY3Qgd2l0aCB0aGUgbmV3IHZhbHVlcyBmb3IgZmllbGRcbi8vIG1vZGlmaWNhdGlvbnMgdGhhdCBkb24ndCBrbm93IHRoZWlyIHJlc3VsdHMgYWhlYWQgb2YgdGltZSwgbGlrZVxuLy8gJ2luY3JlbWVudCcuXG4vLyBPcHRpb25zOlxuLy8gICBhY2w6ICBhIGxpc3Qgb2Ygc3RyaW5ncy4gSWYgdGhlIG9iamVjdCB0byBiZSB1cGRhdGVkIGhhcyBhbiBBQ0wsXG4vLyAgICAgICAgIG9uZSBvZiB0aGUgcHJvdmlkZWQgc3RyaW5ncyBtdXN0IHByb3ZpZGUgdGhlIGNhbGxlciB3aXRoXG4vLyAgICAgICAgIHdyaXRlIHBlcm1pc3Npb25zLlxuY29uc3Qgc3BlY2lhbEtleXNGb3JVcGRhdGUgPSBbJ19oYXNoZWRfcGFzc3dvcmQnLCAnX3BlcmlzaGFibGVfdG9rZW4nLCAnX2VtYWlsX3ZlcmlmeV90b2tlbicsICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnLCAnX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0JywgJ19mYWlsZWRfbG9naW5fY291bnQnLCAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCcsICdfcGFzc3dvcmRfY2hhbmdlZF9hdCcsICdfcGFzc3dvcmRfaGlzdG9yeSddO1xuXG5jb25zdCBpc1NwZWNpYWxVcGRhdGVLZXkgPSBrZXkgPT4ge1xuICByZXR1cm4gc3BlY2lhbEtleXNGb3JVcGRhdGUuaW5kZXhPZihrZXkpID49IDA7XG59XG5cbmZ1bmN0aW9uIGV4cGFuZFJlc3VsdE9uS2V5UGF0aChvYmplY3QsIGtleSwgdmFsdWUpIHtcbiAgaWYgKGtleS5pbmRleE9mKCcuJykgPCAwKSB7XG4gICAgb2JqZWN0W2tleV0gPSB2YWx1ZVtrZXldO1xuICAgIHJldHVybiBvYmplY3Q7XG4gIH1cbiAgY29uc3QgcGF0aCA9IGtleS5zcGxpdCgnLicpO1xuICBjb25zdCBmaXJzdEtleSA9IHBhdGhbMF07XG4gIGNvbnN0IG5leHRQYXRoID0gcGF0aC5zbGljZSgxKS5qb2luKCcuJyk7XG4gIG9iamVjdFtmaXJzdEtleV0gPSBleHBhbmRSZXN1bHRPbktleVBhdGgob2JqZWN0W2ZpcnN0S2V5XSB8fCB7fSwgbmV4dFBhdGgsIHZhbHVlW2ZpcnN0S2V5XSk7XG4gIGRlbGV0ZSBvYmplY3Rba2V5XTtcbiAgcmV0dXJuIG9iamVjdDtcbn1cblxuZnVuY3Rpb24gc2FuaXRpemVEYXRhYmFzZVJlc3VsdChvcmlnaW5hbE9iamVjdCwgcmVzdWx0KTogUHJvbWlzZTxhbnk+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSB7fTtcbiAgaWYgKCFyZXN1bHQpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3BvbnNlKTtcbiAgfVxuICBPYmplY3Qua2V5cyhvcmlnaW5hbE9iamVjdCkuZm9yRWFjaChrZXkgPT4ge1xuICAgIGNvbnN0IGtleVVwZGF0ZSA9IG9yaWdpbmFsT2JqZWN0W2tleV07XG4gICAgLy8gZGV0ZXJtaW5lIGlmIHRoYXQgd2FzIGFuIG9wXG4gICAgaWYgKGtleVVwZGF0ZSAmJiB0eXBlb2Yga2V5VXBkYXRlID09PSAnb2JqZWN0JyAmJiBrZXlVcGRhdGUuX19vcFxuICAgICAgJiYgWydBZGQnLCAnQWRkVW5pcXVlJywgJ1JlbW92ZScsICdJbmNyZW1lbnQnXS5pbmRleE9mKGtleVVwZGF0ZS5fX29wKSA+IC0xKSB7XG4gICAgICAvLyBvbmx5IHZhbGlkIG9wcyB0aGF0IHByb2R1Y2UgYW4gYWN0aW9uYWJsZSByZXN1bHRcbiAgICAgIC8vIHRoZSBvcCBtYXkgaGF2ZSBoYXBwZW5kIG9uIGEga2V5cGF0aFxuICAgICAgZXhwYW5kUmVzdWx0T25LZXlQYXRoKHJlc3BvbnNlLCBrZXksIHJlc3VsdCk7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShyZXNwb25zZSk7XG59XG5cbmZ1bmN0aW9uIGpvaW5UYWJsZU5hbWUoY2xhc3NOYW1lLCBrZXkpIHtcbiAgcmV0dXJuIGBfSm9pbjoke2tleX06JHtjbGFzc05hbWV9YDtcbn1cblxuY29uc3QgZmxhdHRlblVwZGF0ZU9wZXJhdG9yc0ZvckNyZWF0ZSA9IG9iamVjdCA9PiB7XG4gIGZvciAoY29uc3Qga2V5IGluIG9iamVjdCkge1xuICAgIGlmIChvYmplY3Rba2V5XSAmJiBvYmplY3Rba2V5XS5fX29wKSB7XG4gICAgICBzd2l0Y2ggKG9iamVjdFtrZXldLl9fb3ApIHtcbiAgICAgIGNhc2UgJ0luY3JlbWVudCc6XG4gICAgICAgIGlmICh0eXBlb2Ygb2JqZWN0W2tleV0uYW1vdW50ICE9PSAnbnVtYmVyJykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdvYmplY3RzIHRvIGFkZCBtdXN0IGJlIGFuIGFycmF5Jyk7XG4gICAgICAgIH1cbiAgICAgICAgb2JqZWN0W2tleV0gPSBvYmplY3Rba2V5XS5hbW91bnQ7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnQWRkJzpcbiAgICAgICAgaWYgKCEob2JqZWN0W2tleV0ub2JqZWN0cyBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdvYmplY3RzIHRvIGFkZCBtdXN0IGJlIGFuIGFycmF5Jyk7XG4gICAgICAgIH1cbiAgICAgICAgb2JqZWN0W2tleV0gPSBvYmplY3Rba2V5XS5vYmplY3RzO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ0FkZFVuaXF1ZSc6XG4gICAgICAgIGlmICghKG9iamVjdFtrZXldLm9iamVjdHMgaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnb2JqZWN0cyB0byBhZGQgbXVzdCBiZSBhbiBhcnJheScpO1xuICAgICAgICB9XG4gICAgICAgIG9iamVjdFtrZXldID0gb2JqZWN0W2tleV0ub2JqZWN0cztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdSZW1vdmUnOlxuICAgICAgICBpZiAoIShvYmplY3Rba2V5XS5vYmplY3RzIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ29iamVjdHMgdG8gYWRkIG11c3QgYmUgYW4gYXJyYXknKTtcbiAgICAgICAgfVxuICAgICAgICBvYmplY3Rba2V5XSA9IFtdXG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnRGVsZXRlJzpcbiAgICAgICAgZGVsZXRlIG9iamVjdFtrZXldO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5DT01NQU5EX1VOQVZBSUxBQkxFLCBgVGhlICR7b2JqZWN0W2tleV0uX19vcH0gb3BlcmF0b3IgaXMgbm90IHN1cHBvcnRlZCB5ZXQuYCk7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmNvbnN0IHRyYW5zZm9ybUF1dGhEYXRhID0gKGNsYXNzTmFtZSwgb2JqZWN0LCBzY2hlbWEpID0+IHtcbiAgaWYgKG9iamVjdC5hdXRoRGF0YSAmJiBjbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBPYmplY3Qua2V5cyhvYmplY3QuYXV0aERhdGEpLmZvckVhY2gocHJvdmlkZXIgPT4ge1xuICAgICAgY29uc3QgcHJvdmlkZXJEYXRhID0gb2JqZWN0LmF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgIGNvbnN0IGZpZWxkTmFtZSA9IGBfYXV0aF9kYXRhXyR7cHJvdmlkZXJ9YDtcbiAgICAgIGlmIChwcm92aWRlckRhdGEgPT0gbnVsbCkge1xuICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHtcbiAgICAgICAgICBfX29wOiAnRGVsZXRlJ1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHByb3ZpZGVyRGF0YTtcbiAgICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdID0geyB0eXBlOiAnT2JqZWN0JyB9XG4gICAgICB9XG4gICAgfSk7XG4gICAgZGVsZXRlIG9iamVjdC5hdXRoRGF0YTtcbiAgfVxufVxuLy8gVHJhbnNmb3JtcyBhIERhdGFiYXNlIGZvcm1hdCBBQ0wgdG8gYSBSRVNUIEFQSSBmb3JtYXQgQUNMXG5jb25zdCB1bnRyYW5zZm9ybU9iamVjdEFDTCA9ICh7X3JwZXJtLCBfd3Blcm0sIC4uLm91dHB1dH0pID0+IHtcbiAgaWYgKF9ycGVybSB8fCBfd3Blcm0pIHtcbiAgICBvdXRwdXQuQUNMID0ge307XG5cbiAgICAoX3JwZXJtIHx8IFtdKS5mb3JFYWNoKGVudHJ5ID0+IHtcbiAgICAgIGlmICghb3V0cHV0LkFDTFtlbnRyeV0pIHtcbiAgICAgICAgb3V0cHV0LkFDTFtlbnRyeV0gPSB7IHJlYWQ6IHRydWUgfTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG91dHB1dC5BQ0xbZW50cnldWydyZWFkJ10gPSB0cnVlO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgKF93cGVybSB8fCBbXSkuZm9yRWFjaChlbnRyeSA9PiB7XG4gICAgICBpZiAoIW91dHB1dC5BQ0xbZW50cnldKSB7XG4gICAgICAgIG91dHB1dC5BQ0xbZW50cnldID0geyB3cml0ZTogdHJ1ZSB9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3V0cHV0LkFDTFtlbnRyeV1bJ3dyaXRlJ10gPSB0cnVlO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG4gIHJldHVybiBvdXRwdXQ7XG59XG5cbi8qKlxuICogV2hlbiBxdWVyeWluZywgdGhlIGZpZWxkTmFtZSBtYXkgYmUgY29tcG91bmQsIGV4dHJhY3QgdGhlIHJvb3QgZmllbGROYW1lXG4gKiAgICAgYHRlbXBlcmF0dXJlLmNlbHNpdXNgIGJlY29tZXMgYHRlbXBlcmF0dXJlYFxuICogQHBhcmFtIHtzdHJpbmd9IGZpZWxkTmFtZSB0aGF0IG1heSBiZSBhIGNvbXBvdW5kIGZpZWxkIG5hbWVcbiAqIEByZXR1cm5zIHtzdHJpbmd9IHRoZSByb290IG5hbWUgb2YgdGhlIGZpZWxkXG4gKi9cbmNvbnN0IGdldFJvb3RGaWVsZE5hbWUgPSAoZmllbGROYW1lOiBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICByZXR1cm4gZmllbGROYW1lLnNwbGl0KCcuJylbMF1cbn1cblxuY29uc3QgcmVsYXRpb25TY2hlbWEgPSB7IGZpZWxkczogeyByZWxhdGVkSWQ6IHsgdHlwZTogJ1N0cmluZycgfSwgb3duaW5nSWQ6IHsgdHlwZTogJ1N0cmluZycgfSB9IH07XG5cbmNsYXNzIERhdGFiYXNlQ29udHJvbGxlciB7XG4gIGFkYXB0ZXI6IFN0b3JhZ2VBZGFwdGVyO1xuICBzY2hlbWFDYWNoZTogYW55O1xuICBzY2hlbWFQcm9taXNlOiA/UHJvbWlzZTxTY2hlbWFDb250cm9sbGVyLlNjaGVtYUNvbnRyb2xsZXI+O1xuXG4gIGNvbnN0cnVjdG9yKGFkYXB0ZXI6IFN0b3JhZ2VBZGFwdGVyLCBzY2hlbWFDYWNoZTogYW55KSB7XG4gICAgdGhpcy5hZGFwdGVyID0gYWRhcHRlcjtcbiAgICB0aGlzLnNjaGVtYUNhY2hlID0gc2NoZW1hQ2FjaGU7XG4gICAgLy8gV2UgZG9uJ3Qgd2FudCBhIG11dGFibGUgdGhpcy5zY2hlbWEsIGJlY2F1c2UgdGhlbiB5b3UgY291bGQgaGF2ZVxuICAgIC8vIG9uZSByZXF1ZXN0IHRoYXQgdXNlcyBkaWZmZXJlbnQgc2NoZW1hcyBmb3IgZGlmZmVyZW50IHBhcnRzIG9mXG4gICAgLy8gaXQuIEluc3RlYWQsIHVzZSBsb2FkU2NoZW1hIHRvIGdldCBhIHNjaGVtYS5cbiAgICB0aGlzLnNjaGVtYVByb21pc2UgPSBudWxsO1xuICB9XG5cbiAgY29sbGVjdGlvbkV4aXN0cyhjbGFzc05hbWU6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuY2xhc3NFeGlzdHMoY2xhc3NOYW1lKTtcbiAgfVxuXG4gIHB1cmdlQ29sbGVjdGlvbihjbGFzc05hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiB0aGlzLmxvYWRTY2hlbWEoKVxuICAgICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiBzY2hlbWFDb250cm9sbGVyLmdldE9uZVNjaGVtYShjbGFzc05hbWUpKVxuICAgICAgLnRoZW4oc2NoZW1hID0+IHRoaXMuYWRhcHRlci5kZWxldGVPYmplY3RzQnlRdWVyeShjbGFzc05hbWUsIHNjaGVtYSwge30pKTtcbiAgfVxuXG4gIHZhbGlkYXRlQ2xhc3NOYW1lKGNsYXNzTmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFTY2hlbWFDb250cm9sbGVyLmNsYXNzTmFtZUlzVmFsaWQoY2xhc3NOYW1lKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsICdpbnZhbGlkIGNsYXNzTmFtZTogJyArIGNsYXNzTmFtZSkpO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgYSBzY2hlbWFDb250cm9sbGVyLlxuICBsb2FkU2NoZW1hKG9wdGlvbnM6IExvYWRTY2hlbWFPcHRpb25zID0ge2NsZWFyQ2FjaGU6IGZhbHNlfSk6IFByb21pc2U8U2NoZW1hQ29udHJvbGxlci5TY2hlbWFDb250cm9sbGVyPiB7XG4gICAgaWYgKHRoaXMuc2NoZW1hUHJvbWlzZSAhPSBudWxsKSB7XG4gICAgICByZXR1cm4gdGhpcy5zY2hlbWFQcm9taXNlO1xuICAgIH1cbiAgICB0aGlzLnNjaGVtYVByb21pc2UgPSBTY2hlbWFDb250cm9sbGVyLmxvYWQodGhpcy5hZGFwdGVyLCB0aGlzLnNjaGVtYUNhY2hlLCBvcHRpb25zKTtcbiAgICB0aGlzLnNjaGVtYVByb21pc2UudGhlbigoKSA9PiBkZWxldGUgdGhpcy5zY2hlbWFQcm9taXNlLFxuICAgICAgKCkgPT4gZGVsZXRlIHRoaXMuc2NoZW1hUHJvbWlzZSk7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYShvcHRpb25zKTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIGZvciB0aGUgY2xhc3NuYW1lIHRoYXQgaXMgcmVsYXRlZCB0byB0aGUgZ2l2ZW5cbiAgLy8gY2xhc3NuYW1lIHRocm91Z2ggdGhlIGtleS5cbiAgLy8gVE9ETzogbWFrZSB0aGlzIG5vdCBpbiB0aGUgRGF0YWJhc2VDb250cm9sbGVyIGludGVyZmFjZVxuICByZWRpcmVjdENsYXNzTmFtZUZvcktleShjbGFzc05hbWU6IHN0cmluZywga2V5OiBzdHJpbmcpOiBQcm9taXNlPD9zdHJpbmc+IHtcbiAgICByZXR1cm4gdGhpcy5sb2FkU2NoZW1hKCkudGhlbigoc2NoZW1hKSA9PiB7XG4gICAgICB2YXIgdCAgPSBzY2hlbWEuZ2V0RXhwZWN0ZWRUeXBlKGNsYXNzTmFtZSwga2V5KTtcbiAgICAgIGlmICh0ICE9IG51bGwgJiYgdHlwZW9mIHQgIT09ICdzdHJpbmcnICYmIHQudHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgICByZXR1cm4gdC50YXJnZXRDbGFzcztcbiAgICAgIH1cbiAgICAgIHJldHVybiBjbGFzc05hbWU7XG4gICAgfSk7XG4gIH1cblxuICAvLyBVc2VzIHRoZSBzY2hlbWEgdG8gdmFsaWRhdGUgdGhlIG9iamVjdCAoUkVTVCBBUEkgZm9ybWF0KS5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgbmV3IHNjaGVtYS5cbiAgLy8gVGhpcyBkb2VzIG5vdCB1cGRhdGUgdGhpcy5zY2hlbWEsIGJlY2F1c2UgaW4gYSBzaXR1YXRpb24gbGlrZSBhXG4gIC8vIGJhdGNoIHJlcXVlc3QsIHRoYXQgY291bGQgY29uZnVzZSBvdGhlciB1c2VycyBvZiB0aGUgc2NoZW1hLlxuICB2YWxpZGF0ZU9iamVjdChjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIHF1ZXJ5OiBhbnksIHsgYWNsIH06IFF1ZXJ5T3B0aW9ucyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGxldCBzY2hlbWE7XG4gICAgY29uc3QgaXNNYXN0ZXIgPSBhY2wgPT09IHVuZGVmaW5lZDtcbiAgICB2YXIgYWNsR3JvdXA6IHN0cmluZ1tdICA9IGFjbCB8fCBbXTtcbiAgICByZXR1cm4gdGhpcy5sb2FkU2NoZW1hKCkudGhlbihzID0+IHtcbiAgICAgIHNjaGVtYSA9IHM7XG4gICAgICBpZiAoaXNNYXN0ZXIpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMuY2FuQWRkRmllbGQoc2NoZW1hLCBjbGFzc05hbWUsIG9iamVjdCwgYWNsR3JvdXApO1xuICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHNjaGVtYS52YWxpZGF0ZU9iamVjdChjbGFzc05hbWUsIG9iamVjdCwgcXVlcnkpO1xuICAgIH0pO1xuICB9XG5cbiAgdXBkYXRlKGNsYXNzTmFtZTogc3RyaW5nLCBxdWVyeTogYW55LCB1cGRhdGU6IGFueSwge1xuICAgIGFjbCxcbiAgICBtYW55LFxuICAgIHVwc2VydCxcbiAgfTogRnVsbFF1ZXJ5T3B0aW9ucyA9IHt9LCBza2lwU2FuaXRpemF0aW9uOiBib29sZWFuID0gZmFsc2UpOiBQcm9taXNlPGFueT4ge1xuICAgIGNvbnN0IG9yaWdpbmFsUXVlcnkgPSBxdWVyeTtcbiAgICBjb25zdCBvcmlnaW5hbFVwZGF0ZSA9IHVwZGF0ZTtcbiAgICAvLyBNYWtlIGEgY29weSBvZiB0aGUgb2JqZWN0LCBzbyB3ZSBkb24ndCBtdXRhdGUgdGhlIGluY29taW5nIGRhdGEuXG4gICAgdXBkYXRlID0gZGVlcGNvcHkodXBkYXRlKTtcbiAgICB2YXIgcmVsYXRpb25VcGRhdGVzID0gW107XG4gICAgdmFyIGlzTWFzdGVyID0gYWNsID09PSB1bmRlZmluZWQ7XG4gICAgdmFyIGFjbEdyb3VwID0gYWNsIHx8IFtdO1xuICAgIHJldHVybiB0aGlzLmxvYWRTY2hlbWEoKVxuICAgICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiB7XG4gICAgICAgIHJldHVybiAoaXNNYXN0ZXIgPyBQcm9taXNlLnJlc29sdmUoKSA6IHNjaGVtYUNvbnRyb2xsZXIudmFsaWRhdGVQZXJtaXNzaW9uKGNsYXNzTmFtZSwgYWNsR3JvdXAsICd1cGRhdGUnKSlcbiAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICByZWxhdGlvblVwZGF0ZXMgPSB0aGlzLmNvbGxlY3RSZWxhdGlvblVwZGF0ZXMoY2xhc3NOYW1lLCBvcmlnaW5hbFF1ZXJ5Lm9iamVjdElkLCB1cGRhdGUpO1xuICAgICAgICAgICAgaWYgKCFpc01hc3Rlcikge1xuICAgICAgICAgICAgICBxdWVyeSA9IHRoaXMuYWRkUG9pbnRlclBlcm1pc3Npb25zKHNjaGVtYUNvbnRyb2xsZXIsIGNsYXNzTmFtZSwgJ3VwZGF0ZScsIHF1ZXJ5LCBhY2xHcm91cCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIXF1ZXJ5KSB7XG4gICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChhY2wpIHtcbiAgICAgICAgICAgICAgcXVlcnkgPSBhZGRXcml0ZUFDTChxdWVyeSwgYWNsKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhbGlkYXRlUXVlcnkocXVlcnkpO1xuICAgICAgICAgICAgcmV0dXJuIHNjaGVtYUNvbnRyb2xsZXIuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSwgdHJ1ZSlcbiAgICAgICAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICAgICAgICAvLyBJZiB0aGUgc2NoZW1hIGRvZXNuJ3QgZXhpc3QsIHByZXRlbmQgaXQgZXhpc3RzIHdpdGggbm8gZmllbGRzLiBUaGlzIGJlaGF2aW9yXG4gICAgICAgICAgICAgICAgLy8gd2lsbCBsaWtlbHkgbmVlZCByZXZpc2l0aW5nLlxuICAgICAgICAgICAgICAgIGlmIChlcnJvciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4geyBmaWVsZHM6IHt9IH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAudGhlbihzY2hlbWEgPT4ge1xuICAgICAgICAgICAgICAgIE9iamVjdC5rZXlzKHVwZGF0ZSkuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGZpZWxkTmFtZS5tYXRjaCgvXmF1dGhEYXRhXFwuKFthLXpBLVowLTlfXSspXFwuaWQkLykpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsIGBJbnZhbGlkIGZpZWxkIG5hbWUgZm9yIHVwZGF0ZTogJHtmaWVsZE5hbWV9YCk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBjb25zdCByb290RmllbGROYW1lID0gZ2V0Um9vdEZpZWxkTmFtZShmaWVsZE5hbWUpO1xuICAgICAgICAgICAgICAgICAgaWYgKCFTY2hlbWFDb250cm9sbGVyLmZpZWxkTmFtZUlzVmFsaWQocm9vdEZpZWxkTmFtZSkgJiYgIWlzU3BlY2lhbFVwZGF0ZUtleShyb290RmllbGROYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgYEludmFsaWQgZmllbGQgbmFtZSBmb3IgdXBkYXRlOiAke2ZpZWxkTmFtZX1gKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHVwZGF0ZU9wZXJhdGlvbiBpbiB1cGRhdGUpIHtcbiAgICAgICAgICAgICAgICAgIGlmICh1cGRhdGVbdXBkYXRlT3BlcmF0aW9uXSAmJiB0eXBlb2YgdXBkYXRlW3VwZGF0ZU9wZXJhdGlvbl0gPT09ICdvYmplY3QnICYmIE9iamVjdC5rZXlzKHVwZGF0ZVt1cGRhdGVPcGVyYXRpb25dKS5zb21lKGlubmVyS2V5ID0+IGlubmVyS2V5LmluY2x1ZGVzKCckJykgfHwgaW5uZXJLZXkuaW5jbHVkZXMoJy4nKSkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfTkVTVEVEX0tFWSwgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdXBkYXRlID0gdHJhbnNmb3JtT2JqZWN0QUNMKHVwZGF0ZSk7XG4gICAgICAgICAgICAgICAgdHJhbnNmb3JtQXV0aERhdGEoY2xhc3NOYW1lLCB1cGRhdGUsIHNjaGVtYSk7XG4gICAgICAgICAgICAgICAgaWYgKG1hbnkpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXIudXBkYXRlT2JqZWN0c0J5UXVlcnkoY2xhc3NOYW1lLCBzY2hlbWEsIHF1ZXJ5LCB1cGRhdGUpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodXBzZXJ0KSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hZGFwdGVyLnVwc2VydE9uZU9iamVjdChjbGFzc05hbWUsIHNjaGVtYSwgcXVlcnksIHVwZGF0ZSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuZmluZE9uZUFuZFVwZGF0ZShjbGFzc05hbWUsIHNjaGVtYSwgcXVlcnksIHVwZGF0ZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnRoZW4oKHJlc3VsdDogYW55KSA9PiB7XG4gICAgICAgICAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ09iamVjdCBub3QgZm91bmQuJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVSZWxhdGlvblVwZGF0ZXMoY2xhc3NOYW1lLCBvcmlnaW5hbFF1ZXJ5Lm9iamVjdElkLCB1cGRhdGUsIHJlbGF0aW9uVXBkYXRlcykudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KS50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgICAgICAgIGlmIChza2lwU2FuaXRpemF0aW9uKSB7XG4gICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBzYW5pdGl6ZURhdGFiYXNlUmVzdWx0KG9yaWdpbmFsVXBkYXRlLCByZXN1bHQpO1xuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBDb2xsZWN0IGFsbCByZWxhdGlvbi11cGRhdGluZyBvcGVyYXRpb25zIGZyb20gYSBSRVNULWZvcm1hdCB1cGRhdGUuXG4gIC8vIFJldHVybnMgYSBsaXN0IG9mIGFsbCByZWxhdGlvbiB1cGRhdGVzIHRvIHBlcmZvcm1cbiAgLy8gVGhpcyBtdXRhdGVzIHVwZGF0ZS5cbiAgY29sbGVjdFJlbGF0aW9uVXBkYXRlcyhjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0SWQ6ID9zdHJpbmcsIHVwZGF0ZTogYW55KSB7XG4gICAgdmFyIG9wcyA9IFtdO1xuICAgIHZhciBkZWxldGVNZSA9IFtdO1xuICAgIG9iamVjdElkID0gdXBkYXRlLm9iamVjdElkIHx8IG9iamVjdElkO1xuXG4gICAgdmFyIHByb2Nlc3MgPSAob3AsIGtleSkgPT4ge1xuICAgICAgaWYgKCFvcCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAob3AuX19vcCA9PSAnQWRkUmVsYXRpb24nKSB7XG4gICAgICAgIG9wcy5wdXNoKHtrZXksIG9wfSk7XG4gICAgICAgIGRlbGV0ZU1lLnB1c2goa2V5KTtcbiAgICAgIH1cblxuICAgICAgaWYgKG9wLl9fb3AgPT0gJ1JlbW92ZVJlbGF0aW9uJykge1xuICAgICAgICBvcHMucHVzaCh7a2V5LCBvcH0pO1xuICAgICAgICBkZWxldGVNZS5wdXNoKGtleSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChvcC5fX29wID09ICdCYXRjaCcpIHtcbiAgICAgICAgZm9yICh2YXIgeCBvZiBvcC5vcHMpIHtcbiAgICAgICAgICBwcm9jZXNzKHgsIGtleSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuXG4gICAgZm9yIChjb25zdCBrZXkgaW4gdXBkYXRlKSB7XG4gICAgICBwcm9jZXNzKHVwZGF0ZVtrZXldLCBrZXkpO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBkZWxldGVNZSkge1xuICAgICAgZGVsZXRlIHVwZGF0ZVtrZXldO1xuICAgIH1cbiAgICByZXR1cm4gb3BzO1xuICB9XG5cbiAgLy8gUHJvY2Vzc2VzIHJlbGF0aW9uLXVwZGF0aW5nIG9wZXJhdGlvbnMgZnJvbSBhIFJFU1QtZm9ybWF0IHVwZGF0ZS5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIGFsbCB1cGRhdGVzIGhhdmUgYmVlbiBwZXJmb3JtZWRcbiAgaGFuZGxlUmVsYXRpb25VcGRhdGVzKGNsYXNzTmFtZTogc3RyaW5nLCBvYmplY3RJZDogc3RyaW5nLCB1cGRhdGU6IGFueSwgb3BzOiBhbnkpIHtcbiAgICB2YXIgcGVuZGluZyA9IFtdO1xuICAgIG9iamVjdElkID0gdXBkYXRlLm9iamVjdElkIHx8IG9iamVjdElkO1xuICAgIG9wcy5mb3JFYWNoKCh7a2V5LCBvcH0pID0+IHtcbiAgICAgIGlmICghb3ApIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKG9wLl9fb3AgPT0gJ0FkZFJlbGF0aW9uJykge1xuICAgICAgICBmb3IgKGNvbnN0IG9iamVjdCBvZiBvcC5vYmplY3RzKSB7XG4gICAgICAgICAgcGVuZGluZy5wdXNoKHRoaXMuYWRkUmVsYXRpb24oa2V5LCBjbGFzc05hbWUsXG4gICAgICAgICAgICBvYmplY3RJZCxcbiAgICAgICAgICAgIG9iamVjdC5vYmplY3RJZCkpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChvcC5fX29wID09ICdSZW1vdmVSZWxhdGlvbicpIHtcbiAgICAgICAgZm9yIChjb25zdCBvYmplY3Qgb2Ygb3Aub2JqZWN0cykge1xuICAgICAgICAgIHBlbmRpbmcucHVzaCh0aGlzLnJlbW92ZVJlbGF0aW9uKGtleSwgY2xhc3NOYW1lLFxuICAgICAgICAgICAgb2JqZWN0SWQsXG4gICAgICAgICAgICBvYmplY3Qub2JqZWN0SWQpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIFByb21pc2UuYWxsKHBlbmRpbmcpO1xuICB9XG5cbiAgLy8gQWRkcyBhIHJlbGF0aW9uLlxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHN1Y2Nlc3NmdWxseSBpZmYgdGhlIGFkZCB3YXMgc3VjY2Vzc2Z1bC5cbiAgYWRkUmVsYXRpb24oa2V5OiBzdHJpbmcsIGZyb21DbGFzc05hbWU6IHN0cmluZywgZnJvbUlkOiBzdHJpbmcsIHRvSWQ6IHN0cmluZykge1xuICAgIGNvbnN0IGRvYyA9IHtcbiAgICAgIHJlbGF0ZWRJZDogdG9JZCxcbiAgICAgIG93bmluZ0lkOiBmcm9tSWRcbiAgICB9O1xuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIudXBzZXJ0T25lT2JqZWN0KGBfSm9pbjoke2tleX06JHtmcm9tQ2xhc3NOYW1lfWAsIHJlbGF0aW9uU2NoZW1hLCBkb2MsIGRvYyk7XG4gIH1cblxuICAvLyBSZW1vdmVzIGEgcmVsYXRpb24uXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgc3VjY2Vzc2Z1bGx5IGlmZiB0aGUgcmVtb3ZlIHdhc1xuICAvLyBzdWNjZXNzZnVsLlxuICByZW1vdmVSZWxhdGlvbihrZXk6IHN0cmluZywgZnJvbUNsYXNzTmFtZTogc3RyaW5nLCBmcm9tSWQ6IHN0cmluZywgdG9JZDogc3RyaW5nKSB7XG4gICAgdmFyIGRvYyA9IHtcbiAgICAgIHJlbGF0ZWRJZDogdG9JZCxcbiAgICAgIG93bmluZ0lkOiBmcm9tSWRcbiAgICB9O1xuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuZGVsZXRlT2JqZWN0c0J5UXVlcnkoYF9Kb2luOiR7a2V5fToke2Zyb21DbGFzc05hbWV9YCwgcmVsYXRpb25TY2hlbWEsIGRvYylcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIC8vIFdlIGRvbid0IGNhcmUgaWYgdGhleSB0cnkgdG8gZGVsZXRlIGEgbm9uLWV4aXN0ZW50IHJlbGF0aW9uLlxuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PSBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5EKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBSZW1vdmVzIG9iamVjdHMgbWF0Y2hlcyB0aGlzIHF1ZXJ5IGZyb20gdGhlIGRhdGFiYXNlLlxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHN1Y2Nlc3NmdWxseSBpZmYgdGhlIG9iamVjdCB3YXNcbiAgLy8gZGVsZXRlZC5cbiAgLy8gT3B0aW9uczpcbiAgLy8gICBhY2w6ICBhIGxpc3Qgb2Ygc3RyaW5ncy4gSWYgdGhlIG9iamVjdCB0byBiZSB1cGRhdGVkIGhhcyBhbiBBQ0wsXG4gIC8vICAgICAgICAgb25lIG9mIHRoZSBwcm92aWRlZCBzdHJpbmdzIG11c3QgcHJvdmlkZSB0aGUgY2FsbGVyIHdpdGhcbiAgLy8gICAgICAgICB3cml0ZSBwZXJtaXNzaW9ucy5cbiAgZGVzdHJveShjbGFzc05hbWU6IHN0cmluZywgcXVlcnk6IGFueSwgeyBhY2wgfTogUXVlcnlPcHRpb25zID0ge30pOiBQcm9taXNlPGFueT4ge1xuICAgIGNvbnN0IGlzTWFzdGVyID0gYWNsID09PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgYWNsR3JvdXAgPSBhY2wgfHwgW107XG5cbiAgICByZXR1cm4gdGhpcy5sb2FkU2NoZW1hKClcbiAgICAgIC50aGVuKHNjaGVtYUNvbnRyb2xsZXIgPT4ge1xuICAgICAgICByZXR1cm4gKGlzTWFzdGVyID8gUHJvbWlzZS5yZXNvbHZlKCkgOiBzY2hlbWFDb250cm9sbGVyLnZhbGlkYXRlUGVybWlzc2lvbihjbGFzc05hbWUsIGFjbEdyb3VwLCAnZGVsZXRlJykpXG4gICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgaWYgKCFpc01hc3Rlcikge1xuICAgICAgICAgICAgICBxdWVyeSA9IHRoaXMuYWRkUG9pbnRlclBlcm1pc3Npb25zKHNjaGVtYUNvbnRyb2xsZXIsIGNsYXNzTmFtZSwgJ2RlbGV0ZScsIHF1ZXJ5LCBhY2xHcm91cCk7XG4gICAgICAgICAgICAgIGlmICghcXVlcnkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ09iamVjdCBub3QgZm91bmQuJyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGRlbGV0ZSBieSBxdWVyeVxuICAgICAgICAgICAgaWYgKGFjbCkge1xuICAgICAgICAgICAgICBxdWVyeSA9IGFkZFdyaXRlQUNMKHF1ZXJ5LCBhY2wpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFsaWRhdGVRdWVyeShxdWVyeSk7XG4gICAgICAgICAgICByZXR1cm4gc2NoZW1hQ29udHJvbGxlci5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lKVxuICAgICAgICAgICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgICAgICAvLyBJZiB0aGUgc2NoZW1hIGRvZXNuJ3QgZXhpc3QsIHByZXRlbmQgaXQgZXhpc3RzIHdpdGggbm8gZmllbGRzLiBUaGlzIGJlaGF2aW9yXG4gICAgICAgICAgICAgIC8vIHdpbGwgbGlrZWx5IG5lZWQgcmV2aXNpdGluZy5cbiAgICAgICAgICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgZmllbGRzOiB7fSB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgLnRoZW4ocGFyc2VGb3JtYXRTY2hlbWEgPT4gdGhpcy5hZGFwdGVyLmRlbGV0ZU9iamVjdHNCeVF1ZXJ5KGNsYXNzTmFtZSwgcGFyc2VGb3JtYXRTY2hlbWEsIHF1ZXJ5KSlcbiAgICAgICAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICAgICAgLy8gV2hlbiBkZWxldGluZyBzZXNzaW9ucyB3aGlsZSBjaGFuZ2luZyBwYXNzd29yZHMsIGRvbid0IHRocm93IGFuIGVycm9yIGlmIHRoZXkgZG9uJ3QgaGF2ZSBhbnkgc2Vzc2lvbnMuXG4gICAgICAgICAgICAgICAgaWYgKGNsYXNzTmFtZSA9PT0gXCJfU2Vzc2lvblwiICYmIGVycm9yLmNvZGUgPT09IFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe30pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIEluc2VydHMgYW4gb2JqZWN0IGludG8gdGhlIGRhdGFiYXNlLlxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHN1Y2Nlc3NmdWxseSBpZmYgdGhlIG9iamVjdCBzYXZlZC5cbiAgY3JlYXRlKGNsYXNzTmFtZTogc3RyaW5nLCBvYmplY3Q6IGFueSwgeyBhY2wgfTogUXVlcnlPcHRpb25zID0ge30pOiBQcm9taXNlPGFueT4ge1xuICAvLyBNYWtlIGEgY29weSBvZiB0aGUgb2JqZWN0LCBzbyB3ZSBkb24ndCBtdXRhdGUgdGhlIGluY29taW5nIGRhdGEuXG4gICAgY29uc3Qgb3JpZ2luYWxPYmplY3QgPSBvYmplY3Q7XG4gICAgb2JqZWN0ID0gdHJhbnNmb3JtT2JqZWN0QUNMKG9iamVjdCk7XG5cbiAgICBvYmplY3QuY3JlYXRlZEF0ID0geyBpc286IG9iamVjdC5jcmVhdGVkQXQsIF9fdHlwZTogJ0RhdGUnIH07XG4gICAgb2JqZWN0LnVwZGF0ZWRBdCA9IHsgaXNvOiBvYmplY3QudXBkYXRlZEF0LCBfX3R5cGU6ICdEYXRlJyB9O1xuXG4gICAgdmFyIGlzTWFzdGVyID0gYWNsID09PSB1bmRlZmluZWQ7XG4gICAgdmFyIGFjbEdyb3VwID0gYWNsIHx8IFtdO1xuICAgIGNvbnN0IHJlbGF0aW9uVXBkYXRlcyA9IHRoaXMuY29sbGVjdFJlbGF0aW9uVXBkYXRlcyhjbGFzc05hbWUsIG51bGwsIG9iamVjdCk7XG4gICAgcmV0dXJuIHRoaXMudmFsaWRhdGVDbGFzc05hbWUoY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5sb2FkU2NoZW1hKCkpXG4gICAgICAudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHtcbiAgICAgICAgcmV0dXJuIChpc01hc3RlciA/IFByb21pc2UucmVzb2x2ZSgpIDogc2NoZW1hQ29udHJvbGxlci52YWxpZGF0ZVBlcm1pc3Npb24oY2xhc3NOYW1lLCBhY2xHcm91cCwgJ2NyZWF0ZScpKVxuICAgICAgICAgIC50aGVuKCgpID0+IHNjaGVtYUNvbnRyb2xsZXIuZW5mb3JjZUNsYXNzRXhpc3RzKGNsYXNzTmFtZSkpXG4gICAgICAgICAgLnRoZW4oKCkgPT4gc2NoZW1hQ29udHJvbGxlci5yZWxvYWREYXRhKCkpXG4gICAgICAgICAgLnRoZW4oKCkgPT4gc2NoZW1hQ29udHJvbGxlci5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCB0cnVlKSlcbiAgICAgICAgICAudGhlbihzY2hlbWEgPT4ge1xuICAgICAgICAgICAgdHJhbnNmb3JtQXV0aERhdGEoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSk7XG4gICAgICAgICAgICBmbGF0dGVuVXBkYXRlT3BlcmF0b3JzRm9yQ3JlYXRlKG9iamVjdCk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmNyZWF0ZU9iamVjdChjbGFzc05hbWUsIFNjaGVtYUNvbnRyb2xsZXIuY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYShzY2hlbWEpLCBvYmplY3QpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZVJlbGF0aW9uVXBkYXRlcyhjbGFzc05hbWUsIG9iamVjdC5vYmplY3RJZCwgb2JqZWN0LCByZWxhdGlvblVwZGF0ZXMpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICByZXR1cm4gc2FuaXRpemVEYXRhYmFzZVJlc3VsdChvcmlnaW5hbE9iamVjdCwgcmVzdWx0Lm9wc1swXSlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgfSlcbiAgfVxuXG4gIGNhbkFkZEZpZWxkKHNjaGVtYTogU2NoZW1hQ29udHJvbGxlci5TY2hlbWFDb250cm9sbGVyLCBjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIGFjbEdyb3VwOiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNsYXNzU2NoZW1hID0gc2NoZW1hLmRhdGFbY2xhc3NOYW1lXTtcbiAgICBpZiAoIWNsYXNzU2NoZW1hKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuICAgIGNvbnN0IGZpZWxkcyA9IE9iamVjdC5rZXlzKG9iamVjdCk7XG4gICAgY29uc3Qgc2NoZW1hRmllbGRzID0gT2JqZWN0LmtleXMoY2xhc3NTY2hlbWEpO1xuICAgIGNvbnN0IG5ld0tleXMgPSBmaWVsZHMuZmlsdGVyKChmaWVsZCkgPT4ge1xuICAgICAgLy8gU2tpcCBmaWVsZHMgdGhhdCBhcmUgdW5zZXRcbiAgICAgIGlmIChvYmplY3RbZmllbGRdICYmIG9iamVjdFtmaWVsZF0uX19vcCAmJiBvYmplY3RbZmllbGRdLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzY2hlbWFGaWVsZHMuaW5kZXhPZihmaWVsZCkgPCAwO1xuICAgIH0pO1xuICAgIGlmIChuZXdLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBzY2hlbWEudmFsaWRhdGVQZXJtaXNzaW9uKGNsYXNzTmFtZSwgYWNsR3JvdXAsICdhZGRGaWVsZCcpO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICAvLyBXb24ndCBkZWxldGUgY29sbGVjdGlvbnMgaW4gdGhlIHN5c3RlbSBuYW1lc3BhY2VcbiAgLyoqXG4gICAqIERlbGV0ZSBhbGwgY2xhc3NlcyBhbmQgY2xlYXJzIHRoZSBzY2hlbWEgY2FjaGVcbiAgICpcbiAgICogQHBhcmFtIHtib29sZWFufSBmYXN0IHNldCB0byB0cnVlIGlmIGl0J3Mgb2sgdG8ganVzdCBkZWxldGUgcm93cyBhbmQgbm90IGluZGV4ZXNcbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IHdoZW4gdGhlIGRlbGV0aW9ucyBjb21wbGV0ZXNcbiAgICovXG4gIGRlbGV0ZUV2ZXJ5dGhpbmcoZmFzdDogYm9vbGVhbiA9IGZhbHNlKTogUHJvbWlzZTxhbnk+IHtcbiAgICB0aGlzLnNjaGVtYVByb21pc2UgPSBudWxsO1xuICAgIHJldHVybiBQcm9taXNlLmFsbChbXG4gICAgICB0aGlzLmFkYXB0ZXIuZGVsZXRlQWxsQ2xhc3NlcyhmYXN0KSxcbiAgICAgIHRoaXMuc2NoZW1hQ2FjaGUuY2xlYXIoKVxuICAgIF0pO1xuICB9XG5cblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgYSBsaXN0IG9mIHJlbGF0ZWQgaWRzIGdpdmVuIGFuIG93bmluZyBpZC5cbiAgLy8gY2xhc3NOYW1lIGhlcmUgaXMgdGhlIG93bmluZyBjbGFzc05hbWUuXG4gIHJlbGF0ZWRJZHMoY2xhc3NOYW1lOiBzdHJpbmcsIGtleTogc3RyaW5nLCBvd25pbmdJZDogc3RyaW5nLCBxdWVyeU9wdGlvbnM6IFF1ZXJ5T3B0aW9ucyk6IFByb21pc2U8QXJyYXk8c3RyaW5nPj4ge1xuICAgIGNvbnN0IHsgc2tpcCwgbGltaXQsIHNvcnQgfSA9IHF1ZXJ5T3B0aW9ucztcbiAgICBjb25zdCBmaW5kT3B0aW9ucyA9IHt9O1xuICAgIGlmIChzb3J0ICYmIHNvcnQuY3JlYXRlZEF0ICYmIHRoaXMuYWRhcHRlci5jYW5Tb3J0T25Kb2luVGFibGVzKSB7XG4gICAgICBmaW5kT3B0aW9ucy5zb3J0ID0geyAnX2lkJyA6IHNvcnQuY3JlYXRlZEF0IH07XG4gICAgICBmaW5kT3B0aW9ucy5saW1pdCA9IGxpbWl0O1xuICAgICAgZmluZE9wdGlvbnMuc2tpcCA9IHNraXA7XG4gICAgICBxdWVyeU9wdGlvbnMuc2tpcCA9IDA7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuZmluZChqb2luVGFibGVOYW1lKGNsYXNzTmFtZSwga2V5KSwgcmVsYXRpb25TY2hlbWEsIHsgb3duaW5nSWQgfSwgZmluZE9wdGlvbnMpXG4gICAgICAudGhlbihyZXN1bHRzID0+IHJlc3VsdHMubWFwKHJlc3VsdCA9PiByZXN1bHQucmVsYXRlZElkKSk7XG4gIH1cblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgYSBsaXN0IG9mIG93bmluZyBpZHMgZ2l2ZW4gc29tZSByZWxhdGVkIGlkcy5cbiAgLy8gY2xhc3NOYW1lIGhlcmUgaXMgdGhlIG93bmluZyBjbGFzc05hbWUuXG4gIG93bmluZ0lkcyhjbGFzc05hbWU6IHN0cmluZywga2V5OiBzdHJpbmcsIHJlbGF0ZWRJZHM6IHN0cmluZ1tdKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuZmluZChqb2luVGFibGVOYW1lKGNsYXNzTmFtZSwga2V5KSwgcmVsYXRpb25TY2hlbWEsIHsgcmVsYXRlZElkOiB7ICckaW4nOiByZWxhdGVkSWRzIH0gfSwge30pXG4gICAgICAudGhlbihyZXN1bHRzID0+IHJlc3VsdHMubWFwKHJlc3VsdCA9PiByZXN1bHQub3duaW5nSWQpKTtcbiAgfVxuXG4gIC8vIE1vZGlmaWVzIHF1ZXJ5IHNvIHRoYXQgaXQgbm8gbG9uZ2VyIGhhcyAkaW4gb24gcmVsYXRpb24gZmllbGRzLCBvclxuICAvLyBlcXVhbC10by1wb2ludGVyIGNvbnN0cmFpbnRzIG9uIHJlbGF0aW9uIGZpZWxkcy5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHF1ZXJ5IGlzIG11dGF0ZWRcbiAgcmVkdWNlSW5SZWxhdGlvbihjbGFzc05hbWU6IHN0cmluZywgcXVlcnk6IGFueSwgc2NoZW1hOiBhbnkpOiBQcm9taXNlPGFueT4ge1xuICAvLyBTZWFyY2ggZm9yIGFuIGluLXJlbGF0aW9uIG9yIGVxdWFsLXRvLXJlbGF0aW9uXG4gIC8vIE1ha2UgaXQgc2VxdWVudGlhbCBmb3Igbm93LCBub3Qgc3VyZSBvZiBwYXJhbGxlaXphdGlvbiBzaWRlIGVmZmVjdHNcbiAgICBpZiAocXVlcnlbJyRvciddKSB7XG4gICAgICBjb25zdCBvcnMgPSBxdWVyeVsnJG9yJ107XG4gICAgICByZXR1cm4gUHJvbWlzZS5hbGwob3JzLm1hcCgoYVF1ZXJ5LCBpbmRleCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5yZWR1Y2VJblJlbGF0aW9uKGNsYXNzTmFtZSwgYVF1ZXJ5LCBzY2hlbWEpLnRoZW4oKGFRdWVyeSkgPT4ge1xuICAgICAgICAgIHF1ZXJ5Wyckb3InXVtpbmRleF0gPSBhUXVlcnk7XG4gICAgICAgIH0pO1xuICAgICAgfSkpLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHF1ZXJ5KTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHByb21pc2VzID0gT2JqZWN0LmtleXMocXVlcnkpLm1hcCgoa2V5KSA9PiB7XG4gICAgICBjb25zdCB0ID0gc2NoZW1hLmdldEV4cGVjdGVkVHlwZShjbGFzc05hbWUsIGtleSk7XG4gICAgICBpZiAoIXQgfHwgdC50eXBlICE9PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocXVlcnkpO1xuICAgICAgfVxuICAgICAgbGV0IHF1ZXJpZXM6ID9hbnlbXSA9IG51bGw7XG4gICAgICBpZiAocXVlcnlba2V5XSAmJiAocXVlcnlba2V5XVsnJGluJ10gfHwgcXVlcnlba2V5XVsnJG5lJ10gfHwgcXVlcnlba2V5XVsnJG5pbiddIHx8IHF1ZXJ5W2tleV0uX190eXBlID09ICdQb2ludGVyJykpIHtcbiAgICAgIC8vIEJ1aWxkIHRoZSBsaXN0IG9mIHF1ZXJpZXNcbiAgICAgICAgcXVlcmllcyA9IE9iamVjdC5rZXlzKHF1ZXJ5W2tleV0pLm1hcCgoY29uc3RyYWludEtleSkgPT4ge1xuICAgICAgICAgIGxldCByZWxhdGVkSWRzO1xuICAgICAgICAgIGxldCBpc05lZ2F0aW9uID0gZmFsc2U7XG4gICAgICAgICAgaWYgKGNvbnN0cmFpbnRLZXkgPT09ICdvYmplY3RJZCcpIHtcbiAgICAgICAgICAgIHJlbGF0ZWRJZHMgPSBbcXVlcnlba2V5XS5vYmplY3RJZF07XG4gICAgICAgICAgfSBlbHNlIGlmIChjb25zdHJhaW50S2V5ID09ICckaW4nKSB7XG4gICAgICAgICAgICByZWxhdGVkSWRzID0gcXVlcnlba2V5XVsnJGluJ10ubWFwKHIgPT4gci5vYmplY3RJZCk7XG4gICAgICAgICAgfSBlbHNlIGlmIChjb25zdHJhaW50S2V5ID09ICckbmluJykge1xuICAgICAgICAgICAgaXNOZWdhdGlvbiA9IHRydWU7XG4gICAgICAgICAgICByZWxhdGVkSWRzID0gcXVlcnlba2V5XVsnJG5pbiddLm1hcChyID0+IHIub2JqZWN0SWQpO1xuICAgICAgICAgIH0gZWxzZSBpZiAoY29uc3RyYWludEtleSA9PSAnJG5lJykge1xuICAgICAgICAgICAgaXNOZWdhdGlvbiA9IHRydWU7XG4gICAgICAgICAgICByZWxhdGVkSWRzID0gW3F1ZXJ5W2tleV1bJyRuZSddLm9iamVjdElkXTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgaXNOZWdhdGlvbixcbiAgICAgICAgICAgIHJlbGF0ZWRJZHNcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcXVlcmllcyA9IFt7aXNOZWdhdGlvbjogZmFsc2UsIHJlbGF0ZWRJZHM6IFtdfV07XG4gICAgICB9XG5cbiAgICAgIC8vIHJlbW92ZSB0aGUgY3VycmVudCBxdWVyeUtleSBhcyB3ZSBkb24sdCBuZWVkIGl0IGFueW1vcmVcbiAgICAgIGRlbGV0ZSBxdWVyeVtrZXldO1xuICAgICAgLy8gZXhlY3V0ZSBlYWNoIHF1ZXJ5IGluZGVwZW5kZW50bHkgdG8gYnVpbGQgdGhlIGxpc3Qgb2ZcbiAgICAgIC8vICRpbiAvICRuaW5cbiAgICAgIGNvbnN0IHByb21pc2VzID0gcXVlcmllcy5tYXAoKHEpID0+IHtcbiAgICAgICAgaWYgKCFxKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLm93bmluZ0lkcyhjbGFzc05hbWUsIGtleSwgcS5yZWxhdGVkSWRzKS50aGVuKChpZHMpID0+IHtcbiAgICAgICAgICBpZiAocS5pc05lZ2F0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLmFkZE5vdEluT2JqZWN0SWRzSWRzKGlkcywgcXVlcnkpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmFkZEluT2JqZWN0SWRzSWRzKGlkcywgcXVlcnkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcykudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH0pXG5cbiAgICB9KVxuXG4gICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocXVlcnkpO1xuICAgIH0pXG4gIH1cblxuICAvLyBNb2RpZmllcyBxdWVyeSBzbyB0aGF0IGl0IG5vIGxvbmdlciBoYXMgJHJlbGF0ZWRUb1xuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gcXVlcnkgaXMgbXV0YXRlZFxuICByZWR1Y2VSZWxhdGlvbktleXMoY2xhc3NOYW1lOiBzdHJpbmcsIHF1ZXJ5OiBhbnksIHF1ZXJ5T3B0aW9uczogYW55KTogP1Byb21pc2U8dm9pZD4ge1xuXG4gICAgaWYgKHF1ZXJ5Wyckb3InXSkge1xuICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHF1ZXJ5Wyckb3InXS5tYXAoKGFRdWVyeSkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5yZWR1Y2VSZWxhdGlvbktleXMoY2xhc3NOYW1lLCBhUXVlcnksIHF1ZXJ5T3B0aW9ucyk7XG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgdmFyIHJlbGF0ZWRUbyA9IHF1ZXJ5WyckcmVsYXRlZFRvJ107XG4gICAgaWYgKHJlbGF0ZWRUbykge1xuICAgICAgcmV0dXJuIHRoaXMucmVsYXRlZElkcyhcbiAgICAgICAgcmVsYXRlZFRvLm9iamVjdC5jbGFzc05hbWUsXG4gICAgICAgIHJlbGF0ZWRUby5rZXksXG4gICAgICAgIHJlbGF0ZWRUby5vYmplY3Qub2JqZWN0SWQsXG4gICAgICAgIHF1ZXJ5T3B0aW9ucylcbiAgICAgICAgLnRoZW4oKGlkcykgPT4ge1xuICAgICAgICAgIGRlbGV0ZSBxdWVyeVsnJHJlbGF0ZWRUbyddO1xuICAgICAgICAgIHRoaXMuYWRkSW5PYmplY3RJZHNJZHMoaWRzLCBxdWVyeSk7XG4gICAgICAgICAgcmV0dXJuIHRoaXMucmVkdWNlUmVsYXRpb25LZXlzKGNsYXNzTmFtZSwgcXVlcnksIHF1ZXJ5T3B0aW9ucyk7XG4gICAgICAgIH0pLnRoZW4oKCkgPT4ge30pO1xuICAgIH1cbiAgfVxuXG4gIGFkZEluT2JqZWN0SWRzSWRzKGlkczogP0FycmF5PHN0cmluZz4gPSBudWxsLCBxdWVyeTogYW55KSB7XG4gICAgY29uc3QgaWRzRnJvbVN0cmluZzogP0FycmF5PHN0cmluZz4gPSB0eXBlb2YgcXVlcnkub2JqZWN0SWQgPT09ICdzdHJpbmcnID8gW3F1ZXJ5Lm9iamVjdElkXSA6IG51bGw7XG4gICAgY29uc3QgaWRzRnJvbUVxOiA/QXJyYXk8c3RyaW5nPiA9IHF1ZXJ5Lm9iamVjdElkICYmIHF1ZXJ5Lm9iamVjdElkWyckZXEnXSA/IFtxdWVyeS5vYmplY3RJZFsnJGVxJ11dIDogbnVsbDtcbiAgICBjb25zdCBpZHNGcm9tSW46ID9BcnJheTxzdHJpbmc+ID0gcXVlcnkub2JqZWN0SWQgJiYgcXVlcnkub2JqZWN0SWRbJyRpbiddID8gcXVlcnkub2JqZWN0SWRbJyRpbiddIDogbnVsbDtcblxuICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgIGNvbnN0IGFsbElkczogQXJyYXk8QXJyYXk8c3RyaW5nPj4gPSBbaWRzRnJvbVN0cmluZywgaWRzRnJvbUVxLCBpZHNGcm9tSW4sIGlkc10uZmlsdGVyKGxpc3QgPT4gbGlzdCAhPT0gbnVsbCk7XG4gICAgY29uc3QgdG90YWxMZW5ndGggPSBhbGxJZHMucmVkdWNlKChtZW1vLCBsaXN0KSA9PiBtZW1vICsgbGlzdC5sZW5ndGgsIDApO1xuXG4gICAgbGV0IGlkc0ludGVyc2VjdGlvbiA9IFtdO1xuICAgIGlmICh0b3RhbExlbmd0aCA+IDEyNSkge1xuICAgICAgaWRzSW50ZXJzZWN0aW9uID0gaW50ZXJzZWN0LmJpZyhhbGxJZHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZHNJbnRlcnNlY3Rpb24gPSBpbnRlcnNlY3QoYWxsSWRzKTtcbiAgICB9XG5cbiAgICAvLyBOZWVkIHRvIG1ha2Ugc3VyZSB3ZSBkb24ndCBjbG9iYmVyIGV4aXN0aW5nIHNob3J0aGFuZCAkZXEgY29uc3RyYWludHMgb24gb2JqZWN0SWQuXG4gICAgaWYgKCEoJ29iamVjdElkJyBpbiBxdWVyeSkpIHtcbiAgICAgIHF1ZXJ5Lm9iamVjdElkID0ge1xuICAgICAgICAkaW46IHVuZGVmaW5lZCxcbiAgICAgIH07XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcXVlcnkub2JqZWN0SWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICBxdWVyeS5vYmplY3RJZCA9IHtcbiAgICAgICAgJGluOiB1bmRlZmluZWQsXG4gICAgICAgICRlcTogcXVlcnkub2JqZWN0SWRcbiAgICAgIH07XG4gICAgfVxuICAgIHF1ZXJ5Lm9iamVjdElkWyckaW4nXSA9IGlkc0ludGVyc2VjdGlvbjtcblxuICAgIHJldHVybiBxdWVyeTtcbiAgfVxuXG4gIGFkZE5vdEluT2JqZWN0SWRzSWRzKGlkczogc3RyaW5nW10gPSBbXSwgcXVlcnk6IGFueSkge1xuICAgIGNvbnN0IGlkc0Zyb21OaW4gPSBxdWVyeS5vYmplY3RJZCAmJiBxdWVyeS5vYmplY3RJZFsnJG5pbiddID8gcXVlcnkub2JqZWN0SWRbJyRuaW4nXSA6IFtdO1xuICAgIGxldCBhbGxJZHMgPSBbLi4uaWRzRnJvbU5pbiwuLi5pZHNdLmZpbHRlcihsaXN0ID0+IGxpc3QgIT09IG51bGwpO1xuXG4gICAgLy8gbWFrZSBhIHNldCBhbmQgc3ByZWFkIHRvIHJlbW92ZSBkdXBsaWNhdGVzXG4gICAgYWxsSWRzID0gWy4uLm5ldyBTZXQoYWxsSWRzKV07XG5cbiAgICAvLyBOZWVkIHRvIG1ha2Ugc3VyZSB3ZSBkb24ndCBjbG9iYmVyIGV4aXN0aW5nIHNob3J0aGFuZCAkZXEgY29uc3RyYWludHMgb24gb2JqZWN0SWQuXG4gICAgaWYgKCEoJ29iamVjdElkJyBpbiBxdWVyeSkpIHtcbiAgICAgIHF1ZXJ5Lm9iamVjdElkID0ge1xuICAgICAgICAkbmluOiB1bmRlZmluZWQsXG4gICAgICB9O1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHF1ZXJ5Lm9iamVjdElkID09PSAnc3RyaW5nJykge1xuICAgICAgcXVlcnkub2JqZWN0SWQgPSB7XG4gICAgICAgICRuaW46IHVuZGVmaW5lZCxcbiAgICAgICAgJGVxOiBxdWVyeS5vYmplY3RJZFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBxdWVyeS5vYmplY3RJZFsnJG5pbiddID0gYWxsSWRzO1xuICAgIHJldHVybiBxdWVyeTtcbiAgfVxuXG4gIC8vIFJ1bnMgYSBxdWVyeSBvbiB0aGUgZGF0YWJhc2UuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gYSBsaXN0IG9mIGl0ZW1zLlxuICAvLyBPcHRpb25zOlxuICAvLyAgIHNraXAgICAgbnVtYmVyIG9mIHJlc3VsdHMgdG8gc2tpcC5cbiAgLy8gICBsaW1pdCAgIGxpbWl0IHRvIHRoaXMgbnVtYmVyIG9mIHJlc3VsdHMuXG4gIC8vICAgc29ydCAgICBhbiBvYmplY3Qgd2hlcmUga2V5cyBhcmUgdGhlIGZpZWxkcyB0byBzb3J0IGJ5LlxuICAvLyAgICAgICAgICAgdGhlIHZhbHVlIGlzICsxIGZvciBhc2NlbmRpbmcsIC0xIGZvciBkZXNjZW5kaW5nLlxuICAvLyAgIGNvdW50ICAgcnVuIGEgY291bnQgaW5zdGVhZCBvZiByZXR1cm5pbmcgcmVzdWx0cy5cbiAgLy8gICBhY2wgICAgIHJlc3RyaWN0IHRoaXMgb3BlcmF0aW9uIHdpdGggYW4gQUNMIGZvciB0aGUgcHJvdmlkZWQgYXJyYXlcbiAgLy8gICAgICAgICAgIG9mIHVzZXIgb2JqZWN0SWRzIGFuZCByb2xlcy4gYWNsOiBudWxsIG1lYW5zIG5vIHVzZXIuXG4gIC8vICAgICAgICAgICB3aGVuIHRoaXMgZmllbGQgaXMgbm90IHByZXNlbnQsIGRvbid0IGRvIGFueXRoaW5nIHJlZ2FyZGluZyBBQ0xzLlxuICAvLyBUT0RPOiBtYWtlIHVzZXJJZHMgbm90IG5lZWRlZCBoZXJlLiBUaGUgZGIgYWRhcHRlciBzaG91bGRuJ3Qga25vd1xuICAvLyBhbnl0aGluZyBhYm91dCB1c2VycywgaWRlYWxseS4gVGhlbiwgaW1wcm92ZSB0aGUgZm9ybWF0IG9mIHRoZSBBQ0xcbiAgLy8gYXJnIHRvIHdvcmsgbGlrZSB0aGUgb3RoZXJzLlxuICBmaW5kKGNsYXNzTmFtZTogc3RyaW5nLCBxdWVyeTogYW55LCB7XG4gICAgc2tpcCxcbiAgICBsaW1pdCxcbiAgICBhY2wsXG4gICAgc29ydCA9IHt9LFxuICAgIGNvdW50LFxuICAgIGtleXMsXG4gICAgb3AsXG4gICAgZGlzdGluY3QsXG4gICAgcGlwZWxpbmUsXG4gICAgcmVhZFByZWZlcmVuY2UsXG4gICAgaXNXcml0ZSxcbiAgfTogYW55ID0ge30pOiBQcm9taXNlPGFueT4ge1xuICAgIGNvbnN0IGlzTWFzdGVyID0gYWNsID09PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgYWNsR3JvdXAgPSBhY2wgfHwgW107XG4gICAgb3AgPSBvcCB8fCAodHlwZW9mIHF1ZXJ5Lm9iamVjdElkID09ICdzdHJpbmcnICYmIE9iamVjdC5rZXlzKHF1ZXJ5KS5sZW5ndGggPT09IDEgPyAnZ2V0JyA6ICdmaW5kJyk7XG4gICAgLy8gQ291bnQgb3BlcmF0aW9uIGlmIGNvdW50aW5nXG4gICAgb3AgPSAoY291bnQgPT09IHRydWUgPyAnY291bnQnIDogb3ApO1xuXG4gICAgbGV0IGNsYXNzRXhpc3RzID0gdHJ1ZTtcbiAgICByZXR1cm4gdGhpcy5sb2FkU2NoZW1hKClcbiAgICAgIC50aGVuKHNjaGVtYUNvbnRyb2xsZXIgPT4ge1xuICAgICAgICAvL0FsbG93IHZvbGF0aWxlIGNsYXNzZXMgaWYgcXVlcnlpbmcgd2l0aCBNYXN0ZXIgKGZvciBfUHVzaFN0YXR1cylcbiAgICAgICAgLy9UT0RPOiBNb3ZlIHZvbGF0aWxlIGNsYXNzZXMgY29uY2VwdCBpbnRvIG1vbmdvIGFkYXB0ZXIsIHBvc3RncmVzIGFkYXB0ZXIgc2hvdWxkbid0IGNhcmVcbiAgICAgICAgLy90aGF0IGFwaS5wYXJzZS5jb20gYnJlYWtzIHdoZW4gX1B1c2hTdGF0dXMgZXhpc3RzIGluIG1vbmdvLlxuICAgICAgICByZXR1cm4gc2NoZW1hQ29udHJvbGxlci5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCBpc01hc3RlcilcbiAgICAgICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgIC8vIEJlaGF2aW9yIGZvciBub24tZXhpc3RlbnQgY2xhc3NlcyBpcyBraW5kYSB3ZWlyZCBvbiBQYXJzZS5jb20uIFByb2JhYmx5IGRvZXNuJ3QgbWF0dGVyIHRvbyBtdWNoLlxuICAgICAgICAgIC8vIEZvciBub3csIHByZXRlbmQgdGhlIGNsYXNzIGV4aXN0cyBidXQgaGFzIG5vIG9iamVjdHMsXG4gICAgICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICBjbGFzc0V4aXN0cyA9IGZhbHNlO1xuICAgICAgICAgICAgICByZXR1cm4geyBmaWVsZHM6IHt9IH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICAgICAgLy8gUGFyc2UuY29tIHRyZWF0cyBxdWVyaWVzIG9uIF9jcmVhdGVkX2F0IGFuZCBfdXBkYXRlZF9hdCBhcyBpZiB0aGV5IHdlcmUgcXVlcmllcyBvbiBjcmVhdGVkQXQgYW5kIHVwZGF0ZWRBdCxcbiAgICAgICAgICAvLyBzbyBkdXBsaWNhdGUgdGhhdCBiZWhhdmlvciBoZXJlLiBJZiBib3RoIGFyZSBzcGVjaWZpZWQsIHRoZSBjb3JyZWN0IGJlaGF2aW9yIHRvIG1hdGNoIFBhcnNlLmNvbSBpcyB0b1xuICAgICAgICAgIC8vIHVzZSB0aGUgb25lIHRoYXQgYXBwZWFycyBmaXJzdCBpbiB0aGUgc29ydCBsaXN0LlxuICAgICAgICAgICAgaWYgKHNvcnQuX2NyZWF0ZWRfYXQpIHtcbiAgICAgICAgICAgICAgc29ydC5jcmVhdGVkQXQgPSBzb3J0Ll9jcmVhdGVkX2F0O1xuICAgICAgICAgICAgICBkZWxldGUgc29ydC5fY3JlYXRlZF9hdDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChzb3J0Ll91cGRhdGVkX2F0KSB7XG4gICAgICAgICAgICAgIHNvcnQudXBkYXRlZEF0ID0gc29ydC5fdXBkYXRlZF9hdDtcbiAgICAgICAgICAgICAgZGVsZXRlIHNvcnQuX3VwZGF0ZWRfYXQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBxdWVyeU9wdGlvbnMgPSB7IHNraXAsIGxpbWl0LCBzb3J0LCBrZXlzLCByZWFkUHJlZmVyZW5jZSB9O1xuICAgICAgICAgICAgT2JqZWN0LmtleXMoc29ydCkuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgICAgICBpZiAoZmllbGROYW1lLm1hdGNoKC9eYXV0aERhdGFcXC4oW2EtekEtWjAtOV9dKylcXC5pZCQvKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCBgQ2Fubm90IHNvcnQgYnkgJHtmaWVsZE5hbWV9YCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgY29uc3Qgcm9vdEZpZWxkTmFtZSA9IGdldFJvb3RGaWVsZE5hbWUoZmllbGROYW1lKTtcbiAgICAgICAgICAgICAgaWYgKCFTY2hlbWFDb250cm9sbGVyLmZpZWxkTmFtZUlzVmFsaWQocm9vdEZpZWxkTmFtZSkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgYEludmFsaWQgZmllbGQgbmFtZTogJHtmaWVsZE5hbWV9LmApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiAoaXNNYXN0ZXIgPyBQcm9taXNlLnJlc29sdmUoKSA6IHNjaGVtYUNvbnRyb2xsZXIudmFsaWRhdGVQZXJtaXNzaW9uKGNsYXNzTmFtZSwgYWNsR3JvdXAsIG9wKSlcbiAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWR1Y2VSZWxhdGlvbktleXMoY2xhc3NOYW1lLCBxdWVyeSwgcXVlcnlPcHRpb25zKSlcbiAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWR1Y2VJblJlbGF0aW9uKGNsYXNzTmFtZSwgcXVlcnksIHNjaGVtYUNvbnRyb2xsZXIpKVxuICAgICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFpc01hc3Rlcikge1xuICAgICAgICAgICAgICAgICAgcXVlcnkgPSB0aGlzLmFkZFBvaW50ZXJQZXJtaXNzaW9ucyhzY2hlbWFDb250cm9sbGVyLCBjbGFzc05hbWUsIG9wLCBxdWVyeSwgYWNsR3JvdXApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoIXF1ZXJ5KSB7XG4gICAgICAgICAgICAgICAgICBpZiAob3AgPT0gJ2dldCcpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdPYmplY3Qgbm90IGZvdW5kLicpO1xuICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoIWlzTWFzdGVyKSB7XG4gICAgICAgICAgICAgICAgICBpZiAoaXNXcml0ZSkge1xuICAgICAgICAgICAgICAgICAgICBxdWVyeSA9IGFkZFdyaXRlQUNMKHF1ZXJ5LCBhY2xHcm91cCk7XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBxdWVyeSA9IGFkZFJlYWRBQ0wocXVlcnksIGFjbEdyb3VwKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdmFsaWRhdGVRdWVyeShxdWVyeSk7XG4gICAgICAgICAgICAgICAgaWYgKGNvdW50KSB7XG4gICAgICAgICAgICAgICAgICBpZiAoIWNsYXNzRXhpc3RzKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAwO1xuICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci5jb3VudChjbGFzc05hbWUsIHNjaGVtYSwgcXVlcnksIHJlYWRQcmVmZXJlbmNlKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9ICBlbHNlIGlmIChkaXN0aW5jdCkge1xuICAgICAgICAgICAgICAgICAgaWYgKCFjbGFzc0V4aXN0cykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmRpc3RpbmN0KGNsYXNzTmFtZSwgc2NoZW1hLCBxdWVyeSwgZGlzdGluY3QpO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gIGVsc2UgaWYgKHBpcGVsaW5lKSB7XG4gICAgICAgICAgICAgICAgICBpZiAoIWNsYXNzRXhpc3RzKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuYWdncmVnYXRlKGNsYXNzTmFtZSwgc2NoZW1hLCBwaXBlbGluZSwgcmVhZFByZWZlcmVuY2UpO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmZpbmQoY2xhc3NOYW1lLCBzY2hlbWEsIHF1ZXJ5LCBxdWVyeU9wdGlvbnMpXG4gICAgICAgICAgICAgICAgICAgIC50aGVuKG9iamVjdHMgPT4gb2JqZWN0cy5tYXAob2JqZWN0ID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICBvYmplY3QgPSB1bnRyYW5zZm9ybU9iamVjdEFDTChvYmplY3QpO1xuICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmaWx0ZXJTZW5zaXRpdmVEYXRhKGlzTWFzdGVyLCBhY2xHcm91cCwgY2xhc3NOYW1lLCBvYmplY3QpXG4gICAgICAgICAgICAgICAgICAgIH0pKS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5URVJOQUxfU0VSVkVSX0VSUk9SLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIGRlbGV0ZVNjaGVtYShjbGFzc05hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiB0aGlzLmxvYWRTY2hlbWEoeyBjbGVhckNhY2hlOiB0cnVlIH0pXG4gICAgICAudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHNjaGVtYUNvbnRyb2xsZXIuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSwgdHJ1ZSkpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHJldHVybiB7IGZpZWxkczoge30gfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC50aGVuKChzY2hlbWE6IGFueSkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5jb2xsZWN0aW9uRXhpc3RzKGNsYXNzTmFtZSlcbiAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLmFkYXB0ZXIuY291bnQoY2xhc3NOYW1lLCB7IGZpZWxkczoge30gfSkpXG4gICAgICAgICAgLnRoZW4oY291bnQgPT4ge1xuICAgICAgICAgICAgaWYgKGNvdW50ID4gMCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMjU1LCBgQ2xhc3MgJHtjbGFzc05hbWV9IGlzIG5vdCBlbXB0eSwgY29udGFpbnMgJHtjb3VudH0gb2JqZWN0cywgY2Fubm90IGRyb3Agc2NoZW1hLmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci5kZWxldGVDbGFzcyhjbGFzc05hbWUpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnRoZW4od2FzUGFyc2VDb2xsZWN0aW9uID0+IHtcbiAgICAgICAgICAgIGlmICh3YXNQYXJzZUNvbGxlY3Rpb24pIHtcbiAgICAgICAgICAgICAgY29uc3QgcmVsYXRpb25GaWVsZE5hbWVzID0gT2JqZWN0LmtleXMoc2NoZW1hLmZpZWxkcykuZmlsdGVyKGZpZWxkTmFtZSA9PiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ1JlbGF0aW9uJyk7XG4gICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChyZWxhdGlvbkZpZWxkTmFtZXMubWFwKG5hbWUgPT4gdGhpcy5hZGFwdGVyLmRlbGV0ZUNsYXNzKGpvaW5UYWJsZU5hbWUoY2xhc3NOYW1lLCBuYW1lKSkpKS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgfSlcbiAgfVxuXG4gIGFkZFBvaW50ZXJQZXJtaXNzaW9ucyhzY2hlbWE6IGFueSwgY2xhc3NOYW1lOiBzdHJpbmcsIG9wZXJhdGlvbjogc3RyaW5nLCBxdWVyeTogYW55LCBhY2xHcm91cDogYW55W10gPSBbXSkge1xuICAvLyBDaGVjayBpZiBjbGFzcyBoYXMgcHVibGljIHBlcm1pc3Npb24gZm9yIG9wZXJhdGlvblxuICAvLyBJZiB0aGUgQmFzZUNMUCBwYXNzLCBsZXQgZ28gdGhyb3VnaFxuICAgIGlmIChzY2hlbWEudGVzdEJhc2VDTFAoY2xhc3NOYW1lLCBhY2xHcm91cCwgb3BlcmF0aW9uKSkge1xuICAgICAgcmV0dXJuIHF1ZXJ5O1xuICAgIH1cbiAgICBjb25zdCBwZXJtcyA9IHNjaGVtYS5wZXJtc1tjbGFzc05hbWVdO1xuICAgIGNvbnN0IGZpZWxkID0gWydnZXQnLCAnZmluZCddLmluZGV4T2Yob3BlcmF0aW9uKSA+IC0xID8gJ3JlYWRVc2VyRmllbGRzJyA6ICd3cml0ZVVzZXJGaWVsZHMnO1xuICAgIGNvbnN0IHVzZXJBQ0wgPSBhY2xHcm91cC5maWx0ZXIoKGFjbCkgPT4ge1xuICAgICAgcmV0dXJuIGFjbC5pbmRleE9mKCdyb2xlOicpICE9IDAgJiYgYWNsICE9ICcqJztcbiAgICB9KTtcbiAgICAvLyB0aGUgQUNMIHNob3VsZCBoYXZlIGV4YWN0bHkgMSB1c2VyXG4gICAgaWYgKHBlcm1zICYmIHBlcm1zW2ZpZWxkXSAmJiBwZXJtc1tmaWVsZF0ubGVuZ3RoID4gMCkge1xuICAgIC8vIE5vIHVzZXIgc2V0IHJldHVybiB1bmRlZmluZWRcbiAgICAvLyBJZiB0aGUgbGVuZ3RoIGlzID4gMSwgdGhhdCBtZWFucyB3ZSBkaWRuJ3QgZGUtZHVwZSB1c2VycyBjb3JyZWN0bHlcbiAgICAgIGlmICh1c2VyQUNMLmxlbmd0aCAhPSAxKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHVzZXJJZCA9IHVzZXJBQ0xbMF07XG4gICAgICBjb25zdCB1c2VyUG9pbnRlciA9ICB7XG4gICAgICAgIFwiX190eXBlXCI6IFwiUG9pbnRlclwiLFxuICAgICAgICBcImNsYXNzTmFtZVwiOiBcIl9Vc2VyXCIsXG4gICAgICAgIFwib2JqZWN0SWRcIjogdXNlcklkXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBwZXJtRmllbGRzID0gcGVybXNbZmllbGRdO1xuICAgICAgY29uc3Qgb3JzID0gcGVybUZpZWxkcy5tYXAoKGtleSkgPT4ge1xuICAgICAgICBjb25zdCBxID0ge1xuICAgICAgICAgIFtrZXldOiB1c2VyUG9pbnRlclxuICAgICAgICB9O1xuICAgICAgICAvLyBpZiB3ZSBhbHJlYWR5IGhhdmUgYSBjb25zdHJhaW50IG9uIHRoZSBrZXksIHVzZSB0aGUgJGFuZFxuICAgICAgICBpZiAocXVlcnkuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgIHJldHVybiB7JyRhbmQnOiBbcSwgcXVlcnldfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBvdGhlcndpc2UganVzdCBhZGQgdGhlIGNvbnN0YWludFxuICAgICAgICByZXR1cm4gT2JqZWN0LmFzc2lnbih7fSwgcXVlcnksIHtcbiAgICAgICAgICBbYCR7a2V5fWBdOiB1c2VyUG9pbnRlcixcbiAgICAgICAgfSlcbiAgICAgIH0pO1xuICAgICAgaWYgKG9ycy5sZW5ndGggPiAxKSB7XG4gICAgICAgIHJldHVybiB7JyRvcic6IG9yc307XG4gICAgICB9XG4gICAgICByZXR1cm4gb3JzWzBdO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gcXVlcnk7XG4gICAgfVxuICB9XG5cbiAgLy8gVE9ETzogY3JlYXRlIGluZGV4ZXMgb24gZmlyc3QgY3JlYXRpb24gb2YgYSBfVXNlciBvYmplY3QuIE90aGVyd2lzZSBpdCdzIGltcG9zc2libGUgdG9cbiAgLy8gaGF2ZSBhIFBhcnNlIGFwcCB3aXRob3V0IGl0IGhhdmluZyBhIF9Vc2VyIGNvbGxlY3Rpb24uXG4gIHBlcmZvcm1Jbml0aWFsaXphdGlvbigpIHtcbiAgICBjb25zdCByZXF1aXJlZFVzZXJGaWVsZHMgPSB7IGZpZWxkczogeyAuLi5TY2hlbWFDb250cm9sbGVyLmRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0LCAuLi5TY2hlbWFDb250cm9sbGVyLmRlZmF1bHRDb2x1bW5zLl9Vc2VyIH0gfTtcbiAgICBjb25zdCByZXF1aXJlZFJvbGVGaWVsZHMgPSB7IGZpZWxkczogeyAuLi5TY2hlbWFDb250cm9sbGVyLmRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0LCAuLi5TY2hlbWFDb250cm9sbGVyLmRlZmF1bHRDb2x1bW5zLl9Sb2xlIH0gfTtcblxuICAgIGNvbnN0IHVzZXJDbGFzc1Byb21pc2UgPSB0aGlzLmxvYWRTY2hlbWEoKVxuICAgICAgLnRoZW4oc2NoZW1hID0+IHNjaGVtYS5lbmZvcmNlQ2xhc3NFeGlzdHMoJ19Vc2VyJykpXG4gICAgY29uc3Qgcm9sZUNsYXNzUHJvbWlzZSA9IHRoaXMubG9hZFNjaGVtYSgpXG4gICAgICAudGhlbihzY2hlbWEgPT4gc2NoZW1hLmVuZm9yY2VDbGFzc0V4aXN0cygnX1JvbGUnKSlcblxuICAgIGNvbnN0IHVzZXJuYW1lVW5pcXVlbmVzcyA9IHVzZXJDbGFzc1Byb21pc2VcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuYWRhcHRlci5lbnN1cmVVbmlxdWVuZXNzKCdfVXNlcicsIHJlcXVpcmVkVXNlckZpZWxkcywgWyd1c2VybmFtZSddKSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIHVzZXJuYW1lczogJywgZXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pO1xuXG4gICAgY29uc3QgZW1haWxVbmlxdWVuZXNzID0gdXNlckNsYXNzUHJvbWlzZVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5hZGFwdGVyLmVuc3VyZVVuaXF1ZW5lc3MoJ19Vc2VyJywgcmVxdWlyZWRVc2VyRmllbGRzLCBbJ2VtYWlsJ10pKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ1VuYWJsZSB0byBlbnN1cmUgdW5pcXVlbmVzcyBmb3IgdXNlciBlbWFpbCBhZGRyZXNzZXM6ICcsIGVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcblxuICAgIGNvbnN0IHJvbGVVbmlxdWVuZXNzID0gcm9sZUNsYXNzUHJvbWlzZVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5hZGFwdGVyLmVuc3VyZVVuaXF1ZW5lc3MoJ19Sb2xlJywgcmVxdWlyZWRSb2xlRmllbGRzLCBbJ25hbWUnXSkpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBsb2dnZXIud2FybignVW5hYmxlIHRvIGVuc3VyZSB1bmlxdWVuZXNzIGZvciByb2xlIG5hbWU6ICcsIGVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcblxuICAgIGNvbnN0IGluZGV4UHJvbWlzZSA9IHRoaXMuYWRhcHRlci51cGRhdGVTY2hlbWFXaXRoSW5kZXhlcygpO1xuXG4gICAgLy8gQ3JlYXRlIHRhYmxlcyBmb3Igdm9sYXRpbGUgY2xhc3Nlc1xuICAgIGNvbnN0IGFkYXB0ZXJJbml0ID0gdGhpcy5hZGFwdGVyLnBlcmZvcm1Jbml0aWFsaXphdGlvbih7IFZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXM6IFNjaGVtYUNvbnRyb2xsZXIuVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyB9KTtcbiAgICByZXR1cm4gUHJvbWlzZS5hbGwoW3VzZXJuYW1lVW5pcXVlbmVzcywgZW1haWxVbmlxdWVuZXNzLCByb2xlVW5pcXVlbmVzcywgYWRhcHRlckluaXQsIGluZGV4UHJvbWlzZV0pO1xuICB9XG5cbiAgc3RhdGljIF92YWxpZGF0ZVF1ZXJ5OiAoKGFueSkgPT4gdm9pZClcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBEYXRhYmFzZUNvbnRyb2xsZXI7XG4vLyBFeHBvc2UgdmFsaWRhdGVRdWVyeSBmb3IgdGVzdHNcbm1vZHVsZS5leHBvcnRzLl92YWxpZGF0ZVF1ZXJ5ID0gdmFsaWRhdGVRdWVyeTtcbiJdfQ==