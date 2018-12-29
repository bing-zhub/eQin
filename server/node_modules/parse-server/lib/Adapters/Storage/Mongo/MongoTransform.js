'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _logger = require('../../../logger');

var _logger2 = _interopRequireDefault(_logger);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var mongodb = require('mongodb');
var Parse = require('parse/node').Parse;

const transformKey = (className, fieldName, schema) => {
  // Check if the schema is known since it's a built-in field.
  switch (fieldName) {
    case 'objectId':
      return '_id';
    case 'createdAt':
      return '_created_at';
    case 'updatedAt':
      return '_updated_at';
    case 'sessionToken':
      return '_session_token';
    case 'lastUsed':
      return '_last_used';
    case 'timesUsed':
      return 'times_used';
  }

  if (schema.fields[fieldName] && schema.fields[fieldName].__type == 'Pointer') {
    fieldName = '_p_' + fieldName;
  } else if (schema.fields[fieldName] && schema.fields[fieldName].type == 'Pointer') {
    fieldName = '_p_' + fieldName;
  }

  return fieldName;
};

const transformKeyValueForUpdate = (className, restKey, restValue, parseFormatSchema) => {
  // Check if the schema is known since it's a built-in field.
  var key = restKey;
  var timeField = false;
  switch (key) {
    case 'objectId':
    case '_id':
      if (className === '_GlobalConfig') {
        return {
          key: key,
          value: parseInt(restValue)
        };
      }
      key = '_id';
      break;
    case 'createdAt':
    case '_created_at':
      key = '_created_at';
      timeField = true;
      break;
    case 'updatedAt':
    case '_updated_at':
      key = '_updated_at';
      timeField = true;
      break;
    case 'sessionToken':
    case '_session_token':
      key = '_session_token';
      break;
    case 'expiresAt':
    case '_expiresAt':
      key = 'expiresAt';
      timeField = true;
      break;
    case '_email_verify_token_expires_at':
      key = '_email_verify_token_expires_at';
      timeField = true;
      break;
    case '_account_lockout_expires_at':
      key = '_account_lockout_expires_at';
      timeField = true;
      break;
    case '_failed_login_count':
      key = '_failed_login_count';
      break;
    case '_perishable_token_expires_at':
      key = '_perishable_token_expires_at';
      timeField = true;
      break;
    case '_password_changed_at':
      key = '_password_changed_at';
      timeField = true;
      break;
    case '_rperm':
    case '_wperm':
      return { key: key, value: restValue };
    case 'lastUsed':
    case '_last_used':
      key = '_last_used';
      timeField = true;
      break;
    case 'timesUsed':
    case 'times_used':
      key = 'times_used';
      timeField = true;
      break;
  }

  if (parseFormatSchema.fields[key] && parseFormatSchema.fields[key].type === 'Pointer' || !parseFormatSchema.fields[key] && restValue && restValue.__type == 'Pointer') {
    key = '_p_' + key;
  }

  // Handle atomic values
  var value = transformTopLevelAtom(restValue);
  if (value !== CannotTransform) {
    if (timeField && typeof value === 'string') {
      value = new Date(value);
    }
    if (restKey.indexOf('.') > 0) {
      return { key, value: restValue };
    }
    return { key, value };
  }

  // Handle arrays
  if (restValue instanceof Array) {
    value = restValue.map(transformInteriorValue);
    return { key, value };
  }

  // Handle update operators
  if (typeof restValue === 'object' && '__op' in restValue) {
    return { key, value: transformUpdateOperator(restValue, false) };
  }

  // Handle normal objects by recursing
  value = mapValues(restValue, transformInteriorValue);
  return { key, value };
};

const isRegex = value => {
  return value && value instanceof RegExp;
};

const isStartsWithRegex = value => {
  if (!isRegex(value)) {
    return false;
  }

  const matches = value.toString().match(/\/\^\\Q.*\\E\//);
  return !!matches;
};

const isAllValuesRegexOrNone = values => {
  if (!values || !Array.isArray(values) || values.length === 0) {
    return true;
  }

  const firstValuesIsRegex = isStartsWithRegex(values[0]);
  if (values.length === 1) {
    return firstValuesIsRegex;
  }

  for (let i = 1, length = values.length; i < length; ++i) {
    if (firstValuesIsRegex !== isStartsWithRegex(values[i])) {
      return false;
    }
  }

  return true;
};

const isAnyValueRegex = values => {
  return values.some(function (value) {
    return isRegex(value);
  });
};

const transformInteriorValue = restValue => {
  if (restValue !== null && typeof restValue === 'object' && Object.keys(restValue).some(key => key.includes('$') || key.includes('.'))) {
    throw new Parse.Error(Parse.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
  }
  // Handle atomic values
  var value = transformInteriorAtom(restValue);
  if (value !== CannotTransform) {
    return value;
  }

  // Handle arrays
  if (restValue instanceof Array) {
    return restValue.map(transformInteriorValue);
  }

  // Handle update operators
  if (typeof restValue === 'object' && '__op' in restValue) {
    return transformUpdateOperator(restValue, true);
  }

  // Handle normal objects by recursing
  return mapValues(restValue, transformInteriorValue);
};

const valueAsDate = value => {
  if (typeof value === 'string') {
    return new Date(value);
  } else if (value instanceof Date) {
    return value;
  }
  return false;
};

function transformQueryKeyValue(className, key, value, schema) {
  switch (key) {
    case 'createdAt':
      if (valueAsDate(value)) {
        return { key: '_created_at', value: valueAsDate(value) };
      }
      key = '_created_at';
      break;
    case 'updatedAt':
      if (valueAsDate(value)) {
        return { key: '_updated_at', value: valueAsDate(value) };
      }
      key = '_updated_at';
      break;
    case 'expiresAt':
      if (valueAsDate(value)) {
        return { key: 'expiresAt', value: valueAsDate(value) };
      }
      break;
    case '_email_verify_token_expires_at':
      if (valueAsDate(value)) {
        return { key: '_email_verify_token_expires_at', value: valueAsDate(value) };
      }
      break;
    case 'objectId':
      {
        if (className === '_GlobalConfig') {
          value = parseInt(value);
        }
        return { key: '_id', value };
      }
    case '_account_lockout_expires_at':
      if (valueAsDate(value)) {
        return { key: '_account_lockout_expires_at', value: valueAsDate(value) };
      }
      break;
    case '_failed_login_count':
      return { key, value };
    case 'sessionToken':
      return { key: '_session_token', value };
    case '_perishable_token_expires_at':
      if (valueAsDate(value)) {
        return { key: '_perishable_token_expires_at', value: valueAsDate(value) };
      }
      break;
    case '_password_changed_at':
      if (valueAsDate(value)) {
        return { key: '_password_changed_at', value: valueAsDate(value) };
      }
      break;
    case '_rperm':
    case '_wperm':
    case '_perishable_token':
    case '_email_verify_token':
      return { key, value };
    case '$or':
    case '$and':
    case '$nor':
      return { key: key, value: value.map(subQuery => transformWhere(className, subQuery, schema)) };
    case 'lastUsed':
      if (valueAsDate(value)) {
        return { key: '_last_used', value: valueAsDate(value) };
      }
      key = '_last_used';
      break;
    case 'timesUsed':
      return { key: 'times_used', value: value };
    default:
      {
        // Other auth data
        const authDataMatch = key.match(/^authData\.([a-zA-Z0-9_]+)\.id$/);
        if (authDataMatch) {
          const provider = authDataMatch[1];
          // Special-case auth data.
          return { key: `_auth_data_${provider}.id`, value };
        }
      }
  }

  const expectedTypeIsArray = schema && schema.fields[key] && schema.fields[key].type === 'Array';

  const expectedTypeIsPointer = schema && schema.fields[key] && schema.fields[key].type === 'Pointer';

  const field = schema && schema.fields[key];
  if (expectedTypeIsPointer || !schema && value && value.__type === 'Pointer') {
    key = '_p_' + key;
  }

  // Handle query constraints
  const transformedConstraint = transformConstraint(value, field);
  if (transformedConstraint !== CannotTransform) {
    if (transformedConstraint.$text) {
      return { key: '$text', value: transformedConstraint.$text };
    }
    if (transformedConstraint.$elemMatch) {
      return { key: '$nor', value: [{ [key]: transformedConstraint }] };
    }
    return { key, value: transformedConstraint };
  }

  if (expectedTypeIsArray && !(value instanceof Array)) {
    return { key, value: { '$all': [transformInteriorAtom(value)] } };
  }

  // Handle atomic values
  if (transformTopLevelAtom(value) !== CannotTransform) {
    return { key, value: transformTopLevelAtom(value) };
  } else {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `You cannot use ${value} as a query parameter.`);
  }
}

// Main exposed method to help run queries.
// restWhere is the "where" clause in REST API form.
// Returns the mongo form of the query.
function transformWhere(className, restWhere, schema) {
  const mongoWhere = {};
  for (const restKey in restWhere) {
    const out = transformQueryKeyValue(className, restKey, restWhere[restKey], schema);
    mongoWhere[out.key] = out.value;
  }
  return mongoWhere;
}

const parseObjectKeyValueToMongoObjectKeyValue = (restKey, restValue, schema) => {
  // Check if the schema is known since it's a built-in field.
  let transformedValue;
  let coercedToDate;
  switch (restKey) {
    case 'objectId':
      return { key: '_id', value: restValue };
    case 'expiresAt':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: 'expiresAt', value: coercedToDate };
    case '_email_verify_token_expires_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: '_email_verify_token_expires_at', value: coercedToDate };
    case '_account_lockout_expires_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: '_account_lockout_expires_at', value: coercedToDate };
    case '_perishable_token_expires_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: '_perishable_token_expires_at', value: coercedToDate };
    case '_password_changed_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: '_password_changed_at', value: coercedToDate };
    case '_failed_login_count':
    case '_rperm':
    case '_wperm':
    case '_email_verify_token':
    case '_hashed_password':
    case '_perishable_token':
      return { key: restKey, value: restValue };
    case 'sessionToken':
      return { key: '_session_token', value: restValue };
    default:
      // Auth data should have been transformed already
      if (restKey.match(/^authData\.([a-zA-Z0-9_]+)\.id$/)) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'can only query on ' + restKey);
      }
      // Trust that the auth data has been transformed and save it directly
      if (restKey.match(/^_auth_data_[a-zA-Z0-9_]+$/)) {
        return { key: restKey, value: restValue };
      }
  }
  //skip straight to transformTopLevelAtom for Bytes, they don't show up in the schema for some reason
  if (restValue && restValue.__type !== 'Bytes') {
    //Note: We may not know the type of a field here, as the user could be saving (null) to a field
    //That never existed before, meaning we can't infer the type.
    if (schema.fields[restKey] && schema.fields[restKey].type == 'Pointer' || restValue.__type == 'Pointer') {
      restKey = '_p_' + restKey;
    }
  }

  // Handle atomic values
  var value = transformTopLevelAtom(restValue);
  if (value !== CannotTransform) {
    return { key: restKey, value: value };
  }

  // ACLs are handled before this method is called
  // If an ACL key still exists here, something is wrong.
  if (restKey === 'ACL') {
    throw 'There was a problem transforming an ACL.';
  }

  // Handle arrays
  if (restValue instanceof Array) {
    value = restValue.map(transformInteriorValue);
    return { key: restKey, value: value };
  }

  // Handle normal objects by recursing
  if (Object.keys(restValue).some(key => key.includes('$') || key.includes('.'))) {
    throw new Parse.Error(Parse.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
  }
  value = mapValues(restValue, transformInteriorValue);
  return { key: restKey, value };
};

const parseObjectToMongoObjectForCreate = (className, restCreate, schema) => {
  restCreate = addLegacyACL(restCreate);
  const mongoCreate = {};
  for (const restKey in restCreate) {
    if (restCreate[restKey] && restCreate[restKey].__type === 'Relation') {
      continue;
    }
    const { key, value } = parseObjectKeyValueToMongoObjectKeyValue(restKey, restCreate[restKey], schema);
    if (value !== undefined) {
      mongoCreate[key] = value;
    }
  }

  // Use the legacy mongo format for createdAt and updatedAt
  if (mongoCreate.createdAt) {
    mongoCreate._created_at = new Date(mongoCreate.createdAt.iso || mongoCreate.createdAt);
    delete mongoCreate.createdAt;
  }
  if (mongoCreate.updatedAt) {
    mongoCreate._updated_at = new Date(mongoCreate.updatedAt.iso || mongoCreate.updatedAt);
    delete mongoCreate.updatedAt;
  }

  return mongoCreate;
};

// Main exposed method to help update old objects.
const transformUpdate = (className, restUpdate, parseFormatSchema) => {
  const mongoUpdate = {};
  const acl = addLegacyACL(restUpdate);
  if (acl._rperm || acl._wperm || acl._acl) {
    mongoUpdate.$set = {};
    if (acl._rperm) {
      mongoUpdate.$set._rperm = acl._rperm;
    }
    if (acl._wperm) {
      mongoUpdate.$set._wperm = acl._wperm;
    }
    if (acl._acl) {
      mongoUpdate.$set._acl = acl._acl;
    }
  }
  for (var restKey in restUpdate) {
    if (restUpdate[restKey] && restUpdate[restKey].__type === 'Relation') {
      continue;
    }
    var out = transformKeyValueForUpdate(className, restKey, restUpdate[restKey], parseFormatSchema);

    // If the output value is an object with any $ keys, it's an
    // operator that needs to be lifted onto the top level update
    // object.
    if (typeof out.value === 'object' && out.value !== null && out.value.__op) {
      mongoUpdate[out.value.__op] = mongoUpdate[out.value.__op] || {};
      mongoUpdate[out.value.__op][out.key] = out.value.arg;
    } else {
      mongoUpdate['$set'] = mongoUpdate['$set'] || {};
      mongoUpdate['$set'][out.key] = out.value;
    }
  }

  return mongoUpdate;
};

// Add the legacy _acl format.
const addLegacyACL = restObject => {
  const restObjectCopy = _extends({}, restObject);
  const _acl = {};

  if (restObject._wperm) {
    restObject._wperm.forEach(entry => {
      _acl[entry] = { w: true };
    });
    restObjectCopy._acl = _acl;
  }

  if (restObject._rperm) {
    restObject._rperm.forEach(entry => {
      if (!(entry in _acl)) {
        _acl[entry] = { r: true };
      } else {
        _acl[entry].r = true;
      }
    });
    restObjectCopy._acl = _acl;
  }

  return restObjectCopy;
};

// A sentinel value that helper transformations return when they
// cannot perform a transformation
function CannotTransform() {}

const transformInteriorAtom = atom => {
  // TODO: check validity harder for the __type-defined types
  if (typeof atom === 'object' && atom && !(atom instanceof Date) && atom.__type === 'Pointer') {
    return {
      __type: 'Pointer',
      className: atom.className,
      objectId: atom.objectId
    };
  } else if (typeof atom === 'function' || typeof atom === 'symbol') {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `cannot transform value: ${atom}`);
  } else if (DateCoder.isValidJSON(atom)) {
    return DateCoder.JSONToDatabase(atom);
  } else if (BytesCoder.isValidJSON(atom)) {
    return BytesCoder.JSONToDatabase(atom);
  } else if (typeof atom === 'object' && atom && atom.$regex !== undefined) {
    return new RegExp(atom.$regex);
  } else {
    return atom;
  }
};

// Helper function to transform an atom from REST format to Mongo format.
// An atom is anything that can't contain other expressions. So it
// includes things where objects are used to represent other
// datatypes, like pointers and dates, but it does not include objects
// or arrays with generic stuff inside.
// Raises an error if this cannot possibly be valid REST format.
// Returns CannotTransform if it's just not an atom
function transformTopLevelAtom(atom, field) {
  switch (typeof atom) {
    case 'number':
    case 'boolean':
    case 'undefined':
      return atom;
    case 'string':
      if (field && field.type === 'Pointer') {
        return `${field.targetClass}$${atom}`;
      }
      return atom;
    case 'symbol':
    case 'function':
      throw new Parse.Error(Parse.Error.INVALID_JSON, `cannot transform value: ${atom}`);
    case 'object':
      if (atom instanceof Date) {
        // Technically dates are not rest format, but, it seems pretty
        // clear what they should be transformed to, so let's just do it.
        return atom;
      }

      if (atom === null) {
        return atom;
      }

      // TODO: check validity harder for the __type-defined types
      if (atom.__type == 'Pointer') {
        return `${atom.className}$${atom.objectId}`;
      }
      if (DateCoder.isValidJSON(atom)) {
        return DateCoder.JSONToDatabase(atom);
      }
      if (BytesCoder.isValidJSON(atom)) {
        return BytesCoder.JSONToDatabase(atom);
      }
      if (GeoPointCoder.isValidJSON(atom)) {
        return GeoPointCoder.JSONToDatabase(atom);
      }
      if (PolygonCoder.isValidJSON(atom)) {
        return PolygonCoder.JSONToDatabase(atom);
      }
      if (FileCoder.isValidJSON(atom)) {
        return FileCoder.JSONToDatabase(atom);
      }
      return CannotTransform;

    default:
      // I don't think typeof can ever let us get here
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, `really did not expect value: ${atom}`);
  }
}

function relativeTimeToDate(text, now = new Date()) {
  text = text.toLowerCase();

  let parts = text.split(' ');

  // Filter out whitespace
  parts = parts.filter(part => part !== '');

  const future = parts[0] === 'in';
  const past = parts[parts.length - 1] === 'ago';

  if (!future && !past && text !== 'now') {
    return { status: 'error', info: "Time should either start with 'in' or end with 'ago'" };
  }

  if (future && past) {
    return {
      status: 'error',
      info: "Time cannot have both 'in' and 'ago'"
    };
  }

  // strip the 'ago' or 'in'
  if (future) {
    parts = parts.slice(1);
  } else {
    // past
    parts = parts.slice(0, parts.length - 1);
  }

  if (parts.length % 2 !== 0 && text !== 'now') {
    return {
      status: 'error',
      info: 'Invalid time string. Dangling unit or number.'
    };
  }

  const pairs = [];
  while (parts.length) {
    pairs.push([parts.shift(), parts.shift()]);
  }

  let seconds = 0;
  for (const [num, interval] of pairs) {
    const val = Number(num);
    if (!Number.isInteger(val)) {
      return {
        status: 'error',
        info: `'${num}' is not an integer.`
      };
    }

    switch (interval) {
      case 'yr':
      case 'yrs':
      case 'year':
      case 'years':
        seconds += val * 31536000; // 365 * 24 * 60 * 60
        break;

      case 'wk':
      case 'wks':
      case 'week':
      case 'weeks':
        seconds += val * 604800; // 7 * 24 * 60 * 60
        break;

      case 'd':
      case 'day':
      case 'days':
        seconds += val * 86400; // 24 * 60 * 60
        break;

      case 'hr':
      case 'hrs':
      case 'hour':
      case 'hours':
        seconds += val * 3600; // 60 * 60
        break;

      case 'min':
      case 'mins':
      case 'minute':
      case 'minutes':
        seconds += val * 60;
        break;

      case 'sec':
      case 'secs':
      case 'second':
      case 'seconds':
        seconds += val;
        break;

      default:
        return {
          status: 'error',
          info: `Invalid interval: '${interval}'`
        };
    }
  }

  const milliseconds = seconds * 1000;
  if (future) {
    return {
      status: 'success',
      info: 'future',
      result: new Date(now.valueOf() + milliseconds)
    };
  } else if (past) {
    return {
      status: 'success',
      info: 'past',
      result: new Date(now.valueOf() - milliseconds)
    };
  } else {
    return {
      status: 'success',
      info: 'present',
      result: new Date(now.valueOf())
    };
  }
}

