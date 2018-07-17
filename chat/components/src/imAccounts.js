/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;
Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("resource:///modules/imServices.jsm");
Cu.import("resource:///modules/jsProtoHelper.jsm");

var kPrefAutologinPending = "messenger.accounts.autoLoginPending";
var kPrefMessengerAccounts = "messenger.accounts";
var kPrefAccountPrefix = "messenger.account.";
var kAccountKeyPrefix = "account";
var kAccountOptionPrefPrefix = "options.";
var kPrefAccountName = "name";
var kPrefAccountPrpl = "prpl";
var kPrefAccountAutoLogin = "autoLogin";
var kPrefAccountAutoJoin = "autoJoin";
var kPrefAccountAlias = "alias";
var kPrefAccountFirstConnectionState = "firstConnectionState";

var kPrefConvertOldPasswords = "messenger.accounts.convertOldPasswords";
var kPrefAccountPassword = "password";

XPCOMUtils.defineLazyGetter(this, "_", () =>
  l10nHelper("chrome://chat/locale/accounts.properties")
);

XPCOMUtils.defineLazyGetter(this, "_maxDebugMessages", () =>
  Services.prefs.getIntPref("messenger.accounts.maxDebugMessages")
);

XPCOMUtils.defineLazyServiceGetter(this, "HttpProtocolHandler",
  "@mozilla.org/network/protocol;1?name=http", "nsIHttpProtocolHandler");

var gUserCanceledMasterPasswordPrompt = false;
var gConvertingOldPasswords = false;

var SavePrefTimer = {
  saveNow: function() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    Services.prefs.savePrefFile(null);
  },
  _timer: null,
  unInitTimer: function() {
    if (this._timer)
      this.saveNow();
  },
  initTimer: function() {
    if (!this._timer)
      this._timer = setTimeout(this.saveNow.bind(this), 5000);
  }
};

var AutoLoginCounter = {
  _count: 0,
  startAutoLogin: function() {
    ++this._count;
    if (this._count != 1)
      return;
    Services.prefs.setIntPref(kPrefAutologinPending, Date.now() / 1000);
    SavePrefTimer.saveNow();
  },
  finishedAutoLogin: function() {
    --this._count;
    if (this._count != 0)
      return;
    Services.prefs.deleteBranch(kPrefAutologinPending);
    SavePrefTimer.initTimer();
  }
};

function UnknownProtocol(aPrplId)
{
  this.id = aPrplId;
}
UnknownProtocol.prototype = {
  __proto__: ClassInfo("prplIProtocol", "Unknown protocol"),
  get name() { return ""; },
  get normalizedName() { return this.name; },
  get iconBaseURI() { return "chrome://chat/skin/prpl-unknown/"; },
  getOptions: function() { return EmptyEnumerator; },
  getUsernameSplit: function() { return EmptyEnumerator; },
  get usernameEmptyText() { return ""; },

  getAccount: function(aKey, aName) { throw Cr.NS_ERROR_NOT_IMPLEMENTED; },
  accountExists: function() { throw Cr.NS_ERROR_NOT_IMPLEMENTED; },

  // false seems an acceptable default for all options
  // (they should never be called anyway).
  get uniqueChatName() { return false; },
  get chatHasTopic() { return false; },
  get noPassword() { return false; },
  get newMailNotification() { return false; },
  get imagesInIM() { return false; },
  get passwordOptional() { return true; },
  get usePointSize() { return true; },
  get registerNoScreenName() { return false; },
  get slashCommandsNative() { return false; },
  get usePurpleProxy() { return false; }
};

// An unknown prplIAccount.
function UnknownAccount(aAccount) {
  this._init(aAccount.protocol, aAccount);
}
UnknownAccount.prototype = GenericAccountPrototype;

function UnknownAccountBuddy(aAccount, aBuddy, aTag) {
  this._init(new UnknownAccount(aAccount), aBuddy, aTag);
}
UnknownAccountBuddy.prototype = GenericAccountBuddyPrototype;

