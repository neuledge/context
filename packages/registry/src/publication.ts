import type { BuildResult } from "@neuledge/context";
import {
  buildFromDefinition,
  buildUnversioned,
  getHeadCommit,
} from "./build.js";
import { isVersioned, type PackageDefinition } from "./definition.js";
import { createBuildFingerprint, sha256Hex } from "./fingerprint.js";
import { formatBuilt } from "./format.js";
import {
  checkPackageExists,
  type PackageMetadata,
  publishPackage,
} from "./publish.js";
import { resolveBuildSource } from "./source.js";
import { downloadZipBuffer } from "./zip.js";

/** Legacy metadata retains the old skip policy until a forced migration. */
export async function publicationSkipReason(
  definition: PackageDefinition,
  version: string,
  existing: PackageMetadata | null,
  force = false,
  sourceContentDigest?: string,
): Promise<string | undefined> {
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
      createBuildFingerprint(
        definition,
        version,
        commit,
        undefined,
        sourceContentDigest,
      )
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
  const source = resolveBuildSource(definition, version);

  // A versioned ZIP can serve different bytes at the same version. Fetch once
  // here and use those exact bytes for both the skip decision and the build.
  let zipBuffer: Buffer | undefined;
  let sourceContentDigest: string | undefined;
  if (
    !options.force &&
    isVersioned(definition) &&
    source.type === "zip" &&
    existing?.build_fingerprint
  ) {
    zipBuffer = await downloadZipBuffer(source.url);
    sourceContentDigest = sha256Hex(zipBuffer);
  }

  const reason = await publicationSkipReason(
    definition,
    version,
    existing,
    options.force,
    sourceContentDigest,
  );
  if (reason) {
    options.onSkip?.(reason);
    if (!options.quietSkips) log(`Skipping ${id} (${reason})`);
    return;
  }
  log(`Building ${id}...`);
  const result = isVersioned(definition)
    ? await buildFromDefinition(definition, version, outputDir, {
        force: options.force,
        zipBuffer,
      })
    : await buildUnversioned(definition, outputDir);
  log(`Built: ${result.path} (${formatBuilt(result)})`);
  log(`Publishing ${id}...`);
  await publishPackage(
    definition.registry,
    definition.name,
    version,
    result.path,
    { sourceType: source.type },
  );
  log(`Published: ${id}`);
  return result;
}
