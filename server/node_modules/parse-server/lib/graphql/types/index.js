'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GraphQLJSONObject = exports.GraphQLPointer = exports.GraphQLDate = exports.GraphQLFile = exports.GraphQLGeoPointInput = exports.GraphQLGeoPoint = exports.GraphQLACLInput = exports.GraphQLACL = undefined;
exports.type = type;
exports.inputType = inputType;
exports.queryType = queryType;

var _graphql = require('graphql');

var _ACL = require('./ACL');

var _GeoPoint = require('./GeoPoint');

var _File = require('./File');

var _Date = require('./Date');

var _Pointer = require('./Pointer');

var _JSONObject = require('./JSONObject');

var _StringQuery = require('./StringQuery');

var _NumberQuery = require('./NumberQuery');

var _NumberInput = require('./NumberInput');

exports.GraphQLACL = _ACL.GraphQLACL;
exports.GraphQLACLInput = _ACL.GraphQLACLInput;
exports.GraphQLGeoPoint = _GeoPoint.GraphQLGeoPoint;
exports.GraphQLGeoPointInput = _GeoPoint.GraphQLGeoPointInput;
exports.GraphQLFile = _File.GraphQLFile;
exports.GraphQLDate = _Date.GraphQLDate;
exports.GraphQLPointer = _Pointer.GraphQLPointer;
exports.GraphQLJSONObject = _JSONObject.GraphQLJSONObject;
function type(fieldName, field) {
  if (fieldName === 'objectId') {
    return new _graphql.GraphQLNonNull(_graphql.GraphQLID);
  }
  const type = field.type;
  if (type == 'String') {
    return _graphql.GraphQLString;
  }if (type == 'Number') {
    return _graphql.GraphQLFloat;
  }if (type == 'Boolean') {
    return _graphql.GraphQLBoolean;
  }if (type == 'GeoPoint') {
    return _GeoPoint.GraphQLGeoPoint;
  }if (type == 'File') {
    return _File.GraphQLFile;
  } else if (type == 'ACL') {
    return _ACL.GraphQLACL;
  } else if (type == 'Date') {
    return _Date.GraphQLDate;
  } else if (type == 'Pointer') {
    return _Pointer.GraphQLPointer;
  }
}

function inputType(fieldName, field) {
  if (fieldName === 'objectId') {
    return new _graphql.GraphQLNonNull(_graphql.GraphQLID);
  }
  const type = field.type;
  if (type == 'String') {
    return _graphql.GraphQLString;
  }if (type == 'Number') {
    return _NumberInput.NumberInput;
  }if (type == 'Boolean') {
    return _graphql.GraphQLBoolean;
  }if (type == 'GeoPoint') {
    return _GeoPoint.GraphQLGeoPointInput;
  }if (type == 'File') {
    return _File.GraphQLFile;
  } else if (type == 'ACL') {
    return _ACL.GraphQLACLInput;
  } else if (type == 'Date') {
    return _Date.GraphQLDate;
  } else if (type == 'Pointer') {
    return _Pointer.GraphQLPointerInput;
  }
}

function queryType(fieldName, field) {
  if (fieldName === 'objectId') {
    return new _graphql.GraphQLNonNull(_graphql.GraphQLID);
  }
  const type = field.type;
  if (type == 'String') {
    return _StringQuery.StringQuery;
  }if (type == 'Number') {
    return _NumberQuery.NumberQuery;
  }if (type == 'Boolean') {
    return _graphql.GraphQLBoolean;
  }if (type == 'GeoPoint') {
    return _GeoPoint.GraphQLGeoPointInput;
  }if (type == 'File') {
    return _File.GraphQLFile;
  } else if (type == 'ACL') {
    // cannot query on ACL!
    return;
  } else if (type == 'Date') {
    return _Date.GraphQLDate;
  } else if (type == 'Pointer') {
    return _Pointer.GraphQLPointerInput;
  }
}