# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]
## [v2.5]

## [v2.4] 2020-06-18
### Fixed
- Broken SearX instance
- Update timezones to 2020a
- UXP#1457 - Unfold sqlite

### Removed
- UXP#756 - Remove identity from manifestHEADmaster
- UXP#1470 - Remove update.locale
- UXP#1390 - Remove Presentation Service
- UXP#1538 - Remove speech recognition

## [v2.3] 2020-01-12

### Added
- New about config option "mail.suppress_content_language", set to true by default.
This removes Content-Language header from outgoing mail to help resist fingerprinting.

### Removed
- Search engines that are not useful from mail: YaCy, GNUSocial, Internet Archive, Package Search
- MailNews: this component was taken upstream to UXP
- TwemojiMozilla font: now ships in UXP by default.

### Fixed
- Missing locales for RSS Feed Reader that was removed during imChat component removal.

## [v2.2] 2019-10-03
### Added
- 2019c timezones update

### Fixed
- Backports for various crash fixes and bugs
- Missing dom_bindings.xpt in package-manifest.in
- Broken folder Removal Prompt after removing an Account

### Changed
- SearX search engine instance to a working one

## [v2.1] 2019-08-26
### Added
- New 2019b Time Zone update
- Use our own infastructure for autoconfiguration wizard

### Fixed
- Default search engine changed to working instances (SearX/YaCy)
- Backports for various crash fixes and minor bug fixes

### Changed
- Profile Directory (Now ~/.hyperbola/icedove-uxp instead of ~/.mozilla/thunderbird)
- Iceowl-UXP now installs as global addon (opt-in)
- RSS feeds now open default browser (Iceweasel-UXP)

### Removed
- Chat and IM (unmaintained code)
- MediaGoblin instance search plugin

## [v2.0] - 2019-06-15
### Added
- Backports for various crash fixes and minor bug fixes
- Backports for fetching ISP configuration using SSL and SOCKS (Tails Uplift)
- Backports for supporting multiple authors and mimetypes in RSS feeds
- Ability to disable Calendar's UA string (New pref: calendar.useragent.disabled true/false)

### Changed
- Referer and Cookies are now disabled by default
- UserAgent version bumped

### Fixed
- Fallout from upstream UXP refactor of search service.

### Removed
- Outlook Express Importer
- Unused nsIImportMimeEncode.idl

### Security
- Multiple security backports applied to libical: CVE-2019-11703, CVE-2019-11704, CVE-2019-11705, CVE-2019-11706

## [v1.9] - 2019-03-23
### Added
- Backports for various crash fixes and minor bug fixes

### Removed
- Remove unused code that uses eval from Protovis library.

## [v1.8] - 2019-02-20
### Added
- Backports for various crash fixes
- Backports for Time Zone data and bug fix for Brazilian time

### Security
- Backported fix for CVE-2018-18509: S/MIME signature spoofing

## [v1.7] - 2018-12-19
### Added
- Backports for various crash fixes

## [v1.6] - 2018-11-19
### Added
- Backports for various crash fixes
- Backport new version of ICal for Iceowl-UXP

### Fixed
- Missing Header file in mailnews/ (regression)

## [v1.5] - 2018-10-30
### Added
- Error Console opens in a new tab pref(toolkit.console.openInTab)
- Backports for various crash fixes

### Removed
- InstantBird
- Unused Build Files (S3 Bucket and Rust)
- Unneeded includes in mailnews/

## [v1.4] - 2018-09-15
### Removed
- Telemetry
- DOCTYPE declarations from SVG files

## [v1.3] - 2018-09-04
### Added
- Iceowl branding and GUID for Lightning Calendar
- Backport: Various calendar and minor bugfixes in mail

### Changed
- Refer to a "change log" instead of a "CHANGELOG" throughout the site
to differentiate between the file and the purpose of the file -- the
logging of changes.

### Removed
- File Link Footer Text
- OAuth2
- Non-free Google Calendar API key and GCal remnents

## [v1.2] - 2018-08-11
### Added
- Internal about:credits page
- Backported context menu bug fixes

### Removed
- Mozilla AUS and Update URLs

## [v1.1] - 2018-08-01
### Added
- Backported security fixes that prevent stale password attempts

### Changed
- Iceape-UXP GUID reference in Icedove-UXP code
- Fix for oversized search engine icons

### Removed
- Unused Data Choices Tab

## [v1.0] - 2018-07-28
### Added
- Initial Import of Thunderbird esr52.9.1
- Icedove branding
- NextCloud File Link

### Changed
- GUID
- API Changes: nsIURIWithQuery (c-c 1326433), SEC_NORMAL (c-c 1328847)
- Restored classic Error Console
- Add blocklist.manifest for TychoAM (Addon Manager)
- Change default search engines

### Removed
- Thunderbird Branding
- HighTail File Link (non-free)
- Google Phishing Service
- Google Calendar (SaaSS)
- DOM Web Speech
- Mozilla Security Reporter
- All Rust Code
- Chromium sandbox



[Unreleased]: https://git.hyperbola.info:50100/software/icedove-uxp.git/log/
[v1.0]: https://git.hyperbola.info:50100/software/icedove-uxp.git/tag/?h=v1.0
[v1.1]: https://git.hyperbola.info:50100/software/icedove-uxp.git/tag/?h=v1.1
[v1.2]: https://git.hyperbola.info:50100/software/icedove-uxp.git/tag/?h=v1.2
[v1.3]: https://git.hyperbola.info:50100/software/icedove-uxp.git/tag/?h=v1.3
[v1.4]: https://git.hyperbola.info:50100/software/icedove-uxp.git/tag/?h=v1.4
[v1.5]: https://git.hyperbola.info:50100/software/icedove-uxp.git/tag/?h=v1.5
[v1.6]: https://git.hyperbola.info:50100/software/icedove-uxp.git/tag/?h=v1.6
[v1.7]: https://git.hyperbola.info:50100/software/icedove-uxp.git/tag/?h=v1.7
[v1.8]: https://git.hyperbola.info:50100/software/icedove-uxp.git/tag/?h=v1.8
[v1.9]: https://git.hyperbola.info:50100/software/icedove-uxp.git/tag/?h=v1.9
