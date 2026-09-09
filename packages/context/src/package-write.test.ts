import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { loadPackages } from "./cli.js";
import { initDatabase, openDatabase } from "./database.js";
import { buildPackage } from "./package-builder.js";
import { copyPackageFile, createPackageTempFile } from "./package-file.js";
import { search } from "./search.js";
import { PackageStore, readPackageInfo } from "./store.js";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    copyFileSync: vi.fn(fs.copyFileSync),
    renameSync: vi.fn(fs.renameSync),
  };
});
vi.mock("./database.js", async (importOriginal) => {
  const database = await importOriginal<typeof import("./database.js")>();
  return { ...database, openDatabase: vi.fn(database.openDatabase) };
});
vi.mock("./store.js", async (importOriginal) => {
  const store = await importOriginal<typeof import("./store.js")>();
  return { ...store, readPackageInfo: vi.fn(store.readPackageInfo) };
});

const OPTIONS = { name: "test-lib", version: "1.0.0" };
const documents = (word: string) => [
  {
    path: "docs/guide.md",
    content: `## Guide\n\nDocumentation about ${word}.`,
  },
];
let directory: string;
let outputPath: string;
let realOpen: typeof openDatabase;
let realReadInfo: typeof readPackageInfo;

beforeAll(async () => {
  await initDatabase();
  realReadInfo = (
    await vi.importActual<typeof import("./store.js")>("./store.js")
  ).readPackageInfo;
  realOpen = (
    await vi.importActual<typeof import("./database.js")>("./database.js")
  ).openDatabase;
});
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "context-package-write-"));
  outputPath = join(directory, "test-lib@1.0.0.db");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function expectSearch(path: string, topic: string): void {
  const db = openDatabase(path, { readonly: true });
  try {
    expect(search(db, topic).results).toHaveLength(1);
  } finally {
    db.close();
  }
}

function injectFailure(stage: string): void {
  const failure = new Error(`Injected ${stage} failure`);
  if (stage === "validation") {
    vi.mocked(readPackageInfo).mockImplementationOnce(() => {
      throw failure;
    });
  } else if (stage === "replacement") {
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw failure;
    });
  } else {
    vi.mocked(openDatabase).mockImplementationOnce((path, options) => {
      if (stage === "initialization") throw failure;
      const db = realOpen(path, options);
      if (stage === "chunk insertion") {
        const prepare = db.prepare.bind(db);
        vi.spyOn(db, "prepare").mockImplementation((sql) => {
          const stmt = prepare(sql);
          if (sql.includes("INSERT INTO chunks")) {
            vi.spyOn(stmt, "run").mockImplementation(() => {
              throw failure;
            });
          }
          return stmt;
        });
      } else if (stage === "close") {
        const close = db.close.bind(db);
        vi.spyOn(db, "close").mockImplementation(() => {
          close();
          throw failure;
        });
      } else {
        const exec = db.exec.bind(db);
        vi.spyOn(db, "exec").mockImplementation((sql) => {
          exec(sql);
          if (
            (stage === "FTS creation" &&
              sql.includes("CREATE VIRTUAL TABLE")) ||
            (stage === "FTS indexing" && sql.includes("VALUES('rebuild')"))
          ) {
            throw failure;
          }
        });
      }
      return db;
    });
  }
}

describe.each([
  false,
  true,
])("package build (existing installation: %s)", (existing) => {
  it.each([
    "initialization",
    "FTS creation",
    "chunk insertion",
    "FTS indexing",
    "close",
    "validation",
    "replacement",
  ])("preserves the installed state after a failure during %s", (stage) => {
    if (existing) buildPackage(outputPath, documents("original"), OPTIONS);
    const original = existing ? readFileSync(outputPath) : undefined;
    injectFailure(stage);

    expect(() =>
      buildPackage(outputPath, documents("replacement"), OPTIONS),
    ).toThrow(`Injected ${stage} failure`);
    expect(readdirSync(directory)).toEqual(
      existing ? ["test-lib@1.0.0.db"] : [],
    );
    if (original) {
      expect(readFileSync(outputPath)).toEqual(original);
      expectSearch(outputPath, "original");
      expect(readPackageInfo(outputPath).sectionCount).toBe(1);
    }
  });

  it("installs a complete, searchable package and removes staging files", () => {
    if (existing) buildPackage(outputPath, documents("original"), OPTIONS);
    const result = buildPackage(outputPath, documents("replacement"), OPTIONS);
    expect(result.path).toBe(outputPath);
    expect(result.sectionCount).toBe(1);
    expectSearch(outputPath, "replacement");
    expect(readdirSync(directory)).toEqual(["test-lib@1.0.0.db"]);
  });
});

