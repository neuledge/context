---
"@neuledge/context": patch
---

Clean up abandoned `.context-*` package staging directories left behind by a hard shutdown. The next download or setup now reclaims them when their recorded owner process is gone.
