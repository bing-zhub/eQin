'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NumberQuery = undefined;

var _graphql = require('graphql');

const NumberQuery = exports.NumberQuery = new _graphql.GraphQLScalarType({
  name: 'NumberQuery',
  description: `Queries for number values
  Supported constraints:

  - key: 1
  - key: {$lt: 1} # less than
  - key: {$gt: 1} # greater than
  - key: {$lte: 1} # less than or equal
  - key: {$gte: 1} # greater than or equal
  `,
  serialize: () => {
    throw "NumberQuery serialize not implemented";
  },
  parseValue: () => {
    throw "NumberQuery parseValue not implemented";
  },
  parseLiteral: ast => {
    if (ast.kind == _graphql.Kind.OBJECT) {
      const fields = ast.fields;
      return fields.reduce((memo, field) => {
        const operator = field.name.value;
        const value = field.value.value;
        memo['$' + operator] = parseFloat(value);
        return memo;
      }, {});
    } else if (ast.kind == _graphql.Kind.INT || ast.kind == _graphql.Kind.FLOAT) {
      return parseFloat(ast.value);
    } else {
      throw 'Invalid literal for NumberQuery';
    }
  }
});