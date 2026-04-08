---
"@neuledge/context": patch
---

Fix context add command to properly handle branch refs in URLs like /tree/branch-name by using the ref during git clone rather than trying to checkout after a shallow clone.

Also allow running the CLI directly with tsx by recognizing .ts files in the isRunDirectly check.
