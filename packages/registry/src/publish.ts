/**
 * Publish documentation packages to the registry server.
 *
 * Server API:
 * - GET  /packages/<registry>/<name>/<version> — Check existence / metadata
 * - POST /packages/<registry>/<name>/<version> — Upload .db file (authenticated)
 */

import { readFileSync } from "node:fs";

const DEFAULT_SERVER_URL = "https://context.neuledge.com";

function getServerUrl(): string {
  return process.env.REGISTRY_SERVER_URL || DEFAULT_SERVER_URL;
}

function getPublishKey(): string {
  const key = process.env.REGISTRY_PUBLISH_KEY;
  if (!key) {
    throw new Error(
      "REGISTRY_PUBLISH_KEY environment variable is required for publishing",
    );
  }
  return key;
}

export interface PackageMetadata {
  registry: string;
  name: string;
  version: string;
  source_commit?: string;
}

/**
 * Check if a package version already exists on the server.
 * Returns metadata if it exists, null if not found.
 */
export async function checkPackageExists(
  registry: string,
  name: string,
  version: string,
): Promise<PackageMetadata | null> {
  const url = `${getServerUrl()}/packages/${encodeURIComponent(registry)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const response = await fetch(url);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Server error checking ${registry}/${name}@${version}: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as PackageMetadata;
}

/**
 * Upload a .db package to the server.
 */
export async function publishPackage(
  registry: string,
  name: string,
  version: string,
  dbPath: string,
): Promise<void> {
  const url = `${getServerUrl()}/packages/${encodeURIComponent(registry)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const body = readFileSync(dbPath);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getPublishKey()}`,
      "Content-Type": "application/octet-stream",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to publish ${registry}/${name}@${version}: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
    );
  }
}
