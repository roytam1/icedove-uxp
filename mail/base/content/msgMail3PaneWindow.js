/** ***** BEGIN LICENSE BLOCK *****
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource:///modules/activity/activityModules.js");
Components.utils.import("resource:///modules/errUtils.js");
Components.utils.import("resource:///modules/folderUtils.jsm");
Components.utils.import("resource:///modules/IOUtils.js");
Components.utils.import("resource:///modules/jsTreeSelection.js");
Components.utils.import("resource:///modules/MailConsts.js");
Components.utils.import("resource:///modules/mailInstrumentation.js");
Components.utils.import("resource:///modules/mailnewsMigrator.js");
Components.utils.import("resource:///modules/mailServices.js");
Components.utils.import("resource:///modules/msgDBCacheManager.js");
Components.utils.import("resource:///modules/sessionStoreManager.js");
Components.utils.import("resource:///modules/summaryFrameManager.js");
Components.utils.import("resource:///modules/MailUtils.js");
Components.utils.import("resource://gre/modules/Services.jsm");

/* This is where functions related to the 3 pane window are kept */

// from MailNewsTypes.h
var nsMsgKey_None = 0xFFFFFFFF;
var nsMsgViewIndex_None = 0xFFFFFFFF;
var kMailCheckOncePrefName = "mail.startup.enabledMailCheckOnce";

var kStandardPaneConfig = 0;
var kWidePaneConfig = 1;
var kVerticalPaneConfig = 2;

var kNumFolderViews = 4; // total number of folder views

/** widget with id=messagepanebox, initialized by GetMessagePane() */
var gMessagePane;

/** widget with id=messagepaneboxwrapper, initialized by GetMessagePaneWrapper() */
var gMessagePaneWrapper;

var gThreadAndMessagePaneSplitter = null;
/**
 * Tracks whether the right mouse button changed the selection or not.  If the
 * user right clicks on the selection, it stays the same.  If they click outside
 * of it, we alter the selection (but not the current index) to be the row they
 * clicked on.
 *
 * The value of this variable is an object with "view" and "selection" keys
 * and values.  The view value is the view whose selection we saved off, and
 * the selection value is the selection object we saved off.
 */
var gRightMouseButtonSavedSelection = null;
var gNewAccountToLoad = null;

var gDisplayStartupPage = false;

// The object in charge of managing the mail summary pane
var gSummaryFrameManager;

// the folderListener object
var folderListener = {
    OnItemAdded: function(parentItem, item) { },

    OnItemRemoved: function(parentItem, item) { },

    OnItemPropertyChanged: function(item, property, oldValue, newValue) { },

    OnItemIntPropertyChanged: function(item, property, oldValue, newValue) {
      if (item == gFolderDisplay.displayedFolder) {
        if(property.toString() == "TotalMessages" || property.toString() == "TotalUnreadMessages") {
          UpdateStatusMessageCounts(gFolderDisplay.displayedFolder);
        }
      }
    },

    OnItemBoolPropertyChanged: function(item, property, oldValue, newValue) { },

    OnItemUnicharPropertyChanged: function(item, property, oldValue, newValue) { },
    OnItemPropertyFlagChanged: function(item, property, oldFlag, newFlag) { },

    OnItemEvent: function(folder, event) {
      var eventType = event.toString();
      if (eventType == "ImapHdrDownloaded") {
        if (folder) {
          var imapFolder = folder.QueryInterface(Components.interfaces.nsIMsgImapMailFolder);
          if (imapFolder) {
            var hdrParser = imapFolder.hdrParser;
            if (hdrParser) {
              var msgHdr = hdrParser.GetNewMsgHdr();
              if (msgHdr)
              {
                var hdrs = hdrParser.headers;
                if (hdrs && hdrs.indexOf("X-attachment-size:") > 0) {
                  msgHdr.OrFlags(Components.interfaces.nsMsgMessageFlags
                                           .Attachment);
                }
                if (hdrs && hdrs.indexOf("X-image-size:") > 0) {
                  msgHdr.setStringProperty("imageSize", "1");
                }
              }
            }
          }
        }
      }
      else if (eventType == "JunkStatusChanged") {
        HandleJunkStatusChanged(folder);
      }
    }
}

/*
 * Listen for Lightweight Theme styling changes and update the theme accordingly.
 */
var LightweightThemeListener = {
  _modifiedStyles: [],

  init: function () {
    XPCOMUtils.defineLazyGetter(this, "styleSheet", function() {
      for (let i = document.styleSheets.length - 1; i >= 0; i--) {
        let sheet = document.styleSheets[i];
        if (sheet.href == "chrome://messenger/skin/messengerLWTheme.css")
          return sheet;
      }
    });

    Services.obs.addObserver(this, "lightweight-theme-styling-update", false);
    Services.obs.addObserver(this, "lightweight-theme-optimized", false);
    if (document.documentElement.hasAttribute("lwtheme"))
      this.updateStyleSheet(document.documentElement.style.backgroundImage);
  },

  uninit: function () {
    Services.obs.removeObserver(this, "lightweight-theme-styling-update");
    Services.obs.removeObserver(this, "lightweight-theme-optimized");
  },

  /**
   * Append the headerImage to the background-image property of all rulesets in
   * messengerLWTheme.css.
   *
   * @param headerImage - a string containing a CSS image for the lightweight
   * theme header.
   */
  updateStyleSheet: function(headerImage) {
    if (!this.styleSheet)
      return;
    for (let i = 0; i < this.styleSheet.cssRules.length; i++) {
      let rule = this.styleSheet.cssRules[i];
      if (!rule.style.backgroundImage)
        continue;

      if (!this._modifiedStyles[i])
        this._modifiedStyles[i] = { backgroundImage: rule.style.backgroundImage };

      rule.style.backgroundImage = this._modifiedStyles[i].backgroundImage + ", " + headerImage;
    }
  },

  // nsIObserver
  observe: function (aSubject, aTopic, aData) {
    if ((aTopic != "lightweight-theme-styling-update" && aTopic != "lightweight-theme-optimized") ||
          !this.styleSheet)
      return;

    if (aTopic == "lightweight-theme-optimized" && aSubject != window)
      return;

    let themeData = JSON.parse(aData);
    if (!themeData)
      return;
    this.updateStyleSheet("url(" + themeData.headerURL + ")");
  },
};

function ServerContainsFolder(server, folder)
{
  if (!folder || !server)
    return false;

  return server.equals(folder.server);
}

function SelectServer(server)
{
  gFolderTreeView.selectFolder(server.rootFolder);
}

// we have this incoming server listener in case we need to
// alter the folder pane selection when a server is removed
// or changed (currently, when the real username or real hostname change)
var gThreePaneIncomingServerListener = {
    onServerLoaded: function(server) {},
    onServerUnloaded: function(server) {
      let defaultServer;
      try {
        defaultServer = accountManager.defaultAccount.incomingServer;
      } catch (e) {
       // If there is no default server we have nothing to do.
       return;
      }

      var selectedFolders = GetSelectedMsgFolders();
      for (var i = 0; i < selectedFolders.length; i++) {
        if (ServerContainsFolder(server, selectedFolders[i])) {
          SelectServer(defaultServer);
          // we've made a new selection, we're done
          return;
        }
      }

      // if nothing is selected at this point, better go select the default
      // this could happen if nothing was selected when the server was removed
      selectedFolders = GetSelectedMsgFolders();
      if (selectedFolders.length == 0) {
        SelectServer(defaultServer);
      }
    },
    onServerChanged: function(server) {
      // if the current selected folder is on the server that changed
      // and that server is an imap or news server,
      // we need to update the selection.
      // on those server types, we'll be reconnecting to the server
      // and our currently selected folder will need to be reloaded
      // or worse, be invalid.
      if (server.type != "imap" && server.type !="nntp")
        return;

      var selectedFolders = GetSelectedMsgFolders();
      for (var i = 0; i < selectedFolders.length; i++) {
        // if the selected item is a server, we don't have to update
        // the selection
        if (!(selectedFolders[i].isServer) && ServerContainsFolder(server, selectedFolders[i])) {
          SelectServer(server);
          // we've made a new selection, we're done
          return;
        }
      }
    }
}

