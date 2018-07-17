/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var MODULE_NAME = "cloudfile-backend-helpers";

var RELATIVE_ROOT = "../shared-modules";
var MODULE_REQUIRES = ["window-helpers"];

Cu.import('resource://gre/modules/XPCOMUtils.jsm');

var kUserAuthRequested = "cloudfile:auth";
var kUserDataRequested = "cloudfile:user";
var kUploadFile = "cloudfile:uploadFile";
var kGetFileURL = "cloudfile:getFileURL";
var kDeleteFile = "cloudfile:deleteFile";
var kLogout = "cloudfile:logout";

var wh;

function installInto(module) {
  setupModule(module);
  module.kUserAuthRequested = kUserAuthRequested;
  module.kUserDataRequested = kUserDataRequested;
  module.kUploadFile = kUploadFile;
  module.kGetFileURL = kGetFileURL;
  module.kDeleteFile = kDeleteFile;
  module.kLogout = kLogout;
  module.SimpleRequestObserverManager = SimpleRequestObserverManager;
  module.SimpleRequestObserver = SimpleRequestObserver;
  module.assert_can_cancel_uploads = assert_can_cancel_uploads;
}

function setupModule(module) {
  wh = collector.getModule('window-helpers');
}

function SimpleRequestObserverManager() {
  this._observers = [];
}

SimpleRequestObserverManager.prototype = {
  create: function(aName) {
    let obs = new SimpleRequestObserver(aName);
    this._observers.push(obs);
    return obs;
  },

  check: function() {
    for (let observer of this._observers) {
      if (!observer.success)
        throw new Error("An observer named " + observer.name + " was leftover, "
                        + "with its success attribute set to: "
                        + observer.success);
    }
  },

  reset: function() {
    this._observers = [];
  }
}

function SimpleRequestObserver(aName) {
  this.name = aName;
};

SimpleRequestObserver.prototype = {
  success: null,
  onStartRequest: function(aRequest, aContext) {},
  onStopRequest: function(aRequest, aContext, aStatusCode) {
    if (Components.isSuccessCode(aStatusCode)) {
      this.success = true;
    } else {
      this.success = false;
    }
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIRequestObserver,
                                         Ci.nsISupportsWeakReference]),
}

/**
 * This function uploads one or more files, and then proceeds to cancel
 * them.  This function assumes that the mock server for the provider
 * is prepared for the uploaded files, and will give enough time for
 * the uploads to be cancelled before they complete.
 *
 * @param aController the controller to use for waitFors.
 * @param aProvider the provider to upload and cancel the files with.
 * @param aFiles the array of files to upload.
 */
function assert_can_cancel_uploads(aController, aProvider, aFiles) {
  let fileListenerMap = [];
  wh.plan_for_observable_event("cloudfile:uploadStarted");

  for (let file of aFiles) {
    let mapping = {};
    mapping.listener = {
      onStartRequest: function(aRequest, aContext) {
        mapping.started = true;
      },
      onStopRequest: function(aRequest, aContext, aStatusCode) {
        if (aStatusCode == Ci.nsIMsgCloudFileProvider.uploadCanceled)
          mapping.cancelled = true;
      },
    }

    aProvider.uploadFile(file, mapping.listener);
    fileListenerMap.push(mapping);
  }

  // Wait for the first file to start uploading...
  wh.wait_for_observable_event("cloudfile:uploadStarted");

  // Go backwards through the file list, ensuring that we can cancel the
  // last file, all the way to the first.
  for (let i = aFiles.length - 1; i >= 0; --i)
    aProvider.cancelFileUpload(aFiles[i]);

  aController.waitFor(function() {
    return fileListenerMap.length == aFiles.length &&
           fileListenerMap.every(function(aMapping) {
             return aMapping.cancelled
           })
  }, "Timed out waiting for cancellation to occur");
}
