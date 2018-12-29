'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GraphQLPointerInput = exports.GraphQLPointer = undefined;

var _graphql = require('graphql');

const GraphQLPointer = exports.GraphQLPointer = new _graphql.GraphQLScalarType({
  name: 'Pointer',
  fields: {
    objectId: {
      type: _graphql.GraphQLID,
      name: 'objectId',
      description: 'pointer\'s objectId'
    },
    className: {
      type: _graphql.GraphQLString,
      name: 'className',
      description: 'pointer\'s className'
    }
  },
  serialize: () => {
    throw "serialize not implemented";
  },
  parseValue: () => {
    throw "parseValue not implemented";
  },
  parseLiteral: litteral => {
    return { objectId: litteral.value };
  }
});

const GraphQLPointerInput = exports.GraphQLPointerInput = GraphQLPointer;