import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { IngestionReport } from "./ingestion.js";

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
