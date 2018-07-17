/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* Tests that an empty cache entry doesn't return an empty message for news. */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

// The basic daemon to use for testing nntpd.js implementations
var daemon = setupNNTPDaemon();

var server;
var localserver;

var streamListener =
{
  _data: "",

  QueryInterface:
    XPCOMUtils.generateQI([Ci.nsIStreamListener, Ci.nsIRequestObserver]),

  // nsIRequestObserver
  onStartRequest: function(aRequest, aContext) {
  },
  onStopRequest: function(aRequest, aContext, aStatusCode) {
    do_check_eq(aStatusCode, 0);

    // Reduce any \r\n to just \n so we can do a good comparison on any
    // platform.
    var reduced = this._data.replace(/\r\n/g, "\n");
    do_check_eq(reduced, kSimpleNewsArticle);

    // We must finish closing connections and tidying up after a timeout
    // so that the thread has time to unwrap itself.
    do_timeout(0, doTestFinished);
  },

  // nsIStreamListener
  onDataAvailable: function(aRequest, aContext, aInputStream, aOffset, aCount) {
    let scriptStream = Cc["@mozilla.org/scriptableinputstream;1"]
                         .createInstance(Ci.nsIScriptableInputStream);

    scriptStream.init(aInputStream);

    this._data += scriptStream.read(aCount);
  }
};

function doTestFinished() {
    localserver.closeCachedConnections();

    server.stop();

    var thread = gThreadManager.currentThread;
    while (thread.hasPendingEvents())
      thread.processNextEvent(true);

    do_test_finished();
}


function run_test() {
  server = makeServer(NNTP_RFC977_handler, daemon);
  server.start();
  localserver = setupLocalServer(server.port);
  var uri = Cc["@mozilla.org/network/standard-url;1"]
              .createInstance(Ci.nsIURI);
  uri.spec = "news://localhost:" + server.port + "/TSS1%40nntp.test";

  try {
    // Add an empty message to the cache
    MailServices.nntp
                .cacheStorage
                .asyncOpenURI(uri, "", Ci.nsICacheStorage.OPEN_NORMALLY, {
      onCacheEntryAvailable: function(cacheEntry, isNew, appCache, status) {
        do_check_eq(status, Components.results.NS_OK);

        cacheEntry.markValid();

        // Get the folder and new mail
        var folder = localserver.rootFolder.getChildNamed("test.subscribe.simple");
        folder.clearFlag(Ci.nsMsgFolderFlags.Offline);
        folder.getNewMessages(null, {
          OnStopRunningUrl: function () { localserver.closeCachedConnections(); }});
        server.performTest();

        do_check_eq(folder.getTotalMessages(false), 1);
        do_check_true(folder.hasNewMessages);

        server.resetTest();

        var message = folder.firstNewMessage;

        var messageUri = folder.getUriForMsg(message);

        MailServices.nntp
                    .QueryInterface(Ci.nsIMsgMessageService)
                    .DisplayMessage(messageUri, streamListener, null, null, null, {});

        // Get the server to run
        server.performTest();
      }
    });

    do_test_pending();

  } catch (e) {
    server.stop();
    do_throw(e);
  }
};
