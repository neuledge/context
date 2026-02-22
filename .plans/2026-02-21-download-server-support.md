# Download Server Support

## Background

### What is Context?

Context (`@neuledge/context`) is an open-source MCP (Model Context Protocol) server that gives AI agents instant access to up-to-date library documentation. It works locally and offline — no cloud calls during operation.

**How it works today:**
1. A user runs `context add <git-repo-or-url>` to index documentation from a git repository, local directory, or pre-built `.db` file
2. The CLI clones the repo, parses markdown/MDX files, chunks them by H2 sections, deduplicates, and stores everything in a SQLite database with FTS5 full-text search
3. The `.db` file is saved to `~/.context/packages/`
4. When an AI agent connects via MCP, it gets a `get_docs` tool that searches installed packages by keyword
5. Results are relevance-ranked (BM25), token-budgeted (2000 tokens max), and grouped by document

**The problem:** Users must manually find, clone, and build documentation packages. There's no way to discover or download pre-built packages. Every user rebuilds the same docs from scratch.

### What this plan adds

A **community-driven package registry** so pre-built documentation packages can be:
- **Defined** via YAML files in this repository (anyone can submit a PR)
- **Built automatically** by a weekly CI job
- **Published** to the Neuledge server (free hosting)
- **Discovered and downloaded** by AI agents via new MCP tools

### Repository structure (current)

```
/
├── packages/context/           ← published npm package (@neuledge/context)
│   ├── src/
│   │   ├── cli.ts              ← CLI: add, list, remove, serve, query
│   │   ├── server.ts           ← MCP server with get_docs tool
│   │   ├── build.ts            ← markdown parsing & chunking
│   │   ├── package-builder.ts  ← creates SQLite .db from parsed sections
│   │   ├── search.ts           ← FTS5 search with BM25 scoring
│   │   ├── store.ts            ← in-memory package registry
│   │   ├── git.ts              ← git clone, tag parsing, docs detection
│   │   └── db.ts               ← SQLite schema validation helpers
│   └── package.json            ← @neuledge/context, published to npm
├── .github/workflows/ci.yml   ← lint, build, test on push/PR
├── pnpm-workspace.yaml         ← workspace: packages/*
└── package.json                ← root, private monorepo
```

### Key technical details

- **Database format:** SQLite with tables `meta` (name, version, description, source_url), `chunks` (doc_path, doc_title, section_title, content, tokens, has_code), and `chunks_fts` (FTS5 virtual table with porter stemming)
- **Chunking:** Splits on H2 headings, target 800 tokens/chunk, hard limit 1200, deduplicates by MD5 hash
- **CLI `add` command** already supports: git repos (clone + tag checkout + docs detection), URLs (download .db), local dirs, local files. It accepts `--tag`, `--name`, `--pkg-version`, `--path`, `--lang`, `--save` options
- **Git tag handling:** `git.ts` has `fetchTagsWithMetadata()`, `parseMonorepoTag()`, `sortTagsForSelection()`, version extraction from tags via semver parsing
- **Workspace:** pnpm monorepo with turbo. Only `packages/context/` exists currently

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│  This Repository (open source)                   │
│                                                  │
│  registry/                   ← YAML definitions  │
│    npm/                        (community PRs)   │
│      nextjs.yaml                                 │
│      react.yaml                                  │
│    pip/                                          │
│      django.yaml                                 │
│                                                  │
│  packages/registry/          ← private package   │
│    src/                        (repo infra only)  │
│      definition.ts             schema + parser   │
│      version-check.ts          registry queries  │
│      build.ts                  build from def    │
│      publish.ts                server upload     │
│      cli.ts                    local testing     │
│                                                  │
│  packages/context/           ← published package │
│    src/                        (npm: @neuledge/   │
│      server.ts                  context)         │
│      ...                                         │
│                                                  │
│  .agents/registry/           ← AI agent config   │
│    AGENT.md                    for researching   │
│                                 & building defs  │
│                                                  │
│  .github/workflows/                              │
│    registry-update.yml       ← weekly cron       │
└──────────────┬───────────────────────────────────┘
               │ builds .db using `context add`
               │ then publishes to server
               ▼
