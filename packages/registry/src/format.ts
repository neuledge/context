import type { BuildResult } from "@neuledge/context";
import { formatIngestionSummary } from "./ingestion.js";

/** Include skipped files so malformed documents are visible to operators. */
export function formatBuilt(result: BuildResult): string {
  const built = `${result.sectionCount} sections, ${result.totalTokens} tokens`;
  if (result.diagnostics) {
    return `${built}; ${formatIngestionSummary(result.diagnostics)}`;
  }
  const skipped =
    result.skippedFiles > 0
      ? `, ${result.skippedFiles} file${result.skippedFiles === 1 ? "" : "s"} skipped`
      : "";
  return `${built}${skipped}`;
}
