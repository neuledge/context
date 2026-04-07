/**
 * llms.txt index handling.
 *
 * The llms.txt spec (https://llmstxt.org/) defines llms.txt as a curated index
 * of links to documentation, organized under H2 sections. To build a useful
 * package from such an index, we must follow the links and fetch the linked
 * documents — otherwise we end up with only the table of contents.
 *
 * llms-full.txt, by contrast, already inlines the full documentation and
 * doesn't need link following.
 */

import type { MarkdownFile } from "./package-builder.js";

/** A link extracted from an llms.txt index. */
export interface LlmsTxtLink {
  /** The H2 section the link appeared under, or null for top-level links. */
  section: string | null;
  /** Display title from the markdown link. */
  title: string;
  /** Absolute URL of the linked resource. */
  url: string;
}

/**
 * Parse markdown link list items grouped by H2 section from an llms.txt file.
 * Resolves relative URLs against `baseUrl`. Invalid URLs are skipped silently.
 */
export function parseLlmsTxtLinks(
  content: string,
  baseUrl: string,
): LlmsTxtLink[] {
  const links: LlmsTxtLink[] = [];
  let currentSection: string | null = null;

  // Match markdown list items with a link: "- [title](url)" or "* [title](url)".
  const linkRegex = /^\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;

  for (const line of content.split(/\r?\n/)) {
    // Track current H2 section
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch?.[1]) {
      currentSection = headingMatch[1].trim();
      continue;
    }

    const linkMatch = line.match(linkRegex);
    if (linkMatch?.[1] && linkMatch[2]) {
      const title = linkMatch[1].trim();
      const rawUrl = linkMatch[2].trim();
      try {
        const resolved = new URL(rawUrl, baseUrl).toString();
        links.push({ section: currentSection, title, url: resolved });
      } catch {
        // Skip invalid URLs
      }
    }
  }

  return links;
}

export interface FetchLinkedDocsOptions {
  /** Maximum number of concurrent fetches. Default 5. */
  concurrency?: number;
  /** Per-request timeout in milliseconds. Default 30s. */
  timeoutMs?: number;
  /** Maximum number of links to follow. Default 500. */
  maxLinks?: number;
  /** Only follow links on the same hostname as `baseUrl`. Default true. */
  sameOriginOnly?: boolean;
  /** Custom fetch implementation (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Optional logger for progress messages. */
  log?: (message: string) => void;
}

interface FetchedDoc {
  url: string;
  file: MarkdownFile;
}

/** Fetch a single URL and convert it to a MarkdownFile, or return null on failure. */
async function fetchLink(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<FetchedDoc | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return null;

    const text = await response.text();
    if (!text.trim()) return null;

    // Choose an extension so parseDocument routes to the right parser.
    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    const isHtml =
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml") ||
      // Fall back to sniffing when servers don't set content-type properly
      (!contentType && /<html[\s>]/i.test(text.slice(0, 1024)));

    const path = pathFromUrl(url, isHtml ? ".html" : ".md");
    return { url, file: { path, content: text } };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Derive a stable, human-readable file path from a URL. */
function pathFromUrl(url: string, defaultExt: string): string {
  const parsed = new URL(url);
  let path = parsed.pathname.replace(/\/$/, "") || "/index";
  // If the path already has a recognized extension, keep it.
  if (!/\.(md|mdx|html?|adoc|rst|txt)$/i.test(path)) {
    path += defaultExt;
  }
  return parsed.host + path;
}

/**
 * Fetch all links from an llms.txt index and return them as MarkdownFile entries
 * ready to be passed to `buildPackage`. Failed fetches are skipped silently.
 */
export async function fetchLinkedDocs(
  content: string,
  baseUrl: string,
  options: FetchLinkedDocsOptions = {},
): Promise<MarkdownFile[]> {
  const {
    concurrency = 5,
    timeoutMs = 30_000,
    maxLinks = 500,
    sameOriginOnly = true,
    fetchImpl = fetch,
    log,
  } = options;

  const baseHost = new URL(baseUrl).host;
  const allLinks = parseLlmsTxtLinks(content, baseUrl);

  // Filter and dedupe
  const seen = new Set<string>();
  const links: LlmsTxtLink[] = [];
  for (const link of allLinks) {
    if (sameOriginOnly && new URL(link.url).host !== baseHost) continue;
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    links.push(link);
    if (links.length >= maxLinks) break;
  }

  if (links.length === 0) return [];

  log?.(
    `Following ${links.length} link${links.length === 1 ? "" : "s"} from llms.txt...`,
  );

  const results: MarkdownFile[] = [];
  let index = 0;
  let completed = 0;
  let failed = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = index++;
      if (i >= links.length) return;
      const link = links[i];
      if (!link) return;
      const fetched = await fetchLink(link.url, fetchImpl, timeoutMs);
      completed++;
      if (fetched) {
        results.push(fetched.file);
      } else {
        failed++;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, links.length) },
    () => worker(),
  );
  await Promise.all(workers);

  log?.(
    `✓ Fetched ${completed - failed}/${completed} linked documents${failed > 0 ? ` (${failed} failed)` : ""}`,
  );

  return results;
}
