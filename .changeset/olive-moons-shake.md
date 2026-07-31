---
"@neuledge/context": patch
---

Fix out-of-memory crash when building packages from very large documentation files (such as a site's `llms-full.txt`, or a single-page HTML manual). Oversized markdown is now split into smaller chunks before parsing, and oversized HTML is cut at tag boundaries before it reaches the HTML-to-Markdown converter, so no input can exhaust the heap. An 8MB HTML page that previously needed more than 512MB of heap now builds in under 192MB and yields the same sections.
