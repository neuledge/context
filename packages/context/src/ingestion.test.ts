import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { parseDocument } from "./build.js";
import { initDatabase, openDatabase } from "./database.js";
import { readLocalDocsFiles } from "./git.js";
import { type IngestionDiagnostic, IngestionError } from "./ingestion.js";
import { buildPackage } from "./package-builder.js";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    readFileSync: vi.fn(fs.readFileSync),
    readdirSync: vi.fn(fs.readdirSync),
  };
});
vi.mock("./build.js", async (original) => {
  const build = await original<typeof import("./build.js")>();
  return { ...build, parseDocument: vi.fn(build.parseDocument) };
});

const fixtures = resolve(import.meta.dirname, "fixtures/ingestion");
const options = { name: "ingestion-fixture", version: "1" };
let directory: string;
let output: string;

beforeAll(async () => {
  await initDatabase();
});
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "context-ingestion-"));
  output = join(directory, "package.db");
  mkdirSync(join(directory, "docs"));
});
afterEach(() => {
  vi.resetAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

it("reports distinct source and parser outcomes while preserving headings and examples", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const build =
    await vi.importActual<typeof import("./build.js")>("./build.js");
  for (const extension of ["md", "html", "rst"]) {
    copyFileSync(
      join(fixtures, `guide.${extension}`),
      join(directory, "docs", `guide.${extension}`),
    );
  }
  copyFileSync(
    join(fixtures, "guide.md"),
    join(directory, "docs", "z-duplicate.md"),
  );
  writeFileSync(join(directory, ".gitignore"), "ignored.md\n");
  for (const file of [
    "ignored.md",
    ".hidden.md",
    "unreadable.md",
    "broken.md",
  ]) {
    writeFileSync(
      join(directory, "docs", file),
      `## ${file}\n\nUnique documentation for ${file}.`,
    );
  }
  writeFileSync(join(directory, "docs", "empty.md"), "");
  writeFileSync(
    join(directory, "docs", "source.ts"),
    "export const unrelated = 1;",
  );
  mkdirSync(join(directory, "docs", "de"));
  mkdirSync(join(directory, "docs", "unreadable"));
  const denied = () =>
    Object.assign(new Error("Permission denied"), { code: "EACCES" });
  vi.mocked(readFileSync).mockImplementation((path, opts) => {
    if (basename(String(path)) === "unreadable.md") throw denied();
    return fs.readFileSync(path, opts);
  });
  vi.mocked(readdirSync).mockImplementation((path, opts) => {
    if (basename(String(path)) === "unreadable") throw denied();
    return fs.readdirSync(path, opts);
  });
  vi.mocked(parseDocument).mockImplementation((content, path) => {
    if (path.endsWith("broken.md")) throw new Error("Parser rejected document");
    return build.parseDocument(content, path);
  });

  const diagnostics: IngestionDiagnostic[] = [];
  const files = readLocalDocsFiles(directory, { path: "docs", diagnostics });
  const result = buildPackage(output, files, { ...options, diagnostics });
  expect(result.skippedFiles).toBe(1);
  expect(result.diagnostics.summary).toEqual({
    discoveredFiles: 9,
    selectedFiles: 6,
    indexedDocuments: 3,
    indexedSections: result.sectionCount,
    excludedFiles: 2,
    excludedDirectories: 1,
    duplicateFiles: 1,
    unreadableFiles: 1,
    unreadableDirectories: 1,
    parseFailures: 1,
    emptyFiles: 1,
  });
  expect(result.diagnostics.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "docs/ignored.md",
        outcome: "excluded",
        reason: "gitignore",
      }),
      expect.objectContaining({
        path: "docs/de",
        kind: "directory",
        outcome: "excluded",
        reason: "language-filter",
      }),
      expect.objectContaining({
        path: "docs/z-duplicate.md",
        outcome: "duplicate",
        duplicateOf: "docs/guide.md",
      }),
      expect.objectContaining({
        path: "docs/unreadable.md",
        outcome: "read-error",
        reason: "EACCES",
      }),
      expect.objectContaining({
        path: "docs/unreadable",
        kind: "directory",
        outcome: "read-error",
      }),
      expect.objectContaining({
        path: "docs/broken.md",
        outcome: "parse-error",
        reason: "Parser rejected document",
      }),
      expect.objectContaining({ path: "docs/empty.md", outcome: "empty" }),
    ]),
  );
  expect(JSON.stringify(result.diagnostics)).not.toContain(directory);
  expect(
    result.diagnostics.entries.some((entry) =>
      entry.path.endsWith("source.ts"),
    ),
  ).toBe(false);
  const db = openDatabase(output, { readonly: true });
  try {
    for (const [extension, title, example] of [
      ["md", "Configure Markdown", "run-markdown-example --port 8080"],
      ["html", "Configure HTML", "run-html-example --port 8081"],
      ["rst", "Configure RST", "run-rst-example --port 8082"],
    ] as const) {
      expect(
        db
          .prepare(
            "SELECT section_title, content FROM chunks WHERE doc_path = ?",
          )
          .all(`docs/guide.${extension}`),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            section_title: title,
            content: expect.stringContaining(example),
          }),
        ]),
      );
    }
  } finally {
    db.close();
  }
});

