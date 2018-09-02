# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

ifndef OBJDIR
OBJDIR_ARCH_1 = $(MOZ_OBJDIR)/$(firstword $(MOZ_BUILD_PROJECTS))
OBJDIR_ARCH_2 = $(MOZ_OBJDIR)/$(word 2,$(MOZ_BUILD_PROJECTS))
DIST_ARCH_1 = $(OBJDIR_ARCH_1)/dist
DIST_ARCH_2 = $(OBJDIR_ARCH_2)/dist
DIST_UNI = $(DIST_ARCH_1)/universal
OBJDIR = $(OBJDIR_ARCH_1)
endif

topsrcdir = $(TOPSRCDIR)
DEPTH = $(OBJDIR)

include $(DEPTH)/config/autoconf.mk
include $(topsrcdir)/mozilla/toolkit/mozapps/installer/package-name.mk

XPI_PKGNAME = iceowl-uxp-5.4.9.1.$(AB_CD).$(MOZ_PKG_PLATFORM)

STANDALONE_MAKEFILE := 1
include $(TOPSRCDIR)/config/config.mk

define unify_iceowl-uxp
mkdir -p $(DIST_UNI)/$1
rm -rf $(DIST_UNI)/$1/$2*
cp -R $(DIST_ARCH_1)/$1/$2 $(DIST_UNI)/$1
grep -v em:targetPlatform $(DIST_ARCH_1)/$1/$2/install.rdf > $(DIST_UNI)/$1/$2/install.rdf
endef

define unify_lightning_repackage
$(call py_action,zip,-C $(DIST_UNI)/$1/$2 ../$(XPI_PKGNAME).xpi '*')
endef

postflight_all:
	$(call unify_iceowl-uxp,xpi-stage,iceowl-uxp)
	$(call unify_iceowl-uxp_repackage,xpi-stage,iceowl-uxp)
ifdef NIGHTLY_BUILD
	$(call unify_iceowl-uxp,$(MOZ_APP_DISPLAYNAME).app/Contents/Resources/extensions,{e2fda1a4-762b-4020-b5ad-a41df1933103})
else
	$(call unify_iceowl-uxp,$(MOZ_APP_DISPLAYNAME).app/Contents/Resources/distribution/extensions,{e2fda1a4-762b-4020-b5ad-a41df1933103})
endif
