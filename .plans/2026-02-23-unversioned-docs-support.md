# Support Unversioned Documentation Sources

## Problem

The current registry system assumes all documentation is versioned — each YAML definition requires a `versions` array with semver ranges and `tag_pattern` to map npm/pip versions to git tags. This works for libraries like Next.js or React where docs live alongside code with proper version tags.

However, many libraries keep documentation in separate repos with **no version tags**:

- `drizzle-orm` → docs in `drizzle-team/drizzle-orm-docs` (no tags)
- `tailwindcss` → docs in `tailwindlabs/tailwindcss.com` (no version tags)
- Many others follow this pattern

These libraries can't be defined with the current YAML format because there are no git tags to map versions to, and no way to express "just use the default branch."

## Design

### Core Idea

Support two kinds of definitions:

1. **Versioned** (current) — `versions` array with semver ranges, tag patterns, registry API discovery
2. **Unversioned** (new) — top-level `source` field, no version ranges, always builds from default branch with version label `"latest"`

### YAML Format

Unversioned definitions use a top-level `source` instead of `versions`:

```yaml
# registry/npm/drizzle-orm.yaml
name: drizzle-orm
description: "TypeScript ORM that lets you write SQL in TypeScript"
repository: https://github.com/drizzle-team/drizzle-orm

source:
  type: git
  url: https://github.com/drizzle-team/drizzle-orm-docs
  docs_path: src/content/docs
```

Versus the existing versioned format:

```yaml
# registry/npm/next.yaml
name: next
description: "The React Framework for the Web"
repository: https://github.com/vercel/next.js

versions:
  - min_version: "15.0.0"
    source:
      type: git
      url: https://github.com/vercel/next.js
      docs_path: docs
    tag_pattern: "v{version}"
```

A definition has **either** `versions` **or** `source`, never both. The Zod schema enforces this.

### Version Labeling

Unversioned packages use `"latest"` as their version string everywhere:
- DB metadata: `version = "latest"`
- Server path: `/packages/npm/drizzle-orm/latest`
- MCP tool: `drizzle-orm@latest`
- File naming: `npm-drizzle-orm@latest.db`

### Skip-if-unchanged via `source_commit`

To avoid rebuilding unversioned packages when nothing changed:

1. **`git ls-remote`** — Before building, run `git ls-remote <url> HEAD` to get the current commit SHA. This is a single HTTP call, no clone needed.
2. **Store commit in DB metadata** — `buildUnversioned()` stores the commit SHA as `source_commit` in the `.db` meta table.
3. **Server check** — During `publish-all`, the CI job checks the server for the existing package's `source_commit`. If it matches the current HEAD SHA, skip the build entirely.
4. **Force rebuild** — A `--force` flag on `publish-all` bypasses the check.

This means the weekly CI job for unversioned packages does:
```
for each unversioned definition:
  sha = git ls-remote <url> HEAD
  server_sha = GET /packages/<registry>/<name>/latest → source_commit
  if sha == server_sha → skip
  else → clone, build, publish (with source_commit=sha)
```

The `source_commit` field is also useful for versioned packages (tracking exactly which commit was built), but is only *required* for the skip-if-unchanged optimization on unversioned ones.

### What Changes

**`definition.ts`** — Schema and types:
- Make `versions` optional
- Add optional top-level `source` field
- Add Zod refinement: must have exactly one of `versions` or `source`
- Export discriminated type: `PackageDefinition` = `VersionedDefinition | UnversionedDefinition`
- Add `isVersioned(def)` type guard

**`version-check.ts`** — Version discovery:
- `discoverVersions()` returns `[{ name, registry, version: "latest" }]` for unversioned definitions (no registry API call needed)
- Versioned path unchanged

**`build.ts`** — Build pipeline:
- Add `buildUnversioned(definition, outputDir)` that clones default branch, reads docs, builds DB with version `"latest"`
- Store `source_commit` (HEAD SHA from cloned repo) in DB metadata
- Add `getHeadCommit(url)` helper using `git ls-remote`

**`cli.ts`** (registry) — CLI commands:
- `registry list` — show `(unversioned)` for unversioned definitions
- `registry check` — show `latest (unversioned)` for unversioned definitions
- `registry build <name> [version]` — make version optional; for unversioned, default to `"latest"`

**`packages/context/src/package-builder.ts`** — Add optional `sourceCommit` to `PackageBuildOptions`

**`.agents/registry/AGENT.md`** — Update agent instructions with unversioned format

**Tests** — Add test cases for unversioned definitions in definition.test.ts, version-check.test.ts

### What Doesn't Change

- `packages/context/` MCP server, search, store — no changes needed. It already handles `version: "latest"` in DB metadata, MCP tools, etc.
- Server API endpoints — `latest` is a valid version string
- DB schema shape — unchanged, `source_commit` is just another meta key
- `SourceSchema` — reused as-is for both versioned entries and unversioned top-level

---

## Progress

| # | Task | Status |
|---|------|--------|
| 1 | Update `definition.ts`: schema, types, `isVersioned()` helper | done |
| 2 | Update `definition.test.ts`: unversioned parsing, validation | done |
| 3 | Update `version-check.ts`: handle unversioned definitions | done |
| 4 | Update `version-check.test.ts`: unversioned test cases | done |
| 5 | Update `build.ts`: support building unversioned packages | done |
| 6 | Update `cli.ts` (registry): handle unversioned in list/check/build | done |
| 7 | Update `.agents/registry/AGENT.md` with unversioned format | done |
| 8 | Add `getHeadCommit()` + store `source_commit` in build | done |
| 9 | Add `sourceCommit` to `PackageBuildOptions` in package-builder.ts | done |
| 10 | Add example: `registry/npm/drizzle-orm.yaml` | done |
| 11 | Update plan `2026-02-21-download-server-support.md` section 1.1 | done |
| 12 | Run lint, build, tests — verify everything passes | done |
