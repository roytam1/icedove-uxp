/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * This tests various body search criteria.
 */
load("../../../resources/searchTestUtils.js");

Components.utils.import("resource:///modules/mailServices.js");

var nsMsgSearchScope = Ci.nsMsgSearchScope;
var nsMsgSearchAttrib = Ci.nsMsgSearchAttrib;
var nsMsgSearchOp = Ci.nsMsgSearchOp;

var Isnt = nsMsgSearchOp.Isnt;
var Is = nsMsgSearchOp.Is;
var IsEmpty = nsMsgSearchOp.IsEmpty;
var IsntEmpty = nsMsgSearchOp.IsntEmpty;
var Contains = nsMsgSearchOp.Contains;
var DoesntContain = nsMsgSearchOp.DoesntContain;
var IsBefore = nsMsgSearchOp.IsBefore; // control entry not enabled

var offlineMail = nsMsgSearchScope.offlineMail;
var onlineMail = nsMsgSearchScope.onlineMail;
var offlineMailFilter = nsMsgSearchScope.offlineMailFilter;
var onlineMailFilter = nsMsgSearchScope.onlineMailFilter;
var news = nsMsgSearchScope.news; // control entry not enabled

var Body = nsMsgSearchAttrib.Body;

var Files =
[
  "../../../data/base64-1",
  "../../../data/basic1",
  "../../../data/multipart-base64-2",
  "../../../data/bug132340",

  // Base64 encoded bodies.
  "../../../data/01-plaintext.eml",
  "../../../data/02-plaintext+attachment.eml",
  "../../../data/03-HTML.eml",
  "../../../data/04-HTML+attachment.eml",
  "../../../data/05-HTML+embedded-image.eml",
  "../../../data/06-plaintext+HMTL.eml",
  "../../../data/07-plaintext+(HTML+embedded-image).eml",
  "../../../data/08-plaintext+HTML+attachment.eml",
  "../../../data/09-(HTML+embedded-image)+attachment.eml",
  "../../../data/10-plaintext+(HTML+embedded-image)+attachment.eml",

  // Bodies with non-ASCII characters in UTF-8 and other charsets.
  "../../../data/11-plaintext.eml",
  "../../../data/12-plaintext+attachment.eml",  // using ISO-8859-7 (Greek)
  "../../../data/13-HTML.eml",
  "../../../data/14-HTML+attachment.eml",
  "../../../data/15-HTML+embedded-image.eml",
  "../../../data/16-plaintext+HMTL.eml",                   // text part is base64 encoded
  "../../../data/17-plaintext+(HTML+embedded-image).eml",  // HTML part is base64 encoded
  "../../../data/18-plaintext+HTML+attachment.eml",
  "../../../data/19-(HTML+embedded-image)+attachment.eml",
  "../../../data/20-plaintext+(HTML+embedded-image)+attachment.eml",  // using windows-1252

  // Bodies with non-ASCII characters in UTF-8 and other charsets, all encoded with quoted printable.
  "../../../data/21-plaintext.eml",
  "../../../data/22-plaintext+attachment.eml",  // using ISO-8859-7 (Greek)
  "../../../data/23-HTML.eml",
  "../../../data/24-HTML+attachment.eml",
  "../../../data/25-HTML+embedded-image.eml",
  "../../../data/26-plaintext+HMTL.eml",                   // text part is base64 encoded
  "../../../data/27-plaintext+(HTML+embedded-image).eml",  // HTML part is base64 encoded
  "../../../data/28-plaintext+HTML+attachment.eml",
  "../../../data/29-(HTML+embedded-image)+attachment.eml",
  "../../../data/30-plaintext+(HTML+embedded-image)+attachment.eml",  // using windows-1252

  // Messages with message attachments, Content-Type: message/rfc822.
  "../../../data/multipart-message-1.eml",  // plaintext, has "bodyOfAttachedMessagePlain"
  "../../../data/multipart-message-2.eml",  // plaintext, base64, non-ASCII, has "bodyOfAttachedMessagePläin"
  "../../../data/multipart-message-3.eml",  // plaintext+HTML, non-ASCII in plaintext, has "bodyOfAttachedMessagePläin"
  "../../../data/multipart-message-4.eml",  // plaintext+HTML, non-ASCII in HTML, has "bodyOfAttachedMessägeHTML"
]
var Tests =
[
  /* Translate Base64 messages */
  // "World!" is contained in three messages, but in bug132340 it's not in a text
  // part and should not be found.
  { value: "World!", op: Contains, count: 2 },
  /* Don't match the base64 text */
  { value: "DQp", op: Contains, count: 0 },
  /* Nested multipart/mixed, don't match */
  { value: "PGh", op: Contains, count: 0 },
  /* An encoded base-64 text/plain match */
  { value: "base 64 text", op: Contains, count: 1 },

  // Comprehensive test of various MIME structures, messages 01 to 10.
  // Messages 01 to 10 contain "huhu" once.
  { value: "huhu", op: Contains, count: 10 },

  // Messages 06, 07, 08, 10 contain "hihi" in the plaintext part.
  { value: "hihi", op: Contains, count: 4 },

  // The base64 of embedded images and attachments contains "iVBORw" and we don't
  // want to find that.
  { value: "iVBORw", op: Contains, count: 0 },

  // The base64 of attachments contains "wMA005J0z" and we don't want to find that.
  { value: "wMA005J0z", op: Contains, count: 0 },

  // The base64 of the plaintext and HTML parts contains "U2VhcmNoIGZ"
  // and we don't want to find that.
  { value: "U2VhcmNoIGZ", op: Contains, count: 0 },

  // Messages 11 and 13 to 20 contain "hühü" once.
  { value: "hühü", op: Contains, count: 9 },
  // Message 12 contains Καλησπέρα (good evening in Greek).
  { value: "Καλησπέρα", op: Contains, count: 1 },

  // Messages 16, 17, 18, 20 contain "hïhï" in the plaintext part.
  { value: "hïhï", op: Contains, count: 4 },

  // Messages 21 and 23 to 30 contain "höhö" once.
  { value: "höhö", op: Contains, count: 9 },
  // Message 22 contains Καλημέρα (good morning in Greek).
  { value: "Καλημέρα", op: Contains, count: 1 },

  // Messages 16, 17, 18, 20 contain "hähä" in the plaintext part.
  { value: "hähä", op: Contains, count: 4 },

  // The four messages with message/rfc822 attachment contain "bodyOfAttachedMessagePlain"
  // or "bodyOfAttachedMessagePläin" in the plaintext part and "bodyOfAttachedMessageHTML"
  // or "bodyOfAttachedMessägeHTML" in the HTML part.
  { value: "bodyOfAttachedMessagePlain", op: Contains, count: 2 },
  { value: "bodyOfAttachedMessagePläin", op: Contains, count: 2 },
  { value: "bodyOfAttachedMessageHTML", op: Contains, count: 1 },
  { value: "bodyOfAttachedMessägeHTML", op: Contains, count: 1 },
];

