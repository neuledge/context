---
"@neuledge/context": patch
---

Use `defuddle` for HTML article extraction when ingesting arbitrary URLs.

Previously, `context add <url>` passed raw HTML (minus a few stripped tags) to the Markdown pipeline, which left site clutter — subscribe CTAs, related posts, comment widgets — in the final package on platforms like Substack and Medium. The HTML branch now runs through `defuddle` to produce clean Markdown before packaging, and the extracted article title is available for future manifest enrichment.
