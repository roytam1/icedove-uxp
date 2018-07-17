/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tests that we get correct adressees for different type of replies:
 * reply to sender, reply to all, reply to list, mail-followup-tp,
 * mail-reply-to, and reply to self.
 */

// make SOLO_TEST=composition/test-reply-addresses.js mozmill-one

var MODULE_NAME = "test-reply-addresses";

var RELATIVE_ROOT = "../shared-modules";
var MODULE_REQUIRES = ["folder-display-helpers",
                         "window-helpers", "compose-helpers"];

var folder;
var i = 0;

var myEmail = "me@example.com";
var myEmail2 = "otherme@example.com";

var identity;
var identity2;

Cu.import("resource:///modules/mailServices.js");

function setupModule(module) {
  collector.getModule("folder-display-helpers").installInto(module);
  collector.getModule("window-helpers").installInto(module);
  collector.getModule("compose-helpers").installInto(module);

  // Now set up an account with some identities.
  let acctMgr = MailServices.accounts;
  let account = acctMgr.createAccount();
  account.incomingServer = acctMgr.createIncomingServer(
    "nobody", "Reply Addresses Testing", "pop3");

  folder = account.incomingServer.rootFolder
                  .QueryInterface(Ci.nsIMsgLocalMailFolder)
                  .createLocalSubfolder("Msgs4Reply");

  identity = acctMgr.createIdentity();
  identity.email = myEmail;
  account.addIdentity(identity);

  identity2 = acctMgr.createIdentity();
  identity2.email = myEmail2;
  account.addIdentity(identity2);

  // Let's add messages to the folder later as we go, it's hard to read
  // out of context what the expected results should be.
}

/**
 * Helper to open a reply, check the fields are as expected, and close the
 * reply window.
 * @param aReplyFunction which reply function to call
 * @param aExpectedFields the fields expected
 */
function checkReply(aReplyFunction, aExpectedFields) {
  let rwc = aReplyFunction();
  checkToAddresses(rwc, aExpectedFields);
  close_compose_window(rwc);
}

/**
 * Helper to check that the reply window has the expected address fields.
 */
function checkToAddresses(replyWinController, expectedFields) {
  let addressingWidgetItems = replyWinController.window.document
    .querySelectorAll("#addressingWidget .addressingWidgetItem");

  let obtainedFields = [];
  for (let i = 0; i < addressingWidgetItems.length; i++) {
    let addrTypePopup = addressingWidgetItems[i].querySelector("menupopup");
    let addrTextbox = addressingWidgetItems[i].querySelector("textbox");

    let selectedIndex = addrTypePopup.parentNode.selectedIndex;
    let typeMenuitems = addrTypePopup.childNodes;
    let addrType = (selectedIndex != -1) ?
      typeMenuitems[selectedIndex].value : typeMenuitems[0].value;

    if (!addrTextbox.value)
      continue;
    let addresses = obtainedFields[addrType];
    if (addresses)
      addresses.push(addrTextbox.value);
    else
      addresses = [addrTextbox.value];
    obtainedFields[addrType] = addresses;
  }

  // Check what we expect is there.
  for (let type in expectedFields) {
    let expected = expectedFields[type];
    let obtained = obtainedFields[type];

    for (let i = 0; i < expected.length; i++) {
      if (!obtained || !obtained.includes(expected[i])) {
        throw new Error(expected[i] + " is not in " + type + " fields; " +
                        "obtained=" + obtained);
      }
    }
    assert_equals(obtained.length, expected.length,
                  "Unexpected number of fields obtained for type=" + type +
                  "; obtained=" + obtained + "; expected=" + expected);
  }

  // Check there's no "extra" fields either.
  for (let type in obtainedFields) {
    let expected = expectedFields[type];
    let obtained = obtainedFields[type];
    if (!expected) {
      throw new Error("Didn't expect a field for type=" + type +
                      "; obtained=" + obtained);
    }
  }
}

/**
 * Helper to set an auto-Cc list for an identity.
 */
function useAutoCc(aIdentity, aCcList) {
  aIdentity.doCc = true;
  aIdentity.doCcList = aCcList;
}

