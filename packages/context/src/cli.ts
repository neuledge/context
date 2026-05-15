#!/usr/bin/env node

import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Command } from "commander";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

import { loadAuth, saveAuth } from "./auth.js";
import { getServerUrl } from "./config.js";
import { initDatabase } from "./database.js";
import { downloadPackage, searchPackages } from "./download.js";
import { extractArticleMarkdown } from "./extract-html.js";
import {
  buildFetchOptions,
  fetchWithTimeout,
  readResponseText,
} from "./fetch.js";
import {
  checkoutRef,
  cloneRepository,
  detectLocalDocsFolder,
  detectVersion,
  extractRepoName,
  fetchTagsWithMetadata,
  getDefaultBranch,
  isGitUrl,
  parseGitUrl,
  parseMonorepoTag,
  readLocalDocsFiles,
  sortTagsForSelection,
  type TagInfo,
} from "./git.js";
import {
  GET_DOCS_TOPIC_DESCRIPTION,
  NO_DOCUMENTATION_FOUND_MESSAGE,
  SEARCH_PACKAGES_NAME_DESCRIPTION,
} from "./guidance.js";
import { fetchLinkedDocs } from "./llms-txt.js";
import { buildPackage, type MarkdownFile } from "./package-builder.js";
import { type SearchResult, search } from "./search.js";
import { ContextServer } from "./server.js";
import {
  getPackageFileName,
  type PackageInfo,
  PackageStore,
  readPackageInfo,
} from "./store.js";

type SourceType = "file" | "url" | "git" | "local-dir" | "website";

/** Detect the type of source based on the input string. */
export function detectSourceType(source: string): SourceType {
  // Handle empty or whitespace-only strings as file
  if (!source.trim()) {
    return "file";
  }

  // Git: any git-compatible URL (git://, ssh://, git@, .git suffix, or known hosts)
  if (isGitUrl(source)) {
    return "git";
  }

  // URL: starts with http:// or https://
  if (source.startsWith("http://") || source.startsWith("https://")) {
    // .db files are direct package downloads
    if (source.endsWith(".db")) {
      return "url";
    }
    // URLs ending with llms.txt or llms-full.txt are treated as direct website sources
    if (source.endsWith("/llms.txt") || source.endsWith("/llms-full.txt")) {
      return "website";
    }
    // Other URLs are websites — we'll try to fetch llms.txt from them
    return "website";
  }

  // Local directory: check if path exists and is a directory
  const resolvedPath = resolve(source);
  try {
    const stat = statSync(resolvedPath);
    if (stat.isDirectory()) {
      return "local-dir";
    }
  } catch {
    // Path doesn't exist or can't be accessed - treat as file
  }

  // Default: local file (.db package)
  return "file";
}

