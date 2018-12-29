'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GraphQLGeoPointInput = exports.GraphQLGeoPoint = undefined;

var _graphql = require('graphql');

const GraphQLGeoPoint = exports.GraphQLGeoPoint = new _graphql.GraphQLScalarType({
  name: 'GeoPoint',
  fields: {
    latitude: {
      type: _graphql.GraphQLFloat,
      name: 'latitude',
      description: 'laititude of the point, in degrees'
    },
    longitude: {
      type: _graphql.GraphQLFloat,
      name: 'latitude',
      description: 'latitude of the point, in degrees'
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

const GraphQLGeoPointInput = exports.GraphQLGeoPointInput = GraphQLGeoPoint;