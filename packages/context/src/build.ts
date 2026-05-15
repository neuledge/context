/**
 * Build utilities for generating documentation packages.
 * Parses markdown/MDX, AsciiDoc, and reStructuredText files and chunks them by section.
 */

import type { Content, Heading, Root, Yaml } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as parseYaml } from "yaml";
import { parseHtml } from "./html.js";

export interface DocFrontmatter {
  title?: string;
  description?: string;
}

export interface DocSection {
  docPath: string;
  docTitle: string;
  sectionTitle: string;
  content: string;
  tokens: number;
  hasCode: boolean;
}

export interface ParsedDoc {
  path: string;
  frontmatter: DocFrontmatter;
  sections: DocSection[];
}

const MAX_CHUNK_TOKENS = 800;
const HARD_LIMIT_TOKENS = 1200; // Absolute maximum - split unconditionally above this
const MIN_CHUNK_TOKENS = 5; // Filter out trivial chunks like "<br/>" (2 tokens)
const TOC_LINK_RATIO = 0.5; // Skip sections where >50% of content is links

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Check if content contains code blocks. */
function hasCodeBlock(content: string): boolean {
  return /```[\s\S]*?```/.test(content);
}

/**
 * Check if a section is likely a table of contents.
 * Detects based on section title or high link-to-content ratio.
 */
function isTableOfContents(sectionTitle: string, content: string): boolean {
  const lowerTitle = sectionTitle.toLowerCase();

  // Check title patterns
  if (
    lowerTitle.includes("table of contents") ||
    lowerTitle === "toc" ||
    lowerTitle === "contents" ||
    lowerTitle === "index"
  ) {
    return true;
  }

  // Check link ratio - TOC sections are mostly links
  const linkPattern = /\[([^\]]*)\]\([^)]+\)/g;
  const links = content.match(linkPattern) || [];
  const linkTextLength = links.reduce((sum, link) => sum + link.length, 0);

  // If more than 50% of content is links, likely a TOC
  if (content.length > 0 && linkTextLength / content.length > TOC_LINK_RATIO) {
    return true;
  }

  return false;
}

/**
 * Split oversized content at code block boundaries or line boundaries.
 * This handles the case where a single "paragraph" (like a large code block) exceeds limits.
 */
function splitOversizedContent(content: string): string[] {
  const tokens = estimateTokens(content);
  if (tokens <= HARD_LIMIT_TOKENS) {
    return [content];
  }

  // First try to split at code block boundaries
  const codeBlockRegex = /```[\s\S]*?```/g;
  const parts: string[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(codeBlockRegex)) {
    const beforeBlock = content.slice(lastIndex, match.index).trim();
    if (beforeBlock) {
      parts.push(beforeBlock);
    }
    parts.push(match[0]);
    lastIndex = (match.index ?? 0) + match[0].length;
  }

  const afterLast = content.slice(lastIndex).trim();
  if (afterLast) {
    parts.push(afterLast);
  }

  // If we got multiple parts, recursively process each
  if (parts.length > 1) {
    return parts.flatMap(splitOversizedContent);
  }

  // Single block still too large - split by lines
  const lines = content.split("\n");
  const chunks: string[] = [];
  let currentChunk = "";
  let currentTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(`${line}\n`);

    if (currentTokens + lineTokens > HARD_LIMIT_TOKENS && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = line;
      currentTokens = lineTokens;
    } else {
      currentChunk += (currentChunk ? "\n" : "") + line;
      currentTokens += lineTokens;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/** Extract frontmatter from AST. */
function extractFrontmatter(tree: Root): DocFrontmatter {
  const yamlNode = tree.children.find((n): n is Yaml => n.type === "yaml");
  if (!yamlNode) return {};

  try {
    return parseYaml(yamlNode.value) as DocFrontmatter;
  } catch {
    return {};
  }
}

/** Get heading text from AST node. */
function getHeadingText(node: Heading): string {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") {
      text += child.value;
    } else if (child.type === "inlineCode") {
      text += child.value;
    }
  }
  return text;
}

