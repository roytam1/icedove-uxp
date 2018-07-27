# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Lighting version number
ICEDOVEUXP_VERSION := $(shell cat $(topsrcdir)/mail/config/version.txt)
ICEAPEUXP_VERSION := $(shell cat $(topsrcdir)/suite/config/version.txt)

ifdef MOZ_SUITE
LIGHTNING_VERSION := $(shell $(PYTHON) $(topsrcdir)/calendar/lightning/build/makeversion.py $(ICEDOVEUXP_VERSION))
else
LIGHTNING_VERSION := $(shell $(PYTHON) $(topsrcdir)/calendar/lightning/build/makeversion.py $(word 1,$(MOZ_PKG_VERSION) $(ICEDOVEUXP_VERSION)))
endif

# For extensions we require a max version that is compatible across security releases.
# ICEDOVEUXP_MAXVERSION and ICEAPEUXP_MAXVERSION is our method for doing that.
# Alpha versions 10.0a1 and 10.0a2 aren't affected
# For Iceape-UXP, 2.17 becomes 2.17.*, 2.17.1 becomes 2.17.*
# For Icedove-UXP, 10.0 becomes 10.*, 10.0.1 becomes 10.*
ICEDOVEUXP_MAXVERSION := $(ICEDOVEUXP_VERSION)
ifneq (a,$(findstring a,$(ICEDOVEUXP_VERSION)))
ICEDOVEUXP_MAXVERSION := $(shell echo $(ICEDOVEUXP_VERSION) | sed 's|\(^[0-9]*\)\.\([0-9]*\).*|\1|' ).*
endif

ICEAPEUXP_MAXVERSION := $(ICEAPEUXP_VERSION)
ifneq (a,$(findstring a,$(ICEAPEUXP_VERSION)))
ICEAPEUXP_MAXVERSION := $(shell echo $(ICEAPEUXP_VERSION) | sed 's|\(^[0-9]*.[0-9]*\).*|\1|' ).*
endif
