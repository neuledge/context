/**
 * Glob matching for `exclude_paths`, shared by the zip and git source builders.
 */

/**
 * Compile a simple glob pattern to a RegExp.
 * Supports * (any chars except /) and ** (any chars including /).
 */
export function compileGlob(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Drop files matching any exclude pattern.
 *
 * Patterns are matched against the path relative to `docsPath`, so a definition
 * reads the same whether its source is a zip or a git clone: the zip builder
 * strips the prefix while extracting, and git file paths still carry it.
 */
export function excludeFiles<T extends { path: string }>(
  files: T[],
  excludePaths: string[] | undefined,
  docsPath?: string,
): T[] {
  if (!excludePaths?.length) return files;

  const patterns = excludePaths.map(compileGlob);
  const prefix = docsPath ? `${docsPath.replace(/\/+$/, "")}/` : "";

  return files.filter((file) => {
    const relative =
      prefix && file.path.startsWith(prefix)
        ? file.path.slice(prefix.length)
        : file.path;
    return !patterns.some((re) => re.test(relative));
  });
}
