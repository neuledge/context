/**
 * Build utilities for generating documentation packages.
 * Parses markdown/MDX, AsciiDoc, and reStructuredText files and chunks them by section.
 */

import type { Content, Heading, PhrasingContent, Root, Yaml } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as parseYaml } from "yaml";
import { isPermalinkText, parseHtml } from "./html.js";
import { fencedBlocks, fencedLines, opensFence } from "./markdown-fences.js";

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

/**
 * Check if content has fenced code (see `fencedBlocks` for `tildes`). A fence that never
 * closes counts: CommonMark runs it to the end, and a part cut from an oversized block
 * holds code with only one fence.
 */
function hasCodeBlock(content: string, tildes = true): boolean {
  return content.split("\n").some((line) => opensFence(line, tildes));
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

  // Check link ratio - TOC sections are mostly links. Measure the text a reader
  // sees: counting each link's URL would make prose with a few long URLs look
  // like a TOC and drop it.
  const linkPattern = /\[([^\]]*)\]\([^)]+\)/g;
  let linkTextLength = 0;
  const visibleText = content.replace(linkPattern, (_, text: string) => {
    linkTextLength += text.length;
    return text;
  });

  // If more than 50% of content is links, likely a TOC
  if (
    visibleText.length > 0 &&
    linkTextLength / visibleText.length > TOC_LINK_RATIO
  ) {
    return true;
  }

  return false;
}

/**
 * Split oversized content at code block boundaries or line boundaries.
 * This handles the case where a single "paragraph" (like a large code block) exceeds limits.
 */
function splitOversizedContent(content: string, tildes: boolean): string[] {
  const tokens = estimateTokens(content);
  if (tokens <= HARD_LIMIT_TOKENS) {
    return [content];
  }

  // First try to split at code block boundaries
  const lines = content.split("\n");
  const parts: string[] = [];
  let next = 0;

  for (const [first, last] of fencedBlocks(lines, tildes)) {
    const beforeBlock = lines.slice(next, first).join("\n").trim();
    if (beforeBlock) {
      parts.push(beforeBlock);
    }
    parts.push(lines.slice(first, last + 1).join("\n"));
    next = last + 1;
  }

  const afterLast = lines.slice(next).join("\n").trim();
  if (afterLast) {
    parts.push(afterLast);
  }

  // If we got multiple parts, recursively process each
  if (parts.length > 1) {
    return parts.flatMap((part) => splitOversizedContent(part, tildes));
  }

  // Single block still too large - split by lines
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
    // Validate types rather than blindly casting: malformed frontmatter can
    // parse title/description into non-strings (e.g. a bare value the YAML
    // parser reads as a map), which later breaks SQLite parameter binding.
    const data = parseYaml(yamlNode.value) as Record<string, unknown> | null;
    return {
      title: typeof data?.title === "string" ? data.title : undefined,
      description:
        typeof data?.description === "string" ? data.description : undefined,
    };
  } catch {
    return {};
  }
}

/** A document's title when it names none itself: its file name, without extension. */
export function fileTitle(filePath: string): string {
  return (
    filePath
      .split("/")
      .pop()
      ?.replace(/\.(md|mdx|mdoc|qmd|rmd|adoc|rst|html?)$/, "") || "Untitled"
  );
}

/** Get heading text from AST node. */
function getHeadingText(node: Heading): string {
  return node.children.map(getInlineText).join("");
}

/** Text of an inline node, including text nested in emphasis, strong and links. */
function getInlineText(node: PhrasingContent): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if ("children" in node) return node.children.map(getInlineText).join("");
  return "";
}

/**
 * A trailing attribute block: `{#id}` sets a heading's anchor in Docusaurus and
 * VitePress, and Pandoc (Quarto, R Markdown) also takes `{.class}` and `{-}`.
 */