function fixFile(file) {
  var fstream = Cc["@mozilla.org/network/file-input-stream;1"]
                  .createInstance(Ci.nsIFileInputStream);
  fstream.init(file, -1, -1, Ci.nsIFileInputStream.CLOSE_ON_EOF);
  var sstream = Cc["@mozilla.org/scriptableinputstream;1"]
                  .createInstance(Ci.nsIScriptableInputStream);
  sstream.init(fstream);

  var str = sstream.read(4096);
  if (str.startsWith("From ")) {
    sstream.close();
    fstream.close();
    return file;
  }
  var data = "From - Tue Oct 02 00:26:47 2007\r\n";
  do {
    data += str;
    str = sstream.read(4096);
  } while (str.length > 0);

  sstream.close();
  fstream.close();

  let targetFile = Cc["@mozilla.org/file/local;1"]
                     .createInstance(Ci.nsILocalFile);
  targetFile.initWithFile(do_get_profile());
  targetFile.append(file.leafName);
  let ostream = Cc["@mozilla.org/network/file-output-stream;1"]
                  .createInstance(Ci.nsIFileOutputStream);
  ostream.init(targetFile, -1, -1, 0);
  ostream.write(data, data.length);
  ostream.close();
  return targetFile;
}

var copyListener = 
{
  OnStartCopy: function() {},
  OnProgress: function(aProgress, aProgressMax) {},
  SetMessageKey: function(aKey) {},
  SetMessageId: function(aMessageId) {},
  OnStopCopy: function(aStatus) 
  {
    var fileName = Files.shift();
    if (fileName)
    { 
      var file = fixFile(do_get_file(fileName));
      MailServices.copy.CopyFileMessage(file, localAccountUtils.inboxFolder, null,
                                        false, 0, "", copyListener, null);
    }
    else
      testBodySearch();
  }
};

