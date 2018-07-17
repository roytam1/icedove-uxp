/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;
Cu.import("resource:///modules/imServices.jsm");
Cu.import("resource:///modules/imXPCOMUtils.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "categoryManager",
                                   "@mozilla.org/categorymanager;1",
                                   "nsICategoryManager");

var kQuitApplicationGranted = "quit-application-granted";
var kProtocolPluginCategory = "im-protocol-plugin";

var kPrefReportIdle =        "messenger.status.reportIdle";
var kPrefUserIconFilename =  "messenger.status.userIconFileName";
var kPrefUserDisplayname =   "messenger.status.userDisplayName";
var kPrefTimeBeforeIdle =    "messenger.status.timeBeforeIdle";
var kPrefAwayWhenIdle =      "messenger.status.awayWhenIdle";
var kPrefDefaultMessage =    "messenger.status.defaultIdleAwayMessage";

var NS_IOSERVICE_GOING_OFFLINE_TOPIC = "network:offline-about-to-go-offline";
var NS_IOSERVICE_OFFLINE_STATUS_TOPIC = "network:offline-status-changed";

function UserStatus()
{
  this._observers = [];

  if (Services.prefs.getBoolPref(kPrefReportIdle))
    this._addIdleObserver();
  Services.prefs.addObserver(kPrefReportIdle, this, false);

  if (Services.io.offline)
    this._offlineStatusType = Ci.imIStatusInfo.STATUS_OFFLINE;
  Services.obs.addObserver(this, NS_IOSERVICE_GOING_OFFLINE_TOPIC, false);
  Services.obs.addObserver(this, NS_IOSERVICE_OFFLINE_STATUS_TOPIC, false);
}
UserStatus.prototype = {
  __proto__: ClassInfo("imIUserStatusInfo", "User status info"),

  unInit: function() {
    this._observers = [];
    Services.prefs.removeObserver(kPrefReportIdle, this);
    if (this._observingIdleness)
      this._removeIdleObserver();
    Services.obs.removeObserver(this, NS_IOSERVICE_GOING_OFFLINE_TOPIC);
    Services.obs.removeObserver(this, NS_IOSERVICE_OFFLINE_STATUS_TOPIC);
  },
  _observingIdleness: false,
  _addIdleObserver: function() {
    this._observingIdleness = true;
    this._idleService =
      Cc["@mozilla.org/widget/idleservice;1"].getService(Ci.nsIIdleService);
    Services.obs.addObserver(this, "im-sent", false);

    this._timeBeforeIdle = Services.prefs.getIntPref(kPrefTimeBeforeIdle);
    if (this._timeBeforeIdle < 0)
      this._timeBeforeIdle = 0;
    Services.prefs.addObserver(kPrefTimeBeforeIdle, this, false);
    if (this._timeBeforeIdle)
      this._idleService.addIdleObserver(this, this._timeBeforeIdle);
  },
  _removeIdleObserver: function() {
    if (this._timeBeforeIdle)
      this._idleService.removeIdleObserver(this, this._timeBeforeIdle);

    Services.prefs.removeObserver(kPrefTimeBeforeIdle, this);
    delete this._timeBeforeIdle;

    Services.obs.removeObserver(this, "im-sent");
    delete this._idleService;
    delete this._observingIdleness;
  },

  observe: function(aSubject, aTopic, aData) {
    if (aTopic == "nsPref:changed") {
      if (aData == kPrefReportIdle) {
        let reportIdle = Services.prefs.getBoolPref(kPrefReportIdle);
        if (reportIdle && !this._observingIdleness)
          this._addIdleObserver();
        else if (!reportIdle && this._observingIdleness)
        this._removeIdleObserver();
      }
      else if (aData == kPrefTimeBeforeIdle) {
        let timeBeforeIdle = Services.prefs.getIntPref(kPrefTimeBeforeIdle);
        if (timeBeforeIdle != this._timeBeforeIdle) {
          if (this._timeBeforeIdle)
            this._idleService.removeIdleObserver(this, this._timeBeforeIdle);
          this._timeBeforeIdle = timeBeforeIdle;
          if (this._timeBeforeIdle)
            this._idleService.addIdleObserver(this, this._timeBeforeIdle);
        }
      }
      else
        throw Cr.NS_ERROR_UNEXPECTED;
    }
    else if (aTopic == NS_IOSERVICE_GOING_OFFLINE_TOPIC)
      this.offline = true;
    else if (aTopic == NS_IOSERVICE_OFFLINE_STATUS_TOPIC && aData == "online")
      this.offline = false;
    else
      this._checkIdle();
  },

  _offlineStatusType: Ci.imIStatusInfo.STATUS_AVAILABLE,
  set offline(aOffline) {
    let statusType = this.statusType;
    let statusText = this.statusText;
    if (aOffline)
      this._offlineStatusType = Ci.imIStatusInfo.STATUS_OFFLINE;
    else
      delete this._offlineStatusType;
    if (this.statusType != statusType || this.statusText != statusText)
      this._notifyObservers("status-changed", this.statusText);
  },

  _idleTime: 0,
  get idleTime() { return this._idleTime; },
  set idleTime(aIdleTime) {
    this._idleTime = aIdleTime;
    this._notifyObservers("idle-time-changed", aIdleTime);
  },
  _idle: false,
  _idleStatusText: "",
  _idleStatusType: Ci.imIStatusInfo.STATUS_AVAILABLE,
  _checkIdle: function() {
    let idleTime = Math.floor(this._idleService.idleTime / 1000);
    let idle = this._timeBeforeIdle && idleTime >= this._timeBeforeIdle;
    if (idle == this._idle)
      return;

    let statusType = this.statusType;
    let statusText = this.statusText;
    this._idle = idle;
    if (idle) {
      this.idleTime = idleTime;
      if (Services.prefs.getBoolPref(kPrefAwayWhenIdle)) {
        this._idleStatusType = Ci.imIStatusInfo.STATUS_AWAY;
        this._idleStatusText =
          Services.prefs.getComplexValue(kPrefDefaultMessage,
                                         Ci.nsIPrefLocalizedString).data;
      }
    }
    else {
      this.idleTime = 0;
      delete this._idleStatusType;
      delete this._idleStatusText;
    }
    if (this.statusType != statusType || this.statusText != statusText)
      this._notifyObservers("status-changed", this.statusText);
  },

  _statusText: "",
  get statusText() { return this._statusText || this._idleStatusText; },
  _statusType: Ci.imIStatusInfo.STATUS_AVAILABLE,
  get statusType() { return Math.min(this._statusType, this._idleStatusType, this._offlineStatusType); },
  setStatus: function(aStatus, aMessage) {
    if (aStatus != Ci.imIStatusInfo.STATUS_UNKNOWN)
      this._statusType = aStatus;
    if (aStatus != Ci.imIStatusInfo.STATUS_OFFLINE)
      this._statusText = aMessage;
    this._notifyObservers("status-changed", aMessage);
  },

  _getProfileDir: () => Services.dirsvc.get("ProfD", Ci.nsIFile),
  setUserIcon: function(aIconFile) {
    let folder = this._getProfileDir();

    let newName = "";
    if (aIconFile) {
      // Get the extension (remove trailing dots - invalid Windows extension).
      let ext = aIconFile.leafName.replace(/.*(\.[a-z0-9]+)\.*/i, "$1");
      // newName = userIcon-<timestamp(now)>.<aIconFile.extension>
      newName = "userIcon-" + Math.floor(Date.now() / 1000) + ext;

      // Copy the new icon file to newName in the profile folder.
      aIconFile.copyTo(folder, newName);
    }

    // Get the previous file name before saving the new file name.
    let oldFileName = Services.prefs.getCharPref(kPrefUserIconFilename);
    Services.prefs.setCharPref(kPrefUserIconFilename, newName);

    // Now that the new icon has been copied to the profile directory
    // and the pref value changed, we can remove the old icon. Ignore
    // failures so that we always fire the user-icon-changed notification.
    try {
      if (oldFileName) {
        folder.append(oldFileName);
        if (folder.exists())
          folder.remove(false);
      }
    } catch (e) {
      Cu.reportError(e);
    }

    this._notifyObservers("user-icon-changed", newName);
  },
  getUserIcon: function() {
    let filename = Services.prefs.getCharPref(kPrefUserIconFilename);
    if (!filename)
      return null; // No icon has been set.

    let file = this._getProfileDir();
    file.append(filename);

    if (!file.exists()) {
      Services.console.logStringMessage("Invalid userIconFileName preference");
      return null;
    }

    return Services.io.newFileURI(file);
  },

  get displayName() {
    return Services.prefs.getComplexValue(kPrefUserDisplayname,
                                          Ci.nsISupportsString).data;
  },
  set displayName(aDisplayName) {
    let str = Cc["@mozilla.org/supports-string;1"]
              .createInstance(Ci.nsISupportsString);
    str.data = aDisplayName;
    Services.prefs.setComplexValue(kPrefUserDisplayname, Ci.nsISupportsString,
                                   str);
    this._notifyObservers("user-display-name-changed", aDisplayName);
  },

  addObserver: function(aObserver) {
    if (!this._observers.includes(aObserver))
      this._observers.push(aObserver);
  },
  removeObserver: function(aObserver) {
    this._observers = this._observers.filter(o => o !== aObserver);
  },
  _notifyObservers: function(aTopic, aData) {
    for (let observer of this._observers)
      observer.observe(this, aTopic, aData);
  }
};

