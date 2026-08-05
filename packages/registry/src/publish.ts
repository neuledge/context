/**
 * Publish documentation packages to the registry server.
 *
 * Server API:
 * - GET  /packages/<registry>/<name>/<version> — Check existence / metadata
 * - POST /packages/<registry>/<name>/<version> — Upload .db file (authenticated)
 */

import { readFileSync } from "node:fs";
import pRetry, { AbortError } from "p-retry";

const DEFAULT_SERVER_URL = "https://api.context.neuledge.com";

/**
 * The registry server occasionally drops a connection or returns 5xx under load.
 * A single blip used to fail the whole nightly publish — 48 packages succeed and
 * one `fetch failed` exits non-zero — so retry transient faults with backoff.
 * 4xx is the server's considered answer and aborts immediately.
 */
function requestWithRetry(
  url: string,
  init: RequestInit,
  describe: () => string,
): Promise<Response> {
  return pRetry(
    async () => {
      const response = await fetch(url, init);
      if (response.ok || response.status === 404) return response;

      const body = await response.text().catch(() => "");
      const error = new Error(
        `${describe()}: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
      );
      if (response.status < 500) throw new AbortError(error);
      throw error;
    },
    { retries: 3 },
  );
}

function getServerUrl(): string {
  return process.env.REGISTRY_SERVER_URL?.trim() || DEFAULT_SERVER_URL;
}

function getPublishKey(): string {
  const key = process.env.REGISTRY_PUBLISH_KEY?.trim();
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

  const headers: Record<string, string> = {};
  const key = process.env.REGISTRY_PUBLISH_KEY?.trim();
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  const response = await requestWithRetry(
    url,
    { headers },
    () => `Server error checking ${registry}/${name}@${version}`,
  );

  if (response.status === 404) {
    return null;
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

  // Re-uploading an identical package is safe: the server keys on
  // registry/name/version, so a retry after a dropped connection overwrites
  // rather than duplicating.
  await requestWithRetry(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getPublishKey()}`,
        "Content-Type": "application/octet-stream",
      },
      body,
    },
    () => `Failed to publish ${registry}/${name}@${version}`,
  );
}
