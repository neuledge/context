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

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Perform a fetch with an AbortController timeout.
 * Rejects with an AbortError if the request takes longer than timeoutMs.
 */
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a fetch Response body as text, capping the total bytes read.
 * Returns null if the body exceeds maxBytes.
 */
export async function readResponseText(
  response: Response,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.length;
      if (bytesRead > maxBytes) return null;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch {
    return null;
  }
}