// aName and aPrplId are provided as parameter only if this is a new
// account that doesn't exist in the preferences. In this case, these
// 2 values should be stored.
function imAccount(aKey, aName, aPrplId)
{
  if (!aKey.startsWith(kAccountKeyPrefix))
    throw Cr.NS_ERROR_INVALID_ARG;

  this.id = aKey;
  this.numericId = parseInt(aKey.substr(kAccountKeyPrefix.length));
  gAccountsService._keepAccount(this);
  this.prefBranch = Services.prefs.getBranch(kPrefAccountPrefix + aKey + ".");

  if (aName) {
    this.name = aName;
    let str = Cc["@mozilla.org/supports-string;1"]
              .createInstance(Ci.nsISupportsString);
    str.data = aName;
    this.prefBranch.setComplexValue(kPrefAccountName, Ci.nsISupportsString,
                                    str);

    this.firstConnectionState = Ci.imIAccount.FIRST_CONNECTION_UNKNOWN;
  }
  else {
    this.name = this.prefBranch.getComplexValue(kPrefAccountName,
                                                Ci.nsISupportsString).data;
  }

  let prplId = aPrplId;
  if (prplId)
    this.prefBranch.setCharPref(kPrefAccountPrpl, prplId);
  else
    prplId = this.prefBranch.getCharPref(kPrefAccountPrpl);

  // Get the protocol plugin, or fallback to an UnknownProtocol instance.
  this.protocol = Services.core.getProtocolById(prplId);
  if (!this.protocol) {
    this.protocol = new UnknownProtocol(prplId);
    this._connectionErrorReason = Ci.imIAccount.ERROR_UNKNOWN_PRPL;
    return;
  }

  // Ensure the account is correctly stored in blist.sqlite.
  Services.contacts.storeAccount(this.numericId, this.name, prplId);

  // Get the prplIAccount from the protocol plugin.
  this.prplAccount = this.protocol.getAccount(this);

  // Send status change notifications to the account.
  this.observedStatusInfo = null; // (To execute the setter).

  // If we have never finished the first connection attempt for this account,
  // mark the account as having caused a crash.
  if (this.firstConnectionState == Ci.imIAccount.FIRST_CONNECTION_PENDING)
    this.firstConnectionState = Ci.imIAccount.FIRST_CONNECTION_CRASHED;

  Services.logins.initializationPromise.then(() => {
    // Try to convert old passwords stored in the preferences.
    // Don't try too hard if the user has canceled a master password prompt:
    // we don't want to display several of theses prompts at startup.
    if (gConvertingOldPasswords && !this.protocol.noPassword) {
      try {
        let password = this.prefBranch.getComplexValue(kPrefAccountPassword,
                                                       Ci.nsISupportsString).data;
        if (password && !this.password)
          this.password = password;
      } catch (e) { /* No password saved in the prefs for this account. */ }
    }

    // Check for errors that should prevent connection attempts.
    if (this._passwordRequired && !this.password)
      this._connectionErrorReason = Ci.imIAccount.ERROR_MISSING_PASSWORD;
    else if (this.firstConnectionState == Ci.imIAccount.FIRST_CONNECTION_CRASHED)
      this._connectionErrorReason = Ci.imIAccount.ERROR_CRASHED;
  });
}

