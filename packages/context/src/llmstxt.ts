/**
 * llms.txt source adapter for building documentation packages.
 *
 * Fetches a project's llms.txt and optionally llms-full.txt from a base URL.
 *
 * See: https://llmstxt.org/
 */

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
