load("../../../resources/logHelper.js");
load("../../../resources/asyncTestUtils.js");

load("../../../resources/messageGenerator.js");
load("../../../resources/messageModifier.js");
load("../../../resources/messageInjection.js");

Components.utils.import("resource:///modules/gloda/mimemsg.js");

var gMessenger = Cc["@mozilla.org/messenger;1"]
                   .createInstance(Ci.nsIMessenger);

// Create a message generator
var msgGen = gMessageGenerator = new MessageGenerator();

var p7mAttachment = "dGhpcyBpcyBub3QgYSByZWFsIHMvbWltZSBwN20gZW50aXR5";

// create a message with a p7m attachment
var messages = {
  attachments: [{ 
    body: p7mAttachment,
    filename: 'test.txt.p7m',
    contentType: 'application/pkcs7-mime',
    format:'',
    encoding: "base64"
  }]
};

var msgWindow = Cc["@mozilla.org/messenger/msgwindow;1"]
                  .createInstance(Ci.nsIMsgWindow);

function* worker(params) {
  let synMsg = gMessageGenerator.makeMessage(params.messages);
  let synSet = new SyntheticMessageSet([synMsg]);
  yield add_sets_to_folder(gInbox, [synSet]);

  let msgHdr = synSet.getMsgHdr(0);

  Services.prefs.setBoolPref("mailnews.p7m_external", params.all_external);
  Services.prefs.setBoolPref("mailnews.p7m_subparts_external", params.subparts_external);

  MsgHdrToMimeMessage(msgHdr, null, function (aMsgHdr, aMimeMsg) {
    try {
      do_check_true(aMimeMsg.allUserAttachments.length == params.count);
      async_driver();
    } catch (err) {
      do_throw(err);
    }
  });

  yield false;
}

/* ===== Driver ===== */

var tests = [
  parameterizeTest(worker, [{ messages, all_external: false, subparts_external: false, count: 0 }]),
  // We are only testing with a p7m attachment, so whether all parts or just subparts are
  // made external yields the same result: one attachment which is not inlined.
  parameterizeTest(worker, [{ messages, all_external: true,  subparts_external: false, count: 1 }]),
  parameterizeTest(worker, [{ messages, all_external: false, subparts_external: true,  count: 1 }]),
  parameterizeTest(worker, [{ messages, all_external: true,  subparts_external: true,  count: 1 }])
];

var gInbox;

function run_test() {
  gInbox = configure_message_injection({mode: "local"});
  async_run_tests(tests);
}
