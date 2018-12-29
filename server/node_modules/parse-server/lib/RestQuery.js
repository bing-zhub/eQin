'use strict';

// An object that encapsulates everything we need to run a 'find'
// operation, encoded in the REST API format.

var SchemaController = require('./Controllers/SchemaController');
var Parse = require('parse/node').Parse;
const triggers = require('./triggers');

const AlwaysSelectedKeys = ['objectId', 'createdAt', 'updatedAt'];
// restOptions can include:
//   skip
//   limit
//   order
//   count
//   include
//   keys
//   redirectClassNameForKey
function RestQuery(config, auth, className, restWhere = {}, restOptions = {}, clientSDK) {

  this.config = config;
  this.auth = auth;
  this.className = className;
  this.restWhere = restWhere;
  this.restOptions = restOptions;
  this.clientSDK = clientSDK;
  this.response = null;
  this.findOptions = {};
  this.isWrite = false;

  if (!this.auth.isMaster) {
    if (this.className == '_Session') {
      if (!this.auth.user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token');
      }
      this.restWhere = {
        '$and': [this.restWhere, {
          'user': {
            __type: 'Pointer',
            className: '_User',
            objectId: this.auth.user.id
          }
        }]
      };
    }
  }

  this.doCount = false;
  this.includeAll = false;

  // The format for this.include is not the same as the format for the
  // include option - it's the paths we should include, in order,
  // stored as arrays, taking into account that we need to include foo
  // before including foo.bar. Also it should dedupe.
  // For example, passing an arg of include=foo.bar,foo.baz could lead to
  // this.include = [['foo'], ['foo', 'baz'], ['foo', 'bar']]
  this.include = [];

  // If we have keys, we probably want to force some includes (n-1 level)
  // See issue: https://github.com/parse-community/parse-server/issues/3185
  if (restOptions.hasOwnProperty('keys')) {
    const keysForInclude = restOptions.keys.split(',').filter(key => {
      // At least 2 components
      return key.split(".").length > 1;
    }).map(key => {
      // Slice the last component (a.b.c -> a.b)
      // Otherwise we'll include one level too much.
      return key.slice(0, key.lastIndexOf("."));
    }).join(',');

    // Concat the possibly present include string with the one from the keys
    // Dedup / sorting is handle in 'include' case.
    if (keysForInclude.length > 0) {
      if (!restOptions.include || restOptions.include.length == 0) {
        restOptions.include = keysForInclude;
      } else {
        restOptions.include += "," + keysForInclude;
      }
    }
  }

  for (var option in restOptions) {
    switch (option) {
      case 'keys':
        {
          const keys = restOptions.keys.split(',').concat(AlwaysSelectedKeys);
          this.keys = Array.from(new Set(keys));
          break;
        }
      case 'count':
        this.doCount = true;
        break;
      case 'includeAll':
        this.includeAll = true;
        break;
      case 'distinct':
      case 'pipeline':
      case 'skip':
      case 'limit':
      case 'readPreference':
        this.findOptions[option] = restOptions[option];
        break;
      case 'order':
        var fields = restOptions.order.split(',');
        this.findOptions.sort = fields.reduce((sortMap, field) => {
          field = field.trim();
          if (field === '$score') {
            sortMap.score = { $meta: 'textScore' };
          } else if (field[0] == '-') {
            sortMap[field.slice(1)] = -1;
          } else {
            sortMap[field] = 1;
          }
          return sortMap;
        }, {});
        break;
      case 'include':
        {
          const paths = restOptions.include.split(',');
          // Load the existing includes (from keys)
          const pathSet = paths.reduce((memo, path) => {
            // Split each paths on . (a.b.c -> [a,b,c])
            // reduce to create all paths
            // ([a,b,c] -> {a: true, 'a.b': true, 'a.b.c': true})
            return path.split('.').reduce((memo, path, index, parts) => {
              memo[parts.slice(0, index + 1).join('.')] = true;
              return memo;
            }, memo);
          }, {});

          this.include = Object.keys(pathSet).map(s => {
            return s.split('.');
          }).sort((a, b) => {
            return a.length - b.length; // Sort by number of components
          });
          break;
        }
      case 'redirectClassNameForKey':
        this.redirectKey = restOptions.redirectClassNameForKey;
        this.redirectClassName = null;
        break;
      case 'includeReadPreference':
      case 'subqueryReadPreference':
        break;
      default:
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad option: ' + option);
    }
  }
}

// A convenient method to perform all the steps of processing a query
// in order.
// Returns a promise for the response - an object with optional keys
// 'results' and 'count'.
// TODO: consolidate the replaceX functions
RestQuery.prototype.execute = function (executeOptions) {
  return Promise.resolve().then(() => {
    return this.buildRestWhere();
  }).then(() => {
    return this.handleIncludeAll();
  }).then(() => {
    return this.runFind(executeOptions);
  }).then(() => {
    return this.runCount();
  }).then(() => {
    return this.handleInclude();
  }).then(() => {
    return this.runAfterFindTrigger();
  }).then(() => {
    return this.response;
  });
};

RestQuery.prototype.buildRestWhere = function () {
  return Promise.resolve().then(() => {
    return this.getUserAndRoleACL();
  }).then(() => {
    return this.redirectClassNameForKey();
  }).then(() => {
    return this.validateClientClassCreation();
  }).then(() => {
    return this.replaceSelect();
  }).then(() => {
    return this.replaceDontSelect();
  }).then(() => {
    return this.replaceInQuery();
  }).then(() => {
    return this.replaceNotInQuery();
  }).then(() => {
    return this.replaceEquality();
  });
};

// Marks the query for a write attempt, so we read the proper ACL (write instead of read)
RestQuery.prototype.forWrite = function () {
  this.isWrite = true;
  return this;
};

// Uses the Auth object to get the list of roles, adds the user id
RestQuery.prototype.getUserAndRoleACL = function () {
  if (this.auth.isMaster) {
    return Promise.resolve();
  }

  this.findOptions.acl = ['*'];

  if (this.auth.user) {
    return this.auth.getUserRoles().then(roles => {
      this.findOptions.acl = this.findOptions.acl.concat(roles, [this.auth.user.id]);
      return;
    });
  } else {
    return Promise.resolve();
  }
};

// Changes the className if redirectClassNameForKey is set.
// Returns a promise.
RestQuery.prototype.redirectClassNameForKey = function () {
  if (!this.redirectKey) {
    return Promise.resolve();
  }

  // We need to change the class name based on the schema
  return this.config.database.redirectClassNameForKey(this.className, this.redirectKey).then(newClassName => {
    this.className = newClassName;
    this.redirectClassName = newClassName;
  });
};

// Validates this operation against the allowClientClassCreation config.
RestQuery.prototype.validateClientClassCreation = function () {
  if (this.config.allowClientClassCreation === false && !this.auth.isMaster && SchemaController.systemClasses.indexOf(this.className) === -1) {
    return this.config.database.loadSchema().then(schemaController => schemaController.hasClass(this.className)).then(hasClass => {
      if (hasClass !== true) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This user is not allowed to access ' + 'non-existent class: ' + this.className);
      }
    });
  } else {
    return Promise.resolve();
  }
};

function transformInQuery(inQueryObject, className, results) {
  var values = [];
  for (var result of results) {
    values.push({
      __type: 'Pointer',
      className: className,
      objectId: result.objectId
    });
  }
  delete inQueryObject['$inQuery'];
  if (Array.isArray(inQueryObject['$in'])) {
    inQueryObject['$in'] = inQueryObject['$in'].concat(values);
  } else {
    inQueryObject['$in'] = values;
  }
}

// Replaces a $inQuery clause by running the subquery, if there is an
// $inQuery clause.
// The $inQuery clause turns into an $in with values that are just
// pointers to the objects returned in the subquery.
RestQuery.prototype.replaceInQuery = function () {
  var inQueryObject = findObjectWithKey(this.restWhere, '$inQuery');
  if (!inQueryObject) {
    return;
  }

  // The inQuery value must have precisely two keys - where and className
  var inQueryValue = inQueryObject['$inQuery'];
  if (!inQueryValue.where || !inQueryValue.className) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $inQuery');
  }

  const additionalOptions = {
    redirectClassNameForKey: inQueryValue.redirectClassNameForKey
  };

  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  }

  var subquery = new RestQuery(this.config, this.auth, inQueryValue.className, inQueryValue.where, additionalOptions);
  return subquery.execute().then(response => {
    transformInQuery(inQueryObject, subquery.className, response.results);
    // Recurse to repeat
    return this.replaceInQuery();
  });
};

function transformNotInQuery(notInQueryObject, className, results) {
  var values = [];
  for (var result of results) {
    values.push({
      __type: 'Pointer',
      className: className,
      objectId: result.objectId
    });
  }
  delete notInQueryObject['$notInQuery'];
  if (Array.isArray(notInQueryObject['$nin'])) {
    notInQueryObject['$nin'] = notInQueryObject['$nin'].concat(values);
  } else {
    notInQueryObject['$nin'] = values;
  }
}

// Replaces a $notInQuery clause by running the subquery, if there is an
// $notInQuery clause.
// The $notInQuery clause turns into a $nin with values that are just
// pointers to the objects returned in the subquery.
RestQuery.prototype.replaceNotInQuery = function () {
  var notInQueryObject = findObjectWithKey(this.restWhere, '$notInQuery');
  if (!notInQueryObject) {
    return;
  }

  // The notInQuery value must have precisely two keys - where and className
  var notInQueryValue = notInQueryObject['$notInQuery'];
  if (!notInQueryValue.where || !notInQueryValue.className) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $notInQuery');
  }

  const additionalOptions = {
    redirectClassNameForKey: notInQueryValue.redirectClassNameForKey
  };

  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  }

  var subquery = new RestQuery(this.config, this.auth, notInQueryValue.className, notInQueryValue.where, additionalOptions);
  return subquery.execute().then(response => {
    transformNotInQuery(notInQueryObject, subquery.className, response.results);
    // Recurse to repeat
    return this.replaceNotInQuery();
  });
};

const transformSelect = (selectObject, key, objects) => {
  var values = [];
  for (var result of objects) {
    values.push(key.split('.').reduce((o, i) => o[i], result));
  }
  delete selectObject['$select'];
  if (Array.isArray(selectObject['$in'])) {
    selectObject['$in'] = selectObject['$in'].concat(values);
  } else {
    selectObject['$in'] = values;
  }
};

// Replaces a $select clause by running the subquery, if there is a
// $select clause.
// The $select clause turns into an $in with values selected out of
// the subquery.
// Returns a possible-promise.
RestQuery.prototype.replaceSelect = function () {
  var selectObject = findObjectWithKey(this.restWhere, '$select');
  if (!selectObject) {
    return;
  }

  // The select value must have precisely two keys - query and key
  var selectValue = selectObject['$select'];
  // iOS SDK don't send where if not set, let it pass
  if (!selectValue.query || !selectValue.key || typeof selectValue.query !== 'object' || !selectValue.query.className || Object.keys(selectValue).length !== 2) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $select');
  }

  const additionalOptions = {
    redirectClassNameForKey: selectValue.query.redirectClassNameForKey
  };

  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  }

  var subquery = new RestQuery(this.config, this.auth, selectValue.query.className, selectValue.query.where, additionalOptions);
  return subquery.execute().then(response => {
    transformSelect(selectObject, selectValue.key, response.results);
    // Keep replacing $select clauses
    return this.replaceSelect();
  });
};

const transformDontSelect = (dontSelectObject, key, objects) => {
  var values = [];
  for (var result of objects) {
    values.push(key.split('.').reduce((o, i) => o[i], result));
  }
  delete dontSelectObject['$dontSelect'];
  if (Array.isArray(dontSelectObject['$nin'])) {
    dontSelectObject['$nin'] = dontSelectObject['$nin'].concat(values);
  } else {
    dontSelectObject['$nin'] = values;
  }
};

// Replaces a $dontSelect clause by running the subquery, if there is a
// $dontSelect clause.
// The $dontSelect clause turns into an $nin with values selected out of
// the subquery.
// Returns a possible-promise.
RestQuery.prototype.replaceDontSelect = function () {
  var dontSelectObject = findObjectWithKey(this.restWhere, '$dontSelect');
  if (!dontSelectObject) {
    return;
  }

  // The dontSelect value must have precisely two keys - query and key
  var dontSelectValue = dontSelectObject['$dontSelect'];
  if (!dontSelectValue.query || !dontSelectValue.key || typeof dontSelectValue.query !== 'object' || !dontSelectValue.query.className || Object.keys(dontSelectValue).length !== 2) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $dontSelect');
  }
  const additionalOptions = {
    redirectClassNameForKey: dontSelectValue.query.redirectClassNameForKey
  };

  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  }

  var subquery = new RestQuery(this.config, this.auth, dontSelectValue.query.className, dontSelectValue.query.where, additionalOptions);
  return subquery.execute().then(response => {
    transformDontSelect(dontSelectObject, dontSelectValue.key, response.results);
    // Keep replacing $dontSelect clauses
    return this.replaceDontSelect();
  });
};

const cleanResultOfSensitiveUserInfo = function (result, auth, config) {
  delete result.password;

  if (auth.isMaster || auth.user && auth.user.id === result.objectId) {
    return;
  }

  for (const field of config.userSensitiveFields) {
    delete result[field];
  }
};

const cleanResultAuthData = function (result) {
  if (result.authData) {
    Object.keys(result.authData).forEach(provider => {
      if (result.authData[provider] === null) {
        delete result.authData[provider];
      }
    });

    if (Object.keys(result.authData).length == 0) {
      delete result.authData;
    }
  }
};

const replaceEqualityConstraint = constraint => {
  if (typeof constraint !== 'object') {
    return constraint;
  }
  const equalToObject = {};
  let hasDirectConstraint = false;
  let hasOperatorConstraint = false;
  for (const key in constraint) {
    if (key.indexOf('$') !== 0) {
      hasDirectConstraint = true;
      equalToObject[key] = constraint[key];
    } else {
      hasOperatorConstraint = true;
    }
  }
  if (hasDirectConstraint && hasOperatorConstraint) {
    constraint['$eq'] = equalToObject;
    Object.keys(equalToObject).forEach(key => {
      delete constraint[key];
    });
  }
  return constraint;
};

RestQuery.prototype.replaceEquality = function () {
  if (typeof this.restWhere !== 'object') {
    return;
  }
  for (const key in this.restWhere) {
    this.restWhere[key] = replaceEqualityConstraint(this.restWhere[key]);
  }
};

// Returns a promise for whether it was successful.
// Populates this.response with an object that only has 'results'.
RestQuery.prototype.runFind = function (options = {}) {
  if (this.findOptions.limit === 0) {
    this.response = { results: [] };
    return Promise.resolve();
  }
  const findOptions = Object.assign({}, this.findOptions);
  if (this.keys) {
    findOptions.keys = this.keys.map(key => {
      return key.split('.')[0];
    });
  }
  if (options.op) {
    findOptions.op = options.op;
  }
  if (this.isWrite) {
    findOptions.isWrite = true;
  }
  return this.config.database.find(this.className, this.restWhere, findOptions).then(results => {
    if (this.className === '_User') {
      for (var result of results) {
        cleanResultOfSensitiveUserInfo(result, this.auth, this.config);
        cleanResultAuthData(result);
      }
    }

    this.config.filesController.expandFilesInObject(this.config, results);

    if (this.redirectClassName) {
      for (var r of results) {
        r.className = this.redirectClassName;
      }
    }
    this.response = { results: results };
  });
};

// Returns a promise for whether it was successful.
// Populates this.response.count with the count
RestQuery.prototype.runCount = function () {
  if (!this.doCount) {
    return;
  }
  this.findOptions.count = true;
  delete this.findOptions.skip;
  delete this.findOptions.limit;
  return this.config.database.find(this.className, this.restWhere, this.findOptions).then(c => {
    this.response.count = c;
  });
};

// Augments this.response with all pointers on an object
RestQuery.prototype.handleIncludeAll = function () {
  if (!this.includeAll) {
    return;
  }
  return this.config.database.loadSchema().then(schemaController => schemaController.getOneSchema(this.className)).then(schema => {
    const includeFields = [];
    const keyFields = [];
    for (const field in schema.fields) {
      if (schema.fields[field].type && schema.fields[field].type === 'Pointer') {
        includeFields.push([field]);
        keyFields.push(field);
      }
    }
    // Add fields to include, keys, remove dups
    this.include = [...new Set([...this.include, ...includeFields])];
    // if this.keys not set, then all keys are already included
    if (this.keys) {
      this.keys = [...new Set([...this.keys, ...keyFields])];
    }
  });
};

// Augments this.response with data at the paths provided in this.include.
RestQuery.prototype.handleInclude = function () {
  if (this.include.length == 0) {
    return;
  }

  var pathResponse = includePath(this.config, this.auth, this.response, this.include[0], this.restOptions);
  if (pathResponse.then) {
    return pathResponse.then(newResponse => {
      this.response = newResponse;
      this.include = this.include.slice(1);
      return this.handleInclude();
    });
  } else if (this.include.length > 0) {
    this.include = this.include.slice(1);
    return this.handleInclude();
  }

  return pathResponse;
};

//Returns a promise of a processed set of results
RestQuery.prototype.runAfterFindTrigger = function () {
  if (!this.response) {
    return;
  }
  // Avoid doing any setup for triggers if there is no 'afterFind' trigger for this class.
  const hasAfterFindHook = triggers.triggerExists(this.className, triggers.Types.afterFind, this.config.applicationId);
  if (!hasAfterFindHook) {
    return Promise.resolve();
  }
  // Skip Aggregate and Distinct Queries
  if (this.findOptions.pipeline || this.findOptions.distinct) {
    return Promise.resolve();
  }
  // Run afterFind trigger and set the new results
  return triggers.maybeRunAfterFindTrigger(triggers.Types.afterFind, this.auth, this.className, this.response.results, this.config).then(results => {
    // Ensure we properly set the className back
    if (this.redirectClassName) {
      this.response.results = results.map(object => {
        if (object instanceof Parse.Object) {
          object = object.toJSON();
        }
        object.className = this.redirectClassName;
        return object;
      });
    } else {
      this.response.results = results;
    }
  });
};

// Adds included values to the response.
// Path is a list of field names.
// Returns a promise for an augmented response.
function includePath(config, auth, response, path, restOptions = {}) {
  var pointers = findPointers(response.results, path);
  if (pointers.length == 0) {
    return response;
  }
  const pointersHash = {};
  for (var pointer of pointers) {
    if (!pointer) {
      continue;
    }
    const className = pointer.className;
    // only include the good pointers
    if (className) {
      pointersHash[className] = pointersHash[className] || new Set();
      pointersHash[className].add(pointer.objectId);
    }
  }
  const includeRestOptions = {};
  if (restOptions.keys) {
    const keys = new Set(restOptions.keys.split(','));
    const keySet = Array.from(keys).reduce((set, key) => {
      const keyPath = key.split('.');
      let i = 0;
      for (i; i < path.length; i++) {
        if (path[i] != keyPath[i]) {
          return set;
        }
      }
      if (i < keyPath.length) {
        set.add(keyPath[i]);
      }
      return set;
    }, new Set());
    if (keySet.size > 0) {
      includeRestOptions.keys = Array.from(keySet).join(',');
    }
  }

  if (restOptions.includeReadPreference) {
    includeRestOptions.readPreference = restOptions.includeReadPreference;
    includeRestOptions.includeReadPreference = restOptions.includeReadPreference;
  }

  const queryPromises = Object.keys(pointersHash).map(className => {
    const objectIds = Array.from(pointersHash[className]);
    let where;
    if (objectIds.length === 1) {
      where = { 'objectId': objectIds[0] };
    } else {
      where = { 'objectId': { '$in': objectIds } };
    }
    var query = new RestQuery(config, auth, className, where, includeRestOptions);
    return query.execute({ op: 'get' }).then(results => {
      results.className = className;
      return Promise.resolve(results);
    });
  });

  // Get the objects for all these object ids
  return Promise.all(queryPromises).then(responses => {
    var replace = responses.reduce((replace, includeResponse) => {
      for (var obj of includeResponse.results) {
        obj.__type = 'Object';
        obj.className = includeResponse.className;

        if (obj.className == "_User" && !auth.isMaster) {
          delete obj.sessionToken;
          delete obj.authData;
        }
        replace[obj.objectId] = obj;
      }
      return replace;
    }, {});

    var resp = {
      results: replacePointers(response.results, path, replace)
    };
    if (response.count) {
      resp.count = response.count;
    }
    return resp;
  });
}

