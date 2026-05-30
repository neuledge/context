---
"@neuledge/context": patch
---

Ignore non-string `title`/`description` frontmatter values when parsing docs. Previously a frontmatter field that parsed to a non-string (e.g. an object) propagated into the document title and broke package building with "Too few parameter values were provided". Such values now fall back to the derived title instead of crashing the build.
