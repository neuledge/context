/**
 * Build documentation packages from registry definitions.
 *
 * Uses @neuledge/context functions directly (workspace dependency)
 * to clone repos, read docs, and build SQLite packages.
 *
 * Supports both versioned (clone at specific tag) and unversioned
 * (clone default branch) definitions. Supports git and zip sources.
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
  isGitVersionEntry,
  resolveUrl,
  resolveVersionEntry,
  type UnversionedDefinition,
  type VersionedDefinition,
} from "./definition.js";
import { downloadAndExtractZip } from "./zip.js";

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
export async function buildFromDefinition(
  definition: VersionedDefinition,
  version: string,
  outputDir: string,
): Promise<RegistryBuildResult> {
  const entry = resolveVersionEntry(definition, version);
  if (!entry) {
    throw new Error(
      `No version entry matches ${version} in ${definition.name}`,
    );
  }

  // Replace / in scoped names (e.g., @trpc/server → @trpc-server) for valid filenames
  const safeName = definition.name.replace(/\//g, "-");
  const outputPath = join(
    outputDir,
    `${definition.registry}-${safeName}@${version}.db`,
  );

  if (isGitVersionEntry(entry)) {
    return buildFromGit(
      entry.source.url,
      constructTag(entry.tag_pattern, version),
      entry.source.docs_path,
      entry.source.lang,
      outputPath,
      definition,
      version,
    );
  }

  // Zip source: resolve URL template and download
  const url = resolveUrl(entry.source.url, version);
  const docsPath = entry.source.docs_path
    ? resolveUrl(entry.source.docs_path, version)
    : undefined;

  const files = await downloadAndExtractZip(url, { docsPath });

  if (files.length === 0) {
    throw new Error(`No documentation files found in ZIP from ${url}`);
  }

  const result = buildPackage(outputPath, files, {
    name: definition.name,
    version,
    description: definition.description,
    sourceUrl: definition.repository ?? url,
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
  const version = "latest";
  const { source } = definition;
  const safeName = definition.name.replace(/\//g, "-");
  const outputPath = join(
    outputDir,
    `${definition.registry}-${safeName}@${version}.db`,
  );

  if (source.type === "zip") {
    const files = await downloadAndExtractZip(source.url, {
      docsPath: source.docs_path,
    });

    if (files.length === 0) {
      throw new Error(`No documentation files found in ZIP from ${source.url}`);
    }

    const result = buildPackage(outputPath, files, {
      name: definition.name,
      version,
      description: definition.description,
      sourceUrl: definition.repository ?? source.url,
    });

    return {
      ...result,
      name: definition.name,
      registry: definition.registry,
      version,
    };
  }

  // Git source: clone and read
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

/** Build from a git source (clone at tag, read docs, build package). */
function buildFromGit(
  url: string,
  tag: string,
  docsPath: string | undefined,
  lang: string,
  outputPath: string,
  definition: VersionedDefinition,
  version: string,
): RegistryBuildResult {
  const { tempDir, cleanup } = cloneRepository(url, tag);

  try {
    const files = readLocalDocsFiles(tempDir, { path: docsPath, lang });

    if (files.length === 0) {
      throw new Error(`No documentation files found in ${url} at tag ${tag}`);
    }

    const result = buildPackage(outputPath, files, {
      name: definition.name,
      version,
      description: definition.description,
      sourceUrl: definition.repository ?? url,
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
