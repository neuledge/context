import { type BuildResult, formatIngestionSummary } from "@neuledge/context";

/** Include skipped files so malformed documents are visible to operators. */
export function formatBuilt(result: BuildResult): string {
  const skipped =
    result.skippedFiles > 0
      ? `, ${result.skippedFiles} file${result.skippedFiles === 1 ? "" : "s"} skipped`
      : "";
  const diagnostics = result.diagnostics
    ? `; ${formatIngestionSummary(result.diagnostics)}`
    : "";
  return `${result.sectionCount} sections, ${result.totalTokens} tokens${skipped}${diagnostics}`;
}
