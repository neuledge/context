/**
 * Publish built .db packages to the context server.
 * Handles existence checks and authenticated uploads.
 */

import { createReadStream, statSync } from "node:fs";

const DEFAULT_SERVER_URL = "https://context.neuledge.com";

function getServerUrl(): string {
  return process.env.REGISTRY_SERVER_URL ?? DEFAULT_SERVER_URL;
}

/**
 * Check if a package version already exists on the server.
 */
export async function checkExists(
  registry: string,
  name: string,
  version: string,
  serverUrl = getServerUrl(),
): Promise<boolean> {
  const url = `${serverUrl}/packages/${registry}/${name}/${version}`;
  const response = await fetch(url, { method: "HEAD" });
  return response.ok;
}

/**
 * Publish a .db file to the server.
 * Requires REGISTRY_PUBLISH_KEY environment variable (or explicit key param).
 */
export async function publishPackage(
  registry: string,
  name: string,
  version: string,
  dbPath: string,
  options: { key?: string; serverUrl?: string } = {},
): Promise<void> {
  const key = options.key ?? process.env.REGISTRY_PUBLISH_KEY;
  if (!key) {
    throw new Error(
      "REGISTRY_PUBLISH_KEY environment variable is required for publishing",
    );
  }

  const serverUrl = options.serverUrl ?? getServerUrl();
  const url = `${serverUrl}/packages/${registry}/${name}/${version}`;

  const fileSize = statSync(dbPath).size;
  const fileStream = createReadStream(dbPath);

  // Use Readable.toWeb to convert Node stream to fetch-compatible ReadableStream
  const { Readable } = await import("node:stream");
  const body = Readable.toWeb(fileStream) as ReadableStream;

  // Cast to any to pass duplex option (Node 18+ fetch requirement for streaming bodies)
  // biome-ignore lint/suspicious/noExplicitAny: required for Node.js streaming fetch
  const fetchOptions: any = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(fileSize),
    },
    body,
    duplex: "half",
  };
  const response = await fetch(url, fetchOptions as RequestInit);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Publish failed for ${registry}/${name}@${version}: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
    );
  }
}