imAccount.prototype = {
  __proto__: ClassInfo(["imIAccount", "prplIAccount"], "im account object"),

  name: "",
  id: "",
  numericId: 0,
  protocol: null,
  prplAccount: null,
  connectionState: Ci.imIAccount.STATE_DISCONNECTED,
  connectionStateMsg: "",
  connectionErrorMessage: "",
  _connectionErrorReason: Ci.prplIAccount.NO_ERROR,
  get connectionErrorReason() {
    if (this._connectionErrorReason != Ci.prplIAccount.NO_ERROR &&
        (this._connectionErrorReason != Ci.imIAccount.ERROR_MISSING_PASSWORD ||
         !this._password))
      return this._connectionErrorReason;
    else
      return this.prplAccount.connectionErrorReason;
  },

  observe: function(aSubject, aTopic, aData) {
    if (aTopic == "account-connect-progress")
      this.connectionStateMsg = aData;
    else if (aTopic == "account-connecting") {
      if (this.prplAccount.connectionErrorReason != Ci.prplIAccount.NO_ERROR) {
        delete this.connectionErrorMessage;
        if (this.timeOfNextReconnect - Date.now() > 1000) {
          // This is a manual reconnection, reset the auto-reconnect stuff
          this.timeOfLastConnect = 0;
          this._cancelReconnection();
        }
      }
      if (this.firstConnectionState != Ci.imIAccount.FIRST_CONNECTION_OK)
        this.firstConnectionState = Ci.imIAccount.FIRST_CONNECTION_PENDING;
      this.connectionState = Ci.imIAccount.STATE_CONNECTING;
    }
    else if (aTopic == "account-connected") {
      this.connectionState = Ci.imIAccount.STATE_CONNECTED;
      this._finishedAutoLogin();
      this.timeOfLastConnect = Date.now();
      if (this.firstConnectionState != Ci.imIAccount.FIRST_CONNECTION_OK)
        this.firstConnectionState = Ci.imIAccount.FIRST_CONNECTION_OK;
      delete this.connectionStateMsg;

      if (this.canJoinChat &&
          this.prefBranch.prefHasUserValue(kPrefAccountAutoJoin)) {
        let autojoin = this.prefBranch.getComplexValue(
          kPrefAccountAutoJoin, Ci.nsISupportsString).data;
        if (autojoin) {
          for (let room of autojoin.trim().split(/,\s*/)) {
            if (room)
              this.joinChat(this.getChatRoomDefaultFieldValues(room));
          }
        }
      }
    }
    else if (aTopic == "account-disconnecting") {
      this.connectionState = Ci.imIAccount.STATE_DISCONNECTING;
      this.connectionErrorMessage = aData;
      delete this.connectionStateMsg;
      this._finishedAutoLogin();

      let firstConnectionState = this.firstConnectionState;
      if (firstConnectionState != Ci.imIAccount.FIRST_CONNECTION_OK &&
          firstConnectionState != Ci.imIAccount.FIRST_CONNECTION_CRASHED)
        this.firstConnectionState = Ci.imIAccount.FIRST_CONNECTION_UNKNOWN;

      let connectionErrorReason = this.prplAccount.connectionErrorReason;
      if (connectionErrorReason != Ci.prplIAccount.NO_ERROR) {
        if (connectionErrorReason == Ci.prplIAccount.ERROR_NETWORK_ERROR ||
            connectionErrorReason == Ci.prplIAccount.ERROR_ENCRYPTION_ERROR)
          this._startReconnectTimer();
        this._sendNotification("account-connect-error");
      }
    }
    else if (aTopic == "account-disconnected") {
      this.connectionState = Ci.imIAccount.STATE_DISCONNECTED;
      let connectionErrorReason = this.prplAccount.connectionErrorReason;
      if (connectionErrorReason != Ci.prplIAccount.NO_ERROR) {
        // If the account was disconnected with an error, save the debug messages.
        this._omittedDebugMessagesBeforeError += this._omittedDebugMessages;
        if (this._debugMessagesBeforeError)
          this._omittedDebugMessagesBeforeError += this._debugMessagesBeforeError.length;
        this._debugMessagesBeforeError = this._debugMessages;
      }
      else {
        // After a clean disconnection, drop the debug messages that
        // could have been left by a previous error.
        delete this._omittedDebugMessagesBeforeError;
        delete this._debugMessagesBeforeError;
      }
      delete this._omittedDebugMessages;
      delete this._debugMessages;
      if (this._statusObserver &&
          connectionErrorReason == Ci.prplIAccount.NO_ERROR &&
          this.statusInfo.statusType > Ci.imIStatusInfo.STATUS_OFFLINE) {
        // If the status changed back to online while an account was still
        // disconnecting, it was not reconnected automatically at that point,
        // so we must do it now. (This happens for protocols like IRC where
        // disconnection is not immediate.)
        this._sendNotification(aTopic, aData);
        this.connect();
        return;
      }
    }
    else
      throw Cr.NS_ERROR_UNEXPECTED;
    this._sendNotification(aTopic, aData);
  },

  _debugMessages: null,
  _omittedDebugMessages: 0,
  _debugMessagesBeforeError: null,
  _omittedDebugMessagesBeforeError: 0,
  logDebugMessage: function(aMessage, aLevel) {
    if (!this._debugMessages)
      this._debugMessages = [];
    if (_maxDebugMessages &&
        this._debugMessages.length >= _maxDebugMessages) {
      this._debugMessages.shift();
      ++this._omittedDebugMessages;
    }
    this._debugMessages.push({logLevel: aLevel, message: aMessage});
  },
  _createDebugMessage: function(aMessage) {
    let scriptError =
      Cc["@mozilla.org/scripterror;1"].createInstance(Ci.nsIScriptError);
    scriptError.init(aMessage, "", "", 0, null, Ci.nsIScriptError.warningFlag,
                     "component javascript");
    return {logLevel: 0, message: scriptError};
  },
  getDebugMessages: function(aCount) {
    let messages = [];
    if (this._omittedDebugMessagesBeforeError) {
      let text = this._omittedDebugMessagesBeforeError + " messages omitted";
      messages.push(this._createDebugMessage(text));
    }
    if (this._debugMessagesBeforeError)
      messages = messages.concat(this._debugMessagesBeforeError);
    if (this._omittedDebugMessages) {
      let text = this._omittedDebugMessages + " messages omitted";
      messages.push(this._createDebugMessage(text));
    }
    if (this._debugMessages)
      messages = messages.concat(this._debugMessages);
    if (messages.length) {
      let appInfo = Services.appinfo;
      let header =
        `${appInfo.name} ${appInfo.version} (${appInfo.appBuildID}), ` +
        `Gecko ${appInfo.platformVersion} (${appInfo.platformBuildID}) ` +
        `on ${HttpProtocolHandler.oscpu}`;
      messages.unshift(this._createDebugMessage(header));
    }

    if (aCount)
      aCount.value = messages.length;
    return messages;
  },

  _observedStatusInfo: null,
  get observedStatusInfo() { return this._observedStatusInfo; },
  _statusObserver: null,
  set observedStatusInfo(aUserStatusInfo) {
    if (!this.prplAccount)
      return;
    if (this._statusObserver)
      this.statusInfo.removeObserver(this._statusObserver);
    this._observedStatusInfo = aUserStatusInfo;
    if (this._statusObserver)
      this.statusInfo.addObserver(this._statusObserver);
  },
  _removeStatusObserver: function() {
    if (this._statusObserver) {
      this.statusInfo.removeObserver(this._statusObserver);
      delete this._statusObserver;
    }
  },
  get statusInfo() { return this._observedStatusInfo || Services.core.globalUserStatus; },

  reconnectAttempt: 0,
  timeOfLastConnect: 0,
  timeOfNextReconnect: 0,
  _reconnectTimer: null,
  _startReconnectTimer: function() {
    if (Services.io.offline) {
      Cu.reportError("_startReconnectTimer called while offline");
      return;
    }

    /* If the last successful connection is older than 10 seconds, reset the
       number of reconnection attemps. */
    const kTimeBeforeSuccessfulConnection = 10;
    if (this.timeOfLastConnect &&
        this.timeOfLastConnect + kTimeBeforeSuccessfulConnection * 1000 < Date.now()) {
      delete this.reconnectAttempt;
      delete this.timeOfLastConnect;
    }

    let timers =
      Services.prefs.getCharPref("messenger.accounts.reconnectTimer").split(",");
    let delay = timers[Math.min(this.reconnectAttempt, timers.length - 1)];
    let msDelay = parseInt(delay) * 1000;
    ++this.reconnectAttempt;
    this.timeOfNextReconnect = Date.now() + msDelay;
    this._reconnectTimer = setTimeout(this.connect.bind(this), msDelay);
  },

  _sendNotification: function(aTopic, aData) {
    Services.obs.notifyObservers(this, aTopic, aData);
  },

  get firstConnectionState() {
    try {
      return this.prefBranch.getIntPref(kPrefAccountFirstConnectionState);
    } catch (e) {
      return Ci.imIAccount.FIRST_CONNECTION_OK;
    }
  },
  set firstConnectionState(aState) {
    if (aState == Ci.imIAccount.FIRST_CONNECTION_OK)
      this.prefBranch.deleteBranch(kPrefAccountFirstConnectionState);
    else {
      this.prefBranch.setIntPref(kPrefAccountFirstConnectionState, aState);
      // We want to save this pref immediately when trying to connect.
      if (aState == Ci.imIAccount.FIRST_CONNECTION_PENDING)
        SavePrefTimer.saveNow();
      else
        SavePrefTimer.initTimer();
    }
  },

  _pendingReconnectForConnectionInfoChange: false,
  _connectionInfoChanged: function() {
    // The next connection will be the first connection with these parameters.
    this.firstConnectionState = Ci.imIAccount.FIRST_CONNECTION_UNKNOWN;

    // We want to attempt to reconnect with the new settings only if a
    // previous attempt failed or a connection attempt is currently
    // pending (so we can return early if the account is currently
    // connected or disconnected without error).
    // The code doing the reconnection attempt is wrapped within an
    // executeSoon call so that when multiple settings are changed at
    // once we don't attempt to reconnect until they are all saved.
    // If a reconnect attempt is already scheduled, we can also return early.
    if (this._pendingReconnectForConnectionInfoChange || this.connected ||
        (this.disconnected &&
         this.connectionErrorReason == Ci.prplIAccount.NO_ERROR))
      return;

    this._pendingReconnectForConnectionInfoChange = true;
    executeSoon(function () {
      delete this._pendingReconnectForConnectionInfoChange;
      // If the connection parameters have changed while we were
      // trying to connect, cancel the ongoing connection attempt and
      // try again with the new parameters.
      if (this.connecting) {
        this.disconnect();
        this.connect();
        return;
      }
      // If the account was disconnected because of a non-fatal
      // connection error, retry now that we have new parameters.
      let errorReason = this.connectionErrorReason;
      if (this.disconnected &&
          errorReason != Ci.prplIAccount.NO_ERROR &&
          errorReason != Ci.imIAccount.ERROR_MISSING_PASSWORD &&
          errorReason != Ci.imIAccount.ERROR_CRASHED &&
          errorReason != Ci.imIAccount.ERROR_UNKNOWN_PRPL) {
        this.connect();
      }
    }.bind(this));
  },

  // If the protocol plugin is missing, we can't access the normalizedName,
  // but in lots of cases this.name is equivalent.
  get normalizedName() {
    return this.prplAccount ? this.prplAccount.normalizedName : this.name;
  },
  normalize: function(aName) {
    return this.prplAccount ? this.prplAccount.normalize(aName) : aName;
  },

  _sendUpdateNotification: function() {
    this._sendNotification("account-updated");
  },

  set alias(val) {
    if (val) {
      let str = Cc["@mozilla.org/supports-string;1"]
                .createInstance(Ci.nsISupportsString);
      str.data = val;
      this.prefBranch.setComplexValue(kPrefAccountAlias, Ci.nsISupportsString,
                                      str);
    }
    else
      this.prefBranch.deleteBranch(kPrefAccountAlias);
    this._sendUpdateNotification();
  },
  get alias() {
    try {
      return this.prefBranch.getComplexValue(kPrefAccountAlias,
                                             Ci.nsISupportsString).data;
    } catch (e) {
      return "";
    }
  },

  _password: "",
  get password() {
    if (this._password)
      return this._password;

    // Avoid prompting the user for the master password more than once at startup.
    if (gUserCanceledMasterPasswordPrompt)
      return "";

    let passwordURI = "im://" + this.protocol.id;
    let logins;
    try {
      logins = Services.logins.findLogins({}, passwordURI, null, passwordURI);
    } catch (e) {
      this._handleMasterPasswordException(e);
      return "";
    }
    let normalizedName = this.normalizedName;
    for (let login of logins) {
      if (login.username == normalizedName) {
        this._password = login.password;
        if (this._connectionErrorReason == Ci.imIAccount.ERROR_MISSING_PASSWORD) {
          // We have found a password for an account marked as missing password,
          // re-check all others accounts missing a password. But first,
          // remove the error on our own account to avoid re-checking it.
          delete this._connectionErrorReason;
          gAccountsService._checkIfPasswordStillMissing();
        }
        return this._password;
      }
    }
    return "";
  },
  _checkIfPasswordStillMissing: function() {
    if (this._connectionErrorReason != Ci.imIAccount.ERROR_MISSING_PASSWORD ||
        !this.password)
      return;

    delete this._connectionErrorReason;
    this._sendUpdateNotification();
  },
  get _passwordRequired() {
    return !this.protocol.noPassword && !this.protocol.passwordOptional;
  },
  set password(aPassword) {
    this._password = aPassword;
    if (gUserCanceledMasterPasswordPrompt)
      return;
    let newLogin = Cc["@mozilla.org/login-manager/loginInfo;1"]
                   .createInstance(Ci.nsILoginInfo);
    let passwordURI = "im://" + this.protocol.id;
    newLogin.init(passwordURI, null, passwordURI, this.normalizedName,
                  aPassword, "", "");
    try {
      let logins = Services.logins.findLogins({}, passwordURI, null, passwordURI);
      let saved = false;
      for (let login of logins) {
        if (newLogin.matches(login, true)) {
          if (aPassword)
            Services.logins.modifyLogin(login, newLogin);
          else
            Services.logins.removeLogin(login);
          saved = true;
          break;
        }
      }
      if (!saved && aPassword)
        Services.logins.addLogin(newLogin);
    } catch (e) {
      this._handleMasterPasswordException(e);
    }

    this._connectionInfoChanged();
    if (aPassword &&
        this._connectionErrorReason == Ci.imIAccount.ERROR_MISSING_PASSWORD)
      this._connectionErrorReason = Ci.imIAccount.NO_ERROR;
    else if (!aPassword && this._passwordRequired)
      this._connectionErrorReason = Ci.imIAccount.ERROR_MISSING_PASSWORD;
    this._sendUpdateNotification();
  },
  _handleMasterPasswordException: function(aException) {
    if (aException.result != Components.results.NS_ERROR_ABORT)
      throw aException;

    gUserCanceledMasterPasswordPrompt = true;
    executeSoon(function () { gUserCanceledMasterPasswordPrompt = false; });
  },

  get autoLogin() {
    let autoLogin = true;
    try {
      autoLogin = this.prefBranch.getBoolPref(kPrefAccountAutoLogin);
    } catch (e) { }
    return autoLogin;
  },
  set autoLogin(val) {
    this.prefBranch.setBoolPref(kPrefAccountAutoLogin, val);
    SavePrefTimer.initTimer();
    this._sendUpdateNotification();
  },
  _autoLoginPending: false,
  checkAutoLogin: function() {
    // No auto-login if: the account has an error at the imIAccount level
    // (unknown protocol, missing password, first connection crashed),
    // the account is already connected or connecting, or autoLogin is off.
    if (this._connectionErrorReason != Ci.prplIAccount.NO_ERROR ||
        this.connecting || this.connected || !this.autoLogin)
      return;

    this._autoLoginPending = true;
    AutoLoginCounter.startAutoLogin();
    try {
      this.connect();
    } catch (e) {
      Cu.reportError(e);
      this._finishedAutoLogin();
    }
  },
  _finishedAutoLogin: function() {
    if (!this.hasOwnProperty("_autoLoginPending"))
      return;
    delete this._autoLoginPending;
    AutoLoginCounter.finishedAutoLogin();
  },

  // Delete the account (from the preferences, mozStorage, and call unInit).
  remove: function() {
    let login = Cc["@mozilla.org/login-manager/loginInfo;1"]
                .createInstance(Ci.nsILoginInfo);
    let passwordURI = "im://" + this.protocol.id;
    // Note: the normalizedName may not be exactly right if the
    // protocol plugin is missing.
    login.init(passwordURI, null, passwordURI, this.normalizedName, "", "", "");
    let logins = Services.logins.findLogins({}, passwordURI, null, passwordURI);
    for (let l of logins) {
      if (login.matches(l, true)) {
        Services.logins.removeLogin(l);
        break;
      }
    }
    if (this.connected || this.connecting)
      this.disconnect();
    if (this.prplAccount)
      this.prplAccount.remove();
    this.unInit();
    Services.contacts.forgetAccount(this.numericId);
    this.prefBranch.deleteBranch("");
  },
  unInit: function() {
    // remove any pending reconnection timer.
    this._cancelReconnection();

    // Keeping a status observer could cause an immediate reconnection.
    this._removeStatusObserver();

    // remove any pending autologin preference used for crash detection.
    this._finishedAutoLogin();

    // If the first connection was pending on quit, we set it back to unknown.
    if (this.firstConnectionState == Ci.imIAccount.FIRST_CONNECTION_PENDING)
      this.firstConnectionState = Ci.imIAccount.FIRST_CONNECTION_UNKNOWN;

    // and make sure we cleanup the save pref timer.
    SavePrefTimer.unInitTimer();

    if (this.prplAccount)
      this.prplAccount.unInit();

    delete this.protocol;
    delete this.prplAccount;
  },

  get _ensurePrplAccount() {
    if (this.prplAccount)
      return this.prplAccount;
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  connect: function() {
    if (!this.prplAccount)
      throw Cr.NS_ERROR_NOT_IMPLEMENTED;

    if (this._passwordRequired) {
      // If the previous connection attempt failed because we have a wrong password,
      // clear the passwor cache so that if there's no password in the password
      // manager the user gets prompted again.
      if (this.connectionErrorReason == Ci.prplIAccount.ERROR_AUTHENTICATION_FAILED)
        delete this._password;

      let password = this.password;
      if (!password) {
        let prompts = Services.prompt;
        let shouldSave = {value: false};
        password = {value: ""};
        if (!prompts.promptPassword(null, _("passwordPromptTitle", this.name),
                                    _("passwordPromptText", this.name),
                                    password, _("passwordPromptSaveCheckbox"),
                                    shouldSave))
          return;

        if (shouldSave.value)
          this.password = password.value;
        else
          this._password = password.value;
      }
    }

    if (!this._statusObserver) {
      this._statusObserver = {
        observe: (function(aSubject, aTopic, aData) {
          // Disconnect or reconnect the account automatically, otherwise notify
          // the prplAccount instance.
          let statusType = aSubject.statusType;
          let connectionErrorReason = this.connectionErrorReason;
          if (statusType == Ci.imIStatusInfo.STATUS_OFFLINE) {
            if (this.connected || this.connecting)
              this.prplAccount.disconnect();
            this._cancelReconnection();
          }
          else if (statusType > Ci.imIStatusInfo.STATUS_OFFLINE &&
                   this.disconnected &&
                   (connectionErrorReason == Ci.prplIAccount.NO_ERROR ||
                    connectionErrorReason == Ci.prplIAccount.ERROR_NETWORK_ERROR ||
                    connectionErrorReason == Ci.prplIAccount.ERROR_ENCRYPTION_ERROR))
            this.prplAccount.connect();
          else if (this.connected)
            this.prplAccount.observe(aSubject, aTopic, aData);
        }).bind(this)
      };

      this.statusInfo.addObserver(this._statusObserver);
    }

    if (!Services.io.offline &&
        this.statusInfo.statusType > Ci.imIStatusInfo.STATUS_OFFLINE &&
        this.disconnected)
      this.prplAccount.connect();
  },
  disconnect: function() {
    this._removeStatusObserver();
    if (!this.disconnected)
      this._ensurePrplAccount.disconnect();
  },

  get disconnected() { return this.connectionState == Ci.imIAccount.STATE_DISCONNECTED; },
  get connected() { return this.connectionState == Ci.imIAccount.STATE_CONNECTED; },
  get connecting() { return this.connectionState == Ci.imIAccount.STATE_CONNECTING; },
  get disconnecting() { return this.connectionState == Ci.imIAccount.STATE_DISCONNECTING; },

  _cancelReconnection: function() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      delete this._reconnectTimer;
    }
    delete this.reconnectAttempt;
    delete this.timeOfNextReconnect;
  },
  cancelReconnection: function() {
    if (!this.disconnected)
      throw Cr.NS_ERROR_UNEXPECTED;

    // Ensure we don't keep a status observer that could re-enable the
    // auto-reconnect timers.
    this.disconnect();

    this._cancelReconnection();
  },
  createConversation: function(aName) {
    return this._ensurePrplAccount.createConversation(aName);
  },
  addBuddy: function(aTag, aName) {
    this._ensurePrplAccount.addBuddy(aTag, aName);
  },
  loadBuddy: function(aBuddy, aTag) {
    if (this.prplAccount)
      return this.prplAccount.loadBuddy(aBuddy, aTag);
    // Generate dummy account buddies for unknown protocols.
    return new UnknownAccountBuddy(this, aBuddy, aTag);
  },
  requestBuddyInfo: function(aBuddyName) {
    this._ensurePrplAccount.requestBuddyInfo(aBuddyName);
  },
  getChatRoomFields: function() { return this._ensurePrplAccount.getChatRoomFields(); },
  getChatRoomDefaultFieldValues: function(aDefaultChatName) {
    return this._ensurePrplAccount.getChatRoomDefaultFieldValues(aDefaultChatName);
  },
  get canJoinChat() { return this.prplAccount ? this.prplAccount.canJoinChat : false; },
  joinChat: function(aComponents) {
    this._ensurePrplAccount.joinChat(aComponents);
  },
  setBool: function(aName, aVal) {
    this.prefBranch.setBoolPref(kAccountOptionPrefPrefix + aName, aVal);
    this._connectionInfoChanged();
    if (this.prplAccount)
      this.prplAccount.setBool(aName, aVal);
    SavePrefTimer.initTimer();
  },
  setInt: function(aName, aVal) {
    this.prefBranch.setIntPref(kAccountOptionPrefPrefix + aName, aVal);
    this._connectionInfoChanged();
    if (this.prplAccount)
      this.prplAccount.setInt(aName, aVal);
    SavePrefTimer.initTimer();
  },
  setString: function(aName, aVal) {
    let str = Cc["@mozilla.org/supports-string;1"]
              .createInstance(Ci.nsISupportsString);
    str.data = aVal;
    this.prefBranch.setComplexValue(kAccountOptionPrefPrefix + aName,
                                    Ci.nsISupportsString, str);
    this._connectionInfoChanged();
    if (this.prplAccount)
      this.prplAccount.setString(aName, aVal);
    SavePrefTimer.initTimer();
  },
  save: function() { SavePrefTimer.saveNow(); },

  get HTMLEnabled() { return this._ensurePrplAccount.HTMLEnabled; },
  get HTMLEscapePlainText() { return this._ensurePrplAccount.HTMLEscapePlainText; },
  get noBackgroundColors() { return this._ensurePrplAccount.noBackgroundColors; },
  get autoResponses() { return this._ensurePrplAccount.autoResponses; },
  get singleFormatting() { return this._ensurePrplAccount.singleFormatting; },
  get noFontSizes() { return this._ensurePrplAccount.noFontSizes; },
  get noUrlDesc() { return this._ensurePrplAccount.noUrlDesc; },
  get noImages() { return this._ensurePrplAccount.noImages; },

  get proxyInfo() { return this._ensurePrplAccount.proxyInfo; },
  set proxyInfo(val) {
    this._ensurePrplAccount.proxyInfo = val;
    this._connectionInfoChanged();
  }
};