/** Convert AST nodes back to markdown text (simplified). */
function astToMarkdown(nodes: Content[], source: string): string {
  if (nodes.length === 0) return "";

  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!first || !last) return "";

  const startOffset = first.position?.start?.offset;
  const endOffset = last.position?.end?.offset;

  if (startOffset != null && endOffset != null) {
    return source.slice(startOffset, endOffset);
  }

  return "";
}

/** Remove MDX-specific tags from content. */
function cleanMdxContent(content: string): string {
  // Remove React-style tags like <AppOnly>, <PagesOnly>, etc.
  let cleaned = content.replace(/<\/?[A-Z][a-zA-Z]*\s*\/?>/g, "");
  // Remove empty lines created by tag removal
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}

/** Helper to create a section with proper part numbering. */
function createSection(
  docPath: string,
  docTitle: string,
  sectionTitle: string,
  content: string,
  partNum: number,
): DocSection | null {
  const cleanedContent = cleanMdxContent(content);
  const tokens = estimateTokens(cleanedContent);
  if (!cleanedContent || tokens < MIN_CHUNK_TOKENS) {
    return null;
  }
  return {
    docPath,
    docTitle,
    sectionTitle:
      partNum > 1 ? `${sectionTitle} (part ${partNum})` : sectionTitle,
    content: cleanedContent,
    tokens,
    hasCode: hasCodeBlock(cleanedContent),
  };
}

/** Split content at paragraph boundaries for large sections. */
function splitAtParagraphs(
  content: string,
  docPath: string,
  docTitle: string,
  sectionTitle: string,
): DocSection[] {
  const paragraphs = content.split(/\n\n+/);
  const sections: DocSection[] = [];
  let currentContent = "";
  let currentTokens = 0;
  let partNum = 1;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    // If a single paragraph exceeds hard limit, split it further
    if (paraTokens > HARD_LIMIT_TOKENS) {
      // First, flush current content
      if (currentContent) {
        const section = createSection(
          docPath,
          docTitle,
          sectionTitle,
          currentContent,
          partNum,
        );
        if (section) {
          sections.push(section);
          partNum++;
        }
        currentContent = "";
        currentTokens = 0;
      }

      // Split the oversized paragraph
      const subParts = splitOversizedContent(para);
      for (const subPart of subParts) {
        const section = createSection(
          docPath,
          docTitle,
          sectionTitle,
          subPart,
          partNum,
        );
        if (section) {
          sections.push(section);
          partNum++;
        }
      }
      continue;
    }

    if (currentTokens + paraTokens > MAX_CHUNK_TOKENS && currentContent) {
      const section = createSection(
        docPath,
        docTitle,
        sectionTitle,
        currentContent,
        partNum,
      );
      if (section) {
        sections.push(section);
        partNum++;
      }
      currentContent = para;
      currentTokens = paraTokens;
    } else {
      currentContent += (currentContent ? "\n\n" : "") + para;
      currentTokens += paraTokens;
    }
  }

  if (currentContent) {
    const section = createSection(
      docPath,
      docTitle,
      sectionTitle,
      currentContent,
      partNum,
    );
    if (section) {
      sections.push(section);
    }
  }

  return sections;
}

/**
 * Parse a markdown/MDX file and extract sections.
 */
