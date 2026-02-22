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
│      version-check.ts          tag discovery     │
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
name: nextjs
registry: npm
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

  - min_version: "13.0.0"
    max_version: "15.0.0"         # exclusive
    source:
      type: git
      url: https://github.com/vercel/next.js
      docs_path: docs
      lang: en
    tag_pattern: "v{version}"

  - min_version: "9.0.0"
    max_version: "13.0.0"
    source:
      type: git
      # Older docs lived in a different repo
      url: https://github.com/vercel/next-site
      docs_path: docs/pages
      lang: en
    tag_pattern: "v{version}"
```

**Key design decisions:**
- `tag_pattern`: `{version}` is replaced with the semver (e.g., `"v{version}"` → `v15.2.0`). Supports monorepo patterns like `"nextjs@{version}"`.
- Version ranges use semver comparison. `min_version` inclusive, `max_version` exclusive.
- `source.type: git` is the only supported type initially. Can later add `url`, `script`, etc.
- `lang` defaults to `"en"` per existing behavior in `context add`.

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
    version-check.ts    # Discover versions from git tags
    version-check.test.ts
    build.ts            # Build .db from definition + version
    publish.ts          # Upload .db to server
    cli.ts              # CLI entry point for local testing
```

Dependencies: `yaml`, `zod` (already in workspace). Dev: `vitest`, `typescript`, `tsx`.

### 1.3 Registry Definition Parser (`definition.ts`)

Responsibilities:
- Parse and validate YAML definition files using Zod schemas
- Resolve which version entry matches a given version (first match wins, semver comparison)
- Construct git tag from `tag_pattern` + version string
- Reverse-parse: extract version from a git tag using `tag_pattern`
- List all definition files by scanning `registry/` directory

### 1.4 Version Discovery (`version-check.ts`)

For each definition file:
1. Clone the source repo (shallow, like `context add` does via `git.ts`)
2. List git tags via `git tag -l`
3. For each tag, try to extract a version using the `tag_pattern` (reversed)
4. Filter to versions within the defined ranges (`min_version` <= v < `max_version`)
5. Return list of `{ name, registry, version, tag }` tuples sorted by semver descending

### 1.5 Build from Definition (`build.ts`)

Given a definition + target version:
1. Find the matching version entry
2. Compute git tag via `tag_pattern`
3. Shell out to: `context add <git-url> --tag <tag> --name <name> --pkg-version <version> --path <docs_path> --lang <lang> --save <output-path>`
4. Return path to the built `.db` file

This delegates all build logic to `@neuledge/context` CLI, keeping the registry package as pure orchestration.

### 1.6 Publish to Server (`publish.ts`)

Simple HTTP client:
- Check existence: `GET <base-url>/packages/<registry>/<name>/<version>` → 200 (exists) or 404 (new)
- Upload: `POST <base-url>/packages/<registry>/<name>/<version>` with `.db` file body, `Authorization: Bearer <key>` header
- Base URL defaults to `https://api.context.neuledge.com/v1`, configurable via env var `REGISTRY_SERVER_URL`

### 1.7 Registry CLI (`cli.ts`)

Entry point for local testing and CI (not shipped to users):
- `registry list` — List all definitions in `registry/`, show name, registry, version ranges
- `registry check [name]` — Discover available versions for one or all packages
- `registry build <name> <version>` — Build a `.db` for a specific version
- `registry publish <name> <version>` — Build and publish (requires `REGISTRY_PUBLISH_KEY` env var)
- `registry publish-all` — Check all definitions, build and publish any missing versions (used by CI)

### 1.8 GitHub Actions Workflow

New file: `.github/workflows/registry-update.yml`

Triggers: weekly cron (Monday 6 AM UTC) + manual dispatch.

Steps:
1. Checkout, setup Node.js + pnpm, install deps, build
2. Run `pnpm --filter registry publish-all`
   - For each definition: discover versions → check server → build missing → publish
3. Uses `REGISTRY_PUBLISH_KEY` secret for auth

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
- Input: `{ registry: "npm" | "pip" | ..., name: string, version?: string }`
- Calls server search API
- Returns list of matching packages with name, version, description, size

**`download_package`**
- Input: `{ registry: string, name: string, version: string, server?: string }`
- Downloads `.db` from server
- Installs it (reuses existing `addFromUrl` logic)
- Updates the `get_docs` tool enum to include the new package
- Returns success/failure + package info

### 2.3 Dynamic Tool Registration

Currently `get_docs` is registered once at startup with a fixed library enum. After a download, we need to re-register or update the tool to include the new package. The MCP SDK may need investigation for how to handle dynamic tool updates.

### 2.4 Server Specification

Document the expected server API so others can implement compatible servers. The base URL is configurable (e.g., `https://api.context.neuledge.com/v1`). Endpoints are relative to the base URL:
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
| 1.4 | Version discovery from git tags (`version-check.ts`) | pending |
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
