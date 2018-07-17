/**
 * The intent of this file is to demonstrate a minimal
 * POP3 unit test using the testing file POP3Pump.js
 */
load("../../../resources/POP3pump.js");
Components.utils.import("resource://gre/modules/Promise.jsm");

var testSubjects = ["[Bug 397009] A filter will let me tag, but not untag",
                    "Hello, did you receive my bugmail?"];

add_task(function* runPump() {
  // demonstration of access to the local inbox folder
  dump("local inbox folder " + localAccountUtils.inboxFolder.URI + " is loaded\n");
  // demonstration of access to the fake server
  dump("Server " + gPOP3Pump.fakeServer.prettyName + " is loaded\n");

  gPOP3Pump.files = ["../../../data/bugmail1",
                      "../../../data/draft1"];
  yield gPOP3Pump.run();

  // get message headers for the inbox folder
  let enumerator = localAccountUtils.inboxFolder.msgDatabase.EnumerateMessages();
  var msgCount = 0;
  while (enumerator.hasMoreElements()) {
    msgCount++;
    let hdr = enumerator.getNext().QueryInterface(Ci.nsIMsgDBHdr);
    do_check_eq(hdr.subject, testSubjects[msgCount - 1]);
  }
  do_check_eq(msgCount, 2);
  gPOP3Pump = null;
});

function run_test() {
  run_next_test();
}
