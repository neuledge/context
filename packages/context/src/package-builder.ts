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

/** Files larger than this are pre-split by ## headings before AST parsing to avoid OOM. */
const MAX_FILE_SIZE_FOR_PARSING = 1024 * 1024; // 1MB

/** Pre-split oversized markdown by ## headings into independently parseable chunks. */
export function splitMarkdownByHeadings(file: MarkdownFile): MarkdownFile[] {
  if (!/^## /m.test(file.content)) {
    return [file];
  }

  const parts: string[] = [];
  let current: string[] = [];

  for (const line of file.content.split("\n")) {
    if (line.startsWith("## ")) {
      if (current.length > 0) {
        parts.push(current.join("\n"));
      }
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    parts.push(current.join("\n"));
  }

  if (parts.length <= 1) return [file];

  return parts.map((content) => ({ path: file.path, content }));
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

    // Pre-split oversized files by ## headings to avoid OOM during AST parsing
    const processedFiles = files.flatMap((file) => {
      if (
        file.content.length > MAX_FILE_SIZE_FOR_PARSING &&
        /\.(md|mdx|txt)$/i.test(file.path)
      ) {
        return splitMarkdownByHeadings(file);
      }
      return [file];
    });

    for (const file of processedFiles) {
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
