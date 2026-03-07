/**
 * Build documentation packages from registry definitions.
 *
 * Uses @neuledge/context functions directly (workspace dependency)
 * to clone repos, read docs, and build SQLite packages.
 *
 * Supports both versioned (clone at specific tag) and unversioned
 * (clone default branch) definitions.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  type BuildResult,
  buildPackage,
  cloneRepository,
  readLocalDocsFiles,
} from "@neuledge/context";
import {
  constructTag,
  resolveVersionEntry,
  type Source,
  type UnversionedDefinition,
  type VersionedDefinition,
} from "./definition.js";

export interface RegistryBuildResult extends BuildResult {
  name: string;
  registry: string;
  version: string;
  /** Source content fingerprint for skip-if-unchanged checks */
  sourceCommit?: string;
}

/**
 * Get the HEAD commit SHA of a remote repository without cloning.
 * Uses `git ls-remote` which makes a single HTTP call.
 */
export function getHeadCommit(url: string): string {
  const output = execSync(`git ls-remote ${url} HEAD`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

  // Format: "<sha>\tHEAD"
  const sha = output.split("\t")[0];
  if (!sha) {
    throw new Error(`Failed to get HEAD commit for ${url}`);
  }
  return sha;
}

interface ZipEntry {
  path: string;
  compression: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const ZIP_DOC_EXTENSIONS = [
  ".txt",
  ".md",
  ".mdx",
  ".qmd",
  ".rmd",
  ".adoc",
  ".rst",
];

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function hasSupportedDocExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return ZIP_DOC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function matchZipDocsPath(path: string, docsPath?: string): boolean {
  if (!docsPath) return true;
  const normalizedPath = normalizePath(path);
  const normalizedPrefix = normalizePath(docsPath).replace(/\/+$/, "");
  return (
    normalizedPath === normalizedPrefix ||
    normalizedPath.startsWith(`${normalizedPrefix}/`)
  );
}

function findEndOfCentralDirectory(zip: Buffer): number {
  const sig = 0x06054b50;
  const maxSearch = Math.max(0, zip.length - 66_000);

  for (let i = zip.length - 22; i >= maxSearch; i--) {
    if (zip.readUInt32LE(i) === sig) {
      return i;
    }
  }

  throw new Error("Invalid ZIP: end of central directory not found");
}

function readCentralDirectoryEntries(zip: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(zip);
  const totalEntries = zip.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = zip.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntry[] = [];
  let offset = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP: malformed central directory");
    }

    const compression = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const fileNameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);

    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const path = zip.subarray(nameStart, nameEnd).toString("utf-8");

    if (!path.endsWith("/")) {
      entries.push({
        path: normalizePath(path),
        compression,
        compressedSize,
        localHeaderOffset,
      });
    }

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function extractZipEntry(zip: Buffer, entry: ZipEntry): Buffer {
  const localOffset = entry.localHeaderOffset;
  if (zip.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error(`Invalid ZIP local header for ${entry.path}`);
  }

  const fileNameLength = zip.readUInt16LE(localOffset + 26);
  const extraLength = zip.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const compressedData = zip.subarray(
    dataStart,
    dataStart + entry.compressedSize,
  );

  if (entry.compression === 0) {
    return compressedData;
  }
  if (entry.compression === 8) {
    return inflateRawSync(compressedData);
  }

  throw new Error(
    `Unsupported ZIP compression method ${entry.compression} for ${entry.path}`,
  );
}

async function readZipDocs(
  url: string,
  docsPath?: string,
): Promise<{
  files: Array<{ path: string; content: string }>;
  sourceCommit: string;
}> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `ZIP download failed: ${response.status} ${response.statusText}`,
    );
  }

  const zipBuffer = Buffer.from(await response.arrayBuffer());
  const sourceCommit = createHash("sha256").update(zipBuffer).digest("hex");
  const entries = readCentralDirectoryEntries(zipBuffer);

  const files: Array<{ path: string; content: string }> = [];
  for (const entry of entries) {
    if (!hasSupportedDocExtension(entry.path)) continue;
    if (!matchZipDocsPath(entry.path, docsPath)) continue;

    const contentBuffer = extractZipEntry(zipBuffer, entry);
    files.push({
      path: entry.path,
      content: contentBuffer.toString("utf-8"),
    });
  }

  return { files, sourceCommit };
}

