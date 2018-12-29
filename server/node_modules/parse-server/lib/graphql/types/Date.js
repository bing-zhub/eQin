'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GraphQLDate = undefined;

var _graphql = require('graphql');

// http://graphql.org/graphql-js/type/#graphqlscalartype
const GraphQLDate = exports.GraphQLDate = new _graphql.GraphQLScalarType({
  name: 'Date',
  serialize: obj => {
    if (typeof a === 'string') {
      return new Date(obj);
    }
    return obj;
  },
  parseValue: () => {
    throw "Date parseValue not implemented";
  },
  parseLiteral: () => {
    throw "Date parseLiteral not implemented";
  }
});