var gCoreService;
function CoreService() { gCoreService = this; }
CoreService.prototype = {
  globalUserStatus: null,

  _initialized: false,
  get initialized() { return this._initialized; },
  init: function() {
    if (this._initialized)
      return;

    initLogModule("core", this);

    Services.obs.addObserver(this, kQuitApplicationGranted, false);
    this._initialized = true;

    Services.cmd.initCommands();
    this._protos = {};

    this.globalUserStatus = new UserStatus();
    this.globalUserStatus.addObserver({
      observe: function(aSubject, aTopic, aData) {
        Services.obs.notifyObservers(aSubject, aTopic, aData);
      }
    });

    let accounts = Services.accounts;
    accounts.initAccounts();
    Services.contacts.initContacts();
    Services.conversations.initConversations();
    Services.obs.notifyObservers(this, "prpl-init", null);

    // Wait with automatic connections until the password service
    // is available.
    if (accounts.autoLoginStatus == Ci.imIAccountsService.AUTOLOGIN_ENABLED) {
      Services.logins.initializationPromise.then(() => {
        Services.accounts.processAutoLogin();
      });
    }
  },
  observe: function(aObject, aTopic, aData) {
    if (aTopic == kQuitApplicationGranted)
      this.quit();
  },
  quit: function() {
    if (!this._initialized)
      throw Cr.NS_ERROR_NOT_INITIALIZED;

    Services.obs.removeObserver(this, kQuitApplicationGranted);
    Services.obs.notifyObservers(this, "prpl-quit", null);

    Services.conversations.unInitConversations();
    Services.accounts.unInitAccounts();
    Services.contacts.unInitContacts();
    Services.cmd.unInitCommands();

    this.globalUserStatus.unInit();
    delete this.globalUserStatus;
    delete this._protos;
    delete this._initialized;
  },

  getProtocols: function() {
    if (!this._initialized)
      throw Cr.NS_ERROR_NOT_INITIALIZED;

    let protocols = [];
    let entries = categoryManager.enumerateCategory(kProtocolPluginCategory);
    while (entries.hasMoreElements()) {
      let id = entries.getNext().QueryInterface(Ci.nsISupportsCString).data;

      // If the preference is set to disable this prpl, don't show it in the
      // full list of protocols.
      let pref = "chat.prpls." + id + ".disable";
      if (Services.prefs.getPrefType(pref) == Services.prefs.PREF_BOOL &&
          Services.prefs.getBoolPref(pref)) {
        this.LOG("Disabling prpl: " + id);
        continue;
      }

      let proto = this.getProtocolById(id);
      if (proto)
        protocols.push(proto);
    }
    return new nsSimpleEnumerator(protocols);
  },

  getProtocolById: function(aPrplId) {
    if (!this._initialized)
      throw Cr.NS_ERROR_NOT_INITIALIZED;

    if (this._protos.hasOwnProperty(aPrplId))
      return this._protos[aPrplId];

    let cid;
    try {
      cid = categoryManager.getCategoryEntry(kProtocolPluginCategory, aPrplId);
    } catch (e) {
      return null; // no protocol registered for this id.
    }

    let proto = null;
    try {
      proto = Cc[cid].createInstance(Ci.prplIProtocol);
    } catch (e) {
      // This is a real error, the protocol is registered and failed to init.
      let error = "failed to create an instance of " + cid + ": " + e;
      dump(error + "\n");
      Cu.reportError(error);
    }
    if (!proto)
      return null;

    try {
      proto.init(aPrplId);
    } catch (e) {
      Cu.reportError("Could not initialize protocol " + aPrplId + ": " + e);
      return null;
    }

    this._protos[aPrplId] = proto;
    return proto;
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imICoreService]),
  classDescription: "Core",
  classID: Components.ID("{073f5953-853c-4a38-bd81-255510c31c2e}"),
  contractID: "@mozilla.org/chat/core-service;1"
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([CoreService]);
