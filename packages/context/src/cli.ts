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
import { buildPackage } from "./package-builder.js";
import { type SearchResult, search } from "./search.js";
import { ContextServer } from "./server.js";
import { type PackageInfo, PackageStore, readPackageInfo } from "./store.js";

// TODO: Package ecosystem enhancements:
// - Package registry: GitHub-based registry for discovering community packages
// - Version management: Track multiple versions, update notifications
// - Package generation CLI: Dedicated `context build` command for creating packages

type SourceType = "file" | "url" | "git" | "local-dir";

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

  // URL: starts with http:// or https:// (for downloading .db files)
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return "url";
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
    destPath = join(resolvedSavePath, `${packageName}@${version}.db`);
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
    destPath = join(resolvedSavePath, `${packageName}@${version}.db`);
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
  const destName = `${info.name}@${info.version}.db`;
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
    const destName = `${info.name}@${info.version}.db`;
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

  console.log(`Cloning ${url}...`);

  // Clone without checking out a specific ref initially (we'll do it after tag selection)
  const { tempDir, cleanup } = cloneRepository(url);

  try {
    // Determine which tag/ref to use
    let selectedTag: string | null = null;

    if (options.tag) {
      // Explicit --tag provided
      selectedTag = options.tag;
    } else if (urlRef) {
      // Ref was part of the URL (e.g., github.com/user/repo#v1.0.0)
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

    // Checkout the selected tag if specified
    if (selectedTag) {
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
    const outputPath = join(DATA_DIR, `${packageName}@${versionLabel}.db`);

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
  const outputPath = join(DATA_DIR, `${packageName}@${versionLabel}.db`);

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
    "Install a documentation package from file, URL, GitHub, git repo, or local directory",
  )
  .argument(
    "<source>",
    "Package source: local .db file, URL (.db), GitHub URL, git URL, or local directory",
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
  .action(async () => {
    const store = new PackageStore();
    loadPackages(store);

    const packages = store.list();
    if (packages.length > 0) {
      const names = packages.map((p) => `${p.name}@${p.version}`).join(", ");
      console.error(`Context MCP Server starting...`);
      console.error(`Loaded ${packages.length} packages: ${names}`);
    } else {
      console.error("Context MCP Server starting...");
      console.error("No packages installed. Run: context add <package.db>");
    }

    const server = new ContextServer(store);
    await server.start();
  });

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
        message: "No documentation found. Try different keywords.",
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
  .argument("<topic>", "Search query (e.g., 'middleware authentication')")
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

// Only parse when run directly (not when imported for testing)
const isRunDirectly =
  process.argv[1]?.endsWith("cli.js") ||
  process.argv[1]?.endsWith("context") ||
  process.argv[1]?.includes("bin/context");

if (isRunDirectly) {
  program.parse();
}
