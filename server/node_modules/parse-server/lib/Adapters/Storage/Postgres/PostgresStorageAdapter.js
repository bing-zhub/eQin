'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PostgresStorageAdapter = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };
// -disable-next

// -disable-next


var _PostgresClient = require('./PostgresClient');

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _sql = require('./sql');

var _sql2 = _interopRequireDefault(_sql);

var _StorageAdapter = require('../StorageAdapter');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const PostgresRelationDoesNotExistError = '42P01';
const PostgresDuplicateRelationError = '42P07';
const PostgresDuplicateColumnError = '42701';
const PostgresMissingColumnError = '42703';
const PostgresDuplicateObjectError = '42710';
const PostgresUniqueIndexViolationError = '23505';
const PostgresTransactionAbortedError = '25P02';
const logger = require('../../../logger');

const debug = function (...args) {
  args = ['PG: ' + arguments[0]].concat(args.slice(1, args.length));
  const log = logger.getLogger();
  log.debug.apply(log, args);
};

const parseTypeToPostgresType = type => {
  switch (type.type) {
    case 'String':
      return 'text';
    case 'Date':
      return 'timestamp with time zone';
    case 'Object':
      return 'jsonb';
    case 'File':
      return 'text';
    case 'Boolean':
      return 'boolean';
    case 'Pointer':
      return 'char(10)';
    case 'Number':
      return 'double precision';
    case 'GeoPoint':
      return 'point';
    case 'Bytes':
      return 'jsonb';
    case 'Polygon':
      return 'polygon';
    case 'Array':
      if (type.contents && type.contents.type === 'String') {
        return 'text[]';
      } else {
        return 'jsonb';
      }
    default:
      throw `no type for ${JSON.stringify(type)} yet`;
  }
};

const ParseToPosgresComparator = {
  '$gt': '>',
  '$lt': '<',
  '$gte': '>=',
  '$lte': '<='
};

const mongoAggregateToPostgres = {
  $dayOfMonth: 'DAY',
  $dayOfWeek: 'DOW',
  $dayOfYear: 'DOY',
  $isoDayOfWeek: 'ISODOW',
  $isoWeekYear: 'ISOYEAR',
  $hour: 'HOUR',
  $minute: 'MINUTE',
  $second: 'SECOND',
  $millisecond: 'MILLISECONDS',
  $month: 'MONTH',
  $week: 'WEEK',
  $year: 'YEAR'
};

const toPostgresValue = value => {
  if (typeof value === 'object') {
    if (value.__type === 'Date') {
      return value.iso;
    }
    if (value.__type === 'File') {
      return value.name;
    }
  }
  return value;
};

const transformValue = value => {
  if (typeof value === 'object' && value.__type === 'Pointer') {
    return value.objectId;
  }
  return value;
};

// Duplicate from then mongo adapter...
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

const toParseSchema = schema => {
  if (schema.className === '_User') {
    delete schema.fields._hashed_password;
  }
  if (schema.fields) {
    delete schema.fields._wperm;
    delete schema.fields._rperm;
  }
  let clps = defaultCLPS;
  if (schema.classLevelPermissions) {
    clps = _extends({}, emptyCLPS, schema.classLevelPermissions);
  }
  let indexes = {};
  if (schema.indexes) {
    indexes = _extends({}, schema.indexes);
  }
  return {
    className: schema.className,
    fields: schema.fields,
    classLevelPermissions: clps,
    indexes
  };
};

const toPostgresSchema = schema => {
  if (!schema) {
    return schema;
  }
  schema.fields = schema.fields || {};
  schema.fields._wperm = { type: 'Array', contents: { type: 'String' } };
  schema.fields._rperm = { type: 'Array', contents: { type: 'String' } };
  if (schema.className === '_User') {
    schema.fields._hashed_password = { type: 'String' };
    schema.fields._password_history = { type: 'Array' };
  }
  return schema;
};

const handleDotFields = object => {
  Object.keys(object).forEach(fieldName => {
    if (fieldName.indexOf('.') > -1) {
      const components = fieldName.split('.');
      const first = components.shift();
      object[first] = object[first] || {};
      let currentObj = object[first];
      let next;
      let value = object[fieldName];
      if (value && value.__op === 'Delete') {
        value = undefined;
      }
      /* eslint-disable no-cond-assign */
      while (next = components.shift()) {
        /* eslint-enable no-cond-assign */
        currentObj[next] = currentObj[next] || {};
        if (components.length === 0) {
          currentObj[next] = value;
        }
        currentObj = currentObj[next];
      }
      delete object[fieldName];
    }
  });
  return object;
};

const transformDotFieldToComponents = fieldName => {
  return fieldName.split('.').map((cmpt, index) => {
    if (index === 0) {
      return `"${cmpt}"`;
    }
    return `'${cmpt}'`;
  });
};

const transformDotField = fieldName => {
  if (fieldName.indexOf('.') === -1) {
    return `"${fieldName}"`;
  }
  const components = transformDotFieldToComponents(fieldName);
  let name = components.slice(0, components.length - 1).join('->');
  name += '->>' + components[components.length - 1];
  return name;
};

const transformAggregateField = fieldName => {
  if (typeof fieldName !== 'string') {
    return fieldName;
  }
  if (fieldName === '$_created_at') {
    return 'createdAt';
  }
  if (fieldName === '$_updated_at') {
    return 'updatedAt';
  }
  return fieldName.substr(1);
};

const validateKeys = object => {
  if (typeof object == 'object') {
    for (const key in object) {
      if (typeof object[key] == 'object') {
        validateKeys(object[key]);
      }

      if (key.includes('$') || key.includes('.')) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
      }
    }
  }
};

// Returns the list of join tables on a schema
const joinTablesForSchema = schema => {
  const list = [];
  if (schema) {
    Object.keys(schema.fields).forEach(field => {
      if (schema.fields[field].type === 'Relation') {
        list.push(`_Join:${field}:${schema.className}`);
      }
    });
  }
  return list;
};