// aMsgWindowInitialized: false if we are calling from the onload handler, otherwise true
function UpdateMailPaneConfig(aMsgWindowInitialized) {
  const dynamicIds = ["messagesBox", "mailContent", "threadPaneBox"];
  const layouts = ["standard", "wide", "vertical"];
  var layoutView = Services.prefs.getIntPref("mail.pane_config.dynamic");
  // Ensure valid value; hard fail if not.
  layoutView = dynamicIds[layoutView] ? layoutView : kStandardPaneConfig;
  var desiredId = dynamicIds[layoutView];
  document.getElementById("mailContent")
          .setAttribute("layout", layouts[layoutView]);
  var messagePaneBoxWrapper = GetMessagePaneWrapper();
  if (messagePaneBoxWrapper.parentNode.id != desiredId) {
    ClearAttachmentList();
    var hdrToolbox = document.getElementById("header-view-toolbox");
    var hdrToolbar = document.getElementById("header-view-toolbar");
    var firstPermanentChild = hdrToolbar.firstPermanentChild;
    var lastPermanentChild = hdrToolbar.lastPermanentChild;
    var messagePaneSplitter = GetThreadAndMessagePaneSplitter();
    var desiredParent = document.getElementById(desiredId);

    // Here the message pane including the header pane is moved to the
    // new layout by the appendChild() method below.  As described in bug
    // 519956 only elements in the DOM tree are copied to the new place
    // whereas javascript class variables of DOM tree elements get lost.
    // In this case the ToolboxPalette, Toolbarset first/lastPermanentChild
    // are removed which results in the message header pane not being
    // customizable any more.  A workaround for this problem is to clone
    // them first and add them to the DOM tree after the message pane has
    // been moved.
    var cloneToolboxPalette;
    var cloneToolbarset;
    if (hdrToolbox.palette) {
      cloneToolboxPalette = hdrToolbox.palette.cloneNode(true);
    }
    if (hdrToolbox.toolbarset) {
      cloneToolbarset = hdrToolbox.toolbarset.cloneNode(true);
    }

    // See Bug 381992. The ctor for the browser element will fire again when we
    // re-insert the messagePaneBoxWrapper back into the document.  But the dtor
    // doesn't fire when the element is removed from the document.  Manually
    // call destroy here to avoid a nasty leak.
    document.getElementById("messagepane").destroy();
    let footerBox = desiredParent.lastChild;
    if (footerBox && footerBox.id == "msg-footer-notification-box") {
      desiredParent.insertBefore(messagePaneSplitter, footerBox);
      desiredParent.insertBefore(messagePaneBoxWrapper, footerBox);
    } else {
      desiredParent.appendChild(messagePaneSplitter);
      desiredParent.appendChild(messagePaneBoxWrapper);
    }
    hdrToolbox.palette  = cloneToolboxPalette;
    hdrToolbox.toolbarset = cloneToolbarset;
    hdrToolbar = document.getElementById("header-view-toolbar");
    hdrToolbar.firstPermanentChild = firstPermanentChild;
    hdrToolbar.lastPermanentChild = lastPermanentChild;
    messagePaneSplitter.orient = desiredParent.orient;
    if (aMsgWindowInitialized)
    {
      messenger.setWindow(null, null);
      messenger.setWindow(window, msgWindow);
      ReloadMessage();
    }

    // The quick filter bar gets badly lied to due to standard XUL/XBL problems,
    //  so we need to generate synthetic notifications after a delay on those
    //  nodes that care about overflow.  The 'lie' comes in the form of being
    //  given (at startup) an overflow event with a tiny clientWidth (100), then
    //  a more tiny resize event (clientWidth = 32), then a resize event that
    //  claims the entire horizontal space is allocated to us
    //  (clientWidth = 1036).  It would appear that when the messagepane's XBL
    //  binding (or maybe the splitter's?) finally activates, the quick filter
    //  pane gets resized down without any notification.
    // Our solution tries to be generic and help out any code with an onoverflow
    //  handler.  We will also generate an onresize notification if it turns out
    //  that onoverflow is not appropriate (and such a handler is registered).
    //  This does require that XUL attributes were used to register the handlers
    //  rather than addEventListener.
    // The choice of the delay is basically a kludge because something like 10ms
    //  may be insufficient to ensure we get enqueued after whatever triggers
    //  the layout discontinuity.  (We need to wait for a paint to happen to
    //  trigger the XBL binding, and then there may be more complexities...)
    setTimeout(function UpdateMailPaneConfig_deferredFixup() {
      let threadPaneBox = document.getElementById("threadPaneBox");
      let overflowNodes =
        threadPaneBox.querySelectorAll("[onoverflow]");

      for (let iNode = 0; iNode < overflowNodes.length; iNode++) {
        let node = overflowNodes[iNode];

        if (node.scrollWidth > node.clientWidth) {
          let e = document.createEvent("HTMLEvents");
          e.initEvent("overflow", false, false);
          node.dispatchEvent(e);
        }
        else if (node.onresize) {
          let e = document.createEvent("HTMLEvents");
          e.initEvent("resize", false, false);
          node.dispatchEvent(e);
        }
      }
    }, 1500);
  }
}

var MailPrefObserver = {
  observe: function(subject, topic, prefName) {
    // verify that we're changing the mail pane config pref
    if (topic == "nsPref:changed")
    {
      if (prefName == "mail.pane_config.dynamic")
        UpdateMailPaneConfig(true);
      else if (prefName == "mail.showCondensedAddresses")
      {
        var currentDisplayNameVersion;
        var threadTree = document.getElementById("threadTree");

        currentDisplayNameVersion =
            Services.prefs.getIntPref("mail.displayname.version");

        Services.prefs.setIntPref("mail.displayname.version",
                                  ++currentDisplayNameVersion);

        //refresh the thread pane
        threadTree.treeBoxObject.invalidate();
      }
    }
  }
};

/**
 * Called on startup if there are no accounts.
 */
function AutoConfigWizard(okCallback)
{
  let suppressDialogs = false;

  // Try to get the suppression pref that we stashed away in accountProvisionerTab.js.
  // If it doesn't exist, nsIPrefBranch throws, so we eat it silently and move along.
  try {
    suppressDialogs = Services.prefs.getBoolPref("mail.provider.suppress_dialog_on_startup");
  } catch(e) {};

  if (suppressDialogs) {
    // Looks like we were in the middle of filling out an account form. We
    // won't display the dialogs in that case.
    Services.prefs.clearUserPref("mail.provider.suppress_dialog_on_startup");
    okCallback();
    return;
  }

  if (Services.prefs.getBoolPref("mail.provider.enabled")) {
    Services.obs.addObserver({
      observe: function(aSubject, aTopic, aData) {
        if (aTopic == "mail-tabs-session-restored" && aSubject === window) {
          // We're done here, unregister this observer.
          Services.obs.removeObserver(this, "mail-tabs-session-restored");
          NewMailAccountProvisioner(msgWindow, { okCallback: null });
        }
      }
    }, "mail-tabs-session-restored", false);
    okCallback();
  }
  else
    NewMailAccount(msgWindow, okCallback);
}

/**
 * Called on startup to initialize various parts of the main window
 */
function OnLoadMessenger()
{
  migrateMailnews();
  // Rig up our TabsInTitlebar early so that we can catch any resize events.
  TabsInTitlebar.init();
  // Listen for Lightweight Theme styling changes and update the theme accordingly.
  LightweightThemeListener.init();
  // update the pane config before we exit onload otherwise the user may see a flicker if we poke the document
  // in delayedOnLoadMessenger...
  UpdateMailPaneConfig(false);
  document.loadBindingDocument('chrome://global/content/bindings/textbox.xml');

#ifdef XP_WIN
  // On Win8 set an attribute when the window frame color is too dark for black text.
  if (window.matchMedia("(-moz-os-version: windows-win8)").matches &&
      window.matchMedia("(-moz-windows-default-theme)").matches) {
    let windows8WindowFrameColor = Cu.import("resource:///modules/Windows8WindowFrameColor.jsm", {}).Windows8WindowFrameColor;
    let windowFrameColor = windows8WindowFrameColor.get();

    // Formula from W3C's WCAG 2.0 spec's color ratio and relative luminance,
    // section 1.3.4, http://www.w3.org/TR/WCAG20/ .
    windowFrameColor = windowFrameColor.map((color) => {
      if (color <= 10) {
        return color / 255 / 12.92;
      }
      return Math.pow(((color / 255) + 0.055) / 1.055, 2.4);
    });
    let backgroundLuminance = windowFrameColor[0] * 0.2126 +
                              windowFrameColor[1] * 0.7152 +
                              windowFrameColor[2] * 0.0722;
    let foregroundLuminance = 0; // Default to black for foreground text.
    let contrastRatio = (backgroundLuminance + 0.05) / (foregroundLuminance + 0.05);
    if (contrastRatio < 3) {
      document.documentElement.setAttribute("darkwindowframe", "true");
    }
  }
#endif

  ToolbarIconColor.init();

  // Set a sane starting width/height for all resolutions on new profiles.
  // Do this before the window loads.
  if (!document.documentElement.hasAttribute("width"))
  {
    // Prefer 1024xfull height.
    let defaultHeight = screen.availHeight;
    let defaultWidth = (screen.availWidth <= 1024) ? screen.availWidth : 1024;

    // On small screens, default to maximized state.
    if (defaultHeight <= 600)
      document.documentElement.setAttribute("sizemode", "maximized");

    document.documentElement.setAttribute("width", defaultWidth);
    document.documentElement.setAttribute("height", defaultHeight);
    // Make sure we're safe at the left/top edge of screen
    document.documentElement.setAttribute("screenX", screen.availLeft);
    document.documentElement.setAttribute("screenY", screen.availTop);
  }

  Services.prefs.addObserver("mail.pane_config.dynamic", MailPrefObserver, false);
  Services.prefs.addObserver("mail.showCondensedAddresses", MailPrefObserver,
                             false);

  MailOfflineMgr.init();
  CreateMailWindowGlobals();
  GetMessagePaneWrapper().collapsed = true;
  msgDBCacheManager.init();
  Services.search.init();

  // This needs to be before we throw up the account wizard on first run.
  try {
    mailInstrumentationManager.init();
  } catch(ex) {logException(ex);}

  // - initialize tabmail system
  // Do this before LoadPostAccountWizard since that code selects the first
  //  folder for display, and we want gFolderDisplay setup and ready to handle
  //  that event chain.
  // Also, we definitely need to register the tab type prior to the call to
  //  specialTabs.openSpecialTabsOnStartup below.
  let tabmail = document.getElementById('tabmail');
  if (tabmail)
  {
    // mailTabType is defined in mailTabs.js
    tabmail.registerTabType(mailTabType);
    // glodaFacetTab* in glodaFacetTab.js
    tabmail.registerTabType(glodaFacetTabType);
    QuickFilterBarMuxer._init();
    tabmail.registerTabMonitor(GlodaSearchBoxTabMonitor);
    tabmail.registerTabMonitor(statusMessageCountsMonitor);
    tabmail.openFirstTab();
  }

  // Install the light-weight theme handlers
  let panelcontainer = document.getElementById("tabpanelcontainer");
  if (panelcontainer) {
    panelcontainer.addEventListener("InstallBrowserTheme",
                                    LightWeightThemeWebInstaller, false, true);
    panelcontainer.addEventListener("PreviewBrowserTheme",
                                    LightWeightThemeWebInstaller, false, true);
    panelcontainer.addEventListener("ResetBrowserThemePreview",
                                    LightWeightThemeWebInstaller, false, true);
  }

  Services.obs.addObserver(gPluginHandler.pluginCrashed, "plugin-crashed", false);

  // This also registers the contentTabType ("contentTab")
  specialTabs.openSpecialTabsOnStartup();
  preferencesTabType.initialize();
  // accountProvisionerTabType is defined in accountProvisionerTab.js
  tabmail.registerTabType(accountProvisionerTabType);

  // verifyAccounts returns true if the callback won't be called
  // We also don't want the account wizard to open if any sort of account exists
  if (verifyAccounts(LoadPostAccountWizard, false, AutoConfigWizard))
    LoadPostAccountWizard();

  // Set up the summary frame manager to handle loading pages in the
  // multi-message pane
  gSummaryFrameManager = new SummaryFrameManager(
                         document.getElementById("multimessage"));

  window.addEventListener("AppCommand", HandleAppCommandEvent, true);
}

