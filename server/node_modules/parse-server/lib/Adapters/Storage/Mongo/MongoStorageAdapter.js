'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MongoStorageAdapter = undefined;

var _MongoCollection = require('./MongoCollection');

var _MongoCollection2 = _interopRequireDefault(_MongoCollection);

var _MongoSchemaCollection = require('./MongoSchemaCollection');

var _MongoSchemaCollection2 = _interopRequireDefault(_MongoSchemaCollection);

var _StorageAdapter = require('../StorageAdapter');

var _mongodbUrl = require('../../../vendor/mongodbUrl');

var _MongoTransform = require('./MongoTransform');

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _defaults = require('../../../defaults');

var _defaults2 = _interopRequireDefault(_defaults);

var _logger = require('../../../logger');

var _logger2 = _interopRequireDefault(_logger);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }
// -disable-next

// -disable-next


// -disable-next
const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;
const ReadPreference = mongodb.ReadPreference;

const MongoSchemaCollectionName = '_SCHEMA';

const storageAdapterAllCollections = mongoAdapter => {
  return mongoAdapter.connect().then(() => mongoAdapter.database.collections()).then(collections => {
    return collections.filter(collection => {
      if (collection.namespace.match(/\.system\./)) {
        return false;
      }
      // TODO: If you have one app with a collection prefix that happens to be a prefix of another
      // apps prefix, this will go very very badly. We should fix that somehow.
      return collection.collectionName.indexOf(mongoAdapter._collectionPrefix) == 0;
    });
  });
};

const convertParseSchemaToMongoSchema = (_ref) => {
  let schema = _objectWithoutProperties(_ref, []);

  delete schema.fields._rperm;
  delete schema.fields._wperm;

  if (schema.className === '_User') {
    // Legacy mongo adapter knows about the difference between password and _hashed_password.
    // Future database adapters will only know about _hashed_password.
    // Note: Parse Server will bring back password with injectDefaultSchema, so we don't need
    // to add _hashed_password back ever.
    delete schema.fields._hashed_password;
  }

  return schema;
};

// Returns { code, error } if invalid, or { result }, an object
// suitable for inserting into _SCHEMA collection, otherwise.
const mongoSchemaFromFieldsAndClassNameAndCLP = (fields, className, classLevelPermissions, indexes) => {
  const mongoObject = {
    _id: className,
    objectId: 'string',
    updatedAt: 'string',
    createdAt: 'string',
    _metadata: undefined
  };

  for (const fieldName in fields) {
    mongoObject[fieldName] = _MongoSchemaCollection2.default.parseFieldTypeToMongoFieldType(fields[fieldName]);
  }

  if (typeof classLevelPermissions !== 'undefined') {
    mongoObject._metadata = mongoObject._metadata || {};
    if (!classLevelPermissions) {
      delete mongoObject._metadata.class_permissions;
    } else {
      mongoObject._metadata.class_permissions = classLevelPermissions;
    }
  }

  if (indexes && typeof indexes === 'object' && Object.keys(indexes).length > 0) {
    mongoObject._metadata = mongoObject._metadata || {};
    mongoObject._metadata.indexes = indexes;
  }

  if (!mongoObject._metadata) {
    // cleanup the unused _metadata
    delete mongoObject._metadata;
  }

  return mongoObject;
};

class MongoStorageAdapter {
  // Private
  constructor({
    uri = _defaults2.default.DefaultMongoURI,
    collectionPrefix = '',
    mongoOptions = {}
  }) {
    this._uri = uri;
    this._collectionPrefix = collectionPrefix;
    this._mongoOptions = mongoOptions;

    // MaxTimeMS is not a global MongoDB client option, it is applied per operation.
    this._maxTimeMS = mongoOptions.maxTimeMS;
    this.canSortOnJoinTables = true;
    delete mongoOptions.maxTimeMS;
  }
  // Public


  connect() {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // parsing and re-formatting causes the auth value (if there) to get URI
    // encoded
    const encodedUri = (0, _mongodbUrl.format)((0, _mongodbUrl.parse)(this._uri));

    this.connectionPromise = MongoClient.connect(encodedUri, this._mongoOptions).then(client => {
      // Starting mongoDB 3.0, the MongoClient.connect don't return a DB anymore but a client
      // Fortunately, we can get back the options and use them to select the proper DB.
      // https://github.com/mongodb/node-mongodb-native/blob/2c35d76f08574225b8db02d7bef687123e6bb018/lib/mongo_client.js#L885
      const options = client.s.options;
      const database = client.db(options.dbName);
      if (!database) {
        delete this.connectionPromise;
        return;
      }
      database.on('error', () => {
        delete this.connectionPromise;
      });
      database.on('close', () => {
        delete this.connectionPromise;
      });
      this.client = client;
      this.database = database;
    }).catch(err => {
      delete this.connectionPromise;
      return Promise.reject(err);
    });

    return this.connectionPromise;
  }

  handleError(error) {
    if (error && error.code === 13) {
      // Unauthorized error
      delete this.client;
      delete this.database;
      delete this.connectionPromise;
      _logger2.default.error('Received unauthorized error', { error: error });
    }
    throw error;
  }

  handleShutdown() {
    if (!this.client) {
      return;
    }
    this.client.close(false);
  }

  _adaptiveCollection(name) {
    return this.connect().then(() => this.database.collection(this._collectionPrefix + name)).then(rawCollection => new _MongoCollection2.default(rawCollection)).catch(err => this.handleError(err));
  }

  _schemaCollection() {
    return this.connect().then(() => this._adaptiveCollection(MongoSchemaCollectionName)).then(collection => new _MongoSchemaCollection2.default(collection));
  }

  classExists(name) {
    return this.connect().then(() => {
      return this.database.listCollections({ name: this._collectionPrefix + name }).toArray();
    }).then(collections => {
      return collections.length > 0;
    }).catch(err => this.handleError(err));
  }

  setClassLevelPermissions(className, CLPs) {
    return this._schemaCollection().then(schemaCollection => schemaCollection.updateSchema(className, {
      $set: { '_metadata.class_permissions': CLPs }
    })).catch(err => this.handleError(err));
  }