const buildWhereClause = ({ schema, query, index }) => {
  const patterns = [];
  let values = [];
  const sorts = [];

  schema = toPostgresSchema(schema);
  for (const fieldName in query) {
    const isArrayField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array';
    const initialPatternsLength = patterns.length;
    const fieldValue = query[fieldName];

    // nothingin the schema, it's gonna blow up
    if (!schema.fields[fieldName]) {
      // as it won't exist
      if (fieldValue && fieldValue.$exists === false) {
        continue;
      }
    }

    if (fieldName.indexOf('.') >= 0) {
      let name = transformDotField(fieldName);
      if (fieldValue === null) {
        patterns.push(`${name} IS NULL`);
      } else {
        if (fieldValue.$in) {
          const inPatterns = [];
          name = transformDotFieldToComponents(fieldName).join('->');
          fieldValue.$in.forEach(listElem => {
            if (typeof listElem === 'string') {
              inPatterns.push(`"${listElem}"`);
            } else {
              inPatterns.push(`${listElem}`);
            }
          });
          patterns.push(`(${name})::jsonb @> '[${inPatterns.join()}]'::jsonb`);
        } else if (fieldValue.$regex) {
          // Handle later
        } else {
          patterns.push(`${name} = '${fieldValue}'`);
        }
      }
    } else if (fieldValue === null || fieldValue === undefined) {
      patterns.push(`$${index}:name IS NULL`);
      values.push(fieldName);
      index += 1;
      continue;
    } else if (typeof fieldValue === 'string') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue);
      index += 2;
    } else if (typeof fieldValue === 'boolean') {
      patterns.push(`$${index}:name = $${index + 1}`);
      // Can't cast boolean to double precision
      if (schema.fields[fieldName] && schema.fields[fieldName].type === 'Number') {
        // Should always return zero results
        const MAX_INT_PLUS_ONE = 9223372036854775808;
        values.push(fieldName, MAX_INT_PLUS_ONE);
      } else {
        values.push(fieldName, fieldValue);
      }
      index += 2;
    } else if (typeof fieldValue === 'number') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue);
      index += 2;
    } else if (['$or', '$nor', '$and'].includes(fieldName)) {
      const clauses = [];
      const clauseValues = [];
      fieldValue.forEach(subQuery => {
        const clause = buildWhereClause({ schema, query: subQuery, index });
        if (clause.pattern.length > 0) {
          clauses.push(clause.pattern);
          clauseValues.push(...clause.values);
          index += clause.values.length;
        }
      });

      const orOrAnd = fieldName === '$and' ? ' AND ' : ' OR ';
      const not = fieldName === '$nor' ? ' NOT ' : '';

      patterns.push(`${not}(${clauses.join(orOrAnd)})`);
      values.push(...clauseValues);
    }

    if (fieldValue.$ne !== undefined) {
      if (isArrayField) {
        fieldValue.$ne = JSON.stringify([fieldValue.$ne]);
        patterns.push(`NOT array_contains($${index}:name, $${index + 1})`);
      } else {
        if (fieldValue.$ne === null) {
          patterns.push(`$${index}:name IS NOT NULL`);
          values.push(fieldName);
          index += 1;
          continue;
        } else {
          // if not null, we need to manually exclude null
          patterns.push(`($${index}:name <> $${index + 1} OR $${index}:name IS NULL)`);
        }
      }

      // TODO: support arrays
      values.push(fieldName, fieldValue.$ne);
      index += 2;
    }
    if (fieldValue.$eq !== undefined) {
      if (fieldValue.$eq === null) {
        patterns.push(`$${index}:name IS NULL`);
        values.push(fieldName);
        index += 1;
      } else {
        patterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.$eq);
        index += 2;
      }
    }
    const isInOrNin = Array.isArray(fieldValue.$in) || Array.isArray(fieldValue.$nin);
    if (Array.isArray(fieldValue.$in) && isArrayField && schema.fields[fieldName].contents && schema.fields[fieldName].contents.type === 'String') {
      const inPatterns = [];
      let allowNull = false;
      values.push(fieldName);
      fieldValue.$in.forEach((listElem, listIndex) => {
        if (listElem === null) {
          allowNull = true;
        } else {
          values.push(listElem);
          inPatterns.push(`$${index + 1 + listIndex - (allowNull ? 1 : 0)}`);
        }
      });
      if (allowNull) {
        patterns.push(`($${index}:name IS NULL OR $${index}:name && ARRAY[${inPatterns.join()}])`);
      } else {
        patterns.push(`$${index}:name && ARRAY[${inPatterns.join()}]`);
      }
      index = index + 1 + inPatterns.length;
    } else if (isInOrNin) {
      var createConstraint = (baseArray, notIn) => {
        if (baseArray.length > 0) {
          const not = notIn ? ' NOT ' : '';
          if (isArrayField) {
            patterns.push(`${not} array_contains($${index}:name, $${index + 1})`);
            values.push(fieldName, JSON.stringify(baseArray));
            index += 2;
          } else {
            // Handle Nested Dot Notation Above
            if (fieldName.indexOf('.') >= 0) {
              return;
            }
            const inPatterns = [];
            values.push(fieldName);
            baseArray.forEach((listElem, listIndex) => {
              if (listElem !== null) {
                values.push(listElem);
                inPatterns.push(`$${index + 1 + listIndex}`);
              }
            });
            patterns.push(`$${index}:name ${not} IN (${inPatterns.join()})`);
            index = index + 1 + inPatterns.length;
          }
        } else if (!notIn) {
          values.push(fieldName);
          patterns.push(`$${index}:name IS NULL`);
          index = index + 1;
        }
      };
      if (fieldValue.$in) {
        createConstraint(_lodash2.default.flatMap(fieldValue.$in, elt => elt), false);
      }
      if (fieldValue.$nin) {
        createConstraint(_lodash2.default.flatMap(fieldValue.$nin, elt => elt), true);
      }
    } else if (typeof fieldValue.$in !== 'undefined') {
      throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $in value');
    } else if (typeof fieldValue.$nin !== 'undefined') {
      throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $nin value');
    }

    if (Array.isArray(fieldValue.$all) && isArrayField) {
      if (isAnyValueRegexStartsWith(fieldValue.$all)) {
        if (!isAllValuesRegexOrNone(fieldValue.$all)) {
          throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'All $all values must be of regex type or none: ' + fieldValue.$all);
        }

        for (let i = 0; i < fieldValue.$all.length; i += 1) {
          const value = processRegexPattern(fieldValue.$all[i].$regex);
          fieldValue.$all[i] = value.substring(1) + '%';
        }
        patterns.push(`array_contains_all_regex($${index}:name, $${index + 1}::jsonb)`);
      } else {
        patterns.push(`array_contains_all($${index}:name, $${index + 1}::jsonb)`);
      }
      values.push(fieldName, JSON.stringify(fieldValue.$all));
      index += 2;
    }

    if (typeof fieldValue.$exists !== 'undefined') {
      if (fieldValue.$exists) {
        patterns.push(`$${index}:name IS NOT NULL`);
      } else {
        patterns.push(`$${index}:name IS NULL`);
      }
      values.push(fieldName);
      index += 1;
    }

    if (fieldValue.$containedBy) {
      const arr = fieldValue.$containedBy;
      if (!(arr instanceof Array)) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $containedBy: should be an array`);
      }

      patterns.push(`$${index}:name <@ $${index + 1}::jsonb`);
      values.push(fieldName, JSON.stringify(arr));
      index += 2;
    }

    if (fieldValue.$text) {
      const search = fieldValue.$text.$search;
      let language = 'english';
      if (typeof search !== 'object') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $search, should be object`);
      }
      if (!search.$term || typeof search.$term !== 'string') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $term, should be string`);
      }
      if (search.$language && typeof search.$language !== 'string') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $language, should be string`);
      } else if (search.$language) {
        language = search.$language;
      }
      if (search.$caseSensitive && typeof search.$caseSensitive !== 'boolean') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $caseSensitive, should be boolean`);
      } else if (search.$caseSensitive) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $caseSensitive not supported, please use $regex or create a separate lower case column.`);
      }
      if (search.$diacriticSensitive && typeof search.$diacriticSensitive !== 'boolean') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $diacriticSensitive, should be boolean`);
      } else if (search.$diacriticSensitive === false) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $diacriticSensitive - false not supported, install Postgres Unaccent Extension`);
      }
      patterns.push(`to_tsvector($${index}, $${index + 1}:name) @@ to_tsquery($${index + 2}, $${index + 3})`);
      values.push(language, fieldName, language, search.$term);
      index += 4;
    }

    if (fieldValue.$nearSphere) {
      const point = fieldValue.$nearSphere;
      const distance = fieldValue.$maxDistance;
      const distanceInKM = distance * 6371 * 1000;
      patterns.push(`ST_distance_sphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) <= $${index + 3}`);
      sorts.push(`ST_distance_sphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) ASC`);
      values.push(fieldName, point.longitude, point.latitude, distanceInKM);
      index += 4;
    }

    if (fieldValue.$within && fieldValue.$within.$box) {
      const box = fieldValue.$within.$box;
      const left = box[0].longitude;
      const bottom = box[0].latitude;
      const right = box[1].longitude;
      const top = box[1].latitude;

      patterns.push(`$${index}:name::point <@ $${index + 1}::box`);
      values.push(fieldName, `((${left}, ${bottom}), (${right}, ${top}))`);
      index += 2;
    }

    if (fieldValue.$geoWithin && fieldValue.$geoWithin.$centerSphere) {
      const centerSphere = fieldValue.$geoWithin.$centerSphere;
      if (!(centerSphere instanceof Array) || centerSphere.length < 2) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere should be an array of Parse.GeoPoint and distance');
      }
      // Get point, convert to geo point if necessary and validate
      let point = centerSphere[0];
      if (point instanceof Array && point.length === 2) {
        point = new _node2.default.GeoPoint(point[1], point[0]);
      } else if (!GeoPointCoder.isValidJSON(point)) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere geo point invalid');
      }
      _node2.default.GeoPoint._validate(point.latitude, point.longitude);
      // Get distance and validate
      const distance = centerSphere[1];
      if (isNaN(distance) || distance < 0) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere distance invalid');
      }
      const distanceInKM = distance * 6371 * 1000;
      patterns.push(`ST_distance_sphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) <= $${index + 3}`);
      values.push(fieldName, point.longitude, point.latitude, distanceInKM);
      index += 4;
    }

    if (fieldValue.$geoWithin && fieldValue.$geoWithin.$polygon) {
      const polygon = fieldValue.$geoWithin.$polygon;
      let points;
      if (typeof polygon === 'object' && polygon.__type === 'Polygon') {
        if (!polygon.coordinates || polygon.coordinates.length < 3) {
          throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value; Polygon.coordinates should contain at least 3 lon/lat pairs');
        }
        points = polygon.coordinates;
      } else if (polygon instanceof Array) {
        if (polygon.length < 3) {
          throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should contain at least 3 GeoPoints');
        }
        points = polygon;
      } else {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should be Polygon object or Array of Parse.GeoPoint\'s');
      }
      points = points.map(point => {
        if (point instanceof Array && point.length === 2) {
          _node2.default.GeoPoint._validate(point[1], point[0]);
          return `(${point[0]}, ${point[1]})`;
        }
        if (typeof point !== 'object' || point.__type !== 'GeoPoint') {
          throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value');
        } else {
          _node2.default.GeoPoint._validate(point.latitude, point.longitude);
        }
        return `(${point.longitude}, ${point.latitude})`;
      }).join(', ');

      patterns.push(`$${index}:name::point <@ $${index + 1}::polygon`);
      values.push(fieldName, `(${points})`);
      index += 2;
    }
    if (fieldValue.$geoIntersects && fieldValue.$geoIntersects.$point) {
      const point = fieldValue.$geoIntersects.$point;
      if (typeof point !== 'object' || point.__type !== 'GeoPoint') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoIntersect value; $point should be GeoPoint');
      } else {
        _node2.default.GeoPoint._validate(point.latitude, point.longitude);
      }
      patterns.push(`$${index}:name::polygon @> $${index + 1}::point`);
      values.push(fieldName, `(${point.longitude}, ${point.latitude})`);
      index += 2;
    }

    if (fieldValue.$regex) {
      let regex = fieldValue.$regex;
      let operator = '~';
      const opts = fieldValue.$options;
      if (opts) {
        if (opts.indexOf('i') >= 0) {
          operator = '~*';
        }
        if (opts.indexOf('x') >= 0) {
          regex = removeWhiteSpace(regex);
        }
      }

      const name = transformDotField(fieldName);
      regex = processRegexPattern(regex);

      patterns.push(`$${index}:raw ${operator} '$${index + 1}:raw'`);
      values.push(name, regex);
      index += 2;
    }

    if (fieldValue.__type === 'Pointer') {
      if (isArrayField) {
        patterns.push(`array_contains($${index}:name, $${index + 1})`);
        values.push(fieldName, JSON.stringify([fieldValue]));
        index += 2;
      } else {
        patterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.objectId);
        index += 2;
      }
    }

    if (fieldValue.__type === 'Date') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue.iso);
      index += 2;
    }

    if (fieldValue.__type === 'GeoPoint') {
      patterns.push('$' + index + ':name ~= POINT($' + (index + 1) + ', $' + (index + 2) + ')');
      values.push(fieldName, fieldValue.longitude, fieldValue.latitude);
      index += 3;
    }

    if (fieldValue.__type === 'Polygon') {
      const value = convertPolygonToSQL(fieldValue.coordinates);
      patterns.push(`$${index}:name ~= $${index + 1}::polygon`);
      values.push(fieldName, value);
      index += 2;
    }

    Object.keys(ParseToPosgresComparator).forEach(cmp => {
      if (fieldValue[cmp] || fieldValue[cmp] === 0) {
        const pgComparator = ParseToPosgresComparator[cmp];
        patterns.push(`$${index}:name ${pgComparator} $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue[cmp]));
        index += 2;
      }
    });

    if (initialPatternsLength === patterns.length) {
      throw new _node2.default.Error(_node2.default.Error.OPERATION_FORBIDDEN, `Postgres doesn't support this query type yet ${JSON.stringify(fieldValue)}`);
    }
  }
  values = values.map(transformValue);
  return { pattern: patterns.join(' AND '), values, sorts };
};

class PostgresStorageAdapter {

  constructor({
    uri,
    collectionPrefix = '',
    databaseOptions
  }) {
    this._collectionPrefix = collectionPrefix;
    const { client, pgp } = (0, _PostgresClient.createClient)(uri, databaseOptions);
    this._client = client;
    this._pgp = pgp;
    this.canSortOnJoinTables = false;
  }

  // Private


  handleShutdown() {
    if (!this._client) {
      return;
    }
    this._client.$pool.end();
  }

  _ensureSchemaCollectionExists(conn) {
    conn = conn || this._client;
    return conn.none('CREATE TABLE IF NOT EXISTS "_SCHEMA" ( "className" varChar(120), "schema" jsonb, "isParseClass" bool, PRIMARY KEY ("className") )').catch(error => {
      if (error.code === PostgresDuplicateRelationError || error.code === PostgresUniqueIndexViolationError || error.code === PostgresDuplicateObjectError) {
        // Table already exists, must have been created by a different request. Ignore error.
      } else {
        throw error;
      }
    });
  }

  classExists(name) {
    return this._client.one('SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)', [name], a => a.exists);
  }

  setClassLevelPermissions(className, CLPs) {
    const self = this;
    return this._client.task('set-class-level-permissions', function* (t) {
      yield self._ensureSchemaCollectionExists(t);
      const values = [className, 'schema', 'classLevelPermissions', JSON.stringify(CLPs)];
      yield t.none(`UPDATE "_SCHEMA" SET $2:name = json_object_set_key($2:name, $3::text, $4::jsonb) WHERE "className"=$1`, values);
    });
  }

  setIndexesWithSchemaFormat(className, submittedIndexes, existingIndexes = {}, fields, conn) {
    conn = conn || this._client;
    const self = this;
    if (submittedIndexes === undefined) {
      return Promise.resolve();
    }
    if (Object.keys(existingIndexes).length === 0) {
      existingIndexes = { _id_: { _id: 1 } };
    }
    const deletedIndexes = [];
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
        deletedIndexes.push(name);
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
    return conn.tx('set-indexes-with-schema-format', function* (t) {
      if (insertedIndexes.length > 0) {
        yield self.createIndexes(className, insertedIndexes, t);
      }
      if (deletedIndexes.length > 0) {
        yield self.dropIndexes(className, deletedIndexes, t);
      }
      yield self._ensureSchemaCollectionExists(t);
      yield t.none('UPDATE "_SCHEMA" SET $2:name = json_object_set_key($2:name, $3::text, $4::jsonb) WHERE "className"=$1', [className, 'schema', 'indexes', JSON.stringify(existingIndexes)]);
    });
  }

  createClass(className, schema, conn) {
    conn = conn || this._client;
    return conn.tx('create-class', t => {
      const q1 = this.createTable(className, schema, t);
      const q2 = t.none('INSERT INTO "_SCHEMA" ("className", "schema", "isParseClass") VALUES ($<className>, $<schema>, true)', { className, schema });
      const q3 = this.setIndexesWithSchemaFormat(className, schema.indexes, {}, schema.fields, t);
      return t.batch([q1, q2, q3]);
    }).then(() => {
      return toParseSchema(schema);
    }).catch(err => {
      if (err.data[0].result.code === PostgresTransactionAbortedError) {
        err = err.data[1].result;
      }
      if (err.code === PostgresUniqueIndexViolationError && err.detail.includes(className)) {
        throw new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, `Class ${className} already exists.`);
      }
      throw err;
    });
  }

  // Just create a table, do not insert in schema
  createTable(className, schema, conn) {
    conn = conn || this._client;
    const self = this;
    debug('createTable', className, schema);
    const valuesArray = [];
    const patternsArray = [];
    const fields = Object.assign({}, schema.fields);
    if (className === '_User') {
      fields._email_verify_token_expires_at = { type: 'Date' };
      fields._email_verify_token = { type: 'String' };
      fields._account_lockout_expires_at = { type: 'Date' };
      fields._failed_login_count = { type: 'Number' };
      fields._perishable_token = { type: 'String' };
      fields._perishable_token_expires_at = { type: 'Date' };
      fields._password_changed_at = { type: 'Date' };
      fields._password_history = { type: 'Array' };
    }
    let index = 2;
    const relations = [];
    Object.keys(fields).forEach(fieldName => {
      const parseType = fields[fieldName];
      // Skip when it's a relation
      // We'll create the tables later
      if (parseType.type === 'Relation') {
        relations.push(fieldName);
        return;
      }
      if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
        parseType.contents = { type: 'String' };
      }
      valuesArray.push(fieldName);
      valuesArray.push(parseTypeToPostgresType(parseType));
      patternsArray.push(`$${index}:name $${index + 1}:raw`);
      if (fieldName === 'objectId') {
        patternsArray.push(`PRIMARY KEY ($${index}:name)`);
      }
      index = index + 2;
    });
    const qs = `CREATE TABLE IF NOT EXISTS $1:name (${patternsArray.join()})`;
    const values = [className, ...valuesArray];

    return conn.task('create-table', function* (t) {
      try {
        yield self._ensureSchemaCollectionExists(t);
        yield t.none(qs, values);
      } catch (error) {
        if (error.code !== PostgresDuplicateRelationError) {
          throw error;
        }
        // ELSE: Table already exists, must have been created by a different request. Ignore the error.
      }
      yield t.tx('create-table-tx', tx => {
        return tx.batch(relations.map(fieldName => {
          return tx.none('CREATE TABLE IF NOT EXISTS $<joinTable:name> ("relatedId" varChar(120), "owningId" varChar(120), PRIMARY KEY("relatedId", "owningId") )', { joinTable: `_Join:${fieldName}:${className}` });
        }));
      });
    });
  }

  schemaUpgrade(className, schema, conn) {
    debug('schemaUpgrade', { className, schema });
    conn = conn || this._client;
    const self = this;

    return conn.tx('schema-upgrade', function* (t) {
      const columns = yield t.map('SELECT column_name FROM information_schema.columns WHERE table_name = $<className>', { className }, a => a.column_name);
      const newColumns = Object.keys(schema.fields).filter(item => columns.indexOf(item) === -1).map(fieldName => self.addFieldIfNotExists(className, fieldName, schema.fields[fieldName], t));

      yield t.batch(newColumns);
    });
  }

  addFieldIfNotExists(className, fieldName, type, conn) {
    // TODO: Must be revised for invalid logic...
    debug('addFieldIfNotExists', { className, fieldName, type });
    conn = conn || this._client;
    const self = this;
    return conn.tx('add-field-if-not-exists', function* (t) {
      if (type.type !== 'Relation') {
        try {
          yield t.none('ALTER TABLE $<className:name> ADD COLUMN $<fieldName:name> $<postgresType:raw>', {
            className,
            fieldName,
            postgresType: parseTypeToPostgresType(type)
          });
        } catch (error) {
          if (error.code === PostgresRelationDoesNotExistError) {
            return yield self.createClass(className, { fields: { [fieldName]: type } }, t);
          }
          if (error.code !== PostgresDuplicateColumnError) {
            throw error;
          }
          // Column already exists, created by other request. Carry on to see if it's the right type.
        }
      } else {
        yield t.none('CREATE TABLE IF NOT EXISTS $<joinTable:name> ("relatedId" varChar(120), "owningId" varChar(120), PRIMARY KEY("relatedId", "owningId") )', { joinTable: `_Join:${fieldName}:${className}` });
      }

      const result = yield t.any('SELECT "schema" FROM "_SCHEMA" WHERE "className" = $<className> and ("schema"::json->\'fields\'->$<fieldName>) is not null', { className, fieldName });

      if (result[0]) {
        throw 'Attempted to add a field that already exists';
      } else {
        const path = `{fields,${fieldName}}`;
        yield t.none('UPDATE "_SCHEMA" SET "schema"=jsonb_set("schema", $<path>, $<type>)  WHERE "className"=$<className>', { path, type, className });
      }
    });
  }

  // Drops a collection. Resolves with true if it was a Parse Schema (eg. _User, Custom, etc.)
  // and resolves with false if it wasn't (eg. a join table). Rejects if deletion was impossible.
  deleteClass(className) {
    const operations = [{ query: `DROP TABLE IF EXISTS $1:name`, values: [className] }, { query: `DELETE FROM "_SCHEMA" WHERE "className" = $1`, values: [className] }];
    return this._client.tx(t => t.none(this._pgp.helpers.concat(operations))).then(() => className.indexOf('_Join:') != 0); // resolves with false when _Join table
  }

  // Delete all data known to this adapter. Used for testing.
  deleteAllClasses() {
    const now = new Date().getTime();
    const helpers = this._pgp.helpers;
    debug('deleteAllClasses');

    return this._client.task('delete-all-classes', function* (t) {
      try {
        const results = yield t.any('SELECT * FROM "_SCHEMA"');
        const joins = results.reduce((list, schema) => {
          return list.concat(joinTablesForSchema(schema.schema));
        }, []);
        const classes = ['_SCHEMA', '_PushStatus', '_JobStatus', '_JobSchedule', '_Hooks', '_GlobalConfig', '_Audience', ...results.map(result => result.className), ...joins];
        const queries = classes.map(className => ({ query: 'DROP TABLE IF EXISTS $<className:name>', values: { className } }));
        yield t.tx(tx => tx.none(helpers.concat(queries)));
      } catch (error) {
        if (error.code !== PostgresRelationDoesNotExistError) {
          throw error;
        }
        // No _SCHEMA collection. Don't delete anything.
      }
    }).then(() => {
      debug(`deleteAllClasses done in ${new Date().getTime() - now}`);
    });
  }

  // Remove the column and all the data. For Relations, the _Join collection is handled
  // specially, this function does not delete _Join columns. It should, however, indicate
  // that the relation fields does not exist anymore. In mongo, this means removing it from
  // the _SCHEMA collection.  There should be no actual data in the collection under the same name
  // as the relation column, so it's fine to attempt to delete it. If the fields listed to be
  // deleted do not exist, this function should return successfully anyways. Checking for
  // attempts to delete non-existent fields is the responsibility of Parse Server.

  // This function is not obligated to delete fields atomically. It is given the field
  // names in a list so that databases that are capable of deleting fields atomically
  // may do so.

  // Returns a Promise.
  deleteFields(className, schema, fieldNames) {
    debug('deleteFields', className, fieldNames);
    fieldNames = fieldNames.reduce((list, fieldName) => {
      const field = schema.fields[fieldName];
      if (field.type !== 'Relation') {
        list.push(fieldName);
      }
      delete schema.fields[fieldName];
      return list;
    }, []);

    const values = [className, ...fieldNames];
    const columns = fieldNames.map((name, idx) => {
      return `$${idx + 2}:name`;
    }).join(', DROP COLUMN');

    return this._client.tx('delete-fields', function* (t) {
      yield t.none('UPDATE "_SCHEMA" SET "schema"=$<schema> WHERE "className"=$<className>', { schema, className });
      if (values.length > 1) {
        yield t.none(`ALTER TABLE $1:name DROP COLUMN ${columns}`, values);
      }
    });
  }

  // Return a promise for all schemas known to this adapter, in Parse format. In case the
  // schemas cannot be retrieved, returns a promise that rejects. Requirements for the
  // rejection reason are TBD.
  getAllClasses() {
    const self = this;
    return this._client.task('get-all-classes', function* (t) {
      yield self._ensureSchemaCollectionExists(t);
      return yield t.map('SELECT * FROM "_SCHEMA"', null, row => toParseSchema(_extends({ className: row.className }, row.schema)));
    });
  }

  // Return a promise for the schema with the given name, in Parse format. If
  // this adapter doesn't know about the schema, return a promise that rejects with
  // undefined as the reason.
  getClass(className) {
    debug('getClass', className);
    return this._client.any('SELECT * FROM "_SCHEMA" WHERE "className"=$<className>', { className }).then(result => {
      if (result.length !== 1) {
        throw undefined;
      }
      return result[0].schema;
    }).then(toParseSchema);
  }

  // TODO: remove the mongo format dependency in the return value
  createObject(className, schema, object) {
    debug('createObject', className, object);
    let columnsArray = [];
    const valuesArray = [];
    schema = toPostgresSchema(schema);
    const geoPoints = {};

    object = handleDotFields(object);

    validateKeys(object);

    Object.keys(object).forEach(fieldName => {
      if (object[fieldName] === null) {
        return;
      }
      var authDataMatch = fieldName.match(/^_auth_data_([a-zA-Z0-9_]+)$/);
      if (authDataMatch) {
        var provider = authDataMatch[1];
        object['authData'] = object['authData'] || {};
        object['authData'][provider] = object[fieldName];
        delete object[fieldName];
        fieldName = 'authData';
      }

      columnsArray.push(fieldName);
      if (!schema.fields[fieldName] && className === '_User') {
        if (fieldName === '_email_verify_token' || fieldName === '_failed_login_count' || fieldName === '_perishable_token' || fieldName === '_password_history') {
          valuesArray.push(object[fieldName]);
        }

        if (fieldName === '_email_verify_token_expires_at') {
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
        }

        if (fieldName === '_account_lockout_expires_at' || fieldName === '_perishable_token_expires_at' || fieldName === '_password_changed_at') {
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
        }
        return;
      }
      switch (schema.fields[fieldName].type) {
        case 'Date':
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
          break;
        case 'Pointer':
          valuesArray.push(object[fieldName].objectId);
          break;
        case 'Array':
          if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
            valuesArray.push(object[fieldName]);
          } else {
            valuesArray.push(JSON.stringify(object[fieldName]));
          }
          break;
        case 'Object':
        case 'Bytes':
        case 'String':
        case 'Number':
        case 'Boolean':
          valuesArray.push(object[fieldName]);
          break;
        case 'File':
          valuesArray.push(object[fieldName].name);
          break;
        case 'Polygon':
          {
            const value = convertPolygonToSQL(object[fieldName].coordinates);
            valuesArray.push(value);
            break;
          }
        case 'GeoPoint':
          // pop the point and process later
          geoPoints[fieldName] = object[fieldName];
          columnsArray.pop();
          break;
        default:
          throw `Type ${schema.fields[fieldName].type} not supported yet`;
      }
    });

    columnsArray = columnsArray.concat(Object.keys(geoPoints));
    const initialValues = valuesArray.map((val, index) => {
      let termination = '';
      const fieldName = columnsArray[index];
      if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
        termination = '::text[]';
      } else if (schema.fields[fieldName] && schema.fields[fieldName].type === 'Array') {
        termination = '::jsonb';
      }
      return `$${index + 2 + columnsArray.length}${termination}`;
    });
    const geoPointsInjects = Object.keys(geoPoints).map(key => {
      const value = geoPoints[key];
      valuesArray.push(value.longitude, value.latitude);
      const l = valuesArray.length + columnsArray.length;
      return `POINT($${l}, $${l + 1})`;
    });

    const columnsPattern = columnsArray.map((col, index) => `$${index + 2}:name`).join();
    const valuesPattern = initialValues.concat(geoPointsInjects).join();

    const qs = `INSERT INTO $1:name (${columnsPattern}) VALUES (${valuesPattern})`;
    const values = [className, ...columnsArray, ...valuesArray];
    debug(qs, values);
    return this._client.none(qs, values).then(() => ({ ops: [object] })).catch(error => {
      if (error.code === PostgresUniqueIndexViolationError) {
        const err = new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
        err.underlyingError = error;
        if (error.constraint) {
          const matches = error.constraint.match(/unique_([a-zA-Z]+)/);
          if (matches && Array.isArray(matches)) {
            err.userInfo = { duplicated_field: matches[1] };
          }
        }
        error = err;
      }
      throw error;
    });
  }

  // Remove all objects that match the given Parse Query.
  // If no objects match, reject with OBJECT_NOT_FOUND. If objects are found and deleted, resolve with undefined.
  // If there is some other error, reject with INTERNAL_SERVER_ERROR.
  deleteObjectsByQuery(className, schema, query) {
    debug('deleteObjectsByQuery', className, query);
    const values = [className];
    const index = 2;
    const where = buildWhereClause({ schema, index, query });
    values.push(...where.values);
    if (Object.keys(query).length === 0) {
      where.pattern = 'TRUE';
    }
    const qs = `WITH deleted AS (DELETE FROM $1:name WHERE ${where.pattern} RETURNING *) SELECT count(*) FROM deleted`;
    debug(qs, values);
    return this._client.one(qs, values, a => +a.count).then(count => {
      if (count === 0) {
        throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Object not found.');
      } else {
        return count;
      }
    }).catch(error => {
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      }
      // ELSE: Don't delete anything if doesn't exist
    });
  }
  // Return value not currently well specified.
  findOneAndUpdate(className, schema, query, update) {
    debug('findOneAndUpdate', className, query, update);
    return this.updateObjectsByQuery(className, schema, query, update).then(val => val[0]);
  }

  // Apply the update to all objects that match the given Parse Query.
  updateObjectsByQuery(className, schema, query, update) {
    debug('updateObjectsByQuery', className, query, update);
    const updatePatterns = [];
    const values = [className];
    let index = 2;
    schema = toPostgresSchema(schema);

    const originalUpdate = _extends({}, update);
    update = handleDotFields(update);
    // Resolve authData first,
    // So we don't end up with multiple key updates
    for (const fieldName in update) {
      const authDataMatch = fieldName.match(/^_auth_data_([a-zA-Z0-9_]+)$/);
      if (authDataMatch) {
        var provider = authDataMatch[1];
        const value = update[fieldName];
        delete update[fieldName];
        update['authData'] = update['authData'] || {};
        update['authData'][provider] = value;
      }
    }

    for (const fieldName in update) {
      const fieldValue = update[fieldName];
      if (fieldValue === null) {
        updatePatterns.push(`$${index}:name = NULL`);
        values.push(fieldName);
        index += 1;
      } else if (fieldName == 'authData') {
        // This recursively sets the json_object
        // Only 1 level deep
        const generate = (jsonb, key, value) => {
          return `json_object_set_key(COALESCE(${jsonb}, '{}'::jsonb), ${key}, ${value})::jsonb`;
        };
        const lastKey = `$${index}:name`;
        const fieldNameIndex = index;
        index += 1;
        values.push(fieldName);
        const update = Object.keys(fieldValue).reduce((lastKey, key) => {
          const str = generate(lastKey, `$${index}::text`, `$${index + 1}::jsonb`);
          index += 2;
          let value = fieldValue[key];
          if (value) {
            if (value.__op === 'Delete') {
              value = null;
            } else {
              value = JSON.stringify(value);
            }
          }
          values.push(key, value);
          return str;
        }, lastKey);
        updatePatterns.push(`$${fieldNameIndex}:name = ${update}`);
      } else if (fieldValue.__op === 'Increment') {
        updatePatterns.push(`$${index}:name = COALESCE($${index}:name, 0) + $${index + 1}`);
        values.push(fieldName, fieldValue.amount);
        index += 2;
      } else if (fieldValue.__op === 'Add') {
        updatePatterns.push(`$${index}:name = array_add(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldValue.__op === 'Delete') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, null);
        index += 2;
      } else if (fieldValue.__op === 'Remove') {
        updatePatterns.push(`$${index}:name = array_remove(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldValue.__op === 'AddUnique') {
        updatePatterns.push(`$${index}:name = array_add_unique(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldName === 'updatedAt') {
        //TODO: stop special casing this. It should check for __type === 'Date' and use .iso
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'string') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'boolean') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (fieldValue.__type === 'Pointer') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.objectId);
        index += 2;
      } else if (fieldValue.__type === 'Date') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue));
        index += 2;
      } else if (fieldValue instanceof Date) {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (fieldValue.__type === 'File') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue));
        index += 2;
      } else if (fieldValue.__type === 'GeoPoint') {
        updatePatterns.push(`$${index}:name = POINT($${index + 1}, $${index + 2})`);
        values.push(fieldName, fieldValue.longitude, fieldValue.latitude);
        index += 3;
      } else if (fieldValue.__type === 'Polygon') {
        const value = convertPolygonToSQL(fieldValue.coordinates);
        updatePatterns.push(`$${index}:name = $${index + 1}::polygon`);
        values.push(fieldName, value);
        index += 2;
      } else if (fieldValue.__type === 'Relation') {
        // noop
      } else if (typeof fieldValue === 'number') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'object' && schema.fields[fieldName] && schema.fields[fieldName].type === 'Object') {
        // Gather keys to increment
        const keysToIncrement = Object.keys(originalUpdate).filter(k => {
          // choose top level fields that have a delete operation set
          // Note that Object.keys is iterating over the **original** update object
          // and that some of the keys of the original update could be null or undefined:
          // (See the above check `if (fieldValue === null || typeof fieldValue == "undefined")`)
          const value = originalUpdate[k];
          return value && value.__op === 'Increment' && k.split('.').length === 2 && k.split(".")[0] === fieldName;
        }).map(k => k.split('.')[1]);

        let incrementPatterns = '';
        if (keysToIncrement.length > 0) {
          incrementPatterns = ' || ' + keysToIncrement.map(c => {
            const amount = fieldValue[c].amount;
            return `CONCAT('{"${c}":', COALESCE($${index}:name->>'${c}','0')::int + ${amount}, '}')::jsonb`;
          }).join(' || ');
          // Strip the keys
          keysToIncrement.forEach(key => {
            delete fieldValue[key];
          });
        }

        const keysToDelete = Object.keys(originalUpdate).filter(k => {
          // choose top level fields that have a delete operation set.
          const value = originalUpdate[k];
          return value && value.__op === 'Delete' && k.split('.').length === 2 && k.split(".")[0] === fieldName;
        }).map(k => k.split('.')[1]);

        const deletePatterns = keysToDelete.reduce((p, c, i) => {
          return p + ` - '$${index + 1 + i}:value'`;
        }, '');

        updatePatterns.push(`$${index}:name = ('{}'::jsonb ${deletePatterns} ${incrementPatterns} || $${index + 1 + keysToDelete.length}::jsonb )`);

        values.push(fieldName, ...keysToDelete, JSON.stringify(fieldValue));
        index += 2 + keysToDelete.length;
      } else if (Array.isArray(fieldValue) && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array') {
        const expectedType = parseTypeToPostgresType(schema.fields[fieldName]);
        if (expectedType === 'text[]') {
          updatePatterns.push(`$${index}:name = $${index + 1}::text[]`);
        } else {
          let type = 'text';
          for (const elt of fieldValue) {
            if (typeof elt == 'object') {
              type = 'json';
              break;
            }
          }
          updatePatterns.push(`$${index}:name = array_to_json($${index + 1}::${type}[])::jsonb`);
        }
        values.push(fieldName, fieldValue);
        index += 2;
      } else {
        debug('Not supported update', fieldName, fieldValue);
        return Promise.reject(new _node2.default.Error(_node2.default.Error.OPERATION_FORBIDDEN, `Postgres doesn't support update ${JSON.stringify(fieldValue)} yet`));
      }
    }

    const where = buildWhereClause({ schema, index, query });
    values.push(...where.values);

    const whereClause = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const qs = `UPDATE $1:name SET ${updatePatterns.join()} ${whereClause} RETURNING *`;
    debug('update: ', qs, values);
    return this._client.any(qs, values);
  }

  // Hopefully, we can get rid of this. It's only used for config and hooks.
  upsertOneObject(className, schema, query, update) {
    debug('upsertOneObject', { className, query, update });
    const createValue = Object.assign({}, query, update);
    return this.createObject(className, schema, createValue).catch(error => {
      // ignore duplicate value errors as it's upsert
      if (error.code !== _node2.default.Error.DUPLICATE_VALUE) {
        throw error;
      }
      return this.findOneAndUpdate(className, schema, query, update);
    });
  }

  find(className, schema, query, { skip, limit, sort, keys }) {
    debug('find', className, query, { skip, limit, sort, keys });
    const hasLimit = limit !== undefined;
    const hasSkip = skip !== undefined;
    let values = [className];
    const where = buildWhereClause({ schema, query, index: 2 });
    values.push(...where.values);

    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const limitPattern = hasLimit ? `LIMIT $${values.length + 1}` : '';
    if (hasLimit) {
      values.push(limit);
    }
    const skipPattern = hasSkip ? `OFFSET $${values.length + 1}` : '';
    if (hasSkip) {
      values.push(skip);
    }

    let sortPattern = '';
    if (sort) {
      const sortCopy = sort;
      const sorting = Object.keys(sort).map(key => {
        const transformKey = transformDotFieldToComponents(key).join('->');
        // Using $idx pattern gives:  non-integer constant in ORDER BY
        if (sortCopy[key] === 1) {
          return `${transformKey} ASC`;
        }
        return `${transformKey} DESC`;
      }).join();
      sortPattern = sort !== undefined && Object.keys(sort).length > 0 ? `ORDER BY ${sorting}` : '';
    }
    if (where.sorts && Object.keys(where.sorts).length > 0) {
      sortPattern = `ORDER BY ${where.sorts.join()}`;
    }

    let columns = '*';
    if (keys) {
      // Exclude empty keys
      keys = keys.filter(key => {
        return key.length > 0;
      });
      columns = keys.map((key, index) => {
        if (key === '$score') {
          return `ts_rank_cd(to_tsvector($${2}, $${3}:name), to_tsquery($${4}, $${5}), 32) as score`;
        }
        return `$${index + values.length + 1}:name`;
      }).join();
      values = values.concat(keys);
    }

    const qs = `SELECT ${columns} FROM $1:name ${wherePattern} ${sortPattern} ${limitPattern} ${skipPattern}`;
    debug(qs, values);
    return this._client.any(qs, values).catch(error => {
      // Query on non existing table, don't crash
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      }
      return [];
    }).then(results => results.map(object => this.postgresObjectToParseObject(className, object, schema)));
  }

  // Converts from a postgres-format object to a REST-format object.
  // Does not strip out anything based on a lack of authentication.
  postgresObjectToParseObject(className, object, schema) {
    Object.keys(schema.fields).forEach(fieldName => {
      if (schema.fields[fieldName].type === 'Pointer' && object[fieldName]) {
        object[fieldName] = { objectId: object[fieldName], __type: 'Pointer', className: schema.fields[fieldName].targetClass };
      }
      if (schema.fields[fieldName].type === 'Relation') {
        object[fieldName] = {
          __type: "Relation",
          className: schema.fields[fieldName].targetClass
        };
      }
      if (object[fieldName] && schema.fields[fieldName].type === 'GeoPoint') {
        object[fieldName] = {
          __type: "GeoPoint",
          latitude: object[fieldName].y,
          longitude: object[fieldName].x
        };
      }
      if (object[fieldName] && schema.fields[fieldName].type === 'Polygon') {
        let coords = object[fieldName];
        coords = coords.substr(2, coords.length - 4).split('),(');
        coords = coords.map(point => {
          return [parseFloat(point.split(',')[1]), parseFloat(point.split(',')[0])];
        });
        object[fieldName] = {
          __type: "Polygon",
          coordinates: coords
        };
      }
      if (object[fieldName] && schema.fields[fieldName].type === 'File') {
        object[fieldName] = {
          __type: 'File',
          name: object[fieldName]
        };
      }
    });
    //TODO: remove this reliance on the mongo format. DB adapter shouldn't know there is a difference between created at and any other date field.
    if (object.createdAt) {
      object.createdAt = object.createdAt.toISOString();
    }
    if (object.updatedAt) {
      object.updatedAt = object.updatedAt.toISOString();
    }
    if (object.expiresAt) {
      object.expiresAt = { __type: 'Date', iso: object.expiresAt.toISOString() };
    }
    if (object._email_verify_token_expires_at) {
      object._email_verify_token_expires_at = { __type: 'Date', iso: object._email_verify_token_expires_at.toISOString() };
    }
    if (object._account_lockout_expires_at) {
      object._account_lockout_expires_at = { __type: 'Date', iso: object._account_lockout_expires_at.toISOString() };
    }
    if (object._perishable_token_expires_at) {
      object._perishable_token_expires_at = { __type: 'Date', iso: object._perishable_token_expires_at.toISOString() };
    }
    if (object._password_changed_at) {
      object._password_changed_at = { __type: 'Date', iso: object._password_changed_at.toISOString() };
    }

    for (const fieldName in object) {
      if (object[fieldName] === null) {
        delete object[fieldName];
      }
      if (object[fieldName] instanceof Date) {
        object[fieldName] = { __type: 'Date', iso: object[fieldName].toISOString() };
      }
    }

    return object;
  }

  // Create a unique index. Unique indexes on nullable fields are not allowed. Since we don't
  // currently know which fields are nullable and which aren't, we ignore that criteria.
  // As such, we shouldn't expose this function to users of parse until we have an out-of-band
  // Way of determining if a field is nullable. Undefined doesn't count against uniqueness,
  // which is why we use sparse indexes.
  ensureUniqueness(className, schema, fieldNames) {
    // Use the same name for every ensureUniqueness attempt, because postgres
    // Will happily create the same index with multiple names.
    const constraintName = `unique_${fieldNames.sort().join('_')}`;
    const constraintPatterns = fieldNames.map((fieldName, index) => `$${index + 3}:name`);
    const qs = `ALTER TABLE $1:name ADD CONSTRAINT $2:name UNIQUE (${constraintPatterns.join()})`;
    return this._client.none(qs, [className, constraintName, ...fieldNames]).catch(error => {
      if (error.code === PostgresDuplicateRelationError && error.message.includes(constraintName)) {
        // Index already exists. Ignore error.
      } else if (error.code === PostgresUniqueIndexViolationError && error.message.includes(constraintName)) {
        // Cast the error into the proper parse error
        throw new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      } else {
        throw error;
      }
    });
  }

  // Executes a count.
  count(className, schema, query) {
    debug('count', className, query);
    const values = [className];
    const where = buildWhereClause({ schema, query, index: 2 });
    values.push(...where.values);

    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const qs = `SELECT count(*) FROM $1:name ${wherePattern}`;
    return this._client.one(qs, values, a => +a.count).catch(error => {
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      }
      return 0;
    });
  }

  distinct(className, schema, query, fieldName) {
    debug('distinct', className, query);
    let field = fieldName;
    let column = fieldName;
    const isNested = fieldName.indexOf('.') >= 0;
    if (isNested) {
      field = transformDotFieldToComponents(fieldName).join('->');
      column = fieldName.split('.')[0];
    }
    const isArrayField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array';
    const isPointerField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Pointer';
    const values = [field, column, className];
    const where = buildWhereClause({ schema, query, index: 4 });
    values.push(...where.values);

    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const transformer = isArrayField ? 'jsonb_array_elements' : 'ON';
    let qs = `SELECT DISTINCT ${transformer}($1:name) $2:name FROM $3:name ${wherePattern}`;
    if (isNested) {
      qs = `SELECT DISTINCT ${transformer}($1:raw) $2:raw FROM $3:name ${wherePattern}`;
    }
    debug(qs, values);
    return this._client.any(qs, values).catch(error => {
      if (error.code === PostgresMissingColumnError) {
        return [];
      }
      throw error;
    }).then(results => {
      if (!isNested) {
        results = results.filter(object => object[field] !== null);
        return results.map(object => {
          if (!isPointerField) {
            return object[field];
          }
          return {
            __type: 'Pointer',
            className: schema.fields[fieldName].targetClass,
            objectId: object[field]
          };
        });
      }
      const child = fieldName.split('.')[1];
      return results.map(object => object[column][child]);
    }).then(results => results.map(object => this.postgresObjectToParseObject(className, object, schema)));
  }

  aggregate(className, schema, pipeline) {
    debug('aggregate', className, pipeline);
    const values = [className];
    let index = 2;
    let columns = [];
    let countField = null;
    let groupValues = null;
    let wherePattern = '';
    let limitPattern = '';
    let skipPattern = '';
    let sortPattern = '';
    let groupPattern = '';
    for (let i = 0; i < pipeline.length; i += 1) {
      const stage = pipeline[i];
      if (stage.$group) {
        for (const field in stage.$group) {
          const value = stage.$group[field];
          if (value === null || value === undefined) {
            continue;
          }
          if (field === '_id' && typeof value === 'string' && value !== '') {
            columns.push(`$${index}:name AS "objectId"`);
            groupPattern = `GROUP BY $${index}:name`;
            values.push(transformAggregateField(value));
            index += 1;
            continue;
          }
          if (field === '_id' && typeof value === 'object' && Object.keys(value).length !== 0) {
            groupValues = value;
            const groupByFields = [];
            for (const alias in value) {
              const operation = Object.keys(value[alias])[0];
              const source = transformAggregateField(value[alias][operation]);
              if (mongoAggregateToPostgres[operation]) {
                if (!groupByFields.includes(`"${source}"`)) {
                  groupByFields.push(`"${source}"`);
                }
                columns.push(`EXTRACT(${mongoAggregateToPostgres[operation]} FROM $${index}:name AT TIME ZONE 'UTC') AS $${index + 1}:name`);
                values.push(source, alias);
                index += 2;
              }
            }
            groupPattern = `GROUP BY $${index}:raw`;
            values.push(groupByFields.join());
            index += 1;
            continue;
          }
          if (value.$sum) {
            if (typeof value.$sum === 'string') {
              columns.push(`SUM($${index}:name) AS $${index + 1}:name`);
              values.push(transformAggregateField(value.$sum), field);
              index += 2;
            } else {
              countField = field;
              columns.push(`COUNT(*) AS $${index}:name`);
              values.push(field);
              index += 1;
            }
          }
          if (value.$max) {
            columns.push(`MAX($${index}:name) AS $${index + 1}:name`);
            values.push(transformAggregateField(value.$max), field);
            index += 2;
          }
          if (value.$min) {
            columns.push(`MIN($${index}:name) AS $${index + 1}:name`);
            values.push(transformAggregateField(value.$min), field);
            index += 2;
          }
          if (value.$avg) {
            columns.push(`AVG($${index}:name) AS $${index + 1}:name`);
            values.push(transformAggregateField(value.$avg), field);
            index += 2;
          }
        }
      } else {
        columns.push('*');
      }
      if (stage.$project) {
        if (columns.includes('*')) {
          columns = [];
        }
        for (const field in stage.$project) {
          const value = stage.$project[field];
          if (value === 1 || value === true) {
            columns.push(`$${index}:name`);
            values.push(field);
            index += 1;
          }
        }
      }
      if (stage.$match) {
        const patterns = [];
        const orOrAnd = stage.$match.hasOwnProperty('$or') ? ' OR ' : ' AND ';

        if (stage.$match.$or) {
          const collapse = {};
          stage.$match.$or.forEach(element => {
            for (const key in element) {
              collapse[key] = element[key];
            }
          });
          stage.$match = collapse;
        }
        for (const field in stage.$match) {
          const value = stage.$match[field];
          const matchPatterns = [];
          Object.keys(ParseToPosgresComparator).forEach(cmp => {
            if (value[cmp]) {
              const pgComparator = ParseToPosgresComparator[cmp];
              matchPatterns.push(`$${index}:name ${pgComparator} $${index + 1}`);
              values.push(field, toPostgresValue(value[cmp]));
              index += 2;
            }
          });
          if (matchPatterns.length > 0) {
            patterns.push(`(${matchPatterns.join(' AND ')})`);
          }
          if (schema.fields[field] && schema.fields[field].type && matchPatterns.length === 0) {
            patterns.push(`$${index}:name = $${index + 1}`);
            values.push(field, value);
            index += 2;
          }
        }
        wherePattern = patterns.length > 0 ? `WHERE ${patterns.join(` ${orOrAnd} `)}` : '';
      }
      if (stage.$limit) {
        limitPattern = `LIMIT $${index}`;
        values.push(stage.$limit);
        index += 1;
      }
      if (stage.$skip) {
        skipPattern = `OFFSET $${index}`;
        values.push(stage.$skip);
        index += 1;
      }
      if (stage.$sort) {
        const sort = stage.$sort;
        const keys = Object.keys(sort);
        const sorting = keys.map(key => {
          const transformer = sort[key] === 1 ? 'ASC' : 'DESC';
          const order = `$${index}:name ${transformer}`;
          index += 1;
          return order;
        }).join();
        values.push(...keys);
        sortPattern = sort !== undefined && sorting.length > 0 ? `ORDER BY ${sorting}` : '';
      }
    }

    const qs = `SELECT ${columns.join()} FROM $1:name ${wherePattern} ${sortPattern} ${limitPattern} ${skipPattern} ${groupPattern}`;
    debug(qs, values);
    return this._client.map(qs, values, a => this.postgresObjectToParseObject(className, a, schema)).then(results => {
      results.forEach(result => {
        if (!result.hasOwnProperty('objectId')) {
          result.objectId = null;
        }
        if (groupValues) {
          result.objectId = {};
          for (const key in groupValues) {
            result.objectId[key] = result[key];
            delete result[key];
          }
        }
        if (countField) {
          result[countField] = parseInt(result[countField], 10);
        }
      });
      return results;
    });
  }

  performInitialization({ VolatileClassesSchemas }) {
    // TODO: This method needs to be rewritten to make proper use of connections (@vitaly-t)
    debug('performInitialization');
    const promises = VolatileClassesSchemas.map(schema => {
      return this.createTable(schema.className, schema).catch(err => {
        if (err.code === PostgresDuplicateRelationError || err.code === _node2.default.Error.INVALID_CLASS_NAME) {
          return Promise.resolve();
        }
        throw err;
      }).then(() => this.schemaUpgrade(schema.className, schema));
    });
    return Promise.all(promises).then(() => {
      return this._client.tx('perform-initialization', t => {
        return t.batch([t.none(_sql2.default.misc.jsonObjectSetKeys), t.none(_sql2.default.array.add), t.none(_sql2.default.array.addUnique), t.none(_sql2.default.array.remove), t.none(_sql2.default.array.containsAll), t.none(_sql2.default.array.containsAllRegex), t.none(_sql2.default.array.contains)]);
      });
    }).then(data => {
      debug(`initializationDone in ${data.duration}`);
    }).catch(error => {
      /* eslint-disable no-console */
      console.error(error);
    });
  }

  createIndexes(className, indexes, conn) {
    return (conn || this._client).tx(t => t.batch(indexes.map(i => {
      return t.none('CREATE INDEX $1:name ON $2:name ($3:name)', [i.name, className, i.key]);
    })));
  }

  createIndexesIfNeeded(className, fieldName, type, conn) {
    return (conn || this._client).none('CREATE INDEX $1:name ON $2:name ($3:name)', [fieldName, className, type]);
  }

  dropIndexes(className, indexes, conn) {
    const queries = indexes.map(i => ({ query: 'DROP INDEX $1:name', values: i }));
    return (conn || this._client).tx(t => t.none(this._pgp.helpers.concat(queries)));
  }

  getIndexes(className) {
    const qs = 'SELECT * FROM pg_indexes WHERE tablename = ${className}';
    return this._client.any(qs, { className });
  }

  updateSchemaWithIndexes() {
    return Promise.resolve();
  }
}

exports.PostgresStorageAdapter = PostgresStorageAdapter;
function convertPolygonToSQL(polygon) {
  if (polygon.length < 3) {
    throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `Polygon must have at least 3 values`);
  }
  if (polygon[0][0] !== polygon[polygon.length - 1][0] || polygon[0][1] !== polygon[polygon.length - 1][1]) {
    polygon.push(polygon[0]);
  }
  const unique = polygon.filter((item, index, ar) => {
    let foundIndex = -1;
    for (let i = 0; i < ar.length; i += 1) {
      const pt = ar[i];
      if (pt[0] === item[0] && pt[1] === item[1]) {
        foundIndex = i;
        break;
      }
    }
    return foundIndex === index;
  });
  if (unique.length < 3) {
    throw new _node2.default.Error(_node2.default.Error.INTERNAL_SERVER_ERROR, 'GeoJSON: Loop must have at least 3 different vertices');
  }
  const points = polygon.map(point => {
    _node2.default.GeoPoint._validate(parseFloat(point[1]), parseFloat(point[0]));
    return `(${point[1]}, ${point[0]})`;
  }).join(', ');
  return `(${points})`;
}

