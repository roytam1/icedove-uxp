#! /bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

MOZ_APP_BASENAME=Icedove-UXP
MOZ_APP_NAME=icedove-uxp
MOZ_UPDATER=1
MOZ_THUNDERBIRD=1
MOZ_APP_STATIC_INI=1
MOZ_DISABLE_EXPORT_JS=1
MOZ_NO_ACTIVEX_SUPPORT=1
MOZ_ACTIVEX_SCRIPTING_SUPPORT=
MOZ_LDAP_XPCOM=1
MOZ_COMPOSER=1

if test "$OS_ARCH" = "WINNT" -o \
        "$OS_ARCH" = "Linux"; then
  MOZ_BUNDLED_FONTS=1
fi

if test "$OS_ARCH" = "WINNT"; then
  if ! test "$HAVE_64BIT_BUILD"; then
    MOZ_VERIFY_MAR_SIGNATURE=1
    MOZ_MAINTENANCE_SERVICE=1
  fi
fi

# For Icedove-UXP we want to use 52.9.YYYYMMDD as MOZ_APP_VERSION in release
# builds so add-on developers have something to target while maintaining
# Thunderbird compatibility.
# To enable add "export ICEDOVE_VERSION=1" to the .mozconfig file.
# However, this will cause a full rebuild at 00:00 UTC every day so
# don't export the variable if you are in development or don't care.
# When not exported we fall back the value in the version*.txt file.
if test -n "$ICEDOVE_VERSION" ; then
    MOZ_APP_VERSION=52.9.`date --utc '+%Y%m%d'`
    MOZ_APP_VERSION_DISPLAY=52.9.`date --utc '+%Y%m%d'`
else
    MOZ_APP_VERSION_TXT=${_topsrcdir}/$MOZ_BUILD_APP/config/version.txt
    MOZ_APP_VERSION=`cat $MOZ_APP_VERSION_TXT`
    MOZ_APP_VERSION_DISPLAY_TXT=${_topsrcdir}/$MOZ_BUILD_APP/config/version_display.txt
    MOZ_APP_VERSION_DISPLAY=`cat $MOZ_APP_VERSION_DISPLAY_TXT`
fi

MOZ_SAFE_BROWSING=1
MOZ_MORK=1

THUNDERBIRD_VERSION=$MOZ_APP_VERSION

MOZ_UA_BUILDID=20100101

MOZ_BRANDING_DIRECTORY=mail/branding/icedove
MOZ_OFFICIAL_BRANDING_DIRECTORY=mail/branding/icedove
MOZ_APP_ID={3550f703-e582-4d05-9a08-453d09bdfdc6}
# This should usually be the same as the value MAR_CHANNEL_ID.
# If more than one ID is needed, then you should use a comma separated list
# of values.
ACCEPTED_MAR_CHANNEL_IDS=icedove-comm-release
# The MAR_CHANNEL_ID must not contain the following 3 characters: ",\t "
MAR_CHANNEL_ID=icedove-comm-release
# Enable generational GC on desktop.
JSGC_GENERATIONAL=1
MOZ_PROFILE_MIGRATOR=1
MOZ_JSDOWNLOADS=1
MOZ_BINARY_EXTENSIONS=1
MOZ_SEPARATE_MANIFEST_FOR_THEME_OVERRIDES=1

# Enable building ./signmar and running libmar signature tests
MOZ_ENABLE_SIGNMAR=1

MOZ_DEVTOOLS=all