function LoadPostAccountWizard()
{
  InitMsgWindow();
  messenger.setWindow(window, msgWindow);

  InitPanes();
  MigrateAttachmentDownloadStore();
  MigrateJunkMailSettings();
  MigrateFolderViews();
  MigrateOpenMessageBehavior();
  Components.utils.import("resource:///modules/mailMigrator.js");
  MailMigrator.migratePostAccountWizard();

  accountManager.setSpecialFolders();

  try {
    accountManager.loadVirtualFolders();
  } catch (e) {Components.utils.reportError(e);}
  accountManager.addIncomingServerListener(gThreePaneIncomingServerListener);

  gPhishingDetector.init();

  AddToSession();

  //need to add to session before trying to load start folder otherwise listeners aren't
  //set up correctly.

  let startFolderURI = null, startMsgHdr = null;
  if ("arguments" in window && window.arguments.length > 0)
  {
    let arg0 = window.arguments[0];
    // If the argument is a string, it is either a folder URI or a feed URI
    if (typeof arg0 == "string")
    {
      // filter our any feed urls that came in as arguments to the new window...
      if (arg0.toLowerCase().startsWith("feed:"))
      {
        let feedHandler = Components.classes["@mozilla.org/newsblog-feed-downloader;1"]
          .getService(Components.interfaces.nsINewsBlogFeedDownloader);
        if (feedHandler)
          feedHandler.subscribeToFeed(arg0, null, msgWindow);
      }
      else
      {
        startFolderURI = arg0;
      }
    }
    else if (arg0)
    {
      // arg0 is an object
      if (("wrappedJSObject" in arg0) && arg0.wrappedJSObject)
        arg0 = arg0.wrappedJSObject;
      startMsgHdr = ("msgHdr" in arg0) ? arg0.msgHdr : null;
    }
  }

  function completeStartup() {
    // Check whether we need to show the default client dialog
    // First, check the shell service
    var nsIShellService = Components.interfaces.nsIShellService;
    if (nsIShellService) {
      var shellService;
      var defaultAccount;
      try {
        shellService = Components.classes["@mozilla.org/mail/shell-service;1"].getService(nsIShellService);
        defaultAccount = accountManager.defaultAccount;
      } catch (ex) {}

      // Next, try loading the search integration module
      // We'll get a null SearchIntegration if we don't have one
      Components.utils.import("resource:///modules/SearchIntegration.js");

      // Show the default client dialog only if
      // EITHER: we have at least one account, and we aren't already the default
      // for mail,
      // OR: we have the search integration module, the OS version is suitable,
      // and the first run hasn't already been completed.
      // Needs to be shown outside the he normal load sequence so it doesn't appear
      // before any other displays, in the wrong place of the screen.
      if ((shellService && defaultAccount && shellService.shouldCheckDefaultClient
           && !shellService.isDefaultClient(true, nsIShellService.MAIL)) ||
        (SearchIntegration && !SearchIntegration.osVersionTooLow &&
         !SearchIntegration.osComponentsNotRunning && !SearchIntegration.firstRunDone)) {
        window.openDialog("chrome://messenger/content/systemIntegrationDialog.xul",
                          "SystemIntegration", "modal,centerscreen,chrome,resizable=no");
        // On windows, there seems to be a delay between setting TB as the
        // default client, and the isDefaultClient check succeeding.
        if (shellService.isDefaultClient(true, nsIShellService.MAIL))
          Services.obs.notifyObservers(window, "mail:setAsDefault", null);
      }
    }
    // All core modal dialogs are done, the user can now interact with the 3-pane window
    Services.obs.notifyObservers(window, "mail-startup-done", null);
  }

  setTimeout(completeStartup, 0);

  // FIX ME - later we will be able to use onload from the overlay
  OnLoadMsgHeaderPane();

  //Set focus to the Thread Pane the first time the window is opened.
  SetFocusThreadPane();

  // initialize the customizeDone method on the customizeable toolbar
  var toolbox = document.getElementById("mail-toolbox");
  toolbox.customizeDone = function(aEvent) { MailToolboxCustomizeDone(aEvent, "CustomizeMailToolbar"); };

  var toolbarset = document.getElementById('customToolbars');
  toolbox.toolbarset = toolbarset;

  // XXX Do not select the folder until the window displays or the threadpane
  //  will be at minimum size.  We used to have
  //  gFolderDisplay.ensureRowIsVisible use settimeout itself to defer that
  //  calculation, but that was ugly.  Also, in theory we will open the window
  //  faster if we let the event loop start doing things sooner.

  if (startMsgHdr)
    window.setTimeout(loadStartMsgHdr, 0, startMsgHdr);
  else
    window.setTimeout(loadStartFolder, 0, startFolderURI);
}

function HandleAppCommandEvent(evt)
{
  evt.stopPropagation();
  switch (evt.command) {
    case "Back":
      goDoCommand('cmd_goBack');
      break;
    case "Forward":
      goDoCommand('cmd_goForward');
      break;
    case "Stop":
      msgWindow.StopUrls();
      break;
    case "Search":
      goDoCommand('cmd_search');
      break;
    case "Bookmarks":
      toAddressBook();
      break;
    case "Home":
    case "Reload":
    default:
      break;
  }
}

/**
 * Look for another 3-pane window.
 */
function FindOther3PaneWindow()
{
  // XXX We'd like to use getZOrderDOMWindowEnumerator here, but it doesn't work
  // on Linux
  let enumerator = Services.wm.getEnumerator("mail:3pane");
  while (enumerator.hasMoreElements()) {
    let win = enumerator.getNext();
    if (win != window)
      return win;
  }
  return null;
}

/**
 * Called by messenger.xul:onunload, the 3-pane window inside of tabs window.
 *  It's being unloaded!  Right now!
 */
function OnUnloadMessenger()
{
  Services.obs.notifyObservers(window, "mail-unloading-messenger", null);
  accountManager.removeIncomingServerListener(gThreePaneIncomingServerListener);
  Services.prefs.removeObserver("mail.pane_config.dynamic", MailPrefObserver);
  Services.prefs.removeObserver("mail.showCondensedAddresses", MailPrefObserver);

  if (gRightMouseButtonSavedSelection) {
    // Avoid possible cycle leaks.
    gRightMouseButtonSavedSelection.view = null;
    gRightMouseButtonSavedSelection = null;
  }

  sessionStoreManager.unloadingWindow(window);

  TabsInTitlebar.uninit();

  ToolbarIconColor.uninit();

  LightweightThemeListener.uninit();

  let tabmail = document.getElementById("tabmail");
  tabmail._teardown();

  MailServices.mailSession.RemoveFolderListener(folderListener);

  gPhishingDetector.shutdown();

  Services.obs.removeObserver(gPluginHandler.pluginCrashed, "plugin-crashed");

  // FIX ME - later we will be able to use onload from the overlay
  OnUnloadMsgHeaderPane();

  UnloadPanes();

  OnMailWindowUnload();
  try {
    mailInstrumentationManager.uninit();
  } catch (ex) {logException(ex);}
}

