/** Download a pinned table of contents and its same-directory HTML pages. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseHTML } from "linkedom";
import type { HtmlIndexSource } from "./definition.js";
import { compileGlob } from "./glob.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const CACHE_DIR = resolve(".cache/context/html-index");
const HTML_PATH = /\.html?$/i;

export function resolveIndexUrl(template: string, version: string): URL {
  if (!/^\d+(?:[._-][A-Za-z0-9]+)*$/.test(version)) {
    throw new Error(`HTML index requires a pinned numeric release: ${version}`);
  }
  if (template.split("{version}").length !== 2) {
    throw new Error("HTML index URL requires one {version} directory");
  }
  const url = new URL(template.replace("{version}", version));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !template.includes("/{version}/") ||
    !url.pathname.includes(`/${version}/`) ||
    (!url.pathname.endsWith("/") && !HTML_PATH.test(url.pathname)) ||
    /%(?:2f|5c|25|00)/i.test(url.pathname)
  ) {
    throw new Error("HTML index URL must pin an HTTPS version directory");
  }
  return url;
}

/** URL parsing normalizes dot segments; encoded separators remain forbidden. */
function scopedUrl(href: string, base: URL, root: URL): URL | undefined {
  try {
    const url = new URL(href, base);
    if (
      url.origin !== root.origin ||
      url.username ||
      url.password ||
      url.search ||
      !url.pathname.startsWith(root.pathname) ||
      /%(?:2f|5c|25|00)/i.test(url.pathname)
    )
      return;
    decodeURIComponent(url.pathname); // Reject malformed escapes as well.
    url.hash = "";
    return url;
  } catch {
    return;
  }
}

function indexLinks(
  html: string,
  index: URL,
  root: URL,
  source: HtmlIndexSource,
): URL[] {
  const { document } = parseHTML(html);
  const excluded = source.exclude_paths?.map(compileGlob) ?? [];
  const urls = new Set<string>();
  for (const anchor of document.querySelectorAll("a[href]")) {
    const url = scopedUrl(anchor.getAttribute("href") ?? "", index, root);
    if (!url || !HTML_PATH.test(url.pathname) || url.href === index.href)
      continue;
    const path = decodeURIComponent(url.pathname.slice(root.pathname.length));
    if (excluded.some((pattern) => pattern.test(path))) continue;
    urls.add(url.href);
    if (urls.size > source.max_pages) {
      throw new Error(
        `HTML index exceeds max_pages (${source.max_pages}): ${index}`,
      );
    }
  }
  if (!urls.size)
    throw new Error(`No documentation links found in HTML index: ${index}`);
  return [...urls].sort().map((url) => new URL(url));
}

interface CachedPage {
  url: string;
  finalUrl: string;
  content: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readCache(
  path: string,
  url: URL,
  root: URL,
): Promise<CachedPage | undefined> {
  try {
    const page: CachedPage = JSON.parse(await readFile(path, "utf8"));
    if (
      page.url === url.href &&
      typeof page.finalUrl === "string" &&
      scopedUrl(page.finalUrl, url, root) &&
      typeof page.content === "string" &&
      page.content.trim() &&
      Buffer.byteLength(page.content) <= MAX_BYTES
    )
      return page;
  } catch {
    // Missing or interrupted cache entries are refetched.
  }
  return;
}

async function writeCache(path: string, page: CachedPage): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(page));
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

class RetryableError extends Error {}

async function readHtml(response: Response, url: URL): Promise<string> {
  const type = response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (type !== "text/html" && type !== "application/xhtml+xml") {
    await response.body?.cancel();
    throw new Error(
      `Expected HTML from ${url}, received ${type ?? "no content type"}`,
    );
  }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error(`HTML response exceeds 10 MiB: ${url}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Empty HTML response: ${url}`);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES)
        throw new Error(`HTML response exceeds 10 MiB: ${url}`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const content = Buffer.concat(chunks).toString("utf8");
  if (!content.trim()) throw new Error(`Empty HTML response: ${url}`);
  return content;
}

