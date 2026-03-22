/**
 * llms.txt source adapter for building documentation packages.
 *
 * Fetches a project's llms.txt and optionally llms-full.txt from a base URL,
 * then feeds the markdown content through the existing parseDocument pipeline.
 *
 * See: https://llmstxt.org/
 */

import type { ParsedDoc } from "./build.js";
import { parseDocument } from "./build.js";

export interface LlmsTxtSource {
  /** Raw content of llms.txt (the structured index). */
  index: string;
  /** Raw content of llms-full.txt (complete documentation), if available. */
  full?: string;
  /** Base URL where the files were fetched from. */
  baseUrl: string;
}

/**
 * Fetch llms.txt and optionally llms-full.txt from a base URL.
 *
 * @param baseUrl - The base URL of the project (e.g. "https://example.com")
 * @returns The fetched content, with `full` omitted if llms-full.txt is not found.
 */
export async function fetchLlmsTxt(baseUrl: string): Promise<LlmsTxtSource> {
  const normalizedBase = baseUrl.replace(/\/+$/, "");

  const [indexRes, fullRes] = await Promise.all([
    fetch(`${normalizedBase}/llms.txt`),
    fetch(`${normalizedBase}/llms-full.txt`).catch(() => null),
  ]);

  if (!indexRes.ok) {
    throw new Error(
      `Failed to fetch llms.txt from ${normalizedBase}/llms.txt: ${indexRes.status} ${indexRes.statusText}`,
    );
  }

  const index = await indexRes.text();

  let full: string | undefined;
  if (fullRes && fullRes.ok) {
    full = await fullRes.text();
  }

  return { index, full, baseUrl: normalizedBase };
}

/**
 * Parse llms.txt content into a ParsedDoc using the existing markdown pipeline.
 *
 * When llms-full.txt is available, it is used as the primary content source
 * (it contains the complete documentation). The index is parsed separately
 * so its section metadata is also captured.
 *
 * When only llms.txt (the index) is available, it is parsed directly —
 * providing a structured overview of the project's documentation.
 */
export function parseLlmsTxt(source: LlmsTxtSource): ParsedDoc[] {
  const docs: ParsedDoc[] = [];

  // Always parse the index
  docs.push(parseDocument(source.index, "llms.txt"));

  // If llms-full.txt is available, parse it as the complete documentation
  if (source.full) {
    docs.push(parseDocument(source.full, "llms-full.txt"));
  }

  return docs;
}
