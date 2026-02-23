/**
 * Build documentation packages from registry definitions.
 *
 * Uses @neuledge/context functions directly (workspace dependency)
 * to clone repos, read docs, and build SQLite packages.
 *
 * Supports both versioned (clone at specific tag) and unversioned
 * (clone default branch) definitions.
 */

import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  type BuildResult,
  buildPackage,
  cloneRepository,
  readLocalDocsFiles,
} from "@neuledge/context";
import {
  constructTag,
  resolveVersionEntry,
  type UnversionedDefinition,
  type VersionedDefinition,
} from "./definition.js";

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
export function getHeadCommit(url: string): string {
  const output = execSync(`git ls-remote ${url} HEAD`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

  // Format: "<sha>\tHEAD"
  const sha = output.split("\t")[0];
  if (!sha) {
    throw new Error(`Failed to get HEAD commit for ${url}`);
  }
  return sha;
}

/**
 * Build a .db package for a specific version of a versioned definition.
 */
export function buildFromDefinition(
  definition: VersionedDefinition,
  version: string,
  outputDir: string,
): RegistryBuildResult {
  const entry = resolveVersionEntry(definition, version);
  if (!entry) {
    throw new Error(
      `No version entry matches ${version} in ${definition.name}`,
    );
  }

  const tag = constructTag(entry.tag_pattern, version);
  const outputPath = join(
    outputDir,
    `${definition.registry}-${definition.name}@${version}.db`,
  );

  // Clone the repository at the specific tag
  const { tempDir, cleanup } = cloneRepository(entry.source.url, tag);

  try {
    // Read documentation files
    const files = readLocalDocsFiles(tempDir, {
      path: entry.source.docs_path,
      lang: entry.source.lang,
    });

    if (files.length === 0) {
      throw new Error(
        `No documentation files found in ${entry.source.url} at tag ${tag}`,
      );
    }

    // Build the package
    const result = buildPackage(outputPath, files, {
      name: definition.name,
      version,
      description: definition.description,
      sourceUrl: definition.repository ?? entry.source.url,
    });

    return {
      ...result,
      name: definition.name,
      registry: definition.registry,
      version,
    };
  } finally {
    cleanup();
  }
}

/**
 * Build a .db package from an unversioned definition.
 * Clones the default branch (HEAD) and labels the package as "latest".
 * Stores the HEAD commit SHA in DB metadata for skip-if-unchanged checks.
 */
export function buildUnversioned(
  definition: UnversionedDefinition,
  outputDir: string,
): RegistryBuildResult {
  const version = "latest";
  const { source } = definition;
  const outputPath = join(
    outputDir,
    `${definition.registry}-${definition.name}@${version}.db`,
  );

  // Clone without a specific ref — gets the default branch
  const { tempDir, cleanup } = cloneRepository(source.url);

  try {
    // Get the commit SHA of the cloned HEAD
    const sourceCommit = execSync("git rev-parse HEAD", {
      cwd: tempDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const files = readLocalDocsFiles(tempDir, {
      path: source.docs_path,
      lang: source.lang,
    });

    if (files.length === 0) {
      throw new Error(
        `No documentation files found in ${source.url} (default branch)`,
      );
    }

    const result = buildPackage(outputPath, files, {
      name: definition.name,
      version,
      description: definition.description,
      sourceUrl: definition.repository ?? source.url,
      sourceCommit,
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
