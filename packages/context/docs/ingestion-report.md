# Ingestion reporting

`context add` documents what it discovered, selected, indexed, excluded, and
dropped while building a documentation package. This page covers the CLI summary,
the `--diagnostics` JSON report, strict validation, the report schema, and library
use. Registry builds publish the same report vocabulary; see the end of this page.

## CLI summary

Builds print a one-line ingestion summary listing discovered documentation files,
selected files, indexed documents and sections, followed only by the problem kinds
that actually occurred: exclusions, duplicates, unreadable files/directories,
parse failures, and empty documents. A clean build prints just the
discovery/selection/indexing counts, with no problem list.

## JSON report

To inspect paths and reasons, write a JSON report:

```bash
context add ./my-project --diagnostics ingestion.json
context add ./my-project --strict --diagnostics ingestion.json
```

Report parent directories are created automatically. Successful builds save the
requested report before replacing the installed package; a report-write failure
leaves the installed package unchanged. If reporting also fails after a build
error, the CLI preserves the original error and reports both failures.

## Strict builds

`--strict` rejects unreadable files/directories, failed linked-page downloads,
parser failures, and documents that produce no sections before changing the
installed package. Intentional exclusions and duplicate content remain
acceptable. The JSON report is also written when strict validation fails. These
options apply to documentation builds, not installation of prebuilt `.db` files.

## Report schema

The report has `schemaVersion`, `summary`, and per-path `entries`. Discovered
files are documentation candidates actually visited within the selected source;
selected files exclude intentional exclusions and duplicates. Indexed sections
count only sections stored after deduplication. Pruned directories appear once
with their exclusion reason; their contents are not scanned or counted. Hidden
and tooling directories and unrelated source-code files are omitted. Git/local
paths are relative to the repository root, including an explicit docs path.

Entries use the shared vocabulary `excluded`, `duplicate`, `read-error`,
`parse-error`, `empty`, and `indexed`. Entries name relative paths and give
reasons; duplicate documents identify the retained path when available. Directory
exclusions are reported without walking their descendants.

## Library use

`buildPackage` always returns a report as `BuildResult.diagnostics`. The property
is optional in the public type so existing result objects and builder mocks
remain compatible. The existing `skippedFiles` field still counts only
split/parse failures. To include source selection and read outcomes, pass the
same `IngestionDiagnostic[]` to `readLocalDocsFiles(..., { diagnostics })` and
`buildPackage(..., { name, version, diagnostics, strict })`. Strict failures throw
`IngestionError`, whose `diagnostics` property contains the report. Library code
does not log diagnostics.

## Registry builds

`registry build` uses the same report vocabulary through the registry publisher.
Git, ZIP, and HTML-index sources share the report vocabulary; Git paths are
relative to the checkout, ZIP paths to `docs_path`, and HTML paths to the pinned
index directory. Summary counts cover the selected source scope, not files
outside `docs_path` or links outside the pinned HTML directory. Failed source
downloads still abort the build; failure reports may contain only outcomes
collected before the abort.

`--strict` fails on read errors, parse errors, and documents producing no
sections. It does not reject exclusions or duplicates, and validation failures
leave any existing output package unchanged. The report is written on strict
failure too. A requested report is saved before replacing the output package, so
a report-write failure leaves the existing package unchanged. Reporting failures
do not mask an earlier build error. The default remains a tolerant build with
visible diagnostics. For library use, `buildFromDefinition` and `buildUnversioned`
accept an optional final `{ strict, diagnostics }` argument and return
`diagnostics` with the build result.
