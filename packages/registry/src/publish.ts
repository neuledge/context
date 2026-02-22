/**
 * Publish built .db packages to the Neuledge server.
 */

import { readFileSync, statSync } from "node:fs";

const DEFAULT_SERVER_URL = "https://context.neuledge.com";

function getServerUrl(): string {
  return process.env.REGISTRY_SERVER_URL ?? DEFAULT_SERVER_URL;
}

/**
 * Check if a package version already exists on the server.
 */
export async function checkPackageExists(
  registry: string,
  name: string,
  version: string,
): Promise<boolean> {
  const url = `${getServerUrl()}/packages/${encodeURIComponent(registry)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const res = await fetch(url);
  return res.status === 200;
}

/**
 * Upload a .db file to the server.
 */
export async function publishPackage(
  registry: string,
  name: string,
  version: string,
  dbPath: string,
): Promise<void> {
  const key = process.env.REGISTRY_PUBLISH_KEY;
  if (!key) {
    throw new Error(
      "REGISTRY_PUBLISH_KEY environment variable is required for publishing",
    );
  }

  const url = `${getServerUrl()}/packages/${encodeURIComponent(registry)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const body = readFileSync(dbPath);
  const size = statSync(dbPath).size;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Publish failed (${res.status}): ${text}`);
  }
}
