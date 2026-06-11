---
"@neuledge/context": patch
---

Retry git clones on transient network failures (connection timeouts, DNS errors, 5xx) with exponential backoff, so a single network hiccup no longer fails package builds