/**
 * Called by the session store manager periodically and at shutdown to get
 * the state of this window for persistence.
 */
function getWindowStateForSessionPersistence()
{
  let tabmail = document.getElementById('tabmail');
  let tabsState = tabmail.persistTabs();
  return { type: "3pane", tabs: tabsState };
}

/**
 * Attempt to restore our tab states.  This should only be called by
 * |loadStartFolder| or |loadStartMsgHdr|.
 *
 * @param aDontRestoreFirstTab If this is true, the first tab will not be
 *                             restored, and will continue to retain focus at
 *                             the end. This is needed if the window was opened
 *                             with a folder or a message as an argument.
 *
 * @return true if the restoration was successful, false otherwise.
 */
function atStartupRestoreTabs(aDontRestoreFirstTab) {

  let state = sessionStoreManager.loadingWindow(window);

  if (state) {
    let tabsState = state.tabs;
    let tabmail = document.getElementById("tabmail");
    tabmail.restoreTabs(tabsState, aDontRestoreFirstTab);
  }

  // it's now safe to load extra Tabs.
  setTimeout(loadExtraTabs, 0);
  Services.obs.notifyObservers(window, "mail-tabs-session-restored", null);
  return state ? true : false;
}

/**
 * Loads and restores tabs upon opening a window by evaluating window.arguments[1].
 *
 * The type of the object is specified by it's action property. It can be
 * either "restore" or "open". "restore" invokes tabmail.restoreTab() for each
 * item in the tabs array. While "open" invokes tabmail.openTab() for each item.
 *
 * In case a tab can't be restored it will fail silently
 *
 * the object need at least the following properties:
 *
 * {
 *   action = "restore" | "open"
 *   tabs = [];
 * }
 *
 */
function loadExtraTabs()
{

  if (!("arguments" in window) || window.arguments.length < 2)
    return;

  let tab = window.arguments[1];
  if ((!tab) || (typeof tab != "object"))
    return;

  let tabmail =  document.getElementById("tabmail");

  // we got no action, so suppose its "legacy" code
  if (!("action" in tab)) {

    if ("tabType" in tab)
      tabmail.openTab(tab.tabType, tab.tabParams);

    return;
  }

  if (!("tabs" in tab))
    return;

  // this is used if a tab is detached to a new window.
  if (tab.action == "restore") {

    for (let i = 0; i < tab.tabs.length; i++)
      tabmail.restoreTab(tab.tabs[i]);

    // we currently do not support opening in background or opening a
    // special position. So select the last tab opened.
    tabmail.switchToTab(tabmail.tabInfo[tabmail.tabInfo.length-1])

    return;
  }

  if (tab.action == "open") {

    for (let i = 0; i < tab.tabs.length; i++)
      if("tabType" in tabs.tab[i])
        tabmail.openTab(tabs.tab[i].tabType,tabs.tab[i].tabParams);

    return;
  }

}

/**
 * Loads the given message header at window open. Exactly one out of this and
 * |loadStartFolder| should be called.
 *
 * @param aStartMsgHdr The message header to load at window open
 */
function loadStartMsgHdr(aStartMsgHdr)
{
  // We'll just clobber the default tab
  atStartupRestoreTabs(true);

  MsgDisplayMessageInFolderTab(aStartMsgHdr);
}

function loadStartFolder(initialUri)
{
    var defaultServer = null;
    var startFolder;
    var isLoginAtStartUpEnabled = false;

    // If a URI was explicitly specified, we'll just clobber the default tab
    let loadFolder = !atStartupRestoreTabs(!!initialUri);

    if (initialUri)
      loadFolder = true;

    //First get default account
    try
    {

        if(initialUri)
            startFolder = MailUtils.getFolderForURI(initialUri);
        else
        {
            try {
                var defaultAccount = accountManager.defaultAccount;
            } catch (x) {
                return; // exception caused by no default account, ignore it.
            }

            defaultServer = defaultAccount.incomingServer;
            var rootMsgFolder = defaultServer.rootMsgFolder;

            startFolder = rootMsgFolder;

            // Enable check new mail once by turning checkmail pref 'on' to bring
            // all users to one plane. This allows all users to go to Inbox. User can
            // always go to server settings panel and turn off "Check for new mail at startup"
            if (!Services.prefs.getBoolPref(kMailCheckOncePrefName))
            {
                Services.prefs.setBoolPref(kMailCheckOncePrefName, true);
                defaultServer.loginAtStartUp = true;
            }

            // Get the user pref to see if the login at startup is enabled for default account
            isLoginAtStartUpEnabled = defaultServer.loginAtStartUp;

            // Get Inbox only if login at startup is enabled.
            if (isLoginAtStartUpEnabled)
            {
                //now find Inbox
                var outNumFolders = new Object();
                const kInboxFlag = Components.interfaces.nsMsgFolderFlags.Inbox;
                var inboxFolder = rootMsgFolder.getFolderWithFlags(kInboxFlag);
                if (!inboxFolder) return;

                startFolder = inboxFolder;
            }
        }

        // it is possible we were given an initial uri and we need to subscribe or try to add
        // the folder. i.e. the user just clicked on a news folder they aren't subscribed to from a browser
        // the news url comes in here.

        // Perform biff on the server to check for new mail, except for imap
        // or a pop3 account that is deferred or deferred to,
        // or the case where initialUri is non-null (non-startup)
        if (!initialUri && isLoginAtStartUpEnabled
            && !defaultServer.isDeferredTo &&
            defaultServer.rootFolder == defaultServer.rootMsgFolder)
          defaultServer.performBiff(msgWindow);
        if (loadFolder) {
          try {
            gFolderTreeView.selectFolder(startFolder);
          } catch(ex) {
            // This means we tried to select a folder that isn't in the current
            // view. Just select the first one in the view then.
            if (gFolderTreeView._rowMap.length)
              gFolderTreeView.selectFolder(gFolderTreeView._rowMap[0]._folder);
          }
        }
    }
    catch(ex)
    {
      // this is the case where we're trying to auto-subscribe to a folder.
      if (initialUri && !startFolder.parent)
      {
        // hack to force display of thread pane.
        ShowingThreadPane();
        messenger.loadURL(window, initialUri);
        return;
      }

      Components.utils.reportError(ex);
    }

    MsgGetMessagesForAllServers(defaultServer);

    if (MailOfflineMgr.isOnline()) {
      // Check if we shut down offline, and restarted online, in which case
      // we may have offline events to playback. Since this is not a pref
      // the user should set, it's not in mailnews.js, so we need a try catch.
      let playbackOfflineEvents = false;
      try {
        playbackOfflineEvents = Services.prefs.getBoolPref("mailnews.playback_offline");
      }
      catch(ex) {}
      if (playbackOfflineEvents)
      {
        Services.prefs.setBoolPref("mailnews.playback_offline", false);
        MailOfflineMgr.offlineManager.goOnline(false, true, msgWindow);
      }

      // If appropriate, send unsent messages. This may end up prompting the user,
      // so we need to get it out of the flow of the normal load sequence.
      setTimeout(function checkUnsent() {
        if (MailOfflineMgr.shouldSendUnsentMessages())
          SendUnsentMessages();
      }, 0);
    }
}

function AddToSession()
{
  var nsIFolderListener = Components.interfaces.nsIFolderListener;
  var notifyFlags = nsIFolderListener.intPropertyChanged | nsIFolderListener.event;
  MailServices.mailSession.AddFolderListener(folderListener, notifyFlags);
}

function InitPanes()
{
  gFolderTreeView.load(document.getElementById("folderTree"),
                       "folderTree.json");
  var folderTree = document.getElementById("folderTree");
  folderTree.addEventListener("click",FolderPaneOnClick,true);
  folderTree.addEventListener("mousedown",TreeOnMouseDown,true);
  var threadTree = document.getElementById("threadTree");
  threadTree.addEventListener("click",ThreadTreeOnClick,true);

  OnLoadThreadPane();
  SetupCommandUpdateHandlers();
}

function UnloadPanes()
{
  var threadTree = document.getElementById("threadTree");
  threadTree.removeEventListener("click",ThreadTreeOnClick,true);
  var folderTree = document.getElementById("folderTree");
  folderTree.removeEventListener("click",FolderPaneOnClick,true);
  folderTree.removeEventListener("mousedown",TreeOnMouseDown,true);
  gFolderTreeView.unload("folderTree.json");
  UnloadCommandUpdateHandlers();
}

function OnLoadThreadPane()
{
  // Use an observer to watch the columns element so that we get a notification
  // whenever attributes on the columns change.
  let observer = new MutationObserver(function handleMutations(mutations) {
    gFolderDisplay.hintColumnsChanged();
  });
  observer.observe(document.getElementById("threadCols"), {
    attributes: true,
    subtree: true,
    attributeFilter: ["hidden", "ordinal"]
  });
}

