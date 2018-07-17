/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tests that we do the right thing wrt. message encoding, especially when
 * all characters doesn't fit the selected charset.
 */

// make SOLO_TEST=composition/test-charset-upgrade.js mozmill-one

var MODULE_NAME = "test-charset-upgrade";

var RELATIVE_ROOT = "../shared-modules";
var MODULE_REQUIRES = ["folder-display-helpers", "window-helpers", "compose-helpers"];

Cu.import('resource://gre/modules/Services.jsm');
Cu.import("resource:///modules/mailServices.js");

var draftsFolder;
var outboxFolder;

function setupModule(module) {
  for (let req of MODULE_REQUIRES) {
    collector.getModule(req).installInto(module);
  }
  draftsFolder = get_special_folder(Ci.nsMsgFolderFlags.Drafts, true);
  outboxFolder = get_special_folder(Ci.nsMsgFolderFlags.Queue);

  // Ensure reply charset isn't UTF-8, otherwise there's no need to upgrade,
  //  which is what this test tests.
  let str = Components.classes["@mozilla.org/pref-localizedstring;1"]
                      .createInstance(Components.interfaces.nsIPrefLocalizedString);
  str.data = "windows-1252";
  Services.prefs.setComplexValue("mailnews.send_default_charset",
                                 Components.interfaces.nsIPrefLocalizedString, str);

  // Don't create paragraphs in the test.
  // When creating a paragraph, the test fails to retrieve the
  // original character set windows-1252. Until we understand why,
  // we run without paragraphs.
  Services.prefs.setBoolPref("mail.compose.default_to_paragraph", false);
}

/**
 * Test that if all characters don't fit the current charset selection,
 * we upgrade properly to UTF-8. In HTML composition.
 */
function test_encoding_upgrade_html_compose() {
  Services.prefs.setBoolPref("mail.identity.default.compose_html", true);
  let compWin = open_compose_new_mail();

  setup_msg_contents(compWin,
                     "someone@example.com",
                     "encoding upgrade test - html mode",
                     "so far, this is latin1\n");

  // Ctrl+S = save as draft.
  compWin.keypress(null, "s", {shiftKey: false, accelKey: true});

  be_in_folder(draftsFolder);
  let draftMsg = select_click_row(0);

  // Charset should still be the default.
  assert_equals(draftMsg.Charset, "windows-1252");

  let draftMsgContent = get_msg_source(draftMsg, true);
  if (!draftMsgContent.includes('content="text/html; charset=windows-1252"'))
    throw new Error("Expected content type not in msg; draftMsgContent=" +
                    draftMsgContent);

  const CHINESE = "漢皇重色思傾國漢皇重色思傾國";
  type_in_composer(compWin, ["but now, we enter some chinese: " + CHINESE + "\n"]);

  // Ctrl+U = Underline (so we can check multipart/alternative gets right,
  // without it html->plaintext conversion will it as send plain text only)
  compWin.keypress(null, "U", {shiftKey: false, accelKey: true});

  type_in_composer(compWin, ["content need to be upgraded to utf-8 now."]);

  // Ctrl+S = save as draft.
  compWin.keypress(null, "s", {shiftKey: false, accelKey: true});

  be_in_folder(draftsFolder);
  let draftMsg2 = select_click_row(0);
  // Charset should have be upgraded to UTF-8.
  assert_equals(draftMsg2.Charset, "UTF-8");

  let draftMsg2Content = get_msg_source(draftMsg2, true);
  if (!draftMsg2Content.includes('content="text/html; charset=UTF-8"'))
    throw new Error("Expected content type not in msg; draftMsg2Content=" +
                    draftMsg2Content);

  if (!draftMsg2Content.includes(CHINESE))
    throw new Error("Chinese text not in msg; CHINESE=" + CHINESE +
                    ", draftMsg2Content=" + draftMsg2Content);

  plan_for_window_close(compWin);
  compWin.window.goDoCommand("cmd_sendLater");
  wait_for_window_close();

  be_in_folder(outboxFolder);
  let outMsg = select_click_row(0);
  let outMsgContent = get_msg_source(outMsg, true);

  // This message should be multipart/alternative.
  if (!outMsgContent.includes("Content-Type: multipart/alternative"))
    throw new Error("Expected multipart/alternative; content=" + outMsgContent);

  let chinesePlainIdx = outMsgContent.indexOf(CHINESE);
  assert_true(chinesePlainIdx > 0, "chinesePlainIdx=" + chinesePlainIdx +
                                   ", outMsgContent=" + outMsgContent);

  let chineseHTMLIdx = outMsgContent.indexOf(CHINESE, chinesePlainIdx);
  assert_true(chineseHTMLIdx > 0, "chineseHTMLIdx=" + chineseHTMLIdx +
                                  ", outMsgContent=" + outMsgContent);

  // Make sure the actual html also got the content type set correctly.
  if (!outMsgContent.includes('content="text/html; charset=UTF-8"'))
    throw new Error("Expected content type not in html; outMsgContent=" +
                    outMsgContent);

  press_delete(); // Delete the msg from Outbox.
}

