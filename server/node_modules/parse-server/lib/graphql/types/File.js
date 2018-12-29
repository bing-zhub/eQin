'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GraphQLFile = undefined;

var _graphql = require('graphql');

const GraphQLFile = exports.GraphQLFile = new _graphql.GraphQLObjectType({
  name: 'File',
  fields: {
    name: {
      type: _graphql.GraphQLString,
      name: 'name',
      description: 'name of the file'
    },
    url: {
      type: _graphql.GraphQLString,
      name: 'url',
      description: 'url of the file'
    }
  }
});