function run_test()
{
  localAccountUtils.loadLocalMailAccount();

  // test that validity table terms are valid

  // offline mail table
  testValidityTable(offlineMail, Contains, Body, true);
  testValidityTable(offlineMail, DoesntContain, Body, true);
  testValidityTable(offlineMail, Is, Body, true);
  testValidityTable(offlineMail, Isnt, Body, true);
  testValidityTable(offlineMail, IsEmpty, Body, false);
  testValidityTable(offlineMail, IsntEmpty, Body, false);
  testValidityTable(offlineMail, IsBefore, Body, false);

  // offline mail filter table
  testValidityTable(offlineMailFilter, Contains, Body, true);
  testValidityTable(offlineMailFilter, DoesntContain, Body, true);
  testValidityTable(offlineMailFilter, Is, Body, true);
  testValidityTable(offlineMailFilter, Isnt, Body, true);
  testValidityTable(offlineMailFilter, IsEmpty, Body, false);
  testValidityTable(offlineMailFilter, IsntEmpty, Body, false);
  testValidityTable(offlineMailFilter, IsBefore, Body, false);

  // online mail
  testValidityTable(onlineMail, Contains, Body, true);
  testValidityTable(onlineMail, DoesntContain, Body, true);
  testValidityTable(onlineMail, Is, Body, false);
  testValidityTable(onlineMail, Isnt, Body, false);
  testValidityTable(onlineMail, IsEmpty, Body, false);
  testValidityTable(onlineMail, IsntEmpty, Body, false);
  testValidityTable(onlineMail, IsBefore, Body, false);

  // online mail filter  
  /*testValidityTable(onlineMailFilter, Contains, Body, true);
  testValidityTable(onlineMailFilter, DoesntContain, Body, true);
  testValidityTable(onlineMailFilter, Is, Body, false);
  testValidityTable(onlineMailFilter, Isnt, Body, false);
  testValidityTable(onlineMailFilter, IsEmpty, Body, false);
  testValidityTable(onlineMailFilter, IsntEmpty, Body, false);
  testValidityTable(onlineMailFilter, IsBefore, Body, false);*/

  // News does not support body tests
  testValidityTable(news, Contains, Body, false);
  testValidityTable(news, DoesntContain, Body, false);
  testValidityTable(news, Is, Body, false);
  testValidityTable(news, Isnt, Body, false);
  testValidityTable(news, IsEmpty, Body, false);
  testValidityTable(news, IsntEmpty, Body, false);
  testValidityTable(news, IsBefore, Body, false);

  do_test_pending();
  copyListener.OnStopCopy(null);
}

// process each test from queue, calls itself upon completion of each search
var testObject;
function testBodySearch()
{
  var test = Tests.shift();
  if (test)
  {
    testObject = new TestSearch(localAccountUtils.inboxFolder,
                         test.value,
                         Body,
                         test.op,
                         test.count,
                         testBodySearch);
  }
  else
  {
    testObject = null;
    do_test_finished();
  }
}

