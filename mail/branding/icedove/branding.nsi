# This Source Code Form is subject to the terms of the Mozilla Public
# # License, v. 2.0. If a copy of the MPL was not distributed with this
# # file, You can obtain one at http://mozilla.org/MPL/2.0/.

# NSIS defines for nightly builds.
# The release build branding.nsi is located in other-license/branding/thunderbird/
#!define BrandShortName        "Icedove-UXP"

# BrandFullNameInternal is used for some registry and file system values
# instead of BrandFullName and typically should not be modified.
!define BrandFullNameInternal "Icedove-UXP Mail/News"
!define CompanyName           "Hyperbola Project"
!define URLInfoAbout          "https://www.hyperbola.info/"
!define URLUpdateInfo         "https://wiki.hyperbola.info/doku.php?id=en:project:icedove-uxp"

# Everything below this line may be modified for Alpha / Beta releases.
#!define BrandFullName         "Icedove-UXP"

# Add !define NO_INSTDIR_FROM_REG to prevent finding a non-default installation
# directory in the registry and using that as the default. This prevents
# Beta releases built with official branding from finding an existing install
# of an official release and defaulting to its installation directory.
