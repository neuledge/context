import type Database from "better-sqlite3";

export function getMetaValue(
  db: Database.Database,
  key: string,
): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function getSectionCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM chunks").get() as {
    count: number;
  };
  return row.count;
}

export function validatePackageSchema(db: Database.Database): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  const tableNames = new Set(tables.map((t) => t.name));

  if (!tableNames.has("meta")) {
    throw new Error("Invalid package: missing 'meta' table");
  }
  if (!tableNames.has("chunks")) {
    throw new Error("Invalid package: missing 'chunks' table");
  }
  if (!tableNames.has("chunks_fts")) {
    throw new Error("Invalid package: missing 'chunks_fts' table");
  }
}
