'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GraphQLACLInput = exports.GraphQLACL = undefined;

var _graphql = require('graphql');

const GraphQLACL = exports.GraphQLACL = new _graphql.GraphQLScalarType({
  name: 'ACL',
  fields: {
    read: {
      type: new _graphql.GraphQLList(_graphql.GraphQLString),
      name: 'read',
      description: 'Read access for the object'
    },
    write: {
      type: new _graphql.GraphQLList(_graphql.GraphQLString),
      name: 'write',
      description: 'Write access for the object'
    }
  },
  serialize: () => {
    throw "not implemented";
  },
  parseValue: () => {
    throw "not implemented";
  },
  parseLiteral: () => {
    throw "not implemented";
  }
});

const GraphQLACLInput = exports.GraphQLACLInput = GraphQLACL;