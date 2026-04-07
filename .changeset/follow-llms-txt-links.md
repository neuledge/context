---
"@neuledge/context": minor
---

`context add <website>` now follows the markdown links inside an `llms.txt`
index and fetches each linked document, instead of treating the index as the
final content. This produces packages with the full documentation rather than
just the table of contents. `llms-full.txt` is unchanged. Cross-origin links
are skipped by default.