  setIndexesWithSchemaFormat(className, submittedIndexes, existingIndexes = {}, fields) {
    if (submittedIndexes === undefined) {
      return Promise.resolve();
    }
    if (Object.keys(existingIndexes).length === 0) {
      existingIndexes = { _id_: { _id: 1 } };
    }
    const deletePromises = [];
    const insertedIndexes = [];
    Object.keys(submittedIndexes).forEach(name => {
      const field = submittedIndexes[name];
      if (existingIndexes[name] && field.__op !== 'Delete') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Index ${name} exists, cannot update.`);
      }
      if (!existingIndexes[name] && field.__op === 'Delete') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Index ${name} does not exist, cannot delete.`);
      }
      if (field.__op === 'Delete') {
        const promise = this.dropIndex(className, name);
        deletePromises.push(promise);
        delete existingIndexes[name];
      } else {
        Object.keys(field).forEach(key => {
          if (!fields.hasOwnProperty(key)) {
            throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Field ${key} does not exist, cannot add index.`);
          }
        });
        existingIndexes[name] = field;
        insertedIndexes.push({
          key: field,
          name
        });
      }
    });
    let insertPromise = Promise.resolve();
    if (insertedIndexes.length > 0) {
      insertPromise = this.createIndexes(className, insertedIndexes);
    }
    return Promise.all(deletePromises).then(() => insertPromise).then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.updateSchema(className, {
      $set: { '_metadata.indexes': existingIndexes }
    })).catch(err => this.handleError(err));
  }

  setIndexesFromMongo(className) {
    return this.getIndexes(className).then(indexes => {
      indexes = indexes.reduce((obj, index) => {
        if (index.key._fts) {
          delete index.key._fts;
          delete index.key._ftsx;
          for (const field in index.weights) {
            index.key[field] = 'text';
          }
        }
        obj[index.name] = index.key;
        return obj;
      }, {});
      return this._schemaCollection().then(schemaCollection => schemaCollection.updateSchema(className, {
        $set: { '_metadata.indexes': indexes }
      }));
    }).catch(err => this.handleError(err)).catch(() => {
      // Ignore if collection not found
      return Promise.resolve();
    });
  }

  createClass(className, schema) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoObject = mongoSchemaFromFieldsAndClassNameAndCLP(schema.fields, className, schema.classLevelPermissions, schema.indexes);
    mongoObject._id = className;
    return this.setIndexesWithSchemaFormat(className, schema.indexes, {}, schema.fields).then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.insertSchema(mongoObject)).catch(err => this.handleError(err));
  }

  addFieldIfNotExists(className, fieldName, type) {
    return this._schemaCollection().then(schemaCollection => schemaCollection.addFieldIfNotExists(className, fieldName, type)).then(() => this.createIndexesIfNeeded(className, fieldName, type)).catch(err => this.handleError(err));
  }

  // Drops a collection. Resolves with true if it was a Parse Schema (eg. _User, Custom, etc.)
  // and resolves with false if it wasn't (eg. a join table). Rejects if deletion was impossible.
  deleteClass(className) {
    return this._adaptiveCollection(className).then(collection => collection.drop()).catch(error => {
      // 'ns not found' means collection was already gone. Ignore deletion attempt.
      if (error.message == 'ns not found') {
        return;
      }
      throw error;
    })
    // We've dropped the collection, now remove the _SCHEMA document
    .then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.findAndDeleteSchema(className)).catch(err => this.handleError(err));
  }

  deleteAllClasses(fast) {
    return storageAdapterAllCollections(this).then(collections => Promise.all(collections.map(collection => fast ? collection.remove({}) : collection.drop())));
  }

  // Remove the column and all the data. For Relations, the _Join collection is handled
  // specially, this function does not delete _Join columns. It should, however, indicate
  // that the relation fields does not exist anymore. In mongo, this means removing it from
  // the _SCHEMA collection.  There should be no actual data in the collection under the same name
  // as the relation column, so it's fine to attempt to delete it. If the fields listed to be
  // deleted do not exist, this function should return successfully anyways. Checking for
  // attempts to delete non-existent fields is the responsibility of Parse Server.

  // Pointer field names are passed for legacy reasons: the original mongo
  // format stored pointer field names differently in the database, and therefore
  // needed to know the type of the field before it could delete it. Future database
  // adapters should ignore the pointerFieldNames argument. All the field names are in
  // fieldNames, they show up additionally in the pointerFieldNames database for use
  // by the mongo adapter, which deals with the legacy mongo format.

  // This function is not obligated to delete fields atomically. It is given the field
  // names in a list so that databases that are capable of deleting fields atomically
  // may do so.

  // Returns a Promise.
  deleteFields(className, schema, fieldNames) {
    const mongoFormatNames = fieldNames.map(fieldName => {
      if (schema.fields[fieldName].type === 'Pointer') {
        return `_p_${fieldName}`;
      } else {
        return fieldName;
      }
    });
    const collectionUpdate = { '$unset': {} };
    mongoFormatNames.forEach(name => {
      collectionUpdate['$unset'][name] = null;
    });

    const schemaUpdate = { '$unset': {} };
    fieldNames.forEach(name => {
      schemaUpdate['$unset'][name] = null;
    });

    return this._adaptiveCollection(className).then(collection => collection.updateMany({}, collectionUpdate)).then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.updateSchema(className, schemaUpdate)).catch(err => this.handleError(err));
  }

  // Return a promise for all schemas known to this adapter, in Parse format. In case the
  // schemas cannot be retrieved, returns a promise that rejects. Requirements for the
  // rejection reason are TBD.
  getAllClasses() {
    return this._schemaCollection().then(schemasCollection => schemasCollection._fetchAllSchemasFrom_SCHEMA()).catch(err => this.handleError(err));
  }

  // Return a promise for the schema with the given name, in Parse format. If
  // this adapter doesn't know about the schema, return a promise that rejects with
  // undefined as the reason.
  getClass(className) {
    return this._schemaCollection().then(schemasCollection => schemasCollection._fetchOneSchemaFrom_SCHEMA(className)).catch(err => this.handleError(err));
  }

  // TODO: As yet not particularly well specified. Creates an object. Maybe shouldn't even need the schema,
  // and should infer from the type. Or maybe does need the schema for validations. Or maybe needs
  // the schema only for the legacy mongo format. We'll figure that out later.
  createObject(className, schema, object) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoObject = (0, _MongoTransform.parseObjectToMongoObjectForCreate)(className, object, schema);
    return this._adaptiveCollection(className).then(collection => collection.insertOne(mongoObject)).catch(error => {
      if (error.code === 11000) {
        // Duplicate value
        const err = new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
        err.underlyingError = error;
        if (error.message) {
          const matches = error.message.match(/index:[\sa-zA-Z0-9_\-\.]+\$?([a-zA-Z_-]+)_1/);
          if (matches && Array.isArray(matches)) {
            err.userInfo = { duplicated_field: matches[1] };
          }
        }
        throw err;
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Remove all objects that match the given Parse Query.
  // If no objects match, reject with OBJECT_NOT_FOUND. If objects are found and deleted, resolve with undefined.
  // If there is some other error, reject with INTERNAL_SERVER_ERROR.
  deleteObjectsByQuery(className, schema, query) {
    schema = convertParseSchemaToMongoSchema(schema);
    return this._adaptiveCollection(className).then(collection => {
      const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
      return collection.deleteMany(mongoWhere);
    }).catch(err => this.handleError(err)).then(({ result }) => {
      if (result.n === 0) {
        throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Object not found.');
      }
      return Promise.resolve();
    }, () => {
      throw new _node2.default.Error(_node2.default.Error.INTERNAL_SERVER_ERROR, 'Database adapter error');
    });
  }

  // Apply the update to all objects that match the given Parse Query.
  updateObjectsByQuery(className, schema, query, update) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoUpdate = (0, _MongoTransform.transformUpdate)(className, update, schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    return this._adaptiveCollection(className).then(collection => collection.updateMany(mongoWhere, mongoUpdate)).catch(err => this.handleError(err));
  }

  // Atomically finds and updates an object based on query.
  // Return value not currently well specified.
  findOneAndUpdate(className, schema, query, update) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoUpdate = (0, _MongoTransform.transformUpdate)(className, update, schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.findAndModify(mongoWhere, [], mongoUpdate, { new: true })).then(result => (0, _MongoTransform.mongoObjectToParseObject)(className, result.value, schema)).catch(error => {
      if (error.code === 11000) {
        throw new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Hopefully we can get rid of this. It's only used for config and hooks.
  upsertOneObject(className, schema, query, update) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoUpdate = (0, _MongoTransform.transformUpdate)(className, update, schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    return this._adaptiveCollection(className).then(collection => collection.upsertOne(mongoWhere, mongoUpdate)).catch(err => this.handleError(err));
  }

  // Executes a find. Accepts: className, query in Parse format, and { skip, limit, sort }.
  find(className, schema, query, { skip, limit, sort, keys, readPreference }) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    const mongoSort = _lodash2.default.mapKeys(sort, (value, fieldName) => (0, _MongoTransform.transformKey)(className, fieldName, schema));
    const mongoKeys = _lodash2.default.reduce(keys, (memo, key) => {
      memo[(0, _MongoTransform.transformKey)(className, key, schema)] = 1;
      return memo;
    }, {});

    readPreference = this._parseReadPreference(readPreference);
    return this.createTextIndexesIfNeeded(className, query, schema).then(() => this._adaptiveCollection(className)).then(collection => collection.find(mongoWhere, {
      skip,
      limit,
      sort: mongoSort,
      keys: mongoKeys,
      maxTimeMS: this._maxTimeMS,
      readPreference
    })).then(objects => objects.map(object => (0, _MongoTransform.mongoObjectToParseObject)(className, object, schema))).catch(err => this.handleError(err));
  }

  // Create a unique index. Unique indexes on nullable fields are not allowed. Since we don't
  // currently know which fields are nullable and which aren't, we ignore that criteria.
  // As such, we shouldn't expose this function to users of parse until we have an out-of-band
  // Way of determining if a field is nullable. Undefined doesn't count against uniqueness,
  // which is why we use sparse indexes.
  ensureUniqueness(className, schema, fieldNames) {
    schema = convertParseSchemaToMongoSchema(schema);
    const indexCreationRequest = {};
    const mongoFieldNames = fieldNames.map(fieldName => (0, _MongoTransform.transformKey)(className, fieldName, schema));
    mongoFieldNames.forEach(fieldName => {
      indexCreationRequest[fieldName] = 1;
    });
    return this._adaptiveCollection(className).then(collection => collection._ensureSparseUniqueIndexInBackground(indexCreationRequest)).catch(error => {
      if (error.code === 11000) {
        throw new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'Tried to ensure field uniqueness for a class that already has duplicates.');
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Used in tests
  _rawFind(className, query) {
    return this._adaptiveCollection(className).then(collection => collection.find(query, {
      maxTimeMS: this._maxTimeMS
    })).catch(err => this.handleError(err));
  }

  // Executes a count.
  count(className, schema, query, readPreference) {
    schema = convertParseSchemaToMongoSchema(schema);
    readPreference = this._parseReadPreference(readPreference);
    return this._adaptiveCollection(className).then(collection => collection.count((0, _MongoTransform.transformWhere)(className, query, schema), {
      maxTimeMS: this._maxTimeMS,
      readPreference
    })).catch(err => this.handleError(err));
  }

  distinct(className, schema, query, fieldName) {
    schema = convertParseSchemaToMongoSchema(schema);
    const isPointerField = schema.fields[fieldName] && schema.fields[fieldName].type === 'Pointer';
    if (isPointerField) {
      fieldName = `_p_${fieldName}`;
    }
    return this._adaptiveCollection(className).then(collection => collection.distinct(fieldName, (0, _MongoTransform.transformWhere)(className, query, schema))).then(objects => {
      objects = objects.filter(obj => obj != null);
      return objects.map(object => {
        if (isPointerField) {
          const field = fieldName.substring(3);
          return (0, _MongoTransform.transformPointerString)(schema, field, object);
        }
        return (0, _MongoTransform.mongoObjectToParseObject)(className, object, schema);
      });
    }).catch(err => this.handleError(err));
  }

  aggregate(className, schema, pipeline, readPreference) {
    let isPointerField = false;
    pipeline = pipeline.map(stage => {
      if (stage.$group) {
        stage.$group = this._parseAggregateGroupArgs(schema, stage.$group);
        if (stage.$group._id && typeof stage.$group._id === 'string' && stage.$group._id.indexOf('$_p_') >= 0) {
          isPointerField = true;
        }
      }
      if (stage.$match) {
        stage.$match = this._parseAggregateArgs(schema, stage.$match);
      }
      if (stage.$project) {
        stage.$project = this._parseAggregateProjectArgs(schema, stage.$project);
      }
      return stage;
    });
    readPreference = this._parseReadPreference(readPreference);
    return this._adaptiveCollection(className).then(collection => collection.aggregate(pipeline, { readPreference, maxTimeMS: this._maxTimeMS })).catch(error => {
      if (error.code === 16006) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, error.message);
      }
      throw error;
    }).then(results => {
      results.forEach(result => {
        if (result.hasOwnProperty('_id')) {
          if (isPointerField && result._id) {
            result._id = result._id.split('$')[1];
          }
          if (result._id == null || _lodash2.default.isEmpty(result._id)) {
            result._id = null;
          }
          result.objectId = result._id;
          delete result._id;
        }
      });
      return results;
    }).then(objects => objects.map(object => (0, _MongoTransform.mongoObjectToParseObject)(className, object, schema))).catch(err => this.handleError(err));
  }

  // This function will recursively traverse the pipeline and convert any Pointer or Date columns.
  // If we detect a pointer column we will rename the column being queried for to match the column
  // in the database. We also modify the value to what we expect the value to be in the database
  // as well.
  // For dates, the driver expects a Date object, but we have a string coming in. So we'll convert
  // the string to a Date so the driver can perform the necessary comparison.
  //
  // The goal of this method is to look for the "leaves" of the pipeline and determine if it needs
  // to be converted. The pipeline can have a few different forms. For more details, see:
  //     https://docs.mongodb.com/manual/reference/operator/aggregation/
  //
  // If the pipeline is an array, it means we are probably parsing an '$and' or '$or' operator. In
  // that case we need to loop through all of it's children to find the columns being operated on.
  // If the pipeline is an object, then we'll loop through the keys checking to see if the key name
  // matches one of the schema columns. If it does match a column and the column is a Pointer or
  // a Date, then we'll convert the value as described above.
  //
  // As much as I hate recursion...this seemed like a good fit for it. We're essentially traversing
  // down a tree to find a "leaf node" and checking to see if it needs to be converted.
  _parseAggregateArgs(schema, pipeline) {
    if (Array.isArray(pipeline)) {
      return pipeline.map(value => this._parseAggregateArgs(schema, value));
    } else if (typeof pipeline === 'object') {
      const returnValue = {};
      for (const field in pipeline) {
        if (schema.fields[field] && schema.fields[field].type === 'Pointer') {
          if (typeof pipeline[field] === 'object') {
            // Pass objects down to MongoDB...this is more than likely an $exists operator.
            returnValue[`_p_${field}`] = pipeline[field];
          } else {
            returnValue[`_p_${field}`] = `${schema.fields[field].targetClass}$${pipeline[field]}`;
          }
        } else if (schema.fields[field] && schema.fields[field].type === 'Date') {
          returnValue[field] = this._convertToDate(pipeline[field]);
        } else {
          returnValue[field] = this._parseAggregateArgs(schema, pipeline[field]);
        }

        if (field === 'objectId') {
          returnValue['_id'] = returnValue[field];
          delete returnValue[field];
        } else if (field === 'createdAt') {
          returnValue['_created_at'] = returnValue[field];
          delete returnValue[field];
        } else if (field === 'updatedAt') {
          returnValue['_updated_at'] = returnValue[field];
          delete returnValue[field];
        }
      }
      return returnValue;
    }
    return pipeline;
  }

  // This function is slightly different than the one above. Rather than trying to combine these
  // two functions and making the code even harder to understand, I decided to split it up. The
  // difference with this function is we are not transforming the values, only the keys of the
  // pipeline.
  _parseAggregateProjectArgs(schema, pipeline) {
    const returnValue = {};
    for (const field in pipeline) {
      if (schema.fields[field] && schema.fields[field].type === 'Pointer') {
        returnValue[`_p_${field}`] = pipeline[field];
      } else {
        returnValue[field] = this._parseAggregateArgs(schema, pipeline[field]);
      }

      if (field === 'objectId') {
        returnValue['_id'] = returnValue[field];
        delete returnValue[field];
      } else if (field === 'createdAt') {
        returnValue['_created_at'] = returnValue[field];
        delete returnValue[field];
      } else if (field === 'updatedAt') {
        returnValue['_updated_at'] = returnValue[field];
        delete returnValue[field];
      }
    }
    return returnValue;
  }

  // This function is slightly different than the two above. MongoDB $group aggregate looks like:
  //     { $group: { _id: <expression>, <field1>: { <accumulator1> : <expression1> }, ... } }
  // The <expression> could be a column name, prefixed with the '$' character. We'll look for
  // these <expression> and check to see if it is a 'Pointer' or if it's one of createdAt,
  // updatedAt or objectId and change it accordingly.
  _parseAggregateGroupArgs(schema, pipeline) {
    if (Array.isArray(pipeline)) {
      return pipeline.map(value => this._parseAggregateGroupArgs(schema, value));
    } else if (typeof pipeline === 'object') {
      const returnValue = {};
      for (const field in pipeline) {
        returnValue[field] = this._parseAggregateGroupArgs(schema, pipeline[field]);
      }
      return returnValue;
    } else if (typeof pipeline === 'string') {
      const field = pipeline.substring(1);
      if (schema.fields[field] && schema.fields[field].type === 'Pointer') {
        return `$_p_${field}`;
      } else if (field == 'createdAt') {
        return '$_created_at';
      } else if (field == 'updatedAt') {
        return '$_updated_at';
      }
    }
    return pipeline;
  }

  // This function will attempt to convert the provided value to a Date object. Since this is part
  // of an aggregation pipeline, the value can either be a string or it can be another object with
  // an operator in it (like $gt, $lt, etc). Because of this I felt it was easier to make this a
  // recursive method to traverse down to the "leaf node" which is going to be the string.
  _convertToDate(value) {
    if (typeof value === 'string') {
      return new Date(value);
    }

    const returnValue = {};
    for (const field in value) {
      returnValue[field] = this._convertToDate(value[field]);
    }
    return returnValue;
  }

  _parseReadPreference(readPreference) {
    switch (readPreference) {
      case 'PRIMARY':
        readPreference = ReadPreference.PRIMARY;
        break;
      case 'PRIMARY_PREFERRED':
        readPreference = ReadPreference.PRIMARY_PREFERRED;
        break;
      case 'SECONDARY':
        readPreference = ReadPreference.SECONDARY;
        break;
      case 'SECONDARY_PREFERRED':
        readPreference = ReadPreference.SECONDARY_PREFERRED;
        break;
      case 'NEAREST':
        readPreference = ReadPreference.NEAREST;
        break;
      case undefined:
        break;
      default:
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, 'Not supported read preference.');
    }
    return readPreference;
  }

  performInitialization() {
    return Promise.resolve();
  }

  createIndex(className, index) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.createIndex(index)).catch(err => this.handleError(err));
  }

  createIndexes(className, indexes) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.createIndexes(indexes)).catch(err => this.handleError(err));
  }

  createIndexesIfNeeded(className, fieldName, type) {
    if (type && type.type === 'Polygon') {
      const index = {
        [fieldName]: '2dsphere'
      };
      return this.createIndex(className, index);
    }
    return Promise.resolve();
  }

  createTextIndexesIfNeeded(className, query, schema) {
    for (const fieldName in query) {
      if (!query[fieldName] || !query[fieldName].$text) {
        continue;
      }
      const existingIndexes = schema.indexes;
      for (const key in existingIndexes) {
        const index = existingIndexes[key];
        if (index.hasOwnProperty(fieldName)) {
          return Promise.resolve();
        }
      }
      const indexName = `${fieldName}_text`;
      const textIndex = {
        [indexName]: { [fieldName]: 'text' }
      };
      return this.setIndexesWithSchemaFormat(className, textIndex, existingIndexes, schema.fields).catch(error => {
        if (error.code === 85) {
          // Index exist with different options
          return this.setIndexesFromMongo(className);
        }
        throw error;
      });
    }
    return Promise.resolve();
  }

  getIndexes(className) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.indexes()).catch(err => this.handleError(err));
  }

  dropIndex(className, index) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.dropIndex(index)).catch(err => this.handleError(err));
  }

  dropAllIndexes(className) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.dropIndexes()).catch(err => this.handleError(err));
  }

  updateSchemaWithIndexes() {
    return this.getAllClasses().then(classes => {
      const promises = classes.map(schema => {
        return this.setIndexesFromMongo(schema.className);
      });
      return Promise.all(promises);
    }).catch(err => this.handleError(err));
  }
}

exports.MongoStorageAdapter = MongoStorageAdapter;
exports.default = MongoStorageAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL01vbmdvL01vbmdvU3RvcmFnZUFkYXB0ZXIuanMiXSwibmFtZXMiOlsibW9uZ29kYiIsInJlcXVpcmUiLCJNb25nb0NsaWVudCIsIlJlYWRQcmVmZXJlbmNlIiwiTW9uZ29TY2hlbWFDb2xsZWN0aW9uTmFtZSIsInN0b3JhZ2VBZGFwdGVyQWxsQ29sbGVjdGlvbnMiLCJtb25nb0FkYXB0ZXIiLCJjb25uZWN0IiwidGhlbiIsImRhdGFiYXNlIiwiY29sbGVjdGlvbnMiLCJmaWx0ZXIiLCJjb2xsZWN0aW9uIiwibmFtZXNwYWNlIiwibWF0Y2giLCJjb2xsZWN0aW9uTmFtZSIsImluZGV4T2YiLCJfY29sbGVjdGlvblByZWZpeCIsImNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEiLCJzY2hlbWEiLCJmaWVsZHMiLCJfcnBlcm0iLCJfd3Blcm0iLCJjbGFzc05hbWUiLCJfaGFzaGVkX3Bhc3N3b3JkIiwibW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lQW5kQ0xQIiwiY2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiaW5kZXhlcyIsIm1vbmdvT2JqZWN0IiwiX2lkIiwib2JqZWN0SWQiLCJ1cGRhdGVkQXQiLCJjcmVhdGVkQXQiLCJfbWV0YWRhdGEiLCJ1bmRlZmluZWQiLCJmaWVsZE5hbWUiLCJNb25nb1NjaGVtYUNvbGxlY3Rpb24iLCJwYXJzZUZpZWxkVHlwZVRvTW9uZ29GaWVsZFR5cGUiLCJjbGFzc19wZXJtaXNzaW9ucyIsIk9iamVjdCIsImtleXMiLCJsZW5ndGgiLCJNb25nb1N0b3JhZ2VBZGFwdGVyIiwiY29uc3RydWN0b3IiLCJ1cmkiLCJkZWZhdWx0cyIsIkRlZmF1bHRNb25nb1VSSSIsImNvbGxlY3Rpb25QcmVmaXgiLCJtb25nb09wdGlvbnMiLCJfdXJpIiwiX21vbmdvT3B0aW9ucyIsIl9tYXhUaW1lTVMiLCJtYXhUaW1lTVMiLCJjYW5Tb3J0T25Kb2luVGFibGVzIiwiY29ubmVjdGlvblByb21pc2UiLCJlbmNvZGVkVXJpIiwiY2xpZW50Iiwib3B0aW9ucyIsInMiLCJkYiIsImRiTmFtZSIsIm9uIiwiY2F0Y2giLCJlcnIiLCJQcm9taXNlIiwicmVqZWN0IiwiaGFuZGxlRXJyb3IiLCJlcnJvciIsImNvZGUiLCJsb2dnZXIiLCJoYW5kbGVTaHV0ZG93biIsImNsb3NlIiwiX2FkYXB0aXZlQ29sbGVjdGlvbiIsIm5hbWUiLCJyYXdDb2xsZWN0aW9uIiwiTW9uZ29Db2xsZWN0aW9uIiwiX3NjaGVtYUNvbGxlY3Rpb24iLCJjbGFzc0V4aXN0cyIsImxpc3RDb2xsZWN0aW9ucyIsInRvQXJyYXkiLCJzZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJDTFBzIiwic2NoZW1hQ29sbGVjdGlvbiIsInVwZGF0ZVNjaGVtYSIsIiRzZXQiLCJzZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdCIsInN1Ym1pdHRlZEluZGV4ZXMiLCJleGlzdGluZ0luZGV4ZXMiLCJyZXNvbHZlIiwiX2lkXyIsImRlbGV0ZVByb21pc2VzIiwiaW5zZXJ0ZWRJbmRleGVzIiwiZm9yRWFjaCIsImZpZWxkIiwiX19vcCIsIlBhcnNlIiwiRXJyb3IiLCJJTlZBTElEX1FVRVJZIiwicHJvbWlzZSIsImRyb3BJbmRleCIsInB1c2giLCJrZXkiLCJoYXNPd25Qcm9wZXJ0eSIsImluc2VydFByb21pc2UiLCJjcmVhdGVJbmRleGVzIiwiYWxsIiwic2V0SW5kZXhlc0Zyb21Nb25nbyIsImdldEluZGV4ZXMiLCJyZWR1Y2UiLCJvYmoiLCJpbmRleCIsIl9mdHMiLCJfZnRzeCIsIndlaWdodHMiLCJjcmVhdGVDbGFzcyIsImluc2VydFNjaGVtYSIsImFkZEZpZWxkSWZOb3RFeGlzdHMiLCJ0eXBlIiwiY3JlYXRlSW5kZXhlc0lmTmVlZGVkIiwiZGVsZXRlQ2xhc3MiLCJkcm9wIiwibWVzc2FnZSIsImZpbmRBbmREZWxldGVTY2hlbWEiLCJkZWxldGVBbGxDbGFzc2VzIiwiZmFzdCIsIm1hcCIsInJlbW92ZSIsImRlbGV0ZUZpZWxkcyIsImZpZWxkTmFtZXMiLCJtb25nb0Zvcm1hdE5hbWVzIiwiY29sbGVjdGlvblVwZGF0ZSIsInNjaGVtYVVwZGF0ZSIsInVwZGF0ZU1hbnkiLCJnZXRBbGxDbGFzc2VzIiwic2NoZW1hc0NvbGxlY3Rpb24iLCJfZmV0Y2hBbGxTY2hlbWFzRnJvbV9TQ0hFTUEiLCJnZXRDbGFzcyIsIl9mZXRjaE9uZVNjaGVtYUZyb21fU0NIRU1BIiwiY3JlYXRlT2JqZWN0Iiwib2JqZWN0IiwiaW5zZXJ0T25lIiwiRFVQTElDQVRFX1ZBTFVFIiwidW5kZXJseWluZ0Vycm9yIiwibWF0Y2hlcyIsIkFycmF5IiwiaXNBcnJheSIsInVzZXJJbmZvIiwiZHVwbGljYXRlZF9maWVsZCIsImRlbGV0ZU9iamVjdHNCeVF1ZXJ5IiwicXVlcnkiLCJtb25nb1doZXJlIiwiZGVsZXRlTWFueSIsInJlc3VsdCIsIm4iLCJPQkpFQ1RfTk9UX0ZPVU5EIiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwidXBkYXRlT2JqZWN0c0J5UXVlcnkiLCJ1cGRhdGUiLCJtb25nb1VwZGF0ZSIsImZpbmRPbmVBbmRVcGRhdGUiLCJfbW9uZ29Db2xsZWN0aW9uIiwiZmluZEFuZE1vZGlmeSIsIm5ldyIsInZhbHVlIiwidXBzZXJ0T25lT2JqZWN0IiwidXBzZXJ0T25lIiwiZmluZCIsInNraXAiLCJsaW1pdCIsInNvcnQiLCJyZWFkUHJlZmVyZW5jZSIsIm1vbmdvU29ydCIsIl8iLCJtYXBLZXlzIiwibW9uZ29LZXlzIiwibWVtbyIsIl9wYXJzZVJlYWRQcmVmZXJlbmNlIiwiY3JlYXRlVGV4dEluZGV4ZXNJZk5lZWRlZCIsIm9iamVjdHMiLCJlbnN1cmVVbmlxdWVuZXNzIiwiaW5kZXhDcmVhdGlvblJlcXVlc3QiLCJtb25nb0ZpZWxkTmFtZXMiLCJfZW5zdXJlU3BhcnNlVW5pcXVlSW5kZXhJbkJhY2tncm91bmQiLCJfcmF3RmluZCIsImNvdW50IiwiZGlzdGluY3QiLCJpc1BvaW50ZXJGaWVsZCIsInN1YnN0cmluZyIsImFnZ3JlZ2F0ZSIsInBpcGVsaW5lIiwic3RhZ2UiLCIkZ3JvdXAiLCJfcGFyc2VBZ2dyZWdhdGVHcm91cEFyZ3MiLCIkbWF0Y2giLCJfcGFyc2VBZ2dyZWdhdGVBcmdzIiwiJHByb2plY3QiLCJfcGFyc2VBZ2dyZWdhdGVQcm9qZWN0QXJncyIsInJlc3VsdHMiLCJzcGxpdCIsImlzRW1wdHkiLCJyZXR1cm5WYWx1ZSIsInRhcmdldENsYXNzIiwiX2NvbnZlcnRUb0RhdGUiLCJEYXRlIiwiUFJJTUFSWSIsIlBSSU1BUllfUFJFRkVSUkVEIiwiU0VDT05EQVJZIiwiU0VDT05EQVJZX1BSRUZFUlJFRCIsIk5FQVJFU1QiLCJwZXJmb3JtSW5pdGlhbGl6YXRpb24iLCJjcmVhdGVJbmRleCIsIiR0ZXh0IiwiaW5kZXhOYW1lIiwidGV4dEluZGV4IiwiZHJvcEFsbEluZGV4ZXMiLCJkcm9wSW5kZXhlcyIsInVwZGF0ZVNjaGVtYVdpdGhJbmRleGVzIiwiY2xhc3NlcyIsInByb21pc2VzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOztBQUtBOztBQUlBOztBQVNBOzs7O0FBRUE7Ozs7QUFDQTs7OztBQUNBOzs7Ozs7O0FBTEE7O0FBRUE7OztBQUtBO0FBQ0EsTUFBTUEsVUFBVUMsUUFBUSxTQUFSLENBQWhCO0FBQ0EsTUFBTUMsY0FBY0YsUUFBUUUsV0FBNUI7QUFDQSxNQUFNQyxpQkFBaUJILFFBQVFHLGNBQS9COztBQUVBLE1BQU1DLDRCQUE0QixTQUFsQzs7QUFFQSxNQUFNQywrQkFBK0JDLGdCQUFnQjtBQUNuRCxTQUFPQSxhQUFhQyxPQUFiLEdBQ0pDLElBREksQ0FDQyxNQUFNRixhQUFhRyxRQUFiLENBQXNCQyxXQUF0QixFQURQLEVBRUpGLElBRkksQ0FFQ0UsZUFBZTtBQUNuQixXQUFPQSxZQUFZQyxNQUFaLENBQW1CQyxjQUFjO0FBQ3RDLFVBQUlBLFdBQVdDLFNBQVgsQ0FBcUJDLEtBQXJCLENBQTJCLFlBQTNCLENBQUosRUFBOEM7QUFDNUMsZUFBTyxLQUFQO0FBQ0Q7QUFDRDtB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QUN2QyxXQUFPLEtBQUt0QyxtQkFBTCxDQUF5QmpELFNBQXpCLEVBQ0pmLElBREksQ0FDQ0ksY0FBY0EsV0FBV29KLGdCQUFYLENBQTRCN0QsU0FBNUIsQ0FBc0NXLEtBQXRDLENBRGYsRUFFSmhELEtBRkksQ0FFRUMsT0FBTyxLQUFLRyxXQUFMLENBQWlCSCxHQUFqQixDQUZULENBQVA7QUFHRDs7QUFFRHVKLGlCQUFlL0wsU0FBZixFQUFrQztBQUNoQyxXQUFPLEtBQUtpRCxtQkFBTCxDQUF5QmpELFNBQXpCLEVBQ0pmLElBREksQ0FDQ0ksY0FBY0EsV0FBV29KLGdCQUFYLENBQTRCdUQsV0FBNUIsRUFEZixFQUVKekosS0FGSSxDQUVFQyxPQUFPLEtBQUtHLFdBQUwsQ0FBaUJILEdBQWpCLENBRlQsQ0FBUDtBQUdEOztBQUVEeUosNEJBQXdDO0FBQ3RDLFdBQU8sS0FBS25GLGFBQUwsR0FDSjdILElBREksQ0FDRWlOLE9BQUQsSUFBYTtBQUNqQixZQUFNQyxXQUFXRCxRQUFRNUYsR0FBUixDQUFhMUcsTUFBRCxJQUFZO0FBQ3ZDLGVBQU8sS0FBS3VGLG1CQUFMLENBQXlCdkYsT0FBT0ksU0FBaEMsQ0FBUDtBQUNELE9BRmdCLENBQWpCO0FBR0EsYUFBT3lDLFFBQVF5QyxHQUFSLENBQVlpSCxRQUFaLENBQVA7QUFDRCxLQU5JLEVBT0o1SixLQVBJLENBT0VDLE9BQU8sS0FBS0csV0FBTCxDQUFpQkgsR0FBakIsQ0FQVCxDQUFQO0FBUUQ7QUF2dEJ3RDs7UUFBOUNyQixtQixHQUFBQSxtQjtrQkEwdEJFQSxtQiIsImZpbGUiOiJNb25nb1N0b3JhZ2VBZGFwdGVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQGZsb3dcbmltcG9ydCBNb25nb0NvbGxlY3Rpb24gICAgICAgZnJvbSAnLi9Nb25nb0NvbGxlY3Rpb24nO1xuaW1wb3J0IE1vbmdvU2NoZW1hQ29sbGVjdGlvbiBmcm9tICcuL01vbmdvU2NoZW1hQ29sbGVjdGlvbic7XG5pbXBvcnQgeyBTdG9yYWdlQWRhcHRlciB9ICAgIGZyb20gJy4uL1N0b3JhZ2VBZGFwdGVyJztcbmltcG9ydCB0eXBlIHsgU2NoZW1hVHlwZSxcbiAgUXVlcnlUeXBlLFxuICBTdG9yYWdlQ2xhc3MsXG4gIFF1ZXJ5T3B0aW9ucyB9IGZyb20gJy4uL1N0b3JhZ2VBZGFwdGVyJztcbmltcG9ydCB7XG4gIHBhcnNlIGFzIHBhcnNlVXJsLFxuICBmb3JtYXQgYXMgZm9ybWF0VXJsLFxufSBmcm9tICcuLi8uLi8uLi92ZW5kb3IvbW9uZ29kYlVybCc7XG5pbXBvcnQge1xuICBwYXJzZU9iamVjdFRvTW9uZ29PYmplY3RGb3JDcmVhdGUsXG4gIG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCxcbiAgdHJhbnNmb3JtS2V5LFxuICB0cmFuc2Zvcm1XaGVyZSxcbiAgdHJhbnNmb3JtVXBkYXRlLFxuICB0cmFuc2Zvcm1Qb2ludGVyU3RyaW5nLFxufSBmcm9tICcuL01vbmdvVHJhbnNmb3JtJztcbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuaW1wb3J0IFBhcnNlICAgICAgICAgICAgICAgICBmcm9tICdwYXJzZS9ub2RlJztcbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuaW1wb3J0IF8gICAgICAgICAgICAgICAgICAgICBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IGRlZmF1bHRzICAgICAgICAgICAgICBmcm9tICcuLi8uLi8uLi9kZWZhdWx0cyc7XG5pbXBvcnQgbG9nZ2VyICAgICAgICAgICAgICAgIGZyb20gJy4uLy4uLy4uL2xvZ2dlcic7XG5cbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuY29uc3QgbW9uZ29kYiA9IHJlcXVpcmUoJ21vbmdvZGInKTtcbmNvbnN0IE1vbmdvQ2xpZW50ID0gbW9uZ29kYi5Nb25nb0NsaWVudDtcbmNvbnN0IFJlYWRQcmVmZXJlbmNlID0gbW9uZ29kYi5SZWFkUHJlZmVyZW5jZTtcblxuY29uc3QgTW9uZ29TY2hlbWFDb2xsZWN0aW9uTmFtZSA9ICdfU0NIRU1BJztcblxuY29uc3Qgc3RvcmFnZUFkYXB0ZXJBbGxDb2xsZWN0aW9ucyA9IG1vbmdvQWRhcHRlciA9PiB7XG4gIHJldHVybiBtb25nb0FkYXB0ZXIuY29ubmVjdCgpXG4gICAgLnRoZW4oKCkgPT4gbW9uZ29BZGFwdGVyLmRhdGFiYXNlLmNvbGxlY3Rpb25zKCkpXG4gICAgLnRoZW4oY29sbGVjdGlvbnMgPT4ge1xuICAgICAgcmV0dXJuIGNvbGxlY3Rpb25zLmZpbHRlcihjb2xsZWN0aW9uID0+IHtcbiAgICAgICAgaWYgKGNvbGxlY3Rpb24ubmFtZXNwYWNlLm1hdGNoKC9cXC5zeXN0ZW1cXC4vKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICAvLyBUT0RPOiBJZiB5b3UgaGF2ZSBvbmUgYXBwIHdpdGggYSBjb2xsZWN0aW9uIHByZWZpeCB0aGF0IGhhcHBlbnMgdG8gYmUgYSBwcmVmaXggb2YgYW5vdGhlclxuICAgICAgICAvLyBhcHBzIHByZWZpeCwgdGhpcyB3aWxsIGdvIHZlcnkgdmVyeSBiYWRseS4gV2Ugc2hvdWxkIGZpeCB0aGF0IHNvbWVob3cuXG4gICAgICAgIHJldHVybiAoY29sbGVjdGlvbi5jb2xsZWN0aW9uTmFtZS5pbmRleE9mKG1vbmdvQWRhcHRlci5fY29sbGVjdGlvblByZWZpeCkgPT0gMCk7XG4gICAgICB9KTtcbiAgICB9KTtcbn1cblxuY29uc3QgY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYSA9ICh7Li4uc2NoZW1hfSkgPT4ge1xuICBkZWxldGUgc2NoZW1hLmZpZWxkcy5fcnBlcm07XG4gIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl93cGVybTtcblxuICBpZiAoc2NoZW1hLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgIC8vIExlZ2FjeSBtb25nbyBhZGFwdGVyIGtub3dzIGFib3V0IHRoZSBkaWZmZXJlbmNlIGJldHdlZW4gcGFzc3dvcmQgYW5kIF9oYXNoZWRfcGFzc3dvcmQuXG4gICAgLy8gRnV0dXJlIGRhdGFiYXNlIGFkYXB0ZXJzIHdpbGwgb25seSBrbm93IGFib3V0IF9oYXNoZWRfcGFzc3dvcmQuXG4gICAgLy8gTm90ZTogUGFyc2UgU2VydmVyIHdpbGwgYnJpbmcgYmFjayBwYXNzd29yZCB3aXRoIGluamVjdERlZmF1bHRTY2hlbWEsIHNvIHdlIGRvbid0IG5lZWRcbiAgICAvLyB0byBhZGQgX2hhc2hlZF9wYXNzd29yZCBiYWNrIGV2ZXIuXG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX2hhc2hlZF9wYXNzd29yZDtcbiAgfVxuXG4gIHJldHVybiBzY2hlbWE7XG59XG5cbi8vIFJldHVybnMgeyBjb2RlLCBlcnJvciB9IGlmIGludmFsaWQsIG9yIHsgcmVzdWx0IH0sIGFuIG9iamVjdFxuLy8gc3VpdGFibGUgZm9yIGluc2VydGluZyBpbnRvIF9TQ0hFTUEgY29sbGVjdGlvbiwgb3RoZXJ3aXNlLlxuY29uc3QgbW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lQW5kQ0xQID0gKGZpZWxkcywgY2xhc3NOYW1lLCBjbGFzc0xldmVsUGVybWlzc2lvbnMsIGluZGV4ZXMpID0+IHtcbiAgY29uc3QgbW9uZ29PYmplY3QgPSB7XG4gICAgX2lkOiBjbGFzc05hbWUsXG4gICAgb2JqZWN0SWQ6ICdzdHJpbmcnLFxuICAgIHVwZGF0ZWRBdDogJ3N0cmluZycsXG4gICAgY3JlYXRlZEF0OiAnc3RyaW5nJyxcbiAgICBfbWV0YWRhdGE6IHVuZGVmaW5lZCxcbiAgfTtcblxuICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBmaWVsZHMpIHtcbiAgICBtb25nb09iamVjdFtmaWVsZE5hbWVdID0gTW9uZ29TY2hlbWFDb2xsZWN0aW9uLnBhcnNlRmllbGRUeXBlVG9Nb25nb0ZpZWxkVHlwZShmaWVsZHNbZmllbGROYW1lXSk7XG4gIH1cblxuICBpZiAodHlwZW9mIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBtb25nb09iamVjdC5fbWV0YWRhdGEgPSBtb25nb09iamVjdC5fbWV0YWRhdGEgfHwge307XG4gICAgaWYgKCFjbGFzc0xldmVsUGVybWlzc2lvbnMpIHtcbiAgICAgIGRlbGV0ZSBtb25nb09iamVjdC5fbWV0YWRhdGEuY2xhc3NfcGVybWlzc2lvbnM7XG4gICAgfSBlbHNlIHtcbiAgICAgIG1vbmdvT2JqZWN0Ll9tZXRhZGF0YS5jbGFzc19wZXJtaXNzaW9ucyA9IGNsYXNzTGV2ZWxQZXJtaXNzaW9ucztcbiAgICB9XG4gIH1cblxuICBpZiAoaW5kZXhlcyAmJiB0eXBlb2YgaW5kZXhlcyA9PT0gJ29iamVjdCcgJiYgT2JqZWN0LmtleXMoaW5kZXhlcykubGVuZ3RoID4gMCkge1xuICAgIG1vbmdvT2JqZWN0Ll9tZXRhZGF0YSA9IG1vbmdvT2JqZWN0Ll9tZXRhZGF0YSB8fCB7fTtcbiAgICBtb25nb09iamVjdC5fbWV0YWRhdGEuaW5kZXhlcyA9IGluZGV4ZXM7XG4gIH1cblxuICBpZiAoIW1vbmdvT2JqZWN0Ll9tZXRhZGF0YSkgeyAvLyBjbGVhbnVwIHRoZSB1bnVzZWQgX21ldGFkYXRhXG4gICAgZGVsZXRlIG1vbmdvT2JqZWN0Ll9tZXRhZGF0YTtcbiAgfVxuXG4gIHJldHVybiBtb25nb09iamVjdDtcbn1cblxuXG5leHBvcnQgY2xhc3MgTW9uZ29TdG9yYWdlQWRhcHRlciBpbXBsZW1lbnRzIFN0b3JhZ2VBZGFwdGVyIHtcbiAgLy8gUHJpdmF0ZVxuICBfdXJpOiBzdHJpbmc7XG4gIF9jb2xsZWN0aW9uUHJlZml4OiBzdHJpbmc7XG4gIF9tb25nb09wdGlvbnM6IE9iamVjdDtcbiAgLy8gUHVibGljXG4gIGNvbm5lY3Rpb25Qcm9taXNlOiBQcm9taXNlPGFueT47XG4gIGRhdGFiYXNlOiBhbnk7XG4gIGNsaWVudDogTW9uZ29DbGllbnQ7XG4gIF9tYXhUaW1lTVM6ID9udW1iZXI7XG4gIGNhblNvcnRPbkpvaW5UYWJsZXM6IGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3Ioe1xuICAgIHVyaSA9IGRlZmF1bHRzLkRlZmF1bHRNb25nb1VSSSxcbiAgICBjb2xsZWN0aW9uUHJlZml4ID0gJycsXG4gICAgbW9uZ29PcHRpb25zID0ge30sXG4gIH06IGFueSkge1xuICAgIHRoaXMuX3VyaSA9IHVyaTtcbiAgICB0aGlzLl9jb2xsZWN0aW9uUHJlZml4ID0gY29sbGVjdGlvblByZWZpeDtcbiAgICB0aGlzLl9tb25nb09wdGlvbnMgPSBtb25nb09wdGlvbnM7XG5cbiAgICAvLyBNYXhUaW1lTVMgaXMgbm90IGEgZ2xvYmFsIE1vbmdvREIgY2xpZW50IG9wdGlvbiwgaXQgaXMgYXBwbGllZCBwZXIgb3BlcmF0aW9uLlxuICAgIHRoaXMuX21heFRpbWVNUyA9IG1vbmdvT3B0aW9ucy5tYXhUaW1lTVM7XG4gICAgdGhpcy5jYW5Tb3J0T25Kb2luVGFibGVzID0gdHJ1ZTtcbiAgICBkZWxldGUgbW9uZ29PcHRpb25zLm1heFRpbWVNUztcbiAgfVxuXG4gIGNvbm5lY3QoKSB7XG4gICAgaWYgKHRoaXMuY29ubmVjdGlvblByb21pc2UpIHtcbiAgICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlO1xuICAgIH1cblxuICAgIC8vIHBhcnNpbmcgYW5kIHJlLWZvcm1hdHRpbmcgY2F1c2VzIHRoZSBhdXRoIHZhbHVlIChpZiB0aGVyZSkgdG8gZ2V0IFVSSVxuICAgIC8vIGVuY29kZWRcbiAgICBjb25zdCBlbmNvZGVkVXJpID0gZm9ybWF0VXJsKHBhcnNlVXJsKHRoaXMuX3VyaSkpO1xuXG4gICAgdGhpcy5jb25uZWN0aW9uUHJvbWlzZSA9IE1vbmdvQ2xpZW50LmNvbm5lY3QoZW5jb2RlZFVyaSwgdGhpcy5fbW9uZ29PcHRpb25zKS50aGVuKGNsaWVudCA9PiB7XG4gICAgICAvLyBTdGFydGluZyBtb25nb0RCIDMuMCwgdGhlIE1vbmdvQ2xpZW50LmNvbm5lY3QgZG9uJ3QgcmV0dXJuIGEgREIgYW55bW9yZSBidXQgYSBjbGllbnRcbiAgICAgIC8vIEZvcnR1bmF0ZWx5LCB3ZSBjYW4gZ2V0IGJhY2sgdGhlIG9wdGlvbnMgYW5kIHVzZSB0aGVtIHRvIHNlbGVjdCB0aGUgcHJvcGVyIERCLlxuICAgICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL21vbmdvZGIvbm9kZS1tb25nb2RiLW5hdGl2ZS9ibG9iLzJjMzVkNzZmMDg1NzQyMjViOGRiMDJkN2JlZjY4NzEyM2U2YmIwMTgvbGliL21vbmdvX2NsaWVudC5qcyNMODg1XG4gICAgICBjb25zdCBvcHRpb25zID0gY2xpZW50LnMub3B0aW9ucztcbiAgICAgIGNvbnN0IGRhdGFiYXNlID0gY2xpZW50LmRiKG9wdGlvbnMuZGJOYW1lKTtcbiAgICAgIGlmICghZGF0YWJhc2UpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuY29ubmVjdGlvblByb21pc2U7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGRhdGFiYXNlLm9uKCdlcnJvcicsICgpID0+IHtcbiAgICAgICAgZGVsZXRlIHRoaXMuY29ubmVjdGlvblByb21pc2U7XG4gICAgICB9KTtcbiAgICAgIGRhdGFiYXNlLm9uKCdjbG9zZScsICgpID0+IHtcbiAgICAgICAgZGVsZXRlIHRoaXMuY29ubmVjdGlvblByb21pc2U7XG4gICAgICB9KTtcbiAgICAgIHRoaXMuY2xpZW50ID0gY2xpZW50O1xuICAgICAgdGhpcy5kYXRhYmFzZSA9IGRhdGFiYXNlO1xuICAgIH0pLmNhdGNoKChlcnIpID0+IHtcbiAgICAgIGRlbGV0ZSB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KGVycik7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgfVxuXG4gIGhhbmRsZUVycm9yPFQ+KGVycm9yOiA/KEVycm9yIHwgUGFyc2UuRXJyb3IpKTogUHJvbWlzZTxUPiB7XG4gICAgaWYgKGVycm9yICYmIGVycm9yLmNvZGUgPT09IDEzKSB7IC8vIFVuYXV0aG9yaXplZCBlcnJvclxuICAgICAgZGVsZXRlIHRoaXMuY2xpZW50O1xuICAgICAgZGVsZXRlIHRoaXMuZGF0YWJhc2U7XG4gICAgICBkZWxldGUgdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgICAgIGxvZ2dlci5lcnJvcignUmVjZWl2ZWQgdW5hdXRob3JpemVkIGVycm9yJywgeyBlcnJvcjogZXJyb3IgfSk7XG4gICAgfVxuICAgIHRocm93IGVycm9yO1xuICB9XG5cbiAgaGFuZGxlU2h1dGRvd24oKSB7XG4gICAgaWYgKCF0aGlzLmNsaWVudCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmNsaWVudC5jbG9zZShmYWxzZSk7XG4gIH1cblxuICBfYWRhcHRpdmVDb2xsZWN0aW9uKG5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLmNvbm5lY3QoKVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5kYXRhYmFzZS5jb2xsZWN0aW9uKHRoaXMuX2NvbGxlY3Rpb25QcmVmaXggKyBuYW1lKSlcbiAgICAgIC50aGVuKHJhd0NvbGxlY3Rpb24gPT4gbmV3IE1vbmdvQ29sbGVjdGlvbihyYXdDb2xsZWN0aW9uKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIF9zY2hlbWFDb2xsZWN0aW9uKCk6IFByb21pc2U8TW9uZ29TY2hlbWFDb2xsZWN0aW9uPiB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdCgpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oTW9uZ29TY2hlbWFDb2xsZWN0aW9uTmFtZSkpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IG5ldyBNb25nb1NjaGVtYUNvbGxlY3Rpb24oY29sbGVjdGlvbikpO1xuICB9XG5cbiAgY2xhc3NFeGlzdHMobmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdCgpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuZGF0YWJhc2UubGlzdENvbGxlY3Rpb25zKHsgbmFtZTogdGhpcy5fY29sbGVjdGlvblByZWZpeCArIG5hbWUgfSkudG9BcnJheSgpO1xuICAgIH0pLnRoZW4oY29sbGVjdGlvbnMgPT4ge1xuICAgICAgcmV0dXJuIGNvbGxlY3Rpb25zLmxlbmd0aCA+IDA7XG4gICAgfSkuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBzZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoY2xhc3NOYW1lOiBzdHJpbmcsIENMUHM6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKClcbiAgICAgIC50aGVuKHNjaGVtYUNvbGxlY3Rpb24gPT4gc2NoZW1hQ29sbGVjdGlvbi51cGRhdGVTY2hlbWEoY2xhc3NOYW1lLCB7XG4gICAgICAgICRzZXQ6IHsgJ19tZXRhZGF0YS5jbGFzc19wZXJtaXNzaW9ucyc6IENMUHMgfVxuICAgICAgfSkpLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgc2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQoY2xhc3NOYW1lOiBzdHJpbmcsIHN1Ym1pdHRlZEluZGV4ZXM6IGFueSwgZXhpc3RpbmdJbmRleGVzOiBhbnkgPSB7fSwgZmllbGRzOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoc3VibWl0dGVkSW5kZXhlcyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuICAgIGlmIChPYmplY3Qua2V5cyhleGlzdGluZ0luZGV4ZXMpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgZXhpc3RpbmdJbmRleGVzID0geyBfaWRfOiB7IF9pZDogMX0gfTtcbiAgICB9XG4gICAgY29uc3QgZGVsZXRlUHJvbWlzZXMgPSBbXTtcbiAgICBjb25zdCBpbnNlcnRlZEluZGV4ZXMgPSBbXTtcbiAgICBPYmplY3Qua2V5cyhzdWJtaXR0ZWRJbmRleGVzKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgY29uc3QgZmllbGQgPSBzdWJtaXR0ZWRJbmRleGVzW25hbWVdO1xuICAgICAgaWYgKGV4aXN0aW5nSW5kZXhlc1tuYW1lXSAmJiBmaWVsZC5fX29wICE9PSAnRGVsZXRlJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgYEluZGV4ICR7bmFtZX0gZXhpc3RzLCBjYW5ub3QgdXBkYXRlLmApO1xuICAgICAgfVxuICAgICAgaWYgKCFleGlzdGluZ0luZGV4ZXNbbmFtZV0gJiYgZmllbGQuX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksIGBJbmRleCAke25hbWV9IGRvZXMgbm90IGV4aXN0LCBjYW5ub3QgZGVsZXRlLmApO1xuICAgICAgfVxuICAgICAgaWYgKGZpZWxkLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLmRyb3BJbmRleChjbGFzc05hbWUsIG5hbWUpO1xuICAgICAgICBkZWxldGVQcm9taXNlcy5wdXNoKHByb21pc2UpO1xuICAgICAgICBkZWxldGUgZXhpc3RpbmdJbmRleGVzW25hbWVdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgT2JqZWN0LmtleXMoZmllbGQpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICBpZiAoIWZpZWxkcy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgYEZpZWxkICR7a2V5fSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGFkZCBpbmRleC5gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBleGlzdGluZ0luZGV4ZXNbbmFtZV0gPSBmaWVsZDtcbiAgICAgICAgaW5zZXJ0ZWRJbmRleGVzLnB1c2goe1xuICAgICAgICAgIGtleTogZmllbGQsXG4gICAgICAgICAgbmFtZSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgbGV0IGluc2VydFByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICBpZiAoaW5zZXJ0ZWRJbmRleGVzLmxlbmd0aCA+IDApIHtcbiAgICAgIGluc2VydFByb21pc2UgPSB0aGlzLmNyZWF0ZUluZGV4ZXMoY2xhc3NOYW1lLCBpbnNlcnRlZEluZGV4ZXMpO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5hbGwoZGVsZXRlUHJvbWlzZXMpXG4gICAgICAudGhlbigoKSA9PiBpbnNlcnRQcm9taXNlKVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fc2NoZW1hQ29sbGVjdGlvbigpKVxuICAgICAgLnRoZW4oc2NoZW1hQ29sbGVjdGlvbiA9PiBzY2hlbWFDb2xsZWN0aW9uLnVwZGF0ZVNjaGVtYShjbGFzc05hbWUsIHtcbiAgICAgICAgJHNldDogeyAnX21ldGFkYXRhLmluZGV4ZXMnOiAgZXhpc3RpbmdJbmRleGVzIH1cbiAgICAgIH0pKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgc2V0SW5kZXhlc0Zyb21Nb25nbyhjbGFzc05hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLmdldEluZGV4ZXMoY2xhc3NOYW1lKS50aGVuKChpbmRleGVzKSA9PiB7XG4gICAgICBpbmRleGVzID0gaW5kZXhlcy5yZWR1Y2UoKG9iaiwgaW5kZXgpID0+IHtcbiAgICAgICAgaWYgKGluZGV4LmtleS5fZnRzKSB7XG4gICAgICAgICAgZGVsZXRlIGluZGV4LmtleS5fZnRzO1xuICAgICAgICAgIGRlbGV0ZSBpbmRleC5rZXkuX2Z0c3g7XG4gICAgICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBpbmRleC53ZWlnaHRzKSB7XG4gICAgICAgICAgICBpbmRleC5rZXlbZmllbGRdID0gJ3RleHQnO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBvYmpbaW5kZXgubmFtZV0gPSBpbmRleC5rZXk7XG4gICAgICAgIHJldHVybiBvYmo7XG4gICAgICB9LCB7fSk7XG4gICAgICByZXR1cm4gdGhpcy5fc2NoZW1hQ29sbGVjdGlvbigpXG4gICAgICAgIC50aGVuKHNjaGVtYUNvbGxlY3Rpb24gPT4gc2NoZW1hQ29sbGVjdGlvbi51cGRhdGVTY2hlbWEoY2xhc3NOYW1lLCB7XG4gICAgICAgICAgJHNldDogeyAnX21ldGFkYXRhLmluZGV4ZXMnOiBpbmRleGVzIH1cbiAgICAgICAgfSkpO1xuICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSlcbiAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgIC8vIElnbm9yZSBpZiBjb2xsZWN0aW9uIG5vdCBmb3VuZFxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgfVxuXG4gIGNyZWF0ZUNsYXNzKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgbW9uZ29PYmplY3QgPSBtb25nb1NjaGVtYUZyb21GaWVsZHNBbmRDbGFzc05hbWVBbmRDTFAoc2NoZW1hLmZpZWxkcywgY2xhc3NOYW1lLCBzY2hlbWEuY2xhc3NMZXZlbFBlcm1pc3Npb25zLCBzY2hlbWEuaW5kZXhlcyk7XG4gICAgbW9uZ29PYmplY3QuX2lkID0gY2xhc3NOYW1lO1xuICAgIHJldHVybiB0aGlzLnNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KGNsYXNzTmFtZSwgc2NoZW1hLmluZGV4ZXMsIHt9LCBzY2hlbWEuZmllbGRzKVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fc2NoZW1hQ29sbGVjdGlvbigpKVxuICAgICAgLnRoZW4oc2NoZW1hQ29sbGVjdGlvbiA9PiBzY2hlbWFDb2xsZWN0aW9uLmluc2VydFNjaGVtYShtb25nb09iamVjdCkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBhZGRGaWVsZElmTm90RXhpc3RzKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZE5hbWU6IHN0cmluZywgdHlwZTogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKVxuICAgICAgLnRoZW4oc2NoZW1hQ29sbGVjdGlvbiA9PiBzY2hlbWFDb2xsZWN0aW9uLmFkZEZpZWxkSWZOb3RFeGlzdHMoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHR5cGUpKVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5jcmVhdGVJbmRleGVzSWZOZWVkZWQoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHR5cGUpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gRHJvcHMgYSBjb2xsZWN0aW9uLiBSZXNvbHZlcyB3aXRoIHRydWUgaWYgaXQgd2FzIGEgUGFyc2UgU2NoZW1hIChlZy4gX1VzZXIsIEN1c3RvbSwgZXRjLilcbiAgLy8gYW5kIHJlc29sdmVzIHdpdGggZmFsc2UgaWYgaXQgd2Fzbid0IChlZy4gYSBqb2luIHRhYmxlKS4gUmVqZWN0cyBpZiBkZWxldGlvbiB3YXMgaW1wb3NzaWJsZS5cbiAgZGVsZXRlQ2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5kcm9wKCkpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgLy8gJ25zIG5vdCBmb3VuZCcgbWVhbnMgY29sbGVjdGlvbiB3YXMgYWxyZWFkeSBnb25lLiBJZ25vcmUgZGVsZXRpb24gYXR0ZW1wdC5cbiAgICAgICAgaWYgKGVycm9yLm1lc3NhZ2UgPT0gJ25zIG5vdCBmb3VuZCcpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KVxuICAgIC8vIFdlJ3ZlIGRyb3BwZWQgdGhlIGNvbGxlY3Rpb24sIG5vdyByZW1vdmUgdGhlIF9TQ0hFTUEgZG9jdW1lbnRcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKSlcbiAgICAgIC50aGVuKHNjaGVtYUNvbGxlY3Rpb24gPT4gc2NoZW1hQ29sbGVjdGlvbi5maW5kQW5kRGVsZXRlU2NoZW1hKGNsYXNzTmFtZSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBkZWxldGVBbGxDbGFzc2VzKGZhc3Q6IGJvb2xlYW4pIHtcbiAgICByZXR1cm4gc3RvcmFnZUFkYXB0ZXJBbGxDb2xsZWN0aW9ucyh0aGlzKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbnMgPT4gUHJvbWlzZS5hbGwoY29sbGVjdGlvbnMubWFwKGNvbGxlY3Rpb24gPT4gZmFzdCA/IGNvbGxlY3Rpb24ucmVtb3ZlKHt9KSA6IGNvbGxlY3Rpb24uZHJvcCgpKSkpO1xuICB9XG5cbiAgLy8gUmVtb3ZlIHRoZSBjb2x1bW4gYW5kIGFsbCB0aGUgZGF0YS4gRm9yIFJlbGF0aW9ucywgdGhlIF9Kb2luIGNvbGxlY3Rpb24gaXMgaGFuZGxlZFxuICAvLyBzcGVjaWFsbHksIHRoaXMgZnVuY3Rpb24gZG9lcyBub3QgZGVsZXRlIF9Kb2luIGNvbHVtbnMuIEl0IHNob3VsZCwgaG93ZXZlciwgaW5kaWNhdGVcbiAgLy8gdGhhdCB0aGUgcmVsYXRpb24gZmllbGRzIGRvZXMgbm90IGV4aXN0IGFueW1vcmUuIEluIG1vbmdvLCB0aGlzIG1lYW5zIHJlbW92aW5nIGl0IGZyb21cbiAgLy8gdGhlIF9TQ0hFTUEgY29sbGVjdGlvbi4gIFRoZXJlIHNob3VsZCBiZSBubyBhY3R1YWwgZGF0YSBpbiB0aGUgY29sbGVjdGlvbiB1bmRlciB0aGUgc2FtZSBuYW1lXG4gIC8vIGFzIHRoZSByZWxhdGlvbiBjb2x1bW4sIHNvIGl0J3MgZmluZSB0byBhdHRlbXB0IHRvIGRlbGV0ZSBpdC4gSWYgdGhlIGZpZWxkcyBsaXN0ZWQgdG8gYmVcbiAgLy8gZGVsZXRlZCBkbyBub3QgZXhpc3QsIHRoaXMgZnVuY3Rpb24gc2hvdWxkIHJldHVybiBzdWNjZXNzZnVsbHkgYW55d2F5cy4gQ2hlY2tpbmcgZm9yXG4gIC8vIGF0dGVtcHRzIHRvIGRlbGV0ZSBub24tZXhpc3RlbnQgZmllbGRzIGlzIHRoZSByZXNwb25zaWJpbGl0eSBvZiBQYXJzZSBTZXJ2ZXIuXG5cbiAgLy8gUG9pbnRlciBmaWVsZCBuYW1lcyBhcmUgcGFzc2VkIGZvciBsZWdhY3kgcmVhc29uczogdGhlIG9yaWdpbmFsIG1vbmdvXG4gIC8vIGZvcm1hdCBzdG9yZWQgcG9pbnRlciBmaWVsZCBuYW1lcyBkaWZmZXJlbnRseSBpbiB0aGUgZGF0YWJhc2UsIGFuZCB0aGVyZWZvcmVcbiAgLy8gbmVlZGVkIHRvIGtub3cgdGhlIHR5cGUgb2YgdGhlIGZpZWxkIGJlZm9yZSBpdCBjb3VsZCBkZWxldGUgaXQuIEZ1dHVyZSBkYXRhYmFzZVxuICAvLyBhZGFwdGVycyBzaG91bGQgaWdub3JlIHRoZSBwb2ludGVyRmllbGROYW1lcyBhcmd1bWVudC4gQWxsIHRoZSBmaWVsZCBuYW1lcyBhcmUgaW5cbiAgLy8gZmllbGROYW1lcywgdGhleSBzaG93IHVwIGFkZGl0aW9uYWxseSBpbiB0aGUgcG9pbnRlckZpZWxkTmFtZXMgZGF0YWJhc2UgZm9yIHVzZVxuICAvLyBieSB0aGUgbW9uZ28gYWRhcHRlciwgd2hpY2ggZGVhbHMgd2l0aCB0aGUgbGVnYWN5IG1vbmdvIGZvcm1hdC5cblxuICAvLyBUaGlzIGZ1bmN0aW9uIGlzIG5vdCBvYmxpZ2F0ZWQgdG8gZGVsZXRlIGZpZWxkcyBhdG9taWNhbGx5LiBJdCBpcyBnaXZlbiB0aGUgZmllbGRcbiAgLy8gbmFtZXMgaW4gYSBsaXN0IHNvIHRoYXQgZGF0YWJhc2VzIHRoYXQgYXJlIGNhcGFibGUgb2YgZGVsZXRpbmcgZmllbGRzIGF0b21pY2FsbHlcbiAgLy8gbWF5IGRvIHNvLlxuXG4gIC8vIFJldHVybnMgYSBQcm9taXNlLlxuICBkZWxldGVGaWVsZHMoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgZmllbGROYW1lczogc3RyaW5nW10pIHtcbiAgICBjb25zdCBtb25nb0Zvcm1hdE5hbWVzID0gZmllbGROYW1lcy5tYXAoZmllbGROYW1lID0+IHtcbiAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICAgIHJldHVybiBgX3BfJHtmaWVsZE5hbWV9YFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIGZpZWxkTmFtZTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBjb25zdCBjb2xsZWN0aW9uVXBkYXRlID0geyAnJHVuc2V0JyA6IHt9IH07XG4gICAgbW9uZ29Gb3JtYXROYW1lcy5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgY29sbGVjdGlvblVwZGF0ZVsnJHVuc2V0J11bbmFtZV0gPSBudWxsO1xuICAgIH0pO1xuXG4gICAgY29uc3Qgc2NoZW1hVXBkYXRlID0geyAnJHVuc2V0JyA6IHt9IH07XG4gICAgZmllbGROYW1lcy5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgc2NoZW1hVXBkYXRlWyckdW5zZXQnXVtuYW1lXSA9IG51bGw7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi51cGRhdGVNYW55KHt9LCBjb2xsZWN0aW9uVXBkYXRlKSlcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKSlcbiAgICAgIC50aGVuKHNjaGVtYUNvbGxlY3Rpb24gPT4gc2NoZW1hQ29sbGVjdGlvbi51cGRhdGVTY2hlbWEoY2xhc3NOYW1lLCBzY2hlbWFVcGRhdGUpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gUmV0dXJuIGEgcHJvbWlzZSBmb3IgYWxsIHNjaGVtYXMga25vd24gdG8gdGhpcyBhZGFwdGVyLCBpbiBQYXJzZSBmb3JtYXQuIEluIGNhc2UgdGhlXG4gIC8vIHNjaGVtYXMgY2Fubm90IGJlIHJldHJpZXZlZCwgcmV0dXJucyBhIHByb21pc2UgdGhhdCByZWplY3RzLiBSZXF1aXJlbWVudHMgZm9yIHRoZVxuICAvLyByZWplY3Rpb24gcmVhc29uIGFyZSBUQkQuXG4gIGdldEFsbENsYXNzZXMoKTogUHJvbWlzZTxTdG9yYWdlQ2xhc3NbXT4ge1xuICAgIHJldHVybiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKCkudGhlbihzY2hlbWFzQ29sbGVjdGlvbiA9PiBzY2hlbWFzQ29sbGVjdGlvbi5fZmV0Y2hBbGxTY2hlbWFzRnJvbV9TQ0hFTUEoKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIFJldHVybiBhIHByb21pc2UgZm9yIHRoZSBzY2hlbWEgd2l0aCB0aGUgZ2l2ZW4gbmFtZSwgaW4gUGFyc2UgZm9ybWF0LiBJZlxuICAvLyB0aGlzIGFkYXB0ZXIgZG9lc24ndCBrbm93IGFib3V0IHRoZSBzY2hlbWEsIHJldHVybiBhIHByb21pc2UgdGhhdCByZWplY3RzIHdpdGhcbiAgLy8gdW5kZWZpbmVkIGFzIHRoZSByZWFzb24uXG4gIGdldENsYXNzKGNsYXNzTmFtZTogc3RyaW5nKTogUHJvbWlzZTxTdG9yYWdlQ2xhc3M+IHtcbiAgICByZXR1cm4gdGhpcy5fc2NoZW1hQ29sbGVjdGlvbigpXG4gICAgICAudGhlbihzY2hlbWFzQ29sbGVjdGlvbiA9PiBzY2hlbWFzQ29sbGVjdGlvbi5fZmV0Y2hPbmVTY2hlbWFGcm9tX1NDSEVNQShjbGFzc05hbWUpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gVE9ETzogQXMgeWV0IG5vdCBwYXJ0aWN1bGFybHkgd2VsbCBzcGVjaWZpZWQuIENyZWF0ZXMgYW4gb2JqZWN0LiBNYXliZSBzaG91bGRuJ3QgZXZlbiBuZWVkIHRoZSBzY2hlbWEsXG4gIC8vIGFuZCBzaG91bGQgaW5mZXIgZnJvbSB0aGUgdHlwZS4gT3IgbWF5YmUgZG9lcyBuZWVkIHRoZSBzY2hlbWEgZm9yIHZhbGlkYXRpb25zLiBPciBtYXliZSBuZWVkc1xuICAvLyB0aGUgc2NoZW1hIG9ubHkgZm9yIHRoZSBsZWdhY3kgbW9uZ28gZm9ybWF0LiBXZSdsbCBmaWd1cmUgdGhhdCBvdXQgbGF0ZXIuXG4gIGNyZWF0ZU9iamVjdChjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBvYmplY3Q6IGFueSkge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb09iamVjdCA9IHBhcnNlT2JqZWN0VG9Nb25nb09iamVjdEZvckNyZWF0ZShjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5pbnNlcnRPbmUobW9uZ29PYmplY3QpKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IDExMDAwKSB7IC8vIER1cGxpY2F0ZSB2YWx1ZVxuICAgICAgICAgIGNvbnN0IGVyciA9IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsICdBIGR1cGxpY2F0ZSB2YWx1ZSBmb3IgYSBmaWVsZCB3aXRoIHVuaXF1ZSB2YWx1ZXMgd2FzIHByb3ZpZGVkJyk7XG4gICAgICAgICAgZXJyLnVuZGVybHlpbmdFcnJvciA9IGVycm9yO1xuICAgICAgICAgIGlmIChlcnJvci5tZXNzYWdlKSB7XG4gICAgICAgICAgICBjb25zdCBtYXRjaGVzID0gZXJyb3IubWVzc2FnZS5tYXRjaCgvaW5kZXg6W1xcc2EtekEtWjAtOV9cXC1cXC5dK1xcJD8oW2EtekEtWl8tXSspXzEvKTtcbiAgICAgICAgICAgIGlmIChtYXRjaGVzICYmIEFycmF5LmlzQXJyYXkobWF0Y2hlcykpIHtcbiAgICAgICAgICAgICAgZXJyLnVzZXJJbmZvID0geyBkdXBsaWNhdGVkX2ZpZWxkOiBtYXRjaGVzWzFdIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBSZW1vdmUgYWxsIG9iamVjdHMgdGhhdCBtYXRjaCB0aGUgZ2l2ZW4gUGFyc2UgUXVlcnkuXG4gIC8vIElmIG5vIG9iamVjdHMgbWF0Y2gsIHJlamVjdCB3aXRoIE9CSkVDVF9OT1RfRk9VTkQuIElmIG9iamVjdHMgYXJlIGZvdW5kIGFuZCBkZWxldGVkLCByZXNvbHZlIHdpdGggdW5kZWZpbmVkLlxuICAvLyBJZiB0aGVyZSBpcyBzb21lIG90aGVyIGVycm9yLCByZWplY3Qgd2l0aCBJTlRFUk5BTF9TRVJWRVJfRVJST1IuXG4gIGRlbGV0ZU9iamVjdHNCeVF1ZXJ5KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUpIHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IHtcbiAgICAgICAgY29uc3QgbW9uZ29XaGVyZSA9IHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgcXVlcnksIHNjaGVtYSk7XG4gICAgICAgIHJldHVybiBjb2xsZWN0aW9uLmRlbGV0ZU1hbnkobW9uZ29XaGVyZSlcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSlcbiAgICAgIC50aGVuKCh7IHJlc3VsdCB9KSA9PiB7XG4gICAgICAgIGlmIChyZXN1bHQubiA9PT0gMCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELCAnT2JqZWN0IG5vdCBmb3VuZC4nKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9LCAoKSA9PiB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsICdEYXRhYmFzZSBhZGFwdGVyIGVycm9yJyk7XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIEFwcGx5IHRoZSB1cGRhdGUgdG8gYWxsIG9iamVjdHMgdGhhdCBtYXRjaCB0aGUgZ2l2ZW4gUGFyc2UgUXVlcnkuXG4gIHVwZGF0ZU9iamVjdHNCeVF1ZXJ5KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIHVwZGF0ZTogYW55KSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvVXBkYXRlID0gdHJhbnNmb3JtVXBkYXRlKGNsYXNzTmFtZSwgdXBkYXRlLCBzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvV2hlcmUgPSB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLnVwZGF0ZU1hbnkobW9uZ29XaGVyZSwgbW9uZ29VcGRhdGUpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gQXRvbWljYWxseSBmaW5kcyBhbmQgdXBkYXRlcyBhbiBvYmplY3QgYmFzZWQgb24gcXVlcnkuXG4gIC8vIFJldHVybiB2YWx1ZSBub3QgY3VycmVudGx5IHdlbGwgc3BlY2lmaWVkLlxuICBmaW5kT25lQW5kVXBkYXRlKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIHVwZGF0ZTogYW55KSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvVXBkYXRlID0gdHJhbnNmb3JtVXBkYXRlKGNsYXNzTmFtZSwgdXBkYXRlLCBzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvV2hlcmUgPSB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLl9tb25nb0NvbGxlY3Rpb24uZmluZEFuZE1vZGlmeShtb25nb1doZXJlLCBbXSwgbW9uZ29VcGRhdGUsIHsgbmV3OiB0cnVlIH0pKVxuICAgICAgLnRoZW4ocmVzdWx0ID0+IG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWUsIHJlc3VsdC52YWx1ZSwgc2NoZW1hKSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSAxMTAwMCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsICdBIGR1cGxpY2F0ZSB2YWx1ZSBmb3IgYSBmaWVsZCB3aXRoIHVuaXF1ZSB2YWx1ZXMgd2FzIHByb3ZpZGVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gSG9wZWZ1bGx5IHdlIGNhbiBnZXQgcmlkIG9mIHRoaXMuIEl0J3Mgb25seSB1c2VkIGZvciBjb25maWcgYW5kIGhvb2tzLlxuICB1cHNlcnRPbmVPYmplY3QoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSwgdXBkYXRlOiBhbnkpIHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgbW9uZ29VcGRhdGUgPSB0cmFuc2Zvcm1VcGRhdGUoY2xhc3NOYW1lLCB1cGRhdGUsIHNjaGVtYSk7XG4gICAgY29uc3QgbW9uZ29XaGVyZSA9IHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgcXVlcnksIHNjaGVtYSk7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24udXBzZXJ0T25lKG1vbmdvV2hlcmUsIG1vbmdvVXBkYXRlKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIEV4ZWN1dGVzIGEgZmluZC4gQWNjZXB0czogY2xhc3NOYW1lLCBxdWVyeSBpbiBQYXJzZSBmb3JtYXQsIGFuZCB7IHNraXAsIGxpbWl0LCBzb3J0IH0uXG4gIGZpbmQoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSwgeyBza2lwLCBsaW1pdCwgc29ydCwga2V5cywgcmVhZFByZWZlcmVuY2UgfTogUXVlcnlPcHRpb25zKTogUHJvbWlzZTxhbnk+IHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgbW9uZ29XaGVyZSA9IHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgcXVlcnksIHNjaGVtYSk7XG4gICAgY29uc3QgbW9uZ29Tb3J0ID0gXy5tYXBLZXlzKHNvcnQsICh2YWx1ZSwgZmllbGROYW1lKSA9PiB0cmFuc2Zvcm1LZXkoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHNjaGVtYSkpO1xuICAgIGNvbnN0IG1vbmdvS2V5cyA9IF8ucmVkdWNlKGtleXMsIChtZW1vLCBrZXkpID0+IHtcbiAgICAgIG1lbW9bdHJhbnNmb3JtS2V5KGNsYXNzTmFtZSwga2V5LCBzY2hlbWEpXSA9IDE7XG4gICAgICByZXR1cm4gbWVtbztcbiAgICB9LCB7fSk7XG5cbiAgICByZWFkUHJlZmVyZW5jZSA9IHRoaXMuX3BhcnNlUmVhZFByZWZlcmVuY2UocmVhZFByZWZlcmVuY2UpO1xuICAgIHJldHVybiB0aGlzLmNyZWF0ZVRleHRJbmRleGVzSWZOZWVkZWQoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSkpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uZmluZChtb25nb1doZXJlLCB7XG4gICAgICAgIHNraXAsXG4gICAgICAgIGxpbWl0LFxuICAgICAgICBzb3J0OiBtb25nb1NvcnQsXG4gICAgICAgIGtleXM6IG1vbmdvS2V5cyxcbiAgICAgICAgbWF4VGltZU1TOiB0aGlzLl9tYXhUaW1lTVMsXG4gICAgICAgIHJlYWRQcmVmZXJlbmNlLFxuICAgICAgfSkpXG4gICAgICAudGhlbihvYmplY3RzID0+IG9iamVjdHMubWFwKG9iamVjdCA9PiBtb25nb09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSkpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gQ3JlYXRlIGEgdW5pcXVlIGluZGV4LiBVbmlxdWUgaW5kZXhlcyBvbiBudWxsYWJsZSBmaWVsZHMgYXJlIG5vdCBhbGxvd2VkLiBTaW5jZSB3ZSBkb24ndFxuICAvLyBjdXJyZW50bHkga25vdyB3aGljaCBmaWVsZHMgYXJlIG51bGxhYmxlIGFuZCB3aGljaCBhcmVuJ3QsIHdlIGlnbm9yZSB0aGF0IGNyaXRlcmlhLlxuICAvLyBBcyBzdWNoLCB3ZSBzaG91bGRuJ3QgZXhwb3NlIHRoaXMgZnVuY3Rpb24gdG8gdXNlcnMgb2YgcGFyc2UgdW50aWwgd2UgaGF2ZSBhbiBvdXQtb2YtYmFuZFxuICAvLyBXYXkgb2YgZGV0ZXJtaW5pbmcgaWYgYSBmaWVsZCBpcyBudWxsYWJsZS4gVW5kZWZpbmVkIGRvZXNuJ3QgY291bnQgYWdhaW5zdCB1bmlxdWVuZXNzLFxuICAvLyB3aGljaCBpcyB3aHkgd2UgdXNlIHNwYXJzZSBpbmRleGVzLlxuICBlbnN1cmVVbmlxdWVuZXNzKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIGZpZWxkTmFtZXM6IHN0cmluZ1tdKSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IGluZGV4Q3JlYXRpb25SZXF1ZXN0ID0ge307XG4gICAgY29uc3QgbW9uZ29GaWVsZE5hbWVzID0gZmllbGROYW1lcy5tYXAoZmllbGROYW1lID0+IHRyYW5zZm9ybUtleShjbGFzc05hbWUsIGZpZWxkTmFtZSwgc2NoZW1hKSk7XG4gICAgbW9uZ29GaWVsZE5hbWVzLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgIGluZGV4Q3JlYXRpb25SZXF1ZXN0W2ZpZWxkTmFtZV0gPSAxO1xuICAgIH0pO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLl9lbnN1cmVTcGFyc2VVbmlxdWVJbmRleEluQmFja2dyb3VuZChpbmRleENyZWF0aW9uUmVxdWVzdCkpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gMTEwMDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLCAnVHJpZWQgdG8gZW5zdXJlIGZpZWxkIHVuaXF1ZW5lc3MgZm9yIGEgY2xhc3MgdGhhdCBhbHJlYWR5IGhhcyBkdXBsaWNhdGVzLicpO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIFVzZWQgaW4gdGVzdHNcbiAgX3Jhd0ZpbmQoY2xhc3NOYW1lOiBzdHJpbmcsIHF1ZXJ5OiBRdWVyeVR5cGUpIHtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSkudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uZmluZChxdWVyeSwge1xuICAgICAgbWF4VGltZU1TOiB0aGlzLl9tYXhUaW1lTVMsXG4gICAgfSkpLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gRXhlY3V0ZXMgYSBjb3VudC5cbiAgY291bnQoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSwgcmVhZFByZWZlcmVuY2U6ID9zdHJpbmcpIHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgcmVhZFByZWZlcmVuY2UgPSB0aGlzLl9wYXJzZVJlYWRQcmVmZXJlbmNlKHJlYWRQcmVmZXJlbmNlKTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5jb3VudCh0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpLCB7XG4gICAgICAgIG1heFRpbWVNUzogdGhpcy5fbWF4VGltZU1TLFxuICAgICAgICByZWFkUHJlZmVyZW5jZSxcbiAgICAgIH0pKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgZGlzdGluY3QoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSwgZmllbGROYW1lOiBzdHJpbmcpIHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgaXNQb2ludGVyRmllbGQgPSBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdQb2ludGVyJztcbiAgICBpZiAoaXNQb2ludGVyRmllbGQpIHtcbiAgICAgIGZpZWxkTmFtZSA9IGBfcF8ke2ZpZWxkTmFtZX1gXG4gICAgfVxuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLmRpc3RpbmN0KGZpZWxkTmFtZSwgdHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKSkpXG4gICAgICAudGhlbihvYmplY3RzID0+IHtcbiAgICAgICAgb2JqZWN0cyA9IG9iamVjdHMuZmlsdGVyKChvYmopID0+IG9iaiAhPSBudWxsKTtcbiAgICAgICAgcmV0dXJuIG9iamVjdHMubWFwKG9iamVjdCA9PiB7XG4gICAgICAgICAgaWYgKGlzUG9pbnRlckZpZWxkKSB7XG4gICAgICAgICAgICBjb25zdCBmaWVsZCA9IGZpZWxkTmFtZS5zdWJzdHJpbmcoMyk7XG4gICAgICAgICAgICByZXR1cm4gdHJhbnNmb3JtUG9pbnRlclN0cmluZyhzY2hlbWEsIGZpZWxkLCBvYmplY3QpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gbW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0KGNsYXNzTmFtZSwgb2JqZWN0LCBzY2hlbWEpO1xuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBhZ2dyZWdhdGUoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogYW55LCBwaXBlbGluZTogYW55LCByZWFkUHJlZmVyZW5jZTogP3N0cmluZykge1xuICAgIGxldCBpc1BvaW50ZXJGaWVsZCA9IGZhbHNlO1xuICAgIHBpcGVsaW5lID0gcGlwZWxpbmUubWFwKChzdGFnZSkgPT4ge1xuICAgICAgaWYgKHN0YWdlLiRncm91cCkge1xuICAgICAgICBzdGFnZS4kZ3JvdXAgPSB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZUdyb3VwQXJncyhzY2hlbWEsIHN0YWdlLiRncm91cCk7XG4gICAgICAgIGlmIChzdGFnZS4kZ3JvdXAuX2lkICYmICh0eXBlb2Ygc3RhZ2UuJGdyb3VwLl9pZCA9PT0gJ3N0cmluZycpICYmIHN0YWdlLiRncm91cC5faWQuaW5kZXhPZignJF9wXycpID49IDApIHtcbiAgICAgICAgICBpc1BvaW50ZXJGaWVsZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kbWF0Y2gpIHtcbiAgICAgICAgc3RhZ2UuJG1hdGNoID0gdGhpcy5fcGFyc2VBZ2dyZWdhdGVBcmdzKHNjaGVtYSwgc3RhZ2UuJG1hdGNoKTtcbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kcHJvamVjdCkge1xuICAgICAgICBzdGFnZS4kcHJvamVjdCA9IHRoaXMuX3BhcnNlQWdncmVnYXRlUHJvamVjdEFyZ3Moc2NoZW1hLCBzdGFnZS4kcHJvamVjdCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gc3RhZ2U7XG4gICAgfSk7XG4gICAgcmVhZFByZWZlcmVuY2UgPSB0aGlzLl9wYXJzZVJlYWRQcmVmZXJlbmNlKHJlYWRQcmVmZXJlbmNlKTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5hZ2dyZWdhdGUocGlwZWxpbmUsIHsgcmVhZFByZWZlcmVuY2UsIG1heFRpbWVNUzogdGhpcy5fbWF4VGltZU1TIH0pKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IDE2MDA2KSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksIGVycm9yLm1lc3NhZ2UpO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSlcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICByZXN1bHRzLmZvckVhY2gocmVzdWx0ID0+IHtcbiAgICAgICAgICBpZiAocmVzdWx0Lmhhc093blByb3BlcnR5KCdfaWQnKSkge1xuICAgICAgICAgICAgaWYgKGlzUG9pbnRlckZpZWxkICYmIHJlc3VsdC5faWQpIHtcbiAgICAgICAgICAgICAgcmVzdWx0Ll9pZCA9IHJlc3VsdC5faWQuc3BsaXQoJyQnKVsxXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXN1bHQuX2lkID09IG51bGwgfHwgXy5pc0VtcHR5KHJlc3VsdC5faWQpKSB7XG4gICAgICAgICAgICAgIHJlc3VsdC5faWQgPSBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzdWx0Lm9iamVjdElkID0gcmVzdWx0Ll9pZDtcbiAgICAgICAgICAgIGRlbGV0ZSByZXN1bHQuX2lkO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZXN1bHRzO1xuICAgICAgfSlcbiAgICAgIC50aGVuKG9iamVjdHMgPT4gb2JqZWN0cy5tYXAob2JqZWN0ID0+IG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBUaGlzIGZ1bmN0aW9uIHdpbGwgcmVjdXJzaXZlbHkgdHJhdmVyc2UgdGhlIHBpcGVsaW5lIGFuZCBjb252ZXJ0IGFueSBQb2ludGVyIG9yIERhdGUgY29sdW1ucy5cbiAgLy8gSWYgd2UgZGV0ZWN0IGEgcG9pbnRlciBjb2x1bW4gd2Ugd2lsbCByZW5hbWUgdGhlIGNvbHVtbiBiZWluZyBxdWVyaWVkIGZvciB0byBtYXRjaCB0aGUgY29sdW1uXG4gIC8vIGluIHRoZSBkYXRhYmFzZS4gV2UgYWxzbyBtb2RpZnkgdGhlIHZhbHVlIHRvIHdoYXQgd2UgZXhwZWN0IHRoZSB2YWx1ZSB0byBiZSBpbiB0aGUgZGF0YWJhc2VcbiAgLy8gYXMgd2VsbC5cbiAgLy8gRm9yIGRhdGVzLCB0aGUgZHJpdmVyIGV4cGVjdHMgYSBEYXRlIG9iamVjdCwgYnV0IHdlIGhhdmUgYSBzdHJpbmcgY29taW5nIGluLiBTbyB3ZSdsbCBjb252ZXJ0XG4gIC8vIHRoZSBzdHJpbmcgdG8gYSBEYXRlIHNvIHRoZSBkcml2ZXIgY2FuIHBlcmZvcm0gdGhlIG5lY2Vzc2FyeSBjb21wYXJpc29uLlxuICAvL1xuICAvLyBUaGUgZ29hbCBvZiB0aGlzIG1ldGhvZCBpcyB0byBsb29rIGZvciB0aGUgXCJsZWF2ZXNcIiBvZiB0aGUgcGlwZWxpbmUgYW5kIGRldGVybWluZSBpZiBpdCBuZWVkc1xuICAvLyB0byBiZSBjb252ZXJ0ZWQuIFRoZSBwaXBlbGluZSBjYW4gaGF2ZSBhIGZldyBkaWZmZXJlbnQgZm9ybXMuIEZvciBtb3JlIGRldGFpbHMsIHNlZTpcbiAgLy8gICAgIGh0dHBzOi8vZG9jcy5tb25nb2RiLmNvbS9tYW51YWwvcmVmZXJlbmNlL29wZXJhdG9yL2FnZ3JlZ2F0aW9uL1xuICAvL1xuICAvLyBJZiB0aGUgcGlwZWxpbmUgaXMgYW4gYXJyYXksIGl0IG1lYW5zIHdlIGFyZSBwcm9iYWJseSBwYXJzaW5nIGFuICckYW5kJyBvciAnJG9yJyBvcGVyYXRvci4gSW5cbiAgLy8gdGhhdCBjYXNlIHdlIG5lZWQgdG8gbG9vcCB0aHJvdWdoIGFsbCBvZiBpdCdzIGNoaWxkcmVuIHRvIGZpbmQgdGhlIGNvbHVtbnMgYmVpbmcgb3BlcmF0ZWQgb24uXG4gIC8vIElmIHRoZSBwaXBlbGluZSBpcyBhbiBvYmplY3QsIHRoZW4gd2UnbGwgbG9vcCB0aHJvdWdoIHRoZSBrZXlzIGNoZWNraW5nIHRvIHNlZSBpZiB0aGUga2V5IG5hbWVcbiAgLy8gbWF0Y2hlcyBvbmUgb2YgdGhlIHNjaGVtYSBjb2x1bW5zLiBJZiBpdCBkb2VzIG1hdGNoIGEgY29sdW1uIGFuZCB0aGUgY29sdW1uIGlzIGEgUG9pbnRlciBvclxuICAvLyBhIERhdGUsIHRoZW4gd2UnbGwgY29udmVydCB0aGUgdmFsdWUgYXMgZGVzY3JpYmVkIGFib3ZlLlxuICAvL1xuICAvLyBBcyBtdWNoIGFzIEkgaGF0ZSByZWN1cnNpb24uLi50aGlzIHNlZW1lZCBsaWtlIGEgZ29vZCBmaXQgZm9yIGl0LiBXZSdyZSBlc3NlbnRpYWxseSB0cmF2ZXJzaW5nXG4gIC8vIGRvd24gYSB0cmVlIHRvIGZpbmQgYSBcImxlYWYgbm9kZVwiIGFuZCBjaGVja2luZyB0byBzZWUgaWYgaXQgbmVlZHMgdG8gYmUgY29udmVydGVkLlxuICBfcGFyc2VBZ2dyZWdhdGVBcmdzKHNjaGVtYTogYW55LCBwaXBlbGluZTogYW55KTogYW55IHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwaXBlbGluZSkpIHtcbiAgICAgIHJldHVybiBwaXBlbGluZS5tYXAoKHZhbHVlKSA9PiB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZUFyZ3Moc2NoZW1hLCB2YWx1ZSkpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHBpcGVsaW5lID09PSAnb2JqZWN0Jykge1xuICAgICAgY29uc3QgcmV0dXJuVmFsdWUgPSB7fTtcbiAgICAgIGZvciAoY29uc3QgZmllbGQgaW4gcGlwZWxpbmUpIHtcbiAgICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGRdICYmIHNjaGVtYS5maWVsZHNbZmllbGRdLnR5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgICAgIGlmICh0eXBlb2YgcGlwZWxpbmVbZmllbGRdID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgLy8gUGFzcyBvYmplY3RzIGRvd24gdG8gTW9uZ29EQi4uLnRoaXMgaXMgbW9yZSB0aGFuIGxpa2VseSBhbiAkZXhpc3RzIG9wZXJhdG9yLlxuICAgICAgICAgICAgcmV0dXJuVmFsdWVbYF9wXyR7ZmllbGR9YF0gPSBwaXBlbGluZVtmaWVsZF07XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVyblZhbHVlW2BfcF8ke2ZpZWxkfWBdID0gYCR7c2NoZW1hLmZpZWxkc1tmaWVsZF0udGFyZ2V0Q2xhc3N9JCR7cGlwZWxpbmVbZmllbGRdfWA7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHNjaGVtYS5maWVsZHNbZmllbGRdICYmIHNjaGVtYS5maWVsZHNbZmllbGRdLnR5cGUgPT09ICdEYXRlJykge1xuICAgICAgICAgIHJldHVyblZhbHVlW2ZpZWxkXSA9IHRoaXMuX2NvbnZlcnRUb0RhdGUocGlwZWxpbmVbZmllbGRdKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm5WYWx1ZVtmaWVsZF0gPSB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZUFyZ3Moc2NoZW1hLCBwaXBlbGluZVtmaWVsZF0pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGZpZWxkID09PSAnb2JqZWN0SWQnKSB7XG4gICAgICAgICAgcmV0dXJuVmFsdWVbJ19pZCddID0gcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICAgIGRlbGV0ZSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09ICdjcmVhdGVkQXQnKSB7XG4gICAgICAgICAgcmV0dXJuVmFsdWVbJ19jcmVhdGVkX2F0J10gPSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgICAgZGVsZXRlIHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PT0gJ3VwZGF0ZWRBdCcpIHtcbiAgICAgICAgICByZXR1cm5WYWx1ZVsnX3VwZGF0ZWRfYXQnXSA9IHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgICBkZWxldGUgcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gcmV0dXJuVmFsdWU7XG4gICAgfVxuICAgIHJldHVybiBwaXBlbGluZTtcbiAgfVxuXG4gIC8vIFRoaXMgZnVuY3Rpb24gaXMgc2xpZ2h0bHkgZGlmZmVyZW50IHRoYW4gdGhlIG9uZSBhYm92ZS4gUmF0aGVyIHRoYW4gdHJ5aW5nIHRvIGNvbWJpbmUgdGhlc2VcbiAgLy8gdHdvIGZ1bmN0aW9ucyBhbmQgbWFraW5nIHRoZSBjb2RlIGV2ZW4gaGFyZGVyIHRvIHVuZGVyc3RhbmQsIEkgZGVjaWRlZCB0byBzcGxpdCBpdCB1cC4gVGhlXG4gIC8vIGRpZmZlcmVuY2Ugd2l0aCB0aGlzIGZ1bmN0aW9uIGlzIHdlIGFyZSBub3QgdHJhbnNmb3JtaW5nIHRoZSB2YWx1ZXMsIG9ubHkgdGhlIGtleXMgb2YgdGhlXG4gIC8vIHBpcGVsaW5lLlxuICBfcGFyc2VBZ2dyZWdhdGVQcm9qZWN0QXJncyhzY2hlbWE6IGFueSwgcGlwZWxpbmU6IGFueSk6IGFueSB7XG4gICAgY29uc3QgcmV0dXJuVmFsdWUgPSB7fTtcbiAgICBmb3IgKGNvbnN0IGZpZWxkIGluIHBpcGVsaW5lKSB7XG4gICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZF0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICAgIHJldHVyblZhbHVlW2BfcF8ke2ZpZWxkfWBdID0gcGlwZWxpbmVbZmllbGRdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuVmFsdWVbZmllbGRdID0gdGhpcy5fcGFyc2VBZ2dyZWdhdGVBcmdzKHNjaGVtYSwgcGlwZWxpbmVbZmllbGRdKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGZpZWxkID09PSAnb2JqZWN0SWQnKSB7XG4gICAgICAgIHJldHVyblZhbHVlWydfaWQnXSA9IHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgZGVsZXRlIHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09ICdjcmVhdGVkQXQnKSB7XG4gICAgICAgIHJldHVyblZhbHVlWydfY3JlYXRlZF9hdCddID0gcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICBkZWxldGUgcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PT0gJ3VwZGF0ZWRBdCcpIHtcbiAgICAgICAgcmV0dXJuVmFsdWVbJ191cGRhdGVkX2F0J10gPSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgIGRlbGV0ZSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXR1cm5WYWx1ZTtcbiAgfVxuXG4gIC8vIFRoaXMgZnVuY3Rpb24gaXMgc2xpZ2h0bHkgZGlmZmVyZW50IHRoYW4gdGhlIHR3byBhYm92ZS4gTW9uZ29EQiAkZ3JvdXAgYWdncmVnYXRlIGxvb2tzIGxpa2U6XG4gIC8vICAgICB7ICRncm91cDogeyBfaWQ6IDxleHByZXNzaW9uPiwgPGZpZWxkMT46IHsgPGFjY3VtdWxhdG9yMT4gOiA8ZXhwcmVzc2lvbjE+IH0sIC4uLiB9IH1cbiAgLy8gVGhlIDxleHByZXNzaW9uPiBjb3VsZCBiZSBhIGNvbHVtbiBuYW1lLCBwcmVmaXhlZCB3aXRoIHRoZSAnJCcgY2hhcmFjdGVyLiBXZSdsbCBsb29rIGZvclxuICAvLyB0aGVzZSA8ZXhwcmVzc2lvbj4gYW5kIGNoZWNrIHRvIHNlZSBpZiBpdCBpcyBhICdQb2ludGVyJyBvciBpZiBpdCdzIG9uZSBvZiBjcmVhdGVkQXQsXG4gIC8vIHVwZGF0ZWRBdCBvciBvYmplY3RJZCBhbmQgY2hhbmdlIGl0IGFjY29yZGluZ2x5LlxuICBfcGFyc2VBZ2dyZWdhdGVHcm91cEFyZ3Moc2NoZW1hOiBhbnksIHBpcGVsaW5lOiBhbnkpOiBhbnkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHBpcGVsaW5lKSkge1xuICAgICAgcmV0dXJuIHBpcGVsaW5lLm1hcCgodmFsdWUpID0+IHRoaXMuX3BhcnNlQWdncmVnYXRlR3JvdXBBcmdzKHNjaGVtYSwgdmFsdWUpKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBwaXBlbGluZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGNvbnN0IHJldHVyblZhbHVlID0ge307XG4gICAgICBmb3IgKGNvbnN0IGZpZWxkIGluIHBpcGVsaW5lKSB7XG4gICAgICAgIHJldHVyblZhbHVlW2ZpZWxkXSA9IHRoaXMuX3BhcnNlQWdncmVnYXRlR3JvdXBBcmdzKHNjaGVtYSwgcGlwZWxpbmVbZmllbGRdKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXR1cm5WYWx1ZTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBwaXBlbGluZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGNvbnN0IGZpZWxkID0gcGlwZWxpbmUuc3Vic3RyaW5nKDEpO1xuICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGRdICYmIHNjaGVtYS5maWVsZHNbZmllbGRdLnR5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgICByZXR1cm4gYCRfcF8ke2ZpZWxkfWA7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkID09ICdjcmVhdGVkQXQnKSB7XG4gICAgICAgIHJldHVybiAnJF9jcmVhdGVkX2F0JztcbiAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT0gJ3VwZGF0ZWRBdCcpIHtcbiAgICAgICAgcmV0dXJuICckX3VwZGF0ZWRfYXQnO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcGlwZWxpbmU7XG4gIH1cblxuICAvLyBUaGlzIGZ1bmN0aW9uIHdpbGwgYXR0ZW1wdCB0byBjb252ZXJ0IHRoZSBwcm92aWRlZCB2YWx1ZSB0byBhIERhdGUgb2JqZWN0LiBTaW5jZSB0aGlzIGlzIHBhcnRcbiAgLy8gb2YgYW4gYWdncmVnYXRpb24gcGlwZWxpbmUsIHRoZSB2YWx1ZSBjYW4gZWl0aGVyIGJlIGEgc3RyaW5nIG9yIGl0IGNhbiBiZSBhbm90aGVyIG9iamVjdCB3aXRoXG4gIC8vIGFuIG9wZXJhdG9yIGluIGl0IChsaWtlICRndCwgJGx0LCBldGMpLiBCZWNhdXNlIG9mIHRoaXMgSSBmZWx0IGl0IHdhcyBlYXNpZXIgdG8gbWFrZSB0aGlzIGFcbiAgLy8gcmVjdXJzaXZlIG1ldGhvZCB0byB0cmF2ZXJzZSBkb3duIHRvIHRoZSBcImxlYWYgbm9kZVwiIHdoaWNoIGlzIGdvaW5nIHRvIGJlIHRoZSBzdHJpbmcuXG4gIF9jb252ZXJ0VG9EYXRlKHZhbHVlOiBhbnkpOiBhbnkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gbmV3IERhdGUodmFsdWUpO1xuICAgIH1cblxuICAgIGNvbnN0IHJldHVyblZhbHVlID0ge31cbiAgICBmb3IgKGNvbnN0IGZpZWxkIGluIHZhbHVlKSB7XG4gICAgICByZXR1cm5WYWx1ZVtmaWVsZF0gPSB0aGlzLl9jb252ZXJ0VG9EYXRlKHZhbHVlW2ZpZWxkXSlcbiAgICB9XG4gICAgcmV0dXJuIHJldHVyblZhbHVlO1xuICB9XG5cbiAgX3BhcnNlUmVhZFByZWZlcmVuY2UocmVhZFByZWZlcmVuY2U6ID9zdHJpbmcpOiA/c3RyaW5nIHtcbiAgICBzd2l0Y2ggKHJlYWRQcmVmZXJlbmNlKSB7XG4gICAgY2FzZSAnUFJJTUFSWSc6XG4gICAgICByZWFkUHJlZmVyZW5jZSA9IFJlYWRQcmVmZXJlbmNlLlBSSU1BUlk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdQUklNQVJZX1BSRUZFUlJFRCc6XG4gICAgICByZWFkUHJlZmVyZW5jZSA9IFJlYWRQcmVmZXJlbmNlLlBSSU1BUllfUFJFRkVSUkVEO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnU0VDT05EQVJZJzpcbiAgICAgIHJlYWRQcmVmZXJlbmNlID0gUmVhZFByZWZlcmVuY2UuU0VDT05EQVJZO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnU0VDT05EQVJZX1BSRUZFUlJFRCc6XG4gICAgICByZWFkUHJlZmVyZW5jZSA9IFJlYWRQcmVmZXJlbmNlLlNFQ09OREFSWV9QUkVGRVJSRUQ7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdORUFSRVNUJzpcbiAgICAgIHJlYWRQcmVmZXJlbmNlID0gUmVhZFByZWZlcmVuY2UuTkVBUkVTVDtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgdW5kZWZpbmVkOlxuICAgICAgYnJlYWs7XG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCAnTm90IHN1cHBvcnRlZCByZWFkIHByZWZlcmVuY2UuJyk7XG4gICAgfVxuICAgIHJldHVybiByZWFkUHJlZmVyZW5jZTtcbiAgfVxuXG4gIHBlcmZvcm1Jbml0aWFsaXphdGlvbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBjcmVhdGVJbmRleChjbGFzc05hbWU6IHN0cmluZywgaW5kZXg6IGFueSkge1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLl9tb25nb0NvbGxlY3Rpb24uY3JlYXRlSW5kZXgoaW5kZXgpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgY3JlYXRlSW5kZXhlcyhjbGFzc05hbWU6IHN0cmluZywgaW5kZXhlczogYW55KSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uX21vbmdvQ29sbGVjdGlvbi5jcmVhdGVJbmRleGVzKGluZGV4ZXMpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgY3JlYXRlSW5kZXhlc0lmTmVlZGVkKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZE5hbWU6IHN0cmluZywgdHlwZTogYW55KSB7XG4gICAgaWYgKHR5cGUgJiYgdHlwZS50eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgIGNvbnN0IGluZGV4ID0ge1xuICAgICAgICBbZmllbGROYW1lXTogJzJkc3BoZXJlJ1xuICAgICAgfTtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZUluZGV4KGNsYXNzTmFtZSwgaW5kZXgpO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBjcmVhdGVUZXh0SW5kZXhlc0lmTmVlZGVkKGNsYXNzTmFtZTogc3RyaW5nLCBxdWVyeTogUXVlcnlUeXBlLCBzY2hlbWE6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGZvcihjb25zdCBmaWVsZE5hbWUgaW4gcXVlcnkpIHtcbiAgICAgIGlmICghcXVlcnlbZmllbGROYW1lXSB8fCAhcXVlcnlbZmllbGROYW1lXS4kdGV4dCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGV4aXN0aW5nSW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuICAgICAgZm9yIChjb25zdCBrZXkgaW4gZXhpc3RpbmdJbmRleGVzKSB7XG4gICAgICAgIGNvbnN0IGluZGV4ID0gZXhpc3RpbmdJbmRleGVzW2tleV07XG4gICAgICAgIGlmIChpbmRleC5oYXNPd25Qcm9wZXJ0eShmaWVsZE5hbWUpKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb25zdCBpbmRleE5hbWUgPSBgJHtmaWVsZE5hbWV9X3RleHRgO1xuICAgICAgY29uc3QgdGV4dEluZGV4ID0ge1xuICAgICAgICBbaW5kZXhOYW1lXTogeyBbZmllbGROYW1lXTogJ3RleHQnIH1cbiAgICAgIH07XG4gICAgICByZXR1cm4gdGhpcy5zZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdChjbGFzc05hbWUsIHRleHRJbmRleCwgZXhpc3RpbmdJbmRleGVzLCBzY2hlbWEuZmllbGRzKVxuICAgICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IDg1KSB7IC8vIEluZGV4IGV4aXN0IHdpdGggZGlmZmVyZW50IG9wdGlvbnNcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNldEluZGV4ZXNGcm9tTW9uZ28oY2xhc3NOYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBnZXRJbmRleGVzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uX21vbmdvQ29sbGVjdGlvbi5pbmRleGVzKCkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBkcm9wSW5kZXgoY2xhc3NOYW1lOiBzdHJpbmcsIGluZGV4OiBhbnkpIHtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLmRyb3BJbmRleChpbmRleCkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBkcm9wQWxsSW5kZXhlcyhjbGFzc05hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLl9tb25nb0NvbGxlY3Rpb24uZHJvcEluZGV4ZXMoKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIHVwZGF0ZVNjaGVtYVdpdGhJbmRleGVzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QWxsQ2xhc3NlcygpXG4gICAgICAudGhlbigoY2xhc3NlcykgPT4ge1xuICAgICAgICBjb25zdCBwcm9taXNlcyA9IGNsYXNzZXMubWFwKChzY2hlbWEpID0+IHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5zZXRJbmRleGVzRnJvbU1vbmdvKHNjaGVtYS5jbGFzc05hbWUpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgTW9uZ29TdG9yYWdlQWRhcHRlcjtcbiJdfQ==