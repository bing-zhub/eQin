'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AggregateRouter = undefined;

var _ClassesRouter = require('./ClassesRouter');

var _ClassesRouter2 = _interopRequireDefault(_ClassesRouter);

var _rest = require('../rest');

var _rest2 = _interopRequireDefault(_rest);

var _middlewares = require('../middlewares');

var middleware = _interopRequireWildcard(_middlewares);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _UsersRouter = require('./UsersRouter');

var _UsersRouter2 = _interopRequireDefault(_UsersRouter);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const BASE_KEYS = ['where', 'distinct'];

const PIPELINE_KEYS = ['addFields', 'bucket', 'bucketAuto', 'collStats', 'count', 'currentOp', 'facet', 'geoNear', 'graphLookup', 'group', 'indexStats', 'limit', 'listLocalSessions', 'listSessions', 'lookup', 'match', 'out', 'project', 'redact', 'replaceRoot', 'sample', 'skip', 'sort', 'sortByCount', 'unwind'];

const ALLOWED_KEYS = [...BASE_KEYS, ...PIPELINE_KEYS];

class AggregateRouter extends _ClassesRouter2.default {

  handleFind(req) {
    const body = Object.assign(req.body, _ClassesRouter2.default.JSONFromQuery(req.query));
    const options = {};
    let pipeline = [];

    if (Array.isArray(body)) {
      pipeline = body.map(stage => {
        const stageName = Object.keys(stage)[0];
        return this.transformStage(stageName, stage);
      });
    } else {
      const stages = [];
      for (const stageName in body) {
        stages.push(this.transformStage(stageName, body));
      }
      pipeline = stages;
    }
    if (body.distinct) {
      options.distinct = String(body.distinct);
    }
    options.pipeline = pipeline;
    if (typeof body.where === 'string') {
      body.where = JSON.parse(body.where);
    }
    return _rest2.default.find(req.config, req.auth, this.className(req), body.where, options, req.info.clientSDK).then(response => {
      for (const result of response.results) {
        if (typeof result === 'object') {
          _UsersRouter2.default.removeHiddenProperties(result);
        }
      }
      return { response };
    });
  }