// Object may be a list of REST-format object to find pointers in, or
// it may be a single object.
// If the path yields things that aren't pointers, this throws an error.
// Path is a list of fields to search into.
// Returns a list of pointers in REST format.
function findPointers(object, path) {
  if (object instanceof Array) {
    var answer = [];
    for (var x of object) {
      answer = answer.concat(findPointers(x, path));
    }
    return answer;
  }

  if (typeof object !== 'object' || !object) {
    return [];
  }

  if (path.length == 0) {
    if (object === null || object.__type == 'Pointer') {
      return [object];
    }
    return [];
  }

  var subobject = object[path[0]];
  if (!subobject) {
    return [];
  }
  return findPointers(subobject, path.slice(1));
}

// Object may be a list of REST-format objects to replace pointers
// in, or it may be a single object.
// Path is a list of fields to search into.
// replace is a map from object id -> object.
// Returns something analogous to object, but with the appropriate
// pointers inflated.
function replacePointers(object, path, replace) {
  if (object instanceof Array) {
    return object.map(obj => replacePointers(obj, path, replace)).filter(obj => typeof obj !== 'undefined');
  }

  if (typeof object !== 'object' || !object) {
    return object;
  }

  if (path.length === 0) {
    if (object && object.__type === 'Pointer') {
      return replace[object.objectId];
    }
    return object;
  }

  var subobject = object[path[0]];
  if (!subobject) {
    return object;
  }
  var newsub = replacePointers(subobject, path.slice(1), replace);
  var answer = {};
  for (var key in object) {
    if (key == path[0]) {
      answer[key] = newsub;
    } else {
      answer[key] = object[key];
    }
  }
  return answer;
}

// Finds a subobject that has the given key, if there is one.
// Returns undefined otherwise.
function findObjectWithKey(root, key) {
  if (typeof root !== 'object') {
    return;
  }
  if (root instanceof Array) {
    for (var item of root) {
      const answer = findObjectWithKey(item, key);
      if (answer) {
        return answer;
      }
    }
  }
  if (root && root[key]) {
    return root;
  }
  for (var subkey in root) {
    const answer = findObjectWithKey(root[subkey], key);
    if (answer) {
      return answer;
    }
  }
}

