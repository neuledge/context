/** Per-document outcomes shared by source readers and package builders. */
export interface IngestionDiagnostic {
  /** Path relative to the source root (never the temporary checkout path). */
  path: string;
  kind: "file" | "directory";
  outcome:
    | "excluded"
    | "duplicate"
    | "read-error"
    | "parse-error"
    | "empty"
    | "indexed";
  reason?: string;
  duplicateOf?: string;
  /** Sections actually added to the package after section deduplication. */
  sections?: number;
  duplicateSections?: number;
}

export interface IngestionReport {
  schemaVersion: 1;
  summary: {
    discoveredFiles: number;
    selectedFiles: number;
    indexedDocuments: number;
    indexedSections: number;
    excludedFiles: number;
    excludedDirectories: number;
    duplicateFiles: number;
    unreadableFiles: number;
    unreadableDirectories: number;
    parseFailures: number;
    emptyFiles: number;
  };
  entries: IngestionDiagnostic[];
}

export function createIngestionReport(
  diagnostics: readonly IngestionDiagnostic[],
): IngestionReport {
  const summary: IngestionReport["summary"] = {
    discoveredFiles: 0,
    selectedFiles: 0,
    indexedDocuments: 0,
    indexedSections: 0,
    excludedFiles: 0,
    excludedDirectories: 0,
    duplicateFiles: 0,
    unreadableFiles: 0,
    unreadableDirectories: 0,
    parseFailures: 0,
    emptyFiles: 0,
  };
  for (const entry of diagnostics) {
    if (entry.kind === "directory") {
      if (entry.outcome === "excluded") summary.excludedDirectories++;
      if (entry.outcome === "read-error") summary.unreadableDirectories++;
      continue;
    }
    summary.discoveredFiles++;
    if (entry.outcome !== "excluded" && entry.outcome !== "duplicate") {
      summary.selectedFiles++;
    }
    switch (entry.outcome) {
      case "excluded":
        summary.excludedFiles++;
        break;
      case "duplicate":
        summary.duplicateFiles++;
        break;
      case "read-error":
        summary.unreadableFiles++;
        break;
      case "parse-error":
        summary.parseFailures++;
        break;
      case "empty":
        summary.emptyFiles++;
        break;
      case "indexed":
        summary.indexedDocuments++;
        summary.indexedSections += entry.sections ?? 0;
        break;
    }
  }
  const entries = diagnostics
    .map((entry) => ({ ...entry }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { schemaVersion: 1, summary, entries };
}

/** Keep filesystem error codes useful without leaking checkout paths. */
export function ingestionErrorReason(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string"
    ? code
    : error instanceof Error
      ? error.message
      : String(error);
}

export function formatIngestionSummary(report: IngestionReport): string {
  const s = report.summary;
  const count = (value: number, singular: string, plural = `${singular}s`) =>
    `${value} ${value === 1 ? singular : plural}`;
  const base = `Ingestion: ${count(s.discoveredFiles, "documentation file")} discovered, ${s.selectedFiles} selected, ${s.indexedDocuments} indexed, ${count(s.indexedSections, "section")}`;
  const problems: string[] = [];
  if (s.excludedFiles + s.excludedDirectories > 0) {
    problems.push(
      `excluded ${count(s.excludedFiles, "file")}/${count(s.excludedDirectories, "directory", "directories")}`,
    );
  }
  if (s.duplicateFiles > 0) {
    problems.push(`${count(s.duplicateFiles, "duplicate")}`);
  }
  if (s.unreadableFiles + s.unreadableDirectories > 0) {
    problems.push(
      `unreadable ${count(s.unreadableFiles, "file")}/${count(s.unreadableDirectories, "directory", "directories")}`,
    );
  }
  if (s.parseFailures > 0) {
    problems.push(`${count(s.parseFailures, "parse failure")}`);
  }
  if (s.emptyFiles > 0) {
    problems.push(`${count(s.emptyFiles, "empty file")}`);
  }
  return problems.length > 0 ? `${base}; ${problems.join(", ")}` : base;
}

export class IngestionError extends Error {
  readonly diagnostics: IngestionReport;

  constructor(message: string, diagnostics: readonly IngestionDiagnostic[]) {
    super(message);
    this.name = "IngestionError";
    this.diagnostics = createIngestionReport(diagnostics);
  }
}

export function validateIngestion(report: IngestionReport): void {
  const s = report.summary;
  if (
    s.unreadableFiles +
      s.unreadableDirectories +
      s.parseFailures +
      s.emptyFiles >
    0
  ) {
    throw new IngestionError(
      "Strict ingestion validation failed: unreadable, unparseable, or empty documentation",
      report.entries,
    );
  }
}
