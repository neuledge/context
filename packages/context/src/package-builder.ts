/**
 * Package builder for creating documentation packages from markdown files.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import Database from "better-sqlite3";
import { type DocSection, parseMarkdown } from "./build.js";

/**
 * Check if pandoc is available on the system.
 * Caches the result after first check.
 */
let pandocAvailable: boolean | null = null;
function isPandocAvailable(): boolean {
  if (pandocAvailable === null) {
    try {
      execSync("pandoc --version", { stdio: ["pipe", "pipe", "pipe"] });
      pandocAvailable = true;
    } catch {
      pandocAvailable = false;
    }
  }
  return pandocAvailable;
}

/**
 * Convert reStructuredText content to Markdown using pandoc.
 * Returns null if conversion fails or pandoc is not available.
 */
function rstToMarkdown(content: string): string | null {
  if (!isPandocAvailable()) return null;
  try {
    return execSync("pandoc -f rst -t markdown --wrap=none", {
      input: content,
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

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
}

export interface MarkdownFile {
  path: string;
  content: string;
}

export interface BuildResult {
  path: string;
  sectionCount: number;
  totalTokens: number;
  /** Number of RST files skipped because pandoc is not installed */
  rstSkipped: number;
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

  const db = new Database(outputPath);

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

    // Parse and insert chunks
    const insertChunk = db.prepare(`
      INSERT INTO chunks (doc_path, doc_title, section_title, content, tokens, has_code)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const allSections: DocSection[] = [];
    const seenHashes = new Set<string>();

    let rstSkipped = 0;
    for (const file of files) {
      try {
        let content = file.content;
        if (file.path.endsWith(".rst")) {
          const converted = rstToMarkdown(content);
          if (converted === null) {
            rstSkipped++;
            continue;
          }
          content = converted;
        }
        const parsed = parseMarkdown(content, file.path);
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
      rstSkipped,
    };
  } finally {
    db.close();
  }
}
