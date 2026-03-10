/**
 * ZIP archive download and extraction for documentation sources.
 *
 * Downloads ZIP files from URLs and extracts documentation files
 * (HTML, Markdown, AsciiDoc, RST) using Node.js built-in zlib.
 * No external ZIP library required.
 */

import { inflateRawSync } from "node:zlib";

const DOCUMENTATION_EXTENSIONS = [
  ".md",
  ".mdx",
  ".qmd",
  ".rmd",
  ".adoc",
  ".rst",
  ".html",
  ".htm",
];

/**
 * Common auto-generated HTML files that are navigation indexes or
 * boilerplate rather than useful documentation content.
 * Matched against the filename (basename) of each entry.
 */
const IGNORED_FILES = new Set([
  // Javadoc auto-generated indexes
  "allpackages-index.html",
  "allclasses-index.html",
  "index-all.html",
  "constant-values.html",
  "serialized-form.html",
  "deprecated-list.html",
  "help-doc.html",
  "overview-tree.html",
  // Common navigation/generated pages
  "genindex.html",
  "search.html",
  "searchindex.js",
  "py-modindex.html",
]);

interface ZipEntry {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
}

/**
 * Download a ZIP file from a URL and extract documentation files.
 * Optionally filters to a specific subdirectory within the archive.
 * Supports exclude patterns (glob-style with * wildcards) to skip unwanted files.
 */
export async function downloadAndExtractZip(
  url: string,
  options?: { docsPath?: string; excludePaths?: string[] },
): Promise<Array<{ path: string; content: string }>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ZIP from ${url}: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const entries = readCentralDirectory(buffer);

  const files: Array<{ path: string; content: string }> = [];
  const docsPath = options?.docsPath;
  const excludePatterns = options?.excludePaths?.map(compileGlob);

  for (const entry of entries) {
    // Skip directories
    if (entry.path.endsWith("/")) continue;

    // Filter by docs_path prefix
    if (docsPath && !entry.path.startsWith(`${docsPath}/`)) continue;

    // Filter to documentation file extensions
    const ext = getExtension(entry.path);
    if (!DOCUMENTATION_EXTENSIONS.includes(ext)) continue;

    const relativePath = docsPath
      ? entry.path.slice(docsPath.length + 1)
      : entry.path;

    // Skip default ignored files (by basename)
    const basename = relativePath.split("/").pop() ?? "";
    if (IGNORED_FILES.has(basename)) continue;

    // Apply custom exclude patterns against relative path
    if (excludePatterns?.some((re) => re.test(relativePath))) continue;

    const content = extractEntry(buffer, entry);
    files.push({ path: relativePath, content });
  }

  return files;
}

/**
 * Compile a simple glob pattern to a RegExp.
 * Supports * (any chars except /) and ** (any chars including /).
 */
function compileGlob(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Get lowercase file extension including the dot. */
function getExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "";
  return path.slice(lastDot).toLowerCase();
}

/**
 * Parse the ZIP central directory to get entry metadata.
 * The central directory is at the end of the file and lists all entries.
 */
function readCentralDirectory(buffer: Buffer): ZipEntry[] {
  // Find End of Central Directory record (EOCD)
  // Signature: 0x06054b50
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP file: End of Central Directory not found");
  }

  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);

  const entries: ZipEntry[] = [];
  let offset = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    // Central directory file header signature: 0x02014b50
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory entry");
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    const path = buffer.toString(
      "utf-8",
      offset + 46,
      offset + 46 + fileNameLength,
    );

    entries.push({
      path,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      localHeaderOffset,
    });

    offset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

/**
 * Extract a single entry's content from the ZIP buffer.
 * Supports stored (no compression) and deflated entries.
 */
function extractEntry(buffer: Buffer, entry: ZipEntry): string {
  // Read local file header to find data start
  const localOffset = entry.localHeaderOffset;

  // Local file header signature: 0x04034b50
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error(`Invalid local file header for ${entry.path}`);
  }

  const localFileNameLength = buffer.readUInt16LE(localOffset + 26);
  const localExtraLength = buffer.readUInt16LE(localOffset + 28);
  const dataOffset = localOffset + 30 + localFileNameLength + localExtraLength;

  const compressedData = buffer.subarray(
    dataOffset,
    dataOffset + entry.compressedSize,
  );

  let data: Buffer;
  if (entry.compressionMethod === 0) {
    // Stored (no compression)
    data = compressedData;
  } else if (entry.compressionMethod === 8) {
    // Deflated
    data = inflateRawSync(compressedData);
  } else {
    throw new Error(
      `Unsupported compression method ${entry.compressionMethod} for ${entry.path}`,
    );
  }

  return data.toString("utf-8");
}
