import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initDatabase } from "./database.js";
import { createTestDb, insertChunk, rebuildFtsIndex } from "./test-utils.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = dirname(SRC_DIR);

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label}`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

describe("serve package reload integration", () => {
  let testHome: string;
  let packagesDir: string;
  let client: Client | undefined;

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    testHome = join(
      tmpdir(),
      `context-serve-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    packagesDir = join(testHome, ".context", "packages");

    // The CLI's run-directly check matches argv[1] ending in "context", so run
    // the TypeScript source through a symlink named "context" rather than
    // depending on a prebuilt dist/cli.js.
    const binDir = join(testHome, "bin");
    mkdirSync(binDir, { recursive: true });
    symlinkSync(join(SRC_DIR, "cli.ts"), join(binDir, "context"));
  });

  afterEach(async () => {
    await client?.close().catch(() => {});
    client = undefined;
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
  });

  it("serves → reloads the store → notifies the MCP client of a new package", async () => {
    const started = new Client({ name: "test-client", version: "1.0.0" });
    client = started;

    const notified = new Promise<void>((resolve) => {
      started.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        resolve();
      });
    });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", join(testHome, "bin", "context"), "serve"],
      // Node's `os.homedir()` reads `HOME` on POSIX but `USERPROFILE` on
      // Windows, so set both to redirect the package directory to the
      // per-test temp HOME on every platform.
      env: { HOME: testHome, USERPROFILE: testHome },
      cwd: PKG_DIR,
      stderr: "pipe",
    });

    await started.connect(transport);

    // A fresh HOME starts with no `.context/packages`; `serve` must create it
    // before the initial store scan and watcher setup.
    expect(existsSync(packagesDir)).toBe(true);

    const before = await started.listTools();
    const beforeGetDocs = before.tools.find((tool) => tool.name === "get_docs");
    expect(beforeGetDocs).toBeDefined();
    expect(JSON.stringify(beforeGetDocs)).not.toContain("newpkg@1.0.0");

    // Install a package the way `context add` does: write the database fully
    // outside the watched directory, then atomically rename it into place.
    // Writing the .db in place would let the watcher observe a half-written
    // file on Windows (where the create event can fire before writes finish).
    const pkgPath = join(packagesDir, "newpkg@1.0.0.db");
    const stagingPath = join(testHome, "newpkg@1.0.0.staging.db");
    const db = createTestDb(stagingPath, { name: "newpkg", version: "1.0.0" });
    insertChunk(db, {
      docPath: "docs/intro.md",
      docTitle: "Introduction",
      sectionTitle: "Start",
      content: "Welcome to newpkg.",
      tokens: 3,
    });
    rebuildFtsIndex(db);
    db.close();

    renameSync(stagingPath, pkgPath);

    await withTimeout(notified, 10_000, "tools/list_changed notification");

    const after = await started.listTools();
    const afterGetDocs = after.tools.find((tool) => tool.name === "get_docs");
    expect(JSON.stringify(afterGetDocs)).toContain("newpkg@1.0.0");
  }, 20_000);
});
