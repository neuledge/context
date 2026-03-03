/**
 * YAML definition parser for registry packages.
 *
 * Each definition file (e.g., registry/npm/next.yaml) describes
 * how to build documentation packages for a library across versions.
 * The name must match the registry package name AND the file path.
 * Scoped packages use subdirectories (e.g., registry/npm/@trpc/server.yaml).
 * The registry (npm, pip, etc.) is derived from the parent directory name.
 *
 * Definitions come in two forms:
 * - **Versioned**: `versions` array with semver ranges and tag patterns.
 *   Used when docs are tagged alongside library releases.
 * - **Unversioned**: top-level `source` field, no version ranges.
 *   Used when docs live in a separate repo without version tags (e.g., drizzle-orm).
 *   Always builds from the default branch with version label "latest".
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
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

// A definition has either `versions` (versioned) or `source` (unversioned), not both.
const DefinitionFileSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    repository: z.url().optional(),
    versions: z.array(VersionEntrySchema).min(1).optional(),
    source: SourceSchema.optional(),
  })
  .check((ctx) => {
    const hasVersions = ctx.value.versions != null;
    const hasSource = ctx.value.source != null;
    if (hasVersions === hasSource) {
      ctx.issues.push({
        message:
          "Must have either 'versions' (versioned docs) or 'source' (unversioned docs), but not both",
        path: hasVersions ? ["source"] : ["versions"],
        input: ctx.value,
        code: "custom",
      });
    }
  });

export type Source = z.infer<typeof SourceSchema>;
export type VersionEntry = z.infer<typeof VersionEntrySchema>;
export type DefinitionFile = z.infer<typeof DefinitionFileSchema>;

interface BaseDefinition {
  name: string;
  description?: string;
  repository?: string;
  /** Derived from parent directory (e.g., "npm", "pip") */
  registry: string;
}

export interface VersionedDefinition extends BaseDefinition {
  versions: VersionEntry[];
  source?: undefined;
}

export interface UnversionedDefinition extends BaseDefinition {
  source: Source;
  versions?: undefined;
}

export type PackageDefinition = VersionedDefinition | UnversionedDefinition;

/** Check if a definition uses versioned docs (has `versions` array). */
export function isVersioned(
  def: PackageDefinition,
): def is VersionedDefinition {
  return def.versions != null;
}

/**
 * Parse and validate a YAML definition file.
 * The registry is derived from the file's parent directory name.
 *
 * When managerDir is provided, the expected name is derived from the
 * relative path (supporting scoped packages like @trpc/server.yaml).
 * Otherwise, falls back to the immediate parent directory for registry
 * and filename for the expected name.
 */
export function loadDefinition(
  filePath: string,
  managerDir?: string,
): PackageDefinition {
  const content = readFileSync(filePath, "utf-8");
  const raw = parseYaml(content);
  const parsed = DefinitionFileSchema.parse(raw);

  const registry = managerDir
    ? basename(managerDir)
    : basename(dirname(filePath));

  // Derive expected name from relative path within managerDir
  // e.g., npm/@trpc/server.yaml → @trpc/server
  // e.g., npm/next.yaml → next
  const expectedName = managerDir
    ? relative(managerDir, filePath).replace(/\.yaml$/, "")
    : basename(filePath, ".yaml");

  if (parsed.name !== expectedName) {
    throw new Error(
      `Definition name "${parsed.name}" doesn't match filename "${expectedName}.yaml"`,
    );
  }

  return {
    ...parsed,
    registry,
  } as PackageDefinition;
}

/**
 * Scan the registry/ directory and load all definitions.
 * Supports scoped packages via @scope subdirectories (e.g., npm/@trpc/server.yaml).
 */
export function listDefinitions(registryDir: string): PackageDefinition[] {
  const definitions: PackageDefinition[] = [];

  for (const manager of readdirSync(registryDir, { withFileTypes: true })) {
    if (!manager.isDirectory()) continue;

    const managerDir = join(registryDir, manager.name);
    for (const entry of readdirSync(managerDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".yaml")) {
        definitions.push(
          loadDefinition(join(managerDir, entry.name), managerDir),
        );
      } else if (entry.isDirectory() && entry.name.startsWith("@")) {
        // Scoped package directory (e.g., @trpc/)
        const scopeDir = join(managerDir, entry.name);
        for (const file of readdirSync(scopeDir, { withFileTypes: true })) {
          if (!file.isFile() || !file.name.endsWith(".yaml")) continue;
          definitions.push(
            loadDefinition(join(scopeDir, file.name), managerDir),
          );
        }
      }
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
 * Only applicable to versioned definitions.
 */
export function resolveVersionEntry(
  definition: VersionedDefinition,
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
