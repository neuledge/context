---
"@neuledge/context": patch
---

Fix out-of-memory crash when building packages from very large documentation files (such as a site's `llms-full.txt`, or a single-page HTML manual). Oversized markdown is now split into smaller chunks before parsing, and oversized HTML is cut at tag boundaries before it reaches the HTML-to-Markdown converter, so no input can exhaust the heap. An 8MB HTML page that previously needed more than 512MB of heap now builds in under 192MB and yields the same sections. The HTML split also scans each page once rather than once per tag, so a malformed page full of unclosed `<script` or `<svg` tags no longer stalls the build for minutes.

Malformed pages keep their page chrome out of the index: a stray close tag such as a `</header>` inside an `<aside>` no longer ends the sidebar early and leak it into search results, and a `<script>`, `<style>` or `<title>` that is never closed no longer has its body indexed as prose. A file that cannot be split or parsed at all is now skipped on its own instead of failing the whole build, and `buildPackage` reports how many it skipped.

Sections of a split document also keep unique titles. A page with no `##`/`<h2>` heading anywhere — an `h1` + `h3` page, or one with div-based headings — used to restart its part numbering in every chunk, so the same run of "Introduction", "Introduction (part 2)", … repeated once per chunk and blunted title search; the numbering now runs continuously across the whole document. Such a page also keeps its frontmatter title on every chunk instead of falling back to the filename part-way through.
