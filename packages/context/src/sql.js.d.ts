declare module "sql.js-fts5" {
  interface Statement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  interface Database {
    run(sql: string, params?: unknown[]): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  interface InitOptions {
    wasmBinary?: ArrayLike<number>;
    locateFile?: (filename: string) => string;
  }

  export default function initSqlJs(
    options?: InitOptions,
  ): Promise<SqlJsStatic>;
}
