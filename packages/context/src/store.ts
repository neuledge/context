import { statSync } from "node:fs";
import { type DatabaseConnection, openDatabase } from "./database.js";
import { getMetaValue, getSectionCount, validatePackageSchema } from "./db.js";

export interface PackageMeta {
  name: string;
  version: string;
  description?: string;
  sourceUrl?: string;
}

export interface PackageInfo extends PackageMeta {
  path: string;
  sizeBytes: number;
  sectionCount: number;
}

/** Create a filesystem-safe filename for an installed package database. */
export function getPackageFileName(name: string, version: string): string {
  const safeName = name.replaceAll("/", "__");
  const safeVersion = version.replaceAll("/", "__");
  return `${safeName}@${safeVersion}.db`;
}

/** Identity of an installed package, and the spec users type: `name@version`. */
export function packageKey(pkg: PackageMeta): string {
  return `${pkg.name}@${pkg.version}`;
}

/**
 * Match a package against a `--libs` allow-list holding bare names (every
 * installed version) and `name@version` keys (that version only).
 */
export function isAllowedLibrary(
  pkg: PackageMeta,
  allowed: ReadonlySet<string>,
): boolean {
  return allowed.has(pkg.name) || allowed.has(packageKey(pkg));
}

/** Numeric segments of a version plus its prerelease suffix, or null if not numeric. */
function parseVersionParts(
  version: string,
): { numbers: number[]; prerelease: string } | null {
  const core = version.startsWith("v") ? version.slice(1) : version;
  const dash = core.indexOf("-");
  const segments = (dash === -1 ? core : core.slice(0, dash)).split(".");
  if (!segments.every((s) => /^\d+$/.test(s))) return null;

  return {
    numbers: segments.map((s) => Number.parseInt(s, 10)),
    prerelease: dash === -1 ? "" : core.slice(dash + 1),
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Order two version strings, lowest first.
 *
 * Rules, all chosen so a bare-name lookup lands on the version a user expects:
 * - segments compare as numbers, so `1.15.9` < `1.15.10` (text order gets this
 *   backwards — the bug behind #102);
 * - a missing segment counts as zero, so `1.2` and `1.2.0` are the same release;
 * - a prerelease sorts below its release (`2.0.0-rc.1` < `2.0.0`); two
 *   prereleases compare as text;
 * - versions with no numeric part (`latest`, `main`) sort below every numeric
 *   version, so a floating label never hides a real release;
 * - anything still tied falls back to text, so results never depend on
 *   insertion or filesystem order.
 */
export function compareVersions(a: string, b: string): number {
  const partsA = parseVersionParts(a);
  const partsB = parseVersionParts(b);
  if (!partsA || !partsB) {
    if (partsA) return 1;
    if (partsB) return -1;
    return compareText(a, b);
  }

  const length = Math.max(partsA.numbers.length, partsB.numbers.length);
  for (let i = 0; i < length; i++) {
    const diff = (partsA.numbers[i] ?? 0) - (partsB.numbers[i] ?? 0);
    if (diff !== 0) return diff;
  }

  if (partsA.prerelease !== partsB.prerelease) {
    if (!partsA.prerelease) return 1;
    if (!partsB.prerelease) return -1;
    return compareText(partsA.prerelease, partsB.prerelease);
  }

  return compareText(a, b);
}

/**
 * Registry of documentation packages.
 * Manages an in-memory list of packages without file system operations.
 */
export class PackageStore {
  // Keyed by `name@version`: several versions of the same package can be
  // installed side by side, and each one has to stay addressable.
  private packages = new Map<string, PackageInfo>();

  /** Add a package to the registry. Replaces the same name@version only. */
  add(info: PackageInfo): void {
    this.packages.set(packageKey(info), info);
  }

  /** Remove a package resolved from `spec` (see `get`). Returns true if removed. */
  remove(spec: string): boolean {
    const pkg = this.get(spec);
    if (!pkg) return false;
    return this.packages.delete(packageKey(pkg));
  }

  /** Get all registered packages, grouped by name with the highest version first. */
  list(): PackageInfo[] {
    return [...this.packages.values()].sort(
      (a, b) =>
        a.name.localeCompare(b.name) || compareVersions(b.version, a.version),
    );
  }

  /**
   * Get a package by spec: `name@version` returns that exact version, a bare
   * `name` returns the highest installed version.
   */
  get(spec: string): PackageInfo | null {
    const exact = this.packages.get(spec);
    if (exact) return exact;

    let best: PackageInfo | null = null;
    for (const pkg of this.packages.values()) {
      if (pkg.name !== spec) continue;
      if (!best || compareVersions(pkg.version, best.version) > 0) best = pkg;
    }
    return best;
  }

  /** Open a package database for searching. Accepts the same specs as `get`. */
  openDb(spec: string): DatabaseConnection | null {
    const pkg = this.get(spec);
    if (!pkg) return null;
    return openDatabase(pkg.path, { readonly: true });
  }
}

/** Read package info from a database file. */
export function readPackageInfo(packagePath: string): PackageInfo {
  const db = openDatabase(packagePath, { readonly: true });
  try {
    validatePackageSchema(db);

    const name = getMetaValue(db, "name");
    const version = getMetaValue(db, "version");

    if (!name || !version) {
      throw new Error("Invalid package: missing name or version in meta table");
    }

    return {
      name,
      version,
      description: getMetaValue(db, "description"),
      sourceUrl: getMetaValue(db, "source_url"),
      path: packagePath,
      sizeBytes: statSync(packagePath).size,
      sectionCount: getSectionCount(db),
    };
  } finally {
    db.close();
  }
}