/** Download a file from a URL to a local path. */
async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`,
    );
  }

  if (!response.body) {
    throw new Error("Download failed: No response body");
  }

  const fileStream = createWriteStream(destPath);
  // Convert web ReadableStream to Node stream
  const { Readable } = await import("node:stream");
  const nodeStream = Readable.fromWeb(
    response.body as import("stream/web").ReadableStream,
  );
  await pipeline(nodeStream, fileStream);
}

const DATA_DIR = join(homedir(), ".context", "packages");

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Well-known llms.txt file paths to try, in order of preference. */
const LLMS_TXT_PATHS = ["/llms-full.txt", "/llms.txt"];

/**
 * Derive a package name from a website URL.
 * e.g., "https://react-aria.adobe.com" → "react-aria.adobe.com"
 */
export function packageNameFromUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.hostname.replace(/^www\./, "");
}

/**
 * Derive a package name from an arbitrary URL, including path.
 * e.g., "https://overreacted.io/things-i-dont-know-as-of-2018/" → "overreacted.io-things-i-dont-know-as-of-2018"
 */
export function suggestPackageNameFromUrl(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/$/, "").replace(/^\//, "");
  if (!path) return host;
  const sanitizedPath = path
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitizedPath ? `${host}-${sanitizedPath}` : host;
}

export interface FetchedWebPage {
  /** Clean markdown/text content, ready to pass to the package builder. */
  content: string;
  /** Article title when extracted from HTML (undefined for raw markdown/text). */
  title?: string;
}

/**
 * Result of {@link fetchWebPage}. On failure, `reason` describes what
 * went wrong so callers can surface a useful error to the user.
 */
export type FetchWebPageResult =
  | ({ ok: true } & FetchedWebPage)
  | { ok: false; reason: string };

/**
 * Fetch a web page and return it as markdown-ready content.
 *
 * HTML responses are run through defuddle to strip site chrome (nav,
 * subscribe boxes, comments, recommendation rails) before being
 * converted to Markdown. Markdown/plain-text responses pass through
 * unchanged. On failure, returns `{ ok: false, reason }` with a
 * human-readable explanation.
 */
export async function fetchWebPage(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = 30_000,
): Promise<FetchWebPageResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      url,
      buildFetchOptions(url),
      timeoutMs,
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: `request timed out after ${timeoutMs}ms` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `network error: ${msg}` };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `HTTP ${response.status} ${response.statusText}`.trim(),
    };
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > 10 * 1024 * 1024) {
    return { ok: false, reason: "response exceeds 10 MB size cap" };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    contentType.includes("application/pdf") ||
    contentType.startsWith("image/") ||
    contentType.startsWith("video/") ||
    contentType.startsWith("audio/")
  ) {
    return {
      ok: false,
      reason: `unsupported content type: ${contentType || "binary"}`,
    };
  }

  let text: string | null;
  try {
    text = await readResponseText(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `failed to read response body: ${msg}` };
  }

  if (text === null) {
    return { ok: false, reason: "response body exceeds 10 MB size cap" };
  }
  if (!text.trim()) {
    return { ok: false, reason: "empty response body" };
  }

  const isHtml =
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml") ||
    (!contentType && /<html[\s>]/i.test(text.slice(0, 1024)));

  if (isHtml) {
    const extracted = await extractArticleMarkdown(text, url);
    if (!extracted) {
      return {
        ok: false,
        reason: "could not extract readable article content from HTML",
      };
    }
    return { ok: true, content: extracted.markdown, title: extracted.title };
  }

  return { ok: true, content: text };
}

/**
 * Resolve the llms.txt URL to fetch.
 * If the URL already points to a specific llms.txt file, use it directly.
 * Otherwise, try well-known paths from the site root.
 */
export function resolveLlmsTxtUrls(source: string): string[] {
  const url = new URL(source);

  if (
    url.pathname.endsWith("/llms.txt") ||
    url.pathname.endsWith("/llms-full.txt")
  ) {
    return [source];
  }

  // Build base URL (ensure trailing slash handling)
  const base = url.origin + url.pathname.replace(/\/$/, "");
  return LLMS_TXT_PATHS.map((path) => `${base}${path}`);
}

/** Install a package from a website's llms.txt file. */
async function addFromWebsite(
  source: string,
  options: AddFromGitOptions,
): Promise<void> {
  const urls = resolveLlmsTxtUrls(source);

  let content: string | null = null;
  let resolvedUrl: string | null = null;

  for (const url of urls) {
    console.log(`Trying ${url}...`);
    try {
      const response = await fetch(url, buildFetchOptions(url));
      if (response.ok) {
        const text = await response.text();
        // Sanity check: must have some meaningful content
        if (text.trim().length > 0) {
          content = text;
          resolvedUrl = url;
          console.log(`✓ Found ${url}`);
          break;
        }
      }
    } catch {
      // Network error — continue to next URL
    }
  }

  if (!content || !resolvedUrl) {
    // Fallback: fetch the original URL as a single page
    console.log(`No llms.txt found. Fetching page content directly...`);
    const page = await fetchWebPage(source);
    if (!page.ok) {
      throw new Error(
        `No llms.txt found at ${source}. Tried:\n${urls.map((u) => `  - ${u}`).join("\n")}\n\nDirect fetch also failed: ${page.reason}.`,
      );
    }

    const packageName = options.name ?? suggestPackageNameFromUrl(source);
    const versionLabel = options.version ?? "latest";

    const parsedUrl = new URL(source);
    let path = parsedUrl.pathname.replace(/\/$/, "") || "/index";
    if (!/\.(md|mdx|adoc|rst|txt)$/i.test(path)) {
      path += ".md";
    }
    const docPath = parsedUrl.host + path;

    const files: MarkdownFile[] = [{ path: docPath, content: page.content }];

    ensureDataDir();
    const outputPath = join(
      DATA_DIR,
      getPackageFileName(packageName, versionLabel),
    );

    console.log(`Building package...`);
    const result = buildPackage(outputPath, files, {
      name: packageName,
      version: versionLabel,
      sourceUrl: source,
    });

    if (result.sectionCount === 0) {
      throw new Error(
        `No documentation sections could be extracted from ${source}. The page may be empty or in an unsupported format.`,
      );
    }

    console.log(`✓ Built package: ${packageName}@${versionLabel}`);
    console.log(`✓ Saved to ${outputPath}`);

    if (options.save) {
      savePackageCopy(outputPath, options.save, packageName, versionLabel);
    }

    const sizeBytes = statSync(outputPath).size;

    console.log(
      `\nInstalled: ${packageName}@${versionLabel} (${formatBytes(sizeBytes)}, ${result.sectionCount} sections)`,
    );
    return;
  }

  const packageName = options.name ?? packageNameFromUrl(source);
  const versionLabel = options.version ?? "latest";

  const isFullIndex = resolvedUrl.endsWith("/llms-full.txt");

  // Always include the index itself so the H1/intro content is preserved.
  const files: MarkdownFile[] = [
    {
      path: isFullIndex ? "llms-full.txt" : "llms.txt",
      content,
    },
  ];

  // llms.txt is a curated index of links — follow them to fetch the actual
  // documentation. llms-full.txt already inlines everything, so skip.
  if (!isFullIndex) {
    const linkedFiles = await fetchLinkedDocs(content, resolvedUrl, {
      log: (msg) => {
        console.log(msg);
      },
    });
    files.push(...linkedFiles);
  }

  // Build the package
  ensureDataDir();
  const outputPath = join(
    DATA_DIR,
    getPackageFileName(packageName, versionLabel),
  );

  console.log(`Building package...`);
  const result = buildPackage(outputPath, files, {
    name: packageName,
    version: versionLabel,
    sourceUrl: source,
  });

  if (result.sectionCount === 0) {
    throw new Error(
      `No documentation sections could be extracted from ${resolvedUrl}. The file may be empty or in an unsupported format.`,
    );
  }

  console.log(`✓ Built package: ${packageName}@${versionLabel}`);
  console.log(`✓ Saved to ${outputPath}`);

  // Save to custom path if specified
  if (options.save) {
    savePackageCopy(outputPath, options.save, packageName, versionLabel);
  }

  const sizeBytes = statSync(outputPath).size;

  console.log(
    `\nInstalled: ${packageName}@${versionLabel} (${formatBytes(sizeBytes)}, ${result.sectionCount} sections)`,
  );
}

const LOW_DOCS_THRESHOLD = 50;

/** Build a Google search URL to help find documentation repos. */
function buildDocsSearchUrl(repoName: string): string {
  const query = `${repoName} documentation site github.com`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/** Warn if package has few sections (docs may live elsewhere). */
function warnIfLowDocs(sectionCount: number, repoName: string): void {
  if (sectionCount < LOW_DOCS_THRESHOLD) {
    const searchUrl = buildDocsSearchUrl(repoName);
    console.log(`
