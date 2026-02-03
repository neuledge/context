---
"@neuledge/context": patch
---

Fix version detection to skip prerelease tags

When auto-detecting version from git tags, the code now properly identifies and skips prerelease versions (canary, alpha, beta, rc, etc.) and finds the highest stable version by semantic versioning.

Previously, adding a repository like Next.js would incorrectly pick a canary version (e.g., v16.2.0-canary.23) instead of the latest stable release (e.g., v16.1.6).
