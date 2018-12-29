'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _Options = require('./Options');

var _defaults = require('./defaults');

var _defaults2 = _interopRequireDefault(_defaults);

var _logger = require('./logger');

var logging = _interopRequireWildcard(_logger);

var _Config = require('./Config');

var _Config2 = _interopRequireDefault(_Config);

var _PromiseRouter = require('./PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _requiredParameter = require('./requiredParameter');

var _requiredParameter2 = _interopRequireDefault(_requiredParameter);

var _AnalyticsRouter = require('./Routers/AnalyticsRouter');

var _ClassesRouter = require('./Routers/ClassesRouter');

var _FeaturesRouter = require('./Routers/FeaturesRouter');

var _FilesRouter = require('./Routers/FilesRouter');

var _FunctionsRouter = require('./Routers/FunctionsRouter');

var _GlobalConfigRouter = require('./Routers/GlobalConfigRouter');

var _HooksRouter = require('./Routers/HooksRouter');

var _IAPValidationRouter = require('./Routers/IAPValidationRouter');

var _InstallationsRouter = require('./Routers/InstallationsRouter');

var _LogsRouter = require('./Routers/LogsRouter');

var _ParseLiveQueryServer = require('./LiveQuery/ParseLiveQueryServer');

var _PublicAPIRouter = require('./Routers/PublicAPIRouter');

var _PushRouter = require('./Routers/PushRouter');

var _CloudCodeRouter = require('./Routers/CloudCodeRouter');

var _RolesRouter = require('./Routers/RolesRouter');

var _SchemasRouter = require('./Routers/SchemasRouter');

var _SessionsRouter = require('./Routers/SessionsRouter');

var _UsersRouter = require('./Routers/UsersRouter');

var _PurgeRouter = require('./Routers/PurgeRouter');

var _AudiencesRouter = require('./Routers/AudiencesRouter');

var _AggregateRouter = require('./Routers/AggregateRouter');

var _ParseServerRESTController = require('./ParseServerRESTController');

var _Controllers = require('./Controllers');

var controllers = _interopRequireWildcard(_Controllers);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// ParseServer - open-source compatible API Server for Parse apps

var batch = require('./batch'),
    bodyParser = require('body-parser'),
    express = require('express'),
    middlewares = require('./middlewares'),
    Parse = require('parse/node').Parse,
    path = require('path');

// Mutate the Parse object to add the Cloud Code handlers
addParseCloud();

// ParseServer works like a constructor of an express app.
// The args that we understand are:
// "analyticsAdapter": an adapter class for analytics
// "filesAdapter": a class like GridStoreAdapter providing create, get,
//                 and delete
// "loggerAdapter": a class like WinstonLoggerAdapter providing info, error,
//                 and query
// "jsonLogs": log as structured JSON objects
// "databaseURI": a uri like mongodb://localhost:27017/dbname to tell us
//          what database this Parse API connects to.
// "cloud": relative location to cloud code to require, or a function
//          that is given an instance of Parse as a parameter.  Use this instance of Parse
//          to register your cloud code hooks and functions.
// "appId": the application id to host
// "masterKey": the master key for requests to this app
// "collectionPrefix": optional prefix for database collection names
// "fileKey": optional key from Parse dashboard for supporting older files
//            hosted by Parse
// "clientKey": optional key from Parse dashboard
// "dotNetKey": optional key from Parse dashboard
// "restAPIKey": optional key from Parse dashboard
// "webhookKey": optional key from Parse dashboard
// "javascriptKey": optional key from Parse dashboard
// "push": optional key from configure push
// "sessionLength": optional length in seconds for how long Sessions should be valid for
// "maxLimit": optional upper bound for what can be specified for the 'limit' parameter on queries

class ParseServer {

  constructor(options) {
    injectDefaults(options);
    const {
      appId = (0, _requiredParameter2.default)('You must provide an appId!'),
      masterKey = (0, _requiredParameter2.default)('You must provide a masterKey!'),
      cloud,
      javascriptKey,
      serverURL = (0, _requiredParameter2.default)('You must provide a serverURL!'),
      __indexBuildCompletionCallbackForTests = () => {}
    } = options;
    // Initialize the node client SDK automatically
    Parse.initialize(appId, javascriptKey || 'unused', masterKey);
    Parse.serverURL = serverURL;

    const allControllers = controllers.getControllers(options);

    const {
      loggerController,
      databaseController,
      hooksController
    } = allControllers;
    this.config = _Config2.default.put(Object.assign({}, options, allControllers));

    logging.setLogger(loggerController);
    const dbInitPromise = databaseController.performInitialization();
    hooksController.load();

    // Note: Tests will start to fail if any validation happens after this is called.
    if (process.env.TESTING) {
      __indexBuildCompletionCallbackForTests(dbInitPromise);
    }

    if (cloud) {
      addParseCloud();
      if (typeof cloud === 'function') {
        cloud(Parse);
      } else if (typeof cloud === 'string') {
        require(path.resolve(process.cwd(), cloud));
      } else {
        throw "argument 'cloud' must either be a string or a function";
      }
    }
  }

  get app() {
    if (!this._app) {
      this._app = ParseServer.app(this.config);
    }
    return this._app;
  }

  handleShutdown() {
    const { adapter } = this.config.databaseController;
    if (adapter && typeof adapter.handleShutdown === 'function') {
      adapter.handleShutdown();
    }
  }

  static app({ maxUploadSize = '20mb', appId }) {
    // This app serves the Parse API directly.
    // It's the equivalent of https://api.parse.com/1 in the hosted Parse API.
    var api = express();
    //api.use("/apps", express.static(__dirname + "/public"));
    // File handling needs to be before default middlewares are applied
    api.use('/', middlewares.allowCrossDomain, new _FilesRouter.FilesRouter().expressRouter({
      maxUploadSize: maxUploadSize
    }));

    api.use('/health', function (req, res) {
      res.json({
        status: 'ok'
      });
    });

    api.use('/', bodyParser.urlencoded({ extended: false }), new _PublicAPIRouter.PublicAPIRouter().expressRouter());

    api.use(bodyParser.json({ 'type': '*/*', limit: maxUploadSize }));
    api.use(middlewares.allowCrossDomain);
    api.use(middlewares.allowMethodOverride);
    api.use(middlewares.handleParseHeaders);

    const appRouter = ParseServer.promiseRouter({ appId });
    api.use(appRouter.expressRouter());

    api.use(middlewares.handleParseErrors);

    // run the following when not testing
    if (!process.env.TESTING) {
      //This causes tests to spew some useless warnings, so disable in test
      /* istanbul ignore next */
      process.on('uncaughtException', err => {
        if (err.code === "EADDRINUSE") {
          // user-friendly message for this common error
          process.stderr.write(`Unable to listen on port ${err.port}. The port is already in use.`);
          process.exit(0);
        } else {
          throw err;
        }
      });
      // verify the server url after a 'mount' event is received
      /* istanbul ignore next */
      api.on('mount', function () {
        ParseServer.verifyServerUrl();
      });
    }
    if (process.env.PARSE_SERVER_ENABLE_EXPERIMENTAL_DIRECT_ACCESS === '1') {
      Parse.CoreManager.setRESTController((0, _ParseServerRESTController.ParseServerRESTController)(appId, appRouter));
    }
    return api;
  }

  static promiseRouter({ appId }) {
    const routers = [new _ClassesRouter.ClassesRouter(), new _UsersRouter.UsersRouter(), new _SessionsRouter.SessionsRouter(), new _RolesRouter.RolesRouter(), new _AnalyticsRouter.AnalyticsRouter(), new _InstallationsRouter.InstallationsRouter(), new _FunctionsRouter.FunctionsRouter(), new _SchemasRouter.SchemasRouter(), new _PushRouter.PushRouter(), new _LogsRouter.LogsRouter(), new _IAPValidationRouter.IAPValidationRouter(), new _FeaturesRouter.FeaturesRouter(), new _GlobalConfigRouter.GlobalConfigRouter(), new _PurgeRouter.PurgeRouter(), new _HooksRouter.HooksRouter(), new _CloudCodeRouter.CloudCodeRouter(), new _AudiencesRouter.AudiencesRouter(), new _AggregateRouter.AggregateRouter()];

    const routes = routers.reduce((memo, router) => {
      return memo.concat(router.routes);
    }, []);

    const appRouter = new _PromiseRouter2.default(routes, appId);

    batch.mountOnto(appRouter);
    return appRouter;
  }

  start(options, callback) {
    const app = express();
    if (options.middleware) {
      let middleware;
      if (typeof options.middleware == 'string') {
        middleware = require(path.resolve(process.cwd(), options.middleware));
      } else {
        middleware = options.middleware; // use as-is let express fail
      }
      app.use(middleware);
    }

    app.use(options.mountPath, this.app);
    const server = app.listen(options.port, options.host, callback);
    this.server = server;

    if (options.startLiveQueryServer || options.liveQueryServerOptions) {
      this.liveQueryServer = ParseServer.createLiveQueryServer(server, options.liveQueryServerOptions);
    }
    /* istanbul ignore next */
    if (!process.env.TESTING) {
      configureListeners(this);
    }
    this.expressApp = app;
    return this;
  }

  static start(options, callback) {
    const parseServer = new ParseServer(options);
    return parseServer.start(options, callback);
  }

  static createLiveQueryServer(httpServer, config) {
    if (!httpServer || config && config.port) {
      var app = express();
      httpServer = require('http').createServer(app);
      httpServer.listen(config.port);
    }
    return new _ParseLiveQueryServer.ParseLiveQueryServer(httpServer, config);
  }

  static verifyServerUrl(callback) {
    // perform a health check on the serverURL value
    if (Parse.serverURL) {
      const request = require('request');
      request(Parse.serverURL.replace(/\/$/, "") + "/health", function (error, response, body) {
        let json;
        try {
          json = JSON.parse(body);
        } catch (e) {
          json = null;
        }
        if (error || response.statusCode !== 200 || !json || json && json.status !== 'ok') {
          /* eslint-disable no-console */
          console.warn(`\nWARNING, Unable to connect to '${Parse.serverURL}'.` + ` Cloud code and push notifications may be unavailable!\n`);
          /* eslint-enable no-console */
          if (callback) {
            callback(false);
          }
        } else {
          if (callback) {
            callback(true);
          }
        }
      });
    }
  }
}

function addParseCloud() {
  const ParseCloud = require("./cloud-code/Parse.Cloud");
  Object.assign(Parse.Cloud, ParseCloud);
  global.Parse = Parse;
}

function injectDefaults(options) {
  Object.keys(_defaults2.default).forEach(key => {
    if (!options.hasOwnProperty(key)) {
      options[key] = _defaults2.default[key];
    }
  });

  if (!options.hasOwnProperty('serverURL')) {
    options.serverURL = `http://localhost:${options.port}${options.mountPath}`;
  }

  options.userSensitiveFields = Array.from(new Set(options.userSensitiveFields.concat(_defaults2.default.userSensitiveFields, options.userSensitiveFields)));

  options.masterKeyIps = Array.from(new Set(options.masterKeyIps.concat(_defaults2.default.masterKeyIps, options.masterKeyIps)));
}

// Those can't be tested as it requires a subprocess
/* istanbul ignore next */
function configureListeners(parseServer) {
  const server = parseServer.server;
  const sockets = {};
  /* Currently, express doesn't shut down immediately after receiving SIGINT/SIGTERM if it has client connections that haven't timed out. (This is a known issue with node - https://github.com/nodejs/node/issues/2642)
    This function, along with `destroyAliveConnections()`, intend to fix this behavior such that parse server will close all open connections and initiate the shutdown process as soon as it receives a SIGINT/SIGTERM signal. */
  server.on('connection', socket => {
    const socketId = socket.remoteAddress + ':' + socket.remotePort;
    sockets[socketId] = socket;
    socket.on('close', () => {
      delete sockets[socketId];
    });
  });

  const destroyAliveConnections = function () {
    for (const socketId in sockets) {
      try {
        sockets[socketId].destroy();
      } catch (e) {/* */}
    }
  };

  const handleShutdown = function () {
    process.stdout.write('Termination signal received. Shutting down.');
    destroyAliveConnections();
    server.close();
    parseServer.handleShutdown();
  };
  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);
}

