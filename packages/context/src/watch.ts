/**
 * Debounced directory watching for the long-running `context serve` process.
 *
 * A running stdio server shares the package directory with separate
 * `context add` / `context remove` processes. Watching that directory lets the
 * server reload its package store and refresh `get_docs` when a package is
 * installed or removed underneath it.
 *
 * The watcher is deliberately defensive: it never keeps the process alive on
 * its own (`unref`), it contains callback exceptions, and it survives both
 * `fs.watch` errors (such as ENOSPC) and the watched directory being removed
 * and recreated.
 */

import { existsSync, watch } from "node:fs";

/** The subset of `fs.FSWatcher` used here, so tests can inject a fake. */
export interface WatchHandle {
  close(): void;
  on(event: "error", listener: (error: Error) => void): this;
  unref?(): void;
}

/** A filesystem watch factory, injectable for tests. */
export type WatchFn = (
  directory: string,
  listener: (eventType: string, filename: string | null) => void,
) => WatchHandle;

export interface WatchDirectoryOptions {
  /** Coalesce events that arrive within this many milliseconds. Default: 200. */
  debounceMs?: number;
  /** Poll interval while waiting for a removed directory to be recreated. */
  retryMs?: number;
  /** Filesystem watch factory, injectable for tests. */
  watchFn?: WatchFn;
  /** Path existence check, injectable for tests. */
  exists?: (path: string) => boolean;
}

const defaultWatchFn: WatchFn = (directory, listener) =>
  watch(directory, listener);

/**
 * Watch a directory and call `callback` (debounced) after its contents change.
 *
 * Returns a stop function. The watcher and its timers are unref'd, so a caller
 * that wants the process to stay alive must have some other handle open.
 */
export function watchDirectory(
  directory: string,
  callback: () => void,
  options: WatchDirectoryOptions = {},
): () => void {
  const debounceMs = options.debounceMs ?? 200;
  const retryMs = options.retryMs ?? debounceMs;
  const watchFn = options.watchFn ?? defaultWatchFn;
  const exists = options.exists ?? existsSync;

  let watcher: WatchHandle | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const clearDebounce = (): void => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const detach = (): void => {
    if (watcher === null) return;
    const current = watcher;
    watcher = null;
    try {
      current.close();
    } catch {
      // The watcher may already be gone; closing is best-effort.
    }
  };

  const scheduleRetry = (): void => {
    if (stopped || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (stopped) return;
      if (exists(directory)) {
        attach();
        schedule();
      } else {
        scheduleRetry();
      }
    }, retryMs);
    retryTimer.unref();
  };

  const schedule = (): void => {
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (stopped) return;

      // A watched directory can vanish without an error event (Linux keeps the
      // watch on the old inode and emits one final rename). Drop the dead
      // watcher and poll until the directory is recreated, then reload.
      if (!exists(directory)) {
        detach();
        scheduleRetry();
        return;
      }

      try {
        callback();
      } catch {
        // A failing reload must not kill the watcher: later events still fire.
      }
    }, debounceMs);
    debounceTimer.unref();
  };

  const handleEvent = (eventType: string): void => {
    // A `rename` is how `fs.watch` reports both the watched directory being
    // removed/recreated and entries being added or removed inside it. The
    // directory may already exist again when the event is handled (a quick
    // remove/recreate inside the debounce window), but the old watcher is still
    // attached to the dead inode. Detach and re-attach so the watcher always
    // follows the current directory, then reload.
    if (eventType === "rename") {
      detach();
      if (exists(directory)) {
        attach();
      } else {
        scheduleRetry();
      }
    }
    schedule();
  };

  const handleError = (): void => {
    detach();
    scheduleRetry();
  };

  const attach = (): void => {
    if (stopped || watcher !== null) return;
    if (!exists(directory)) {
      scheduleRetry();
      return;
    }
    try {
      watcher = watchFn(directory, handleEvent);
      watcher.on("error", handleError);
      watcher.unref?.();
    } catch {
      // `watch` can throw synchronously (missing directory, resource limits).
      handleError();
    }
  };

  attach();

  return () => {
    stopped = true;
    clearDebounce();
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    detach();
  };
}
