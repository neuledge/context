/**
 * Publish documentation packages to the registry server.
 *
 * Server API:
 * - GET  /packages/<registry>/<name>/<version> — Check existence / metadata
 * - POST /packages/<registry>/<name>/<version> — Upload .db file (authenticated)
 */

import { readFileSync } from "node:fs";
import { initDatabase, openDatabase } from "@neuledge/context";
import pRetry, { AbortError } from "p-retry";
import type { Source } from "./definition.js";

const DEFAULT_SERVER_URL = "https://api.context.neuledge.com";

class RegistryRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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
      if (response.ok || (response.status === 404 && init.method !== "POST"))
        return response;

      const body = await response.text().catch(() => "");
      const error = new RegistryRequestError(
        response.status,
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
  build_fingerprint?: string;
  ingestion_revision?: string;
}

export interface PublishOptions {
  /**
   * The resolved source type of the artifact being published. Only Git builds
   * can recover a lost upload response after a 409: their fingerprint embeds
   * the content-addressed commit, so a matching fingerprint proves the server
   * already holds this exact artifact.
   */
  sourceType?: Source["type"];
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
  options: PublishOptions = {},
): Promise<void> {
  const url = `${getServerUrl()}/packages/${encodeURIComponent(registry)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const body = readFileSync(dbPath);

  try {
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
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (error instanceof RegistryRequestError && error.status === 409) {
      // ZIP and HTML fingerprints use the version, not the downloaded bytes, so
      // changed content at the same version still produces the same fingerprint.
      // Accepting a matching fingerprint here would silently treat a rejected
      // replacement as published. Only a Git build — whose fingerprint includes
      // the content-addressed commit — can prove the server holds this upload.
      if (options.sourceType === "git") {
        try {
          if (await matchesPublishedArtifact(registry, name, version, dbPath))
            return;
        } catch (verificationError) {
          message += `. Could not verify published metadata: ${verificationError instanceof Error ? verificationError.message : String(verificationError)}`;
        }
      }
      message +=
        ". The registry rejected replacement of this published version. Use a registry-supported replacement or artifact revision; --force cannot override the server's policy";
    }
    throw new Error(
      `${message}. The rebuilt artifact is preserved at ${dbPath}.`,
      {
        cause: error,
      },
    );
  }
}

/** A lost upload response is recoverable only with matching artifact metadata. */
async function matchesPublishedArtifact(
  registry: string,
  name: string,
  version: string,
  dbPath: string,
): Promise<boolean> {
  await initDatabase();
  const db = openDatabase(dbPath, { readonly: true });
  let values: Record<string, string>;
  try {
    values = Object.fromEntries(
      (
        db.prepare("SELECT key, value FROM meta").all() as {
          key: string;
          value: string;
        }[]
      ).map(({ key, value }) => [key, value]),
    );
  } finally {
    db.close();
  }
  if (!values.build_fingerprint || !values.ingestion_revision) return false;
  const published = await checkPackageExists(registry, name, version);
  return (
    published?.registry === registry &&
    published.name === name &&
    published.version === version &&
    published.build_fingerprint === values.build_fingerprint &&
    published.ingestion_revision === values.ingestion_revision
  );
}
