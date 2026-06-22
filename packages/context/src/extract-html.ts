/**
 * Extract the main article content from an HTML page and convert to
 * Markdown. Uses defuddle (Obsidian Web Clipper's extractor) to strip
 * subscribe boxes, navigation, comment widgets, and other clutter that
 * plain tag-denylisting leaves behind on platforms like Substack and
 * Medium.
 */

import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";

export interface ExtractedArticle {
  markdown: string;
  title?: string;
}

/**
 * Run defuddle on raw HTML and return clean Markdown, or `null` if
 * extraction produced no usable content.
 */
export async function extractArticleMarkdown(
  html: string,
  url: string,
): Promise<ExtractedArticle | null> {
  try {
    const { document } = parseHTML(html);
    const result = await Defuddle(document, url, { markdown: true });
    const content = result.contentMarkdown ?? result.content;
    if (!content?.trim()) return null;
    return {
      markdown: content,
      title: result.title?.trim() || undefined,
    };
  } catch {
    return null;
  }
}
