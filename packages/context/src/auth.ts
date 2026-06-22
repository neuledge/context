/**
 * Per-platform authentication configuration.
 *
 * Many content platforms (Medium, Substack, etc.) gate content behind
 * login. Users with legitimate subscriptions can store cookies/auth
 * tokens per domain so that `context add <url>` can fetch authenticated
 * content automatically.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PlatformAuth {
  /** Cookie string sent as the Cookie header. */
  cookies?: string;
  /** Additional headers to send with requests to this platform. */
  headers?: Record<string, string>;
}

export type AuthConfig = Record<string, PlatformAuth>;

const AUTH_PATH = join(homedir(), ".context", "auth.json");

let authCache: AuthConfig | undefined;

/** Clear the in-memory auth cache. Useful in tests. */
export function clearAuthCache(): void {
  authCache = undefined;
}

/** Load auth config from disk. Returns empty object if missing. */
export function loadAuth(): AuthConfig {
  if (authCache !== undefined) return authCache;
  try {
    if (existsSync(AUTH_PATH)) {
      const raw = readFileSync(AUTH_PATH, "utf-8");
      authCache = JSON.parse(raw) as AuthConfig;
      return authCache;
    }
  } catch {
    // Ignore parse errors — treat as empty
  }
  authCache = {};
  return authCache;
}

/** Save auth config to disk. */
export function saveAuth(auth: AuthConfig): void {
  const dir = join(homedir(), ".context");
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o700);
  writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2), { mode: 0o600 });
  authCache = auth;
}

/**
 * Find the best matching auth entry for a URL.
 *
 * Looks for an exact hostname match first, then tries progressively
 * shorter parent domains (e.g., `rafahari.substack.com` → `substack.com`).
 */
export function findAuthForUrl(
  auth: AuthConfig,
  url: string,
): PlatformAuth | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }

  // Try exact match, then one immediate parent domain only.
  // We intentionally stop after one parent to avoid matching public
  // suffixes like co.uk.
  const parts = hostname.split(".");
  for (let i = 0; i < Math.min(2, parts.length - 1); i++) {
    const domain = parts.slice(i).join(".");
    if (auth[domain]) {
      return auth[domain];
    }
  }

  return null;
}

/**
 * Build RequestInit headers for a fetch, merging platform auth
 * if a matching entry exists.
 */
export function withPlatformAuth(
  auth: AuthConfig,
  url: string,
  baseHeaders: Record<string, string> = {},
): RequestInit {
  const platformAuth = findAuthForUrl(auth, url);
  if (!platformAuth) {
    return { headers: baseHeaders, redirect: "follow" };
  }

  const headers: Record<string, string> = { ...baseHeaders };

  if (platformAuth.cookies) {
    headers.Cookie = platformAuth.cookies;
  }

  if (platformAuth.headers) {
    Object.assign(headers, platformAuth.headers);
  }

  return { headers, redirect: "follow" };
}
