/**
 * Version discovery from package registry APIs (npm, pip).
 * Queries registries to find available versions for a definition.
 */

import type { Definition } from "./definition.js";
import { compareSemver, findMatchingVersion, semverGte } from "./definition.js";

export interface VersionInfo {
  name: string;
  registry: string;
  version: string;
}

/**
 * Prerelease label patterns to exclude.
 * Matches alpha, beta, rc, canary, dev, next, experimental, etc.
 */
const PRERELEASE_PATTERN =
  /[-.]?(alpha|beta|rc|canary|dev|next|experimental|pre|nightly)\d*/i;

function isPrerelease(version: string): boolean {
  return PRERELEASE_PATTERN.test(version);
}

/**
 * Get available versions for a definition from the appropriate registry API.
 * Filters to versions matching the defined ranges, excluding prereleases.
 * Returns the latest patch per minor version, sorted by semver descending.
 */
export async function getAvailableVersions(
  def: Definition,
  options: { since?: Date } = {},
): Promise<VersionInfo[]> {
  let versions: Array<{ version: string; publishedAt?: Date }>;

  switch (def.registry) {
    case "npm":
      versions = await fetchNpmVersions(def.packageName, options.since);
      break;
    case "pip":
      versions = await fetchPipVersions(def.packageName, options.since);
      break;
    default:
      throw new Error(`Unsupported registry: ${def.registry}`);
  }

  // Filter to versions within at least one defined range, excluding prereleases
  const matching = versions.filter(
    ({ version }) =>
      !isPrerelease(version) && findMatchingVersion(def, version) != null,
  );

  // Keep only the latest patch per minor version
  const latestByMinor = keepLatestPatchPerMinor(matching.map((v) => v.version));

  return latestByMinor.map((version) => ({
    name: def.name,
    registry: def.registry,
    version,
  }));
}

/**
 * Given a list of semver strings, return the latest patch for each major.minor pair.
 * Result is sorted by semver descending.
 */
function keepLatestPatchPerMinor(versions: string[]): string[] {
  const byMinor = new Map<string, string>();

  for (const v of versions) {
    const parts = v.replace(/^v/, "").split(".");
    const minor = `${parts[0] ?? "0"}.${parts[1] ?? "0"}`;
    const current = byMinor.get(minor);
    if (current == null || semverGte(v, current)) {
      byMinor.set(minor, v);
    }
  }

  return [...byMinor.values()].sort((a, b) => compareSemver(b, a));
}

interface NpmRegistryResponse {
  versions?: Record<string, unknown>;
  time?: Record<string, string>;
}

async function fetchNpmVersions(
  packageName: string,
  since?: Date,
): Promise<Array<{ version: string; publishedAt?: Date }>> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `npm registry error for ${packageName}: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as NpmRegistryResponse;
  const versions = Object.keys(data.versions ?? {});

  return versions
    .map((version) => {
      const publishedAtStr = data.time?.[version];
      const publishedAt = publishedAtStr ? new Date(publishedAtStr) : undefined;
      return { version, publishedAt };
    })
    .filter(({ publishedAt }) => {
      if (since == null || publishedAt == null) return true;
      return publishedAt >= since;
    });
}

interface PypiResponse {
  releases?: Record<string, Array<{ upload_time_iso_8601?: string }>>;
}

async function fetchPipVersions(
  packageName: string,
  since?: Date,
): Promise<Array<{ version: string; publishedAt?: Date }>> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `PyPI error for ${packageName}: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as PypiResponse;
  const releases = data.releases ?? {};

  return Object.entries(releases)
    .map(([version, files]) => {
      // Use the earliest upload time for this version
      const timestamps = files
        .map((f) =>
          f.upload_time_iso_8601 ? new Date(f.upload_time_iso_8601) : null,
        )
        .filter((d): d is Date => d != null);

      const publishedAt =
        timestamps.length > 0
          ? new Date(Math.min(...timestamps.map((d) => d.getTime())))
          : undefined;

      return { version, publishedAt };
    })
    .filter(({ publishedAt }) => {
      if (since == null || publishedAt == null) return true;
      return publishedAt >= since;
    });
}
