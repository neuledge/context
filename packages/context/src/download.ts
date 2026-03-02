/**
 * Download and install documentation packages from a registry server.
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
import { pipeline } from "node:stream/promises";
import { type PackageInfo, readPackageInfo } from "./store.js";

const DATA_DIR = join(homedir(), ".context", "packages");

export interface SearchResultEntry {
  registry: string;
  name: string;
  version: string;
  description?: string;
  size?: number;
}

/**
 * Search for packages on a registry server.
 */
export async function searchPackages(
  serverUrl: string,
  registry: string,
  name: string,
  version?: string,
): Promise<SearchResultEntry[]> {
  const params = new URLSearchParams({ registry, name });
  if (version) params.set("version", version);

  const url = `${serverUrl}/search?${params}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as SearchResultEntry[];
}

/**
 * Download and install a package from a registry server.
 * Returns the installed PackageInfo.
 */
export async function downloadPackage(
  serverUrl: string,
  registry: string,
  name: string,
  version: string,
): Promise<PackageInfo> {
  const url = `${serverUrl}/packages/${encodeURIComponent(registry)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}/download`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`,
    );
  }

  if (!response.body) {
    throw new Error("Download failed: no response body");
  }

  // Download to a temp file first, then validate and move
  mkdirSync(DATA_DIR, { recursive: true });
  const tempPath = join(DATA_DIR, `.downloading-${Date.now()}-${name}.db`);

  try {
    const fileStream = createWriteStream(tempPath);
    const { Readable } = await import("node:stream");
    const nodeStream = Readable.fromWeb(
      response.body as import("stream/web").ReadableStream,
    );
    await pipeline(nodeStream, fileStream);

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
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw err;
  }
}