⚠️  Warning: Only ${sectionCount} sections found (threshold: ${LOW_DOCS_THRESHOLD})
   This repository may not contain substantial documentation.
   Many projects keep docs in a separate repository.

   🔍 Search for the docs repo: ${searchUrl}

   Or try:
   - Use --path to specify a different docs folder
   - Check for a dedicated docs repo (e.g., ${repoName}-docs, ${repoName}.github.io)`);
  }
}

/** Save a copy of the package to the specified path. */
function savePackageCopy(
  sourcePath: string,
  savePath: string,
  packageName: string,
  version: string,
): void {
  const resolvedSavePath = resolve(savePath);

  let destPath: string;
  if (
    existsSync(resolvedSavePath) &&
    statSync(resolvedSavePath).isDirectory()
  ) {
    // Save to directory with standard name
    destPath = join(resolvedSavePath, getPackageFileName(packageName, version));
  } else if (savePath.endsWith(".db")) {
    // Use exact path
    destPath = resolvedSavePath;
    // Ensure parent directory exists
    const parentDir = resolve(destPath, "..");
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
  } else {
    // Treat as directory, create it
    mkdirSync(resolvedSavePath, { recursive: true });
    destPath = join(resolvedSavePath, getPackageFileName(packageName, version));
  }

  copyFileSync(sourcePath, destPath);
  console.log(`✓ Saved to ${destPath}`);
}

/** Ensure data directory exists. */
function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

/** Load all packages from the data directory into the store. */
function loadPackages(store: PackageStore): void {
  if (!existsSync(DATA_DIR)) return;

  for (const file of readdirSync(DATA_DIR)) {
    if (!file.endsWith(".db")) continue;
    try {
      const info = readPackageInfo(join(DATA_DIR, file));
      store.add(info);
    } catch {
      // Skip invalid packages
    }
  }
}

/** Parse a `--libs` spec into name (optionally with @version). */
// Uses lastIndexOf so scoped names like `@trpc/server@1.0.0` split correctly,
// while a bare scoped name `@trpc/server` (leading `@` only) keeps its name.
export function parseLibSpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { name: spec };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

/**
 * Resolve `--libs` specs against installed packages. Exits the process with a
 * descriptive error if any spec doesn't match an installed package.
 */
export function resolveAllowedLibraries(
  specs: string[],
  installed: PackageInfo[],
): Set<string> {
  const allowed = new Set<string>();
  const errors: string[] = [];

  for (const raw of specs) {
    const spec = parseLibSpec(raw);
    const pkg = installed.find((p) => p.name === spec.name);

    if (!pkg) {
      errors.push(`  - ${raw}: not installed`);
      continue;
    }
    if (spec.version && pkg.version !== spec.version) {
      errors.push(
        `  - ${raw}: installed version is ${pkg.version}, not ${spec.version}`,
      );
      continue;
    }
    allowed.add(pkg.name);
  }

  if (errors.length > 0) {
    console.error("Cannot start --libs session:");
    for (const e of errors) console.error(e);
    console.error("Run `context list` to see installed packages.");
    process.exit(1);
  }

  return allowed;
}

const program = new Command()
  .name("context")
  .description("Local-first documentation for AI agents")
  .version(version);

/** Install a package from a local file path. */
function addFromFile(source: string, options: { save?: string }): void {
  const sourcePath = resolve(source);
  if (!existsSync(sourcePath)) {
    throw new Error(`File not found: ${source}`);
  }

  console.log(`Installing ${source}...`);

  // Read package info and validate
  const info = readPackageInfo(sourcePath);

  // Copy to data directory
  ensureDataDir();
  const destName = getPackageFileName(info.name, info.version);
  const destPath = join(DATA_DIR, destName);

  if (resolve(sourcePath) !== destPath) {
    copyFileSync(sourcePath, destPath);
    console.log(`✓ Copied to ${destPath}`);
    info.path = destPath;
  }

  // Save to custom path if specified
  if (options.save) {
    savePackageCopy(destPath, options.save, info.name, info.version);
  }

  console.log(
    `\nInstalled: ${info.name}@${info.version} (${formatBytes(info.sizeBytes)}, ${info.sectionCount} sections)`,
  );
}

/** Install a package from a URL. */
async function addFromUrl(
  url: string,
  options: { save?: string },
): Promise<void> {
  console.log(`Downloading ${url}...`);

  // Extract filename from URL for temp file
  const urlObj = new URL(url);
  const filename = basename(urlObj.pathname) || "package.db";

  // Download to temp location first
  ensureDataDir();
  const tempPath = join(DATA_DIR, `.downloading-${Date.now()}-${filename}`);

  try {
    await downloadFile(url, tempPath);
    console.log(`✓ Downloaded`);

    // Validate the package
    const info = readPackageInfo(tempPath);
    console.log(`✓ Validated package`);

    // Move to final location
    const destName = getPackageFileName(info.name, info.version);
    const destPath = join(DATA_DIR, destName);

    // Remove old version if it exists
    if (existsSync(destPath)) {
      unlinkSync(destPath);
    }

    // Rename temp to final
    renameSync(tempPath, destPath);
    info.path = destPath;

    // Save to custom path if specified
    if (options.save) {
      savePackageCopy(destPath, options.save, info.name, info.version);
    }

    console.log(
      `\nInstalled: ${info.name}@${info.version} (${formatBytes(info.sizeBytes)}, ${info.sectionCount} sections)`,
    );
  } catch (err) {
    // Clean up temp file on error
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw err;
  }
}

export interface AddFromGitOptions {
  tag?: string;
  version?: string;
  path?: string;
  name?: string;
  save?: string;
  lang?: string;
}

/**
 * Check if running in interactive TTY mode.
 */
function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Prompt user to select a git tag from a list.
 * Returns the selected tag name, or null for HEAD.
 */
async function promptTagSelection(
  tags: TagInfo[],
  defaultBranch: string,
): Promise<string | null> {
  const { select } = await import("@inquirer/prompts");

  const HEAD_VALUE = "__HEAD__";

  const choices = [
    {
      name: `HEAD (current ${defaultBranch} branch)`,
      value: HEAD_VALUE,
    },
    ...tags.map((tag) => ({
      name: tag.isPrerelease ? `${tag.name} (prerelease)` : tag.name,
      value: tag.name,
    })),
  ];

  const selected = await select({
    message: "Select a tag:",
    choices,
    pageSize: 15,
  });

  return selected === HEAD_VALUE ? null : selected;
}

/**
 * Prompt user to confirm or modify package name and version.
 */
async function promptPackageDetails(
  suggestedName: string,
  suggestedVersion: string,
): Promise<{ name: string; version: string }> {
  const { input } = await import("@inquirer/prompts");

  const name = await input({
    message: "Package name:",
    default: suggestedName,
  });

  const version = await input({
    message: "Version:",
    default: suggestedVersion,
  });

  return { name, version };
}

/** Install a package from a git repository (via clone). */
async function addFromGitClone(
  source: string,
  options: AddFromGitOptions,
): Promise<void> {
  const { url, ref: urlRef } = parseGitUrl(source);

  console.log(`Cloning ${url}${urlRef ? ` (ref: ${urlRef})` : ""}...`);

  // If the URL already specifies a ref (e.g. /tree/branch), clone directly
  // onto it — that's more reliable than post-clone fetch+checkout, which
  // doesn't work cleanly for branches on shallow clones.
  const { tempDir, cleanup } = cloneRepository(url, urlRef);

  try {
    // Determine which tag/ref to use
    let selectedTag: string | null = null;

    if (options.tag) {
      // Explicit --tag provided
      selectedTag = options.tag;
    } else if (urlRef) {
      // Ref was part of the URL (e.g., /tree/branch). Already checked out
      // via the initial clone, so we only record it for labeling below.
      selectedTag = urlRef;
    } else {
      // Interactive tag selection
      if (!isInteractive()) {
        throw new Error(
          "Interactive mode required. Use --tag to specify a git tag, or run in a terminal.",
        );
      }

      console.log("Fetching tags...");
      const tags = fetchTagsWithMetadata(tempDir);
      const sortedTags = sortTagsForSelection(tags);
      const defaultBranch = getDefaultBranch(tempDir);

      if (sortedTags.length === 0) {
        console.log("No tags found, using HEAD.");
      } else {
        selectedTag = await promptTagSelection(sortedTags, defaultBranch);
      }
    }

    // Checkout the selected tag if specified — skipped when we already
    // cloned with it (urlRef case).
    if (selectedTag && selectedTag !== urlRef) {
      console.log(`Checking out ${selectedTag}...`);
      checkoutRef(tempDir, selectedTag);
    }

    // Determine package name and version
    let packageName: string;
    let versionLabel: string;

    // Extract suggested values from tag or use defaults
    const repoName = extractRepoName(url);
    let suggestedName = repoName;
    let suggestedVersion = "latest";

    if (selectedTag) {
      const parsed = parseMonorepoTag(selectedTag);
      if (parsed.packageName) {
        suggestedName = parsed.packageName;
      }
      suggestedVersion = parsed.version;
    }

    // Use explicit options if provided, otherwise prompt or use suggestions
    if (options.name && options.version) {
      // Both provided, skip prompts
      packageName = options.name;
      versionLabel = options.version;
    } else if (options.name) {
      packageName = options.name;
      versionLabel = options.version ?? suggestedVersion;
    } else if (options.version) {
      packageName = options.name ?? suggestedName;
      versionLabel = options.version;
    } else {
      // Need to prompt for confirmation
      if (!isInteractive()) {
        // Non-interactive: use suggested values
        packageName = suggestedName;
        versionLabel = suggestedVersion;
        console.log(`Using: ${packageName}@${versionLabel}`);
      } else {
        const details = await promptPackageDetails(
          suggestedName,
          suggestedVersion,
        );
        packageName = details.name;
        versionLabel = details.version;
      }
    }

    // Detect or use provided docs path
    let docsPath: string | undefined = options.path;
    if (!docsPath) {
      const detected = detectLocalDocsFolder(tempDir);
      if (detected) {
        docsPath = detected;
      }
    }

    if (docsPath) {
      console.log(`✓ Found docs at /${docsPath}`);
    } else {
      console.log(`✓ Reading from repository root`);
    }

    // Read all markdown files (filtered by language)
    const files = readLocalDocsFiles(tempDir, {
      path: docsPath,
      lang: options.lang,
    });
    if (files.length === 0) {
      throw new Error(
        `No markdown files found${docsPath ? ` in ${docsPath}` : ""}. Use --path to specify or --lang all to include all languages.`,
      );
    }
    console.log(
      `✓ Found ${files.length} markdown files${options.lang ? ` (lang: ${options.lang})` : ""}`,
    );

    // Build the package
    ensureDataDir();
    const outputPath = join(
      DATA_DIR,
      getPackageFileName(packageName, versionLabel),
    );

    console.log(`Building package...`);
    const result = buildPackage(outputPath, files, {
      name: packageName,
      version: versionLabel,
      sourceUrl: url,
    });

    console.log(`✓ Built package: ${packageName}@${versionLabel}`);
    console.log(`✓ Saved to ${outputPath}`);

    // Save to custom path if specified
    if (options.save) {
      savePackageCopy(outputPath, options.save, packageName, versionLabel);
    }

    const sizeBytes = statSync(outputPath).size;

    console.log(
      `\nInstalled: ${packageName}@${versionLabel} (${formatBytes(sizeBytes)}, ${result.sectionCount} sections)`,
    );

    warnIfLowDocs(result.sectionCount, packageName);
  } finally {
    cleanup();
  }
}

/** Install a package from a local directory. */
async function addFromLocalDir(
  source: string,
  options: AddFromGitOptions,
): Promise<void> {
  const dirPath = resolve(source);
  const dirName = basename(dirPath);
  const packageName =
    options.name ?? dirName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  // Pass packageName to detectVersion for monorepo support (filters tags by package name)
  const versionLabel = options.version ?? detectVersion(dirPath, packageName);

  console.log(`Scanning ${dirPath}...`);

  // Detect or use provided docs path
  let docsPath: string | undefined = options.path;
  if (!docsPath) {
    const detected = detectLocalDocsFolder(dirPath);
    if (detected) {
      docsPath = detected;
    }
  }

  if (docsPath) {
    console.log(`✓ Found docs at /${docsPath}`);
  } else {
    console.log(`✓ Reading from directory root`);
  }

  // Read all markdown files (filtered by language)
  const files = readLocalDocsFiles(dirPath, {
    path: docsPath,
    lang: options.lang,
  });
  if (files.length === 0) {
    throw new Error(
      `No markdown files found${docsPath ? ` in ${docsPath}` : ""}. Use --path to specify or --lang all to include all languages.`,
    );
  }
  console.log(
    `✓ Found ${files.length} markdown files${options.lang ? ` (lang: ${options.lang})` : ""}`,
  );

  // Build the package
  ensureDataDir();
  const outputPath = join(
    DATA_DIR,
    getPackageFileName(packageName, versionLabel),
  );

  console.log(`Building package...`);
  const result = buildPackage(outputPath, files, {
    name: packageName,
    version: versionLabel,
    sourceUrl: dirPath,
  });

  console.log(`✓ Built package: ${packageName}@${versionLabel}`);
  console.log(`✓ Saved to ${outputPath}`);

  // Save to custom path if specified
  if (options.save) {
    savePackageCopy(outputPath, options.save, packageName, versionLabel);
  }

  const sizeBytes = statSync(outputPath).size;

  console.log(
    `\nInstalled: ${packageName}@${versionLabel} (${formatBytes(sizeBytes)}, ${result.sectionCount} sections)`,
  );

  warnIfLowDocs(result.sectionCount, packageName);
}

program
  .command("add")
  .description(
    "Install a documentation package from file, URL, GitHub, git repo, website (llms.txt), or local directory",
  )
  .argument(
    "<source>",
    "Package source: local .db file, URL (.db), GitHub URL, git URL, website URL (auto-fetches llms.txt), or local directory",
  )
  .option("--tag <tag>", "Git tag to checkout (for git repos)")
  .option("--pkg-version <version>", "Custom version label")
  .option("--path <path>", "Path to docs folder in repo/directory")
  .option("--name <name>", "Custom package name")
  .option("--save <path>", "Save a copy of the package to the specified path")
  .option(
    "--lang <code>",
    "Language filter: 'all' for all languages, or ISO code (e.g., 'en', 'de')",
  )
  .action(
    async (
      source: string,
      options: {
        tag?: string;
        pkgVersion?: string;
        path?: string;
        name?: string;
        save?: string;
        lang?: string;
      },
    ) => {
      try {
        const sourceType = detectSourceType(source);

        // Map pkgVersion to version for internal use
        const internalOptions = {
          ...options,
          version: options.pkgVersion,
        };

        switch (sourceType) {
          case "file":
            addFromFile(source, internalOptions);
            break;
          case "url":
            await addFromUrl(source, internalOptions);
            break;
          case "git":
            await addFromGitClone(source, internalOptions);
            break;
          case "local-dir":
            await addFromLocalDir(source, internalOptions);
            break;
          case "website":
            await addFromWebsite(source, internalOptions);
            break;
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    },
  );

program
  .command("list")
  .description("Show installed packages")
  .action(() => {
    const store = new PackageStore();
    loadPackages(store);
    const packages = store.list();

    if (packages.length === 0) {
      console.log("No packages installed.");
      console.log("Run: context add <package.db>");
      return;
    }

    console.log("Installed packages:\n");
    let totalSize = 0;
    for (const pkg of packages) {
      totalSize += pkg.sizeBytes;
      const name = `${pkg.name}@${pkg.version}`.padEnd(24);
      const size = formatBytes(pkg.sizeBytes).padStart(8);
      console.log(`  ${name} ${size}    ${pkg.sectionCount} sections`);
    }
    console.log(
      `\nTotal: ${packages.length} packages (${formatBytes(totalSize)})`,
    );
  });

program
  .command("remove")
  .description("Remove a documentation package")
  .argument("<name>", "Package name (e.g., 'next' or 'next@v16.2.0')")
  .action((name: string) => {
    const store = new PackageStore();
    loadPackages(store);

    // Strip version suffix if present (e.g., "next@v16.2.0" -> "next")
    const atIndex = name.indexOf("@");
    const packageName = atIndex > 0 ? name.slice(0, atIndex) : name;

    const pkg = store.get(packageName);
    if (!pkg) {
      console.error(`Error: Package not found: ${packageName}`);
      process.exit(1);
    }

    // Delete file from disk
    try {
      unlinkSync(pkg.path);
    } catch {
      // Ignore deletion errors
    }

    console.log(`Removed: ${pkg.name}@${pkg.version}`);
  });

program
  .command("serve")
  .description("Start the MCP server")
  .option(
    "--http [port]",
    "Start as HTTP server instead of stdio (default port: 8080)",
  )
  .option("--host <host>", "Host to bind to (default: 127.0.0.1)")
  .option(
    "--libs <names...>",
    "Restrict the session to a fixed set of installed libraries (e.g., react next@15). Hides search_packages and download_package.",
  )
  .action(
    async (options: {
      http?: string | true;
      host?: string;
      libs?: string[];
    }) => {
      const store = new PackageStore();
      loadPackages(store);

      const allowedLibraries = options.libs
        ? resolveAllowedLibraries(options.libs, store.list())
        : undefined;

      const visible = allowedLibraries
        ? store.list().filter((p) => allowedLibraries.has(p.name))
        : store.list();

      if (visible.length > 0) {
        const names = visible.map((p) => `${p.name}@${p.version}`).join(", ");
        console.error(`Context MCP Server starting...`);
        const prefix = allowedLibraries ? "Restricted to" : "Loaded";
        console.error(`${prefix} ${visible.length} packages: ${names}`);
      } else {
        console.error("Context MCP Server starting...");
        console.error("No packages installed. Run: context add <package.db>");
      }

      const server = new ContextServer(store, { allowedLibraries });

      if (options.http !== undefined) {
        const port =
          typeof options.http === "string"
            ? Number.parseInt(options.http, 10)
            : 8080;
        const host = options.host ?? "127.0.0.1";

        const { port: actualPort } = await server.startHTTP({ port, host });
        console.error(`Listening on http://${host}:${actualPort}/mcp`);
      } else {
        await server.start();
      }
    },
  );

