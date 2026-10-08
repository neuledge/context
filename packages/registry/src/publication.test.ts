import { execFile, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { initDatabase, openDatabase } from "@neuledge/context";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getHeadCommit } from "./build.js";
import { getIngestionRevision } from "./fingerprint.js";
import type { PackageMetadata } from "./publish.js";

const run = promisify(execFile);

describe("publication freshness through the CLI", () => {
  let root: string;
  let server: Server;
  let url: string;
  let metadata: PackageMetadata | null;
  let uploads: number;
  let archiveDownloads: number;
  let conflict: boolean;
  let legacy: boolean;
  let dropUploadResponse: boolean;
  let metadataReads: number;
  let entryPoint: string;
  let preload: string | undefined;
  let repoUrl: string;
  const docs =
    "# Documentation\n\n## Getting started\n\nThis documentation explains how to configure and run the application with a complete example.\n";

  beforeAll(() => initDatabase());
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "publication-freshness-"));
    mkdirSync(join(root, "definitions", "custom"), { recursive: true });
    mkdirSync(join(root, "output"));
    const repo = join(root, "repo");
    mkdirSync(join(repo, "docs"), { recursive: true });
    mkdirSync(join(repo, "guides"));
    writeFileSync(join(repo, "docs", "intro.md"), docs);
    writeFileSync(
      join(repo, "docs", "extra.md"),
      docs.replace("Getting started", "Extra"),
    );
    writeFileSync(
      join(repo, "guides", "intro.md"),
      docs.replace("Getting started", "Guide"),
    );
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    git(["init", "--initial-branch=main"]);
    git(["add", "."]);
    git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "docs",
    ]);
    git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "tag",
      "-a",
      "v1.0",
      "-m",
      "release",
    ]);
    repoUrl = pathToFileURL(repo).href;
    metadata = null;
    uploads = 0;
    archiveDownloads = 0;
    conflict = false;
    legacy = false;
    dropUploadResponse = false;
    metadataReads = 0;
    entryPoint = "src/cli.ts";
    preload = undefined;

    server = createServer((request, response) => {
      if (request.url?.startsWith("/source/")) {
        archiveDownloads++;
        response.end(
          readFileSync(new URL("./fixtures/freshness.zip", import.meta.url)),
        );
        return;
      }
      if (request.method !== "POST") {
        metadataReads++;
        response.writeHead(metadata ? 200 : 404, {
          "Content-Type": "application/json",
        });
        const body =
          metadata && legacy
            ? {
                ...metadata,
                build_fingerprint: undefined,
                ingestion_revision: undefined,
              }
            : metadata;
        response.end(JSON.stringify(body ?? { error: "not found" }));
        return;
      }
      uploads++;
      const buffers: Buffer[] = [];
      request.on("data", (data: Buffer) => buffers.push(data));
      request.on("end", () => {
        if (conflict) {
          response.writeHead(409);
          response.end("immutable release");
          return;
        }
        const dbPath = join(root, "uploaded.db");
        writeFileSync(dbPath, Buffer.concat(buffers));
        const db = openDatabase(dbPath, { readonly: true });
        try {
          const values = Object.fromEntries(
            (
              db.prepare("SELECT key, value FROM meta").all() as {
                key: string;
                value: string;
              }[]
            ).map((row) => [row.key, row.value]),
          );
          if (!values.name || !values.version)
            throw new Error("Missing package identity");
          metadata = {
            registry: decodeURIComponent(
              request.url?.split("/")[2] ?? "custom",
            ),
            name: values.name,
            version: values.version,
            source_commit: values.source_commit,
            build_fingerprint: values.build_fingerprint,
            ingestion_revision: values.ingestion_revision,
          };
        } finally {
          db.close();
        }
        if (dropUploadResponse) {
          dropUploadResponse = false;
          conflict = true;
          request.socket.destroy();
          return;
        }
        response.end("{}");
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test server address");
    url = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    rmSync(root, { recursive: true, force: true });
  });

  function currentMetadata(): PackageMetadata {
    if (!metadata) throw new Error("No package was uploaded");
    return metadata;
  }

  function defineGit(path = "docs", excludes: string[] = []) {
    writeFileSync(
      join(root, "definitions", "custom", "docs.yaml"),
      `name: docs\nsource:\n  type: git\n  url: ${repoUrl}\n  ref: main\n  docs_path: ${path}\n  exclude_paths: ${JSON.stringify(excludes)}\n`,
    );
  }
  function defineArchive(path = "docs") {
    writeFileSync(
      join(root, "definitions", "custom", "docs.yaml"),
      `name: docs\nversions:\n  - versions: ["1.0"]\n    source:\n      type: zip\n      url: ${url}/source/{version}.zip\n      docs_path: ${path}\n`,
    );
  }
  async function cli(command: string, ...args: string[]) {
    try {
      const result = await run(
        process.execPath,
        [
          ...(entryPoint.startsWith("src/") ? ["--import", "tsx"] : []),
          ...(preload ? ["--import", pathToFileURL(preload).href] : []),
          entryPoint,
          command,
          ...args,
          "--dir",
          join(root, "definitions"),
          "--output",
          join(root, "output"),
        ],
        {
          cwd: process.cwd(),
          timeout: 30_000,
          env: {
            ...process.env,
            REGISTRY_SERVER_URL: url,
            REGISTRY_PUBLISH_KEY: "test-key",
          },
        },
      );
      return { status: 0, output: result.stdout + result.stderr };
    } catch (error) {
      const result = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      return {
        status: result.code ?? 1,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      };
    }
  }

  it("skips unchanged Git, then rebuilds changed docs_path, exclusions and pipeline at the same commit", async () => {
    defineGit();
    expect((await cli("publish", "docs")).status).toBe(0);
    const commit = metadata?.source_commit;
    expect(commit).toBe(getHeadCommit(repoUrl, "main"));
    expect(metadata?.ingestion_revision).toBe(getIngestionRevision());
    expect(metadata?.build_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect((await cli("publish", "docs")).output).toContain(
      "build inputs unchanged",
    );
    expect(uploads).toBe(1);
    defineGit("guides");
    expect((await cli("publish-all")).status).toBe(0);
    expect(uploads).toBe(2);
    expect(metadata?.source_commit).toBe(commit);
    defineGit("docs", ["extra.md"]);
    expect((await cli("publish", "docs")).status).toBe(0);
    expect(uploads).toBe(3);
    metadata = {
      ...currentMetadata(),
      build_fingerprint: "old-ingestion-pipeline",
    };
    expect((await cli("publish-all")).status).toBe(0);
    expect(uploads).toBe(4);
  }, 90_000);

  it("compares fingerprints for already-published explicit versions in both commands", async () => {
    defineArchive();
    expect((await cli("publish", "docs", "1.0")).status).toBe(0);
    expect((await cli("publish-all")).output).toContain(
      "build inputs unchanged",
    );
    expect(uploads).toBe(1);
    expect(archiveDownloads).toBe(1);
    defineArchive("guides");
    expect((await cli("publish", "docs", "1.0")).status).toBe(0);
    expect(uploads).toBe(2);
    metadata = {
      ...currentMetadata(),
      build_fingerprint: "old-ingestion-pipeline",
    };
    expect((await cli("publish-all")).status).toBe(0);
    expect(uploads).toBe(3);
    expect((await cli("publish-all", "--force")).status).toBe(0);
    expect(uploads).toBe(4);
  }, 90_000);

  it("retains legacy Git skipping and migrates with --force", async () => {
    defineGit();
    expect((await cli("publish", "docs")).status).toBe(0);
    legacy = true;
    defineGit("guides");
    expect((await cli("publish", "docs")).output).toContain("legacy metadata");
    expect(uploads).toBe(1);
    expect((await cli("publish", "docs", "--force")).status).toBe(0);
    expect(uploads).toBe(2);
    legacy = false;
    expect((await cli("publish", "docs")).output).toContain(
      "build inputs unchanged",
    );
  }, 90_000);

  it("reports immutable-version conflicts and preserves the rebuilt artifact", async () => {
    defineArchive();
    expect((await cli("publish", "docs", "1.0")).status).toBe(0);
    legacy = true;
    expect((await cli("publish-all")).output).toContain("legacy metadata");
    expect(uploads).toBe(1);
    conflict = true;
    const failed = await cli("publish-all", "--force");
    expect(failed.status).not.toBe(0);
    expect(failed.output).toContain("409 Conflict");
    expect(failed.output).toContain("immutable release");
    expect(failed.output).toContain("rebuilt artifact is preserved");
    expect(failed.output).toContain("Failed: 1");
    expect(existsSync(join(root, "output", "custom-docs@1.0.db"))).toBe(true);
  }, 90_000);

  it("resolves annotated tags to the commit recorded by a versioned Git build", async () => {
    writeFileSync(
      join(root, "definitions", "custom", "docs.yaml"),
      `name: docs\nversions:\n  - min_version: "1.0"\n    source:\n      type: git\n      url: ${repoUrl}\n      docs_path: docs\n`,
    );
    expect((await cli("publish", "docs", "1.0")).status).toBe(0);
    expect(metadata?.source_commit).toBe(getHeadCommit(repoUrl, "v1.0"));
    expect((await cli("publish", "docs", "1.0")).output).toContain(
      "build inputs unchanged",
    );
    expect(uploads).toBe(1);
  }, 90_000);

  it("recovers a lost upload response followed by a conflict only after verifying metadata", async () => {
    defineArchive();
    dropUploadResponse = true;
    const published = await cli("publish-all");
    expect(published.status).toBe(0);
    expect(published.output).toContain("Succeeded: 1");
    expect(uploads).toBe(2);
    expect(metadataReads).toBe(2);
    expect(currentMetadata().build_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(join(root, "output", "custom-docs@1.0.db"))).toBe(false);
  }, 60_000);

  it.each([
    "build_fingerprint",
    "ingestion_revision",
  ] as const)("rejects a conflicting upload with mismatched %s", async (field) => {
    defineArchive();
    expect((await cli("publish", "docs", "1.0")).status).toBe(0);
    metadata = { ...currentMetadata(), [field]: "different-artifact" };
    conflict = true;
    const failed = await cli("publish-all", "--force");
    expect(failed.status).not.toBe(0);
    expect(failed.output).toContain("409 Conflict");
    expect(failed.output).toContain("rebuilt artifact is preserved");
    expect(existsSync(join(root, "output", "custom-docs@1.0.db"))).toBe(true);
  }, 60_000);

  it("summarizes unchanged versions without printing each skip", async () => {
    defineArchive();
    expect((await cli("publish", "docs", "1.0")).status).toBe(0);
    const skipped = await cli("publish-all");
    expect(skipped.status).toBe(0);
    expect(skipped.output).toContain("Skipped: 1");
    expect(skipped.output).toContain("build inputs unchanged: 1");
    expect(skipped.output).not.toContain("Skipping custom/docs@1.0");
  }, 60_000);

  it("does not request metadata when forcing publication", async () => {
    defineArchive();
    expect((await cli("publish", "docs", "1.0")).status).toBe(0);
    const previousReads = metadataReads;
    expect((await cli("publish-all", "--force")).status).toBe(0);
    expect(metadataReads).toBe(previousReads);
    expect(uploads).toBe(2);
  }, 60_000);

  it("builds identical fingerprints through the source and built CLIs", async () => {
    defineGit();
    expect((await cli("publish", "docs")).status).toBe(0);
    const sourceMetadata = currentMetadata();
    entryPoint = "dist/cli.js";
    expect((await cli("publish", "docs", "--force")).status).toBe(0);
    expect(currentMetadata()).toEqual(sourceMetadata);
    expect(uploads).toBe(2);
  }, 60_000);

  it("warns and skips removed published tags while publishing subsequent versions", async () => {
    mkdirSync(join(root, "definitions", "npm"));
    writeFileSync(
      join(root, "definitions", "npm", "docs.yaml"),
      `name: docs\nversions:\n  - min_version: "1.0"\n    source:\n      type: git\n      url: ${repoUrl}\n      docs_path: docs\n`,
    );
    expect((await cli("publish", "docs", "1.0")).status).toBe(0);
    execFileSync("git", ["tag", "-d", "v1.0"], { cwd: join(root, "repo") });
    preload = join(root, "versions.mjs");
    writeFileSync(
      preload,
      `const original = globalThis.fetch;
globalThis.fetch = (url, init) => String(url).startsWith("https://registry.npmjs.org/")
  ? Promise.resolve(new Response(JSON.stringify({ versions: { "1.0": {} } })))
  : original(url, init);\n`,
    );
    writeFileSync(
      join(root, "definitions", "npm", "zzz.yaml"),
      `name: zzz\nversions:\n  - versions: ["1.0"]\n    source:\n      type: zip\n      url: ${url}/source/{version}.zip\n      docs_path: docs\n`,
    );
    const published = await cli("publish-all");
    expect(published.status).toBe(0);
    expect(published.output).toContain("WARNING npm/docs@1.0");
    expect(published.output).toContain("source tag unavailable: 1");
    expect(published.output).toContain("Succeeded: 1");
    expect(published.output).toContain("Skipped: 1");
    expect(published.output).toContain("Failed: 0");
    expect(uploads).toBe(2);
  }, 60_000);

  it("reports unreachable source repositories as failures", async () => {
    defineGit();
    expect((await cli("publish", "docs")).status).toBe(0);
    repoUrl = pathToFileURL(join(root, "missing-repository")).href;
    defineGit();
    const failed = await cli("publish-all");
    expect(failed.status).not.toBe(0);
    expect(failed.output).toContain("Failed: 1");
    expect(failed.output).not.toContain("source tag unavailable");
  }, 60_000);
});
