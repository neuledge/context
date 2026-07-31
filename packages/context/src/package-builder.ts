/**
 * Package builder for creating documentation packages from markdown files.
 */

import { createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { type DocSection, parseDocument } from "./build.js";
import { openDatabase } from "./database.js";

/**
 * Generate a content hash for section deduplication.
 * Uses first 16 chars of MD5 (sufficient for detecting identical content).
 */
function contentHash(content: string): string {
  return createHash("md5").update(content).digest("hex").slice(0, 16);
}

export interface PackageBuildOptions {
  name: string;
  version: string;
  description?: string;
  sourceUrl?: string;
  /** Git commit SHA used to build this package (for skip-if-unchanged checks) */
  sourceCommit?: string;
}

export interface MarkdownFile {
  path: string;
  content: string;
}

export interface BuildResult {
  path: string;
  sectionCount: number;
  totalTokens: number;
}

/**
 * Markdown chunks longer than this are split further before AST parsing.
 *
 * Counted in UTF-16 code units, not bytes: that is what a JS string costs in the heap,
 * which is the resource being bounded here.
 */
const MAX_PARSE_CHUNK_CHARS = 1024 * 1024;

/** Extensions `parseDocument` routes away from remark. Matched as it matches them. */
const NON_MARKDOWN_EXTENSIONS = [".html", ".htm", ".adoc", ".rst"];

/** An ATX `##` heading: up to 3 spaces of indent, then `##` and a space or tab. */
const H2_LINE = /^ {0,3}##([ \t]|$)/;

/**
 * Split markdown into one chunk per `##` section.
 *
 * Fenced code blocks are tracked so that `## ` lines inside them — common in docs that
 * demonstrate markdown — aren't mistaken for headings and split mid-fence. Fence
 * handling follows CommonMark: an opening fence may carry an info string, a closing
 * fence may not, and only the same character in at least the same run length closes.
 */
export function splitMarkdownByHeadings(file: MarkdownFile): MarkdownFile[] {
  const parts: string[] = [];
  let current: string[] = [];
  let openFence: string | null = null;

  for (const line of file.content.split("\n")) {
    const [, marker, info] = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line) ?? [];

    if (marker) {
      if (openFence === null) {
        // Backtick fences can't have a backtick in the info string; that isn't a fence.
        if (marker[0] !== "`" || !info?.includes("`")) openFence = marker;
      } else if (marker.startsWith(openFence) && !info?.trim()) {
        openFence = null;
      }
    } else if (openFence === null && H2_LINE.test(line) && current.length) {
      parts.push(current.join("\n"));
      current = [];
    }

    current.push(line);
  }
  if (current.length) parts.push(current.join("\n"));

  if (parts.length <= 1) return [file];
  return parts.map((content) => ({ path: file.path, content }));
}

/**
 * Split content into chunks of at most `maxChars`, preferring line boundaries.
 *
 * A single line over the limit is cut mid-line. Nothing else bounds it, and a line that
 * long is a data blob — a base64 payload, a minified sample — rather than prose.
 */
function splitBySize(content: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of content.split("\n")) {
    if (current && current.length + line.length + 1 > maxChars) {
      chunks.push(current);
      current = "";
    }

    let rest = line;
    while (rest.length > maxChars) {
      chunks.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }

    current += current ? `\n${rest}` : rest;
  }
  if (current) chunks.push(current);

  return chunks.length ? chunks : [content];
}

/** The document's leading YAML frontmatter block, if it opens with one. */
function leadingFrontmatter(content: string): string {
  return /^---\n[\s\S]*?\n---\n/.exec(content)?.[0] ?? "";
}

/**
 * Break an oversized file into chunks small enough to parse without exhausting the heap.
 *
 * remark builds a full AST for whatever it is given, so a multi-megabyte document (a
 * site's `llms-full.txt`, say) can OOM the process. Splitting by `##` keeps sections
 * intact where possible; the size fallback bounds the rest, so a file with no headings
 * — or one enormous section — can't crash the build either.
 *
 * Only markdown is split, because splitting on markdown line structure would corrupt
 * the other formats. Note this leaves HTML unbounded: `parseHtml` builds a DOM *and*
 * then a remark AST, so it is the heaviest path here.
 * TODO: bound HTML too, by size at tag boundaries.
 */