/* Functions for accessing particular parts of the window*/
function GetMessagePane()
{
  if (!gMessagePane)
    gMessagePane = document.getElementById("messagepanebox");
  return gMessagePane;
}

function GetMessagePaneWrapper()
{
  if (!gMessagePaneWrapper)
    gMessagePaneWrapper = document.getElementById("messagepaneboxwrapper");
  return gMessagePaneWrapper;
}

function GetMessagePaneFrame()
{
  // We must use the message pane element directly here, as other tabs can
  // have browser elements as well (which could be set to content-primary,
  // which would confuse things with a window.content return).
  return document.getElementById("messagepane").contentWindow;
}

function getMailToolbox()
{
  return document.getElementById("mail-toolbox");
}

function FindInSidebar(currentWindow, id)
{
  var item = currentWindow.document.getElementById(id);
  if (item)
    return item;

  for (var i = 0; i < currentWindow.frames.length; ++i)
  {
    var frameItem = FindInSidebar(currentWindow.frames[i], id);
    if (frameItem)
      return frameItem;
  }

  return null;
}

function GetThreadAndMessagePaneSplitter()
{
  if (!gThreadAndMessagePaneSplitter)
    gThreadAndMessagePaneSplitter = document.getElementById('threadpane-splitter');
  return gThreadAndMessagePaneSplitter;
}

function IsMessagePaneCollapsed()
{
  return document.getElementById("threadpane-splitter")
                 .getAttribute("state") == "collapsed";
}

function ClearThreadPaneSelection()
{
  gFolderDisplay.clearSelection();
}

function ClearMessagePane()
{
  // hide the message header view AND the message pane...
  HideMessageHeaderPane();
  gMessageNotificationBar.clearMsgNotifications();
  ClearPendingReadTimer();
  try {
    // This can fail because cloning imap URI's can fail if the username
    // has been cleared by docshell/base/nsDefaultURIFixup.cpp.
    let messagePane = GetMessagePaneFrame();
    // If we don't do this check, no one else does and we do a non-trivial
    // amount of work.  So do the check.
    if (messagePane.location.href != "about:blank")
      messagePane.location.href = "about:blank";
  } catch(ex) {
      logException(ex, false, "error clearing message pane");
  }
}

/**
 * When right-clicks happen, we do not want to corrupt the underlying
 * selection.  The right-click is a transient selection.  So, unless the
 * user is right-clicking on the current selection, we create a new
 * selection object (thanks to JSTreeSelection) and set that as the
 * current/transient selection.
 *
 * It is up you to call RestoreSelectionWithoutContentLoad to clean up when we
 * are done.
 *
 * @param aSingleSelect Should the selection we create be a single selection?
 *     This is relevant if the row being clicked on is already part of the
 *     selection.  If it is part of the selection and !aSingleSelect, then we
 *     leave the selection as is.  If it is part of the selection and
 *     aSingleSelect then we create a transient single-row selection.
 */
function ChangeSelectionWithoutContentLoad(event, tree, aSingleSelect)
{
  var treeBoxObj = tree.treeBoxObject;
  if (!treeBoxObj) {
    event.stopPropagation();
    return;
  }

  var treeSelection = treeBoxObj.view.selection;

  var row = treeBoxObj.getRowAt(event.clientX, event.clientY);
  // Only do something if:
  // - the row is valid
  // - it's not already selected (or we want a single selection)
  if (row >= 0 &&
      (aSingleSelect || !treeSelection.isSelected(row))) {
    // Check if the row is exactly the existing selection.  In that case
    //  there is no need to create a bogus selection.
    if (treeSelection.count == 1) {
      let minObj = {};
      treeSelection.getRangeAt(0, minObj, {});
      if (minObj.value == row) {
        event.stopPropagation();
        return;
      }
    }

    let transientSelection = new JSTreeSelection(treeBoxObj);
    transientSelection.logAdjustSelectionForReplay();

    gRightMouseButtonSavedSelection = {
      // Need to clear out this reference later.
      view: treeBoxObj.view,
      realSelection: treeSelection,
      transientSelection: transientSelection
    };

    var saveCurrentIndex = treeSelection.currentIndex;

    // tell it to log calls to adjustSelection
    // attach it to the view
    treeBoxObj.view.selection = transientSelection;
    // Don't generate any selection events! (we never set this to false, because
    //  that would generate an event, and we never need one of those from this
    //  selection object.
    transientSelection.selectEventsSuppressed = true;
    transientSelection.select(row);
    transientSelection.currentIndex = saveCurrentIndex;
    treeBoxObj.ensureRowIsVisible(row);
  }
  event.stopPropagation();
}

function TreeOnMouseDown(event)
{
    // Detect right mouse click and change the highlight to the row
    // where the click happened without loading the message headers in
    // the Folder or Thread Pane.
    // Same for middle click, which will open the folder/message in a tab.
    if (event.button == 2 || event.button == 1)
    {
      // We want a single selection if this is a middle-click (button 1)
      ChangeSelectionWithoutContentLoad(event, event.target.parentNode,
                                        event.button == 1);
    }
}

function FolderPaneContextMenuNewTab(event)
{
  var bgLoad = Services.prefs.getBoolPref("mail.tabs.loadInBackground");
  if (event.shiftKey)
    bgLoad = !bgLoad;
  MsgOpenNewTabForFolder(bgLoad);
}

function FolderPaneOnClick(event)
{
  var folderTree = document.getElementById("folderTree");

  // Middle click on a folder opens the folder in a tab
  if (event.button == 1 && event.originalTarget.localName != "slider" &&
      event.originalTarget.localName != "scrollbarbutton")
  {
    FolderPaneContextMenuNewTab(event);
    RestoreSelectionWithoutContentLoad(folderTree);
  }
  else if (event.button == 0)
  {
    var row = {};
    var col = {};
    var elt = {};
    folderTree.treeBoxObject.getCellAt(event.clientX, event.clientY, row, col, elt);
    if (row.value == -1) {
      if (event.originalTarget.localName == "treecol")
      {
        // clicking on the name column in the folder pane should not sort
        event.stopPropagation();
      }
    }
    else if ((event.originalTarget.localName == "slider") ||
             (event.originalTarget.localName == "scrollbarbutton")) {
      event.stopPropagation();
    }
  }
}

function OpenMessageInNewTab(event)
{
  if (!gFolderDisplay.selectedMessage)
    return;
  var bgLoad = Services.prefs.getBoolPref("mail.tabs.loadInBackground");
  if (event.shiftKey)
    bgLoad = !bgLoad;

  document.getElementById("tabmail").openTab("message",
      {msgHdr: gFolderDisplay.selectedMessage,
       viewWrapperToClone: gFolderDisplay.view,
       background: bgLoad});
}

function OpenContainingFolder()
{
  if (!gFolderDisplay.selectedMessage)
    return;

  MailUtils.displayMessageInFolderTab(gFolderDisplay.selectedMessage);
}

function ThreadTreeOnClick(event)
{
  var threadTree = document.getElementById("threadTree");

  // Middle click on a message opens the message in a tab
  if (event.button == 1 && event.originalTarget.localName != "slider" &&
      event.originalTarget.localName != "scrollbarbutton")
  {
    OpenMessageInNewTab(event);
    RestoreSelectionWithoutContentLoad(threadTree);
  }
}

function GetSelectedMsgFolders()
{
  return gFolderTreeView.getSelectedFolders();
}

function SelectFolder(folderUri)
{
  gFolderTreeView.selectFolder(MailUtils.getFolderForURI(folderUri));
}

function ReloadMessage()
{
  if (!gFolderDisplay.selectedMessage)
    return;

  let view = gFolderDisplay.view.dbView;
  if (view)
    view.reloadMessage();
}

// Some of the per account junk mail settings have been
// converted to global prefs. Let's try to migrate some
// of those settings from the default account.
function MigrateJunkMailSettings()
{
  var junkMailSettingsVersion = Services.prefs.getIntPref("mail.spam.version");
  if (!junkMailSettingsVersion)
  {
    // Get the default account, check to see if we have values for our
    // globally migrated prefs.
    var defaultAccount;
    try {
      defaultAccount = accountManager.defaultAccount;
    } catch (ex) {}
    if (defaultAccount && defaultAccount.incomingServer)
    {
      // we only care about
      var prefix = "mail.server." + defaultAccount.incomingServer.key + ".";
      if (Services.prefs.prefHasUserValue(prefix + "manualMark"))
      {
        Services.prefs.setBoolPref("mail.spam.manualMark",
          Services.prefs.getBoolPref(prefix + "manualMark"));
      }
      if (Services.prefs.prefHasUserValue(prefix + "manualMarkMode"))
      {
        Services.prefs.setIntPref("mail.spam.manualMarkMode",
          Services.prefs.getIntPref(prefix + "manualMarkMode"));
      }
      if (Services.prefs.prefHasUserValue(prefix + "spamLoggingEnabled"))
      {
        Services.prefs.setBoolPref("mail.spam.logging.enabled",
          Services.prefs.getBoolPref(prefix + "spamLoggingEnabled"));
      }
      if (Services.prefs.prefHasUserValue(prefix + "markAsReadOnSpam"))
      {
        Services.prefs.setBoolPref("mail.spam.markAsReadOnSpam",
          Services.prefs.getBoolPref(prefix + "markAsReadOnSpam"));
      }
    }
    // bump the version so we don't bother doing this again.
    Services.prefs.setIntPref("mail.spam.version", 1);
  }
}

