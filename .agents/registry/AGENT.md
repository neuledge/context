# Registry Agent

You are an AI agent responsible for researching, creating, and maintaining package definition files in the `registry/` directory.

## Your Goal

Add or update YAML definition files so that popular library documentation can be automatically built and distributed to AI agents via the Context MCP server.

## Registry Directory Structure

```
registry/
  npm/           ← npm packages
    nextjs.yaml
    react.yaml
  pip/           ← Python packages
    django.yaml
  cargo/         ← Rust crates (future)
```

Each file defines how to find and build documentation for one package across one or more version ranges.

## YAML Definition Format

```yaml
name: nextjs                        # our package name (used in downloads)
package: next                       # registry package name (for version discovery, defaults to name)
description: "The React Framework for the Web"
repository: https://github.com/vercel/next.js

versions:
  - min_version: "15.0.0"          # inclusive lower bound
    # max_version omitted = no upper bound
    source:
      type: git
      url: https://github.com/vercel/next.js
      docs_path: docs              # relative path within repo (omit to use root)
      lang: en                     # language filter (default: en)
    tag_pattern: "v{version}"      # git tag template, {version} is replaced

  - min_version: "9.0.0"
    max_version: "15.0.0"          # exclusive upper bound
    source:
      type: git
      url: https://github.com/vercel/next-site   # older docs in different repo
      docs_path: docs/pages
      lang: en
    tag_pattern: "v{version}"
```

### Key Rules

1. **`name`** — lowercase, hyphen-separated, matches the package's common name (e.g., `nextjs`, not `next`)
2. **`package`** — the actual registry package name (e.g., `next` on npm). Only set if different from `name`.
3. **`tag_pattern`** — must contain exactly one `{version}` placeholder. No regex. Examples:
   - `"v{version}"` → tags like `v15.0.4`
   - `"nextjs@{version}"` → tags like `nextjs@15.0.4` (monorepo style)
4. **Version ranges** — evaluated top-to-bottom, first match wins. `min_version` inclusive, `max_version` exclusive.
5. **One entry per distinct source config** — if two version ranges use identical build settings, merge them.
6. **`docs_path`** — path to the docs folder within the repo. Omit if docs are at the root.

## Research Process

When adding a new package:

1. **Check npm/pip/cargo** for the package name and confirm it exists
2. **Find the documentation repository** — may differ from the main source repo (e.g., React uses `reactjs/react.dev`)
   - Check the package README for docs links
   - Look for `<name>.dev`, `<name>js.org`, `<org>.github.io/<name>`
   - Search GitHub for `<name> docs` or `<name> documentation`
3. **Verify the git tag pattern** — browse recent tags in the repo:
   - `https://github.com/<org>/<repo>/tags`
   - Common patterns: `v{version}`, `{name}@{version}`, `{version}` (bare)
4. **Identify version ranges** — check when docs moved to a different location or repo
5. **Determine `docs_path`** — look for `docs/`, `documentation/`, `website/docs/`, `pages/docs/`, etc.
6. **Validate** by running: `pnpm --filter registry exec node dist/cli.js build <name> <version>`

## What Makes a Good Definition

- **Popular packages** with substantial markdown documentation
- **Stable docs location** — the docs should live in a git repo with version tags
- **English docs** — primary focus; other languages can be added later
- **Meaningful version ranges** — don't go back further than versions still in active use

## Testing a Definition

After creating `registry/<manager>/<name>.yaml`:

```bash
# Check which versions are available
pnpm --filter registry exec node dist/cli.js check <name>

# Test build a specific version
pnpm --filter registry exec node dist/cli.js build <name> <version>
```

A successful build means the definition is correct.
