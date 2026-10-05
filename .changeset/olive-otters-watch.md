---
"@neuledge/context": minor
---

For stdio sessions, `context serve` now watches the installed packages directory and reloads `get_docs` (notifying connected MCP clients) when a package is installed or removed by a separate `context add` or `context remove` process. `ContextServer.refreshGetDocsTool()` is now a public, supported API. `context remove` now reports unlink failures (including a file that survives the unlink attempt) instead of claiming success.
