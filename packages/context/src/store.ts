import { statSync } from "node:fs";
import Database from "better-sqlite3";
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

/**
 * Registry of documentation packages.
 * Manages an in-memory list of packages without file system operations.
 */
export class PackageStore {
  private packages = new Map<string, PackageInfo>();

  /** Add a package to the registry. */
  add(info: PackageInfo): void {
    this.packages.set(info.name, info);
  }

  /** Remove a package from the registry by name. Returns true if removed. */
  remove(name: string): boolean {
    return this.packages.delete(name);
  }

  /** Get all registered packages. */
  list(): PackageInfo[] {
    return [...this.packages.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /** Get a package by name. */
  get(name: string): PackageInfo | null {
    return this.packages.get(name) ?? null;
  }

  /** Open a package database for searching. */
  openDb(name: string): Database.Database | null {
    const pkg = this.packages.get(name);
    if (!pkg) return null;
    return new Database(pkg.path, { readonly: true });
  }
}

/** Read package info from a database file. */
export function readPackageInfo(packagePath: string): PackageInfo {
  const db = new Database(packagePath, { readonly: true });
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
