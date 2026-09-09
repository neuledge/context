import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initDatabase } from "@neuledge/context";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildFromDefinition } from "./build.js";
import {
  isExplicitVersionEntry,
  isVersioned,
  isZipVersionEntry,
  loadDefinition,
  resolveVersionEntry,
  type VersionedDefinition,
} from "./definition.js";
import { downloadHtmlIndex } from "./html-index.js";
import { discoverVersions } from "./version-check.js";

vi.mock("./html-index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./html-index.js")>()),
  downloadHtmlIndex: vi.fn(),
}));

describe("HTML index registry integration", () => {
  let dir: string;

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "html-registry-"));
    mkdirSync(join(dir, "systemd"));
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  function definition(
    source = 'type: html-index\n      url: "https://docs.example/man/{version}/"',
    versions = '["258"]',
  ) {
    const path = join(dir, "systemd", "systemd.yaml");
    writeFileSync(
      path,
      `name: systemd\nversions:\n  - versions: ${versions}\n    source:\n      ${source}\n`,
    );
    return loadDefinition(path);
  }

  it("discovers explicit releases without registry API requests, including in nightly builds", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const def = definition();
    expect(isVersioned(def)).toBe(true);
    const entry = resolveVersionEntry(def as VersionedDefinition, "258");
    expect(entry && isExplicitVersionEntry(entry)).toBe(true);
    expect(entry && isZipVersionEntry(entry)).toBe(false);
    expect(
      resolveVersionEntry(def as VersionedDefinition, "257"),
    ).toBeUndefined();
    expect(await discoverVersions(def, { since: 2 })).toEqual([
      { name: "systemd", registry: "systemd", version: "258" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(entry?.source).toMatchObject({ concurrency: 4, max_pages: 2000 });
  });

  it.each([
    ['type: html-index\n      url: "https://docs.example/latest/"', '["258"]'],
    [
      'type: html-index\n      url: "https://docs.example/{version}/"',
      '["latest"]',
    ],
    [
      'type: html-index\n      url: "https://docs.example/{version}/"\n      concurrency: 0',
      '["258"]',
    ],
    [
      'type: html-index\n      url: "https://docs.example/{version}/"\n      max_pages: 5001',
      '["258"]',
    ],
  ])("rejects invalid HTML source definitions", (source, versions) => {
    expect(() => definition(source, versions)).toThrow();
  });

  it("uses explicit HTML releases even when a package-manager API exists", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const def = { ...definition(), registry: "npm" };
    expect(await discoverVersions(def)).toEqual([
      { name: "systemd", registry: "npm", version: "258" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unversioned HTML sources", () => {
    const path = join(dir, "systemd", "systemd.yaml");
    writeFileSync(
      path,
      'name: systemd\nsource:\n  type: html-index\n  url: "https://docs.example/man/258/"\n',
    );
    expect(() => loadDefinition(path)).toThrow();
  });

  it("builds an HTML release into a searchable package through the registry pipeline", async () => {
    vi.mocked(downloadHtmlIndex).mockResolvedValue([
      {
        path: "systemd.service.html",
        content:
          "<h1>systemd.service</h1><h2>Options</h2><p>ExecStart= specifies the command to run.</p>",
      },
    ]);
    const result = await buildFromDefinition(
      definition() as VersionedDefinition,
      "258",
      dir,
    );
    expect(result).toMatchObject({
      name: "systemd",
      registry: "systemd",
      version: "258",
    });
    expect(result.sectionCount).toBeGreaterThan(0);
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(downloadHtmlIndex).toHaveBeenCalledWith(
      expect.objectContaining({ type: "html-index" }),
      "258",
    );
  });

  it("loads both shipped systemd definitions", async () => {
    const root = resolve(import.meta.dirname, "../../..", "registry/systemd");
    const manuals = loadDefinition(join(root, "systemd.yaml"));
    expect(await discoverVersions(manuals)).toEqual([
      { name: "systemd", registry: "systemd", version: "258" },
    ]);
    const guides = loadDefinition(join(root, "systemd-guides.yaml"));
    expect(guides.source).toMatchObject({
      type: "git",
      ref: "v258",
      docs_path: "docs",
    });
  });
});
