import { existsSync, mkdirSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { search } from "./search.js";
import { ContextServer } from "./server.js";
import { PackageStore, readPackageInfo } from "./store.js";
import { createTestDb, insertChunk, rebuildFtsIndex } from "./test-utils.js";

describe("ContextServer", () => {
  it("creates an MCP server instance", () => {
    const store = new PackageStore();
    const server = new ContextServer(store);

    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
  });

  it("has correct name and version from package.json", () => {
    const store = new PackageStore();
    const ctx = new ContextServer(store);
    const serverInfo = ctx.server.server as unknown as {
      _serverInfo: { name: string; version: string };
    };

    expect(serverInfo._serverInfo.name).toBe("context");
    expect(serverInfo._serverInfo.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("ContextServer integration", () => {
  const TEST_DIR = join(tmpdir(), `context-server-int-test-${Date.now()}`);
  let db: Database.Database;
  const testPackagePath = join(TEST_DIR, "nextjs@15.0.db");

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = createTestDb(testPackagePath, {
      name: "nextjs",
      version: "15.0",
      description: "Next.js documentation",
    });

    // Add realistic documentation chunks
    insertChunk(db, {
      docPath: "docs/routing/middleware.md",
      docTitle: "Middleware",
      sectionTitle: "Introduction",
      content:
        "Middleware allows you to run code before a request is completed. Based on the incoming request, you can modify the response by rewriting, redirecting, modifying headers, or responding directly.",
      tokens: 45,
    });
    insertChunk(db, {
      docPath: "docs/routing/middleware.md",
      docTitle: "Middleware",
      sectionTitle: "Convention",
      content:
        "Use the file `middleware.ts` (or `.js`) in the root of your project to define Middleware. For example, at the same level as `pages` or `app`, or inside `src` if applicable.",
      tokens: 40,
    });
    insertChunk(db, {
      docPath: "docs/app/building-your-application/routing/route-handlers.md",
      docTitle: "Route Handlers",
      sectionTitle: "Introduction",
      content:
        "Route Handlers allow you to create custom request handlers for a given route using the Web Request and Response APIs.",
      tokens: 30,
    });
    rebuildFtsIndex(db);
    db.close();
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it("returns search results through get_docs tool handler", () => {
    const store = new PackageStore();
    const info = readPackageInfo(testPackagePath);
    store.add(info);

    // Test the search flow directly (simulates what get_docs handler does)
    const pkgDb = store.openDb("nextjs");
    expect(pkgDb).not.toBeNull();

    if (pkgDb) {
      const result = search(pkgDb, "middleware");
      pkgDb.close();

      expect(result.library).toBe("nextjs@15.0");
      expect(result.version).toBe("15.0");
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0]?.title).toContain("Middleware");
    }
  });

  it("end-to-end: store → server → search flow works correctly", () => {
    const store = new PackageStore();
    const info = readPackageInfo(testPackagePath);
    store.add(info);

    // Verify package is registered
    expect(store.list()).toHaveLength(1);
    expect(store.get("nextjs")?.version).toBe("15.0");

    // Verify database can be opened and searched
    const pkgDb = store.openDb("nextjs");
    expect(pkgDb).not.toBeNull();

    if (pkgDb) {
      // Search for middleware docs
      const middlewareResult = search(pkgDb, "middleware");
      expect(middlewareResult.results.length).toBeGreaterThan(0);
      expect(
        middlewareResult.results.some((r) => r.title.includes("Middleware")),
      ).toBe(true);

      // Search for route handlers
      const routeResult = search(pkgDb, "route handlers");
      expect(routeResult.results.length).toBeGreaterThan(0);
      expect(
        routeResult.results.some((r) => r.title.includes("Route Handlers")),
      ).toBe(true);

      // Search for non-existent topic
      const noResult = search(pkgDb, "graphql federation");
      expect(noResult.results).toHaveLength(0);

      pkgDb.close();
    }
  });

  it("ContextServer can be created with packages", () => {
    const store = new PackageStore();
    const info = readPackageInfo(testPackagePath);
    store.add(info);

    const server = new ContextServer(store);
    expect(server).toBeDefined();
    expect(server.server).toBeDefined();

    // Verify store has the package
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.name).toBe("nextjs");
  });
});

describe("ContextServer HTTP transport", () => {
  let testDir: string;
  let httpServer: Server;
  let port: number;
  const clients: Client[] = [];

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `context-http-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    const testPackagePath = join(testDir, "nextjs@15.0.db");

    const db = createTestDb(testPackagePath, {
      name: "nextjs",
      version: "15.0",
      description: "Next.js documentation",
    });

    insertChunk(db, {
      docPath: "docs/routing/middleware.md",
      docTitle: "Middleware",
      sectionTitle: "Introduction",
      content:
        "Middleware allows you to run code before a request is completed.",
      tokens: 20,
    });
    rebuildFtsIndex(db);
    db.close();

    const store = new PackageStore();
    const info = readPackageInfo(testPackagePath);
    store.add(info);

    const ctx = new ContextServer(store);
    const result = await ctx.startHTTP({ port: 0 });
    httpServer = result.server;
    port = result.port;
  });

  afterEach(async () => {
    // Close all clients first to release SSE streams
    await Promise.all(clients.map((c) => c.close().catch(() => {})));
    clients.length = 0;

    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it("starts HTTP server and accepts MCP client connections", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    clients.push(client);
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );

    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);
    expect(toolNames).toContain("get_docs");
    expect(toolNames).toContain("search_packages");
    expect(toolNames).toContain("download_package");
  });

  it("supports multiple concurrent client sessions", async () => {
    const client1 = new Client({ name: "client-1", version: "1.0.0" });
    const client2 = new Client({ name: "client-2", version: "1.0.0" });
    clients.push(client1, client2);

    const transport1 = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    const transport2 = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );

    await client1.connect(transport1);
    await client2.connect(transport2);

    // Both clients can list tools independently
    const [tools1, tools2] = await Promise.all([
      client1.listTools(),
      client2.listTools(),
    ]);

    expect(tools1.tools.map((t) => t.name)).toContain("get_docs");
    expect(tools2.tools.map((t) => t.name)).toContain("get_docs");
  });

  it("returns tool results via HTTP transport", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    clients.push(client);
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );

    await client.connect(transport);

    const result = await client.callTool({
      name: "get_docs",
      arguments: { library: "nextjs@15.0", topic: "middleware" },
    });

    const text = (result.content as { type: string; text: string }[])[0]?.text;
    expect(text).toBeDefined();
    const parsed = JSON.parse(text ?? "");
    expect(parsed.library).toBe("nextjs@15.0");
    expect(parsed.results.length).toBeGreaterThan(0);
  });

  it("returns 404 for non-MCP paths", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/other`);
    expect(response.status).toBe(404);
  });
});
