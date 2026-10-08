import type { BuildResult } from "@neuledge/context";

/** Include skipped files so malformed documents are visible to operators. */
export function formatBuilt(result: BuildResult): string {
  const skipped =
    result.skippedFiles > 0 ? `, ${result.skippedFiles} files skipped` : "";
  return `${result.sectionCount} sections, ${result.totalTokens} tokens${skipped}`;
}
