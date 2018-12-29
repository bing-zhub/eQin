'use strict';

// Helper functions for accessing the linkedin API.
var https = require('https');
var Parse = require('parse/node').Parse;

// Returns a promise that fulfills iff this user id is valid.
function validateAuthData(authData) {
  return request('people/~:(id)', authData.access_token, authData.is_mobile_sdk).then(data => {
    if (data && data.id == authData.id) {
      return;
    }
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Linkedin auth is invalid for this user.');
  });
}

// Returns a promise that fulfills iff this app id is valid.
function validateAppId() {
  return Promise.resolve();
}

// A promisey wrapper for api requests
function request(path, access_token, is_mobile_sdk) {
  var headers = {
    'Authorization': 'Bearer ' + access_token,
    'x-li-format': 'json'
  };

  if (is_mobile_sdk) {
    headers['x-li-src'] = 'msdk';
  }

  return new Promise(function (resolve, reject) {
    https.get({
      host: 'api.linkedin.com',
      path: '/v1/' + path,
      headers: headers
    }, function (res) {
      var data = '';
      res.on('data', function (chunk) {
        data += chunk;
      });
      res.on('end', function () {
        try {
          data = JSON.parse(data);
        } catch (e) {
          return reject(e);
        }
        resolve(data);
      });
    }).on('error', function () {
      reject('Failed to validate this access token with Linkedin.');
    });
  });
}

