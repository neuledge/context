# Download Server Support

Add server-backed package discovery and download to the Context MCP tool. This enables a community-driven package registry where YAML definition files in this repository describe how to build documentation packages, a weekly CI job builds and publishes them, and agents can search/download packages on demand.

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│  This Repository (open source)              │
│                                             │
│  registry/                                  │
│    npm/                                     │
│      nextjs.yaml                            │
│      react.yaml                             │
│    pip/                                     │
│      django.yaml                            │
│    ...                                      │
│                                             │
│  .github/workflows/                         │
│    registry-update.yml  (weekly cron)       │
│                                             │
│  packages/context/src/                      │
│    registry.ts          (definition parser) │
│    server.ts            (MCP tools)         │
└──────────────┬──────────────────────────────┘
               │ builds & publishes
               ▼
┌─────────────────────────────────────────────┐
│  Neuledge Server (external, not this repo)  │
│  - Stores .db packages                      │
│  - Search API                               │
│  - Download API                             │
└──────────────┬──────────────────────────────┘
               │ MCP tools query
               ▼
┌─────────────────────────────────────────────┐
│  AI Agent (via MCP)                         │
│  - search_packages(registry, name, version) │
│  - download_package(registry, name, version)│
│  - get_docs(library, topic)                 │
└─────────────────────────────────────────────┘
```

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

### 1.2 Registry Definition Parser

New file: `packages/context/src/registry.ts`

Responsibilities:
- Parse and validate YAML definition files using Zod schemas
- Resolve which version entry matches a given version
- Construct git tag from tag_pattern + version
- List all definition files in the registry directory

Schema (Zod):
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

### 1.3 Version Discovery Script

New file: `packages/context/src/version-check.ts`

For each definition file:
1. Clone the repo (shallow)
2. List git tags, filter by tag_pattern
3. Parse to get available versions
4. Filter to versions within the defined ranges
5. Return list of `{ name, registry, version }` tuples

This will be used by both the CI workflow and can be tested locally.

### 1.4 Build-from-Definition Script

New file: `packages/context/src/registry-build.ts`

Given a definition file + target version:
1. Parse the definition YAML
2. Find the matching version entry
3. Clone the repo at the computed tag
4. Build the package using existing `buildPackage()`
5. Output the .db file to a specified path

This reuses the existing build pipeline (`git.ts` + `package-builder.ts`), which is already flexible enough for the initial version.

### 1.5 CLI Commands

Add to `cli.ts`:
- `context registry list` — List all package definitions in registry/
- `context registry check <name>` — Check for new versions of a specific package
- `context registry build <name> <version>` — Build a specific version from definition

These are primarily for local testing and debugging before CI runs.

### 1.6 GitHub Actions Workflow

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
      - For each definition file:
        - Discover new versions
        - For each new version:
          - Check if already published on Neuledge server (API call)
          - If not: build .db, publish to server (with REGISTRY_PUBLISH_KEY secret)
```

The publish step will use a simple HTTP API call (POST with the .db file + auth header). The server implementation is external, but we define the expected API contract:

**Publish API contract (what the workflow expects):**
- `GET /api/v1/packages/<registry>/<name>/<version>` → 200 if exists, 404 if not
- `POST /api/v1/packages/<registry>/<name>/<version>` → Upload .db file, requires `Authorization: Bearer <key>`

### 1.7 Example Definitions

Create 2-3 starter definitions to validate the format:
- `registry/npm/nextjs.yaml` — Complex example with multiple version ranges
- `registry/npm/react.yaml` — Simple single-range example

## Stage 2: MCP Download Server Integration

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

Add two new tools to the MCP server:

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
| 1.1 | Define YAML schema & create Zod validator (`registry.ts`) | pending |
| 1.2 | Version discovery: list available versions from git tags (`version-check.ts`) | pending |
| 1.3 | Build-from-definition: build .db from YAML + version (`registry-build.ts`) | pending |
| 1.4 | CLI commands: `registry list`, `registry check`, `registry build` | pending |
| 1.5 | GitHub Actions weekly workflow (`registry-update.yml`) | pending |
| 1.6 | Example definitions: nextjs, react | pending |
| 1.7 | Tests for registry parser, version discovery, build | pending |
| **Stage 2** | | |
| 2.1 | Server config management (`~/.context/config.json`) | pending |
| 2.2 | MCP `search_packages` tool | pending |
| 2.3 | MCP `download_package` tool | pending |
| 2.4 | Dynamic `get_docs` tool update after download | pending |
| 2.5 | Server API specification document | pending |