// The first time a user runs a build that supports folder views, pre-populate the favorite folders list
// with the existing INBOX folders.
function MigrateFolderViews()
{
  var folderViewsVersion = Services.prefs.getIntPref("mail.folder.views.version");
  if (!folderViewsVersion)
  {
     var servers = accountManager.allServers;
     var server;
     var inbox;
     for (var index = 0; index < servers.length; index++)
     {
       server = servers.queryElementAt(index, Components.interfaces.nsIMsgIncomingServer);
       if (server)
       {
         inbox = GetInboxFolder(server);
         if (inbox)
           inbox.setFlag(Components.interfaces.nsMsgFolderFlags.Favorite);
       }
     }
    Services.prefs.setIntPref("mail.folder.views.version", 1);
  }
}

// Thunderbird has been storing old attachment download meta data in downloads.rdf
// even though there was no way to show or clean up this data. Now that we are using
// the new download manager in toolkit, we don't want to present this old data.
// To migrate to the new download manager, remove downloads.rdf.
function MigrateAttachmentDownloadStore()
{
  var attachmentStoreVersion = Services.prefs.getIntPref("mail.attachment.store.version");
  if (!attachmentStoreVersion)
  {
    var downloadsFile = Services.dirsvc.get("DLoads", Components.interfaces.nsIFile);
    if (downloadsFile && downloadsFile.exists())
      downloadsFile.remove(false);

    // bump the version so we don't bother doing this again.
    Services.prefs.setIntPref("mail.attachment.store.version", 1);
  }
}

// Do a one-time migration of the old mailnews.reuse_message_window pref to the
// newer mail.openMessageBehavior. This does the migration only if the old pref
// is defined.
function MigrateOpenMessageBehavior()
{
  let openMessageBehaviorVersion = Services.prefs.getIntPref(
                                     "mail.openMessageBehavior.version");
  if (!openMessageBehaviorVersion)
  {
    let reuseMessageWindow;
    try {
      reuseMessageWindow = Services.prefs.getBoolPref(
                             "mailnews.reuse_message_window");
    }
    catch (e) {}

    // Don't touch this if it isn't defined
    if (reuseMessageWindow === true)
      Services.prefs.setIntPref("mail.openMessageBehavior",
          MailConsts.OpenMessageBehavior.EXISTING_WINDOW);
    else if (reuseMessageWindow === false)
      Services.prefs.setIntPref("mail.openMessageBehavior",
          MailConsts.OpenMessageBehavior.NEW_TAB);

    Services.prefs.setIntPref("mail.openMessageBehavior.version", 1);
  }
}

function ThreadPaneOnDragStart(aEvent) {
  if (aEvent.originalTarget.localName != "treechildren")
    return;

  let messageUris = gFolderDisplay.selectedMessageUris;
  if (!messageUris)
     return;

  gFolderDisplay.hintAboutToDeleteMessages();
  let messengerBundle = document.getElementById("bundle_messenger");
  let noSubjectString = messengerBundle.getString("defaultSaveMessageAsFileName");
  if (noSubjectString.endsWith(".eml"))
    noSubjectString = noSubjectString.slice(0, -4);
  let longSubjectTruncator = messengerBundle.getString("longMsgSubjectTruncator");
  // Clip the subject string to 124 chars to avoid problems on Windows,
  // see NS_MAX_FILEDESCRIPTOR in m-c/widget/windows/nsDataObj.cpp .
  const maxUncutNameLength = 124;
  let maxCutNameLength = maxUncutNameLength - longSubjectTruncator.length;
  let messages = new Map();
  for (let [index, msgUri] of messageUris.entries()) {
    let msgService = messenger.messageServiceFromURI(msgUri);
    let msgHdr = msgService.messageURIToMsgHdr(msgUri);
    let subject = msgHdr.mime2DecodedSubject || "";
    if (msgHdr.flags & Components.interfaces.nsMsgMessageFlags.HasRe)
        subject = "Re: " + subject;

    let uniqueFileName;
    // If there is no subject, use a default name.
    // If subject needs to be truncated, add a truncation character to indicate it.
    if (!subject) {
      uniqueFileName = noSubjectString;
    } else {
      uniqueFileName = (subject.length <= maxUncutNameLength) ?
        subject : subject.substr(0, maxCutNameLength) + longSubjectTruncator;
    }
    let msgFileName = validateFileName(uniqueFileName);
    let msgFileNameLowerCase = msgFileName.toLocaleLowerCase();

    while (true) {
      if (!messages[msgFileNameLowerCase]) {
        messages[msgFileNameLowerCase] = 1;
        break;
      }
      else {
        let postfix = "-" + messages[msgFileNameLowerCase];
        messages[msgFileNameLowerCase]++;
        msgFileName = msgFileName + postfix;
        msgFileNameLowerCase = msgFileNameLowerCase + postfix;
      }
    }

    msgFileName = msgFileName + ".eml";

    let msgUrl = {};
    msgService.GetUrlForUri(msgUri, msgUrl, null);

    aEvent.dataTransfer.mozSetDataAt("text/x-moz-message", msgUri, index);
    aEvent.dataTransfer.mozSetDataAt("text/x-moz-url", msgUrl.value.spec, index);
    aEvent.dataTransfer.mozSetDataAt("application/x-moz-file-promise-url",
                                     msgUrl.value.spec + "?fileName=" +
                                     encodeURIComponent(msgFileName), index);
    aEvent.dataTransfer.mozSetDataAt("application/x-moz-file-promise",
                                     new messageFlavorDataProvider(), index);

  }

  aEvent.dataTransfer.effectAllowed = "copyMove";
  aEvent.dataTransfer.addElement(aEvent.originalTarget);
}

function messageFlavorDataProvider() {
}

messageFlavorDataProvider.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIFlavorDataProvider,
                       Components.interfaces.nsISupports]),

  getFlavorData : function(aTransferable, aFlavor, aData, aDataLen) {
    if (aFlavor !== "application/x-moz-file-promise") {
      return;
    }
    let fileUriPrimitive = {};
    let dataSize = {};
    aTransferable.getTransferData("application/x-moz-file-promise-url",
                                  fileUriPrimitive, dataSize);

    let fileUriStr = fileUriPrimitive.value.QueryInterface(Components.interfaces.nsISupportsString);
    let fileUri = Services.io.newURI(fileUriStr.data, null, null);
    let fileUrl = fileUri.QueryInterface(Components.interfaces.nsIURL);
    let fileName = fileUrl.fileName;

    let destDirPrimitive = {};
    aTransferable.getTransferData("application/x-moz-file-promise-dir",
                                  destDirPrimitive, dataSize);
    let destDirectory = destDirPrimitive.value.QueryInterface(Components.interfaces.nsILocalFile);
    let file = destDirectory.clone();
    file.append(fileName);

    let messageUriPrimitive = {};
    aTransferable.getTransferData("text/x-moz-message", messageUriPrimitive, dataSize);
    let messageUri = messageUriPrimitive.value.QueryInterface(Components.interfaces.nsISupportsString);

    messenger.saveAs(messageUri.data, true, null, decodeURIComponent(file.path), true);
  }
}

/**
 * Returns a new filename that is guaranteed to not be in the Set
 * of existing names.
 *
 * Example use:
 *   suggestUniqueFileName("testname", ".txt", new Set("testname", "testname1"))
 *   returns "testname2.txt"
 * Does not check file system for existing files.
 *
 * @param aIdentifier     proposed filename
 * @param aType           extension
 * @param aExistingNames  a Set of names already in use
 */
function suggestUniqueFileName(aIdentifier, aType, aExistingNames) {
  let suffix = 1;
  let base = validateFileName(aIdentifier);
  let suggestion = base + aType;
  while(true) {
    if (!aExistingNames.has(suggestion))
      break;

    suggestion = base + suffix + aType;
    suffix++;
  }

  return suggestion;
}

function ThreadPaneOnDragOver(aEvent) {
  let ds = Components.classes["@mozilla.org/widget/dragservice;1"]
                     .getService(Components.interfaces.nsIDragService)
                     .getCurrentSession();
  ds.canDrop = false;
  if (!gFolderDisplay.displayedFolder.canFileMessages)
    return;

  let dt = aEvent.dataTransfer;
  if (Array.indexOf(dt.mozTypesAt(0), "application/x-moz-file") != -1) {
    let extFile = dt.mozGetDataAt("application/x-moz-file", 0)
                    .QueryInterface(Components.interfaces.nsIFile);
    if (extFile.isFile()) {
      let len = extFile.leafName.length;
      if (len > 4 && extFile.leafName.toLowerCase().endsWith(".eml"))
        ds.canDrop = true;
    }
  }
}