  transformStage(stageName, stage) {
    if (ALLOWED_KEYS.indexOf(stageName) === -1) {
      throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Invalid parameter for query: ${stageName}`);
    }
    if (stageName === 'group') {
      if (stage[stageName].hasOwnProperty('_id')) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Invalid parameter for query: group. Please use objectId instead of _id`);
      }
      if (!stage[stageName].hasOwnProperty('objectId')) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Invalid parameter for query: group. objectId is required`);
      }
      stage[stageName]._id = stage[stageName].objectId;
      delete stage[stageName].objectId;
    }
    return { [`$${stageName}`]: stage[stageName] };
  }

  mountRoutes() {
    this.route('GET', '/aggregate/:className', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.handleFind(req);
    });
  }
}

exports.AggregateRouter = AggregateRouter;
exports.default = AggregateRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0FnZ3JlZ2F0ZVJvdXRlci5qcyJdLCJuYW1lcyI6WyJtaWRkbGV3YXJlIiwiQkFTRV9LRVlTIiwiUElQRUxJTkVfS0VZUyIsIkFMTE9XRURfS0VZUyIsIkFnZ3JlZ2F0ZVJvdXRlciIsIkNsYXNzZXNSb3V0ZXIiLCJoYW5kbGVGaW5kIiwicmVxIiwiYm9keSIsIk9iamVjdCIsImFzc2lnbiIsIkpTT05Gcm9tUXVlcnkiLCJxdWVyeSIsIm9wdGlvbnMiLCJwaXBlbGluZSIsIkFycmF5IiwiaXNBcnJheSIsIm1hcCIsInN0YWdlIiwic3RhZ2VOYW1lIiwia2V5cyIsInRyYW5zZm9ybVN0YWdlIiwic3RhZ2VzIiwicHVzaCIsImRpc3RpbmN0IiwiU3RyaW5nIiwid2hlcmUiLCJKU09OIiwicGFyc2UiLCJyZXN0IiwiZmluZCIsImNvbmZpZyIsImF1dGgiLCJjbGFzc05hbWUiLCJpbmZvIiwiY2xpZW50U0RLIiwidGhlbiIsInJlc3BvbnNlIiwicmVzdWx0IiwicmVzdWx0cyIsIlVzZXJzUm91dGVyIiwicmVtb3ZlSGlkZGVuUHJvcGVydGllcyIsImluZGV4T2YiLCJQYXJzZSIsIkVycm9yIiwiSU5WQUxJRF9RVUVSWSIsImhhc093blByb3BlcnR5IiwiX2lkIiwib2JqZWN0SWQiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwicHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7OztBQUNBOzs7O0FBQ0E7O0lBQVlBLFU7O0FBQ1o7Ozs7QUFDQTs7Ozs7Ozs7QUFFQSxNQUFNQyxZQUFZLENBQUMsT0FBRCxFQUFVLFVBQVYsQ0FBbEI7O0FBRUEsTUFBTUMsZ0JBQWdCLENBQ3BCLFdBRG9CLEVBRXBCLFFBRm9CLEVBR3BCLFlBSG9CLEVBSXBCLFdBSm9CLEVBS3BCLE9BTG9CLEVBTXBCLFdBTm9CLEVBT3BCLE9BUG9CLEVBUXBCLFNBUm9CLEVBU3BCLGFBVG9CLEVBVXBCLE9BVm9CLEVB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QUksQ0FBQzNCLE1BQU1DLFNBQU4sRUFBaUIyQixjQUFqQixDQUFnQyxVQUFoQyxDQUFMLEVBQWtEO0FBQ2hELGNBQU0sSUFBSUgsZUFBTUMsS0FBVixDQUNKRCxlQUFNQyxLQUFOLENBQVlDLGFBRFIsRUFFSCwwREFGRyxDQUFOO0FBSUQ7QUFDRDNCLFlBQU1DLFNBQU4sRUFBaUI0QixHQUFqQixHQUF1QjdCLE1BQU1DLFNBQU4sRUFBaUI2QixRQUF4QztBQUNBLGFBQU85QixNQUFNQyxTQUFOLEVBQWlCNkIsUUFBeEI7QUFDRDtBQUNELFdBQU8sRUFBRSxDQUFFLElBQUc3QixTQUFVLEVBQWYsR0FBbUJELE1BQU1DLFNBQU4sQ0FBckIsRUFBUDtBQUNEOztBQUVEOEIsZ0JBQWM7QUFDWixTQUFLQyxLQUFMLENBQVcsS0FBWCxFQUFpQix1QkFBakIsRUFBMENsRCxXQUFXbUQsNkJBQXJELEVBQW9GNUMsT0FBTztBQUFFLGFBQU8sS0FBS0QsVUFBTCxDQUFnQkMsR0FBaEIsQ0FBUDtBQUE4QixLQUEzSDtBQUNEO0FBaEVnRDs7UUFBdENILGUsR0FBQUEsZTtrQkFtRUVBLGUiLCJmaWxlIjoiQWdncmVnYXRlUm91dGVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IENsYXNzZXNSb3V0ZXIgZnJvbSAnLi9DbGFzc2VzUm91dGVyJztcbmltcG9ydCByZXN0IGZyb20gJy4uL3Jlc3QnO1xuaW1wb3J0ICogYXMgbWlkZGxld2FyZSBmcm9tICcuLi9taWRkbGV3YXJlcyc7XG5pbXBvcnQgUGFyc2UgICAgICAgICBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCBVc2Vyc1JvdXRlciAgIGZyb20gJy4vVXNlcnNSb3V0ZXInO1xuXG5jb25zdCBCQVNFX0tFWVMgPSBbJ3doZXJlJywgJ2Rpc3RpbmN0J107XG5cbmNvbnN0IFBJUEVMSU5FX0tFWVMgPSBbXG4gICdhZGRGaWVsZHMnLFxuICAnYnVja2V0JyxcbiAgJ2J1Y2tldEF1dG8nLFxuICAnY29sbFN0YXRzJyxcbiAgJ2NvdW50JyxcbiAgJ2N1cnJlbnRPcCcsXG4gICdmYWNldCcsXG4gICdnZW9OZWFyJyxcbiAgJ2dyYXBoTG9va3VwJyxcbiAgJ2dyb3VwJyxcbiAgJ2luZGV4U3RhdHMnLFxuICAnbGltaXQnLFxuICAnbGlzdExvY2FsU2Vzc2lvbnMnLFxuICAnbGlzdFNlc3Npb25zJyxcbiAgJ2xvb2t1cCcsXG4gICdtYXRjaCcsXG4gICdvdXQnLFxuICAncHJvamVjdCcsXG4gICdyZWRhY3QnLFxuICAncmVwbGFjZVJvb3QnLFxuICAnc2FtcGxlJyxcbiAgJ3NraXAnLFxuICAnc29ydCcsXG4gICdzb3J0QnlDb3VudCcsXG4gICd1bndpbmQnLFxuXTtcblxuY29uc3QgQUxMT1dFRF9LRVlTID0gWy4uLkJBU0VfS0VZUywgLi4uUElQRUxJTkVfS0VZU107XG5cbmV4cG9ydCBjbGFzcyBBZ2dyZWdhdGVSb3V0ZXIgZXh0ZW5kcyBDbGFzc2VzUm91dGVyIHtcblxuICBoYW5kbGVGaW5kKHJlcSkge1xuICAgIGNvbnN0IGJvZHkgPSBPYmplY3QuYXNzaWduKHJlcS5ib2R5LCBDbGFzc2VzUm91dGVyLkpTT05Gcm9tUXVlcnkocmVxLnF1ZXJ5KSk7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xuICAgIGxldCBwaXBlbGluZSA9IFtdO1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYm9keSkpIHtcbiAgICAgIHBpcGVsaW5lID0gYm9keS5tYXAoKHN0YWdlKSA9PiB7XG4gICAgICAgIGNvbnN0IHN0YWdlTmFtZSA9IE9iamVjdC5rZXlzKHN0YWdlKVswXTtcbiAgICAgICAgcmV0dXJuIHRoaXMudHJhbnNmb3JtU3RhZ2Uoc3RhZ2VOYW1lLCBzdGFnZSk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qgc3RhZ2VzID0gW107XG4gICAgICBmb3IgKGNvbnN0IHN0YWdlTmFtZSBpbiBib2R5KSB7XG4gICAgICAgIHN0YWdlcy5wdXNoKHRoaXMudHJhbnNmb3JtU3RhZ2Uoc3RhZ2VOYW1lLCBib2R5KSk7XG4gICAgICB9XG4gICAgICBwaXBlbGluZSA9IHN0YWdlcztcbiAgICB9XG4gICAgaWYgKGJvZHkuZGlzdGluY3QpIHtcbiAgICAgIG9wdGlvbnMuZGlzdGluY3QgPSBTdHJpbmcoYm9keS5kaXN0aW5jdCk7XG4gICAgfVxuICAgIG9wdGlvbnMucGlwZWxpbmUgPSBwaXBlbGluZTtcbiAgICBpZiAodHlwZW9mIGJvZHkud2hlcmUgPT09ICdzdHJpbmcnKSB7XG4gICAgICBib2R5LndoZXJlID0gSlNPTi5wYXJzZShib2R5LndoZXJlKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3QuZmluZChyZXEuY29uZmlnLCByZXEuYXV0aCwgdGhpcy5jbGFzc05hbWUocmVxKSwgYm9keS53aGVyZSwgb3B0aW9ucywgcmVxLmluZm8uY2xpZW50U0RLKS50aGVuKChyZXNwb25zZSkgPT4ge1xuICAgICAgZm9yKGNvbnN0IHJlc3VsdCBvZiByZXNwb25zZS5yZXN1bHRzKSB7XG4gICAgICAgIGlmKHR5cGVvZiByZXN1bHQgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgVXNlcnNSb3V0ZXIucmVtb3ZlSGlkZGVuUHJvcGVydGllcyhyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4geyByZXNwb25zZSB9O1xuICAgIH0pO1xuICB9XG5cbiAgdHJhbnNmb3JtU3RhZ2Uoc3RhZ2VOYW1lLCBzdGFnZSkge1xuICAgIGlmIChBTExPV0VEX0tFWVMuaW5kZXhPZihzdGFnZU5hbWUpID09PSAtMSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgICBgSW52YWxpZCBwYXJhbWV0ZXIgZm9yIHF1ZXJ5OiAke3N0YWdlTmFtZX1gXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoc3RhZ2VOYW1lID09PSAnZ3JvdXAnKSB7XG4gICAgICBpZiAoc3RhZ2Vbc3RhZ2VOYW1lXS5oYXNPd25Qcm9wZXJ0eSgnX2lkJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksXG4gICAgICAgICAgYEludmFsaWQgcGFyYW1ldGVyIGZvciBxdWVyeTogZ3JvdXAuIFBsZWFzZSB1c2Ugb2JqZWN0SWQgaW5zdGVhZCBvZiBfaWRgXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoIXN0YWdlW3N0YWdlTmFtZV0uaGFzT3duUHJvcGVydHkoJ29iamVjdElkJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksXG4gICAgICAgICAgYEludmFsaWQgcGFyYW1ldGVyIGZvciBxdWVyeTogZ3JvdXAuIG9iamVjdElkIGlzIHJlcXVpcmVkYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgc3RhZ2Vbc3RhZ2VOYW1lXS5faWQgPSBzdGFnZVtzdGFnZU5hbWVdLm9iamVjdElkO1xuICAgICAgZGVsZXRlIHN0YWdlW3N0YWdlTmFtZV0ub2JqZWN0SWQ7XG4gICAgfVxuICAgIHJldHVybiB7IFtgJCR7c3RhZ2VOYW1lfWBdOiBzdGFnZVtzdGFnZU5hbWVdIH07XG4gIH1cblxuICBtb3VudFJvdXRlcygpIHtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCcvYWdncmVnYXRlLzpjbGFzc05hbWUnLCBtaWRkbGV3YXJlLnByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVGaW5kKHJlcSk7IH0pO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IEFnZ3JlZ2F0ZVJvdXRlcjtcbiJdfQ==