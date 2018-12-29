'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _RestQuery = require('./RestQuery');

var _RestQuery2 = _interopRequireDefault(_RestQuery);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _logger = require('./logger');

var _logger2 = _interopRequireDefault(_logger);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// A RestWrite encapsulates everything we need to run an operation
// that writes to the database.
// This could be either a "create" or an "update".

var SchemaController = require('./Controllers/SchemaController');
var deepcopy = require('deepcopy');

const Auth = require('./Auth');
var cryptoUtils = require('./cryptoUtils');
var passwordCrypto = require('./password');
var Parse = require('parse/node');
var triggers = require('./triggers');
var ClientSDK = require('./ClientSDK');


// query and data are both provided in REST API format. So data
// types are encoded by plain old objects.
// If query is null, this is a "create" and the data in data should be
// created.
// Otherwise this is an "update" - the object matching the query
// should get updated with data.
// RestWrite will handle objectId, createdAt, and updatedAt for
// everything. It also knows to use triggers and special modifications
// for the _User class.
function RestWrite(config, auth, className, query, data, originalData, clientSDK) {
  if (auth.isReadOnly) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Cannot perform a write operation when using readOnlyMasterKey');
  }
  this.config = config;
  this.auth = auth;
  this.className = className;
  this.clientSDK = clientSDK;
  this.storage = {};
  this.runOptions = {};
  if (!query && data.objectId) {
    throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'objectId is an invalid field name.');
  }

  // When the operation is complete, this.response may have several
  // fields.
  // response: the actual data to be returned
  // status: the http status code. if not present, treated like a 200
  // location: the location header. if not present, no location header
  this.response = null;

  // Processing this operation may mutate our data, so we operate on a
  // copy
  this.query = deepcopy(query);
  this.data = deepcopy(data);
  // We never change originalData, so we do not need a deep copy
  this.originalData = originalData;

  // The timestamp we'll use for this whole operation
  this.updatedAt = Parse._encode(new Date()).iso;
}

// A convenient method to perform all the steps of processing the
// write, in order.
// Returns a promise for a {response, status, location} object.
// status and location are optional.
RestWrite.prototype.execute = function () {
  return Promise.resolve().then(() => {
    return this.getUserAndRoleACL();
  }).then(() => {
    return this.validateClientClassCreation();
  }).then(() => {
    return this.handleInstallation();
  }).then(() => {
    return this.handleSession();
  }).then(() => {
    return this.validateAuthData();
  }).then(() => {
    return this.runBeforeTrigger();
  }).then(() => {
    return this.validateSchema();
  }).then(() => {
    return this.setRequiredFieldsIfNeeded();
  }).then(() => {
    return this.transformUser();
  }).then(() => {
    return this.expandFilesForExistingObjects();
  }).then(() => {
    return this.destroyDuplicatedSessions();
  }).then(() => {
    return this.runDatabaseOperation();
  }).then(() => {
    return this.createSessionTokenIfNeeded();
  }).then(() => {
    return this.handleFollowup();
  }).then(() => {
    return this.runAfterTrigger();
  }).then(() => {
    return this.cleanUserAuthData();
  }).then(() => {
    return this.response;
  });
};

// Uses the Auth object to get the list of roles, adds the user id
RestWrite.prototype.getUserAndRoleACL = function () {
  if (this.auth.isMaster) {
    return Promise.resolve();
  }

  this.runOptions.acl = ['*'];

  if (this.auth.user) {
    return this.auth.getUserRoles().then(roles => {
      this.runOptions.acl = this.runOptions.acl.concat(roles, [this.auth.user.id]);
      return;
    });
  } else {
    return Promise.resolve();
  }
};

// Validates this operation against the allowClientClassCreation config.
RestWrite.prototype.validateClientClassCreation = function () {
  if (this.config.allowClientClassCreation === false && !this.auth.isMaster && SchemaController.systemClasses.indexOf(this.className) === -1) {
    return this.config.database.loadSchema().then(schemaController => schemaController.hasClass(this.className)).then(hasClass => {
      if (hasClass !== true) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This user is not allowed to access ' + 'non-existent class: ' + this.className);
      }
    });
  } else {
    return Promise.resolve();
  }
};

// Validates this operation against the schema.
RestWrite.prototype.validateSchema = function () {
  return this.config.database.validateObject(this.className, this.data, this.query, this.runOptions);
};

// Runs any beforeSave triggers against this operation.
// Any change leads to our data being mutated.
RestWrite.prototype.runBeforeTrigger = function () {
  if (this.response) {
    return;
  }

  // Avoid doing any setup for triggers if there is no 'beforeSave' trigger for this class.
  if (!triggers.triggerExists(this.className, triggers.Types.beforeSave, this.config.applicationId)) {
    return Promise.resolve();
  }

  // Cloud code gets a bit of extra data for its objects
  var extraData = { className: this.className };
  if (this.query && this.query.objectId) {
    extraData.objectId = this.query.objectId;
  }

  let originalObject = null;
  const updatedObject = this.buildUpdatedObject(extraData);
  if (this.query && this.query.objectId) {
    // This is an update for existing object.
    originalObject = triggers.inflate(extraData, this.originalData);
  }

  return Promise.resolve().then(() => {
    return triggers.maybeRunTrigger(triggers.Types.beforeSave, this.auth, updatedObject, originalObject, this.config);
  }).then(response => {
    if (response && response.object) {
      this.storage.fieldsChangedByTrigger = _lodash2.default.reduce(response.object, (result, value, key) => {
        if (!_lodash2.default.isEqual(this.data[key], value)) {
          result.push(key);
        }
        return result;
      }, []);
      this.data = response.object;
      // We should delete the objectId for an update write
      if (this.query && this.query.objectId) {
        delete this.data.objectId;
      }
    }
  });
};

RestWrite.prototype.setRequiredFieldsIfNeeded = function () {
  if (this.data) {
    // Add default fields
    this.data.updatedAt = this.updatedAt;
    if (!this.query) {
      this.data.createdAt = this.updatedAt;

      // Only assign new objectId if we are creating new object
      if (!this.data.objectId) {
        this.data.objectId = cryptoUtils.newObjectId(this.config.objectIdSize);
      }
    }
  }
  return Promise.resolve();
};

// Transforms auth data for a user object.
// Does nothing if this isn't a user object.
// Returns a promise for when we're done if it can't finish this tick.
RestWrite.prototype.validateAuthData = function () {
  if (this.className !== '_User') {
    return;
  }

  if (!this.query && !this.data.authData) {
    if (typeof this.data.username !== 'string' || _lodash2.default.isEmpty(this.data.username)) {
      throw new Parse.Error(Parse.Error.USERNAME_MISSING, 'bad or missing username');
    }
    if (typeof this.data.password !== 'string' || _lodash2.default.isEmpty(this.data.password)) {
      throw new Parse.Error(Parse.Error.PASSWORD_MISSING, 'password is required');
    }
  }

  if (!this.data.authData || !Object.keys(this.data.authData).length) {
    return;
  }

  var authData = this.data.authData;
  var providers = Object.keys(authData);
  if (providers.length > 0) {
    const canHandleAuthData = providers.reduce((canHandle, provider) => {
      var providerAuthData = authData[provider];
      var hasToken = providerAuthData && providerAuthData.id;
      return canHandle && (hasToken || providerAuthData == null);
    }, true);
    if (canHandleAuthData) {
      return this.handleAuthData(authData);
    }
  }
  throw new Parse.Error(Parse.Error.UNSUPPORTED_SERVICE, 'This authentication method is unsupported.');
};

RestWrite.prototype.handleAuthDataValidation = function (authData) {
  const validations = Object.keys(authData).map(provider => {
    if (authData[provider] === null) {
      return Promise.resolve();
    }
    const validateAuthData = this.config.authDataManager.getValidatorForProvider(provider);
    if (!validateAuthData) {
      throw new Parse.Error(Parse.Error.UNSUPPORTED_SERVICE, 'This authentication method is unsupported.');
    }
    return validateAuthData(authData[provider]);
  });
  return Promise.all(validations);
};

RestWrite.prototype.findUsersWithAuthData = function (authData) {
  const providers = Object.keys(authData);
  const query = providers.reduce((memo, provider) => {
    if (!authData[provider]) {
      return memo;
    }
    const queryKey = `authData.${provider}.id`;
    const query = {};
    query[queryKey] = authData[provider].id;
    memo.push(query);
    return memo;
  }, []).filter(q => {
    return typeof q !== 'undefined';
  });

  let findPromise = Promise.resolve([]);
  if (query.length > 0) {
    findPromise = this.config.database.find(this.className, { '$or': query }, {});
  }

  return findPromise;
};

RestWrite.prototype.filteredObjectsByACL = function (objects) {
  if (this.auth.isMaster) {
    return objects;
  }
  return objects.filter(object => {
    if (!object.ACL) {
      return true; // legacy users that have no ACL field on them
    }
    // Regular users that have been locked out.
    return object.ACL && Object.keys(object.ACL).length > 0;
  });
};

RestWrite.prototype.handleAuthData = function (authData) {
  let results;
  return this.findUsersWithAuthData(authData).then(r => {
    results = this.filteredObjectsByACL(r);
    if (results.length > 1) {
      // More than 1 user with the passed id's
      throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
    }

    this.storage['authProvider'] = Object.keys(authData).join(',');

    if (results.length > 0) {
      const userResult = results[0];
      const mutatedAuthData = {};
      Object.keys(authData).forEach(provider => {
        const providerData = authData[provider];
        const userAuthData = userResult.authData[provider];
        if (!_lodash2.default.isEqual(providerData, userAuthData)) {
          mutatedAuthData[provider] = providerData;
        }
      });
      const hasMutatedAuthData = Object.keys(mutatedAuthData).length !== 0;
      let userId;
      if (this.query && this.query.objectId) {
        userId = this.query.objectId;
      } else if (this.auth && this.auth.user && this.auth.user.id) {
        userId = this.auth.user.id;
      }
      if (!userId || userId === userResult.objectId) {
        // no user making the call
        // OR the user making the call is the right one
        // Login with auth data
        delete results[0].password;

        // need to set the objectId first otherwise location has trailing undefined
        this.data.objectId = userResult.objectId;

        if (!this.query || !this.query.objectId) {
          // this a login call, no userId passed
          this.response = {
            response: userResult,
            location: this.location()
          };
        }
        // If we didn't change the auth data, just keep going
        if (!hasMutatedAuthData) {
          return;
        }
        // We have authData that is updated on login
        // that can happen when token are refreshed,
        // We should update the token and let the user in
        // We should only check the mutated keys
        return this.handleAuthDataValidation(mutatedAuthData).then(() => {
          // IF we have a response, we'll skip the database operation / beforeSave / afterSave etc...
          // we need to set it up there.
          // We are supposed to have a response only on LOGIN with authData, so we skip those
          // If we're not logging in, but just updating the current user, we can safely skip that part
          if (this.response) {
            // Assign the new authData in the response
            Object.keys(mutatedAuthData).forEach(provider => {
              this.response.response.authData[provider] = mutatedAuthData[provider];
            });
            // Run the DB update directly, as 'master'
            // Just update the authData part
            // Then we're good for the user, early exit of sorts
            return this.config.database.update(this.className, { objectId: this.data.objectId }, { authData: mutatedAuthData }, {});
          }
        });
      } else if (userId) {
        // Trying to update auth data but users
        // are different
        if (userResult.objectId !== userId) {
          throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
        }
        // No auth data was mutated, just keep going
        if (!hasMutatedAuthData) {
          return;
        }
      }
    }
    return this.handleAuthDataValidation(authData);
  });
};

// The non-third-party parts of User transformation
RestWrite.prototype.transformUser = function () {
  var promise = Promise.resolve();

  if (this.className !== '_User') {
    return promise;
  }

  if (!this.auth.isMaster && "emailVerified" in this.data) {
    const error = `Clients aren't allowed to manually update email verification.`;
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, error);
  }

  // Do not cleanup session if objectId is not set
  if (this.query && this.objectId()) {
    // If we're updating a _User object, we need to clear out the cache for that user. Find all their
    // session tokens, and remove them from the cache.
    promise = new _RestQuery2.default(this.config, Auth.master(this.config), '_Session', {
      user: {
        __type: "Pointer",
        className: "_User",
        objectId: this.objectId()
      }
    }).execute().then(results => {
      results.results.forEach(session => this.config.cacheController.user.del(session.sessionToken));
    });
  }

  return promise.then(() => {
    // Transform the password
    if (this.data.password === undefined) {
      // ignore only if undefined. should proceed if empty ('')
      return Promise.resolve();
    }

    if (this.query) {
      this.storage['clearSessions'] = true;
      // Generate a new session only if the user requested
      if (!this.auth.isMaster) {
        this.storage['generateNewSession'] = true;
      }
    }

    return this._validatePasswordPolicy().then(() => {
      return passwordCrypto.hash(this.data.password).then(hashedPassword => {
        this.data._hashed_password = hashedPassword;
        delete this.data.password;
      });
    });
  }).then(() => {
    return this._validateUserName();
  }).then(() => {
    return this._validateEmail();
  });
};

RestWrite.prototype._validateUserName = function () {
  // Check for username uniqueness
  if (!this.data.username) {
    if (!this.query) {
      this.data.username = cryptoUtils.randomString(25);
      this.responseShouldHaveUsername = true;
    }
    return Promise.resolve();
  }
  // We need to a find to check for duplicate username in case they are missing the unique index on usernames
  // TODO: Check if there is a unique index, and if so, skip this query.
  return this.config.database.find(this.className, { username: this.data.username, objectId: { '$ne': this.objectId() } }, { limit: 1 }).then(results => {
    if (results.length > 0) {
      throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
    }
    return;
  });
};

RestWrite.prototype._validateEmail = function () {
  if (!this.data.email || this.data.email.__op === 'Delete') {
    return Promise.resolve();
  }
  // Validate basic email address format
  if (!this.data.email.match(/^.+@.+$/)) {
    return Promise.reject(new Parse.Error(Parse.Error.INVALID_EMAIL_ADDRESS, 'Email address format is invalid.'));
  }
  // Same problem for email as above for username
  return this.config.database.find(this.className, { email: this.data.email, objectId: { '$ne': this.objectId() } }, { limit: 1 }).then(results => {
    if (results.length > 0) {
      throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
    }
    if (!this.data.authData || !Object.keys(this.data.authData).length || Object.keys(this.data.authData).length === 1 && Object.keys(this.data.authData)[0] === 'anonymous') {
      // We updated the email, send a new validation
      this.storage['sendVerificationEmail'] = true;
      this.config.userController.setEmailVerifyToken(this.data);
    }
  });
};

RestWrite.prototype._validatePasswordPolicy = function () {
  if (!this.config.passwordPolicy) return Promise.resolve();
  return this._validatePasswordRequirements().then(() => {
    return this._validatePasswordHistory();
  });
};

RestWrite.prototype._validatePasswordRequirements = function () {
  // check if the password conforms to the defined password policy if configured
  const policyError = 'Password does not meet the Password Policy requirements.';

  // check whether the password meets the password strength requirements
  if (this.config.passwordPolicy.patternValidator && !this.config.passwordPolicy.patternValidator(this.data.password) || this.config.passwordPolicy.validatorCallback && !this.config.passwordPolicy.validatorCallback(this.data.password)) {
    return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, policyError));
  }

  // check whether password contain username
  if (this.config.passwordPolicy.doNotAllowUsername === true) {
    if (this.data.username) {
      // username is not passed during password reset
      if (this.data.password.indexOf(this.data.username) >= 0) return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, policyError));
    } else {
      // retrieve the User object using objectId during password reset
      return this.config.database.find('_User', { objectId: this.objectId() }).then(results => {
        if (results.length != 1) {
          throw undefined;
        }
        if (this.data.password.indexOf(results[0].username) >= 0) return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, policyError));
        return Promise.resolve();
      });
    }
  }
  return Promise.resolve();
};

RestWrite.prototype._validatePasswordHistory = function () {
  // check whether password is repeating from specified history
  if (this.query && this.config.passwordPolicy.maxPasswordHistory) {
    return this.config.database.find('_User', { objectId: this.objectId() }, { keys: ["_password_history", "_hashed_password"] }).then(results => {
      if (results.length != 1) {
        throw undefined;
      }
      const user = results[0];
      let oldPasswords = [];
      if (user._password_history) oldPasswords = _lodash2.default.take(user._password_history, this.config.passwordPolicy.maxPasswordHistory - 1);
      oldPasswords.push(user.password);
      const newPassword = this.data.password;
      // compare the new password hash with all old password hashes
      const promises = oldPasswords.map(function (hash) {
        return passwordCrypto.compare(newPassword, hash).then(result => {
          if (result) // reject if there is a match
            return Promise.reject("REPEAT_PASSWORD");
          return Promise.resolve();
        });
      });
      // wait for all comparisons to complete
      return Promise.all(promises).then(() => {
        return Promise.resolve();
      }).catch(err => {
        if (err === "REPEAT_PASSWORD") // a match was found
          return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, `New password should not be the same as last ${this.config.passwordPolicy.maxPasswordHistory} passwords.`));
        throw err;
      });
    });
  }
  return Promise.resolve();
};

RestWrite.prototype.createSessionTokenIfNeeded = function () {
  if (this.className !== '_User') {
    return;
  }
  if (this.query) {
    return;
  }
  if (!this.storage['authProvider'] // signup call, with
  && this.config.preventLoginWithUnverifiedEmail // no login without verification
  && this.config.verifyUserEmails) {
    // verification is on
    return; // do not create the session token in that case!
  }
  return this.createSessionToken();
};

RestWrite.prototype.createSessionToken = function () {
  // cloud installationId from Cloud Code,
  // never create session tokens from there.
  if (this.auth.installationId && this.auth.installationId === 'cloud') {
    return;
  }

  const {
    sessionData,
    createSession
  } = Auth.createSession(this.config, {
    userId: this.objectId(),
    createdWith: {
      'action': this.storage['authProvider'] ? 'login' : 'signup',
      'authProvider': this.storage['authProvider'] || 'password'
    },
    installationId: this.auth.installationId
  });

  if (this.response && this.response.response) {
    this.response.response.sessionToken = sessionData.sessionToken;
  }

  return createSession();
};

RestWrite.prototype.destroyDuplicatedSessions = function () {
  // Only for _Session, and at creation time
  if (this.className != '_Session' || this.query) {
    return;
  }
  // Destroy the sessions in 'Background'
  const {
    user,
    installationId,
    sessionToken
  } = this.data;
  if (!user || !installationId) {
    return;
  }
  if (!user.objectId) {
    return;
  }
  this.config.database.destroy('_Session', {
    user,
    installationId,
    sessionToken: { '$ne': sessionToken }
  });
};

// Handles any followup logic
RestWrite.prototype.handleFollowup = function () {
  if (this.storage && this.storage['clearSessions'] && this.config.revokeSessionOnPasswordReset) {
    var sessionQuery = {
      user: {
        __type: 'Pointer',
        className: '_User',
        objectId: this.objectId()
      }
    };
    delete this.storage['clearSessions'];
    return this.config.database.destroy('_Session', sessionQuery).then(this.handleFollowup.bind(this));
  }

  if (this.storage && this.storage['generateNewSession']) {
    delete this.storage['generateNewSession'];
    return this.createSessionToken().then(this.handleFollowup.bind(this));
  }

  if (this.storage && this.storage['sendVerificationEmail']) {
    delete this.storage['sendVerificationEmail'];
    // Fire and forget!
    this.config.userController.sendVerificationEmail(this.data);
    return this.handleFollowup.bind(this);
  }
};