/**
 * Helper to stop using auto-Cc for an identity.
 */
function stopUsingAutoCc(aIdentity) {
  aIdentity.doCc = false;
  aIdentity.doCcList = "";
}

/**
 * Helper to ensure autoCc is turned off.
 */
function ensureNoAutoCc(aIdentity) {
  aIdentity.doCc = false;
}

/**
 * Helper to set an auto-bcc list for an identity.
 */
function useAutoBcc(aIdentity, aBccList) {
  aIdentity.doBcc = true;
  aIdentity.doBccList = aBccList;
}

/**
 * Helper to stop using auto-bcc for an identity.
 */
function stopUsingAutoBcc(aIdentity) {
  aIdentity.doBcc = false;
  aIdentity.doBccList = "";
}

/**
 * Helper to ensure auto-bcc is turned off.
 */
function ensureNoAutoBcc(aIdentity) {
  aIdentity.doBcc = false;
}

/**
 * Tests that for a list post with munged Reply-To:
 * - reply: goes to From
 * - reply all: includes From + the usual thing
 * - reply list: goes to the list
 */
function testReplyToMungedReplyToList() {
  let msg0 = create_message({
    from: "Tester <test@example.com>",
    to: "munged.list@example.com, someone.else@example.com",
    subject: "testReplyToMungedReplyToList",
    clobberHeaders: {
      "Reply-To": "Munged List <munged.list@example.com>",
      "List-Post": "<mailto:munged.list@example.com>",
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);

  checkReply(
    open_compose_with_reply,
    {"addr_to": ["Tester <test@example.com>"]}
  );

  checkReply(
    open_compose_with_reply_to_all,
    {
      "addr_to": [
        "Munged List <munged.list@example.com>",
        "someone.else@example.com",
        "Tester <test@example.com>"
       ]
    }
  );

  checkReply(
    open_compose_with_reply_to_list,
    {
      "addr_to": ["munged.list@example.com"]
    }
  );
}

/**
 * Tests that addresses get set properly when doing a normal reply.
 */
function testToCcReply() {
  let msg0 = create_message({
    from: "Homer <homer@example.com>",
    to: "Mr Burns <mrburns@example.com>, workers@example.com, " +
        myEmail,
    cc: "Lisa <lisa@example.com>",
    subject: "testToCcReply - normal mail with to and cc (me in To)"
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply,
      // To: From
    {"addr_to": ["Homer <homer@example.com>"]}
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
    open_compose_with_reply,
    // To: From
    // Cc: identity Cc list, including self.
    {
      "addr_to": ["Homer <homer@example.com>"],
      "addr_cc": [myEmail, "smithers@example.com"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Tests that addresses get set properly when doing a normal reply to all.
 */
function testToCcReplyAll() {
  let msg0 = create_message({
    from: "Homer <homer@example.com>",
    to: "Mr Burns <mrburns@example.com>, workers@example.com, " +
        myEmail,
    cc: "Lisa <lisa@example.com>",
    subject: "testToCcReplyAll - normal mail with to and cc (me in To)"
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply_to_all,
    // To: From + Tos without me.
    // Cc: original Ccs
    {
      "addr_to": ["Homer <homer@example.com>",
                  "Mr Burns <mrburns@example.com>",
                  "workers@example.com"],
      "addr_cc": ["Lisa <lisa@example.com>"]
    }
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
    open_compose_with_reply_to_all,
    // To: From + Tos without me.
    // Cc: original Ccs + auto-Ccs
    {
      "addr_to": ["Homer <homer@example.com>",
                  "Mr Burns <mrburns@example.com>",
                  "workers@example.com"],
      "addr_cc": ["Lisa <lisa@example.com>",
                  myEmail,
                  "smithers@example.com"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Tests that that addresses get set properly when doing a normal reply to all
 * where when recipients aren't all ascii.
 */
function testToCcReplyAllInternational() {
  let msg0 = create_message({
    from: "Hideaki / =?iso-2022-jp?B?GyRCNUhGIzFRTEAbKEI=?= <hideaki@example.com>",
    to: "Mr Burns <mrburns@example.com>, =?UTF-8?B?w4VrZQ==?= <ake@example.com>, " +
        "=?KOI8-R?Q?=E9=D7=C1=CE?= <ivan@example.com>, " + myEmail,
    cc: "=?Big5?B?pP2oca1e?= <xiuying@example.com>",
    subject: "testToCcReplyAllInternational - non-ascii people mail with to and cc (me in To)",
    clobberHeaders: { 'Content-Transfer-Encoding': 'quoted-printable' },
    // Content-Transfer-Encoding ^^^ should be set from the body encoding below,
    //but that doesn't seem to work. (No Content-Transfer-Encoding header is
    // generated).
    body: {charset: "windows-1251", encoding: "quoted-printable", body: "=CF=F0=E8=E2=E5=F2 =E8=E7 =CC=EE=F1=EA=E2=FB"}
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply_to_all,
    // To: From + Tos without me.
    // Cc: original Ccs
    {
      "addr_to": ["Hideaki / 吉藤英明 <hideaki@example.com>",
                  "Mr Burns <mrburns@example.com>",
                  "Åke <ake@example.com>",
                  "Иван <ivan@example.com>"],
      "addr_cc": ["王秀英 <xiuying@example.com>"]
    }
  );

  useAutoCc(identity, "Åsa <asa@example.com>");
  checkReply(
    open_compose_with_reply_to_all,
    // To: From + Tos without me.
    // Cc: original Ccs + auto-Ccs
    {
      "addr_to": ["Hideaki / 吉藤英明 <hideaki@example.com>",
                  "Mr Burns <mrburns@example.com>",
                  "Åke <ake@example.com>",
                  "Иван <ivan@example.com>"],
      "addr_cc": ["王秀英 <xiuying@example.com>", "Åsa <asa@example.com>"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Tests that that addresses get set properly when doing a reply to a mail with
 * reply-to set.
 */
function testToCcReplyWhenReplyToSet() {
  let msg0 = create_message({
    from: "Homer <homer@example.com>",
    to: "workers@example.com",
    cc: "Lisa <lisa@example.com>, " + myEmail,
    subject: "testToCcReplyWhenReplyToSet - to/cc mail with reply-to set (me in Cc)",
    clobberHeaders: {
      "Reply-To": "marge@example.com"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply,
    // To: reply-to
    {"addr_to": ["marge@example.com"]}
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
    open_compose_with_reply,
    // To: reply-to
    // Cc: auto-Ccs
    {
      "addr_to": ["marge@example.com"],
      "addr_cc": [myEmail, "smithers@example.com"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Tests that addresses get set properly when doing a reply to all for a mail
 * w/ Reply-To.
 */
function testToCcReplyAllWhenReplyToSet() {
  let msg0 = create_message({
    from: "Homer <homer@example.com>",
    to: "workers@example.com",
    cc: "Lisa <lisa@example.com>, " + myEmail,
    subject: "testToCcReplyAllWhenReplyToSet - to/cc mail with reply-to set (me in Cc)",
    clobberHeaders: {
      "Reply-To": "marge@example.com"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply_to_all,
    // To: Reply-To + Tos
    // Cc: original Ccs without me.
    {
      "addr_to": ["marge@example.com",
                  "workers@example.com"],
      "addr_cc": ["Lisa <lisa@example.com>"]
    }
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
    open_compose_with_reply_to_all,
    // To: Reply-To + Tos
    // Cc: original Ccs + auto-Ccs (which includes me!)
    {
      "addr_to": ["marge@example.com",
                  "workers@example.com"],
      "addr_cc": ["Lisa <lisa@example.com>", myEmail, "smithers@example.com"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Tests that addresses get set properly when doing a reply to list.
 */
function testReplyToList() {
  let msg0 = create_message({
    from: "Homer <homer@example.com>",
    to: "workers-list@example.com",
    cc: "Lisa <lisa@example.com>, " + myEmail,
    subject: "testReplyToList - mailing list message (me in Cc)",
    clobberHeaders: {
      "List-Post": "<mailto:workers-list@example.com>"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply_to_list,
    // To: the list
    {"addr_to": ["workers-list@example.com"]}
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
    open_compose_with_reply_to_list,
    // To: the list
    // Cc: auto-Ccs
    {
      "addr_to": ["workers-list@example.com"],
      "addr_cc": [myEmail, "smithers@example.com"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Tests that addresses get set properly when doing a reply to sender for a
 * list post.
 */
function testReplySenderForListPost() {
  let msg0 = create_message({
    from: "Homer <homer@example.com>",
    to: "workers-list@example.com",
    cc: "Lisa <lisa@example.com>, " + myEmail,
    subject: "testReplySenderForListPost - mailing list message (me in Cc)",
    clobberHeaders: {
      "List-Post": "<mailto:workers-list@example.com>"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply,
    // To: From
    {"addr_to": ["Homer <homer@example.com>"]}
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
    open_compose_with_reply,
    // To: From
    // Cc: auto-Ccs
    {
      "addr_to": ["Homer <homer@example.com>"],
      "addr_cc": [myEmail, "smithers@example.com"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Tests that addresses get set properly when doing a reply all to a list post.
 */
function testReplyToAllForListPost() {
  let msg0 = create_message({
    from: "Homer <homer@example.com>",
    to: "workers-list@example.com",
    cc: "Lisa <lisa@example.com>, " + myEmail,
    subject: "testReplyToAllForListPost - mailing list message (me in Cc)",
    clobberHeaders: {
      "List-Post": "<mailto:workers-list@example.com>"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply_to_all,
    // To: From + original To
    // Cc: original CC without me
    {
      "addr_to": ["Homer <homer@example.com>", "workers-list@example.com"],
      "addr_cc": ["Lisa <lisa@example.com>"]
    }
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
    open_compose_with_reply_to_all,
    // To: From + original To
    // Cc: original CC + auto-Ccs (including me!)
    {
    "addr_to": ["Homer <homer@example.com>", "workers-list@example.com"],
    "addr_cc": ["Lisa <lisa@example.com>", myEmail, "smithers@example.com"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Tests that addresses get set properly when doing a reply to all for a list
 * post when also reply-to is set.
 */
function testReplyToListWhenReplyToSet() {
  let msg0 = create_message({
    from: "Homer <homer@example.com>",
    to: "workers-list@example.com, " + myEmail,
    cc: "Lisa <lisa@example.com>",
    subject: "testReplyToListWhenReplyToSet - mailing list message w/ cc, reply-to (me in To)",
    clobberHeaders: {
      "Reply-To": "marge@example.com",
      "List-Post": "<mailto:workers-list@example.com>"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply_to_all,
    // To: Reply-To, original Tos
    // Cc: original Cc
    {
      "addr_to": ["marge@example.com", "workers-list@example.com"],
      "addr_cc": ["Lisa <lisa@example.com>"]
    }
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
    open_compose_with_reply_to_all,
    // To: Reply-To, original Tos
    // Cc: original Cc + auto-Ccs
    {
      "addr_to": ["marge@example.com", "workers-list@example.com"],
      "addr_cc": ["Lisa <lisa@example.com>", myEmail, "smithers@example.com"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Test that addresses get set properly for Mail-Reply-To. Mail-Reply-To should
 * be used for reply to author, if present.
 * @see http://cr.yp.to/proto/replyto.html
 */
function testMailReplyTo() {
  let msg0 = create_message({
    from: "Homer <homer@example.com>",
    to: "workers-list@example.com",
    cc: "Lisa <lisa@example.com>",
    subject: "testMailReplyTo - mail with Mail-Reply-To header",
    clobberHeaders: {
      "Reply-To": "workers-list@example.com", // reply-to munging
      "Mail-Reply-To": "Homer S. <homer@example.com>"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply,
    // To: Mail-Reply-To
    {"addr_to": ["Homer S. <homer@example.com>"]}
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
    open_compose_with_reply,
    // To: Mail-Reply-To
    // Cc: auto-Ccs
    {
      "addr_to": ["Homer S. <homer@example.com>"],
      "addr_cc": [myEmail, "smithers@example.com"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Test that addresses get set properly Mail-Followup-To. Mail-Followup-To
 * should be the default recipient list for reply-all, if present.
 * @see http://cr.yp.to/proto/replyto.html
 */
function testMailFollowupTo() {
  let msg0 = create_message({
    from: "Homer <homer@example.com>",
    to: "workers-list@example.com, " + myEmail,
    cc: "Lisa <lisa@example.com>",
    subject: "testMailFollowupTo - mail with Mail-Followup-To header",
    clobberHeaders: {
      // Homer is on the list, and don't want extra copies, so he has
      // set the Mail-Followup-To header so followups go to the list.
      "Mail-Followup-To": "workers-list@example.com"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply_to_all,
     // To: Mail-Followup-To
    {"addr_to": ["workers-list@example.com"]}
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
    open_compose_with_reply_to_all,
    // To: Mail-Followup-To
    // Cc: auto-Ccs
    {
      "addr_to": ["workers-list@example.com"],
      "addr_cc": [myEmail, "smithers@example.com"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Tests that addresses get set properly for reply to self.
 */
function testReplyToSelfReply() {
  let msg0 = create_message({
    from: myEmail,
    to: "Bart <bart@example.com>, Maggie <maggie@example.com>",
    cc: "Lisa <lisa@example.com>",
    subject: "testReplyToSelfReply - reply to self",
    clobberHeaders: {
      "Bcc": "Moe <moe@example.com>",
      "Reply-To": "Flanders <flanders@example.com>"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply,
    // To: original To
    // Reply-To: original Reply-To
    {
      "addr_to": ["Bart <bart@example.com>", "Maggie <maggie@example.com>"],
      "addr_reply": ["Flanders <flanders@example.com>"]
    }
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
    open_compose_with_reply,
    // To: original To
    // Cc: auto-Ccs
    // Reply-To: original Reply-To
    {
      "addr_to": ["Bart <bart@example.com>", "Maggie <maggie@example.com>"],
      "addr_cc": [myEmail, "smithers@example.com"],
      "addr_reply": ["Flanders <flanders@example.com>"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Tests that addresses get set properly for a reply all to self - this should
 * be treated as a followup.
 */
function testReplyToSelfReplyAll() {
  let msg0 = create_message({
    from: myEmail,
    to: "Bart <bart@example.com>, Maggie <maggie@example.com>",
    cc: "Lisa <lisa@example.com>",
    subject: "testReplyToSelfReplyAll - reply to self",
    clobberHeaders: {
      "Bcc": "Moe <moe@example.com>",
      "Reply-To": "Flanders <flanders@example.com>"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
     open_compose_with_reply_to_all,
    // To: original To
    // Cc: original Cc
    // Bcc: original Bcc
    // Reply-To: original Reply-To
    {
      "addr_to": ["Bart <bart@example.com>",
                  "Maggie <maggie@example.com>"],
      "addr_cc": ["Lisa <lisa@example.com>"],
      "addr_bcc": ["Moe <moe@example.com>"],
      "addr_reply": ["Flanders <flanders@example.com>"]
    }
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  useAutoBcc(identity, "Lisa <lisa@example.com>");
  checkReply(
    open_compose_with_reply_to_all,
    // To: original To
    // Cc: original Cc (auto-Ccs would have been included here already)
    // Bcc: original Bcc
    // Reply-To: original Reply-To
    {
      "addr_to": ["Bart <bart@example.com>",
                  "Maggie <maggie@example.com>"],
      "addr_cc": ["Lisa <lisa@example.com>"],
      "addr_bcc": ["Moe <moe@example.com>"],
      "addr_reply": ["Flanders <flanders@example.com>"]
    }
  );
  stopUsingAutoCc(identity);
  stopUsingAutoBcc(identity);
}

/**
 * Tests that addresses get set properly for a reply all to self - but for a
 * message that is not really the original sent message. Like an auto-bcc:d copy
 * or from Gmail. This should be treated as a followup.
 */
function testReplyToSelfNotOriginalSourceMsgReplyAll() {
  let msg0 = create_message({
    from: myEmail2,
    to: "Bart <bart@example.com>, Maggie <maggie@example.com>",
    cc: "Lisa <lisa@example.com>",
    subject: "testReplyToSelfNotOriginalSourceMsgReplyAll - reply to self",
    clobberHeaders: {
      "Reply-To": "Flanders <flanders@example.com>"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity2);
  useAutoBcc(identity2, myEmail + ", smithers@example.com");
  checkReply(
     open_compose_with_reply_to_all,
    // To: original To
    // Cc: original Cc
    // Bcc: auto-bccs
    // Reply-To: original Reply-To
    {
      "addr_to": ["Bart <bart@example.com>",
                  "Maggie <maggie@example.com>"],
      "addr_cc": ["Lisa <lisa@example.com>"],
      "addr_bcc": [myEmail, "smithers@example.com"],
      "addr_reply": ["Flanders <flanders@example.com>"]
    }
  );
  stopUsingAutoBcc(identity2);

  useAutoCc(identity2, myEmail + ", smithers@example.com");
  useAutoBcc(identity2, "moe@example.com,bart@example.com,lisa@example.com");
  checkReply(
    open_compose_with_reply_to_all,
    // To: original To
    // Cc: original Cc (auto-Ccs would have been included here already)
    // Bcc: auto-bcc minus addressess already in To/Cc
    // Reply-To: original Reply-To
    {
      "addr_to": ["Bart <bart@example.com>",
                  "Maggie <maggie@example.com>"],
      "addr_cc": ["Lisa <lisa@example.com>", myEmail, "smithers@example.com"],
      "addr_bcc": ["moe@example.com"],
      "addr_reply": ["Flanders <flanders@example.com>"]
    }
  );
  stopUsingAutoCc(identity2);
  stopUsingAutoBcc(identity2);

  useAutoBcc(identity2, myEmail2 + ", smithers@example.com");
  checkReply(
    open_compose_with_reply_to_all,
    // To: original To
    // Cc: original Cc (auto-Ccs would have been included here already)
    // Bcc: auto-bccs
    // Reply-To: original Reply-To
    {
      "addr_to": ["Bart <bart@example.com>",
                  "Maggie <maggie@example.com>"],
      "addr_cc": ["Lisa <lisa@example.com>"],
      "addr_bcc": [myEmail2, "smithers@example.com"],
      "addr_reply": ["Flanders <flanders@example.com>"]
    }
  );
  stopUsingAutoBcc(identity2);
}

/**
 * Tests that a reply to an other identity isn't treated as a reply to self
 * followup.
 */
function testReplyToOtherIdentity() {
  let msg0 = create_message({
    from: myEmail,
    to: myEmail2 + ", barney@example.com",
    cc: "Lisa <lisa@example.com>",
    subject: "testReplyToOtherIdentity - reply to other identity",
    clobberHeaders: {
      "Reply-To": "secretary@example.com"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity2);
  ensureNoAutoBcc(identity2);
  checkReply(
    open_compose_with_reply_to_all,
    // To: from + to (except me2)
    // Cc: original Cc
    //
    {
      "addr_to": ["secretary@example.com", "barney@example.com"],
      "addr_cc": ["Lisa <lisa@example.com>"]
    }
  );
}

/**
 * Tests that addresses get set properly for a reply all to self w/ bccs -
 * this should be treated as a followup.
 */
function testReplyToSelfWithBccs() {
  let msg0 = create_message({
    from: myEmail,
    to: myEmail,
    cc: myEmail2 + ", Lisa <lisa@example.com>",
    subject: "testReplyToSelfWithBccs - reply to self",
    clobberHeaders: {
      "Bcc": "Moe <moe@example.com>, Barney <barney@example.com>",
      "Reply-To": myEmail2
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply_to_all,
    // To: original To
    // Cc: original Cc
    // Bcc: original Bcc
    // Reply-To: original Reply-To
    {
      "addr_to": [myEmail],
      "addr_cc": [myEmail2, "Lisa <lisa@example.com>"],
      "addr_bcc": ["Moe <moe@example.com>", "Barney <barney@example.com>"],
      "addr_reply": [myEmail2]
    }
  );
}

/**
 * Tests that addresses get set properly for a reply all to other identity w/ bccs -
 * this be treated as a followup.
 */
function testReplyToOtherIdentityWithBccs() {
  let msg0 = create_message({
    from: myEmail,
    to: myEmail2,
    cc: "Lisa <lisa@example.com>",
    subject: "testReplyToOtherIdentityWithBccs - reply to other identity",
    clobberHeaders: {
      "Bcc": "Moe <moe@example.com>, Barney <barney@example.com>"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply_to_all,
    // To: original To
    // Cc: original Cc
    // Bcc: original Bcc
    {
      "addr_to": [myEmail2],
      "addr_cc": ["Lisa <lisa@example.com>"],
      "addr_bcc": ["Moe <moe@example.com>", "Barney <barney@example.com>"]
    }
  );
}

/**
 * Tests that addresses get set properly for a nntp reply-all.
 */
function testNewsgroupsReplyAll() {
  let msg0 = create_message({
    from: "Homer <homer@example.com>",
    to: "test1-list@example.org",
    subject: "testNewsgroupsReplyAll - sent to two newsgroups and a list",
    clobberHeaders: {
      "Newsgroups": "example.test1, example.test2"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
     open_compose_with_reply_to_all,
    // To: From, original To
    // Newsgroups: original Ccs
    {
      "addr_to": ["Homer <homer@example.com>", "test1-list@example.org"],
      "addr_newsgroups": ["example.test1", "example.test2"]
    }
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
     open_compose_with_reply_to_all,
    // To: From, original To
    // Newsgroups: original Ccs
    {
      "addr_to": ["Homer <homer@example.com>", "test1-list@example.org"],
      "addr_cc": [myEmail, "smithers@example.com"],
      "addr_newsgroups": ["example.test1", "example.test2"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Tests that addresses get set properly for an nntp followup, when Followup-To
 * is set.
 */
function testNewsgroupsReplyAllFollowupTo() {
  let msg0 = create_message({
    from: "Homer <homer@example.com>",
    to: "test1-list@example.org, " + myEmail,
    subject: "testNewsgroupsReplyAllFollowupTo - Followup-To set",
    clobberHeaders: {
      "Newsgroups": "example.test1, example.test2",
      "Followup-To": "example.test2"
    }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply_to_all,
    // To: From + original To (except me)
    // Newsgroups: <Followup-To>
    {
      "addr_to": ["Homer <homer@example.com>", "test1-list@example.org"],
      "addr_newsgroups": ["example.test2"]
    }
  );

  useAutoCc(identity, myEmail + ", smithers@example.com");
  checkReply(
    open_compose_with_reply_to_all,
    // To: From + original To (except me)
    // Cc: auto-Ccs
    // Newsgroups: <Followup-To>
    {
      "addr_to": ["Homer <homer@example.com>", "test1-list@example.org"],
      "addr_cc": [myEmail, "smithers@example.com"],
      "addr_newsgroups": ["example.test2"]
    }
  );
  stopUsingAutoCc(identity);
}

/**
 * Tests that addresses get set properly when doing a reply where To=From
 * and a Reply-To exists.
 */
function testToFromWithReplyTo() {
  let msg0 = create_message({
    from: myEmail,
    to: myEmail,
    subject: "testToFromWithReplyTo - To=From w/ Reply-To set",
    clobberHeaders: { "Reply-To": "Flanders <flanders@example.com>" }
  });
  add_message_to_folder(folder, msg0);

  be_in_folder(folder);
  let msg = select_click_row(i++);
  assert_selected_and_displayed(mc, msg);

  ensureNoAutoCc(identity);
  checkReply(
    open_compose_with_reply,
    // To: Reply-To
    {"addr_to": ["Flanders <flanders@example.com>"]}
  );
}