module.exports = {
  validateAppId: validateAppId,
  validateAuthData: validateAuthData
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9BdXRoL2xpbmtlZGluLmpzIl0sIm5hbWVzIjpbImh0dHBzIiwicmVxdWlyZSIsIlBhcnNlIiwidmFsaWRhdGVBdXRoRGF0YSIsImF1dGhEYXRhIiwicmVxdWVzdCIsImFjY2Vzc190b2tlbiIsImlzX21vYmlsZV9zZGsiLCJ0aGVuIiwiZGF0YSIsImlkIiwiRXJyb3IiLCJPQkpFQ1RfTk9UX0ZPVU5EIiwidmFsaWRhdGVBcHBJZCIsIlByb21pc2UiLCJyZXNvbHZlIiwicGF0aCIsImhlYWRlcnMiLCJyZWplY3QiLCJnZXQiLCJob3N0IiwicmVzIiwib24iLCJjaHVuayIsIkpTT04iLCJwYXJzZSIsImUiLCJtb2R1bGUiLCJleHBvcnRzIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0EsSUFBSUEsUUFBUUMsUUFBUSxPQUFSLENBQVo7QUFDQSxJQUFJQyxRQUFRRCxRQUFRLFlBQVIsRUFBc0JDLEtBQWxDOztBQUVBO0FBQ0EsU0FBU0MsZ0JBQVQsQ0FBMEJDLFFBQTFCLEVBQW9DO0FBQ2xDLFNBQU9DLFFBQVEsZUFBUixFQUF5QkQsU0FBU0UsWUFBbEMsRUFBZ0RGLFNBQVNHLGFBQXpELEVBQ0pDLElBREksQ0FDRUMsSUFBRCxJQUFVO0FBQ2QsUUFBSUEsUUFBUUEsS0FBS0MsRUFBTCxJQUFXTixTQUFTTSxFQUFoQyxFQUFvQztBQUNsQztBQUNEO0FBQ0QsVUFBTSxJQUFJUixNQUFNUyxLQUFWLENBQ0pULE1BQU1TLEtBQU4sQ0FBWUMsZ0JBRFIsRUFFSix5Q0FGSSxDQUFOO0FBR0QsR0FSSSxDQUFQO0FBU0Q7O0FBRUQ7QUFDQSxTQUFTQyxhQUFULEdBQXlCO0FBQ3ZCLFNBQU9DLFFBQVFDLE9BQVIsRUFBUDtBQUNEOztBQUVEO0FBQ0EsU0FBU1YsT0FBVCxDQUFpQlcsSUFBakIsRUFBdUJWLFlBQXZCLEVBQXFDQyxhQUFyQyxFQUFvRDtBQUNsRCxNQUFJVSxVQUFVO0FBQ1oscUJBQWlCLFlBQVlYLFlBRGpCO0FBRVosbUJBQWU7QUFGSCxHQUFkOztBQUtBLE1BQUdDLGFBQUgsRUFBa0I7QUFDaEJVLFlBQVEsVUFBUixJQUFzQixNQUF0QjtBQUNEOztBQUVELFNBQU8sSUFBSUgsT0FBSixDQUFZLFVBQVNDLE9BQVQsRUFBa0JHLE1BQWxCLEVBQTBCO0FBQzNDbEIsVUFBTW1CLEdBQU4sQ0FBVTtBQUNSQyxZQUFNLGtCQURFO0FBRVJKLFlBQU0sU0FBU0EsSUFGUDtBQUdSQyxlQUFTQTtBQUhELEtBQVYsRUFJRyxVQUFTSSxHQUFULEVBQWM7QUFDZixVQUFJWixPQUFPLEVBQVg7QUFDQVksVUFBSUMsRUFBSixDQUFPLE1BQVAsRUFBZSxVQUFTQyxLQUFULEVBQWdCO0FBQzdCZCxnQkFBUWMsS0FBUjtBQUNELE9BRkQ7QUFHQUYsVUFBSUMsRUFBSixDQUFPLEtBQVAsRUFBYyxZQUFXO0FBQ3ZCLFlBQUk7QUFDRmIsaUJBQU9lLEtBQUtDLEtBQUwsQ0FBV2hCLElBQVgsQ0FBUDtBQUNELFNBRkQsQ0FFRSxPQUFNaUIsQ0FBTixFQUFTO0FBQ1QsaUJBQU9SLE9BQU9RLENBQVAsQ0FBUDtBQUNEO0FBQ0RYLGdCQUFRTixJQUFSO0FBQ0QsT0FQRDtBQVFELEtBakJELEVBaUJHYSxFQWpCSCxDQWlCTSxPQWpCTixFQWlCZSxZQUFXO0FBQ3hCSixhQUFPLHFEQUFQO0FBQ0QsS0FuQkQ7QUFvQkQsR0FyQk0sQ0FBUDtBQXNCRDs7QUFFRFMsT0FBT0MsT0FBUCxHQUFpQjtBQUNmZixpQkFBZUEsYUFEQTtBQUVmVixvQkFBa0JBO0FBRkgsQ0FBakIiLCJmaWxlIjoibGlua2VkaW4uanMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBIZWxwZXIgZnVuY3Rpb25zIGZvciBhY2Nlc3NpbmcgdGhlIGxpbmtlZGluIEFQSS5cbnZhciBodHRwcyA9IHJlcXVpcmUoJ2h0dHBzJyk7XG52YXIgUGFyc2UgPSByZXF1aXJlKCdwYXJzZS9ub2RlJykuUGFyc2U7XG5cbi8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgZnVsZmlsbHMgaWZmIHRoaXMgdXNlciBpZCBpcyB2YWxpZC5cbmZ1bmN0aW9uIHZhbGlkYXRlQXV0aERhdGEoYXV0aERhdGEpIHtcbiAgcmV0dXJuIHJlcXVlc3QoJ3Blb3BsZS9+OihpZCknLCBhdXRoRGF0YS5hY2Nlc3NfdG9rZW4sIGF1dGhEYXRhLmlzX21vYmlsZV9zZGspXG4gICAgLnRoZW4oKGRhdGEpID0+IHtcbiAgICAgIGlmIChkYXRhICYmIGRhdGEuaWQgPT0gYXV0aERhdGEuaWQpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELFxuICAgICAgICAnTGlua2VkaW4gYXV0aCBpcyBpbnZhbGlkIGZvciB0aGlzIHVzZXIuJyk7XG4gICAgfSk7XG59XG5cbi8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgZnVsZmlsbHMgaWZmIHRoaXMgYXBwIGlkIGlzIHZhbGlkLlxuZnVuY3Rpb24gdmFsaWRhdGVBcHBJZCgpIHtcbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xufVxuXG4vLyBBIHByb21pc2V5IHdyYXBwZXIgZm9yIGFwaSByZXF1ZXN0c1xuZnVuY3Rpb24gcmVxdWVzdChwYXRoLCBhY2Nlc3NfdG9rZW4sIGlzX21vYmlsZV9zZGspIHtcbiAgdmFyIGhlYWRlcnMgPSB7XG4gICAgJ0F1dGhvcml6YXRpb24nOiAnQmVhcmVyICcgKyBhY2Nlc3NfdG9rZW4sXG4gICAgJ3gtbGktZm9ybWF0JzogJ2pzb24nLFxuICB9XG5cbiAgaWYoaXNfbW9iaWxlX3Nkaykge1xuICAgIGhlYWRlcnNbJ3gtbGktc3JjJ10gPSAnbXNkayc7XG4gIH1cblxuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgaHR0cHMuZ2V0KHtcbiAgICAgIGhvc3Q6ICdhcGkubGlua2VkaW4uY29tJyxcbiAgICAgIHBhdGg6ICcvdjEvJyArIHBhdGgsXG4gICAgICBoZWFkZXJzOiBoZWFkZXJzXG4gICAgfSwgZnVuY3Rpb24ocmVzKSB7XG4gICAgICB2YXIgZGF0YSA9ICcnO1xuICAgICAgcmVzLm9uKCdkYXRhJywgZnVuY3Rpb24oY2h1bmspIHtcbiAgICAgICAgZGF0YSArPSBjaHVuaztcbiAgICAgIH0pO1xuICAgICAgcmVzLm9uKCdlbmQnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBkYXRhID0gSlNPTi5wYXJzZShkYXRhKTtcbiAgICAgICAgfSBjYXRjaChlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChlKTtcbiAgICAgICAgfVxuICAgICAgICByZXNvbHZlKGRhdGEpO1xuICAgICAgfSk7XG4gICAgfSkub24oJ2Vycm9yJywgZnVuY3Rpb24oKSB7XG4gICAgICByZWplY3QoJ0ZhaWxlZCB0byB2YWxpZGF0ZSB0aGlzIGFjY2VzcyB0b2tlbiB3aXRoIExpbmtlZGluLicpO1xuICAgIH0pO1xuICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHZhbGlkYXRlQXBwSWQ6IHZhbGlkYXRlQXBwSWQsXG4gIHZhbGlkYXRlQXV0aERhdGE6IHZhbGlkYXRlQXV0aERhdGFcbn07XG4iXX0=