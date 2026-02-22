/**
 * Package definition schema and parser.
 * Reads YAML files from registry/<manager>/<name>.yaml and validates with Zod.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const VersionEntrySchema = z.object({
  min_version: z.string(),
  max_version: z.string().optional(),
  source: z.object({
    type: z.literal("git"),
    url: z.string().url(),
    docs_path: z.string().optional(),
    lang: z.string().default("en"),
  }),
  tag_pattern: z.string(),
});

const DefinitionSchema = z.object({
  name: z.string(),
  // npm registry package name (may differ from `name`). Defaults to `name`.
  package: z.string().optional(),
  description: z.string(),
  repository: z.string().url(),
  versions: z.array(VersionEntrySchema).min(1),
});

export type VersionEntry = z.infer<typeof VersionEntrySchema>;
export type DefinitionRaw = z.infer<typeof DefinitionSchema>;

export interface Definition extends DefinitionRaw {
  /** Package manager registry (e.g., "npm", "pip") — derived from directory name. */
  registry: string;
  /** Resolved package name for registry lookups (defaults to `name`). */
  packageName: string;
}

/**
 * Parse and validate a YAML definition file.
 * Derives `registry` from the parent directory name.
 */
export function parseDefinition(filePath: string): Definition {
  const content = readFileSync(filePath, "utf8");
  const raw = parseYaml(content);
  const parsed = DefinitionSchema.parse(raw);
  const registry = basename(dirname(filePath));
  return { ...parsed, registry, packageName: parsed.package ?? parsed.name };
}

/**
 * List all definition file paths under a registry directory.
 * Returns absolute paths sorted alphabetically.
 */
export function listDefinitionFiles(registryDir: string): string[] {
  const files: string[] = [];

  for (const manager of readdirSync(registryDir).sort()) {
    const managerPath = join(registryDir, manager);
    if (!statSync(managerPath).isDirectory()) continue;

    for (const file of readdirSync(managerPath).sort()) {
      if (!file.endsWith(".yaml")) continue;
      files.push(join(managerPath, file));
    }
  }

  return files;
}

/**
 * List all parsed definitions from a registry directory.
 */
export function listDefinitions(registryDir: string): Definition[] {
  return listDefinitionFiles(registryDir).map(parseDefinition);
}

/**
 * Find the first version entry that matches the given semver version string.
 * A version matches if: min_version <= version (and version < max_version if set).
 */
export function findMatchingVersion(
  def: Definition,
  version: string,
): VersionEntry | null {
  for (const entry of def.versions) {
    if (
      semverGte(version, entry.min_version) &&
      (entry.max_version == null || semverLt(version, entry.max_version))
    ) {
      return entry;
    }
  }
  return null;
}

/**
 * Construct a git tag from a tag_pattern and version string.
 * Replaces the `{version}` placeholder with the version string.
 */
export function buildGitTag(pattern: string, version: string): string {
  return pattern.replace("{version}", version);
}

/**
 * Compare two semver strings. Returns true if a >= b.
 * Only handles major.minor.patch (ignores pre-release labels).
 */
export function semverGte(a: string, b: string): boolean {
  return compareSemver(a, b) >= 0;
}

/**
 * Compare two semver strings. Returns true if a < b.
 */
export function semverLt(a: string, b: string): boolean {
  return compareSemver(a, b) < 0;
}

/**
 * Compare two semver strings numerically.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);

  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseSemver(v: string): [number, number, number] {
  // Strip leading 'v' if present
  const clean = v.startsWith("v") ? v.slice(1) : v;
  const parts = clean.split(".").map((p) => parseInt(p, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}
