/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Default start page
//pref("mailnews.start_page.url", "chrome://messenger/content/start.xhtml");
pref("mailnews.start_page.url", "about:");

// first launch welcome page
//pref("mailnews.start_page.welcome_url", "chrome://messenger/content/start.xhtml");
pref("mailnews.start_page.welcome_url", "about:");

// start page override to load after an update
//pref("mailnews.start_page.override_url", "chrome://messenger/content/start.xhtml");
pref("mailnews.start_page.override_url", "about:");

pref("app.vendorURL", "http://www.mozillamessaging.com/%LOCALE%/thunderbird/");

// We appear as Thunderbird to avoid fingerprinting risks
pref("general.useragent.override", "Mozilla/5.0 (Windows NT 10.0; WOW64; rv:52.0) Gecko/20100101, Thunderbird/52.9.1");