function ThreadPaneOnDrop(aEvent) {
  let dt = aEvent.dataTransfer;
  for (let i = 0; i < dt.mozItemCount; i++) {
    let extFile = dt.mozGetDataAt("application/x-moz-file", i)
                    .QueryInterface(Components.interfaces.nsIFile);
    if (extFile.isFile()) {
      let len = extFile.leafName.length;
      if (len > 4 && extFile.leafName.toLowerCase().endsWith(".eml"))
        MailServices.copy.CopyFileMessage(extFile, gFolderDisplay.displayedFolder,
                                          null, false, 1, "", null, msgWindow);
    }
  }
}

var LightWeightThemeWebInstaller = {
  handleEvent: function (event) {
    switch (event.type) {
      case "InstallBrowserTheme":
      case "PreviewBrowserTheme":
      case "ResetBrowserThemePreview":
        // ignore requests from background tabs
        if (event.target.ownerDocument.defaultView.top != content)
          return;
    }
    switch (event.type) {
      case "InstallBrowserTheme":
        this._installRequest(event);
        break;
      case "PreviewBrowserTheme":
        this._preview(event);
        break;
      case "ResetBrowserThemePreview":
        this._resetPreview(event);
        break;
      case "pagehide":
        this._resetPreview();
        break;
    }
  },

  onTabTitleChanged: function (aTab) {
  },

  onTabSwitched: function (aTab, aOldTab) {
    this._resetPreview();
  },

  get _manager () {
    let temp = {};
    Components.utils.import("resource://gre/modules/LightweightThemeManager.jsm", temp);
    delete this._manager;
    return this._manager = temp.LightweightThemeManager;
  },

  _installRequest: function (event) {
    let node = event.target;
    let data = this._getThemeFromNode(node);
    if (!data)
      return;

    if (this._isAllowed(node)) {
      this._install(data);
      return;
    }

    let messengerBundle = document.getElementById("bundle_messenger");

    let buttons = [{
      label: messengerBundle.getString("lwthemeInstallRequest.allowButton"),
      accessKey: messengerBundle.getString("lwthemeInstallRequest.allowButton.accesskey"),
      callback: function () {
        LightWeightThemeWebInstaller._install(data);
      }
    }];

    this._removePreviousNotifications();

    let message =
      messengerBundle.getFormattedString("lwthemeInstallRequest.message",
                                         [node.ownerDocument.location.host]);

    let notificationBox = this._getNotificationBox();
    let notificationBar =
      notificationBox.appendNotification(message, "lwtheme-install-request", "",
                                         notificationBox.PRIORITY_INFO_MEDIUM,
                                         buttons);
    notificationBar.persistence = 1;
  },

  _install: function (newTheme) {
    let previousTheme = this._manager.currentTheme;
    this._manager.currentTheme = newTheme;
    if (this._manager.currentTheme &&
        this._manager.currentTheme.id == newTheme.id)
      this._postInstallNotification(newTheme, previousTheme);
  },

  _postInstallNotification: function (newTheme, previousTheme) {
    function text(id) {
      return document.getElementById("bundle_messenger")
                     .getString("lwthemePostInstallNotification." + id);
    }

    let buttons = [{
      label: text("undoButton"),
      accessKey: text("undoButton.accesskey"),
      callback: function () {
        LightWeightThemeWebInstaller._manager.forgetUsedTheme(newTheme.id);
        LightWeightThemeWebInstaller._manager.currentTheme = previousTheme;
      }
    }, {
      label: text("manageButton"),
      accessKey: text("manageButton.accesskey"),
      callback: function () {
        openAddonsMgr("addons://list/theme");
      }
    }];

    this._removePreviousNotifications();

    let notificationBox = this._getNotificationBox();
    let notificationBar =
      notificationBox.appendNotification(text("message"),
                                         "lwtheme-install-notification", "",
                                         notificationBox.PRIORITY_INFO_MEDIUM,
                                         buttons);
    notificationBar.persistence = 1;
    notificationBar.timeout = Date.now() + 20000; // 20 seconds
  },

  _removePreviousNotifications: function () {
    let box = this._getNotificationBox();

    ["lwtheme-install-request",
     "lwtheme-install-notification"].forEach(function (value) {
        var notification = box.getNotificationWithValue(value);
        if (notification)
          box.removeNotification(notification);
      });
  },

  _previewWindow: null,
  _preview: function (event) {
    if (!this._isAllowed(event.target))
      return;

    let data = this._getThemeFromNode(event.target);
    if (!data)
      return;

    this._resetPreview();

    this._previewWindow = event.target.ownerDocument.defaultView;
    this._previewWindow.addEventListener("pagehide", this, true);
    document.getElementById('tabmail').registerTabMonitor(this);

    this._manager.previewTheme(data);
  },

  _resetPreview: function (event) {
    if (!this._previewWindow ||
        event && !this._isAllowed(event.target))
      return;

    this._previewWindow.removeEventListener("pagehide", this, true);
    this._previewWindow = null;
    document.getElementById('tabmail').unregisterTabMonitor(this);

    this._manager.resetPreview();
  },

  _isAllowed: function (node) {
    let uri = node.ownerDocument.documentURIObject;
    return Services.perms.testPermission(uri, "install") == Services.perms.ALLOW_ACTION;
  },

  _getNotificationBox: function () {
    // Try and get the notification box for the selected tab.
    let browser = document.getElementById('tabmail').getBrowserForSelectedTab();
    // The messagepane doesn't have a notification bar yet.
    if (browser && browser.parentNode.tagName == "notificationbox")
      return browser.parentNode;

    // Otherwise, default to the global notificationbox
    return document.getElementById("mail-notification-box");
  },

  _getThemeFromNode: function (node) {
    return this._manager.parseTheme(node.getAttribute("data-browsertheme"),
                                    node.baseURI);
  }
}

/**
 * Initialize and attach the HTML5 context menu to the specified menupopup
 * during the onpopupshowing event.
 *
 * @param menuPopup the menupopup element
 * @param event the event responsible for showing the popup
 */
function InitPageMenu(menuPopup, event) {
  if (event.target != menuPopup)
    return;

  PageMenuParent.buildAndAddToPopup(menuPopup.triggerNode, menuPopup);

  if (menuPopup.children.length == 0)
    event.preventDefault();
}

