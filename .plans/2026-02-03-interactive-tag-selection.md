# Interactive Tag Selection for Monorepo Support

## Problem
In monorepos like `vercel/ai`, automatic version detection picks the wrong package's version because tags are prefixed with package names (e.g., `ai@6.0.68`, `@ai-sdk/gateway@2.0.31`).

## Solution
Replace automatic detection with an interactive flow that lets users select tags and confirm package name/version.

## New CLI Options
```bash
context add <repo> [options]
  --tag <tag>         Git tag to checkout (skip interactive selection)
  --name <name>       Package name (skip confirmation)
  --version <version> Version label (skip confirmation)
```

## User Flow

### 1. Tag Selection
When `--tag` is NOT provided:
```
$ context add https://github.com/vercel/ai

Select a tag (or press Enter for HEAD):
❯ HEAD (current main branch)
  ai@6.0.68
  ai@6.0.67
  @ai-sdk/openai@1.2.3
  ai@6.0.66
  ...
  ↓ 95 more tags
```

**Sorting logic:**
1. `HEAD` (main/master) always first
2. Stable versions sorted by git tag date (most recent first)
3. Prereleases (canary, alpha, beta, rc, etc.) sorted by date but placed after stable versions
4. Limit to ~100 tags

### 2. Package Name & Version Confirmation
After tag selection, suggest name/version extracted from tag:
```
Selected: ai@6.0.68

Package name: ai (press Enter to confirm, or type new name)
Version: 6.0.68 (press Enter to confirm, or type new version)
```

Skip this step if both `--name` and `--version` are provided.

## Implementation

### Dependencies
Add `@inquirer/prompts` for interactive selection (modern, ESM, TypeScript).

### New Functions in git.ts
```typescript
// Fetch tags with metadata (date, is-prerelease)
export function fetchTagsWithMetadata(dirPath: string): TagInfo[]

// Sort tags: HEAD first, then stable by date, then prereleases
export function sortTagsForSelection(tags: TagInfo[]): TagInfo[]
```

### Changes to cli.ts
1. Add `--tag` option
2. Before cloning/processing, if no `--tag`:
   - Clone repo (shallow)
   - Fetch tags with metadata
   - Show interactive selector
3. After tag selection, if name/version not both provided:
   - Parse tag to suggest name/version
   - Show confirmation prompts

## Progress

| Task | Status |
|------|--------|
| Add @inquirer/prompts dependency | Pending |
| Implement fetchTagsWithMetadata | Pending |
| Implement sortTagsForSelection | Pending |
| Add --tag CLI option | Pending |
| Implement interactive tag selector | Pending |
| Implement name/version confirmation | Pending |
| Update tests | Pending |
| Run validation | Pending |
