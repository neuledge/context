import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { loadPackages } from "./cli.js";
import { initDatabase } from "./database.js";
import { downloadPackage } from "./download.js";
import { buildPackage } from "./package-builder.js";
import { PackageStore, readPackageInfo } from "./store.js";

vi.mock("node:os", async (importOriginal) => {
  const os = await importOriginal<typeof import("node:os")>();
  const fs = await import("node:fs");
  const path = await import("node:path");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "context-download-"));
  return { ...os, homedir: () => home };
});
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, renameSync: vi.fn(fs.renameSync) };
});

const DATA_DIR = join(homedir(), ".context", "packages");
const PACKAGE_PATH = join(DATA_DIR, "test-lib@1.0.0.db");
const OPTIONS = { name: "test-lib", version: "1.0.0" };
const download = () =>
  downloadPackage("https://registry.example", "npm", "test-lib", "1.0.0");
let payload: Uint8Array;

beforeAll(async () => {
  await initDatabase();
  const source = join(homedir(), "incoming.db");
  buildPackage(
    source,
    [{ path: "guide.md", content: "## Guide\n\nReplacement documentation." }],
    OPTIONS,
  );
  payload = new Uint8Array(readFileSync(source));
});
beforeEach(() => {
  mkdirSync(DATA_DIR, { recursive: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(payload)),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  rmSync(DATA_DIR, { recursive: true, force: true });
});
afterAll(() => rmSync(homedir(), { recursive: true, force: true }));

function seed(existing: boolean): Buffer | undefined {
  if (!existing) return;
  buildPackage(
    PACKAGE_PATH,
    [{ path: "old.md", content: "## Original\n\nOriginal documentation." }],
    OPTIONS,
  );
  return readFileSync(PACKAGE_PATH);
}

describe.each([
  false,
  true,
])("download (existing installation: %s)", (existing) => {
  it.each([
    "network",
    "stream",
    "validation",
    "replacement",
  ])("preserves installed state after a %s failure", async (stage) => {
    const original = seed(existing);
    if (stage === "network") {
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Network unavailable"));
    } else if (stage === "stream") {
      let sent = false;
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            pull(controller) {
              if (sent) controller.error(new Error("Download interrupted"));
              else {
                controller.enqueue(payload.subarray(0, 128));
                sent = true;
              }
            },
          }),
        ),
      );
    } else if (stage === "validation") {
      vi.mocked(fetch).mockResolvedValueOnce(new Response("invalid database"));
    } else {
      vi.mocked(renameSync).mockImplementationOnce(() => {
        throw Object.assign(new Error("Destination is in use"), {
          code: "EPERM",
        });
      });
    }

    await expect(download()).rejects.toThrow();
    expect(readdirSync(DATA_DIR)).toEqual(
      existing ? ["test-lib@1.0.0.db"] : [],
    );
    if (original) {
      expect(readFileSync(PACKAGE_PATH)).toEqual(original);
      expect(readPackageInfo(PACKAGE_PATH).sectionCount).toBe(1);
    }
  });

  it("publishes only the complete download and returns its installed path", async () => {
    seed(existing);
    let resume: () => void = () => {};
    let started: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let sent = false;
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        new ReadableStream(
          {
            async pull(controller) {
              if (!sent) {
                sent = true;
                controller.enqueue(payload.subarray(0, 128));
              } else {
                started();
                await gate;
                controller.enqueue(payload.subarray(128));
                controller.close();
              }
            },
          },
          { highWaterMark: 0 },
        ),
      ),
    );

    const pending = download();
    try {
      await paused;
      const store = new PackageStore();
      loadPackages(store, DATA_DIR);
      expect(store.list().map((pkg) => pkg.sectionCount)).toEqual(
        existing ? [1] : [],
      );
    } finally {
      resume();
      await pending;
    }
    expect(await pending).toMatchObject({
      ...OPTIONS,
      path: PACKAGE_PATH,
      sectionCount: 1,
    });
    expect(new Uint8Array(readFileSync(PACKAGE_PATH))).toEqual(payload);
    expect(readdirSync(DATA_DIR)).toEqual(["test-lib@1.0.0.db"]);
  });
});

it("uses independent staging files for simultaneous downloads of the same package", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const results = await Promise.all([download(), download()]);
  expect(results.map((pkg) => pkg.path)).toEqual([PACKAGE_PATH, PACKAGE_PATH]);
  expect(new Uint8Array(readFileSync(PACKAGE_PATH))).toEqual(payload);
  expect(readdirSync(DATA_DIR)).toEqual(["test-lib@1.0.0.db"]);
});

it("ignores valid files left under legacy temporary download names", () => {
  buildPackage(
    join(DATA_DIR, ".downloading-legacy.db"),
    [
      {
        path: "guide.md",
        content: "## Guide\n\nUnfinished download documentation.",
      },
    ],
    OPTIONS,
  );
  const store = new PackageStore();
  loadPackages(store, DATA_DIR);
  expect(store.list()).toEqual([]);
});
