---
"@neuledge/context": patch
---

Remove the public exports `createIngestionReport`, `formatIngestionSummary`,
`ingestionErrorReason`, `validateIngestion`, and `writeIngestionReport`, while
keeping `IngestionReport`, `IngestionDiagnostic`, and `IngestionError` (and
`BuildResult.diagnostics`). The post-build CLI summary now lists only problem
kinds with nonzero counts, so a clean build prints one short line, and the
ingestion-report documentation moved to a dedicated page. This is intentionally
a patch despite removing exports: 1.4.0 shipped only hours ago and almost nobody
can depend on them yet.
