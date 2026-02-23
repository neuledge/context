/**
 * Version discovery from package registry APIs (npm, pip).
 *
 * Queries public registry APIs to find available versions,
 * filters to defined ranges, and deduplicates to latest-patch-per-minor.
 */

import {
  compareSemver,
  isVersioned,
  type PackageDefinition,
  resolveVersionEntry,
} from "./definition.js";

export interface AvailableVersion {
  name: string;
  registry: string;
  version: string;
  publishedAt?: string;
}

type RegistryFetcher = (packageName: string) => Promise<VersionInfo[]>;

interface VersionInfo {
  version: string;
  publishedAt?: string;
}

const registryFetchers: Record<string, RegistryFetcher> = {
  npm: fetchNpmVersions,
  pip: fetchPipVersions,
};

/**
 * Discover available versions for a package definition.
 *
 * For versioned definitions: queries the appropriate registry API,
 * filters to defined ranges, removes prereleases, and keeps only
 * the latest patch per minor.
 *
 * For unversioned definitions: returns a single "latest" entry
 * (no registry API call needed — docs are always built from HEAD).
 */
export async function discoverVersions(
  definition: PackageDefinition,
  options: { since?: number } = {},
): Promise<AvailableVersion[]> {
  // Unversioned definitions always have a single "latest" version
  if (!isVersioned(definition)) {
    return [
      {
        name: definition.name,
        registry: definition.registry,
        version: "latest",
      },
    ];
  }

  const fetcher = registryFetchers[definition.registry];
  if (!fetcher) {
    throw new Error(`Unsupported registry: ${definition.registry}`);
  }

  const allVersions = await fetcher(definition.name);

  // Filter by publish date if --since is set
  const sinceDate = options.since
    ? new Date(Date.now() - options.since * 24 * 60 * 60 * 1000)
    : undefined;

  const filtered = allVersions.filter((v) => {
    // Skip prereleases
    if (isPrerelease(v.version)) return false;

    // Must match a defined version range
    if (!resolveVersionEntry(definition, v.version)) return false;

    // Filter by publish date
    if (sinceDate && v.publishedAt) {
      if (new Date(v.publishedAt) < sinceDate) return false;
    }

    return true;
  });

  // Keep only latest patch per minor version
  const latestPerMinor = deduplicateToLatestPatch(filtered);

  // Sort by semver descending
  latestPerMinor.sort((a, b) => compareSemver(b.version, a.version));

  return latestPerMinor.map((v) => ({
    name: definition.name,
    registry: definition.registry,
    version: v.version,
    publishedAt: v.publishedAt,
  }));
}

async function fetchNpmVersions(packageName: string): Promise<VersionInfo[]> {
  const res = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
  );
  if (!res.ok) {
    throw new Error(`npm registry returned ${res.status} for ${packageName}`);
  }

  const data = (await res.json()) as {
    versions?: Record<string, unknown>;
    time?: Record<string, string>;
  };

  const versions = Object.keys(data.versions ?? {});
  const time = data.time ?? {};

  return versions.map((v) => ({
    version: v,
    publishedAt: time[v],
  }));
}

async function fetchPipVersions(packageName: string): Promise<VersionInfo[]> {
  const res = await fetch(
    `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`,
  );
  if (!res.ok) {
    throw new Error(`PyPI returned ${res.status} for ${packageName}`);
  }

  const data = (await res.json()) as {
    releases?: Record<string, Array<{ upload_time_iso_8601?: string }>>;
  };

  const releases = data.releases ?? {};

  return Object.entries(releases).map(([version, files]) => ({
    version,
    publishedAt: files[0]?.upload_time_iso_8601,
  }));
}

function isPrerelease(version: string): boolean {
  return (
    /[-+]/.test(version) || /[a-z]/i.test(version.replace(/^\d+\.\d+\.\d+/, ""))
  );
}

/**
 * Keep only the latest patch for each major.minor combination.
 */
function deduplicateToLatestPatch(versions: VersionInfo[]): VersionInfo[] {
  const byMinor = new Map<string, VersionInfo>();

  for (const v of versions) {
    const parts = v.version.split(".");
    const minorKey = `${parts[0]}.${parts[1]}`;

    const existing = byMinor.get(minorKey);
    if (!existing || compareSemver(v.version, existing.version) > 0) {
      byMinor.set(minorKey, v);
    }
  }

  return [...byMinor.values()];
}
