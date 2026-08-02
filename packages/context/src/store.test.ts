import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type DatabaseConnection,
  initDatabase,
  openDatabase,
} from "./database.js";
import { getMetaValue } from "./db.js";
import {
  compareVersions,
  getPackageFileName,
  isAllowedLibrary,
  type PackageInfo,
  PackageStore,
  readPackageInfo,
} from "./store.js";
import { createTestDb, insertChunk, rebuildFtsIndex } from "./test-utils.js";

const TEST_DIR = join(tmpdir(), `context-test-${Date.now()}`);
const TEST_PACKAGE_PATH = join(TEST_DIR, "test-lib@1.0.0.db");

function createTestPackage(
  path: string,
  meta: { name?: string; version?: string; description?: string } = {},
): void {
  const db = createTestDb(path, meta);

  insertChunk(db, {
    docPath: "docs/intro.md",
    docTitle: "Introduction",
    sectionTitle: "Getting Started",
    content: "# Hello World",
    tokens: 10,
  });
  insertChunk(db, {
    docPath: "docs/api.md",
    docTitle: "API Reference",
    sectionTitle: "Functions",
    content: "## Functions\n`foo()`",
    tokens: 15,
    hasCode: 1,
  });

  rebuildFtsIndex(db);
  db.close();
}

