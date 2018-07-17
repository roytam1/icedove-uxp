/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/*
 * Test suite for increasing the popularity of contacts via
 * expandMailingLists.
 */

Components.utils.import("resource:///modules/mailServices.js");

var MsgComposeContractID = "@mozilla.org/messengercompose/compose;1";
var MsgComposeParamsContractID = "@mozilla.org/messengercompose/composeparams;1";
var MsgComposeFieldsContractID = "@mozilla.org/messengercompose/composefields;1";

var TESTS = [
  {
    email: "em@test.invalid",
    // TB 2 stored popularity as hex, so we need to check correct handling.
    prePopularity: "a",
    postPopularity: "11"
  },
  {
    email: "e@test.invalid",
    prePopularity: "0",
    postPopularity: "1"
  },
  {
    email: "e@test.invalid",
    prePopularity: "1",
    postPopularity: "2"
  },
  {
    email: "em@test.invalid",
    prePopularity: "11",
    postPopularity: "12"
  }
];

function checkPopulate(aTo, aCheckTo)
{
  let msgCompose = Cc[MsgComposeContractID].createInstance(Ci.nsIMsgCompose);

  // Set up some basic fields for compose.
  let fields = Cc[MsgComposeFieldsContractID].createInstance(Ci.nsIMsgCompFields);

  fields.to = aTo;

  // Set up some params
  let params = Cc[MsgComposeParamsContractID]
                 .createInstance(Ci.nsIMsgComposeParams);

  params.composeFields = fields;

  msgCompose.initialize(params);

  do_check_eq(msgCompose.expandMailingLists());

  do_check_eq(fields.to, aCheckTo);
}

function run_test() {
  // Test setup - copy the data files into place
  let testAB = do_get_file("../../../data/tb2hexpopularity.mab");

  // Copy the file to the profile directory for a PAB
  testAB.copyTo(do_get_profile(), kPABData.fileName);

  // Check the popularity index on a couple of cards.
  let AB = MailServices.ab.getDirectory(kPABData.URI);

  for (let i = 0; i < TESTS.length; ++i) {
    let card = AB.cardForEmailAddress(TESTS[i].email);
    do_check_true(!!card);

    // Thunderbird 2 stored its popularityIndexes as hex, hence when we read it
    // now we're going to get a hex value. The AB has a value of "a".
    do_check_eq(card.getProperty("PopularityIndex", -1), TESTS[i].prePopularity);

    // Call the check populate function.
    checkPopulate(TESTS[i].email, TESTS[i].email);

    // Now we've run check populate, check the popularityIndex has increased.
    card = AB.cardForEmailAddress(TESTS[i].email);
    do_check_true(!!card);

    // Thunderbird 2 stored its popularityIndexes as hex, hence when we read it
    // now we're going to get a hex value. The AB has a value of "a".
    do_check_eq(card.getProperty("PopularityIndex", -1), TESTS[i].postPopularity);
  }
};