function formatLibraryName(pkg: PackageInfo): string {
  return `${pkg.name}@${pkg.version}`;
}

function formatSearchResult(result: SearchResult): string {
  if (result.results.length === 0) {
    return JSON.stringify(
      {
        library: result.library,
        version: result.version,
        results: [],
        message: NO_DOCUMENTATION_FOUND_MESSAGE,
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      library: result.library,
      version: result.version,
      results: result.results,
    },
    null,
    2,
  );
}

program
  .command("query")
  .description("Query documentation from an installed package")
  .argument("<library>", "Package name with version (e.g., nextjs@15.0)")
  .argument("<topic>", GET_DOCS_TOPIC_DESCRIPTION)
  .action((library: string, topic: string) => {
    const store = new PackageStore();
    loadPackages(store);

    const packages = store.list();
    const pkg = packages.find((p) => formatLibraryName(p) === library);

    if (!pkg) {
      const available = packages.map(formatLibraryName);
      if (available.length === 0) {
        console.error("Error: No packages installed.");
        console.error("Run: context add <package.db>");
      } else {
        console.error(`Error: Package not found: ${library}`);
        const maxShow = 5;
        const shown = available.slice(0, maxShow);
        const remaining = available.length - maxShow;
        const suffix = remaining > 0 ? `, ... (+${remaining} more)` : "";
        console.error(`Available packages: ${shown.join(", ")}${suffix}`);
      }
      process.exit(1);
    }

    const db = store.openDb(pkg.name);
    if (!db) {
      console.error(`Error: Failed to open package database: ${library}`);
      process.exit(1);
    }

    try {
      const result = search(db, topic);
      console.log(formatSearchResult(result));
    } finally {
      db.close();
    }
  });

/**
 * Parse a "registry/name[@version]" string (e.g., "npm/next",
 * "pip/django", "npm/next@16.1.7", "npm/@trpc/server@10.0.0").
 * Returns { registry, name, version? } or null if the format is invalid.
 */
export function parseRegistryPackage(input: string): {
  registry: string;
  name: string;
  version?: string;
} | null {
  // Handle scoped packages: npm/@scope/name → registry=npm, name=@scope/name
  const firstSlash = input.indexOf("/");
  if (firstSlash <= 0) return null;

  const registry = input.slice(0, firstSlash);
  let name = input.slice(firstSlash + 1);
  if (!name) return null;

  // Split off an optional trailing "@version". Use lastIndexOf so scoped
  // package names like "@trpc/server" aren't mistaken for a version marker.
  let version: string | undefined;
  const atIdx = name.lastIndexOf("@");
  if (atIdx > 0) {
    const v = name.slice(atIdx + 1);
    if (v) version = v;
    name = name.slice(0, atIdx);
  }
  if (!name) return null;

  return version ? { registry, name, version } : { registry, name };
}

program
  .command("browse")
  .description("Search for packages available on the registry server")
  .argument(
    "<package>",
    `${SEARCH_PACKAGES_NAME_DESCRIPTION} or registry/name (e.g., "npm/next")`,
  )
  .option(
    "--server <name>",
    "Server name from config (uses default if omitted)",
  )
  .action(async (pkg: string, options: { server?: string }) => {
    try {
      const serverUrl = getServerUrl(options.server);

      // Parse "registry/name[@version]" or treat as name-only search.
      // The version suffix (if any) is ignored — browse always lists all
      // available versions for the package.
      const parsed = parseRegistryPackage(pkg);
      const registry = parsed?.registry ?? "npm";
      const name = parsed?.name ?? pkg;

      const results = await searchPackages(serverUrl, registry, name);

      if (results.length === 0) {
        console.log(`No packages found for "${pkg}".`);
        return;
      }

      console.log();
      for (const entry of results) {
        const id = `${entry.registry}/${entry.name}@${entry.version}`;
        const size = entry.size ? formatBytes(entry.size).padStart(8) : "";
        const desc = entry.description ? `  ${entry.description}` : "";
        console.log(`  ${id.padEnd(32)} ${size}${desc}`);
      }
      console.log(
        `\nFound ${results.length} version${results.length === 1 ? "" : "s"}. Install with: context install ${registry}/${name}`,
      );
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program
  .command("install")
  .description("Download and install a package from the registry server")
  .argument("<package>", 'Package to install (e.g., "npm/next")')
  .argument("[version]", "Specific version (installs latest if omitted)")
  .option(
    "--server <name>",
    "Server name from config (uses default if omitted)",
  )
  .action(
    async (
      pkg: string,
      versionArg: string | undefined,
      options: { server?: string },
    ) => {
      try {
        const parsed = parseRegistryPackage(pkg);
        if (!parsed) {
          console.error(
            `Error: Invalid package format "${pkg}". Use registry/name (e.g., npm/next, pip/django).`,
          );
          process.exit(1);
        }

        if (parsed.version && versionArg && parsed.version !== versionArg) {
          console.error(
            `Error: Conflicting versions: "${parsed.version}" in "${pkg}" and "${versionArg}" as separate argument.`,
          );
          process.exit(1);
        }

        const serverUrl = getServerUrl(options.server);
        let targetVersion = versionArg ?? parsed.version;

        // If no version specified, find the latest
        if (!targetVersion) {
          const results = await searchPackages(
            serverUrl,
            parsed.registry,
            parsed.name,
          );

          const latest = results[0];
          if (!latest) {
            console.error(
              `Error: No packages found for "${pkg}" on the server.`,
            );
            process.exit(1);
          }

          targetVersion = latest.version;
        }

        console.log(
          `Installing ${parsed.registry}/${parsed.name}@${targetVersion}...`,
        );
        const info = await downloadPackage(
          serverUrl,
          parsed.registry,
          parsed.name,
          targetVersion,
        );

        console.log(
          `\nInstalled: ${info.name}@${info.version} (${formatBytes(info.sizeBytes)}, ${info.sectionCount} sections)`,
        );
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    },
  );

program
  .command("auth")
  .description("Manage per-platform authentication (cookies, headers)")
  .addCommand(
    new Command("add")
      .description("Add or update auth for a domain")
      .argument(
        "<domain>",
        "Domain to authenticate (e.g., medium.com, substack.com)",
      )
      .option("--cookies <cookies>", "Cookie string (e.g., 'uid=abc; sid=def')")
      .option(
        "--header <header>",
        "Additional header in 'Key: Value' format (repeatable)",
        collectHeaders,
        {},
      )
      .action(
        (
          domain: string,
          options: { cookies?: string; header: Record<string, string> },
        ) => {
          const auth = loadAuth();
          auth[domain] = {
            cookies: options.cookies,
            headers:
              Object.keys(options.header).length > 0
                ? options.header
                : undefined,
          };
          saveAuth(auth);
          console.log(`✓ Auth saved for ${domain}`);
        },
      ),
  )
  .addCommand(
    new Command("list")
      .description("List configured platform auth entries")
      .action(() => {
        const auth = loadAuth();
        const domains = Object.keys(auth);
        if (domains.length === 0) {
          console.log("No platform auth configured.");
          console.log("Run: context auth add <domain> --cookies <cookies>");
          return;
        }
        console.log("Configured platform auth:\n");
        for (const domain of domains.sort()) {
          const entry = auth[domain];
          if (!entry) continue;
          const hasCookies = entry.cookies ? "yes" : "no";
          const headerCount = entry.headers
            ? Object.keys(entry.headers).length
            : 0;
          console.log(
            `  ${domain.padEnd(24)} cookies: ${hasCookies}  headers: ${headerCount}`,
          );
        }
      }),
  )
  .addCommand(
    new Command("remove")
      .description("Remove auth for a domain")
      .argument("<domain>", "Domain to remove auth for")
      .action((domain: string) => {
        const auth = loadAuth();
        if (!auth[domain]) {
          console.error(`Error: No auth found for ${domain}`);
          process.exit(1);
        }
        delete auth[domain];
        saveAuth(auth);
        console.log(`✓ Removed auth for ${domain}`);
      }),
  );

/** Collect repeated --header options into a Record. */
function collectHeaders(
  value: string,
  previous: Record<string, string>,
): Record<string, string> {
  const sep = value.indexOf(":");
  if (sep <= 0) {
    throw new Error(`Invalid header format: "${value}". Use "Key: Value".`);
  }
  const key = value.slice(0, sep).trim();
  const val = value.slice(sep + 1).trim();
  previous[key] = val;
  return previous;
}

// Only parse when run directly (not when imported for testing)
const isRunDirectly =
  process.argv[1]?.endsWith("cli.js") ||
  process.argv[1]?.endsWith("context") ||
  process.argv[1]?.includes("bin/context");

if (isRunDirectly) {
  await initDatabase();
  program.parse();
}