// Handles the _Session class specialness.
// Does nothing if this isn't an _Session object.
RestWrite.prototype.handleSession = function () {
  if (this.response || this.className !== '_Session') {
    return;
  }

  if (!this.auth.user && !this.auth.isMaster) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Session token required.');
  }

  // TODO: Verify proper error to throw
  if (this.data.ACL) {
    throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'Cannot set ' + 'ACL on a Session.');
  }

  if (this.query) {
    if (this.data.user && !this.auth.isMaster && this.data.user.objectId != this.auth.user.id) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME);
    } else if (this.data.installationId) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME);
    } else if (this.data.sessionToken) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME);
    }
  }

  if (!this.query && !this.auth.isMaster) {
    const additionalSessionData = {};
    for (var key in this.data) {
      if (key === 'objectId' || key === 'user') {
        continue;
      }
      additionalSessionData[key] = this.data[key];
    }

    const { sessionData, createSession } = Auth.createSession(this.config, {
      userId: this.auth.user.id,
      createdWith: {
        action: 'create'
      },
      additionalSessionData
    });

    return createSession().then(results => {
      if (!results.response) {
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Error creating session.');
      }
      sessionData['objectId'] = results.response['objectId'];
      this.response = {
        status: 201,
        location: results.location,
        response: sessionData
      };
    });
  }
};

// Handles the _Installation class specialness.
// Does nothing if this isn't an installation object.
// If an installation is found, this can mutate this.query and turn a create
// into an update.
// Returns a promise for when we're done if it can't finish this tick.
RestWrite.prototype.handleInstallation = function () {
  if (this.response || this.className !== '_Installation') {
    return;
  }

  if (!this.query && !this.data.deviceToken && !this.data.installationId && !this.auth.installationId) {
    throw new Parse.Error(135, 'at least one ID field (deviceToken, installationId) ' + 'must be specified in this operation');
  }

  // If the device token is 64 characters long, we assume it is for iOS
  // and lowercase it.
  if (this.data.deviceToken && this.data.deviceToken.length == 64) {
    this.data.deviceToken = this.data.deviceToken.toLowerCase();
  }

  // We lowercase the installationId if present
  if (this.data.installationId) {
    this.data.installationId = this.data.installationId.toLowerCase();
  }

  let installationId = this.data.installationId;

  // If data.installationId is not set and we're not master, we can lookup in auth
  if (!installationId && !this.auth.isMaster) {
    installationId = this.auth.installationId;
  }

  if (installationId) {
    installationId = installationId.toLowerCase();
  }

  // Updating _Installation but not updating anything critical
  if (this.query && !this.data.deviceToken && !installationId && !this.data.deviceType) {
    return;
  }

  var promise = Promise.resolve();

  var idMatch; // Will be a match on either objectId or installationId
  var objectIdMatch;
  var installationIdMatch;
  var deviceTokenMatches = [];

  // Instead of issuing 3 reads, let's do it with one OR.
  const orQueries = [];
  if (this.query && this.query.objectId) {
    orQueries.push({
      objectId: this.query.objectId
    });
  }
  if (installationId) {
    orQueries.push({
      'installationId': installationId
    });
  }
  if (this.data.deviceToken) {
    orQueries.push({ 'deviceToken': this.data.deviceToken });
  }

  if (orQueries.length == 0) {
    return;
  }

  promise = promise.then(() => {
    return this.config.database.find('_Installation', {
      '$or': orQueries
    }, {});
  }).then(results => {
    results.forEach(result => {
      if (this.query && this.query.objectId && result.objectId == this.query.objectId) {
        objectIdMatch = result;
      }
      if (result.installationId == installationId) {
        installationIdMatch = result;
      }
      if (result.deviceToken == this.data.deviceToken) {
        deviceTokenMatches.push(result);
      }
    });

    // Sanity checks when running a query
    if (this.query && this.query.objectId) {
      if (!objectIdMatch) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found for update.');
      }
      if (this.data.installationId && objectIdMatch.installationId && this.data.installationId !== objectIdMatch.installationId) {
        throw new Parse.Error(136, 'installationId may not be changed in this ' + 'operation');
      }
      if (this.data.deviceToken && objectIdMatch.deviceToken && this.data.deviceToken !== objectIdMatch.deviceToken && !this.data.installationId && !objectIdMatch.installationId) {
        throw new Parse.Error(136, 'deviceToken may not be changed in this ' + 'operation');
      }
      if (this.data.deviceType && this.data.deviceType && this.data.deviceType !== objectIdMatch.deviceType) {
        throw new Parse.Error(136, 'deviceType may not be changed in this ' + 'operation');
      }
    }

    if (this.query && this.query.objectId && objectIdMatch) {
      idMatch = objectIdMatch;
    }

    if (installationId && installationIdMatch) {
      idMatch = installationIdMatch;
    }
    // need to specify deviceType only if it's new
    if (!this.query && !this.data.deviceType && !idMatch) {
      throw new Parse.Error(135, 'deviceType must be specified in this operation');
    }
  }).then(() => {
    if (!idMatch) {
      if (!deviceTokenMatches.length) {
        return;
      } else if (deviceTokenMatches.length == 1 && (!deviceTokenMatches[0]['installationId'] || !installationId)) {
        // Single match on device token but none on installationId, and either
        // the passed object or the match is missing an installationId, so we
        // can just return the match.
        return deviceTokenMatches[0]['objectId'];
      } else if (!this.data.installationId) {
        throw new Parse.Error(132, 'Must specify installationId when deviceToken ' + 'matches multiple Installation objects');
      } else {
        // Multiple device token matches and we specified an installation ID,
        // or a single match where both the passed and matching objects have
        // an installation ID. Try cleaning out old installations that match
        // the deviceToken, and return nil to signal that a new object should
        // be created.
        var delQuery = {
          'deviceToken': this.data.deviceToken,
          'installationId': {
            '$ne': installationId
          }
        };
        if (this.data.appIdentifier) {
          delQuery['appIdentifier'] = this.data.appIdentifier;
        }
        this.config.database.destroy('_Installation', delQuery).catch(err => {
          if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
            // no deletions were made. Can be ignored.
            return;
          }
          // rethrow the error
          throw err;
        });
        return;
      }
    } else {
      if (deviceTokenMatches.length == 1 && !deviceTokenMatches[0]['installationId']) {
        // Exactly one device token match and it doesn't have an installation
        // ID. This is the one case where we want to merge with the existing
        // object.
        const delQuery = { objectId: idMatch.objectId };
        return this.config.database.destroy('_Installation', delQuery).then(() => {
          return deviceTokenMatches[0]['objectId'];
        }).catch(err => {
          if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
            // no deletions were made. Can be ignored
            return;
          }
          // rethrow the error
          throw err;
        });
      } else {
        if (this.data.deviceToken && idMatch.deviceToken != this.data.deviceToken) {
          // We're setting the device token on an existing installation, so
          // we should try cleaning out old installations that match this
          // device token.
          const delQuery = {
            'deviceToken': this.data.deviceToken
          };
          // We have a unique install Id, use that to preserve
          // the interesting installation
          if (this.data.installationId) {
            delQuery['installationId'] = {
              '$ne': this.data.installationId
            };
          } else if (idMatch.objectId && this.data.objectId && idMatch.objectId == this.data.objectId) {
            // we passed an objectId, preserve that instalation
            delQuery['objectId'] = {
              '$ne': idMatch.objectId
            };
          } else {
            // What to do here? can't really clean up everything...
            return idMatch.objectId;
          }
          if (this.data.appIdentifier) {
            delQuery['appIdentifier'] = this.data.appIdentifier;
          }
          this.config.database.destroy('_Installation', delQuery).catch(err => {
            if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
              // no deletions were made. Can be ignored.
              return;
            }
            // rethrow the error
            throw err;
          });
        }
        // In non-merge scenarios, just return the installation match id
        return idMatch.objectId;
      }
    }
  }).then(objId => {
    if (objId) {
      this.query = { objectId: objId };
      delete this.data.objectId;
      delete this.data.createdAt;
    }
    // TODO: Validate ops (add/remove on channels, $inc on badge, etc.)
  });
  return promise;
};

// If we short-circuted the object response - then we need to make sure we expand all the files,
// since this might not have a query, meaning it won't return the full result back.
// TODO: (nlutsenko) This should die when we move to per-class based controllers on _Session/_User
RestWrite.prototype.expandFilesForExistingObjects = function () {
  // Check whether we have a short-circuited response - only then run expansion.
  if (this.response && this.response.response) {
    this.config.filesController.expandFilesInObject(this.config, this.response.response);
  }
};

RestWrite.prototype.runDatabaseOperation = function () {
  if (this.response) {
    return;
  }

  if (this.className === '_Role') {
    this.config.cacheController.role.clear();
  }

  if (this.className === '_User' && this.query && this.auth.isUnauthenticated()) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, `Cannot modify user ${this.query.objectId}.`);
  }

  if (this.className === '_Product' && this.data.download) {
    this.data.downloadName = this.data.download.name;
  }

  // TODO: Add better detection for ACL, ensuring a user can't be locked from
  //       their own user record.
  if (this.data.ACL && this.data.ACL['*unresolved']) {
    throw new Parse.Error(Parse.Error.INVALID_ACL, 'Invalid ACL.');
  }

  if (this.query) {
    // Force the user to not lockout
    // Matched with parse.com
    if (this.className === '_User' && this.data.ACL && this.auth.isMaster !== true) {
      this.data.ACL[this.query.objectId] = { read: true, write: true };
    }
    // update password timestamp if user password is being changed
    if (this.className === '_User' && this.data._hashed_password && this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordAge) {
      this.data._password_changed_at = Parse._encode(new Date());
    }
    // Ignore createdAt when update
    delete this.data.createdAt;

    let defer = Promise.resolve();
    // if password history is enabled then save the current password to history
    if (this.className === '_User' && this.data._hashed_password && this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordHistory) {
      defer = this.config.database.find('_User', { objectId: this.objectId() }, { keys: ["_password_history", "_hashed_password"] }).then(results => {
        if (results.length != 1) {
          throw undefined;
        }
        const user = results[0];
        let oldPasswords = [];
        if (user._password_history) {
          oldPasswords = _lodash2.default.take(user._password_history, this.config.passwordPolicy.maxPasswordHistory);
        }
        //n-1 passwords go into history including last password
        while (oldPasswords.length > this.config.passwordPolicy.maxPasswordHistory - 2) {
          oldPasswords.shift();
        }
        oldPasswords.push(user.password);
        this.data._password_history = oldPasswords;
      });
    }

    return defer.then(() => {
      // Run an update
      return this.config.database.update(this.className, this.query, this.data, this.runOptions).then(response => {
        response.updatedAt = this.updatedAt;
        this._updateResponseWithData(response, this.data);
        this.response = { response };
      });
    });
  } else {
    // Set the default ACL and password timestamp for the new _User
    if (this.className === '_User') {
      var ACL = this.data.ACL;
      // default public r/w ACL
      if (!ACL) {
        ACL = {};
        ACL['*'] = { read: true, write: false };
      }
      // make sure the user is not locked down
      ACL[this.data.objectId] = { read: true, write: true };
      this.data.ACL = ACL;
      // password timestamp to be used when password expiry policy is enforced
      if (this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordAge) {
        this.data._password_changed_at = Parse._encode(new Date());
      }
    }

    // Run a create
    return this.config.database.create(this.className, this.data, this.runOptions).catch(error => {
      if (this.className !== '_User' || error.code !== Parse.Error.DUPLICATE_VALUE) {
        throw error;
      }

      // Quick check, if we were able to infer the duplicated field name
      if (error && error.userInfo && error.userInfo.duplicated_field === 'username') {
        throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
      }

      if (error && error.userInfo && error.userInfo.duplicated_field === 'email') {
        throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
      }

      // If this was a failed user creation due to username or email already taken, we need to
      // check whether it was username or email and return the appropriate error.
      // Fallback to the original method
      // TODO: See if we can later do this without additional queries by using named indexes.
      return this.config.database.find(this.className, { username: this.data.username, objectId: { '$ne': this.objectId() } }, { limit: 1 }).then(results => {
        if (results.length > 0) {
          throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
        }
        return this.config.database.find(this.className, { email: this.data.email, objectId: { '$ne': this.objectId() } }, { limit: 1 });
      }).then(results => {
        if (results.length > 0) {
          throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
        }
        throw new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      });
    }).then(response => {
      response.objectId = this.data.objectId;
      response.createdAt = this.data.createdAt;

      if (this.responseShouldHaveUsername) {
        response.username = this.data.username;
      }
      this._updateResponseWithData(response, this.data);
      this.response = {
        status: 201,
        response,
        location: this.location()
      };
    });
  }
};

// Returns nothing - doesn't wait for the trigger.
RestWrite.prototype.runAfterTrigger = function () {
  if (!this.response || !this.response.response) {
    return;
  }

  // Avoid doing any setup for triggers if there is no 'afterSave' trigger for this class.
  const hasAfterSaveHook = triggers.triggerExists(this.className, triggers.Types.afterSave, this.config.applicationId);
  const hasLiveQuery = this.config.liveQueryController.hasLiveQuery(this.className);
  if (!hasAfterSaveHook && !hasLiveQuery) {
    return Promise.resolve();
  }

  var extraData = { className: this.className };
  if (this.query && this.query.objectId) {
    extraData.objectId = this.query.objectId;
  }

  // Build the original object, we only do this for a update write.
  let originalObject;
  if (this.query && this.query.objectId) {
    originalObject = triggers.inflate(extraData, this.originalData);
  }

  // Build the inflated object, different from beforeSave, originalData is not empty
  // since developers can change data in the beforeSave.
  const updatedObject = this.buildUpdatedObject(extraData);
  updatedObject._handleSaveResponse(this.response.response, this.response.status || 200);

  // Notifiy LiveQueryServer if possible
  this.config.liveQueryController.onAfterSave(updatedObject.className, updatedObject, originalObject);

  // Run afterSave trigger
  return triggers.maybeRunTrigger(triggers.Types.afterSave, this.auth, updatedObject, originalObject, this.config).catch(function (err) {
    _logger2.default.warn('afterSave caught an error', err);
  });
};

// A helper to figure out what location this operation happens at.
RestWrite.prototype.location = function () {
  var middle = this.className === '_User' ? '/users/' : '/classes/' + this.className + '/';
  return this.config.mount + middle + this.data.objectId;
};

// A helper to get the object id for this operation.
// Because it could be either on the query or on the data
RestWrite.prototype.objectId = function () {
  return this.data.objectId || this.query.objectId;
};

// Returns a copy of the data and delete bad keys (_auth_data, _hashed_password...)
RestWrite.prototype.sanitizedData = function () {
  const data = Object.keys(this.data).reduce((data, key) => {
    // Regexp comes from Parse.Object.prototype.validate
    if (!/^[A-Za-z][0-9A-Za-z_]*$/.test(key)) {
      delete data[key];
    }
    return data;
  }, deepcopy(this.data));
  return Parse._decode(undefined, data);
};

// Returns an updated copy of the object
RestWrite.prototype.buildUpdatedObject = function (extraData) {
  const updatedObject = triggers.inflate(extraData, this.originalData);
  Object.keys(this.data).reduce(function (data, key) {
    if (key.indexOf(".") > 0) {
      // subdocument key with dot notation ('x.y':v => 'x':{'y':v})
      const splittedKey = key.split(".");
      const parentProp = splittedKey[0];
      let parentVal = updatedObject.get(parentProp);
      if (typeof parentVal !== 'object') {
        parentVal = {};
      }
      parentVal[splittedKey[1]] = data[key];
      updatedObject.set(parentProp, parentVal);
      delete data[key];
    }
    return data;
  }, deepcopy(this.data));

  updatedObject.set(this.sanitizedData());
  return updatedObject;
};

RestWrite.prototype.cleanUserAuthData = function () {
  if (this.response && this.response.response && this.className === '_User') {
    const user = this.response.response;
    if (user.authData) {
      Object.keys(user.authData).forEach(provider => {
        if (user.authData[provider] === null) {
          delete user.authData[provider];
        }
      });
      if (Object.keys(user.authData).length == 0) {
        delete user.authData;
      }
    }
  }
};

RestWrite.prototype._updateResponseWithData = function (response, data) {
  if (_lodash2.default.isEmpty(this.storage.fieldsChangedByTrigger)) {
    return response;
  }
  const clientSupportsDelete = ClientSDK.supportsForwardDelete(this.clientSDK);
  this.storage.fieldsChangedByTrigger.forEach(fieldName => {
    const dataValue = data[fieldName];

    if (!response.hasOwnProperty(fieldName)) {
      response[fieldName] = dataValue;
    }

    // Strips operations from responses
    if (response[fieldName] && response[fieldName].__op) {
      delete response[fieldName];
      if (clientSupportsDelete && dataValue.__op == 'Delete') {
        response[fieldName] = dataValue;
      }
    }
  });
  return response;
};

exports.default = RestWrite;

