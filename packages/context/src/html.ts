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

// Remove non-content elements
for (const tag of [
  "script",
  "style",
  "nav",
  "footer",
  "header",
  "noscript",
  "title",
]) {
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
