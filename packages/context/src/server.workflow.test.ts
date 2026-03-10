import { createReadStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, insertChunk, rebuildFtsIndex } from "./test-utils.js";

describe("ContextServer registry workflow", () => {
  let originalHome: string | undefined;
  let testHome: string;
  let registryDbPath: string;
  let registryServer: Server;
  let contextHttpServer: Server;
  let registryUrl: string;
  let contextUrl: string;
  let client: Client;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    testHome = join(
      tmpdir(),
      `context-workflow-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testHome, { recursive: true });
    process.env.HOME = testHome;
    vi.resetModules();

    const registryDir = join(testHome, "registry");
    mkdirSync(registryDir, { recursive: true });
    registryDbPath = join(registryDir, "hono@1.0.0.db");

    const db = createTestDb(registryDbPath, {
      name: "hono",
      version: "1.0.0",
      description: "Hono documentation",
    });
    insertChunk(db, {
      docPath: "docs/middleware/secure-headers.md",
      docTitle: "secureHeaders",
      sectionTitle: "Options",
      content:
        "Use secureHeaders to set common security headers. The middleware accepts options for crossOriginEmbedderPolicy and xFrameOptions.",
      tokens: 24,
    });
    rebuildFtsIndex(db);
    db.close();

    registryServer = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/search") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify([
            {
              registry: "npm",
              name: "hono",
              version: "1.0.0",
              description: "Hono documentation",
              size: 1024,
            },
          ]),
        );
        return;
      }

      if (
        req.method === "GET" &&
        url.pathname === "/packages/npm/hono/1.0.0/download"
      ) {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        createReadStream(registryDbPath).pipe(res);
        return;
      }

      res.writeHead(404).end("Not Found");
    });

    const registryPort = await new Promise<number>((resolve) => {
      registryServer.listen(0, "127.0.0.1", () => {
        const addr = registryServer.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
    registryUrl = `http://127.0.0.1:${registryPort}`;

    const [{ saveConfig }, { ContextServer }, { PackageStore }] =
      await Promise.all([
        import("./config.js"),
        import("./server.js"),
        import("./store.js"),
      ]);

    saveConfig({
      servers: [{ name: "test-registry", url: registryUrl, default: true }],
    });

    const context = new ContextServer(new PackageStore());
    const started = await context.startHTTP({ port: 0 });
    contextHttpServer = started.server;
    contextUrl = `http://127.0.0.1:${started.port}/mcp`;

    client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(contextUrl));
    await client.connect(transport);
  });

  afterEach(async () => {
    await client?.close().catch(() => {});

    await Promise.all([
      new Promise<void>((resolve) => registryServer?.close(() => resolve())),
      new Promise<void>((resolve) => contextHttpServer?.close(() => resolve())),
    ]);

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    vi.resetModules();

    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
  });

  it("supports the search_packages -> download_package -> get_docs workflow", async () => {
    const initialTools = await client.listTools();
    expect(initialTools.tools.map((tool) => tool.name)).toContain("get_docs");

    const preInstallResult = await client.callTool({
      name: "get_docs",
      arguments: {
        library: "hono@1.0.0",
        topic: "secureHeaders",
      },
    });
    const preInstallText = (preInstallResult.content as { text: string }[])[0]
      ?.text;
    expect(preInstallText).toBeDefined();

    const preInstallPayload = JSON.parse(preInstallText ?? "");
    expect(preInstallPayload.error).toBe("Package not found: hono@1.0.0");
    expect(preInstallPayload.message).toContain("search_packages");
    expect(preInstallPayload.message).toContain("download_package");

    const searchResult = await client.callTool({
      name: "search_packages",
      arguments: {
        registry: "npm",
        name: "hono",
        server: "test-registry",
      },
    });
    const searchText = (searchResult.content as { text: string }[])[0]?.text;
    expect(searchText).toBeDefined();

    const searchPayload = JSON.parse(searchText ?? "");
    expect(searchPayload.count).toBe(1);
    expect(searchPayload.results[0]).toMatchObject({
      registry: "npm",
      name: "hono",
      version: "1.0.0",
    });

    const downloadResult = await client.callTool({
      name: "download_package",
      arguments: {
        registry: "npm",
        name: "hono",
        version: "1.0.0",
        server: "test-registry",
      },
    });
    const downloadText = (downloadResult.content as { text: string }[])[0]
      ?.text;
    expect(downloadText).toBeDefined();

    const downloadPayload = JSON.parse(downloadText ?? "");
    expect(downloadPayload.success).toBe(true);
    expect(downloadPayload.package).toMatchObject({
      name: "hono",
      version: "1.0.0",
    });

    const toolsAfterInstall = await client.listTools();
    expect(toolsAfterInstall.tools.map((tool) => tool.name)).toContain(
      "get_docs",
    );

    const docsResult = await client.callTool({
      name: "get_docs",
      arguments: {
        library: "hono@1.0.0",
        topic: "secureHeaders",
      },
    });
    const docsText = (docsResult.content as { text: string }[])[0]?.text;
    expect(docsText).toBeDefined();

    const docsPayload = JSON.parse(docsText ?? "");
    expect(docsPayload.library).toBe("hono@1.0.0");
    expect(docsPayload.results.length).toBeGreaterThan(0);
    expect(docsPayload.results[0]?.title).toContain("secureHeaders");
  });
});
