/**
 * Shared fetch utilities for making HTTP requests with consistent headers
 * and platform authentication.
 */

import { loadAuth, withPlatformAuth } from "./auth.js";

/** Default browser-like headers to bypass basic bot protection. */
export const DEFAULT_FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  DNT: "1",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

/** Build fetch init options, merging platform auth and optional cookies from env. */
export function buildFetchOptions(
  url?: string,
  extraHeaders?: Record<string, string>,
): RequestInit {
  const baseHeaders = { ...DEFAULT_FETCH_HEADERS, ...extraHeaders };

  const cookieEnv = process.env.CONTEXT_FETCH_COOKIES;
  if (cookieEnv) {
    baseHeaders.Cookie = cookieEnv;
  }

  if (url) {
    const auth = loadAuth();
    return withPlatformAuth(auth, url, baseHeaders);
  }

  return { headers: baseHeaders, redirect: "follow" };
}