exports.default = ParseServer;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9QYXJzZVNlcnZlci5qcyJdLCJuYW1lcyI6WyJsb2dnaW5nIiwiY29udHJvbGxlcnMiLCJiYXRjaCIsInJlcXVpcmUiLCJib2R5UGFyc2VyIiwiZXhwcmVzcyIsIm1pZGRsZXdhcmVzIiwiUGFyc2UiLCJwYXRoIiwiYWRkUGFyc2VDbG91ZCIsIlBhcnNlU2VydmVyIiwiY29uc3RydWN0b3IiLCJvcHRpb25zIiwiaW5qZWN0RGVmYXVsdHMiLCJhcHBJZCIsIm1hc3RlcktleSIsImNsb3VkIiwiamF2YXNjcmlwdEtleSIsInNlcnZlclVSTCIsIl9faW5kZXhCdWlsZENvbXBsZXRpb25DYWxsYmFja0ZvclRlc3RzIiwiaW5pdGlhbGl6ZSIsImFsbENvbnRyb2xsZXJzIiwiZ2V0Q29udHJvbGxlcnMiLCJsb2dnZXJDb250cm9sbGVyIiwiZGF0YWJhc2VDb250cm9sbGVyIiwiaG9va3NDb250cm9sbGVyIiwiY29uZmlnIiwiQ29uZmlnIiwicHV0IiwiT2JqZWN0IiwiYXNzaWduIiwic2V0TG9nZ2VyIiwiZGJJbml0UHJvbWlzZSIsInBlcmZvcm1Jbml0aWFsaXphdGlvbiIsImxvYWQiLCJwcm9jZXNzIiwiZW52IiwiVEVTVElORyIsInJlc29sdmUiLCJjd2QiLCJhcHAiLCJfYXBwIiwiaGFuZGxlU2h1dGRvd24iLCJhZGFwdGVyIiwibWF4VXBsb2FkU2l6ZSIsImFwaSIsInVzZSIsImFsbG93Q3Jvc3NEb21haW4iLCJGaWxlc1JvdXRlciIsImV4cHJlc3NSb3V0ZXIiLCJyZXEiLCJyZXMiLCJqc29uIiwic3RhdHVzIiwidXJsZW5jb2RlZCIsImV4dGVuZGVkIiwiUHVibGljQVBJUm91dGVyIiwibGltaXQiLCJhbGxvd01ldGhvZE92ZXJyaWRlIiwiaGFuZGxlUGFyc2VIZWFkZXJzIiwiYXBwUm91dGVyIiwicHJvbWlzZVJvdXRlciIsImhhbmRsZVBhcnNlRXJyb3JzIiwib24iLCJlcnIiLCJjb2RlIiwic3RkZXJyIiwid3JpdGUiLCJwb3J0IiwiZXhpdCIsInZlcmlmeVNlcnZlclVybCIsIlBBUlNFX1NFUlZFUl9FTkFCTEVfRVhQRVJJTUVOVEFMX0RJUkVDVF9BQ0NFU1MiLCJDb3JlTWFuYWdlciIsInNldFJFU1RDb250cm9sbGVyIiwicm91dGVycyIsIkNsYXNzZXNSb3V0ZXIiLCJVc2Vyc1JvdXRlciIsIlNlc3Npb25zUm91dGVyIiwiUm9sZXNSb3V0ZXIiLCJBbmFseXRpY3NSb3V0ZXIiLCJJbnN0YWxsYXRpb25zUm91dGVyIiwiRnVuY3Rpb25zUm91dGVyIiwiU2NoZW1hc1JvdXRlciIsIlB1c2hSb3V0ZXIiLCJMb2dzUm91dGVyIiwiSUFQVmFsaWRhdGlvblJvdXRlciIsIkZlYXR1cmVzUm91dGVyIiwiR2xvYmFsQ29uZmlnUm91dGVyIiwiUHVyZ2VSb3V0ZXIiLCJIb29rc1JvdXRlciIsIkNsb3VkQ29kZVJvdXRlciIsIkF1ZGllbmNlc1JvdXRlciIsIkFnZ3JlZ2F0ZVJvdXRlciIsInJvdXRlcyIsInJlZHVjZSIsIm1lbW8iLCJyb3V0ZXIiLCJjb25jYXQiLCJQcm9taXNlUm91dGVyIiwibW91bnRPbnRvIiwic3RhcnQiLCJjYWxsYmFjayIsIm1pZGRsZXdhcmUiLCJtb3VudFBhdGgiLCJzZXJ2ZXIiLCJsaXN0ZW4iLCJob3N0Iiwic3RhcnRMaXZlUXVlcnlTZXJ2ZXIiLCJsaXZlUXVlcnlTZXJ2ZXJPcHRpb25zIiwibGl2ZVF1ZXJ5U2VydmVyIiwiY3JlYXRlTGl2ZVF1ZXJ5U2VydmVyIiwiY29uZmlndXJlTGlzdGVuZXJzIiwiZXhwcmVzc0FwcCIsInBhcnNlU2VydmVyIiwiaHR0cFNlcnZlciIsImNyZWF0ZVNlcnZlciIsIlBhcnNlTGl2ZVF1ZXJ5U2VydmVyIiwicmVxdWVzdCIsInJlcGxhY2UiLCJlcnJvciIsInJlc3BvbnNlIiwiYm9keSIsIkpTT04iLCJwYXJzZSIsImUiLCJzdGF0dXNDb2RlIiwiY29uc29sZSIsIndhcm4iLCJQYXJzZUNsb3VkIiwiQ2xvdWQiLCJnbG9iYWwiLCJrZXlzIiwiZGVmYXVsdHMiLCJmb3JFYWNoIiwia2V5IiwiaGFzT3duUHJvcGVydHkiLCJ1c2VyU2Vuc2l0aXZlRmllbGRzIiwiQXJyYXkiLCJmcm9tIiwiU2V0IiwibWFzdGVyS2V5SXBzIiwic29ja2V0cyIsInNvY2tldCIsInNvY2tldElkIiwicmVtb3RlQWRkcmVzcyIsInJlbW90ZVBvcnQiLCJkZXN0cm95QWxpdmVDb25uZWN0aW9ucyIsImRlc3Ryb3kiLCJzdGRvdXQiLCJjbG9zZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBU0E7O0FBRUE7Ozs7QUFDQTs7SUFBWUEsTzs7QUFDWjs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFFQTs7QUFDQTs7SUFBWUMsVzs7Ozs7O0FBdkNaOztBQUVBLElBQUlDLFFBQVFDLFFBQVEsU0FBUixDQUFaO0FBQUEsSUFDRUMsYUFBYUQsUUFBUSxhQUFSLENBRGY7QUFBQSxJQUVFRSxVQUFVRixRQUFRLFNBQVIsQ0FGWjtBQUFBLElBR0VHLGNBQWNILFFBQVEsZUFBUixDQUhoQjtBQUFBLElBSUVJLFFBQVFKLFFBQVEsWUFBUixFQUFzQkksS0FKaEM7QUFBQSxJQUtFQyxPQUFPTCxRQUFRLE1BQVIsQ0FMVDs7QUFzQ0E7QUFDQU07O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQyxXQUFOLENBQWtCOztBQUVoQkMsY0FBWUMsT0FBWixFQUF5QztBQUN2Q0MsbUJBQWVELE9BQWY7QUFDQSxVQUFNO0FBQ0pFLGNBQVEsaUNBQWtCLDRCQUFsQixDQURKO0FBRUpDLGtCQUFZLGlDQUFrQiwrQkFBbEIs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Q0QsT0FGRCxDQUVFLE9BQU92QixDQUFQLEVBQVUsQ0FBRSxLQUFPO0FBQ3RCO0FBQ0YsR0FORDs7QUFRQSxRQUFNbEYsaUJBQWlCLFlBQVc7QUFDaENQLFlBQVFpSCxNQUFSLENBQWVqRixLQUFmLENBQXFCLDZDQUFyQjtBQUNBK0U7QUFDQTFDLFdBQU82QyxLQUFQO0FBQ0FwQyxnQkFBWXZFLGNBQVo7QUFDRCxHQUxEO0FBTUFQLFVBQVE0QixFQUFSLENBQVcsU0FBWCxFQUFzQnJCLGNBQXRCO0FBQ0FQLFVBQVE0QixFQUFSLENBQVcsUUFBWCxFQUFxQnJCLGNBQXJCO0FBQ0Q7O2tCQUVjaEMsVyIsImZpbGUiOiJQYXJzZVNlcnZlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIFBhcnNlU2VydmVyIC0gb3Blbi1zb3VyY2UgY29tcGF0aWJsZSBBUEkgU2VydmVyIGZvciBQYXJzZSBhcHBzXG5cbnZhciBiYXRjaCA9IHJlcXVpcmUoJy4vYmF0Y2gnKSxcbiAgYm9keVBhcnNlciA9IHJlcXVpcmUoJ2JvZHktcGFyc2VyJyksXG4gIGV4cHJlc3MgPSByZXF1aXJlKCdleHByZXNzJyksXG4gIG1pZGRsZXdhcmVzID0gcmVxdWlyZSgnLi9taWRkbGV3YXJlcycpLFxuICBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKS5QYXJzZSxcbiAgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcblxuaW1wb3J0IHsgUGFyc2VTZXJ2ZXJPcHRpb25zLFxuICBMaXZlUXVlcnlTZXJ2ZXJPcHRpb25zIH0gICAgICBmcm9tICcuL09wdGlvbnMnO1xuaW1wb3J0IGRlZmF1bHRzICAgICAgICAgICAgICAgICBmcm9tICcuL2RlZmF1bHRzJztcbmltcG9ydCAqIGFzIGxvZ2dpbmcgICAgICAgICAgICAgZnJvbSAnLi9sb2dnZXInO1xuaW1wb3J0IENvbmZpZyAgICAgICAgICAgICAgICAgICBmcm9tICcuL0NvbmZpZyc7XG5pbXBvcnQgUHJvbWlzZVJvdXRlciAgICAgICAgICAgIGZyb20gJy4vUHJvbWlzZVJvdXRlcic7XG5pbXBvcnQgcmVxdWlyZWRQYXJhbWV0ZXIgICAgICAgIGZyb20gJy4vcmVxdWlyZWRQYXJhbWV0ZXInO1xuaW1wb3J0IHsgQW5hbHl0aWNzUm91dGVyIH0gICAgICBmcm9tICcuL1JvdXRlcnMvQW5hbHl0aWNzUm91dGVyJztcbmltcG9ydCB7IENsYXNzZXNSb3V0ZXIgfSAgICAgICAgZnJvbSAnLi9Sb3V0ZXJzL0NsYXNzZXNSb3V0ZXInO1xuaW1wb3J0IHsgRmVhdHVyZXNSb3V0ZXIgfSAgICAgICBmcm9tICcuL1JvdXRlcnMvRmVhdHVyZXNSb3V0ZXInO1xuaW1wb3J0IHsgRmlsZXNSb3V0ZXIgfSAgICAgICAgICBmcm9tICcuL1JvdXRlcnMvRmlsZXNSb3V0ZXInO1xuaW1wb3J0IHsgRnVuY3Rpb25zUm91dGVyIH0gICAgICBmcm9tICcuL1JvdXRlcnMvRnVuY3Rpb25zUm91dGVyJztcbmltcG9ydCB7IEdsb2JhbENvbmZpZ1JvdXRlciB9ICAgZnJvbSAnLi9Sb3V0ZXJzL0dsb2JhbENvbmZpZ1JvdXRlcic7XG5pbXBvcnQgeyBIb29rc1JvdXRlciB9ICAgICAgICAgIGZyb20gJy4vUm91dGVycy9Ib29rc1JvdXRlcic7XG5pbXBvcnQgeyBJQVBWYWxpZGF0aW9uUm91dGVyIH0gIGZyb20gJy4vUm91dGVycy9JQVBWYWxpZGF0aW9uUm91dGVyJztcbmltcG9ydCB7IEluc3RhbGxhdGlvbnNSb3V0ZXIgfSAgZnJvbSAnLi9Sb3V0ZXJzL0luc3RhbGxhdGlvbnNSb3V0ZXInO1xuaW1wb3J0IHsgTG9nc1JvdXRlciB9ICAgICAgICAgICBmcm9tICcuL1JvdXRlcnMvTG9nc1JvdXRlcic7XG5pbXBvcnQgeyBQYXJzZUxpdmVRdWVyeVNlcnZlciB9IGZyb20gJy4vTGl2ZVF1ZXJ5L1BhcnNlTGl2ZVF1ZXJ5U2VydmVyJztcbmltcG9ydCB7IFB1YmxpY0FQSVJvdXRlciB9ICAgICAgZnJvbSAnLi9Sb3V0ZXJzL1B1YmxpY0FQSVJvdXRlcic7XG5pbXBvcnQgeyBQdXNoUm91dGVyIH0gICAgICAgICAgIGZyb20gJy4vUm91dGVycy9QdXNoUm91dGVyJztcbmltcG9ydCB7IENsb3VkQ29kZVJvdXRlciB9ICAgICAgZnJvbSAnLi9Sb3V0ZXJzL0Nsb3VkQ29kZVJvdXRlcic7XG5pbXBvcnQgeyBSb2xlc1JvdXRlciB9ICAgICAgICAgIGZyb20gJy4vUm91dGVycy9Sb2xlc1JvdXRlcic7XG5pbXBvcnQgeyBTY2hlbWFzUm91dGVyIH0gICAgICAgIGZyb20gJy4vUm91dGVycy9TY2hlbWFzUm91dGVyJztcbmltcG9ydCB7IFNlc3Npb25zUm91dGVyIH0gICAgICAgZnJvbSAnLi9Sb3V0ZXJzL1Nlc3Npb25zUm91dGVyJztcbmltcG9ydCB7IFVzZXJzUm91dGVyIH0gICAgICAgICAgZnJvbSAnLi9Sb3V0ZXJzL1VzZXJzUm91dGVyJztcbmltcG9ydCB7IFB1cmdlUm91dGVyIH0gICAgICAgICAgZnJvbSAnLi9Sb3V0ZXJzL1B1cmdlUm91dGVyJztcbmltcG9ydCB7IEF1ZGllbmNlc1JvdXRlciB9ICAgICAgZnJvbSAnLi9Sb3V0ZXJzL0F1ZGllbmNlc1JvdXRlcic7XG5pbXBvcnQgeyBBZ2dyZWdhdGVSb3V0ZXIgfSAgICAgIGZyb20gJy4vUm91dGVycy9BZ2dyZWdhdGVSb3V0ZXInO1xuXG5pbXBvcnQgeyBQYXJzZVNlcnZlclJFU1RDb250cm9sbGVyIH0gZnJvbSAnLi9QYXJzZVNlcnZlclJFU1RDb250cm9sbGVyJztcbmltcG9ydCAqIGFzIGNvbnRyb2xsZXJzIGZyb20gJy4vQ29udHJvbGxlcnMnO1xuLy8gTXV0YXRlIHRoZSBQYXJzZSBvYmplY3QgdG8gYWRkIHRoZSBDbG91ZCBDb2RlIGhhbmRsZXJzXG5hZGRQYXJzZUNsb3VkKCk7XG5cbi8vIFBhcnNlU2VydmVyIHdvcmtzIGxpa2UgYSBjb25zdHJ1Y3RvciBvZiBhbiBleHByZXNzIGFwcC5cbi8vIFRoZSBhcmdzIHRoYXQgd2UgdW5kZXJzdGFuZCBhcmU6XG4vLyBcImFuYWx5dGljc0FkYXB0ZXJcIjogYW4gYWRhcHRlciBjbGFzcyBmb3IgYW5hbHl0aWNzXG4vLyBcImZpbGVzQWRhcHRlclwiOiBhIGNsYXNzIGxpa2UgR3JpZFN0b3JlQWRhcHRlciBwcm92aWRpbmcgY3JlYXRlLCBnZXQsXG4vLyAgICAgICAgICAgICAgICAgYW5kIGRlbGV0ZVxuLy8gXCJsb2dnZXJBZGFwdGVyXCI6IGEgY2xhc3MgbGlrZSBXaW5zdG9uTG9nZ2VyQWRhcHRlciBwcm92aWRpbmcgaW5mbywgZXJyb3IsXG4vLyAgICAgICAgICAgICAgICAgYW5kIHF1ZXJ5XG4vLyBcImpzb25Mb2dzXCI6IGxvZyBhcyBzdHJ1Y3R1cmVkIEpTT04gb2JqZWN0c1xuLy8gXCJkYXRhYmFzZVVSSVwiOiBhIHVyaSBsaWtlIG1vbmdvZGI6Ly9sb2NhbGhvc3Q6MjcwMTcvZGJuYW1lIHRvIHRlbGwgdXNcbi8vICAgICAgICAgIHdoYXQgZGF0YWJhc2UgdGhpcyBQYXJzZSBBUEkgY29ubmVjdHMgdG8uXG4vLyBcImNsb3VkXCI6IHJlbGF0aXZlIGxvY2F0aW9uIHRvIGNsb3VkIGNvZGUgdG8gcmVxdWlyZSwgb3IgYSBmdW5jdGlvblxuLy8gICAgICAgICAgdGhhdCBpcyBnaXZlbiBhbiBpbnN0YW5jZSBvZiBQYXJzZSBhcyBhIHBhcmFtZXRlci4gIFVzZSB0aGlzIGluc3RhbmNlIG9mIFBhcnNlXG4vLyAgICAgICAgICB0byByZWdpc3RlciB5b3VyIGNsb3VkIGNvZGUgaG9va3MgYW5kIGZ1bmN0aW9ucy5cbi8vIFwiYXBwSWRcIjogdGhlIGFwcGxpY2F0aW9uIGlkIHRvIGhvc3Rcbi8vIFwibWFzdGVyS2V5XCI6IHRoZSBtYXN0ZXIga2V5IGZvciByZXF1ZXN0cyB0byB0aGlzIGFwcFxuLy8gXCJjb2xsZWN0aW9uUHJlZml4XCI6IG9wdGlvbmFsIHByZWZpeCBmb3IgZGF0YWJhc2UgY29sbGVjdGlvbiBuYW1lc1xuLy8gXCJmaWxlS2V5XCI6IG9wdGlvbmFsIGtleSBmcm9tIFBhcnNlIGRhc2hib2FyZCBmb3Igc3VwcG9ydGluZyBvbGRlciBmaWxlc1xuLy8gICAgICAgICAgICBob3N0ZWQgYnkgUGFyc2Vcbi8vIFwiY2xpZW50S2V5XCI6IG9wdGlvbmFsIGtleSBmcm9tIFBhcnNlIGRhc2hib2FyZFxuLy8gXCJkb3ROZXRLZXlcIjogb3B0aW9uYWwga2V5IGZyb20gUGFyc2UgZGFzaGJvYXJkXG4vLyBcInJlc3RBUElLZXlcIjogb3B0aW9uYWwga2V5IGZyb20gUGFyc2UgZGFzaGJvYXJkXG4vLyBcIndlYmhvb2tLZXlcIjogb3B0aW9uYWwga2V5IGZyb20gUGFyc2UgZGFzaGJvYXJkXG4vLyBcImphdmFzY3JpcHRLZXlcIjogb3B0aW9uYWwga2V5IGZyb20gUGFyc2UgZGFzaGJvYXJkXG4vLyBcInB1c2hcIjogb3B0aW9uYWwga2V5IGZyb20gY29uZmlndXJlIHB1c2hcbi8vIFwic2Vzc2lvbkxlbmd0aFwiOiBvcHRpb25hbCBsZW5ndGggaW4gc2Vjb25kcyBmb3IgaG93IGxvbmcgU2Vzc2lvbnMgc2hvdWxkIGJlIHZhbGlkIGZvclxuLy8gXCJtYXhMaW1pdFwiOiBvcHRpb25hbCB1cHBlciBib3VuZCBmb3Igd2hhdCBjYW4gYmUgc3BlY2lmaWVkIGZvciB0aGUgJ2xpbWl0JyBwYXJhbWV0ZXIgb24gcXVlcmllc1xuXG5jbGFzcyBQYXJzZVNlcnZlciB7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogUGFyc2VTZXJ2ZXJPcHRpb25zKSB7XG4gICAgaW5qZWN0RGVmYXVsdHMob3B0aW9ucyk7XG4gICAgY29uc3Qge1xuICAgICAgYXBwSWQgPSByZXF1aXJlZFBhcmFtZXRlcignWW91IG11c3QgcHJvdmlkZSBhbiBhcHBJZCEnKSxcbiAgICAgIG1hc3RlcktleSA9IHJlcXVpcmVkUGFyYW1ldGVyKCdZb3UgbXVzdCBwcm92aWRlIGEgbWFzdGVyS2V5IScpLFxuICAgICAgY2xvdWQsXG4gICAgICBqYXZhc2NyaXB0S2V5LFxuICAgICAgc2VydmVyVVJMID0gcmVxdWlyZWRQYXJhbWV0ZXIoJ1lvdSBtdXN0IHByb3ZpZGUgYSBzZXJ2ZXJVUkwhJyksXG4gICAgICBfX2luZGV4QnVpbGRDb21wbGV0aW9uQ2FsbGJhY2tGb3JUZXN0cyA9ICgpID0+IHt9LFxuICAgIH0gPSBvcHRpb25zO1xuICAgIC8vIEluaXRpYWxpemUgdGhlIG5vZGUgY2xpZW50IFNESyBhdXRvbWF0aWNhbGx5XG4gICAgUGFyc2UuaW5pdGlhbGl6ZShhcHBJZCwgamF2YXNjcmlwdEtleSB8fCAndW51c2VkJywgbWFzdGVyS2V5KTtcbiAgICBQYXJzZS5zZXJ2ZXJVUkwgPSBzZXJ2ZXJVUkw7XG5cbiAgICBjb25zdCBhbGxDb250cm9sbGVycyA9IGNvbnRyb2xsZXJzLmdldENvbnRyb2xsZXJzKG9wdGlvbnMpO1xuXG4gICAgY29uc3Qge1xuICAgICAgbG9nZ2VyQ29udHJvbGxlcixcbiAgICAgIGRhdGFiYXNlQ29udHJvbGxlcixcbiAgICAgIGhvb2tzQ29udHJvbGxlcixcbiAgICB9ID0gYWxsQ29udHJvbGxlcnM7XG4gICAgdGhpcy5jb25maWcgPSBDb25maWcucHV0KE9iamVjdC5hc3NpZ24oe30sIG9wdGlvbnMsIGFsbENvbnRyb2xsZXJzKSk7XG5cbiAgICBsb2dnaW5nLnNldExvZ2dlcihsb2dnZXJDb250cm9sbGVyKTtcbiAgICBjb25zdCBkYkluaXRQcm9taXNlID0gZGF0YWJhc2VDb250cm9sbGVyLnBlcmZvcm1Jbml0aWFsaXphdGlvbigpO1xuICAgIGhvb2tzQ29udHJvbGxlci5sb2FkKCk7XG5cbiAgICAvLyBOb3RlOiBUZXN0cyB3aWxsIHN0YXJ0IHRvIGZhaWwgaWYgYW55IHZhbGlkYXRpb24gaGFwcGVucyBhZnRlciB0aGlzIGlzIGNhbGxlZC5cbiAgICBpZiAocHJvY2Vzcy5lbnYuVEVTVElORykge1xuICAgICAgX19pbmRleEJ1aWxkQ29tcGxldGlvbkNhbGxiYWNrRm9yVGVzdHMoZGJJbml0UHJvbWlzZSk7XG4gICAgfVxuXG4gICAgaWYgKGNsb3VkKSB7XG4gICAgICBhZGRQYXJzZUNsb3VkKCk7XG4gICAgICBpZiAodHlwZW9mIGNsb3VkID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNsb3VkKFBhcnNlKVxuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgY2xvdWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJlcXVpcmUocGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIGNsb3VkKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBcImFyZ3VtZW50ICdjbG91ZCcgbXVzdCBlaXRoZXIgYmUgYSBzdHJpbmcgb3IgYSBmdW5jdGlvblwiO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGdldCBhcHAoKSB7XG4gICAgaWYgKCF0aGlzLl9hcHApIHtcbiAgICAgIHRoaXMuX2FwcCA9IFBhcnNlU2VydmVyLmFwcCh0aGlzLmNvbmZpZyk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLl9hcHA7XG4gIH1cblxuICBoYW5kbGVTaHV0ZG93bigpIHtcbiAgICBjb25zdCB7IGFkYXB0ZXIgfSA9IHRoaXMuY29uZmlnLmRhdGFiYXNlQ29udHJvbGxlcjtcbiAgICBpZiAoYWRhcHRlciAmJiB0eXBlb2YgYWRhcHRlci5oYW5kbGVTaHV0ZG93biA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgYWRhcHRlci5oYW5kbGVTaHV0ZG93bigpO1xuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyBhcHAoe21heFVwbG9hZFNpemUgPSAnMjBtYicsIGFwcElkfSkge1xuICAgIC8vIFRoaXMgYXBwIHNlcnZlcyB0aGUgUGFyc2UgQVBJIGRpcmVjdGx5LlxuICAgIC8vIEl0J3MgdGhlIGVxdWl2YWxlbnQgb2YgaHR0cHM6Ly9hcGkucGFyc2UuY29tLzEgaW4gdGhlIGhvc3RlZCBQYXJzZSBBUEkuXG4gICAgdmFyIGFwaSA9IGV4cHJlc3MoKTtcbiAgICAvL2FwaS51c2UoXCIvYXBwc1wiLCBleHByZXNzLnN0YXRpYyhfX2Rpcm5hbWUgKyBcIi9wdWJsaWNcIikpO1xuICAgIC8vIEZpbGUgaGFuZGxpbmcgbmVlZHMgdG8gYmUgYmVmb3JlIGRlZmF1bHQgbWlkZGxld2FyZXMgYXJlIGFwcGxpZWRcbiAgICBhcGkudXNlKCcvJywgbWlkZGxld2FyZXMuYWxsb3dDcm9zc0RvbWFpbiwgbmV3IEZpbGVzUm91dGVyKCkuZXhwcmVzc1JvdXRlcih7XG4gICAgICBtYXhVcGxvYWRTaXplOiBtYXhVcGxvYWRTaXplXG4gICAgfSkpO1xuXG4gICAgYXBpLnVzZSgnL2hlYWx0aCcsIChmdW5jdGlvbihyZXEsIHJlcykge1xuICAgICAgcmVzLmpzb24oe1xuICAgICAgICBzdGF0dXM6ICdvaydcbiAgICAgIH0pO1xuICAgIH0pKTtcblxuICAgIGFwaS51c2UoJy8nLCBib2R5UGFyc2VyLnVybGVuY29kZWQoe2V4dGVuZGVkOiBmYWxzZX0pLCBuZXcgUHVibGljQVBJUm91dGVyKCkuZXhwcmVzc1JvdXRlcigpKTtcblxuICAgIGFwaS51c2UoYm9keVBhcnNlci5qc29uKHsgJ3R5cGUnOiAnKi8qJyAsIGxpbWl0OiBtYXhVcGxvYWRTaXplIH0pKTtcbiAgICBhcGkudXNlKG1pZGRsZXdhcmVzLmFsbG93Q3Jvc3NEb21haW4pO1xuICAgIGFwaS51c2UobWlkZGxld2FyZXMuYWxsb3dNZXRob2RPdmVycmlkZSk7XG4gICAgYXBpLnVzZShtaWRkbGV3YXJlcy5oYW5kbGVQYXJzZUhlYWRlcnMpO1xuXG4gICAgY29uc3QgYXBwUm91dGVyID0gUGFyc2VTZXJ2ZXIucHJvbWlzZVJvdXRlcih7IGFwcElkIH0pO1xuICAgIGFwaS51c2UoYXBwUm91dGVyLmV4cHJlc3NSb3V0ZXIoKSk7XG5cbiAgICBhcGkudXNlKG1pZGRsZXdhcmVzLmhhbmRsZVBhcnNlRXJyb3JzKTtcblxuICAgIC8vIHJ1biB0aGUgZm9sbG93aW5nIHdoZW4gbm90IHRlc3RpbmdcbiAgICBpZiAoIXByb2Nlc3MuZW52LlRFU1RJTkcpIHtcbiAgICAgIC8vVGhpcyBjYXVzZXMgdGVzdHMgdG8gc3BldyBzb21lIHVzZWxlc3Mgd2FybmluZ3MsIHNvIGRpc2FibGUgaW4gdGVzdFxuICAgICAgLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbiAgICAgIHByb2Nlc3Mub24oJ3VuY2F1Z2h0RXhjZXB0aW9uJywgKGVycikgPT4ge1xuICAgICAgICBpZiAoZXJyLmNvZGUgPT09IFwiRUFERFJJTlVTRVwiKSB7IC8vIHVzZXItZnJpZW5kbHkgbWVzc2FnZSBmb3IgdGhpcyBjb21tb24gZXJyb3JcbiAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgVW5hYmxlIHRvIGxpc3RlbiBvbiBwb3J0ICR7ZXJyLnBvcnR9LiBUaGUgcG9ydCBpcyBhbHJlYWR5IGluIHVzZS5gKTtcbiAgICAgICAgICBwcm9jZXNzLmV4aXQoMCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIC8vIHZlcmlmeSB0aGUgc2VydmVyIHVybCBhZnRlciBhICdtb3VudCcgZXZlbnQgaXMgcmVjZWl2ZWRcbiAgICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgICBhcGkub24oJ21vdW50JywgZnVuY3Rpb24oKSB7XG4gICAgICAgIFBhcnNlU2VydmVyLnZlcmlmeVNlcnZlclVybCgpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChwcm9jZXNzLmVudi5QQVJTRV9TRVJWRVJfRU5BQkxFX0VYUEVSSU1FTlRBTF9ESVJFQ1RfQUNDRVNTID09PSAnMScpIHtcbiAgICAgIFBhcnNlLkNvcmVNYW5hZ2VyLnNldFJFU1RDb250cm9sbGVyKFBhcnNlU2VydmVyUkVTVENvbnRyb2xsZXIoYXBwSWQsIGFwcFJvdXRlcikpO1xuICAgIH1cbiAgICByZXR1cm4gYXBpO1xuICB9XG5cbiAgc3RhdGljIHByb21pc2VSb3V0ZXIoe2FwcElkfSkge1xuICAgIGNvbnN0IHJvdXRlcnMgPSBbXG4gICAgICBuZXcgQ2xhc3Nlc1JvdXRlcigpLFxuICAgICAgbmV3IFVzZXJzUm91dGVyKCksXG4gICAgICBuZXcgU2Vzc2lvbnNSb3V0ZXIoKSxcbiAgICAgIG5ldyBSb2xlc1JvdXRlcigpLFxuICAgICAgbmV3IEFuYWx5dGljc1JvdXRlcigpLFxuICAgICAgbmV3IEluc3RhbGxhdGlvbnNSb3V0ZXIoKSxcbiAgICAgIG5ldyBGdW5jdGlvbnNSb3V0ZXIoKSxcbiAgICAgIG5ldyBTY2hlbWFzUm91dGVyKCksXG4gICAgICBuZXcgUHVzaFJvdXRlcigpLFxuICAgICAgbmV3IExvZ3NSb3V0ZXIoKSxcbiAgICAgIG5ldyBJQVBWYWxpZGF0aW9uUm91dGVyKCksXG4gICAgICBuZXcgRmVhdHVyZXNSb3V0ZXIoKSxcbiAgICAgIG5ldyBHbG9iYWxDb25maWdSb3V0ZXIoKSxcbiAgICAgIG5ldyBQdXJnZVJvdXRlcigpLFxuICAgICAgbmV3IEhvb2tzUm91dGVyKCksXG4gICAgICBuZXcgQ2xvdWRDb2RlUm91dGVyKCksXG4gICAgICBuZXcgQXVkaWVuY2VzUm91dGVyKCksXG4gICAgICBuZXcgQWdncmVnYXRlUm91dGVyKClcbiAgICBdO1xuXG4gICAgY29uc3Qgcm91dGVzID0gcm91dGVycy5yZWR1Y2UoKG1lbW8sIHJvdXRlcikgPT4ge1xuICAgICAgcmV0dXJuIG1lbW8uY29uY2F0KHJvdXRlci5yb3V0ZXMpO1xuICAgIH0sIFtdKTtcblxuICAgIGNvbnN0IGFwcFJvdXRlciA9IG5ldyBQcm9taXNlUm91dGVyKHJvdXRlcywgYXBwSWQpO1xuXG4gICAgYmF0Y2gubW91bnRPbnRvKGFwcFJvdXRlcik7XG4gICAgcmV0dXJuIGFwcFJvdXRlcjtcbiAgfVxuXG4gIHN0YXJ0KG9wdGlvbnM6IFBhcnNlU2VydmVyT3B0aW9ucywgY2FsbGJhY2s6ID8oKT0+dm9pZCkge1xuICAgIGNvbnN0IGFwcCA9IGV4cHJlc3MoKTtcbiAgICBpZiAob3B0aW9ucy5taWRkbGV3YXJlKSB7XG4gICAgICBsZXQgbWlkZGxld2FyZTtcbiAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy5taWRkbGV3YXJlID09ICdzdHJpbmcnKSB7XG4gICAgICAgIG1pZGRsZXdhcmUgPSByZXF1aXJlKHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCBvcHRpb25zLm1pZGRsZXdhcmUpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1pZGRsZXdhcmUgPSBvcHRpb25zLm1pZGRsZXdhcmU7IC8vIHVzZSBhcy1pcyBsZXQgZXhwcmVzcyBmYWlsXG4gICAgICB9XG4gICAgICBhcHAudXNlKG1pZGRsZXdhcmUpO1xuICAgIH1cblxuICAgIGFwcC51c2Uob3B0aW9ucy5tb3VudFBhdGgsIHRoaXMuYXBwKTtcbiAgICBjb25zdCBzZXJ2ZXIgPSBhcHAubGlzdGVuKG9wdGlvbnMucG9ydCwgb3B0aW9ucy5ob3N0LCBjYWxsYmFjayk7XG4gICAgdGhpcy5zZXJ2ZXIgPSBzZXJ2ZXI7XG5cbiAgICBpZiAob3B0aW9ucy5zdGFydExpdmVRdWVyeVNlcnZlciB8fCBvcHRpb25zLmxpdmVRdWVyeVNlcnZlck9wdGlvbnMpIHtcbiAgICAgIHRoaXMubGl2ZVF1ZXJ5U2VydmVyID0gUGFyc2VTZXJ2ZXIuY3JlYXRlTGl2ZVF1ZXJ5U2VydmVyKHNlcnZlciwgb3B0aW9ucy5saXZlUXVlcnlTZXJ2ZXJPcHRpb25zKTtcbiAgICB9XG4gICAgLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbiAgICBpZiAoIXByb2Nlc3MuZW52LlRFU1RJTkcpIHtcbiAgICAgIGNvbmZpZ3VyZUxpc3RlbmVycyh0aGlzKTtcbiAgICB9XG4gICAgdGhpcy5leHByZXNzQXBwID0gYXBwO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgc3RhdGljIHN0YXJ0KG9wdGlvbnM6IFBhcnNlU2VydmVyT3B0aW9ucywgY2FsbGJhY2s6ID8oKT0+dm9pZCkge1xuICAgIGNvbnN0IHBhcnNlU2VydmVyID0gbmV3IFBhcnNlU2VydmVyKG9wdGlvbnMpO1xuICAgIHJldHVybiBwYXJzZVNlcnZlci5zdGFydChvcHRpb25zLCBjYWxsYmFjayk7XG4gIH1cblxuICBzdGF0aWMgY3JlYXRlTGl2ZVF1ZXJ5U2VydmVyKGh0dHBTZXJ2ZXIsIGNvbmZpZzogTGl2ZVF1ZXJ5U2VydmVyT3B0aW9ucykge1xuICAgIGlmICghaHR0cFNlcnZlciB8fCAoY29uZmlnICYmIGNvbmZpZy5wb3J0KSkge1xuICAgICAgdmFyIGFwcCA9IGV4cHJlc3MoKTtcbiAgICAgIGh0dHBTZXJ2ZXIgPSByZXF1aXJlKCdodHRwJykuY3JlYXRlU2VydmVyKGFwcCk7XG4gICAgICBodHRwU2VydmVyLmxpc3Rlbihjb25maWcucG9ydCk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgUGFyc2VMaXZlUXVlcnlTZXJ2ZXIoaHR0cFNlcnZlciwgY29uZmlnKTtcbiAgfVxuXG4gIHN0YXRpYyB2ZXJpZnlTZXJ2ZXJVcmwoY2FsbGJhY2spIHtcbiAgICAvLyBwZXJmb3JtIGEgaGVhbHRoIGNoZWNrIG9uIHRoZSBzZXJ2ZXJVUkwgdmFsdWVcbiAgICBpZihQYXJzZS5zZXJ2ZXJVUkwpIHtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSByZXF1aXJlKCdyZXF1ZXN0Jyk7XG4gICAgICByZXF1ZXN0KFBhcnNlLnNlcnZlclVSTC5yZXBsYWNlKC9cXC8kLywgXCJcIikgKyBcIi9oZWFsdGhcIiwgZnVuY3Rpb24gKGVycm9yLCByZXNwb25zZSwgYm9keSkge1xuICAgICAgICBsZXQganNvbjtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBqc29uID0gSlNPTi5wYXJzZShib2R5KTtcbiAgICAgICAgfSBjYXRjaChlKSB7XG4gICAgICAgICAganNvbiA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIHx8IHJlc3BvbnNlLnN0YXR1c0NvZGUgIT09IDIwMCB8fCAhanNvbiB8fCBqc29uICYmIGpzb24uc3RhdHVzICE9PSAnb2snKSB7XG4gICAgICAgICAgLyogZXNsaW50LWRpc2FibGUgbm8tY29uc29sZSAqL1xuICAgICAgICAgIGNvbnNvbGUud2FybihgXFxuV0FSTklORywgVW5hYmxlIHRvIGNvbm5lY3QgdG8gJyR7UGFyc2Uuc2VydmVyVVJMfScuYCArXG4gICAgICAgICAgICBgIENsb3VkIGNvZGUgYW5kIHB1c2ggbm90aWZpY2F0aW9ucyBtYXkgYmUgdW5hdmFpbGFibGUhXFxuYCk7XG4gICAgICAgICAgLyogZXNsaW50LWVuYWJsZSBuby1jb25zb2xlICovXG4gICAgICAgICAgaWYoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKGZhbHNlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKHRydWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGFkZFBhcnNlQ2xvdWQoKSB7XG4gIGNvbnN0IFBhcnNlQ2xvdWQgPSByZXF1aXJlKFwiLi9jbG91ZC1jb2RlL1BhcnNlLkNsb3VkXCIpO1xuICBPYmplY3QuYXNzaWduKFBhcnNlLkNsb3VkLCBQYXJzZUNsb3VkKTtcbiAgZ2xvYmFsLlBhcnNlID0gUGFyc2U7XG59XG5cbmZ1bmN0aW9uIGluamVjdERlZmF1bHRzKG9wdGlvbnM6IFBhcnNlU2VydmVyT3B0aW9ucykge1xuICBPYmplY3Qua2V5cyhkZWZhdWx0cykuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgaWYgKCFvcHRpb25zLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgIG9wdGlvbnNba2V5XSA9IGRlZmF1bHRzW2tleV07XG4gICAgfVxuICB9KTtcblxuICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ3NlcnZlclVSTCcpKSB7XG4gICAgb3B0aW9ucy5zZXJ2ZXJVUkwgPSBgaHR0cDovL2xvY2FsaG9zdDoke29wdGlvbnMucG9ydH0ke29wdGlvbnMubW91bnRQYXRofWA7XG4gIH1cblxuICBvcHRpb25zLnVzZXJTZW5zaXRpdmVGaWVsZHMgPSBBcnJheS5mcm9tKG5ldyBTZXQob3B0aW9ucy51c2VyU2Vuc2l0aXZlRmllbGRzLmNvbmNhdChcbiAgICBkZWZhdWx0cy51c2VyU2Vuc2l0aXZlRmllbGRzLFxuICAgIG9wdGlvbnMudXNlclNlbnNpdGl2ZUZpZWxkc1xuICApKSk7XG5cbiAgb3B0aW9ucy5tYXN0ZXJLZXlJcHMgPSBBcnJheS5mcm9tKG5ldyBTZXQob3B0aW9ucy5tYXN0ZXJLZXlJcHMuY29uY2F0KFxuICAgIGRlZmF1bHRzLm1hc3RlcktleUlwcyxcbiAgICBvcHRpb25zLm1hc3RlcktleUlwc1xuICApKSk7XG59XG5cbi8vIFRob3NlIGNhbid0IGJlIHRlc3RlZCBhcyBpdCByZXF1aXJlcyBhIHN1YnByb2Nlc3Ncbi8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG5mdW5jdGlvbiBjb25maWd1cmVMaXN0ZW5lcnMocGFyc2VTZXJ2ZXIpIHtcbiAgY29uc3Qgc2VydmVyID0gcGFyc2VTZXJ2ZXIuc2VydmVyO1xuICBjb25zdCBzb2NrZXRzID0ge307XG4gIC8qIEN1cnJlbnRseSwgZXhwcmVzcyBkb2Vzbid0IHNodXQgZG93biBpbW1lZGlhdGVseSBhZnRlciByZWNlaXZpbmcgU0lHSU5UL1NJR1RFUk0gaWYgaXQgaGFzIGNsaWVudCBjb25uZWN0aW9ucyB0aGF0IGhhdmVuJ3QgdGltZWQgb3V0LiAoVGhpcyBpcyBhIGtub3duIGlzc3VlIHdpdGggbm9kZSAtIGh0dHBzOi8vZ2l0aHViLmNvbS9ub2RlanMvbm9kZS9pc3N1ZXMvMjY0MilcbiAgICBUaGlzIGZ1bmN0aW9uLCBhbG9uZyB3aXRoIGBkZXN0cm95QWxpdmVDb25uZWN0aW9ucygpYCwgaW50ZW5kIHRvIGZpeCB0aGlzIGJlaGF2aW9yIHN1Y2ggdGhhdCBwYXJzZSBzZXJ2ZXIgd2lsbCBjbG9zZSBhbGwgb3BlbiBjb25uZWN0aW9ucyBhbmQgaW5pdGlhdGUgdGhlIHNodXRkb3duIHByb2Nlc3MgYXMgc29vbiBhcyBpdCByZWNlaXZlcyBhIFNJR0lOVC9TSUdURVJNIHNpZ25hbC4gKi9cbiAgc2VydmVyLm9uKCdjb25uZWN0aW9uJywgKHNvY2tldCkgPT4ge1xuICAgIGNvbnN0IHNvY2tldElkID0gc29ja2V0LnJlbW90ZUFkZHJlc3MgKyAnOicgKyBzb2NrZXQucmVtb3RlUG9ydDtcbiAgICBzb2NrZXRzW3NvY2tldElkXSA9IHNvY2tldDtcbiAgICBzb2NrZXQub24oJ2Nsb3NlJywgKCkgPT4ge1xuICAgICAgZGVsZXRlIHNvY2tldHNbc29ja2V0SWRdO1xuICAgIH0pO1xuICB9KTtcblxuICBjb25zdCBkZXN0cm95QWxpdmVDb25uZWN0aW9ucyA9IGZ1bmN0aW9uKCkge1xuICAgIGZvciAoY29uc3Qgc29ja2V0SWQgaW4gc29ja2V0cykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgc29ja2V0c1tzb2NrZXRJZF0uZGVzdHJveSgpO1xuICAgICAgfSBjYXRjaCAoZSkgeyAvKiAqLyB9XG4gICAgfVxuICB9XG5cbiAgY29uc3QgaGFuZGxlU2h1dGRvd24gPSBmdW5jdGlvbigpIHtcbiAgICBwcm9jZXNzLnN0ZG91dC53cml0ZSgnVGVybWluYXRpb24gc2lnbmFsIHJlY2VpdmVkLiBTaHV0dGluZyBkb3duLicpO1xuICAgIGRlc3Ryb3lBbGl2ZUNvbm5lY3Rpb25zKCk7XG4gICAgc2VydmVyLmNsb3NlKCk7XG4gICAgcGFyc2VTZXJ2ZXIuaGFuZGxlU2h1dGRvd24oKTtcbiAgfTtcbiAgcHJvY2Vzcy5vbignU0lHVEVSTScsIGhhbmRsZVNodXRkb3duKTtcbiAgcHJvY2Vzcy5vbignU0lHSU5UJywgaGFuZGxlU2h1dGRvd24pO1xufVxuXG5leHBvcnQgZGVmYXVsdCBQYXJzZVNlcnZlcjtcbiJdfQ==