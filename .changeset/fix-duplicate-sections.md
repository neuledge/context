---
"@neuledge/context": patch
---

Fix duplicate sections appearing when scanning repos with identical content across multiple files

Sections with the same content from different source files (e.g., shared README sections across package directories) are now deduplicated based on content only, keeping the first occurrence regardless of section title.