┌──────────────────────────────────────────────────┐
│  Neuledge Server (external, not this repo)       │
│  - Stores .db packages                           │
│  - Search API                                    │
│  - Download API                                  │
└──────────────┬───────────────────────────────────┘
               │ MCP tools query
               ▼
┌──────────────────────────────────────────────────┐
│  AI Agent (via MCP)                              │
│  - search_packages(registry, name, version)      │
│  - download_package(registry, name, version)     │
│  - get_docs(library, topic)                      │
└──────────────────────────────────────────────────┘
```

**Key separation:**

- `packages/context/` — The published npm package. User-facing. Handles MCP serving, local doc building, searching. Unchanged in Stage 1.
- `packages/registry/` — Private workspace package (never published). Repo infrastructure only. Parses YAML definitions, discovers versions, orchestrates builds by shelling out to `context add`, publishes to server.
- `registry/` — Top-level directory with YAML definition files organized by package manager. This is where the community contributes via PRs.
- `.agents/registry/` — AI agent instructions for researching packages and creating/maintaining definition files.

---

## Stage 1: Package Registry Definitions & Build Pipeline

### 1.1 Package Definition Format (YAML)

Location: `registry/<manager>/<package-name>.yaml`

Organizing by package manager prevents naming conflicts (e.g., `registry/npm/react.yaml` vs `registry/pip/react.yaml`).

```yaml
# registry/npm/nextjs.yaml
name: nextjs                       # our package name (used in downloads)
package: next                      # npm registry package name (for version discovery)
description: "The React Framework for the Web"
repository: https://github.com/vercel/next.js

# Each entry covers a version range with specific build instructions.
# Ranges are evaluated top-to-bottom; the first match wins.
# A version matches if: min_version <= version (< max_version if set).
versions:
  - min_version: "15.0.0"        # inclusive
    # max_version omitted = no upper bound (current/latest)
    source:
      type: git
      url: https://github.com/vercel/next.js
      docs_path: docs             # relative path within repo
      lang: en                    # language filter (default: en)
    tag_pattern: "v{version}"     # how git tags map to versions

  - min_version: "9.0.0"
    max_version: "15.0.0"         # exclusive
    source:
      type: git
      # Older docs lived in a different repo
      url: https://github.com/vercel/next-site
      docs_path: docs/pages
      lang: en
    tag_pattern: "v{version}"
