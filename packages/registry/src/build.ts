/**
 * Build documentation packages from registry definitions.
 *
 * Uses @neuledge/context functions directly (workspace dependency)
 * to clone repos, read docs, and build SQLite packages.
 *
 * Supports both versioned (clone at specific tag) and unversioned
 * (clone default branch) definitions. Supports git, zip and HTML index sources.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  type BuildResult,
  buildPackage,
  cloneRepository,
  initDatabase,
  readLocalDocsFiles,
} from "@neuledge/context";
import type {
  GitSource,
  PackageDefinition,
  UnversionedDefinition,
  VersionedDefinition,
} from "./definition.js";
import { createBuildFingerprint, getIngestionRevision } from "./fingerprint.js";
import { excludeFiles } from "./glob.js";
import { downloadHtmlIndex } from "./html-index.js";
import { resolveBuildSource } from "./source.js";
import { downloadAndExtractZip } from "./zip.js";

/** Only an absent ref is skippable; transport failures keep their original error. */
export class MissingSourceRefError extends Error {}

export interface RegistryBuildResult extends BuildResult {
  name: string;
  registry: string;
  version: string;
  /** Git commit SHA that was built (for skip-if-unchanged checks) */
  sourceCommit?: string;
}

/**
 * Get the HEAD commit SHA of a remote repository without cloning.
 * Uses `git ls-remote` which makes a single HTTP call.
 */
export function getHeadCommit(url: string, ref?: string): string {
  // Must match the ref the package is built from. Asking for HEAD while building
  // a branch compares two unrelated commits, so the skip-if-unchanged check never
  // fires and the package is rebuilt and republished on every run.
  const requested = ref ?? "HEAD";
  const output = execFileSync(
    "git",
    ["ls-remote", url, requested, `${requested}^{}`],
    {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();

  const refs = new Map(
    output.split("\n").map((line) => {
      const [sha, name] = line.split("\t");
      return [name, sha];
    }),
  );
  // Match clone --branch: prefer a branch, and peel annotated tags to commits.
  const candidates = requested.startsWith("refs/")
    ? [requested]
    : [`refs/heads/${requested}`, `refs/tags/${requested}`, requested];
  const sha = candidates
    .map((name) => refs.get(`${name}^{}`) ?? refs.get(name))
    .find(Boolean);
  if (!sha) {
    throw new MissingSourceRefError(
      `Git reference ${requested} not found in upstream ${url}`,
    );
  }
  return sha;
}

function fingerprintOptions(
  definition: PackageDefinition,
  version: string,
  sourceCommit?: string,
) {
  const ingestionRevision = getIngestionRevision();
  return {
    ingestionRevision,
    buildFingerprint: createBuildFingerprint(
      definition,
      version,
      sourceCommit,
      ingestionRevision,
    ),
  };
}

/**
 * Build a .db package for a specific version of a versioned definition.
 */
export async function buildFromDefinition(
  definition: VersionedDefinition,
  version: string,
  outputDir: string,
): Promise<RegistryBuildResult> {
  await initDatabase();
  const source = resolveBuildSource(definition, version);

  // Replace / in scoped names (e.g., @trpc/server → @trpc-server) for valid filenames
  const safeName = definition.name.replace(/\//g, "-");
  const outputPath = join(
    outputDir,
    `${definition.registry}-${safeName}@${version}.db`,
  );

  if (source.type === "git") {
    return buildFromGit(source, outputPath, definition, version);
  }

  const files =
    source.type === "html-index"
      ? await downloadHtmlIndex(source, version)
      : await downloadAndExtractZip(source.url, {
          docsPath: source.docs_path,
          excludePaths: source.exclude_paths,
        });

  if (files.length === 0) {
    throw new Error(
      `No documentation files found in ${source.type} source from ${source.url}`,
    );
  }

  const result = buildPackage(outputPath, files, {
    name: definition.name,
    version,
    description: definition.description,
    sourceUrl: definition.repository ?? source.url,
    ...fingerprintOptions(definition, version),
  });

  return {
    ...result,
    name: definition.name,
    registry: definition.registry,
    version,
  };
}

/**
 * Build a .db package from an unversioned definition.
 * Clones the default branch (HEAD) and labels the package as "latest".
 * Stores the HEAD commit SHA in DB metadata for skip-if-unchanged checks.
 */
export async function buildUnversioned(
  definition: UnversionedDefinition,
  outputDir: string,
): Promise<RegistryBuildResult> {
  await initDatabase();
  const version = "latest";
  const source = resolveBuildSource(definition, version);
  const safeName = definition.name.replace(/\//g, "-");
  const outputPath = join(
    outputDir,
    `${definition.registry}-${safeName}@${version}.db`,
  );

  if (source.type === "zip") {
    const files = await downloadAndExtractZip(source.url, {
      docsPath: source.docs_path,
      excludePaths: source.exclude_paths,
    });

    if (files.length === 0) {
      throw new Error(`No documentation files found in ZIP from ${source.url}`);
    }

    const result = buildPackage(outputPath, files, {
      name: definition.name,
      version,
      description: definition.description,
      sourceUrl: definition.repository ?? source.url,
      ...fingerprintOptions(definition, version),
    });

    return {
      ...result,
      name: definition.name,
      registry: definition.registry,
      version,
    };
  }

  if (source.type !== "git")
    throw new Error("Unversioned HTML sources are unsupported");
  return buildFromGit(source, outputPath, definition, version);
}

/** Build from a git source (clone at tag, read docs, build package). */
function buildFromGit(
  source: GitSource,
  outputPath: string,
  definition: PackageDefinition,
  version: string,
): RegistryBuildResult {
  const { tempDir, cleanup } = cloneRepository(source.url, source.ref);

  try {
    const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: tempDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // Filter before the emptiness check, so an over-broad exclude_paths fails
    // loudly here instead of publishing an empty package.
    const files = excludeFiles(
      readLocalDocsFiles(tempDir, {
        path: source.docs_path,
        lang: source.lang,
      }),
      source.exclude_paths,
      source.docs_path,
    );

    if (files.length === 0) {
      throw new Error(
        `No documentation files found in ${source.url} at ref ${source.ref ?? "HEAD"}`,
      );
    }

    const result = buildPackage(outputPath, files, {
      name: definition.name,
      version,
      description: definition.description,
      sourceUrl: definition.repository ?? source.url,
      sourceCommit,
      ...fingerprintOptions(definition, version, sourceCommit),
    });

    return {
      ...result,
      name: definition.name,
      registry: definition.registry,
      version,
      sourceCommit,
    };
  } finally {
    cleanup();
  }
}
