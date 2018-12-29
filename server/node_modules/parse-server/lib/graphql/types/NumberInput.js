'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NumberInput = undefined;

var _graphql = require('graphql');

const NumberInput = exports.NumberInput = new _graphql.GraphQLScalarType({
  name: 'NumberInput',
  description: `Input for number
  Supported schemas:

  - key: 1
  - key: {increment: 1}
  `,
  serialize: () => {
    throw "NumberInput serialize not implemented";
  },
  parseValue: () => {
    throw "NumberInput parseValue not implemented";
  },
  parseLiteral: ast => {
    if (ast.kind == _graphql.Kind.OBJECT) {
      const fields = ast.fields;
      if (fields.length != 1) {
        throw 'Invalid NUmberInput';
      }
      const field = fields[0];
      const operator = field.name.value;
      if (operator != "increment") {
        throw `the ${operator} operator is not supported`;
      }
      const value = field.value.value;
      return { "__op": "Increment", "amount": parseFloat(value) };
    } else if (ast.kind == _graphql.Kind.INT || ast.kind == _graphql.Kind.FLOAT) {
      return parseFloat(ast.value);
    } else {
      throw 'Invalid literal for NumberInput';
    }
  }
});