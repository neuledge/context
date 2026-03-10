import { createServer } from "node:http";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getServerUrl } from "./config.js";
import { downloadPackage, searchPackages } from "./download.js";
import {
  DOWNLOAD_PACKAGE_DESCRIPTION,
  GET_DOCS_DESCRIPTION,
  GET_DOCS_LIBRARY_DESCRIPTION,
  GET_DOCS_TOPIC_DESCRIPTION,
  MISSING_PACKAGE_GUIDANCE,
  NO_DOCUMENTATION_FOUND_MESSAGE,
  SEARCH_PACKAGES_DESCRIPTION,
  SEARCH_PACKAGES_NAME_DESCRIPTION,
} from "./guidance.js";
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
   * Register all MCP tools. Called before connecting a transport.
   */
  private registerTools(): void {
    const packages = this.store.list();
    this.registerGetDocsTool(packages);
    this.registerSearchPackagesTool();
    this.registerDownloadPackageTool();
  }

  /**
   * Start the server with stdio transport.
   * Registers tools and connects.
   */
  async start(): Promise<void> {
    this.registerTools();

    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
  }

  /**
   * Start the server with Streamable HTTP transport.
   * Creates an HTTP server that handles MCP protocol over HTTP,
   * allowing multiple clients on the network to connect.
   *
   * @returns The HTTP server instance and the port it's listening on.
   */
  async startHTTP(options: {
    port: number;
    host?: string;
  }): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
    this.registerTools();

    const host = options.host ?? "127.0.0.1";

    // Track transports by session ID for multi-client support
    const transports = new Map<string, StreamableHTTPServerTransport>();

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      if (url.pathname !== "/mcp") {
        res.writeHead(404).end("Not Found");
        return;
      }

      // Handle DELETE for session termination
      if (req.method === "DELETE") {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        const transport = sessionId ? transports.get(sessionId) : undefined;
        if (sessionId && transport) {
          await transport.close();
          transports.delete(sessionId);
          res.writeHead(200).end();
        } else {
          res.writeHead(404).end("Session not found");
        }
        return;
      }

      // For GET and POST, route to existing transport or create new one
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        // Existing session
        await transports.get(sessionId)?.handleRequest(req, res);
        return;
      }

      if (sessionId && !transports.has(sessionId)) {
        // Invalid session ID
        res.writeHead(404).end("Session not found");
        return;
      }

      // New session (no session ID header) — create a new transport.
      // Pre-generate the session ID so we can store the transport before
      // handleRequest (which may keep an SSE stream open indefinitely).
      const newSessionId = crypto.randomUUID();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      });

      transport.onclose = () => {
        transports.delete(newSessionId);
      };

      transports.set(newSessionId, transport);

      // Each new transport gets its own ContextServer sharing the same store
      const sessionCtx = new ContextServer(this.store);
      sessionCtx.registerTools();

      await sessionCtx.mcp.connect(transport);
      await transport.handleRequest(req, res);
    });

    return new Promise((resolve) => {
      httpServer.listen(options.port, host, () => {
        const addr = httpServer.address();
        const actualPort =
          typeof addr === "object" && addr ? addr.port : options.port;
        resolve({ server: httpServer, port: actualPort });
      });
    });
  }

  /** Access the underlying McpServer for testing. */
  get server(): McpServer {
    return this.mcp;
  }

  /**
   * Always expose get_docs so first-run agents can discover the registry-first
   * workflow instead of failing because the tool is absent.
   */
  private buildGetDocsLibrarySchema(
    packages: PackageInfo[],
  ): z.ZodType<string> {
    if (packages.length === 0) {
      return z.string().describe(GET_DOCS_LIBRARY_DESCRIPTION);
    }

    const libraryEnum = packages.map(formatLibraryName);
    return z
      .enum(libraryEnum as [string, ...string[]])
      .describe(GET_DOCS_LIBRARY_DESCRIPTION);
  }

  private registerGetDocsTool(packages: PackageInfo[]): void {
    this.getDocsRegistration = this.mcp.registerTool(
      "get_docs",
      {
        description: GET_DOCS_DESCRIPTION,
        inputSchema: {
          library: this.buildGetDocsLibrarySchema(packages),
          topic: z.string().describe(GET_DOCS_TOPIC_DESCRIPTION),
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

    if (this.getDocsRegistration) {
      // Update existing tool with new enum
      this.getDocsRegistration.update({
        paramsSchema: {
          library: this.buildGetDocsLibrarySchema(packages),
          topic: z.string().describe(GET_DOCS_TOPIC_DESCRIPTION),
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
            text: JSON.stringify({
              error: `Package not found: ${library}`,
              message: MISSING_PACKAGE_GUIDANCE,
            }),
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
        description: SEARCH_PACKAGES_DESCRIPTION,
        inputSchema: {
          registry: z
            .string()
            .describe('Package registry (e.g., "npm", "pip", "cargo", "go")'),
          name: z.string().describe(SEARCH_PACKAGES_NAME_DESCRIPTION),
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
        description: DOWNLOAD_PACKAGE_DESCRIPTION,
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
      message: NO_DOCUMENTATION_FOUND_MESSAGE,
    });
  }

  return JSON.stringify({
    library: result.library,
    version: result.version,
    results: result.results,
  });
}
