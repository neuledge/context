---
"@neuledge/context": patch
---

Fix OOM crash when building packages from large llms-full.txt files (e.g., Cloudflare docs). Large markdown files (>1MB) are now pre-split by `##` headings before AST parsing so individual chunks stay small.
