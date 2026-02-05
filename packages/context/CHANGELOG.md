# @neuledge/context

## 0.2.2

### Patch Changes

- ab8ac14: Add demo gif to README

## 0.2.1

### Patch Changes

- 8153b31: Improve get_docs tool description to better encourage agent usage

## 0.2.0

### Minor Changes

- 85980dd: Add interactive tag selection for git repositories with `--tag` option for non-interactive use. Improves monorepo support by letting users select the correct package tag.
- ead6a20: Rename CLI option `--docs-path` to `--path` for brevity

### Patch Changes

- 4aed06b: Fix duplicate sections appearing when scanning repos with identical content across multiple files

  Sections with the same content from different source files (e.g., shared README sections across package directories) are now deduplicated based on content only, keeping the first occurrence regardless of section title.

- 0845e7d: Rename `--version` to `--pkg-version` in the `add` command to fix conflict with Commander.js's built-in version flag
- 38d9ad5: Fix CLI version to read from package.json instead of hardcoded value, keeping it in sync with server version

## 0.1.1

### Patch Changes

- 52c8d30: Fix version detection to skip prerelease tags

  When auto-detecting version from git tags, the code now properly identifies and skips prerelease versions (canary, alpha, beta, rc, etc.) and finds the highest stable version by semantic versioning.

  Previously, adding a repository like Next.js would incorrectly pick a canary version (e.g., v16.2.0-canary.23) instead of the latest stable release (e.g., v16.1.6).

- bf8f350: Fix CLI `remove` command to accept package names with version suffix (e.g., `next@v16.2.0`). Previously, only the package name without version worked.