it.each([
  "read-error",
  "parse-error",
  "empty",
] as const)("strict validation rejects %s without replacing an installed package", (outcome) => {
  const valid = {
    path: "guide.md",
    content: "## Guide\n\nOriginal installed documentation.",
  };
  buildPackage(output, [valid], options);
  const original = readFileSync(output);
  const diagnostics: IngestionDiagnostic[] =
    outcome === "read-error"
      ? [{ path: "missing.md", kind: "file", outcome, reason: "ENOENT" }]
      : [];
  const files =
    outcome === "read-error"
      ? [valid]
      : [
          valid,
          {
            path: "bad.md",
            content:
              outcome === "empty" ? "" : (undefined as unknown as string),
          },
        ];
  expect(() =>
    buildPackage(output, files, { ...options, diagnostics, strict: true }),
  ).toThrow(IngestionError);
  expect(readFileSync(output)).toEqual(original);
});

it("strict validation rejects unreadable directories even when no files were discovered", () => {
  expect(() =>
    buildPackage(output, [], {
      ...options,
      strict: true,
      diagnostics: [
        {
          path: "docs",
          kind: "directory",
          outcome: "read-error",
          reason: "EACCES",
        },
      ],
    }),
  ).toThrow(IngestionError);
  expect(existsSync(output)).toBe(false);
});

it("allows intentional exclusions and duplicates in strict mode, counting only inserted sections", () => {
  const content =
    "## Guide\n\nIntentional duplicate content is not document loss.";
  const result = buildPackage(
    output,
    [
      { path: "a.md", content },
      { path: "b.md", content },
    ],
    {
      ...options,
      strict: true,
      diagnostics: [
        {
          path: "ignored.md",
          kind: "file",
          outcome: "excluded",
          reason: "exclude_paths",
        },
      ],
    },
  );
  expect(result.diagnostics.summary).toMatchObject({
    discoveredFiles: 3,
    selectedFiles: 1,
    indexedDocuments: 1,
    indexedSections: 1,
    excludedFiles: 1,
    duplicateFiles: 1,
  });
  expect(result.diagnostics.entries).toContainEqual({
    path: "b.md",
    kind: "file",
    outcome: "duplicate",
    reason: "All sections duplicate earlier content",
    duplicateOf: "a.md",
  });
});

it("writes context add reports on success and strict failure without changing the installed package", () => {
  const home = join(directory, "isolated-user");
  const preload = join(directory, "isolated-os.mjs");
  // Override homedir only inside the test child; never touch the user's packages.
  writeFileSync(
    preload,
    `import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module'; os.homedir = () => ${JSON.stringify(home)}; syncBuiltinESMExports();`,
  );
  copyFileSync(join(fixtures, "guide.md"), join(directory, "docs", "guide.md"));
  writeFileSync(join(directory, "docs", "empty.md"), "");
  const report = join(directory, "report.json");
  const args = [
    "--import",
    pathToFileURL(preload).href,
    resolve(import.meta.dirname, "../dist/cli.js"),
    "add",
    directory,
    "--path",
    "docs",
    "--name",
    "fixture",
    "--pkg-version",
    "1",
    "--diagnostics",
    report,
  ];
  const normal = spawnSync(process.execPath, args, { encoding: "utf8" });
  expect(normal.status, normal.stderr).toBe(0);
  expect(normal.stdout).toContain("Ingestion:");
  expect(JSON.parse(readFileSync(report, "utf8")).summary).toMatchObject({
    discoveredFiles: 2,
    indexedDocuments: 1,
    emptyFiles: 1,
  });
  const installed = join(home, ".context", "packages", "fixture@1.db");
  const original = readFileSync(installed);
  const strict = spawnSync(process.execPath, [...args, "--strict"], {
    encoding: "utf8",
  });
  expect(strict.status).toBe(1);
  expect(strict.stderr).toContain("Strict ingestion validation failed");
  expect(readFileSync(installed)).toEqual(original);
  expect(JSON.parse(readFileSync(report, "utf8")).entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "docs/empty.md", outcome: "empty" }),
    ]),
  );
}, 15_000);
