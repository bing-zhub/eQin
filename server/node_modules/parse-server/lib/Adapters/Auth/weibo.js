'use strict';

// Helper functions for accessing the weibo Graph API.
var https = require('https');
var Parse = require('parse/node').Parse;
var querystring = require('querystring');

// Returns a promise that fulfills iff this user id is valid.
function validateAuthData(authData) {
  return graphRequest(authData.access_token).then(function (data) {
    if (data && data.uid == authData.id) {
      return;
    }
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'weibo auth is invalid for this user.');
  });
}

// Returns a promise that fulfills if this app id is valid.
function validateAppId() {
  return Promise.resolve();
}

// A promisey wrapper for weibo graph requests.
function graphRequest(access_token) {
  return new Promise(function (resolve, reject) {
    var postData = querystring.stringify({
      "access_token": access_token
    });
    var options = {
      hostname: 'api.weibo.com',
      path: '/oauth2/get_token_info',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    var req = https.request(options, function (res) {
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
      res.on('error', function () {
        reject('Failed to validate this access token with weibo.');
      });
    });
    req.on('error', function () {
      reject('Failed to validate this access token with weibo.');
    });
    req.write(postData);
    req.end();
  });
}

module.exports = {
  validateAppId,
  validateAuthData
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9BdXRoL3dlaWJvLmpzIl0sIm5hbWVzIjpbImh0dHBzIiwicmVxdWlyZSIsIlBhcnNlIiwicXVlcnlzdHJpbmciLCJ2YWxpZGF0ZUF1dGhEYXRhIiwiYXV0aERhdGEiLCJncmFwaFJlcXVlc3QiLCJhY2Nlc3NfdG9rZW4iLCJ0aGVuIiwiZGF0YSIsInVpZCIsImlkIiwiRXJyb3IiLCJPQkpFQ1RfTk9UX0ZPVU5EIiwidmFsaWRhdGVBcHBJZCIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0IiwicG9zdERhdGEiLCJzdHJpbmdpZnkiLCJvcHRpb25zIiwiaG9zdG5hbWUiLCJwYXRoIiwibWV0aG9kIiwiaGVhZGVycyIsIkJ1ZmZlciIsImJ5dGVMZW5ndGgiLCJyZXEiLCJyZXF1ZXN0IiwicmVzIiwib24iLCJjaHVuayIsIkpTT04iLCJwYXJzZSIsImUiLCJ3cml0ZSIsImVuZCIsIm1vZHVsZSIsImV4cG9ydHMiXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQSxJQUFJQSxRQUFRQyxRQUFRLE9BQVIsQ0FBWjtBQUNBLElBQUlDLFFBQVFELFFBQVEsWUFBUixFQUFzQkMsS0FBbEM7QUFDQSxJQUFJQyxjQUFjRixRQUFRLGFBQVIsQ0FBbEI7O0FBRUE7QUFDQSxTQUFTRyxnQkFBVCxDQUEwQkMsUUFBMUIsRUFBb0M7QUFDbEMsU0FBT0MsYUFBYUQsU0FBU0UsWUFBdEIsRUFBb0NDLElBQXBDLENBQXlDLFVBQVVDLElBQVYsRUFBZ0I7QUFDOUQsUUFBSUEsUUFBUUEsS0FBS0MsR0FBTCxJQUFZTCxTQUFTTSxFQUFqQyxFQUFxQztBQUNuQztBQUNEO0FBQ0QsVUFBTSxJQUFJVCxNQUFNVSxLQUFWLENBQWdCVixNQUFNVSxLQUFOLENBQVlDLGdCQUE1QixFQUE4QyxzQ0FBOUMsQ0FBTjtBQUNELEdBTE0sQ0FBUDtBQU1EOztBQUVEO0FBQ0EsU0FBU0MsYUFBVCxHQUF5QjtBQUN2QixTQUFPQyxRQUFRQyxPQUFSLEVBQVA7QUFDRDs7QUFFRDtBQUNBLFNBQVNWLFlBQVQsQ0FBc0JDLFlBQXRCLEVBQW9DO0FBQ2xDLFNBQU8sSUFBSVEsT0FBSixDQUFZLFVBQVVDLE9BQVYsRUFBbUJDLE1BQW5CLEVBQTJCO0FBQzVDLFFBQUlDLFdBQVdmLFlBQVlnQixTQUFaLENBQXNCO0FBQ25DLHNCQUFlWjtBQURvQixLQUF0QixDQUFmO0FBR0EsUUFBSWEsVUFBVTtBQUNaQyxnQkFBVSxlQURFO0FBRVpDLFlBQU0sd0JBRk07QUFHWkMsY0FBUSxNQUhJO0FBSVpDLGVBQVM7QUFDUCx3QkFBZ0IsbUNBRFQ7QUFFUCwwQkFBa0JDLE9BQU9DLFVBQVAsQ0FBa0JSLFFBQWxCO0FBRlg7QUFKRyxLQUFkO0FBU0EsUUFBSVMsTUFBTTNCLE1BQU00QixPQUFOLENBQWNSLE9BQWQsRUFBdUIsVUFBU1MsR0FBVCxFQUFhO0FBQzVDLFVBQUlwQixPQUFPLEVBQVg7QUFDQW9CLFVBQUlDLEVBQUosQ0FBTyxNQUFQLEVBQWUsVUFBVUMsS0FBVixFQUFpQjtBQUM5QnRCLGdCQUFRc0IsS0FBUjtBQUNELE9BRkQ7QUFHQUYsVUFBSUMsRUFBSixDQUFPLEtBQVAsRUFBYyxZQUFZO0FBQ3hCLFlBQUk7QUFDRnJCLGlCQUFPdUIsS0FBS0MsS0FBTCxDQUFXeEIsSUFBWCxDQUFQO0FBQ0QsU0FGRCxDQUVFLE9BQU15QixDQUFOLEVBQVM7QUFDVCxpQkFBT2pCLE9BQU9pQixDQUFQLENBQVA7QUFDRDtBQUNEbEIsZ0JBQVFQLElBQVI7QUFDRCxPQVBEO0FBUUFvQixVQUFJQyxFQUFKLENBQU8sT0FBUCxFQUFnQixZQUFZO0FBQzFCYixlQUFPLGtEQUFQO0FBQ0QsT0FGRDtBQUdELEtBaEJTLENBQVY7QUFpQkFVLFFBQUlHLEVBQUosQ0FBTyxPQUFQLEVBQWdCLFlBQVk7QUFDMUJiLGFBQU8sa0RBQVA7QUFDRCxLQUZEO0FBR0FVLFFBQUlRLEtBQUosQ0FBVWpCLFFBQVY7QUFDQVMsUUFBSVMsR0FBSjtBQUNELEdBbkNNLENBQVA7QUFvQ0Q7O0FBRURDLE9BQU9DLE9BQVAsR0FBaUI7QUFDZnhCLGVBRGU7QUFFZlY7QUFGZSxDQUFqQiIsImZpbGUiOiJ3ZWliby5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEhlbHBlciBmdW5jdGlvbnMgZm9yIGFjY2Vzc2luZyB0aGUgd2VpYm8gR3JhcGggQVBJLlxudmFyIGh0dHBzID0gcmVxdWlyZSgnaHR0cHMnKTtcbnZhciBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKS5QYXJzZTtcbnZhciBxdWVyeXN0cmluZyA9IHJlcXVpcmUoJ3F1ZXJ5c3RyaW5nJyk7XG5cbi8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgZnVsZmlsbHMgaWZmIHRoaXMgdXNlciBpZCBpcyB2YWxpZC5cbmZ1bmN0aW9uIHZhbGlkYXRlQXV0aERhdGEoYXV0aERhdGEpIHtcbiAgcmV0dXJuIGdyYXBoUmVxdWVzdChhdXRoRGF0YS5hY2Nlc3NfdG9rZW4pLnRoZW4oZnVuY3Rpb24gKGRhdGEpIHtcbiAgICBpZiAoZGF0YSAmJiBkYXRhLnVpZCA9PSBhdXRoRGF0YS5pZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ3dlaWJvIGF1dGggaXMgaW52YWxpZCBmb3IgdGhpcyB1c2VyLicpO1xuICB9KTtcbn1cblxuLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCBmdWxmaWxscyBpZiB0aGlzIGFwcCBpZCBpcyB2YWxpZC5cbmZ1bmN0aW9uIHZhbGlkYXRlQXBwSWQoKSB7XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbn1cblxuLy8gQSBwcm9taXNleSB3cmFwcGVyIGZvciB3ZWlibyBncmFwaCByZXF1ZXN0cy5cbmZ1bmN0aW9uIGdyYXBoUmVxdWVzdChhY2Nlc3NfdG9rZW4pIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICB2YXIgcG9zdERhdGEgPSBxdWVyeXN0cmluZy5zdHJpbmdpZnkoe1xuICAgICAgXCJhY2Nlc3NfdG9rZW5cIjphY2Nlc3NfdG9rZW5cbiAgICB9KTtcbiAgICB2YXIgb3B0aW9ucyA9IHtcbiAgICAgIGhvc3RuYW1lOiAnYXBpLndlaWJvLmNvbScsXG4gICAgICBwYXRoOiAnL29hdXRoMi9nZXRfdG9rZW5faW5mbycsXG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnLFxuICAgICAgICAnQ29udGVudC1MZW5ndGgnOiBCdWZmZXIuYnl0ZUxlbmd0aChwb3N0RGF0YSlcbiAgICAgIH1cbiAgICB9O1xuICAgIHZhciByZXEgPSBodHRwcy5yZXF1ZXN0KG9wdGlvbnMsIGZ1bmN0aW9uKHJlcyl7XG4gICAgICB2YXIgZGF0YSA9ICcnO1xuICAgICAgcmVzLm9uKCdkYXRhJywgZnVuY3Rpb24gKGNodW5rKSB7XG4gICAgICAgIGRhdGEgKz0gY2h1bms7XG4gICAgICB9KTtcbiAgICAgIHJlcy5vbignZW5kJywgZnVuY3Rpb24gKCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGRhdGEgPSBKU09OLnBhcnNlKGRhdGEpO1xuICAgICAgICB9IGNhdGNoKGUpIHtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGUpO1xuICAgICAgICB9XG4gICAgICAgIHJlc29sdmUoZGF0YSk7XG4gICAgICB9KTtcbiAgICAgIHJlcy5vbignZXJyb3InLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJlamVjdCgnRmFpbGVkIHRvIHZhbGlkYXRlIHRoaXMgYWNjZXNzIHRva2VuIHdpdGggd2VpYm8uJyk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICByZXEub24oJ2Vycm9yJywgZnVuY3Rpb24gKCkge1xuICAgICAgcmVqZWN0KCdGYWlsZWQgdG8gdmFsaWRhdGUgdGhpcyBhY2Nlc3MgdG9rZW4gd2l0aCB3ZWliby4nKTtcbiAgICB9KTtcbiAgICByZXEud3JpdGUocG9zdERhdGEpO1xuICAgIHJlcS5lbmQoKTtcbiAgfSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICB2YWxpZGF0ZUFwcElkLFxuICB2YWxpZGF0ZUF1dGhEYXRhXG59O1xuIl19