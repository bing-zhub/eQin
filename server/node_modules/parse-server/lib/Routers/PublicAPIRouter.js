'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PublicAPIRouter = undefined;

var _PromiseRouter = require('../PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _Config = require('../Config');

var _Config2 = _interopRequireDefault(_Config);

var _express = require('express');

var _express2 = _interopRequireDefault(_express);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _querystring = require('querystring');

var _querystring2 = _interopRequireDefault(_querystring);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const public_html = _path2.default.resolve(__dirname, "../../public_html");
const views = _path2.default.resolve(__dirname, '../../views');

class PublicAPIRouter extends _PromiseRouter2.default {

  verifyEmail(req) {
    const { token, username } = req.query;
    const appId = req.params.appId;
    const config = _Config2.default.get(appId);

    if (!config) {
      this.invalidRequest();
    }

    if (!config.publicServerURL) {
      return this.missingPublicServerURL();
    }

    if (!token || !username) {
      return this.invalidLink(req);
    }

    const userController = config.userController;
    return userController.verifyEmail(username, token).then(() => {
      const params = _querystring2.default.stringify({ username });
      return Promise.resolve({
        status: 302,
        location: `${config.verifyEmailSuccessURL}?${params}`
      });
    }, () => {
      return this.invalidVerificationLink(req);
    });
  }

  resendVerificationEmail(req) {
    const username = req.body.username;
    const appId = req.params.appId;
    const config = _Config2.default.get(appId);

    if (!config) {
      this.invalidRequest();
    }

    if (!config.publicServerURL) {
      return this.missingPublicServerURL();
    }

    if (!username) {
      return this.invalidLink(req);
    }

    const userController = config.userController;

    return userController.resendVerificationEmail(username).then(() => {
      return Promise.resolve({
        status: 302,
        location: `${config.linkSendSuccessURL}`
      });
    }, () => {
      return Promise.resolve({
        status: 302,
        location: `${config.linkSendFailURL}`
      });
    });
  }

  changePassword(req) {
    return new Promise((resolve, reject) => {
      const config = _Config2.default.get(req.query.id);

      if (!config) {
        this.invalidRequest();
      }

      if (!config.publicServerURL) {
        return resolve({
          status: 404,
          text: 'Not found.'
        });
      }
      // Should we keep the file in memory or leave like that?
      _fs2.default.readFile(_path2.default.resolve(views, "choose_password"), 'utf-8', (err, data) => {
        if (err) {
          return reject(err);
        }
        data = data.replace("PARSE_SERVER_URL", `'${config.publicServerURL}'`);
        resolve({
          text: data
        });
      });
    });
  }

  requestResetPassword(req) {

    const config = req.config;

    if (!config) {
      this.invalidRequest();
    }

    if (!config.publicServerURL) {
      return this.missingPublicServerURL();
    }

    const { username, token } = req.query;

    if (!username || !token) {
      return this.invalidLink(req);
    }

    return config.userController.checkResetTokenValidity(username, token).then(() => {
      const params = _querystring2.default.stringify({ token, id: config.applicationId, username, app: config.appName });
      return Promise.resolve({
        status: 302,
        location: `${config.choosePasswordURL}?${params}`
      });
    }, () => {
      return this.invalidLink(req);
    });
  }

  resetPassword(req) {

    const config = req.config;

    if (!config) {
      this.invalidRequest();
    }

    if (!config.publicServerURL) {
      return this.missingPublicServerURL();
    }

    const {
      username,
      token,
      new_password
    } = req.body;

    if (!username || !token || !new_password) {
      return this.invalidLink(req);
    }

    return config.userController.updatePassword(username, token, new_password).then(() => {
      const params = _querystring2.default.stringify({ username: username });
      return Promise.resolve({
        status: 302,
        location: `${config.passwordResetSuccessURL}?${params}`
      });
    }, err => {
      const params = _querystring2.default.stringify({ username: username, token: token, id: config.applicationId, error: err, app: config.appName });
      return Promise.resolve({
        status: 302,
        location: `${config.choosePasswordURL}?${params}`
      });
    });
  }

  invalidLink(req) {
    return Promise.resolve({
      status: 302,
      location: req.config.invalidLinkURL
    });
  }

  invalidVerificationLink(req) {
    const config = req.config;
    if (req.query.username && req.params.appId) {
      const params = _querystring2.default.stringify({ username: req.query.username, appId: req.params.appId });
      return Promise.resolve({
        status: 302,
        location: `${config.invalidVerificationLinkURL}?${params}`
      });
    } else {
      return this.invalidLink(req);
    }
  }

  missingPublicServerURL() {
    return Promise.resolve({
      text: 'Not found.',
      status: 404
    });
  }

  invalidRequest() {
    const error = new Error();
    error.status = 403;
    error.message = "unauthorized";
    throw error;
  }

  setConfig(req) {
    req.config = _Config2.default.get(req.params.appId);
    return Promise.resolve();
  }

  mountRoutes() {
    this.route('GET', '/apps/:appId/verify_email', req => {
      this.setConfig(req);
    }, req => {
      return this.verifyEmail(req);
    });

    this.route('POST', '/apps/:appId/resend_verification_email', req => {
      this.setConfig(req);
    }, req => {
      return this.resendVerificationEmail(req);
    });

    this.route('GET', '/apps/choose_password', req => {
      return this.changePassword(req);
    });

    this.route('POST', '/apps/:appId/request_password_reset', req => {
      this.setConfig(req);
    }, req => {
      return this.resetPassword(req);
    });

    this.route('GET', '/apps/:appId/request_password_reset', req => {
      this.setConfig(req);
    }, req => {
      return this.requestResetPassword(req);
    });
  }

  expressRouter() {
    const router = _express2.default.Router();
    router.use("/apps", _express2.default.static(public_html));
    router.use("/", super.expressRouter());
    return router;
  }
}

exports.PublicAPIRouter = PublicAPIRouter;
exports.default = PublicAPIRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1B1YmxpY0FQSVJvdXRlci5qcyJdLCJuYW1lcyI6WyJwdWJsaWNfaHRtbCIsInBhdGgiLCJyZXNvbHZlIiwiX19kaXJuYW1lIiwidmlld3MiLCJQdWJsaWNBUElSb3V0ZXIiLCJQcm9taXNlUm91dGVyIiwidmVyaWZ5RW1haWwiLCJyZXEiLCJ0b2tlbiIsInVzZXJuYW1lIiwicXVlcnkiLCJhcHBJZCIsInBhcmFtcyIsImNvbmZpZyIsIkNvbmZpZyIsImdldCIsImludmFsaWRSZXF1ZXN0IiwicHVibGljU2VydmVyVVJMIiwibWlzc2luZ1B1YmxpY1NlcnZlclVSTCIsImludmFsaWRMaW5rIiwidXNlckNvbnRyb2xsZXIiLCJ0aGVuIiwicXMiLCJzdHJpbmdpZnkiLCJQcm9taXNlIiwic3RhdHVzIiwibG9jYXRpb24iLCJ2ZXJpZnlFbWFpbFN1Y2Nlc3NVUkwiLCJpbnZhbGlkVmVyaWZpY2F0aW9uTGluayIsInJlc2VuZFZlcmlmaWNhdGlvbkVtYWlsIiwiYm9keSIsImxpbmtTZW5kU3VjY2Vzc1VSTCIsImxpbmtTZW5kRmFpbFVSTCIsImNoYW5nZVBhc3N3b3JkIiwicmVqZWN0IiwiaWQiLCJ0ZXh0IiwiZnMiLCJyZWFkRmlsZSIsImVyciIsImRhdGEiLCJyZXBsYWNlIiwicmVxdWVzdFJlc2V0UGFzc3dvcmQiLCJjaGVja1Jlc2V0VG9rZW5WYWxpZGl0eSIsImFwcGxpY2F0aW9uSWQiLCJhcHAiLCJhcHBOYW1lIiwiY2hvb3NlUGFzc3dvcmRVUkwiLCJyZXNldFBhc3N3b3JkIiwibmV3X3Bhc3N3b3JkIiwidXBkYXRlUGFzc3dvcmQiLCJwYXNzd29yZFJlc2V0U3VjY2Vzc1VSTCIsImVycm9yIiwiaW52YWxpZExpbmtVUkwiLCJpbnZhbGlkVmVyaWZpY2F0aW9uTGlua1VSTCIsIkVycm9yIiwibWVzc2FnZSIsInNldENvbmZpZyIsIm1vdW50Um91dGVzIiwicm91dGUiLCJleHByZXNzUm91dGVyIiwicm91dGVyIiwiZXhw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QUFMLENBQVcsS0FBWCxFQUFpQixxQ0FBakIsRUFDRXBELE9BQU87QUFBRSxXQUFLa0QsU0FBTCxDQUFlbEQsR0FBZjtBQUFxQixLQURoQyxFQUVFQSxPQUFPO0FBQUUsYUFBTyxLQUFLbUMsb0JBQUwsQ0FBMEJuQyxHQUExQixDQUFQO0FBQXdDLEtBRm5EO0FBR0Q7O0FBRURxRCxrQkFBZ0I7QUFDZCxVQUFNQyxTQUFTQyxrQkFBUUMsTUFBUixFQUFmO0FBQ0FGLFdBQU9HLEdBQVAsQ0FBVyxPQUFYLEVBQW9CRixrQkFBUUcsTUFBUixDQUFlbEUsV0FBZixDQUFwQjtBQUNBOEQsV0FBT0csR0FBUCxDQUFXLEdBQVgsRUFBZ0IsTUFBTUosYUFBTixFQUFoQjtBQUNBLFdBQU9DLE1BQVA7QUFDRDtBQTlOZ0Q7O1FBQXRDekQsZSxHQUFBQSxlO2tCQWlPRUEsZSIsImZpbGUiOiJQdWJsaWNBUElSb3V0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgUHJvbWlzZVJvdXRlciBmcm9tICcuLi9Qcm9taXNlUm91dGVyJztcbmltcG9ydCBDb25maWcgZnJvbSAnLi4vQ29uZmlnJztcbmltcG9ydCBleHByZXNzIGZyb20gJ2V4cHJlc3MnO1xuaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHFzIGZyb20gJ3F1ZXJ5c3RyaW5nJztcblxuY29uc3QgcHVibGljX2h0bWwgPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uLy4uL3B1YmxpY19odG1sXCIpO1xuY29uc3Qgdmlld3MgPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vdmlld3MnKTtcblxuZXhwb3J0IGNsYXNzIFB1YmxpY0FQSVJvdXRlciBleHRlbmRzIFByb21pc2VSb3V0ZXIge1xuXG4gIHZlcmlmeUVtYWlsKHJlcSkge1xuICAgIGNvbnN0IHsgdG9rZW4sIHVzZXJuYW1lIH0gPSByZXEucXVlcnk7XG4gICAgY29uc3QgYXBwSWQgPSByZXEucGFyYW1zLmFwcElkO1xuICAgIGNvbnN0IGNvbmZpZyA9IENvbmZpZy5nZXQoYXBwSWQpO1xuXG4gICAgaWYoIWNvbmZpZyl7XG4gICAgICB0aGlzLmludmFsaWRSZXF1ZXN0KCk7XG4gICAgfVxuXG4gICAgaWYgKCFjb25maWcucHVibGljU2VydmVyVVJMKSB7XG4gICAgICByZXR1cm4gdGhpcy5taXNzaW5nUHVibGljU2VydmVyVVJMKCk7XG4gICAgfVxuXG4gICAgaWYgKCF0b2tlbiB8fCAhdXNlcm5hbWUpIHtcbiAgICAgIHJldHVybiB0aGlzLmludmFsaWRMaW5rKHJlcSk7XG4gICAgfVxuXG4gICAgY29uc3QgdXNlckNvbnRyb2xsZXIgPSBjb25maWcudXNlckNvbnRyb2xsZXI7XG4gICAgcmV0dXJuIHVzZXJDb250cm9sbGVyLnZlcmlmeUVtYWlsKHVzZXJuYW1lLCB0b2tlbikudGhlbigoKSA9PiB7XG4gICAgICBjb25zdCBwYXJhbXMgPSBxcy5zdHJpbmdpZnkoe3VzZXJuYW1lfSk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAgICAgICAgc3RhdHVzOiAzMDIsXG4gICAgICAgIGxvY2F0aW9uOiBgJHtjb25maWcudmVyaWZ5RW1haWxTdWNjZXNzVVJMfT8ke3BhcmFtc31gXG4gICAgICB9KTtcbiAgICB9LCAoKT0+IHtcbiAgICAgIHJldHVybiB0aGlzLmludmFsaWRWZXJpZmljYXRpb25MaW5rKHJlcSk7XG4gICAgfSlcbiAgfVxuXG4gIHJlc2VuZFZlcmlmaWNhdGlvbkVtYWlsKHJlcSkge1xuICAgIGNvbnN0IHVzZXJuYW1lID0gcmVxLmJvZHkudXNlcm5hbWU7XG4gICAgY29uc3QgYXBwSWQgPSByZXEucGFyYW1zLmFwcElkO1xuICAgIGNvbnN0IGNvbmZpZyA9IENvbmZpZy5nZXQoYXBwSWQpO1xuXG4gICAgaWYoIWNvbmZpZyl7XG4gICAgICB0aGlzLmludmFsaWRSZXF1ZXN0KCk7XG4gICAgfVxuXG4gICAgaWYgKCFjb25maWcucHVibGljU2VydmVyVVJMKSB7XG4gICAgICByZXR1cm4gdGhpcy5taXNzaW5nUHVibGljU2VydmVyVVJMKCk7XG4gICAgfVxuXG4gICAgaWYgKCF1c2VybmFtZSkge1xuICAgICAgcmV0dXJuIHRoaXMuaW52YWxpZExpbmsocmVxKTtcbiAgICB9XG5cbiAgICBjb25zdCB1c2VyQ29udHJvbGxlciA9IGNvbmZpZy51c2VyQ29udHJvbGxlcjtcblxuICAgIHJldHVybiB1c2VyQ29udHJvbGxlci5yZXNlbmRWZXJpZmljYXRpb25FbWFpbCh1c2VybmFtZSkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAgICAgICAgc3RhdHVzOiAzMDIsXG4gICAgICAgIGxvY2F0aW9uOiBgJHtjb25maWcubGlua1NlbmRTdWNjZXNzVVJMfWBcbiAgICAgIH0pO1xuICAgIH0sICgpPT4ge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICAgIHN0YXR1czogMzAyLFxuICAgICAgICBsb2NhdGlvbjogYCR7Y29uZmlnLmxpbmtTZW5kRmFpbFVSTH1gXG4gICAgICB9KTtcbiAgICB9KVxuICB9XG5cbiAgY2hhbmdlUGFzc3dvcmQocmVxKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IENvbmZpZy5nZXQocmVxLnF1ZXJ5LmlkKTtcblxuICAgICAgaWYoIWNvbmZpZyl7XG4gICAgICAgIHRoaXMuaW52YWxpZFJlcXVlc3QoKTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFjb25maWcucHVibGljU2VydmVyVVJMKSB7XG4gICAgICAgIHJldHVybiByZXNvbHZlKHtcbiAgICAgICAgICBzdGF0dXM6IDQwNCxcbiAgICAgICAgICB0ZXh0OiAnTm90IGZvdW5kLidcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICAvLyBTaG91bGQgd2Uga2VlcCB0aGUgZmlsZSBpbiBtZW1vcnkgb3IgbGVhdmUgbGlrZSB0aGF0P1xuICAgICAgZnMucmVhZEZpbGUocGF0aC5yZXNvbHZlKHZpZXdzLCBcImNob29zZV9wYXNzd29yZFwiKSwgJ3V0Zi04JywgKGVyciwgZGF0YSkgPT4ge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChlcnIpO1xuICAgICAgICB9XG4gICAgICAgIGRhdGEgPSBkYXRhLnJlcGxhY2UoXCJQQVJTRV9TRVJWRVJfVVJMXCIsIGAnJHtjb25maWcucHVibGljU2VydmVyVVJMfSdgKTtcbiAgICAgICAgcmVzb2x2ZSh7XG4gICAgICAgICAgdGV4dDogZGF0YVxuICAgICAgICB9KVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICByZXF1ZXN0UmVzZXRQYXNzd29yZChyZXEpIHtcblxuICAgIGNvbnN0IGNvbmZpZyA9IHJlcS5jb25maWc7XG5cbiAgICBpZighY29uZmlnKXtcbiAgICAgIHRoaXMuaW52YWxpZFJlcXVlc3QoKTtcbiAgICB9XG5cbiAgICBpZiAoIWNvbmZpZy5wdWJsaWNTZXJ2ZXJVUkwpIHtcbiAgICAgIHJldHVybiB0aGlzLm1pc3NpbmdQdWJsaWNTZXJ2ZXJVUkwoKTtcbiAgICB9XG5cbiAgICBjb25zdCB7IHVzZXJuYW1lLCB0b2tlbiB9ID0gcmVxLnF1ZXJ5O1xuXG4gICAgaWYgKCF1c2VybmFtZSB8fCAhdG9rZW4pIHtcbiAgICAgIHJldHVybiB0aGlzLmludmFsaWRMaW5rKHJlcSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbmZpZy51c2VyQ29udHJvbGxlci5jaGVja1Jlc2V0VG9rZW5WYWxpZGl0eSh1c2VybmFtZSwgdG9rZW4pLnRoZW4oKCkgPT4ge1xuICAgICAgY29uc3QgcGFyYW1zID0gcXMuc3RyaW5naWZ5KHt0b2tlbiwgaWQ6IGNvbmZpZy5hcHBsaWNhdGlvbklkLCB1c2VybmFtZSwgYXBwOiBjb25maWcuYXBwTmFtZSwgfSk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAgICAgICAgc3RhdHVzOiAzMDIsXG4gICAgICAgIGxvY2F0aW9uOiBgJHtjb25maWcuY2hvb3NlUGFzc3dvcmRVUkx9PyR7cGFyYW1zfWBcbiAgICAgIH0pXG4gICAgfSwgKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaW52YWxpZExpbmsocmVxKTtcbiAgICB9KVxuICB9XG5cbiAgcmVzZXRQYXNzd29yZChyZXEpIHtcblxuICAgIGNvbnN0IGNvbmZpZyA9IHJlcS5jb25maWc7XG5cbiAgICBpZighY29uZmlnKXtcbiAgICAgIHRoaXMuaW52YWxpZFJlcXVlc3QoKTtcbiAgICB9XG5cbiAgICBpZiAoIWNvbmZpZy5wdWJsaWNTZXJ2ZXJVUkwpIHtcbiAgICAgIHJldHVybiB0aGlzLm1pc3NpbmdQdWJsaWNTZXJ2ZXJVUkwoKTtcbiAgICB9XG5cbiAgICBjb25zdCB7XG4gICAgICB1c2VybmFtZSxcbiAgICAgIHRva2VuLFxuICAgICAgbmV3X3Bhc3N3b3JkXG4gICAgfSA9IHJlcS5ib2R5O1xuXG4gICAgaWYgKCF1c2VybmFtZSB8fCAhdG9rZW4gfHwgIW5ld19wYXNzd29yZCkge1xuICAgICAgcmV0dXJuIHRoaXMuaW52YWxpZExpbmsocmVxKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY29uZmlnLnVzZXJDb250cm9sbGVyLnVwZGF0ZVBhc3N3b3JkKHVzZXJuYW1lLCB0b2tlbiwgbmV3X3Bhc3N3b3JkKS50aGVuKCgpID0+IHtcbiAgICAgIGNvbnN0IHBhcmFtcyA9IHFzLnN0cmluZ2lmeSh7dXNlcm5hbWU6IHVzZXJuYW1lfSk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAgICAgICAgc3RhdHVzOiAzMDIsXG4gICAgICAgIGxvY2F0aW9uOiBgJHtjb25maWcucGFzc3dvcmRSZXNldFN1Y2Nlc3NVUkx9PyR7cGFyYW1zfWBcbiAgICAgIH0pO1xuICAgIH0sIChlcnIpID0+IHtcbiAgICAgIGNvbnN0IHBhcmFtcyA9IHFzLnN0cmluZ2lmeSh7dXNlcm5hbWU6IHVzZXJuYW1lLCB0b2tlbjogdG9rZW4sIGlkOiBjb25maWcuYXBwbGljYXRpb25JZCwgZXJyb3I6ZXJyLCBhcHA6Y29uZmlnLmFwcE5hbWV9KTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICBzdGF0dXM6IDMwMixcbiAgICAgICAgbG9jYXRpb246IGAke2NvbmZpZy5jaG9vc2VQYXNzd29yZFVSTH0/JHtwYXJhbXN9YFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgfVxuXG4gIGludmFsaWRMaW5rKHJlcSkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgc3RhdHVzOiAzMDIsXG4gICAgICBsb2NhdGlvbjogcmVxLmNvbmZpZy5pbnZhbGlkTGlua1VSTFxuICAgIH0pO1xuICB9XG5cbiAgaW52YWxpZFZlcmlmaWNhdGlvbkxpbmsocmVxKSB7XG4gICAgY29uc3QgY29uZmlnID0gcmVxLmNvbmZpZztcbiAgICBpZiAocmVxLnF1ZXJ5LnVzZXJuYW1lICYmIHJlcS5wYXJhbXMuYXBwSWQpIHtcbiAgICAgIGNvbnN0IHBhcmFtcyA9IHFzLnN0cmluZ2lmeSh7dXNlcm5hbWU6IHJlcS5xdWVyeS51c2VybmFtZSwgYXBwSWQ6IHJlcS5wYXJhbXMuYXBwSWR9KTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICBzdGF0dXM6IDMwMixcbiAgICAgICAgbG9jYXRpb246IGAke2NvbmZpZy5pbnZhbGlkVmVyaWZpY2F0aW9uTGlua1VSTH0/JHtwYXJhbXN9YFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0aGlzLmludmFsaWRMaW5rKHJlcSk7XG4gICAgfVxuICB9XG5cbiAgbWlzc2luZ1B1YmxpY1NlcnZlclVSTCgpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAgICAgIHRleHQ6ICAnTm90IGZvdW5kLicsXG4gICAgICBzdGF0dXM6IDQwNFxuICAgIH0pO1xuICB9XG5cbiAgaW52YWxpZFJlcXVlc3QoKSB7XG4gICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoKTtcbiAgICBlcnJvci5zdGF0dXMgPSA0MDM7XG4gICAgZXJyb3IubWVzc2FnZSA9IFwidW5hdXRob3JpemVkXCI7XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cblxuICBzZXRDb25maWcocmVxKSB7XG4gICAgcmVxLmNvbmZpZyA9IENvbmZpZy5nZXQocmVxLnBhcmFtcy5hcHBJZCk7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgbW91bnRSb3V0ZXMoKSB7XG4gICAgdGhpcy5yb3V0ZSgnR0VUJywnL2FwcHMvOmFwcElkL3ZlcmlmeV9lbWFpbCcsXG4gICAgICByZXEgPT4geyB0aGlzLnNldENvbmZpZyhyZXEpIH0sXG4gICAgICByZXEgPT4geyByZXR1cm4gdGhpcy52ZXJpZnlFbWFpbChyZXEpOyB9KTtcblxuICAgIHRoaXMucm91dGUoJ1BPU1QnLCAnL2FwcHMvOmFwcElkL3Jlc2VuZF92ZXJpZmljYXRpb25fZW1haWwnLFxuICAgICAgcmVxID0+IHsgdGhpcy5zZXRDb25maWcocmVxKTsgfSxcbiAgICAgIHJlcSA9PiB7IHJldHVybiB0aGlzLnJlc2VuZFZlcmlmaWNhdGlvbkVtYWlsKHJlcSk7IH0pO1xuXG4gICAgdGhpcy5yb3V0ZSgnR0VUJywnL2FwcHMvY2hvb3NlX3Bhc3N3b3JkJyxcbiAgICAgIHJlcSA9PiB7IHJldHVybiB0aGlzLmNoYW5nZVBhc3N3b3JkKHJlcSk7IH0pO1xuXG4gICAgdGhpcy5yb3V0ZSgnUE9TVCcsJy9hcHBzLzphcHBJZC9yZXF1ZXN0X3Bhc3N3b3JkX3Jlc2V0JyxcbiAgICAgIHJlcSA9PiB7IHRoaXMuc2V0Q29uZmlnKHJlcSkgfSxcbiAgICAgIHJlcSA9PiB7IHJldHVybiB0aGlzLnJlc2V0UGFzc3dvcmQocmVxKTsgfSk7XG5cbiAgICB0aGlzLnJvdXRlKCdHRVQnLCcvYXBwcy86YXBwSWQvcmVxdWVzdF9wYXNzd29yZF9yZXNldCcsXG4gICAgICByZXEgPT4geyB0aGlzLnNldENvbmZpZyhyZXEpIH0sXG4gICAgICByZXEgPT4geyByZXR1cm4gdGhpcy5yZXF1ZXN0UmVzZXRQYXNzd29yZChyZXEpOyB9KTtcbiAgfVxuXG4gIGV4cHJlc3NSb3V0ZXIoKSB7XG4gICAgY29uc3Qgcm91dGVyID0gZXhwcmVzcy5Sb3V0ZXIoKTtcbiAgICByb3V0ZXIudXNlKFwiL2FwcHNcIiwgZXhwcmVzcy5zdGF0aWMocHVibGljX2h0bWwpKTtcbiAgICByb3V0ZXIudXNlKFwiL1wiLCBzdXBlci5leHByZXNzUm91dGVyKCkpO1xuICAgIHJldHVybiByb3V0ZXI7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUHVibGljQVBJUm91dGVyO1xuIl19