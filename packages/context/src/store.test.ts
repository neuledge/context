import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PackageStore, readPackageInfo } from "./store.js";
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
      const db = new Database(path);
      db.exec("CREATE TABLE foo (id INTEGER)");
      db.close();

      expect(() => readPackageInfo(path)).toThrow("missing 'meta' table");
    });

    it("throws on missing chunks table", () => {
      const path = join(TEST_DIR, "invalid.db");
      const db = new Database(path);
      db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.close();

      expect(() => readPackageInfo(path)).toThrow("missing 'chunks' table");
    });

    it("throws on missing name in meta", () => {
      const path = join(TEST_DIR, "invalid.db");
      const db = new Database(path);
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
});
