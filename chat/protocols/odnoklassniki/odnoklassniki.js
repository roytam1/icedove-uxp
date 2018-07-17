/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var {interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("resource:///modules/jsProtoHelper.jsm");
Cu.import("resource:///modules/xmpp.jsm");
Cu.import("resource:///modules/xmpp-session.jsm");

XPCOMUtils.defineLazyGetter(this, "_", () =>
  l10nHelper("chrome://chat/locale/xmpp.properties")
);

function OdnoklassnikiAccount(aProtoInstance, aImAccount) {
  this._init(aProtoInstance, aImAccount);
}
OdnoklassnikiAccount.prototype = {
  __proto__: XMPPAccountPrototype,
  get canJoinChat() { return false; },
  connect: function() {
    if (!this.name.includes("@")) {
      // TODO: Do not use the default resource value if the user has not
      // specified it and let the service generate it.
      let jid = this.name + "@odnoklassniki.ru/" + XMPPDefaultResource;
      this._jid = this._parseJID(jid);
    }
    else {
      this._jid = this._parseJID(this.name);
      if (this._jid.domain != "odnoklassniki.ru") {
        // We can't use this.onError because this._connection doesn't exist.
        this.reportDisconnecting(Ci.prplIAccount.ERROR_INVALID_USERNAME,
                                 _("connection.error.invalidUsername"));
        this.reportDisconnected();
        return;
      }
    }

    this._connection = new XMPPSession("xmpp.odnoklassniki.ru", 5222,
                                       "require_tls", this._jid,
                                       this.imAccount.password, this);
  }
};

function OdnoklassnikiProtocol() {
}
OdnoklassnikiProtocol.prototype = {
  __proto__: GenericProtocolPrototype,
  get normalizedName() { return "odnoklassniki"; },
  get name() { return _("odnoklassniki.protocolName"); },
  get iconBaseURI() { return "chrome://prpl-odnoklassniki/skin/"; },
  get usernameEmptyText() { return _("odnoklassniki.usernameHint"); },
  getAccount: function(aImAccount) { return new OdnoklassnikiAccount(this, aImAccount); },
  classID: Components.ID("{29b09a83-81c1-2032-11e2-6d9bc4f8e969}")
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([OdnoklassnikiProtocol]);
