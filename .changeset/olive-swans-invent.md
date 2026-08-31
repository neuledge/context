---
"@neuledge/context": patch
---

Update the optional `better-sqlite3` dependency to 13.x. It ships its own prebuilt binaries, so installing no longer compiles it from source, and it works on Node 24 — which 11.x did not.
