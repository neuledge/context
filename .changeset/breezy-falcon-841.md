---
"@neuledge/context": minor
---

Add `--libs` option to `context serve` for restricting an MCP session to a fixed subset of installed libraries. Each entry can be a name (`react`) or `name@version` (`react@18.3.1`). When set, `search_packages` and `download_package` are hidden so the session is locked to that list — useful for per-project scoping when many packages are installed globally.
