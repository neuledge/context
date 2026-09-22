---
"@neuledge/context": patch
---

Handle search topics as literal keywords with optional quoted phrases, preventing malformed quotes and FTS operator words from causing SQLite errors. Preserve Unicode keywords and add local ingestion-to-retrieval regression fixtures.