export function parseMarkdown(source: string, filePath: string): ParsedDoc {
  const processor = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]);

  const tree = processor.parse(source) as Root;
  const frontmatter = extractFrontmatter(tree);
  const docTitle =
    frontmatter.title ||
    filePath
      .split("/")
      .pop()
      ?.replace(/\.(md|mdx|mdoc|qmd|rmd|adoc|rst)$/, "") ||
    "Untitled";

  // Remove frontmatter and JSX import statements from source for extraction
  let cleanSource = source;
  const yamlNode = tree.children.find((n): n is Yaml => n.type === "yaml");
  if (yamlNode?.position?.end?.offset) {
    cleanSource = source.slice(yamlNode.position.end.offset);
  }
  // Remove import statements
  cleanSource = cleanSource.replace(/^import\s+.*?[;\n]/gm, "");

  const sections: DocSection[] = [];

  // Find all h2 headings and their content
  const contentNodes = tree.children.filter(
    (n) =>
      n.type !== "yaml" &&
      !(
        n.type === "paragraph" &&
        /^import\s/.test(
          source.slice(
            n.position?.start?.offset ?? 0,
            n.position?.end?.offset ?? 0,
          ),
        )
      ),
  );

  let currentH2: string | null = null;
  let currentNodes: Content[] = [];

  for (const node of contentNodes) {
    if (node.type === "heading" && node.depth === 2) {
      // Save previous section
      if (currentH2 && currentNodes.length > 0) {
        const content = astToMarkdown(currentNodes, source);
        const cleanedContent = cleanMdxContent(content);
        // Skip TOC sections (high link ratio or TOC-like title)
        if (cleanedContent && !isTableOfContents(currentH2, cleanedContent)) {
          const tokens = estimateTokens(cleanedContent);
          if (tokens > MAX_CHUNK_TOKENS) {
            sections.push(
              ...splitAtParagraphs(
                cleanedContent,
                filePath,
                docTitle,
                currentH2,
              ),
            );
          } else if (tokens >= MIN_CHUNK_TOKENS) {
            sections.push({
              docPath: filePath,
              docTitle,
              sectionTitle: currentH2,
              content: cleanedContent,
              tokens,
              hasCode: hasCodeBlock(cleanedContent),
            });
          }
        }
      }
      currentH2 = getHeadingText(node);
      currentNodes = [];
    } else if (currentH2) {
      currentNodes.push(node);
    } else if (node.type === "heading" && node.depth === 1) {
    } else {
      // Content before first h2 - use docTitle as section
      if (!currentH2) {
        currentH2 = "Introduction";
      }
      currentNodes.push(node);
    }
  }

  // Save last section
  if (currentH2 && currentNodes.length > 0) {
    const content = astToMarkdown(currentNodes, source);
    const cleanedContent = cleanMdxContent(content);
    // Skip TOC sections (high link ratio or TOC-like title)
    if (cleanedContent && !isTableOfContents(currentH2, cleanedContent)) {
      const tokens = estimateTokens(cleanedContent);
      if (tokens > MAX_CHUNK_TOKENS) {
        sections.push(
          ...splitAtParagraphs(cleanedContent, filePath, docTitle, currentH2),
        );
      } else if (tokens >= MIN_CHUNK_TOKENS) {
        sections.push({
          docPath: filePath,
          docTitle,
          sectionTitle: currentH2,
          content: cleanedContent,
          tokens,
          hasCode: hasCodeBlock(cleanedContent),
        });
      }
    }
  }

  return {
    path: filePath,
    frontmatter,
    sections,
  };
}

/**
 * Extract AsciiDoc attributes (key-value metadata at the top of the file).
 * Format: `:key: value` lines at the document start.
 */
function extractAsciidocAttributes(source: string): DocFrontmatter {
  const attrs: Record<string, string> = {};
  for (const line of source.split("\n")) {
    const match = line.match(/^:([a-zA-Z_-]+):\s*(.*)$/);
    if (match?.[1] && match[2] !== undefined) {
      attrs[match[1]] = match[2].trim();
    } else if (line.trim() === "" && Object.keys(attrs).length > 0) {
      break; // End of attribute block
    } else if (!line.startsWith(":") && line.trim() !== "") {
      break; // Non-attribute content
    }
  }
  return {
    title: attrs.doctitle || attrs["document-title"],
    description: attrs.description,
  };
}

/**
 * Parse an AsciiDoc file and extract sections.
 * Chunks on level-1 headings (== Heading), which are equivalent to markdown h2.
 */