function removeWhiteSpace(regex) {
  if (!regex.endsWith('\n')) {
    regex += '\n';
  }

  // remove non escaped comments
  return regex.replace(/([^\\])#.*\n/gmi, '$1')
  // remove lines starting with a comment
  .replace(/^#.*\n/gmi, '')
  // remove non escaped whitespace
  .replace(/([^\\])\s+/gmi, '$1')
  // remove whitespace at the beginning of a line
  .replace(/^\s+/, '').trim();
}

function processRegexPattern(s) {
  if (s && s.startsWith('^')) {
    // regex for startsWith
    return '^' + literalizeRegexPart(s.slice(1));
  } else if (s && s.endsWith('$')) {
    // regex for endsWith
    return literalizeRegexPart(s.slice(0, s.length - 1)) + '$';
  }

  // regex for contains
  return literalizeRegexPart(s);
}

function isStartsWithRegex(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('^')) {
    return false;
  }

  const matches = value.match(/\^\\Q.*\\E/);
  return !!matches;
}

function isAllValuesRegexOrNone(values) {
  if (!values || !Array.isArray(values) || values.length === 0) {
    return true;
  }

  const firstValuesIsRegex = isStartsWithRegex(values[0].$regex);
  if (values.length === 1) {
    return firstValuesIsRegex;
  }

  for (let i = 1, length = values.length; i < length; ++i) {
    if (firstValuesIsRegex !== isStartsWithRegex(values[i].$regex)) {
      return false;
    }
  }

  return true;
}

function isAnyValueRegexStartsWith(values) {
  return values.some(function (value) {
    return isStartsWithRegex(value.$regex);
  });
}

function createLiteralRegex(remaining) {
  return remaining.split('').map(c => {
    if (c.match(/[0-9a-zA-Z]/) !== null) {
      // don't escape alphanumeric characters
      return c;
    }
    // escape everything else (single quotes with single quotes, everything else with a backslash)
    return c === `'` ? `''` : `\\${c}`;
  }).join('');
}

function literalizeRegexPart(s) {
  const matcher1 = /\\Q((?!\\E).*)\\E$/;
  const result1 = s.match(matcher1);
  if (result1 && result1.length > 1 && result1.index > -1) {
    // process regex that has a beginning and an end specified for the literal text
    const prefix = s.substr(0, result1.index);
    const remaining = result1[1];

    return literalizeRegexPart(prefix) + createLiteralRegex(remaining);
  }

  // process regex that has a beginning specified for the literal text
  const matcher2 = /\\Q((?!\\E).*)$/;
  const result2 = s.match(matcher2);
  if (result2 && result2.length > 1 && result2.index > -1) {
    const prefix = s.substr(0, result2.index);
    const remaining = result2[1];

    return literalizeRegexPart(prefix) + createLiteralRegex(remaining);
  }

  // remove all instances of \Q and \E from the remaining text & escape single quotes
  return s.replace(/([^\\])(\\E)/, '$1').replace(/([^\\])(\\Q)/, '$1').replace(/^\\E/, '').replace(/^\\Q/, '').replace(/([^'])'/, `$1''`).replace(/^'([^'])/, `''$1`);
}

var GeoPointCoder = {
  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'GeoPoint';
  }
};

