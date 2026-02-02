import Database from "better-sqlite3";

export interface TestPackageOptions {
  name?: string;
  version?: string;
  description?: string;
}

export interface TestChunk {
  docPath: string;
  docTitle: string;
  sectionTitle: string;
  content: string;
  tokens: number;
  hasCode?: number;
}

export function createTestDb(
  path: string,
  options: TestPackageOptions = {},
): Database.Database {
  const db = new Database(path);

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

  const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  insertMeta.run("name", options.name ?? "test-lib");
  insertMeta.run("version", options.version ?? "1.0.0");
  if (options.description) insertMeta.run("description", options.description);

  return db;
}

export function insertChunk(db: Database.Database, chunk: TestChunk): void {
  db.prepare(`
    INSERT INTO chunks (doc_path, doc_title, section_title, content, tokens, has_code)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    chunk.docPath,
    chunk.docTitle,
    chunk.sectionTitle,
    chunk.content,
    chunk.tokens,
    chunk.hasCode ?? 0,
  );
}

export function rebuildFtsIndex(db: Database.Database): void {
  db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");
}
