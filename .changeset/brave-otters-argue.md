---
"@neuledge/context": patch
---

Fix two cases where a bare package name resolved to the wrong installed version. With two prereleases installed, `2.0.0-rc.10` ranked below `2.0.0-rc.2`, because the prerelease suffix was compared as text — the same inversion that made `1.15.10` lose to `1.15.9`, one field deeper. Prerelease identifiers are now compared one at a time, numerically where both are numbers. Separately, a version carrying semver build metadata (`1.0.0+20130313144700`) was treated as having no numeric part at all and sorted below every real release, including `0.0.1`; build metadata is now ignored for ordering, as semver specifies.