it("keeps the installed package visible during writing and closes before validation", () => {
  buildPackage(outputPath, documents("original"), OPTIONS);
  const original = readFileSync(outputPath);
  let writerClosed = false;
  let observations = 0;
  vi.mocked(openDatabase).mockImplementationOnce((path, options) => {
    const db = realOpen(path, options);
    const exec = db.exec.bind(db);
    const close = db.close.bind(db);
    vi.spyOn(db, "exec").mockImplementation((sql) => {
      exec(sql);
      const store = new PackageStore();
      loadPackages(store, directory);
      expect(store.list().map((pkg) => pkg.sectionCount)).toEqual([1]);
      expect(readFileSync(outputPath)).toEqual(original);
      observations++;
    });
    vi.spyOn(db, "close").mockImplementation(() => {
      close();
      writerClosed = true;
    });
    return db;
  });
  vi.mocked(readPackageInfo).mockImplementation((path) => {
    if (path !== outputPath) expect(writerClosed).toBe(true);
    return realReadInfo(path);
  });

  buildPackage(outputPath, documents("replacement"), OPTIONS);
  expect(observations).toBeGreaterThanOrEqual(2);
  expectSearch(outputPath, "replacement");
});

it("does not discover staged packages, even after they become valid databases", () => {
  const temp = createPackageTempFile(directory);
  try {
    buildPackage(temp.path, documents("replacement"), OPTIONS);
    const store = new PackageStore();
    loadPackages(store, directory);
    expect(store.list()).toEqual([]);
    temp.install();
    loadPackages(store, directory);
    expect(store.list().map((pkg) => pkg.path)).toEqual([outputPath]);
  } finally {
    temp.cleanup();
  }
  expect(readdirSync(directory)).toEqual(["test-lib@1.0.0.db"]);
});

it.each([
  "EPERM",
  "EBUSY",
])("preserves the old package when rename fails with %s", (code) => {
  buildPackage(outputPath, documents("original"), OPTIONS);
  const original = readFileSync(outputPath);
  vi.mocked(renameSync).mockImplementationOnce(() => {
    throw Object.assign(new Error("Destination is in use"), { code });
  });
  expect(() =>
    buildPackage(outputPath, documents("replacement"), OPTIONS),
  ).toThrow("Destination is in use");
  expect(readFileSync(outputPath)).toEqual(original);
  expectSearch(outputPath, "original");
  expect(readdirSync(directory)).toEqual(["test-lib@1.0.0.db"]);
});

it("keeps an open reader usable during replacement or an OS sharing violation", () => {
  buildPackage(outputPath, documents("original"), OPTIONS);
  const original = readFileSync(outputPath);
  const reader = openDatabase(outputPath, { readonly: true });
  try {
    expect(search(reader, "original").results).toHaveLength(1);
    try {
      buildPackage(outputPath, documents("replacement"), OPTIONS);
      expectSearch(outputPath, "replacement");
    } catch (error) {
      // SQLite handles may prohibit replacement on Windows. That failure must
      // preserve the installed file; never work around it by deleting first.
      expect(process.platform).toBe("win32");
      expect(["EPERM", "EACCES", "EBUSY"]).toContain(
        (error as NodeJS.ErrnoException).code,
      );
      expect(readFileSync(outputPath)).toEqual(original);
    }
    expect(search(reader, "original").results).toHaveLength(1);
  } finally {
    reader.close();
  }
  buildPackage(outputPath, documents("replacement"), OPTIONS);
  expectSearch(outputPath, "replacement");
  expect(readdirSync(directory)).toEqual(["test-lib@1.0.0.db"]);
});

it.each([
  false,
  true,
])("cleans up a partial copy (existing installation: %s)", (existing) => {
  if (existing) buildPackage(outputPath, documents("original"), OPTIONS);
  const original = existing ? readFileSync(outputPath) : undefined;
  vi.mocked(copyFileSync).mockImplementationOnce((_source, destination) => {
    writeFileSync(destination, "partial database");
    throw new Error("Copy interrupted");
  });
  expect(() => copyPackageFile("source.db", outputPath)).toThrow(
    "Copy interrupted",
  );
  expect(readdirSync(directory)).toEqual(existing ? ["test-lib@1.0.0.db"] : []);
  if (original) expect(readFileSync(outputPath)).toEqual(original);
});

it("rejects an invalid staged database and cleans up its SQLite artifacts", () => {
  const temp = createPackageTempFile(directory);
  try {
    writeFileSync(temp.path, "invalid database");
    writeFileSync(`${temp.path}-journal`, "leftover journal");
    expect(() => temp.install(outputPath)).toThrow();
    expect(existsSync(outputPath)).toBe(false);
  } finally {
    temp.cleanup();
  }
  expect(readdirSync(directory)).toEqual([]);
});