export function parseAsciidoc(source: string, filePath: string): ParsedDoc {
  const attrs = extractAsciidocAttributes(source);

  // Extract document title from `= Title` (level-0 heading) or attributes
  const titleMatch = source.match(/^= (.+)$/m);
  const docTitle =
    attrs.title ||
    titleMatch?.[1]?.trim() ||
    filePath
      .split("/")
      .pop()
      ?.replace(/\.adoc$/, "") ||
    "Untitled";

  const lines = source.split("\n");
  const sections: DocSection[] = [];
  let currentH2: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    // Skip attribute lines at the very top
    if (!currentH2 && /^:[a-zA-Z_-]+:/.test(line)) continue;

    // Level-1 heading (== Section) — equivalent to markdown h2
    const h2Match = line.match(/^== (.+)$/);
    if (h2Match?.[1]) {
      // Flush previous section
      if (currentH2) {
        flushSection(
          sections,
          currentContent.join("\n"),
          filePath,
          docTitle,
          currentH2,
        );
      }
      currentH2 = h2Match[1].trim();
      currentContent = [];
      continue;
    }

    // Skip the document title line (= Title)
    if (/^= .+$/.test(line) && !currentH2) continue;

    // Accumulate content
    if (!currentH2 && line.trim()) {
      currentH2 = "Introduction";
    }
    if (currentH2) {
      currentContent.push(line);
    }
  }

  // Flush last section
  if (currentH2) {
    flushSection(
      sections,
      currentContent.join("\n"),
      filePath,
      docTitle,
      currentH2,
    );
  }

  return {
    path: filePath,
    frontmatter: { title: docTitle, description: attrs.description },
    sections,
  };
}

/**
 * Detect RST heading underline characters and their hierarchy.
 * RST determines heading level by the order underline characters first appear.
 */
function detectRstHeadingLevel(
  charOrder: string[],
  underlineChar: string,
): number {
  let idx = charOrder.indexOf(underlineChar);
  if (idx === -1) {
    charOrder.push(underlineChar);
    idx = charOrder.length - 1;
  }
  return idx;
}

/**
 * Parse a reStructuredText file and extract sections.
 * RST headings are text lines followed by underline characters (=, -, ~, ^, etc.).
 * Chunks on the second heading level encountered (equivalent to markdown h2).
 */
