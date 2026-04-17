---
"@neuledge/context": minor
---

Add support for ingesting arbitrary URLs when `llms.txt` is not found

- `context add <url>` now falls back to fetching the page directly if `llms.txt` is unavailable, enabling ingestion of blog posts, articles, documentation pages, and raw markdown files
- Added `suggestPackageNameFromUrl()` to derive meaningful package names from URL paths
- Added `fetchWebPage()` helper with content-type detection and binary rejection
- All HTTP fetches now include browser-like headers to bypass basic bot protection
- Added per-platform authentication via `context auth add/list/remove` for accessing subscriber-only content with cookies
- Auth is stored in `~/.context/auth.json` and matched by domain (with parent-domain fallback for subdomains)