var gAccountsService = null;

function AccountsService() { }
AccountsService.prototype = {
  initAccounts: function() {
    this._initAutoLoginStatus();
    this._accounts = [];
    this._accountsById = {};
    gAccountsService = this;
    gConvertingOldPasswords =
      Services.prefs.getBoolPref(kPrefConvertOldPasswords);
    let accountList = this._accountList;
    for (let account of (accountList ? accountList.split(",") : [])) {
      try {
        account.trim();
        if (!account)
          throw Cr.NS_ERROR_INVALID_ARG;
        new imAccount(account);
      } catch (e) {
        Cu.reportError(e);
        dump(e + " " + e.toSource() + "\n");
      }
    }
    // If the user has canceled a master password prompt, we haven't
    // been able to save any password, so the old password conversion
    // still needs to happen.
    if (gConvertingOldPasswords && !gUserCanceledMasterPasswordPrompt)
      Services.prefs.setBoolPref(kPrefConvertOldPasswords, false);

    this._prefObserver = this.observe.bind(this);
    Services.prefs.addObserver(kPrefMessengerAccounts, this._prefObserver, false);
  },

  _observingAccountListChange: true,
  _prefObserver: null,
  observe: function(aSubject, aTopic, aData) {
    if (aTopic != "nsPref:changed" || aData != kPrefMessengerAccounts ||
       !this._observingAccountListChange)
      return;

    this._accounts =
      this._accountList.split(",").map(String.trim)
          .filter(k => k.startsWith(kAccountKeyPrefix))
          .map(k => parseInt(k.substr(kAccountKeyPrefix.length)))
          .map(this.getAccountByNumericId, this)
          .filter(a => a);

    Services.obs.notifyObservers(this, "account-list-updated", null);
  },

  get _accountList() { return Services.prefs.getCharPref(kPrefMessengerAccounts); },
  set _accountList(aNewList) {
    this._observingAccountListChange = false;
    Services.prefs.setCharPref(kPrefMessengerAccounts, aNewList);
    delete this._observingAccountListChange;
  },

  unInitAccounts: function() {
    for (let account of this._accounts)
      account.unInit();
    gAccountsService = null;
    delete this._accounts;
    delete this._accountsById;
    Services.prefs.removeObserver(kPrefMessengerAccounts, this._prefObserver);
    delete this._prefObserver;
  },

  autoLoginStatus: Ci.imIAccountsService.AUTOLOGIN_ENABLED,
  _initAutoLoginStatus: function() {
    /* If auto-login is already disabled, do nothing */
    if (this.autoLoginStatus != Ci.imIAccountsService.AUTOLOGIN_ENABLED)
      return;

    let prefs = Services.prefs;
    if (!prefs.getIntPref("messenger.startup.action")) {
      // the value 0 means that we start without connecting the accounts
      this.autoLoginStatus = Ci.imIAccountsService.AUTOLOGIN_USER_DISABLED;
      return;
    }

    /* Disable auto-login if we are running in safe mode */
    if (Services.appinfo.inSafeMode) {
      this.autoLoginStatus = Ci.imIAccountsService.AUTOLOGIN_SAFE_MODE;
      return;
    }

    /* Check if we crashed at the last startup during autologin */
    let autoLoginPending;
    if (prefs.getPrefType(kPrefAutologinPending) == prefs.PREF_INVALID ||
        !(autoLoginPending = prefs.getIntPref(kPrefAutologinPending))) {
      // if the pref isn't set, then we haven't crashed: keep autologin enabled
      return;
    }

    // Last autologin hasn't finished properly.
    // For now, assume it's because of a crash.
    this.autoLoginStatus = Ci.imIAccountsService.AUTOLOGIN_CRASH;
    prefs.deleteBranch(kPrefAutologinPending);

    // If the crash reporter isn't built, we can't know anything more.
    if (!("nsICrashReporter" in Ci))
      return;

    try {
      // Try to get more info with breakpad
      let lastCrashTime = 0;

      /* Locate the LastCrash file */
      let lastCrash = Services.dirsvc.get("UAppData", Ci.nsILocalFile);
      lastCrash.append("Crash Reports");
      lastCrash.append("LastCrash");
      if (lastCrash.exists()) {
        /* Ok, the file exists, now let's try to read it */
        let is = Cc["@mozilla.org/network/file-input-stream;1"]
                 .createInstance(Ci.nsIFileInputStream);
        let sis = Cc["@mozilla.org/scriptableinputstream;1"]
                  .createInstance(Ci.nsIScriptableInputStream);
        is.init(lastCrash, -1, 0, 0);
        sstream.init(sis);

        lastCrashTime = parseInt(sstream.read(lastCrash.fileSize));

        sstream.close();
        fstream.close();
      }
      // The file not existing is totally acceptable, it just means that
      // either we never crashed or breakpad is not enabled.
      // In this case, lastCrashTime will keep its 0 initialization value.

      /*dump("autoLoginPending = " + autoLoginPending +
             ", lastCrash = " + lastCrashTime +
             ", difference = " + lastCrashTime - autoLoginPending + "\n");*/

      if (lastCrashTime < autoLoginPending) {
        // the last crash caught by breakpad is older than our last autologin
        // attempt.
        // If breakpad is currently enabled, we can be confident that
        // autologin was interrupted for an exterior reason
        // (application killed by the user, power outage, ...)
        try {
          Services.appinfo.QueryInterface(Ci.nsICrashReporter)
                  .annotateCrashReport("=", "");
        } catch (e) {
          // This should fail with NS_ERROR_INVALID_ARG if breakpad is enabled,
          // and NS_ERROR_NOT_INITIALIZED if it is not.
          if (e.result != Cr.NS_ERROR_NOT_INITIALIZED)
            this.autoLoginStatus = Ci.imIAccountsService.AUTOLOGIN_ENABLED;
        }
      }
    } catch (e) {
      // if we failed to get the last crash time, then keep the
      // AUTOLOGIN_CRASH value in mAutoLoginStatus and return.
      return;
    }
  },

  processAutoLogin: function() {
    if (!this._accounts)  // if we're already shutting down
      return;

    for (let account of this._accounts)
      account.checkAutoLogin();

    // Make sure autologin is now enabled, so that we don't display a
    // message stating that it is disabled and asking the user if it
    // should be processed now.
    this.autoLoginStatus = Ci.imIAccountsService.AUTOLOGIN_ENABLED;

    // Notify observers so that any message stating that autologin is
    // disabled can be removed
    Services.obs.notifyObservers(this, "autologin-processed", null);
  },

  _checkingIfPasswordStillMissing: false,
  _checkIfPasswordStillMissing: function() {
    // Avoid recursion.
    if (this._checkingIfPasswordStillMissing)
      return;

    this._checkingIfPasswordStillMissing = true;
    for (let account of this._accounts)
      account._checkIfPasswordStillMissing();
    delete this._checkingIfPasswordStillMissing;
  },

  getAccountById: function(aAccountId) {
    if (!aAccountId.startsWith(kAccountKeyPrefix))
      throw Cr.NS_ERROR_INVALID_ARG;

    let id = parseInt(aAccountId.substr(kAccountKeyPrefix.length));
    return this.getAccountByNumericId(id);
  },

  _keepAccount: function(aAccount) {
    this._accounts.push(aAccount);
    this._accountsById[aAccount.numericId] = aAccount;
  },
  getAccountByNumericId: function(aAccountId) { return this._accountsById[aAccountId]; },
  getAccounts: function() { return new nsSimpleEnumerator(this._accounts); },

  createAccount: function(aName, aPrpl) {
    // Ensure an account with the same name and protocol doesn't already exist.
    let prpl = Services.core.getProtocolById(aPrpl);
    if (!prpl)
      throw Cr.NS_ERROR_UNEXPECTED;
    if (prpl.accountExists(aName)) {
      Cu.reportError("Attempted to create a duplicate account!");
      throw Cr.NS_ERROR_ALREADY_INITIALIZED;
    }

    /* First get a unique id for the new account. */
    let id;
    for (id = 1; ; ++id) {
      if (this._accountsById.hasOwnProperty(id))
        continue;

      /* id isn't used by a known account, double check it isn't
       already used in the sqlite database. This should never
       happen, except if we have a corrupted profile. */
      if (!Services.contacts.accountIdExists(id))
        break;
      Services.console.logStringMessage("No account " + id + " but there is some data in the buddy list for an account with this number. Your profile may be corrupted.");
    }

    /* Actually create the new account. */
    let key = kAccountKeyPrefix + id;
    let account = new imAccount(key, aName, aPrpl);

    /* Save the account list pref. */
    let list = this._accountList;
    this._accountList = list ? list + "," + key : key;

    Services.obs.notifyObservers(account, "account-added", null);
    return account;
  },

  deleteAccount: function(aAccountId) {
    let account = this.getAccountById(aAccountId);
    if (!account)
      throw Cr.NS_ERROR_INVALID_ARG;

    let index = this._accounts.indexOf(account);
    if (index == -1)
      throw Cr.NS_ERROR_UNEXPECTED;

    let id = account.numericId;
    account.remove();
    this._accounts.splice(index, 1);
    delete this._accountsById[id];
    Services.obs.notifyObservers(account, "account-removed", null);

    /* Update the account list pref. */
    let list = this._accountList;
    this._accountList =
      list.split(",").filter(k => k.trim() != aAccountId).join(",");
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imIAccountsService]),
  classDescription: "Accounts",
  classID: Components.ID("{a94b5427-cd8d-40cf-b47e-b67671953e70}"),
  contractID: "@mozilla.org/chat/accounts-service;1"
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([AccountsService]);
