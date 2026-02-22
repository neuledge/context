import { existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getServerUrl } from "./config.js";
import { type SearchResult, search } from "./search.js";
import {
  type PackageInfo,
  type PackageStore,
  readPackageInfo,
} from "./store.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const DATA_DIR = join(homedir(), ".context", "packages");

/**
 * MCP server for documentation retrieval.
 * Provides get_docs, search_packages, and download_package tools.
 */
export class ContextServer {
  private mcp: McpServer;
  private store: PackageStore;
  // Tracks currently registered packages for dynamic get_docs updates
  private registeredPackages: PackageInfo[] = [];

  constructor(store: PackageStore) {
    this.store = store;
    this.mcp = new McpServer({
      name: "context",
      version,
    });
  }

  /**
   * Start the server with stdio transport.
   * Registers all tools. get_docs is only registered when packages are available.
   */
  async start(): Promise<void> {
    this.registerSearchPackagesTool();
    this.registerDownloadPackageTool();

    const packages = this.store.list();
    if (packages.length > 0) {
      this.refreshGetDocsTool(packages);
    }

    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
  }

  /** Access the underlying McpServer for testing. */
  get server(): McpServer {
    return this.mcp;
  }

  /**
   * Re-register get_docs with the current package list.
   * Called at startup and after each successful download.
   */
  private refreshGetDocsTool(packages: PackageInfo[]): void {
    this.registeredPackages = packages;
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
        // Always read from the store at query time for up-to-date results
        return this.handleGetDocs(this.registeredPackages, library, topic);
      },
    );
  }

  private registerSearchPackagesTool(): void {
    this.mcp.registerTool(
      "search_packages",
      {
        description:
          "Search the Context package registry for available documentation packages. Use this to discover pre-built documentation packages that can be downloaded and installed.",
        inputSchema: {
          registry: z
            .string()
            .describe("Package manager registry (e.g., 'npm', 'pip')"),
          name: z
            .string()
            .describe("Package name to search for (e.g., 'nextjs', 'react')"),
          version: z
            .string()
            .optional()
            .describe(
              "Specific version to search for. Omit to list all available versions.",
            ),
          server: z
            .string()
            .optional()
            .describe(
              "Server name from config (defaults to the configured default server)",
            ),
        },
      },
      async ({ registry, name, version: ver, server }) => {
        return this.handleSearchPackages(registry, name, ver, server);
      },
    );
  }

  private registerDownloadPackageTool(): void {
    this.mcp.registerTool(
      "download_package",
      {
        description:
          "Download and install a documentation package from the Context registry. After installation, the package becomes available in get_docs.",
        inputSchema: {
          registry: z
            .string()
            .describe("Package manager registry (e.g., 'npm', 'pip')"),
          name: z.string().describe("Package name (e.g., 'nextjs')"),
          version: z.string().describe("Version to download (e.g., '15.0.4')"),
          server: z
            .string()
            .optional()
            .describe(
              "Server name from config (defaults to the configured default server)",
            ),
        },
      },
      async ({ registry, name, version: ver, server }) => {
        return this.handleDownloadPackage(registry, name, ver, server);
      },
    );
  }

  private async handleSearchPackages(
    registry: string,
    name: string,
    ver: string | undefined,
    serverName: string | undefined,
  ): Promise<{ content: { type: "text"; text: string }[] }> {
    try {
      const serverUrl = getServerUrl(serverName);
      const params = new URLSearchParams({ registry, name });
      if (ver) params.set("version", ver);

      const response = await fetch(`${serverUrl}/search?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        return errorContent(
          `Search failed: ${response.status} ${response.statusText}`,
        );
      }

      const results = await response.json();
      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
      };
    } catch (err) {
      return errorContent(
        `Search error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleDownloadPackage(
    registry: string,
    name: string,
    ver: string,
    serverName: string | undefined,
  ): Promise<{ content: { type: "text"; text: string }[] }> {
    try {
      const serverUrl = getServerUrl(serverName);
      const downloadUrl = `${serverUrl}/packages/${registry}/${name}/${ver}/download`;

      mkdirSync(DATA_DIR, { recursive: true });
      const tempPath = join(
        DATA_DIR,
        `.downloading-${Date.now()}-${name}@${ver}.db`,
      );

      try {
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          return errorContent(
            `Download failed: ${response.status} ${response.statusText}`,
          );
        }
        if (!response.body) {
          return errorContent("Download failed: empty response body");
        }

        const { Readable } = await import("node:stream");
        const { createWriteStream } = await import("node:fs");
        const fileStream = createWriteStream(tempPath);
        const nodeStream = Readable.fromWeb(
          response.body as import("stream/web").ReadableStream,
        );
        await pipeline(nodeStream, fileStream);

        // Validate the downloaded package
        const info = readPackageInfo(tempPath);
        const destPath = join(DATA_DIR, `${info.name}@${info.version}.db`);

        if (existsSync(destPath)) {
          unlinkSync(destPath);
        }
        renameSync(tempPath, destPath);
        info.path = destPath;

        // Register in store and refresh get_docs tool
        this.store.add(info);
        this.refreshGetDocsTool(this.store.list());

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                package: `${info.name}@${info.version}`,
                sizeBytes: info.sizeBytes,
                sectionCount: info.sectionCount,
                message: `Installed ${info.name}@${info.version}. You can now use get_docs with library "${formatLibraryName(info)}".`,
              }),
            },
          ],
        };
      } catch (err) {
        if (existsSync(tempPath)) {
          try {
            unlinkSync(tempPath);
          } catch {
            // ignore cleanup errors
          }
        }
        throw err;
      }
    } catch (err) {
      return errorContent(
        `Download error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private handleGetDocs(
    packages: PackageInfo[],
    library: string,
    topic: string,
  ): { content: { type: "text"; text: string }[] } {
    const pkg = packages.find((p) => formatLibraryName(p) === library);

    if (!pkg) {
      return errorContent(`Package not found: ${library}`);
    }

    const db = this.store.openDb(pkg.name);
    if (!db) {
      return errorContent(`Failed to open package database: ${library}`);
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

function errorContent(message: string): {
  content: { type: "text"; text: string }[];
} {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  };
}
