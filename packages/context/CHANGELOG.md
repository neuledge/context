# @neuledge/context

## 0.1.1

### Patch Changes

- 52c8d30: Fix version detection to skip prerelease tags

  When auto-detecting version from git tags, the code now properly identifies and skips prerelease versions (canary, alpha, beta, rc, etc.) and finds the highest stable version by semantic versioning.

  Previously, adding a repository like Next.js would incorrectly pick a canary version (e.g., v16.2.0-canary.23) instead of the latest stable release (e.g., v16.1.6).

- bf8f350: Fix CLI `remove` command to accept package names with version suffix (e.g., `next@v16.2.0`). Previously, only the package name without version worked.
