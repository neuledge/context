---
"@neuledge/context": patch
---

Keep fenced code blocks whole when a long Markdown section is split at paragraph boundaries, instead of cutting them at blank lines inside the code. The same fence rules now decide where very large Markdown files are split at `##` headings and which sections are marked as having code, so `~~~` blocks count as code too
