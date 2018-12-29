'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.StringQuery = undefined;

var _graphql = require('graphql');

const StringQuery = exports.StringQuery = new _graphql.GraphQLScalarType({
  name: 'StringQuery',
  description: `Query constraint on string parameters
  Supported constraints:

  - key: "value"
  - key: {$regex: "value"}
  `,
  serialize: () => {
    throw "StringQuery serialize not implemented";
  },
  parseValue: () => {
    throw "StringQuery parseValue not implemented";
  },
  parseLiteral: ast => {
    if (ast.kind == _graphql.Kind.OBJECT) {
      const fields = ast.fields;
      return fields.reduce((memo, field) => {
        const operator = field.name.value;
        const value = field.value.value;
        memo['$' + operator] = value;
        return memo;
      }, {});
    } else if (ast.kind == _graphql.Kind.STRING) {
      return ast.value;
    } else {
      throw 'Invalid literal for StringQuery';
    }
  }
});