module.exports = RestWrite;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9SZXN0V3JpdGUuanMiXSwibmFtZXMiOlsiU2NoZW1hQ29udHJvbGxlciIsInJlcXVpcmUiLCJkZWVwY29weSIsIkF1dGgiLCJjcnlwdG9VdGlscyIsInBhc3N3b3JkQ3J5cHRvIiwiUGFyc2UiLCJ0cmlnZ2VycyIsIkNsaWVudFNESyIsIlJlc3RXcml0ZSIsImNvbmZpZyIsImF1dGgiLCJjbGFzc05hbWUiLCJxdWVyeSIsImRhdGEiLCJvcmlnaW5hbERhdGEiLCJjbGllbnRTREsiLCJpc1JlYWRPbmx5IiwiRXJyb3IiLCJPUEVSQVRJT05fRk9SQklEREVOIiwic3RvcmFnZSIsInJ1bk9wdGlvbnMiLCJvYmplY3RJZCIsIklOVkFMSURfS0VZX05BTUUiLCJyZXNwb25zZSIsInVwZGF0ZWRBdCIsIl9lbmNvZGUiLCJEYXRlIiwiaXNvIiwicHJvdG90eXBlIiwiZXhlY3V0ZSIsIlByb21pc2UiLCJyZXNvbHZlIiwidGhlbiIsImdldFVzZXJBbmRSb2xlQUNMIiwidmFsaWRhdGVDbGllbnRDbGFzc0NyZWF0aW9uIiwiaGFuZGxlSW5zdGFsbGF0aW9uIiwiaGFuZGxlU2Vzc2lvbiIsInZhbGlkYXRlQXV0aERhdGEiLCJydW5CZWZvcmVUcmlnZ2VyIiwidmFsaWRhdGVTY2hlbWEiLCJzZXRSZXF1aXJlZEZpZWxkc0lmTmVlZGVkIiwidHJhbnNmb3JtVXNlciIsImV4cGFuZEZpbGVzRm9yRXhpc3RpbmdPYmplY3RzIiwiZGVzdHJveUR1cGxpY2F0ZWRTZXNzaW9ucyIsInJ1bkRhdGFiYXNlT3BlcmF0aW9uIiwiY3JlYXRlU2Vzc2lvblRva2VuSWZOZWVkZWQiLCJoYW5kbGVGb2xsb3d1cCIsInJ1bkFmdGVyVHJpZ2dlciIsImNsZWFuVXNlckF1dGhEYXRhIiwiaXNNYXN0ZXIiLCJhY2wiLCJ1c2VyIiwiZ2V0VXNlclJvbGVzIiwicm9sZXMiLCJjb25jYXQiLCJpZCIsImFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiIsInN5c3RlbUNsYXNzZXMiLCJpbmRleE9mIiwiZGF0YWJhc2UiLCJsb2FkU2NoZW1hIiwic2NoZW1hQ29udHJvbGxlciIsImhhc0NsYXNzIiwidmFsaWRhdGVPYmplY3QiLCJ0cmlnZ2VyRXhpc3RzIiwiVHlwZXMiLCJiZWZvcmVTYXZlIiwiYXBwbGljYXRpb25JZCIsImV4dHJhRGF0YSIsIm9yaWdpbmFsT2JqZWN0IiwidXBkYXRlZE9iamVjdCIsImJ1aWxkVXBkYXRlZE9iamVjdCIsImluZmxhdGUiLCJtYXliZVJ1blRyaWdnZXIiLCJvYmplY3QiLCJmaWVsZHNDaGFuZ2VkQnlUcmlnZ2VyIiwiXyIsInJlZHVjZSIsInJlc3VsdCIsInZhbHVlIiwia2V5IiwiaXNFcXVhbCIsInB1c2giLCJjcmVhdGVkQXQiLCJuZXdPYmplY3RJZCIsIm9iamVjdElkU2l6ZSIsImF1dGhEYXRhIiwidXNlcm5hbWUiLCJpc0VtcHR5IiwiVVNFUk5BTUVfTUlTU0lORyIsInBhc3N3b3JkIiwiUEFTU1dPUkRfTUlTU0lORyIsIk9iamVjdCIsImtleXMiLCJsZW5ndGgiLCJwcm92aWRlcnMiLCJjYW5IYW5kbGVBdXRoRGF0YSIsImNhbkhhbmRsZSIsInByb3ZpZGVyIiwicHJvdmlkZXJBdXRoRGF0YSIsImhhc1Rva2VuIiwiaGFuZGxlQXV0aERhdGEiLCJVTlNVUFBPUlRFRF9TRVJWSUNFIiwiaGFuZGxlQXV0aERhdGFWYWxpZGF0aW9uIiwidmFsaWRhdGlvbnMiLCJtYXAiLCJhdXRoRGF0YU1hbmFnZXIiLCJnZXRWYWxpZGF0b3JGb3JQcm92aWRlciIsImFsbCIsImZpbmRVc2Vyc1dpdGhBdXRoRGF0YSIsIm1lbW8iLCJxdWVyeUtleSIsImZpbHRlciIsInEiLCJmaW5kUHJvbWlzZSIsImZpbmQiLCJmaWx0ZXJlZE9iamVjdHNCeUFDTCIsIm9iamVjdHMiLCJBQ0wiLCJyZXN1bHRzIiwiciIsIkFDQ09VTlRfQUxSRUFEWV9MSU5LRUQiLCJqb2luIiwidXNlclJlc3VsdCIsIm11dGF0ZWRBdXRoRGF0YSIsImZvckVhY2giLCJwcm92aWRlckRhdGEiLCJ1c2VyQXV0aERhdGEiLCJoYXNNdXRhdGVkQXV0aERhdGEiLCJ1c2VySWQiLCJsb2NhdGlvbiIsInVwZGF0ZSIsInByb21pc2UiLCJlcnJvciIsIlJlc3RRdWVyeSIsIm1hc3RlciIsIl9fdHlwZSIsInNlc3Npb24iLCJjYWNoZUNvbnRyb2xsZXIiLCJkZWwiLCJzZXNzaW9uVG9rZW4iLCJ1bmRlZmluZWQiLCJfdmFsaWRhdGVQYXNzd29yZFBvbGljeSIsImhhc2giLCJoYXNoZWRQYXNzd29yZCIsIl9oYXNoZWRfcGFzc3dvcmQiLCJfdmFsaWRhdGVVc2VyTmFtZSIsIl92YWxpZGF0ZUVtYWlsIiwicmFuZG9tU3RyaW5nIiwicmVzcG9uc2VTaG91bGRIYXZlVXNlcm5hbWUiLCJsaW1pdCIsIlVTRVJOQU1FX1RBS0VOIiwiZW1haWwiLCJfX29wIiwibWF0Y2giLCJyZWplY3QiLCJJTlZBTElEX0VNQUlMX0FERFJFU1MiLCJFTUFJTF9UQUtFTiIsInVzZXJDb250cm9sbGVyIiwic2V0RW1haWxWZXJpZnlUb2tlbiIsInBhc3N3b3JkUG9saWN5IiwiX3ZhbGlkYXRlUGFzc3dvcmRSZXF1aXJlbWVudHMiLCJfdmFsaWRhdGVQYXNzd29yZEhpc3RvcnkiLCJwb2xpY3lFcnJvciIsInBhdHRlcm5WYWxpZGF0b3IiLCJ2YWxpZGF0b3JDYWxsYmFjayIsIlZBTElEQVRJT05fRVJST1IiLCJkb05vdEFsbG93VXNlcm5hbWUiLCJtYXhQYXNzd29yZEhpc3RvcnkiLCJvbGRQYXNzd29yZHMiLCJfcGFzc3dvcmRfaGlzdG9yeSIsInRha2UiLCJuZXdQYXNzd29yZCIsInByb21pc2VzIiwiY29tcGFyZSIsImNhdGNoIiwiZXJyIiwicHJldmVudExvZ2luV2l0aFVudmVyaWZpZWRFbWFpbCIsInZlcmlmeVVzZXJFbWFpbHMiLCJjcmVhdGVTZXNzaW9uVG9rZW4iLCJpbnN0YWxsYXRpb25JZCIsInNlc3Npb25EYXRhIiwiY3JlYXRlU2Vzc2lvbiIsImNyZWF0ZWRXaXRoIiwiZGVzdHJveSIsInJldm9rZVNlc3Npb25PblBhc3N3b3JkUmVzZXQiLCJzZXNzaW9uUXVlcnkiLCJiaW5kIiwic2VuZFZlcmlmaWNhdGlvbkVtYWlsIiwiSU5WQUxJRF9TRVNTSU9OX1RPS0VOIiwiYWRkaXRpb25hbFNlc3Npb25EYXRhIiwiYWN0aW9uIiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwic3RhdHVzIiwiZGV2aWNlVG9rZW4iLCJ0b0xvd2VyQ2FzZSIsImRldmljZVR5cGUiLCJpZE1hdGNoIiwib2JqZWN0SWRNYXRjaCIsImluc3RhbGxhdGlvbklkTWF0Y2giLCJkZXZpY2VUb2tlbk1hdGNoZXMiLCJvclF1ZXJpZXMiLCJPQkpFQ1RfTk9UX0ZPVU5EIiwiZGVsUXVlcnkiLCJhcHBJZGVudGlmaWVyIiwiY29kZSIsIm9iaklkIiwiZmlsZXNDb250cm9sbGVyIiwiZXhwYW5kRmlsZXNJbk9iamVjdCIsInJvbGUiLCJjbGVhciIsImlzVW5hdXRoZW50aWNhdGVkIiwiU0VTU0lPTl9NSVNTSU5HIiwiZG93bmxvYWQiLCJkb3dubG9hZE5hbWUiLCJuYW1lIiwiSU5WQUxJRF9BQ0wiLCJyZWFkIiwid3JpdGUiLCJtYXhQYXNzd29yZEFnZSIsIl9wYXNzd29yZF9jaGFuZ2VkX2F0IiwiZGVmZXIiLCJzaGlmdCIsIl91cGRhdGVSZXNwb25zZVdpdGhEYXRhIiwiY3JlYXRlIiwiRFVQTElDQVRFX1ZBTFVFIiwidXNlckluZm8iLCJkdXBsaWNhdGVkX2ZpZWxkIiwiaGFzQWZ0ZXJTYXZlSG9vayIsImFmdGVyU2F2ZSIsImhhc0xpdmVRdWVyeSIsImxpdmVRdWVyeUNvbnRyb2xsZXIiLCJfaGFuZGxlU2F2ZVJlc3BvbnNlIiwib25BZnRlclNhdmUiLCJsb2dnZXIiLCJ3YXJuIiwibWlkZGxlIiwibW91bnQiLCJzYW5pdGl6ZWREYXRhIiwidGVzdCIsIl9kZWNvZGUiLCJzcGxpdHRlZEtleSIsInNwbGl0IiwicGFyZW50UHJvcCIsInBhcmVudFZhbCIsImdldCIsInNldCIsImNsaWVudFN1cHBvcnRzRGVsZXRlIiwic3VwcG9ydHNGb3J3YXJkRGVsZXRlIiwi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bE8sU0FBU29PLGNBQVQsQ0FBd0JGLFNBQXhCLENBQUosRUFBd0M7QUFDdENsTyxlQUFTa08sU0FBVCxJQUFzQkMsU0FBdEI7QUFDRDs7QUFFRDtBQUNBLFFBQUluTyxTQUFTa08sU0FBVCxLQUF1QmxPLFNBQVNrTyxTQUFULEVBQW9CaEcsSUFBL0MsRUFBcUQ7QUFDbkQsYUFBT2xJLFNBQVNrTyxTQUFULENBQVA7QUFDQSxVQUFJRix3QkFBd0JHLFVBQVVqRyxJQUFWLElBQWtCLFFBQTlDLEVBQXdEO0FBQ3REbEksaUJBQVNrTyxTQUFULElBQXNCQyxTQUF0QjtBQUNEO0FBQ0Y7QUFDRixHQWREO0FBZUEsU0FBT25PLFFBQVA7QUFDRCxDQXJCRDs7a0JBdUJlZixTOztBQUNmb1AsT0FBT0MsT0FBUCxHQUFpQnJQLFNBQWpCIiwiZmlsZSI6IlJlc3RXcml0ZS5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEEgUmVzdFdyaXRlIGVuY2Fwc3VsYXRlcyBldmVyeXRoaW5nIHdlIG5lZWQgdG8gcnVuIGFuIG9wZXJhdGlvblxuLy8gdGhhdCB3cml0ZXMgdG8gdGhlIGRhdGFiYXNlLlxuLy8gVGhpcyBjb3VsZCBiZSBlaXRoZXIgYSBcImNyZWF0ZVwiIG9yIGFuIFwidXBkYXRlXCIuXG5cbnZhciBTY2hlbWFDb250cm9sbGVyID0gcmVxdWlyZSgnLi9Db250cm9sbGVycy9TY2hlbWFDb250cm9sbGVyJyk7XG52YXIgZGVlcGNvcHkgPSByZXF1aXJlKCdkZWVwY29weScpO1xuXG5jb25zdCBBdXRoID0gcmVxdWlyZSgnLi9BdXRoJyk7XG52YXIgY3J5cHRvVXRpbHMgPSByZXF1aXJlKCcuL2NyeXB0b1V0aWxzJyk7XG52YXIgcGFzc3dvcmRDcnlwdG8gPSByZXF1aXJlKCcuL3Bhc3N3b3JkJyk7XG52YXIgUGFyc2UgPSByZXF1aXJlKCdwYXJzZS9ub2RlJyk7XG52YXIgdHJpZ2dlcnMgPSByZXF1aXJlKCcuL3RyaWdnZXJzJyk7XG52YXIgQ2xpZW50U0RLID0gcmVxdWlyZSgnLi9DbGllbnRTREsnKTtcbmltcG9ydCBSZXN0UXVlcnkgZnJvbSAnLi9SZXN0UXVlcnknO1xuaW1wb3J0IF8gICAgICAgICBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IGxvZ2dlciAgICBmcm9tICcuL2xvZ2dlcic7XG5cbi8vIHF1ZXJ5IGFuZCBkYXRhIGFyZSBib3RoIHByb3ZpZGVkIGluIFJFU1QgQVBJIGZvcm1hdC4gU28gZGF0YVxuLy8gdHlwZXMgYXJlIGVuY29kZWQgYnkgcGxhaW4gb2xkIG9iamVjdHMuXG4vLyBJZiBxdWVyeSBpcyBudWxsLCB0aGlzIGlzIGEgXCJjcmVhdGVcIiBhbmQgdGhlIGRhdGEgaW4gZGF0YSBzaG91bGQgYmVcbi8vIGNyZWF0ZWQuXG4vLyBPdGhlcndpc2UgdGhpcyBpcyBhbiBcInVwZGF0ZVwiIC0gdGhlIG9iamVjdCBtYXRjaGluZyB0aGUgcXVlcnlcbi8vIHNob3VsZCBnZXQgdXBkYXRlZCB3aXRoIGRhdGEuXG4vLyBSZXN0V3JpdGUgd2lsbCBoYW5kbGUgb2JqZWN0SWQsIGNyZWF0ZWRBdCwgYW5kIHVwZGF0ZWRBdCBmb3Jcbi8vIGV2ZXJ5dGhpbmcuIEl0IGFsc28ga25vd3MgdG8gdXNlIHRyaWdnZXJzIGFuZCBzcGVjaWFsIG1vZGlmaWNhdGlvbnNcbi8vIGZvciB0aGUgX1VzZXIgY2xhc3MuXG5mdW5jdGlvbiBSZXN0V3JpdGUoY29uZmlnLCBhdXRoLCBjbGFzc05hbWUsIHF1ZXJ5LCBkYXRhLCBvcmlnaW5hbERhdGEsIGNsaWVudFNESykge1xuICBpZiAoYXV0aC5pc1JlYWRPbmx5KSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sICdDYW5ub3QgcGVyZm9ybSBhIHdyaXRlIG9wZXJhdGlvbiB3aGVuIHVzaW5nIHJlYWRPbmx5TWFzdGVyS2V5Jyk7XG4gIH1cbiAgdGhpcy5jb25maWcgPSBjb25maWc7XG4gIHRoaXMuYXV0aCA9IGF1dGg7XG4gIHRoaXMuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuICB0aGlzLmNsaWVudFNESyA9IGNsaWVudFNESztcbiAgdGhpcy5zdG9yYWdlID0ge307XG4gIHRoaXMucnVuT3B0aW9ucyA9IHt9O1xuICBpZiAoIXF1ZXJ5ICYmIGRhdGEub2JqZWN0SWQpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgJ29iamVjdElkIGlzIGFuIGludmFsaWQgZmllbGQgbmFtZS4nKTtcbiAgfVxuXG4gIC8vIFdoZW4gdGhlIG9wZXJhdGlvbiBpcyBjb21wbGV0ZSwgdGhpcy5yZXNwb25zZSBtYXkgaGF2ZSBzZXZlcmFsXG4gIC8vIGZpZWxkcy5cbiAgLy8gcmVzcG9uc2U6IHRoZSBhY3R1YWwgZGF0YSB0byBiZSByZXR1cm5lZFxuICAvLyBzdGF0dXM6IHRoZSBodHRwIHN0YXR1cyBjb2RlLiBpZiBub3QgcHJlc2VudCwgdHJlYXRlZCBsaWtlIGEgMjAwXG4gIC8vIGxvY2F0aW9uOiB0aGUgbG9jYXRpb24gaGVhZGVyLiBpZiBub3QgcHJlc2VudCwgbm8gbG9jYXRpb24gaGVhZGVyXG4gIHRoaXMucmVzcG9uc2UgPSBudWxsO1xuXG4gIC8vIFByb2Nlc3NpbmcgdGhpcyBvcGVyYXRpb24gbWF5IG11dGF0ZSBvdXIgZGF0YSwgc28gd2Ugb3BlcmF0ZSBvbiBhXG4gIC8vIGNvcHlcbiAgdGhpcy5xdWVyeSA9IGRlZXBjb3B5KHF1ZXJ5KTtcbiAgdGhpcy5kYXRhID0gZGVlcGNvcHkoZGF0YSk7XG4gIC8vIFdlIG5ldmVyIGNoYW5nZSBvcmlnaW5hbERhdGEsIHNvIHdlIGRvIG5vdCBuZWVkIGEgZGVlcCBjb3B5XG4gIHRoaXMub3JpZ2luYWxEYXRhID0gb3JpZ2luYWxEYXRhO1xuXG4gIC8vIFRoZSB0aW1lc3RhbXAgd2UnbGwgdXNlIGZvciB0aGlzIHdob2xlIG9wZXJhdGlvblxuICB0aGlzLnVwZGF0ZWRBdCA9IFBhcnNlLl9lbmNvZGUobmV3IERhdGUoKSkuaXNvO1xufVxuXG4vLyBBIGNvbnZlbmllbnQgbWV0aG9kIHRvIHBlcmZvcm0gYWxsIHRoZSBzdGVwcyBvZiBwcm9jZXNzaW5nIHRoZVxuLy8gd3JpdGUsIGluIG9yZGVyLlxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIGEge3Jlc3BvbnNlLCBzdGF0dXMsIGxvY2F0aW9ufSBvYmplY3QuXG4vLyBzdGF0dXMgYW5kIGxvY2F0aW9uIGFyZSBvcHRpb25hbC5cblJlc3RXcml0ZS5wcm90b3R5cGUuZXhlY3V0ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0VXNlckFuZFJvbGVBQ0woKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMudmFsaWRhdGVDbGllbnRDbGFzc0NyZWF0aW9uKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmhhbmRsZUluc3RhbGxhdGlvbigpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVTZXNzaW9uKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnZhbGlkYXRlQXV0aERhdGEoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMucnVuQmVmb3JlVHJpZ2dlcigpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy52YWxpZGF0ZVNjaGVtYSgpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5zZXRSZXF1aXJlZEZpZWxkc0lmTmVlZGVkKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnRyYW5zZm9ybVVzZXIoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuZXhwYW5kRmlsZXNGb3JFeGlzdGluZ09iamVjdHMoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuZGVzdHJveUR1cGxpY2F0ZWRTZXNzaW9ucygpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5ydW5EYXRhYmFzZU9wZXJhdGlvbigpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5jcmVhdGVTZXNzaW9uVG9rZW5JZk5lZWRlZCgpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVGb2xsb3d1cCgpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5ydW5BZnRlclRyaWdnZXIoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuY2xlYW5Vc2VyQXV0aERhdGEoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMucmVzcG9uc2U7XG4gIH0pXG59O1xuXG4vLyBVc2VzIHRoZSBBdXRoIG9iamVjdCB0byBnZXQgdGhlIGxpc3Qgb2Ygcm9sZXMsIGFkZHMgdGhlIHVzZXIgaWRcblJlc3RXcml0ZS5wcm90b3R5cGUuZ2V0VXNlckFuZFJvbGVBQ0wgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIHRoaXMucnVuT3B0aW9ucy5hY2wgPSBbJyonXTtcblxuICBpZiAodGhpcy5hdXRoLnVzZXIpIHtcbiAgICByZXR1cm4gdGhpcy5hdXRoLmdldFVzZXJSb2xlcygpLnRoZW4oKHJvbGVzKSA9PiB7XG4gICAgICB0aGlzLnJ1bk9wdGlvbnMuYWNsID0gdGhpcy5ydW5PcHRpb25zLmFjbC5jb25jYXQocm9sZXMsIFt0aGlzLmF1dGgudXNlci5pZF0pO1xuICAgICAgcmV0dXJuO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxufTtcblxuLy8gVmFsaWRhdGVzIHRoaXMgb3BlcmF0aW9uIGFnYWluc3QgdGhlIGFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiBjb25maWcuXG5SZXN0V3JpdGUucHJvdG90eXBlLnZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5jb25maWcuYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uID09PSBmYWxzZSAmJiAhdGhpcy5hdXRoLmlzTWFzdGVyXG4gICAgICAmJiBTY2hlbWFDb250cm9sbGVyLnN5c3RlbUNsYXNzZXMuaW5kZXhPZih0aGlzLmNsYXNzTmFtZSkgPT09IC0xKSB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmxvYWRTY2hlbWEoKVxuICAgICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiBzY2hlbWFDb250cm9sbGVyLmhhc0NsYXNzKHRoaXMuY2xhc3NOYW1lKSlcbiAgICAgIC50aGVuKGhhc0NsYXNzID0+IHtcbiAgICAgICAgaWYgKGhhc0NsYXNzICE9PSB0cnVlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICAgICAgICAnVGhpcyB1c2VyIGlzIG5vdCBhbGxvd2VkIHRvIGFjY2VzcyAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ25vbi1leGlzdGVudCBjbGFzczogJyArIHRoaXMuY2xhc3NOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG59O1xuXG4vLyBWYWxpZGF0ZXMgdGhpcyBvcGVyYXRpb24gYWdhaW5zdCB0aGUgc2NoZW1hLlxuUmVzdFdyaXRlLnByb3RvdHlwZS52YWxpZGF0ZVNjaGVtYSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UudmFsaWRhdGVPYmplY3QodGhpcy5jbGFzc05hbWUsIHRoaXMuZGF0YSwgdGhpcy5xdWVyeSwgdGhpcy5ydW5PcHRpb25zKTtcbn07XG5cbi8vIFJ1bnMgYW55IGJlZm9yZVNhdmUgdHJpZ2dlcnMgYWdhaW5zdCB0aGlzIG9wZXJhdGlvbi5cbi8vIEFueSBjaGFuZ2UgbGVhZHMgdG8gb3VyIGRhdGEgYmVpbmcgbXV0YXRlZC5cblJlc3RXcml0ZS5wcm90b3R5cGUucnVuQmVmb3JlVHJpZ2dlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5yZXNwb25zZSkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIEF2b2lkIGRvaW5nIGFueSBzZXR1cCBmb3IgdHJpZ2dlcnMgaWYgdGhlcmUgaXMgbm8gJ2JlZm9yZVNhdmUnIHRyaWdnZXIgZm9yIHRoaXMgY2xhc3MuXG4gIGlmICghdHJpZ2dlcnMudHJpZ2dlckV4aXN0cyh0aGlzLmNsYXNzTmFtZSwgdHJpZ2dlcnMuVHlwZXMuYmVmb3JlU2F2ZSwgdGhpcy5jb25maWcuYXBwbGljYXRpb25JZCkpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICAvLyBDbG91ZCBjb2RlIGdldHMgYSBiaXQgb2YgZXh0cmEgZGF0YSBmb3IgaXRzIG9iamVjdHNcbiAgdmFyIGV4dHJhRGF0YSA9IHtjbGFzc05hbWU6IHRoaXMuY2xhc3NOYW1lfTtcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgIGV4dHJhRGF0YS5vYmplY3RJZCA9IHRoaXMucXVlcnkub2JqZWN0SWQ7XG4gIH1cblxuICBsZXQgb3JpZ2luYWxPYmplY3QgPSBudWxsO1xuICBjb25zdCB1cGRhdGVkT2JqZWN0ID0gdGhpcy5idWlsZFVwZGF0ZWRPYmplY3QoZXh0cmFEYXRhKTtcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgIC8vIFRoaXMgaXMgYW4gdXBkYXRlIGZvciBleGlzdGluZyBvYmplY3QuXG4gICAgb3JpZ2luYWxPYmplY3QgPSB0cmlnZ2Vycy5pbmZsYXRlKGV4dHJhRGF0YSwgdGhpcy5vcmlnaW5hbERhdGEpO1xuICB9XG5cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0cmlnZ2Vycy5tYXliZVJ1blRyaWdnZXIodHJpZ2dlcnMuVHlwZXMuYmVmb3JlU2F2ZSwgdGhpcy5hdXRoLCB1cGRhdGVkT2JqZWN0LCBvcmlnaW5hbE9iamVjdCwgdGhpcy5jb25maWcpO1xuICB9KS50aGVuKChyZXNwb25zZSkgPT4ge1xuICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5vYmplY3QpIHtcbiAgICAgIHRoaXMuc3RvcmFnZS5maWVsZHNDaGFuZ2VkQnlUcmlnZ2VyID0gXy5yZWR1Y2UocmVzcG9uc2Uub2JqZWN0LCAocmVzdWx0LCB2YWx1ZSwga2V5KSA9PiB7XG4gICAgICAgIGlmICghXy5pc0VxdWFsKHRoaXMuZGF0YVtrZXldLCB2YWx1ZSkpIHtcbiAgICAgICAgICByZXN1bHQucHVzaChrZXkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9LCBbXSk7XG4gICAgICB0aGlzLmRhdGEgPSByZXNwb25zZS5vYmplY3Q7XG4gICAgICAvLyBXZSBzaG91bGQgZGVsZXRlIHRoZSBvYmplY3RJZCBmb3IgYW4gdXBkYXRlIHdyaXRlXG4gICAgICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmRhdGEub2JqZWN0SWRcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5zZXRSZXF1aXJlZEZpZWxkc0lmTmVlZGVkID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmRhdGEpIHtcbiAgICAvLyBBZGQgZGVmYXVsdCBmaWVsZHNcbiAgICB0aGlzLmRhdGEudXBkYXRlZEF0ID0gdGhpcy51cGRhdGVkQXQ7XG4gICAgaWYgKCF0aGlzLnF1ZXJ5KSB7XG4gICAgICB0aGlzLmRhdGEuY3JlYXRlZEF0ID0gdGhpcy51cGRhdGVkQXQ7XG5cbiAgICAgIC8vIE9ubHkgYXNzaWduIG5ldyBvYmplY3RJZCBpZiB3ZSBhcmUgY3JlYXRpbmcgbmV3IG9iamVjdFxuICAgICAgaWYgKCF0aGlzLmRhdGEub2JqZWN0SWQpIHtcbiAgICAgICAgdGhpcy5kYXRhLm9iamVjdElkID0gY3J5cHRvVXRpbHMubmV3T2JqZWN0SWQodGhpcy5jb25maWcub2JqZWN0SWRTaXplKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xufTtcblxuLy8gVHJhbnNmb3JtcyBhdXRoIGRhdGEgZm9yIGEgdXNlciBvYmplY3QuXG4vLyBEb2VzIG5vdGhpbmcgaWYgdGhpcyBpc24ndCBhIHVzZXIgb2JqZWN0LlxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIHdoZW4gd2UncmUgZG9uZSBpZiBpdCBjYW4ndCBmaW5pc2ggdGhpcyB0aWNrLlxuUmVzdFdyaXRlLnByb3RvdHlwZS52YWxpZGF0ZUF1dGhEYXRhID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmNsYXNzTmFtZSAhPT0gJ19Vc2VyJykge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghdGhpcy5xdWVyeSAmJiAhdGhpcy5kYXRhLmF1dGhEYXRhKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLmRhdGEudXNlcm5hbWUgIT09ICdzdHJpbmcnIHx8IF8uaXNFbXB0eSh0aGlzLmRhdGEudXNlcm5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuVVNFUk5BTUVfTUlTU0lORyxcbiAgICAgICAgJ2JhZCBvciBtaXNzaW5nIHVzZXJuYW1lJyk7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgdGhpcy5kYXRhLnBhc3N3b3JkICE9PSAnc3RyaW5nJyB8fCBfLmlzRW1wdHkodGhpcy5kYXRhLnBhc3N3b3JkKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBBU1NXT1JEX01JU1NJTkcsXG4gICAgICAgICdwYXNzd29yZCBpcyByZXF1aXJlZCcpO1xuICAgIH1cbiAgfVxuXG4gIGlmICghdGhpcy5kYXRhLmF1dGhEYXRhIHx8ICFPYmplY3Qua2V5cyh0aGlzLmRhdGEuYXV0aERhdGEpLmxlbmd0aCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHZhciBhdXRoRGF0YSA9IHRoaXMuZGF0YS5hdXRoRGF0YTtcbiAgdmFyIHByb3ZpZGVycyA9IE9iamVjdC5rZXlzKGF1dGhEYXRhKTtcbiAgaWYgKHByb3ZpZGVycy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgY2FuSGFuZGxlQXV0aERhdGEgPSBwcm92aWRlcnMucmVkdWNlKChjYW5IYW5kbGUsIHByb3ZpZGVyKSA9PiB7XG4gICAgICB2YXIgcHJvdmlkZXJBdXRoRGF0YSA9IGF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgIHZhciBoYXNUb2tlbiA9IChwcm92aWRlckF1dGhEYXRhICYmIHByb3ZpZGVyQXV0aERhdGEuaWQpO1xuICAgICAgcmV0dXJuIGNhbkhhbmRsZSAmJiAoaGFzVG9rZW4gfHwgcHJvdmlkZXJBdXRoRGF0YSA9PSBudWxsKTtcbiAgICB9LCB0cnVlKTtcbiAgICBpZiAoY2FuSGFuZGxlQXV0aERhdGEpIHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZUF1dGhEYXRhKGF1dGhEYXRhKTtcbiAgICB9XG4gIH1cbiAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlVOU1VQUE9SVEVEX1NFUlZJQ0UsXG4gICAgJ1RoaXMgYXV0aGVudGljYXRpb24gbWV0aG9kIGlzIHVuc3VwcG9ydGVkLicpO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5oYW5kbGVBdXRoRGF0YVZhbGlkYXRpb24gPSBmdW5jdGlvbihhdXRoRGF0YSkge1xuICBjb25zdCB2YWxpZGF0aW9ucyA9IE9iamVjdC5rZXlzKGF1dGhEYXRhKS5tYXAoKHByb3ZpZGVyKSA9PiB7XG4gICAgaWYgKGF1dGhEYXRhW3Byb3ZpZGVyXSA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICBjb25zdCB2YWxpZGF0ZUF1dGhEYXRhID0gdGhpcy5jb25maWcuYXV0aERhdGFNYW5hZ2VyLmdldFZhbGlkYXRvckZvclByb3ZpZGVyKHByb3ZpZGVyKTtcbiAgICBpZiAoIXZhbGlkYXRlQXV0aERhdGEpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5VTlNVUFBPUlRFRF9TRVJWSUNFLFxuICAgICAgICAnVGhpcyBhdXRoZW50aWNhdGlvbiBtZXRob2QgaXMgdW5zdXBwb3J0ZWQuJyk7XG4gICAgfVxuICAgIHJldHVybiB2YWxpZGF0ZUF1dGhEYXRhKGF1dGhEYXRhW3Byb3ZpZGVyXSk7XG4gIH0pO1xuICByZXR1cm4gUHJvbWlzZS5hbGwodmFsaWRhdGlvbnMpO1xufVxuXG5SZXN0V3JpdGUucHJvdG90eXBlLmZpbmRVc2Vyc1dpdGhBdXRoRGF0YSA9IGZ1bmN0aW9uKGF1dGhEYXRhKSB7XG4gIGNvbnN0IHByb3ZpZGVycyA9IE9iamVjdC5rZXlzKGF1dGhEYXRhKTtcbiAgY29uc3QgcXVlcnkgPSBwcm92aWRlcnMucmVkdWNlKChtZW1vLCBwcm92aWRlcikgPT4ge1xuICAgIGlmICghYXV0aERhdGFbcHJvdmlkZXJdKSB7XG4gICAgICByZXR1cm4gbWVtbztcbiAgICB9XG4gICAgY29uc3QgcXVlcnlLZXkgPSBgYXV0aERhdGEuJHtwcm92aWRlcn0uaWRgO1xuICAgIGNvbnN0IHF1ZXJ5ID0ge307XG4gICAgcXVlcnlbcXVlcnlLZXldID0gYXV0aERhdGFbcHJvdmlkZXJdLmlkO1xuICAgIG1lbW8ucHVzaChxdWVyeSk7XG4gICAgcmV0dXJuIG1lbW87XG4gIH0sIFtdKS5maWx0ZXIoKHEpID0+IHtcbiAgICByZXR1cm4gdHlwZW9mIHEgIT09ICd1bmRlZmluZWQnO1xuICB9KTtcblxuICBsZXQgZmluZFByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoW10pO1xuICBpZiAocXVlcnkubGVuZ3RoID4gMCkge1xuICAgIGZpbmRQcm9taXNlID0gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZChcbiAgICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgICAgeyckb3InOiBxdWVyeX0sIHt9KVxuICB9XG5cbiAgcmV0dXJuIGZpbmRQcm9taXNlO1xufVxuXG5SZXN0V3JpdGUucHJvdG90eXBlLmZpbHRlcmVkT2JqZWN0c0J5QUNMID0gZnVuY3Rpb24ob2JqZWN0cykge1xuICBpZiAodGhpcy5hdXRoLmlzTWFzdGVyKSB7XG4gICAgcmV0dXJuIG9iamVjdHM7XG4gIH1cbiAgcmV0dXJuIG9iamVjdHMuZmlsdGVyKChvYmplY3QpID0+IHtcbiAgICBpZiAoIW9iamVjdC5BQ0wpIHtcbiAgICAgIHJldHVybiB0cnVlOyAvLyBsZWdhY3kgdXNlcnMgdGhhdCBoYXZlIG5vIEFDTCBmaWVsZCBvbiB0aGVtXG4gICAgfVxuICAgIC8vIFJlZ3VsYXIgdXNlcnMgdGhhdCBoYXZlIGJlZW4gbG9ja2VkIG91dC5cbiAgICByZXR1cm4gb2JqZWN0LkFDTCAmJiBPYmplY3Qua2V5cyhvYmplY3QuQUNMKS5sZW5ndGggPiAwO1xuICB9KTtcbn1cblxuUmVzdFdyaXRlLnByb3RvdHlwZS5oYW5kbGVBdXRoRGF0YSA9IGZ1bmN0aW9uKGF1dGhEYXRhKSB7XG4gIGxldCByZXN1bHRzO1xuICByZXR1cm4gdGhpcy5maW5kVXNlcnNXaXRoQXV0aERhdGEoYXV0aERhdGEpLnRoZW4oKHIpID0+IHtcbiAgICByZXN1bHRzID0gdGhpcy5maWx0ZXJlZE9iamVjdHNCeUFDTChyKTtcbiAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAxKSB7XG4gICAgICAvLyBNb3JlIHRoYW4gMSB1c2VyIHdpdGggdGhlIHBhc3NlZCBpZCdzXG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuQUNDT1VOVF9BTFJFQURZX0xJTktFRCxcbiAgICAgICAgJ3RoaXMgYXV0aCBpcyBhbHJlYWR5IHVzZWQnKTtcbiAgICB9XG5cbiAgICB0aGlzLnN0b3JhZ2VbJ2F1dGhQcm92aWRlciddID0gT2JqZWN0LmtleXMoYXV0aERhdGEpLmpvaW4oJywnKTtcblxuICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHVzZXJSZXN1bHQgPSByZXN1bHRzWzBdO1xuICAgICAgY29uc3QgbXV0YXRlZEF1dGhEYXRhID0ge307XG4gICAgICBPYmplY3Qua2V5cyhhdXRoRGF0YSkuZm9yRWFjaCgocHJvdmlkZXIpID0+IHtcbiAgICAgICAgY29uc3QgcHJvdmlkZXJEYXRhID0gYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgICBjb25zdCB1c2VyQXV0aERhdGEgPSB1c2VyUmVzdWx0LmF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgICAgaWYgKCFfLmlzRXF1YWwocHJvdmlkZXJEYXRhLCB1c2VyQXV0aERhdGEpKSB7XG4gICAgICAgICAgbXV0YXRlZEF1dGhEYXRhW3Byb3ZpZGVyXSA9IHByb3ZpZGVyRGF0YTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBjb25zdCBoYXNNdXRhdGVkQXV0aERhdGEgPSBPYmplY3Qua2V5cyhtdXRhdGVkQXV0aERhdGEpLmxlbmd0aCAhPT0gMDtcbiAgICAgIGxldCB1c2VySWQ7XG4gICAgICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgICAgIHVzZXJJZCA9IHRoaXMucXVlcnkub2JqZWN0SWQ7XG4gICAgICB9IGVsc2UgaWYgKHRoaXMuYXV0aCAmJiB0aGlzLmF1dGgudXNlciAmJiB0aGlzLmF1dGgudXNlci5pZCkge1xuICAgICAgICB1c2VySWQgPSB0aGlzLmF1dGgudXNlci5pZDtcbiAgICAgIH1cbiAgICAgIGlmICghdXNlcklkIHx8IHVzZXJJZCA9PT0gdXNlclJlc3VsdC5vYmplY3RJZCkgeyAvLyBubyB1c2VyIG1ha2luZyB0aGUgY2FsbFxuICAgICAgICAvLyBPUiB0aGUgdXNlciBtYWtpbmcgdGhlIGNhbGwgaXMgdGhlIHJpZ2h0IG9uZVxuICAgICAgICAvLyBMb2dpbiB3aXRoIGF1dGggZGF0YVxuICAgICAgICBkZWxldGUgcmVzdWx0c1swXS5wYXNzd29yZDtcblxuICAgICAgICAvLyBuZWVkIHRvIHNldCB0aGUgb2JqZWN0SWQgZmlyc3Qgb3RoZXJ3aXNlIGxvY2F0aW9uIGhhcyB0cmFpbGluZyB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5kYXRhLm9iamVjdElkID0gdXNlclJlc3VsdC5vYmplY3RJZDtcblxuICAgICAgICBpZiAoIXRoaXMucXVlcnkgfHwgIXRoaXMucXVlcnkub2JqZWN0SWQpIHsgLy8gdGhpcyBhIGxvZ2luIGNhbGwsIG5vIHVzZXJJZCBwYXNzZWRcbiAgICAgICAgICB0aGlzLnJlc3BvbnNlID0ge1xuICAgICAgICAgICAgcmVzcG9uc2U6IHVzZXJSZXN1bHQsXG4gICAgICAgICAgICBsb2NhdGlvbjogdGhpcy5sb2NhdGlvbigpXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBJZiB3ZSBkaWRuJ3QgY2hhbmdlIHRoZSBhdXRoIGRhdGEsIGp1c3Qga2VlcCBnb2luZ1xuICAgICAgICBpZiAoIWhhc011dGF0ZWRBdXRoRGF0YSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAvLyBXZSBoYXZlIGF1dGhEYXRhIHRoYXQgaXMgdXBkYXRlZCBvbiBsb2dpblxuICAgICAgICAvLyB0aGF0IGNhbiBoYXBwZW4gd2hlbiB0b2tlbiBhcmUgcmVmcmVzaGVkLFxuICAgICAgICAvLyBXZSBzaG91bGQgdXBkYXRlIHRoZSB0b2tlbiBhbmQgbGV0IHRoZSB1c2VyIGluXG4gICAgICAgIC8vIFdlIHNob3VsZCBvbmx5IGNoZWNrIHRoZSBtdXRhdGVkIGtleXNcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlQXV0aERhdGFWYWxpZGF0aW9uKG11dGF0ZWRBdXRoRGF0YSkudGhlbigoKSA9PiB7XG4gICAgICAgICAgLy8gSUYgd2UgaGF2ZSBhIHJlc3BvbnNlLCB3ZSdsbCBza2lwIHRoZSBkYXRhYmFzZSBvcGVyYXRpb24gLyBiZWZvcmVTYXZlIC8gYWZ0ZXJTYXZlIGV0Yy4uLlxuICAgICAgICAgIC8vIHdlIG5lZWQgdG8gc2V0IGl0IHVwIHRoZXJlLlxuICAgICAgICAgIC8vIFdlIGFyZSBzdXBwb3NlZCB0byBoYXZlIGEgcmVzcG9uc2Ugb25seSBvbiBMT0dJTiB3aXRoIGF1dGhEYXRhLCBzbyB3ZSBza2lwIHRob3NlXG4gICAgICAgICAgLy8gSWYgd2UncmUgbm90IGxvZ2dpbmcgaW4sIGJ1dCBqdXN0IHVwZGF0aW5nIHRoZSBjdXJyZW50IHVzZXIsIHdlIGNhbiBzYWZlbHkgc2tpcCB0aGF0IHBhcnRcbiAgICAgICAgICBpZiAodGhpcy5yZXNwb25zZSkge1xuICAgICAgICAgICAgLy8gQXNzaWduIHRoZSBuZXcgYXV0aERhdGEgaW4gdGhlIHJlc3BvbnNlXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhtdXRhdGVkQXV0aERhdGEpLmZvckVhY2goKHByb3ZpZGVyKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucmVzcG9uc2UucmVzcG9uc2UuYXV0aERhdGFbcHJvdmlkZXJdID0gbXV0YXRlZEF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgLy8gUnVuIHRoZSBEQiB1cGRhdGUgZGlyZWN0bHksIGFzICdtYXN0ZXInXG4gICAgICAgICAgICAvLyBKdXN0IHVwZGF0ZSB0aGUgYXV0aERhdGEgcGFydFxuICAgICAgICAgICAgLy8gVGhlbiB3ZSdyZSBnb29kIGZvciB0aGUgdXNlciwgZWFybHkgZXhpdCBvZiBzb3J0c1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLnVwZGF0ZSh0aGlzLmNsYXNzTmFtZSwge29iamVjdElkOiB0aGlzLmRhdGEub2JqZWN0SWR9LCB7YXV0aERhdGE6IG11dGF0ZWRBdXRoRGF0YX0sIHt9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIGlmICh1c2VySWQpIHtcbiAgICAgICAgLy8gVHJ5aW5nIHRvIHVwZGF0ZSBhdXRoIGRhdGEgYnV0IHVzZXJzXG4gICAgICAgIC8vIGFyZSBkaWZmZXJlbnRcbiAgICAgICAgaWYgKHVzZXJSZXN1bHQub2JqZWN0SWQgIT09IHVzZXJJZCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5BQ0NPVU5UX0FMUkVBRFlfTElOS0VELFxuICAgICAgICAgICAgJ3RoaXMgYXV0aCBpcyBhbHJlYWR5IHVzZWQnKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBObyBhdXRoIGRhdGEgd2FzIG11dGF0ZWQsIGp1c3Qga2VlcCBnb2luZ1xuICAgICAgICBpZiAoIWhhc011dGF0ZWRBdXRoRGF0YSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5oYW5kbGVBdXRoRGF0YVZhbGlkYXRpb24oYXV0aERhdGEpO1xuICB9KTtcbn1cblxuXG4vLyBUaGUgbm9uLXRoaXJkLXBhcnR5IHBhcnRzIG9mIFVzZXIgdHJhbnNmb3JtYXRpb25cblJlc3RXcml0ZS5wcm90b3R5cGUudHJhbnNmb3JtVXNlciA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gIGlmICh0aGlzLmNsYXNzTmFtZSAhPT0gJ19Vc2VyJykge1xuICAgIHJldHVybiBwcm9taXNlO1xuICB9XG5cbiAgaWYgKCF0aGlzLmF1dGguaXNNYXN0ZXIgJiYgXCJlbWFpbFZlcmlmaWVkXCIgaW4gdGhpcy5kYXRhKSB7XG4gICAgY29uc3QgZXJyb3IgPSBgQ2xpZW50cyBhcmVuJ3QgYWxsb3dlZCB0byBtYW51YWxseSB1cGRhdGUgZW1haWwgdmVyaWZpY2F0aW9uLmBcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTiwgZXJyb3IpO1xuICB9XG5cbiAgLy8gRG8gbm90IGNsZWFudXAgc2Vzc2lvbiBpZiBvYmplY3RJZCBpcyBub3Qgc2V0XG4gIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMub2JqZWN0SWQoKSkge1xuICAgIC8vIElmIHdlJ3JlIHVwZGF0aW5nIGEgX1VzZXIgb2JqZWN0LCB3ZSBuZWVkIHRvIGNsZWFyIG91dCB0aGUgY2FjaGUgZm9yIHRoYXQgdXNlci4gRmluZCBhbGwgdGhlaXJcbiAgICAvLyBzZXNzaW9uIHRva2VucywgYW5kIHJlbW92ZSB0aGVtIGZyb20gdGhlIGNhY2hlLlxuICAgIHByb21pc2UgPSBuZXcgUmVzdFF1ZXJ5KHRoaXMuY29uZmlnLCBBdXRoLm1hc3Rlcih0aGlzLmNvbmZpZyksICdfU2Vzc2lvbicsIHtcbiAgICAgIHVzZXI6IHtcbiAgICAgICAgX190eXBlOiBcIlBvaW50ZXJcIixcbiAgICAgICAgY2xhc3NOYW1lOiBcIl9Vc2VyXCIsXG4gICAgICAgIG9iamVjdElkOiB0aGlzLm9iamVjdElkKCksXG4gICAgICB9XG4gICAgfSkuZXhlY3V0ZSgpXG4gICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgcmVzdWx0cy5yZXN1bHRzLmZvckVhY2goc2Vzc2lvbiA9PiB0aGlzLmNvbmZpZy5jYWNoZUNvbnRyb2xsZXIudXNlci5kZWwoc2Vzc2lvbi5zZXNzaW9uVG9rZW4pKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgLy8gVHJhbnNmb3JtIHRoZSBwYXNzd29yZFxuICAgIGlmICh0aGlzLmRhdGEucGFzc3dvcmQgPT09IHVuZGVmaW5lZCkgeyAvLyBpZ25vcmUgb25seSBpZiB1bmRlZmluZWQuIHNob3VsZCBwcm9jZWVkIGlmIGVtcHR5ICgnJylcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5xdWVyeSkge1xuICAgICAgdGhpcy5zdG9yYWdlWydjbGVhclNlc3Npb25zJ10gPSB0cnVlO1xuICAgICAgLy8gR2VuZXJhdGUgYSBuZXcgc2Vzc2lvbiBvbmx5IGlmIHRoZSB1c2VyIHJlcXVlc3RlZFxuICAgICAgaWYgKCF0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICAgICAgdGhpcy5zdG9yYWdlWydnZW5lcmF0ZU5ld1Nlc3Npb24nXSA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRlUGFzc3dvcmRQb2xpY3koKS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiBwYXNzd29yZENyeXB0by5oYXNoKHRoaXMuZGF0YS5wYXNzd29yZCkudGhlbigoaGFzaGVkUGFzc3dvcmQpID0+IHtcbiAgICAgICAgdGhpcy5kYXRhLl9oYXNoZWRfcGFzc3dvcmQgPSBoYXNoZWRQYXNzd29yZDtcbiAgICAgICAgZGVsZXRlIHRoaXMuZGF0YS5wYXNzd29yZDtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLl92YWxpZGF0ZVVzZXJOYW1lKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLl92YWxpZGF0ZUVtYWlsKCk7XG4gIH0pO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdmFsaWRhdGVVc2VyTmFtZSA9IGZ1bmN0aW9uICgpIHtcbiAgLy8gQ2hlY2sgZm9yIHVzZXJuYW1lIHVuaXF1ZW5lc3NcbiAgaWYgKCF0aGlzLmRhdGEudXNlcm5hbWUpIHtcbiAgICBpZiAoIXRoaXMucXVlcnkpIHtcbiAgICAgIHRoaXMuZGF0YS51c2VybmFtZSA9IGNyeXB0b1V0aWxzLnJhbmRvbVN0cmluZygyNSk7XG4gICAgICB0aGlzLnJlc3BvbnNlU2hvdWxkSGF2ZVVzZXJuYW1lID0gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG4gIC8vIFdlIG5lZWQgdG8gYSBmaW5kIHRvIGNoZWNrIGZvciBkdXBsaWNhdGUgdXNlcm5hbWUgaW4gY2FzZSB0aGV5IGFyZSBtaXNzaW5nIHRoZSB1bmlxdWUgaW5kZXggb24gdXNlcm5hbWVzXG4gIC8vIFRPRE86IENoZWNrIGlmIHRoZXJlIGlzIGEgdW5pcXVlIGluZGV4LCBhbmQgaWYgc28sIHNraXAgdGhpcyBxdWVyeS5cbiAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoXG4gICAgdGhpcy5jbGFzc05hbWUsXG4gICAge3VzZXJuYW1lOiB0aGlzLmRhdGEudXNlcm5hbWUsIG9iamVjdElkOiB7JyRuZSc6IHRoaXMub2JqZWN0SWQoKX19LFxuICAgIHtsaW1pdDogMX1cbiAgKS50aGVuKHJlc3VsdHMgPT4ge1xuICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5VU0VSTkFNRV9UQUtFTiwgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgdXNlcm5hbWUuJyk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfSk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLl92YWxpZGF0ZUVtYWlsID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5kYXRhLmVtYWlsIHx8IHRoaXMuZGF0YS5lbWFpbC5fX29wID09PSAnRGVsZXRlJykge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuICAvLyBWYWxpZGF0ZSBiYXNpYyBlbWFpbCBhZGRyZXNzIGZvcm1hdFxuICBpZiAoIXRoaXMuZGF0YS5lbWFpbC5tYXRjaCgvXi4rQC4rJC8pKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0VNQUlMX0FERFJFU1MsICdFbWFpbCBhZGRyZXNzIGZvcm1hdCBpcyBpbnZhbGlkLicpKTtcbiAgfVxuICAvLyBTYW1lIHByb2JsZW0gZm9yIGVtYWlsIGFzIGFib3ZlIGZvciB1c2VybmFtZVxuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZChcbiAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICB7ZW1haWw6IHRoaXMuZGF0YS5lbWFpbCwgb2JqZWN0SWQ6IHsnJG5lJzogdGhpcy5vYmplY3RJZCgpfX0sXG4gICAge2xpbWl0OiAxfVxuICApLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkVNQUlMX1RBS0VOLCAnQWNjb3VudCBhbHJlYWR5IGV4aXN0cyBmb3IgdGhpcyBlbWFpbCBhZGRyZXNzLicpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICAhdGhpcy5kYXRhLmF1dGhEYXRhIHx8XG4gICAgICAhT2JqZWN0LmtleXModGhpcy5kYXRhLmF1dGhEYXRhKS5sZW5ndGggfHxcbiAgICAgIE9iamVjdC5rZXlzKHRoaXMuZGF0YS5hdXRoRGF0YSkubGVuZ3RoID09PSAxICYmIE9iamVjdC5rZXlzKHRoaXMuZGF0YS5hdXRoRGF0YSlbMF0gPT09ICdhbm9ueW1vdXMnXG4gICAgKSB7XG4gICAgICAvLyBXZSB1cGRhdGVkIHRoZSBlbWFpbCwgc2VuZCBhIG5ldyB2YWxpZGF0aW9uXG4gICAgICB0aGlzLnN0b3JhZ2VbJ3NlbmRWZXJpZmljYXRpb25FbWFpbCddID0gdHJ1ZTtcbiAgICAgIHRoaXMuY29uZmlnLnVzZXJDb250cm9sbGVyLnNldEVtYWlsVmVyaWZ5VG9rZW4odGhpcy5kYXRhKTtcbiAgICB9XG4gIH0pO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdmFsaWRhdGVQYXNzd29yZFBvbGljeSA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5KVxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRlUGFzc3dvcmRSZXF1aXJlbWVudHMoKS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGVQYXNzd29yZEhpc3RvcnkoKTtcbiAgfSk7XG59O1xuXG5cblJlc3RXcml0ZS5wcm90b3R5cGUuX3ZhbGlkYXRlUGFzc3dvcmRSZXF1aXJlbWVudHMgPSBmdW5jdGlvbigpIHtcbiAgLy8gY2hlY2sgaWYgdGhlIHBhc3N3b3JkIGNvbmZvcm1zIHRvIHRoZSBkZWZpbmVkIHBhc3N3b3JkIHBvbGljeSBpZiBjb25maWd1cmVkXG4gIGNvbnN0IHBvbGljeUVycm9yID0gJ1Bhc3N3b3JkIGRvZXMgbm90IG1lZXQgdGhlIFBhc3N3b3JkIFBvbGljeSByZXF1aXJlbWVudHMuJztcblxuICAvLyBjaGVjayB3aGV0aGVyIHRoZSBwYXNzd29yZCBtZWV0cyB0aGUgcGFzc3dvcmQgc3RyZW5ndGggcmVxdWlyZW1lbnRzXG4gIGlmICh0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5wYXR0ZXJuVmFsaWRhdG9yICYmICF0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5wYXR0ZXJuVmFsaWRhdG9yKHRoaXMuZGF0YS5wYXNzd29yZCkgfHxcbiAgICB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS52YWxpZGF0b3JDYWxsYmFjayAmJiAhdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kudmFsaWRhdG9yQ2FsbGJhY2sodGhpcy5kYXRhLnBhc3N3b3JkKSkge1xuICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuVkFMSURBVElPTl9FUlJPUiwgcG9saWN5RXJyb3IpKTtcbiAgfVxuXG4gIC8vIGNoZWNrIHdoZXRoZXIgcGFzc3dvcmQgY29udGFpbiB1c2VybmFtZVxuICBpZiAodGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kuZG9Ob3RBbGxvd1VzZXJuYW1lID09PSB0cnVlKSB7XG4gICAgaWYgKHRoaXMuZGF0YS51c2VybmFtZSkgeyAvLyB1c2VybmFtZSBpcyBub3QgcGFzc2VkIGR1cmluZyBwYXNzd29yZCByZXNldFxuICAgICAgaWYgKHRoaXMuZGF0YS5wYXNzd29yZC5pbmRleE9mKHRoaXMuZGF0YS51c2VybmFtZSkgPj0gMClcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5WQUxJREFUSU9OX0VSUk9SLCBwb2xpY3lFcnJvcikpO1xuICAgIH0gZWxzZSB7IC8vIHJldHJpZXZlIHRoZSBVc2VyIG9iamVjdCB1c2luZyBvYmplY3RJZCBkdXJpbmcgcGFzc3dvcmQgcmVzZXRcbiAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKCdfVXNlcicsIHtvYmplY3RJZDogdGhpcy5vYmplY3RJZCgpfSlcbiAgICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoICE9IDEpIHtcbiAgICAgICAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHRoaXMuZGF0YS5wYXNzd29yZC5pbmRleE9mKHJlc3VsdHNbMF0udXNlcm5hbWUpID49IDApXG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlZBTElEQVRJT05fRVJST1IsIHBvbGljeUVycm9yKSk7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdmFsaWRhdGVQYXNzd29yZEhpc3RvcnkgPSBmdW5jdGlvbigpIHtcbiAgLy8gY2hlY2sgd2hldGhlciBwYXNzd29yZCBpcyByZXBlYXRpbmcgZnJvbSBzcGVjaWZpZWQgaGlzdG9yeVxuICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnkpIHtcbiAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZCgnX1VzZXInLCB7b2JqZWN0SWQ6IHRoaXMub2JqZWN0SWQoKX0sIHtrZXlzOiBbXCJfcGFzc3dvcmRfaGlzdG9yeVwiLCBcIl9oYXNoZWRfcGFzc3dvcmRcIl19KVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCAhPSAxKSB7XG4gICAgICAgICAgdGhyb3cgdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHVzZXIgPSByZXN1bHRzWzBdO1xuICAgICAgICBsZXQgb2xkUGFzc3dvcmRzID0gW107XG4gICAgICAgIGlmICh1c2VyLl9wYXNzd29yZF9oaXN0b3J5KVxuICAgICAgICAgIG9sZFBhc3N3b3JkcyA9IF8udGFrZSh1c2VyLl9wYXNzd29yZF9oaXN0b3J5LCB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnkgLSAxKTtcbiAgICAgICAgb2xkUGFzc3dvcmRzLnB1c2godXNlci5wYXNzd29yZCk7XG4gICAgICAgIGNvbnN0IG5ld1Bhc3N3b3JkID0gdGhpcy5kYXRhLnBhc3N3b3JkO1xuICAgICAgICAvLyBjb21wYXJlIHRoZSBuZXcgcGFzc3dvcmQgaGFzaCB3aXRoIGFsbCBvbGQgcGFzc3dvcmQgaGFzaGVzXG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gb2xkUGFzc3dvcmRzLm1hcChmdW5jdGlvbiAoaGFzaCkge1xuICAgICAgICAgIHJldHVybiBwYXNzd29yZENyeXB0by5jb21wYXJlKG5ld1Bhc3N3b3JkLCBoYXNoKS50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgICAgICAgIGlmIChyZXN1bHQpIC8vIHJlamVjdCBpZiB0aGVyZSBpcyBhIG1hdGNoXG4gICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcIlJFUEVBVF9QQVNTV09SRFwiKTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgICB9KVxuICAgICAgICB9KTtcbiAgICAgICAgLy8gd2FpdCBmb3IgYWxsIGNvbXBhcmlzb25zIHRvIGNvbXBsZXRlXG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcykudGhlbigoKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9KS5jYXRjaChlcnIgPT4ge1xuICAgICAgICAgIGlmIChlcnIgPT09IFwiUkVQRUFUX1BBU1NXT1JEXCIpIC8vIGEgbWF0Y2ggd2FzIGZvdW5kXG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlZBTElEQVRJT05fRVJST1IsIGBOZXcgcGFzc3dvcmQgc2hvdWxkIG5vdCBiZSB0aGUgc2FtZSBhcyBsYXN0ICR7dGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5fSBwYXNzd29yZHMuYCkpO1xuICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLmNyZWF0ZVNlc3Npb25Ub2tlbklmTmVlZGVkID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmNsYXNzTmFtZSAhPT0gJ19Vc2VyJykge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5xdWVyeSkge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXRoaXMuc3RvcmFnZVsnYXV0aFByb3ZpZGVyJ10gLy8gc2lnbnVwIGNhbGwsIHdpdGhcbiAgICAgICYmIHRoaXMuY29uZmlnLnByZXZlbnRMb2dpbldpdGhVbnZlcmlmaWVkRW1haWwgLy8gbm8gbG9naW4gd2l0aG91dCB2ZXJpZmljYXRpb25cbiAgICAgICYmIHRoaXMuY29uZmlnLnZlcmlmeVVzZXJFbWFpbHMpIHsgLy8gdmVyaWZpY2F0aW9uIGlzIG9uXG4gICAgcmV0dXJuOyAvLyBkbyBub3QgY3JlYXRlIHRoZSBzZXNzaW9uIHRva2VuIGluIHRoYXQgY2FzZSFcbiAgfVxuICByZXR1cm4gdGhpcy5jcmVhdGVTZXNzaW9uVG9rZW4oKTtcbn1cblxuUmVzdFdyaXRlLnByb3RvdHlwZS5jcmVhdGVTZXNzaW9uVG9rZW4gPSBmdW5jdGlvbigpIHtcbiAgLy8gY2xvdWQgaW5zdGFsbGF0aW9uSWQgZnJvbSBDbG91ZCBDb2RlLFxuICAvLyBuZXZlciBjcmVhdGUgc2Vzc2lvbiB0b2tlbnMgZnJvbSB0aGVyZS5cbiAgaWYgKHRoaXMuYXV0aC5pbnN0YWxsYXRpb25JZCAmJiB0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWQgPT09ICdjbG91ZCcpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCB7XG4gICAgc2Vzc2lvbkRhdGEsXG4gICAgY3JlYXRlU2Vzc2lvbixcbiAgfSA9IEF1dGguY3JlYXRlU2Vzc2lvbih0aGlzLmNvbmZpZywge1xuICAgIHVzZXJJZDogdGhpcy5vYmplY3RJZCgpLFxuICAgIGNyZWF0ZWRXaXRoOiB7XG4gICAgICAnYWN0aW9uJzogdGhpcy5zdG9yYWdlWydhdXRoUHJvdmlkZXInXSA/ICdsb2dpbicgOiAnc2lnbnVwJyxcbiAgICAgICdhdXRoUHJvdmlkZXInOiB0aGlzLnN0b3JhZ2VbJ2F1dGhQcm92aWRlciddIHx8ICdwYXNzd29yZCdcbiAgICB9LFxuICAgIGluc3RhbGxhdGlvbklkOiB0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWQsXG4gIH0pO1xuXG4gIGlmICh0aGlzLnJlc3BvbnNlICYmIHRoaXMucmVzcG9uc2UucmVzcG9uc2UpIHtcbiAgICB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlLnNlc3Npb25Ub2tlbiA9IHNlc3Npb25EYXRhLnNlc3Npb25Ub2tlbjtcbiAgfVxuXG4gIHJldHVybiBjcmVhdGVTZXNzaW9uKCk7XG59XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuZGVzdHJveUR1cGxpY2F0ZWRTZXNzaW9ucyA9IGZ1bmN0aW9uKCkge1xuICAvLyBPbmx5IGZvciBfU2Vzc2lvbiwgYW5kIGF0IGNyZWF0aW9uIHRpbWVcbiAgaWYgKHRoaXMuY2xhc3NOYW1lICE9ICdfU2Vzc2lvbicgfHwgdGhpcy5xdWVyeSkge1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBEZXN0cm95IHRoZSBzZXNzaW9ucyBpbiAnQmFja2dyb3VuZCdcbiAgY29uc3Qge1xuICAgIHVzZXIsXG4gICAgaW5zdGFsbGF0aW9uSWQsXG4gICAgc2Vzc2lvblRva2VuLFxuICB9ID0gdGhpcy5kYXRhO1xuICBpZiAoIXVzZXIgfHwgIWluc3RhbGxhdGlvbklkKSAge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXVzZXIub2JqZWN0SWQpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdGhpcy5jb25maWcuZGF0YWJhc2UuZGVzdHJveSgnX1Nlc3Npb24nLCB7XG4gICAgdXNlcixcbiAgICBpbnN0YWxsYXRpb25JZCxcbiAgICBzZXNzaW9uVG9rZW46IHsgJyRuZSc6IHNlc3Npb25Ub2tlbiB9LFxuICB9KTtcbn1cblxuLy8gSGFuZGxlcyBhbnkgZm9sbG93dXAgbG9naWNcblJlc3RXcml0ZS5wcm90b3R5cGUuaGFuZGxlRm9sbG93dXAgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuc3RvcmFnZSAmJiB0aGlzLnN0b3JhZ2VbJ2NsZWFyU2Vzc2lvbnMnXSAmJiB0aGlzLmNvbmZpZy5yZXZva2VTZXNzaW9uT25QYXNzd29yZFJlc2V0KSB7XG4gICAgdmFyIHNlc3Npb25RdWVyeSA9IHtcbiAgICAgIHVzZXI6IHtcbiAgICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICAgIGNsYXNzTmFtZTogJ19Vc2VyJyxcbiAgICAgICAgb2JqZWN0SWQ6IHRoaXMub2JqZWN0SWQoKVxuICAgICAgfVxuICAgIH07XG4gICAgZGVsZXRlIHRoaXMuc3RvcmFnZVsnY2xlYXJTZXNzaW9ucyddO1xuICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5kZXN0cm95KCdfU2Vzc2lvbicsIHNlc3Npb25RdWVyeSlcbiAgICAgIC50aGVuKHRoaXMuaGFuZGxlRm9sbG93dXAuYmluZCh0aGlzKSk7XG4gIH1cblxuICBpZiAodGhpcy5zdG9yYWdlICYmIHRoaXMuc3RvcmFnZVsnZ2VuZXJhdGVOZXdTZXNzaW9uJ10pIHtcbiAgICBkZWxldGUgdGhpcy5zdG9yYWdlWydnZW5lcmF0ZU5ld1Nlc3Npb24nXTtcbiAgICByZXR1cm4gdGhpcy5jcmVhdGVTZXNzaW9uVG9rZW4oKVxuICAgICAgLnRoZW4odGhpcy5oYW5kbGVGb2xsb3d1cC5iaW5kKHRoaXMpKTtcbiAgfVxuXG4gIGlmICh0aGlzLnN0b3JhZ2UgJiYgdGhpcy5zdG9yYWdlWydzZW5kVmVyaWZpY2F0aW9uRW1haWwnXSkge1xuICAgIGRlbGV0ZSB0aGlzLnN0b3JhZ2VbJ3NlbmRWZXJpZmljYXRpb25FbWFpbCddO1xuICAgIC8vIEZpcmUgYW5kIGZvcmdldCFcbiAgICB0aGlzLmNvbmZpZy51c2VyQ29udHJvbGxlci5zZW5kVmVyaWZpY2F0aW9uRW1haWwodGhpcy5kYXRhKTtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVGb2xsb3d1cC5iaW5kKHRoaXMpO1xuICB9XG59O1xuXG4vLyBIYW5kbGVzIHRoZSBfU2Vzc2lvbiBjbGFzcyBzcGVjaWFsbmVzcy5cbi8vIERvZXMgbm90aGluZyBpZiB0aGlzIGlzbid0IGFuIF9TZXNzaW9uIG9iamVjdC5cblJlc3RXcml0ZS5wcm90b3R5cGUuaGFuZGxlU2Vzc2lvbiA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5yZXNwb25zZSB8fCB0aGlzLmNsYXNzTmFtZSAhPT0gJ19TZXNzaW9uJykge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghdGhpcy5hdXRoLnVzZXIgJiYgIXRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1NFU1NJT05fVE9LRU4sXG4gICAgICAnU2Vzc2lvbiB0b2tlbiByZXF1aXJlZC4nKTtcbiAgfVxuXG4gIC8vIFRPRE86IFZlcmlmeSBwcm9wZXIgZXJyb3IgdG8gdGhyb3dcbiAgaWYgKHRoaXMuZGF0YS5BQ0wpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgJ0Nhbm5vdCBzZXQgJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICdBQ0wgb24gYSBTZXNzaW9uLicpO1xuICB9XG5cbiAgaWYgKHRoaXMucXVlcnkpIHtcbiAgICBpZiAodGhpcy5kYXRhLnVzZXIgJiYgIXRoaXMuYXV0aC5pc01hc3RlciAmJiB0aGlzLmRhdGEudXNlci5vYmplY3RJZCAhPSB0aGlzLmF1dGgudXNlci5pZCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5kYXRhLmluc3RhbGxhdGlvbklkKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmRhdGEuc2Vzc2lvblRva2VuKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSk7XG4gICAgfVxuICB9XG5cbiAgaWYgKCF0aGlzLnF1ZXJ5ICYmICF0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICBjb25zdCBhZGRpdGlvbmFsU2Vzc2lvbkRhdGEgPSB7fTtcbiAgICBmb3IgKHZhciBrZXkgaW4gdGhpcy5kYXRhKSB7XG4gICAgICBpZiAoa2V5ID09PSAnb2JqZWN0SWQnIHx8IGtleSA9PT0gJ3VzZXInKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgYWRkaXRpb25hbFNlc3Npb25EYXRhW2tleV0gPSB0aGlzLmRhdGFba2V5XTtcbiAgICB9XG5cbiAgICBjb25zdCB7IHNlc3Npb25EYXRhLCBjcmVhdGVTZXNzaW9uIH0gPSBBdXRoLmNyZWF0ZVNlc3Npb24odGhpcy5jb25maWcsIHtcbiAgICAgIHVzZXJJZDogdGhpcy5hdXRoLnVzZXIuaWQsXG4gICAgICBjcmVhdGVkV2l0aDoge1xuICAgICAgICBhY3Rpb246ICdjcmVhdGUnLFxuICAgICAgfSxcbiAgICAgIGFkZGl0aW9uYWxTZXNzaW9uRGF0YVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGNyZWF0ZVNlc3Npb24oKS50aGVuKChyZXN1bHRzKSA9PiB7XG4gICAgICBpZiAoIXJlc3VsdHMucmVzcG9uc2UpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUixcbiAgICAgICAgICAnRXJyb3IgY3JlYXRpbmcgc2Vzc2lvbi4nKTtcbiAgICAgIH1cbiAgICAgIHNlc3Npb25EYXRhWydvYmplY3RJZCddID0gcmVzdWx0cy5yZXNwb25zZVsnb2JqZWN0SWQnXTtcbiAgICAgIHRoaXMucmVzcG9uc2UgPSB7XG4gICAgICAgIHN0YXR1czogMjAxLFxuICAgICAgICBsb2NhdGlvbjogcmVzdWx0cy5sb2NhdGlvbixcbiAgICAgICAgcmVzcG9uc2U6IHNlc3Npb25EYXRhXG4gICAgICB9O1xuICAgIH0pO1xuICB9XG59O1xuXG4vLyBIYW5kbGVzIHRoZSBfSW5zdGFsbGF0aW9uIGNsYXNzIHNwZWNpYWxuZXNzLlxuLy8gRG9lcyBub3RoaW5nIGlmIHRoaXMgaXNuJ3QgYW4gaW5zdGFsbGF0aW9uIG9iamVjdC5cbi8vIElmIGFuIGluc3RhbGxhdGlvbiBpcyBmb3VuZCwgdGhpcyBjYW4gbXV0YXRlIHRoaXMucXVlcnkgYW5kIHR1cm4gYSBjcmVhdGVcbi8vIGludG8gYW4gdXBkYXRlLlxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIHdoZW4gd2UncmUgZG9uZSBpZiBpdCBjYW4ndCBmaW5pc2ggdGhpcyB0aWNrLlxuUmVzdFdyaXRlLnByb3RvdHlwZS5oYW5kbGVJbnN0YWxsYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMucmVzcG9uc2UgfHwgdGhpcy5jbGFzc05hbWUgIT09ICdfSW5zdGFsbGF0aW9uJykge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghdGhpcy5xdWVyeSAmJiAhdGhpcy5kYXRhLmRldmljZVRva2VuICYmICF0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQgJiYgIXRoaXMuYXV0aC5pbnN0YWxsYXRpb25JZCkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxMzUsXG4gICAgICAnYXQgbGVhc3Qgb25lIElEIGZpZWxkIChkZXZpY2VUb2tlbiwgaW5zdGFsbGF0aW9uSWQpICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAnbXVzdCBiZSBzcGVjaWZpZWQgaW4gdGhpcyBvcGVyYXRpb24nKTtcbiAgfVxuXG4gIC8vIElmIHRoZSBkZXZpY2UgdG9rZW4gaXMgNjQgY2hhcmFjdGVycyBsb25nLCB3ZSBhc3N1bWUgaXQgaXMgZm9yIGlPU1xuICAvLyBhbmQgbG93ZXJjYXNlIGl0LlxuICBpZiAodGhpcy5kYXRhLmRldmljZVRva2VuICYmIHRoaXMuZGF0YS5kZXZpY2VUb2tlbi5sZW5ndGggPT0gNjQpIHtcbiAgICB0aGlzLmRhdGEuZGV2aWNlVG9rZW4gPSB0aGlzLmRhdGEuZGV2aWNlVG9rZW4udG9Mb3dlckNhc2UoKTtcbiAgfVxuXG4gIC8vIFdlIGxvd2VyY2FzZSB0aGUgaW5zdGFsbGF0aW9uSWQgaWYgcHJlc2VudFxuICBpZiAodGhpcy5kYXRhLmluc3RhbGxhdGlvbklkKSB7XG4gICAgdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkID0gdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkLnRvTG93ZXJDYXNlKCk7XG4gIH1cblxuICBsZXQgaW5zdGFsbGF0aW9uSWQgPSB0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQ7XG5cbiAgLy8gSWYgZGF0YS5pbnN0YWxsYXRpb25JZCBpcyBub3Qgc2V0IGFuZCB3ZSdyZSBub3QgbWFzdGVyLCB3ZSBjYW4gbG9va3VwIGluIGF1dGhcbiAgaWYgKCFpbnN0YWxsYXRpb25JZCAmJiAhdGhpcy5hdXRoLmlzTWFzdGVyKSB7XG4gICAgaW5zdGFsbGF0aW9uSWQgPSB0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWQ7XG4gIH1cblxuICBpZiAoaW5zdGFsbGF0aW9uSWQpIHtcbiAgICBpbnN0YWxsYXRpb25JZCA9IGluc3RhbGxhdGlvbklkLnRvTG93ZXJDYXNlKCk7XG4gIH1cblxuICAvLyBVcGRhdGluZyBfSW5zdGFsbGF0aW9uIGJ1dCBub3QgdXBkYXRpbmcgYW55dGhpbmcgY3JpdGljYWxcbiAgaWYgKHRoaXMucXVlcnkgJiYgIXRoaXMuZGF0YS5kZXZpY2VUb2tlblxuICAgICAgICAgICAgICAgICAgJiYgIWluc3RhbGxhdGlvbklkICYmICF0aGlzLmRhdGEuZGV2aWNlVHlwZSkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHZhciBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cbiAgdmFyIGlkTWF0Y2g7IC8vIFdpbGwgYmUgYSBtYXRjaCBvbiBlaXRoZXIgb2JqZWN0SWQgb3IgaW5zdGFsbGF0aW9uSWRcbiAgdmFyIG9iamVjdElkTWF0Y2g7XG4gIHZhciBpbnN0YWxsYXRpb25JZE1hdGNoO1xuICB2YXIgZGV2aWNlVG9rZW5NYXRjaGVzID0gW107XG5cbiAgLy8gSW5zdGVhZCBvZiBpc3N1aW5nIDMgcmVhZHMsIGxldCdzIGRvIGl0IHdpdGggb25lIE9SLlxuICBjb25zdCBvclF1ZXJpZXMgPSBbXTtcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgIG9yUXVlcmllcy5wdXNoKHtcbiAgICAgIG9iamVjdElkOiB0aGlzLnF1ZXJ5Lm9iamVjdElkXG4gICAgfSk7XG4gIH1cbiAgaWYgKGluc3RhbGxhdGlvbklkKSB7XG4gICAgb3JRdWVyaWVzLnB1c2goe1xuICAgICAgJ2luc3RhbGxhdGlvbklkJzogaW5zdGFsbGF0aW9uSWRcbiAgICB9KTtcbiAgfVxuICBpZiAodGhpcy5kYXRhLmRldmljZVRva2VuKSB7XG4gICAgb3JRdWVyaWVzLnB1c2goeydkZXZpY2VUb2tlbic6IHRoaXMuZGF0YS5kZXZpY2VUb2tlbn0pO1xuICB9XG5cbiAgaWYgKG9yUXVlcmllcy5sZW5ndGggPT0gMCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHByb21pc2UgPSBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKCdfSW5zdGFsbGF0aW9uJywge1xuICAgICAgJyRvcic6IG9yUXVlcmllc1xuICAgIH0sIHt9KTtcbiAgfSkudGhlbigocmVzdWx0cykgPT4ge1xuICAgIHJlc3VsdHMuZm9yRWFjaCgocmVzdWx0KSA9PiB7XG4gICAgICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkICYmIHJlc3VsdC5vYmplY3RJZCA9PSB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgICAgIG9iamVjdElkTWF0Y2ggPSByZXN1bHQ7XG4gICAgICB9XG4gICAgICBpZiAocmVzdWx0Lmluc3RhbGxhdGlvbklkID09IGluc3RhbGxhdGlvbklkKSB7XG4gICAgICAgIGluc3RhbGxhdGlvbklkTWF0Y2ggPSByZXN1bHQ7XG4gICAgICB9XG4gICAgICBpZiAocmVzdWx0LmRldmljZVRva2VuID09IHRoaXMuZGF0YS5kZXZpY2VUb2tlbikge1xuICAgICAgICBkZXZpY2VUb2tlbk1hdGNoZXMucHVzaChyZXN1bHQpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gU2FuaXR5IGNoZWNrcyB3aGVuIHJ1bm5pbmcgYSBxdWVyeVxuICAgIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICAgIGlmICghb2JqZWN0SWRNYXRjaCkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCxcbiAgICAgICAgICAnT2JqZWN0IG5vdCBmb3VuZCBmb3IgdXBkYXRlLicpO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCAmJiBvYmplY3RJZE1hdGNoLmluc3RhbGxhdGlvbklkICYmXG4gICAgICAgICAgdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkICE9PSBvYmplY3RJZE1hdGNoLmluc3RhbGxhdGlvbklkKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxMzYsXG4gICAgICAgICAgJ2luc3RhbGxhdGlvbklkIG1heSBub3QgYmUgY2hhbmdlZCBpbiB0aGlzICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnb3BlcmF0aW9uJyk7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5kYXRhLmRldmljZVRva2VuICYmIG9iamVjdElkTWF0Y2guZGV2aWNlVG9rZW4gJiZcbiAgICAgICAgICB0aGlzLmRhdGEuZGV2aWNlVG9rZW4gIT09IG9iamVjdElkTWF0Y2guZGV2aWNlVG9rZW4gJiZcbiAgICAgICAgICAhdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkICYmICFvYmplY3RJZE1hdGNoLmluc3RhbGxhdGlvbklkKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxMzYsXG4gICAgICAgICAgJ2RldmljZVRva2VuIG1heSBub3QgYmUgY2hhbmdlZCBpbiB0aGlzICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnb3BlcmF0aW9uJyk7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5kYXRhLmRldmljZVR5cGUgJiYgdGhpcy5kYXRhLmRldmljZVR5cGUgJiZcbiAgICAgICAgICB0aGlzLmRhdGEuZGV2aWNlVHlwZSAhPT0gb2JqZWN0SWRNYXRjaC5kZXZpY2VUeXBlKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxMzYsXG4gICAgICAgICAgJ2RldmljZVR5cGUgbWF5IG5vdCBiZSBjaGFuZ2VkIGluIHRoaXMgJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdvcGVyYXRpb24nKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkICYmIG9iamVjdElkTWF0Y2gpIHtcbiAgICAgIGlkTWF0Y2ggPSBvYmplY3RJZE1hdGNoO1xuICAgIH1cblxuICAgIGlmIChpbnN0YWxsYXRpb25JZCAmJiBpbnN0YWxsYXRpb25JZE1hdGNoKSB7XG4gICAgICBpZE1hdGNoID0gaW5zdGFsbGF0aW9uSWRNYXRjaDtcbiAgICB9XG4gICAgLy8gbmVlZCB0byBzcGVjaWZ5IGRldmljZVR5cGUgb25seSBpZiBpdCdzIG5ld1xuICAgIGlmICghdGhpcy5xdWVyeSAmJiAhdGhpcy5kYXRhLmRldmljZVR5cGUgJiYgIWlkTWF0Y2gpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxMzUsXG4gICAgICAgICdkZXZpY2VUeXBlIG11c3QgYmUgc3BlY2lmaWVkIGluIHRoaXMgb3BlcmF0aW9uJyk7XG4gICAgfVxuXG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIGlmICghaWRNYXRjaCkge1xuICAgICAgaWYgKCFkZXZpY2VUb2tlbk1hdGNoZXMubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH0gZWxzZSBpZiAoZGV2aWNlVG9rZW5NYXRjaGVzLmxlbmd0aCA9PSAxICYmXG4gICAgICAgICghZGV2aWNlVG9rZW5NYXRjaGVzWzBdWydpbnN0YWxsYXRpb25JZCddIHx8ICFpbnN0YWxsYXRpb25JZClcbiAgICAgICkge1xuICAgICAgICAvLyBTaW5nbGUgbWF0Y2ggb24gZGV2aWNlIHRva2VuIGJ1dCBub25lIG9uIGluc3RhbGxhdGlvbklkLCBhbmQgZWl0aGVyXG4gICAgICAgIC8vIHRoZSBwYXNzZWQgb2JqZWN0IG9yIHRoZSBtYXRjaCBpcyBtaXNzaW5nIGFuIGluc3RhbGxhdGlvbklkLCBzbyB3ZVxuICAgICAgICAvLyBjYW4ganVzdCByZXR1cm4gdGhlIG1hdGNoLlxuICAgICAgICByZXR1cm4gZGV2aWNlVG9rZW5NYXRjaGVzWzBdWydvYmplY3RJZCddO1xuICAgICAgfSBlbHNlIGlmICghdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxMzIsXG4gICAgICAgICAgJ011c3Qgc3BlY2lmeSBpbnN0YWxsYXRpb25JZCB3aGVuIGRldmljZVRva2VuICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ21hdGNoZXMgbXVsdGlwbGUgSW5zdGFsbGF0aW9uIG9iamVjdHMnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIE11bHRpcGxlIGRldmljZSB0b2tlbiBtYXRjaGVzIGFuZCB3ZSBzcGVjaWZpZWQgYW4gaW5zdGFsbGF0aW9uIElELFxuICAgICAgICAvLyBvciBhIHNpbmdsZSBtYXRjaCB3aGVyZSBib3RoIHRoZSBwYXNzZWQgYW5kIG1hdGNoaW5nIG9iamVjdHMgaGF2ZVxuICAgICAgICAvLyBhbiBpbnN0YWxsYXRpb24gSUQuIFRyeSBjbGVhbmluZyBvdXQgb2xkIGluc3RhbGxhdGlvbnMgdGhhdCBtYXRjaFxuICAgICAgICAvLyB0aGUgZGV2aWNlVG9rZW4sIGFuZCByZXR1cm4gbmlsIHRvIHNpZ25hbCB0aGF0IGEgbmV3IG9iamVjdCBzaG91bGRcbiAgICAgICAgLy8gYmUgY3JlYXRlZC5cbiAgICAgICAgdmFyIGRlbFF1ZXJ5ID0ge1xuICAgICAgICAgICdkZXZpY2VUb2tlbic6IHRoaXMuZGF0YS5kZXZpY2VUb2tlbixcbiAgICAgICAgICAnaW5zdGFsbGF0aW9uSWQnOiB7XG4gICAgICAgICAgICAnJG5lJzogaW5zdGFsbGF0aW9uSWRcbiAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIGlmICh0aGlzLmRhdGEuYXBwSWRlbnRpZmllcikge1xuICAgICAgICAgIGRlbFF1ZXJ5WydhcHBJZGVudGlmaWVyJ10gPSB0aGlzLmRhdGEuYXBwSWRlbnRpZmllcjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmNvbmZpZy5kYXRhYmFzZS5kZXN0cm95KCdfSW5zdGFsbGF0aW9uJywgZGVsUXVlcnkpXG4gICAgICAgICAgLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyLmNvZGUgPT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCkge1xuICAgICAgICAgICAgICAvLyBubyBkZWxldGlvbnMgd2VyZSBtYWRlLiBDYW4gYmUgaWdub3JlZC5cbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gcmV0aHJvdyB0aGUgZXJyb3JcbiAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoZGV2aWNlVG9rZW5NYXRjaGVzLmxlbmd0aCA9PSAxICYmXG4gICAgICAgICFkZXZpY2VUb2tlbk1hdGNoZXNbMF1bJ2luc3RhbGxhdGlvbklkJ10pIHtcbiAgICAgICAgLy8gRXhhY3RseSBvbmUgZGV2aWNlIHRva2VuIG1hdGNoIGFuZCBpdCBkb2Vzbid0IGhhdmUgYW4gaW5zdGFsbGF0aW9uXG4gICAgICAgIC8vIElELiBUaGlzIGlzIHRoZSBvbmUgY2FzZSB3aGVyZSB3ZSB3YW50IHRvIG1lcmdlIHdpdGggdGhlIGV4aXN0aW5nXG4gICAgICAgIC8vIG9iamVjdC5cbiAgICAgICAgY29uc3QgZGVsUXVlcnkgPSB7b2JqZWN0SWQ6IGlkTWF0Y2gub2JqZWN0SWR9O1xuICAgICAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZGVzdHJveSgnX0luc3RhbGxhdGlvbicsIGRlbFF1ZXJ5KVxuICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBkZXZpY2VUb2tlbk1hdGNoZXNbMF1bJ29iamVjdElkJ107XG4gICAgICAgICAgfSlcbiAgICAgICAgICAuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICAgIGlmIChlcnIuY29kZSA9PSBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5EKSB7XG4gICAgICAgICAgICAgIC8vIG5vIGRlbGV0aW9ucyB3ZXJlIG1hZGUuIENhbiBiZSBpZ25vcmVkXG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIHJldGhyb3cgdGhlIGVycm9yXG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodGhpcy5kYXRhLmRldmljZVRva2VuICYmXG4gICAgICAgICAgaWRNYXRjaC5kZXZpY2VUb2tlbiAhPSB0aGlzLmRhdGEuZGV2aWNlVG9rZW4pIHtcbiAgICAgICAgICAvLyBXZSdyZSBzZXR0aW5nIHRoZSBkZXZpY2UgdG9rZW4gb24gYW4gZXhpc3RpbmcgaW5zdGFsbGF0aW9uLCBzb1xuICAgICAgICAgIC8vIHdlIHNob3VsZCB0cnkgY2xlYW5pbmcgb3V0IG9sZCBpbnN0YWxsYXRpb25zIHRoYXQgbWF0Y2ggdGhpc1xuICAgICAgICAgIC8vIGRldmljZSB0b2tlbi5cbiAgICAgICAgICBjb25zdCBkZWxRdWVyeSA9IHtcbiAgICAgICAgICAgICdkZXZpY2VUb2tlbic6IHRoaXMuZGF0YS5kZXZpY2VUb2tlbixcbiAgICAgICAgICB9O1xuICAgICAgICAgIC8vIFdlIGhhdmUgYSB1bmlxdWUgaW5zdGFsbCBJZCwgdXNlIHRoYXQgdG8gcHJlc2VydmVcbiAgICAgICAgICAvLyB0aGUgaW50ZXJlc3RpbmcgaW5zdGFsbGF0aW9uXG4gICAgICAgICAgaWYgKHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCkge1xuICAgICAgICAgICAgZGVsUXVlcnlbJ2luc3RhbGxhdGlvbklkJ10gPSB7XG4gICAgICAgICAgICAgICckbmUnOiB0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2UgaWYgKGlkTWF0Y2gub2JqZWN0SWQgJiYgdGhpcy5kYXRhLm9iamVjdElkXG4gICAgICAgICAgICAgICAgICAgICYmIGlkTWF0Y2gub2JqZWN0SWQgPT0gdGhpcy5kYXRhLm9iamVjdElkKSB7XG4gICAgICAgICAgICAvLyB3ZSBwYXNzZWQgYW4gb2JqZWN0SWQsIHByZXNlcnZlIHRoYXQgaW5zdGFsYXRpb25cbiAgICAgICAgICAgIGRlbFF1ZXJ5WydvYmplY3RJZCddID0ge1xuICAgICAgICAgICAgICAnJG5lJzogaWRNYXRjaC5vYmplY3RJZFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBXaGF0IHRvIGRvIGhlcmU/IGNhbid0IHJlYWxseSBjbGVhbiB1cCBldmVyeXRoaW5nLi4uXG4gICAgICAgICAgICByZXR1cm4gaWRNYXRjaC5vYmplY3RJZDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHRoaXMuZGF0YS5hcHBJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICBkZWxRdWVyeVsnYXBwSWRlbnRpZmllciddID0gdGhpcy5kYXRhLmFwcElkZW50aWZpZXI7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuY29uZmlnLmRhdGFiYXNlLmRlc3Ryb3koJ19JbnN0YWxsYXRpb24nLCBkZWxRdWVyeSlcbiAgICAgICAgICAgIC5jYXRjaChlcnIgPT4ge1xuICAgICAgICAgICAgICBpZiAoZXJyLmNvZGUgPT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCkge1xuICAgICAgICAgICAgICAgIC8vIG5vIGRlbGV0aW9ucyB3ZXJlIG1hZGUuIENhbiBiZSBpZ25vcmVkLlxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAvLyByZXRocm93IHRoZSBlcnJvclxuICAgICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICAvLyBJbiBub24tbWVyZ2Ugc2NlbmFyaW9zLCBqdXN0IHJldHVybiB0aGUgaW5zdGFsbGF0aW9uIG1hdGNoIGlkXG4gICAgICAgIHJldHVybiBpZE1hdGNoLm9iamVjdElkO1xuICAgICAgfVxuICAgIH1cbiAgfSkudGhlbigob2JqSWQpID0+IHtcbiAgICBpZiAob2JqSWQpIHtcbiAgICAgIHRoaXMucXVlcnkgPSB7b2JqZWN0SWQ6IG9iaklkfTtcbiAgICAgIGRlbGV0ZSB0aGlzLmRhdGEub2JqZWN0SWQ7XG4gICAgICBkZWxldGUgdGhpcy5kYXRhLmNyZWF0ZWRBdDtcbiAgICB9XG4gICAgLy8gVE9ETzogVmFsaWRhdGUgb3BzIChhZGQvcmVtb3ZlIG9uIGNoYW5uZWxzLCAkaW5jIG9uIGJhZGdlLCBldGMuKVxuICB9KTtcbiAgcmV0dXJuIHByb21pc2U7XG59O1xuXG4vLyBJZiB3ZSBzaG9ydC1jaXJjdXRlZCB0aGUgb2JqZWN0IHJlc3BvbnNlIC0gdGhlbiB3ZSBuZWVkIHRvIG1ha2Ugc3VyZSB3ZSBleHBhbmQgYWxsIHRoZSBmaWxlcyxcbi8vIHNpbmNlIHRoaXMgbWlnaHQgbm90IGhhdmUgYSBxdWVyeSwgbWVhbmluZyBpdCB3b24ndCByZXR1cm4gdGhlIGZ1bGwgcmVzdWx0IGJhY2suXG4vLyBUT0RPOiAobmx1dHNlbmtvKSBUaGlzIHNob3VsZCBkaWUgd2hlbiB3ZSBtb3ZlIHRvIHBlci1jbGFzcyBiYXNlZCBjb250cm9sbGVycyBvbiBfU2Vzc2lvbi9fVXNlclxuUmVzdFdyaXRlLnByb3RvdHlwZS5leHBhbmRGaWxlc0ZvckV4aXN0aW5nT2JqZWN0cyA9IGZ1bmN0aW9uKCkge1xuICAvLyBDaGVjayB3aGV0aGVyIHdlIGhhdmUgYSBzaG9ydC1jaXJjdWl0ZWQgcmVzcG9uc2UgLSBvbmx5IHRoZW4gcnVuIGV4cGFuc2lvbi5cbiAgaWYgKHRoaXMucmVzcG9uc2UgJiYgdGhpcy5yZXNwb25zZS5yZXNwb25zZSkge1xuICAgIHRoaXMuY29uZmlnLmZpbGVzQ29udHJvbGxlci5leHBhbmRGaWxlc0luT2JqZWN0KHRoaXMuY29uZmlnLCB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlKTtcbiAgfVxufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5ydW5EYXRhYmFzZU9wZXJhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5yZXNwb25zZSkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Sb2xlJykge1xuICAgIHRoaXMuY29uZmlnLmNhY2hlQ29udHJvbGxlci5yb2xlLmNsZWFyKCk7XG4gIH1cblxuICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgJiZcbiAgICAgIHRoaXMucXVlcnkgJiZcbiAgICAgIHRoaXMuYXV0aC5pc1VuYXV0aGVudGljYXRlZCgpKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlNFU1NJT05fTUlTU0lORywgYENhbm5vdCBtb2RpZnkgdXNlciAke3RoaXMucXVlcnkub2JqZWN0SWR9LmApO1xuICB9XG5cbiAgaWYgKHRoaXMuY2xhc3NOYW1lID09PSAnX1Byb2R1Y3QnICYmIHRoaXMuZGF0YS5kb3dubG9hZCkge1xuICAgIHRoaXMuZGF0YS5kb3dubG9hZE5hbWUgPSB0aGlzLmRhdGEuZG93bmxvYWQubmFtZTtcbiAgfVxuXG4gIC8vIFRPRE86IEFkZCBiZXR0ZXIgZGV0ZWN0aW9uIGZvciBBQ0wsIGVuc3VyaW5nIGEgdXNlciBjYW4ndCBiZSBsb2NrZWQgZnJvbVxuICAvLyAgICAgICB0aGVpciBvd24gdXNlciByZWNvcmQuXG4gIGlmICh0aGlzLmRhdGEuQUNMICYmIHRoaXMuZGF0YS5BQ0xbJyp1bnJlc29sdmVkJ10pIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9BQ0wsICdJbnZhbGlkIEFDTC4nKTtcbiAgfVxuXG4gIGlmICh0aGlzLnF1ZXJ5KSB7XG4gICAgLy8gRm9yY2UgdGhlIHVzZXIgdG8gbm90IGxvY2tvdXRcbiAgICAvLyBNYXRjaGVkIHdpdGggcGFyc2UuY29tXG4gICAgaWYgKHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInICYmIHRoaXMuZGF0YS5BQ0wgJiYgdGhpcy5hdXRoLmlzTWFzdGVyICE9PSB0cnVlKSB7XG4gICAgICB0aGlzLmRhdGEuQUNMW3RoaXMucXVlcnkub2JqZWN0SWRdID0geyByZWFkOiB0cnVlLCB3cml0ZTogdHJ1ZSB9O1xuICAgIH1cbiAgICAvLyB1cGRhdGUgcGFzc3dvcmQgdGltZXN0YW1wIGlmIHVzZXIgcGFzc3dvcmQgaXMgYmVpbmcgY2hhbmdlZFxuICAgIGlmICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJyAmJiB0aGlzLmRhdGEuX2hhc2hlZF9wYXNzd29yZCAmJiB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeSAmJiB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEFnZSkge1xuICAgICAgdGhpcy5kYXRhLl9wYXNzd29yZF9jaGFuZ2VkX2F0ID0gUGFyc2UuX2VuY29kZShuZXcgRGF0ZSgpKTtcbiAgICB9XG4gICAgLy8gSWdub3JlIGNyZWF0ZWRBdCB3aGVuIHVwZGF0ZVxuICAgIGRlbGV0ZSB0aGlzLmRhdGEuY3JlYXRlZEF0O1xuXG4gICAgbGV0IGRlZmVyID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgLy8gaWYgcGFzc3dvcmQgaGlzdG9yeSBpcyBlbmFibGVkIHRoZW4gc2F2ZSB0aGUgY3VycmVudCBwYXNzd29yZCB0byBoaXN0b3J5XG4gICAgaWYgKHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInICYmIHRoaXMuZGF0YS5faGFzaGVkX3Bhc3N3b3JkICYmIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5ICYmIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkSGlzdG9yeSkge1xuICAgICAgZGVmZXIgPSB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKCdfVXNlcicsIHtvYmplY3RJZDogdGhpcy5vYmplY3RJZCgpfSwge2tleXM6IFtcIl9wYXNzd29yZF9oaXN0b3J5XCIsIFwiX2hhc2hlZF9wYXNzd29yZFwiXX0pLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCAhPSAxKSB7XG4gICAgICAgICAgdGhyb3cgdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHVzZXIgPSByZXN1bHRzWzBdO1xuICAgICAgICBsZXQgb2xkUGFzc3dvcmRzID0gW107XG4gICAgICAgIGlmICh1c2VyLl9wYXNzd29yZF9oaXN0b3J5KSB7XG4gICAgICAgICAgb2xkUGFzc3dvcmRzID0gXy50YWtlKHVzZXIuX3Bhc3N3b3JkX2hpc3RvcnksIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkSGlzdG9yeSk7XG4gICAgICAgIH1cbiAgICAgICAgLy9uLTEgcGFzc3dvcmRzIGdvIGludG8gaGlzdG9yeSBpbmNsdWRpbmcgbGFzdCBwYXNzd29yZFxuICAgICAgICB3aGlsZSAob2xkUGFzc3dvcmRzLmxlbmd0aCA+IHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkSGlzdG9yeSAtIDIpIHtcbiAgICAgICAgICBvbGRQYXNzd29yZHMuc2hpZnQoKTtcbiAgICAgICAgfVxuICAgICAgICBvbGRQYXNzd29yZHMucHVzaCh1c2VyLnBhc3N3b3JkKTtcbiAgICAgICAgdGhpcy5kYXRhLl9wYXNzd29yZF9oaXN0b3J5ID0gb2xkUGFzc3dvcmRzO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGRlZmVyLnRoZW4oKCkgPT4ge1xuICAgICAgLy8gUnVuIGFuIHVwZGF0ZVxuICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLnVwZGF0ZSh0aGlzLmNsYXNzTmFtZSwgdGhpcy5xdWVyeSwgdGhpcy5kYXRhLCB0aGlzLnJ1bk9wdGlvbnMpXG4gICAgICAgIC50aGVuKHJlc3BvbnNlID0+IHtcbiAgICAgICAgICByZXNwb25zZS51cGRhdGVkQXQgPSB0aGlzLnVwZGF0ZWRBdDtcbiAgICAgICAgICB0aGlzLl91cGRhdGVSZXNwb25zZVdpdGhEYXRhKHJlc3BvbnNlLCB0aGlzLmRhdGEpO1xuICAgICAgICAgIHRoaXMucmVzcG9uc2UgPSB7IHJlc3BvbnNlIH07XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIC8vIFNldCB0aGUgZGVmYXVsdCBBQ0wgYW5kIHBhc3N3b3JkIHRpbWVzdGFtcCBmb3IgdGhlIG5ldyBfVXNlclxuICAgIGlmICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgICAgdmFyIEFDTCA9IHRoaXMuZGF0YS5BQ0w7XG4gICAgICAvLyBkZWZhdWx0IHB1YmxpYyByL3cgQUNMXG4gICAgICBpZiAoIUFDTCkge1xuICAgICAgICBBQ0wgPSB7fTtcbiAgICAgICAgQUNMWycqJ10gPSB7IHJlYWQ6IHRydWUsIHdyaXRlOiBmYWxzZSB9O1xuICAgICAgfVxuICAgICAgLy8gbWFrZSBzdXJlIHRoZSB1c2VyIGlzIG5vdCBsb2NrZWQgZG93blxuICAgICAgQUNMW3RoaXMuZGF0YS5vYmplY3RJZF0gPSB7IHJlYWQ6IHRydWUsIHdyaXRlOiB0cnVlIH07XG4gICAgICB0aGlzLmRhdGEuQUNMID0gQUNMO1xuICAgICAgLy8gcGFzc3dvcmQgdGltZXN0YW1wIHRvIGJlIHVzZWQgd2hlbiBwYXNzd29yZCBleHBpcnkgcG9saWN5IGlzIGVuZm9yY2VkXG4gICAgICBpZiAodGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kgJiYgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRBZ2UpIHtcbiAgICAgICAgdGhpcy5kYXRhLl9wYXNzd29yZF9jaGFuZ2VkX2F0ID0gUGFyc2UuX2VuY29kZShuZXcgRGF0ZSgpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSdW4gYSBjcmVhdGVcbiAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuY3JlYXRlKHRoaXMuY2xhc3NOYW1lLCB0aGlzLmRhdGEsIHRoaXMucnVuT3B0aW9ucylcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmICh0aGlzLmNsYXNzTmFtZSAhPT0gJ19Vc2VyJyB8fCBlcnJvci5jb2RlICE9PSBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFF1aWNrIGNoZWNrLCBpZiB3ZSB3ZXJlIGFibGUgdG8gaW5mZXIgdGhlIGR1cGxpY2F0ZWQgZmllbGQgbmFtZVxuICAgICAgICBpZiAoZXJyb3IgJiYgZXJyb3IudXNlckluZm8gJiYgZXJyb3IudXNlckluZm8uZHVwbGljYXRlZF9maWVsZCA9PT0gJ3VzZXJuYW1lJykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5VU0VSTkFNRV9UQUtFTiwgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgdXNlcm5hbWUuJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZXJyb3IgJiYgZXJyb3IudXNlckluZm8gJiYgZXJyb3IudXNlckluZm8uZHVwbGljYXRlZF9maWVsZCA9PT0gJ2VtYWlsJykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5FTUFJTF9UQUtFTiwgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgZW1haWwgYWRkcmVzcy4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIHRoaXMgd2FzIGEgZmFpbGVkIHVzZXIgY3JlYXRpb24gZHVlIHRvIHVzZXJuYW1lIG9yIGVtYWlsIGFscmVhZHkgdGFrZW4sIHdlIG5lZWQgdG9cbiAgICAgICAgLy8gY2hlY2sgd2hldGhlciBpdCB3YXMgdXNlcm5hbWUgb3IgZW1haWwgYW5kIHJldHVybiB0aGUgYXBwcm9wcmlhdGUgZXJyb3IuXG4gICAgICAgIC8vIEZhbGxiYWNrIHRvIHRoZSBvcmlnaW5hbCBtZXRob2RcbiAgICAgICAgLy8gVE9ETzogU2VlIGlmIHdlIGNhbiBsYXRlciBkbyB0aGlzIHdpdGhvdXQgYWRkaXRpb25hbCBxdWVyaWVzIGJ5IHVzaW5nIG5hbWVkIGluZGV4ZXMuXG4gICAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKFxuICAgICAgICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgICAgICAgIHsgdXNlcm5hbWU6IHRoaXMuZGF0YS51c2VybmFtZSwgb2JqZWN0SWQ6IHsnJG5lJzogdGhpcy5vYmplY3RJZCgpfSB9LFxuICAgICAgICAgIHsgbGltaXQ6IDEgfVxuICAgICAgICApXG4gICAgICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5VU0VSTkFNRV9UQUtFTiwgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgdXNlcm5hbWUuJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZChcbiAgICAgICAgICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICAgICAgICAgIHsgZW1haWw6IHRoaXMuZGF0YS5lbWFpbCwgb2JqZWN0SWQ6IHsnJG5lJzogdGhpcy5vYmplY3RJZCgpfSB9LFxuICAgICAgICAgICAgICB7IGxpbWl0OiAxIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkVNQUlMX1RBS0VOLCAnQWNjb3VudCBhbHJlYWR5IGV4aXN0cyBmb3IgdGhpcyBlbWFpbCBhZGRyZXNzLicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSwgJ0EgZHVwbGljYXRlIHZhbHVlIGZvciBhIGZpZWxkIHdpdGggdW5pcXVlIHZhbHVlcyB3YXMgcHJvdmlkZWQnKTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAudGhlbihyZXNwb25zZSA9PiB7XG4gICAgICAgIHJlc3BvbnNlLm9iamVjdElkID0gdGhpcy5kYXRhLm9iamVjdElkO1xuICAgICAgICByZXNwb25zZS5jcmVhdGVkQXQgPSB0aGlzLmRhdGEuY3JlYXRlZEF0O1xuXG4gICAgICAgIGlmICh0aGlzLnJlc3BvbnNlU2hvdWxkSGF2ZVVzZXJuYW1lKSB7XG4gICAgICAgICAgcmVzcG9uc2UudXNlcm5hbWUgPSB0aGlzLmRhdGEudXNlcm5hbWU7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdXBkYXRlUmVzcG9uc2VXaXRoRGF0YShyZXNwb25zZSwgdGhpcy5kYXRhKTtcbiAgICAgICAgdGhpcy5yZXNwb25zZSA9IHtcbiAgICAgICAgICBzdGF0dXM6IDIwMSxcbiAgICAgICAgICByZXNwb25zZSxcbiAgICAgICAgICBsb2NhdGlvbjogdGhpcy5sb2NhdGlvbigpXG4gICAgICAgIH07XG4gICAgICB9KTtcbiAgfVxufTtcblxuLy8gUmV0dXJucyBub3RoaW5nIC0gZG9lc24ndCB3YWl0IGZvciB0aGUgdHJpZ2dlci5cblJlc3RXcml0ZS5wcm90b3R5cGUucnVuQWZ0ZXJUcmlnZ2VyID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5yZXNwb25zZSB8fCAhdGhpcy5yZXNwb25zZS5yZXNwb25zZSkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIEF2b2lkIGRvaW5nIGFueSBzZXR1cCBmb3IgdHJpZ2dlcnMgaWYgdGhlcmUgaXMgbm8gJ2FmdGVyU2F2ZScgdHJpZ2dlciBmb3IgdGhpcyBjbGFzcy5cbiAgY29uc3QgaGFzQWZ0ZXJTYXZlSG9vayA9IHRyaWdnZXJzLnRyaWdnZXJFeGlzdHModGhpcy5jbGFzc05hbWUsIHRyaWdnZXJzLlR5cGVzLmFmdGVyU2F2ZSwgdGhpcy5jb25maWcuYXBwbGljYXRpb25JZCk7XG4gIGNvbnN0IGhhc0xpdmVRdWVyeSA9IHRoaXMuY29uZmlnLmxpdmVRdWVyeUNvbnRyb2xsZXIuaGFzTGl2ZVF1ZXJ5KHRoaXMuY2xhc3NOYW1lKTtcbiAgaWYgKCFoYXNBZnRlclNhdmVIb29rICYmICFoYXNMaXZlUXVlcnkpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICB2YXIgZXh0cmFEYXRhID0ge2NsYXNzTmFtZTogdGhpcy5jbGFzc05hbWV9O1xuICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgZXh0cmFEYXRhLm9iamVjdElkID0gdGhpcy5xdWVyeS5vYmplY3RJZDtcbiAgfVxuXG4gIC8vIEJ1aWxkIHRoZSBvcmlnaW5hbCBvYmplY3QsIHdlIG9ubHkgZG8gdGhpcyBmb3IgYSB1cGRhdGUgd3JpdGUuXG4gIGxldCBvcmlnaW5hbE9iamVjdDtcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgIG9yaWdpbmFsT2JqZWN0ID0gdHJpZ2dlcnMuaW5mbGF0ZShleHRyYURhdGEsIHRoaXMub3JpZ2luYWxEYXRhKTtcbiAgfVxuXG4gIC8vIEJ1aWxkIHRoZSBpbmZsYXRlZCBvYmplY3QsIGRpZmZlcmVudCBmcm9tIGJlZm9yZVNhdmUsIG9yaWdpbmFsRGF0YSBpcyBub3QgZW1wdHlcbiAgLy8gc2luY2UgZGV2ZWxvcGVycyBjYW4gY2hhbmdlIGRhdGEgaW4gdGhlIGJlZm9yZVNhdmUuXG4gIGNvbnN0IHVwZGF0ZWRPYmplY3QgPSB0aGlzLmJ1aWxkVXBkYXRlZE9iamVjdChleHRyYURhdGEpO1xuICB1cGRhdGVkT2JqZWN0Ll9oYW5kbGVTYXZlUmVzcG9uc2UodGhpcy5yZXNwb25zZS5yZXNwb25zZSwgdGhpcy5yZXNwb25zZS5zdGF0dXMgfHwgMjAwKTtcblxuICAvLyBOb3RpZml5IExpdmVRdWVyeVNlcnZlciBpZiBwb3NzaWJsZVxuICB0aGlzLmNvbmZpZy5saXZlUXVlcnlDb250cm9sbGVyLm9uQWZ0ZXJTYXZlKHVwZGF0ZWRPYmplY3QuY2xhc3NOYW1lLCB1cGRhdGVkT2JqZWN0LCBvcmlnaW5hbE9iamVjdCk7XG5cbiAgLy8gUnVuIGFmdGVyU2F2ZSB0cmlnZ2VyXG4gIHJldHVybiB0cmlnZ2Vycy5tYXliZVJ1blRyaWdnZXIodHJpZ2dlcnMuVHlwZXMuYWZ0ZXJTYXZlLCB0aGlzLmF1dGgsIHVwZGF0ZWRPYmplY3QsIG9yaWdpbmFsT2JqZWN0LCB0aGlzLmNvbmZpZylcbiAgICAuY2F0Y2goZnVuY3Rpb24oZXJyKSB7XG4gICAgICBsb2dnZXIud2FybignYWZ0ZXJTYXZlIGNhdWdodCBhbiBlcnJvcicsIGVycik7XG4gICAgfSlcbn07XG5cbi8vIEEgaGVscGVyIHRvIGZpZ3VyZSBvdXQgd2hhdCBsb2NhdGlvbiB0aGlzIG9wZXJhdGlvbiBoYXBwZW5zIGF0LlxuUmVzdFdyaXRlLnByb3RvdHlwZS5sb2NhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICB2YXIgbWlkZGxlID0gKHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInID8gJy91c2Vycy8nIDpcbiAgICAnL2NsYXNzZXMvJyArIHRoaXMuY2xhc3NOYW1lICsgJy8nKTtcbiAgcmV0dXJuIHRoaXMuY29uZmlnLm1vdW50ICsgbWlkZGxlICsgdGhpcy5kYXRhLm9iamVjdElkO1xufTtcblxuLy8gQSBoZWxwZXIgdG8gZ2V0IHRoZSBvYmplY3QgaWQgZm9yIHRoaXMgb3BlcmF0aW9uLlxuLy8gQmVjYXVzZSBpdCBjb3VsZCBiZSBlaXRoZXIgb24gdGhlIHF1ZXJ5IG9yIG9uIHRoZSBkYXRhXG5SZXN0V3JpdGUucHJvdG90eXBlLm9iamVjdElkID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmRhdGEub2JqZWN0SWQgfHwgdGhpcy5xdWVyeS5vYmplY3RJZDtcbn07XG5cbi8vIFJldHVybnMgYSBjb3B5IG9mIHRoZSBkYXRhIGFuZCBkZWxldGUgYmFkIGtleXMgKF9hdXRoX2RhdGEsIF9oYXNoZWRfcGFzc3dvcmQuLi4pXG5SZXN0V3JpdGUucHJvdG90eXBlLnNhbml0aXplZERhdGEgPSBmdW5jdGlvbigpIHtcbiAgY29uc3QgZGF0YSA9IE9iamVjdC5rZXlzKHRoaXMuZGF0YSkucmVkdWNlKChkYXRhLCBrZXkpID0+IHtcbiAgICAvLyBSZWdleHAgY29tZXMgZnJvbSBQYXJzZS5PYmplY3QucHJvdG90eXBlLnZhbGlkYXRlXG4gICAgaWYgKCEoL15bQS1aYS16XVswLTlBLVphLXpfXSokLykudGVzdChrZXkpKSB7XG4gICAgICBkZWxldGUgZGF0YVtrZXldO1xuICAgIH1cbiAgICByZXR1cm4gZGF0YTtcbiAgfSwgZGVlcGNvcHkodGhpcy5kYXRhKSk7XG4gIHJldHVybiBQYXJzZS5fZGVjb2RlKHVuZGVmaW5lZCwgZGF0YSk7XG59XG5cbi8vIFJldHVybnMgYW4gdXBkYXRlZCBjb3B5IG9mIHRoZSBvYmplY3RcblJlc3RXcml0ZS5wcm90b3R5cGUuYnVpbGRVcGRhdGVkT2JqZWN0ID0gZnVuY3Rpb24gKGV4dHJhRGF0YSkge1xuICBjb25zdCB1cGRhdGVkT2JqZWN0ID0gdHJpZ2dlcnMuaW5mbGF0ZShleHRyYURhdGEsIHRoaXMub3JpZ2luYWxEYXRhKTtcbiAgT2JqZWN0LmtleXModGhpcy5kYXRhKS5yZWR1Y2UoZnVuY3Rpb24gKGRhdGEsIGtleSkge1xuICAgIGlmIChrZXkuaW5kZXhPZihcIi5cIikgPiAwKSB7XG4gICAgICAvLyBzdWJkb2N1bWVudCBrZXkgd2l0aCBkb3Qgbm90YXRpb24gKCd4LnknOnYgPT4gJ3gnOnsneSc6dn0pXG4gICAgICBjb25zdCBzcGxpdHRlZEtleSA9IGtleS5zcGxpdChcIi5cIik7XG4gICAgICBjb25zdCBwYXJlbnRQcm9wID0gc3BsaXR0ZWRLZXlbMF07XG4gICAgICBsZXQgcGFyZW50VmFsID0gdXBkYXRlZE9iamVjdC5nZXQocGFyZW50UHJvcCk7XG4gICAgICBpZih0eXBlb2YgcGFyZW50VmFsICE9PSAnb2JqZWN0Jykge1xuICAgICAgICBwYXJlbnRWYWwgPSB7fTtcbiAgICAgIH1cbiAgICAgIHBhcmVudFZhbFtzcGxpdHRlZEtleVsxXV0gPSBkYXRhW2tleV07XG4gICAgICB1cGRhdGVkT2JqZWN0LnNldChwYXJlbnRQcm9wLCBwYXJlbnRWYWwpO1xuICAgICAgZGVsZXRlIGRhdGFba2V5XTtcbiAgICB9XG4gICAgcmV0dXJuIGRhdGE7XG4gIH0sIGRlZXBjb3B5KHRoaXMuZGF0YSkpO1xuXG4gIHVwZGF0ZWRPYmplY3Quc2V0KHRoaXMuc2FuaXRpemVkRGF0YSgpKTtcbiAgcmV0dXJuIHVwZGF0ZWRPYmplY3Q7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLmNsZWFuVXNlckF1dGhEYXRhID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnJlc3BvbnNlICYmIHRoaXMucmVzcG9uc2UucmVzcG9uc2UgJiYgdGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBjb25zdCB1c2VyID0gdGhpcy5yZXNwb25zZS5yZXNwb25zZTtcbiAgICBpZiAodXNlci5hdXRoRGF0YSkge1xuICAgICAgT2JqZWN0LmtleXModXNlci5hdXRoRGF0YSkuZm9yRWFjaCgocHJvdmlkZXIpID0+IHtcbiAgICAgICAgaWYgKHVzZXIuYXV0aERhdGFbcHJvdmlkZXJdID09PSBudWxsKSB7XG4gICAgICAgICAgZGVsZXRlIHVzZXIuYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGlmIChPYmplY3Qua2V5cyh1c2VyLmF1dGhEYXRhKS5sZW5ndGggPT0gMCkge1xuICAgICAgICBkZWxldGUgdXNlci5hdXRoRGF0YTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuX3VwZGF0ZVJlc3BvbnNlV2l0aERhdGEgPSBmdW5jdGlvbihyZXNwb25zZSwgZGF0YSkge1xuICBpZiAoXy5pc0VtcHR5KHRoaXMuc3RvcmFnZS5maWVsZHNDaGFuZ2VkQnlUcmlnZ2VyKSkge1xuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuICBjb25zdCBjbGllbnRTdXBwb3J0c0RlbGV0ZSA9IENsaWVudFNESy5zdXBwb3J0c0ZvcndhcmREZWxldGUodGhpcy5jbGllbnRTREspO1xuICB0aGlzLnN0b3JhZ2UuZmllbGRzQ2hhbmdlZEJ5VHJpZ2dlci5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgY29uc3QgZGF0YVZhbHVlID0gZGF0YVtmaWVsZE5hbWVdO1xuXG4gICAgaWYoIXJlc3BvbnNlLmhhc093blByb3BlcnR5KGZpZWxkTmFtZSkpIHtcbiAgICAgIHJlc3BvbnNlW2ZpZWxkTmFtZV0gPSBkYXRhVmFsdWU7XG4gICAgfVxuXG4gICAgLy8gU3RyaXBzIG9wZXJhdGlvbnMgZnJvbSByZXNwb25zZXNcbiAgICBpZiAocmVzcG9uc2VbZmllbGROYW1lXSAmJiByZXNwb25zZVtmaWVsZE5hbWVdLl9fb3ApIHtcbiAgICAgIGRlbGV0ZSByZXNwb25zZVtmaWVsZE5hbWVdO1xuICAgICAgaWYgKGNsaWVudFN1cHBvcnRzRGVsZXRlICYmIGRhdGFWYWx1ZS5fX29wID09ICdEZWxldGUnKSB7XG4gICAgICAgIHJlc3BvbnNlW2ZpZWxkTmFtZV0gPSBkYXRhVmFsdWU7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIHJlc3BvbnNlO1xufVxuXG5leHBvcnQgZGVmYXVsdCBSZXN0V3JpdGU7XG5tb2R1bGUuZXhwb3J0cyA9IFJlc3RXcml0ZTtcbiJdfQ==