var TabsInTitlebar = {
  init: function () {
#ifdef CAN_DRAW_IN_TITLEBAR
    // Don't trust the initial value of the sizemode attribute; wait for the
    // resize event.
    this._readPref();
    Services.prefs.addObserver(this._drawInTitlePref, this, false);
    Services.prefs.addObserver(this._autoHidePref, this, false);

    this.allowedBy("sizemode", false);
    window.addEventListener("resize", function (event) {
      if (event.target != window)
        return;
      TabsInTitlebar.allowedBy("sizemode", true);
    }, false);

    // We need to update the appearance of the titlebar when the menu changes
    // from the active to the inactive state. We can't, however, rely on
    // DOMMenuBarInactive, because the menu fires this event and then removes
    // the inactive attribute after an event-loop spin.
    //
    // Because updating the appearance involves sampling the heights and
    // margins of various elements, it's important that the layout be more or
    // less settled before updating the titlebar. So instead of listening to
    // DOMMenuBarActive and DOMMenuBarInactive, we use a MutationObserver to
    // watch the "invalid" attribute directly.
    let menu = document.getElementById("mail-toolbar-menubar2");
    this._menuObserver = new MutationObserver(this._onMenuMutate);
    this._menuObserver.observe(menu, {attributes: true});

    let sizeMode = document.getElementById("messengerWindow");
    this._sizeModeObserver = new MutationObserver(this._onSizeModeMutate);
    this._sizeModeObserver.observe(sizeMode, {attributes: true});

    this._initialized = true;
#endif
  },

  allowedBy: function (condition, allow) {
#ifdef CAN_DRAW_IN_TITLEBAR
    if (allow) {
      if (condition in this._disallowed) {
        delete this._disallowed[condition];
        this._update(true);
      }
    } else {
      if (!(condition in this._disallowed)) {
        this._disallowed[condition] = null;
        this._update(true);
      }
    }
#endif
  },

  updateAppearance: function updateAppearance(aForce) {
#ifdef CAN_DRAW_IN_TITLEBAR
    this._update(aForce);
#endif
  },

  get enabled() {
    return document.documentElement.getAttribute("tabsintitlebar") == "true";
  },

#ifdef CAN_DRAW_IN_TITLEBAR
  observe: function (subject, topic, data) {
    if (topic == "nsPref:changed")
      this._readPref();
  },

  _onMenuMutate: function (aMutations) {
    for (let mutation of aMutations) {
      if (mutation.attributeName == "inactive" ||
          mutation.attributeName == "autohide") {
        TabsInTitlebar._update(true);
        return;
      }
    }
  },

  _onSizeModeMutate: function (aMutations) {
    for (let mutation of aMutations) {
      if (mutation.attributeName == "sizemode") {
        TabsInTitlebar._update(true);
        return;
      }
    }
  },

  _initialized: false,
  _disallowed: {},
  _drawInTitlePref: "mail.tabs.drawInTitlebar",
  _autoHidePref: "mail.tabs.autoHide",
  _lastSizeMode: null,

  _readPref: function () {
    // check is only true when drawInTitlebar=true and autoHide=false
    let check = Services.prefs.getBoolPref(this._drawInTitlePref) &&
                !Services.prefs.getBoolPref(this._autoHidePref);
    this.allowedBy("pref", check);
  },

  _update: function (aForce=false) {
    function $(id) { return document.getElementById(id); }
    function rect(ele) { return ele.getBoundingClientRect(); }
    function verticalMargins(cstyle) { return parseFloat(cstyle.marginBottom) + parseFloat(cstyle.marginTop); }

    if (!this._initialized || window.fullScreen)
      return;

    let allowed = true;

    if (!aForce) {
      // _update is called on resize events, because the window is not ready
      // after sizemode events. However, we only care about the event when the
      // sizemode is different from the last time we updated the appearance of
      // the tabs in the titlebar.
      let sizemode = document.documentElement.getAttribute("sizemode");
      if (this._lastSizeMode == sizemode) {
        return;
      }
      this._lastSizeMode = sizemode;
    }

    for (let something in this._disallowed) {
      allowed = false;
      break;
    }

    let titlebar = $("titlebar");
    let titlebarContent = $("titlebar-content");
    let menubar = $("mail-toolbar-menubar2");

    if (allowed) {
      // We set the tabsintitlebar attribute first so that our CSS for
      // tabsintitlebar manifests before we do our measurements.
      document.documentElement.setAttribute("tabsintitlebar", "true");
      updateTitlebarDisplay();

      // Try to avoid reflows in this code by calculating dimensions first and
      // then later set the properties affecting layout together in a batch.

      // Get the full height of the tabs toolbar:
      let tabsToolbar = $("tabs-toolbar");
      let fullTabsHeight = rect(tabsToolbar).height;
      let gNavToolbox = $("navigation-toolbox");
      // Buttons first:
      let captionButtonsBoxWidth = rect($("titlebar-buttonbox")).width;

#ifdef XP_MACOSX
      let secondaryButtonWidth = rect($("titlebar-fullscreen-button")).width;
#endif

      // Get the height and margins separately for the menubar
      let menuHeight = rect(menubar).height;
      let menuStyles = window.getComputedStyle(menubar);
      let fullMenuHeight = verticalMargins(menuStyles) + menuHeight;
      let tabsStyles = window.getComputedStyle(tabsToolbar);
      fullTabsHeight += verticalMargins(tabsStyles);

      // If the #tabmail overlaps the tabbar using negative margins, we need to
      // take those into account so we don't overlap it
      let tabmailMarginTop = parseFloat(window.getComputedStyle($("tabmail")).marginTop);
      tabmailMarginTop = Math.min(tabmailMarginTop, 0);

      // And get the height of what's in the titlebar:
      let titlebarContentHeight = rect(titlebarContent).height;

      // Begin setting CSS properties which will cause a reflow

      // If the menubar is around (menuHeight is non-zero), try to adjust
      // its full height (i.e. including margins) to match the titlebar,
      // by changing the menubar's bottom padding
      if (menuHeight) {
        // Calculate the difference between the titlebar's height and that of
        // the menubar
        let menuTitlebarDelta = titlebarContentHeight - fullMenuHeight;
        let paddingBottom;
        // The titlebar is bigger:
        if (menuTitlebarDelta > 0) {
          fullMenuHeight += menuTitlebarDelta;
          // If there is already padding on the menubar, we need to add that
          // to the difference so the total padding is correct:
          if ((paddingBottom = menuStyles.paddingBottom)) {
            menuTitlebarDelta += parseFloat(paddingBottom);
          }
          menubar.style.paddingBottom = menuTitlebarDelta + "px";
        // The menubar is bigger, but has bottom padding we can remove:
        } else if (menuTitlebarDelta < 0 && (paddingBottom = menuStyles.paddingBottom)) {
          let existingPadding = parseFloat(paddingBottom);
          // menuTitlebarDelta is negative; work out what's left, but don't set
          // negative padding:
          let desiredPadding = Math.max(0, existingPadding + menuTitlebarDelta);
          menubar.style.paddingBottom = desiredPadding + "px";
          // We've changed the menu height now:
          fullMenuHeight += desiredPadding - existingPadding;
        }
      }

      // Next, we calculate how much we need to stretch the titlebar down to
      // go all the way to the bottom of the tab strip, if necessary.
      let tabAndMenuHeight = fullTabsHeight + fullMenuHeight;

      if (tabAndMenuHeight > titlebarContentHeight) {
        // We need to increase the titlebar content's outer height
        // (ie including margins) to match the tab and menu height:
        let extraMargin = tabAndMenuHeight - titlebarContentHeight;
        // We need to reduce the height by the amount of navbar overlap
        // (this value is 0 or negative):
        extraMargin += tabmailMarginTop;
        // On non-OSX, we can just use bottom margin:
#ifndef XP_MACOSX
        titlebarContent.style.marginBottom = extraMargin + "px";
#endif
        titlebarContentHeight += extraMargin;
      } else {
        titlebarContent.style.removeProperty("margin-bottom");
      }

      // Then we bring up the titlebar by the same amount, but we add any
      // negative margin:
      titlebar.style.marginBottom = "-" + titlebarContentHeight + "px";

      // Finally, size the placeholders:
#ifdef XP_MACOSX
      this._sizePlaceholder("fullscreen-button", secondaryButtonWidth);
#endif

      this._sizePlaceholder("caption-buttons", captionButtonsBoxWidth);

      if (!this._draghandles) {
        this._draghandles = {};
        let tmp = {};
        Components.utils.import("resource://gre/modules/WindowDraggingUtils.jsm", tmp);

        let mouseDownCheck = function () {
          return !this._dragBindingAlive && TabsInTitlebar.enabled;
        };

        this._draghandles.tabsToolbar = new tmp.WindowDraggingElement(tabsToolbar);
        this._draghandles.tabsToolbar.mouseDownCheck = mouseDownCheck;

        this._draghandles.navToolbox = new tmp.WindowDraggingElement(gNavToolbox);
        this._draghandles.navToolbox.mouseDownCheck = mouseDownCheck;
      }
    } else {
      document.documentElement.removeAttribute("tabsintitlebar");
      updateTitlebarDisplay();

      // Reset the margins and padding that might have been modified:
      titlebarContent.style.marginTop = "";
      titlebarContent.style.marginBottom = "";
      titlebar.style.marginBottom = "";
      menubar.style.paddingBottom = "";
    }

    ToolbarIconColor.inferFromText();
  },

  _sizePlaceholder: function (type, width) {
    Array.forEach(document.querySelectorAll(".titlebar-placeholder[type='"+ type +"']"),
                  function (node) { node.width = width; });
  },
#endif

  uninit: function () {
#ifdef CAN_DRAW_IN_TITLEBAR
    this._initialized = false;
    Services.prefs.removeObserver(this._drawInTitlePref, this);
    Services.prefs.removeObserver(this._autoHidePref, this);
    this._menuObserver.disconnect();
#endif
  }
};

#ifdef CAN_DRAW_IN_TITLEBAR
function updateTitlebarDisplay() {

#ifdef XP_MACOSX
    // OS X and the other platforms differ enough to necessitate this kind of
    // special-casing. Like the other platforms where we CAN_DRAW_IN_TITLEBAR,
    // we draw in the OS X titlebar when putting the tabs up there. However, OS X
    // also draws in the titlebar when a lightweight theme is applied, regardless
    // of whether or not the tabs are drawn in the titlebar.
    if (TabsInTitlebar.enabled) {
      document.documentElement.setAttribute("chromemargin-nonlwtheme", "0,2,2,2");
      document.documentElement.setAttribute("chromemargin", "0,2,2,2");
      document.documentElement.setAttribute("tabsintitlebar", "true");
    } else {
      // We set chromemargin-nonlwtheme to "" instead of removing it as a way of
      // making sure that LightweightThemeConsumer doesn't take it upon itself to
      // detect this value again if and when we do a lwtheme state change.
      document.documentElement.setAttribute("chromemargin-nonlwtheme", "");
      let hasLWTheme = document.documentElement.hasAttribute("lwtheme");
      if (hasLWTheme) {
        document.documentElement.setAttribute("chromemargin", "0,2,2,2");
      } else {
        document.documentElement.removeAttribute("chromemargin");
      }
    }

#else
  document.getElementById("titlebar").hidden = !TabsInTitlebar.enabled;

  if (TabsInTitlebar.enabled)
    document.documentElement.setAttribute("chromemargin", "0,2,2,2");
  else
    document.documentElement.removeAttribute("chromemargin");

#endif
}
#endif

/* Draw */
function onTitlebarMaxClick() {
  if (window.windowState == window.STATE_MAXIMIZED)
    window.restore();
  else
    window.maximize();
}
