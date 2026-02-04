import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getMetaValue } from "./db.js";

// TODO: Future enhancements for better search quality:
// - Semantic search: Add local embeddings for meaning-based retrieval
// - GraphRAG: Add relations table to traverse related docs (e.g., middleware → auth)
//   Schema: relations(from_id, to_id, type: 'references'|'extends'|'example_of', weight)
// - Smarter chunking: Improve section splitting with better context preservation
// - Quality heuristics: Detect README-only repos, score documentation completeness

const CONFIG = {
  MAX_TOKENS: 2000,
  RELEVANCE_DROP: 0.5,
};

export interface DocSnippet {
  title: string;
  content: string;
  source: string;
}

export interface SearchResult {
  library: string;
  version: string;
  results: DocSnippet[];
}

interface ChunkMatch {
  id: number;
  docPath: string;
  docTitle: string;
  sectionTitle: string;
  content: string;
  tokens: number;
  score: number;
}

/**
 * Build an FTS5 query from user topic.
 * - Cleans special characters (keeps alphanumeric, spaces, quotes)
 * - Words are implicitly ANDed by FTS5
 */
function buildQuery(topic: string): string {
  return topic
    .trim()
    .replace(/[^\w\s"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchFts(db: Database.Database, query: string): ChunkMatch[] {
  const ftsQuery = buildQuery(query);
  if (!ftsQuery) return [];

  // BM25 weights: doc_title, section_title, content
  // Higher weight = more important for ranking
  const stmt = db.prepare(`
    SELECT
      c.id,
      c.doc_path as docPath,
      c.doc_title as docTitle,
      c.section_title as sectionTitle,
      c.content,
      c.tokens,
      (bm25(chunks_fts, 5.0, 10.0, 1.0) * -1) as score
    FROM chunks_fts
    JOIN chunks c ON chunks_fts.rowid = c.id
    WHERE chunks_fts MATCH ?
    ORDER BY score DESC
    LIMIT 20
  `);

  return stmt.all(ftsQuery) as ChunkMatch[];
}

function filterByRelevance(matches: ChunkMatch[]): ChunkMatch[] {
  const first = matches[0];
  if (!first) return [];

  const topScore = first.score;
  // Keep matches that are within RELEVANCE_DROP of top score
  const minScore = topScore * CONFIG.RELEVANCE_DROP;

  return matches.filter((m) => m.score >= minScore);
}

function applyTokenBudget(matches: ChunkMatch[]): ChunkMatch[] {
  const result: ChunkMatch[] = [];
  let totalTokens = 0;

  for (const match of matches) {
    if (totalTokens + match.tokens > CONFIG.MAX_TOKENS) break;
    result.push(match);
    totalTokens += match.tokens;
  }

  return result;
}

function groupByDocument(matches: ChunkMatch[]): Map<string, ChunkMatch[]> {
  const byDoc = new Map<string, ChunkMatch[]>();

  for (const match of matches) {
    const existing = byDoc.get(match.docPath);
    if (existing) {
      existing.push(match);
    } else {
      byDoc.set(match.docPath, [match]);
    }
  }

  // Sort chunks within each doc by ID (document order)
  for (const chunks of byDoc.values()) {
    chunks.sort((a, b) => a.id - b.id);
  }

  return byDoc;
}

function cloneChunk(chunk: ChunkMatch): ChunkMatch {
  return {
    id: chunk.id,
    docPath: chunk.docPath,
    docTitle: chunk.docTitle,
    sectionTitle: chunk.sectionTitle,
    content: chunk.content,
    tokens: chunk.tokens,
    score: chunk.score,
  };
}

function mergeAdjacentChunks(chunks: ChunkMatch[]): ChunkMatch[] {
  const first = chunks[0];
  if (!first || chunks.length <= 1) return chunks;

  const merged: ChunkMatch[] = [];
  let current = cloneChunk(first);

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];
    if (!next) continue;

    // Merge if IDs are adjacent
    if (next.id === current.id + 1) {
      current.sectionTitle = `${current.sectionTitle} / ${next.sectionTitle}`;
      current.content = `${current.content}\n\n${next.content}`;
      current.tokens = current.tokens + next.tokens;
    } else {
      merged.push(current);
      current = cloneChunk(next);
    }
  }
  merged.push(current);

  return merged;
}

function assembleResults(matches: ChunkMatch[]): DocSnippet[] {
  const byDoc = groupByDocument(matches);
  const results: DocSnippet[] = [];

  // Maintain order: docs with highest-scoring chunk first
  const docOrder = [...new Set(matches.map((m) => m.docPath))];

  for (const docPath of docOrder) {
    const chunks = byDoc.get(docPath);
    if (!chunks) continue;

    const merged = mergeAdjacentChunks(chunks);

    for (const chunk of merged) {
      results.push({
        title: `${chunk.docTitle} > ${chunk.sectionTitle}`,
        content: chunk.content,
        source: chunk.docPath,
      });
    }
  }

  return results;
}

/**
 * Deduplicate results by title + content.
 * Sections from different files with identical title and content are collapsed.
 * Keeps the first occurrence (highest relevance order).
 */
function deduplicateResults(results: DocSnippet[]): DocSnippet[] {
  const seen = new Set<string>();
  const deduplicated: DocSnippet[] = [];

  for (const result of results) {
    const key = createHash("md5")
      .update(`${result.title}\n${result.content}`)
      .digest("hex")
      .slice(0, 16);

    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(result);
    }
  }

  return deduplicated;
}

export function search(db: Database.Database, topic: string): SearchResult {
  const name = getMetaValue(db, "name") ?? "unknown";
  const version = getMetaValue(db, "version") ?? "unknown";

  const matches = searchFts(db, topic);
  const filtered = filterByRelevance(matches);
  const budgeted = applyTokenBudget(filtered);
  const assembled = assembleResults(budgeted);
  const results = deduplicateResults(assembled);

  return {
    library: `${name}@${version}`,
    version,
    results,
  };
}
