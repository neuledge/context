/**
 * Database abstraction layer.
 *
 * Tries native better-sqlite3 for performance, falls back to sql.js (WebAssembly)
 * when native binaries aren't available (e.g. unsupported Node versions on Windows).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

export interface Statement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): void;
}

export interface DatabaseConnection {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  transaction<T extends unknown[]>(
    fn: (...args: T) => void,
  ): (...args: T) => void;
  close(): void;
}

type Backend = "better-sqlite3" | "sql.js";

let backend: Backend | null = null;
// biome-ignore lint/suspicious/noExplicitAny: dynamic module loading
let betterSqlite3Constructor: any = null;
// biome-ignore lint/suspicious/noExplicitAny: dynamic module loading
let sqlJsApi: any = null;

/**
 * Initialize the database backend. Tries better-sqlite3 first,
 * falls back to sql.js if native bindings aren't available.
 * Must be called before openDatabase() when better-sqlite3 is unavailable.
 */
export async function initDatabase(): Promise<void> {
  if (backend) return;

  try {
    betterSqlite3Constructor = _require("better-sqlite3");
    backend = "better-sqlite3";
  } catch {
    const sqlJs = await import("sql.js-fts5");
    const initSqlJs = sqlJs.default;
    // Load WASM binary manually — older sql.js-fts5 uses fetch() with a bare
    // path which fails in newer Node.js versions that require a proper URL.
    const wasmPath = _require.resolve("sql.js-fts5/dist/sql-wasm.wasm");
    const wasmBinary = readFileSync(wasmPath);
    sqlJsApi = await initSqlJs({ wasmBinary });
    backend = "sql.js";
  }
}

/**
 * Open a SQLite database file.
 *
 * If initDatabase() hasn't been called, attempts a sync load of better-sqlite3.
 * If that fails, throws with instructions to call initDatabase() first.
 */
export function openDatabase(
  path: string,
  options?: { readonly?: boolean },
): DatabaseConnection {
  if (!backend) {
    // Lazy sync init — only works when better-sqlite3 is installed
    try {
      betterSqlite3Constructor = _require("better-sqlite3");
      backend = "better-sqlite3";
    } catch {
      throw new Error(
        "Database not initialized. Call `await initDatabase()` first.",
      );
    }
  }

  if (backend === "better-sqlite3") {
    return new betterSqlite3Constructor(path, options) as DatabaseConnection;
  }

  return createSqlJsConnection(path, options);
}

// -- sql.js backend --

function createSqlJsConnection(
  path: string,
  options?: { readonly?: boolean },
): DatabaseConnection {
  // biome-ignore lint/suspicious/noExplicitAny: sql.js dynamic API
  let db: any;

  if (existsSync(path)) {
    const buffer = readFileSync(path);
    db = new sqlJsApi.Database(new Uint8Array(buffer));
  } else {
    db = new sqlJsApi.Database();
  }

  const readonly = options?.readonly ?? false;
  return new SqlJsConnection(db, readonly ? undefined : path);
}

class SqlJsConnection implements DatabaseConnection {
  // biome-ignore lint/suspicious/noExplicitAny: sql.js dynamic API
  private db: any;
  private savePath: string | undefined;

  // biome-ignore lint/suspicious/noExplicitAny: sql.js dynamic API
  constructor(db: any, savePath?: string) {
    this.db = db;
    this.savePath = savePath;
  }

  prepare(sql: string): Statement {
    return new SqlJsStatement(this.db, sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T extends unknown[]>(
    fn: (...args: T) => void,
  ): (...args: T) => void {
    return (...args: T) => {
      this.db.exec("BEGIN TRANSACTION");
      try {
        fn(...args);
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    };
  }

  close(): void {
    if (this.savePath) {
      const data = this.db.export();
      writeFileSync(this.savePath, Buffer.from(data));
    }
    this.db.close();
  }
}

class SqlJsStatement implements Statement {
  // biome-ignore lint/suspicious/noExplicitAny: sql.js dynamic API
  private db: any;
  private sql: string;

  // biome-ignore lint/suspicious/noExplicitAny: sql.js dynamic API
  constructor(db: any, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  get(...params: unknown[]): unknown {
    const stmt = this.db.prepare(this.sql);
    try {
      if (params.length > 0) {
        stmt.bind(params);
      }
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params: unknown[]): unknown[] {
    const stmt = this.db.prepare(this.sql);
    try {
      if (params.length > 0) {
        stmt.bind(params);
      }
      const results: unknown[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  run(...params: unknown[]): void {
    this.db.run(this.sql, params);
  }
}