describe("store", () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("readPackageInfo", () => {
    it("reads valid package metadata", () => {
      createTestPackage(TEST_PACKAGE_PATH, {
        name: "my-lib",
        version: "2.0.0",
        description: "A test library",
      });

      const info = readPackageInfo(TEST_PACKAGE_PATH);

      expect(info.name).toBe("my-lib");
      expect(info.version).toBe("2.0.0");
      expect(info.description).toBe("A test library");
      expect(info.sectionCount).toBe(2);
      expect(info.sizeBytes).toBeGreaterThan(0);
    });

    it("throws on missing meta table", () => {
      const path = join(TEST_DIR, "invalid.db");
      const db = openDatabase(path);
      db.exec("CREATE TABLE foo (id INTEGER)");
      db.close();

      expect(() => readPackageInfo(path)).toThrow("missing 'meta' table");
    });

    it("throws on missing chunks table", () => {
      const path = join(TEST_DIR, "invalid.db");
      const db = openDatabase(path);
      db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.close();

      expect(() => readPackageInfo(path)).toThrow("missing 'chunks' table");
    });

    it("throws on missing name in meta", () => {
      const path = join(TEST_DIR, "invalid.db");
      const db = openDatabase(path);
      db.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE chunks (id INTEGER PRIMARY KEY);
        CREATE VIRTUAL TABLE chunks_fts USING fts5(content);
        INSERT INTO meta (key, value) VALUES ('version', '1.0.0');
      `);
      db.close();

      expect(() => readPackageInfo(path)).toThrow("missing name or version");
    });
  });

  describe("getPackageFileName", () => {
    it("returns name@version.db for simple packages", () => {
      expect(getPackageFileName("react", "18.0.0")).toBe("react@18.0.0.db");
    });

    it("replaces slashes in scoped package names", () => {
      expect(getPackageFileName("@tanstack/react-query", "5.0.0")).toBe(
        "@tanstack__react-query@5.0.0.db",
      );
    });

    it("handles 'latest' as version", () => {
      expect(getPackageFileName("hono", "latest")).toBe("hono@latest.db");
    });
  });

  describe("PackageStore", () => {
    it("starts empty", () => {
      const store = new PackageStore();
      expect(store.list()).toHaveLength(0);
    });

    it("adds and retrieves packages", () => {
      createTestPackage(TEST_PACKAGE_PATH, {
        name: "test-lib",
        version: "1.0",
      });
      const info = readPackageInfo(TEST_PACKAGE_PATH);

      const store = new PackageStore();
      store.add(info);

      expect(store.list()).toHaveLength(1);
      expect(store.get("test-lib")).toEqual(info);
    });

    it("removes packages", () => {
      createTestPackage(TEST_PACKAGE_PATH, {
        name: "test-lib",
        version: "1.0",
      });
      const info = readPackageInfo(TEST_PACKAGE_PATH);

      const store = new PackageStore();
      store.add(info);
      expect(store.list()).toHaveLength(1);

      const removed = store.remove("test-lib");
      expect(removed).toBe(true);
      expect(store.list()).toHaveLength(0);
      expect(store.get("test-lib")).toBeNull();
    });

    it("returns false when removing non-existent package", () => {
      const store = new PackageStore();
      expect(store.remove("unknown")).toBe(false);
    });

    it("opens database for registered package", () => {
      createTestPackage(TEST_PACKAGE_PATH, {
        name: "test-lib",
        version: "1.0",
      });
      const info = readPackageInfo(TEST_PACKAGE_PATH);

      const store = new PackageStore();
      store.add(info);

      const db = store.openDb("test-lib");

      expect(db).not.toBeNull();
      db?.close();
    });

    it("returns null for unknown package", () => {
      const store = new PackageStore();

      expect(store.get("unknown")).toBeNull();
      expect(store.openDb("unknown")).toBeNull();
    });
  });

  describe("PackageStore with several versions installed", () => {
    /** Fake package info — these tests never touch the database file. */
    function fake(name: string, version: string): PackageInfo {
      return {
        name,
        version,
        path: `/${name}@${version}.db`,
        sizeBytes: 1,
        sectionCount: 1,
      };
    }

    // The reported case: 1.15.10 must win over 1.15.9 even though it sorts
    // lower as text, and regardless of the order readdirSync returns files in.
    it.each([
      ["oldest first", ["1.15.9", "1.15.10"]],
      ["newest first", ["1.15.10", "1.15.9"]],
    ])("resolves a bare name to the highest version (%s)", (_label, order) => {
      const store = new PackageStore();
      for (const version of order) store.add(fake("occtswift", version));

      expect(store.get("occtswift")?.version).toBe("1.15.10");
    });

    it("resolves name@version to that exact version", () => {
      const store = new PackageStore();
      store.add(fake("occtswift", "1.15.9"));
      store.add(fake("occtswift", "1.15.10"));

      expect(store.get("occtswift@1.15.9")?.version).toBe("1.15.9");
      expect(store.get("occtswift@1.15.11")).toBeNull();
    });

    it("lists every installed version, highest first", () => {
      const store = new PackageStore();
      store.add(fake("occtswift", "1.15.9"));
      store.add(fake("occtswift", "1.15.10"));
      store.add(fake("react", "18.0.0"));

      expect(store.list().map((p) => `${p.name}@${p.version}`)).toEqual([
        "occtswift@1.15.10",
        "occtswift@1.15.9",
        "react@18.0.0",
      ]);
    });

    it("prefers a release over its prereleases", () => {
      const store = new PackageStore();
      store.add(fake("next", "16.0.0"));
      store.add(fake("next", "16.0.0-canary.3"));

      expect(store.get("next")?.version).toBe("16.0.0");
      expect(store.get("next@16.0.0-canary.3")?.version).toBe(
        "16.0.0-canary.3",
      );
    });

    it("keeps unparseable versions below numeric ones", () => {
      const store = new PackageStore();
      store.add(fake("hono", "latest"));
      store.add(fake("hono", "4.0.0"));

      expect(store.get("hono")?.version).toBe("4.0.0");
      expect(store.get("hono@latest")?.version).toBe("latest");
    });

    it("picks unparseable versions deterministically when nothing is numeric", () => {
      const versions = ["main", "latest", "nightly"];
      const forward = new PackageStore();
      for (const v of versions) forward.add(fake("hono", v));
      const reversed = new PackageStore();
      for (const v of [...versions].reverse()) reversed.add(fake("hono", v));

      expect(forward.get("hono")?.version).toBe("nightly");
      expect(reversed.get("hono")?.version).toBe("nightly");
    });

    it("removes only the requested version", () => {
      const store = new PackageStore();
      store.add(fake("occtswift", "1.15.9"));
      store.add(fake("occtswift", "1.15.10"));

      expect(store.remove("occtswift@1.15.9")).toBe(true);
      expect(store.list().map((p) => p.version)).toEqual(["1.15.10"]);

      // A bare name removes the version it resolves to.
      expect(store.remove("occtswift")).toBe(true);
      expect(store.list()).toHaveLength(0);
    });

    it("opens the database of the requested version", () => {
      const oldPath = join(TEST_DIR, "test-lib@1.15.9.db");
      const newPath = join(TEST_DIR, "test-lib@1.15.10.db");
      createTestPackage(oldPath, { name: "test-lib", version: "1.15.9" });
      createTestPackage(newPath, { name: "test-lib", version: "1.15.10" });

      const store = new PackageStore();
      store.add(readPackageInfo(oldPath));
      store.add(readPackageInfo(newPath));

      const pinned = store.openDb("test-lib@1.15.9");
      expect(pinned).not.toBeNull();
      expect(getMetaValue(pinned as DatabaseConnection, "version")).toBe(
        "1.15.9",
      );
      pinned?.close();

      const preferred = store.openDb("test-lib");
      expect(getMetaValue(preferred as DatabaseConnection, "version")).toBe(
        "1.15.10",
      );
      preferred?.close();
    });
  });

  describe("isAllowedLibrary", () => {
    const pkg = { name: "react", version: "18.3.1" };

    it("matches a bare name and an exact key", () => {
      expect(isAllowedLibrary(pkg, new Set(["react"]))).toBe(true);
      expect(isAllowedLibrary(pkg, new Set(["react@18.3.1"]))).toBe(true);
    });

    it("rejects a key pinned to another version", () => {
      expect(isAllowedLibrary(pkg, new Set(["react@19.0.0"]))).toBe(false);
    });
  });

  describe("compareVersions", () => {
    it("compares segments numerically, not as text", () => {
      expect(compareVersions("1.15.9", "1.15.10")).toBeLessThan(0);
      expect(compareVersions("1.15.10", "1.15.9")).toBeGreaterThan(0);
      expect(compareVersions("2.0.0", "10.0.0")).toBeLessThan(0);
    });

    it("treats missing segments as zero and accepts a v prefix", () => {
      expect(compareVersions("1.2", "1.3.0")).toBeLessThan(0);
      expect(compareVersions("v1.3.0", "1.2.0")).toBeGreaterThan(0);
      // Numerically equal versions still order deterministically, both ways.
      expect(compareVersions("1.2", "1.2.0")).toBeLessThan(0);
      expect(compareVersions("1.2.0", "1.2")).toBeGreaterThan(0);
    });

    it("sorts prereleases below their release", () => {
      expect(compareVersions("2.0.0-rc.1", "2.0.0")).toBeLessThan(0);
      expect(compareVersions("2.0.0-rc.1", "2.0.0-rc.2")).toBeLessThan(0);
    });

    it("sorts unparseable versions below numeric ones without throwing", () => {
      expect(compareVersions("latest", "0.0.1")).toBeLessThan(0);
      expect(compareVersions("0.0.1", "main")).toBeGreaterThan(0);
      expect(compareVersions("latest", "main")).toBeLessThan(0);
    });
  });
});
