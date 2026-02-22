/**
 * Build a .db package from a registry definition and target version.
 * Uses @neuledge/context APIs directly (no shelling out to CLI).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildPackage,
  cloneRepository,
  readLocalDocsFiles,
} from "@neuledge/context";
import {
  buildGitTag,
  type Definition,
  findMatchingVersion,
} from "./definition.js";

export interface BuildOptions {
  /** Directory to write the .db file. */
  outputDir: string;
}

export interface BuildVersionResult {
  /** Path to the built .db file. */
  dbPath: string;
  sectionCount: number;
  totalTokens: number;
}

/**
 * Build a documentation .db for a specific version of a definition.
 * Clones the git repository at the correct tag, reads docs, and builds the package.
 */
export async function buildVersion(
  def: Definition,
  version: string,
  options: BuildOptions,
): Promise<BuildVersionResult> {
  const entry = findMatchingVersion(def, version);
  if (!entry) {
    throw new Error(
      `No version entry matches ${version} in ${def.registry}/${def.name}`,
    );
  }

  const tag = buildGitTag(entry.tag_pattern, version);
  const { tempDir, cleanup } = cloneRepository(entry.source.url, tag);

  try {
    const files = readLocalDocsFiles(tempDir, {
      path: entry.source.docs_path,
      lang: entry.source.lang,
    });

    if (files.length === 0) {
      throw new Error(
        `No markdown files found for ${def.registry}/${def.name}@${version}`,
      );
    }

    mkdirSync(options.outputDir, { recursive: true });
    const dbPath = join(options.outputDir, `${def.name}@${version}.db`);

    const result = buildPackage(dbPath, files, {
      name: def.name,
      version,
      description: def.description,
      sourceUrl: entry.source.url,
    });

    return {
      dbPath,
      sectionCount: result.sectionCount,
      totalTokens: result.totalTokens,
    };
  } finally {
    cleanup();
  }
}
