---
"@neuledge/context": patch
---

Remove the public exports `createIngestionReport`, `formatIngestionSummary`,
`ingestionErrorReason`, `validateIngestion`, and `writeIngestionReport`, while
keeping `IngestionReport`, `IngestionDiagnostic`, and `IngestionError` (and
`BuildResult.diagnostics`). The post-build CLI summary now lists only problem
kinds with nonzero counts, so a clean build prints one short line, and the
ingestion-report documentation moved to a dedicated page. This is a one-time
exception to the usual major bump for breaking API changes, agreed for this
follow-up: 1.4.0 shipped only hours ago, so these exports have had almost no
time to gain users.
