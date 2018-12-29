"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PushRouter = undefined;

var _PromiseRouter = require("../PromiseRouter");

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _middlewares = require("../middlewares");

var middleware = _interopRequireWildcard(_middlewares);

var _node = require("parse/node");

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class PushRouter extends _PromiseRouter2.default {

  mountRoutes() {
    this.route("POST", "/push", middleware.promiseEnforceMasterKeyAccess, PushRouter.handlePOST);
  }

  static handlePOST(req) {
    if (req.auth.isReadOnly) {
      throw new _node.Parse.Error(_node.Parse.Error.OPERATION_FORBIDDEN, 'read-only masterKey isn\'t allowed to send push notifications.');
    }
    const pushController = req.config.pushController;
    if (!pushController) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Push controller is not set');
    }

    const where = PushRouter.getQueryCondition(req);
    let resolve;
    const promise = new Promise(_resolve => {
      resolve = _resolve;
    });
    let pushStatusId;
    pushController.sendPush(req.body, where, req.config, req.auth, objectId => {
      pushStatusId = objectId;
      resolve({
        headers: {
          'X-Parse-Push-Status-Id': pushStatusId
        },
        response: {
          result: true
        }
      });
    }).catch(err => {
      req.config.loggerController.error(`_PushStatus ${pushStatusId}: error while sending push`, err);
    });
    return promise;
  }

  /**
   * Get query condition from the request body.
   * @param {Object} req A request object
   * @returns {Object} The query condition, the where field in a query api call
   */
  static getQueryCondition(req) {
    const body = req.body || {};
    const hasWhere = typeof body.where !== 'undefined';
    const hasChannels = typeof body.channels !== 'undefined';

    let where;
    if (hasWhere && hasChannels) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Channels and query can not be set at the same time.');
    } else if (hasWhere) {
      where = body.where;
    } else if (hasChannels) {
      where = {
        "channels": {
          "$in": body.channels
        }
      };
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Sending a push requires either "channels" or a "where" query.');
    }
    return where;
  }
}