const HEADING_ATTRIBUTES = /\s*\{[#.-][^{}]*\}\s*$/;

/**
 * A document's title from its h1, without the permalink anchor HTML docs put in every
 * heading or a trailing attribute block. The anchor is dropped from the title only: the
 * h1 can sit inside the "Introduction" content, which stays as it was.
 */
function getTitleText(node: Heading): string {
  const children = node.children.filter(
    (child) =>
      !(
        child.type === "link" &&
        child.url.startsWith("#") &&
        isPermalinkText(getInlineText(child))
      ),
  );
  // Only from plain text: in inline code, `{#each}` is what the title is about.
  const last = children.at(-1);
  if (last?.type === "text") {
    children[children.length - 1] = {
      ...last,
      value: last.value.replace(HEADING_ATTRIBUTES, ""),
    };
  }
  return getHeadingText({ ...node, children })
    .replace(/\s+/g, " ")
    .trim();
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

/**
 * React-style tags like <AppOnly> or <PagesOnly>, unless they sit inside a fenced
 * block or an inline code span. There the same shape is a generic type
 * (`List<String>`, `createTRPCClient<AppRouter>`) or a JSX example (`<App />`),
 * and removing it breaks the code. Code is matched first so it is skipped whole.
 * A fence opens and closes only on a line of its own, so a ``` inside a code line
 * or a sentence does not pair up with the next block; an unclosed fence runs to
 * the end, as it does in CommonMark.
 */
const MDX_TAG_OUTSIDE_CODE =
  /^[ \t]*(`{3,}|~{3,})[^\n]*(?:[\s\S]*?\n[ \t]*\1[`~]*[ \t]*$|[\s\S]*)|`[^`\n]+`|(<\/?[A-Z][a-zA-Z]*\s*\/?>)/gm;

/** Remove MDX-specific tags from content. */
function cleanMdxContent(content: string): string {
  return removeMdxTags(content).trim();
}

/** Remove MDX-specific tags, and the blank lines they leave, keeping indentation. */
function removeMdxTags(content: string): string {
  return content
    .replace(MDX_TAG_OUTSIDE_CODE, (match, _fence, tag) => (tag ? "" : match))
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
}

/** Helper to create a section with proper part numbering. */
function createSection(
  docPath: string,
  docTitle: string,
  sectionTitle: string,
  content: string,
  partNum: number,
  tildes: boolean,
): DocSection | null {
  // Not cleanMdxContent: Markdown paragraphs are cleaned before they are packed, and a
  // second pass here would strip generics from a code block split across parts, whose
  // opening fence is in an earlier part.
  const trimmed = content.trim();
  const tokens = estimateTokens(trimmed);
  if (!trimmed || tokens < MIN_CHUNK_TOKENS) {
    return null;
  }
  return {
    docPath,
    docTitle,
    sectionTitle:
      partNum > 1 ? `${sectionTitle} (part ${partNum})` : sectionTitle,
    content: trimmed,
    tokens,
    hasCode: hasCodeBlock(trimmed, tildes),
  };
}

/** A line of MDX tags alone, which cleaning would leave blank. */
const MDX_TAG_LINE = /^[ \t]*(?:<\/?[A-Z][a-zA-Z]*\s*\/?>[ \t]*)+$/;

/**
 * Split Markdown at blank lines, except inside fenced code blocks (`fencedLines`).
 *
 * Code often has blank lines in it, and cutting there gives each part half a block with
 * one unpaired fence, so the rest of that part reads as code and the next part's code
 * as prose. An oversized block is still cut by `splitOversizedContent`.
 *
 * The section is split before MDX tags are removed, because removing them can shift an
 * indented fence to column 0 and leave its closing fence too far right to match. A line
 * of MDX tags alone outside a block still counts as a blank line, as it did when the
 * tags were removed first. Each paragraph is cleaned on its own, which keeps generics
 * in code safe because none holds part of a block.
 */
function splitMarkdownParagraphs(content: string): string[] {
  const lines = content.split("\n");
  const inCode = fencedLines(lines);
  const paragraphs: string[] = [];
  let current: string[] = [];

  lines.forEach((line, i) => {
    if (!inCode[i] && (line === "" || MDX_TAG_LINE.test(line))) {
      if (current.length) paragraphs.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  });
  if (current.length) paragraphs.push(current.join("\n"));

  return paragraphs.map(removeMdxTags).filter((paragraph) => paragraph.trim());
}

/** Pack paragraphs into sections for a large section (see `fencedBlocks` for `tildes`). */
function splitAtParagraphs(
  paragraphs: string[],
  docPath: string,
  docTitle: string,
  sectionTitle: string,
  tildes = true,
): DocSection[] {
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
          tildes,
        );
        if (section) {
          sections.push(section);
          partNum++;
        }
        currentContent = "";
        currentTokens = 0;
      }

      // Split the oversized paragraph
      const subParts = splitOversizedContent(para, tildes);
      for (const subPart of subParts) {
        const section = createSection(
          docPath,
          docTitle,
          sectionTitle,
          subPart,
          partNum,
          tildes,
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
        tildes,
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
      tildes,
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
  // A single h1 is the page's title, as `= Title` is for AsciiDoc and the top heading
  // is for reStructuredText. Several h1s are a concatenation (an llms-full.txt), where
  // the first page's title would mislabel the rest.
  const h1s = tree.children.filter(
    (n): n is Heading => n.type === "heading" && n.depth === 1,
  );
  const docTitle =
    frontmatter.title ||
    (h1s.length === 1 && h1s[0] ? getTitleText(h1s[0]) : "") ||
    fileTitle(filePath);

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
                splitMarkdownParagraphs(content),
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
          ...splitAtParagraphs(
            splitMarkdownParagraphs(content),
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
    attrs.title || titleMatch?.[1]?.trim() || fileTitle(filePath);

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
    docTitle = fileTitle(filePath);
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
      ...splitAtParagraphs(
        content.split(/\n\n+/),
        docPath,
        docTitle,
        sectionTitle,
        false,
      ),
    );
  } else {
    sections.push({
      docPath,
      docTitle,
      sectionTitle,
      content,
      tokens,
      hasCode: hasCodeBlock(content, false),
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
