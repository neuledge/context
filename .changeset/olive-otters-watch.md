---
"@neuledge/context": patch
---

`serve` now picks up packages installed while it is running. `context add` writes to the data directory from a separate process, so a long-lived stdio server used to serve the package list it read at startup until the client reconnected, and `get_docs` could not see a package that was already installed.
