import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildPackage,
  type IngestionDiagnostic,
  IngestionError,
  initDatabase,
} from "@neuledge/context";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { buildFromDefinition } from "./build.js";
import type { VersionedDefinition } from "./definition.js";
import { downloadHtmlIndex } from "./html-index.js";

let directory: string;
beforeAll(async () => {
  await initDatabase();
});
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "registry-ingestion-"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

/** Small stored ZIP fixture, without compression or third-party tooling. */
function zip(files: Record<string, string>): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path);
    const content = Buffer.from(text);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, content);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt32LE(content.length, 20);
    entry.writeUInt32LE(content.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + content.length;
  }
  const index = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, index, end]));
}

it("carries ZIP exclusions, duplicate sections and empty documents into the build report", async () => {
  const content = "## ZIP Guide\n\nRun the archived documentation example.";
  const archive = zip({
    "docs/guide.md": content,
    "docs/alias.md": content,
    "docs/excluded.md": "Intentionally excluded.",
    "docs/empty.md": "",
    "docs/search.html": "Generated navigation.",
    "docs/source.ts": "Unrelated source code.",
    "outside.md": "Outside selected docs_path.",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(archive)),
  );
  const definition: VersionedDefinition = {
    registry: "test",
    name: "zip-docs",
    versions: [
      {
        versions: ["1"],
        source: {
          type: "zip",
          url: "https://fixture.example/docs.zip",
          docs_path: "docs",
          exclude_paths: ["excluded.md"],
          lang: "en",
        },
      },
    ],
  };
  const result = await buildFromDefinition(definition, "1", directory);
  expect(result.diagnostics.summary).toMatchObject({
    discoveredFiles: 5,
    selectedFiles: 2,
    indexedDocuments: 1,
    indexedSections: 1,
    duplicateFiles: 1,
    excludedFiles: 2,
    emptyFiles: 1,
  });
  expect(result.diagnostics.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "excluded.md",
        outcome: "excluded",
        reason: "exclude_paths",
      }),
      expect.objectContaining({
        path: "search.html",
        outcome: "excluded",
        reason: "generated-navigation",
      }),
      expect.objectContaining({
        path: "alias.md",
        outcome: "duplicate",
        duplicateOf: "guide.md",
      }),
    ]),
  );
  const original = readFileSync(result.path);
  await expect(
    buildFromDefinition(definition, "1", directory, { strict: true }),
  ).rejects.toBeInstanceOf(IngestionError);
  expect(readFileSync(result.path)).toEqual(original);
});

it("uses the same outcomes for HTML index exclusions, aliases and empty pages", async () => {
  const page =
    "<h1>HTML reference</h1><h2>Example</h2><p>Run the HTML example to configure the service.</p>";
  const pages: Record<string, string> = {
    "/docs/1/":
      '<a href="a.html">Guide</a><a href="b.html">Alias</a><a href="empty.html">Empty</a><a href="excluded.html">Excluded</a><a href="excluded.html#again">Repeated excluded link</a>',
    "/docs/1/a.html": page,
    "/docs/1/b.html": page,
    "/docs/1/empty.html": "<html><body></body></html>",
  };
  const fetchMock = vi.fn(
    async (url: URL) =>
      new Response(pages[url.pathname], {
        headers: { "content-type": "text/html" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const diagnostics: IngestionDiagnostic[] = [];
  const files = await downloadHtmlIndex(
    {
      type: "html-index",
      url: "https://fixture.example/docs/{version}/",
      exclude_paths: ["excluded.html"],
      max_pages: 10,
      concurrency: 2,
    },
    "1",
    { cacheDir: join(directory, "cache"), diagnostics },
  );
  const result = buildPackage(join(directory, "html.db"), files, {
    name: "html-docs",
    version: "1",
    diagnostics,
  });
  expect(result.diagnostics.summary).toMatchObject({
    discoveredFiles: 4,
    selectedFiles: 2,
    indexedDocuments: 1,
    duplicateFiles: 1,
    excludedFiles: 1,
    emptyFiles: 1,
  });
  expect(result.diagnostics.entries).toContainEqual({
    path: "b.html",
    kind: "file",
    outcome: "duplicate",
    reason: "Identical document content",
    duplicateOf: "a.html",
  });
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it("keeps failed HTML downloads fatal and attaches their relative path", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) =>
      url.pathname.endsWith("missing.html")
        ? new Response("Missing", { status: 404 })
        : new Response('<a href="missing.html">Missing</a>', {
            headers: { "content-type": "text/html" },
          }),
    ),
  );
  await expect(
    downloadHtmlIndex(
      {
        type: "html-index",
        url: "https://fixture.example/docs/{version}/",
        max_pages: 10,
        concurrency: 1,
      },
      "1",
      { cacheDir: join(directory, "cache") },
    ),
  ).rejects.toMatchObject({
    diagnostics: {
      entries: [
        expect.objectContaining({
          path: "missing.html",
          kind: "file",
          outcome: "read-error",
        }),
      ],
    },
  });
});

it("writes CLI JSON diagnostics for Git builds and strict failures without changing the package", () => {
  const repository = join(directory, "source");
  const definitions = join(directory, "registry");
  const output = join(directory, "output");
  const report = join(directory, "report.json");
  mkdirSync(repository);
  mkdirSync(join(definitions, "test"), { recursive: true });
  writeFileSync(
    join(repository, "guide.md"),
    "## Git Guide\n\nRun the locally cloned documentation example.",
  );
  writeFileSync(join(repository, "empty.md"), "");
  writeFileSync(join(repository, "excluded.md"), "Excluded source document.");
  execFileSync("git", ["init", "--quiet", repository]);
  execFileSync("git", ["add", "."], { cwd: repository });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Ingestion Test",
      "-c",
      "user.email=ingestion@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Fixture",
    ],
    { cwd: repository },
  );
  writeFileSync(
    join(definitions, "test", "fixture.yaml"),
    `name: fixture\nsource:\n  type: git\n  url: "${pathToFileURL(repository).href}"\n  exclude_paths: [excluded.md]\n`,
  );
  const args = [
    resolve(import.meta.dirname, "../dist/cli.js"),
    "build",
    "fixture",
    "--dir",
    definitions,
    "--output",
    output,
    "--diagnostics",
    report,
  ];
  const normal = spawnSync(process.execPath, args, { encoding: "utf8" });
  expect(normal.status, normal.stderr).toBe(0);
  expect(normal.stdout).toContain("Ingestion:");
  expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({
    schemaVersion: 1,
    summary: {
      discoveredFiles: 3,
      selectedFiles: 2,
      indexedDocuments: 1,
      excludedFiles: 1,
      emptyFiles: 1,
    },
  });
  const packagePath = join(output, "test-fixture@latest.db");
  const original = readFileSync(packagePath);
  const strict = spawnSync(process.execPath, [...args, "--strict"], {
    encoding: "utf8",
  });
  expect(strict.status).not.toBe(0);
  expect(strict.stderr).toContain("Strict ingestion validation failed");
  expect(readFileSync(packagePath)).toEqual(original);
  expect(JSON.parse(readFileSync(report, "utf8")).entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "empty.md", outcome: "empty" }),
      expect.objectContaining({
        path: "excluded.md",
        outcome: "excluded",
        reason: "exclude_paths",
      }),
    ]),
  );
}, 20_000);
