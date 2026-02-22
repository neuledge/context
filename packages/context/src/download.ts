/**
 * Download server client for searching and downloading packages.
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getDefaultServer, getServers, type ServerConfig } from "./config.js";
import { type PackageInfo, readPackageInfo } from "./store.js";

export interface RemotePackage {
  name: string;
  registry: string;
  version: string;
  description?: string;
  size?: number;
}

export interface SearchOptions {
  registry: string;
  name: string;
  version?: string;
  server?: string;
}

export interface DownloadOptions {
  registry: string;
  name: string;
  version: string;
  server?: string;
}

const DATA_DIR = join(homedir(), ".context", "packages");

function resolveServer(serverName?: string): ServerConfig {
  if (!serverName) return getDefaultServer();
  const servers = getServers();
  const server = servers.find((s) => s.name === serverName);
  if (!server) {
    throw new Error(
      `Server "${serverName}" not found. Available: ${servers.map((s) => s.name).join(", ")}`,
    );
  }
  return server;
}

/**
 * Search for packages on a download server.
 */
export async function searchPackages(
  options: SearchOptions,
): Promise<RemotePackage[]> {
  const server = resolveServer(options.server);
  const params = new URLSearchParams({
    registry: options.registry,
    name: options.name,
  });
  if (options.version) {
    params.set("version", options.version);
  }

  const res = await fetch(`${server.url}/search?${params}`);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Search failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as RemotePackage[];
}

/**
 * Download and install a package from a download server.
 * Returns the installed PackageInfo.
 */
export async function downloadPackage(
  options: DownloadOptions,
): Promise<PackageInfo> {
  const server = resolveServer(options.server);
  const url = `${server.url}/packages/${encodeURIComponent(options.registry)}/${encodeURIComponent(options.name)}/${encodeURIComponent(options.version)}/download`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error("Download failed: no response body");
  }

  // Ensure data directory exists
  mkdirSync(DATA_DIR, { recursive: true });

  // Download to temp file first
  const tempPath = join(DATA_DIR, `.downloading-${Date.now()}.db`);

  try {
    const nodeStream = Readable.fromWeb(
      res.body as import("stream/web").ReadableStream,
    );
    await pipeline(nodeStream, createWriteStream(tempPath));

    // Validate the package
    const info = readPackageInfo(tempPath);

    // Move to final location
    const destName = `${info.name}@${info.version}.db`;
    const destPath = join(DATA_DIR, destName);

    if (existsSync(destPath)) {
      unlinkSync(destPath);
    }
    renameSync(tempPath, destPath);
    info.path = destPath;

    return info;
  } catch (err) {
    // Clean up temp file on failure
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw err;
  }
}