exports.default = PostgresStorageAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL1Bvc3RncmVzL1Bvc3RncmVzU3RvcmFnZUFkYXB0ZXIuanMiXSwibmFtZXMiOlsiUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yIiwiUG9zdGdyZXNEdXBsaWNhdGVSZWxhdGlvbkVycm9yIiwiUG9zdGdyZXNEdXBsaWNhdGVDb2x1bW5FcnJvciIsIlBvc3RncmVzTWlzc2luZ0NvbHVtbkVycm9yIiwiUG9zdGdyZXNEdXBsaWNhdGVPYmplY3RFcnJvciIsIlBvc3RncmVzVW5pcXVlSW5kZXhWaW9sYXRpb25FcnJvciIsIlBvc3RncmVzVHJhbnNhY3Rpb25BYm9ydGVkRXJyb3IiLCJsb2dnZXIiLCJyZXF1aXJlIiwiZGVidWciLCJhcmdzIiwiYXJndW1lbnRzIiwiY29uY2F0Iiwic2xpY2UiLCJsZW5ndGgiLCJsb2ciLCJnZXRMb2dnZXIiLCJhcHBseSIsInBhcnNlVHlwZVRvUG9zdGdyZXNUeXBlIiwidHlwZSIsImNvbnRlbnRzIiwiSlNPTiIsInN0cmluZ2lmeSIsIlBhcnNlVG9Qb3NncmVzQ29tcGFyYXRvciIsIm1vbmdvQWdncmVnYXRlVG9Qb3N0Z3JlcyIsIiRkYXlPZk1vbnRoIiwiJGRheU9mV2VlayIsIiRkYXlPZlllYXIiLCIkaXNvRGF5T2ZXZWVrIiwiJGlzb1dlZWtZZWFyIiwiJGhvdXIiLCIkbWludXRlIiwiJHNlY29uZCIsIiRtaWxsaXNlY29uZCIsIiRtb250aCIsIiR3ZWVrIiwiJHllYXIiLCJ0b1Bvc3RncmVzVmFsdWUiLCJ2YWx1ZSIsIl9fdHlwZSIsImlzbyIsIm5hbWUiLCJ0cmFuc2Zvcm1WYWx1ZSIsIm9iamVjdElkIiwiZW1wdHlDTFBTIiwiT2JqZWN0IiwiZnJlZXplIiwiZmluZCIsImdldCIsImNyZWF0ZSIsInVwZGF0ZSIsImRlbGV0ZSIsImFkZEZpZWxkIiwiZGVmYXVsdENMUFMiLCJ0b1BhcnNlU2NoZW1hIiwic2NoZW1hIiwiY2xhc3NOYW1lIiwiZmllbGRzIiwiX2hhc2hlZF9wYXNzd29yZCIsIl93cGVybSIsIl9ycGVybSIsImNscHMiLCJjbGFzc0xldmVsUGVybWlzc2lvbnMiLCJpbmRleGVzIiwidG9Qb3N0Z3Jlc1NjaGVtYSIsIl9wYXNzd29yZF9oaXN0b3J5IiwiaGFuZGxlRG90RmllbGRzIiwib2JqZWN0Iiwia2V5cyIsImZvckVhY2giLCJmaWVsZE5hbWUiLCJpbmRleE9mIiwiY29tcG9uZW50cyIsInNwbGl0IiwiZmlyc3QiLCJzaGlmdCIsImN1cnJlbnRPYmoiLCJuZXh0IiwiX19vcCIsInVuZGVmaW5lZCIsInRyYW5zZm9ybURvdEZpZWxkVG9Db21wb25lbnRzIiwibWFwIiwiY21wdCIsImluZGV4IiwidHJhbnNmb3JtRG90RmllbGQiLCJqb2luIiwidHJhbnNmb3JtQWdncmVnYXRlRmllbGQiLCJzdWJzdHIiLCJ2YWxpZGF0ZUtleXMiLCJrZXkiLCJpbmNsdWRlcyIsIlBhcnNlIiwiRXJyb3IiLCJJTlZBTElEX05FU1RFRF9LRVkiLCJqb2luVGFibGVzRm9yU2NoZW1hIiwibGlzdCIsImZpZWxkIiwicHVzaCIsImJ1aWxkV2hlcmVDbGF1c2UiLCJxdWVyeSIsInBhdHRlcm5zIiwidmFsdWVzIiwic29ydHMiLCJpc0FycmF5RmllbGQiLCJpbml0aWFsUGF0dGVybnNMZW5ndGgiLCJmaWVsZFZhbHVlIiwiJGV4aXN0cyIsIiRpbiIsImluUGF0dGVybnMiLCJsaXN0RWxlbSIsIiRyZWdleCIsIk1BWF9JTlRfUExVU19PTkUiLCJjbGF1c2VzIiwiY2xhdXNlVmFsdWVzIiwic3ViUXVlcnkiLCJjbGF1c2UiLCJwYXR0ZXJuIiwib3JPckFuZCIsIm5vdCIsIiRuZSIsIiRlcSIsImlzSW5Pck5pbiIsIkFycmF5IiwiaXNBcnJheSIsIiRuaW4iLCJhbGxvd051bGwiLCJsaXN0SW5kZXgiLCJjcmVhdGVDb25zdHJhaW50IiwiYmFzZUFycmF5Iiwibm90SW4iLCJfIiwiZmxhdE1hcCIsImVsdCIsIklOVkFMSURfSlNPTiIsIiRhbGwiLCJpc0FueVZhbHVlUmVnZXhTdGFydHNXaXRoIiwiaXNBbGxWYWx1ZXNSZWdleE9yTm9uZSIsImkiLCJwcm9jZXNzUmVnZXhQYXR0ZXJuIiwic3Vic3RyaW5nIiwiJGNvbnRhaW5lZEJ5IiwiYXJyIiwiJHRleHQiLCJzZWFyY2giLCIkc2VhcmNoIiwibGFuZ3VhZ2UiLCIkdGVybSIsIiRsYW5ndWFnZSIsIiRjYXNlU2Vuc2l0aXZlIiwiJGRpYWNyaXRpY1NlbnNpdGl2ZSIsIiRuZWFyU3BoZXJlIiwicG9pbnQiLCJkaXN0YW5jZSIsIiRtYXhEaXN0YW5jZSIsImRpc3RhbmNlSW5LTSIsImxvbmdpdHVkZSIsImxhdGl0dWRlIiwiJHdpdGhpbiIsIiRib3giLCJib3giLCJsZWZ0IiwiYm90dG9tIiwicmlnaHQiLCJ0b3AiLCIkZ2VvV2l0aGluIiwiJGNlbnRlclNwaGVyZSIsImNlbnRlclNwaGVyZSIsIkdlb1BvaW50IiwiR2VvUG9pbnRDb2RlciIsImlzVmFsaWRKU09OIiwiX3ZhbGlkYXRlIiwiaXNOYU4iLCIkcG9seWdvbiIsInBvbHlnb24iLCJwb2ludHMiLCJjb29yZGluYXRlcyIsIiRnZW9JbnRlcnNlY3RzIiwiJHBvaW50IiwicmVnZXgiLCJvcGVyYXRvciIsIm9wdHMiLCIkb3B0aW9ucyIsInJlbW92ZVdoaXRlU3BhY2UiLCJjb252ZXJ0UG9seWdvblRvU1FMIiwiY21wIiwicGdDb21wYXJhdG9yIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsIlBvc3RncmVzU3RvcmFnZUFkYXB0ZXIiLCJjb25zdHJ1Y3RvciIsInVyaSIsImNvbGxlY3Rpb25QcmVmaXgiLCJkYXRhYmFzZU9wdGlvbnMiLCJfY29sbGVjdGlvblByZWZpeCIsImNsaWVudCIsInBncCIsIl9jbGllbnQiLCJfcGdwIiwiY2FuU29ydE9uSm9pblRhYmxlcyIsImhhbmRsZVNodXRkb3duIiwiJHBvb2wiLCJlbmQiLCJfZW5zdXJlU2NoZW1hQ29sbGVjdGlvbkV4aXN0cyIsImNvbm4iLCJub25lIiwiY2F0Y2giLCJlcnJvciIsImNvZGUiLCJjbGFzc0V4aXN0cyIsIm9uZSIsImEiLCJleGlzdHMiLCJzZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJDTFBzIiwic2VsZiIsInRhc2siLCJ0Iiwic2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQiLCJzdWJtaXR0ZWRJbmRleGVzIiwiZXhpc3RpbmdJbmRleGVzIiwiUHJvbWlzZSIsInJlc29sdmUiLCJfaWRfIiwiX2lkIiwiZGVsZXRlZEluZGV4ZXMiLCJpbnNlcnRlZEluZGV4ZXMiLCJJTlZBTElEX1FVRVJZIiwiaGFzT3duUHJvcGVydHkiLCJ0eCIsImNyZWF0ZUluZGV4ZXMiLCJkcm9wSW5kZXhlcyIsImNyZWF0ZUNsYXNzIiwicTEiLCJjcmVhdGVUYWJsZSIsInEyIiwicTMiLCJiYXRjaCIsInRoZW4iLCJlcnIiLCJkYXRhIiwicmVzdWx0IiwiZGV0YWlsIiwiRFVQTElDQVRFX1ZBTFVFIiwidmFsdWVzQXJyYXkiLCJwYXR0ZXJuc0FycmF5IiwiYXNzaWduIiwiX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0IiwiX2VtYWlsX3ZlcmlmeV90b2tlbiIsIl9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCIsIl9mYWlsZWRfbG9naW5fY291bnQiLCJfcGVyaXNoYWJsZV90b2tlbiIsIl9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQiLCJfcGFzc3dvcmRfY2hhbmdlZF9hdCIsInJlbGF0aW9ucyIsInBhcnNlVHlwZSIsInFzIiwiam9pblRhYmxlIiwic2NoZW1hVXBncmFkZSIsImNvbHVtbnMiLCJjb2x1bW5fbmFtZSIsIm5ld0NvbHVtbnMiLCJmaWx0ZXIiLCJpdGVtIiwiYWRkRmllbGRJZk5vdEV4aXN0cyIsInBvc3RncmVzVHlwZSIsImFueSIsInBhdGgiLCJkZWxldGVDbGFzcyIsIm9wZXJhdGlvbnMiLCJoZWxwZXJzIiwiZGVsZXRlQWxsQ2xhc3NlcyIsIm5vdyIsIkRhdGUiLCJnZXRUaW1lIiwicmVzdWx0cyIsImpvaW5zIiwicmVkdWNlIiwiY2xhc3NlcyIsInF1ZXJpZXMiLCJkZWxldGVGaWVsZHMiLCJmaWVsZE5hbWVzIiwiaWR4IiwiZ2V0QWxsQ2xhc3NlcyIsInJvdyIsImdldENsYXNzIiwiY3JlYXRlT2JqZWN0IiwiY29sdW1uc0FycmF5IiwiZ2VvUG9pbnRzIiwiYXV0aERhdGFNYXRjaCIsIm1hdGNoIiwicHJvdmlkZXIiLCJwb3AiLCJpbml0aWFsVmFsdWVzIiwidmFsIiwidGVybWluYXRpb24iLCJnZW9Qb2ludHNJbmplY3RzIiwibCIsImNvbHVtbnNQYXR0ZXJuIiwiY29sIiwidmFsdWVzUGF0dGVybiIsIm9wcyIsInVuZGVybHlpbmdFcnJvciIsImNvbnN0cmFpbnQiLCJtYXRjaGVzIiwidXNlckluZm8iLCJkdXBsaWNhdGVkX2ZpZWxkIiwiZGVsZXRlT2JqZWN0c0J5UXVlcnkiLCJ3aGVyZSIsImNvdW50IiwiT0JKRUNUX05PVF9GT1VORCIsImZpbmRPbmVBbmRVcGRhdGUiLCJ1cGRhdGVPYmplY3RzQnlRdWVyeSIsInVwZGF0ZVBhdHRlcm5zIiwib3JpZ2luYWxVcGRhdGUiLCJnZW5lcmF0ZSIsImpzb25iIiwibGFzdEtleSIsImZpZWxkTmFtZUluZGV4Iiwic3RyIiwiYW1vdW50Iiwib2JqZWN0cyIsImtleXNUb0luY3JlbWVudCIsImsiLCJpbmNyZW1lbnRQYXR0ZXJucyIsImMiLCJrZXlzVG9EZWxldGUiLCJkZWxldGVQYXR0ZXJucyIsInAiLCJleHBlY3RlZFR5cGUiLCJyZWplY3QiLCJ3aGVyZUNsYXVzZSIsInVwc2VydE9uZU9iamVjdCIsImNyZWF0ZVZhbHVlIiwic2tpcCIsImxpbWl0Iiwic29ydCIsImhhc0xpbWl0IiwiaGFzU2tpcCIsIndoZXJlUGF0dGVybiIsImxpbWl0UGF0dGVybiIsInNraXBQYXR0ZXJuIiwic29ydFBhdHRlcm4iLCJzb3J0Q29weSIsInNvcnRpbmciLCJ0cmFuc2Zvcm1LZXkiLCJwb3N0Z3Jlc09iamVjdFRvUGFyc2VPYmplY3QiLCJ0YXJnZXRDbGFzcyIsInkiLCJ4IiwiY29vcmRzIiwicGFyc2VGbG9hdCIsImNyZWF0ZWRBdCIsInRvSVNPU3RyaW5nIiwidXBkYXRlZEF0IiwiZXhwaXJlc0F0IiwiZW5zdXJlVW5pcXVlbmVzcyIsImNvbnN0cmFpbnROYW1lIiwiY29uc3RyYWludFBhdHRlcm5zIiwibWVzc2FnZSIsImRpc3RpbmN0IiwiY29sdW1uIiwiaXNOZXN0ZWQiLCJpc1BvaW50ZXJGaWVsZCIsInRyYW5zZm9ybWVyIiwiY2hpbGQiLCJhZ2dyZWdhdGUiLCJwaXBlbGluZSIsImNvdW50RmllbGQiLCJncm91cFZhbHVlcyIsImdyb3VwUGF0dGVybiIsInN0YWdlIiwiJGdyb3VwIiwiZ3JvdXBCeUZpZWxkcyIsImFsaWFzIiwib3BlcmF0aW9uIiwic291cmNlIiwiJHN1bSIsIiRtYXgiLCIkbWluIiwiJGF2ZyIsIiRwcm9qZWN0IiwiJG1hdGNoIiwiJG9yIiwiY29sbGFwc2UiLCJlbGVtZW50IiwibWF0Y2hQYXR0ZXJucyIsIiRsaW1pdCIsIiRza2lwIiwiJHNvcnQiLCJvcmRlciIsInBhcnNlSW50IiwicGVyZm9ybUluaXRpYWxpemF0aW9uIiwiVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyIsInByb21pc2VzIiwiSU5WQUxJRF9DTEFTU19OQU1FIiwiYWxsIiwic3FsIiwibWlzYyIsImpzb25PYmplY3RTZXRLZXlzIiwiYXJyYXkiLCJhZGQiLCJhZGRVbmlxdWUiLCJyZW1vdmUiLCJjb250YWluc0FsbCIsImNvbnRhaW5zQWxsUmVnZXgiLCJjb250YWlucyIsImR1cmF0aW9uIiwiY29uc29sZSIsImNyZWF0ZUluZGV4ZXNJZk5lZWRlZCIsImdldEluZGV4ZXMiLCJ1cGRhdGVTY2hlbWFXaXRoSW5kZXhlcyIsInVuaXF1ZSIsImFyIiwiZm91bmRJbmRleCIsInB0IiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwiZW5kc1dpdGgiLCJyZXBsYWNlIiwidHJpbSIsInMiLCJzdGFydHNXaXRoIiwibGl0ZXJhbGl6ZVJlZ2V4UGFydCIsImlzU3RhcnRzV2l0aFJlZ2V4IiwiZmlyc3RWYWx1ZXNJc1JlZ2V4Iiwic29tZSIsImNyZWF0ZUxpdGVyYWxSZWdleCIsInJlbWFpbmluZyIsIm1hdGNoZXIxIiwicmVzdWx0MSIsInByZWZpeCIsIm1hdGNoZXIyIiwicmVzdWx0MiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFFQTs7QUFFQTs7O0FBSEE7O0FBRUE7Ozs7QUFFQTs7OztBQUNBOzs7O0FBaUJBOzs7O0FBZkEsTUFBTUEsb0NBQW9DLE9BQTFDO0FBQ0EsTUFBTUMsaUNBQWlDLE9BQXZDO0FBQ0EsTUFBTUMsK0JBQStCLE9BQXJDO0FBQ0EsTUFBTUMsNkJBQTZCLE9BQW5DO0FBQ0EsTUFBTUMsK0JBQStCLE9BQXJDO0FBQ0EsTUFBTUMsb0NBQW9DLE9BQTFDO0FBQ0EsTUFBTUMsa0NBQWtDLE9BQXhDO0FBQ0EsTUFBTUMsU0FBU0MsUUFBUSxpQkFBUixDQUFmOztBQUVBLE1BQU1DLFFBQVEsVUFBUyxHQUFHQyxJQUFaLEVBQXVCO0FBQ25DQSxTQUFPLENBQUMsU0FBU0MsVUFBVSxDQUFWLENBQVYsRUFBd0JDLE1BQXhCLENBQStCRixLQUFLRyxLQUFMLENBQVcsQ0FBWCxFQUFjSCxLQUFLSSxNQUFuQixDQUEvQixDQUFQO0FBQ0EsUUFBTUMsTUFBTVIsT0FBT1MsU0FBUCxFQUFaO0FBQ0FELE1BQUlOLEtBQUosQ0FBVVEsS0FBVixDQUFnQkYsR0FBaEIsRUFBcUJMLElBQXJCO0FBQ0QsQ0FKRDs7QUFXQSxNQUFNUSwwQkFBMEJDLFFBQVE7QUFDdEMsVUFBUUEsS0FBS0EsSUFBYjtBQUNBLFNBQUssUUFBTDtBQUFlLGFBQU8sTUFBUDtBQUNmLFNBQUssTUFBTDtBQUFhLGFBQU8sMEJBQVA7QUFDYixTQUFLLFFBQUw7QUFBZSxhQUFPLE9BQVA7QUFDZixTQUFLLE1BQUw7QUFBYSxhQUFPLE1BQVA7QUFDYixTQUFLLFNBQUw7QUFBZ0IsYUFBTyxTQUFQO0FBQ2hCLFNBQUssU0FBTDtBQUFnQixhQUFPLFVBQVA7QUFDaEIsU0FBSyxRQUFMO0FBQWUsYUFBTyxrQkFBUDtBQUNmLFNBQUssVUFBTDtBQUFpQixhQUFPLE9BQVA7QUFDakIsU0FBSyxPQUFM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QURGO0FBUUQ7O0FBRUQsSUFBSXhQLGdCQUFnQjtBQUNsQkMsY0FBWW5JLEtBQVosRUFBbUI7QUFDakIsV0FBUSxPQUFPQSxLQUFQLEtBQWlCLFFBQWpCLElBQ05BLFVBQVUsSUFESixJQUVOQSxNQUFNQyxNQUFOLEtBQWlCLFVBRm5CO0FBSUQ7QUFOaUIsQ0FBcEI7O2tCQVNlb0osc0IiLCJmaWxlIjoiUG9zdGdyZXNTdG9yYWdlQWRhcHRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEBmbG93XG5pbXBvcnQgeyBjcmVhdGVDbGllbnQgfSBmcm9tICcuL1Bvc3RncmVzQ2xpZW50Jztcbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuaW1wb3J0IFBhcnNlICAgICAgICAgICAgZnJvbSAncGFyc2Uvbm9kZSc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBfICAgICAgICAgICAgICAgIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgc3FsICAgICAgICAgICAgICBmcm9tICcuL3NxbCc7XG5cbmNvbnN0IFBvc3RncmVzUmVsYXRpb25Eb2VzTm90RXhpc3RFcnJvciA9ICc0MlAwMSc7XG5jb25zdCBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IgPSAnNDJQMDcnO1xuY29uc3QgUG9zdGdyZXNEdXBsaWNhdGVDb2x1bW5FcnJvciA9ICc0MjcwMSc7XG5jb25zdCBQb3N0Z3Jlc01pc3NpbmdDb2x1bW5FcnJvciA9ICc0MjcwMyc7XG5jb25zdCBQb3N0Z3Jlc0R1cGxpY2F0ZU9iamVjdEVycm9yID0gJzQyNzEwJztcbmNvbnN0IFBvc3RncmVzVW5pcXVlSW5kZXhWaW9sYXRpb25FcnJvciA9ICcyMzUwNSc7XG5jb25zdCBQb3N0Z3Jlc1RyYW5zYWN0aW9uQWJvcnRlZEVycm9yID0gJzI1UDAyJztcbmNvbnN0IGxvZ2dlciA9IHJlcXVpcmUoJy4uLy4uLy4uL2xvZ2dlcicpO1xuXG5jb25zdCBkZWJ1ZyA9IGZ1bmN0aW9uKC4uLmFyZ3M6IGFueSkge1xuICBhcmdzID0gWydQRzogJyArIGFyZ3VtZW50c1swXV0uY29uY2F0KGFyZ3Muc2xpY2UoMSwgYXJncy5sZW5ndGgpKTtcbiAgY29uc3QgbG9nID0gbG9nZ2VyLmdldExvZ2dlcigpO1xuICBsb2cuZGVidWcuYXBwbHkobG9nLCBhcmdzKTtcbn1cblxuaW1wb3J0IHsgU3RvcmFnZUFkYXB0ZXIgfSAgICBmcm9tICcuLi9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgdHlwZSB7IFNjaGVtYVR5cGUsXG4gIFF1ZXJ5VHlwZSxcbiAgUXVlcnlPcHRpb25zIH0gZnJvbSAnLi4vU3RvcmFnZUFkYXB0ZXInO1xuXG5jb25zdCBwYXJzZVR5cGVUb1Bvc3RncmVzVHlwZSA9IHR5cGUgPT4ge1xuICBzd2l0Y2ggKHR5cGUudHlwZSkge1xuICBjYXNlICdTdHJpbmcnOiByZXR1cm4gJ3RleHQnO1xuICBjYXNlICdEYXRlJzogcmV0dXJuICd0aW1lc3RhbXAgd2l0aCB0aW1lIHpvbmUnO1xuICBjYXNlICdPYmplY3QnOiByZXR1cm4gJ2pzb25iJztcbiAgY2FzZSAnRmlsZSc6IHJldHVybiAndGV4dCc7XG4gIGNhc2UgJ0Jvb2xlYW4nOiByZXR1cm4gJ2Jvb2xlYW4nO1xuICBjYXNlICdQb2ludGVyJzogcmV0dXJuICdjaGFyKDEwKSc7XG4gIGNhc2UgJ051bWJlcic6IHJldHVybiAnZG91YmxlIHByZWNpc2lvbic7XG4gIGNhc2UgJ0dlb1BvaW50JzogcmV0dXJuICdwb2ludCc7XG4gIGNhc2UgJ0J5dGVzJzogcmV0dXJuICdqc29uYic7XG4gIGNhc2UgJ1BvbHlnb24nOiByZXR1cm4gJ3BvbHlnb24nO1xuICBjYXNlICdBcnJheSc6XG4gICAgaWYgKHR5cGUuY29udGVudHMgJiYgdHlwZS5jb250ZW50cy50eXBlID09PSAnU3RyaW5nJykge1xuICAgICAgcmV0dXJuICd0ZXh0W10nO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gJ2pzb25iJztcbiAgICB9XG4gIGRlZmF1bHQ6IHRocm93IGBubyB0eXBlIGZvciAke0pTT04uc3RyaW5naWZ5KHR5cGUpfSB5ZXRgO1xuICB9XG59O1xuXG5jb25zdCBQYXJzZVRvUG9zZ3Jlc0NvbXBhcmF0b3IgPSB7XG4gICckZ3QnOiAnPicsXG4gICckbHQnOiAnPCcsXG4gICckZ3RlJzogJz49JyxcbiAgJyRsdGUnOiAnPD0nXG59XG5cbmNvbnN0IG1vbmdvQWdncmVnYXRlVG9Qb3N0Z3JlcyA9IHtcbiAgJGRheU9mTW9udGg6ICdEQVknLFxuICAkZGF5T2ZXZWVrOiAnRE9XJyxcbiAgJGRheU9mWWVhcjogJ0RPWScsXG4gICRpc29EYXlPZldlZWs6ICdJU09ET1cnLFxuICAkaXNvV2Vla1llYXI6J0lTT1lFQVInLFxuICAkaG91cjogJ0hPVVInLFxuICAkbWludXRlOiAnTUlOVVRFJyxcbiAgJHNlY29uZDogJ1NFQ09ORCcsXG4gICRtaWxsaXNlY29uZDogJ01JTExJU0VDT05EUycsXG4gICRtb250aDogJ01PTlRIJyxcbiAgJHdlZWs6ICdXRUVLJyxcbiAgJHllYXI6ICdZRUFSJyxcbn07XG5cbmNvbnN0IHRvUG9zdGdyZXNWYWx1ZSA9IHZhbHVlID0+IHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICBpZiAodmFsdWUuX190eXBlID09PSAnRGF0ZScpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5pc287XG4gICAgfVxuICAgIGlmICh2YWx1ZS5fX3R5cGUgPT09ICdGaWxlJykge1xuICAgICAgcmV0dXJuIHZhbHVlLm5hbWU7XG4gICAgfVxuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuY29uc3QgdHJhbnNmb3JtVmFsdWUgPSB2YWx1ZSA9PiB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgICAgIHZhbHVlLl9fdHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgcmV0dXJuIHZhbHVlLm9iamVjdElkO1xuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuLy8gRHVwbGljYXRlIGZyb20gdGhlbiBtb25nbyBhZGFwdGVyLi4uXG5jb25zdCBlbXB0eUNMUFMgPSBPYmplY3QuZnJlZXplKHtcbiAgZmluZDoge30sXG4gIGdldDoge30sXG4gIGNyZWF0ZToge30sXG4gIHVwZGF0ZToge30sXG4gIGRlbGV0ZToge30sXG4gIGFkZEZpZWxkOiB7fSxcbn0pO1xuXG5jb25zdCBkZWZhdWx0Q0xQUyA9IE9iamVjdC5mcmVlemUoe1xuICBmaW5kOiB7JyonOiB0cnVlfSxcbiAgZ2V0OiB7JyonOiB0cnVlfSxcbiAgY3JlYXRlOiB7JyonOiB0cnVlfSxcbiAgdXBkYXRlOiB7JyonOiB0cnVlfSxcbiAgZGVsZXRlOiB7JyonOiB0cnVlfSxcbiAgYWRkRmllbGQ6IHsnKic6IHRydWV9LFxufSk7XG5cbmNvbnN0IHRvUGFyc2VTY2hlbWEgPSAoc2NoZW1hKSA9PiB7XG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX2hhc2hlZF9wYXNzd29yZDtcbiAgfVxuICBpZiAoc2NoZW1hLmZpZWxkcykge1xuICAgIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl93cGVybTtcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5fcnBlcm07XG4gIH1cbiAgbGV0IGNscHMgPSBkZWZhdWx0Q0xQUztcbiAgaWYgKHNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnMpIHtcbiAgICBjbHBzID0gey4uLmVtcHR5Q0xQUywgLi4uc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9uc307XG4gIH1cbiAgbGV0IGluZGV4ZXMgPSB7fTtcbiAgaWYgKHNjaGVtYS5pbmRleGVzKSB7XG4gICAgaW5kZXhlcyA9IHsuLi5zY2hlbWEuaW5kZXhlc307XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBjbGFzc05hbWU6IHNjaGVtYS5jbGFzc05hbWUsXG4gICAgZmllbGRzOiBzY2hlbWEuZmllbGRzLFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogY2xwcyxcbiAgICBpbmRleGVzLFxuICB9O1xufVxuXG5jb25zdCB0b1Bvc3RncmVzU2NoZW1hID0gKHNjaGVtYSkgPT4ge1xuICBpZiAoIXNjaGVtYSkge1xuICAgIHJldHVybiBzY2hlbWE7XG4gIH1cbiAgc2NoZW1hLmZpZWxkcyA9IHNjaGVtYS5maWVsZHMgfHwge307XG4gIHNjaGVtYS5maWVsZHMuX3dwZXJtID0ge3R5cGU6ICdBcnJheScsIGNvbnRlbnRzOiB7dHlwZTogJ1N0cmluZyd9fVxuICBzY2hlbWEuZmllbGRzLl9ycGVybSA9IHt0eXBlOiAnQXJyYXknLCBjb250ZW50czoge3R5cGU6ICdTdHJpbmcnfX1cbiAgaWYgKHNjaGVtYS5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBzY2hlbWEuZmllbGRzLl9oYXNoZWRfcGFzc3dvcmQgPSB7dHlwZTogJ1N0cmluZyd9O1xuICAgIHNjaGVtYS5maWVsZHMuX3Bhc3N3b3JkX2hpc3RvcnkgPSB7dHlwZTogJ0FycmF5J307XG4gIH1cbiAgcmV0dXJuIHNjaGVtYTtcbn1cblxuY29uc3QgaGFuZGxlRG90RmllbGRzID0gKG9iamVjdCkgPT4ge1xuICBPYmplY3Qua2V5cyhvYmplY3QpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICBpZiAoZmllbGROYW1lLmluZGV4T2YoJy4nKSA+IC0xKSB7XG4gICAgICBjb25zdCBjb21wb25lbnRzID0gZmllbGROYW1lLnNwbGl0KCcuJyk7XG4gICAgICBjb25zdCBmaXJzdCA9IGNvbXBvbmVudHMuc2hpZnQoKTtcbiAgICAgIG9iamVjdFtmaXJzdF0gPSBvYmplY3RbZmlyc3RdIHx8IHt9O1xuICAgICAgbGV0IGN1cnJlbnRPYmogPSBvYmplY3RbZmlyc3RdO1xuICAgICAgbGV0IG5leHQ7XG4gICAgICBsZXQgdmFsdWUgPSBvYmplY3RbZmllbGROYW1lXTtcbiAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICB2YWx1ZSA9IHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICAgIC8qIGVzbGludC1kaXNhYmxlIG5vLWNvbmQtYXNzaWduICovXG4gICAgICB3aGlsZShuZXh0ID0gY29tcG9uZW50cy5zaGlmdCgpKSB7XG4gICAgICAvKiBlc2xpbnQtZW5hYmxlIG5vLWNvbmQtYXNzaWduICovXG4gICAgICAgIGN1cnJlbnRPYmpbbmV4dF0gPSBjdXJyZW50T2JqW25leHRdIHx8IHt9O1xuICAgICAgICBpZiAoY29tcG9uZW50cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICBjdXJyZW50T2JqW25leHRdID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgY3VycmVudE9iaiA9IGN1cnJlbnRPYmpbbmV4dF07XG4gICAgICB9XG4gICAgICBkZWxldGUgb2JqZWN0W2ZpZWxkTmFtZV07XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIG9iamVjdDtcbn1cblxuY29uc3QgdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMgPSAoZmllbGROYW1lKSA9PiB7XG4gIHJldHVybiBmaWVsZE5hbWUuc3BsaXQoJy4nKS5tYXAoKGNtcHQsIGluZGV4KSA9PiB7XG4gICAgaWYgKGluZGV4ID09PSAwKSB7XG4gICAgICByZXR1cm4gYFwiJHtjbXB0fVwiYDtcbiAgICB9XG4gICAgcmV0dXJuIGAnJHtjbXB0fSdgO1xuICB9KTtcbn1cblxuY29uc3QgdHJhbnNmb3JtRG90RmllbGQgPSAoZmllbGROYW1lKSA9PiB7XG4gIGlmIChmaWVsZE5hbWUuaW5kZXhPZignLicpID09PSAtMSkge1xuICAgIHJldHVybiBgXCIke2ZpZWxkTmFtZX1cImA7XG4gIH1cbiAgY29uc3QgY29tcG9uZW50cyA9IHRyYW5zZm9ybURvdEZpZWxkVG9Db21wb25lbnRzKGZpZWxkTmFtZSk7XG4gIGxldCBuYW1lID0gY29tcG9uZW50cy5zbGljZSgwLCBjb21wb25lbnRzLmxlbmd0aCAtIDEpLmpvaW4oJy0+Jyk7XG4gIG5hbWUgKz0gJy0+PicgKyBjb21wb25lbnRzW2NvbXBvbmVudHMubGVuZ3RoIC0gMV07XG4gIHJldHVybiBuYW1lO1xufVxuXG5jb25zdCB0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCA9IChmaWVsZE5hbWUpID0+IHtcbiAgaWYgKHR5cGVvZiBmaWVsZE5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGZpZWxkTmFtZTtcbiAgfVxuICBpZiAoZmllbGROYW1lID09PSAnJF9jcmVhdGVkX2F0Jykge1xuICAgIHJldHVybiAnY3JlYXRlZEF0JztcbiAgfVxuICBpZiAoZmllbGROYW1lID09PSAnJF91cGRhdGVkX2F0Jykge1xuICAgIHJldHVybiAndXBkYXRlZEF0JztcbiAgfVxuICByZXR1cm4gZmllbGROYW1lLnN1YnN0cigxKTtcbn1cblxuY29uc3QgdmFsaWRhdGVLZXlzID0gKG9iamVjdCkgPT4ge1xuICBpZiAodHlwZW9mIG9iamVjdCA9PSAnb2JqZWN0Jykge1xuICAgIGZvciAoY29uc3Qga2V5IGluIG9iamVjdCkge1xuICAgICAgaWYgKHR5cGVvZiBvYmplY3Rba2V5XSA9PSAnb2JqZWN0Jykge1xuICAgICAgICB2YWxpZGF0ZUtleXMob2JqZWN0W2tleV0pO1xuICAgICAgfVxuXG4gICAgICBpZihrZXkuaW5jbHVkZXMoJyQnKSB8fCBrZXkuaW5jbHVkZXMoJy4nKSl7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX05FU1RFRF9LRVksIFwiTmVzdGVkIGtleXMgc2hvdWxkIG5vdCBjb250YWluIHRoZSAnJCcgb3IgJy4nIGNoYXJhY3RlcnNcIik7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbi8vIFJldHVybnMgdGhlIGxpc3Qgb2Ygam9pbiB0YWJsZXMgb24gYSBzY2hlbWFcbmNvbnN0IGpvaW5UYWJsZXNGb3JTY2hlbWEgPSAoc2NoZW1hKSA9PiB7XG4gIGNvbnN0IGxpc3QgPSBbXTtcbiAgaWYgKHNjaGVtYSkge1xuICAgIE9iamVjdC5rZXlzKHNjaGVtYS5maWVsZHMpLmZvckVhY2goKGZpZWxkKSA9PiB7XG4gICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgICBsaXN0LnB1c2goYF9Kb2luOiR7ZmllbGR9OiR7c2NoZW1hLmNsYXNzTmFtZX1gKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuICByZXR1cm4gbGlzdDtcbn1cblxuaW50ZXJmYWNlIFdoZXJlQ2xhdXNlIHtcbiAgcGF0dGVybjogc3RyaW5nO1xuICB2YWx1ZXM6IEFycmF5PGFueT47XG4gIHNvcnRzOiBBcnJheTxhbnk+O1xufVxuXG5jb25zdCBidWlsZFdoZXJlQ2xhdXNlID0gKHsgc2NoZW1hLCBxdWVyeSwgaW5kZXggfSk6IFdoZXJlQ2xhdXNlID0+IHtcbiAgY29uc3QgcGF0dGVybnMgPSBbXTtcbiAgbGV0IHZhbHVlcyA9IFtdO1xuICBjb25zdCBzb3J0cyA9IFtdO1xuXG4gIHNjaGVtYSA9IHRvUG9zdGdyZXNTY2hlbWEoc2NoZW1hKTtcbiAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gcXVlcnkpIHtcbiAgICBjb25zdCBpc0FycmF5RmllbGQgPSBzY2hlbWEuZmllbGRzXG4gICAgICAgICAgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdXG4gICAgICAgICAgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdBcnJheSc7XG4gICAgY29uc3QgaW5pdGlhbFBhdHRlcm5zTGVuZ3RoID0gcGF0dGVybnMubGVuZ3RoO1xuICAgIGNvbnN0IGZpZWxkVmFsdWUgPSBxdWVyeVtmaWVsZE5hbWVdO1xuXG4gICAgLy8gbm90aGluZ2luIHRoZSBzY2hlbWEsIGl0J3MgZ29ubmEgYmxvdyB1cFxuICAgIGlmICghc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdKSB7XG4gICAgICAvLyBhcyBpdCB3b24ndCBleGlzdFxuICAgICAgaWYgKGZpZWxkVmFsdWUgJiYgZmllbGRWYWx1ZS4kZXhpc3RzID09PSBmYWxzZSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmllbGROYW1lLmluZGV4T2YoJy4nKSA+PSAwKSB7XG4gICAgICBsZXQgbmFtZSA9IHRyYW5zZm9ybURvdEZpZWxkKGZpZWxkTmFtZSk7XG4gICAgICBpZiAoZmllbGRWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAke25hbWV9IElTIE5VTExgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChmaWVsZFZhbHVlLiRpbikge1xuICAgICAgICAgIGNvbnN0IGluUGF0dGVybnMgPSBbXTtcbiAgICAgICAgICBuYW1lID0gdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMoZmllbGROYW1lKS5qb2luKCctPicpO1xuICAgICAgICAgIGZpZWxkVmFsdWUuJGluLmZvckVhY2goKGxpc3RFbGVtKSA9PiB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGxpc3RFbGVtID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICBpblBhdHRlcm5zLnB1c2goYFwiJHtsaXN0RWxlbX1cImApO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgaW5QYXR0ZXJucy5wdXNoKGAke2xpc3RFbGVtfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCgke25hbWV9KTo6anNvbmIgQD4gJ1ske2luUGF0dGVybnMuam9pbigpfV0nOjpqc29uYmApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuJHJlZ2V4KSB7XG4gICAgICAgICAgLy8gSGFuZGxlIGxhdGVyXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcGF0dGVybnMucHVzaChgJHtuYW1lfSA9ICcke2ZpZWxkVmFsdWV9J2ApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlID09PSBudWxsIHx8IGZpZWxkVmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgSVMgTlVMTGApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgIGluZGV4ICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlID09PSAnYm9vbGVhbicpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgLy8gQ2FuJ3QgY2FzdCBib29sZWFuIHRvIGRvdWJsZSBwcmVjaXNpb25cbiAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdOdW1iZXInKSB7XG4gICAgICAgIC8vIFNob3VsZCBhbHdheXMgcmV0dXJuIHplcm8gcmVzdWx0c1xuICAgICAgICBjb25zdCBNQVhfSU5UX1BMVVNfT05FID0gOTIyMzM3MjAzNjg1NDc3NTgwODtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBNQVhfSU5UX1BMVVNfT05FKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICB9XG4gICAgICBpbmRleCArPSAyO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpZWxkVmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH0gZWxzZSBpZiAoWyckb3InLCAnJG5vcicsICckYW5kJ10uaW5jbHVkZXMoZmllbGROYW1lKSkge1xuICAgICAgY29uc3QgY2xhdXNlcyA9IFtdO1xuICAgICAgY29uc3QgY2xhdXNlVmFsdWVzID0gW107XG4gICAgICBmaWVsZFZhbHVlLmZvckVhY2goKHN1YlF1ZXJ5KSA9PiAge1xuICAgICAgICBjb25zdCBjbGF1c2UgPSBidWlsZFdoZXJlQ2xhdXNlKHsgc2NoZW1hLCBxdWVyeTogc3ViUXVlcnksIGluZGV4IH0pO1xuICAgICAgICBpZiAoY2xhdXNlLnBhdHRlcm4ubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNsYXVzZXMucHVzaChjbGF1c2UucGF0dGVybik7XG4gICAgICAgICAgY2xhdXNlVmFsdWVzLnB1c2goLi4uY2xhdXNlLnZhbHVlcyk7XG4gICAgICAgICAgaW5kZXggKz0gY2xhdXNlLnZhbHVlcy5sZW5ndGg7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBvck9yQW5kID0gZmllbGROYW1lID09PSAnJGFuZCcgPyAnIEFORCAnIDogJyBPUiAnO1xuICAgICAgY29uc3Qgbm90ID0gZmllbGROYW1lID09PSAnJG5vcicgPyAnIE5PVCAnIDogJyc7XG5cbiAgICAgIHBhdHRlcm5zLnB1c2goYCR7bm90fSgke2NsYXVzZXMuam9pbihvck9yQW5kKX0pYCk7XG4gICAgICB2YWx1ZXMucHVzaCguLi5jbGF1c2VWYWx1ZXMpO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiRuZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoaXNBcnJheUZpZWxkKSB7XG4gICAgICAgIGZpZWxkVmFsdWUuJG5lID0gSlNPTi5zdHJpbmdpZnkoW2ZpZWxkVmFsdWUuJG5lXSk7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYE5PVCBhcnJheV9jb250YWlucygkJHtpbmRleH06bmFtZSwgJCR7aW5kZXggKyAxfSlgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChmaWVsZFZhbHVlLiRuZSA9PT0gbnVsbCkge1xuICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lIElTIE5PVCBOVUxMYCk7XG4gICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIGlmIG5vdCBudWxsLCB3ZSBuZWVkIHRvIG1hbnVhbGx5IGV4Y2x1ZGUgbnVsbFxuICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCgkJHtpbmRleH06bmFtZSA8PiAkJHtpbmRleCArIDF9IE9SICQke2luZGV4fTpuYW1lIElTIE5VTEwpYCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gVE9ETzogc3VwcG9ydCBhcnJheXNcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS4kbmUpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG4gICAgaWYgKGZpZWxkVmFsdWUuJGVxICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChmaWVsZFZhbHVlLiRlcSA9PT0gbnVsbCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSBJUyBOVUxMYCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgIGluZGV4ICs9IDE7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLiRlcSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGlzSW5Pck5pbiA9IEFycmF5LmlzQXJyYXkoZmllbGRWYWx1ZS4kaW4pIHx8IEFycmF5LmlzQXJyYXkoZmllbGRWYWx1ZS4kbmluKTtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShmaWVsZFZhbHVlLiRpbikgJiZcbiAgICAgICAgaXNBcnJheUZpZWxkICYmXG4gICAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS5jb250ZW50cyAmJlxuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0uY29udGVudHMudHlwZSA9PT0gJ1N0cmluZycpIHtcbiAgICAgIGNvbnN0IGluUGF0dGVybnMgPSBbXTtcbiAgICAgIGxldCBhbGxvd051bGwgPSBmYWxzZTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICBmaWVsZFZhbHVlLiRpbi5mb3JFYWNoKChsaXN0RWxlbSwgbGlzdEluZGV4KSA9PiB7XG4gICAgICAgIGlmIChsaXN0RWxlbSA9PT0gbnVsbCkge1xuICAgICAgICAgIGFsbG93TnVsbCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFsdWVzLnB1c2gobGlzdEVsZW0pO1xuICAgICAgICAgIGluUGF0dGVybnMucHVzaChgJCR7aW5kZXggKyAxICsgbGlzdEluZGV4IC0gKGFsbG93TnVsbCA/IDEgOiAwKX1gKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBpZiAoYWxsb3dOdWxsKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCgkJHtpbmRleH06bmFtZSBJUyBOVUxMIE9SICQke2luZGV4fTpuYW1lICYmIEFSUkFZWyR7aW5QYXR0ZXJucy5qb2luKCl9XSlgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lICYmIEFSUkFZWyR7aW5QYXR0ZXJucy5qb2luKCl9XWApO1xuICAgICAgfVxuICAgICAgaW5kZXggPSBpbmRleCArIDEgKyBpblBhdHRlcm5zLmxlbmd0aDtcbiAgICB9IGVsc2UgaWYgKGlzSW5Pck5pbikge1xuICAgICAgdmFyIGNyZWF0ZUNvbnN0cmFpbnQgPSAoYmFzZUFycmF5LCBub3RJbikgPT4ge1xuICAgICAgICBpZiAoYmFzZUFycmF5Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCBub3QgPSBub3RJbiA/ICcgTk9UICcgOiAnJztcbiAgICAgICAgICBpZiAoaXNBcnJheUZpZWxkKSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAke25vdH0gYXJyYXlfY29udGFpbnMoJCR7aW5kZXh9Om5hbWUsICQke2luZGV4ICsgMX0pYCk7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGJhc2VBcnJheSkpO1xuICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gSGFuZGxlIE5lc3RlZCBEb3QgTm90YXRpb24gQWJvdmVcbiAgICAgICAgICAgIGlmIChmaWVsZE5hbWUuaW5kZXhPZignLicpID49IDApIHtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgaW5QYXR0ZXJucyA9IFtdO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICAgIGJhc2VBcnJheS5mb3JFYWNoKChsaXN0RWxlbSwgbGlzdEluZGV4KSA9PiB7XG4gICAgICAgICAgICAgIGlmIChsaXN0RWxlbSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHZhbHVlcy5wdXNoKGxpc3RFbGVtKTtcbiAgICAgICAgICAgICAgICBpblBhdHRlcm5zLnB1c2goYCQke2luZGV4ICsgMSArIGxpc3RJbmRleH1gKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSAke25vdH0gSU4gKCR7aW5QYXR0ZXJucy5qb2luKCl9KWApO1xuICAgICAgICAgICAgaW5kZXggPSBpbmRleCArIDEgKyBpblBhdHRlcm5zLmxlbmd0aDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoIW5vdEluKSB7XG4gICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSBJUyBOVUxMYCk7XG4gICAgICAgICAgaW5kZXggPSBpbmRleCArIDE7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChmaWVsZFZhbHVlLiRpbikge1xuICAgICAgICBjcmVhdGVDb25zdHJhaW50KF8uZmxhdE1hcChmaWVsZFZhbHVlLiRpbiwgZWx0ID0+IGVsdCksIGZhbHNlKTtcbiAgICAgIH1cbiAgICAgIGlmIChmaWVsZFZhbHVlLiRuaW4pIHtcbiAgICAgICAgY3JlYXRlQ29uc3RyYWludChfLmZsYXRNYXAoZmllbGRWYWx1ZS4kbmluLCBlbHQgPT4gZWx0KSwgdHJ1ZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmKHR5cGVvZiBmaWVsZFZhbHVlLiRpbiAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdiYWQgJGluIHZhbHVlJyk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZS4kbmluICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2JhZCAkbmluIHZhbHVlJyk7XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZmllbGRWYWx1ZS4kYWxsKSAmJiBpc0FycmF5RmllbGQpIHtcbiAgICAgIGlmIChpc0FueVZhbHVlUmVnZXhTdGFydHNXaXRoKGZpZWxkVmFsdWUuJGFsbCkpIHtcbiAgICAgICAgaWYgKCFpc0FsbFZhbHVlc1JlZ2V4T3JOb25lKGZpZWxkVmFsdWUuJGFsbCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnQWxsICRhbGwgdmFsdWVzIG11c3QgYmUgb2YgcmVnZXggdHlwZSBvciBub25lOiAnXG4gICAgICAgICAgICArIGZpZWxkVmFsdWUuJGFsbCk7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGZpZWxkVmFsdWUuJGFsbC5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gcHJvY2Vzc1JlZ2V4UGF0dGVybihmaWVsZFZhbHVlLiRhbGxbaV0uJHJlZ2V4KTtcbiAgICAgICAgICBmaWVsZFZhbHVlLiRhbGxbaV0gPSB2YWx1ZS5zdWJzdHJpbmcoMSkgKyAnJSc7XG4gICAgICAgIH1cbiAgICAgICAgcGF0dGVybnMucHVzaChgYXJyYXlfY29udGFpbnNfYWxsX3JlZ2V4KCQke2luZGV4fTpuYW1lLCAkJHtpbmRleCArIDF9Ojpqc29uYilgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYGFycmF5X2NvbnRhaW5zX2FsbCgkJHtpbmRleH06bmFtZSwgJCR7aW5kZXggKyAxfTo6anNvbmIpYCk7XG4gICAgICB9XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUuJGFsbCkpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGZpZWxkVmFsdWUuJGV4aXN0cyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGlmIChmaWVsZFZhbHVlLiRleGlzdHMpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgSVMgTk9UIE5VTExgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lIElTIE5VTExgKTtcbiAgICAgIH1cbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICBpbmRleCArPSAxO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiRjb250YWluZWRCeSkge1xuICAgICAgY29uc3QgYXJyID0gZmllbGRWYWx1ZS4kY29udGFpbmVkQnk7XG4gICAgICBpZiAoIShhcnIgaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgYmFkICRjb250YWluZWRCeTogc2hvdWxkIGJlIGFuIGFycmF5YFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA8QCAkJHtpbmRleCArIDF9Ojpqc29uYmApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShhcnIpKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuJHRleHQpIHtcbiAgICAgIGNvbnN0IHNlYXJjaCA9IGZpZWxkVmFsdWUuJHRleHQuJHNlYXJjaDtcbiAgICAgIGxldCBsYW5ndWFnZSA9ICdlbmdsaXNoJztcbiAgICAgIGlmICh0eXBlb2Ygc2VhcmNoICE9PSAnb2JqZWN0Jykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRzZWFyY2gsIHNob3VsZCBiZSBvYmplY3RgXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoIXNlYXJjaC4kdGVybSB8fCB0eXBlb2Ygc2VhcmNoLiR0ZXJtICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICR0ZXJtLCBzaG91bGQgYmUgc3RyaW5nYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKHNlYXJjaC4kbGFuZ3VhZ2UgJiYgdHlwZW9mIHNlYXJjaC4kbGFuZ3VhZ2UgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGxhbmd1YWdlLCBzaG91bGQgYmUgc3RyaW5nYFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChzZWFyY2guJGxhbmd1YWdlKSB7XG4gICAgICAgIGxhbmd1YWdlID0gc2VhcmNoLiRsYW5ndWFnZTtcbiAgICAgIH1cbiAgICAgIGlmIChzZWFyY2guJGNhc2VTZW5zaXRpdmUgJiYgdHlwZW9mIHNlYXJjaC4kY2FzZVNlbnNpdGl2ZSAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGNhc2VTZW5zaXRpdmUsIHNob3VsZCBiZSBib29sZWFuYFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChzZWFyY2guJGNhc2VTZW5zaXRpdmUpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgYmFkICR0ZXh0OiAkY2FzZVNlbnNpdGl2ZSBub3Qgc3VwcG9ydGVkLCBwbGVhc2UgdXNlICRyZWdleCBvciBjcmVhdGUgYSBzZXBhcmF0ZSBsb3dlciBjYXNlIGNvbHVtbi5gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoc2VhcmNoLiRkaWFjcml0aWNTZW5zaXRpdmUgJiYgdHlwZW9mIHNlYXJjaC4kZGlhY3JpdGljU2Vuc2l0aXZlICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgYmFkICR0ZXh0OiAkZGlhY3JpdGljU2Vuc2l0aXZlLCBzaG91bGQgYmUgYm9vbGVhbmBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VhcmNoLiRkaWFjcml0aWNTZW5zaXRpdmUgPT09IGZhbHNlKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGRpYWNyaXRpY1NlbnNpdGl2ZSAtIGZhbHNlIG5vdCBzdXBwb3J0ZWQsIGluc3RhbGwgUG9zdGdyZXMgVW5hY2NlbnQgRXh0ZW5zaW9uYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcGF0dGVybnMucHVzaChgdG9fdHN2ZWN0b3IoJCR7aW5kZXh9LCAkJHtpbmRleCArIDF9Om5hbWUpIEBAIHRvX3RzcXVlcnkoJCR7aW5kZXggKyAyfSwgJCR7aW5kZXggKyAzfSlgKTtcbiAgICAgIHZhbHVlcy5wdXNoKGxhbmd1YWdlLCBmaWVsZE5hbWUsIGxhbmd1YWdlLCBzZWFyY2guJHRlcm0pO1xuICAgICAgaW5kZXggKz0gNDtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kbmVhclNwaGVyZSkge1xuICAgICAgY29uc3QgcG9pbnQgPSBmaWVsZFZhbHVlLiRuZWFyU3BoZXJlO1xuICAgICAgY29uc3QgZGlzdGFuY2UgPSBmaWVsZFZhbHVlLiRtYXhEaXN0YW5jZTtcbiAgICAgIGNvbnN0IGRpc3RhbmNlSW5LTSA9IGRpc3RhbmNlICogNjM3MSAqIDEwMDA7XG4gICAgICBwYXR0ZXJucy5wdXNoKGBTVF9kaXN0YW5jZV9zcGhlcmUoJCR7aW5kZXh9Om5hbWU6Omdlb21ldHJ5LCBQT0lOVCgkJHtpbmRleCArIDF9LCAkJHtpbmRleCArIDJ9KTo6Z2VvbWV0cnkpIDw9ICQke2luZGV4ICsgM31gKTtcbiAgICAgIHNvcnRzLnB1c2goYFNUX2Rpc3RhbmNlX3NwaGVyZSgkJHtpbmRleH06bmFtZTo6Z2VvbWV0cnksIFBPSU5UKCQke2luZGV4ICsgMX0sICQke2luZGV4ICsgMn0pOjpnZW9tZXRyeSkgQVNDYClcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgcG9pbnQubG9uZ2l0dWRlLCBwb2ludC5sYXRpdHVkZSwgZGlzdGFuY2VJbktNKTtcbiAgICAgIGluZGV4ICs9IDQ7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuJHdpdGhpbiAmJiBmaWVsZFZhbHVlLiR3aXRoaW4uJGJveCkge1xuICAgICAgY29uc3QgYm94ID0gZmllbGRWYWx1ZS4kd2l0aGluLiRib3g7XG4gICAgICBjb25zdCBsZWZ0ID0gYm94WzBdLmxvbmdpdHVkZTtcbiAgICAgIGNvbnN0IGJvdHRvbSA9IGJveFswXS5sYXRpdHVkZTtcbiAgICAgIGNvbnN0IHJpZ2h0ID0gYm94WzFdLmxvbmdpdHVkZTtcbiAgICAgIGNvbnN0IHRvcCA9IGJveFsxXS5sYXRpdHVkZTtcblxuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWU6OnBvaW50IDxAICQke2luZGV4ICsgMX06OmJveGApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBgKCgke2xlZnR9LCAke2JvdHRvbX0pLCAoJHtyaWdodH0sICR7dG9wfSkpYCk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiRnZW9XaXRoaW4gJiYgZmllbGRWYWx1ZS4kZ2VvV2l0aGluLiRjZW50ZXJTcGhlcmUpIHtcbiAgICAgIGNvbnN0IGNlbnRlclNwaGVyZSA9IGZpZWxkVmFsdWUuJGdlb1dpdGhpbi4kY2VudGVyU3BoZXJlO1xuICAgICAgaWYgKCEoY2VudGVyU3BoZXJlIGluc3RhbmNlb2YgQXJyYXkpIHx8IGNlbnRlclNwaGVyZS5sZW5ndGggPCAyKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJGNlbnRlclNwaGVyZSBzaG91bGQgYmUgYW4gYXJyYXkgb2YgUGFyc2UuR2VvUG9pbnQgYW5kIGRpc3RhbmNlJyk7XG4gICAgICB9XG4gICAgICAvLyBHZXQgcG9pbnQsIGNvbnZlcnQgdG8gZ2VvIHBvaW50IGlmIG5lY2Vzc2FyeSBhbmQgdmFsaWRhdGVcbiAgICAgIGxldCBwb2ludCA9IGNlbnRlclNwaGVyZVswXTtcbiAgICAgIGlmIChwb2ludCBpbnN0YW5jZW9mIEFycmF5ICYmIHBvaW50Lmxlbmd0aCA9PT0gMikge1xuICAgICAgICBwb2ludCA9IG5ldyBQYXJzZS5HZW9Qb2ludChwb2ludFsxXSwgcG9pbnRbMF0pO1xuICAgICAgfSBlbHNlIGlmICghR2VvUG9pbnRDb2Rlci5pc1ZhbGlkSlNPTihwb2ludCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkY2VudGVyU3BoZXJlIGdlbyBwb2ludCBpbnZhbGlkJyk7XG4gICAgICB9XG4gICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICAvLyBHZXQgZGlzdGFuY2UgYW5kIHZhbGlkYXRlXG4gICAgICBjb25zdCBkaXN0YW5jZSA9IGNlbnRlclNwaGVyZVsxXTtcbiAgICAgIGlmKGlzTmFOKGRpc3RhbmNlKSB8fCBkaXN0YW5jZSA8IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkY2VudGVyU3BoZXJlIGRpc3RhbmNlIGludmFsaWQnKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGRpc3RhbmNlSW5LTSA9IGRpc3RhbmNlICogNjM3MSAqIDEwMDA7XG4gICAgICBwYXR0ZXJucy5wdXNoKGBTVF9kaXN0YW5jZV9zcGhlcmUoJCR7aW5kZXh9Om5hbWU6Omdlb21ldHJ5LCBQT0lOVCgkJHtpbmRleCArIDF9LCAkJHtpbmRleCArIDJ9KTo6Z2VvbWV0cnkpIDw9ICQke2luZGV4ICsgM31gKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgcG9pbnQubG9uZ2l0dWRlLCBwb2ludC5sYXRpdHVkZSwgZGlzdGFuY2VJbktNKTtcbiAgICAgIGluZGV4ICs9IDQ7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuJGdlb1dpdGhpbiAmJiBmaWVsZFZhbHVlLiRnZW9XaXRoaW4uJHBvbHlnb24pIHtcbiAgICAgIGNvbnN0IHBvbHlnb24gPSBmaWVsZFZhbHVlLiRnZW9XaXRoaW4uJHBvbHlnb247XG4gICAgICBsZXQgcG9pbnRzO1xuICAgICAgaWYgKHR5cGVvZiBwb2x5Z29uID09PSAnb2JqZWN0JyAmJiBwb2x5Z29uLl9fdHlwZSA9PT0gJ1BvbHlnb24nKSB7XG4gICAgICAgIGlmICghcG9seWdvbi5jb29yZGluYXRlcyB8fCBwb2x5Z29uLmNvb3JkaW5hdGVzLmxlbmd0aCA8IDMpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWU7IFBvbHlnb24uY29vcmRpbmF0ZXMgc2hvdWxkIGNvbnRhaW4gYXQgbGVhc3QgMyBsb24vbGF0IHBhaXJzJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcG9pbnRzID0gcG9seWdvbi5jb29yZGluYXRlcztcbiAgICAgIH0gZWxzZSBpZiAoKHBvbHlnb24gaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgICAgaWYgKHBvbHlnb24ubGVuZ3RoIDwgMykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJHBvbHlnb24gc2hvdWxkIGNvbnRhaW4gYXQgbGVhc3QgMyBHZW9Qb2ludHMnXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBwb2ludHMgPSBwb2x5Z29uO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRwb2x5Z29uIHNob3VsZCBiZSBQb2x5Z29uIG9iamVjdCBvciBBcnJheSBvZiBQYXJzZS5HZW9Qb2ludFxcJ3MnXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBwb2ludHMgPSBwb2ludHMubWFwKChwb2ludCkgPT4ge1xuICAgICAgICBpZiAocG9pbnQgaW5zdGFuY2VvZiBBcnJheSAmJiBwb2ludC5sZW5ndGggPT09IDIpIHtcbiAgICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnRbMV0sIHBvaW50WzBdKTtcbiAgICAgICAgICByZXR1cm4gYCgke3BvaW50WzBdfSwgJHtwb2ludFsxXX0pYDtcbiAgICAgICAgfVxuICAgICAgICBpZiAodHlwZW9mIHBvaW50ICE9PSAnb2JqZWN0JyB8fCBwb2ludC5fX3R5cGUgIT09ICdHZW9Qb2ludCcpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICRnZW9XaXRoaW4gdmFsdWUnKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGAoJHtwb2ludC5sb25naXR1ZGV9LCAke3BvaW50LmxhdGl0dWRlfSlgO1xuICAgICAgfSkuam9pbignLCAnKTtcblxuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWU6OnBvaW50IDxAICQke2luZGV4ICsgMX06OnBvbHlnb25gKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgYCgke3BvaW50c30pYCk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cbiAgICBpZiAoZmllbGRWYWx1ZS4kZ2VvSW50ZXJzZWN0cyAmJiBmaWVsZFZhbHVlLiRnZW9JbnRlcnNlY3RzLiRwb2ludCkge1xuICAgICAgY29uc3QgcG9pbnQgPSBmaWVsZFZhbHVlLiRnZW9JbnRlcnNlY3RzLiRwb2ludDtcbiAgICAgIGlmICh0eXBlb2YgcG9pbnQgIT09ICdvYmplY3QnIHx8IHBvaW50Ll9fdHlwZSAhPT0gJ0dlb1BvaW50Jykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICdiYWQgJGdlb0ludGVyc2VjdCB2YWx1ZTsgJHBvaW50IHNob3VsZCBiZSBHZW9Qb2ludCdcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwb2ludC5sYXRpdHVkZSwgcG9pbnQubG9uZ2l0dWRlKTtcbiAgICAgIH1cbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lOjpwb2x5Z29uIEA+ICQke2luZGV4ICsgMX06OnBvaW50YCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGAoJHtwb2ludC5sb25naXR1ZGV9LCAke3BvaW50LmxhdGl0dWRlfSlgKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuJHJlZ2V4KSB7XG4gICAgICBsZXQgcmVnZXggPSBmaWVsZFZhbHVlLiRyZWdleDtcbiAgICAgIGxldCBvcGVyYXRvciA9ICd+JztcbiAgICAgIGNvbnN0IG9wdHMgPSBmaWVsZFZhbHVlLiRvcHRpb25zO1xuICAgICAgaWYgKG9wdHMpIHtcbiAgICAgICAgaWYgKG9wdHMuaW5kZXhPZignaScpID49IDApIHtcbiAgICAgICAgICBvcGVyYXRvciA9ICd+Kic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG9wdHMuaW5kZXhPZigneCcpID49IDApIHtcbiAgICAgICAgICByZWdleCA9IHJlbW92ZVdoaXRlU3BhY2UocmVnZXgpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5hbWUgPSB0cmFuc2Zvcm1Eb3RGaWVsZChmaWVsZE5hbWUpO1xuICAgICAgcmVnZXggPSBwcm9jZXNzUmVnZXhQYXR0ZXJuKHJlZ2V4KTtcblxuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9OnJhdyAke29wZXJhdG9yfSAnJCR7aW5kZXggKyAxfTpyYXcnYCk7XG4gICAgICB2YWx1ZXMucHVzaChuYW1lLCByZWdleCk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICBpZiAoaXNBcnJheUZpZWxkKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYGFycmF5X2NvbnRhaW5zKCQke2luZGV4fTpuYW1lLCAkJHtpbmRleCArIDF9KWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KFtmaWVsZFZhbHVlXSkpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS5vYmplY3RJZCk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnRGF0ZScpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLmlzbyk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ0dlb1BvaW50Jykge1xuICAgICAgcGF0dGVybnMucHVzaCgnJCcgKyBpbmRleCArICc6bmFtZSB+PSBQT0lOVCgkJyArIChpbmRleCArIDEpICsgJywgJCcgKyAoaW5kZXggKyAyKSArICcpJyk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUubG9uZ2l0dWRlLCBmaWVsZFZhbHVlLmxhdGl0dWRlKTtcbiAgICAgIGluZGV4ICs9IDM7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gY29udmVydFBvbHlnb25Ub1NRTChmaWVsZFZhbHVlLmNvb3JkaW5hdGVzKTtcbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lIH49ICQke2luZGV4ICsgMX06OnBvbHlnb25gKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgdmFsdWUpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG5cbiAgICBPYmplY3Qua2V5cyhQYXJzZVRvUG9zZ3Jlc0NvbXBhcmF0b3IpLmZvckVhY2goY21wID0+IHtcbiAgICAgIGlmIChmaWVsZFZhbHVlW2NtcF0gfHwgZmllbGRWYWx1ZVtjbXBdID09PSAwKSB7XG4gICAgICAgIGNvbnN0IHBnQ29tcGFyYXRvciA9IFBhcnNlVG9Qb3NncmVzQ29tcGFyYXRvcltjbXBdO1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSAke3BnQ29tcGFyYXRvcn0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHRvUG9zdGdyZXNWYWx1ZShmaWVsZFZhbHVlW2NtcF0pKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmIChpbml0aWFsUGF0dGVybnNMZW5ndGggPT09IHBhdHRlcm5zLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sIGBQb3N0Z3JlcyBkb2Vzbid0IHN1cHBvcnQgdGhpcyBxdWVyeSB0eXBlIHlldCAke0pTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUpfWApO1xuICAgIH1cbiAgfVxuICB2YWx1ZXMgPSB2YWx1ZXMubWFwKHRyYW5zZm9ybVZhbHVlKTtcbiAgcmV0dXJuIHsgcGF0dGVybjogcGF0dGVybnMuam9pbignIEFORCAnKSwgdmFsdWVzLCBzb3J0cyB9O1xufVxuXG5leHBvcnQgY2xhc3MgUG9zdGdyZXNTdG9yYWdlQWRhcHRlciBpbXBsZW1lbnRzIFN0b3JhZ2VBZGFwdGVyIHtcblxuICBjYW5Tb3J0T25Kb2luVGFibGVzOiBib29sZWFuO1xuXG4gIC8vIFByaXZhdGVcbiAgX2NvbGxlY3Rpb25QcmVmaXg6IHN0cmluZztcbiAgX2NsaWVudDogYW55O1xuICBfcGdwOiBhbnk7XG5cbiAgY29uc3RydWN0b3Ioe1xuICAgIHVyaSxcbiAgICBjb2xsZWN0aW9uUHJlZml4ID0gJycsXG4gICAgZGF0YWJhc2VPcHRpb25zXG4gIH06IGFueSkge1xuICAgIHRoaXMuX2NvbGxlY3Rpb25QcmVmaXggPSBjb2xsZWN0aW9uUHJlZml4O1xuICAgIGNvbnN0IHsgY2xpZW50LCBwZ3AgfSA9IGNyZWF0ZUNsaWVudCh1cmksIGRhdGFiYXNlT3B0aW9ucyk7XG4gICAgdGhpcy5fY2xpZW50ID0gY2xpZW50O1xuICAgIHRoaXMuX3BncCA9IHBncDtcbiAgICB0aGlzLmNhblNvcnRPbkpvaW5UYWJsZXMgPSBmYWxzZTtcbiAgfVxuXG4gIGhhbmRsZVNodXRkb3duKCkge1xuICAgIGlmICghdGhpcy5fY2xpZW50KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuX2NsaWVudC4kcG9vbC5lbmQoKTtcbiAgfVxuXG4gIF9lbnN1cmVTY2hlbWFDb2xsZWN0aW9uRXhpc3RzKGNvbm46IGFueSkge1xuICAgIGNvbm4gPSBjb25uIHx8IHRoaXMuX2NsaWVudDtcbiAgICByZXR1cm4gY29ubi5ub25lKCdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyBcIl9TQ0hFTUFcIiAoIFwiY2xhc3NOYW1lXCIgdmFyQ2hhcigxMjApLCBcInNjaGVtYVwiIGpzb25iLCBcImlzUGFyc2VDbGFzc1wiIGJvb2wsIFBSSU1BUlkgS0VZIChcImNsYXNzTmFtZVwiKSApJylcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3JcbiAgICAgICAgICB8fCBlcnJvci5jb2RlID09PSBQb3N0Z3Jlc1VuaXF1ZUluZGV4VmlvbGF0aW9uRXJyb3JcbiAgICAgICAgICB8fCBlcnJvci5jb2RlID09PSBQb3N0Z3Jlc0R1cGxpY2F0ZU9iamVjdEVycm9yKSB7XG4gICAgICAgIC8vIFRhYmxlIGFscmVhZHkgZXhpc3RzLCBtdXN0IGhhdmUgYmVlbiBjcmVhdGVkIGJ5IGEgZGlmZmVyZW50IHJlcXVlc3QuIElnbm9yZSBlcnJvci5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICBjbGFzc0V4aXN0cyhuYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50Lm9uZSgnU0VMRUNUIEVYSVNUUyAoU0VMRUNUIDEgRlJPTSBpbmZvcm1hdGlvbl9zY2hlbWEudGFibGVzIFdIRVJFIHRhYmxlX25hbWUgPSAkMSknLCBbbmFtZV0sIGEgPT4gYS5leGlzdHMpO1xuICB9XG5cbiAgc2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZTogc3RyaW5nLCBDTFBzOiBhbnkpIHtcbiAgICBjb25zdCBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50LnRhc2soJ3NldC1jbGFzcy1sZXZlbC1wZXJtaXNzaW9ucycsIGZ1bmN0aW9uICogKHQpIHtcbiAgICAgIHlpZWxkIHNlbGYuX2Vuc3VyZVNjaGVtYUNvbGxlY3Rpb25FeGlzdHModCk7XG4gICAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lLCAnc2NoZW1hJywgJ2NsYXNzTGV2ZWxQZXJtaXNzaW9ucycsIEpTT04uc3RyaW5naWZ5KENMUHMpXTtcbiAgICAgIHlpZWxkIHQubm9uZShgVVBEQVRFIFwiX1NDSEVNQVwiIFNFVCAkMjpuYW1lID0ganNvbl9vYmplY3Rfc2V0X2tleSgkMjpuYW1lLCAkMzo6dGV4dCwgJDQ6Ompzb25iKSBXSEVSRSBcImNsYXNzTmFtZVwiPSQxYCwgdmFsdWVzKTtcbiAgICB9KTtcbiAgfVxuXG4gIHNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KGNsYXNzTmFtZTogc3RyaW5nLCBzdWJtaXR0ZWRJbmRleGVzOiBhbnksIGV4aXN0aW5nSW5kZXhlczogYW55ID0ge30sIGZpZWxkczogYW55LCBjb25uOiA/YW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29ubiA9IGNvbm4gfHwgdGhpcy5fY2xpZW50O1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIGlmIChzdWJtaXR0ZWRJbmRleGVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKGV4aXN0aW5nSW5kZXhlcykubGVuZ3RoID09PSAwKSB7XG4gICAgICBleGlzdGluZ0luZGV4ZXMgPSB7IF9pZF86IHsgX2lkOiAxfSB9O1xuICAgIH1cbiAgICBjb25zdCBkZWxldGVkSW5kZXhlcyA9IFtdO1xuICAgIGNvbnN0IGluc2VydGVkSW5kZXhlcyA9IFtdO1xuICAgIE9iamVjdC5rZXlzKHN1Ym1pdHRlZEluZGV4ZXMpLmZvckVhY2gobmFtZSA9PiB7XG4gICAgICBjb25zdCBmaWVsZCA9IHN1Ym1pdHRlZEluZGV4ZXNbbmFtZV07XG4gICAgICBpZiAoZXhpc3RpbmdJbmRleGVzW25hbWVdICYmIGZpZWxkLl9fb3AgIT09ICdEZWxldGUnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCBgSW5kZXggJHtuYW1lfSBleGlzdHMsIGNhbm5vdCB1cGRhdGUuYCk7XG4gICAgICB9XG4gICAgICBpZiAoIWV4aXN0aW5nSW5kZXhlc1tuYW1lXSAmJiBmaWVsZC5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgYEluZGV4ICR7bmFtZX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBkZWxldGUuYCk7XG4gICAgICB9XG4gICAgICBpZiAoZmllbGQuX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgZGVsZXRlZEluZGV4ZXMucHVzaChuYW1lKTtcbiAgICAgICAgZGVsZXRlIGV4aXN0aW5nSW5kZXhlc1tuYW1lXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIE9iamVjdC5rZXlzKGZpZWxkKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgaWYgKCFmaWVsZHMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksIGBGaWVsZCAke2tleX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBhZGQgaW5kZXguYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgZXhpc3RpbmdJbmRleGVzW25hbWVdID0gZmllbGQ7XG4gICAgICAgIGluc2VydGVkSW5kZXhlcy5wdXNoKHtcbiAgICAgICAgICBrZXk6IGZpZWxkLFxuICAgICAgICAgIG5hbWUsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBjb25uLnR4KCdzZXQtaW5kZXhlcy13aXRoLXNjaGVtYS1mb3JtYXQnLCBmdW5jdGlvbiAqICh0KSB7XG4gICAgICBpZiAoaW5zZXJ0ZWRJbmRleGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgeWllbGQgc2VsZi5jcmVhdGVJbmRleGVzKGNsYXNzTmFtZSwgaW5zZXJ0ZWRJbmRleGVzLCB0KTtcbiAgICAgIH1cbiAgICAgIGlmIChkZWxldGVkSW5kZXhlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHlpZWxkIHNlbGYuZHJvcEluZGV4ZXMoY2xhc3NOYW1lLCBkZWxldGVkSW5kZXhlcywgdCk7XG4gICAgICB9XG4gICAgICB5aWVsZCBzZWxmLl9lbnN1cmVTY2hlbWFDb2xsZWN0aW9uRXhpc3RzKHQpO1xuICAgICAgeWllbGQgdC5ub25lKCdVUERBVEUgXCJfU0NIRU1BXCIgU0VUICQyOm5hbWUgPSBqc29uX29iamVjdF9zZXRfa2V5KCQyOm5hbWUsICQzOjp0ZXh0LCAkNDo6anNvbmIpIFdIRVJFIFwiY2xhc3NOYW1lXCI9JDEnLCBbY2xhc3NOYW1lLCAnc2NoZW1hJywgJ2luZGV4ZXMnLCBKU09OLnN0cmluZ2lmeShleGlzdGluZ0luZGV4ZXMpXSk7XG4gICAgfSk7XG4gIH1cblxuICBjcmVhdGVDbGFzcyhjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBjb25uOiA/YW55KSB7XG4gICAgY29ubiA9IGNvbm4gfHwgdGhpcy5fY2xpZW50O1xuICAgIHJldHVybiBjb25uLnR4KCdjcmVhdGUtY2xhc3MnLCB0ID0+IHtcbiAgICAgIGNvbnN0IHExID0gdGhpcy5jcmVhdGVUYWJsZShjbGFzc05hbWUsIHNjaGVtYSwgdCk7XG4gICAgICBjb25zdCBxMiA9IHQubm9uZSgnSU5TRVJUIElOVE8gXCJfU0NIRU1BXCIgKFwiY2xhc3NOYW1lXCIsIFwic2NoZW1hXCIsIFwiaXNQYXJzZUNsYXNzXCIpIFZBTFVFUyAoJDxjbGFzc05hbWU+LCAkPHNjaGVtYT4sIHRydWUpJywgeyBjbGFzc05hbWUsIHNjaGVtYSB9KTtcbiAgICAgIGNvbnN0IHEzID0gdGhpcy5zZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdChjbGFzc05hbWUsIHNjaGVtYS5pbmRleGVzLCB7fSwgc2NoZW1hLmZpZWxkcywgdCk7XG4gICAgICByZXR1cm4gdC5iYXRjaChbcTEsIHEyLCBxM10pO1xuICAgIH0pXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiB0b1BhcnNlU2NoZW1hKHNjaGVtYSk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB7XG4gICAgICAgIGlmIChlcnIuZGF0YVswXS5yZXN1bHQuY29kZSA9PT0gUG9zdGdyZXNUcmFuc2FjdGlvbkFib3J0ZWRFcnJvcikge1xuICAgICAgICAgIGVyciA9IGVyci5kYXRhWzFdLnJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXJyLmNvZGUgPT09IFBvc3RncmVzVW5pcXVlSW5kZXhWaW9sYXRpb25FcnJvciAmJiBlcnIuZGV0YWlsLmluY2x1ZGVzKGNsYXNzTmFtZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLCBgQ2xhc3MgJHtjbGFzc05hbWV9IGFscmVhZHkgZXhpc3RzLmApXG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfSlcbiAgfVxuXG4gIC8vIEp1c3QgY3JlYXRlIGEgdGFibGUsIGRvIG5vdCBpbnNlcnQgaW4gc2NoZW1hXG4gIGNyZWF0ZVRhYmxlKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIGNvbm46IGFueSkge1xuICAgIGNvbm4gPSBjb25uIHx8IHRoaXMuX2NsaWVudDtcbiAgICBjb25zdCBzZWxmID0gdGhpcztcbiAgICBkZWJ1ZygnY3JlYXRlVGFibGUnLCBjbGFzc05hbWUsIHNjaGVtYSk7XG4gICAgY29uc3QgdmFsdWVzQXJyYXkgPSBbXTtcbiAgICBjb25zdCBwYXR0ZXJuc0FycmF5ID0gW107XG4gICAgY29uc3QgZmllbGRzID0gT2JqZWN0LmFzc2lnbih7fSwgc2NoZW1hLmZpZWxkcyk7XG4gICAgaWYgKGNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgICAgZmllbGRzLl9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCA9IHt0eXBlOiAnRGF0ZSd9O1xuICAgICAgZmllbGRzLl9lbWFpbF92ZXJpZnlfdG9rZW4gPSB7dHlwZTogJ1N0cmluZyd9O1xuICAgICAgZmllbGRzLl9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCA9IHt0eXBlOiAnRGF0ZSd9O1xuICAgICAgZmllbGRzLl9mYWlsZWRfbG9naW5fY291bnQgPSB7dHlwZTogJ051bWJlcid9O1xuICAgICAgZmllbGRzLl9wZXJpc2hhYmxlX3Rva2VuID0ge3R5cGU6ICdTdHJpbmcnfTtcbiAgICAgIGZpZWxkcy5fcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0ID0ge3R5cGU6ICdEYXRlJ307XG4gICAgICBmaWVsZHMuX3Bhc3N3b3JkX2NoYW5nZWRfYXQgPSB7dHlwZTogJ0RhdGUnfTtcbiAgICAgIGZpZWxkcy5fcGFzc3dvcmRfaGlzdG9yeSA9IHsgdHlwZTogJ0FycmF5J307XG4gICAgfVxuICAgIGxldCBpbmRleCA9IDI7XG4gICAgY29uc3QgcmVsYXRpb25zID0gW107XG4gICAgT2JqZWN0LmtleXMoZmllbGRzKS5mb3JFYWNoKChmaWVsZE5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHBhcnNlVHlwZSA9IGZpZWxkc1tmaWVsZE5hbWVdO1xuICAgICAgLy8gU2tpcCB3aGVuIGl0J3MgYSByZWxhdGlvblxuICAgICAgLy8gV2UnbGwgY3JlYXRlIHRoZSB0YWJsZXMgbGF0ZXJcbiAgICAgIGlmIChwYXJzZVR5cGUudHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgICByZWxhdGlvbnMucHVzaChmaWVsZE5hbWUpXG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChbJ19ycGVybScsICdfd3Blcm0nXS5pbmRleE9mKGZpZWxkTmFtZSkgPj0gMCkge1xuICAgICAgICBwYXJzZVR5cGUuY29udGVudHMgPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gICAgICB9XG4gICAgICB2YWx1ZXNBcnJheS5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICB2YWx1ZXNBcnJheS5wdXNoKHBhcnNlVHlwZVRvUG9zdGdyZXNUeXBlKHBhcnNlVHlwZSkpO1xuICAgICAgcGF0dGVybnNBcnJheS5wdXNoKGAkJHtpbmRleH06bmFtZSAkJHtpbmRleCArIDF9OnJhd2ApO1xuICAgICAgaWYgKGZpZWxkTmFtZSA9PT0gJ29iamVjdElkJykge1xuICAgICAgICBwYXR0ZXJuc0FycmF5LnB1c2goYFBSSU1BUlkgS0VZICgkJHtpbmRleH06bmFtZSlgKVxuICAgICAgfVxuICAgICAgaW5kZXggPSBpbmRleCArIDI7XG4gICAgfSk7XG4gICAgY29uc3QgcXMgPSBgQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgJDE6bmFtZSAoJHtwYXR0ZXJuc0FycmF5LmpvaW4oKX0pYDtcbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lLCAuLi52YWx1ZXNBcnJheV07XG5cbiAgICByZXR1cm4gY29ubi50YXNrKCdjcmVhdGUtdGFibGUnLCBmdW5jdGlvbiAqICh0KSB7XG4gICAgICB0cnkge1xuICAgICAgICB5aWVsZCBzZWxmLl9lbnN1cmVTY2hlbWFDb2xsZWN0aW9uRXhpc3RzKHQpO1xuICAgICAgICB5aWVsZCB0Lm5vbmUocXMsIHZhbHVlcyk7XG4gICAgICB9IGNhdGNoKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICAvLyBFTFNFOiBUYWJsZSBhbHJlYWR5IGV4aXN0cywgbXVzdCBoYXZlIGJlZW4gY3JlYXRlZCBieSBhIGRpZmZlcmVudCByZXF1ZXN0LiBJZ25vcmUgdGhlIGVycm9yLlxuICAgICAgfVxuICAgICAgeWllbGQgdC50eCgnY3JlYXRlLXRhYmxlLXR4JywgdHggPT4ge1xuICAgICAgICByZXR1cm4gdHguYmF0Y2gocmVsYXRpb25zLm1hcChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgIHJldHVybiB0eC5ub25lKCdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAkPGpvaW5UYWJsZTpuYW1lPiAoXCJyZWxhdGVkSWRcIiB2YXJDaGFyKDEyMCksIFwib3duaW5nSWRcIiB2YXJDaGFyKDEyMCksIFBSSU1BUlkgS0VZKFwicmVsYXRlZElkXCIsIFwib3duaW5nSWRcIikgKScsIHtqb2luVGFibGU6IGBfSm9pbjoke2ZpZWxkTmFtZX06JHtjbGFzc05hbWV9YH0pO1xuICAgICAgICB9KSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHNjaGVtYVVwZ3JhZGUoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgY29ubjogYW55KSB7XG4gICAgZGVidWcoJ3NjaGVtYVVwZ3JhZGUnLCB7IGNsYXNzTmFtZSwgc2NoZW1hIH0pO1xuICAgIGNvbm4gPSBjb25uIHx8IHRoaXMuX2NsaWVudDtcbiAgICBjb25zdCBzZWxmID0gdGhpcztcblxuICAgIHJldHVybiBjb25uLnR4KCdzY2hlbWEtdXBncmFkZScsIGZ1bmN0aW9uICogKHQpIHtcbiAgICAgIGNvbnN0IGNvbHVtbnMgPSB5aWVsZCB0Lm1hcCgnU0VMRUNUIGNvbHVtbl9uYW1lIEZST00gaW5mb3JtYXRpb25fc2NoZW1hLmNvbHVtbnMgV0hFUkUgdGFibGVfbmFtZSA9ICQ8Y2xhc3NOYW1lPicsIHsgY2xhc3NOYW1lIH0sIGEgPT4gYS5jb2x1bW5fbmFtZSk7XG4gICAgICBjb25zdCBuZXdDb2x1bW5zID0gT2JqZWN0LmtleXMoc2NoZW1hLmZpZWxkcylcbiAgICAgICAgLmZpbHRlcihpdGVtID0+IGNvbHVtbnMuaW5kZXhPZihpdGVtKSA9PT0gLTEpXG4gICAgICAgIC5tYXAoZmllbGROYW1lID0+IHNlbGYuYWRkRmllbGRJZk5vdEV4aXN0cyhjbGFzc05hbWUsIGZpZWxkTmFtZSwgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLCB0KSk7XG5cbiAgICAgIHlpZWxkIHQuYmF0Y2gobmV3Q29sdW1ucyk7XG4gICAgfSk7XG4gIH1cblxuICBhZGRGaWVsZElmTm90RXhpc3RzKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZE5hbWU6IHN0cmluZywgdHlwZTogYW55LCBjb25uOiBhbnkpIHtcbiAgICAvLyBUT0RPOiBNdXN0IGJlIHJldmlzZWQgZm9yIGludmFsaWQgbG9naWMuLi5cbiAgICBkZWJ1ZygnYWRkRmllbGRJZk5vdEV4aXN0cycsIHtjbGFzc05hbWUsIGZpZWxkTmFtZSwgdHlwZX0pO1xuICAgIGNvbm4gPSBjb25uIHx8IHRoaXMuX2NsaWVudDtcbiAgICBjb25zdCBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gY29ubi50eCgnYWRkLWZpZWxkLWlmLW5vdC1leGlzdHMnLCBmdW5jdGlvbiAqICh0KSB7XG4gICAgICBpZiAodHlwZS50eXBlICE9PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgeWllbGQgdC5ub25lKCdBTFRFUiBUQUJMRSAkPGNsYXNzTmFtZTpuYW1lPiBBREQgQ09MVU1OICQ8ZmllbGROYW1lOm5hbWU+ICQ8cG9zdGdyZXNUeXBlOnJhdz4nLCB7XG4gICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICBmaWVsZE5hbWUsXG4gICAgICAgICAgICBwb3N0Z3Jlc1R5cGU6IHBhcnNlVHlwZVRvUG9zdGdyZXNUeXBlKHR5cGUpXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2goZXJyb3IpIHtcbiAgICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4geWllbGQgc2VsZi5jcmVhdGVDbGFzcyhjbGFzc05hbWUsIHtmaWVsZHM6IHtbZmllbGROYW1lXTogdHlwZX19LCB0KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGVycm9yLmNvZGUgIT09IFBvc3RncmVzRHVwbGljYXRlQ29sdW1uRXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBDb2x1bW4gYWxyZWFkeSBleGlzdHMsIGNyZWF0ZWQgYnkgb3RoZXIgcmVxdWVzdC4gQ2Fycnkgb24gdG8gc2VlIGlmIGl0J3MgdGhlIHJpZ2h0IHR5cGUuXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHlpZWxkIHQubm9uZSgnQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgJDxqb2luVGFibGU6bmFtZT4gKFwicmVsYXRlZElkXCIgdmFyQ2hhcigxMjApLCBcIm93bmluZ0lkXCIgdmFyQ2hhcigxMjApLCBQUklNQVJZIEtFWShcInJlbGF0ZWRJZFwiLCBcIm93bmluZ0lkXCIpICknLCB7am9pblRhYmxlOiBgX0pvaW46JHtmaWVsZE5hbWV9OiR7Y2xhc3NOYW1lfWB9KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVzdWx0ID0geWllbGQgdC5hbnkoJ1NFTEVDVCBcInNjaGVtYVwiIEZST00gXCJfU0NIRU1BXCIgV0hFUkUgXCJjbGFzc05hbWVcIiA9ICQ8Y2xhc3NOYW1lPiBhbmQgKFwic2NoZW1hXCI6Ompzb24tPlxcJ2ZpZWxkc1xcJy0+JDxmaWVsZE5hbWU+KSBpcyBub3QgbnVsbCcsIHtjbGFzc05hbWUsIGZpZWxkTmFtZX0pO1xuXG4gICAgICBpZiAocmVzdWx0WzBdKSB7XG4gICAgICAgIHRocm93ICdBdHRlbXB0ZWQgdG8gYWRkIGEgZmllbGQgdGhhdCBhbHJlYWR5IGV4aXN0cyc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBwYXRoID0gYHtmaWVsZHMsJHtmaWVsZE5hbWV9fWA7XG4gICAgICAgIHlpZWxkIHQubm9uZSgnVVBEQVRFIFwiX1NDSEVNQVwiIFNFVCBcInNjaGVtYVwiPWpzb25iX3NldChcInNjaGVtYVwiLCAkPHBhdGg+LCAkPHR5cGU+KSAgV0hFUkUgXCJjbGFzc05hbWVcIj0kPGNsYXNzTmFtZT4nLCB7cGF0aCwgdHlwZSwgY2xhc3NOYW1lfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBEcm9wcyBhIGNvbGxlY3Rpb24uIFJlc29sdmVzIHdpdGggdHJ1ZSBpZiBpdCB3YXMgYSBQYXJzZSBTY2hlbWEgKGVnLiBfVXNlciwgQ3VzdG9tLCBldGMuKVxuICAvLyBhbmQgcmVzb2x2ZXMgd2l0aCBmYWxzZSBpZiBpdCB3YXNuJ3QgKGVnLiBhIGpvaW4gdGFibGUpLiBSZWplY3RzIGlmIGRlbGV0aW9uIHdhcyBpbXBvc3NpYmxlLlxuICBkZWxldGVDbGFzcyhjbGFzc05hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IG9wZXJhdGlvbnMgPSBbXG4gICAgICB7cXVlcnk6IGBEUk9QIFRBQkxFIElGIEVYSVNUUyAkMTpuYW1lYCwgdmFsdWVzOiBbY2xhc3NOYW1lXX0sXG4gICAgICB7cXVlcnk6IGBERUxFVEUgRlJPTSBcIl9TQ0hFTUFcIiBXSEVSRSBcImNsYXNzTmFtZVwiID0gJDFgLCB2YWx1ZXM6IFtjbGFzc05hbWVdfVxuICAgIF07XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC50eCh0ID0+IHQubm9uZSh0aGlzLl9wZ3AuaGVscGVycy5jb25jYXQob3BlcmF0aW9ucykpKVxuICAgICAgLnRoZW4oKCkgPT4gY2xhc3NOYW1lLmluZGV4T2YoJ19Kb2luOicpICE9IDApOyAvLyByZXNvbHZlcyB3aXRoIGZhbHNlIHdoZW4gX0pvaW4gdGFibGVcbiAgfVxuXG4gIC8vIERlbGV0ZSBhbGwgZGF0YSBrbm93biB0byB0aGlzIGFkYXB0ZXIuIFVzZWQgZm9yIHRlc3RpbmcuXG4gIGRlbGV0ZUFsbENsYXNzZXMoKSB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG4gICAgY29uc3QgaGVscGVycyA9IHRoaXMuX3BncC5oZWxwZXJzO1xuICAgIGRlYnVnKCdkZWxldGVBbGxDbGFzc2VzJyk7XG5cbiAgICByZXR1cm4gdGhpcy5fY2xpZW50LnRhc2soJ2RlbGV0ZS1hbGwtY2xhc3NlcycsIGZ1bmN0aW9uICogKHQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdHMgPSB5aWVsZCB0LmFueSgnU0VMRUNUICogRlJPTSBcIl9TQ0hFTUFcIicpO1xuICAgICAgICBjb25zdCBqb2lucyA9IHJlc3VsdHMucmVkdWNlKChsaXN0OiBBcnJheTxzdHJpbmc+LCBzY2hlbWE6IGFueSkgPT4ge1xuICAgICAgICAgIHJldHVybiBsaXN0LmNvbmNhdChqb2luVGFibGVzRm9yU2NoZW1hKHNjaGVtYS5zY2hlbWEpKTtcbiAgICAgICAgfSwgW10pO1xuICAgICAgICBjb25zdCBjbGFzc2VzID0gWydfU0NIRU1BJywgJ19QdXNoU3RhdHVzJywgJ19Kb2JTdGF0dXMnLCAnX0pvYlNjaGVkdWxlJywgJ19Ib29rcycsICdfR2xvYmFsQ29uZmlnJywgJ19BdWRpZW5jZScsIC4uLnJlc3VsdHMubWFwKHJlc3VsdCA9PiByZXN1bHQuY2xhc3NOYW1lKSwgLi4uam9pbnNdO1xuICAgICAgICBjb25zdCBxdWVyaWVzID0gY2xhc3Nlcy5tYXAoY2xhc3NOYW1lID0+ICh7cXVlcnk6ICdEUk9QIFRBQkxFIElGIEVYSVNUUyAkPGNsYXNzTmFtZTpuYW1lPicsIHZhbHVlczoge2NsYXNzTmFtZX19KSk7XG4gICAgICAgIHlpZWxkIHQudHgodHggPT4gdHgubm9uZShoZWxwZXJzLmNvbmNhdChxdWVyaWVzKSkpO1xuICAgICAgfSBjYXRjaChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSAhPT0gUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgICAgLy8gTm8gX1NDSEVNQSBjb2xsZWN0aW9uLiBEb24ndCBkZWxldGUgYW55dGhpbmcuXG4gICAgICB9XG4gICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgZGVidWcoYGRlbGV0ZUFsbENsYXNzZXMgZG9uZSBpbiAke25ldyBEYXRlKCkuZ2V0VGltZSgpIC0gbm93fWApO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBSZW1vdmUgdGhlIGNvbHVtbiBhbmQgYWxsIHRoZSBkYXRhLiBGb3IgUmVsYXRpb25zLCB0aGUgX0pvaW4gY29sbGVjdGlvbiBpcyBoYW5kbGVkXG4gIC8vIHNwZWNpYWxseSwgdGhpcyBmdW5jdGlvbiBkb2VzIG5vdCBkZWxldGUgX0pvaW4gY29sdW1ucy4gSXQgc2hvdWxkLCBob3dldmVyLCBpbmRpY2F0ZVxuICAvLyB0aGF0IHRoZSByZWxhdGlvbiBmaWVsZHMgZG9lcyBub3QgZXhpc3QgYW55bW9yZS4gSW4gbW9uZ28sIHRoaXMgbWVhbnMgcmVtb3ZpbmcgaXQgZnJvbVxuICAvLyB0aGUgX1NDSEVNQSBjb2xsZWN0aW9uLiAgVGhlcmUgc2hvdWxkIGJlIG5vIGFjdHVhbCBkYXRhIGluIHRoZSBjb2xsZWN0aW9uIHVuZGVyIHRoZSBzYW1lIG5hbWVcbiAgLy8gYXMgdGhlIHJlbGF0aW9uIGNvbHVtbiwgc28gaXQncyBmaW5lIHRvIGF0dGVtcHQgdG8gZGVsZXRlIGl0LiBJZiB0aGUgZmllbGRzIGxpc3RlZCB0byBiZVxuICAvLyBkZWxldGVkIGRvIG5vdCBleGlzdCwgdGhpcyBmdW5jdGlvbiBzaG91bGQgcmV0dXJuIHN1Y2Nlc3NmdWxseSBhbnl3YXlzLiBDaGVja2luZyBmb3JcbiAgLy8gYXR0ZW1wdHMgdG8gZGVsZXRlIG5vbi1leGlzdGVudCBmaWVsZHMgaXMgdGhlIHJlc3BvbnNpYmlsaXR5IG9mIFBhcnNlIFNlcnZlci5cblxuICAvLyBUaGlzIGZ1bmN0aW9uIGlzIG5vdCBvYmxpZ2F0ZWQgdG8gZGVsZXRlIGZpZWxkcyBhdG9taWNhbGx5LiBJdCBpcyBnaXZlbiB0aGUgZmllbGRcbiAgLy8gbmFtZXMgaW4gYSBsaXN0IHNvIHRoYXQgZGF0YWJhc2VzIHRoYXQgYXJlIGNhcGFibGUgb2YgZGVsZXRpbmcgZmllbGRzIGF0b21pY2FsbHlcbiAgLy8gbWF5IGRvIHNvLlxuXG4gIC8vIFJldHVybnMgYSBQcm9taXNlLlxuICBkZWxldGVGaWVsZHMoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgZmllbGROYW1lczogc3RyaW5nW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBkZWJ1ZygnZGVsZXRlRmllbGRzJywgY2xhc3NOYW1lLCBmaWVsZE5hbWVzKTtcbiAgICBmaWVsZE5hbWVzID0gZmllbGROYW1lcy5yZWR1Y2UoKGxpc3Q6IEFycmF5PHN0cmluZz4sIGZpZWxkTmFtZTogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCBmaWVsZCA9IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXVxuICAgICAgaWYgKGZpZWxkLnR5cGUgIT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgbGlzdC5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICB9XG4gICAgICBkZWxldGUgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdO1xuICAgICAgcmV0dXJuIGxpc3Q7XG4gICAgfSwgW10pO1xuXG4gICAgY29uc3QgdmFsdWVzID0gW2NsYXNzTmFtZSwgLi4uZmllbGROYW1lc107XG4gICAgY29uc3QgY29sdW1ucyA9IGZpZWxkTmFtZXMubWFwKChuYW1lLCBpZHgpID0+IHtcbiAgICAgIHJldHVybiBgJCR7aWR4ICsgMn06bmFtZWA7XG4gICAgfSkuam9pbignLCBEUk9QIENPTFVNTicpO1xuXG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC50eCgnZGVsZXRlLWZpZWxkcycsIGZ1bmN0aW9uICogKHQpIHtcbiAgICAgIHlpZWxkIHQubm9uZSgnVVBEQVRFIFwiX1NDSEVNQVwiIFNFVCBcInNjaGVtYVwiPSQ8c2NoZW1hPiBXSEVSRSBcImNsYXNzTmFtZVwiPSQ8Y2xhc3NOYW1lPicsIHtzY2hlbWEsIGNsYXNzTmFtZX0pO1xuICAgICAgaWYgKHZhbHVlcy5sZW5ndGggPiAxKSB7XG4gICAgICAgIHlpZWxkIHQubm9uZShgQUxURVIgVEFCTEUgJDE6bmFtZSBEUk9QIENPTFVNTiAke2NvbHVtbnN9YCwgdmFsdWVzKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIFJldHVybiBhIHByb21pc2UgZm9yIGFsbCBzY2hlbWFzIGtub3duIHRvIHRoaXMgYWRhcHRlciwgaW4gUGFyc2UgZm9ybWF0LiBJbiBjYXNlIHRoZVxuICAvLyBzY2hlbWFzIGNhbm5vdCBiZSByZXRyaWV2ZWQsIHJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVqZWN0cy4gUmVxdWlyZW1lbnRzIGZvciB0aGVcbiAgLy8gcmVqZWN0aW9uIHJlYXNvbiBhcmUgVEJELlxuICBnZXRBbGxDbGFzc2VzKCkge1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQudGFzaygnZ2V0LWFsbC1jbGFzc2VzJywgZnVuY3Rpb24gKiAodCkge1xuICAgICAgeWllbGQgc2VsZi5fZW5zdXJlU2NoZW1hQ29sbGVjdGlvbkV4aXN0cyh0KTtcbiAgICAgIHJldHVybiB5aWVsZCB0Lm1hcCgnU0VMRUNUICogRlJPTSBcIl9TQ0hFTUFcIicsIG51bGwsIHJvdyA9PiB0b1BhcnNlU2NoZW1hKHsgY2xhc3NOYW1lOiByb3cuY2xhc3NOYW1lLCAuLi5yb3cuc2NoZW1hIH0pKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFJldHVybiBhIHByb21pc2UgZm9yIHRoZSBzY2hlbWEgd2l0aCB0aGUgZ2l2ZW4gbmFtZSwgaW4gUGFyc2UgZm9ybWF0LiBJZlxuICAvLyB0aGlzIGFkYXB0ZXIgZG9lc24ndCBrbm93IGFib3V0IHRoZSBzY2hlbWEsIHJldHVybiBhIHByb21pc2UgdGhhdCByZWplY3RzIHdpdGhcbiAgLy8gdW5kZWZpbmVkIGFzIHRoZSByZWFzb24uXG4gIGdldENsYXNzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgZGVidWcoJ2dldENsYXNzJywgY2xhc3NOYW1lKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50LmFueSgnU0VMRUNUICogRlJPTSBcIl9TQ0hFTUFcIiBXSEVSRSBcImNsYXNzTmFtZVwiPSQ8Y2xhc3NOYW1lPicsIHsgY2xhc3NOYW1lIH0pXG4gICAgICAudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICBpZiAocmVzdWx0Lmxlbmd0aCAhPT0gMSkge1xuICAgICAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0WzBdLnNjaGVtYTtcbiAgICAgIH0pXG4gICAgICAudGhlbih0b1BhcnNlU2NoZW1hKTtcbiAgfVxuXG4gIC8vIFRPRE86IHJlbW92ZSB0aGUgbW9uZ28gZm9ybWF0IGRlcGVuZGVuY3kgaW4gdGhlIHJldHVybiB2YWx1ZVxuICBjcmVhdGVPYmplY3QoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgb2JqZWN0OiBhbnkpIHtcbiAgICBkZWJ1ZygnY3JlYXRlT2JqZWN0JywgY2xhc3NOYW1lLCBvYmplY3QpO1xuICAgIGxldCBjb2x1bW5zQXJyYXkgPSBbXTtcbiAgICBjb25zdCB2YWx1ZXNBcnJheSA9IFtdO1xuICAgIHNjaGVtYSA9IHRvUG9zdGdyZXNTY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBnZW9Qb2ludHMgPSB7fTtcblxuICAgIG9iamVjdCA9IGhhbmRsZURvdEZpZWxkcyhvYmplY3QpO1xuXG4gICAgdmFsaWRhdGVLZXlzKG9iamVjdCk7XG5cbiAgICBPYmplY3Qua2V5cyhvYmplY3QpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB2YXIgYXV0aERhdGFNYXRjaCA9IGZpZWxkTmFtZS5tYXRjaCgvXl9hdXRoX2RhdGFfKFthLXpBLVowLTlfXSspJC8pO1xuICAgICAgaWYgKGF1dGhEYXRhTWF0Y2gpIHtcbiAgICAgICAgdmFyIHByb3ZpZGVyID0gYXV0aERhdGFNYXRjaFsxXTtcbiAgICAgICAgb2JqZWN0WydhdXRoRGF0YSddID0gb2JqZWN0WydhdXRoRGF0YSddIHx8IHt9O1xuICAgICAgICBvYmplY3RbJ2F1dGhEYXRhJ11bcHJvdmlkZXJdID0gb2JqZWN0W2ZpZWxkTmFtZV07XG4gICAgICAgIGRlbGV0ZSBvYmplY3RbZmllbGROYW1lXTtcbiAgICAgICAgZmllbGROYW1lID0gJ2F1dGhEYXRhJztcbiAgICAgIH1cblxuICAgICAgY29sdW1uc0FycmF5LnB1c2goZmllbGROYW1lKTtcbiAgICAgIGlmICghc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmIGNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgICAgICBpZiAoZmllbGROYW1lID09PSAnX2VtYWlsX3ZlcmlmeV90b2tlbicgfHxcbiAgICAgICAgICAgIGZpZWxkTmFtZSA9PT0gJ19mYWlsZWRfbG9naW5fY291bnQnIHx8XG4gICAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfcGVyaXNoYWJsZV90b2tlbicgfHxcbiAgICAgICAgICAgIGZpZWxkTmFtZSA9PT0gJ19wYXNzd29yZF9oaXN0b3J5Jyl7XG4gICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmllbGROYW1lID09PSAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0Jykge1xuICAgICAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSkge1xuICAgICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXS5pc28pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG51bGwpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmaWVsZE5hbWUgPT09ICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnIHx8XG4gICAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0JyB8fFxuICAgICAgICAgICAgZmllbGROYW1lID09PSAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnKSB7XG4gICAgICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdKSB7XG4gICAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLmlzbyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gobnVsbCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHN3aXRjaCAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUpIHtcbiAgICAgIGNhc2UgJ0RhdGUnOlxuICAgICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0pIHtcbiAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLmlzbyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChudWxsKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1BvaW50ZXInOlxuICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLm9iamVjdElkKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdBcnJheSc6XG4gICAgICAgIGlmIChbJ19ycGVybScsICdfd3Blcm0nXS5pbmRleE9mKGZpZWxkTmFtZSkgPj0gMCkge1xuICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gob2JqZWN0W2ZpZWxkTmFtZV0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2goSlNPTi5zdHJpbmdpZnkob2JqZWN0W2ZpZWxkTmFtZV0pKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ09iamVjdCc6XG4gICAgICBjYXNlICdCeXRlcyc6XG4gICAgICBjYXNlICdTdHJpbmcnOlxuICAgICAgY2FzZSAnTnVtYmVyJzpcbiAgICAgIGNhc2UgJ0Jvb2xlYW4nOlxuICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdGaWxlJzpcbiAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXS5uYW1lKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdQb2x5Z29uJzoge1xuICAgICAgICBjb25zdCB2YWx1ZSA9IGNvbnZlcnRQb2x5Z29uVG9TUUwob2JqZWN0W2ZpZWxkTmFtZV0uY29vcmRpbmF0ZXMpO1xuICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKHZhbHVlKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlICdHZW9Qb2ludCc6XG4gICAgICAgIC8vIHBvcCB0aGUgcG9pbnQgYW5kIHByb2Nlc3MgbGF0ZXJcbiAgICAgICAgZ2VvUG9pbnRzW2ZpZWxkTmFtZV0gPSBvYmplY3RbZmllbGROYW1lXTtcbiAgICAgICAgY29sdW1uc0FycmF5LnBvcCgpO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IGBUeXBlICR7c2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGV9IG5vdCBzdXBwb3J0ZWQgeWV0YDtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbHVtbnNBcnJheSA9IGNvbHVtbnNBcnJheS5jb25jYXQoT2JqZWN0LmtleXMoZ2VvUG9pbnRzKSk7XG4gICAgY29uc3QgaW5pdGlhbFZhbHVlcyA9IHZhbHVlc0FycmF5Lm1hcCgodmFsLCBpbmRleCkgPT4ge1xuICAgICAgbGV0IHRlcm1pbmF0aW9uID0gJyc7XG4gICAgICBjb25zdCBmaWVsZE5hbWUgPSBjb2x1bW5zQXJyYXlbaW5kZXhdO1xuICAgICAgaWYgKFsnX3JwZXJtJywnX3dwZXJtJ10uaW5kZXhPZihmaWVsZE5hbWUpID49IDApIHtcbiAgICAgICAgdGVybWluYXRpb24gPSAnOjp0ZXh0W10nO1xuICAgICAgfSBlbHNlIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdBcnJheScpIHtcbiAgICAgICAgdGVybWluYXRpb24gPSAnOjpqc29uYic7XG4gICAgICB9XG4gICAgICByZXR1cm4gYCQke2luZGV4ICsgMiArIGNvbHVtbnNBcnJheS5sZW5ndGh9JHt0ZXJtaW5hdGlvbn1gO1xuICAgIH0pO1xuICAgIGNvbnN0IGdlb1BvaW50c0luamVjdHMgPSBPYmplY3Qua2V5cyhnZW9Qb2ludHMpLm1hcCgoa2V5KSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGdlb1BvaW50c1trZXldO1xuICAgICAgdmFsdWVzQXJyYXkucHVzaCh2YWx1ZS5sb25naXR1ZGUsIHZhbHVlLmxhdGl0dWRlKTtcbiAgICAgIGNvbnN0IGwgPSB2YWx1ZXNBcnJheS5sZW5ndGggKyBjb2x1bW5zQXJyYXkubGVuZ3RoO1xuICAgICAgcmV0dXJuIGBQT0lOVCgkJHtsfSwgJCR7bCArIDF9KWA7XG4gICAgfSk7XG5cbiAgICBjb25zdCBjb2x1bW5zUGF0dGVybiA9IGNvbHVtbnNBcnJheS5tYXAoKGNvbCwgaW5kZXgpID0+IGAkJHtpbmRleCArIDJ9Om5hbWVgKS5qb2luKCk7XG4gICAgY29uc3QgdmFsdWVzUGF0dGVybiA9IGluaXRpYWxWYWx1ZXMuY29uY2F0KGdlb1BvaW50c0luamVjdHMpLmpvaW4oKVxuXG4gICAgY29uc3QgcXMgPSBgSU5TRVJUIElOVE8gJDE6bmFtZSAoJHtjb2x1bW5zUGF0dGVybn0pIFZBTFVFUyAoJHt2YWx1ZXNQYXR0ZXJufSlgXG4gICAgY29uc3QgdmFsdWVzID0gW2NsYXNzTmFtZSwgLi4uY29sdW1uc0FycmF5LCAuLi52YWx1ZXNBcnJheV1cbiAgICBkZWJ1ZyhxcywgdmFsdWVzKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50Lm5vbmUocXMsIHZhbHVlcylcbiAgICAgIC50aGVuKCgpID0+ICh7IG9wczogW29iamVjdF0gfSkpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNVbmlxdWVJbmRleFZpb2xhdGlvbkVycm9yKSB7XG4gICAgICAgICAgY29uc3QgZXJyID0gbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSwgJ0EgZHVwbGljYXRlIHZhbHVlIGZvciBhIGZpZWxkIHdpdGggdW5pcXVlIHZhbHVlcyB3YXMgcHJvdmlkZWQnKTtcbiAgICAgICAgICBlcnIudW5kZXJseWluZ0Vycm9yID0gZXJyb3I7XG4gICAgICAgICAgaWYgKGVycm9yLmNvbnN0cmFpbnQpIHtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoZXMgPSBlcnJvci5jb25zdHJhaW50Lm1hdGNoKC91bmlxdWVfKFthLXpBLVpdKykvKTtcbiAgICAgICAgICAgIGlmIChtYXRjaGVzICYmIEFycmF5LmlzQXJyYXkobWF0Y2hlcykpIHtcbiAgICAgICAgICAgICAgZXJyLnVzZXJJbmZvID0geyBkdXBsaWNhdGVkX2ZpZWxkOiBtYXRjaGVzWzFdIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGVycm9yID0gZXJyO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBSZW1vdmUgYWxsIG9iamVjdHMgdGhhdCBtYXRjaCB0aGUgZ2l2ZW4gUGFyc2UgUXVlcnkuXG4gIC8vIElmIG5vIG9iamVjdHMgbWF0Y2gsIHJlamVjdCB3aXRoIE9CSkVDVF9OT1RfRk9VTkQuIElmIG9iamVjdHMgYXJlIGZvdW5kIGFuZCBkZWxldGVkLCByZXNvbHZlIHdpdGggdW5kZWZpbmVkLlxuICAvLyBJZiB0aGVyZSBpcyBzb21lIG90aGVyIGVycm9yLCByZWplY3Qgd2l0aCBJTlRFUk5BTF9TRVJWRVJfRVJST1IuXG4gIGRlbGV0ZU9iamVjdHNCeVF1ZXJ5KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUpIHtcbiAgICBkZWJ1ZygnZGVsZXRlT2JqZWN0c0J5UXVlcnknLCBjbGFzc05hbWUsIHF1ZXJ5KTtcbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lXTtcbiAgICBjb25zdCBpbmRleCA9IDI7XG4gICAgY29uc3Qgd2hlcmUgPSBidWlsZFdoZXJlQ2xhdXNlKHsgc2NoZW1hLCBpbmRleCwgcXVlcnkgfSlcbiAgICB2YWx1ZXMucHVzaCguLi53aGVyZS52YWx1ZXMpO1xuICAgIGlmIChPYmplY3Qua2V5cyhxdWVyeSkubGVuZ3RoID09PSAwKSB7XG4gICAgICB3aGVyZS5wYXR0ZXJuID0gJ1RSVUUnO1xuICAgIH1cbiAgICBjb25zdCBxcyA9IGBXSVRIIGRlbGV0ZWQgQVMgKERFTEVURSBGUk9NICQxOm5hbWUgV0hFUkUgJHt3aGVyZS5wYXR0ZXJufSBSRVRVUk5JTkcgKikgU0VMRUNUIGNvdW50KCopIEZST00gZGVsZXRlZGA7XG4gICAgZGVidWcocXMsIHZhbHVlcyk7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC5vbmUocXMsIHZhbHVlcyAsIGEgPT4gK2EuY291bnQpXG4gICAgICAudGhlbihjb3VudCA9PiB7XG4gICAgICAgIGlmIChjb3VudCA9PT0gMCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELCAnT2JqZWN0IG5vdCBmb3VuZC4nKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gY291bnQ7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSAhPT0gUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgICAgLy8gRUxTRTogRG9uJ3QgZGVsZXRlIGFueXRoaW5nIGlmIGRvZXNuJ3QgZXhpc3RcbiAgICAgIH0pO1xuICB9XG4gIC8vIFJldHVybiB2YWx1ZSBub3QgY3VycmVudGx5IHdlbGwgc3BlY2lmaWVkLlxuICBmaW5kT25lQW5kVXBkYXRlKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIHVwZGF0ZTogYW55KTogUHJvbWlzZTxhbnk+IHtcbiAgICBkZWJ1ZygnZmluZE9uZUFuZFVwZGF0ZScsIGNsYXNzTmFtZSwgcXVlcnksIHVwZGF0ZSk7XG4gICAgcmV0dXJuIHRoaXMudXBkYXRlT2JqZWN0c0J5UXVlcnkoY2xhc3NOYW1lLCBzY2hlbWEsIHF1ZXJ5LCB1cGRhdGUpXG4gICAgICAudGhlbigodmFsKSA9PiB2YWxbMF0pO1xuICB9XG5cbiAgLy8gQXBwbHkgdGhlIHVwZGF0ZSB0byBhbGwgb2JqZWN0cyB0aGF0IG1hdGNoIHRoZSBnaXZlbiBQYXJzZSBRdWVyeS5cbiAgdXBkYXRlT2JqZWN0c0J5UXVlcnkoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSwgdXBkYXRlOiBhbnkpOiBQcm9taXNlPFthbnldPiB7XG4gICAgZGVidWcoJ3VwZGF0ZU9iamVjdHNCeVF1ZXJ5JywgY2xhc3NOYW1lLCBxdWVyeSwgdXBkYXRlKTtcbiAgICBjb25zdCB1cGRhdGVQYXR0ZXJucyA9IFtdO1xuICAgIGNvbnN0IHZhbHVlcyA9IFtjbGFzc05hbWVdXG4gICAgbGV0IGluZGV4ID0gMjtcbiAgICBzY2hlbWEgPSB0b1Bvc3RncmVzU2NoZW1hKHNjaGVtYSk7XG5cbiAgICBjb25zdCBvcmlnaW5hbFVwZGF0ZSA9IHsuLi51cGRhdGV9O1xuICAgIHVwZGF0ZSA9IGhhbmRsZURvdEZpZWxkcyh1cGRhdGUpO1xuICAgIC8vIFJlc29sdmUgYXV0aERhdGEgZmlyc3QsXG4gICAgLy8gU28gd2UgZG9uJ3QgZW5kIHVwIHdpdGggbXVsdGlwbGUga2V5IHVwZGF0ZXNcbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiB1cGRhdGUpIHtcbiAgICAgIGNvbnN0IGF1dGhEYXRhTWF0Y2ggPSBmaWVsZE5hbWUubWF0Y2goL15fYXV0aF9kYXRhXyhbYS16QS1aMC05X10rKSQvKTtcbiAgICAgIGlmIChhdXRoRGF0YU1hdGNoKSB7XG4gICAgICAgIHZhciBwcm92aWRlciA9IGF1dGhEYXRhTWF0Y2hbMV07XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdXBkYXRlW2ZpZWxkTmFtZV07XG4gICAgICAgIGRlbGV0ZSB1cGRhdGVbZmllbGROYW1lXTtcbiAgICAgICAgdXBkYXRlWydhdXRoRGF0YSddID0gdXBkYXRlWydhdXRoRGF0YSddIHx8IHt9O1xuICAgICAgICB1cGRhdGVbJ2F1dGhEYXRhJ11bcHJvdmlkZXJdID0gdmFsdWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gdXBkYXRlKSB7XG4gICAgICBjb25zdCBmaWVsZFZhbHVlID0gdXBkYXRlW2ZpZWxkTmFtZV07XG4gICAgICBpZiAoZmllbGRWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9IE5VTExgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGROYW1lID09ICdhdXRoRGF0YScpIHtcbiAgICAgICAgLy8gVGhpcyByZWN1cnNpdmVseSBzZXRzIHRoZSBqc29uX29iamVjdFxuICAgICAgICAvLyBPbmx5IDEgbGV2ZWwgZGVlcFxuICAgICAgICBjb25zdCBnZW5lcmF0ZSA9IChqc29uYjogc3RyaW5nLCBrZXk6IHN0cmluZywgdmFsdWU6IGFueSkgPT4ge1xuICAgICAgICAgIHJldHVybiBganNvbl9vYmplY3Rfc2V0X2tleShDT0FMRVNDRSgke2pzb25ifSwgJ3t9Jzo6anNvbmIpLCAke2tleX0sICR7dmFsdWV9KTo6anNvbmJgO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGxhc3RLZXkgPSBgJCR7aW5kZXh9Om5hbWVgO1xuICAgICAgICBjb25zdCBmaWVsZE5hbWVJbmRleCA9IGluZGV4O1xuICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgICBjb25zdCB1cGRhdGUgPSBPYmplY3Qua2V5cyhmaWVsZFZhbHVlKS5yZWR1Y2UoKGxhc3RLZXk6IHN0cmluZywga2V5OiBzdHJpbmcpID0+IHtcbiAgICAgICAgICBjb25zdCBzdHIgPSBnZW5lcmF0ZShsYXN0S2V5LCBgJCR7aW5kZXh9Ojp0ZXh0YCwgYCQke2luZGV4ICsgMX06Ompzb25iYClcbiAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgIGxldCB2YWx1ZSA9IGZpZWxkVmFsdWVba2V5XTtcbiAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgIGlmICh2YWx1ZS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgICB2YWx1ZSA9IG51bGw7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB2YWx1ZSA9IEpTT04uc3RyaW5naWZ5KHZhbHVlKVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICB2YWx1ZXMucHVzaChrZXksIHZhbHVlKTtcbiAgICAgICAgICByZXR1cm4gc3RyO1xuICAgICAgICB9LCBsYXN0S2V5KTtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7ZmllbGROYW1lSW5kZXh9Om5hbWUgPSAke3VwZGF0ZX1gKTtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS5fX29wID09PSAnSW5jcmVtZW50Jykge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9IENPQUxFU0NFKCQke2luZGV4fTpuYW1lLCAwKSArICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLmFtb3VudCk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX19vcCA9PT0gJ0FkZCcpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSBhcnJheV9hZGQoQ09BTEVTQ0UoJCR7aW5kZXh9Om5hbWUsICdbXSc6Ompzb25iKSwgJCR7aW5kZXggKyAxfTo6anNvbmIpYCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgSlNPTi5zdHJpbmdpZnkoZmllbGRWYWx1ZS5vYmplY3RzKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YClcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBudWxsKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS5fX29wID09PSAnUmVtb3ZlJykge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9IGFycmF5X3JlbW92ZShDT0FMRVNDRSgkJHtpbmRleH06bmFtZSwgJ1tdJzo6anNvbmIpLCAkJHtpbmRleCArIDF9Ojpqc29uYilgKVxuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUub2JqZWN0cykpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fb3AgPT09ICdBZGRVbmlxdWUnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gYXJyYXlfYWRkX3VuaXF1ZShDT0FMRVNDRSgkJHtpbmRleH06bmFtZSwgJ1tdJzo6anNvbmIpLCAkJHtpbmRleCArIDF9Ojpqc29uYilgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlLm9iamVjdHMpKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGROYW1lID09PSAndXBkYXRlZEF0JykgeyAvL1RPRE86IHN0b3Agc3BlY2lhbCBjYXNpbmcgdGhpcy4gSXQgc2hvdWxkIGNoZWNrIGZvciBfX3R5cGUgPT09ICdEYXRlJyBhbmQgdXNlIC5pc29cbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YClcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpZWxkVmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUub2JqZWN0SWQpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ0RhdGUnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHRvUG9zdGdyZXNWYWx1ZShmaWVsZFZhbHVlKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ0ZpbGUnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHRvUG9zdGdyZXNWYWx1ZShmaWVsZFZhbHVlKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnR2VvUG9pbnQnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gUE9JTlQoJCR7aW5kZXggKyAxfSwgJCR7aW5kZXggKyAyfSlgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLmxvbmdpdHVkZSwgZmllbGRWYWx1ZS5sYXRpdHVkZSk7XG4gICAgICAgIGluZGV4ICs9IDM7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBjb252ZXJ0UG9seWdvblRvU1FMKGZpZWxkVmFsdWUuY29vcmRpbmF0ZXMpO1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX06OnBvbHlnb25gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCB2YWx1ZSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIC8vIG5vb3BcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpZWxkVmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ29iamVjdCdcbiAgICAgICAgICAgICAgICAgICAgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdXG4gICAgICAgICAgICAgICAgICAgICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnT2JqZWN0Jykge1xuICAgICAgICAvLyBHYXRoZXIga2V5cyB0byBpbmNyZW1lbnRcbiAgICAgICAgY29uc3Qga2V5c1RvSW5jcmVtZW50ID0gT2JqZWN0LmtleXMob3JpZ2luYWxVcGRhdGUpLmZpbHRlcihrID0+IHtcbiAgICAgICAgICAvLyBjaG9vc2UgdG9wIGxldmVsIGZpZWxkcyB0aGF0IGhhdmUgYSBkZWxldGUgb3BlcmF0aW9uIHNldFxuICAgICAgICAgIC8vIE5vdGUgdGhhdCBPYmplY3Qua2V5cyBpcyBpdGVyYXRpbmcgb3ZlciB0aGUgKipvcmlnaW5hbCoqIHVwZGF0ZSBvYmplY3RcbiAgICAgICAgICAvLyBhbmQgdGhhdCBzb21lIG9mIHRoZSBrZXlzIG9mIHRoZSBvcmlnaW5hbCB1cGRhdGUgY291bGQgYmUgbnVsbCBvciB1bmRlZmluZWQ6XG4gICAgICAgICAgLy8gKFNlZSB0aGUgYWJvdmUgY2hlY2sgYGlmIChmaWVsZFZhbHVlID09PSBudWxsIHx8IHR5cGVvZiBmaWVsZFZhbHVlID09IFwidW5kZWZpbmVkXCIpYClcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IG9yaWdpbmFsVXBkYXRlW2tdO1xuICAgICAgICAgIHJldHVybiB2YWx1ZSAmJiB2YWx1ZS5fX29wID09PSAnSW5jcmVtZW50JyAmJiBrLnNwbGl0KCcuJykubGVuZ3RoID09PSAyICYmIGsuc3BsaXQoXCIuXCIpWzBdID09PSBmaWVsZE5hbWU7XG4gICAgICAgIH0pLm1hcChrID0+IGsuc3BsaXQoJy4nKVsxXSk7XG5cbiAgICAgICAgbGV0IGluY3JlbWVudFBhdHRlcm5zID0gJyc7XG4gICAgICAgIGlmIChrZXlzVG9JbmNyZW1lbnQubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGluY3JlbWVudFBhdHRlcm5zID0gJyB8fCAnICsga2V5c1RvSW5jcmVtZW50Lm1hcCgoYykgPT4ge1xuICAgICAgICAgICAgY29uc3QgYW1vdW50ID0gZmllbGRWYWx1ZVtjXS5hbW91bnQ7XG4gICAgICAgICAgICByZXR1cm4gYENPTkNBVCgne1wiJHtjfVwiOicsIENPQUxFU0NFKCQke2luZGV4fTpuYW1lLT4+JyR7Y30nLCcwJyk6OmludCArICR7YW1vdW50fSwgJ30nKTo6anNvbmJgO1xuICAgICAgICAgIH0pLmpvaW4oJyB8fCAnKTtcbiAgICAgICAgICAvLyBTdHJpcCB0aGUga2V5c1xuICAgICAgICAgIGtleXNUb0luY3JlbWVudC5mb3JFYWNoKChrZXkpID0+IHtcbiAgICAgICAgICAgIGRlbGV0ZSBmaWVsZFZhbHVlW2tleV07XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBrZXlzVG9EZWxldGU6IEFycmF5PHN0cmluZz4gPSBPYmplY3Qua2V5cyhvcmlnaW5hbFVwZGF0ZSkuZmlsdGVyKGsgPT4ge1xuICAgICAgICAgIC8vIGNob29zZSB0b3AgbGV2ZWwgZmllbGRzIHRoYXQgaGF2ZSBhIGRlbGV0ZSBvcGVyYXRpb24gc2V0LlxuICAgICAgICAgIGNvbnN0IHZhbHVlID0gb3JpZ2luYWxVcGRhdGVba107XG4gICAgICAgICAgcmV0dXJuIHZhbHVlICYmIHZhbHVlLl9fb3AgPT09ICdEZWxldGUnICYmIGsuc3BsaXQoJy4nKS5sZW5ndGggPT09IDIgJiYgay5zcGxpdChcIi5cIilbMF0gPT09IGZpZWxkTmFtZTtcbiAgICAgICAgfSkubWFwKGsgPT4gay5zcGxpdCgnLicpWzFdKTtcblxuICAgICAgICBjb25zdCBkZWxldGVQYXR0ZXJucyA9IGtleXNUb0RlbGV0ZS5yZWR1Y2UoKHA6IHN0cmluZywgYzogc3RyaW5nLCBpOiBudW1iZXIpID0+IHtcbiAgICAgICAgICByZXR1cm4gcCArIGAgLSAnJCR7aW5kZXggKyAxICsgaX06dmFsdWUnYDtcbiAgICAgICAgfSwgJycpO1xuXG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gKCd7fSc6Ompzb25iICR7ZGVsZXRlUGF0dGVybnN9ICR7aW5jcmVtZW50UGF0dGVybnN9IHx8ICQke2luZGV4ICsgMSArIGtleXNUb0RlbGV0ZS5sZW5ndGh9Ojpqc29uYiApYCk7XG5cbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCAuLi5rZXlzVG9EZWxldGUsIEpTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUpKTtcbiAgICAgICAgaW5kZXggKz0gMiArIGtleXNUb0RlbGV0ZS5sZW5ndGg7XG4gICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoZmllbGRWYWx1ZSlcbiAgICAgICAgICAgICAgICAgICAgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdXG4gICAgICAgICAgICAgICAgICAgICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnQXJyYXknKSB7XG4gICAgICAgIGNvbnN0IGV4cGVjdGVkVHlwZSA9IHBhcnNlVHlwZVRvUG9zdGdyZXNUeXBlKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSk7XG4gICAgICAgIGlmIChleHBlY3RlZFR5cGUgPT09ICd0ZXh0W10nKSB7XG4gICAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9Ojp0ZXh0W11gKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBsZXQgdHlwZSA9ICd0ZXh0JztcbiAgICAgICAgICBmb3IgKGNvbnN0IGVsdCBvZiBmaWVsZFZhbHVlKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGVsdCA9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICB0eXBlID0gJ2pzb24nO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSBhcnJheV90b19qc29uKCQke2luZGV4ICsgMX06OiR7dHlwZX1bXSk6Ompzb25iYCk7XG4gICAgICAgIH1cbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRlYnVnKCdOb3Qgc3VwcG9ydGVkIHVwZGF0ZScsIGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTiwgYFBvc3RncmVzIGRvZXNuJ3Qgc3VwcG9ydCB1cGRhdGUgJHtKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlKX0geWV0YCkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHdoZXJlID0gYnVpbGRXaGVyZUNsYXVzZSh7IHNjaGVtYSwgaW5kZXgsIHF1ZXJ5IH0pXG4gICAgdmFsdWVzLnB1c2goLi4ud2hlcmUudmFsdWVzKTtcblxuICAgIGNvbnN0IHdoZXJlQ2xhdXNlID0gd2hlcmUucGF0dGVybi5sZW5ndGggPiAwID8gYFdIRVJFICR7d2hlcmUucGF0dGVybn1gIDogJyc7XG4gICAgY29uc3QgcXMgPSBgVVBEQVRFICQxOm5hbWUgU0VUICR7dXBkYXRlUGF0dGVybnMuam9pbigpfSAke3doZXJlQ2xhdXNlfSBSRVRVUk5JTkcgKmA7XG4gICAgZGVidWcoJ3VwZGF0ZTogJywgcXMsIHZhbHVlcyk7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC5hbnkocXMsIHZhbHVlcyk7XG4gIH1cblxuICAvLyBIb3BlZnVsbHksIHdlIGNhbiBnZXQgcmlkIG9mIHRoaXMuIEl0J3Mgb25seSB1c2VkIGZvciBjb25maWcgYW5kIGhvb2tzLlxuICB1cHNlcnRPbmVPYmplY3QoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSwgdXBkYXRlOiBhbnkpIHtcbiAgICBkZWJ1ZygndXBzZXJ0T25lT2JqZWN0Jywge2NsYXNzTmFtZSwgcXVlcnksIHVwZGF0ZX0pO1xuICAgIGNvbnN0IGNyZWF0ZVZhbHVlID0gT2JqZWN0LmFzc2lnbih7fSwgcXVlcnksIHVwZGF0ZSk7XG4gICAgcmV0dXJuIHRoaXMuY3JlYXRlT2JqZWN0KGNsYXNzTmFtZSwgc2NoZW1hLCBjcmVhdGVWYWx1ZSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIC8vIGlnbm9yZSBkdXBsaWNhdGUgdmFsdWUgZXJyb3JzIGFzIGl0J3MgdXBzZXJ0XG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5maW5kT25lQW5kVXBkYXRlKGNsYXNzTmFtZSwgc2NoZW1hLCBxdWVyeSwgdXBkYXRlKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgZmluZChjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlLCB7IHNraXAsIGxpbWl0LCBzb3J0LCBrZXlzIH06IFF1ZXJ5T3B0aW9ucykge1xuICAgIGRlYnVnKCdmaW5kJywgY2xhc3NOYW1lLCBxdWVyeSwge3NraXAsIGxpbWl0LCBzb3J0LCBrZXlzIH0pO1xuICAgIGNvbnN0IGhhc0xpbWl0ID0gbGltaXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBoYXNTa2lwID0gc2tpcCAhPT0gdW5kZWZpbmVkO1xuICAgIGxldCB2YWx1ZXMgPSBbY2xhc3NOYW1lXTtcbiAgICBjb25zdCB3aGVyZSA9IGJ1aWxkV2hlcmVDbGF1c2UoeyBzY2hlbWEsIHF1ZXJ5LCBpbmRleDogMiB9KVxuICAgIHZhbHVlcy5wdXNoKC4uLndoZXJlLnZhbHVlcyk7XG5cbiAgICBjb25zdCB3aGVyZVBhdHRlcm4gPSB3aGVyZS5wYXR0ZXJuLmxlbmd0aCA+IDAgPyBgV0hFUkUgJHt3aGVyZS5wYXR0ZXJufWAgOiAnJztcbiAgICBjb25zdCBsaW1pdFBhdHRlcm4gPSBoYXNMaW1pdCA/IGBMSU1JVCAkJHt2YWx1ZXMubGVuZ3RoICsgMX1gIDogJyc7XG4gICAgaWYgKGhhc0xpbWl0KSB7XG4gICAgICB2YWx1ZXMucHVzaChsaW1pdCk7XG4gICAgfVxuICAgIGNvbnN0IHNraXBQYXR0ZXJuID0gaGFzU2tpcCA/IGBPRkZTRVQgJCR7dmFsdWVzLmxlbmd0aCArIDF9YCA6ICcnO1xuICAgIGlmIChoYXNTa2lwKSB7XG4gICAgICB2YWx1ZXMucHVzaChza2lwKTtcbiAgICB9XG5cbiAgICBsZXQgc29ydFBhdHRlcm4gPSAnJztcbiAgICBpZiAoc29ydCkge1xuICAgICAgY29uc3Qgc29ydENvcHk6IGFueSA9IHNvcnQ7XG4gICAgICBjb25zdCBzb3J0aW5nID0gT2JqZWN0LmtleXMoc29ydCkubWFwKChrZXkpID0+IHtcbiAgICAgICAgY29uc3QgdHJhbnNmb3JtS2V5ID0gdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMoa2V5KS5qb2luKCctPicpO1xuICAgICAgICAvLyBVc2luZyAkaWR4IHBhdHRlcm4gZ2l2ZXM6ICBub24taW50ZWdlciBjb25zdGFudCBpbiBPUkRFUiBCWVxuICAgICAgICBpZiAoc29ydENvcHlba2V5XSA9PT0gMSkge1xuICAgICAgICAgIHJldHVybiBgJHt0cmFuc2Zvcm1LZXl9IEFTQ2A7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGAke3RyYW5zZm9ybUtleX0gREVTQ2A7XG4gICAgICB9KS5qb2luKCk7XG4gICAgICBzb3J0UGF0dGVybiA9IHNvcnQgIT09IHVuZGVmaW5lZCAmJiBPYmplY3Qua2V5cyhzb3J0KS5sZW5ndGggPiAwID8gYE9SREVSIEJZICR7c29ydGluZ31gIDogJyc7XG4gICAgfVxuICAgIGlmICh3aGVyZS5zb3J0cyAmJiBPYmplY3Qua2V5cygod2hlcmUuc29ydHM6IGFueSkpLmxlbmd0aCA+IDApIHtcbiAgICAgIHNvcnRQYXR0ZXJuID0gYE9SREVSIEJZICR7d2hlcmUuc29ydHMuam9pbigpfWA7XG4gICAgfVxuXG4gICAgbGV0IGNvbHVtbnMgPSAnKic7XG4gICAgaWYgKGtleXMpIHtcbiAgICAgIC8vIEV4Y2x1ZGUgZW1wdHkga2V5c1xuICAgICAga2V5cyA9IGtleXMuZmlsdGVyKChrZXkpID0+IHtcbiAgICAgICAgcmV0dXJuIGtleS5sZW5ndGggPiAwO1xuICAgICAgfSk7XG4gICAgICBjb2x1bW5zID0ga2V5cy5tYXAoKGtleSwgaW5kZXgpID0+IHtcbiAgICAgICAgaWYgKGtleSA9PT0gJyRzY29yZScpIHtcbiAgICAgICAgICByZXR1cm4gYHRzX3JhbmtfY2QodG9fdHN2ZWN0b3IoJCR7Mn0sICQkezN9Om5hbWUpLCB0b190c3F1ZXJ5KCQkezR9LCAkJHs1fSksIDMyKSBhcyBzY29yZWA7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGAkJHtpbmRleCArIHZhbHVlcy5sZW5ndGggKyAxfTpuYW1lYDtcbiAgICAgIH0pLmpvaW4oKTtcbiAgICAgIHZhbHVlcyA9IHZhbHVlcy5jb25jYXQoa2V5cyk7XG4gICAgfVxuXG4gICAgY29uc3QgcXMgPSBgU0VMRUNUICR7Y29sdW1uc30gRlJPTSAkMTpuYW1lICR7d2hlcmVQYXR0ZXJufSAke3NvcnRQYXR0ZXJufSAke2xpbWl0UGF0dGVybn0gJHtza2lwUGF0dGVybn1gO1xuICAgIGRlYnVnKHFzLCB2YWx1ZXMpO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQuYW55KHFzLCB2YWx1ZXMpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAvLyBRdWVyeSBvbiBub24gZXhpc3RpbmcgdGFibGUsIGRvbid0IGNyYXNoXG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc1JlbGF0aW9uRG9lc05vdEV4aXN0RXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gW107XG4gICAgICB9KVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PiByZXN1bHRzLm1hcChvYmplY3QgPT4gdGhpcy5wb3N0Z3Jlc09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSkpKTtcbiAgfVxuXG4gIC8vIENvbnZlcnRzIGZyb20gYSBwb3N0Z3Jlcy1mb3JtYXQgb2JqZWN0IHRvIGEgUkVTVC1mb3JtYXQgb2JqZWN0LlxuICAvLyBEb2VzIG5vdCBzdHJpcCBvdXQgYW55dGhpbmcgYmFzZWQgb24gYSBsYWNrIG9mIGF1dGhlbnRpY2F0aW9uLlxuICBwb3N0Z3Jlc09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lOiBzdHJpbmcsIG9iamVjdDogYW55LCBzY2hlbWE6IGFueSkge1xuICAgIE9iamVjdC5rZXlzKHNjaGVtYS5maWVsZHMpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ1BvaW50ZXInICYmIG9iamVjdFtmaWVsZE5hbWVdKSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0geyBvYmplY3RJZDogb2JqZWN0W2ZpZWxkTmFtZV0sIF9fdHlwZTogJ1BvaW50ZXInLCBjbGFzc05hbWU6IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50YXJnZXRDbGFzcyB9O1xuICAgICAgfVxuICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0ge1xuICAgICAgICAgIF9fdHlwZTogXCJSZWxhdGlvblwiLFxuICAgICAgICAgIGNsYXNzTmFtZTogc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnRhcmdldENsYXNzXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0dlb1BvaW50Jykge1xuICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHtcbiAgICAgICAgICBfX3R5cGU6IFwiR2VvUG9pbnRcIixcbiAgICAgICAgICBsYXRpdHVkZTogb2JqZWN0W2ZpZWxkTmFtZV0ueSxcbiAgICAgICAgICBsb25naXR1ZGU6IG9iamVjdFtmaWVsZE5hbWVdLnhcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgICAgbGV0IGNvb3JkcyA9IG9iamVjdFtmaWVsZE5hbWVdO1xuICAgICAgICBjb29yZHMgPSBjb29yZHMuc3Vic3RyKDIsIGNvb3Jkcy5sZW5ndGggLSA0KS5zcGxpdCgnKSwoJyk7XG4gICAgICAgIGNvb3JkcyA9IGNvb3Jkcy5tYXAoKHBvaW50KSA9PiB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgIHBhcnNlRmxvYXQocG9pbnQuc3BsaXQoJywnKVsxXSksXG4gICAgICAgICAgICBwYXJzZUZsb2F0KHBvaW50LnNwbGl0KCcsJylbMF0pXG4gICAgICAgICAgXTtcbiAgICAgICAgfSk7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0ge1xuICAgICAgICAgIF9fdHlwZTogXCJQb2x5Z29uXCIsXG4gICAgICAgICAgY29vcmRpbmF0ZXM6IGNvb3Jkc1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdGaWxlJykge1xuICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHtcbiAgICAgICAgICBfX3R5cGU6ICdGaWxlJyxcbiAgICAgICAgICBuYW1lOiBvYmplY3RbZmllbGROYW1lXVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gICAgLy9UT0RPOiByZW1vdmUgdGhpcyByZWxpYW5jZSBvbiB0aGUgbW9uZ28gZm9ybWF0LiBEQiBhZGFwdGVyIHNob3VsZG4ndCBrbm93IHRoZXJlIGlzIGEgZGlmZmVyZW5jZSBiZXR3ZWVuIGNyZWF0ZWQgYXQgYW5kIGFueSBvdGhlciBkYXRlIGZpZWxkLlxuICAgIGlmIChvYmplY3QuY3JlYXRlZEF0KSB7XG4gICAgICBvYmplY3QuY3JlYXRlZEF0ID0gb2JqZWN0LmNyZWF0ZWRBdC50b0lTT1N0cmluZygpO1xuICAgIH1cbiAgICBpZiAob2JqZWN0LnVwZGF0ZWRBdCkge1xuICAgICAgb2JqZWN0LnVwZGF0ZWRBdCA9IG9iamVjdC51cGRhdGVkQXQudG9JU09TdHJpbmcoKTtcbiAgICB9XG4gICAgaWYgKG9iamVjdC5leHBpcmVzQXQpIHtcbiAgICAgIG9iamVjdC5leHBpcmVzQXQgPSB7IF9fdHlwZTogJ0RhdGUnLCBpc286IG9iamVjdC5leHBpcmVzQXQudG9JU09TdHJpbmcoKSB9O1xuICAgIH1cbiAgICBpZiAob2JqZWN0Ll9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCkge1xuICAgICAgb2JqZWN0Ll9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCA9IHsgX190eXBlOiAnRGF0ZScsIGlzbzogb2JqZWN0Ll9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdC50b0lTT1N0cmluZygpIH07XG4gICAgfVxuICAgIGlmIChvYmplY3QuX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0KSB7XG4gICAgICBvYmplY3QuX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0ID0geyBfX3R5cGU6ICdEYXRlJywgaXNvOiBvYmplY3QuX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0LnRvSVNPU3RyaW5nKCkgfTtcbiAgICB9XG4gICAgaWYgKG9iamVjdC5fcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0KSB7XG4gICAgICBvYmplY3QuX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCA9IHsgX190eXBlOiAnRGF0ZScsIGlzbzogb2JqZWN0Ll9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQudG9JU09TdHJpbmcoKSB9O1xuICAgIH1cbiAgICBpZiAob2JqZWN0Ll9wYXNzd29yZF9jaGFuZ2VkX2F0KSB7XG4gICAgICBvYmplY3QuX3Bhc3N3b3JkX2NoYW5nZWRfYXQgPSB7IF9fdHlwZTogJ0RhdGUnLCBpc286IG9iamVjdC5fcGFzc3dvcmRfY2hhbmdlZF9hdC50b0lTT1N0cmluZygpIH07XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gb2JqZWN0KSB7XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gPT09IG51bGwpIHtcbiAgICAgICAgZGVsZXRlIG9iamVjdFtmaWVsZE5hbWVdO1xuICAgICAgfVxuICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHsgX190eXBlOiAnRGF0ZScsIGlzbzogb2JqZWN0W2ZpZWxkTmFtZV0udG9JU09TdHJpbmcoKSB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBvYmplY3Q7XG4gIH1cblxuICAvLyBDcmVhdGUgYSB1bmlxdWUgaW5kZXguIFVuaXF1ZSBpbmRleGVzIG9uIG51bGxhYmxlIGZpZWxkcyBhcmUgbm90IGFsbG93ZWQuIFNpbmNlIHdlIGRvbid0XG4gIC8vIGN1cnJlbnRseSBrbm93IHdoaWNoIGZpZWxkcyBhcmUgbnVsbGFibGUgYW5kIHdoaWNoIGFyZW4ndCwgd2UgaWdub3JlIHRoYXQgY3JpdGVyaWEuXG4gIC8vIEFzIHN1Y2gsIHdlIHNob3VsZG4ndCBleHBvc2UgdGhpcyBmdW5jdGlvbiB0byB1c2VycyBvZiBwYXJzZSB1bnRpbCB3ZSBoYXZlIGFuIG91dC1vZi1iYW5kXG4gIC8vIFdheSBvZiBkZXRlcm1pbmluZyBpZiBhIGZpZWxkIGlzIG51bGxhYmxlLiBVbmRlZmluZWQgZG9lc24ndCBjb3VudCBhZ2FpbnN0IHVuaXF1ZW5lc3MsXG4gIC8vIHdoaWNoIGlzIHdoeSB3ZSB1c2Ugc3BhcnNlIGluZGV4ZXMuXG4gIGVuc3VyZVVuaXF1ZW5lc3MoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgZmllbGROYW1lczogc3RyaW5nW10pIHtcbiAgICAvLyBVc2UgdGhlIHNhbWUgbmFtZSBmb3IgZXZlcnkgZW5zdXJlVW5pcXVlbmVzcyBhdHRlbXB0LCBiZWNhdXNlIHBvc3RncmVzXG4gICAgLy8gV2lsbCBoYXBwaWx5IGNyZWF0ZSB0aGUgc2FtZSBpbmRleCB3aXRoIG11bHRpcGxlIG5hbWVzLlxuICAgIGNvbnN0IGNvbnN0cmFpbnROYW1lID0gYHVuaXF1ZV8ke2ZpZWxkTmFtZXMuc29ydCgpLmpvaW4oJ18nKX1gO1xuICAgIGNvbnN0IGNvbnN0cmFpbnRQYXR0ZXJucyA9IGZpZWxkTmFtZXMubWFwKChmaWVsZE5hbWUsIGluZGV4KSA9PiBgJCR7aW5kZXggKyAzfTpuYW1lYCk7XG4gICAgY29uc3QgcXMgPSBgQUxURVIgVEFCTEUgJDE6bmFtZSBBREQgQ09OU1RSQUlOVCAkMjpuYW1lIFVOSVFVRSAoJHtjb25zdHJhaW50UGF0dGVybnMuam9pbigpfSlgO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQubm9uZShxcywgW2NsYXNzTmFtZSwgY29uc3RyYWludE5hbWUsIC4uLmZpZWxkTmFtZXNdKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IFBvc3RncmVzRHVwbGljYXRlUmVsYXRpb25FcnJvciAmJiBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKGNvbnN0cmFpbnROYW1lKSkge1xuICAgICAgICAvLyBJbmRleCBhbHJlYWR5IGV4aXN0cy4gSWdub3JlIGVycm9yLlxuICAgICAgICB9IGVsc2UgaWYgKGVycm9yLmNvZGUgPT09IFBvc3RncmVzVW5pcXVlSW5kZXhWaW9sYXRpb25FcnJvciAmJiBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKGNvbnN0cmFpbnROYW1lKSkge1xuICAgICAgICAvLyBDYXN0IHRoZSBlcnJvciBpbnRvIHRoZSBwcm9wZXIgcGFyc2UgZXJyb3JcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLCAnQSBkdXBsaWNhdGUgdmFsdWUgZm9yIGEgZmllbGQgd2l0aCB1bmlxdWUgdmFsdWVzIHdhcyBwcm92aWRlZCcpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIEV4ZWN1dGVzIGEgY291bnQuXG4gIGNvdW50KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUpIHtcbiAgICBkZWJ1ZygnY291bnQnLCBjbGFzc05hbWUsIHF1ZXJ5KTtcbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lXTtcbiAgICBjb25zdCB3aGVyZSA9IGJ1aWxkV2hlcmVDbGF1c2UoeyBzY2hlbWEsIHF1ZXJ5LCBpbmRleDogMiB9KTtcbiAgICB2YWx1ZXMucHVzaCguLi53aGVyZS52YWx1ZXMpO1xuXG4gICAgY29uc3Qgd2hlcmVQYXR0ZXJuID0gd2hlcmUucGF0dGVybi5sZW5ndGggPiAwID8gYFdIRVJFICR7d2hlcmUucGF0dGVybn1gIDogJyc7XG4gICAgY29uc3QgcXMgPSBgU0VMRUNUIGNvdW50KCopIEZST00gJDE6bmFtZSAke3doZXJlUGF0dGVybn1gO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQub25lKHFzLCB2YWx1ZXMsIGEgPT4gK2EuY291bnQpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSAhPT0gUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9KTtcbiAgfVxuXG4gIGRpc3RpbmN0KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIGZpZWxkTmFtZTogc3RyaW5nKSB7XG4gICAgZGVidWcoJ2Rpc3RpbmN0JywgY2xhc3NOYW1lLCBxdWVyeSk7XG4gICAgbGV0IGZpZWxkID0gZmllbGROYW1lO1xuICAgIGxldCBjb2x1bW4gPSBmaWVsZE5hbWU7XG4gICAgY29uc3QgaXNOZXN0ZWQgPSBmaWVsZE5hbWUuaW5kZXhPZignLicpID49IDA7XG4gICAgaWYgKGlzTmVzdGVkKSB7XG4gICAgICBmaWVsZCA9IHRyYW5zZm9ybURvdEZpZWxkVG9Db21wb25lbnRzKGZpZWxkTmFtZSkuam9pbignLT4nKTtcbiAgICAgIGNvbHVtbiA9IGZpZWxkTmFtZS5zcGxpdCgnLicpWzBdO1xuICAgIH1cbiAgICBjb25zdCBpc0FycmF5RmllbGQgPSBzY2hlbWEuZmllbGRzXG4gICAgICAgICAgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdXG4gICAgICAgICAgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdBcnJheSc7XG4gICAgY29uc3QgaXNQb2ludGVyRmllbGQgPSBzY2hlbWEuZmllbGRzXG4gICAgICAgICAgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdXG4gICAgICAgICAgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdQb2ludGVyJztcbiAgICBjb25zdCB2YWx1ZXMgPSBbZmllbGQsIGNvbHVtbiwgY2xhc3NOYW1lXTtcbiAgICBjb25zdCB3aGVyZSA9IGJ1aWxkV2hlcmVDbGF1c2UoeyBzY2hlbWEsIHF1ZXJ5LCBpbmRleDogNCB9KTtcbiAgICB2YWx1ZXMucHVzaCguLi53aGVyZS52YWx1ZXMpO1xuXG4gICAgY29uc3Qgd2hlcmVQYXR0ZXJuID0gd2hlcmUucGF0dGVybi5sZW5ndGggPiAwID8gYFdIRVJFICR7d2hlcmUucGF0dGVybn1gIDogJyc7XG4gICAgY29uc3QgdHJhbnNmb3JtZXIgPSBpc0FycmF5RmllbGQgPyAnanNvbmJfYXJyYXlfZWxlbWVudHMnIDogJ09OJztcbiAgICBsZXQgcXMgPSBgU0VMRUNUIERJU1RJTkNUICR7dHJhbnNmb3JtZXJ9KCQxOm5hbWUpICQyOm5hbWUgRlJPTSAkMzpuYW1lICR7d2hlcmVQYXR0ZXJufWA7XG4gICAgaWYgKGlzTmVzdGVkKSB7XG4gICAgICBxcyA9IGBTRUxFQ1QgRElTVElOQ1QgJHt0cmFuc2Zvcm1lcn0oJDE6cmF3KSAkMjpyYXcgRlJPTSAkMzpuYW1lICR7d2hlcmVQYXR0ZXJufWA7XG4gICAgfVxuICAgIGRlYnVnKHFzLCB2YWx1ZXMpO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQuYW55KHFzLCB2YWx1ZXMpXG4gICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSBQb3N0Z3Jlc01pc3NpbmdDb2x1bW5FcnJvcikge1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pXG4gICAgICAudGhlbigocmVzdWx0cykgPT4ge1xuICAgICAgICBpZiAoIWlzTmVzdGVkKSB7XG4gICAgICAgICAgcmVzdWx0cyA9IHJlc3VsdHMuZmlsdGVyKChvYmplY3QpID0+IG9iamVjdFtmaWVsZF0gIT09IG51bGwpO1xuICAgICAgICAgIHJldHVybiByZXN1bHRzLm1hcChvYmplY3QgPT4ge1xuICAgICAgICAgICAgaWYgKCFpc1BvaW50ZXJGaWVsZCkge1xuICAgICAgICAgICAgICByZXR1cm4gb2JqZWN0W2ZpZWxkXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIF9fdHlwZTogJ1BvaW50ZXInLFxuICAgICAgICAgICAgICBjbGFzc05hbWU6ICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udGFyZ2V0Q2xhc3MsXG4gICAgICAgICAgICAgIG9iamVjdElkOiBvYmplY3RbZmllbGRdXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGNoaWxkID0gZmllbGROYW1lLnNwbGl0KCcuJylbMV07XG4gICAgICAgIHJldHVybiByZXN1bHRzLm1hcChvYmplY3QgPT4gb2JqZWN0W2NvbHVtbl1bY2hpbGRdKTtcbiAgICAgIH0pXG4gICAgICAudGhlbihyZXN1bHRzID0+IHJlc3VsdHMubWFwKG9iamVjdCA9PiB0aGlzLnBvc3RncmVzT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKSkpO1xuICB9XG5cbiAgYWdncmVnYXRlKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IGFueSwgcGlwZWxpbmU6IGFueSkge1xuICAgIGRlYnVnKCdhZ2dyZWdhdGUnLCBjbGFzc05hbWUsIHBpcGVsaW5lKTtcbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lXTtcbiAgICBsZXQgaW5kZXg6IG51bWJlciA9IDI7XG4gICAgbGV0IGNvbHVtbnM6IHN0cmluZ1tdID0gW107XG4gICAgbGV0IGNvdW50RmllbGQgPSBudWxsO1xuICAgIGxldCBncm91cFZhbHVlcyA9IG51bGw7XG4gICAgbGV0IHdoZXJlUGF0dGVybiA9ICcnO1xuICAgIGxldCBsaW1pdFBhdHRlcm4gPSAnJztcbiAgICBsZXQgc2tpcFBhdHRlcm4gPSAnJztcbiAgICBsZXQgc29ydFBhdHRlcm4gPSAnJztcbiAgICBsZXQgZ3JvdXBQYXR0ZXJuID0gJyc7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwaXBlbGluZS5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgY29uc3Qgc3RhZ2UgPSBwaXBlbGluZVtpXTtcbiAgICAgIGlmIChzdGFnZS4kZ3JvdXApIHtcbiAgICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBzdGFnZS4kZ3JvdXApIHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IHN0YWdlLiRncm91cFtmaWVsZF07XG4gICAgICAgICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoZmllbGQgPT09ICdfaWQnICYmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSAmJiB2YWx1ZSAhPT0gJycpIHtcbiAgICAgICAgICAgIGNvbHVtbnMucHVzaChgJCR7aW5kZXh9Om5hbWUgQVMgXCJvYmplY3RJZFwiYCk7XG4gICAgICAgICAgICBncm91cFBhdHRlcm4gPSBgR1JPVVAgQlkgJCR7aW5kZXh9Om5hbWVgO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2godHJhbnNmb3JtQWdncmVnYXRlRmllbGQodmFsdWUpKTtcbiAgICAgICAgICAgIGluZGV4ICs9IDE7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGZpZWxkID09PSAnX2lkJyAmJiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JykgJiYgT2JqZWN0LmtleXModmFsdWUpLmxlbmd0aCAhPT0gMCkge1xuICAgICAgICAgICAgZ3JvdXBWYWx1ZXMgPSB2YWx1ZTtcbiAgICAgICAgICAgIGNvbnN0IGdyb3VwQnlGaWVsZHMgPSBbXTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgYWxpYXMgaW4gdmFsdWUpIHtcbiAgICAgICAgICAgICAgY29uc3Qgb3BlcmF0aW9uID0gT2JqZWN0LmtleXModmFsdWVbYWxpYXNdKVswXTtcbiAgICAgICAgICAgICAgY29uc3Qgc291cmNlID0gdHJhbnNmb3JtQWdncmVnYXRlRmllbGQodmFsdWVbYWxpYXNdW29wZXJhdGlvbl0pO1xuICAgICAgICAgICAgICBpZiAobW9uZ29BZ2dyZWdhdGVUb1Bvc3RncmVzW29wZXJhdGlvbl0pIHtcbiAgICAgICAgICAgICAgICBpZiAoIWdyb3VwQnlGaWVsZHMuaW5jbHVkZXMoYFwiJHtzb3VyY2V9XCJgKSkge1xuICAgICAgICAgICAgICAgICAgZ3JvdXBCeUZpZWxkcy5wdXNoKGBcIiR7c291cmNlfVwiYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvbHVtbnMucHVzaChgRVhUUkFDVCgke21vbmdvQWdncmVnYXRlVG9Qb3N0Z3Jlc1tvcGVyYXRpb25dfSBGUk9NICQke2luZGV4fTpuYW1lIEFUIFRJTUUgWk9ORSAnVVRDJykgQVMgJCR7aW5kZXggKyAxfTpuYW1lYCk7XG4gICAgICAgICAgICAgICAgdmFsdWVzLnB1c2goc291cmNlLCBhbGlhcyk7XG4gICAgICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZ3JvdXBQYXR0ZXJuID0gYEdST1VQIEJZICQke2luZGV4fTpyYXdgO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2goZ3JvdXBCeUZpZWxkcy5qb2luKCkpO1xuICAgICAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodmFsdWUuJHN1bSkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZS4kc3VtID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICBjb2x1bW5zLnB1c2goYFNVTSgkJHtpbmRleH06bmFtZSkgQVMgJCR7aW5kZXggKyAxfTpuYW1lYCk7XG4gICAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlLiRzdW0pLCBmaWVsZCk7XG4gICAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjb3VudEZpZWxkID0gZmllbGQ7XG4gICAgICAgICAgICAgIGNvbHVtbnMucHVzaChgQ09VTlQoKikgQVMgJCR7aW5kZXh9Om5hbWVgKTtcbiAgICAgICAgICAgICAgdmFsdWVzLnB1c2goZmllbGQpO1xuICAgICAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodmFsdWUuJG1heCkge1xuICAgICAgICAgICAgY29sdW1ucy5wdXNoKGBNQVgoJCR7aW5kZXh9Om5hbWUpIEFTICQke2luZGV4ICsgMX06bmFtZWApO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2godHJhbnNmb3JtQWdncmVnYXRlRmllbGQodmFsdWUuJG1heCksIGZpZWxkKTtcbiAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh2YWx1ZS4kbWluKSB7XG4gICAgICAgICAgICBjb2x1bW5zLnB1c2goYE1JTigkJHtpbmRleH06bmFtZSkgQVMgJCR7aW5kZXggKyAxfTpuYW1lYCk7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaCh0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCh2YWx1ZS4kbWluKSwgZmllbGQpO1xuICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHZhbHVlLiRhdmcpIHtcbiAgICAgICAgICAgIGNvbHVtbnMucHVzaChgQVZHKCQke2luZGV4fTpuYW1lKSBBUyAkJHtpbmRleCArIDF9Om5hbWVgKTtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlLiRhdmcpLCBmaWVsZCk7XG4gICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29sdW1ucy5wdXNoKCcqJyk7XG4gICAgICB9XG4gICAgICBpZiAoc3RhZ2UuJHByb2plY3QpIHtcbiAgICAgICAgaWYgKGNvbHVtbnMuaW5jbHVkZXMoJyonKSkge1xuICAgICAgICAgIGNvbHVtbnMgPSBbXTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IGZpZWxkIGluIHN0YWdlLiRwcm9qZWN0KSB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBzdGFnZS4kcHJvamVjdFtmaWVsZF07XG4gICAgICAgICAgaWYgKCh2YWx1ZSA9PT0gMSB8fCB2YWx1ZSA9PT0gdHJ1ZSkpIHtcbiAgICAgICAgICAgIGNvbHVtbnMucHVzaChgJCR7aW5kZXh9Om5hbWVgKTtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkKTtcbiAgICAgICAgICAgIGluZGV4ICs9IDE7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoc3RhZ2UuJG1hdGNoKSB7XG4gICAgICAgIGNvbnN0IHBhdHRlcm5zID0gW107XG4gICAgICAgIGNvbnN0IG9yT3JBbmQgPSBzdGFnZS4kbWF0Y2guaGFzT3duUHJvcGVydHkoJyRvcicpID8gJyBPUiAnIDogJyBBTkQgJztcblxuICAgICAgICBpZiAoc3RhZ2UuJG1hdGNoLiRvcikge1xuICAgICAgICAgIGNvbnN0IGNvbGxhcHNlID0ge307XG4gICAgICAgICAgc3RhZ2UuJG1hdGNoLiRvci5mb3JFYWNoKChlbGVtZW50KSA9PiB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBlbGVtZW50KSB7XG4gICAgICAgICAgICAgIGNvbGxhcHNlW2tleV0gPSBlbGVtZW50W2tleV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgc3RhZ2UuJG1hdGNoID0gY29sbGFwc2U7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBzdGFnZS4kbWF0Y2gpIHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IHN0YWdlLiRtYXRjaFtmaWVsZF07XG4gICAgICAgICAgY29uc3QgbWF0Y2hQYXR0ZXJucyA9IFtdO1xuICAgICAgICAgIE9iamVjdC5rZXlzKFBhcnNlVG9Qb3NncmVzQ29tcGFyYXRvcikuZm9yRWFjaCgoY21wKSA9PiB7XG4gICAgICAgICAgICBpZiAodmFsdWVbY21wXSkge1xuICAgICAgICAgICAgICBjb25zdCBwZ0NvbXBhcmF0b3IgPSBQYXJzZVRvUG9zZ3Jlc0NvbXBhcmF0b3JbY21wXTtcbiAgICAgICAgICAgICAgbWF0Y2hQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSAke3BnQ29tcGFyYXRvcn0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICAgICAgICB2YWx1ZXMucHVzaChmaWVsZCwgdG9Qb3N0Z3Jlc1ZhbHVlKHZhbHVlW2NtcF0pKTtcbiAgICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgICBpZiAobWF0Y2hQYXR0ZXJucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAoJHttYXRjaFBhdHRlcm5zLmpvaW4oJyBBTkQgJyl9KWApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZF0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSAmJiBtYXRjaFBhdHRlcm5zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaChmaWVsZCwgdmFsdWUpO1xuICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgd2hlcmVQYXR0ZXJuID0gcGF0dGVybnMubGVuZ3RoID4gMCA/IGBXSEVSRSAke3BhdHRlcm5zLmpvaW4oYCAke29yT3JBbmR9IGApfWAgOiAnJztcbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kbGltaXQpIHtcbiAgICAgICAgbGltaXRQYXR0ZXJuID0gYExJTUlUICQke2luZGV4fWA7XG4gICAgICAgIHZhbHVlcy5wdXNoKHN0YWdlLiRsaW1pdCk7XG4gICAgICAgIGluZGV4ICs9IDE7XG4gICAgICB9XG4gICAgICBpZiAoc3RhZ2UuJHNraXApIHtcbiAgICAgICAgc2tpcFBhdHRlcm4gPSBgT0ZGU0VUICQke2luZGV4fWA7XG4gICAgICAgIHZhbHVlcy5wdXNoKHN0YWdlLiRza2lwKTtcbiAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kc29ydCkge1xuICAgICAgICBjb25zdCBzb3J0ID0gc3RhZ2UuJHNvcnQ7XG4gICAgICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhzb3J0KTtcbiAgICAgICAgY29uc3Qgc29ydGluZyA9IGtleXMubWFwKChrZXkpID0+IHtcbiAgICAgICAgICBjb25zdCB0cmFuc2Zvcm1lciA9IHNvcnRba2V5XSA9PT0gMSA/ICdBU0MnIDogJ0RFU0MnO1xuICAgICAgICAgIGNvbnN0IG9yZGVyID0gYCQke2luZGV4fTpuYW1lICR7dHJhbnNmb3JtZXJ9YDtcbiAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgIHJldHVybiBvcmRlcjtcbiAgICAgICAgfSkuam9pbigpO1xuICAgICAgICB2YWx1ZXMucHVzaCguLi5rZXlzKTtcbiAgICAgICAgc29ydFBhdHRlcm4gPSBzb3J0ICE9PSB1bmRlZmluZWQgJiYgc29ydGluZy5sZW5ndGggPiAwID8gYE9SREVSIEJZICR7c29ydGluZ31gIDogJyc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcXMgPSBgU0VMRUNUICR7Y29sdW1ucy5qb2luKCl9IEZST00gJDE6bmFtZSAke3doZXJlUGF0dGVybn0gJHtzb3J0UGF0dGVybn0gJHtsaW1pdFBhdHRlcm59ICR7c2tpcFBhdHRlcm59ICR7Z3JvdXBQYXR0ZXJufWA7XG4gICAgZGVidWcocXMsIHZhbHVlcyk7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC5tYXAocXMsIHZhbHVlcywgYSA9PiB0aGlzLnBvc3RncmVzT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWUsIGEsIHNjaGVtYSkpXG4gICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgcmVzdWx0cy5mb3JFYWNoKHJlc3VsdCA9PiB7XG4gICAgICAgICAgaWYgKCFyZXN1bHQuaGFzT3duUHJvcGVydHkoJ29iamVjdElkJykpIHtcbiAgICAgICAgICAgIHJlc3VsdC5vYmplY3RJZCA9IG51bGw7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChncm91cFZhbHVlcykge1xuICAgICAgICAgICAgcmVzdWx0Lm9iamVjdElkID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBncm91cFZhbHVlcykge1xuICAgICAgICAgICAgICByZXN1bHQub2JqZWN0SWRba2V5XSA9IHJlc3VsdFtrZXldO1xuICAgICAgICAgICAgICBkZWxldGUgcmVzdWx0W2tleV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChjb3VudEZpZWxkKSB7XG4gICAgICAgICAgICByZXN1bHRbY291bnRGaWVsZF0gPSBwYXJzZUludChyZXN1bHRbY291bnRGaWVsZF0sIDEwKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVzdWx0cztcbiAgICAgIH0pO1xuICB9XG5cbiAgcGVyZm9ybUluaXRpYWxpemF0aW9uKHsgVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyB9OiBhbnkpIHtcbiAgICAvLyBUT0RPOiBUaGlzIG1ldGhvZCBuZWVkcyB0byBiZSByZXdyaXR0ZW4gdG8gbWFrZSBwcm9wZXIgdXNlIG9mIGNvbm5lY3Rpb25zIChAdml0YWx5LXQpXG4gICAgZGVidWcoJ3BlcmZvcm1Jbml0aWFsaXphdGlvbicpO1xuICAgIGNvbnN0IHByb21pc2VzID0gVm9sYXRpbGVDbGFzc2VzU2NoZW1hcy5tYXAoKHNjaGVtYSkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVGFibGUoc2NoZW1hLmNsYXNzTmFtZSwgc2NoZW1hKVxuICAgICAgICAuY2F0Y2goKGVycikgPT4ge1xuICAgICAgICAgIGlmIChlcnIuY29kZSA9PT0gUG9zdGdyZXNEdXBsaWNhdGVSZWxhdGlvbkVycm9yIHx8IGVyci5jb2RlID09PSBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUpIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbigoKSA9PiB0aGlzLnNjaGVtYVVwZ3JhZGUoc2NoZW1hLmNsYXNzTmFtZSwgc2NoZW1hKSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5fY2xpZW50LnR4KCdwZXJmb3JtLWluaXRpYWxpemF0aW9uJywgdCA9PiB7XG4gICAgICAgICAgcmV0dXJuIHQuYmF0Y2goW1xuICAgICAgICAgICAgdC5ub25lKHNxbC5taXNjLmpzb25PYmplY3RTZXRLZXlzKSxcbiAgICAgICAgICAgIHQubm9uZShzcWwuYXJyYXkuYWRkKSxcbiAgICAgICAgICAgIHQubm9uZShzcWwuYXJyYXkuYWRkVW5pcXVlKSxcbiAgICAgICAgICAgIHQubm9uZShzcWwuYXJyYXkucmVtb3ZlKSxcbiAgICAgICAgICAgIHQubm9uZShzcWwuYXJyYXkuY29udGFpbnNBbGwpLFxuICAgICAgICAgICAgdC5ub25lKHNxbC5hcnJheS5jb250YWluc0FsbFJlZ2V4KSxcbiAgICAgICAgICAgIHQubm9uZShzcWwuYXJyYXkuY29udGFpbnMpXG4gICAgICAgICAgXSk7XG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICAgIC50aGVuKGRhdGEgPT4ge1xuICAgICAgICBkZWJ1ZyhgaW5pdGlhbGl6YXRpb25Eb25lIGluICR7ZGF0YS5kdXJhdGlvbn1gKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAvKiBlc2xpbnQtZGlzYWJsZSBuby1jb25zb2xlICovXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xuICAgICAgfSk7XG4gIH1cblxuICBjcmVhdGVJbmRleGVzKGNsYXNzTmFtZTogc3RyaW5nLCBpbmRleGVzOiBhbnksIGNvbm46ID9hbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gKGNvbm4gfHwgdGhpcy5fY2xpZW50KS50eCh0ID0+IHQuYmF0Y2goaW5kZXhlcy5tYXAoaSA9PiB7XG4gICAgICByZXR1cm4gdC5ub25lKCdDUkVBVEUgSU5ERVggJDE6bmFtZSBPTiAkMjpuYW1lICgkMzpuYW1lKScsIFtpLm5hbWUsIGNsYXNzTmFtZSwgaS5rZXldKTtcbiAgICB9KSkpO1xuICB9XG5cbiAgY3JlYXRlSW5kZXhlc0lmTmVlZGVkKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZE5hbWU6IHN0cmluZywgdHlwZTogYW55LCBjb25uOiA/YW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIChjb25uIHx8IHRoaXMuX2NsaWVudCkubm9uZSgnQ1JFQVRFIElOREVYICQxOm5hbWUgT04gJDI6bmFtZSAoJDM6bmFtZSknLCBbZmllbGROYW1lLCBjbGFzc05hbWUsIHR5cGVdKTtcbiAgfVxuXG4gIGRyb3BJbmRleGVzKGNsYXNzTmFtZTogc3RyaW5nLCBpbmRleGVzOiBhbnksIGNvbm46IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHF1ZXJpZXMgPSBpbmRleGVzLm1hcChpID0+ICh7cXVlcnk6ICdEUk9QIElOREVYICQxOm5hbWUnLCB2YWx1ZXM6IGl9KSk7XG4gICAgcmV0dXJuIChjb25uIHx8IHRoaXMuX2NsaWVudCkudHgodCA9PiB0Lm5vbmUodGhpcy5fcGdwLmhlbHBlcnMuY29uY2F0KHF1ZXJpZXMpKSk7XG4gIH1cblxuICBnZXRJbmRleGVzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3QgcXMgPSAnU0VMRUNUICogRlJPTSBwZ19pbmRleGVzIFdIRVJFIHRhYmxlbmFtZSA9ICR7Y2xhc3NOYW1lfSc7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC5hbnkocXMsIHtjbGFzc05hbWV9KTtcbiAgfVxuXG4gIHVwZGF0ZVNjaGVtYVdpdGhJbmRleGVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb252ZXJ0UG9seWdvblRvU1FMKHBvbHlnb24pIHtcbiAgaWYgKHBvbHlnb24ubGVuZ3RoIDwgMykge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgIGBQb2x5Z29uIG11c3QgaGF2ZSBhdCBsZWFzdCAzIHZhbHVlc2BcbiAgICApO1xuICB9XG4gIGlmIChwb2x5Z29uWzBdWzBdICE9PSBwb2x5Z29uW3BvbHlnb24ubGVuZ3RoIC0gMV1bMF0gfHxcbiAgICBwb2x5Z29uWzBdWzFdICE9PSBwb2x5Z29uW3BvbHlnb24ubGVuZ3RoIC0gMV1bMV0pIHtcbiAgICBwb2x5Z29uLnB1c2gocG9seWdvblswXSk7XG4gIH1cbiAgY29uc3QgdW5pcXVlID0gcG9seWdvbi5maWx0ZXIoKGl0ZW0sIGluZGV4LCBhcikgPT4ge1xuICAgIGxldCBmb3VuZEluZGV4ID0gLTE7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhci5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgY29uc3QgcHQgPSBhcltpXTtcbiAgICAgIGlmIChwdFswXSA9PT0gaXRlbVswXSAmJlxuICAgICAgICAgIHB0WzFdID09PSBpdGVtWzFdKSB7XG4gICAgICAgIGZvdW5kSW5kZXggPSBpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZvdW5kSW5kZXggPT09IGluZGV4O1xuICB9KTtcbiAgaWYgKHVuaXF1ZS5sZW5ndGggPCAzKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5URVJOQUxfU0VSVkVSX0VSUk9SLFxuICAgICAgJ0dlb0pTT046IExvb3AgbXVzdCBoYXZlIGF0IGxlYXN0IDMgZGlmZmVyZW50IHZlcnRpY2VzJ1xuICAgICk7XG4gIH1cbiAgY29uc3QgcG9pbnRzID0gcG9seWdvbi5tYXAoKHBvaW50KSA9PiB7XG4gICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBhcnNlRmxvYXQocG9pbnRbMV0pLCBwYXJzZUZsb2F0KHBvaW50WzBdKSk7XG4gICAgcmV0dXJuIGAoJHtwb2ludFsxXX0sICR7cG9pbnRbMF19KWA7XG4gIH0pLmpvaW4oJywgJyk7XG4gIHJldHVybiBgKCR7cG9pbnRzfSlgO1xufVxuXG5mdW5jdGlvbiByZW1vdmVXaGl0ZVNwYWNlKHJlZ2V4KSB7XG4gIGlmICghcmVnZXguZW5kc1dpdGgoJ1xcbicpKXtcbiAgICByZWdleCArPSAnXFxuJztcbiAgfVxuXG4gIC8vIHJlbW92ZSBub24gZXNjYXBlZCBjb21tZW50c1xuICByZXR1cm4gcmVnZXgucmVwbGFjZSgvKFteXFxcXF0pIy4qXFxuL2dtaSwgJyQxJylcbiAgICAvLyByZW1vdmUgbGluZXMgc3RhcnRpbmcgd2l0aCBhIGNvbW1lbnRcbiAgICAucmVwbGFjZSgvXiMuKlxcbi9nbWksICcnKVxuICAgIC8vIHJlbW92ZSBub24gZXNjYXBlZCB3aGl0ZXNwYWNlXG4gICAgLnJlcGxhY2UoLyhbXlxcXFxdKVxccysvZ21pLCAnJDEnKVxuICAgIC8vIHJlbW92ZSB3aGl0ZXNwYWNlIGF0IHRoZSBiZWdpbm5pbmcgb2YgYSBsaW5lXG4gICAgLnJlcGxhY2UoL15cXHMrLywgJycpXG4gICAgLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gcHJvY2Vzc1JlZ2V4UGF0dGVybihzKSB7XG4gIGlmIChzICYmIHMuc3RhcnRzV2l0aCgnXicpKXtcbiAgICAvLyByZWdleCBmb3Igc3RhcnRzV2l0aFxuICAgIHJldHVybiAnXicgKyBsaXRlcmFsaXplUmVnZXhQYXJ0KHMuc2xpY2UoMSkpO1xuXG4gIH0gZWxzZSBpZiAocyAmJiBzLmVuZHNXaXRoKCckJykpIHtcbiAgICAvLyByZWdleCBmb3IgZW5kc1dpdGhcbiAgICByZXR1cm4gbGl0ZXJhbGl6ZVJlZ2V4UGFydChzLnNsaWNlKDAsIHMubGVuZ3RoIC0gMSkpICsgJyQnO1xuICB9XG5cbiAgLy8gcmVnZXggZm9yIGNvbnRhaW5zXG4gIHJldHVybiBsaXRlcmFsaXplUmVnZXhQYXJ0KHMpO1xufVxuXG5mdW5jdGlvbiBpc1N0YXJ0c1dpdGhSZWdleCh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycgfHwgIXZhbHVlLnN0YXJ0c1dpdGgoJ14nKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGNvbnN0IG1hdGNoZXMgPSB2YWx1ZS5tYXRjaCgvXFxeXFxcXFEuKlxcXFxFLyk7XG4gIHJldHVybiAhIW1hdGNoZXM7XG59XG5cbmZ1bmN0aW9uIGlzQWxsVmFsdWVzUmVnZXhPck5vbmUodmFsdWVzKSB7XG4gIGlmICghdmFsdWVzIHx8ICFBcnJheS5pc0FycmF5KHZhbHVlcykgfHwgdmFsdWVzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgY29uc3QgZmlyc3RWYWx1ZXNJc1JlZ2V4ID0gaXNTdGFydHNXaXRoUmVnZXgodmFsdWVzWzBdLiRyZWdleCk7XG4gIGlmICh2YWx1ZXMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIGZpcnN0VmFsdWVzSXNSZWdleDtcbiAgfVxuXG4gIGZvciAobGV0IGkgPSAxLCBsZW5ndGggPSB2YWx1ZXMubGVuZ3RoOyBpIDwgbGVuZ3RoOyArK2kpIHtcbiAgICBpZiAoZmlyc3RWYWx1ZXNJc1JlZ2V4ICE9PSBpc1N0YXJ0c1dpdGhSZWdleCh2YWx1ZXNbaV0uJHJlZ2V4KSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBpc0FueVZhbHVlUmVnZXhTdGFydHNXaXRoKHZhbHVlcykge1xuICByZXR1cm4gdmFsdWVzLnNvbWUoZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgcmV0dXJuIGlzU3RhcnRzV2l0aFJlZ2V4KHZhbHVlLiRyZWdleCk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVMaXRlcmFsUmVnZXgocmVtYWluaW5nKSB7XG4gIHJldHVybiByZW1haW5pbmcuc3BsaXQoJycpLm1hcChjID0+IHtcbiAgICBpZiAoYy5tYXRjaCgvWzAtOWEtekEtWl0vKSAhPT0gbnVsbCkge1xuICAgICAgLy8gZG9uJ3QgZXNjYXBlIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzXG4gICAgICByZXR1cm4gYztcbiAgICB9XG4gICAgLy8gZXNjYXBlIGV2ZXJ5dGhpbmcgZWxzZSAoc2luZ2xlIHF1b3RlcyB3aXRoIHNpbmdsZSBxdW90ZXMsIGV2ZXJ5dGhpbmcgZWxzZSB3aXRoIGEgYmFja3NsYXNoKVxuICAgIHJldHVybiBjID09PSBgJ2AgPyBgJydgIDogYFxcXFwke2N9YDtcbiAgfSkuam9pbignJyk7XG59XG5cbmZ1bmN0aW9uIGxpdGVyYWxpemVSZWdleFBhcnQoczogc3RyaW5nKSB7XG4gIGNvbnN0IG1hdGNoZXIxID0gL1xcXFxRKCg/IVxcXFxFKS4qKVxcXFxFJC9cbiAgY29uc3QgcmVzdWx0MTogYW55ID0gcy5tYXRjaChtYXRjaGVyMSk7XG4gIGlmKHJlc3VsdDEgJiYgcmVzdWx0MS5sZW5ndGggPiAxICYmIHJlc3VsdDEuaW5kZXggPiAtMSkge1xuICAgIC8vIHByb2Nlc3MgcmVnZXggdGhhdCBoYXMgYSBiZWdpbm5pbmcgYW5kIGFuIGVuZCBzcGVjaWZpZWQgZm9yIHRoZSBsaXRlcmFsIHRleHRcbiAgICBjb25zdCBwcmVmaXggPSBzLnN1YnN0cigwLCByZXN1bHQxLmluZGV4KTtcbiAgICBjb25zdCByZW1haW5pbmcgPSByZXN1bHQxWzFdO1xuXG4gICAgcmV0dXJuIGxpdGVyYWxpemVSZWdleFBhcnQocHJlZml4KSArIGNyZWF0ZUxpdGVyYWxSZWdleChyZW1haW5pbmcpO1xuICB9XG5cbiAgLy8gcHJvY2VzcyByZWdleCB0aGF0IGhhcyBhIGJlZ2lubmluZyBzcGVjaWZpZWQgZm9yIHRoZSBsaXRlcmFsIHRleHRcbiAgY29uc3QgbWF0Y2hlcjIgPSAvXFxcXFEoKD8hXFxcXEUpLiopJC9cbiAgY29uc3QgcmVzdWx0MjogYW55ID0gcy5tYXRjaChtYXRjaGVyMik7XG4gIGlmKHJlc3VsdDIgJiYgcmVzdWx0Mi5sZW5ndGggPiAxICYmIHJlc3VsdDIuaW5kZXggPiAtMSl7XG4gICAgY29uc3QgcHJlZml4ID0gcy5zdWJzdHIoMCwgcmVzdWx0Mi5pbmRleCk7XG4gICAgY29uc3QgcmVtYWluaW5nID0gcmVzdWx0MlsxXTtcblxuICAgIHJldHVybiBsaXRlcmFsaXplUmVnZXhQYXJ0KHByZWZpeCkgKyBjcmVhdGVMaXRlcmFsUmVnZXgocmVtYWluaW5nKTtcbiAgfVxuXG4gIC8vIHJlbW92ZSBhbGwgaW5zdGFuY2VzIG9mIFxcUSBhbmQgXFxFIGZyb20gdGhlIHJlbWFpbmluZyB0ZXh0ICYgZXNjYXBlIHNpbmdsZSBxdW90ZXNcbiAgcmV0dXJuIChcbiAgICBzLnJlcGxhY2UoLyhbXlxcXFxdKShcXFxcRSkvLCAnJDEnKVxuICAgICAgLnJlcGxhY2UoLyhbXlxcXFxdKShcXFxcUSkvLCAnJDEnKVxuICAgICAgLnJlcGxhY2UoL15cXFxcRS8sICcnKVxuICAgICAgLnJlcGxhY2UoL15cXFxcUS8sICcnKVxuICAgICAgLnJlcGxhY2UoLyhbXiddKScvLCBgJDEnJ2ApXG4gICAgICAucmVwbGFjZSgvXicoW14nXSkvLCBgJyckMWApXG4gICk7XG59XG5cbnZhciBHZW9Qb2ludENvZGVyID0ge1xuICBpc1ZhbGlkSlNPTih2YWx1ZSkge1xuICAgIHJldHVybiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICAgIHZhbHVlLl9fdHlwZSA9PT0gJ0dlb1BvaW50J1xuICAgICk7XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IFBvc3RncmVzU3RvcmFnZUFkYXB0ZXI7XG4iXX0=