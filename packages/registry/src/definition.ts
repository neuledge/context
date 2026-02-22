/**
 * YAML definition parser for registry packages.
 *
 * Each definition file (e.g., registry/npm/nextjs.yaml) describes
 * how to build documentation packages for a library across versions.
 * The registry (npm, pip, etc.) is derived from the parent directory name.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod/v4";

const SourceSchema = z.object({
  type: z.literal("git"),
  url: z.url(),
  docs_path: z.string().optional(),
  lang: z.string().default("en"),
});

const VersionEntrySchema = z.object({
  min_version: z.string(),
  max_version: z.string().optional(),
  source: SourceSchema,
  tag_pattern: z.string().default("v{version}"),
});

const DefinitionFileSchema = z.object({
  name: z.string(),
  package: z.string().optional(),
  description: z.string().optional(),
  repository: z.url().optional(),
  versions: z.array(VersionEntrySchema).min(1),
});

export type VersionEntry = z.infer<typeof VersionEntrySchema>;
export type DefinitionFile = z.infer<typeof DefinitionFileSchema>;

export interface PackageDefinition extends DefinitionFile {
  /** Derived from parent directory (e.g., "npm", "pip") */
  registry: string;
  /** Resolved package name for registry queries (defaults to name) */
  registryPackage: string;
}

/**
 * Parse and validate a YAML definition file.
 * The registry is derived from the file's parent directory name.
 */
export function loadDefinition(filePath: string): PackageDefinition {
  const content = readFileSync(filePath, "utf-8");
  const raw = parseYaml(content);
  const parsed = DefinitionFileSchema.parse(raw);
  const registry = basename(dirname(filePath));

  return {
    ...parsed,
    registry,
    registryPackage: parsed.package ?? parsed.name,
  };
}

/**
 * Scan the registry/ directory and load all definitions.
 */
export function listDefinitions(registryDir: string): PackageDefinition[] {
  const definitions: PackageDefinition[] = [];

  for (const manager of readdirSync(registryDir, { withFileTypes: true })) {
    if (!manager.isDirectory()) continue;

    const managerDir = join(registryDir, manager.name);
    for (const file of readdirSync(managerDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".yaml")) continue;

      definitions.push(loadDefinition(join(managerDir, file.name)));
    }
  }

  return definitions.sort((a, b) =>
    `${a.registry}/${a.name}`.localeCompare(`${b.registry}/${b.name}`),
  );
}

/**
 * Find the first version entry that matches a given version.
 * Ranges are evaluated top-to-bottom; first match wins.
 * A version matches if: min_version <= version (< max_version if set).
 */
export function resolveVersionEntry(
  definition: PackageDefinition,
  version: string,
): VersionEntry | undefined {
  return definition.versions.find((entry) => {
    if (compareSemver(version, entry.min_version) < 0) return false;
    if (entry.max_version && compareSemver(version, entry.max_version) >= 0)
      return false;
    return true;
  });
}

/**
 * Construct a git tag from a tag_pattern and version string.
 * Simple string replacement of {version}.
 */
export function constructTag(tagPattern: string, version: string): string {
  return tagPattern.replace("{version}", version);
}

/**
 * Compare two semver strings. Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }

  return 0;
}
