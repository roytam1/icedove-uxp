// Bug 37465 -- assertions with no accounts

Components.utils.import("resource:///modules/mailServices.js");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function run_test() {
  var daemon = setupNNTPDaemon();
  var server = makeServer(NNTP_RFC2980_handler, daemon);
  server.start();

  // Correct URI?
  let uri = Services.io.newURI("news://localhost:" + server.port +
                                 "/1@regular.invalid",
                               null, null);
  let newsUri = uri.QueryInterface(Ci.nsINntpUrl)
                   .QueryInterface(Ci.nsIMsgMailNewsUrl);
  do_check_eq(uri.port, server.port);
  do_check_eq(newsUri.server, null);
  do_check_eq(newsUri.messageID, "1@regular.invalid");
  do_check_eq(newsUri.folder, null);

  // Run the URI and make sure we get the message
  let channel = Services.io.newChannelFromURI2(uri,
                                               null,
                                               Services.scriptSecurityManager.getSystemPrincipal(),
                                               null,
                                               Ci.nsILoadInfo.SEC_NORMAL,
                                               Ci.nsIContentPolicy.TYPE_OTHER);
  channel.asyncOpen(articleTextListener, null);

  // Run the server
  var thread = gThreadManager.currentThread;
  while (!articleTextListener.finished)
    thread.processNextEvent(true);

  do_check_eq(articleTextListener.data,
    daemon.getArticle("<1@regular.invalid>").fullText);

  // Shut down connections
  MailServices.accounts.closeCachedConnections();
  server.stop();
}
