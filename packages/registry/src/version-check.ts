/**
 * Version discovery from package registry APIs (npm, pip, maven, hex, go).
 *
 * Queries public registry APIs to find available versions,
 * filters to defined ranges, and deduplicates to latest-patch-per-minor.
 */

import pRetry, { AbortError } from "p-retry";
import {
  compareSemver,
  isVersioned,
  isZipVersionEntry,
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
  maven: fetchMavenVersions,
  hex: fetchHexVersions,
  go: fetchGoVersions,
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
  options: { since?: number; latest?: number } = {},
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
    // For registries without API fetchers (e.g., python, java),
    // extract versions from zip version entries directly
    const explicitVersions: AvailableVersion[] = [];
    for (const entry of definition.versions) {
      if (isZipVersionEntry(entry)) {
        for (const v of entry.versions) {
          explicitVersions.push({
            name: definition.name,
            registry: definition.registry,
            version: v,
          });
        }
      }
    }
    if (explicitVersions.length > 0) return explicitVersions;

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

  // Sort by semver descending (newest first)
  latestPerMinor.sort((a, b) => compareSemver(b.version, a.version));

  // Limit to N most recent minor versions per package
  const limited = options.latest
    ? latestPerMinor.slice(0, options.latest)
    : latestPerMinor;

  return limited.map((v) => ({
    name: definition.name,
    registry: definition.registry,
    version: v.version,
    publishedAt: v.publishedAt,
  }));
}

async function fetchNpmVersions(packageName: string): Promise<VersionInfo[]> {
  const res = await fetchWithRetry(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
    `npm registry`,
    packageName,
  );

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
  const res = await fetchWithRetry(
    `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`,
    `PyPI`,
    packageName,
  );

  const data = (await res.json()) as {
    releases?: Record<string, Array<{ upload_time_iso_8601?: string }>>;
  };

  const releases = data.releases ?? {};

  return Object.entries(releases).map(([version, files]) => ({
    version,
    publishedAt: files[0]?.upload_time_iso_8601,
  }));
}

/**
 * Fetch versions from Maven Central using the search API.
 * Package name format: "groupId:artifactId" (e.g., "org.springframework.boot:spring-boot").
 */
async function fetchMavenVersions(packageName: string): Promise<VersionInfo[]> {
  const [groupId, artifactId] = packageName.split(":");
  if (!groupId || !artifactId) {
    throw new Error(
      `Invalid Maven package name "${packageName}": expected "groupId:artifactId"`,
    );
  }

  const query = `g:${groupId}+AND+a:${artifactId}`;
  const res = await fetchWithRetry(
    `https://search.maven.org/solrsearch/select?q=${query}&core=gav&rows=200&wt=json`,
    `Maven Central`,
    packageName,
  );

  const data = (await res.json()) as {
    response?: {
      docs?: Array<{ v?: string; timestamp?: number }>;
    };
  };

  const docs = data.response?.docs ?? [];

  return docs.map((doc) => ({
    version: doc.v ?? "",
    publishedAt: doc.timestamp
      ? new Date(doc.timestamp).toISOString()
      : undefined,
  }));
}

/**
 * Fetch versions from Hex.pm API.
 * Package names are lowercase with underscores (e.g., "phoenix", "phoenix_live_view").
 */
async function fetchHexVersions(packageName: string): Promise<VersionInfo[]> {
  const res = await fetchWithRetry(
    `https://hex.pm/api/packages/${encodeURIComponent(packageName)}`,
    `Hex`,
    packageName,
  );

  const data = (await res.json()) as {
    releases?: Array<{ version?: string; inserted_at?: string }>;
  };

  const releases = data.releases ?? [];

  return releases.map((r) => ({
    version: r.version ?? "",
    publishedAt: r.inserted_at,
  }));
}

/**
 * Go modules, via the module proxy (https://proxy.golang.org).
 *
 * `packageName` is the full module path (e.g. "github.com/spf13/cobra"), which
 * is also the definition's `name`. Three things differ from the other fetchers:
 *
 * - **Case escaping.** The proxy requires uppercase letters to be written as
 *   "!" + lowercase, so "github.com/BurntSushi/toml" is requested as
 *   "github.com/!burnt!sushi/toml". The unescaped path 404s. Slashes are path
 *   separators and must NOT be percent-encoded, so encodeURIComponent is wrong
 *   here.
 * - **The "v" prefix is stripped.** Go tags are "v1.10.2"; this returns
 *   "1.10.2" so the shared `isPrerelease` and `compareSemver` keep working
 *   (both misread a leading "v" — isPrerelease sees a letter and discards the
 *   version, compareSemver returns NaN). Definitions restore it with the
 *   default tag_pattern "v{version}".
 * - **No publish dates.** /@v/list returns bare versions. Dates need one
 *   /@v/<version>.info request each, so `--since` filtering is unavailable
 *   rather than expensive. publishedAt is left undefined.
 *
 * The response is plain text, one version per line, in no particular order,
 * and is empty for a module with no tagged releases.
 */
function escapeGoModulePath(modulePath: string): string {
  return modulePath.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
}

async function fetchGoVersions(packageName: string): Promise<VersionInfo[]> {
  const res = await fetchWithRetry(
    `https://proxy.golang.org/${escapeGoModulePath(packageName)}/@v/list`,
    `Go module proxy`,
    packageName,
  );

  const body = await res.text();

  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("v"))
    .map((version) => ({ version: version.slice(1) }));
}

/**
 * Public registries occasionally return 504/503 under load. Retry 5xx and
 * network errors with exponential backoff; 4xx aborts immediately.
 */
function fetchWithRetry(
  url: string,
  registryLabel: string,
  packageName: string,
): Promise<Response> {
  return pRetry(
    async () => {
      const res = await fetch(url);
      if (res.ok) return res;
      const error = new Error(
        `${registryLabel} returned ${res.status} for ${packageName}`,
      );
      if (res.status < 500) throw new AbortError(error);
      throw error;
    },
    { retries: 3 },
  );
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