function resolveVersionedSourceUrl(url: string, version: string): string {
  return url.replaceAll("{version}", version);
}

async function buildFromSource(
  source: Source,
  options: { ref?: string; version?: string },
): Promise<{
  files: Array<{ path: string; content: string }>;
  sourceCommit?: string;
  resolvedSourceUrl: string;
}> {
  if (source.type === "git") {
    const { tempDir, cleanup } = cloneRepository(source.url, options.ref);

    try {
      const files = readLocalDocsFiles(tempDir, {
        path: source.docs_path,
        lang: source.lang,
      });

      const sourceCommit =
        options.ref == null
          ? execSync("git rev-parse HEAD", {
              cwd: tempDir,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
            }).trim()
          : undefined;

      return {
        files,
        sourceCommit,
        resolvedSourceUrl: source.url,
      };
    } finally {
      cleanup();
    }
  }

  const resolvedSourceUrl = options.version
    ? resolveVersionedSourceUrl(source.url, options.version)
    : source.url;
  const { files, sourceCommit } = await readZipDocs(
    resolvedSourceUrl,
    source.docs_path,
  );

  return { files, sourceCommit, resolvedSourceUrl };
}

/**
 * Build a .db package for a specific version of a versioned definition.
 */
export async function buildFromDefinition(
  definition: VersionedDefinition,
  version: string,
  outputDir: string,
): Promise<RegistryBuildResult> {
  const entry = resolveVersionEntry(definition, version);
  if (!entry) {
    throw new Error(
      `No version entry matches ${version} in ${definition.name}`,
    );
  }

  const tag = constructTag(entry.tag_pattern, version);
  // Replace / in scoped names (e.g., @trpc/server -> @trpc-server) for valid filenames
  const safeName = definition.name.replace(/\//g, "-");
  const outputPath = join(
    outputDir,
    `${definition.registry}-${safeName}@${version}.db`,
  );

  const { files, resolvedSourceUrl } = await buildFromSource(entry.source, {
    ref: entry.source.type === "git" ? tag : undefined,
    version,
  });

  if (files.length === 0) {
    throw new Error(`No documentation files found in ${resolvedSourceUrl}`);
  }

  const result = buildPackage(outputPath, files, {
    name: definition.name,
    version,
    description: definition.description,
    sourceUrl: definition.repository ?? resolvedSourceUrl,
  });

  return {
    ...result,
    name: definition.name,
    registry: definition.registry,
    version,
  };
}

/**
 * Build a .db package from an unversioned definition.
 * Clones the default branch (HEAD) and labels the package as "latest".
 */
export async function buildUnversioned(
  definition: UnversionedDefinition,
  outputDir: string,
): Promise<RegistryBuildResult> {
  const version = "latest";
  const { source } = definition;
  const safeName = definition.name.replace(/\//g, "-");
  const outputPath = join(
    outputDir,
    `${definition.registry}-${safeName}@${version}.db`,
  );

  const { files, sourceCommit, resolvedSourceUrl } = await buildFromSource(
    source,
    {},
  );

  if (files.length === 0) {
    throw new Error(`No documentation files found in ${resolvedSourceUrl}`);
  }

  const result = buildPackage(outputPath, files, {
    name: definition.name,
    version,
    description: definition.description,
    sourceUrl: definition.repository ?? resolvedSourceUrl,
    sourceCommit,
  });

  return {
    ...result,
    name: definition.name,
    registry: definition.registry,
    version,
    sourceCommit,
  };
}
