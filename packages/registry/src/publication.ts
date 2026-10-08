import type { BuildResult } from "@neuledge/context";
import {
  buildFromDefinition,
  buildUnversioned,
  getHeadCommit,
} from "./build.js";
import { isVersioned, type PackageDefinition } from "./definition.js";
import { createBuildFingerprint } from "./fingerprint.js";
import { formatBuilt } from "./format.js";
import {
  checkPackageExists,
  type PackageMetadata,
  publishPackage,
} from "./publish.js";
import { resolveBuildSource } from "./source.js";

/** Legacy metadata retains the old skip policy until a forced migration. */
export function publicationSkipReason(
  definition: PackageDefinition,
  version: string,
  existing: PackageMetadata | null,
  force = false,
): string | undefined {
  if (force || !existing) return;
  if (!existing.build_fingerprint && isVersioned(definition)) {
    return "already published; legacy metadata (use --force to rebuild)";
  }
  const source = resolveBuildSource(definition, version);
  // An unversioned archive has no immutable source revision to compare.
  if (!isVersioned(definition) && source.type === "zip") return;
  const commit =
    source.type === "git" ? getHeadCommit(source.url, source.ref) : undefined;
  if (existing.build_fingerprint) {
    if (
      existing.build_fingerprint ===
      createBuildFingerprint(definition, version, commit)
    ) {
      return "build inputs unchanged";
    }
  } else if (commit && commit === existing.source_commit) {
    return "source unchanged; legacy metadata (use --force to rebuild)";
  }
}

export async function publishDefinition(
  definition: PackageDefinition,
  version: string,
  outputDir: string,
  options: {
    force?: boolean;
    log?: (message: string) => void;
    quietSkips?: boolean;
    onSkip?: (reason: string) => void;
  } = {},
): Promise<BuildResult | undefined> {
  const log = options.log ?? console.log;
  const id = `${definition.registry}/${definition.name}@${version}`;
  const existing = options.force
    ? null
    : await checkPackageExists(definition.registry, definition.name, version);
  const reason = publicationSkipReason(
    definition,
    version,
    existing,
    options.force,
  );
  if (reason) {
    options.onSkip?.(reason);
    if (!options.quietSkips) log(`Skipping ${id} (${reason})`);
    return;
  }
  log(`Building ${id}...`);
  const result = isVersioned(definition)
    ? await buildFromDefinition(definition, version, outputDir)
    : await buildUnversioned(definition, outputDir);
  log(`Built: ${result.path} (${formatBuilt(result)})`);
  log(`Publishing ${id}...`);
  await publishPackage(
    definition.registry,
    definition.name,
    version,
    result.path,
  );
  log(`Published: ${id}`);
  return result;
}