exports.PushRouter = PushRouter;
exports.default = PushRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1B1c2hSb3V0ZXIuanMiXSwibmFtZXMiOlsibWlkZGxld2FyZSIsIlB1c2hSb3V0ZXIiLCJQcm9taXNlUm91dGVyIiwibW91bnRSb3V0ZXMiLCJyb3V0ZSIsInByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzIiwiaGFuZGxlUE9TVCIsInJlcSIsImF1dGgiLCJpc1JlYWRPbmx5IiwiUGFyc2UiLCJFcnJvciIsIk9QRVJBVElPTl9GT1JCSURERU4iLCJwdXNoQ29udHJvbGxlciIsImNvbmZpZyIsIlBVU0hfTUlTQ09ORklHVVJFRCIsIndoZXJlIiwiZ2V0UXVlcnlDb25kaXRpb24iLCJyZXNvbHZlIiwicHJvbWlzZSIsIlByb21pc2UiLCJfcmVzb2x2ZSIsInB1c2hTdGF0dXNJZCIsInNlbmRQdXNoIiwiYm9keSIsIm9iamVjdElkIiwiaGVhZGVycyIsInJlc3BvbnNlIiwicmVzdWx0IiwiY2F0Y2giLCJlcnIiLCJsb2dnZXJDb250cm9sbGVyIiwiZXJyb3IiLCJoYXNXaGVyZSIsImhhc0NoYW5uZWxzIiwiY2hhbm5lbHMiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7OztBQUNBOztJQUFZQSxVOztBQUNaOzs7Ozs7QUFFTyxNQUFNQyxVQUFOLFNBQXlCQyx1QkFBekIsQ0FBdUM7O0FBRTVDQyxnQkFBYztBQUNaLFNBQUtDLEtBQUwsQ0FBVyxNQUFYLEVBQW1CLE9BQW5CLEVBQTRCSixXQUFXSyw2QkFBdkMsRUFBc0VKLFdBQVdLLFVBQWpGO0FBQ0Q7O0FBRUQsU0FBT0EsVUFBUCxDQUFrQkMsR0FBbEIsRUFBdUI7QUFDckIsUUFBSUEsSUFBSUMsSUFBSixDQUFTQyxVQUFiLEVBQXlCO0FBQ3ZCLFlBQU0sSUFBSUMsWUFBTUMsS0FBVixDQUFnQkQsWUFBTUMsS0FBTixDQUFZQyxtQkFBNUIsRUFBaUQsZ0VBQWpELENBQU47QUFDRDtBQUNELFVBQU1DLGlCQUFpQk4sSUFBSU8sTUFBSixDQUFXRCxjQUFsQztBQUNBLFFBQUksQ0FBQ0EsY0FBTCxFQUFxQjtBQUNuQixZQUFNLElBQUlILFlBQU1DLEtBQVYsQ0FBZ0JELFlBQU1DLEtBQU4sQ0FBWUksa0JBQTVCLEVBQWdELDRCQUFoRCxDQUFOO0FBQ0Q7O0FBRUQsVUFBTUMsUUFBUWYsV0FBV2dCLGlCQUFYLENBQTZCVixHQUE3QixDQUFkO0FBQ0EsUUFBSVcsT0FBSjtBQUNBLFVBQU1DLFVBQVUsSUFBSUMsT0FBSixDQUFhQyxRQUFELElBQWM7QUFDeENILGdCQUFVRyxRQUFWO0FBQ0QsS0FGZSxDQUFoQjtBQUdBLFFBQUlDLFlBQUo7QUFDQVQsbUJBQWVVLFFBQWYsQ0FBd0JoQixJQUFJaUIsSUFBNUIsRUFBa0NSLEtBQWxDLEVBQXlDVCxJQUFJTyxNQUE3QyxFQUFxRFAsSUFBSUMsSUFBekQsRUFBZ0VpQixRQUFELElBQWM7QUFDM0VILHFCQUFlRyxRQUFmO0FBQ0FQLGNBQVE7QUFDTlEsaUJBQVM7QUFDUCxvQ0FBMEJKO0FBRG5CLFNBREg7QUFJTkssa0JBQVU7QUFDUkMsa0JBQVE7QUFEQTtBQUpKLE9BQVI7QUFRRCxLQVZELEVBVUdDLEtBVkgsQ0FVVUMsR0FBRCxJQUFTO0FBQ2hCdkIsVUFBSU8sTUFBSixDQUFXaUIsZ0JBQVgsQ0FBNEJDLEtBQTVCLENBQW1DLGVBQWNWLFlBQWEsNEJBQTlELEVBQTJGUSxHQUEzRjtBQUNELEtBWkQ7QUFhQSxXQUFPWCxPQUFQO0FBQ0Q7O0FBRUQ7Ozs7O0FBS0EsU0FBT0YsaUJBQVAsQ0FBeUJWLEdBQXpCLEVBQThCO0FBQzVCLFVBQU1pQixPQUFPakIsSUFBSWlCLElBQUosSUFBWSxFQUF6QjtBQUNBLFVBQU1TLFdBQVcsT0FBT1QsS0FBS1IsS0FBWixLQUFzQixXQUF2QztBQUNBLFVBQU1rQixjQUFjLE9BQU9WLEtBQUtXLFFBQVosS0FBeUIsV0FBN0M7O0FBRUEsUUFBSW5CLEtBQUo7QUFDQSxRQUFJaUIsWUFBWUMsV0FBaEIsRUFBNkI7QUFDM0IsWUFBTSxJQUFJeEIsWUFBTUMsS0FBVixDQUFnQkQsWUFBTUMsS0FBTixDQUFZSSxrQkFBNUIsRUFDSixxREFESSxDQUFOO0FBRUQsS0FIRCxNQUdPLElBQUlrQixRQUFKLEVBQWM7QUFDbkJqQixjQUFRUSxLQUFLUixLQUFiO0FBQ0QsS0FGTSxNQUVBLElBQUlrQixXQUFKLEVBQWlCO0FBQ3RCbEIsY0FBUTtBQUNOLG9CQUFZO0FBQ1YsaUJBQU9RLEtBQUtXO0FBREY7QUFETixPQUFSO0FBS0QsS0FOTSxNQU1BO0FBQ0wsWUFBTSxJQUFJekIsWUFBTUMsS0FBVixDQUFnQkQsWUFBTUMsS0FBTixDQUFZSSxrQkFBNUIsRUFBZ0QsK0RBQWhELENBQU47QUFDRDtBQUNELFdBQU9DLEtBQVA7QUFDRDtBQS9EMkM7O1FBQWpDZixVLEdBQUFBLFU7a0JBa0VFQSxVIiwiZmlsZSI6IlB1c2hSb3V0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgUHJvbWlzZVJvdXRlciAgIGZyb20gJy4uL1Byb21pc2VSb3V0ZXInO1xuaW1wb3J0ICogYXMgbWlkZGxld2FyZSBmcm9tIFwiLi4vbWlkZGxld2FyZXNcIjtcbmltcG9ydCB7IFBhcnNlIH0gICAgICAgZnJvbSBcInBhcnNlL25vZGVcIjtcblxuZXhwb3J0IGNsYXNzIFB1c2hSb3V0ZXIgZXh0ZW5kcyBQcm9taXNlUm91dGVyIHtcblxuICBtb3VudFJvdXRlcygpIHtcbiAgICB0aGlzLnJvdXRlKFwiUE9TVFwiLCBcIi9wdXNoXCIsIG1pZGRsZXdhcmUucHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MsIFB1c2hSb3V0ZXIuaGFuZGxlUE9TVCk7XG4gIH1cblxuICBzdGF0aWMgaGFuZGxlUE9TVChyZXEpIHtcbiAgICBpZiAocmVxLmF1dGguaXNSZWFkT25seSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sICdyZWFkLW9ubHkgbWFzdGVyS2V5IGlzblxcJ3QgYWxsb3dlZCB0byBzZW5kIHB1c2ggbm90aWZpY2F0aW9ucy4nKTtcbiAgICB9XG4gICAgY29uc3QgcHVzaENvbnRyb2xsZXIgPSByZXEuY29uZmlnLnB1c2hDb250cm9sbGVyO1xuICAgIGlmICghcHVzaENvbnRyb2xsZXIpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsICdQdXNoIGNvbnRyb2xsZXIgaXMgbm90IHNldCcpO1xuICAgIH1cblxuICAgIGNvbnN0IHdoZXJlID0gUHVzaFJvdXRlci5nZXRRdWVyeUNvbmRpdGlvbihyZXEpO1xuICAgIGxldCByZXNvbHZlO1xuICAgIGNvbnN0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgoX3Jlc29sdmUpID0+IHtcbiAgICAgIHJlc29sdmUgPSBfcmVzb2x2ZTtcbiAgICB9KTtcbiAgICBsZXQgcHVzaFN0YXR1c0lkO1xuICAgIHB1c2hDb250cm9sbGVyLnNlbmRQdXNoKHJlcS5ib2R5LCB3aGVyZSwgcmVxLmNvbmZpZywgcmVxLmF1dGgsIChvYmplY3RJZCkgPT4ge1xuICAgICAgcHVzaFN0YXR1c0lkID0gb2JqZWN0SWQ7XG4gICAgICByZXNvbHZlKHtcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICdYLVBhcnNlLVB1c2gtU3RhdHVzLUlkJzogcHVzaFN0YXR1c0lkXG4gICAgICAgIH0sXG4gICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgcmVzdWx0OiB0cnVlXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pLmNhdGNoKChlcnIpID0+IHtcbiAgICAgIHJlcS5jb25maWcubG9nZ2VyQ29udHJvbGxlci5lcnJvcihgX1B1c2hTdGF0dXMgJHtwdXNoU3RhdHVzSWR9OiBlcnJvciB3aGlsZSBzZW5kaW5nIHB1c2hgLCBlcnIpO1xuICAgIH0pO1xuICAgIHJldHVybiBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBxdWVyeSBjb25kaXRpb24gZnJvbSB0aGUgcmVxdWVzdCBib2R5LlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxIEEgcmVxdWVzdCBvYmplY3RcbiAgICogQHJldHVybnMge09iamVjdH0gVGhlIHF1ZXJ5IGNvbmRpdGlvbiwgdGhlIHdoZXJlIGZpZWxkIGluIGEgcXVlcnkgYXBpIGNhbGxcbiAgICovXG4gIHN0YXRpYyBnZXRRdWVyeUNvbmRpdGlvbihyZXEpIHtcbiAgICBjb25zdCBib2R5ID0gcmVxLmJvZHkgfHwge307XG4gICAgY29uc3QgaGFzV2hlcmUgPSB0eXBlb2YgYm9keS53aGVyZSAhPT0gJ3VuZGVmaW5lZCc7XG4gICAgY29uc3QgaGFzQ2hhbm5lbHMgPSB0eXBlb2YgYm9keS5jaGFubmVscyAhPT0gJ3VuZGVmaW5lZCc7XG5cbiAgICBsZXQgd2hlcmU7XG4gICAgaWYgKGhhc1doZXJlICYmIGhhc0NoYW5uZWxzKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICAnQ2hhbm5lbHMgYW5kIHF1ZXJ5IGNhbiBub3QgYmUgc2V0IGF0IHRoZSBzYW1lIHRpbWUuJyk7XG4gICAgfSBlbHNlIGlmIChoYXNXaGVyZSkge1xuICAgICAgd2hlcmUgPSBib2R5LndoZXJlO1xuICAgIH0gZWxzZSBpZiAoaGFzQ2hhbm5lbHMpIHtcbiAgICAgIHdoZXJlID0ge1xuICAgICAgICBcImNoYW5uZWxzXCI6IHtcbiAgICAgICAgICBcIiRpblwiOiBib2R5LmNoYW5uZWxzXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCwgJ1NlbmRpbmcgYSBwdXNoIHJlcXVpcmVzIGVpdGhlciBcImNoYW5uZWxzXCIgb3IgYSBcIndoZXJlXCIgcXVlcnkuJyk7XG4gICAgfVxuICAgIHJldHVybiB3aGVyZTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBQdXNoUm91dGVyO1xuIl19