async function requestPage(
  url: URL,
  root: URL,
  signal: AbortSignal,
): Promise<CachedPage> {
  let current = url;
  // This deadline covers redirects AND the streamed body, not just headers.
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  for (let redirects = 0; redirects <= 5; redirects++) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: timeout,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent":
            "context-registry/1.0 (+https://github.com/neuledge/context)",
        },
      });
    } catch (error) {
      throw new RetryableError(`Could not fetch ${current}: ${String(error)}`);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      const next = location ? scopedUrl(location, current, root) : undefined;
      if (
        !next ||
        (next.pathname !== root.pathname && !HTML_PATH.test(next.pathname))
      ) {
        throw new Error(
          `HTML redirect leaves the pinned directory: ${current} -> ${location}`,
        );
      }
      current = next;
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      const message = `Failed to fetch ${current}: HTTP ${response.status}`;
      if (response.status === 429 || response.status >= 500)
        throw new RetryableError(message);
      throw new Error(message);
    }
    try {
      return {
        url: url.href,
        finalUrl: current.href,
        content: await readHtml(response, current),
      };
    } catch (error) {
      if (timeout.aborted || error instanceof TypeError) {
        throw new RetryableError(`Could not read ${current}: ${String(error)}`);
      }
      throw error;
    }
  }
  throw new Error(`Too many HTML redirects: ${url}`);
}

async function fetchPage(
  url: URL,
  root: URL,
  cacheDir: string,
  signal: AbortSignal,
): Promise<CachedPage> {
  const path = join(cacheDir, `${digest(url.href)}.json`);
  const cached = await readCache(path, url, root);
  if (cached) return cached;
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const page = await requestPage(url, root, signal);
      await writeCache(path, page);
      return page;
    } catch (error) {
      if (!(error instanceof RetryableError) || attempt === 2 || signal.aborted)
        throw error;
      await delay(1000 * 2 ** attempt, undefined, { signal });
    }
  }
}

export async function downloadHtmlIndex(
  source: HtmlIndexSource,
  version: string,
  options: { cacheDir?: string } = {},
): Promise<Array<{ path: string; content: string }>> {
  const index = resolveIndexUrl(source.url, version);
  const root = new URL(".", index);
  const cacheDir = options.cacheDir ?? CACHE_DIR;
  await mkdir(cacheDir, { recursive: true });
  const controller = new AbortController();
  const indexPage = await fetchPage(index, root, cacheDir, controller.signal);
  const urls = indexLinks(
    indexPage.content,
    new URL(indexPage.finalUrl),
    root,
    source,
  );
  const pages = new Map<string, CachedPage>();
  let totalBytes = Buffer.byteLength(indexPage.content);
  let cursor = 0;
  let failure: unknown;
  const worker = async () => {
    try {
      while (!controller.signal.aborted) {
        const url = urls[cursor++];
        if (!url) return;
        const page = await fetchPage(url, root, cacheDir, controller.signal);
        totalBytes += Buffer.byteLength(page.content);
        if (totalBytes > MAX_TOTAL_BYTES)
          throw new Error("HTML index exceeds 128 MiB total");
        pages.set(url.href, page);
      }
    } catch (error) {
      if (!controller.signal.aborted) failure = error;
      controller.abort();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(source.concurrency, urls.length) }, worker),
  );
  if (failure) throw failure;
  const seen = new Set<string>();
  const files: Array<{ path: string; content: string }> = [];
  // Stable order chooses the same alias regardless of download completion order.
  for (const url of urls) {
    const page = pages.get(url.href);
    if (!page) throw new Error(`HTML page was not downloaded: ${url}`);
    const hash = digest(page.content);
    if (seen.has(hash)) continue;
    seen.add(hash);
    files.push({
      path: decodeURIComponent(url.pathname.slice(root.pathname.length)),
      content: page.content,
    });
  }
  return files;
}