export function splitForParsing(file: MarkdownFile): MarkdownFile[] {
  const isMarkdown = !NON_MARKDOWN_EXTENSIONS.some((ext) =>
    file.path.endsWith(ext),
  );
  if (file.content.length <= MAX_PARSE_CHUNK_CHARS || !isMarkdown) {
    return [file];
  }

  // `parseMarkdown` reads frontmatter only at offset 0 and titles a section from the
  // `##` line opening it, so a continuation chunk would otherwise index under the
  // filename with a section title of "Introduction". Carry both forward instead.
  const frontmatter = leadingFrontmatter(file.content);
  const chunks: MarkdownFile[] = [];

  splitMarkdownByHeadings(file).forEach((part, index) => {
    const prefix = index === 0 ? "" : frontmatter;

    if (prefix.length + part.content.length <= MAX_PARSE_CHUNK_CHARS) {
      chunks.push({ path: file.path, content: prefix + part.content });
      return;
    }

    const heading = /^ {0,3}##[ \t].*/.exec(part.content)?.[0];
    const carried = heading ? `${prefix + heading}\n` : prefix;

    for (const [i, content] of splitBySize(
      part.content,
      MAX_PARSE_CHUNK_CHARS - carried.length,
    ).entries()) {
      chunks.push({
        path: file.path,
        content: i === 0 ? prefix + content : carried + content,
      });
    }
  });

  return chunks;
}

/**
 * Build a documentation package from markdown files.
 */
export function buildPackage(
  outputPath: string,
  files: MarkdownFile[],
  options: PackageBuildOptions,
): BuildResult {
  // Remove existing file if present
  if (existsSync(outputPath)) {
    unlinkSync(outputPath);
  }

  const db = openDatabase(outputPath);

  try {
    // Create schema
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY,
        doc_path TEXT NOT NULL,
        doc_title TEXT NOT NULL,
        section_title TEXT NOT NULL,
        content TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        has_code INTEGER DEFAULT 0
      );
      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        doc_title, section_title, content,
        content='chunks', content_rowid='id',
        tokenize='porter unicode61'
      );
    `);

    // Insert metadata
    const insertMeta = db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?)",
    );
    insertMeta.run("name", options.name);
    insertMeta.run("version", options.version);
    if (options.description) {
      insertMeta.run("description", options.description);
    }
    if (options.sourceUrl) {
      insertMeta.run("source_url", options.sourceUrl);
    }
    if (options.sourceCommit) {
      insertMeta.run("source_commit", options.sourceCommit);
    }

    // Parse and insert chunks
    const insertChunk = db.prepare(`
      INSERT INTO chunks (doc_path, doc_title, section_title, content, tokens, has_code)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const allSections: DocSection[] = [];
    const seenHashes = new Set<string>();

    for (const file of files.flatMap(splitForParsing)) {
      try {
        const parsed = parseDocument(file.content, file.path);
        for (const section of parsed.sections) {
          // Deduplicate sections with identical content (ignore titles)
          const hash = contentHash(section.content);
          if (!seenHashes.has(hash)) {
            seenHashes.add(hash);
            allSections.push(section);
          }
        }
      } catch {
        // Skip files that fail to parse
      }
    }

    // Insert all sections in a transaction
    const insertAll = db.transaction((sections: DocSection[]) => {
      for (const section of sections) {
        insertChunk.run(
          section.docPath,
          section.docTitle,
          section.sectionTitle,
          section.content,
          section.tokens,
          section.hasCode ? 1 : 0,
        );
      }
    });

    insertAll(allSections);

    // Rebuild FTS index
    db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");

    const totalTokens = allSections.reduce((sum, s) => sum + s.tokens, 0);

    return {
      path: outputPath,
      sectionCount: allSections.length,
      totalTokens,
    };
  } finally {
    db.close();
  }
}