module.exports = RestQuery;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9SZXN0UXVlcnkuanMiXSwibmFtZXMiOlsiU2NoZW1hQ29udHJvbGxlciIsInJlcXVpcmUiLCJQYXJzZSIsInRyaWdnZXJzIiwiQWx3YXlzU2VsZWN0ZWRLZXlzIiwiUmVzdFF1ZXJ5IiwiY29uZmlnIiwiYXV0aCIsImNsYXNzTmFtZSIsInJlc3RXaGVyZSIsInJlc3RPcHRpb25zIiwiY2xpZW50U0RLIiwicmVzcG9uc2UiLCJmaW5kT3B0aW9ucyIsImlzV3JpdGUiLCJpc01hc3RlciIsInVzZXIiLCJFcnJvciIsIklOVkFMSURfU0VTU0lPTl9UT0tFTiIsIl9fdHlwZSIsIm9iamVjdElkIiwiaWQiLCJkb0NvdW50IiwiaW5jbHVkZUFsbCIsImluY2x1ZGUiLCJoYXNPd25Qcm9wZXJ0eSIsImtleXNGb3JJbmNsdWRlIiwia2V5cyIsInNwbGl0IiwiZmlsdGVyIiwia2V5IiwibGVuZ3RoIiwibWFwIiwic2xpY2UiLCJsYXN0SW5kZXhPZiIsImpvaW4iLCJvcHRpb24iLCJjb25jYXQiLCJBcnJheSIsImZyb20iLCJTZXQiLCJmaWVsZHMiLCJvcmRlciIsInNvcnQiLCJyZWR1Y2UiLCJzb3J0TWFwIiwiZmllbGQiLCJ0cmltIiwic2NvcmUiLCIkbWV0YSIsInBhdGhzIiwicGF0aFNldCIsIm1lbW8iLCJwYXRoIiwiaW5kZXgiLCJwYXJ0cyIsIk9iamVjdCIsInMiLCJhIiwiYiIsInJlZGlyZWN0S2V5IiwicmVkaXJlY3RDbGFzc05hbWVGb3JLZXkiLCJyZWRpcmVjdENsYXNzTmFtZSIsIklOVkFMSURfSlNPTiIsInByb3RvdHlwZSIsImV4ZWN1dGUiLCJleGVjdXRlT3B0aW9ucyIsIlByb21pc2UiLCJyZXNvbHZlIiwidGhlbiIsImJ1aWxkUmVzdFdoZXJlIiwiaGFuZGxlSW5jbHVkZUFsbCIsInJ1bkZpbmQiLCJydW5Db3VudCIsImhhbmRsZUluY2x1ZGUiLCJydW5BZnRlckZpbmRUcmlnZ2VyIiwiZ2V0VXNlckFuZFJvbGVBQ0wiLCJ2YWxpZGF0ZUNsaWVudENsYXNzQ3JlYXRpb24iLCJyZXBsYWNlU2VsZWN0IiwicmVwbGFjZURvbnRTZWxlY3QiLCJyZXBsYWNlSW5RdWVyeSIsInJlcGxhY2VOb3RJblF1ZXJ5IiwicmVwbGFjZUVxdWFsaXR5IiwiZm9yV3JpdGUiLCJhY2wiLCJnZXRVc2VyUm9sZXMiLCJyb2xlcyIsImRhdGFiYXNlIiwibmV3Q2xhc3NOYW1lIiwiYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uIiwic3lzdGVtQ2xhc3NlcyIsImluZGV4T2YiLCJsb2FkU2NoZW1hIiwic2NoZW1hQ29udHJvbGxlciIsImhhc0NsYXNzIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsInRyYW5zZm9ybUluUXVlcnkiLCJpblF1ZXJ5T2JqZWN0IiwicmVzdWx0cyIsInZhbHVlcyIsInJlc3VsdCIsInB1c2giLCJpc0FycmF5IiwiZmluZE9iamVjdFdpdGhLZXkiLCJpblF1ZXJ5VmFsdWUiLCJ3aGVyZSIsIklOVkFMSURfUVVFUlkiLCJhZGRpdGlvbmFsT3B0aW9ucyIsInN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UiLCJyZWFkUHJlZmVyZW5jZSIsInN1YnF1ZXJ5IiwidHJhbnNmb3JtTm90SW5RdWVyeSIsIm5vdEluUXVlcnlPYmplY3QiLCJub3RJblF1ZXJ5VmFsdWUiLCJ0cmFuc2Zvcm1TZWxlY3QiLCJzZWxlY3RPYmplY3QiLCJvYmplY3RzIiwibyIsImkiLCJzZWxlY3RWYWx1ZSIsInF1ZXJ5IiwidHJhbnNmb3JtRG9udFNlbGVjdCIsImRvbnRTZWxlY3RPYmplY3QiLCJkb250U2VsZWN0VmFsdWUiLCJjbGVhblJlc3VsdE9mU2Vuc2l0aXZlVXNlckluZm8iLCJwYXNzd29yZCIsInVzZXJTZW5zaXRpdmVGaWVsZHMiLCJjbGVhblJlc3VsdEF1dGhEYXRhIiwiYXV0aERhdGEiLCJmb3JFYWNoIiwicHJvdmlkZXIiLCJyZXBsYWNlRXF1YWxpdHlDb25zdHJhaW50IiwiY29uc3RyYWludCIsImVxdWFsVG9PYmplY3QiLCJoYXNEaXJlY3RDb25zdHJhaW50IiwiaGFzT3BlcmF0b3JDb25zdHJhaW50Iiwib3B0aW9ucyIsImxpbWl0IiwiYXNzaWduIiwib3AiLCJmaW5kIiwiZmlsZXNDb250cm9sbGVyIiwiZXhwYW5kRmlsZXNJbk9iamVjdCIsInIiLCJjb3VudCIsInNraXAiLCJjIiwiZ2V0T25lU2NoZW1hIiwic2NoZW1hIiwiaW5jbHVkZUZpZWxkcyIsImtleUZpZWxkcyIsInR5cGUiLCJwYXRoUmVzcG9uc2UiLCJpbmNsdWRlUGF0aCIsIm5ld1Jlc3BvbnNlIiwiaGFzQWZ0ZXJGaW5kSG9vayIsInRyaWdnZXJFeGlzdHMiLCJUeXBlcyIsImFmdGVyRmluZCIsImFwcGxpY2F0aW9uSWQiLCJwaXBlbGluZSIsImRpc3RpbmN0IiwibWF5YmVSdW5BZnRlckZpbmRUcmlnZ2VyIiwib2JqZWN0IiwidG9KU09OIiwicG9pbnRlcnMiLCJmaW5kUG9pbnRlcnMiLCJwb2ludGVyc0hhc2giLCJwb2ludGVyIiwiYWRkIiwiaW5jbHVkZVJlc3RPcHRpb25zIiwia2V5U2V0Iiwic2V0Iiwia2V5UGF0aCIsInNpemUiLCJpbmNsdWRlUmVhZFByZWZlcmVuY2UiLCJxdWVyeVByb21pc2VzIiwib2JqZWN0SWRzIiwiYWxsIiwicmVzcG9uc2VzIiwicmVwbGFjZSIsImluY2x1ZGVSZXNwb25zZSIsIm9iaiIsInNlc3Npb25Ub2tlbiIsInJlc3AiLCJyZXBsYWNlUG9pbnRlcnMiLCJhbnN3ZXIiLCJ4Iiwic3Vib2JqZWN0IiwibmV3c3ViIiwicm9vdCIsIml0ZW0iLCJzdWJrZXkiLCJtb2R1bGUiLCJleHBvcnRzIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7O0FBRUEsSUFBSUEsbUJBQW1CQyxRQUFRLGdDQUFSLENBQXZCO0FBQ0EsSUFBSUMsUUFBUUQsUUFBUSxZQUFSLEVBQXNCQyxLQUFsQztBQUNBLE1BQU1DLFdBQVdGLFFBQVEsWUFBUixDQUFqQjs7QUFFQSxNQUFNRyxxQkFBcUIsQ0FBQyxVQUFELEVBQWEsV0FBYixFQUEwQixXQUExQixDQUEzQjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTQyxTQUFULENBQW1CQyxNQUFuQixFQUEyQkMsSUFBM0IsRUFBaUNDLFNBQWpDLEVBQTRDQyxZQUFZLEVBQXhELEVBQTREQyxjQUFjLEVBQTFFLEVBQThFQyxTQUE5RSxFQUF5Rjs7QUFFdkYsT0FBS0wsTUFBTCxHQUFjQSxNQUFkO0FBQ0EsT0FBS0MsSUFBTCxHQUFZQSxJQUFaO0FBQ0EsT0FBS0MsU0FBTCxHQUFpQkEsU0FBakI7QUFDQSxPQUFLQyxTQUFMLEdBQWlCQSxTQUFqQjtBQUNBLE9BQUtDLFdBQUwsR0FBbUJBLFdBQW5CO0FBQ0EsT0FBS0MsU0FBTCxHQUFpQkEsU0FBakI7QUFDQSxPQUFLQyxRQUFMLEdBQWdCLElBQWhCO0FBQ0EsT0FBS0MsV0FBTCxHQUFtQixFQUFuQjtBQUNBLE9BQUtDLE9BQUwsR0FBZSxLQUFmOztBQUVBLE1BQUksQ0FBQyxLQUFLUCxJQUFMLENBQVVRLFFBQWYsRUFBeUI7QUFDdkIsUUFBSSxLQUFLUCxTQUFMLElBQWtCLFVBQXRCLEVBQWtDO0FBQ2hDLFVBQUksQ0FBQyxLQUFLRCxJQUFMLENBQVVTLElBQWYsRUFBcUI7QUFDbkIsY0FBTSxJQUFJZCxNQUFNZSxLQUFWLENBQWdCZixNQUFNZSxLQUFOLENBQVlDLHFCQUE1QixFQUNKLHVCQURJLENBQU47QUFFRDtBQUNELFdBQUtULFNBQUwsR0FBaUI7QUFDZixnQkFBUSxDQUFDLEtBQUtBLFNBQU4sRUFBaUI7QUFDdkIsa0JBQVE7QUFDTlUsb0JBQVEsU0FERjtBQUVOWCx1QkFBVyxPQUZMO0FBR05ZLHNCQUFVLEtBQUtiLElBQUwsQ0FBVVMsSUFBVixDQUFlSztBQUhuQjtBQURlLFNBQWpCO0FBRE8sT0FBakI7QUFTRDtBQUNGOztBQUVELE9BQUtDLE9BQUwsR0FBZSxLQUFmO0FBQ0EsT0FBS0MsVUFBTCxHQUFrQixLQUFsQjs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxPQUFLQyxPQUFMLEdBQWUsRUFBZjs7QUFFQTtBQUNBO0FBQ0EsTUFBSWQsWUFBWWUsY0FBWixDQUEyQixNQUEzQixDQUFKLEVBQXdDO0FBQ3RDLFVBQU1DLGlCQUFpQmhCLFlBQVlpQixJQUFaLENBQWlCQyxLQUFqQixDQUF1QixHQUF2QixFQUE0QkMsTUFBNUIsQ0FBb0NDLEdBQUQsSUFBUztBQUNqRTtBQUNBLGFBQU9BLElBQUlGLEtBQUosQ0FBVSxHQUFWLEVBQWVHLE1BQWYsR0FBd0IsQ0FBL0I7QUFDRCxLQUhzQixFQUdwQkMsR0FIb0IsQ0FHZkYsR0FBRCxJQUFTO0FBQ2Q7QUFDQTtBQUNBLGFBQU9BLElBQUlHLEtBQUosQ0FBVSxDQUFWLEVBQWFILElBQUlJLFdBQUosQ0FBZ0IsR0FBaEIsQ0FBYixDQUFQO0FBQ0QsS0FQc0IsRUFPcEJDLElBUG9CLENBT2YsR0FQZSxDQUF2Qjs7QUFTQTtBQUNBO0FBQ0EsUUFBSVQsZUFBZUssTUFBZixHQUF3QixDQUE1QixFQUErQjtBQUM3QixVQUFJLENBQUNyQixZQUFZYyxPQUFiLElBQXdCZCxZQUFZYyxPQUFaLENBQW9CTyxNQUFwQixJQUE4QixDQUExRCxFQUE2RDtBQUMzRHJCLG9CQUFZYyxPQUFaLEdBQXNCRSxjQUF0QjtBQUNELE9BRkQsTUFFTztBQUNMaEIsb0JBQVljLE9BQVosSUFBdUIsTUFBTUUsY0FBN0I7QUFDRDtBQUNGO0FBQ0Y7O0FBRUQsT0FBSyxJQUFJVSxNQUFULElBQW1CMUIsV0FBbkIsRUFBZ0M7QUFDOUIsWUFBTzBCLE1BQVA7QUFDQSxXQUFLLE1BQUw7QUFBYTtBQUNYLGdCQUFNVCxPQUFPakIsWUFBWWlCLElBQVosQ0FBaUJDLEtBQWpCLENBQXVCLEdBQXZCLEVBQTRCUyxNQUE1QixDQUFtQ2pDLGtCQUFuQyxDQUFiO0FBQ0EsZUFBS3VCLElBQUwsR0FBWVcsTUFBTUMsSUFBTixDQUFXLElBQUlDLEdBQUosQ0FBUWIsSUFBUixDQUFYLENBQVo7QUFDQTtBQUNEO0FBQ0QsV0FBSyxPQUFMO0FBQ0UsYUFBS0wsT0FBTCxHQUFlLElBQWY7QUFDQTtBQUNGLFdBQUssWUFBTDtBQUNFLGFBQUtDLFVBQUwsR0FBa0IsSUFBbEI7QUFDQTtBQUNGLFdBQUssVUFBTDtBQUNBLFdBQUssVUFBTDtBQUNBLFdBQUssTUFBTDtBQUNBLFdBQUssT0FBTDtBQUNBLFdBQUssZ0JBQUw7QUFDRSxhQUFLVixXQUFMLENBQWlCdUIsTUFBakIsSUFBMkIxQixZQUFZMEIsTUFBWixDQUEzQjtBQUNBO0FBQ0YsV0FBSyxPQUFMO0FBQ0UsWUFBSUssU0FBUy9CLFlBQVlnQyxLQUFaLENBQWtCZCxLQUFsQixDQUF3QixHQUF4QixDQUFiO0FBQ0EsYUFBS2YsV0FBTCxDQUFpQjhCLElBQWpCLEdBQXdCRixPQUFPRyxNQUFQLENBQWMsQ0FBQ0MsT0FBRCxFQUFVQyxLQUFWLEtBQW9CO0FBQ3hEQSxrQkFBUUEsTUFBTUMsSUFBTixFQUFSO0FBQ0EsY0FBSUQsVUFBVSxRQUFkLEVBQXdCO0FBQ3RCRCxvQkFBUUcsS0FBUixHQUFnQixFQUFDQyxPQUFPLFdBQVIsRUFBaEI7QUFDRCxXQUZELE1BRU8sSUFBSUgsTUFBTSxDQUFOLEtBQVksR0FBaEIsRUFBcUI7QUFDMUJELG9CQUFRQyxNQUFNYixLQUFOLENBQVksQ0FBWixDQUFSLElBQTBCLENBQUMsQ0FBM0I7QUFDRCxXQUZNLE1BRUE7QUFDTFksb0JBQVFDLEtBQVIsSUFBaUIsQ0FBakI7QUFDRDtBQUNELGlCQUFPRCxPQUFQO0FBQ0QsU0FWdUIsRUFVckIsRUFWcUIsQ0FBeEI7QUFXQTtBQUNGLFdBQUssU0FBTDtBQUFnQjtBQUNkLGdCQUFNSyxRQUFReEMsWUFBWWMsT0FBWixDQUFvQkksS0FBcEIsQ0FBMEIsR0FBMUIsQ0FBZDtBQUNBO0FBQ0EsZ0JBQU11QixVQUFVRCxNQUFNTixNQUFOLENBQWEsQ0FBQ1EsSUFBRCxFQUFPQyxJQUFQLEtBQWdCO0FBQzNDO0FBQ0E7QUFDQTtBQUNBLG1CQUFPQSxLQUFLekIsS0FBTCxDQUFXLEdBQVgsRUFBZ0JnQixNQUFoQixDQUF1QixDQUFDUSxJQUFELEVBQU9DLElBQVAsRUFBYUMsS0FBYixFQUFvQkMsS0FBcEIsS0FBOEI7QUFDMURILG1CQUFLRyxNQUFNdEIsS0FBTixDQUFZLENBQVosRUFBZXFCLFFBQVEsQ0FBdkIsRUFBMEJuQixJQUExQixDQUErQixHQUEvQixDQUFMLElBQTRDLElBQTVDO0FBQ0EscUJBQU9pQixJQUFQO0FBQ0QsYUFITSxFQUdKQSxJQUhJLENBQVA7QUFJRCxXQVJlLEVBUWIsRUFSYSxDQUFoQjs7QUFVQSxlQUFLNUIsT0FBTCxHQUFlZ0MsT0FBTzdCLElBQVAsQ0FBWXdCLE9BQVosRUFBcUJuQixHQUFyQixDQUEwQnlCLENBQUQsSUFBTztBQUM3QyxtQkFBT0EsRUFBRTdCLEtBQUYsQ0FBUSxHQUFSLENBQVA7QUFDRCxXQUZjLEVBRVplLElBRlksQ0FFUCxDQUFDZSxDQUFELEVBQUlDLENBQUosS0FBVTtBQUNoQixtQkFBT0QsRUFBRTNCLE1BQUYsR0FBVzRCLEVBQUU1QixNQUFwQixDQURnQixDQUNZO0FBQzdCLFdBSmMsQ0FBZjtBQUtBO0FBQ0Q7QUFDRCxXQUFLLHlCQUFMO0FBQ0UsYUFBSzZCLFdBQUwsR0FBbUJsRCxZQUFZbUQsdUJBQS9CO0FBQ0EsYUFBS0MsaUJBQUwsR0FBeUIsSUFBekI7QUFDQTtBQUNGLFdBQUssdUJBQUw7QUFDQSxXQUFLLHdCQUFMO0FBQ0U7QUFDRjtBQUNFLGNBQU0sSUFBSTVELE1BQU1lLEtBQVYsQ0FBZ0JmLE1BQU1lLEtBQU4sQ0FBWThDLFlBQTVCLEVBQ0osaUJBQWlCM0IsTUFEYixDQUFOO0FBN0RGO0FBZ0VEO0FBQ0Y7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBL0IsVUFBVTJELFNBQVYsQ0FBb0JDLE9BQXBCLEdBQThCLFVBQVNDLGNBQVQsRUFBeUI7QUFDckQsU0FBT0MsUUFBUUMsT0FBUixHQUFrQkMsSUFBbEIsQ0FBdUIsTUFBTTtBQUNsQyxXQUFPLEtBQUtDLGNBQUwsRUFBUDtBQUNELEdBRk0sRUFFSkQsSUFGSSxDQUVDLE1BQU07QUFDWixXQUFPLEtBQUtFLGdCQUFMLEVBQVA7QUFDRCxHQUpNLEVBSUpGLElBSkksQ0FJQyxNQUFNO0FBQ1osV0FBTyxLQUFLRyxPQUFMLENBQWFOLGNBQWIsQ0FBUDtBQUNELEdBTk0sRUFNSkcsSUFOSSxDQU1DLE1BQU07QUFDWixXQUFPLEtBQUtJLFFBQUwsRUFBUDtBQUNELEdBUk0sRUFRSkosSUFSSSxDQVFDLE1BQU07QUFDWixXQUFPLEtBQUtLLGFBQUwsRUFBUDtBQUNELEdBVk0sRUFVSkwsSUFWSSxDQVVDLE1BQU07QUFDWixXQUFPLEtBQUtNLG1CQUFMLEVBQVA7QUFDRCxHQVpNLEVBWUpOLElBWkksQ0FZQyxNQUFNO0FBQ1osV0FBTyxLQUFLekQsUUFBWjtBQUNELEdBZE0sQ0FBUDtBQWVELENBaEJEOztBQWtCQVAsVUFBVTJELFNBQVYsQ0FBb0JNLGNBQXBCLEdBQXFDLFlBQVc7QUFDOUMsU0FBT0gsUUFBUUMsT0FBUixHQUFrQkMsSUFBbEIsQ0FBdUIsTUFBTTtBQUNsQyxXQUFPLEtBQUtPLGlCQUFMLEVBQVA7QUFDRCxHQUZNLEVBRUpQLElBRkksQ0FFQyxNQUFNO0FBQ1osV0FBTyxLQUFLUix1QkFBTCxFQUFQO0FBQ0QsR0FKTSxFQUlKUSxJQUpJLENBSUMsTUFBTTtBQUNaLFdBQU8sS0FBS1EsMkJBQUwsRUFBUDtBQUNELEdBTk0sRUFNSlIsSUFOSSxDQU1DLE1BQU07QUFDWixXQUFPLEtBQUtTLGFBQUwsRUFBUDtBQUNELEdBUk0sRUFRSlQsSUFSSSxDQVFDLE1BQU07QUFDWixXQUFPLEtBQUtVLGlCQUFMLEVBQVA7QUFDRCxHQVZNLEVBVUpWLElBVkksQ0FVQyxNQUFNO0FBQ1osV0FBTyxLQUFLVyxjQUFMLEVBQVA7QUFDRCxHQVpNLEVBWUpYLElBWkksQ0FZQyxNQUFNO0FBQ1osV0FBTyxLQUFLWSxpQkFBTCxFQUFQO0FBQ0QsR0FkTSxFQWNKWixJQWRJLENBY0MsTUFBTTtBQUNaLFdBQU8sS0FBS2EsZUFBTCxFQUFQO0FBQ0QsR0FoQk0sQ0FBUDtBQWlCRCxDQWxCRDs7QUFvQkE7QUFDQTdFLFVBQVUyRCxTQUFWLENBQW9CbUIsUUFBcEIsR0FBK0IsWUFBVztBQUN4QyxPQUFLckUsT0FBTCxHQUFlLElBQWY7QUFDQSxTQUFPLElBQVA7QUFDRCxDQUhEOztBQUtBO0FBQ0FULFVBQVUyRCxTQUFWLENBQW9CWSxpQkFBcEIsR0FBd0MsWUFBVztBQUNqRCxNQUFJLEtBQUtyRSxJQUFMLENBQVVRLFFBQWQsRUFBd0I7QUFDdEIsV0FBT29ELFFBQVFDLE9BQVIsRUFBUDtBQUNEOztBQUVELE9BQUt2RCxXQUFMLENBQWlCdUUsR0FBakIsR0FBdUIsQ0FBQyxHQUFELENBQXZCOztBQUVBLE1BQUksS0FBSzdFLElBQUwsQ0FBVVMsSUFBZCxFQUFvQjtBQUNsQixXQUFPLEtBQUtULElBQUwsQ0FBVThFLFlBQVYsR0FBeUJoQixJQUF6QixDQUErQmlCLEtBQUQsSUFBVztBQUM5QyxXQUFLekUsV0FBTCxDQUFpQnVFLEdBQWpCLEdBQXVCLEtBQUt2RSxXQUFMLENBQWlCdUUsR0FBakIsQ0FBcUIvQyxNQUFyQixDQUE0QmlELEtBQTVCLEVBQW1DLENBQUMsS0FBSy9FLElBQUwsQ0FBVVMsSUFBVixDQUFlSyxFQUFoQixDQUFuQyxDQUF2QjtBQUNBO0FBQ0QsS0FITSxDQUFQO0FBSUQsR0FMRCxNQUtPO0FBQ0wsV0FBTzhDLFFBQVFDLE9BQVIsRUFBUDtBQUNEO0FBQ0YsQ0FmRDs7QUFpQkE7QUFDQTtBQUNBL0QsVUFBVTJELFNBQVYsQ0FBb0JILHVCQUFwQixHQUE4QyxZQUFXO0FBQ3ZELE1BQUksQ0FBQyxLQUFLRCxXQUFWLEVBQXVCO0FBQ3JCLFdBQU9PLFFBQVFDLE9BQVIsRUFBUDtBQUNEOztBQUVEO0FBQ0EsU0FBTyxLQUFLOUQsTUFBTCxDQUFZaUYsUUFBWixDQUFxQjFCLHVCQUFyQixDQUE2QyxLQUFLckQsU0FBbEQsRUFBNkQsS0FBS29ELFdBQWxFLEVBQ0pTLElBREksQ0FDRW1CLFlBQUQsSUFBa0I7QUFDdEIsU0FBS2hGLFNBQUwsR0FBaUJnRixZQUFqQjtBQUNBLFNBQUsxQixpQkFBTCxHQUF5QjBCLFlBQXpCO0FBQ0QsR0FKSSxDQUFQO0FBS0QsQ0FYRDs7QUFhQTtBQUNBbkYsVUFBVTJELFNBQVYsQ0FBb0JhLDJCQUFwQixHQUFrRCxZQUFXO0FBQzNELE1BQUksS0FBS3ZFLE1BQUwsQ0FBWW1GLHdCQUFaLEtBQXlDLEtBQXpDLElBQWtELENBQUMsS0FBS2xGLElBQUwsQ0FBVVEsUUFBN0QsSUFDR2YsaUJBQWlCMEYsYUFBakIsQ0FBK0JDLE9BQS9CLENBQXVDLEtBQUtuRixTQUE1QyxNQUEyRCxDQUFDLENBRG5FLEVBQ3NFO0FBQ3BFLFdBQU8sS0FBS0YsTUFBTCxDQUFZaUYsUUFBWixDQUFxQkssVUFBckIsR0FDSnZCLElBREksQ0FDQ3dCLG9CQUFvQkEsaUJBQWlCQyxRQUFqQixDQUEwQixLQUFLdEYsU0FBL0IsQ0FEckIsRUFFSjZELElBRkksQ0FFQ3lCLFlBQVk7QUFDaEIsVUFBSUEsYUFBYSxJQUFqQixFQUF1QjtBQUNyQixjQUFNLElBQUk1RixNQUFNZSxLQUFWLENBQWdCZixNQUFNZSxLQUFOLENBQVk4RSxtQkFBNUIsRUFDSix3Q0FDb0Isc0JBRHBCLEdBQzZDLEtBQUt2RixTQUY5QyxDQUFOO0FBR0Q7QUFDRixLQVJJLENBQVA7QUFTRCxHQVhELE1BV087QUFDTCxXQUFPMkQsUUFBUUMsT0FBUixFQUFQO0FBQ0Q7QUFDRixDQWZEOztBQWlCQSxTQUFTNEIsZ0JBQVQsQ0FBMEJDLGFBQTFCLEVBQXlDekYsU0FBekMsRUFBb0QwRixPQUFwRCxFQUE2RDtBQUMzRCxNQUFJQyxTQUFTLEVBQWI7QUFDQSxPQUFLLElBQUlDLE1BQVQsSUFBbUJGLE9BQW5CLEVBQTRCO0FBQzFCQyxXQUFPRSxJQUFQLENBQVk7QUFDVmxGLGNBQVEsU0FERTtBQUVWWCxpQkFBV0EsU0FGRDtBQUdWWSxnQkFBVWdGLE9BQU9oRjtBQUhQLEtBQVo7QUFLRDtBQUNELFNBQU82RSxjQUFjLFVBQWQsQ0FBUDtBQUNBLE1BQUkzRCxNQUFNZ0UsT0FBTixDQUFjTCxjQUFjLEtBQWQsQ0FBZCxDQUFKLEVBQXlDO0FBQ3ZDQSxrQkFBYyxLQUFkLElBQXVCQSxjQUFjLEtBQWQsRUFBcUI1RCxNQUFyQixDQUE0QjhELE1BQTVCLENBQXZCO0FBQ0QsR0FGRCxNQUVPO0FBQ0xGLGtCQUFjLEtBQWQsSUFBdUJFLE1BQXZCO0FBQ0Q7QUFDRjs7QUFFRDtBQUNBO0FBQ0E7QUFDQTtBQUNBOUYsVUFBVTJELFNBQVYsQ0FBb0JnQixjQUFwQixHQUFxQyxZQUFXO0FBQzlDLE1BQUlpQixnQkFBZ0JNLGtCQUFrQixLQUFLOUYsU0FBdkIsRUFBa0MsVUFBbEMsQ0FBcEI7QUFDQSxNQUFJLENBQUN3RixhQUFMLEVBQW9CO0FBQ2xCO0FBQ0Q7O0FBRUQ7QUFDQSxNQUFJTyxlQUFlUCxjQUFjLFVBQWQsQ0FBbkI7QUFDQSxNQUFJLENBQUNPLGFBQWFDLEtBQWQsSUFBdUIsQ0FBQ0QsYUFBYWhHLFNBQXpDLEVBQW9EO0FBQ2xELFVBQU0sSUFBSU4sTUFBTWUsS0FBVixDQUFnQmYsTUFBTWUsS0FBTixDQUFZeUYsYUFBNUIsRUFDSiw0QkFESSxDQUFOO0FBRUQ7O0FBRUQsUUFBTUMsb0JBQW9CO0FBQ3hCOUMsNkJBQXlCMkMsYUFBYTNDO0FBRGQsR0FBMUI7O0FBSUEsTUFBSSxLQUFLbkQsV0FBTCxDQUFpQmtHLHNCQUFyQixFQUE2QztBQUMzQ0Qsc0JBQWtCRSxjQUFsQixHQUFtQyxLQUFLbkcsV0FBTCxDQUFpQmtHLHNCQUFwRDtBQUNBRCxzQkFBa0JDLHNCQUFsQixHQUEyQyxLQUFLbEcsV0FBTCxDQUFpQmtHLHNCQUE1RDtBQUNEOztBQUVELE1BQUlFLFdBQVcsSUFBSXpHLFNBQUosQ0FDYixLQUFLQyxNQURRLEVBQ0EsS0FBS0MsSUFETCxFQUNXaUcsYUFBYWhHLFNBRHhCLEVBRWJnRyxhQUFhQyxLQUZBLEVBRU9FLGlCQUZQLENBQWY7QUFHQSxTQUFPRyxTQUFTN0MsT0FBVCxHQUFtQkksSUFBbkIsQ0FBeUJ6RCxRQUFELElBQWM7QUFDM0NvRixxQkFBaUJDLGFBQWpCLEVBQWdDYSxTQUFTdEcsU0FBekMsRUFBb0RJLFNBQVNzRixPQUE3RDtBQUNBO0FBQ0EsV0FBTyxLQUFLbEIsY0FBTCxFQUFQO0FBQ0QsR0FKTSxDQUFQO0FBS0QsQ0E5QkQ7O0FBZ0NBLFNBQVMrQixtQkFBVCxDQUE2QkMsZ0JBQTdCLEVBQStDeEcsU0FBL0MsRUFBMEQwRixPQUExRCxFQUFtRTtBQUNqRSxNQUFJQyxTQUFTLEVBQWI7QUFDQSxPQUFLLElBQUlDLE1BQVQsSUFBbUJGLE9BQW5CLEVBQTRCO0FBQzFCQyxXQUFPRSxJQUFQLENBQVk7QUFDVmxGLGNBQVEsU0FERTtBQUVWWCxpQkFBV0EsU0FGRDtBQUdWWSxnQkFBVWdGLE9BQU9oRjtBQUhQLEtBQVo7QUFLRDtBQUNELFNBQU80RixpQkFBaUIsYUFBakIsQ0FBUDtBQUNBLE1BQUkxRSxNQUFNZ0UsT0FBTixDQUFjVSxpQkFBaUIsTUFBakIsQ0FBZCxDQUFKLEVBQTZDO0FBQzNDQSxxQkFBaUIsTUFBakIsSUFBMkJBLGlCQUFpQixNQUFqQixFQUF5QjNFLE1BQXpCLENBQWdDOEQsTUFBaEMsQ0FBM0I7QUFDRCxHQUZELE1BRU87QUFDTGEscUJBQWlCLE1BQWpCLElBQTJCYixNQUEzQjtBQUNEO0FBQ0Y7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTlGLFVBQVUyRCxTQUFWLENBQW9CaUIsaUJBQXBCLEdBQXdDLFlBQVc7QUFDakQsTUFBSStCLG1CQUFtQlQsa0JBQWtCLEtBQUs5RixTQUF2QixFQUFrQyxhQUFsQyxDQUF2QjtBQUNBLE1BQUksQ0FBQ3VHLGdCQUFMLEVBQXVCO0FBQ3JCO0FBQ0Q7O0FBRUQ7QUFDQSxNQUFJQyxrQkFBa0JELGlCQUFpQixhQUFqQixDQUF0QjtBQUNBLE1BQUksQ0FBQ0MsZ0JBQWdCUixLQUFqQixJQUEwQixDQUFDUSxnQkFBZ0J6RyxTQUEvQyxFQUEwRDtBQUN4RCxVQUFNLElBQUlOLE1BQU1lLEtBQVYsQ0FBZ0JmLE1BQU1lLEtBQU4sQ0FBWXlGLGFBQTVCLEVBQ0osK0JBREksQ0FBTjtBQUVEOztBQUVELFFBQU1DLG9CQUFvQjtBQUN4QjlDLDZCQUF5Qm9ELGdCQUFnQnBEO0FBRGpCLEdBQTFCOztBQUlBLE1BQUksS0FBS25ELFdBQUwsQ0FBaUJrRyxzQkFBckIsRUFBNkM7QUFDM0NELHNCQUFrQkUsY0FBbEIsR0FBbUMsS0FBS25HLFdBQUwsQ0FBaUJrRyxzQkFBcEQ7QUFDQUQsc0JBQWtCQyxzQkFBbEIsR0FBMkMsS0FBS2xHLFdBQUwsQ0FBaUJrRyxzQkFBNUQ7QUFDRDs7QUFFRCxNQUFJRSxXQUFXLElBQUl6RyxTQUFKLENBQ2IsS0FBS0MsTUFEUSxFQUNBLEtBQUtDLElBREwsRUFDVzBHLGdCQUFnQnpHLFNBRDNCLEVBRWJ5RyxnQkFBZ0JSLEtBRkgsRUFFVUUsaUJBRlYsQ0FBZjtBQUdBLFNBQU9HLFNBQVM3QyxPQUFULEdBQW1CSSxJQUFuQixDQUF5QnpELFFBQUQsSUFBYztBQUMzQ21HLHdCQUFvQkMsZ0JBQXBCLEVBQXNDRixTQUFTdEcsU0FBL0MsRUFBMERJLFNBQVNzRixPQUFuRTtBQUNBO0FBQ0EsV0FBTyxLQUFLakIsaUJBQUwsRUFBUDtBQUNELEdBSk0sQ0FBUDtBQUtELENBOUJEOztBQWdDQSxNQUFNaUMsa0JBQWtCLENBQUNDLFlBQUQsRUFBZXJGLEdBQWYsRUFBb0JzRixPQUFwQixLQUFnQztBQUN0RCxNQUFJakIsU0FBUyxFQUFiO0FBQ0EsT0FBSyxJQUFJQyxNQUFULElBQW1CZ0IsT0FBbkIsRUFBNEI7QUFDMUJqQixXQUFPRSxJQUFQLENBQVl2RSxJQUFJRixLQUFKLENBQVUsR0FBVixFQUFlZ0IsTUFBZixDQUFzQixDQUFDeUUsQ0FBRCxFQUFHQyxDQUFILEtBQU9ELEVBQUVDLENBQUYsQ0FBN0IsRUFBbUNsQixNQUFuQyxDQUFaO0FBQ0Q7QUFDRCxTQUFPZSxhQUFhLFNBQWIsQ0FBUDtBQUNBLE1BQUk3RSxNQUFNZ0UsT0FBTixDQUFjYSxhQUFhLEtBQWIsQ0FBZCxDQUFKLEVBQXdDO0FBQ3RDQSxpQkFBYSxLQUFiLElBQXNCQSxhQUFhLEtBQWIsRUFBb0I5RSxNQUFwQixDQUEyQjhELE1BQTNCLENBQXRCO0FBQ0QsR0FGRCxNQUVPO0FBQ0xnQixpQkFBYSxLQUFiLElBQXNCaEIsTUFBdEI7QUFDRDtBQUNGLENBWEQ7O0FBYUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOUYsVUFBVTJELFNBQVYsQ0FBb0JjLGFBQXBCLEdBQW9DLFlBQVc7QUFDN0MsTUFBSXFDLGVBQWVaLGtCQUFrQixLQUFLOUYsU0FBdkIsRUFBa0MsU0FBbEMsQ0FBbkI7QUFDQSxNQUFJLENBQUMwRyxZQUFMLEVBQW1CO0FBQ2pCO0FBQ0Q7O0FBRUQ7QUFDQSxNQUFJSSxjQUFjSixhQUFhLFNBQWIsQ0FBbEI7QUFDQTtBQUNBLE1BQUksQ0FBQ0ksWUFBWUMsS0FBYixJQUNBLENBQUNELFlBQVl6RixHQURiLElBRUEsT0FBT3lGLFlBQVlDLEtBQW5CLEtBQTZCLFFBRjdCLElBR0EsQ0FBQ0QsWUFBWUMsS0FBWixDQUFrQmhILFNBSG5CLElBSUFnRCxPQUFPN0IsSUFBUCxDQUFZNEYsV0FBWixFQUF5QnhGLE1BQXpCLEtBQW9DLENBSnhDLEVBSTJDO0FBQ3pDLFVBQU0sSUFBSTdCLE1BQU1lLEtBQVYsQ0FBZ0JmLE1BQU1lLEtBQU4sQ0FBWXlGLGFBQTVCLEVBQ0osMkJBREksQ0FBTjtBQUVEOztBQUVELFFBQU1DLG9CQUFvQjtBQUN4QjlDLDZCQUF5QjBELFlBQVlDLEtBQVosQ0FBa0IzRDtBQURuQixHQUExQjs7QUFJQSxNQUFJLEtBQUtuRCxXQUFMLENBQWlCa0csc0JBQXJCLEVBQTZDO0FBQzNDRCxzQkFBa0JFLGNBQWxCLEdBQW1DLEtBQUtuRyxXQUFMLENBQWlCa0csc0JBQXBEO0FBQ0FELHNCQUFrQkMsc0JBQWxCLEdBQTJDLEtBQUtsRyxXQUFMLENBQWlCa0csc0JBQTVEO0FBQ0Q7O0FBRUQsTUFBSUUsV0FBVyxJQUFJekcsU0FBSixDQUNiLEtBQUtDLE1BRFEsRUFDQSxLQUFLQyxJQURMLEVBQ1dnSCxZQUFZQyxLQUFaLENBQWtCaEgsU0FEN0IsRUFFYitHLFlBQVlDLEtBQVosQ0FBa0JmLEtBRkwsRUFFWUUsaUJBRlosQ0FBZjtBQUdBLFNBQU9HLFNBQVM3QyxPQUFULEdBQW1CSSxJQUFuQixDQUF5QnpELFFBQUQsSUFBYztBQUMzQ3NHLG9CQUFnQkMsWUFBaEIsRUFBOEJJLFlBQVl6RixHQUExQyxFQUErQ2xCLFNBQVNzRixPQUF4RDtBQUNBO0FBQ0EsV0FBTyxLQUFLcEIsYUFBTCxFQUFQO0FBQ0QsR0FKTSxDQUFQO0FBS0QsQ0FuQ0Q7O0FBcUNBLE1BQU0yQyxzQkFBc0IsQ0FBQ0MsZ0JBQUQsRUFBbUI1RixHQUFuQixFQUF3QnNGLE9BQXhCLEtBQW9DO0FBQzlELE1BQUlqQixTQUFTLEVBQWI7QUFDQSxPQUFLLElBQUlDLE1BQVQsSUFBbUJnQixPQUFuQixFQUE0QjtBQUMxQmpCLFdBQU9FLElBQVAsQ0FBWXZFLElBQUlGLEtBQUosQ0FBVSxHQUFWLEVBQWVnQixNQUFmLENBQXNCLENBQUN5RSxDQUFELEVBQUdDLENBQUgsS0FBT0QsRUFBRUMsQ0FBRixDQUE3QixFQUFtQ2xCLE1BQW5DLENBQVo7QUFDRDtBQUNELFNBQU9zQixpQkFBaUIsYUFBakIsQ0FBUDtBQUNBLE1BQUlwRixNQUFNZ0UsT0FBTixDQUFjb0IsaUJBQWlCLE1BQWpCLENBQWQsQ0FBSixFQUE2QztBQUMzQ0EscUJBQWlCLE1BQWpCLElBQTJCQSxpQkFBaUIsTUFBakIsRUFBeUJyRixNQUF6QixDQUFnQzhELE1BQWhDLENBQTNCO0FBQ0QsR0FGRCxNQUVPO0FBQ0x1QixxQkFBaUIsTUFBakIsSUFBMkJ2QixNQUEzQjtBQUNEO0FBQ0YsQ0FYRDs7QUFhQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E5RixVQUFVMkQsU0FBVixDQUFvQmUsaUJBQXBCLEdBQXdDLFlBQVc7QUFDakQsTUFBSTJDLG1CQUFtQm5CLGtCQUFrQixLQUFLOUYsU0FBdkIsRUFBa0MsYUFBbEMsQ0FBdkI7QUFDQSxNQUFJLENBQUNpSCxnQkFBTCxFQUF1QjtBQUNyQjtBQUNEOztBQUVEO0FBQ0EsTUFBSUMsa0JBQWtCRCxpQkFBaUIsYUFBakIsQ0FBdEI7QUFDQSxNQUFJLENBQUNDLGdCQUFnQkgsS0FBakIsSUFDQSxDQUFDRyxnQkFBZ0I3RixHQURqQixJQUVBLE9BQU82RixnQkFBZ0JILEtBQXZCLEtBQWlDLFFBRmpDLElBR0EsQ0FBQ0csZ0JBQWdCSCxLQUFoQixDQUFzQmhILFNBSHZCLElBSUFnRCxPQUFPN0IsSUFBUCxDQUFZZ0csZUFBWixFQUE2QjVGLE1BQTdCLEtBQXdDLENBSjVDLEVBSStDO0FBQzdDLFVBQU0sSUFBSTdCLE1BQU1lLEtBQVYsQ0FBZ0JmLE1BQU1lLEtBQU4sQ0FBWXlGLGFBQTVCLEVBQ0osK0JBREksQ0FBTjtBQUVEO0FBQ0QsUUFBTUMsb0JBQW9CO0FBQ3hCOUMsNkJBQXlCOEQsZ0JBQWdCSCxLQUFoQixDQUFzQjNEO0FBRHZCLEdBQTFCOztBQUlBLE1BQUksS0FBS25ELFdBQUwsQ0FBaUJrRyxzQkFBckIsRUFBNkM7QUFDM0NELHNCQUFrQkUsY0FBbEIsR0FBbUMsS0FBS25HLFdBQUwsQ0FBaUJrRyxzQkFBcEQ7QUFDQUQsc0JBQWtCQyxzQkFBbEIsR0FBMkMsS0FBS2xHLFdBQUwsQ0FBaUJrRyxzQkFBNUQ7QUFDRDs7QUFFRCxNQUFJRSxXQUFXLElBQUl6RyxTQUFKLENBQ2IsS0FBS0MsTUFEUSxFQUNBLEtBQUtDLElBREwsRUFDV29ILGdCQUFnQkgsS0FBaEIsQ0FBc0JoSCxTQURqQyxFQUVibUgsZ0JBQWdCSCxLQUFoQixDQUFzQmYsS0FGVCxFQUVnQkUsaUJBRmhCLENBQWY7QUFHQSxTQUFPRyxTQUFTN0MsT0FBVCxHQUFtQkksSUFBbkIsQ0FBeUJ6RCxRQUFELElBQWM7QUFDM0M2Ryx3QkFBb0JDLGdCQUFwQixFQUFzQ0MsZ0JBQWdCN0YsR0FBdEQsRUFBMkRsQixTQUFTc0YsT0FBcEU7QUFDQTtBQUNBLFdBQU8sS0FBS25CLGlCQUFMLEVBQVA7QUFDRCxHQUpNLENBQVA7QUFLRCxDQWpDRDs7QUFtQ0EsTUFBTTZDLGlDQUFpQyxVQUFVeEIsTUFBVixFQUFrQjdGLElBQWxCLEVBQXdCRCxNQUF4QixFQUFnQztBQUNyRSxTQUFPOEYsT0FBT3lCLFFBQWQ7O0FBRUEsTUFBSXRILEtBQUtRLFFBQUwsSUFBa0JSLEtBQUtTLElBQUwsSUFBYVQsS0FBS1MsSUFBTCxDQUFVSyxFQUFWLEtBQWlCK0UsT0FBT2hGLFFBQTNELEVBQXNFO0FBQ3BFO0FBQ0Q7O0FBRUQsT0FBSyxNQUFNMEIsS0FBWCxJQUFvQnhDLE9BQU93SCxtQkFBM0IsRUFBZ0Q7QUFDOUMsV0FBTzFCLE9BQU90RCxLQUFQLENBQVA7QUFDRDtBQUNGLENBVkQ7O0FBWUEsTUFBTWlGLHNCQUFzQixVQUFVM0IsTUFBVixFQUFrQjtBQUM1QyxNQUFJQSxPQUFPNEIsUUFBWCxFQUFxQjtBQUNuQnhFLFdBQU83QixJQUFQLENBQVl5RSxPQUFPNEIsUUFBbkIsRUFBNkJDLE9BQTdCLENBQXNDQyxRQUFELElBQWM7QUFDakQsVUFBSTlCLE9BQU80QixRQUFQLENBQWdCRSxRQUFoQixNQUE4QixJQUFsQyxFQUF3QztBQUN0QyxlQUFPOUIsT0FBTzRCLFFBQVAsQ0FBZ0JFLFFBQWhCLENBQVA7QUFDRDtBQUNGLEtBSkQ7O0FBTUEsUUFBSTFFLE9BQU83QixJQUFQLENBQVl5RSxPQUFPNEIsUUFBbkIsRUFBNkJqRyxNQUE3QixJQUF1QyxDQUEzQyxFQUE4QztBQUM1QyxhQUFPcUUsT0FBTzRCLFFBQWQ7QUFDRDtBQUNGO0FBQ0YsQ0FaRDs7QUFjQSxNQUFNRyw0QkFBNkJDLFVBQUQsSUFBZ0I7QUFDaEQsTUFBSSxPQUFPQSxVQUFQLEtBQXNCLFFBQTFCLEVBQW9DO0FBQ2xDLFdBQU9BLFVBQVA7QUFDRDtBQUNELFFBQU1DLGdCQUFnQixFQUF0QjtBQUNBLE1BQUlDLHNCQUFzQixLQUExQjtBQUNBLE1BQUlDLHdCQUF3QixLQUE1QjtBQUNBLE9BQUssTUFBTXpHLEdBQVgsSUFBa0JzRyxVQUFsQixFQUE4QjtBQUM1QixRQUFJdEcsSUFBSTZELE9BQUosQ0FBWSxHQUFaLE1BQXFCLENBQXpCLEVBQTRCO0FBQzFCMkMsNEJBQXNCLElBQXRCO0FBQ0FELG9CQUFjdkcsR0FBZCxJQUFxQnNHLFdBQVd0RyxHQUFYLENBQXJCO0FBQ0QsS0FIRCxNQUdPO0FBQ0x5Ryw4QkFBd0IsSUFBeEI7QUFDRDtBQUNGO0FBQ0QsTUFBSUQsdUJBQXVCQyxxQkFBM0IsRUFBa0Q7QUFDaERILGVBQVcsS0FBWCxJQUFvQkMsYUFBcEI7QUFDQTdFLFdBQU83QixJQUFQLENBQVkwRyxhQUFaLEVBQTJCSixPQUEzQixDQUFvQ25HLEdBQUQsSUFBUztBQUMxQyxhQUFPc0csV0FBV3RHLEdBQVgsQ0FBUDtBQUNELEtBRkQ7QUFHRDtBQUNELFNBQU9zRyxVQUFQO0FBQ0QsQ0F0QkQ7O0FBd0JBL0gsVUFBVTJELFNBQVYsQ0FBb0JrQixlQUFwQixHQUFzQyxZQUFXO0FBQy9DLE1BQUksT0FBTyxLQUFLekUsU0FBWixLQUEwQixRQUE5QixFQUF3QztBQUN0QztBQUNEO0FBQ0QsT0FBSyxNQUFNcUIsR0FBWCxJQUFrQixLQUFLckIsU0FBdkIsRUFBa0M7QUFDaEMsU0FBS0EsU0FBTCxDQUFlcUIsR0FBZixJQUFzQnFHLDBCQUEwQixLQUFLMUgsU0FBTCxDQUFlcUIsR0FBZixDQUExQixDQUF0QjtBQUNEO0FBQ0YsQ0FQRDs7QUFTQTtBQUNBO0FBQ0F6QixVQUFVMkQsU0FBVixDQUFvQlEsT0FBcEIsR0FBOEIsVUFBU2dFLFVBQVUsRUFBbkIsRUFBdUI7QUFDbkQsTUFBSSxLQUFLM0gsV0FBTCxDQUFpQjRILEtBQWpCLEtBQTJCLENBQS9CLEVBQWtDO0FBQ2hDLFNBQUs3SCxRQUFMLEdBQWdCLEVBQUNzRixTQUFTLEVBQVYsRUFBaEI7QUFDQSxXQUFPL0IsUUFBUUMsT0FBUixFQUFQO0FBQ0Q7QUFDRCxRQUFNdkQsY0FBYzJDLE9BQU9rRixNQUFQLENBQWMsRUFBZCxFQUFrQixLQUFLN0gsV0FBdkIsQ0FBcEI7QUFDQSxNQUFJLEtBQUtjLElBQVQsRUFBZTtBQUNiZCxnQkFBWWMsSUFBWixHQUFtQixLQUFLQSxJQUFMLENBQVVLLEdBQVYsQ0FBZUYsR0FBRCxJQUFTO0FBQ3hDLGFBQU9BLElBQUlGLEtBQUosQ0FBVSxHQUFWLEVBQWUsQ0FBZixDQUFQO0FBQ0QsS0FGa0IsQ0FBbkI7QUFHRDtBQUNELE1BQUk0RyxRQUFRRyxFQUFaLEVBQWdCO0FBQ2Q5SCxnQkFBWThILEVBQVosR0FBaUJILFFBQVFHLEVBQXpCO0FBQ0Q7QUFDRCxNQUFJLEtBQUs3SCxPQUFULEVBQWtCO0FBQ2hCRCxnQkFBWUMsT0FBWixHQUFzQixJQUF0QjtBQUNEO0FBQ0QsU0FBTyxLQUFLUixNQUFMLENBQVlpRixRQUFaLENBQXFCcUQsSUFBckIsQ0FBMEIsS0FBS3BJLFNBQS9CLEVBQTBDLEtBQUtDLFNBQS9DLEVBQTBESSxXQUExRCxFQUNKd0QsSUFESSxDQUNFNkIsT0FBRCxJQUFhO0FBQ2pCLFFBQUksS0FBSzFGLFNBQUwsS0FBbUIsT0FBdkIsRUFBZ0M7QUFDOUIsV0FBSyxJQUFJNEYsTUFBVCxJQUFtQkYsT0FBbkIsRUFBNEI7QUFDMUIwQix1Q0FBK0J4QixNQUEvQixFQUF1QyxLQUFLN0YsSUFBNUMsRUFBa0QsS0FBS0QsTUFBdkQ7QUFDQXlILDRCQUFvQjNCLE1BQXBCO0FBQ0Q7QUFDRjs7QUFFRCxTQUFLOUYsTUFBTCxDQUFZdUksZUFBWixDQUE0QkMsbUJBQTVCLENBQWdELEtBQUt4SSxNQUFyRCxFQUE2RDRGLE9BQTdEOztBQUVBLFFBQUksS0FBS3BDLGlCQUFULEVBQTRCO0FBQzFCLFdBQUssSUFBSWlGLENBQVQsSUFBYzdDLE9BQWQsRUFBdUI7QUFDckI2QyxVQUFFdkksU0FBRixHQUFjLEtBQUtzRCxpQkFBbkI7QUFDRDtBQUNGO0FBQ0QsU0FBS2xELFFBQUwsR0FBZ0IsRUFBQ3NGLFNBQVNBLE9BQVYsRUFBaEI7QUFDRCxHQWpCSSxDQUFQO0FBa0JELENBbkNEOztBQXFDQTtBQUNBO0FBQ0E3RixVQUFVMkQsU0FBVixDQUFvQlMsUUFBcEIsR0FBK0IsWUFBVztBQUN4QyxNQUFJLENBQUMsS0FBS25ELE9BQVYsRUFBbUI7QUFDakI7QUFDRDtBQUNELE9BQUtULFdBQUwsQ0FBaUJtSSxLQUFqQixHQUF5QixJQUF6QjtBQUNBLFNBQU8sS0FBS25JLFdBQUwsQ0FBaUJvSSxJQUF4QjtBQUNBLFNBQU8sS0FBS3BJLFdBQUwsQ0FBaUI0SCxLQUF4QjtBQUNBLFNBQU8sS0FBS25JLE1BQUwsQ0FBWWlGLFFBQVosQ0FBcUJxRCxJQUFyQixDQUEwQixLQUFLcEksU0FBL0IsRUFBMEMsS0FBS0MsU0FBL0MsRUFBMEQsS0FBS0ksV0FBL0QsRUFDSndELElBREksQ0FDRTZFLENBQUQsSUFBTztBQUNYLFNBQUt0SSxRQUFMLENBQWNvSSxLQUFkLEdBQXNCRSxDQUF0QjtBQUNELEdBSEksQ0FBUDtBQUlELENBWEQ7O0FBYUE7QUFDQTdJLFVBQVUyRCxTQUFWLENBQW9CTyxnQkFBcEIsR0FBdUMsWUFBVztBQUNoRCxNQUFJLENBQUMsS0FBS2hELFVBQVYsRUFBc0I7QUFDcEI7QUFDRDtBQUNELFNBQU8sS0FBS2pCLE1BQUwsQ0FBWWlGLFFBQVosQ0FBcUJLLFVBQXJCLEdBQ0p2QixJQURJLENBQ0N3QixvQkFBb0JBLGlCQUFpQnNELFlBQWpCLENBQThCLEtBQUszSSxTQUFuQyxDQURyQixFQUVKNkQsSUFGSSxDQUVDK0UsVUFBVTtBQUNkLFVBQU1DLGdCQUFnQixFQUF0QjtBQUNBLFVBQU1DLFlBQVksRUFBbEI7QUFDQSxTQUFLLE1BQU14RyxLQUFYLElBQW9Cc0csT0FBTzNHLE1BQTNCLEVBQW1DO0FBQ2pDLFVBQUkyRyxPQUFPM0csTUFBUCxDQUFjSyxLQUFkLEVBQXFCeUcsSUFBckIsSUFBNkJILE9BQU8zRyxNQUFQLENBQWNLLEtBQWQsRUFBcUJ5RyxJQUFyQixLQUE4QixTQUEvRCxFQUEwRTtBQUN4RUYsc0JBQWNoRCxJQUFkLENBQW1CLENBQUN2RCxLQUFELENBQW5CO0FBQ0F3RyxrQkFBVWpELElBQVYsQ0FBZXZELEtBQWY7QUFDRDtBQUNGO0FBQ0Q7QUFDQSxTQUFLdEIsT0FBTCxHQUFlLENBQUMsR0FBRyxJQUFJZ0IsR0FBSixDQUFRLENBQUMsR0FBRyxLQUFLaEIsT0FBVCxFQUFrQixHQUFHNkgsYUFBckIsQ0FBUixDQUFKLENBQWY7QUFDQTtBQUNBLFFBQUksS0FBSzFILElBQVQsRUFBZTtBQUNiLFdBQUtBLElBQUwsR0FBWSxDQUFDLEdBQUcsSUFBSWEsR0FBSixDQUFRLENBQUMsR0FBRyxLQUFLYixJQUFULEVBQWUsR0FBRzJILFNBQWxCLENBQVIsQ0FBSixDQUFaO0FBQ0Q7QUFDRixHQWpCSSxDQUFQO0FBa0JELENBdEJEOztBQXdCQTtBQUNBakosVUFBVTJELFNBQVYsQ0FBb0JVLGFBQXBCLEdBQW9DLFlBQVc7QUFDN0MsTUFBSSxLQUFLbEQsT0FBTCxDQUFhTyxNQUFiLElBQXVCLENBQTNCLEVBQThCO0FBQzVCO0FBQ0Q7O0FBRUQsTUFBSXlILGVBQWVDLFlBQVksS0FBS25KLE1BQWpCLEVBQXlCLEtBQUtDLElBQTlCLEVBQ2pCLEtBQUtLLFFBRFksRUFDRixLQUFLWSxPQUFMLENBQWEsQ0FBYixDQURFLEVBQ2UsS0FBS2QsV0FEcEIsQ0FBbkI7QUFFQSxNQUFJOEksYUFBYW5GLElBQWpCLEVBQXVCO0FBQ3JCLFdBQU9tRixhQUFhbkYsSUFBYixDQUFtQnFGLFdBQUQsSUFBaUI7QUFDeEMsV0FBSzlJLFFBQUwsR0FBZ0I4SSxXQUFoQjtBQUNBLFdBQUtsSSxPQUFMLEdBQWUsS0FBS0EsT0FBTCxDQUFhUyxLQUFiLENBQW1CLENBQW5CLENBQWY7QUFDQSxhQUFPLEtBQUt5QyxhQUFMLEVBQVA7QUFDRCxLQUpNLENBQVA7QUFLRCxHQU5ELE1BTU8sSUFBSSxLQUFLbEQsT0FBTCxDQUFhTyxNQUFiLEdBQXNCLENBQTFCLEVBQTZCO0FBQ2xDLFNBQUtQLE9BQUwsR0FBZSxLQUFLQSxPQUFMLENBQWFTLEtBQWIsQ0FBbUIsQ0FBbkIsQ0FBZjtBQUNBLFdBQU8sS0FBS3lDLGFBQUwsRUFBUDtBQUNEOztBQUVELFNBQU84RSxZQUFQO0FBQ0QsQ0FuQkQ7O0FBcUJBO0FBQ0FuSixVQUFVMkQsU0FBVixDQUFvQlcsbUJBQXBCLEdBQTBDLFlBQVc7QUFDbkQsTUFBSSxDQUFDLEtBQUsvRCxRQUFWLEVBQW9CO0FBQ2xCO0FBQ0Q7QUFDRDtBQUNBLFFBQU0rSSxtQkFBbUJ4SixTQUFTeUosYUFBVCxDQUF1QixLQUFLcEosU0FBNUIsRUFBdUNMLFNBQVMwSixLQUFULENBQWVDLFNBQXRELEVBQWlFLEtBQUt4SixNQUFMLENBQVl5SixhQUE3RSxDQUF6QjtBQUNBLE1BQUksQ0FBQ0osZ0JBQUwsRUFBdUI7QUFDckIsV0FBT3hGLFFBQVFDLE9BQVIsRUFBUDtBQUNEO0FBQ0Q7QUFDQSxNQUFJLEtBQUt2RCxXQUFMLENBQWlCbUosUUFBakIsSUFBNkIsS0FBS25KLFdBQUwsQ0FBaUJvSixRQUFsRCxFQUE0RDtBQUMxRCxXQUFPOUYsUUFBUUMsT0FBUixFQUFQO0FBQ0Q7QUFDRDtBQUNBLFNBQU9qRSxTQUFTK0osd0JBQVQsQ0FBa0MvSixTQUFTMEosS0FBVCxDQUFlQyxTQUFqRCxFQUE0RCxLQUFLdkosSUFBakUsRUFBdUUsS0FBS0MsU0FBNUUsRUFBc0YsS0FBS0ksUUFBTCxDQUFjc0YsT0FBcEcsRUFBNkcsS0FBSzVGLE1BQWxILEVBQTBIK0QsSUFBMUgsQ0FBZ0k2QixPQUFELElBQWE7QUFDako7QUFDQSxRQUFJLEtBQUtwQyxpQkFBVCxFQUE0QjtBQUMxQixXQUFLbEQsUUFBTCxDQUFjc0YsT0FBZCxHQUF3QkEsUUFBUWxFLEdBQVIsQ0FBYW1JLE1BQUQsSUFBWTtBQUM5QyxZQUFJQSxrQkFBa0JqSyxNQUFNc0QsTUFBNUIsRUFBb0M7QUFDbEMyRyxtQkFBU0EsT0FBT0MsTUFBUCxFQUFUO0FBQ0Q7QUFDREQsZUFBTzNKLFNBQVAsR0FBbUIsS0FBS3NELGlCQUF4QjtBQUNBLGVBQU9xRyxNQUFQO0FBQ0QsT0FOdUIsQ0FBeEI7QUFPRCxLQVJELE1BUU87QUFDTCxXQUFLdkosUUFBTCxDQUFjc0YsT0FBZCxHQUF3QkEsT0FBeEI7QUFDRDtBQUNGLEdBYk0sQ0FBUDtBQWNELENBNUJEOztBQThCQTtBQUNBO0FBQ0E7QUFDQSxTQUFTdUQsV0FBVCxDQUFxQm5KLE1BQXJCLEVBQTZCQyxJQUE3QixFQUFtQ0ssUUFBbkMsRUFBNkN5QyxJQUE3QyxFQUFtRDNDLGNBQWMsRUFBakUsRUFBcUU7QUFDbkUsTUFBSTJKLFdBQVdDLGFBQWExSixTQUFTc0YsT0FBdEIsRUFBK0I3QyxJQUEvQixDQUFmO0FBQ0EsTUFBSWdILFNBQVN0SSxNQUFULElBQW1CLENBQXZCLEVBQTBCO0FBQ3hCLFdBQU9uQixRQUFQO0FBQ0Q7QUFDRCxRQUFNMkosZUFBZSxFQUFyQjtBQUNBLE9BQUssSUFBSUMsT0FBVCxJQUFvQkgsUUFBcEIsRUFBOEI7QUFDNUIsUUFBSSxDQUFDRyxPQUFMLEVBQWM7QUFDWjtBQUNEO0FBQ0QsVUFBTWhLLFlBQVlnSyxRQUFRaEssU0FBMUI7QUFDQTtBQUNBLFFBQUlBLFNBQUosRUFBZTtBQUNiK0osbUJBQWEvSixTQUFiLElBQTBCK0osYUFBYS9KLFNBQWIsS0FBMkIsSUFBSWdDLEdBQUosRUFBckQ7QUFDQStILG1CQUFhL0osU0FBYixFQUF3QmlLLEdBQXhCLENBQTRCRCxRQUFRcEosUUFBcEM7QUFDRDtBQUNGO0FBQ0QsUUFBTXNKLHFCQUFxQixFQUEzQjtBQUNBLE1BQUloSyxZQUFZaUIsSUFBaEIsRUFBc0I7QUFDcEIsVUFBTUEsT0FBTyxJQUFJYSxHQUFKLENBQVE5QixZQUFZaUIsSUFBWixDQUFpQkMsS0FBakIsQ0FBdUIsR0FBdkIsQ0FBUixDQUFiO0FBQ0EsVUFBTStJLFNBQVNySSxNQUFNQyxJQUFOLENBQVdaLElBQVgsRUFBaUJpQixNQUFqQixDQUF3QixDQUFDZ0ksR0FBRCxFQUFNOUksR0FBTixLQUFjO0FBQ25ELFlBQU0rSSxVQUFVL0ksSUFBSUYsS0FBSixDQUFVLEdBQVYsQ0FBaEI7QUFDQSxVQUFJMEYsSUFBSSxDQUFSO0FBQ0EsV0FBS0EsQ0FBTCxFQUFRQSxJQUFJakUsS0FBS3RCLE1BQWpCLEVBQXlCdUYsR0FBekIsRUFBOEI7QUFDNUIsWUFBSWpFLEtBQUtpRSxDQUFMLEtBQVd1RCxRQUFRdkQsQ0FBUixDQUFmLEVBQTJCO0FBQ3pCLGlCQUFPc0QsR0FBUDtBQUNEO0FBQ0Y7QUFDRCxVQUFJdEQsSUFBSXVELFFBQVE5SSxNQUFoQixFQUF3QjtBQUN0QjZJLFlBQUlILEdBQUosQ0FBUUksUUFBUXZELENBQVIsQ0FBUjtBQUNEO0FBQ0QsYUFBT3NELEdBQVA7QUFDRCxLQVpjLEVBWVosSUFBSXBJLEdBQUosRUFaWSxDQUFmO0FBYUEsUUFBSW1JLE9BQU9HLElBQVAsR0FBYyxDQUFsQixFQUFxQjtBQUNuQkoseUJBQW1CL0ksSUFBbkIsR0FBMEJXLE1BQU1DLElBQU4sQ0FBV29JLE1BQVgsRUFBbUJ4SSxJQUFuQixDQUF3QixHQUF4QixDQUExQjtBQUNEO0FBQ0Y7O0FBRUQsTUFBSXpCLFlBQVlxSyxxQkFBaEIsRUFBdUM7QUFDckNMLHVCQUFtQjdELGNBQW5CLEdBQW9DbkcsWUFBWXFLLHFCQUFoRDtBQUNBTCx1QkFBbUJLLHFCQUFuQixHQUEyQ3JLLFlBQVlxSyxxQkFBdkQ7QUFDRDs7QUFFRCxRQUFNQyxnQkFBZ0J4SCxPQUFPN0IsSUFBUCxDQUFZNEksWUFBWixFQUEwQnZJLEdBQTFCLENBQStCeEIsU0FBRCxJQUFlO0FBQ2pFLFVBQU15SyxZQUFZM0ksTUFBTUMsSUFBTixDQUFXZ0ksYUFBYS9KLFNBQWIsQ0FBWCxDQUFsQjtBQUNBLFFBQUlpRyxLQUFKO0FBQ0EsUUFBSXdFLFVBQVVsSixNQUFWLEtBQXFCLENBQXpCLEVBQTRCO0FBQzFCMEUsY0FBUSxFQUFDLFlBQVl3RSxVQUFVLENBQVYsQ0FBYixFQUFSO0FBQ0QsS0FGRCxNQUVPO0FBQ0x4RSxjQUFRLEVBQUMsWUFBWSxFQUFDLE9BQU93RSxTQUFSLEVBQWIsRUFBUjtBQUNEO0FBQ0QsUUFBSXpELFFBQVEsSUFBSW5ILFNBQUosQ0FBY0MsTUFBZCxFQUFzQkMsSUFBdEIsRUFBNEJDLFNBQTVCLEVBQXVDaUcsS0FBdkMsRUFBOENpRSxrQkFBOUMsQ0FBWjtBQUNBLFdBQU9sRCxNQUFNdkQsT0FBTixDQUFjLEVBQUMwRSxJQUFJLEtBQUwsRUFBZCxFQUEyQnRFLElBQTNCLENBQWlDNkIsT0FBRCxJQUFhO0FBQ2xEQSxjQUFRMUYsU0FBUixHQUFvQkEsU0FBcEI7QUFDQSxhQUFPMkQsUUFBUUMsT0FBUixDQUFnQjhCLE9BQWhCLENBQVA7QUFDRCxLQUhNLENBQVA7QUFJRCxHQWJxQixDQUF0Qjs7QUFlQTtBQUNBLFNBQU8vQixRQUFRK0csR0FBUixDQUFZRixhQUFaLEVBQTJCM0csSUFBM0IsQ0FBaUM4RyxTQUFELElBQWU7QUFDcEQsUUFBSUMsVUFBVUQsVUFBVXZJLE1BQVYsQ0FBaUIsQ0FBQ3dJLE9BQUQsRUFBVUMsZUFBVixLQUE4QjtBQUMzRCxXQUFLLElBQUlDLEdBQVQsSUFBZ0JELGdCQUFnQm5GLE9BQWhDLEVBQXlDO0FBQ3ZDb0YsWUFBSW5LLE1BQUosR0FBYSxRQUFiO0FBQ0FtSyxZQUFJOUssU0FBSixHQUFnQjZLLGdCQUFnQjdLLFNBQWhDOztBQUVBLFlBQUk4SyxJQUFJOUssU0FBSixJQUFpQixPQUFqQixJQUE0QixDQUFDRCxLQUFLUSxRQUF0QyxFQUFnRDtBQUM5QyxpQkFBT3VLLElBQUlDLFlBQVg7QUFDQSxpQkFBT0QsSUFBSXRELFFBQVg7QUFDRDtBQUNEb0QsZ0JBQVFFLElBQUlsSyxRQUFaLElBQXdCa0ssR0FBeEI7QUFDRDtBQUNELGFBQU9GLE9BQVA7QUFDRCxLQVphLEVBWVgsRUFaVyxDQUFkOztBQWNBLFFBQUlJLE9BQU87QUFDVHRGLGVBQVN1RixnQkFBZ0I3SyxTQUFTc0YsT0FBekIsRUFBa0M3QyxJQUFsQyxFQUF3QytILE9BQXhDO0FBREEsS0FBWDtBQUdBLFFBQUl4SyxTQUFTb0ksS0FBYixFQUFvQjtBQUNsQndDLFdBQUt4QyxLQUFMLEdBQWFwSSxTQUFTb0ksS0FBdEI7QUFDRDtBQUNELFdBQU93QyxJQUFQO0FBQ0QsR0F0Qk0sQ0FBUDtBQXVCRDs7QUFFRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBU2xCLFlBQVQsQ0FBc0JILE1BQXRCLEVBQThCOUcsSUFBOUIsRUFBb0M7QUFDbEMsTUFBSThHLGtCQUFrQjdILEtBQXRCLEVBQTZCO0FBQzNCLFFBQUlvSixTQUFTLEVBQWI7QUFDQSxTQUFLLElBQUlDLENBQVQsSUFBY3hCLE1BQWQsRUFBc0I7QUFDcEJ1QixlQUFTQSxPQUFPckosTUFBUCxDQUFjaUksYUFBYXFCLENBQWIsRUFBZ0J0SSxJQUFoQixDQUFkLENBQVQ7QUFDRDtBQUNELFdBQU9xSSxNQUFQO0FBQ0Q7O0FBRUQsTUFBSSxPQUFPdkIsTUFBUCxLQUFrQixRQUFsQixJQUE4QixDQUFDQSxNQUFuQyxFQUEyQztBQUN6QyxXQUFPLEVBQVA7QUFDRDs7QUFFRCxNQUFJOUcsS0FBS3RCLE1BQUwsSUFBZSxDQUFuQixFQUFzQjtBQUNwQixRQUFJb0ksV0FBVyxJQUFYLElBQW1CQSxPQUFPaEosTUFBUCxJQUFpQixTQUF4QyxFQUFtRDtBQUNqRCxhQUFPLENBQUNnSixNQUFELENBQVA7QUFDRDtBQUNELFdBQU8sRUFBUDtBQUNEOztBQUVELE1BQUl5QixZQUFZekIsT0FBTzlHLEtBQUssQ0FBTCxDQUFQLENBQWhCO0FBQ0EsTUFBSSxDQUFDdUksU0FBTCxFQUFnQjtBQUNkLFdBQU8sRUFBUDtBQUNEO0FBQ0QsU0FBT3RCLGFBQWFzQixTQUFiLEVBQXdCdkksS0FBS3BCLEtBQUwsQ0FBVyxDQUFYLENBQXhCLENBQVA7QUFDRDs7QUFFRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTd0osZUFBVCxDQUF5QnRCLE1BQXpCLEVBQWlDOUcsSUFBakMsRUFBdUMrSCxPQUF2QyxFQUFnRDtBQUM5QyxNQUFJakIsa0JBQWtCN0gsS0FBdEIsRUFBNkI7QUFDM0IsV0FBTzZILE9BQU9uSSxHQUFQLENBQVlzSixHQUFELElBQVNHLGdCQUFnQkgsR0FBaEIsRUFBcUJqSSxJQUFyQixFQUEyQitILE9BQTNCLENBQXBCLEVBQ0p2SixNQURJLENBQ0l5SixHQUFELElBQVMsT0FBT0EsR0FBUCxLQUFlLFdBRDNCLENBQVA7QUFFRDs7QUFFRCxNQUFJLE9BQU9uQixNQUFQLEtBQWtCLFFBQWxCLElBQThCLENBQUNBLE1BQW5DLEVBQTJDO0FBQ3pDLFdBQU9BLE1BQVA7QUFDRDs7QUFFRCxNQUFJOUcsS0FBS3RCLE1BQUwsS0FBZ0IsQ0FBcEIsRUFBdUI7QUFDckIsUUFBSW9JLFVBQVVBLE9BQU9oSixNQUFQLEtBQWtCLFNBQWhDLEVBQTJDO0FBQ3pDLGFBQU9pSyxRQUFRakIsT0FBTy9JLFFBQWYsQ0FBUDtBQUNEO0FBQ0QsV0FBTytJLE1BQVA7QUFDRDs7QUFFRCxNQUFJeUIsWUFBWXpCLE9BQU85RyxLQUFLLENBQUwsQ0FBUCxDQUFoQjtBQUNBLE1BQUksQ0FBQ3VJLFNBQUwsRUFBZ0I7QUFDZCxXQUFPekIsTUFBUDtBQUNEO0FBQ0QsTUFBSTBCLFNBQVNKLGdCQUFnQkcsU0FBaEIsRUFBMkJ2SSxLQUFLcEIsS0FBTCxDQUFXLENBQVgsQ0FBM0IsRUFBMENtSixPQUExQyxDQUFiO0FBQ0EsTUFBSU0sU0FBUyxFQUFiO0FBQ0EsT0FBSyxJQUFJNUosR0FBVCxJQUFnQnFJLE1BQWhCLEVBQXdCO0FBQ3RCLFFBQUlySSxPQUFPdUIsS0FBSyxDQUFMLENBQVgsRUFBb0I7QUFDbEJxSSxhQUFPNUosR0FBUCxJQUFjK0osTUFBZDtBQUNELEtBRkQsTUFFTztBQUNMSCxhQUFPNUosR0FBUCxJQUFjcUksT0FBT3JJLEdBQVAsQ0FBZDtBQUNEO0FBQ0Y7QUFDRCxTQUFPNEosTUFBUDtBQUNEOztBQUVEO0FBQ0E7QUFDQSxTQUFTbkYsaUJBQVQsQ0FBMkJ1RixJQUEzQixFQUFpQ2hLLEdBQWpDLEVBQXNDO0FBQ3BDLE1BQUksT0FBT2dLLElBQVAsS0FBZ0IsUUFBcEIsRUFBOEI7QUFDNUI7QUFDRDtBQUNELE1BQUlBLGdCQUFnQnhKLEtBQXBCLEVBQTJCO0FBQ3pCLFNBQUssSUFBSXlKLElBQVQsSUFBaUJELElBQWpCLEVBQXVCO0FBQ3JCLFlBQU1KLFNBQVNuRixrQkFBa0J3RixJQUFsQixFQUF3QmpLLEdBQXhCLENBQWY7QUFDQSxVQUFJNEosTUFBSixFQUFZO0FBQ1YsZUFBT0EsTUFBUDtBQUNEO0FBQ0Y7QUFDRjtBQUNELE1BQUlJLFFBQVFBLEtBQUtoSyxHQUFMLENBQVosRUFBdUI7QUFDckIsV0FBT2dLLElBQVA7QUFDRDtBQUNELE9BQUssSUFBSUUsTUFBVCxJQUFtQkYsSUFBbkIsRUFBeUI7QUFDdkIsVUFBTUosU0FBU25GLGtCQUFrQnVGLEtBQUtFLE1BQUwsQ0FBbEIsRUFBZ0NsSyxHQUFoQyxDQUFmO0FBQ0EsUUFBSTRKLE1BQUosRUFBWTtBQUNWLGFBQU9BLE1BQVA7QUFDRDtBQUNGO0FBQ0Y7O0FBRURPLE9BQU9DLE9BQVAsR0FBaUI3TCxTQUFqQiIsImZpbGUiOiJSZXN0UXVlcnkuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBBbiBvYmplY3QgdGhhdCBlbmNhcHN1bGF0ZXMgZXZlcnl0aGluZyB3ZSBuZWVkIHRvIHJ1biBhICdmaW5kJ1xuLy8gb3BlcmF0aW9uLCBlbmNvZGVkIGluIHRoZSBSRVNUIEFQSSBmb3JtYXQuXG5cbnZhciBTY2hlbWFDb250cm9sbGVyID0gcmVxdWlyZSgnLi9Db250cm9sbGVycy9TY2hlbWFDb250cm9sbGVyJyk7XG52YXIgUGFyc2UgPSByZXF1aXJlKCdwYXJzZS9ub2RlJykuUGFyc2U7XG5jb25zdCB0cmlnZ2VycyA9IHJlcXVpcmUoJy4vdHJpZ2dlcnMnKTtcblxuY29uc3QgQWx3YXlzU2VsZWN0ZWRLZXlzID0gWydvYmplY3RJZCcsICdjcmVhdGVkQXQnLCAndXBkYXRlZEF0J107XG4vLyByZXN0T3B0aW9ucyBjYW4gaW5jbHVkZTpcbi8vICAgc2tpcFxuLy8gICBsaW1pdFxuLy8gICBvcmRlclxuLy8gICBjb3VudFxuLy8gICBpbmNsdWRlXG4vLyAgIGtleXNcbi8vICAgcmVkaXJlY3RDbGFzc05hbWVGb3JLZXlcbmZ1bmN0aW9uIFJlc3RRdWVyeShjb25maWcsIGF1dGgsIGNsYXNzTmFtZSwgcmVzdFdoZXJlID0ge30sIHJlc3RPcHRpb25zID0ge30sIGNsaWVudFNESykge1xuXG4gIHRoaXMuY29uZmlnID0gY29uZmlnO1xuICB0aGlzLmF1dGggPSBhdXRoO1xuICB0aGlzLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbiAgdGhpcy5yZXN0V2hlcmUgPSByZXN0V2hlcmU7XG4gIHRoaXMucmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucztcbiAgdGhpcy5jbGllbnRTREsgPSBjbGllbnRTREs7XG4gIHRoaXMucmVzcG9uc2UgPSBudWxsO1xuICB0aGlzLmZpbmRPcHRpb25zID0ge307XG4gIHRoaXMuaXNXcml0ZSA9IGZhbHNlO1xuXG4gIGlmICghdGhpcy5hdXRoLmlzTWFzdGVyKSB7XG4gICAgaWYgKHRoaXMuY2xhc3NOYW1lID09ICdfU2Vzc2lvbicpIHtcbiAgICAgIGlmICghdGhpcy5hdXRoLnVzZXIpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTixcbiAgICAgICAgICAnSW52YWxpZCBzZXNzaW9uIHRva2VuJyk7XG4gICAgICB9XG4gICAgICB0aGlzLnJlc3RXaGVyZSA9IHtcbiAgICAgICAgJyRhbmQnOiBbdGhpcy5yZXN0V2hlcmUsIHtcbiAgICAgICAgICAndXNlcic6IHtcbiAgICAgICAgICAgIF9fdHlwZTogJ1BvaW50ZXInLFxuICAgICAgICAgICAgY2xhc3NOYW1lOiAnX1VzZXInLFxuICAgICAgICAgICAgb2JqZWN0SWQ6IHRoaXMuYXV0aC51c2VyLmlkXG4gICAgICAgICAgfVxuICAgICAgICB9XVxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICB0aGlzLmRvQ291bnQgPSBmYWxzZTtcbiAgdGhpcy5pbmNsdWRlQWxsID0gZmFsc2U7XG5cbiAgLy8gVGhlIGZvcm1hdCBmb3IgdGhpcy5pbmNsdWRlIGlzIG5vdCB0aGUgc2FtZSBhcyB0aGUgZm9ybWF0IGZvciB0aGVcbiAgLy8gaW5jbHVkZSBvcHRpb24gLSBpdCdzIHRoZSBwYXRocyB3ZSBzaG91bGQgaW5jbHVkZSwgaW4gb3JkZXIsXG4gIC8vIHN0b3JlZCBhcyBhcnJheXMsIHRha2luZyBpbnRvIGFjY291bnQgdGhhdCB3ZSBuZWVkIHRvIGluY2x1ZGUgZm9vXG4gIC8vIGJlZm9yZSBpbmNsdWRpbmcgZm9vLmJhci4gQWxzbyBpdCBzaG91bGQgZGVkdXBlLlxuICAvLyBGb3IgZXhhbXBsZSwgcGFzc2luZyBhbiBhcmcgb2YgaW5jbHVkZT1mb28uYmFyLGZvby5iYXogY291bGQgbGVhZCB0b1xuICAvLyB0aGlzLmluY2x1ZGUgPSBbWydmb28nXSwgWydmb28nLCAnYmF6J10sIFsnZm9vJywgJ2JhciddXVxuICB0aGlzLmluY2x1ZGUgPSBbXTtcblxuICAvLyBJZiB3ZSBoYXZlIGtleXMsIHdlIHByb2JhYmx5IHdhbnQgdG8gZm9yY2Ugc29tZSBpbmNsdWRlcyAobi0xIGxldmVsKVxuICAvLyBTZWUgaXNzdWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9wYXJzZS1jb21tdW5pdHkvcGFyc2Utc2VydmVyL2lzc3Vlcy8zMTg1XG4gIGlmIChyZXN0T3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgna2V5cycpKSB7XG4gICAgY29uc3Qga2V5c0ZvckluY2x1ZGUgPSByZXN0T3B0aW9ucy5rZXlzLnNwbGl0KCcsJykuZmlsdGVyKChrZXkpID0+IHtcbiAgICAgIC8vIEF0IGxlYXN0IDIgY29tcG9uZW50c1xuICAgICAgcmV0dXJuIGtleS5zcGxpdChcIi5cIikubGVuZ3RoID4gMTtcbiAgICB9KS5tYXAoKGtleSkgPT4ge1xuICAgICAgLy8gU2xpY2UgdGhlIGxhc3QgY29tcG9uZW50IChhLmIuYyAtPiBhLmIpXG4gICAgICAvLyBPdGhlcndpc2Ugd2UnbGwgaW5jbHVkZSBvbmUgbGV2ZWwgdG9vIG11Y2guXG4gICAgICByZXR1cm4ga2V5LnNsaWNlKDAsIGtleS5sYXN0SW5kZXhPZihcIi5cIikpO1xuICAgIH0pLmpvaW4oJywnKTtcblxuICAgIC8vIENvbmNhdCB0aGUgcG9zc2libHkgcHJlc2VudCBpbmNsdWRlIHN0cmluZyB3aXRoIHRoZSBvbmUgZnJvbSB0aGUga2V5c1xuICAgIC8vIERlZHVwIC8gc29ydGluZyBpcyBoYW5kbGUgaW4gJ2luY2x1ZGUnIGNhc2UuXG4gICAgaWYgKGtleXNGb3JJbmNsdWRlLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmICghcmVzdE9wdGlvbnMuaW5jbHVkZSB8fCByZXN0T3B0aW9ucy5pbmNsdWRlLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgIHJlc3RPcHRpb25zLmluY2x1ZGUgPSBrZXlzRm9ySW5jbHVkZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3RPcHRpb25zLmluY2x1ZGUgKz0gXCIsXCIgKyBrZXlzRm9ySW5jbHVkZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmb3IgKHZhciBvcHRpb24gaW4gcmVzdE9wdGlvbnMpIHtcbiAgICBzd2l0Y2gob3B0aW9uKSB7XG4gICAgY2FzZSAna2V5cyc6IHtcbiAgICAgIGNvbnN0IGtleXMgPSByZXN0T3B0aW9ucy5rZXlzLnNwbGl0KCcsJykuY29uY2F0KEFsd2F5c1NlbGVjdGVkS2V5cyk7XG4gICAgICB0aGlzLmtleXMgPSBBcnJheS5mcm9tKG5ldyBTZXQoa2V5cykpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNhc2UgJ2NvdW50JzpcbiAgICAgIHRoaXMuZG9Db3VudCA9IHRydWU7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdpbmNsdWRlQWxsJzpcbiAgICAgIHRoaXMuaW5jbHVkZUFsbCA9IHRydWU7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdkaXN0aW5jdCc6XG4gICAgY2FzZSAncGlwZWxpbmUnOlxuICAgIGNhc2UgJ3NraXAnOlxuICAgIGNhc2UgJ2xpbWl0JzpcbiAgICBjYXNlICdyZWFkUHJlZmVyZW5jZSc6XG4gICAgICB0aGlzLmZpbmRPcHRpb25zW29wdGlvbl0gPSByZXN0T3B0aW9uc1tvcHRpb25dO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnb3JkZXInOlxuICAgICAgdmFyIGZpZWxkcyA9IHJlc3RPcHRpb25zLm9yZGVyLnNwbGl0KCcsJyk7XG4gICAgICB0aGlzLmZpbmRPcHRpb25zLnNvcnQgPSBmaWVsZHMucmVkdWNlKChzb3J0TWFwLCBmaWVsZCkgPT4ge1xuICAgICAgICBmaWVsZCA9IGZpZWxkLnRyaW0oKTtcbiAgICAgICAgaWYgKGZpZWxkID09PSAnJHNjb3JlJykge1xuICAgICAgICAgIHNvcnRNYXAuc2NvcmUgPSB7JG1ldGE6ICd0ZXh0U2NvcmUnfTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZFswXSA9PSAnLScpIHtcbiAgICAgICAgICBzb3J0TWFwW2ZpZWxkLnNsaWNlKDEpXSA9IC0xO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHNvcnRNYXBbZmllbGRdID0gMTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc29ydE1hcDtcbiAgICAgIH0sIHt9KTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2luY2x1ZGUnOiB7XG4gICAgICBjb25zdCBwYXRocyA9IHJlc3RPcHRpb25zLmluY2x1ZGUuc3BsaXQoJywnKTtcbiAgICAgIC8vIExvYWQgdGhlIGV4aXN0aW5nIGluY2x1ZGVzIChmcm9tIGtleXMpXG4gICAgICBjb25zdCBwYXRoU2V0ID0gcGF0aHMucmVkdWNlKChtZW1vLCBwYXRoKSA9PiB7XG4gICAgICAgIC8vIFNwbGl0IGVhY2ggcGF0aHMgb24gLiAoYS5iLmMgLT4gW2EsYixjXSlcbiAgICAgICAgLy8gcmVkdWNlIHRvIGNyZWF0ZSBhbGwgcGF0aHNcbiAgICAgICAgLy8gKFthLGIsY10gLT4ge2E6IHRydWUsICdhLmInOiB0cnVlLCAnYS5iLmMnOiB0cnVlfSlcbiAgICAgICAgcmV0dXJuIHBhdGguc3BsaXQoJy4nKS5yZWR1Y2UoKG1lbW8sIHBhdGgsIGluZGV4LCBwYXJ0cykgPT4ge1xuICAgICAgICAgIG1lbW9bcGFydHMuc2xpY2UoMCwgaW5kZXggKyAxKS5qb2luKCcuJyldID0gdHJ1ZTtcbiAgICAgICAgICByZXR1cm4gbWVtbztcbiAgICAgICAgfSwgbWVtbyk7XG4gICAgICB9LCB7fSk7XG5cbiAgICAgIHRoaXMuaW5jbHVkZSA9IE9iamVjdC5rZXlzKHBhdGhTZXQpLm1hcCgocykgPT4ge1xuICAgICAgICByZXR1cm4gcy5zcGxpdCgnLicpO1xuICAgICAgfSkuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICByZXR1cm4gYS5sZW5ndGggLSBiLmxlbmd0aDsgLy8gU29ydCBieSBudW1iZXIgb2YgY29tcG9uZW50c1xuICAgICAgfSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2FzZSAncmVkaXJlY3RDbGFzc05hbWVGb3JLZXknOlxuICAgICAgdGhpcy5yZWRpcmVjdEtleSA9IHJlc3RPcHRpb25zLnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5O1xuICAgICAgdGhpcy5yZWRpcmVjdENsYXNzTmFtZSA9IG51bGw7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdpbmNsdWRlUmVhZFByZWZlcmVuY2UnOlxuICAgIGNhc2UgJ3N1YnF1ZXJ5UmVhZFByZWZlcmVuY2UnOlxuICAgICAgYnJlYWs7XG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICdiYWQgb3B0aW9uOiAnICsgb3B0aW9uKTtcbiAgICB9XG4gIH1cbn1cblxuLy8gQSBjb252ZW5pZW50IG1ldGhvZCB0byBwZXJmb3JtIGFsbCB0aGUgc3RlcHMgb2YgcHJvY2Vzc2luZyBhIHF1ZXJ5XG4vLyBpbiBvcmRlci5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciB0aGUgcmVzcG9uc2UgLSBhbiBvYmplY3Qgd2l0aCBvcHRpb25hbCBrZXlzXG4vLyAncmVzdWx0cycgYW5kICdjb3VudCcuXG4vLyBUT0RPOiBjb25zb2xpZGF0ZSB0aGUgcmVwbGFjZVggZnVuY3Rpb25zXG5SZXN0UXVlcnkucHJvdG90eXBlLmV4ZWN1dGUgPSBmdW5jdGlvbihleGVjdXRlT3B0aW9ucykge1xuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuYnVpbGRSZXN0V2hlcmUoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlSW5jbHVkZUFsbCgpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5ydW5GaW5kKGV4ZWN1dGVPcHRpb25zKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMucnVuQ291bnQoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlSW5jbHVkZSgpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5ydW5BZnRlckZpbmRUcmlnZ2VyKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJlc3BvbnNlO1xuICB9KTtcbn07XG5cblJlc3RRdWVyeS5wcm90b3R5cGUuYnVpbGRSZXN0V2hlcmUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmdldFVzZXJBbmRSb2xlQUNMKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5KCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbigpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5yZXBsYWNlU2VsZWN0KCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJlcGxhY2VEb250U2VsZWN0KCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJlcGxhY2VJblF1ZXJ5KCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJlcGxhY2VOb3RJblF1ZXJ5KCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJlcGxhY2VFcXVhbGl0eSgpO1xuICB9KTtcbn1cblxuLy8gTWFya3MgdGhlIHF1ZXJ5IGZvciBhIHdyaXRlIGF0dGVtcHQsIHNvIHdlIHJlYWQgdGhlIHByb3BlciBBQ0wgKHdyaXRlIGluc3RlYWQgb2YgcmVhZClcblJlc3RRdWVyeS5wcm90b3R5cGUuZm9yV3JpdGUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5pc1dyaXRlID0gdHJ1ZTtcbiAgcmV0dXJuIHRoaXM7XG59XG5cbi8vIFVzZXMgdGhlIEF1dGggb2JqZWN0IHRvIGdldCB0aGUgbGlzdCBvZiByb2xlcywgYWRkcyB0aGUgdXNlciBpZFxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5nZXRVc2VyQW5kUm9sZUFDTCA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5hdXRoLmlzTWFzdGVyKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgdGhpcy5maW5kT3B0aW9ucy5hY2wgPSBbJyonXTtcblxuICBpZiAodGhpcy5hdXRoLnVzZXIpIHtcbiAgICByZXR1cm4gdGhpcy5hdXRoLmdldFVzZXJSb2xlcygpLnRoZW4oKHJvbGVzKSA9PiB7XG4gICAgICB0aGlzLmZpbmRPcHRpb25zLmFjbCA9IHRoaXMuZmluZE9wdGlvbnMuYWNsLmNvbmNhdChyb2xlcywgW3RoaXMuYXV0aC51c2VyLmlkXSk7XG4gICAgICByZXR1cm47XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG59O1xuXG4vLyBDaGFuZ2VzIHRoZSBjbGFzc05hbWUgaWYgcmVkaXJlY3RDbGFzc05hbWVGb3JLZXkgaXMgc2V0LlxuLy8gUmV0dXJucyBhIHByb21pc2UuXG5SZXN0UXVlcnkucHJvdG90eXBlLnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5ID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5yZWRpcmVjdEtleSkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIC8vIFdlIG5lZWQgdG8gY2hhbmdlIHRoZSBjbGFzcyBuYW1lIGJhc2VkIG9uIHRoZSBzY2hlbWFcbiAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5KHRoaXMuY2xhc3NOYW1lLCB0aGlzLnJlZGlyZWN0S2V5KVxuICAgIC50aGVuKChuZXdDbGFzc05hbWUpID0+IHtcbiAgICAgIHRoaXMuY2xhc3NOYW1lID0gbmV3Q2xhc3NOYW1lO1xuICAgICAgdGhpcy5yZWRpcmVjdENsYXNzTmFtZSA9IG5ld0NsYXNzTmFtZTtcbiAgICB9KTtcbn07XG5cbi8vIFZhbGlkYXRlcyB0aGlzIG9wZXJhdGlvbiBhZ2FpbnN0IHRoZSBhbGxvd0NsaWVudENsYXNzQ3JlYXRpb24gY29uZmlnLlxuUmVzdFF1ZXJ5LnByb3RvdHlwZS52YWxpZGF0ZUNsaWVudENsYXNzQ3JlYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuY29uZmlnLmFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiA9PT0gZmFsc2UgJiYgIXRoaXMuYXV0aC5pc01hc3RlclxuICAgICAgJiYgU2NoZW1hQ29udHJvbGxlci5zeXN0ZW1DbGFzc2VzLmluZGV4T2YodGhpcy5jbGFzc05hbWUpID09PSAtMSkge1xuICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5sb2FkU2NoZW1hKClcbiAgICAgIC50aGVuKHNjaGVtYUNvbnRyb2xsZXIgPT4gc2NoZW1hQ29udHJvbGxlci5oYXNDbGFzcyh0aGlzLmNsYXNzTmFtZSkpXG4gICAgICAudGhlbihoYXNDbGFzcyA9PiB7XG4gICAgICAgIGlmIChoYXNDbGFzcyAhPT0gdHJ1ZSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgICAgICAgJ1RoaXMgdXNlciBpcyBub3QgYWxsb3dlZCB0byBhY2Nlc3MgJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdub24tZXhpc3RlbnQgY2xhc3M6ICcgKyB0aGlzLmNsYXNzTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gdHJhbnNmb3JtSW5RdWVyeShpblF1ZXJ5T2JqZWN0LCBjbGFzc05hbWUsIHJlc3VsdHMpIHtcbiAgdmFyIHZhbHVlcyA9IFtdO1xuICBmb3IgKHZhciByZXN1bHQgb2YgcmVzdWx0cykge1xuICAgIHZhbHVlcy5wdXNoKHtcbiAgICAgIF9fdHlwZTogJ1BvaW50ZXInLFxuICAgICAgY2xhc3NOYW1lOiBjbGFzc05hbWUsXG4gICAgICBvYmplY3RJZDogcmVzdWx0Lm9iamVjdElkXG4gICAgfSk7XG4gIH1cbiAgZGVsZXRlIGluUXVlcnlPYmplY3RbJyRpblF1ZXJ5J107XG4gIGlmIChBcnJheS5pc0FycmF5KGluUXVlcnlPYmplY3RbJyRpbiddKSkge1xuICAgIGluUXVlcnlPYmplY3RbJyRpbiddID0gaW5RdWVyeU9iamVjdFsnJGluJ10uY29uY2F0KHZhbHVlcyk7XG4gIH0gZWxzZSB7XG4gICAgaW5RdWVyeU9iamVjdFsnJGluJ10gPSB2YWx1ZXM7XG4gIH1cbn1cblxuLy8gUmVwbGFjZXMgYSAkaW5RdWVyeSBjbGF1c2UgYnkgcnVubmluZyB0aGUgc3VicXVlcnksIGlmIHRoZXJlIGlzIGFuXG4vLyAkaW5RdWVyeSBjbGF1c2UuXG4vLyBUaGUgJGluUXVlcnkgY2xhdXNlIHR1cm5zIGludG8gYW4gJGluIHdpdGggdmFsdWVzIHRoYXQgYXJlIGp1c3Rcbi8vIHBvaW50ZXJzIHRvIHRoZSBvYmplY3RzIHJldHVybmVkIGluIHRoZSBzdWJxdWVyeS5cblJlc3RRdWVyeS5wcm90b3R5cGUucmVwbGFjZUluUXVlcnkgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGluUXVlcnlPYmplY3QgPSBmaW5kT2JqZWN0V2l0aEtleSh0aGlzLnJlc3RXaGVyZSwgJyRpblF1ZXJ5Jyk7XG4gIGlmICghaW5RdWVyeU9iamVjdCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFRoZSBpblF1ZXJ5IHZhbHVlIG11c3QgaGF2ZSBwcmVjaXNlbHkgdHdvIGtleXMgLSB3aGVyZSBhbmQgY2xhc3NOYW1lXG4gIHZhciBpblF1ZXJ5VmFsdWUgPSBpblF1ZXJ5T2JqZWN0WyckaW5RdWVyeSddO1xuICBpZiAoIWluUXVlcnlWYWx1ZS53aGVyZSB8fCAhaW5RdWVyeVZhbHVlLmNsYXNzTmFtZSkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgJ2ltcHJvcGVyIHVzYWdlIG9mICRpblF1ZXJ5Jyk7XG4gIH1cblxuICBjb25zdCBhZGRpdGlvbmFsT3B0aW9ucyA9IHtcbiAgICByZWRpcmVjdENsYXNzTmFtZUZvcktleTogaW5RdWVyeVZhbHVlLnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5XG4gIH07XG5cbiAgaWYgKHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZSkge1xuICAgIGFkZGl0aW9uYWxPcHRpb25zLnJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICAgIGFkZGl0aW9uYWxPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UgPSB0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2U7XG4gIH1cblxuICB2YXIgc3VicXVlcnkgPSBuZXcgUmVzdFF1ZXJ5KFxuICAgIHRoaXMuY29uZmlnLCB0aGlzLmF1dGgsIGluUXVlcnlWYWx1ZS5jbGFzc05hbWUsXG4gICAgaW5RdWVyeVZhbHVlLndoZXJlLCBhZGRpdGlvbmFsT3B0aW9ucyk7XG4gIHJldHVybiBzdWJxdWVyeS5leGVjdXRlKCkudGhlbigocmVzcG9uc2UpID0+IHtcbiAgICB0cmFuc2Zvcm1JblF1ZXJ5KGluUXVlcnlPYmplY3QsIHN1YnF1ZXJ5LmNsYXNzTmFtZSwgcmVzcG9uc2UucmVzdWx0cyk7XG4gICAgLy8gUmVjdXJzZSB0byByZXBlYXRcbiAgICByZXR1cm4gdGhpcy5yZXBsYWNlSW5RdWVyeSgpO1xuICB9KTtcbn07XG5cbmZ1bmN0aW9uIHRyYW5zZm9ybU5vdEluUXVlcnkobm90SW5RdWVyeU9iamVjdCwgY2xhc3NOYW1lLCByZXN1bHRzKSB7XG4gIHZhciB2YWx1ZXMgPSBbXTtcbiAgZm9yICh2YXIgcmVzdWx0IG9mIHJlc3VsdHMpIHtcbiAgICB2YWx1ZXMucHVzaCh7XG4gICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgIGNsYXNzTmFtZTogY2xhc3NOYW1lLFxuICAgICAgb2JqZWN0SWQ6IHJlc3VsdC5vYmplY3RJZFxuICAgIH0pO1xuICB9XG4gIGRlbGV0ZSBub3RJblF1ZXJ5T2JqZWN0Wyckbm90SW5RdWVyeSddO1xuICBpZiAoQXJyYXkuaXNBcnJheShub3RJblF1ZXJ5T2JqZWN0WyckbmluJ10pKSB7XG4gICAgbm90SW5RdWVyeU9iamVjdFsnJG5pbiddID0gbm90SW5RdWVyeU9iamVjdFsnJG5pbiddLmNvbmNhdCh2YWx1ZXMpO1xuICB9IGVsc2Uge1xuICAgIG5vdEluUXVlcnlPYmplY3RbJyRuaW4nXSA9IHZhbHVlcztcbiAgfVxufVxuXG4vLyBSZXBsYWNlcyBhICRub3RJblF1ZXJ5IGNsYXVzZSBieSBydW5uaW5nIHRoZSBzdWJxdWVyeSwgaWYgdGhlcmUgaXMgYW5cbi8vICRub3RJblF1ZXJ5IGNsYXVzZS5cbi8vIFRoZSAkbm90SW5RdWVyeSBjbGF1c2UgdHVybnMgaW50byBhICRuaW4gd2l0aCB2YWx1ZXMgdGhhdCBhcmUganVzdFxuLy8gcG9pbnRlcnMgdG8gdGhlIG9iamVjdHMgcmV0dXJuZWQgaW4gdGhlIHN1YnF1ZXJ5LlxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5yZXBsYWNlTm90SW5RdWVyeSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgbm90SW5RdWVyeU9iamVjdCA9IGZpbmRPYmplY3RXaXRoS2V5KHRoaXMucmVzdFdoZXJlLCAnJG5vdEluUXVlcnknKTtcbiAgaWYgKCFub3RJblF1ZXJ5T2JqZWN0KSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gVGhlIG5vdEluUXVlcnkgdmFsdWUgbXVzdCBoYXZlIHByZWNpc2VseSB0d28ga2V5cyAtIHdoZXJlIGFuZCBjbGFzc05hbWVcbiAgdmFyIG5vdEluUXVlcnlWYWx1ZSA9IG5vdEluUXVlcnlPYmplY3RbJyRub3RJblF1ZXJ5J107XG4gIGlmICghbm90SW5RdWVyeVZhbHVlLndoZXJlIHx8ICFub3RJblF1ZXJ5VmFsdWUuY2xhc3NOYW1lKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksXG4gICAgICAnaW1wcm9wZXIgdXNhZ2Ugb2YgJG5vdEluUXVlcnknKTtcbiAgfVxuXG4gIGNvbnN0IGFkZGl0aW9uYWxPcHRpb25zID0ge1xuICAgIHJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5OiBub3RJblF1ZXJ5VmFsdWUucmVkaXJlY3RDbGFzc05hbWVGb3JLZXlcbiAgfTtcblxuICBpZiAodGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlKSB7XG4gICAgYWRkaXRpb25hbE9wdGlvbnMucmVhZFByZWZlcmVuY2UgPSB0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2U7XG4gICAgYWRkaXRpb25hbE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZTtcbiAgfVxuXG4gIHZhciBzdWJxdWVyeSA9IG5ldyBSZXN0UXVlcnkoXG4gICAgdGhpcy5jb25maWcsIHRoaXMuYXV0aCwgbm90SW5RdWVyeVZhbHVlLmNsYXNzTmFtZSxcbiAgICBub3RJblF1ZXJ5VmFsdWUud2hlcmUsIGFkZGl0aW9uYWxPcHRpb25zKTtcbiAgcmV0dXJuIHN1YnF1ZXJ5LmV4ZWN1dGUoKS50aGVuKChyZXNwb25zZSkgPT4ge1xuICAgIHRyYW5zZm9ybU5vdEluUXVlcnkobm90SW5RdWVyeU9iamVjdCwgc3VicXVlcnkuY2xhc3NOYW1lLCByZXNwb25zZS5yZXN1bHRzKTtcbiAgICAvLyBSZWN1cnNlIHRvIHJlcGVhdFxuICAgIHJldHVybiB0aGlzLnJlcGxhY2VOb3RJblF1ZXJ5KCk7XG4gIH0pO1xufTtcblxuY29uc3QgdHJhbnNmb3JtU2VsZWN0ID0gKHNlbGVjdE9iamVjdCwga2V5ICxvYmplY3RzKSA9PiB7XG4gIHZhciB2YWx1ZXMgPSBbXTtcbiAgZm9yICh2YXIgcmVzdWx0IG9mIG9iamVjdHMpIHtcbiAgICB2YWx1ZXMucHVzaChrZXkuc3BsaXQoJy4nKS5yZWR1Y2UoKG8saSk9Pm9baV0sIHJlc3VsdCkpO1xuICB9XG4gIGRlbGV0ZSBzZWxlY3RPYmplY3RbJyRzZWxlY3QnXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkoc2VsZWN0T2JqZWN0WyckaW4nXSkpIHtcbiAgICBzZWxlY3RPYmplY3RbJyRpbiddID0gc2VsZWN0T2JqZWN0WyckaW4nXS5jb25jYXQodmFsdWVzKTtcbiAgfSBlbHNlIHtcbiAgICBzZWxlY3RPYmplY3RbJyRpbiddID0gdmFsdWVzO1xuICB9XG59XG5cbi8vIFJlcGxhY2VzIGEgJHNlbGVjdCBjbGF1c2UgYnkgcnVubmluZyB0aGUgc3VicXVlcnksIGlmIHRoZXJlIGlzIGFcbi8vICRzZWxlY3QgY2xhdXNlLlxuLy8gVGhlICRzZWxlY3QgY2xhdXNlIHR1cm5zIGludG8gYW4gJGluIHdpdGggdmFsdWVzIHNlbGVjdGVkIG91dCBvZlxuLy8gdGhlIHN1YnF1ZXJ5LlxuLy8gUmV0dXJucyBhIHBvc3NpYmxlLXByb21pc2UuXG5SZXN0UXVlcnkucHJvdG90eXBlLnJlcGxhY2VTZWxlY3QgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHNlbGVjdE9iamVjdCA9IGZpbmRPYmplY3RXaXRoS2V5KHRoaXMucmVzdFdoZXJlLCAnJHNlbGVjdCcpO1xuICBpZiAoIXNlbGVjdE9iamVjdCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFRoZSBzZWxlY3QgdmFsdWUgbXVzdCBoYXZlIHByZWNpc2VseSB0d28ga2V5cyAtIHF1ZXJ5IGFuZCBrZXlcbiAgdmFyIHNlbGVjdFZhbHVlID0gc2VsZWN0T2JqZWN0Wyckc2VsZWN0J107XG4gIC8vIGlPUyBTREsgZG9uJ3Qgc2VuZCB3aGVyZSBpZiBub3Qgc2V0LCBsZXQgaXQgcGFzc1xuICBpZiAoIXNlbGVjdFZhbHVlLnF1ZXJ5IHx8XG4gICAgICAhc2VsZWN0VmFsdWUua2V5IHx8XG4gICAgICB0eXBlb2Ygc2VsZWN0VmFsdWUucXVlcnkgIT09ICdvYmplY3QnIHx8XG4gICAgICAhc2VsZWN0VmFsdWUucXVlcnkuY2xhc3NOYW1lIHx8XG4gICAgICBPYmplY3Qua2V5cyhzZWxlY3RWYWx1ZSkubGVuZ3RoICE9PSAyKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksXG4gICAgICAnaW1wcm9wZXIgdXNhZ2Ugb2YgJHNlbGVjdCcpO1xuICB9XG5cbiAgY29uc3QgYWRkaXRpb25hbE9wdGlvbnMgPSB7XG4gICAgcmVkaXJlY3RDbGFzc05hbWVGb3JLZXk6IHNlbGVjdFZhbHVlLnF1ZXJ5LnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5XG4gIH07XG5cbiAgaWYgKHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZSkge1xuICAgIGFkZGl0aW9uYWxPcHRpb25zLnJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICAgIGFkZGl0aW9uYWxPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UgPSB0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2U7XG4gIH1cblxuICB2YXIgc3VicXVlcnkgPSBuZXcgUmVzdFF1ZXJ5KFxuICAgIHRoaXMuY29uZmlnLCB0aGlzLmF1dGgsIHNlbGVjdFZhbHVlLnF1ZXJ5LmNsYXNzTmFtZSxcbiAgICBzZWxlY3RWYWx1ZS5xdWVyeS53aGVyZSwgYWRkaXRpb25hbE9wdGlvbnMpO1xuICByZXR1cm4gc3VicXVlcnkuZXhlY3V0ZSgpLnRoZW4oKHJlc3BvbnNlKSA9PiB7XG4gICAgdHJhbnNmb3JtU2VsZWN0KHNlbGVjdE9iamVjdCwgc2VsZWN0VmFsdWUua2V5LCByZXNwb25zZS5yZXN1bHRzKTtcbiAgICAvLyBLZWVwIHJlcGxhY2luZyAkc2VsZWN0IGNsYXVzZXNcbiAgICByZXR1cm4gdGhpcy5yZXBsYWNlU2VsZWN0KCk7XG4gIH0pXG59O1xuXG5jb25zdCB0cmFuc2Zvcm1Eb250U2VsZWN0ID0gKGRvbnRTZWxlY3RPYmplY3QsIGtleSwgb2JqZWN0cykgPT4ge1xuICB2YXIgdmFsdWVzID0gW107XG4gIGZvciAodmFyIHJlc3VsdCBvZiBvYmplY3RzKSB7XG4gICAgdmFsdWVzLnB1c2goa2V5LnNwbGl0KCcuJykucmVkdWNlKChvLGkpPT5vW2ldLCByZXN1bHQpKTtcbiAgfVxuICBkZWxldGUgZG9udFNlbGVjdE9iamVjdFsnJGRvbnRTZWxlY3QnXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkoZG9udFNlbGVjdE9iamVjdFsnJG5pbiddKSkge1xuICAgIGRvbnRTZWxlY3RPYmplY3RbJyRuaW4nXSA9IGRvbnRTZWxlY3RPYmplY3RbJyRuaW4nXS5jb25jYXQodmFsdWVzKTtcbiAgfSBlbHNlIHtcbiAgICBkb250U2VsZWN0T2JqZWN0WyckbmluJ10gPSB2YWx1ZXM7XG4gIH1cbn1cblxuLy8gUmVwbGFjZXMgYSAkZG9udFNlbGVjdCBjbGF1c2UgYnkgcnVubmluZyB0aGUgc3VicXVlcnksIGlmIHRoZXJlIGlzIGFcbi8vICRkb250U2VsZWN0IGNsYXVzZS5cbi8vIFRoZSAkZG9udFNlbGVjdCBjbGF1c2UgdHVybnMgaW50byBhbiAkbmluIHdpdGggdmFsdWVzIHNlbGVjdGVkIG91dCBvZlxuLy8gdGhlIHN1YnF1ZXJ5LlxuLy8gUmV0dXJucyBhIHBvc3NpYmxlLXByb21pc2UuXG5SZXN0UXVlcnkucHJvdG90eXBlLnJlcGxhY2VEb250U2VsZWN0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBkb250U2VsZWN0T2JqZWN0ID0gZmluZE9iamVjdFdpdGhLZXkodGhpcy5yZXN0V2hlcmUsICckZG9udFNlbGVjdCcpO1xuICBpZiAoIWRvbnRTZWxlY3RPYmplY3QpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBUaGUgZG9udFNlbGVjdCB2YWx1ZSBtdXN0IGhhdmUgcHJlY2lzZWx5IHR3byBrZXlzIC0gcXVlcnkgYW5kIGtleVxuICB2YXIgZG9udFNlbGVjdFZhbHVlID0gZG9udFNlbGVjdE9iamVjdFsnJGRvbnRTZWxlY3QnXTtcbiAgaWYgKCFkb250U2VsZWN0VmFsdWUucXVlcnkgfHxcbiAgICAgICFkb250U2VsZWN0VmFsdWUua2V5IHx8XG4gICAgICB0eXBlb2YgZG9udFNlbGVjdFZhbHVlLnF1ZXJ5ICE9PSAnb2JqZWN0JyB8fFxuICAgICAgIWRvbnRTZWxlY3RWYWx1ZS5xdWVyeS5jbGFzc05hbWUgfHxcbiAgICAgIE9iamVjdC5rZXlzKGRvbnRTZWxlY3RWYWx1ZSkubGVuZ3RoICE9PSAyKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksXG4gICAgICAnaW1wcm9wZXIgdXNhZ2Ugb2YgJGRvbnRTZWxlY3QnKTtcbiAgfVxuICBjb25zdCBhZGRpdGlvbmFsT3B0aW9ucyA9IHtcbiAgICByZWRpcmVjdENsYXNzTmFtZUZvcktleTogZG9udFNlbGVjdFZhbHVlLnF1ZXJ5LnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5XG4gIH07XG5cbiAgaWYgKHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZSkge1xuICAgIGFkZGl0aW9uYWxPcHRpb25zLnJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICAgIGFkZGl0aW9uYWxPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UgPSB0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2U7XG4gIH1cblxuICB2YXIgc3VicXVlcnkgPSBuZXcgUmVzdFF1ZXJ5KFxuICAgIHRoaXMuY29uZmlnLCB0aGlzLmF1dGgsIGRvbnRTZWxlY3RWYWx1ZS5xdWVyeS5jbGFzc05hbWUsXG4gICAgZG9udFNlbGVjdFZhbHVlLnF1ZXJ5LndoZXJlLCBhZGRpdGlvbmFsT3B0aW9ucyk7XG4gIHJldHVybiBzdWJxdWVyeS5leGVjdXRlKCkudGhlbigocmVzcG9uc2UpID0+IHtcbiAgICB0cmFuc2Zvcm1Eb250U2VsZWN0KGRvbnRTZWxlY3RPYmplY3QsIGRvbnRTZWxlY3RWYWx1ZS5rZXksIHJlc3BvbnNlLnJlc3VsdHMpO1xuICAgIC8vIEtlZXAgcmVwbGFjaW5nICRkb250U2VsZWN0IGNsYXVzZXNcbiAgICByZXR1cm4gdGhpcy5yZXBsYWNlRG9udFNlbGVjdCgpO1xuICB9KVxufTtcblxuY29uc3QgY2xlYW5SZXN1bHRPZlNlbnNpdGl2ZVVzZXJJbmZvID0gZnVuY3Rpb24gKHJlc3VsdCwgYXV0aCwgY29uZmlnKSB7XG4gIGRlbGV0ZSByZXN1bHQucGFzc3dvcmQ7XG5cbiAgaWYgKGF1dGguaXNNYXN0ZXIgfHwgKGF1dGgudXNlciAmJiBhdXRoLnVzZXIuaWQgPT09IHJlc3VsdC5vYmplY3RJZCkpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBmb3IgKGNvbnN0IGZpZWxkIG9mIGNvbmZpZy51c2VyU2Vuc2l0aXZlRmllbGRzKSB7XG4gICAgZGVsZXRlIHJlc3VsdFtmaWVsZF07XG4gIH1cbn07XG5cbmNvbnN0IGNsZWFuUmVzdWx0QXV0aERhdGEgPSBmdW5jdGlvbiAocmVzdWx0KSB7XG4gIGlmIChyZXN1bHQuYXV0aERhdGEpIHtcbiAgICBPYmplY3Qua2V5cyhyZXN1bHQuYXV0aERhdGEpLmZvckVhY2goKHByb3ZpZGVyKSA9PiB7XG4gICAgICBpZiAocmVzdWx0LmF1dGhEYXRhW3Byb3ZpZGVyXSA9PT0gbnVsbCkge1xuICAgICAgICBkZWxldGUgcmVzdWx0LmF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmIChPYmplY3Qua2V5cyhyZXN1bHQuYXV0aERhdGEpLmxlbmd0aCA9PSAwKSB7XG4gICAgICBkZWxldGUgcmVzdWx0LmF1dGhEYXRhO1xuICAgIH1cbiAgfVxufTtcblxuY29uc3QgcmVwbGFjZUVxdWFsaXR5Q29uc3RyYWludCA9IChjb25zdHJhaW50KSA9PiB7XG4gIGlmICh0eXBlb2YgY29uc3RyYWludCAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gY29uc3RyYWludDtcbiAgfVxuICBjb25zdCBlcXVhbFRvT2JqZWN0ID0ge307XG4gIGxldCBoYXNEaXJlY3RDb25zdHJhaW50ID0gZmFsc2U7XG4gIGxldCBoYXNPcGVyYXRvckNvbnN0cmFpbnQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCBrZXkgaW4gY29uc3RyYWludCkge1xuICAgIGlmIChrZXkuaW5kZXhPZignJCcpICE9PSAwKSB7XG4gICAgICBoYXNEaXJlY3RDb25zdHJhaW50ID0gdHJ1ZTtcbiAgICAgIGVxdWFsVG9PYmplY3Rba2V5XSA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICB9IGVsc2Uge1xuICAgICAgaGFzT3BlcmF0b3JDb25zdHJhaW50ID0gdHJ1ZTtcbiAgICB9XG4gIH1cbiAgaWYgKGhhc0RpcmVjdENvbnN0cmFpbnQgJiYgaGFzT3BlcmF0b3JDb25zdHJhaW50KSB7XG4gICAgY29uc3RyYWludFsnJGVxJ10gPSBlcXVhbFRvT2JqZWN0O1xuICAgIE9iamVjdC5rZXlzKGVxdWFsVG9PYmplY3QpLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgZGVsZXRlIGNvbnN0cmFpbnRba2V5XTtcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gY29uc3RyYWludDtcbn1cblxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5yZXBsYWNlRXF1YWxpdHkgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHR5cGVvZiB0aGlzLnJlc3RXaGVyZSAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgZm9yIChjb25zdCBrZXkgaW4gdGhpcy5yZXN0V2hlcmUpIHtcbiAgICB0aGlzLnJlc3RXaGVyZVtrZXldID0gcmVwbGFjZUVxdWFsaXR5Q29uc3RyYWludCh0aGlzLnJlc3RXaGVyZVtrZXldKTtcbiAgfVxufVxuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3Igd2hldGhlciBpdCB3YXMgc3VjY2Vzc2Z1bC5cbi8vIFBvcHVsYXRlcyB0aGlzLnJlc3BvbnNlIHdpdGggYW4gb2JqZWN0IHRoYXQgb25seSBoYXMgJ3Jlc3VsdHMnLlxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5ydW5GaW5kID0gZnVuY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gIGlmICh0aGlzLmZpbmRPcHRpb25zLmxpbWl0ID09PSAwKSB7XG4gICAgdGhpcy5yZXNwb25zZSA9IHtyZXN1bHRzOiBbXX07XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG4gIGNvbnN0IGZpbmRPcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5maW5kT3B0aW9ucyk7XG4gIGlmICh0aGlzLmtleXMpIHtcbiAgICBmaW5kT3B0aW9ucy5rZXlzID0gdGhpcy5rZXlzLm1hcCgoa2V5KSA9PiB7XG4gICAgICByZXR1cm4ga2V5LnNwbGl0KCcuJylbMF07XG4gICAgfSk7XG4gIH1cbiAgaWYgKG9wdGlvbnMub3ApIHtcbiAgICBmaW5kT3B0aW9ucy5vcCA9IG9wdGlvbnMub3A7XG4gIH1cbiAgaWYgKHRoaXMuaXNXcml0ZSkge1xuICAgIGZpbmRPcHRpb25zLmlzV3JpdGUgPSB0cnVlO1xuICB9XG4gIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKHRoaXMuY2xhc3NOYW1lLCB0aGlzLnJlc3RXaGVyZSwgZmluZE9wdGlvbnMpXG4gICAgLnRoZW4oKHJlc3VsdHMpID0+IHtcbiAgICAgIGlmICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgICAgICBmb3IgKHZhciByZXN1bHQgb2YgcmVzdWx0cykge1xuICAgICAgICAgIGNsZWFuUmVzdWx0T2ZTZW5zaXRpdmVVc2VySW5mbyhyZXN1bHQsIHRoaXMuYXV0aCwgdGhpcy5jb25maWcpO1xuICAgICAgICAgIGNsZWFuUmVzdWx0QXV0aERhdGEocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aGlzLmNvbmZpZy5maWxlc0NvbnRyb2xsZXIuZXhwYW5kRmlsZXNJbk9iamVjdCh0aGlzLmNvbmZpZywgcmVzdWx0cyk7XG5cbiAgICAgIGlmICh0aGlzLnJlZGlyZWN0Q2xhc3NOYW1lKSB7XG4gICAgICAgIGZvciAodmFyIHIgb2YgcmVzdWx0cykge1xuICAgICAgICAgIHIuY2xhc3NOYW1lID0gdGhpcy5yZWRpcmVjdENsYXNzTmFtZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5yZXNwb25zZSA9IHtyZXN1bHRzOiByZXN1bHRzfTtcbiAgICB9KTtcbn07XG5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciB3aGV0aGVyIGl0IHdhcyBzdWNjZXNzZnVsLlxuLy8gUG9wdWxhdGVzIHRoaXMucmVzcG9uc2UuY291bnQgd2l0aCB0aGUgY291bnRcblJlc3RRdWVyeS5wcm90b3R5cGUucnVuQ291bnQgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmRvQ291bnQpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdGhpcy5maW5kT3B0aW9ucy5jb3VudCA9IHRydWU7XG4gIGRlbGV0ZSB0aGlzLmZpbmRPcHRpb25zLnNraXA7XG4gIGRlbGV0ZSB0aGlzLmZpbmRPcHRpb25zLmxpbWl0O1xuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZCh0aGlzLmNsYXNzTmFtZSwgdGhpcy5yZXN0V2hlcmUsIHRoaXMuZmluZE9wdGlvbnMpXG4gICAgLnRoZW4oKGMpID0+IHtcbiAgICAgIHRoaXMucmVzcG9uc2UuY291bnQgPSBjO1xuICAgIH0pO1xufTtcblxuLy8gQXVnbWVudHMgdGhpcy5yZXNwb25zZSB3aXRoIGFsbCBwb2ludGVycyBvbiBhbiBvYmplY3RcblJlc3RRdWVyeS5wcm90b3R5cGUuaGFuZGxlSW5jbHVkZUFsbCA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuaW5jbHVkZUFsbCkge1xuICAgIHJldHVybjtcbiAgfVxuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UubG9hZFNjaGVtYSgpXG4gICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiBzY2hlbWFDb250cm9sbGVyLmdldE9uZVNjaGVtYSh0aGlzLmNsYXNzTmFtZSkpXG4gICAgLnRoZW4oc2NoZW1hID0+IHtcbiAgICAgIGNvbnN0IGluY2x1ZGVGaWVsZHMgPSBbXTtcbiAgICAgIGNvbnN0IGtleUZpZWxkcyA9IFtdO1xuICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBzY2hlbWEuZmllbGRzKSB7XG4gICAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlICYmIHNjaGVtYS5maWVsZHNbZmllbGRdLnR5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgICAgIGluY2x1ZGVGaWVsZHMucHVzaChbZmllbGRdKTtcbiAgICAgICAgICBrZXlGaWVsZHMucHVzaChmaWVsZCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIEFkZCBmaWVsZHMgdG8gaW5jbHVkZSwga2V5cywgcmVtb3ZlIGR1cHNcbiAgICAgIHRoaXMuaW5jbHVkZSA9IFsuLi5uZXcgU2V0KFsuLi50aGlzLmluY2x1ZGUsIC4uLmluY2x1ZGVGaWVsZHNdKV07XG4gICAgICAvLyBpZiB0aGlzLmtleXMgbm90IHNldCwgdGhlbiBhbGwga2V5cyBhcmUgYWxyZWFkeSBpbmNsdWRlZFxuICAgICAgaWYgKHRoaXMua2V5cykge1xuICAgICAgICB0aGlzLmtleXMgPSBbLi4ubmV3IFNldChbLi4udGhpcy5rZXlzLCAuLi5rZXlGaWVsZHNdKV07XG4gICAgICB9XG4gICAgfSk7XG59O1xuXG4vLyBBdWdtZW50cyB0aGlzLnJlc3BvbnNlIHdpdGggZGF0YSBhdCB0aGUgcGF0aHMgcHJvdmlkZWQgaW4gdGhpcy5pbmNsdWRlLlxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5oYW5kbGVJbmNsdWRlID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmluY2x1ZGUubGVuZ3RoID09IDApIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB2YXIgcGF0aFJlc3BvbnNlID0gaW5jbHVkZVBhdGgodGhpcy5jb25maWcsIHRoaXMuYXV0aCxcbiAgICB0aGlzLnJlc3BvbnNlLCB0aGlzLmluY2x1ZGVbMF0sIHRoaXMucmVzdE9wdGlvbnMpO1xuICBpZiAocGF0aFJlc3BvbnNlLnRoZW4pIHtcbiAgICByZXR1cm4gcGF0aFJlc3BvbnNlLnRoZW4oKG5ld1Jlc3BvbnNlKSA9PiB7XG4gICAgICB0aGlzLnJlc3BvbnNlID0gbmV3UmVzcG9uc2U7XG4gICAgICB0aGlzLmluY2x1ZGUgPSB0aGlzLmluY2x1ZGUuc2xpY2UoMSk7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVJbmNsdWRlKCk7XG4gICAgfSk7XG4gIH0gZWxzZSBpZiAodGhpcy5pbmNsdWRlLmxlbmd0aCA+IDApIHtcbiAgICB0aGlzLmluY2x1ZGUgPSB0aGlzLmluY2x1ZGUuc2xpY2UoMSk7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlSW5jbHVkZSgpO1xuICB9XG5cbiAgcmV0dXJuIHBhdGhSZXNwb25zZTtcbn07XG5cbi8vUmV0dXJucyBhIHByb21pc2Ugb2YgYSBwcm9jZXNzZWQgc2V0IG9mIHJlc3VsdHNcblJlc3RRdWVyeS5wcm90b3R5cGUucnVuQWZ0ZXJGaW5kVHJpZ2dlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMucmVzcG9uc2UpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gQXZvaWQgZG9pbmcgYW55IHNldHVwIGZvciB0cmlnZ2VycyBpZiB0aGVyZSBpcyBubyAnYWZ0ZXJGaW5kJyB0cmlnZ2VyIGZvciB0aGlzIGNsYXNzLlxuICBjb25zdCBoYXNBZnRlckZpbmRIb29rID0gdHJpZ2dlcnMudHJpZ2dlckV4aXN0cyh0aGlzLmNsYXNzTmFtZSwgdHJpZ2dlcnMuVHlwZXMuYWZ0ZXJGaW5kLCB0aGlzLmNvbmZpZy5hcHBsaWNhdGlvbklkKTtcbiAgaWYgKCFoYXNBZnRlckZpbmRIb29rKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG4gIC8vIFNraXAgQWdncmVnYXRlIGFuZCBEaXN0aW5jdCBRdWVyaWVzXG4gIGlmICh0aGlzLmZpbmRPcHRpb25zLnBpcGVsaW5lIHx8IHRoaXMuZmluZE9wdGlvbnMuZGlzdGluY3QpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbiAgLy8gUnVuIGFmdGVyRmluZCB0cmlnZ2VyIGFuZCBzZXQgdGhlIG5ldyByZXN1bHRzXG4gIHJldHVybiB0cmlnZ2Vycy5tYXliZVJ1bkFmdGVyRmluZFRyaWdnZXIodHJpZ2dlcnMuVHlwZXMuYWZ0ZXJGaW5kLCB0aGlzLmF1dGgsIHRoaXMuY2xhc3NOYW1lLHRoaXMucmVzcG9uc2UucmVzdWx0cywgdGhpcy5jb25maWcpLnRoZW4oKHJlc3VsdHMpID0+IHtcbiAgICAvLyBFbnN1cmUgd2UgcHJvcGVybHkgc2V0IHRoZSBjbGFzc05hbWUgYmFja1xuICAgIGlmICh0aGlzLnJlZGlyZWN0Q2xhc3NOYW1lKSB7XG4gICAgICB0aGlzLnJlc3BvbnNlLnJlc3VsdHMgPSByZXN1bHRzLm1hcCgob2JqZWN0KSA9PiB7XG4gICAgICAgIGlmIChvYmplY3QgaW5zdGFuY2VvZiBQYXJzZS5PYmplY3QpIHtcbiAgICAgICAgICBvYmplY3QgPSBvYmplY3QudG9KU09OKCk7XG4gICAgICAgIH1cbiAgICAgICAgb2JqZWN0LmNsYXNzTmFtZSA9IHRoaXMucmVkaXJlY3RDbGFzc05hbWU7XG4gICAgICAgIHJldHVybiBvYmplY3Q7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZXNwb25zZS5yZXN1bHRzID0gcmVzdWx0cztcbiAgICB9XG4gIH0pO1xufTtcblxuLy8gQWRkcyBpbmNsdWRlZCB2YWx1ZXMgdG8gdGhlIHJlc3BvbnNlLlxuLy8gUGF0aCBpcyBhIGxpc3Qgb2YgZmllbGQgbmFtZXMuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgYW4gYXVnbWVudGVkIHJlc3BvbnNlLlxuZnVuY3Rpb24gaW5jbHVkZVBhdGgoY29uZmlnLCBhdXRoLCByZXNwb25zZSwgcGF0aCwgcmVzdE9wdGlvbnMgPSB7fSkge1xuICB2YXIgcG9pbnRlcnMgPSBmaW5kUG9pbnRlcnMocmVzcG9uc2UucmVzdWx0cywgcGF0aCk7XG4gIGlmIChwb2ludGVycy5sZW5ndGggPT0gMCkge1xuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuICBjb25zdCBwb2ludGVyc0hhc2ggPSB7fTtcbiAgZm9yICh2YXIgcG9pbnRlciBvZiBwb2ludGVycykge1xuICAgIGlmICghcG9pbnRlcikge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGNsYXNzTmFtZSA9IHBvaW50ZXIuY2xhc3NOYW1lO1xuICAgIC8vIG9ubHkgaW5jbHVkZSB0aGUgZ29vZCBwb2ludGVyc1xuICAgIGlmIChjbGFzc05hbWUpIHtcbiAgICAgIHBvaW50ZXJzSGFzaFtjbGFzc05hbWVdID0gcG9pbnRlcnNIYXNoW2NsYXNzTmFtZV0gfHwgbmV3IFNldCgpO1xuICAgICAgcG9pbnRlcnNIYXNoW2NsYXNzTmFtZV0uYWRkKHBvaW50ZXIub2JqZWN0SWQpO1xuICAgIH1cbiAgfVxuICBjb25zdCBpbmNsdWRlUmVzdE9wdGlvbnMgPSB7fTtcbiAgaWYgKHJlc3RPcHRpb25zLmtleXMpIHtcbiAgICBjb25zdCBrZXlzID0gbmV3IFNldChyZXN0T3B0aW9ucy5rZXlzLnNwbGl0KCcsJykpO1xuICAgIGNvbnN0IGtleVNldCA9IEFycmF5LmZyb20oa2V5cykucmVkdWNlKChzZXQsIGtleSkgPT4ge1xuICAgICAgY29uc3Qga2V5UGF0aCA9IGtleS5zcGxpdCgnLicpO1xuICAgICAgbGV0IGkgPSAwO1xuICAgICAgZm9yIChpOyBpIDwgcGF0aC5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAocGF0aFtpXSAhPSBrZXlQYXRoW2ldKSB7XG4gICAgICAgICAgcmV0dXJuIHNldDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGkgPCBrZXlQYXRoLmxlbmd0aCkge1xuICAgICAgICBzZXQuYWRkKGtleVBhdGhbaV0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNldDtcbiAgICB9LCBuZXcgU2V0KCkpO1xuICAgIGlmIChrZXlTZXQuc2l6ZSA+IDApIHtcbiAgICAgIGluY2x1ZGVSZXN0T3B0aW9ucy5rZXlzID0gQXJyYXkuZnJvbShrZXlTZXQpLmpvaW4oJywnKTtcbiAgICB9XG4gIH1cblxuICBpZiAocmVzdE9wdGlvbnMuaW5jbHVkZVJlYWRQcmVmZXJlbmNlKSB7XG4gICAgaW5jbHVkZVJlc3RPcHRpb25zLnJlYWRQcmVmZXJlbmNlID0gcmVzdE9wdGlvbnMuaW5jbHVkZVJlYWRQcmVmZXJlbmNlO1xuICAgIGluY2x1ZGVSZXN0T3B0aW9ucy5pbmNsdWRlUmVhZFByZWZlcmVuY2UgPSByZXN0T3B0aW9ucy5pbmNsdWRlUmVhZFByZWZlcmVuY2U7XG4gIH1cblxuICBjb25zdCBxdWVyeVByb21pc2VzID0gT2JqZWN0LmtleXMocG9pbnRlcnNIYXNoKS5tYXAoKGNsYXNzTmFtZSkgPT4ge1xuICAgIGNvbnN0IG9iamVjdElkcyA9IEFycmF5LmZyb20ocG9pbnRlcnNIYXNoW2NsYXNzTmFtZV0pO1xuICAgIGxldCB3aGVyZTtcbiAgICBpZiAob2JqZWN0SWRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgd2hlcmUgPSB7J29iamVjdElkJzogb2JqZWN0SWRzWzBdfTtcbiAgICB9IGVsc2Uge1xuICAgICAgd2hlcmUgPSB7J29iamVjdElkJzogeyckaW4nOiBvYmplY3RJZHN9fTtcbiAgICB9XG4gICAgdmFyIHF1ZXJ5ID0gbmV3IFJlc3RRdWVyeShjb25maWcsIGF1dGgsIGNsYXNzTmFtZSwgd2hlcmUsIGluY2x1ZGVSZXN0T3B0aW9ucyk7XG4gICAgcmV0dXJuIHF1ZXJ5LmV4ZWN1dGUoe29wOiAnZ2V0J30pLnRoZW4oKHJlc3VsdHMpID0+IHtcbiAgICAgIHJlc3VsdHMuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShyZXN1bHRzKTtcbiAgICB9KVxuICB9KVxuXG4gIC8vIEdldCB0aGUgb2JqZWN0cyBmb3IgYWxsIHRoZXNlIG9iamVjdCBpZHNcbiAgcmV0dXJuIFByb21pc2UuYWxsKHF1ZXJ5UHJvbWlzZXMpLnRoZW4oKHJlc3BvbnNlcykgPT4ge1xuICAgIHZhciByZXBsYWNlID0gcmVzcG9uc2VzLnJlZHVjZSgocmVwbGFjZSwgaW5jbHVkZVJlc3BvbnNlKSA9PiB7XG4gICAgICBmb3IgKHZhciBvYmogb2YgaW5jbHVkZVJlc3BvbnNlLnJlc3VsdHMpIHtcbiAgICAgICAgb2JqLl9fdHlwZSA9ICdPYmplY3QnO1xuICAgICAgICBvYmouY2xhc3NOYW1lID0gaW5jbHVkZVJlc3BvbnNlLmNsYXNzTmFtZTtcblxuICAgICAgICBpZiAob2JqLmNsYXNzTmFtZSA9PSBcIl9Vc2VyXCIgJiYgIWF1dGguaXNNYXN0ZXIpIHtcbiAgICAgICAgICBkZWxldGUgb2JqLnNlc3Npb25Ub2tlbjtcbiAgICAgICAgICBkZWxldGUgb2JqLmF1dGhEYXRhO1xuICAgICAgICB9XG4gICAgICAgIHJlcGxhY2Vbb2JqLm9iamVjdElkXSA9IG9iajtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXBsYWNlO1xuICAgIH0sIHt9KVxuXG4gICAgdmFyIHJlc3AgPSB7XG4gICAgICByZXN1bHRzOiByZXBsYWNlUG9pbnRlcnMocmVzcG9uc2UucmVzdWx0cywgcGF0aCwgcmVwbGFjZSlcbiAgICB9O1xuICAgIGlmIChyZXNwb25zZS5jb3VudCkge1xuICAgICAgcmVzcC5jb3VudCA9IHJlc3BvbnNlLmNvdW50O1xuICAgIH1cbiAgICByZXR1cm4gcmVzcDtcbiAgfSk7XG59XG5cbi8vIE9iamVjdCBtYXkgYmUgYSBsaXN0IG9mIFJFU1QtZm9ybWF0IG9iamVjdCB0byBmaW5kIHBvaW50ZXJzIGluLCBvclxuLy8gaXQgbWF5IGJlIGEgc2luZ2xlIG9iamVjdC5cbi8vIElmIHRoZSBwYXRoIHlpZWxkcyB0aGluZ3MgdGhhdCBhcmVuJ3QgcG9pbnRlcnMsIHRoaXMgdGhyb3dzIGFuIGVycm9yLlxuLy8gUGF0aCBpcyBhIGxpc3Qgb2YgZmllbGRzIHRvIHNlYXJjaCBpbnRvLlxuLy8gUmV0dXJucyBhIGxpc3Qgb2YgcG9pbnRlcnMgaW4gUkVTVCBmb3JtYXQuXG5mdW5jdGlvbiBmaW5kUG9pbnRlcnMob2JqZWN0LCBwYXRoKSB7XG4gIGlmIChvYmplY3QgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIHZhciBhbnN3ZXIgPSBbXTtcbiAgICBmb3IgKHZhciB4IG9mIG9iamVjdCkge1xuICAgICAgYW5zd2VyID0gYW5zd2VyLmNvbmNhdChmaW5kUG9pbnRlcnMoeCwgcGF0aCkpO1xuICAgIH1cbiAgICByZXR1cm4gYW5zd2VyO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnIHx8ICFvYmplY3QpIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBpZiAocGF0aC5sZW5ndGggPT0gMCkge1xuICAgIGlmIChvYmplY3QgPT09IG51bGwgfHwgb2JqZWN0Ll9fdHlwZSA9PSAnUG9pbnRlcicpIHtcbiAgICAgIHJldHVybiBbb2JqZWN0XTtcbiAgICB9XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgdmFyIHN1Ym9iamVjdCA9IG9iamVjdFtwYXRoWzBdXTtcbiAgaWYgKCFzdWJvYmplY3QpIHtcbiAgICByZXR1cm4gW107XG4gIH1cbiAgcmV0dXJuIGZpbmRQb2ludGVycyhzdWJvYmplY3QsIHBhdGguc2xpY2UoMSkpO1xufVxuXG4vLyBPYmplY3QgbWF5IGJlIGEgbGlzdCBvZiBSRVNULWZvcm1hdCBvYmplY3RzIHRvIHJlcGxhY2UgcG9pbnRlcnNcbi8vIGluLCBvciBpdCBtYXkgYmUgYSBzaW5nbGUgb2JqZWN0LlxuLy8gUGF0aCBpcyBhIGxpc3Qgb2YgZmllbGRzIHRvIHNlYXJjaCBpbnRvLlxuLy8gcmVwbGFjZSBpcyBhIG1hcCBmcm9tIG9iamVjdCBpZCAtPiBvYmplY3QuXG4vLyBSZXR1cm5zIHNvbWV0aGluZyBhbmFsb2dvdXMgdG8gb2JqZWN0LCBidXQgd2l0aCB0aGUgYXBwcm9wcmlhdGVcbi8vIHBvaW50ZXJzIGluZmxhdGVkLlxuZnVuY3Rpb24gcmVwbGFjZVBvaW50ZXJzKG9iamVjdCwgcGF0aCwgcmVwbGFjZSkge1xuICBpZiAob2JqZWN0IGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICByZXR1cm4gb2JqZWN0Lm1hcCgob2JqKSA9PiByZXBsYWNlUG9pbnRlcnMob2JqLCBwYXRoLCByZXBsYWNlKSlcbiAgICAgIC5maWx0ZXIoKG9iaikgPT4gdHlwZW9mIG9iaiAhPT0gJ3VuZGVmaW5lZCcpO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnIHx8ICFvYmplY3QpIHtcbiAgICByZXR1cm4gb2JqZWN0O1xuICB9XG5cbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSB7XG4gICAgaWYgKG9iamVjdCAmJiBvYmplY3QuX190eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgIHJldHVybiByZXBsYWNlW29iamVjdC5vYmplY3RJZF07XG4gICAgfVxuICAgIHJldHVybiBvYmplY3Q7XG4gIH1cblxuICB2YXIgc3Vib2JqZWN0ID0gb2JqZWN0W3BhdGhbMF1dO1xuICBpZiAoIXN1Ym9iamVjdCkge1xuICAgIHJldHVybiBvYmplY3Q7XG4gIH1cbiAgdmFyIG5ld3N1YiA9IHJlcGxhY2VQb2ludGVycyhzdWJvYmplY3QsIHBhdGguc2xpY2UoMSksIHJlcGxhY2UpO1xuICB2YXIgYW5zd2VyID0ge307XG4gIGZvciAodmFyIGtleSBpbiBvYmplY3QpIHtcbiAgICBpZiAoa2V5ID09IHBhdGhbMF0pIHtcbiAgICAgIGFuc3dlcltrZXldID0gbmV3c3ViO1xuICAgIH0gZWxzZSB7XG4gICAgICBhbnN3ZXJba2V5XSA9IG9iamVjdFtrZXldO1xuICAgIH1cbiAgfVxuICByZXR1cm4gYW5zd2VyO1xufVxuXG4vLyBGaW5kcyBhIHN1Ym9iamVjdCB0aGF0IGhhcyB0aGUgZ2l2ZW4ga2V5LCBpZiB0aGVyZSBpcyBvbmUuXG4vLyBSZXR1cm5zIHVuZGVmaW5lZCBvdGhlcndpc2UuXG5mdW5jdGlvbiBmaW5kT2JqZWN0V2l0aEtleShyb290LCBrZXkpIHtcbiAgaWYgKHR5cGVvZiByb290ICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAocm9vdCBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgZm9yICh2YXIgaXRlbSBvZiByb290KSB7XG4gICAgICBjb25zdCBhbnN3ZXIgPSBmaW5kT2JqZWN0V2l0aEtleShpdGVtLCBrZXkpO1xuICAgICAgaWYgKGFuc3dlcikge1xuICAgICAgICByZXR1cm4gYW5zd2VyO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBpZiAocm9vdCAmJiByb290W2tleV0pIHtcbiAgICByZXR1cm4gcm9vdDtcbiAgfVxuICBmb3IgKHZhciBzdWJrZXkgaW4gcm9vdCkge1xuICAgIGNvbnN0IGFuc3dlciA9IGZpbmRPYmplY3RXaXRoS2V5KHJvb3Rbc3Via2V5XSwga2V5KTtcbiAgICBpZiAoYW5zd2VyKSB7XG4gICAgICByZXR1cm4gYW5zd2VyO1xuICAgIH1cbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFJlc3RRdWVyeTtcbiJdfQ==