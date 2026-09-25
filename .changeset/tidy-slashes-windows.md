---
"@neuledge/context": patch
---

Store documentation paths with forward slashes on Windows. Adding local or git docs on Windows saved paths like `docs\guide.md`, so the same package built on Windows and Linux had different paths.
