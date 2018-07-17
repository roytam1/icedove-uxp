/*
 * Test nsMsgDatabase's cleanup of nsMsgDBEnumerators
 */

Components.utils.import("resource:///modules/mailServices.js");

var anyOldMessage = do_get_file("../../../../data/bugmail1");

/**
 * Test closing a db with an outstanding enumerator.
 */
function test_enumerator_cleanup() {
  let db = localAccountUtils.inboxFolder.msgDatabase;
  let enumerator = db.EnumerateMessages();
  Cc["@mozilla.org/msgDatabase/msgDBService;1"]
    .getService(Ci.nsIMsgDBService)
    .forceFolderDBClosed(localAccountUtils.inboxFolder);
  localAccountUtils.inboxFolder.msgDatabase = null;
  db = null;
  gc();
  while (enumerator.hasMoreElements())
    var header = enumerator.getNext();

  do_test_finished();
}

/*
 * This infrastructure down here exists just to get
 *  test_references_header_parsing its message header.
 */

function run_test() {
  localAccountUtils.loadLocalMailAccount();
  do_test_pending();
  MailServices.copy.CopyFileMessage(anyOldMessage, localAccountUtils.inboxFolder, null,
                                    false, 0, "", messageHeaderGetterListener, null);
  return true;
}

var messageHeaderGetterListener = {
  OnStartCopy: function() {},
  OnProgress: function(aProgress, aProgressMax) {},
  GetMessageId: function (aMessageId) {},
  SetMessageKey: function(aKey) {
  },
  OnStopCopy: function(aStatus) {
    do_timeout(0, test_enumerator_cleanup);
  }
}
