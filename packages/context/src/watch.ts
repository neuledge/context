import { existsSync, watch } from "node:fs";

/** Wait this long after the last event before treating a burst as one change. */
const DEBOUNCE_MS = 200;

/**
 * Call `onChange` when the contents of `dir` change.
 *
 * Debounced, because a single install is several filesystem events: `context
 * add` writes a temporary file and renames it into place. Without this, one
 * install would rebuild the tool schema three or four times.
 *
 * The watcher is unref'd, so watching never keeps the process alive by itself.
 * Returns a stop function; a missing directory is a no-op rather than an error,
 * since nothing has been installed yet in that case.
 */
export function watchDirectory(dir: string, onChange: () => void): () => void {
  if (!existsSync(dir)) return () => {};

  let pending: NodeJS.Timeout | undefined;

  const watcher = watch(dir, () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      try {
        onChange();
      } catch {
        // A refresh that throws must not take the server down with it.
      }
    }, DEBOUNCE_MS);
  });

  watcher.unref();

  return () => {
    if (pending) clearTimeout(pending);
    watcher.close();
  };
}
