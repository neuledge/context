/**
 * Build documentation packages from registry definitions.
 *
 * Uses @neuledge/context functions directly (workspace dependency)
 * to clone repos, read docs, and build SQLite packages.
 */

import { join } from "node:path";
import {
  type BuildResult,
  buildPackage,
  cloneRepository,
  readLocalDocsFiles,
} from "@neuledge/context";
import {
  constructTag,
  type PackageDefinition,
  resolveVersionEntry,
} from "./definition.js";

export interface RegistryBuildResult extends BuildResult {
  name: string;
  registry: string;
  version: string;
}

/**
 * Build a .db package for a specific version of a defined package.
 */
export function buildFromDefinition(
  definition: PackageDefinition,
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
