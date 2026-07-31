/**
 * HTML document parser using turndown for HTML-to-Markdown conversion.
 * Strips non-content elements (nav, footer, scripts) and feeds the
 * resulting Markdown into the existing parseMarkdown pipeline.
 */

import TurndownService from "turndown";
import { type ParsedDoc, parseMarkdown } from "./build.js";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

/**
 * Elements dropped whole: page chrome and non-prose, never document content.
 *
 * Exported because `splitForParsing` has to keep its cuts out of their bodies. A cut
 * inside one leaves the opening tag in the previous chunk, so the next chunk's parser
 * never sees it and indexes the sidebar or footer as prose.
 */
export const REMOVED_TAGS = new Set([
  "script",
  "style",
  "nav",
  "footer",
  "header",
  "noscript",
  "title",
  "aside",
  "iframe",
  "form",
  "svg",
  "canvas",
]);

for (const tag of REMOVED_TAGS) {
  turndown.remove(tag);
}

/**
 * Parse an HTML file by converting to Markdown, then using the existing
 * Markdown parser for section extraction and chunking.
 */
export function parseHtml(source: string, filePath: string): ParsedDoc {
  const markdown = turndown.turndown(source);
  return parseMarkdown(markdown, filePath);
}