// Transforms a query constraint from REST API format to Mongo format.
// A constraint is something with fields like $lt.
// If it is not a valid constraint but it could be a valid something
// else, return CannotTransform.
// inArray is whether this is an array field.
function transformConstraint(constraint, field) {
  const inArray = field && field.type && field.type === 'Array';
  if (typeof constraint !== 'object' || !constraint) {
    return CannotTransform;
  }
  const transformFunction = inArray ? transformInteriorAtom : transformTopLevelAtom;
  const transformer = atom => {
    const result = transformFunction(atom, field);
    if (result === CannotTransform) {
      throw new Parse.Error(Parse.Error.INVALID_JSON, `bad atom: ${JSON.stringify(atom)}`);
    }
    return result;
  };
  // keys is the constraints in reverse alphabetical order.
  // This is a hack so that:
  //   $regex is handled before $options
  //   $nearSphere is handled before $maxDistance
  var keys = Object.keys(constraint).sort().reverse();
  var answer = {};
  for (var key of keys) {
    switch (key) {
      case '$lt':
      case '$lte':
      case '$gt':
      case '$gte':
      case '$exists':
      case '$ne':
      case '$eq':
        {
          const val = constraint[key];
          if (val && typeof val === 'object' && val.$relativeTime) {
            if (field && field.type !== 'Date') {
              throw new Parse.Error(Parse.Error.INVALID_JSON, '$relativeTime can only be used with Date field');
            }

            switch (key) {
              case '$exists':
              case '$ne':
              case '$eq':
                throw new Parse.Error(Parse.Error.INVALID_JSON, '$relativeTime can only be used with the $lt, $lte, $gt, and $gte operators');
            }

            const parserResult = relativeTimeToDate(val.$relativeTime);
            if (parserResult.status === 'success') {
              answer[key] = parserResult.result;
              break;
            }

            _logger2.default.info('Error while parsing relative date', parserResult);
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $relativeTime (${key}) value. ${parserResult.info}`);
          }

          answer[key] = transformer(val);
          break;
        }

      case '$in':
      case '$nin':
        {
          const arr = constraint[key];
          if (!(arr instanceof Array)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad ' + key + ' value');
          }
          answer[key] = _lodash2.default.flatMap(arr, value => {
            return (atom => {
              if (Array.isArray(atom)) {
                return value.map(transformer);
              } else {
                return transformer(atom);
              }
            })(value);
          });
          break;
        }
      case '$all':
        {
          const arr = constraint[key];
          if (!(arr instanceof Array)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad ' + key + ' value');
          }
          answer[key] = arr.map(transformInteriorAtom);

          const values = answer[key];
          if (isAnyValueRegex(values) && !isAllValuesRegexOrNone(values)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'All $all values must be of regex type or none: ' + values);
          }

          break;
        }
      case '$regex':
        var s = constraint[key];
        if (typeof s !== 'string') {
          throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad regex: ' + s);
        }
        answer[key] = s;
        break;

      case '$containedBy':
        {
          const arr = constraint[key];
          if (!(arr instanceof Array)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $containedBy: should be an array`);
          }
          answer.$elemMatch = {
            $nin: arr.map(transformer)
          };
          break;
        }
      case '$options':
        answer[key] = constraint[key];
        break;

      case '$text':
        {
          const search = constraint[key].$search;
          if (typeof search !== 'object') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $search, should be object`);
          }
          if (!search.$term || typeof search.$term !== 'string') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $term, should be string`);
          } else {
            answer[key] = {
              '$search': search.$term
            };
          }
          if (search.$language && typeof search.$language !== 'string') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $language, should be string`);
          } else if (search.$language) {
            answer[key].$language = search.$language;
          }
          if (search.$caseSensitive && typeof search.$caseSensitive !== 'boolean') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $caseSensitive, should be boolean`);
          } else if (search.$caseSensitive) {
            answer[key].$caseSensitive = search.$caseSensitive;
          }
          if (search.$diacriticSensitive && typeof search.$diacriticSensitive !== 'boolean') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $diacriticSensitive, should be boolean`);
          } else if (search.$diacriticSensitive) {
            answer[key].$diacriticSensitive = search.$diacriticSensitive;
          }
          break;
        }
      case '$nearSphere':
        var point = constraint[key];
        answer[key] = [point.longitude, point.latitude];
        break;

      case '$maxDistance':
        answer[key] = constraint[key];
        break;

      // The SDKs don't seem to use these but they are documented in the
      // REST API docs.
      case '$maxDistanceInRadians':
        answer['$maxDistance'] = constraint[key];
        break;
      case '$maxDistanceInMiles':
        answer['$maxDistance'] = constraint[key] / 3959;
        break;
      case '$maxDistanceInKilometers':
        answer['$maxDistance'] = constraint[key] / 6371;
        break;

      case '$select':
      case '$dontSelect':
        throw new Parse.Error(Parse.Error.COMMAND_UNAVAILABLE, 'the ' + key + ' constraint is not supported yet');

      case '$within':
        var box = constraint[key]['$box'];
        if (!box || box.length != 2) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, 'malformatted $within arg');
        }
        answer[key] = {
          '$box': [[box[0].longitude, box[0].latitude], [box[1].longitude, box[1].latitude]]
        };
        break;

      case '$geoWithin':
        {
          const polygon = constraint[key]['$polygon'];
          const centerSphere = constraint[key]['$centerSphere'];
          if (polygon !== undefined) {
            let points;
            if (typeof polygon === 'object' && polygon.__type === 'Polygon') {
              if (!polygon.coordinates || polygon.coordinates.length < 3) {
                throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; Polygon.coordinates should contain at least 3 lon/lat pairs');
              }
              points = polygon.coordinates;
            } else if (polygon instanceof Array) {
              if (polygon.length < 3) {
                throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should contain at least 3 GeoPoints');
              }
              points = polygon;
            } else {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should be Polygon object or Array of Parse.GeoPoint\'s');
            }
            points = points.map(point => {
              if (point instanceof Array && point.length === 2) {
                Parse.GeoPoint._validate(point[1], point[0]);
                return point;
              }
              if (!GeoPointCoder.isValidJSON(point)) {
                throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value');
              } else {
                Parse.GeoPoint._validate(point.latitude, point.longitude);
              }
              return [point.longitude, point.latitude];
            });
            answer[key] = {
              '$polygon': points
            };
          } else if (centerSphere !== undefined) {
            if (!(centerSphere instanceof Array) || centerSphere.length < 2) {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere should be an array of Parse.GeoPoint and distance');
            }
            // Get point, convert to geo point if necessary and validate
            let point = centerSphere[0];
            if (point instanceof Array && point.length === 2) {
              point = new Parse.GeoPoint(point[1], point[0]);
            } else if (!GeoPointCoder.isValidJSON(point)) {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere geo point invalid');
            }
            Parse.GeoPoint._validate(point.latitude, point.longitude);
            // Get distance and validate
            const distance = centerSphere[1];
            if (isNaN(distance) || distance < 0) {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere distance invalid');
            }
            answer[key] = {
              '$centerSphere': [[point.longitude, point.latitude], distance]
            };
          }
          break;
        }
      case '$geoIntersects':
        {
          const point = constraint[key]['$point'];
          if (!GeoPointCoder.isValidJSON(point)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoIntersect value; $point should be GeoPoint');
          } else {
            Parse.GeoPoint._validate(point.latitude, point.longitude);
          }
          answer[key] = {
            $geometry: {
              type: 'Point',
              coordinates: [point.longitude, point.latitude]
            }
          };
          break;
        }
      default:
        if (key.match(/^\$+/)) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad constraint: ' + key);
        }
        return CannotTransform;
    }
  }
  return answer;
}

// Transforms an update operator from REST format to mongo format.
// To be transformed, the input should have an __op field.
// If flatten is true, this will flatten operators to their static
// data format. For example, an increment of 2 would simply become a
// 2.
// The output for a non-flattened operator is a hash with __op being
// the mongo op, and arg being the argument.
// The output for a flattened operator is just a value.
// Returns undefined if this should be a no-op.

function transformUpdateOperator({
  __op,
  amount,
  objects
}, flatten) {
  switch (__op) {
    case 'Delete':
      if (flatten) {
        return undefined;
      } else {
        return { __op: '$unset', arg: '' };
      }

    case 'Increment':
      if (typeof amount !== 'number') {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'incrementing must provide a number');
      }
      if (flatten) {
        return amount;
      } else {
        return { __op: '$inc', arg: amount };
      }

    case 'Add':
    case 'AddUnique':
      if (!(objects instanceof Array)) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'objects to add must be an array');
      }
      var toAdd = objects.map(transformInteriorAtom);
      if (flatten) {
        return toAdd;
      } else {
        var mongoOp = {
          Add: '$push',
          AddUnique: '$addToSet'
        }[__op];
        return { __op: mongoOp, arg: { '$each': toAdd } };
      }

    case 'Remove':
      if (!(objects instanceof Array)) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'objects to remove must be an array');
      }
      var toRemove = objects.map(transformInteriorAtom);
      if (flatten) {
        return [];
      } else {
        return { __op: '$pullAll', arg: toRemove };
      }

    default:
      throw new Parse.Error(Parse.Error.COMMAND_UNAVAILABLE, `The ${__op} operator is not supported yet.`);
  }
}
function mapValues(object, iterator) {
  const result = {};
  Object.keys(object).forEach(key => {
    result[key] = iterator(object[key]);
  });
  return result;
}

const nestedMongoObjectToNestedParseObject = mongoObject => {
  switch (typeof mongoObject) {
    case 'string':
    case 'number':
    case 'boolean':
      return mongoObject;
    case 'undefined':
    case 'symbol':
    case 'function':
      throw 'bad value in mongoObjectToParseObject';
    case 'object':
      if (mongoObject === null) {
        return null;
      }
      if (mongoObject instanceof Array) {
        return mongoObject.map(nestedMongoObjectToNestedParseObject);
      }

      if (mongoObject instanceof Date) {
        return Parse._encode(mongoObject);
      }

      if (mongoObject instanceof mongodb.Long) {
        return mongoObject.toNumber();
      }

      if (mongoObject instanceof mongodb.Double) {
        return mongoObject.value;
      }

      if (BytesCoder.isValidDatabaseObject(mongoObject)) {
        return BytesCoder.databaseToJSON(mongoObject);
      }

      if (mongoObject.hasOwnProperty('__type') && mongoObject.__type == 'Date' && mongoObject.iso instanceof Date) {
        mongoObject.iso = mongoObject.iso.toJSON();
        return mongoObject;
      }

      return mapValues(mongoObject, nestedMongoObjectToNestedParseObject);
    default:
      throw 'unknown js type';
  }
};

const transformPointerString = (schema, field, pointerString) => {
  const objData = pointerString.split('$');
  if (objData[0] !== schema.fields[field].targetClass) {
    throw 'pointer to incorrect className';
  }
  return {
    __type: 'Pointer',
    className: objData[0],
    objectId: objData[1]
  };
};

// Converts from a mongo-format object to a REST-format object.
// Does not strip out anything based on a lack of authentication.
const mongoObjectToParseObject = (className, mongoObject, schema) => {
  switch (typeof mongoObject) {
    case 'string':
    case 'number':
    case 'boolean':
      return mongoObject;
    case 'undefined':
    case 'symbol':
    case 'function':
      throw 'bad value in mongoObjectToParseObject';
    case 'object':
      {
        if (mongoObject === null) {
          return null;
        }
        if (mongoObject instanceof Array) {
          return mongoObject.map(nestedMongoObjectToNestedParseObject);
        }

        if (mongoObject instanceof Date) {
          return Parse._encode(mongoObject);
        }

        if (mongoObject instanceof mongodb.Long) {
          return mongoObject.toNumber();
        }

        if (mongoObject instanceof mongodb.Double) {
          return mongoObject.value;
        }

        if (BytesCoder.isValidDatabaseObject(mongoObject)) {
          return BytesCoder.databaseToJSON(mongoObject);
        }

        const restObject = {};
        if (mongoObject._rperm || mongoObject._wperm) {
          restObject._rperm = mongoObject._rperm || [];
          restObject._wperm = mongoObject._wperm || [];
          delete mongoObject._rperm;
          delete mongoObject._wperm;
        }

        for (var key in mongoObject) {
          switch (key) {
            case '_id':
              restObject['objectId'] = '' + mongoObject[key];
              break;
            case '_hashed_password':
              restObject._hashed_password = mongoObject[key];
              break;
            case '_acl':
              break;
            case '_email_verify_token':
            case '_perishable_token':
            case '_perishable_token_expires_at':
            case '_password_changed_at':
            case '_tombstone':
            case '_email_verify_token_expires_at':
            case '_account_lockout_expires_at':
            case '_failed_login_count':
            case '_password_history':
              // Those keys will be deleted if needed in the DB Controller
              restObject[key] = mongoObject[key];
              break;
            case '_session_token':
              restObject['sessionToken'] = mongoObject[key];
              break;
            case 'updatedAt':
            case '_updated_at':
              restObject['updatedAt'] = Parse._encode(new Date(mongoObject[key])).iso;
              break;
            case 'createdAt':
            case '_created_at':
              restObject['createdAt'] = Parse._encode(new Date(mongoObject[key])).iso;
              break;
            case 'expiresAt':
            case '_expiresAt':
              restObject['expiresAt'] = Parse._encode(new Date(mongoObject[key]));
              break;
            case 'lastUsed':
            case '_last_used':
              restObject['lastUsed'] = Parse._encode(new Date(mongoObject[key])).iso;
              break;
            case 'timesUsed':
            case 'times_used':
              restObject['timesUsed'] = mongoObject[key];
              break;
            default:
              // Check other auth data keys
              var authDataMatch = key.match(/^_auth_data_([a-zA-Z0-9_]+)$/);
              if (authDataMatch) {
                var provider = authDataMatch[1];
                restObject['authData'] = restObject['authData'] || {};
                restObject['authData'][provider] = mongoObject[key];
                break;
              }

              if (key.indexOf('_p_') == 0) {
                var newKey = key.substring(3);
                if (!schema.fields[newKey]) {
                  _logger2.default.info('transform.js', 'Found a pointer column not in the schema, dropping it.', className, newKey);
                  break;
                }
                if (schema.fields[newKey].type !== 'Pointer') {
                  _logger2.default.info('transform.js', 'Found a pointer in a non-pointer column, dropping it.', className, key);
                  break;
                }
                if (mongoObject[key] === null) {
                  break;
                }
                restObject[newKey] = transformPointerString(schema, newKey, mongoObject[key]);
                break;
              } else if (key[0] == '_' && key != '__type') {
                throw 'bad key in untransform: ' + key;
              } else {
                var value = mongoObject[key];
                if (schema.fields[key] && schema.fields[key].type === 'File' && FileCoder.isValidDatabaseObject(value)) {
                  restObject[key] = FileCoder.databaseToJSON(value);
                  break;
                }
                if (schema.fields[key] && schema.fields[key].type === 'GeoPoint' && GeoPointCoder.isValidDatabaseObject(value)) {
                  restObject[key] = GeoPointCoder.databaseToJSON(value);
                  break;
                }
                if (schema.fields[key] && schema.fields[key].type === 'Polygon' && PolygonCoder.isValidDatabaseObject(value)) {
                  restObject[key] = PolygonCoder.databaseToJSON(value);
                  break;
                }
                if (schema.fields[key] && schema.fields[key].type === 'Bytes' && BytesCoder.isValidDatabaseObject(value)) {
                  restObject[key] = BytesCoder.databaseToJSON(value);
                  break;
                }
              }
              restObject[key] = nestedMongoObjectToNestedParseObject(mongoObject[key]);
          }
        }

        const relationFieldNames = Object.keys(schema.fields).filter(fieldName => schema.fields[fieldName].type === 'Relation');
        const relationFields = {};
        relationFieldNames.forEach(relationFieldName => {
          relationFields[relationFieldName] = {
            __type: 'Relation',
            className: schema.fields[relationFieldName].targetClass
          };
        });

        return _extends({}, restObject, relationFields);
      }
    default:
      throw 'unknown js type';
  }
};

var DateCoder = {
  JSONToDatabase(json) {
    return new Date(json.iso);
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'Date';
  }
};

var BytesCoder = {
  base64Pattern: new RegExp("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"),
  isBase64Value(object) {
    if (typeof object !== 'string') {
      return false;
    }
    return this.base64Pattern.test(object);
  },

  databaseToJSON(object) {
    let value;
    if (this.isBase64Value(object)) {
      value = object;
    } else {
      value = object.buffer.toString('base64');
    }
    return {
      __type: 'Bytes',
      base64: value
    };
  },

  isValidDatabaseObject(object) {
    return object instanceof mongodb.Binary || this.isBase64Value(object);
  },

  JSONToDatabase(json) {
    return new mongodb.Binary(new Buffer(json.base64, 'base64'));
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'Bytes';
  }
};

var GeoPointCoder = {
  databaseToJSON(object) {
    return {
      __type: 'GeoPoint',
      latitude: object[1],
      longitude: object[0]
    };
  },

  isValidDatabaseObject(object) {
    return object instanceof Array && object.length == 2;
  },

  JSONToDatabase(json) {
    return [json.longitude, json.latitude];
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'GeoPoint';
  }
};

var PolygonCoder = {
  databaseToJSON(object) {
    // Convert lng/lat -> lat/lng
    const coords = object.coordinates[0].map(coord => {
      return [coord[1], coord[0]];
    });
    return {
      __type: 'Polygon',
      coordinates: coords
    };
  },

  isValidDatabaseObject(object) {
    const coords = object.coordinates[0];
    if (object.type !== 'Polygon' || !(coords instanceof Array)) {
      return false;
    }
    for (let i = 0; i < coords.length; i++) {
      const point = coords[i];
      if (!GeoPointCoder.isValidDatabaseObject(point)) {
        return false;
      }
      Parse.GeoPoint._validate(parseFloat(point[1]), parseFloat(point[0]));
    }
    return true;
  },

  JSONToDatabase(json) {
    let coords = json.coordinates;
    // Add first point to the end to close polygon
    if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
      coords.push(coords[0]);
    }
    const unique = coords.filter((item, index, ar) => {
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
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'GeoJSON: Loop must have at least 3 different vertices');
    }
    // Convert lat/long -> long/lat
    coords = coords.map(coord => {
      return [coord[1], coord[0]];
    });
    return { type: 'Polygon', coordinates: [coords] };
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'Polygon';
  }
};

var FileCoder = {
  databaseToJSON(object) {
    return {
      __type: 'File',
      name: object
    };
  },

  isValidDatabaseObject(object) {
    return typeof object === 'string';
  },

  JSONToDatabase(json) {
    return json.name;
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'File';
  }
};

module.exports = {
  transformKey,
  parseObjectToMongoObjectForCreate,
  transformUpdate,
  transformWhere,
  mongoObjectToParseObject,
  relativeTimeToDate,
  transformConstraint,
  transformPointerString
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL01vbmdvL01vbmdvVHJhbnNmb3JtLmpzIl0sIm5hbWVzIjpbIm1vbmdvZGIiLCJyZXF1aXJlIiwiUGFyc2UiLCJ0cmFuc2Zvcm1LZXkiLCJjbGFzc05hbWUiLCJmaWVsZE5hbWUiLCJzY2hlbWEiLCJmaWVsZHMiLCJfX3R5cGUiLCJ0eXBlIiwidHJhbnNmb3JtS2V5VmFsdWVGb3JVcGRhdGUiLCJyZXN0S2V5IiwicmVzdFZhbHVlIiwicGFyc2VGb3JtYXRTY2hlbWEiLCJrZXkiLCJ0aW1lRmllbGQiLCJ2YWx1ZSIsInBhcnNlSW50IiwidHJhbnNmb3JtVG9wTGV2ZWxBdG9tIiwiQ2Fubm90VHJhbnNmb3JtIiwiRGF0ZSIsImluZGV4T2YiLCJBcnJheSIsIm1hcCIsInRyYW5zZm9ybUludGVyaW9yVmFsdWUiLCJ0cmFuc2Zvcm1VcGRhdGVPcGVyYXRvciIsIm1hcFZhbHVlcyIsImlzUmVnZXgiLCJSZWdFeHAiLCJpc1N0YXJ0c1dpdGhSZWdleCIsIm1hdGNoZXMiLCJ0b1N0cmluZyIsIm1hdGNoIiwiaXNBbGxWYWx1ZXNSZWdleE9yTm9uZSIsInZhbHVlcyIsImlzQXJyYXkiLCJsZW5ndGgiLCJmaXJzdFZhbHVlc0lzUmVnZXgiLCJpIiwiaXNBbnlWYWx1ZVJlZ2V4Iiwic29tZSIsIk9iamVjdCIsImtleXMiLCJpbmNsdWRlcyIsIkVycm9yIiwiSU5WQUxJRF9ORVNURURfS0VZIiwidHJhbnNmb3JtSW50ZXJpb3JBdG9tIiwidmFsdWVBc0RhdGUiLCJ0cmFuc2Zvcm1RdWVyeUtleVZhbHVlIiwic3ViUXVlcnkiLCJ0cmFuc2Zvcm1XaGVyZSIsImF1dGhEYXRhTWF0Y2giLCJwcm92aWRlciIsImV4cGVjdGVkVHlwZUlzQXJyYXkiLCJleHBlY3RlZFR5cGVJc1BvaW50ZXIiLCJmaWVsZCIsInRyYW5zZm9ybWVkQ29uc3RyYWludCIsInRyYW5zZm9ybUNvbnN0cmFpbnQiLCIkdGV4dCIsIiRlbGVtTWF0Y2giLCJJTlZBTElEX0pTT04iLCJyZXN0V2hlcmUiLCJtb25nb1doZXJlIiwib3V0IiwicGFyc2VPYmplY3RLZXlWYWx1ZVRvTW9uZ29PYmplY3RLZXlWYWx1ZSIsInRyYW5zZm9ybWVkVmFsdWUiLCJjb2VyY2VkVG9EYXRlIiwiSU5WQUxJRF9LRVlfTkFNRSIsInBhcnNlT2JqZWN0VG9Nb25nb09iamVjdEZvckNyZWF0ZSIsInJlc3RDcmVhdGUiLCJhZGRMZWdhY3lBQ0wiLCJtb25nb0NyZWF0ZSIsInVuZGVmaW5lZCIsImNyZWF0ZWRBdCIsIl9jcmVhdGVkX2F0IiwiaXNvIiwidXBkYXRlZEF0IiwiX3VwZGF0ZWRfYXQiLCJ0cmFuc2Zvcm1VcGRhdGUiLCJyZXN0VXBkYXRlIiwibW9uZ29VcGRhdGUiLCJhY2wiLCJfcnBlcm0iLCJfd3Blcm0iLCJfYWNsIiwiJHNldCIsIl9fb3AiLCJhcmciLCJyZXN0T2JqZWN0IiwicmVzdE9iamVjdENvcHkiLCJmb3JFYWNoIiwiZW50cnkiLCJ3IiwiciIsImF0b20iLCJvYmplY3RJZCIsIkRhdGVDb2RlciIsImlzVmFsaWRKU09OIiwiSlNPTlRvRGF0YWJhc2UiLCJCeXRlc0NvZGVyIiwiJHJlZ2V4IiwidGFyZ2V0Q2xhc3MiLCJHZW9Qb2ludENvZGVyIiwiUG9seWdvbkNvZGVyIiwiRmlsZUNvZGVyIiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwicmVsYXRpdmVUaW1lVG9EYXRlIiwidGV4dCIsIm5vdyIsInRvTG93ZXJDYXNlIiwicGFydHMiLCJzcGxpdCIsImZpbHRlciIsInBhcnQiLCJmdXR1cmUiLCJwYXN0Iiwic3RhdHVzIiwiaW5mbyIsInNsaWNlIiwicGFpcnMiLCJwdXNoIiwic2hpZnQiLCJzZWNvbmRzIiwibnVtIiwiaW50ZXJ2YWwiLCJ2YWwiLCJOdW1iZXIiLCJpc0ludGVnZXIiLCJtaWxsaXNlY29uZHMiLCJyZXN1bHQiLCJ2YWx1ZU9mIiwiY29uc3RyYWludCIsImluQXJyYXkiLCJ0cmFuc2Zvcm1GdW5jdGlvbiIsInRyYW5zZm9ybWVyIiwiSlNPTiIsInN0cmluZ2lmeSIsInNvcnQiLCJyZXZlcnNlIiwiYW5zd2VyIiwiJHJlbGF0aXZlVGltZSIsInBhcnNlclJlc3VsdCIsImxvZyIsImFyciIsIl8iLCJmbGF0TWFwIiwicyIsIiRuaW4iLCJzZWFyY2giLCIkc2VhcmNoIiwiJHRlcm0iLCIkbGFuZ3VhZ2UiLCIkY2FzZVNlbnNpdGl2ZSIsIiRkaWFjcml0aWNTZW5zaXRpdmUiLCJwb2ludCIsImxvbmdpdHVkZSIsImxhdGl0dWRlIiwiQ09NTUFORF9VTkFWQUlMQUJMRSIsImJveCIsInBvbHlnb24iLCJjZW50ZXJTcGhlcmUiLCJwb2ludHMiLCJjb29yZGluYXRlcyIsIkdlb1BvaW50IiwiX3ZhbGlkYXRlIiwiZGlzdGFuY2UiLCJpc05hTiIsIiRnZW9tZXRyeSIsImFtb3VudCIsIm9iamVjdHMiLCJmbGF0dGVuIiwidG9BZGQiLCJtb25nb09wIiwiQWRkIiwiQWRkVW5pcXVlIiwidG9SZW1vdmUiLCJvYmplY3QiLCJpdGVyYXRvciIsIm5lc3RlZE1vbmdvT2JqZWN0VG9OZXN0ZWRQYXJzZU9iamVjdCIsIm1vbmdvT2JqZWN0IiwiX2VuY29kZSIsIkxvbmciLCJ0b051bWJlciIsIkRvdWJsZSIsImlzVmFsaWREYXRhYmFzZU9iamVjdCIsImRhdGFiYXNlVG9KU09OIiwiaGFzT3duUHJvcGVydHkiLCJ0b0pTT04iLCJ0cmFuc2Zvcm1Qb2ludGVyU3RyaW5nIiwicG9pbnRlclN0cmluZyIsIm9iakRhdGEiLCJtb25nb09iamVjdFRvUGFyc2VPYmplY3QiLCJfaGFzaGVkX3Bhc3N3b3JkIiwibmV3S2V5Iiwic3Vic3RyaW5nIiwicmVsYXRpb25GaWVsZE5hbWVzIiwicmVsYXRpb25GaWVsZHMiLCJyZWxhdGlvbkZpZWxkTmFtZSIsImpzb24iLCJiYXNlNjRQYXR0ZXJuIiwiaXNCYXNlNjRWYWx1ZSIsInRlc3QiLCJidWZmZXIiLCJiYXNlNjQiLCJCaW5hcnkiLCJCdWZmZXIiLCJjb29yZHMiLCJjb29yZCIsInBhcnNlRmxvYXQiLCJ1bmlxdWUi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SixJQUVOQSxNQUFNUixNQUFOLEtBQWlCLFNBRm5CO0FBSUQ7QUFoRWdCLENBQW5COztBQW1FQSxJQUFJZ0csWUFBWTtBQUNkaUYsaUJBQWVULE1BQWYsRUFBdUI7QUFDckIsV0FBTztBQUNMeEssY0FBUSxNQURIO0FBRUwrTSxZQUFNdkM7QUFGRCxLQUFQO0FBSUQsR0FOYTs7QUFRZFEsd0JBQXNCUixNQUF0QixFQUE4QjtBQUM1QixXQUFRLE9BQU9BLE1BQVAsS0FBa0IsUUFBMUI7QUFDRCxHQVZhOztBQVlkOUUsaUJBQWVvRyxJQUFmLEVBQXFCO0FBQ25CLFdBQU9BLEtBQUtpQixJQUFaO0FBQ0QsR0FkYTs7QUFnQmR0SCxjQUFZakYsS0FBWixFQUFtQjtBQUNqQixXQUFRLE9BQU9BLEtBQVAsS0FBaUIsUUFBakIsSUFDTkEsVUFBVSxJQURKLElBRU5BLE1BQU1SLE1BQU4sS0FBaUIsTUFGbkI7QUFJRDtBQXJCYSxDQUFoQjs7QUF3QkFnTixPQUFPQyxPQUFQLEdBQWlCO0FBQ2Z0TixjQURlO0FBRWZpRSxtQ0FGZTtBQUdmVSxpQkFIZTtBQUlmNUIsZ0JBSmU7QUFLZjZJLDBCQUxlO0FBTWZyRixvQkFOZTtBQU9makQscUJBUGU7QUFRZm1JO0FBUmUsQ0FBakIiLCJmaWxlIjoiTW9uZ29UcmFuc2Zvcm0uanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbG9nIGZyb20gJy4uLy4uLy4uL2xvZ2dlcic7XG5pbXBvcnQgXyAgIGZyb20gJ2xvZGFzaCc7XG52YXIgbW9uZ29kYiA9IHJlcXVpcmUoJ21vbmdvZGInKTtcbnZhciBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKS5QYXJzZTtcblxuY29uc3QgdHJhbnNmb3JtS2V5ID0gKGNsYXNzTmFtZSwgZmllbGROYW1lLCBzY2hlbWEpID0+IHtcbiAgLy8gQ2hlY2sgaWYgdGhlIHNjaGVtYSBpcyBrbm93biBzaW5jZSBpdCdzIGEgYnVpbHQtaW4gZmllbGQuXG4gIHN3aXRjaChmaWVsZE5hbWUpIHtcbiAgY2FzZSAnb2JqZWN0SWQnOiByZXR1cm4gJ19pZCc7XG4gIGNhc2UgJ2NyZWF0ZWRBdCc6IHJldHVybiAnX2NyZWF0ZWRfYXQnO1xuICBjYXNlICd1cGRhdGVkQXQnOiByZXR1cm4gJ191cGRhdGVkX2F0JztcbiAgY2FzZSAnc2Vzc2lvblRva2VuJzogcmV0dXJuICdfc2Vzc2lvbl90b2tlbic7XG4gIGNhc2UgJ2xhc3RVc2VkJzogcmV0dXJuICdfbGFzdF91c2VkJztcbiAgY2FzZSAndGltZXNVc2VkJzogcmV0dXJuICd0aW1lc191c2VkJztcbiAgfVxuXG4gIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLl9fdHlwZSA9PSAnUG9pbnRlcicpIHtcbiAgICBmaWVsZE5hbWUgPSAnX3BfJyArIGZpZWxkTmFtZTtcbiAgfSBlbHNlIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT0gJ1BvaW50ZXInKSB7XG4gICAgZmllbGROYW1lID0gJ19wXycgKyBmaWVsZE5hbWU7XG4gIH1cblxuICByZXR1cm4gZmllbGROYW1lO1xufVxuXG5jb25zdCB0cmFuc2Zvcm1LZXlWYWx1ZUZvclVwZGF0ZSA9IChjbGFzc05hbWUsIHJlc3RLZXksIHJlc3RWYWx1ZSwgcGFyc2VGb3JtYXRTY2hlbWEpID0+IHtcbiAgLy8gQ2hlY2sgaWYgdGhlIHNjaGVtYSBpcyBrbm93biBzaW5jZSBpdCdzIGEgYnVpbHQtaW4gZmllbGQuXG4gIHZhciBrZXkgPSByZXN0S2V5O1xuICB2YXIgdGltZUZpZWxkID0gZmFsc2U7XG4gIHN3aXRjaChrZXkpIHtcbiAgY2FzZSAnb2JqZWN0SWQnOlxuICBjYXNlICdfaWQnOlxuICAgIGlmIChjbGFzc05hbWUgPT09ICdfR2xvYmFsQ29uZmlnJykge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2V5OiBrZXksXG4gICAgICAgIHZhbHVlOiBwYXJzZUludChyZXN0VmFsdWUpXG4gICAgICB9XG4gICAgfVxuICAgIGtleSA9ICdfaWQnO1xuICAgIGJyZWFrO1xuICBjYXNlICdjcmVhdGVkQXQnOlxuICBjYXNlICdfY3JlYXRlZF9hdCc6XG4gICAga2V5ID0gJ19jcmVhdGVkX2F0JztcbiAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgIGJyZWFrO1xuICBjYXNlICd1cGRhdGVkQXQnOlxuICBjYXNlICdfdXBkYXRlZF9hdCc6XG4gICAga2V5ID0gJ191cGRhdGVkX2F0JztcbiAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgIGJyZWFrO1xuICBjYXNlICdzZXNzaW9uVG9rZW4nOlxuICBjYXNlICdfc2Vzc2lvbl90b2tlbic6XG4gICAga2V5ID0gJ19zZXNzaW9uX3Rva2VuJztcbiAgICBicmVhaztcbiAgY2FzZSAnZXhwaXJlc0F0JzpcbiAgY2FzZSAnX2V4cGlyZXNBdCc6XG4gICAga2V5ID0gJ2V4cGlyZXNBdCc7XG4gICAgdGltZUZpZWxkID0gdHJ1ZTtcbiAgICBicmVhaztcbiAgY2FzZSAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0JzpcbiAgICBrZXkgPSAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0JztcbiAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgIGJyZWFrO1xuICBjYXNlICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnOlxuICAgIGtleSA9ICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnO1xuICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgYnJlYWs7XG4gIGNhc2UgJ19mYWlsZWRfbG9naW5fY291bnQnOlxuICAgIGtleSA9ICdfZmFpbGVkX2xvZ2luX2NvdW50JztcbiAgICBicmVhaztcbiAgY2FzZSAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAga2V5ID0gJ19wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQnO1xuICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgYnJlYWs7XG4gIGNhc2UgJ19wYXNzd29yZF9jaGFuZ2VkX2F0JzpcbiAgICBrZXkgPSAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnO1xuICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgYnJlYWs7XG4gIGNhc2UgJ19ycGVybSc6XG4gIGNhc2UgJ193cGVybSc6XG4gICAgcmV0dXJuIHtrZXk6IGtleSwgdmFsdWU6IHJlc3RWYWx1ZX07XG4gIGNhc2UgJ2xhc3RVc2VkJzpcbiAgY2FzZSAnX2xhc3RfdXNlZCc6XG4gICAga2V5ID0gJ19sYXN0X3VzZWQnO1xuICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgYnJlYWs7XG4gIGNhc2UgJ3RpbWVzVXNlZCc6XG4gIGNhc2UgJ3RpbWVzX3VzZWQnOlxuICAgIGtleSA9ICd0aW1lc191c2VkJztcbiAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgIGJyZWFrO1xuICB9XG5cbiAgaWYgKChwYXJzZUZvcm1hdFNjaGVtYS5maWVsZHNba2V5XSAmJiBwYXJzZUZvcm1hdFNjaGVtYS5maWVsZHNba2V5XS50eXBlID09PSAnUG9pbnRlcicpIHx8ICghcGFyc2VGb3JtYXRTY2hlbWEuZmllbGRzW2tleV0gJiYgcmVzdFZhbHVlICYmIHJlc3RWYWx1ZS5fX3R5cGUgPT0gJ1BvaW50ZXInKSkge1xuICAgIGtleSA9ICdfcF8nICsga2V5O1xuICB9XG5cbiAgLy8gSGFuZGxlIGF0b21pYyB2YWx1ZXNcbiAgdmFyIHZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gIGlmICh2YWx1ZSAhPT0gQ2Fubm90VHJhbnNmb3JtKSB7XG4gICAgaWYgKHRpbWVGaWVsZCAmJiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykpIHtcbiAgICAgIHZhbHVlID0gbmV3IERhdGUodmFsdWUpO1xuICAgIH1cbiAgICBpZiAocmVzdEtleS5pbmRleE9mKCcuJykgPiAwKSB7XG4gICAgICByZXR1cm4ge2tleSwgdmFsdWU6IHJlc3RWYWx1ZX1cbiAgICB9XG4gICAgcmV0dXJuIHtrZXksIHZhbHVlfTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBhcnJheXNcbiAgaWYgKHJlc3RWYWx1ZSBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgdmFsdWUgPSByZXN0VmFsdWUubWFwKHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xuICAgIHJldHVybiB7a2V5LCB2YWx1ZX07XG4gIH1cblxuICAvLyBIYW5kbGUgdXBkYXRlIG9wZXJhdG9yc1xuICBpZiAodHlwZW9mIHJlc3RWYWx1ZSA9PT0gJ29iamVjdCcgJiYgJ19fb3AnIGluIHJlc3RWYWx1ZSkge1xuICAgIHJldHVybiB7a2V5LCB2YWx1ZTogdHJhbnNmb3JtVXBkYXRlT3BlcmF0b3IocmVzdFZhbHVlLCBmYWxzZSl9O1xuICB9XG5cbiAgLy8gSGFuZGxlIG5vcm1hbCBvYmplY3RzIGJ5IHJlY3Vyc2luZ1xuICB2YWx1ZSA9IG1hcFZhbHVlcyhyZXN0VmFsdWUsIHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xuICByZXR1cm4ge2tleSwgdmFsdWV9O1xufVxuXG5jb25zdCBpc1JlZ2V4ID0gdmFsdWUgPT4ge1xuICByZXR1cm4gdmFsdWUgJiYgKHZhbHVlIGluc3RhbmNlb2YgUmVnRXhwKVxufVxuXG5jb25zdCBpc1N0YXJ0c1dpdGhSZWdleCA9IHZhbHVlID0+IHtcbiAgaWYgKCFpc1JlZ2V4KHZhbHVlKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGNvbnN0IG1hdGNoZXMgPSB2YWx1ZS50b1N0cmluZygpLm1hdGNoKC9cXC9cXF5cXFxcUS4qXFxcXEVcXC8vKTtcbiAgcmV0dXJuICEhbWF0Y2hlcztcbn1cblxuY29uc3QgaXNBbGxWYWx1ZXNSZWdleE9yTm9uZSA9IHZhbHVlcyA9PiB7XG4gIGlmICghdmFsdWVzIHx8ICFBcnJheS5pc0FycmF5KHZhbHVlcykgfHwgdmFsdWVzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgY29uc3QgZmlyc3RWYWx1ZXNJc1JlZ2V4ID0gaXNTdGFydHNXaXRoUmVnZXgodmFsdWVzWzBdKTtcbiAgaWYgKHZhbHVlcy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gZmlyc3RWYWx1ZXNJc1JlZ2V4O1xuICB9XG5cbiAgZm9yIChsZXQgaSA9IDEsIGxlbmd0aCA9IHZhbHVlcy5sZW5ndGg7IGkgPCBsZW5ndGg7ICsraSkge1xuICAgIGlmIChmaXJzdFZhbHVlc0lzUmVnZXggIT09IGlzU3RhcnRzV2l0aFJlZ2V4KHZhbHVlc1tpXSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn1cblxuY29uc3QgaXNBbnlWYWx1ZVJlZ2V4ID0gdmFsdWVzID0+IHtcbiAgcmV0dXJuIHZhbHVlcy5zb21lKGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgIHJldHVybiBpc1JlZ2V4KHZhbHVlKTtcbiAgfSk7XG59XG5cbmNvbnN0IHRyYW5zZm9ybUludGVyaW9yVmFsdWUgPSByZXN0VmFsdWUgPT4ge1xuICBpZiAocmVzdFZhbHVlICE9PSBudWxsICYmIHR5cGVvZiByZXN0VmFsdWUgPT09ICdvYmplY3QnICYmIE9iamVjdC5rZXlzKHJlc3RWYWx1ZSkuc29tZShrZXkgPT4ga2V5LmluY2x1ZGVzKCckJykgfHwga2V5LmluY2x1ZGVzKCcuJykpKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfTkVTVEVEX0tFWSwgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiKTtcbiAgfVxuICAvLyBIYW5kbGUgYXRvbWljIHZhbHVlc1xuICB2YXIgdmFsdWUgPSB0cmFuc2Zvcm1JbnRlcmlvckF0b20ocmVzdFZhbHVlKTtcbiAgaWYgKHZhbHVlICE9PSBDYW5ub3RUcmFuc2Zvcm0pIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cblxuICAvLyBIYW5kbGUgYXJyYXlzXG4gIGlmIChyZXN0VmFsdWUgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIHJldHVybiByZXN0VmFsdWUubWFwKHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xuICB9XG5cbiAgLy8gSGFuZGxlIHVwZGF0ZSBvcGVyYXRvcnNcbiAgaWYgKHR5cGVvZiByZXN0VmFsdWUgPT09ICdvYmplY3QnICYmICdfX29wJyBpbiByZXN0VmFsdWUpIHtcbiAgICByZXR1cm4gdHJhbnNmb3JtVXBkYXRlT3BlcmF0b3IocmVzdFZhbHVlLCB0cnVlKTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBub3JtYWwgb2JqZWN0cyBieSByZWN1cnNpbmdcbiAgcmV0dXJuIG1hcFZhbHVlcyhyZXN0VmFsdWUsIHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xufVxuXG5jb25zdCB2YWx1ZUFzRGF0ZSA9IHZhbHVlID0+IHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gbmV3IERhdGUodmFsdWUpO1xuICB9IGVsc2UgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIHRyYW5zZm9ybVF1ZXJ5S2V5VmFsdWUoY2xhc3NOYW1lLCBrZXksIHZhbHVlLCBzY2hlbWEpIHtcbiAgc3dpdGNoKGtleSkge1xuICBjYXNlICdjcmVhdGVkQXQnOlxuICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB7a2V5OiAnX2NyZWF0ZWRfYXQnLCB2YWx1ZTogdmFsdWVBc0RhdGUodmFsdWUpfVxuICAgIH1cbiAgICBrZXkgPSAnX2NyZWF0ZWRfYXQnO1xuICAgIGJyZWFrO1xuICBjYXNlICd1cGRhdGVkQXQnOlxuICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB7a2V5OiAnX3VwZGF0ZWRfYXQnLCB2YWx1ZTogdmFsdWVBc0RhdGUodmFsdWUpfVxuICAgIH1cbiAgICBrZXkgPSAnX3VwZGF0ZWRfYXQnO1xuICAgIGJyZWFrO1xuICBjYXNlICdleHBpcmVzQXQnOlxuICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB7a2V5OiAnZXhwaXJlc0F0JywgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKX1cbiAgICB9XG4gICAgYnJlYWs7XG4gIGNhc2UgJ19lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAgaWYgKHZhbHVlQXNEYXRlKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHtrZXk6ICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnLCB2YWx1ZTogdmFsdWVBc0RhdGUodmFsdWUpfVxuICAgIH1cbiAgICBicmVhaztcbiAgY2FzZSAnb2JqZWN0SWQnOiB7XG4gICAgaWYgKGNsYXNzTmFtZSA9PT0gJ19HbG9iYWxDb25maWcnKSB7XG4gICAgICB2YWx1ZSA9IHBhcnNlSW50KHZhbHVlKTtcbiAgICB9XG4gICAgcmV0dXJuIHtrZXk6ICdfaWQnLCB2YWx1ZX1cbiAgfVxuICBjYXNlICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnOlxuICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB7a2V5OiAnX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0JywgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKX1cbiAgICB9XG4gICAgYnJlYWs7XG4gIGNhc2UgJ19mYWlsZWRfbG9naW5fY291bnQnOlxuICAgIHJldHVybiB7a2V5LCB2YWx1ZX07XG4gIGNhc2UgJ3Nlc3Npb25Ub2tlbic6IHJldHVybiB7a2V5OiAnX3Nlc3Npb25fdG9rZW4nLCB2YWx1ZX1cbiAgY2FzZSAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAgaWYgKHZhbHVlQXNEYXRlKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHsga2V5OiAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCcsIHZhbHVlOiB2YWx1ZUFzRGF0ZSh2YWx1ZSkgfVxuICAgIH1cbiAgICBicmVhaztcbiAgY2FzZSAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnOlxuICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB7IGtleTogJ19wYXNzd29yZF9jaGFuZ2VkX2F0JywgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKSB9XG4gICAgfVxuICAgIGJyZWFrO1xuICBjYXNlICdfcnBlcm0nOlxuICBjYXNlICdfd3Blcm0nOlxuICBjYXNlICdfcGVyaXNoYWJsZV90b2tlbic6XG4gIGNhc2UgJ19lbWFpbF92ZXJpZnlfdG9rZW4nOiByZXR1cm4ge2tleSwgdmFsdWV9XG4gIGNhc2UgJyRvcic6XG4gIGNhc2UgJyRhbmQnOlxuICBjYXNlICckbm9yJzpcbiAgICByZXR1cm4ge2tleToga2V5LCB2YWx1ZTogdmFsdWUubWFwKHN1YlF1ZXJ5ID0+IHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgc3ViUXVlcnksIHNjaGVtYSkpfTtcbiAgY2FzZSAnbGFzdFVzZWQnOlxuICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB7a2V5OiAnX2xhc3RfdXNlZCcsIHZhbHVlOiB2YWx1ZUFzRGF0ZSh2YWx1ZSl9XG4gICAgfVxuICAgIGtleSA9ICdfbGFzdF91c2VkJztcbiAgICBicmVhaztcbiAgY2FzZSAndGltZXNVc2VkJzpcbiAgICByZXR1cm4ge2tleTogJ3RpbWVzX3VzZWQnLCB2YWx1ZTogdmFsdWV9O1xuICBkZWZhdWx0OiB7XG4gICAgLy8gT3RoZXIgYXV0aCBkYXRhXG4gICAgY29uc3QgYXV0aERhdGFNYXRjaCA9IGtleS5tYXRjaCgvXmF1dGhEYXRhXFwuKFthLXpBLVowLTlfXSspXFwuaWQkLyk7XG4gICAgaWYgKGF1dGhEYXRhTWF0Y2gpIHtcbiAgICAgIGNvbnN0IHByb3ZpZGVyID0gYXV0aERhdGFNYXRjaFsxXTtcbiAgICAgIC8vIFNwZWNpYWwtY2FzZSBhdXRoIGRhdGEuXG4gICAgICByZXR1cm4ge2tleTogYF9hdXRoX2RhdGFfJHtwcm92aWRlcn0uaWRgLCB2YWx1ZX07XG4gICAgfVxuICB9XG4gIH1cblxuICBjb25zdCBleHBlY3RlZFR5cGVJc0FycmF5ID1cbiAgICBzY2hlbWEgJiZcbiAgICBzY2hlbWEuZmllbGRzW2tleV0gJiZcbiAgICBzY2hlbWEuZmllbGRzW2tleV0udHlwZSA9PT0gJ0FycmF5JztcblxuICBjb25zdCBleHBlY3RlZFR5cGVJc1BvaW50ZXIgPVxuICAgIHNjaGVtYSAmJlxuICAgIHNjaGVtYS5maWVsZHNba2V5XSAmJlxuICAgIHNjaGVtYS5maWVsZHNba2V5XS50eXBlID09PSAnUG9pbnRlcic7XG5cbiAgY29uc3QgZmllbGQgPSBzY2hlbWEgJiYgc2NoZW1hLmZpZWxkc1trZXldO1xuICBpZiAoZXhwZWN0ZWRUeXBlSXNQb2ludGVyIHx8ICFzY2hlbWEgJiYgdmFsdWUgJiYgdmFsdWUuX190eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICBrZXkgPSAnX3BfJyArIGtleTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBxdWVyeSBjb25zdHJhaW50c1xuICBjb25zdCB0cmFuc2Zvcm1lZENvbnN0cmFpbnQgPSB0cmFuc2Zvcm1Db25zdHJhaW50KHZhbHVlLCBmaWVsZCk7XG4gIGlmICh0cmFuc2Zvcm1lZENvbnN0cmFpbnQgIT09IENhbm5vdFRyYW5zZm9ybSkge1xuICAgIGlmICh0cmFuc2Zvcm1lZENvbnN0cmFpbnQuJHRleHQpIHtcbiAgICAgIHJldHVybiB7a2V5OiAnJHRleHQnLCB2YWx1ZTogdHJhbnNmb3JtZWRDb25zdHJhaW50LiR0ZXh0fTtcbiAgICB9XG4gICAgaWYgKHRyYW5zZm9ybWVkQ29uc3RyYWludC4kZWxlbU1hdGNoKSB7XG4gICAgICByZXR1cm4geyBrZXk6ICckbm9yJywgdmFsdWU6IFt7IFtrZXldOiB0cmFuc2Zvcm1lZENvbnN0cmFpbnQgfV0gfTtcbiAgICB9XG4gICAgcmV0dXJuIHtrZXksIHZhbHVlOiB0cmFuc2Zvcm1lZENvbnN0cmFpbnR9O1xuICB9XG5cbiAgaWYgKGV4cGVjdGVkVHlwZUlzQXJyYXkgJiYgISh2YWx1ZSBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgIHJldHVybiB7a2V5LCB2YWx1ZTogeyAnJGFsbCcgOiBbdHJhbnNmb3JtSW50ZXJpb3JBdG9tKHZhbHVlKV0gfX07XG4gIH1cblxuICAvLyBIYW5kbGUgYXRvbWljIHZhbHVlc1xuICBpZiAodHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHZhbHVlKSAhPT0gQ2Fubm90VHJhbnNmb3JtKSB7XG4gICAgcmV0dXJuIHtrZXksIHZhbHVlOiB0cmFuc2Zvcm1Ub3BMZXZlbEF0b20odmFsdWUpfTtcbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgWW91IGNhbm5vdCB1c2UgJHt2YWx1ZX0gYXMgYSBxdWVyeSBwYXJhbWV0ZXIuYCk7XG4gIH1cbn1cblxuLy8gTWFpbiBleHBvc2VkIG1ldGhvZCB0byBoZWxwIHJ1biBxdWVyaWVzLlxuLy8gcmVzdFdoZXJlIGlzIHRoZSBcIndoZXJlXCIgY2xhdXNlIGluIFJFU1QgQVBJIGZvcm0uXG4vLyBSZXR1cm5zIHRoZSBtb25nbyBmb3JtIG9mIHRoZSBxdWVyeS5cbmZ1bmN0aW9uIHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgcmVzdFdoZXJlLCBzY2hlbWEpIHtcbiAgY29uc3QgbW9uZ29XaGVyZSA9IHt9O1xuICBmb3IgKGNvbnN0IHJlc3RLZXkgaW4gcmVzdFdoZXJlKSB7XG4gICAgY29uc3Qgb3V0ID0gdHJhbnNmb3JtUXVlcnlLZXlWYWx1ZShjbGFzc05hbWUsIHJlc3RLZXksIHJlc3RXaGVyZVtyZXN0S2V5XSwgc2NoZW1hKTtcbiAgICBtb25nb1doZXJlW291dC5rZXldID0gb3V0LnZhbHVlO1xuICB9XG4gIHJldHVybiBtb25nb1doZXJlO1xufVxuXG5jb25zdCBwYXJzZU9iamVjdEtleVZhbHVlVG9Nb25nb09iamVjdEtleVZhbHVlID0gKHJlc3RLZXksIHJlc3RWYWx1ZSwgc2NoZW1hKSA9PiB7XG4gIC8vIENoZWNrIGlmIHRoZSBzY2hlbWEgaXMga25vd24gc2luY2UgaXQncyBhIGJ1aWx0LWluIGZpZWxkLlxuICBsZXQgdHJhbnNmb3JtZWRWYWx1ZTtcbiAgbGV0IGNvZXJjZWRUb0RhdGU7XG4gIHN3aXRjaChyZXN0S2V5KSB7XG4gIGNhc2UgJ29iamVjdElkJzogcmV0dXJuIHtrZXk6ICdfaWQnLCB2YWx1ZTogcmVzdFZhbHVlfTtcbiAgY2FzZSAnZXhwaXJlc0F0JzpcbiAgICB0cmFuc2Zvcm1lZFZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gICAgY29lcmNlZFRvRGF0ZSA9IHR5cGVvZiB0cmFuc2Zvcm1lZFZhbHVlID09PSAnc3RyaW5nJyA/IG5ldyBEYXRlKHRyYW5zZm9ybWVkVmFsdWUpIDogdHJhbnNmb3JtZWRWYWx1ZVxuICAgIHJldHVybiB7a2V5OiAnZXhwaXJlc0F0JywgdmFsdWU6IGNvZXJjZWRUb0RhdGV9O1xuICBjYXNlICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnOlxuICAgIHRyYW5zZm9ybWVkVmFsdWUgPSB0cmFuc2Zvcm1Ub3BMZXZlbEF0b20ocmVzdFZhbHVlKTtcbiAgICBjb2VyY2VkVG9EYXRlID0gdHlwZW9mIHRyYW5zZm9ybWVkVmFsdWUgPT09ICdzdHJpbmcnID8gbmV3IERhdGUodHJhbnNmb3JtZWRWYWx1ZSkgOiB0cmFuc2Zvcm1lZFZhbHVlXG4gICAgcmV0dXJuIHtrZXk6ICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnLCB2YWx1ZTogY29lcmNlZFRvRGF0ZX07XG4gIGNhc2UgJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCc6XG4gICAgdHJhbnNmb3JtZWRWYWx1ZSA9IHRyYW5zZm9ybVRvcExldmVsQXRvbShyZXN0VmFsdWUpO1xuICAgIGNvZXJjZWRUb0RhdGUgPSB0eXBlb2YgdHJhbnNmb3JtZWRWYWx1ZSA9PT0gJ3N0cmluZycgPyBuZXcgRGF0ZSh0cmFuc2Zvcm1lZFZhbHVlKSA6IHRyYW5zZm9ybWVkVmFsdWVcbiAgICByZXR1cm4ge2tleTogJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCcsIHZhbHVlOiBjb2VyY2VkVG9EYXRlfTtcbiAgY2FzZSAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAgdHJhbnNmb3JtZWRWYWx1ZSA9IHRyYW5zZm9ybVRvcExldmVsQXRvbShyZXN0VmFsdWUpO1xuICAgIGNvZXJjZWRUb0RhdGUgPSB0eXBlb2YgdHJhbnNmb3JtZWRWYWx1ZSA9PT0gJ3N0cmluZycgPyBuZXcgRGF0ZSh0cmFuc2Zvcm1lZFZhbHVlKSA6IHRyYW5zZm9ybWVkVmFsdWVcbiAgICByZXR1cm4geyBrZXk6ICdfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0JywgdmFsdWU6IGNvZXJjZWRUb0RhdGUgfTtcbiAgY2FzZSAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnOlxuICAgIHRyYW5zZm9ybWVkVmFsdWUgPSB0cmFuc2Zvcm1Ub3BMZXZlbEF0b20ocmVzdFZhbHVlKTtcbiAgICBjb2VyY2VkVG9EYXRlID0gdHlwZW9mIHRyYW5zZm9ybWVkVmFsdWUgPT09ICdzdHJpbmcnID8gbmV3IERhdGUodHJhbnNmb3JtZWRWYWx1ZSkgOiB0cmFuc2Zvcm1lZFZhbHVlXG4gICAgcmV0dXJuIHsga2V5OiAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnLCB2YWx1ZTogY29lcmNlZFRvRGF0ZSB9O1xuICBjYXNlICdfZmFpbGVkX2xvZ2luX2NvdW50JzpcbiAgY2FzZSAnX3JwZXJtJzpcbiAgY2FzZSAnX3dwZXJtJzpcbiAgY2FzZSAnX2VtYWlsX3ZlcmlmeV90b2tlbic6XG4gIGNhc2UgJ19oYXNoZWRfcGFzc3dvcmQnOlxuICBjYXNlICdfcGVyaXNoYWJsZV90b2tlbic6IHJldHVybiB7a2V5OiByZXN0S2V5LCB2YWx1ZTogcmVzdFZhbHVlfTtcbiAgY2FzZSAnc2Vzc2lvblRva2VuJzogcmV0dXJuIHtrZXk6ICdfc2Vzc2lvbl90b2tlbicsIHZhbHVlOiByZXN0VmFsdWV9O1xuICBkZWZhdWx0OlxuICAgIC8vIEF1dGggZGF0YSBzaG91bGQgaGF2ZSBiZWVuIHRyYW5zZm9ybWVkIGFscmVhZHlcbiAgICBpZiAocmVzdEtleS5tYXRjaCgvXmF1dGhEYXRhXFwuKFthLXpBLVowLTlfXSspXFwuaWQkLykpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCAnY2FuIG9ubHkgcXVlcnkgb24gJyArIHJlc3RLZXkpO1xuICAgIH1cbiAgICAvLyBUcnVzdCB0aGF0IHRoZSBhdXRoIGRhdGEgaGFzIGJlZW4gdHJhbnNmb3JtZWQgYW5kIHNhdmUgaXQgZGlyZWN0bHlcbiAgICBpZiAocmVzdEtleS5tYXRjaCgvXl9hdXRoX2RhdGFfW2EtekEtWjAtOV9dKyQvKSkge1xuICAgICAgcmV0dXJuIHtrZXk6IHJlc3RLZXksIHZhbHVlOiByZXN0VmFsdWV9O1xuICAgIH1cbiAgfVxuICAvL3NraXAgc3RyYWlnaHQgdG8gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tIGZvciBCeXRlcywgdGhleSBkb24ndCBzaG93IHVwIGluIHRoZSBzY2hlbWEgZm9yIHNvbWUgcmVhc29uXG4gIGlmIChyZXN0VmFsdWUgJiYgcmVzdFZhbHVlLl9fdHlwZSAhPT0gJ0J5dGVzJykge1xuICAgIC8vTm90ZTogV2UgbWF5IG5vdCBrbm93IHRoZSB0eXBlIG9mIGEgZmllbGQgaGVyZSwgYXMgdGhlIHVzZXIgY291bGQgYmUgc2F2aW5nIChudWxsKSB0byBhIGZpZWxkXG4gICAgLy9UaGF0IG5ldmVyIGV4aXN0ZWQgYmVmb3JlLCBtZWFuaW5nIHdlIGNhbid0IGluZmVyIHRoZSB0eXBlLlxuICAgIGlmIChzY2hlbWEuZmllbGRzW3Jlc3RLZXldICYmIHNjaGVtYS5maWVsZHNbcmVzdEtleV0udHlwZSA9PSAnUG9pbnRlcicgfHwgcmVzdFZhbHVlLl9fdHlwZSA9PSAnUG9pbnRlcicpIHtcbiAgICAgIHJlc3RLZXkgPSAnX3BfJyArIHJlc3RLZXk7XG4gICAgfVxuICB9XG5cbiAgLy8gSGFuZGxlIGF0b21pYyB2YWx1ZXNcbiAgdmFyIHZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gIGlmICh2YWx1ZSAhPT0gQ2Fubm90VHJhbnNmb3JtKSB7XG4gICAgcmV0dXJuIHtrZXk6IHJlc3RLZXksIHZhbHVlOiB2YWx1ZX07XG4gIH1cblxuICAvLyBBQ0xzIGFyZSBoYW5kbGVkIGJlZm9yZSB0aGlzIG1ldGhvZCBpcyBjYWxsZWRcbiAgLy8gSWYgYW4gQUNMIGtleSBzdGlsbCBleGlzdHMgaGVyZSwgc29tZXRoaW5nIGlzIHdyb25nLlxuICBpZiAocmVzdEtleSA9PT0gJ0FDTCcpIHtcbiAgICB0aHJvdyAnVGhlcmUgd2FzIGEgcHJvYmxlbSB0cmFuc2Zvcm1pbmcgYW4gQUNMLic7XG4gIH1cblxuICAvLyBIYW5kbGUgYXJyYXlzXG4gIGlmIChyZXN0VmFsdWUgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIHZhbHVlID0gcmVzdFZhbHVlLm1hcCh0cmFuc2Zvcm1JbnRlcmlvclZhbHVlKTtcbiAgICByZXR1cm4ge2tleTogcmVzdEtleSwgdmFsdWU6IHZhbHVlfTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBub3JtYWwgb2JqZWN0cyBieSByZWN1cnNpbmdcbiAgaWYgKE9iamVjdC5rZXlzKHJlc3RWYWx1ZSkuc29tZShrZXkgPT4ga2V5LmluY2x1ZGVzKCckJykgfHwga2V5LmluY2x1ZGVzKCcuJykpKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfTkVTVEVEX0tFWSwgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiKTtcbiAgfVxuICB2YWx1ZSA9IG1hcFZhbHVlcyhyZXN0VmFsdWUsIHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xuICByZXR1cm4ge2tleTogcmVzdEtleSwgdmFsdWV9O1xufVxuXG5jb25zdCBwYXJzZU9iamVjdFRvTW9uZ29PYmplY3RGb3JDcmVhdGUgPSAoY2xhc3NOYW1lLCByZXN0Q3JlYXRlLCBzY2hlbWEpID0+IHtcbiAgcmVzdENyZWF0ZSA9IGFkZExlZ2FjeUFDTChyZXN0Q3JlYXRlKTtcbiAgY29uc3QgbW9uZ29DcmVhdGUgPSB7fVxuICBmb3IgKGNvbnN0IHJlc3RLZXkgaW4gcmVzdENyZWF0ZSkge1xuICAgIGlmIChyZXN0Q3JlYXRlW3Jlc3RLZXldICYmIHJlc3RDcmVhdGVbcmVzdEtleV0uX190eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgeyBrZXksIHZhbHVlIH0gPSBwYXJzZU9iamVjdEtleVZhbHVlVG9Nb25nb09iamVjdEtleVZhbHVlKFxuICAgICAgcmVzdEtleSxcbiAgICAgIHJlc3RDcmVhdGVbcmVzdEtleV0sXG4gICAgICBzY2hlbWFcbiAgICApO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBtb25nb0NyZWF0ZVtrZXldID0gdmFsdWU7XG4gICAgfVxuICB9XG5cbiAgLy8gVXNlIHRoZSBsZWdhY3kgbW9uZ28gZm9ybWF0IGZvciBjcmVhdGVkQXQgYW5kIHVwZGF0ZWRBdFxuICBpZiAobW9uZ29DcmVhdGUuY3JlYXRlZEF0KSB7XG4gICAgbW9uZ29DcmVhdGUuX2NyZWF0ZWRfYXQgPSBuZXcgRGF0ZShtb25nb0NyZWF0ZS5jcmVhdGVkQXQuaXNvIHx8IG1vbmdvQ3JlYXRlLmNyZWF0ZWRBdCk7XG4gICAgZGVsZXRlIG1vbmdvQ3JlYXRlLmNyZWF0ZWRBdDtcbiAgfVxuICBpZiAobW9uZ29DcmVhdGUudXBkYXRlZEF0KSB7XG4gICAgbW9uZ29DcmVhdGUuX3VwZGF0ZWRfYXQgPSBuZXcgRGF0ZShtb25nb0NyZWF0ZS51cGRhdGVkQXQuaXNvIHx8IG1vbmdvQ3JlYXRlLnVwZGF0ZWRBdCk7XG4gICAgZGVsZXRlIG1vbmdvQ3JlYXRlLnVwZGF0ZWRBdDtcbiAgfVxuXG4gIHJldHVybiBtb25nb0NyZWF0ZTtcbn1cblxuLy8gTWFpbiBleHBvc2VkIG1ldGhvZCB0byBoZWxwIHVwZGF0ZSBvbGQgb2JqZWN0cy5cbmNvbnN0IHRyYW5zZm9ybVVwZGF0ZSA9IChjbGFzc05hbWUsIHJlc3RVcGRhdGUsIHBhcnNlRm9ybWF0U2NoZW1hKSA9PiB7XG4gIGNvbnN0IG1vbmdvVXBkYXRlID0ge307XG4gIGNvbnN0IGFjbCA9IGFkZExlZ2FjeUFDTChyZXN0VXBkYXRlKTtcbiAgaWYgKGFjbC5fcnBlcm0gfHwgYWNsLl93cGVybSB8fCBhY2wuX2FjbCkge1xuICAgIG1vbmdvVXBkYXRlLiRzZXQgPSB7fTtcbiAgICBpZiAoYWNsLl9ycGVybSkge1xuICAgICAgbW9uZ29VcGRhdGUuJHNldC5fcnBlcm0gPSBhY2wuX3JwZXJtO1xuICAgIH1cbiAgICBpZiAoYWNsLl93cGVybSkge1xuICAgICAgbW9uZ29VcGRhdGUuJHNldC5fd3Blcm0gPSBhY2wuX3dwZXJtO1xuICAgIH1cbiAgICBpZiAoYWNsLl9hY2wpIHtcbiAgICAgIG1vbmdvVXBkYXRlLiRzZXQuX2FjbCA9IGFjbC5fYWNsO1xuICAgIH1cbiAgfVxuICBmb3IgKHZhciByZXN0S2V5IGluIHJlc3RVcGRhdGUpIHtcbiAgICBpZiAocmVzdFVwZGF0ZVtyZXN0S2V5XSAmJiByZXN0VXBkYXRlW3Jlc3RLZXldLl9fdHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHZhciBvdXQgPSB0cmFuc2Zvcm1LZXlWYWx1ZUZvclVwZGF0ZShjbGFzc05hbWUsIHJlc3RLZXksIHJlc3RVcGRhdGVbcmVzdEtleV0sIHBhcnNlRm9ybWF0U2NoZW1hKTtcblxuICAgIC8vIElmIHRoZSBvdXRwdXQgdmFsdWUgaXMgYW4gb2JqZWN0IHdpdGggYW55ICQga2V5cywgaXQncyBhblxuICAgIC8vIG9wZXJhdG9yIHRoYXQgbmVlZHMgdG8gYmUgbGlmdGVkIG9udG8gdGhlIHRvcCBsZXZlbCB1cGRhdGVcbiAgICAvLyBvYmplY3QuXG4gICAgaWYgKHR5cGVvZiBvdXQudmFsdWUgPT09ICdvYmplY3QnICYmIG91dC52YWx1ZSAhPT0gbnVsbCAmJiBvdXQudmFsdWUuX19vcCkge1xuICAgICAgbW9uZ29VcGRhdGVbb3V0LnZhbHVlLl9fb3BdID0gbW9uZ29VcGRhdGVbb3V0LnZhbHVlLl9fb3BdIHx8IHt9O1xuICAgICAgbW9uZ29VcGRhdGVbb3V0LnZhbHVlLl9fb3BdW291dC5rZXldID0gb3V0LnZhbHVlLmFyZztcbiAgICB9IGVsc2Uge1xuICAgICAgbW9uZ29VcGRhdGVbJyRzZXQnXSA9IG1vbmdvVXBkYXRlWyckc2V0J10gfHwge307XG4gICAgICBtb25nb1VwZGF0ZVsnJHNldCddW291dC5rZXldID0gb3V0LnZhbHVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBtb25nb1VwZGF0ZTtcbn1cblxuLy8gQWRkIHRoZSBsZWdhY3kgX2FjbCBmb3JtYXQuXG5jb25zdCBhZGRMZWdhY3lBQ0wgPSByZXN0T2JqZWN0ID0+IHtcbiAgY29uc3QgcmVzdE9iamVjdENvcHkgPSB7Li4ucmVzdE9iamVjdH07XG4gIGNvbnN0IF9hY2wgPSB7fTtcblxuICBpZiAocmVzdE9iamVjdC5fd3Blcm0pIHtcbiAgICByZXN0T2JqZWN0Ll93cGVybS5mb3JFYWNoKGVudHJ5ID0+IHtcbiAgICAgIF9hY2xbZW50cnldID0geyB3OiB0cnVlIH07XG4gICAgfSk7XG4gICAgcmVzdE9iamVjdENvcHkuX2FjbCA9IF9hY2w7XG4gIH1cblxuICBpZiAocmVzdE9iamVjdC5fcnBlcm0pIHtcbiAgICByZXN0T2JqZWN0Ll9ycGVybS5mb3JFYWNoKGVudHJ5ID0+IHtcbiAgICAgIGlmICghKGVudHJ5IGluIF9hY2wpKSB7XG4gICAgICAgIF9hY2xbZW50cnldID0geyByOiB0cnVlIH07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBfYWNsW2VudHJ5XS5yID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXN0T2JqZWN0Q29weS5fYWNsID0gX2FjbDtcbiAgfVxuXG4gIHJldHVybiByZXN0T2JqZWN0Q29weTtcbn1cblxuXG4vLyBBIHNlbnRpbmVsIHZhbHVlIHRoYXQgaGVscGVyIHRyYW5zZm9ybWF0aW9ucyByZXR1cm4gd2hlbiB0aGV5XG4vLyBjYW5ub3QgcGVyZm9ybSBhIHRyYW5zZm9ybWF0aW9uXG5mdW5jdGlvbiBDYW5ub3RUcmFuc2Zvcm0oKSB7fVxuXG5jb25zdCB0cmFuc2Zvcm1JbnRlcmlvckF0b20gPSAoYXRvbSkgPT4ge1xuICAvLyBUT0RPOiBjaGVjayB2YWxpZGl0eSBoYXJkZXIgZm9yIHRoZSBfX3R5cGUtZGVmaW5lZCB0eXBlc1xuICBpZiAodHlwZW9mIGF0b20gPT09ICdvYmplY3QnICYmIGF0b20gJiYgIShhdG9tIGluc3RhbmNlb2YgRGF0ZSkgJiYgYXRvbS5fX3R5cGUgPT09ICdQb2ludGVyJykge1xuICAgIHJldHVybiB7XG4gICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgIGNsYXNzTmFtZTogYXRvbS5jbGFzc05hbWUsXG4gICAgICBvYmplY3RJZDogYXRvbS5vYmplY3RJZFxuICAgIH07XG4gIH0gZWxzZSBpZiAodHlwZW9mIGF0b20gPT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIGF0b20gPT09ICdzeW1ib2wnKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYGNhbm5vdCB0cmFuc2Zvcm0gdmFsdWU6ICR7YXRvbX1gKTtcbiAgfSBlbHNlIGlmIChEYXRlQ29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICByZXR1cm4gRGF0ZUNvZGVyLkpTT05Ub0RhdGFiYXNlKGF0b20pO1xuICB9IGVsc2UgaWYgKEJ5dGVzQ29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICByZXR1cm4gQnl0ZXNDb2Rlci5KU09OVG9EYXRhYmFzZShhdG9tKTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgYXRvbSA9PT0gJ29iamVjdCcgJiYgYXRvbSAmJiBhdG9tLiRyZWdleCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIG5ldyBSZWdFeHAoYXRvbS4kcmVnZXgpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhdG9tO1xuICB9XG59XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byB0cmFuc2Zvcm0gYW4gYXRvbSBmcm9tIFJFU1QgZm9ybWF0IHRvIE1vbmdvIGZvcm1hdC5cbi8vIEFuIGF0b20gaXMgYW55dGhpbmcgdGhhdCBjYW4ndCBjb250YWluIG90aGVyIGV4cHJlc3Npb25zLiBTbyBpdFxuLy8gaW5jbHVkZXMgdGhpbmdzIHdoZXJlIG9iamVjdHMgYXJlIHVzZWQgdG8gcmVwcmVzZW50IG90aGVyXG4vLyBkYXRhdHlwZXMsIGxpa2UgcG9pbnRlcnMgYW5kIGRhdGVzLCBidXQgaXQgZG9lcyBub3QgaW5jbHVkZSBvYmplY3RzXG4vLyBvciBhcnJheXMgd2l0aCBnZW5lcmljIHN0dWZmIGluc2lkZS5cbi8vIFJhaXNlcyBhbiBlcnJvciBpZiB0aGlzIGNhbm5vdCBwb3NzaWJseSBiZSB2YWxpZCBSRVNUIGZvcm1hdC5cbi8vIFJldHVybnMgQ2Fubm90VHJhbnNmb3JtIGlmIGl0J3MganVzdCBub3QgYW4gYXRvbVxuZnVuY3Rpb24gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKGF0b20sIGZpZWxkKSB7XG4gIHN3aXRjaCh0eXBlb2YgYXRvbSkge1xuICBjYXNlICdudW1iZXInOlxuICBjYXNlICdib29sZWFuJzpcbiAgY2FzZSAndW5kZWZpbmVkJzpcbiAgICByZXR1cm4gYXRvbTtcbiAgY2FzZSAnc3RyaW5nJzpcbiAgICBpZiAoZmllbGQgJiYgZmllbGQudHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICByZXR1cm4gYCR7ZmllbGQudGFyZ2V0Q2xhc3N9JCR7YXRvbX1gO1xuICAgIH1cbiAgICByZXR1cm4gYXRvbTtcbiAgY2FzZSAnc3ltYm9sJzpcbiAgY2FzZSAnZnVuY3Rpb24nOlxuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sIGBjYW5ub3QgdHJhbnNmb3JtIHZhbHVlOiAke2F0b219YCk7XG4gIGNhc2UgJ29iamVjdCc6XG4gICAgaWYgKGF0b20gaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAvLyBUZWNobmljYWxseSBkYXRlcyBhcmUgbm90IHJlc3QgZm9ybWF0LCBidXQsIGl0IHNlZW1zIHByZXR0eVxuICAgICAgLy8gY2xlYXIgd2hhdCB0aGV5IHNob3VsZCBiZSB0cmFuc2Zvcm1lZCB0bywgc28gbGV0J3MganVzdCBkbyBpdC5cbiAgICAgIHJldHVybiBhdG9tO1xuICAgIH1cblxuICAgIGlmIChhdG9tID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gYXRvbTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBjaGVjayB2YWxpZGl0eSBoYXJkZXIgZm9yIHRoZSBfX3R5cGUtZGVmaW5lZCB0eXBlc1xuICAgIGlmIChhdG9tLl9fdHlwZSA9PSAnUG9pbnRlcicpIHtcbiAgICAgIHJldHVybiBgJHthdG9tLmNsYXNzTmFtZX0kJHthdG9tLm9iamVjdElkfWA7XG4gICAgfVxuICAgIGlmIChEYXRlQ29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICAgIHJldHVybiBEYXRlQ29kZXIuSlNPTlRvRGF0YWJhc2UoYXRvbSk7XG4gICAgfVxuICAgIGlmIChCeXRlc0NvZGVyLmlzVmFsaWRKU09OKGF0b20pKSB7XG4gICAgICByZXR1cm4gQnl0ZXNDb2Rlci5KU09OVG9EYXRhYmFzZShhdG9tKTtcbiAgICB9XG4gICAgaWYgKEdlb1BvaW50Q29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICAgIHJldHVybiBHZW9Qb2ludENvZGVyLkpTT05Ub0RhdGFiYXNlKGF0b20pO1xuICAgIH1cbiAgICBpZiAoUG9seWdvbkNvZGVyLmlzVmFsaWRKU09OKGF0b20pKSB7XG4gICAgICByZXR1cm4gUG9seWdvbkNvZGVyLkpTT05Ub0RhdGFiYXNlKGF0b20pO1xuICAgIH1cbiAgICBpZiAoRmlsZUNvZGVyLmlzVmFsaWRKU09OKGF0b20pKSB7XG4gICAgICByZXR1cm4gRmlsZUNvZGVyLkpTT05Ub0RhdGFiYXNlKGF0b20pO1xuICAgIH1cbiAgICByZXR1cm4gQ2Fubm90VHJhbnNmb3JtO1xuXG4gIGRlZmF1bHQ6XG4gICAgLy8gSSBkb24ndCB0aGluayB0eXBlb2YgY2FuIGV2ZXIgbGV0IHVzIGdldCBoZXJlXG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUiwgYHJlYWxseSBkaWQgbm90IGV4cGVjdCB2YWx1ZTogJHthdG9tfWApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlbGF0aXZlVGltZVRvRGF0ZSh0ZXh0LCBub3cgPSBuZXcgRGF0ZSgpKSB7XG4gIHRleHQgPSB0ZXh0LnRvTG93ZXJDYXNlKCk7XG5cbiAgbGV0IHBhcnRzID0gdGV4dC5zcGxpdCgnICcpO1xuXG4gIC8vIEZpbHRlciBvdXQgd2hpdGVzcGFjZVxuICBwYXJ0cyA9IHBhcnRzLmZpbHRlcigocGFydCkgPT4gcGFydCAhPT0gJycpO1xuXG4gIGNvbnN0IGZ1dHVyZSA9IHBhcnRzWzBdID09PSAnaW4nO1xuICBjb25zdCBwYXN0ID0gcGFydHNbcGFydHMubGVuZ3RoIC0gMV0gPT09ICdhZ28nO1xuXG4gIGlmICghZnV0dXJlICYmICFwYXN0ICYmIHRleHQgIT09ICdub3cnKSB7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAnZXJyb3InLCBpbmZvOiBcIlRpbWUgc2hvdWxkIGVpdGhlciBzdGFydCB3aXRoICdpbicgb3IgZW5kIHdpdGggJ2FnbydcIiB9O1xuICB9XG5cbiAgaWYgKGZ1dHVyZSAmJiBwYXN0KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ2Vycm9yJyxcbiAgICAgIGluZm86IFwiVGltZSBjYW5ub3QgaGF2ZSBib3RoICdpbicgYW5kICdhZ28nXCIsXG4gICAgfTtcbiAgfVxuXG4gIC8vIHN0cmlwIHRoZSAnYWdvJyBvciAnaW4nXG4gIGlmIChmdXR1cmUpIHtcbiAgICBwYXJ0cyA9IHBhcnRzLnNsaWNlKDEpO1xuICB9IGVsc2UgeyAvLyBwYXN0XG4gICAgcGFydHMgPSBwYXJ0cy5zbGljZSgwLCBwYXJ0cy5sZW5ndGggLSAxKTtcbiAgfVxuXG4gIGlmIChwYXJ0cy5sZW5ndGggJSAyICE9PSAwICYmIHRleHQgIT09ICdub3cnKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ2Vycm9yJyxcbiAgICAgIGluZm86ICdJbnZhbGlkIHRpbWUgc3RyaW5nLiBEYW5nbGluZyB1bml0IG9yIG51bWJlci4nLFxuICAgIH07XG4gIH1cblxuICBjb25zdCBwYWlycyA9IFtdO1xuICB3aGlsZShwYXJ0cy5sZW5ndGgpIHtcbiAgICBwYWlycy5wdXNoKFsgcGFydHMuc2hpZnQoKSwgcGFydHMuc2hpZnQoKSBdKTtcbiAgfVxuXG4gIGxldCBzZWNvbmRzID0gMDtcbiAgZm9yIChjb25zdCBbbnVtLCBpbnRlcnZhbF0gb2YgcGFpcnMpIHtcbiAgICBjb25zdCB2YWwgPSBOdW1iZXIobnVtKTtcbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIodmFsKSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgICBpbmZvOiBgJyR7bnVtfScgaXMgbm90IGFuIGludGVnZXIuYCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgc3dpdGNoKGludGVydmFsKSB7XG4gICAgY2FzZSAneXInOlxuICAgIGNhc2UgJ3lycyc6XG4gICAgY2FzZSAneWVhcic6XG4gICAgY2FzZSAneWVhcnMnOlxuICAgICAgc2Vjb25kcyArPSB2YWwgKiAzMTUzNjAwMDsgLy8gMzY1ICogMjQgKiA2MCAqIDYwXG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3drJzpcbiAgICBjYXNlICd3a3MnOlxuICAgIGNhc2UgJ3dlZWsnOlxuICAgIGNhc2UgJ3dlZWtzJzpcbiAgICAgIHNlY29uZHMgKz0gdmFsICogNjA0ODAwOyAvLyA3ICogMjQgKiA2MCAqIDYwXG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ2QnOlxuICAgIGNhc2UgJ2RheSc6XG4gICAgY2FzZSAnZGF5cyc6XG4gICAgICBzZWNvbmRzICs9IHZhbCAqIDg2NDAwOyAvLyAyNCAqIDYwICogNjBcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnaHInOlxuICAgIGNhc2UgJ2hycyc6XG4gICAgY2FzZSAnaG91cic6XG4gICAgY2FzZSAnaG91cnMnOlxuICAgICAgc2Vjb25kcyArPSB2YWwgKiAzNjAwOyAvLyA2MCAqIDYwXG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ21pbic6XG4gICAgY2FzZSAnbWlucyc6XG4gICAgY2FzZSAnbWludXRlJzpcbiAgICBjYXNlICdtaW51dGVzJzpcbiAgICAgIHNlY29uZHMgKz0gdmFsICogNjA7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3NlYyc6XG4gICAgY2FzZSAnc2Vjcyc6XG4gICAgY2FzZSAnc2Vjb25kJzpcbiAgICBjYXNlICdzZWNvbmRzJzpcbiAgICAgIHNlY29uZHMgKz0gdmFsO1xuICAgICAgYnJlYWs7XG5cbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgICBpbmZvOiBgSW52YWxpZCBpbnRlcnZhbDogJyR7aW50ZXJ2YWx9J2AsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IG1pbGxpc2Vjb25kcyA9IHNlY29uZHMgKiAxMDAwO1xuICBpZiAoZnV0dXJlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ3N1Y2Nlc3MnLFxuICAgICAgaW5mbzogJ2Z1dHVyZScsXG4gICAgICByZXN1bHQ6IG5ldyBEYXRlKG5vdy52YWx1ZU9mKCkgKyBtaWxsaXNlY29uZHMpXG4gICAgfTtcbiAgfSBlbHNlIGlmIChwYXN0KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ3N1Y2Nlc3MnLFxuICAgICAgaW5mbzogJ3Bhc3QnLFxuICAgICAgcmVzdWx0OiBuZXcgRGF0ZShub3cudmFsdWVPZigpIC0gbWlsbGlzZWNvbmRzKVxuICAgIH07XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ3N1Y2Nlc3MnLFxuICAgICAgaW5mbzogJ3ByZXNlbnQnLFxuICAgICAgcmVzdWx0OiBuZXcgRGF0ZShub3cudmFsdWVPZigpKVxuICAgIH1cbiAgfVxufVxuXG4vLyBUcmFuc2Zvcm1zIGEgcXVlcnkgY29uc3RyYWludCBmcm9tIFJFU1QgQVBJIGZvcm1hdCB0byBNb25nbyBmb3JtYXQuXG4vLyBBIGNvbnN0cmFpbnQgaXMgc29tZXRoaW5nIHdpdGggZmllbGRzIGxpa2UgJGx0LlxuLy8gSWYgaXQgaXMgbm90IGEgdmFsaWQgY29uc3RyYWludCBidXQgaXQgY291bGQgYmUgYSB2YWxpZCBzb21ldGhpbmdcbi8vIGVsc2UsIHJldHVybiBDYW5ub3RUcmFuc2Zvcm0uXG4vLyBpbkFycmF5IGlzIHdoZXRoZXIgdGhpcyBpcyBhbiBhcnJheSBmaWVsZC5cbmZ1bmN0aW9uIHRyYW5zZm9ybUNvbnN0cmFpbnQoY29uc3RyYWludCwgZmllbGQpIHtcbiAgY29uc3QgaW5BcnJheSA9IGZpZWxkICYmIGZpZWxkLnR5cGUgJiYgZmllbGQudHlwZSA9PT0gJ0FycmF5JztcbiAgaWYgKHR5cGVvZiBjb25zdHJhaW50ICE9PSAnb2JqZWN0JyB8fCAhY29uc3RyYWludCkge1xuICAgIHJldHVybiBDYW5ub3RUcmFuc2Zvcm07XG4gIH1cbiAgY29uc3QgdHJhbnNmb3JtRnVuY3Rpb24gPSBpbkFycmF5ID8gdHJhbnNmb3JtSW50ZXJpb3JBdG9tIDogdHJhbnNmb3JtVG9wTGV2ZWxBdG9tO1xuICBjb25zdCB0cmFuc2Zvcm1lciA9IChhdG9tKSA9PiB7XG4gICAgY29uc3QgcmVzdWx0ID0gdHJhbnNmb3JtRnVuY3Rpb24oYXRvbSwgZmllbGQpO1xuICAgIGlmIChyZXN1bHQgPT09IENhbm5vdFRyYW5zZm9ybSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYGJhZCBhdG9tOiAke0pTT04uc3RyaW5naWZ5KGF0b20pfWApO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG4gIC8vIGtleXMgaXMgdGhlIGNvbnN0cmFpbnRzIGluIHJldmVyc2UgYWxwaGFiZXRpY2FsIG9yZGVyLlxuICAvLyBUaGlzIGlzIGEgaGFjayBzbyB0aGF0OlxuICAvLyAgICRyZWdleCBpcyBoYW5kbGVkIGJlZm9yZSAkb3B0aW9uc1xuICAvLyAgICRuZWFyU3BoZXJlIGlzIGhhbmRsZWQgYmVmb3JlICRtYXhEaXN0YW5jZVxuICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKGNvbnN0cmFpbnQpLnNvcnQoKS5yZXZlcnNlKCk7XG4gIHZhciBhbnN3ZXIgPSB7fTtcbiAgZm9yICh2YXIga2V5IG9mIGtleXMpIHtcbiAgICBzd2l0Y2goa2V5KSB7XG4gICAgY2FzZSAnJGx0JzpcbiAgICBjYXNlICckbHRlJzpcbiAgICBjYXNlICckZ3QnOlxuICAgIGNhc2UgJyRndGUnOlxuICAgIGNhc2UgJyRleGlzdHMnOlxuICAgIGNhc2UgJyRuZSc6XG4gICAgY2FzZSAnJGVxJzoge1xuICAgICAgY29uc3QgdmFsID0gY29uc3RyYWludFtrZXldO1xuICAgICAgaWYgKHZhbCAmJiB0eXBlb2YgdmFsID09PSAnb2JqZWN0JyAmJiB2YWwuJHJlbGF0aXZlVGltZSkge1xuICAgICAgICBpZiAoZmllbGQgJiYgZmllbGQudHlwZSAhPT0gJ0RhdGUnKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJyRyZWxhdGl2ZVRpbWUgY2FuIG9ubHkgYmUgdXNlZCB3aXRoIERhdGUgZmllbGQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHN3aXRjaCAoa2V5KSB7XG4gICAgICAgIGNhc2UgJyRleGlzdHMnOlxuICAgICAgICBjYXNlICckbmUnOlxuICAgICAgICBjYXNlICckZXEnOlxuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICckcmVsYXRpdmVUaW1lIGNhbiBvbmx5IGJlIHVzZWQgd2l0aCB0aGUgJGx0LCAkbHRlLCAkZ3QsIGFuZCAkZ3RlIG9wZXJhdG9ycycpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGFyc2VyUmVzdWx0ID0gcmVsYXRpdmVUaW1lVG9EYXRlKHZhbC4kcmVsYXRpdmVUaW1lKTtcbiAgICAgICAgaWYgKHBhcnNlclJlc3VsdC5zdGF0dXMgPT09ICdzdWNjZXNzJykge1xuICAgICAgICAgIGFuc3dlcltrZXldID0gcGFyc2VyUmVzdWx0LnJlc3VsdDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGxvZy5pbmZvKCdFcnJvciB3aGlsZSBwYXJzaW5nIHJlbGF0aXZlIGRhdGUnLCBwYXJzZXJSZXN1bHQpO1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgYmFkICRyZWxhdGl2ZVRpbWUgKCR7a2V5fSkgdmFsdWUuICR7cGFyc2VyUmVzdWx0LmluZm99YCk7XG4gICAgICB9XG5cbiAgICAgIGFuc3dlcltrZXldID0gdHJhbnNmb3JtZXIodmFsKTtcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGNhc2UgJyRpbic6XG4gICAgY2FzZSAnJG5pbic6IHtcbiAgICAgIGNvbnN0IGFyciA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgIGlmICghKGFyciBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICcgKyBrZXkgKyAnIHZhbHVlJyk7XG4gICAgICB9XG4gICAgICBhbnN3ZXJba2V5XSA9IF8uZmxhdE1hcChhcnIsIHZhbHVlID0+IHtcbiAgICAgICAgcmV0dXJuICgoYXRvbSkgPT4ge1xuICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGF0b20pKSB7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWUubWFwKHRyYW5zZm9ybWVyKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHRyYW5zZm9ybWVyKGF0b20pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSkodmFsdWUpO1xuICAgICAgfSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2FzZSAnJGFsbCc6IHtcbiAgICAgIGNvbnN0IGFyciA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgIGlmICghKGFyciBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICdiYWQgJyArIGtleSArICcgdmFsdWUnKTtcbiAgICAgIH1cbiAgICAgIGFuc3dlcltrZXldID0gYXJyLm1hcCh0cmFuc2Zvcm1JbnRlcmlvckF0b20pO1xuXG4gICAgICBjb25zdCB2YWx1ZXMgPSBhbnN3ZXJba2V5XTtcbiAgICAgIGlmIChpc0FueVZhbHVlUmVnZXgodmFsdWVzKSAmJiAhaXNBbGxWYWx1ZXNSZWdleE9yTm9uZSh2YWx1ZXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdBbGwgJGFsbCB2YWx1ZXMgbXVzdCBiZSBvZiByZWdleCB0eXBlIG9yIG5vbmU6ICdcbiAgICAgICAgICArIHZhbHVlcyk7XG4gICAgICB9XG5cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjYXNlICckcmVnZXgnOlxuICAgICAgdmFyIHMgPSBjb25zdHJhaW50W2tleV07XG4gICAgICBpZiAodHlwZW9mIHMgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdiYWQgcmVnZXg6ICcgKyBzKTtcbiAgICAgIH1cbiAgICAgIGFuc3dlcltrZXldID0gcztcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnJGNvbnRhaW5lZEJ5Jzoge1xuICAgICAgY29uc3QgYXJyID0gY29uc3RyYWludFtrZXldO1xuICAgICAgaWYgKCEoYXJyIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkY29udGFpbmVkQnk6IHNob3VsZCBiZSBhbiBhcnJheWBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGFuc3dlci4kZWxlbU1hdGNoID0ge1xuICAgICAgICAkbmluOiBhcnIubWFwKHRyYW5zZm9ybWVyKVxuICAgICAgfTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjYXNlICckb3B0aW9ucyc6XG4gICAgICBhbnN3ZXJba2V5XSA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnJHRleHQnOiB7XG4gICAgICBjb25zdCBzZWFyY2ggPSBjb25zdHJhaW50W2tleV0uJHNlYXJjaDtcbiAgICAgIGlmICh0eXBlb2Ygc2VhcmNoICE9PSAnb2JqZWN0Jykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRzZWFyY2gsIHNob3VsZCBiZSBvYmplY3RgXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoIXNlYXJjaC4kdGVybSB8fCB0eXBlb2Ygc2VhcmNoLiR0ZXJtICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICR0ZXJtLCBzaG91bGQgYmUgc3RyaW5nYFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICAgJyRzZWFyY2gnOiBzZWFyY2guJHRlcm1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHNlYXJjaC4kbGFuZ3VhZ2UgJiYgdHlwZW9mIHNlYXJjaC4kbGFuZ3VhZ2UgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGxhbmd1YWdlLCBzaG91bGQgYmUgc3RyaW5nYFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChzZWFyY2guJGxhbmd1YWdlKSB7XG4gICAgICAgIGFuc3dlcltrZXldLiRsYW5ndWFnZSA9IHNlYXJjaC4kbGFuZ3VhZ2U7XG4gICAgICB9XG4gICAgICBpZiAoc2VhcmNoLiRjYXNlU2Vuc2l0aXZlICYmIHR5cGVvZiBzZWFyY2guJGNhc2VTZW5zaXRpdmUgIT09ICdib29sZWFuJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRjYXNlU2Vuc2l0aXZlLCBzaG91bGQgYmUgYm9vbGVhbmBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VhcmNoLiRjYXNlU2Vuc2l0aXZlKSB7XG4gICAgICAgIGFuc3dlcltrZXldLiRjYXNlU2Vuc2l0aXZlID0gc2VhcmNoLiRjYXNlU2Vuc2l0aXZlO1xuICAgICAgfVxuICAgICAgaWYgKHNlYXJjaC4kZGlhY3JpdGljU2Vuc2l0aXZlICYmIHR5cGVvZiBzZWFyY2guJGRpYWNyaXRpY1NlbnNpdGl2ZSAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGRpYWNyaXRpY1NlbnNpdGl2ZSwgc2hvdWxkIGJlIGJvb2xlYW5gXG4gICAgICAgICk7XG4gICAgICB9IGVsc2UgaWYgKHNlYXJjaC4kZGlhY3JpdGljU2Vuc2l0aXZlKSB7XG4gICAgICAgIGFuc3dlcltrZXldLiRkaWFjcml0aWNTZW5zaXRpdmUgPSBzZWFyY2guJGRpYWNyaXRpY1NlbnNpdGl2ZTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjYXNlICckbmVhclNwaGVyZSc6XG4gICAgICB2YXIgcG9pbnQgPSBjb25zdHJhaW50W2tleV07XG4gICAgICBhbnN3ZXJba2V5XSA9IFtwb2ludC5sb25naXR1ZGUsIHBvaW50LmxhdGl0dWRlXTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnJG1heERpc3RhbmNlJzpcbiAgICAgIGFuc3dlcltrZXldID0gY29uc3RyYWludFtrZXldO1xuICAgICAgYnJlYWs7XG5cbiAgICAvLyBUaGUgU0RLcyBkb24ndCBzZWVtIHRvIHVzZSB0aGVzZSBidXQgdGhleSBhcmUgZG9jdW1lbnRlZCBpbiB0aGVcbiAgICAvLyBSRVNUIEFQSSBkb2NzLlxuICAgIGNhc2UgJyRtYXhEaXN0YW5jZUluUmFkaWFucyc6XG4gICAgICBhbnN3ZXJbJyRtYXhEaXN0YW5jZSddID0gY29uc3RyYWludFtrZXldO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnJG1heERpc3RhbmNlSW5NaWxlcyc6XG4gICAgICBhbnN3ZXJbJyRtYXhEaXN0YW5jZSddID0gY29uc3RyYWludFtrZXldIC8gMzk1OTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJyRtYXhEaXN0YW5jZUluS2lsb21ldGVycyc6XG4gICAgICBhbnN3ZXJbJyRtYXhEaXN0YW5jZSddID0gY29uc3RyYWludFtrZXldIC8gNjM3MTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnJHNlbGVjdCc6XG4gICAgY2FzZSAnJGRvbnRTZWxlY3QnOlxuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5DT01NQU5EX1VOQVZBSUxBQkxFLFxuICAgICAgICAndGhlICcgKyBrZXkgKyAnIGNvbnN0cmFpbnQgaXMgbm90IHN1cHBvcnRlZCB5ZXQnKTtcblxuICAgIGNhc2UgJyR3aXRoaW4nOlxuICAgICAgdmFyIGJveCA9IGNvbnN0cmFpbnRba2V5XVsnJGJveCddO1xuICAgICAgaWYgKCFib3ggfHwgYm94Lmxlbmd0aCAhPSAyKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgJ21hbGZvcm1hdHRlZCAkd2l0aGluIGFyZycpO1xuICAgICAgfVxuICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICckYm94JzogW1xuICAgICAgICAgIFtib3hbMF0ubG9uZ2l0dWRlLCBib3hbMF0ubGF0aXR1ZGVdLFxuICAgICAgICAgIFtib3hbMV0ubG9uZ2l0dWRlLCBib3hbMV0ubGF0aXR1ZGVdXG4gICAgICAgIF1cbiAgICAgIH07XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJyRnZW9XaXRoaW4nOiB7XG4gICAgICBjb25zdCBwb2x5Z29uID0gY29uc3RyYWludFtrZXldWyckcG9seWdvbiddO1xuICAgICAgY29uc3QgY2VudGVyU3BoZXJlID0gY29uc3RyYWludFtrZXldWyckY2VudGVyU3BoZXJlJ107XG4gICAgICBpZiAocG9seWdvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGxldCBwb2ludHM7XG4gICAgICAgIGlmICh0eXBlb2YgcG9seWdvbiA9PT0gJ29iamVjdCcgJiYgcG9seWdvbi5fX3R5cGUgPT09ICdQb2x5Z29uJykge1xuICAgICAgICAgIGlmICghcG9seWdvbi5jb29yZGluYXRlcyB8fCBwb2x5Z29uLmNvb3JkaW5hdGVzLmxlbmd0aCA8IDMpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWU7IFBvbHlnb24uY29vcmRpbmF0ZXMgc2hvdWxkIGNvbnRhaW4gYXQgbGVhc3QgMyBsb24vbGF0IHBhaXJzJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcG9pbnRzID0gcG9seWdvbi5jb29yZGluYXRlcztcbiAgICAgICAgfSBlbHNlIGlmIChwb2x5Z29uIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgICAgICBpZiAocG9seWdvbi5sZW5ndGggPCAzKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkcG9seWdvbiBzaG91bGQgY29udGFpbiBhdCBsZWFzdCAzIEdlb1BvaW50cydcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHBvaW50cyA9IHBvbHlnb247XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkcG9seWdvbiBzaG91bGQgYmUgUG9seWdvbiBvYmplY3Qgb3IgQXJyYXkgb2YgUGFyc2UuR2VvUG9pbnRcXCdzJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcG9pbnRzID0gcG9pbnRzLm1hcCgocG9pbnQpID0+IHtcbiAgICAgICAgICBpZiAocG9pbnQgaW5zdGFuY2VvZiBBcnJheSAmJiBwb2ludC5sZW5ndGggPT09IDIpIHtcbiAgICAgICAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwb2ludFsxXSwgcG9pbnRbMF0pO1xuICAgICAgICAgICAgcmV0dXJuIHBvaW50O1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIUdlb1BvaW50Q29kZXIuaXNWYWxpZEpTT04ocG9pbnQpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICRnZW9XaXRoaW4gdmFsdWUnKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBvaW50LmxhdGl0dWRlLCBwb2ludC5sb25naXR1ZGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gW3BvaW50LmxvbmdpdHVkZSwgcG9pbnQubGF0aXR1ZGVdO1xuICAgICAgICB9KTtcbiAgICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICAgJyRwb2x5Z29uJzogcG9pbnRzXG4gICAgICAgIH07XG4gICAgICB9IGVsc2UgaWYgKGNlbnRlclNwaGVyZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGlmICghKGNlbnRlclNwaGVyZSBpbnN0YW5jZW9mIEFycmF5KSB8fCBjZW50ZXJTcGhlcmUubGVuZ3RoIDwgMikge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJGNlbnRlclNwaGVyZSBzaG91bGQgYmUgYW4gYXJyYXkgb2YgUGFyc2UuR2VvUG9pbnQgYW5kIGRpc3RhbmNlJyk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gR2V0IHBvaW50LCBjb252ZXJ0IHRvIGdlbyBwb2ludCBpZiBuZWNlc3NhcnkgYW5kIHZhbGlkYXRlXG4gICAgICAgIGxldCBwb2ludCA9IGNlbnRlclNwaGVyZVswXTtcbiAgICAgICAgaWYgKHBvaW50IGluc3RhbmNlb2YgQXJyYXkgJiYgcG9pbnQubGVuZ3RoID09PSAyKSB7XG4gICAgICAgICAgcG9pbnQgPSBuZXcgUGFyc2UuR2VvUG9pbnQocG9pbnRbMV0sIHBvaW50WzBdKTtcbiAgICAgICAgfSBlbHNlIGlmICghR2VvUG9pbnRDb2Rlci5pc1ZhbGlkSlNPTihwb2ludCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgZ2VvIHBvaW50IGludmFsaWQnKTtcbiAgICAgICAgfVxuICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICAgIC8vIEdldCBkaXN0YW5jZSBhbmQgdmFsaWRhdGVcbiAgICAgICAgY29uc3QgZGlzdGFuY2UgPSBjZW50ZXJTcGhlcmVbMV07XG4gICAgICAgIGlmKGlzTmFOKGRpc3RhbmNlKSB8fCBkaXN0YW5jZSA8IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgZGlzdGFuY2UgaW52YWxpZCcpO1xuICAgICAgICB9XG4gICAgICAgIGFuc3dlcltrZXldID0ge1xuICAgICAgICAgICckY2VudGVyU3BoZXJlJzogW1xuICAgICAgICAgICAgW3BvaW50LmxvbmdpdHVkZSwgcG9pbnQubGF0aXR1ZGVdLFxuICAgICAgICAgICAgZGlzdGFuY2VcbiAgICAgICAgICBdXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2FzZSAnJGdlb0ludGVyc2VjdHMnOiB7XG4gICAgICBjb25zdCBwb2ludCA9IGNvbnN0cmFpbnRba2V5XVsnJHBvaW50J107XG4gICAgICBpZiAoIUdlb1BvaW50Q29kZXIuaXNWYWxpZEpTT04ocG9pbnQpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgJ2JhZCAkZ2VvSW50ZXJzZWN0IHZhbHVlOyAkcG9pbnQgc2hvdWxkIGJlIEdlb1BvaW50J1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBvaW50LmxhdGl0dWRlLCBwb2ludC5sb25naXR1ZGUpO1xuICAgICAgfVxuICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICRnZW9tZXRyeToge1xuICAgICAgICAgIHR5cGU6ICdQb2ludCcsXG4gICAgICAgICAgY29vcmRpbmF0ZXM6IFtwb2ludC5sb25naXR1ZGUsIHBvaW50LmxhdGl0dWRlXVxuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGRlZmF1bHQ6XG4gICAgICBpZiAoa2V5Lm1hdGNoKC9eXFwkKy8pKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgJ2JhZCBjb25zdHJhaW50OiAnICsga2V5KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBDYW5ub3RUcmFuc2Zvcm07XG4gICAgfVxuICB9XG4gIHJldHVybiBhbnN3ZXI7XG59XG5cbi8vIFRyYW5zZm9ybXMgYW4gdXBkYXRlIG9wZXJhdG9yIGZyb20gUkVTVCBmb3JtYXQgdG8gbW9uZ28gZm9ybWF0LlxuLy8gVG8gYmUgdHJhbnNmb3JtZWQsIHRoZSBpbnB1dCBzaG91bGQgaGF2ZSBhbiBfX29wIGZpZWxkLlxuLy8gSWYgZmxhdHRlbiBpcyB0cnVlLCB0aGlzIHdpbGwgZmxhdHRlbiBvcGVyYXRvcnMgdG8gdGhlaXIgc3RhdGljXG4vLyBkYXRhIGZvcm1hdC4gRm9yIGV4YW1wbGUsIGFuIGluY3JlbWVudCBvZiAyIHdvdWxkIHNpbXBseSBiZWNvbWUgYVxuLy8gMi5cbi8vIFRoZSBvdXRwdXQgZm9yIGEgbm9uLWZsYXR0ZW5lZCBvcGVyYXRvciBpcyBhIGhhc2ggd2l0aCBfX29wIGJlaW5nXG4vLyB0aGUgbW9uZ28gb3AsIGFuZCBhcmcgYmVpbmcgdGhlIGFyZ3VtZW50LlxuLy8gVGhlIG91dHB1dCBmb3IgYSBmbGF0dGVuZWQgb3BlcmF0b3IgaXMganVzdCBhIHZhbHVlLlxuLy8gUmV0dXJucyB1bmRlZmluZWQgaWYgdGhpcyBzaG91bGQgYmUgYSBuby1vcC5cblxuZnVuY3Rpb24gdHJhbnNmb3JtVXBkYXRlT3BlcmF0b3Ioe1xuICBfX29wLFxuICBhbW91bnQsXG4gIG9iamVjdHMsXG59LCBmbGF0dGVuKSB7XG4gIHN3aXRjaChfX29wKSB7XG4gIGNhc2UgJ0RlbGV0ZSc6XG4gICAgaWYgKGZsYXR0ZW4pIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB7X19vcDogJyR1bnNldCcsIGFyZzogJyd9O1xuICAgIH1cblxuICBjYXNlICdJbmNyZW1lbnQnOlxuICAgIGlmICh0eXBlb2YgYW1vdW50ICE9PSAnbnVtYmVyJykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2luY3JlbWVudGluZyBtdXN0IHByb3ZpZGUgYSBudW1iZXInKTtcbiAgICB9XG4gICAgaWYgKGZsYXR0ZW4pIHtcbiAgICAgIHJldHVybiBhbW91bnQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB7X19vcDogJyRpbmMnLCBhcmc6IGFtb3VudH07XG4gICAgfVxuXG4gIGNhc2UgJ0FkZCc6XG4gIGNhc2UgJ0FkZFVuaXF1ZSc6XG4gICAgaWYgKCEob2JqZWN0cyBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ29iamVjdHMgdG8gYWRkIG11c3QgYmUgYW4gYXJyYXknKTtcbiAgICB9XG4gICAgdmFyIHRvQWRkID0gb2JqZWN0cy5tYXAodHJhbnNmb3JtSW50ZXJpb3JBdG9tKTtcbiAgICBpZiAoZmxhdHRlbikge1xuICAgICAgcmV0dXJuIHRvQWRkO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgbW9uZ29PcCA9IHtcbiAgICAgICAgQWRkOiAnJHB1c2gnLFxuICAgICAgICBBZGRVbmlxdWU6ICckYWRkVG9TZXQnXG4gICAgICB9W19fb3BdO1xuICAgICAgcmV0dXJuIHtfX29wOiBtb25nb09wLCBhcmc6IHsnJGVhY2gnOiB0b0FkZH19O1xuICAgIH1cblxuICBjYXNlICdSZW1vdmUnOlxuICAgIGlmICghKG9iamVjdHMgaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdvYmplY3RzIHRvIHJlbW92ZSBtdXN0IGJlIGFuIGFycmF5Jyk7XG4gICAgfVxuICAgIHZhciB0b1JlbW92ZSA9IG9iamVjdHMubWFwKHRyYW5zZm9ybUludGVyaW9yQXRvbSk7XG4gICAgaWYgKGZsYXR0ZW4pIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHtfX29wOiAnJHB1bGxBbGwnLCBhcmc6IHRvUmVtb3ZlfTtcbiAgICB9XG5cbiAgZGVmYXVsdDpcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuQ09NTUFORF9VTkFWQUlMQUJMRSwgYFRoZSAke19fb3B9IG9wZXJhdG9yIGlzIG5vdCBzdXBwb3J0ZWQgeWV0LmApO1xuICB9XG59XG5mdW5jdGlvbiBtYXBWYWx1ZXMob2JqZWN0LCBpdGVyYXRvcikge1xuICBjb25zdCByZXN1bHQgPSB7fTtcbiAgT2JqZWN0LmtleXMob2JqZWN0KS5mb3JFYWNoKChrZXkpID0+IHtcbiAgICByZXN1bHRba2V5XSA9IGl0ZXJhdG9yKG9iamVjdFtrZXldKTtcbiAgfSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmNvbnN0IG5lc3RlZE1vbmdvT2JqZWN0VG9OZXN0ZWRQYXJzZU9iamVjdCA9IG1vbmdvT2JqZWN0ID0+IHtcbiAgc3dpdGNoKHR5cGVvZiBtb25nb09iamVjdCkge1xuICBjYXNlICdzdHJpbmcnOlxuICBjYXNlICdudW1iZXInOlxuICBjYXNlICdib29sZWFuJzpcbiAgICByZXR1cm4gbW9uZ29PYmplY3Q7XG4gIGNhc2UgJ3VuZGVmaW5lZCc6XG4gIGNhc2UgJ3N5bWJvbCc6XG4gIGNhc2UgJ2Z1bmN0aW9uJzpcbiAgICB0aHJvdyAnYmFkIHZhbHVlIGluIG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCc7XG4gIGNhc2UgJ29iamVjdCc6XG4gICAgaWYgKG1vbmdvT2JqZWN0ID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKG1vbmdvT2JqZWN0IGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgIHJldHVybiBtb25nb09iamVjdC5tYXAobmVzdGVkTW9uZ29PYmplY3RUb05lc3RlZFBhcnNlT2JqZWN0KTtcbiAgICB9XG5cbiAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm4gUGFyc2UuX2VuY29kZShtb25nb09iamVjdCk7XG4gICAgfVxuXG4gICAgaWYgKG1vbmdvT2JqZWN0IGluc3RhbmNlb2YgbW9uZ29kYi5Mb25nKSB7XG4gICAgICByZXR1cm4gbW9uZ29PYmplY3QudG9OdW1iZXIoKTtcbiAgICB9XG5cbiAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBtb25nb2RiLkRvdWJsZSkge1xuICAgICAgcmV0dXJuIG1vbmdvT2JqZWN0LnZhbHVlO1xuICAgIH1cblxuICAgIGlmIChCeXRlc0NvZGVyLmlzVmFsaWREYXRhYmFzZU9iamVjdChtb25nb09iamVjdCkpIHtcbiAgICAgIHJldHVybiBCeXRlc0NvZGVyLmRhdGFiYXNlVG9KU09OKG1vbmdvT2JqZWN0KTtcbiAgICB9XG5cbiAgICBpZiAobW9uZ29PYmplY3QuaGFzT3duUHJvcGVydHkoJ19fdHlwZScpICYmIG1vbmdvT2JqZWN0Ll9fdHlwZSA9PSAnRGF0ZScgJiYgbW9uZ29PYmplY3QuaXNvIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgbW9uZ29PYmplY3QuaXNvID0gbW9uZ29PYmplY3QuaXNvLnRvSlNPTigpO1xuICAgICAgcmV0dXJuIG1vbmdvT2JqZWN0O1xuICAgIH1cblxuICAgIHJldHVybiBtYXBWYWx1ZXMobW9uZ29PYmplY3QsIG5lc3RlZE1vbmdvT2JqZWN0VG9OZXN0ZWRQYXJzZU9iamVjdCk7XG4gIGRlZmF1bHQ6XG4gICAgdGhyb3cgJ3Vua25vd24ganMgdHlwZSc7XG4gIH1cbn1cblxuY29uc3QgdHJhbnNmb3JtUG9pbnRlclN0cmluZyA9IChzY2hlbWEsIGZpZWxkLCBwb2ludGVyU3RyaW5nKSA9PiB7XG4gIGNvbnN0IG9iakRhdGEgPSBwb2ludGVyU3RyaW5nLnNwbGl0KCckJyk7XG4gIGlmIChvYmpEYXRhWzBdICE9PSBzY2hlbWEuZmllbGRzW2ZpZWxkXS50YXJnZXRDbGFzcykge1xuICAgIHRocm93ICdwb2ludGVyIHRvIGluY29ycmVjdCBjbGFzc05hbWUnO1xuICB9XG4gIHJldHVybiB7XG4gICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgY2xhc3NOYW1lOiBvYmpEYXRhWzBdLFxuICAgIG9iamVjdElkOiBvYmpEYXRhWzFdXG4gIH07XG59XG5cbi8vIENvbnZlcnRzIGZyb20gYSBtb25nby1mb3JtYXQgb2JqZWN0IHRvIGEgUkVTVC1mb3JtYXQgb2JqZWN0LlxuLy8gRG9lcyBub3Qgc3RyaXAgb3V0IGFueXRoaW5nIGJhc2VkIG9uIGEgbGFjayBvZiBhdXRoZW50aWNhdGlvbi5cbmNvbnN0IG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCA9IChjbGFzc05hbWUsIG1vbmdvT2JqZWN0LCBzY2hlbWEpID0+IHtcbiAgc3dpdGNoKHR5cGVvZiBtb25nb09iamVjdCkge1xuICBjYXNlICdzdHJpbmcnOlxuICBjYXNlICdudW1iZXInOlxuICBjYXNlICdib29sZWFuJzpcbiAgICByZXR1cm4gbW9uZ29PYmplY3Q7XG4gIGNhc2UgJ3VuZGVmaW5lZCc6XG4gIGNhc2UgJ3N5bWJvbCc6XG4gIGNhc2UgJ2Z1bmN0aW9uJzpcbiAgICB0aHJvdyAnYmFkIHZhbHVlIGluIG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCc7XG4gIGNhc2UgJ29iamVjdCc6IHtcbiAgICBpZiAobW9uZ29PYmplY3QgPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgcmV0dXJuIG1vbmdvT2JqZWN0Lm1hcChuZXN0ZWRNb25nb09iamVjdFRvTmVzdGVkUGFyc2VPYmplY3QpO1xuICAgIH1cblxuICAgIGlmIChtb25nb09iamVjdCBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgIHJldHVybiBQYXJzZS5fZW5jb2RlKG1vbmdvT2JqZWN0KTtcbiAgICB9XG5cbiAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBtb25nb2RiLkxvbmcpIHtcbiAgICAgIHJldHVybiBtb25nb09iamVjdC50b051bWJlcigpO1xuICAgIH1cblxuICAgIGlmIChtb25nb09iamVjdCBpbnN0YW5jZW9mIG1vbmdvZGIuRG91YmxlKSB7XG4gICAgICByZXR1cm4gbW9uZ29PYmplY3QudmFsdWU7XG4gICAgfVxuXG4gICAgaWYgKEJ5dGVzQ29kZXIuaXNWYWxpZERhdGFiYXNlT2JqZWN0KG1vbmdvT2JqZWN0KSkge1xuICAgICAgcmV0dXJuIEJ5dGVzQ29kZXIuZGF0YWJhc2VUb0pTT04obW9uZ29PYmplY3QpO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3RPYmplY3QgPSB7fTtcbiAgICBpZiAobW9uZ29PYmplY3QuX3JwZXJtIHx8IG1vbmdvT2JqZWN0Ll93cGVybSkge1xuICAgICAgcmVzdE9iamVjdC5fcnBlcm0gPSBtb25nb09iamVjdC5fcnBlcm0gfHwgW107XG4gICAgICByZXN0T2JqZWN0Ll93cGVybSA9IG1vbmdvT2JqZWN0Ll93cGVybSB8fCBbXTtcbiAgICAgIGRlbGV0ZSBtb25nb09iamVjdC5fcnBlcm07XG4gICAgICBkZWxldGUgbW9uZ29PYmplY3QuX3dwZXJtO1xuICAgIH1cblxuICAgIGZvciAodmFyIGtleSBpbiBtb25nb09iamVjdCkge1xuICAgICAgc3dpdGNoKGtleSkge1xuICAgICAgY2FzZSAnX2lkJzpcbiAgICAgICAgcmVzdE9iamVjdFsnb2JqZWN0SWQnXSA9ICcnICsgbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdfaGFzaGVkX3Bhc3N3b3JkJzpcbiAgICAgICAgcmVzdE9iamVjdC5faGFzaGVkX3Bhc3N3b3JkID0gbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdfYWNsJzpcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdfZW1haWxfdmVyaWZ5X3Rva2VuJzpcbiAgICAgIGNhc2UgJ19wZXJpc2hhYmxlX3Rva2VuJzpcbiAgICAgIGNhc2UgJ19wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQnOlxuICAgICAgY2FzZSAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnOlxuICAgICAgY2FzZSAnX3RvbWJzdG9uZSc6XG4gICAgICBjYXNlICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnOlxuICAgICAgY2FzZSAnX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0JzpcbiAgICAgIGNhc2UgJ19mYWlsZWRfbG9naW5fY291bnQnOlxuICAgICAgY2FzZSAnX3Bhc3N3b3JkX2hpc3RvcnknOlxuICAgICAgICAvLyBUaG9zZSBrZXlzIHdpbGwgYmUgZGVsZXRlZCBpZiBuZWVkZWQgaW4gdGhlIERCIENvbnRyb2xsZXJcbiAgICAgICAgcmVzdE9iamVjdFtrZXldID0gbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdfc2Vzc2lvbl90b2tlbic6XG4gICAgICAgIHJlc3RPYmplY3RbJ3Nlc3Npb25Ub2tlbiddID0gbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd1cGRhdGVkQXQnOlxuICAgICAgY2FzZSAnX3VwZGF0ZWRfYXQnOlxuICAgICAgICByZXN0T2JqZWN0Wyd1cGRhdGVkQXQnXSA9IFBhcnNlLl9lbmNvZGUobmV3IERhdGUobW9uZ29PYmplY3Rba2V5XSkpLmlzbztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdjcmVhdGVkQXQnOlxuICAgICAgY2FzZSAnX2NyZWF0ZWRfYXQnOlxuICAgICAgICByZXN0T2JqZWN0WydjcmVhdGVkQXQnXSA9IFBhcnNlLl9lbmNvZGUobmV3IERhdGUobW9uZ29PYmplY3Rba2V5XSkpLmlzbztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdleHBpcmVzQXQnOlxuICAgICAgY2FzZSAnX2V4cGlyZXNBdCc6XG4gICAgICAgIHJlc3RPYmplY3RbJ2V4cGlyZXNBdCddID0gUGFyc2UuX2VuY29kZShuZXcgRGF0ZShtb25nb09iamVjdFtrZXldKSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnbGFzdFVzZWQnOlxuICAgICAgY2FzZSAnX2xhc3RfdXNlZCc6XG4gICAgICAgIHJlc3RPYmplY3RbJ2xhc3RVc2VkJ10gPSBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKG1vbmdvT2JqZWN0W2tleV0pKS5pc287XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndGltZXNVc2VkJzpcbiAgICAgIGNhc2UgJ3RpbWVzX3VzZWQnOlxuICAgICAgICByZXN0T2JqZWN0Wyd0aW1lc1VzZWQnXSA9IG1vbmdvT2JqZWN0W2tleV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgLy8gQ2hlY2sgb3RoZXIgYXV0aCBkYXRhIGtleXNcbiAgICAgICAgdmFyIGF1dGhEYXRhTWF0Y2ggPSBrZXkubWF0Y2goL15fYXV0aF9kYXRhXyhbYS16QS1aMC05X10rKSQvKTtcbiAgICAgICAgaWYgKGF1dGhEYXRhTWF0Y2gpIHtcbiAgICAgICAgICB2YXIgcHJvdmlkZXIgPSBhdXRoRGF0YU1hdGNoWzFdO1xuICAgICAgICAgIHJlc3RPYmplY3RbJ2F1dGhEYXRhJ10gPSByZXN0T2JqZWN0WydhdXRoRGF0YSddIHx8IHt9O1xuICAgICAgICAgIHJlc3RPYmplY3RbJ2F1dGhEYXRhJ11bcHJvdmlkZXJdID0gbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChrZXkuaW5kZXhPZignX3BfJykgPT0gMCkge1xuICAgICAgICAgIHZhciBuZXdLZXkgPSBrZXkuc3Vic3RyaW5nKDMpO1xuICAgICAgICAgIGlmICghc2NoZW1hLmZpZWxkc1tuZXdLZXldKSB7XG4gICAgICAgICAgICBsb2cuaW5mbygndHJhbnNmb3JtLmpzJywgJ0ZvdW5kIGEgcG9pbnRlciBjb2x1bW4gbm90IGluIHRoZSBzY2hlbWEsIGRyb3BwaW5nIGl0LicsIGNsYXNzTmFtZSwgbmV3S2V5KTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoc2NoZW1hLmZpZWxkc1tuZXdLZXldLnR5cGUgIT09ICdQb2ludGVyJykge1xuICAgICAgICAgICAgbG9nLmluZm8oJ3RyYW5zZm9ybS5qcycsICdGb3VuZCBhIHBvaW50ZXIgaW4gYSBub24tcG9pbnRlciBjb2x1bW4sIGRyb3BwaW5nIGl0LicsIGNsYXNzTmFtZSwga2V5KTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAobW9uZ29PYmplY3Rba2V5XSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJlc3RPYmplY3RbbmV3S2V5XSA9IHRyYW5zZm9ybVBvaW50ZXJTdHJpbmcoc2NoZW1hLCBuZXdLZXksIG1vbmdvT2JqZWN0W2tleV0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9IGVsc2UgaWYgKGtleVswXSA9PSAnXycgJiYga2V5ICE9ICdfX3R5cGUnKSB7XG4gICAgICAgICAgdGhyb3cgKCdiYWQga2V5IGluIHVudHJhbnNmb3JtOiAnICsga2V5KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB2YXIgdmFsdWUgPSBtb25nb09iamVjdFtrZXldO1xuICAgICAgICAgIGlmIChzY2hlbWEuZmllbGRzW2tleV0gJiYgc2NoZW1hLmZpZWxkc1trZXldLnR5cGUgPT09ICdGaWxlJyAmJiBGaWxlQ29kZXIuaXNWYWxpZERhdGFiYXNlT2JqZWN0KHZhbHVlKSkge1xuICAgICAgICAgICAgcmVzdE9iamVjdFtrZXldID0gRmlsZUNvZGVyLmRhdGFiYXNlVG9KU09OKHZhbHVlKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoc2NoZW1hLmZpZWxkc1trZXldICYmIHNjaGVtYS5maWVsZHNba2V5XS50eXBlID09PSAnR2VvUG9pbnQnICYmIEdlb1BvaW50Q29kZXIuaXNWYWxpZERhdGFiYXNlT2JqZWN0KHZhbHVlKSkge1xuICAgICAgICAgICAgcmVzdE9iamVjdFtrZXldID0gR2VvUG9pbnRDb2Rlci5kYXRhYmFzZVRvSlNPTih2YWx1ZSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHNjaGVtYS5maWVsZHNba2V5XSAmJiBzY2hlbWEuZmllbGRzW2tleV0udHlwZSA9PT0gJ1BvbHlnb24nICYmIFBvbHlnb25Db2Rlci5pc1ZhbGlkRGF0YWJhc2VPYmplY3QodmFsdWUpKSB7XG4gICAgICAgICAgICByZXN0T2JqZWN0W2tleV0gPSBQb2x5Z29uQ29kZXIuZGF0YWJhc2VUb0pTT04odmFsdWUpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChzY2hlbWEuZmllbGRzW2tleV0gJiYgc2NoZW1hLmZpZWxkc1trZXldLnR5cGUgPT09ICdCeXRlcycgJiYgQnl0ZXNDb2Rlci5pc1ZhbGlkRGF0YWJhc2VPYmplY3QodmFsdWUpKSB7XG4gICAgICAgICAgICByZXN0T2JqZWN0W2tleV0gPSBCeXRlc0NvZGVyLmRhdGFiYXNlVG9KU09OKHZhbHVlKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXN0T2JqZWN0W2tleV0gPSBuZXN0ZWRNb25nb09iamVjdFRvTmVzdGVkUGFyc2VPYmplY3QobW9uZ29PYmplY3Rba2V5XSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVsYXRpb25GaWVsZE5hbWVzID0gT2JqZWN0LmtleXMoc2NoZW1hLmZpZWxkcykuZmlsdGVyKGZpZWxkTmFtZSA9PiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ1JlbGF0aW9uJyk7XG4gICAgY29uc3QgcmVsYXRpb25GaWVsZHMgPSB7fTtcbiAgICByZWxhdGlvbkZpZWxkTmFtZXMuZm9yRWFjaChyZWxhdGlvbkZpZWxkTmFtZSA9PiB7XG4gICAgICByZWxhdGlvbkZpZWxkc1tyZWxhdGlvbkZpZWxkTmFtZV0gPSB7XG4gICAgICAgIF9fdHlwZTogJ1JlbGF0aW9uJyxcbiAgICAgICAgY2xhc3NOYW1lOiBzY2hlbWEuZmllbGRzW3JlbGF0aW9uRmllbGROYW1lXS50YXJnZXRDbGFzcyxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiB7IC4uLnJlc3RPYmplY3QsIC4uLnJlbGF0aW9uRmllbGRzIH07XG4gIH1cbiAgZGVmYXVsdDpcbiAgICB0aHJvdyAndW5rbm93biBqcyB0eXBlJztcbiAgfVxufVxuXG52YXIgRGF0ZUNvZGVyID0ge1xuICBKU09OVG9EYXRhYmFzZShqc29uKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKGpzb24uaXNvKTtcbiAgfSxcblxuICBpc1ZhbGlkSlNPTih2YWx1ZSkge1xuICAgIHJldHVybiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICAgIHZhbHVlLl9fdHlwZSA9PT0gJ0RhdGUnXG4gICAgKTtcbiAgfVxufTtcblxudmFyIEJ5dGVzQ29kZXIgPSB7XG4gIGJhc2U2NFBhdHRlcm46IG5ldyBSZWdFeHAoXCJeKD86W0EtWmEtejAtOSsvXXs0fSkqKD86W0EtWmEtejAtOSsvXXsyfT09fFtBLVphLXowLTkrL117M309KT8kXCIpLFxuICBpc0Jhc2U2NFZhbHVlKG9iamVjdCkge1xuICAgIGlmICh0eXBlb2Ygb2JqZWN0ICE9PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5iYXNlNjRQYXR0ZXJuLnRlc3Qob2JqZWN0KTtcbiAgfSxcblxuICBkYXRhYmFzZVRvSlNPTihvYmplY3QpIHtcbiAgICBsZXQgdmFsdWU7XG4gICAgaWYgKHRoaXMuaXNCYXNlNjRWYWx1ZShvYmplY3QpKSB7XG4gICAgICB2YWx1ZSA9IG9iamVjdDtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgPSBvYmplY3QuYnVmZmVyLnRvU3RyaW5nKCdiYXNlNjQnKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIF9fdHlwZTogJ0J5dGVzJyxcbiAgICAgIGJhc2U2NDogdmFsdWVcbiAgICB9O1xuICB9LFxuXG4gIGlzVmFsaWREYXRhYmFzZU9iamVjdChvYmplY3QpIHtcbiAgICByZXR1cm4gKG9iamVjdCBpbnN0YW5jZW9mIG1vbmdvZGIuQmluYXJ5KSB8fCB0aGlzLmlzQmFzZTY0VmFsdWUob2JqZWN0KTtcbiAgfSxcblxuICBKU09OVG9EYXRhYmFzZShqc29uKSB7XG4gICAgcmV0dXJuIG5ldyBtb25nb2RiLkJpbmFyeShuZXcgQnVmZmVyKGpzb24uYmFzZTY0LCAnYmFzZTY0JykpO1xuICB9LFxuXG4gIGlzVmFsaWRKU09OKHZhbHVlKSB7XG4gICAgcmV0dXJuICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgICAgdmFsdWUuX190eXBlID09PSAnQnl0ZXMnXG4gICAgKTtcbiAgfVxufTtcblxudmFyIEdlb1BvaW50Q29kZXIgPSB7XG4gIGRhdGFiYXNlVG9KU09OKG9iamVjdCkge1xuICAgIHJldHVybiB7XG4gICAgICBfX3R5cGU6ICdHZW9Qb2ludCcsXG4gICAgICBsYXRpdHVkZTogb2JqZWN0WzFdLFxuICAgICAgbG9uZ2l0dWRlOiBvYmplY3RbMF1cbiAgICB9XG4gIH0sXG5cbiAgaXNWYWxpZERhdGFiYXNlT2JqZWN0KG9iamVjdCkge1xuICAgIHJldHVybiAob2JqZWN0IGluc3RhbmNlb2YgQXJyYXkgJiZcbiAgICAgIG9iamVjdC5sZW5ndGggPT0gMlxuICAgICk7XG4gIH0sXG5cbiAgSlNPTlRvRGF0YWJhc2UoanNvbikge1xuICAgIHJldHVybiBbIGpzb24ubG9uZ2l0dWRlLCBqc29uLmxhdGl0dWRlIF07XG4gIH0sXG5cbiAgaXNWYWxpZEpTT04odmFsdWUpIHtcbiAgICByZXR1cm4gKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgICB2YWx1ZS5fX3R5cGUgPT09ICdHZW9Qb2ludCdcbiAgICApO1xuICB9XG59O1xuXG52YXIgUG9seWdvbkNvZGVyID0ge1xuICBkYXRhYmFzZVRvSlNPTihvYmplY3QpIHtcbiAgICAvLyBDb252ZXJ0IGxuZy9sYXQgLT4gbGF0L2xuZ1xuICAgIGNvbnN0IGNvb3JkcyA9IG9iamVjdC5jb29yZGluYXRlc1swXS5tYXAoKGNvb3JkKSA9PiB7XG4gICAgICByZXR1cm4gW2Nvb3JkWzFdLCBjb29yZFswXV07XG4gICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIF9fdHlwZTogJ1BvbHlnb24nLFxuICAgICAgY29vcmRpbmF0ZXM6IGNvb3Jkc1xuICAgIH1cbiAgfSxcblxuICBpc1ZhbGlkRGF0YWJhc2VPYmplY3Qob2JqZWN0KSB7XG4gICAgY29uc3QgY29vcmRzID0gb2JqZWN0LmNvb3JkaW5hdGVzWzBdO1xuICAgIGlmIChvYmplY3QudHlwZSAhPT0gJ1BvbHlnb24nIHx8ICEoY29vcmRzIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBwb2ludCA9IGNvb3Jkc1tpXTtcbiAgICAgIGlmICghR2VvUG9pbnRDb2Rlci5pc1ZhbGlkRGF0YWJhc2VPYmplY3QocG9pbnQpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwYXJzZUZsb2F0KHBvaW50WzFdKSwgcGFyc2VGbG9hdChwb2ludFswXSkpO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBKU09OVG9EYXRhYmFzZShqc29uKSB7XG4gICAgbGV0IGNvb3JkcyA9IGpzb24uY29vcmRpbmF0ZXM7XG4gICAgLy8gQWRkIGZpcnN0IHBvaW50IHRvIHRoZSBlbmQgdG8gY2xvc2UgcG9seWdvblxuICAgIGlmIChjb29yZHNbMF1bMF0gIT09IGNvb3Jkc1tjb29yZHMubGVuZ3RoIC0gMV1bMF0gfHxcbiAgICAgICAgY29vcmRzWzBdWzFdICE9PSBjb29yZHNbY29vcmRzLmxlbmd0aCAtIDFdWzFdKSB7XG4gICAgICBjb29yZHMucHVzaChjb29yZHNbMF0pO1xuICAgIH1cbiAgICBjb25zdCB1bmlxdWUgPSBjb29yZHMuZmlsdGVyKChpdGVtLCBpbmRleCwgYXIpID0+IHtcbiAgICAgIGxldCBmb3VuZEluZGV4ID0gLTE7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFyLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGNvbnN0IHB0ID0gYXJbaV07XG4gICAgICAgIGlmIChwdFswXSA9PT0gaXRlbVswXSAmJlxuICAgICAgICAgICAgcHRbMV0gPT09IGl0ZW1bMV0pIHtcbiAgICAgICAgICBmb3VuZEluZGV4ID0gaTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIGZvdW5kSW5kZXggPT09IGluZGV4O1xuICAgIH0pO1xuICAgIGlmICh1bmlxdWUubGVuZ3RoIDwgMykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsXG4gICAgICAgICdHZW9KU09OOiBMb29wIG11c3QgaGF2ZSBhdCBsZWFzdCAzIGRpZmZlcmVudCB2ZXJ0aWNlcydcbiAgICAgICk7XG4gICAgfVxuICAgIC8vIENvbnZlcnQgbGF0L2xvbmcgLT4gbG9uZy9sYXRcbiAgICBjb29yZHMgPSBjb29yZHMubWFwKChjb29yZCkgPT4ge1xuICAgICAgcmV0dXJuIFtjb29yZFsxXSwgY29vcmRbMF1dO1xuICAgIH0pO1xuICAgIHJldHVybiB7IHR5cGU6ICdQb2x5Z29uJywgY29vcmRpbmF0ZXM6IFtjb29yZHNdIH07XG4gIH0sXG5cbiAgaXNWYWxpZEpTT04odmFsdWUpIHtcbiAgICByZXR1cm4gKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgICB2YWx1ZS5fX3R5cGUgPT09ICdQb2x5Z29uJ1xuICAgICk7XG4gIH1cbn07XG5cbnZhciBGaWxlQ29kZXIgPSB7XG4gIGRhdGFiYXNlVG9KU09OKG9iamVjdCkge1xuICAgIHJldHVybiB7XG4gICAgICBfX3R5cGU6ICdGaWxlJyxcbiAgICAgIG5hbWU6IG9iamVjdFxuICAgIH1cbiAgfSxcblxuICBpc1ZhbGlkRGF0YWJhc2VPYmplY3Qob2JqZWN0KSB7XG4gICAgcmV0dXJuICh0eXBlb2Ygb2JqZWN0ID09PSAnc3RyaW5nJyk7XG4gIH0sXG5cbiAgSlNPTlRvRGF0YWJhc2UoanNvbikge1xuICAgIHJldHVybiBqc29uLm5hbWU7XG4gIH0sXG5cbiAgaXNWYWxpZEpTT04odmFsdWUpIHtcbiAgICByZXR1cm4gKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgICB2YWx1ZS5fX3R5cGUgPT09ICdGaWxlJ1xuICAgICk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICB0cmFuc2Zvcm1LZXksXG4gIHBhcnNlT2JqZWN0VG9Nb25nb09iamVjdEZvckNyZWF0ZSxcbiAgdHJhbnNmb3JtVXBkYXRlLFxuICB0cmFuc2Zvcm1XaGVyZSxcbiAgbW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0LFxuICByZWxhdGl2ZVRpbWVUb0RhdGUsXG4gIHRyYW5zZm9ybUNvbnN0cmFpbnQsXG4gIHRyYW5zZm9ybVBvaW50ZXJTdHJpbmcsXG59O1xuIl19