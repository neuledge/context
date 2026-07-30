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

/** Markdown chunks larger than this are split further before AST parsing. */
const MAX_PARSE_CHUNK_BYTES = 1024 * 1024; // 1MB

/**
 * Split markdown into one chunk per `##` section.
 *
 * Fenced code blocks are tracked so that `## ` lines inside them — common in docs
 * that demonstrate markdown — aren't mistaken for headings and split mid-fence.
 */
export function splitMarkdownByHeadings(file: MarkdownFile): MarkdownFile[] {
  const parts: string[] = [];
  let current: string[] = [];
  let openFence: string | null = null;

  for (const line of file.content.split("\n")) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];

    if (fence) {
      // A fence closes only with the same character, repeated at least as many times.
      if (openFence === null) openFence = fence;
      else if (fence.startsWith(openFence)) openFence = null;
    } else if (openFence === null && line.startsWith("## ") && current.length) {
      parts.push(current.join("\n"));
      current = [];
    }

    current.push(line);
  }
  if (current.length) parts.push(current.join("\n"));

  if (parts.length <= 1) return [file];
  return parts.map((content) => ({ path: file.path, content }));
}

/** Split content into chunks of at most `maxBytes` at line boundaries. */
function splitBySize(content: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of content.split("\n")) {
    if (current && current.length + line.length + 1 > maxBytes) {
      chunks.push(current);
      current = line;
    } else {
      current += current ? `\n${line}` : line;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

/**
 * Break an oversized file into chunks small enough to parse without exhausting the heap.
 *
 * remark builds a full AST for whatever it is given, so a multi-megabyte document (a
 * site's `llms-full.txt`, say) can OOM the process. Splitting by `##` keeps sections
 * intact where possible; the size fallback bounds the rest, so a file with no headings
 * — or one enormous section — can't crash the build either.
 *
 * Only markdown is split: the other formats route to parsers that don't build a
 * whole-document AST, and line-splitting them would corrupt their block structure.
 */
export function splitForParsing(file: MarkdownFile): MarkdownFile[] {
  const isMarkdown = !/\.(html?|adoc|rst)$/i.test(file.path);
  if (file.content.length <= MAX_PARSE_CHUNK_BYTES || !isMarkdown) {
    return [file];
  }

  return splitMarkdownByHeadings(file).flatMap((part) =>
    part.content.length > MAX_PARSE_CHUNK_BYTES
      ? splitBySize(part.content, MAX_PARSE_CHUNK_BYTES).map((content) => ({
          path: file.path,
          content,
        }))
      : [part],
  );
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
