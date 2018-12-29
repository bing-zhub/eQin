'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GraphQLJSONObject = undefined;

var _graphql = require('graphql');

// http://graphql.org/graphql-js/type/#graphqlscalartype
const GraphQLJSONObject = exports.GraphQLJSONObject = new _graphql.GraphQLScalarType({
  name: 'JSONObject',
  serialize: () => {
    throw "JSONObject serialize not implemented";
  },
  parseValue: () => {
    throw "JSONObject parseValue not implemented";
  },
  parseLiteral: litteral => {
    return litteral.fields.reduce((memo, field) => {
      const value = field.value;
      if (value.kind == 'IntValue') {
        memo[field.name.value] = parseInt(value.value, 10);
      } else {
        memo[field.name.value] = value.value;
      }
      return memo;
    }, {});
  }
});