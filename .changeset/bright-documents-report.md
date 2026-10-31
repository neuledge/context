---
"@neuledge/context": minor
---
author: @TheRealBecks

Report documentation ingestion outcomes with relative paths and reasons, distinguishing exclusions, duplicate content, read/parse failures, empty documents, and indexed documents. Add JSON reports and strict validation to documentation builds, preserving installed packages when validation rejects unexpected document loss.

Keep diagnostics optional on the existing `BuildResult` type for compatibility with result objects and builder mocks; actual builds always include the report.
