---
"@neuledge/context": patch
---

Remove the public exports `createIngestionReport`, `formatIngestionSummary`,
`ingestionErrorReason`, `validateIngestion`, and `writeIngestionReport`, while
keeping `IngestionReport`, `IngestionDiagnostic`, and `IngestionError` (and
`BuildResult.diagnostics`). The post-build CLI summary now lists only problem
kinds with nonzero counts, so a clean build prints one short line, and the
ingestion-report documentation moved to a dedicated page. Removing these exports
is a breaking change shipped as a patch under the repository's exception for
withdrawing an export within a day of its release: they were added in 1.4.0, released less than a day ago, so
nobody can reasonably depend on them yet.
