import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getServerUrl } from "./config.js";
import { downloadPackage, searchPackages } from "./download.js";
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
  private getDocsRegistration: ReturnType<McpServer["registerTool"]> | null =
    null;

  constructor(store: PackageStore) {
    this.store = store;
    this.mcp = new McpServer({
      name: "context",
      version,
    });
  }

  /**
   * Start the server with stdio transport.
   * Registers tools and connects.
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

    this.getDocsRegistration = this.mcp.registerTool(
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
        return this.handleGetDocs(library, topic);
      },
    );
  }

  /**
   * Update the get_docs tool to include newly installed packages.
   * If get_docs doesn't exist yet, register it for the first time.
   */
  private refreshGetDocsTool(): void {
    const packages = this.store.list();

    if (packages.length === 0) return;

    const libraryEnum = packages.map(formatLibraryName);

    if (this.getDocsRegistration) {
      // Update existing tool with new enum
      this.getDocsRegistration.update({
        paramsSchema: {
          library: z
            .enum(libraryEnum as [string, ...string[]])
            .describe("The library to search (name@version)"),
          topic: z
            .string()
            .describe(
              "What you need help with (e.g., 'middleware authentication', 'server components')",
            ),
        },
        callback: async ({
          library,
          topic,
        }: {
          library: string;
          topic: string;
        }) => {
          return this.handleGetDocs(library, topic);
        },
      });
    } else {
      this.registerGetDocsTool(packages);
    }

    this.mcp.sendToolListChanged();
  }

  private handleGetDocs(
    library: string,
    topic: string,
  ): { content: { type: "text"; text: string }[] } {
    const packages = this.store.list();
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

  private registerSearchPackagesTool(): void {
    this.mcp.registerTool(
      "search_packages",
      {
        description:
          "Search for documentation packages available on the registry server. Use this to discover libraries you can download for offline documentation access.",
        inputSchema: {
          registry: z
            .string()
            .describe('Package registry (e.g., "npm", "pip", "cargo", "go")'),
          name: z
            .string()
            .describe('Package name to search for (e.g., "react", "next")'),
          version: z
            .string()
            .optional()
            .describe("Specific version to search for (optional)"),
          server: z
            .string()
            .optional()
            .describe(
              "Server name from config (optional, uses default if omitted)",
            ),
        },
      },
      async ({ registry, name, version, server }) => {
        try {
          const serverUrl = getServerUrl(server);
          const results = await searchPackages(
            serverUrl,
            registry,
            name,
            version,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  results,
                  count: results.length,
                }),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: err instanceof Error ? err.message : String(err),
                }),
              },
            ],
          };
        }
      },
    );
  }

  private registerDownloadPackageTool(): void {
    this.mcp.registerTool(
      "download_package",
      {
        description:
          "Download and install a documentation package from the registry server. Once installed, the package becomes available through the get_docs tool for instant offline documentation lookup.",
        inputSchema: {
          registry: z
            .string()
            .describe('Package registry (e.g., "npm", "pip", "cargo", "go")'),
          name: z.string().describe('Package name (e.g., "react", "next")'),
          version: z
            .string()
            .describe('Package version (e.g., "18.3.1", "15.0.4")'),
          server: z
            .string()
            .optional()
            .describe(
              "Server name from config (optional, uses default if omitted)",
            ),
        },
      },
      async ({ registry, name, version, server }) => {
        try {
          const serverUrl = getServerUrl(server);
          const info = await downloadPackage(
            serverUrl,
            registry,
            name,
            version,
          );

          // Add to the store and refresh the get_docs tool
          this.store.add(info);
          this.refreshGetDocsTool();

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  package: {
                    name: info.name,
                    version: info.version,
                    description: info.description,
                    sectionCount: info.sectionCount,
                    sizeBytes: info.sizeBytes,
                  },
                  message: `Installed ${info.name}@${info.version} (${info.sectionCount} sections). It is now available via the get_docs tool.`,
                }),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: err instanceof Error ? err.message : String(err),
                }),
              },
            ],
          };
        }
      },
    );
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
