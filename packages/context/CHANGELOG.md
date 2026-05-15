# @neuledge/context

## 1.1.0

### Minor Changes

- [#85](https://github.com/neuledge/context/pull/85) [`1d0a5f6`](https://github.com/neuledge/context/commit/1d0a5f67eab9590f5b8c9d92513c7bc7bc30b66a) Thanks [@moshest](https://github.com/moshest)! - Add `--libs` option to `context serve` for restricting an MCP session to a fixed subset of installed libraries. Each entry can be a name (`react`) or `name@version` (`react@18.3.1`). When set, `search_packages` and `download_package` are hidden so the session is locked to that list — useful for per-project scoping when many packages are installed globally.

## 1.0.1

### Patch Changes

- [#80](https://github.com/neuledge/context/pull/80) [`b5dd83b`](https://github.com/neuledge/context/commit/b5dd83b453ce861ebc516ae915c847f385d6c0d3) Thanks [@moshest](https://github.com/moshest)! - Install `git` in the Docker runtime image so cloning GitHub URLs works out of the box (fixes `Git clone failed: /bin/sh: 1: git: not found`).

## 1.0.0

### Major Changes

- [#76](https://github.com/neuledge/context/pull/76) [`eb7d01c`](https://github.com/neuledge/context/commit/eb7d01c4044b30707645af43cd3890c9c1e776d4) Thanks [@moshest](https://github.com/moshest)! - Release v1.0.0

## 0.9.0

### Minor Changes

- [#73](https://github.com/neuledge/context/pull/73) [`92f0a7d`](https://github.com/neuledge/context/commit/92f0a7d121cd92b8802aeaf5488f811c9e8f140d) Thanks [@shivaram19](https://github.com/shivaram19)! - Add support for ingesting arbitrary URLs when `llms.txt` is not found

  - `context add <url>` now falls back to fetching the page directly if `llms.txt` is unavailable, enabling ingestion of blog posts, articles, documentation pages, and raw markdown files
  - Added `suggestPackageNameFromUrl()` to derive meaningful package names from URL paths
  - Added `fetchWebPage()` helper with content-type detection and binary rejection
  - All HTTP fetches now include browser-like headers to bypass basic bot protection
  - Added per-platform authentication via `context auth add/list/remove` for accessing subscriber-only content with cookies
  - Auth is stored in `~/.context/auth.json` and matched by domain (with parent-domain fallback for subdomains)

### Patch Changes

- [#75](https://github.com/neuledge/context/pull/75) [`85f787c`](https://github.com/neuledge/context/commit/85f787cad34bb51e120de63780eac1c360f8cc6d) Thanks [@moshest](https://github.com/moshest)! - Use `defuddle` for HTML article extraction when ingesting arbitrary URLs.

  Previously, `context add <url>` passed raw HTML (minus a few stripped tags) to the Markdown pipeline, which left site clutter — subscribe CTAs, related posts, comment widgets — in the final package on platforms like Substack and Medium. The HTML branch now runs through `defuddle` to produce clean Markdown before packaging, and the extracted article title is available for future manifest enrichment.

## 0.8.1

### Patch Changes

- [#70](https://github.com/neuledge/context/pull/70) [`5297843`](https://github.com/neuledge/context/commit/529784333baa75c3e74e5c7af57ca0a451e99bb3) Thanks [@moshest](https://github.com/moshest)! - Fix `context add` failing on branch refs (e.g. `/tree/heartbeat`) with a
  cryptic `Command failed: git checkout ... 2>/dev/null` error. The URL ref
  is now passed directly to `git clone --branch`, avoiding the broken
  post-clone checkout path on shallow clones. When `checkoutRef` still runs
  (e.g. `--tag` or interactive selection), it now falls back to
  `FETCH_HEAD` for branches and surfaces git's real stderr in thrown errors
  instead of suppressing it.

## 0.8.0

### Minor Changes

- [#66](https://github.com/neuledge/context/pull/66) [`37350b7`](https://github.com/neuledge/context/commit/37350b7d1d5b310ff051329e54b03a8d63af9681) Thanks [@moshest](https://github.com/moshest)! - `context add <website>` now follows the markdown links inside an `llms.txt`
  index and fetches each linked document, instead of treating the index as the
  final content. This produces packages with the full documentation rather than
  just the table of contents. `llms-full.txt` is unchanged. Cross-origin links
  are skipped by default.

### Patch Changes

- [#65](https://github.com/neuledge/context/pull/65) [`224b62d`](https://github.com/neuledge/context/commit/224b62db0676eccf735ede7e02319dc718e95075) Thanks [@moshest](https://github.com/moshest)! - Fix `context install` to accept the `registry/name@version` shorthand (e.g., `context install npm/next@16.1.7`). Previously the `@version` suffix was treated as part of the package name, causing the install to fail with "No packages found". Scoped packages like `npm/@trpc/server@10.0.0` are also handled correctly.

## 0.7.0

### Minor Changes

- [#58](https://github.com/neuledge/context/pull/58) [`15a1128`](https://github.com/neuledge/context/commit/15a11282b929aad9722532b15ec2e056b9a8c70b) Thanks [@moshest](https://github.com/moshest)! - Support fetching documentation from websites via llms.txt files. When adding a website URL (e.g., `context add https://react-aria.adobe.com`), automatically tries to fetch `llms-full.txt` then `llms.txt` from the site root.

## 0.6.0

### Minor Changes

- [#56](https://github.com/neuledge/context/pull/56) [`e005274`](https://github.com/neuledge/context/commit/e005274b6baec438836c856a086b04a94565a149) Thanks [@moshest](https://github.com/moshest)! - Add sql.js (WebAssembly) fallback when better-sqlite3 native binaries are unavailable, fixing installation failures on Windows with newer Node.js versions

### Patch Changes

- [#53](https://github.com/neuledge/context/pull/53) [`08991be`](https://github.com/neuledge/context/commit/08991be4fd38506d385de2143106a2586c566b38) Thanks [@MaeuRodrig](https://github.com/MaeuRodrig)! - Update README with OpenCode context setup

## 0.5.1

### Patch Changes

- [#47](https://github.com/neuledge/context/pull/47) [`5907850`](https://github.com/neuledge/context/commit/59078502ee8a226d525db43bc18d65a02e14695a) Thanks [@notanobject](https://github.com/notanobject)! - Improve MCP guidance for concise `get_docs` queries and the registry-first install workflow. Fix scoped package installs (e.g., `@tanstack/react-query`) by sanitizing `/` in filenames.

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
