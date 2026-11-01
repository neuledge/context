import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { IngestionDiagnostic, IngestionReport } from "@neuledge/context";

/**
 * Registry-local ingestion report helpers.
 *
 * These mirror the helpers that used to be part of `@neuledge/context`'s
 * public API but are no longer exported there. The registry is the only
 * first-party consumer that needs them, so they live here instead of
 * re-opening the public package surface.
 */

/** Build a normalized report from raw diagnostics, sorted by path. */
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

/** Save an explicitly requested report, creating its parent directories. */
export function writeIngestionReport(
  path: string,
  report: IngestionReport,
): void {
  const destination = resolve(path);
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
  } catch (cause) {
    throw new Error(
      `Could not write ingestion diagnostics to ${destination}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
