/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = ["ircHandlers"];

var Cu = Components.utils;

Cu.import("resource:///modules/ircUtils.jsm");

var ircHandlers = {
  /*
   * Object to hold the IRC handlers, each handler is an object that implements:
   *   name        The display name of the handler.
   *   priority    The priority of the handler (0 is default, positive is
   *               higher priority)
   *   isEnabled   A function where 'this' is bound to the account object. This
   *               should reflect whether this handler should be used for this
   *               account.
   *   commands    An object of commands, each command is a function which
   *               accepts a message object and has 'this' bound to the account
   *               object. It should return whether the message was successfully
   *               handler or not.
   */
  _ircHandlers: [],
  // Object to hold the ISUPPORT handlers, expects the same fields as
  // _ircHandlers.
  _isupportHandlers: [],
  // Object to hold the Client Capabilities handlers, expects the same fields as
  // _ircHandlers.
  _capHandlers: [],
  // Object to hold the CTCP handlers, expects the same fields as _ircHandlers.
  _ctcpHandlers: [],
  // Object to hold the DCC handlers, expects the same fields as _ircHandlers.
  _dccHandlers: [],
  // Object to hold the Services handlers, expects the same fields as
  // _ircHandlers.
  _servicesHandlers: [],

  _registerHandler: function(aArray, aHandler) {
    // Protect ourselves from adding broken handlers.
    if (!("commands" in aHandler)) {
      Cu.reportError(new Error("IRC handlers must have a \"commands\" " +
                               "property: " + aHandler.name));
      return false;
    }
    if (!("isEnabled" in aHandler)) {
      Cu.reportError(new Error("IRC handlers must have a \"isEnabled\" " +
                               "property: " + aHandler.name));
      return false;
    }

    aArray.push(aHandler);
    aArray.sort((a, b) => b.priority - a.priority);
    return true;
  },

  _unregisterHandler: function(aArray, aHandler) {
    return aArray.filter(h => h.name != aHandler.name);
  },

  registerHandler: function(aHandler) {
    return this._registerHandler(this._ircHandlers, aHandler);
  },
  unregisterHandler: function(aHandler) {
    this._ircHandlers = this._unregisterHandler(this._ircHandlers, aHandler);
  },

  registerISUPPORTHandler: function(aHandler) {
    return this._registerHandler(this._isupportHandlers, aHandler);
  },
  unregisterISUPPORTHandler: function(aHandler) {
    this._isupportHandlers = this._unregisterHandler(this._isupportHandlers,
                                                     aHandler);
  },

  registerCAPHandler: function(aHandler) {
    return this._registerHandler(this._capHandlers, aHandler);
  },
  unregisterCAPHandler: function(aHandler) {
    this._capHandlers = this._unregisterHandler(this._capHandlers, aHandler);
  },

  registerCTCPHandler: function(aHandler) {
    return this._registerHandler(this._ctcpHandlers, aHandler);
  },
  unregisterCTCPHandler: function(aHandler) {
    this._ctcpHandlers = this._unregisterHandler(this._ctcpHandlers, aHandler);
  },

  registerDCCHandler: function(aHandler) {
    return this._registerHandler(this._dccHandlers, aHandler);
  },
  unregisterDCCHandler: function(aHandler) {
    this._dccHandlers = this._unregisterHandler(this._dccHandlers, aHandler);
  },

  registerServicesHandler: function(aHandler) {
    return this._registerHandler(this._servicesHandlers, aHandler);
  },
  unregisterServicesHandler: function(aHandler) {
    this._servicesHandlers = this._unregisterHandler(this._servicesHandlers,
                                                     aHandler);
  },

  // Handle a message based on a set of handlers.
  _handleMessage: function(aHandlers, aAccount, aMessage, aCommand) {
    // Loop over each handler and run the command until one handles the message.
    for (let handler of aHandlers) {
      try {
        // Attempt to execute the command, by checking if the handler has the
        // command.
        // Parse the command with the JavaScript account object as "this".
        if (handler.isEnabled.call(aAccount) &&
            Object.prototype.hasOwnProperty.call(handler.commands, aCommand) &&
            handler.commands[aCommand].call(aAccount, aMessage))
          return true;
      } catch (e) {
        // We want to catch an error here because one of our handlers are
        // broken, if we don't catch the error, the whole IRC plug-in will die.
        aAccount.ERROR("Error running command " + aCommand + " with handler " +
                       handler.name + ":\n" + JSON.stringify(aMessage), e);
      }
    }

    return false;
  },

  handleMessage: function(aAccount, aMessage) {
    return this._handleMessage(this._ircHandlers, aAccount, aMessage,
                               aMessage.command.toUpperCase());
  },

  handleISUPPORTMessage: function(aAccount, aMessage) {
    return this._handleMessage(this._isupportHandlers, aAccount, aMessage,
                               aMessage.isupport.parameter);
  },

  handleCAPMessage: function(aAccount, aMessage) {
    return this._handleMessage(this._capHandlers, aAccount, aMessage,
                               aMessage.cap.parameter);
  },

  // aMessage is a CTCP Message, which inherits from an IRC Message.
  handleCTCPMessage: function(aAccount, aMessage) {
    return this._handleMessage(this._ctcpHandlers, aAccount, aMessage,
                               aMessage.ctcp.command);
  },

  // aMessage is a DCC Message, which inherits from a CTCP Message.
  handleDCCMessage: function(aAccount, aMessage) {
    return this._handleMessage(this._dccHandlers, aAccount, aMessage,
                               aMessage.ctcp.dcc.type);
  },

  // aMessage is a Services Message.
  handleServicesMessage: function(aAccount, aMessage) {
    return this._handleMessage(this._servicesHandlers, aAccount, aMessage,
                               aMessage.serviceName);
  },

  // Checking if handlers exist.
  get hasHandlers() { return this._ircHandlers.length > 0; },
  get hasISUPPORTHandlers() { return this._isupportHandlers.length > 0; },
  get hasCAPHandlers() { return this._capHandlers.length > 0; },
  get hasCTCPHandlers() { return this._ctcpHandlers.length > 0; },
  get hasDCCHandlers() { return this._dccHandlers.length > 0; },
  get hasServicesHandlers() { return this._servicesHandlers.length > 0; },

  // Some constant priorities.
  get LOW_PRIORITY() { return -100; },
  get DEFAULT_PRIORITY() { return 0; },
  get HIGH_PRIORITY() { return 100; }
};