export function parseRestructuredText(
  source: string,
  filePath: string,
): ParsedDoc {
  // Extract RST field-list metadata (`:key: value` at the top)
  const frontmatter: DocFrontmatter = {};
  const metaMatch = source.match(/^\.\. meta::\s*\n((?:\s+:[^\n]+\n?)*)/m);
  if (metaMatch?.[1]) {
    const titleLine = metaMatch[1].match(/:title:\s*(.+)/i);
    const descLine = metaMatch[1].match(/:description:\s*(.+)/i);
    if (titleLine?.[1]) frontmatter.title = titleLine[1].trim();
    if (descLine?.[1]) frontmatter.description = descLine[1].trim();
  }

  const lines = source.split("\n");
  const charOrder: string[] = [];
  let h2Level = -1; // Will be set to the second unique heading level seen

  // First pass: detect heading levels to find what maps to "h2"
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const prevLine = lines[i - 1] ?? "";
    if (
      prevLine.trim().length > 0 &&
      /^([=\-~^"+`#:.'_*!$%&,;<>?@\\|/(){}[\]])\1{2,}$/.test(line) &&
      line.length >= prevLine.trim().length
    ) {
      const level = detectRstHeadingLevel(charOrder, line[0] as string);
      if (h2Level === -1 && level > 0) {
        h2Level = level;
      }
    }
  }
  // If only one heading level was found, treat it as h2
  if (h2Level === -1 && charOrder.length > 0) {
    h2Level = 0;
  }

  // Reset for second pass
  charOrder.length = 0;

  // Determine docTitle
  let docTitle: string | undefined = frontmatter.title;
  // Check if the first heading is a title (level 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const prevLine = lines[i - 1] ?? "";
    if (
      prevLine.trim().length > 0 &&
      /^([=\-~^"+`#:.'_*!$%&,;<>?@\\|/(){}[\]])\1{2,}$/.test(line) &&
      line.length >= prevLine.trim().length
    ) {
      detectRstHeadingLevel(charOrder, line[0] as string);
      if (!docTitle) {
        docTitle = prevLine.trim();
      }
      break;
    }
  }
  charOrder.length = 0;

  if (!docTitle) {
    docTitle =
      filePath
        .split("/")
        .pop()
        ?.replace(/\.rst$/, "") || "Untitled";
  }

  // Second pass: extract sections
  const sections: DocSection[] = [];
  let currentH2: string | null = null;
  let currentContent: string[] = [];
  let skipNextLine = false;

  for (let i = 0; i < lines.length; i++) {
    if (skipNextLine) {
      skipNextLine = false;
      continue;
    }

    const line = lines[i] ?? "";
    const nextLine = lines[i + 1] ?? "";

    // Check if this line is a heading (next line is underline)
    if (
      line.trim().length > 0 &&
      /^([=\-~^"+`#:.'_*!$%&,;<>?@\\|/(){}[\]])\1{2,}$/.test(nextLine) &&
      nextLine.length >= line.trim().length
    ) {
      const level = detectRstHeadingLevel(charOrder, nextLine[0] as string);

      if (level === h2Level) {
        // Flush previous section
        if (currentH2) {
          flushSection(
            sections,
            currentContent.join("\n"),
            filePath,
            docTitle,
            currentH2,
          );
        }
        currentH2 = line.trim();
        currentContent = [];
        skipNextLine = true;
        continue;
      } else if (level < h2Level) {
        // This is the document title or higher — skip this heading
        skipNextLine = true;
        continue;
      }
      // Lower-level headings (h3+) are included as content
    }

    // Accumulate content
    if (!currentH2 && line.trim()) {
      // Skip metadata blocks
      if (line.startsWith(".. ") || line.startsWith("   :")) continue;
      currentH2 = "Introduction";
    }
    if (currentH2) {
      currentContent.push(line);
    }
  }

  // Flush last section
  if (currentH2) {
    flushSection(
      sections,
      currentContent.join("\n"),
      filePath,
      docTitle,
      currentH2,
    );
  }

  return {
    path: filePath,
    frontmatter: { title: docTitle, description: frontmatter.description },
    sections,
  };
}

/** Flush accumulated content into sections, handling chunking and filtering. */
function flushSection(
  sections: DocSection[],
  rawContent: string,
  docPath: string,
  docTitle: string,
  sectionTitle: string,
): void {
  const content = rawContent.trim();
  if (!content || isTableOfContents(sectionTitle, content)) return;

  const tokens = estimateTokens(content);
  if (tokens < MIN_CHUNK_TOKENS) return;

  if (tokens > MAX_CHUNK_TOKENS) {
    sections.push(
      ...splitAtParagraphs(content, docPath, docTitle, sectionTitle),
    );
  } else {
    sections.push({
      docPath,
      docTitle,
      sectionTitle,
      content,
      tokens,
      hasCode: hasCodeBlock(content),
    });
  }
}

/**
 * Parse a document file, auto-detecting format from file extension.
 * Supports: Markdown (.md, .mdx, .qmd, .rmd), AsciiDoc (.adoc),
 * reStructuredText (.rst), HTML (.html, .htm)
 */
export function parseDocument(source: string, filePath: string): ParsedDoc {
  if (filePath.endsWith(".html") || filePath.endsWith(".htm")) {
    return parseHtml(source, filePath);
  }
  if (filePath.endsWith(".adoc")) {
    return parseAsciidoc(source, filePath);
  }
  if (filePath.endsWith(".rst")) {
    return parseRestructuredText(source, filePath);
  }
  return parseMarkdown(source, filePath);
}