/**
 * Test that if all characters don't fit the current charset selection,
 * we upgrade properly to UTF-8. In plaintext composition.
 */
function test_encoding_upgrade_plaintext_compose() {
  Services.prefs.setBoolPref("mail.identity.default.compose_html", false);
  let compWin = open_compose_new_mail();
  Services.prefs.setBoolPref("mail.identity.default.compose_html", true);

  setup_msg_contents(compWin,
                     "someone-else@example.com",
                     "encoding upgrade test - plaintext",
                     "this is plaintext latin1\n");

  // Ctrl+S = Save as Draft.
  compWin.keypress(null, "s", {shiftKey: false, accelKey: true});

  be_in_folder(draftsFolder);
  let draftMsg = select_click_row(0);

  // Charset should still be the default.
  assert_equals(draftMsg.Charset, "windows-1252");

  const CHINESE = "漢皇重色思傾國漢皇重色思傾國";
  type_in_composer(compWin, ["enter some plain text chinese: " + CHINESE,
                             "content need to be upgraded to utf-8 now."]);

  // Ctrl+S = Save as Draft.
  compWin.keypress(null, "s", {shiftKey: false, accelKey: true});

  be_in_folder(draftsFolder);
  let draftMsg2 = select_click_row(0);
  // Charset should have be upgraded to UTF-8.
  assert_equals(draftMsg2.Charset, "UTF-8");

  let draftMsg2Content = get_msg_source(draftMsg2, true);
  if (draftMsg2Content.includes("<html>"))
    throw new Error("Plaintext draft contained <html>; "+
                    "draftMsg2Content=" + draftMsg2Content);

  if (!draftMsg2Content.includes(CHINESE))
    throw new Error("Chinese text not in msg; CHINESE=" + CHINESE +
                    ", draftMsg2Content=" + draftMsg2Content);

  plan_for_window_close(compWin);
  compWin.window.goDoCommand("cmd_sendLater");
  wait_for_window_close();

  be_in_folder(outboxFolder);
  let outMsg = select_click_row(0);
  let outMsgContent = get_msg_source(outMsg, true);

  // This message should be text/plain;
  if (!outMsgContent.includes("Content-Type: text/plain"))
    throw new Error("Expected text/plain; content=" + outMsgContent);

  if (!outMsgContent.includes(CHINESE))
    throw new Error("Chinese text not in msg; CHINESE=" + CHINESE +
                    ", outMsgContent=" + outMsgContent);

  press_delete(); // Delete the msg from Outbox.
}

function teardownModule(module) {
  Services.prefs.clearUserPref("mailnews.send_default_charset");
  Services.prefs.clearUserPref("mail.compose.default_to_paragraph");
  Services.prefs.clearUserPref("mail.identity.default.compose_html");
}
