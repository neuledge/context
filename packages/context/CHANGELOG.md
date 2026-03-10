# @neuledge/context

## 0.5.0

### Minor Changes

- [#42](https://github.com/neuledge/context/pull/42) [`dc6f246`](https://github.com/neuledge/context/commit/dc6f24608a817531fbc116f1c7c11d4c1128b5f5) Thanks [@moshest](https://github.com/moshest)! - Add HTML document parsing support (.html, .htm files) using turndown for HTML-to-Markdown conversion

## 0.4.0

### Minor Changes

- 878e126: Add HTTP server transport support via `context serve --http`, enabling multiple clients on the network to connect to a single MCP server instance using the Streamable HTTP protocol

## 0.3.0

### Minor Changes

- 173409c: Add MCP tools for searching and downloading documentation packages from registry servers. New `search_packages` and `download_package` tools allow AI agents to discover and install pre-built documentation packages. Downloaded packages are automatically available via the `get_docs` tool.
- 2e376ff: Add native support for AsciiDoc (.adoc) and reStructuredText (.rst) documentation formats, alongside existing Markdown support. This enables indexing docs from frameworks like Spring Boot, Django, JUnit, and others that don't use Markdown.

## 0.2.3

### Patch Changes

- Add mcpName field for Official MCP Registry listing

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
