import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PackageDefinition } from "./definition.js";
import { resolveBuildSource } from "./source.js";

export function getIngestionRevision(): string {
  // Works from src (tsx) and dist. Runtime needs only the built artifact.
  const { revision } = JSON.parse(
    readFileSync(
      new URL("../dist/ingestion-revision.json", import.meta.url),
      "utf8",
    ),
  ) as { revision: string };
  return revision;
}

export function createBuildFingerprint(
  definition: PackageDefinition,
  version: string,
  sourceCommit?: string,
  ingestionRevision = getIngestionRevision(),
): string {
  const source = resolveBuildSource(definition, version);
  if (source.type === "git" && !sourceCommit) {
    throw new Error(
      "A resolved Git commit is required for a build fingerprint",
    );
  }
  const effectiveSource = {
    type: source.type,
    url: source.url,
    ref: source.type === "git" ? (source.ref ?? "HEAD") : undefined,
    docs_path: "docs_path" in source ? source.docs_path : undefined,
    exclude_paths: [...new Set(source.exclude_paths ?? [])].sort(),
    lang: source.type === "git" ? (source.lang ?? "en") : undefined,
    max_pages:
      source.type === "html-index" ? (source.max_pages ?? 2000) : undefined,
  };
  const inputs = {
    schema_version: 1,
    registry: definition.registry,
    name: definition.name,
    version,
    description: definition.description,
    source_url: definition.repository ?? source.url,
    source: effectiveSource,
    source_revision: sourceCommit ?? version,
    ingestion_revision: ingestionRevision,
  };
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}
