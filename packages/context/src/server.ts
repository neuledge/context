import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { type SearchResult, search } from "./search.js";
import type { PackageInfo, PackageStore } from "./store.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

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
   * Registers the get_docs tool if packages are available.
   */
  async start(): Promise<void> {
    const packages = this.store.list();
    if (packages.length > 0) {
      this.registerGetDocsTool(packages);
    }
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

  private handleGetDocs(
    packages: PackageInfo[],
    library: string,
    topic: string,
  ): { content: { type: "text"; text: string }[] } {
    const pkg = packages.find((p) => formatLibraryName(p) === library);

    if (!pkg) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Package not found: ${library}` }),
          },
        ],
      };
    }

    const db = this.store.openDb(pkg.name);
    if (!db) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Failed to open package database: ${library}`,
            }),
          },
        ],
      };
    }

    try {
      const result = search(db, topic);
      return {
        content: [{ type: "text", text: formatSearchResult(result) }],
      };
    } finally {
      db.close();
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
