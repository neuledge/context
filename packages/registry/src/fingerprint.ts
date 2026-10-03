import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  constructTag,
  isGitVersionEntry,
  isVersioned,
  type PackageDefinition,
  resolveUrl,
  resolveVersionEntry,
} from "./definition.js";

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

/** Only the entry selected for this release contributes to its fingerprint. */
export function resolveBuildSource(
  definition: PackageDefinition,
  version: string,
) {
  if (!isVersioned(definition)) return definition.source;
  const entry = resolveVersionEntry(definition, version);
  if (!entry)
    throw new Error(
      `No version entry matches ${version} in ${definition.name}`,
    );
  if (isGitVersionEntry(entry)) {
    return { ...entry.source, ref: constructTag(entry.tag_pattern, version) };
  }
  return {
    ...entry.source,
    url: resolveUrl(entry.source.url, version),
    ...(entry.source.type === "zip" && entry.source.docs_path
      ? { docs_path: resolveUrl(entry.source.docs_path, version) }
      : {}),
  };
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
    lang: "lang" in source ? (source.lang ?? "en") : undefined,
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
