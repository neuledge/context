import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { downloadPackage, searchPackages } from "./download.js";
import { type SearchResult, search } from "./search.js";
import type { PackageInfo, PackageStore } from "./store.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

type ToolResult = { content: { type: "text"; text: string }[] };

/**
 * MCP server for documentation retrieval.
 * Accepts a PackageStore to provide the get_docs tool.
 */
export class ContextServer {
  private mcp: McpServer;
  private store: PackageStore;

  constructor(store: PackageStore) {
    this.store = store;
    this.mcp = new McpServer({
      name: "context",
      version,
    });
  }

  /**
   * Start the server with stdio transport.
   * Registers get_docs (if packages available), search_packages, and download_package.
   */
  async start(): Promise<void> {
    const packages = this.store.list();
    if (packages.length > 0) {
      this.registerGetDocsTool(packages);
    }
    this.registerSearchPackagesTool();
    this.registerDownloadPackageTool();

    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
  }

  /** Access the underlying McpServer for testing. */
  get server(): McpServer {
    return this.mcp;
  }

  private registerGetDocsTool(packages: PackageInfo[]): void {
    const libraryEnum = packages.map(formatLibraryName);

    this.mcp.registerTool(
      "get_docs",
      {
        description:
          "Provides the latest official documentation for installed libraries. Use this as your primary reference when working with library APIs - it contains current, version-specific information that may be more accurate than training data or web searches. Covers API signatures, usage patterns, and best practices. Instant local lookup, no network needed.",
        inputSchema: {
          library: z
            .enum(libraryEnum as [string, ...string[]])
            .describe("The library to search (name@version)"),
          topic: z
            .string()
            .describe(
              "What you need help with (e.g., 'middleware authentication', 'server components')",
            ),
        },
      },
      async ({ library, topic }) => {
        return this.handleGetDocs(packages, library, topic);
      },
    );
  }

  private registerSearchPackagesTool(): void {
    this.mcp.registerTool(
      "search_packages",
      {
        description:
          "Search for available documentation packages on the server. Use this to discover what libraries are available for download before using download_package.",
        inputSchema: {
          registry: z
            .string()
            .describe('Package registry (e.g., "npm", "pip", "cargo")'),
          name: z.string().describe("Package name to search for"),
          version: z
            .string()
            .optional()
            .describe("Specific version to search for (omit for all versions)"),
        },
      },
      async ({ registry, name, version: ver }) => {
        return this.handleSearchPackages(registry, name, ver);
      },
    );
  }

  private registerDownloadPackageTool(): void {
    this.mcp.registerTool(
      "download_package",
      {
        description:
          "Download and install a documentation package from the server. After downloading, the package becomes available in get_docs for instant local lookups.",
        inputSchema: {
          registry: z
            .string()
            .describe('Package registry (e.g., "npm", "pip", "cargo")'),
          name: z.string().describe("Package name"),
          version: z.string().describe("Package version to download"),
          server: z
            .string()
            .optional()
            .describe("Server name (omit for default)"),
        },
      },
      async ({ registry, name, version: ver, server }) => {
        return this.handleDownloadPackage(registry, name, ver, server);
      },
    );
  }

  private handleGetDocs(
    packages: PackageInfo[],
    library: string,
    topic: string,
  ): ToolResult {
    const pkg = packages.find((p) => formatLibraryName(p) === library);

    if (!pkg) {
      return textResult({ error: `Package not found: ${library}` });
    }

    const db = this.store.openDb(pkg.name);
    if (!db) {
      return textResult({
        error: `Failed to open package database: ${library}`,
      });
    }

    try {
      const result = search(db, topic);
      return { content: [{ type: "text", text: formatSearchResult(result) }] };
    } finally {
      db.close();
    }
  }

  private async handleSearchPackages(
    registry: string,
    name: string,
    ver?: string,
  ): Promise<ToolResult> {
    try {
      const results = await searchPackages({ registry, name, version: ver });
      if (results.length === 0) {
        return textResult({
          message: `No packages found for ${registry}/${name}${ver ? `@${ver}` : ""}`,
        });
      }
      return textResult(results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult({ error: msg });
    }
  }

  private async handleDownloadPackage(
    registry: string,
    name: string,
    ver: string,
    server?: string,
  ): Promise<ToolResult> {
    try {
      const info = await downloadPackage({
        registry,
        name,
        version: ver,
        server,
      });

      // Register the new package in the store so get_docs can find it
      this.store.add(info);

      // Re-register get_docs with the updated package list
      const packages = this.store.list();
      this.registerGetDocsTool(packages);

      // Notify client that tools have changed
      await this.mcp.server.sendToolListChanged();

      return textResult({
        status: "installed",
        name: info.name,
        version: info.version,
        sectionCount: info.sectionCount,
        message: `Downloaded and installed ${info.name}@${info.version}. It is now available in get_docs.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult({ error: msg });
    }
  }
}

function formatLibraryName(pkg: PackageInfo): string {
  return `${pkg.name}@${pkg.version}`;
}

function formatSearchResult(result: SearchResult): string {
  if (result.results.length === 0) {
    return JSON.stringify({
      library: result.library,
      version: result.version,
      results: [],
      message: "No documentation found. Try different keywords.",
    });
  }

  return JSON.stringify({
    library: result.library,
    version: result.version,
    results: result.results,
  });
}

function textResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
