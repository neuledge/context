import {
  constructTag,
  isGitVersionEntry,
  isVersioned,
  type PackageDefinition,
  resolveUrl,
  resolveVersionEntry,
} from "./definition.js";

/** Resolve the same release inputs for both building and fingerprinting. */
export function resolveBuildSource(
  definition: PackageDefinition,
  version: string,
) {
  if (!isVersioned(definition)) return definition.source;
  const entry = resolveVersionEntry(definition, version);
  if (!entry) {
    throw new Error(
      `No version entry matches ${version} in ${definition.name}`,
    );
  }
  if (isGitVersionEntry(entry)) {
    return { ...entry.source, ref: constructTag(entry.tag_pattern, version) };
  }
  return {
    ...entry.source,
    url: resolveUrl(entry.source.url, version),
    ...(entry.source.type === "zip" && entry.source.docs_path
      ? { docs_path: resolveUrl(entry.source.docs_path, version) }
      : {}),
  };
}
