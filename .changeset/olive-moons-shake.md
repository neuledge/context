---
"@neuledge/context": patch
---

Fix out-of-memory crash when building packages from very large documentation files (such as a site's `llms-full.txt`). Oversized markdown is now split into smaller chunks before parsing, so no input size can exhaust the heap.