```

**Key design decisions:**
- **No `registry` field in YAML** — derived from directory path (`registry/npm/nextjs.yaml` → `npm`). The parser enforces this.
- **`package` field** — the registry package name (e.g., `next` on npm) used for version discovery. May differ from `name` (our internal name). If omitted, defaults to `name`.
- **`tag_pattern`**: A literal string template with a single `{version}` placeholder. To construct a tag: replace `{version}` with the semver string. To extract a version: split on the literal prefix/suffix around `{version}`. No regex — the prefix and suffix are fixed strings. Examples: `"v{version}"` → prefix `v`, no suffix. `"nextjs@{version}"` → prefix `nextjs@`, no suffix.
- Version ranges use semver comparison. `min_version` inclusive, `max_version` exclusive.
- `source.type: git` is the only supported type initially. Can later add `url`, `script`, etc.
- `lang` defaults to `"en"` per existing behavior in `context add`.
- Each version range entry should have **distinct build instructions** (different URL, docs_path, or lang). If two entries have identical source config, merge them into one range.

### 1.2 Private `packages/registry/` Package

New workspace package with `"private": true` (already included by `pnpm-workspace.yaml`'s `packages/*` glob).

```
packages/registry/
  package.json          # private, depends on @neuledge/context
  tsconfig.json
  tsconfig.build.json
  src/
    definition.ts       # Zod schema + YAML parser
    definition.test.ts
    version-check.ts    # Discover versions from registry APIs (npm, pip)
    version-check.test.ts
    build.ts            # Build .db from definition + version
    publish.ts          # Upload .db to server
    cli.ts              # CLI entry point for local testing
```

Note: `turbo.json` needs no changes — it uses task-based config that applies to all workspace packages automatically.

Dependencies: `yaml`, `zod` (already in workspace). Dev: `vitest`, `typescript`, `tsx`.

### 1.3 Registry Definition Parser (`definition.ts`)

Responsibilities:
- Parse and validate YAML definition files using Zod schemas
- Derive `registry` from the file's parent directory name (e.g., `registry/npm/nextjs.yaml` → `npm`)
- Resolve which version entry matches a given version (first match wins, semver comparison)
- Construct git tag from `tag_pattern` + version string (simple string replace of `{version}`)
- List all definition files by scanning `registry/` directory

### 1.4 Version Discovery (`version-check.ts`)

Discovers available versions by querying **package registry APIs** (not git tags). This is faster, doesn't require cloning, and gives the canonical version list.

For each definition file:
1. Query the package registry for available versions:
   - **npm**: `GET https://registry.npmjs.org/<package>` → response includes `versions` object and `time` object with publish dates
   - **pip**: `GET https://pypi.org/pypi/<package>/json` → response includes `releases` object
   - Other registries can be added later with the same pattern
2. The `package` field from the YAML definition provides the registry package name (e.g., `next` for npm, `django` for pip)
3. Filter versions to those within at least one defined range (`min_version` <= v < `max_version`)
4. Filter out prereleases (alpha, beta, rc, canary, etc.)
5. Apply version limit: only keep the **latest patch per minor version** (e.g., for 15.0.x keep only 15.0.4, for 15.1.x keep only 15.1.3). This prevents building hundreds of patch releases
6. Return list of `{ name, registry, version }` tuples sorted by semver descending

**Why registry APIs instead of git tags:**
- No cloning required — fast HTTP call vs shallow git clone
- Gives us publish dates (useful for "recent versions only" in CI)
- Canonical version list (git tags may include non-release tags)
- Works even when git tag patterns are complex or inconsistent

### 1.5 Build from Definition (`build.ts`)

Imports build functions directly from `@neuledge/context` (workspace dependency) rather than shelling out to the CLI. This is simpler, avoids needing the binary on PATH, and gives typed access to results.

Given a definition + target version:
1. Find the matching version entry
2. Compute git tag via `tag_pattern`
3. Call `cloneRepository(url, tag)` from `@neuledge/context/git`
4. Call `readLocalDocsFiles(tempDir, { path: docs_path, lang })` from `@neuledge/context/git`
5. Call `buildPackage(outputPath, files, { name, version, sourceUrl })` from `@neuledge/context/package-builder`
6. Clean up temp dir, return path to the built `.db` file

### 1.6 Publish to Server (`publish.ts`)

Simple HTTP client:
- Check existence: `GET <base-url>/packages/<registry>/<name>/<version>` → 200 (exists) or 404 (new)
- Upload: `POST <base-url>/packages/<registry>/<name>/<version>` with `.db` file body, `Authorization: Bearer <key>` header
- Base URL defaults to `https://context.neuledge.com`, configurable via env var `REGISTRY_SERVER_URL`

### 1.7 Registry CLI (`cli.ts`)

Entry point for local testing and CI (not shipped to users):
- `registry list` — List all definitions in `registry/`, show name, registry, version ranges
- `registry check [name]` — Discover available versions for one or all packages
- `registry build <name> <version>` — Build a `.db` for a specific version
- `registry publish <name> <version>` — Build and publish (requires `REGISTRY_PUBLISH_KEY` env var)
- `registry publish-all [--since <days>]` — Check all definitions, build and publish missing versions (used by CI). `--since` limits to versions published on the registry in the last N days (default: 7)

### 1.8 GitHub Actions Workflow

New file: `.github/workflows/registry-update.yml`

Triggers: weekly cron (Monday 6 AM UTC) + manual dispatch.

Steps:
1. Checkout, setup Node.js + pnpm, install deps, build
2. Run `pnpm --filter registry publish-all --since 7`
   - For each definition: query registry for versions published in the last 7 days → filter to defined ranges → check if already on server → build missing → publish
   - This avoids scanning all historical versions — only new releases are processed
3. Uses `REGISTRY_PUBLISH_KEY` secret for auth

**Error handling and scalability:**
- If building one package/version fails, log the error with package name + version + error message, then continue with remaining packages
- At the end, print a summary: N succeeded, M failed (with list of failures)
- Exit with non-zero status if any package failed (so the workflow shows as failed)
- GitHub Actions will notify on workflow failure via existing repo notification settings

**Initial seeding vs. ongoing updates:**
- The weekly cron (`--since 7`) handles ongoing updates — only new releases
- For initial population when a new definition is added, run `registry publish-all` without `--since` (manual dispatch). This builds all versions matching the defined ranges (latest patch per minor)
- Manual dispatch via GitHub Actions UI supports an optional `since` input parameter — leave empty to seed all versions, or set to N days for a targeted backfill

### 1.9 Example Definitions

Starter definitions to validate the format:
- `registry/npm/nextjs.yaml` — Multiple version ranges, docs in main repo
- `registry/npm/react.yaml` — Docs in separate repo (reactjs/react.dev)

### 1.10 AI Agent for Registry Maintenance (`.agents/registry/`)

An AI agent definition (markdown) that can:
- Research popular packages across registries (npm, pip, cargo, etc.)
- Find the correct documentation repository for each package
- Determine git tag patterns and version ranges
- Generate valid YAML definition files
- Validate definitions against the Zod schema
- Test-build a version to verify the definition works

---

## Stage 2: MCP Download Server Integration

_(Lives in `packages/context/` — this IS user-facing)_

### 2.1 Server Configuration

Support multiple download servers. Default is Neuledge.

Configuration stored in `~/.context/config.json`:
```json
{
  "servers": [
    {
      "name": "neuledge",
      "url": "https://context.neuledge.com",
      "default": true
    }
  ]
}
```

### 2.2 MCP Tools

Add two new tools to the MCP server in `packages/context/src/server.ts`:

**`search_packages`**
- Input: `{ registry: string, name: string, version?: string }`
- `registry` is a free-form string (e.g., `"npm"`, `"pip"`) — the tool cannot enumerate all valid registries at registration time
- Calls server search API
- Returns list of matching packages with name, version, description, size
- When `version` is omitted, the server returns all available versions (sorted by semver descending)

**`download_package`**
- Input: `{ registry: string, name: string, version: string, server?: string }`
- Downloads `.db` from server
- Installs it (reuses existing `addFromUrl` logic)
- Updates the `get_docs` tool enum to include the new package
- Returns success/failure + package info

### 2.3 Dynamic Tool Registration

Currently `get_docs` is registered once at startup with a fixed library enum. After a download, we need to re-register or update the tool to include the new package. The MCP SDK may need investigation for how to handle dynamic tool updates.

### 2.4 Server Specification

Document the expected server API so others can implement compatible servers. The base URL is configurable (default: `https://context.neuledge.com`). Endpoints are relative to the base URL:
- `GET /search?registry=<r>&name=<n>&version=<v>` — Search packages
- `GET /packages/<registry>/<name>/<version>` — Check existence / get metadata
- `GET /packages/<registry>/<name>/<version>/download` — Download .db file
- `POST /packages/<registry>/<name>/<version>` — Publish (authenticated)

---

## Out of Scope

These are handled separately, not in this repository:
- Neuledge server implementation (hosting, API, database)
- Neuledge website updates
- Payment / rate limiting infrastructure

---

## Progress

| # | Task | Status |
|---|------|--------|
| **Stage 1** | | |
| 1.1 | YAML definition format spec | done |
| 1.2 | Create `packages/registry/` private workspace package | pending |
| 1.3 | Definition parser with Zod schema (`definition.ts`) | pending |
| 1.4 | Version discovery from registry APIs (`version-check.ts`) | pending |
| 1.5 | Build-from-definition via `context add` (`build.ts`) | pending |
| 1.6 | Publish client (`publish.ts`) | pending |
| 1.7 | Registry CLI for local testing (`cli.ts`) | pending |
| 1.8 | GitHub Actions weekly workflow (`registry-update.yml`) | pending |
| 1.9 | Example definitions: nextjs, react | pending |
| 1.10 | AI agent for registry maintenance (`.agents/registry/`) | pending |
| 1.11 | Tests for parser, version discovery, build | pending |
| **Stage 2** | | |
| 2.1 | Server config management (`~/.context/config.json`) | pending |
| 2.2 | MCP `search_packages` tool | pending |
| 2.3 | MCP `download_package` tool | pending |
| 2.4 | Dynamic `get_docs` tool update after download | pending |
| 2.5 | Server API specification document | pending |
