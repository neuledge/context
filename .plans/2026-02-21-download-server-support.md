# Download Server Support

Add server-backed package discovery and download to the Context MCP tool. This enables a community-driven package registry where YAML definition files in this repository describe how to build documentation packages, a weekly CI job builds and publishes them, and agents can search/download packages on demand.

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

**Key separation:** `packages/registry/` is a **private** workspace package (not published to npm). It depends on `@neuledge/context` and handles all registry infrastructure: parsing YAML definitions, discovering versions, building .db files (by shelling out to `context add`), and publishing to the server. The `@neuledge/context` package stays unchanged — it's the user-facing tool.

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
- `tag_pattern`: Describes how to construct the git tag from a version string. `{version}` is replaced with the semver (e.g., `"v{version}"` → `v15.2.0`). Supports monorepo patterns like `"nextjs@{version}"`.
- Version ranges use semver comparison. `min_version` inclusive, `max_version` exclusive.
- `source.type: git` is the only supported type initially. Can later add `url` (direct download), `script` (custom build), etc.
- `lang` defaults to `"en"` per existing behavior.

### 1.2 Private `packages/registry/` Package

New workspace package: `packages/registry/` with `"private": true`.

```
packages/registry/
  package.json          # private, depends on @neuledge/context
  tsconfig.json
  src/
    definition.ts       # Zod schema + YAML parser
    definition.test.ts
    version-check.ts    # Discover versions from git tags
    version-check.test.ts
    build.ts            # Build .db from definition + version
    publish.ts          # Upload .db to server
    cli.ts              # CLI entry point for local testing
```

It uses the `context` CLI as a child process (or imports `buildPackage` and git helpers directly from `@neuledge/context`) to generate .db files. The registry package orchestrates: which repo, which tag, which docs path — then delegates the actual build.

### 1.3 Registry Definition Parser (`definition.ts`)

Responsibilities:
- Parse and validate YAML definition files using Zod schemas
- Resolve which version entry matches a given version
- Construct git tag from tag_pattern + version
- List all definition files in the `registry/` directory

Zod schema:
```typescript
const SourceSchema = z.object({
  type: z.literal("git"),
  url: z.string().url(),
  docs_path: z.string().optional(),
  lang: z.string().default("en"),
});

const VersionEntrySchema = z.object({
  min_version: z.string(),
  max_version: z.string().optional(),
  source: SourceSchema,
  tag_pattern: z.string().default("v{version}"),
});

const PackageDefinitionSchema = z.object({
  name: z.string(),
  registry: z.string(),  // npm, pip, cargo, etc.
  description: z.string().optional(),
  repository: z.string().url().optional(),
  versions: z.array(VersionEntrySchema).min(1),
});
```

### 1.4 Version Discovery (`version-check.ts`)

For each definition file:
1. Clone the repo (shallow)
2. List git tags, filter by `tag_pattern` (reverse the pattern to extract versions)
3. Parse to get available versions
4. Filter to versions within the defined ranges
5. Return list of `{ name, registry, version }` tuples

### 1.5 Build from Definition (`build.ts`)

Given a definition file + target version:
1. Parse the definition YAML
2. Find the matching version entry (first range that contains the version)
3. Compute git tag via `tag_pattern`
4. Shell out to `context add <git-url> --tag <tag> --name <name> --pkg-version <version> --path <docs_path> --lang <lang> --save <output-path>`
5. Output the .db file

This approach keeps the build logic in `@neuledge/context` where it belongs. The registry package is just orchestration.

### 1.6 Publish to Server (`publish.ts`)

Simple HTTP client:
- Check if version exists: `GET /api/v1/packages/<registry>/<name>/<version>` → 200 or 404
- Upload: `POST /api/v1/packages/<registry>/<name>/<version>` with `.db` file body and `Authorization: Bearer <key>` header

### 1.7 Registry CLI (`cli.ts`)

Entry point for local testing (not shipped to users):
- `registry list` — List all definitions in `registry/`
- `registry check [name]` — Discover available versions for one or all packages
- `registry build <name> <version>` — Build a .db for a specific version
- `registry publish <name> <version>` — Build and publish (requires key)

### 1.8 GitHub Actions Workflow

New file: `.github/workflows/registry-update.yml`

```yaml
on:
  schedule:
    - cron: '0 6 * * 1'  # Weekly on Monday at 6 AM UTC
  workflow_dispatch:       # Allow manual trigger

jobs:
  check-and-build:
    runs-on: ubuntu-latest
    steps:
      - Checkout this repo
      - Setup Node.js + pnpm
      - Install dependencies & build
      - Run: pnpm --filter registry check  # find new versions
      - For each new version:
        - Check if already published (API call)
        - If not: build .db, publish to server
    env:
      REGISTRY_PUBLISH_KEY: ${{ secrets.REGISTRY_PUBLISH_KEY }}
```

### 1.9 Example Definitions

Create 2-3 starter definitions to validate the format:
- `registry/npm/nextjs.yaml` — Complex example with multiple version ranges
- `registry/npm/react.yaml` — Simple single-range example

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
- Downloads .db from server
- Installs it (reuses existing `addFromUrl` logic)
- Updates the `get_docs` tool enum to include the new package
- Returns success/failure + package info

### 2.3 Dynamic Tool Registration

Currently `get_docs` is registered once at startup with a fixed library enum. After a download, we need to re-register or update the tool to include the new package. The MCP SDK may need investigation for how to handle dynamic tool updates.

### 2.4 Server Specification

Document the expected server API so others can implement compatible servers:
- `GET /api/v1/search?registry=<r>&name=<n>&version=<v>` — Search packages
- `GET /api/v1/packages/<registry>/<name>/<version>` — Check existence / get metadata
- `GET /api/v1/packages/<registry>/<name>/<version>/download` — Download .db file
- `POST /api/v1/packages/<registry>/<name>/<version>` — Publish (authenticated)

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
| 1.10 | Tests for parser, version discovery, build | pending |
| **Stage 2** | | |
| 2.1 | Server config management (`~/.context/config.json`) | pending |
| 2.2 | MCP `search_packages` tool | pending |
| 2.3 | MCP `download_package` tool | pending |
| 2.4 | Dynamic `get_docs` tool update after download | pending |
| 2.5 | Server API specification document | pending |
