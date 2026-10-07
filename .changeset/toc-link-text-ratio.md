---
"@neuledge/context": patch
---

Stop dropping prose sections as tables of contents because their links have long URLs. The table-of-contents check counted each link's full Markdown, URL included, as link text, so a paragraph with two or three long links counted as "mostly links" and was left out of the index. It now compares the link text a reader sees with the rest of the text. In the Python 3.14 docs, 154 of 538 pages produced no sections at all, including the C API pages for dict, list, set, tuple and datetime and `library/errno.html`; 45 remain empty after the fix, all of them index or contents pages.
