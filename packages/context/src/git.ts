/**
 * Git operations for cloning repositories.
 */

// TODO: Future enhancements:
// - Auto-detect documentation site from README (parse for docs.* or documentation links)
// - Suggest specific versions when repo has tags (e.g., "context add react --version 18.2.0")

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ignore, { type Ignore } from "ignore";

/**
 * Generate a content hash for deduplication.
 * Uses first 16 chars of MD5 (sufficient for detecting identical content).
 */
function contentHash(content: string): string {
  return createHash("md5").update(content).digest("hex").slice(0, 16);
}

/**
 * ISO 639-1 language codes (2-letter) commonly used in docs.
 * Used to detect and filter locale directories.
 */
const LOCALE_CODES = new Set([
  "ar",
  "bg",
  "bn",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "fa",
  "fi",
  "fr",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lt",
  "lv",
  "ms",
  "nl",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sr",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh",
  "zh-cn",
  "zh-tw",
  "zh-hans",
  "zh-hant",
  "pt-br",
  "es-la",
]);

/**
 * Check if a directory name looks like a locale code.
 */
function isLocaleDir(name: string): boolean {
  return LOCALE_CODES.has(name.toLowerCase());
}

/**
 * Files to ignore during markdown indexing.
 * These are common repo files that aren't useful documentation.
 */
const IGNORED_FILES = new Set([
  "code_of_conduct",
  "contributing",
  "changelog",
  "history",
  "license",
  "security",
  "pull_request_template",
  "issue_template",
  "claude", // AI assistant configuration
]);

/**
 * Test fixture suffixes to ignore.
 */
const FIXTURE_SUFFIXES = ["expect", "test", "spec"];

/**
 * Documentation file extensions to include in search.
 */
const DOCUMENTATION_EXTENSIONS = [".md", ".mdx", ".qmd", ".rmd"];

/**
 * Directories to ignore during markdown indexing.
 * Includes test directories, internal docs, and other non-user-facing content.
 */
const IGNORED_DIRS = new Set([
  // Test directories
  "__tests__",
  "__test__",
  "test",
  "tests",
  "spec",
  "specs",
  "fixtures",
  "__fixtures__",
  "__mocks__",
  // Internal/development directories
  "internal",
  "dev",
  "plans",
  ".plans",
  // Build/generated directories
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  // Other non-doc directories
  "examples", // Often contains code samples, not docs
  "benchmarks",
  "benchmark",
]);

export interface GitCloneResult {
  tempDir: string;
  cleanup: () => void;
}

export interface LocalDocsResult {
  files: Array<{ path: string; content: string }>;
  repoName: string;
}

/**
 * Check if a string is a git URL (supports various git protocols).
 * Matches: https://, git://, ssh://, git@host:, or .git suffix
 * Excludes: URLs with paths beyond repo root (releases, blob, actions, etc.)
 */
export function isGitUrl(source: string): boolean {
  // https://... or http://... ending with .git
  if (/^https?:\/\/.*\.git$/i.test(source)) return true;
  // git://...
  if (source.startsWith("git://")) return true;
  // ssh://...
  if (source.startsWith("ssh://")) return true;
  // git@host:user/repo format (SSH shorthand)
  if (/^git@[\w.-]+:[\w./-]+$/.test(source)) return true;

  // Known git hosting providers - only match repo root or /tree/ paths
  // Exclude: /releases/, /blob/, /raw/, /actions/, /issues/, /pull/, etc.
  const gitHostMatch = source.match(
    /^https?:\/\/(github|gitlab|bitbucket|codeberg)\.[^/]+\/[\w.-]+\/[\w.-]+(\/tree\/.*)?$/,
  );
  if (gitHostMatch) return true;

  return false;
}

/**
 * Clone a git repository to a temporary directory.
 */
export function cloneRepository(url: string, ref?: string): GitCloneResult {
  const tempDir = mkdtempSync(join(tmpdir(), "context-git-"));

  try {
    // Clone with depth 1 for efficiency (shallow clone)
    const cloneArgs = ["clone", "--depth", "1"];
    if (ref) {
      cloneArgs.push("--branch", ref);
    }
    cloneArgs.push(url, tempDir);

    execSync(`git ${cloneArgs.join(" ")}`, {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });
  } catch (error) {
    // Clean up on failure
    rmSync(tempDir, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git clone failed: ${message}`);
  }

  return {
    tempDir,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

/**
 * Extract repository name from a git URL.
 * Handles common docs repo patterns:
 * - org.github.io → org
 * - expressjs.com → express
 * - project-docs → project
 */
export function extractRepoName(url: string): string {
  // Remove .git suffix if present
  let cleaned = url.replace(/\.git$/, "");

  // Handle SSH shorthand (git@host:user/repo)
  if (cleaned.includes("@") && cleaned.includes(":")) {
    cleaned = cleaned.split(":").pop() ?? cleaned;
  }

  // Get the last path segment (repo name) and org/user
  const segments = cleaned.split("/").filter(Boolean);
  let name = segments.pop() ?? "unknown";
  const org = segments.pop();

  // Handle *.github.io patterns → use org name instead
  if (name.endsWith(".github.io") && org) {
    name = org;
  }
  // Handle domain-style repos (e.g., expressjs.com) → strip TLD and "js" suffix
  else if (/\.(com|org|io|dev|net|site|app)$/i.test(name)) {
    name = name
      .replace(/\.(com|org|io|dev|net|site|app)$/i, "")
      .replace(/js$/i, ""); // expressjs → express (only for domain repos)
  }

  return (
    name
      .toLowerCase()
      .replace(/\.js$/, "") // express.js → express
      .replace(/-docs?$/, "")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "unknown"
  );
}

/**
 * Parse git URL to extract optional ref from URL path.
 * Supports: https://github.com/owner/repo/tree/branch
 */
export function parseGitUrl(url: string): { url: string; ref?: string } {
  // Handle GitHub/GitLab tree paths
  const treeMatch = url.match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/tree\/(.+)$/);
  if (treeMatch?.[1] && treeMatch[2]) {
    return { url: treeMatch[1], ref: treeMatch[2] };
  }
  return { url };
}

const DOCS_FOLDER_CANDIDATES = ["docs", "documentation", "doc"];

/**
 * Detect docs folder in a local directory.
 */
export function detectLocalDocsFolder(dirPath: string): string | null {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name.toLowerCase());

    for (const candidate of DOCS_FOLDER_CANDIDATES) {
      if (dirs.includes(candidate)) {
        // Return actual case-sensitive name
        const actual = entries.find(
          (e) => e.isDirectory() && e.name.toLowerCase() === candidate,
        );
        return actual?.name ?? null;
      }
    }
  } catch {
    // Directory read failed
  }
  return null;
}

/**
 * Load .gitignore from a directory if it exists.
 */
function loadGitignore(basePath: string): Ignore {
  const ig = ignore();

  const gitignorePath = join(basePath, ".gitignore");
  if (existsSync(gitignorePath)) {
    try {
      const content = readFileSync(gitignorePath, "utf-8");
      ig.add(content);
    } catch {
      // Ignore read errors
    }
  }

  return ig;
}

export interface FindMarkdownOptions {
  /** Language filter: "all" includes everything, specific code (e.g., "en") includes only that locale */
  lang?: string;
}

/**
 * Recursively find all markdown files in a directory.
 * Respects .gitignore rules and skips non-doc files like CODE_OF_CONDUCT.
 * By default, filters out non-English locale directories.
 */
function findMarkdownFiles(
  dirPath: string,
  ig: Ignore,
  basePath = "",
  options: FindMarkdownOptions = {},
): string[] {
  const files: string[] = [];
  const lang = options.lang?.toLowerCase();

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relativePath = basePath ? join(basePath, entry.name) : entry.name;

      // Skip hidden entries
      if (entry.name.startsWith(".")) continue;

      // Check gitignore (directories need trailing slash for gitignore matching)
      const pathToCheck = entry.isDirectory()
        ? `${relativePath}/`
        : relativePath;
      if (ig.ignores(pathToCheck)) continue;

      if (entry.isDirectory()) {
        // Skip test, internal, and other non-doc directories
        if (IGNORED_DIRS.has(entry.name.toLowerCase())) {
          continue;
        }

        // Filter locale directories unless --lang all or specific lang matches
        if (isLocaleDir(entry.name)) {
          const dirName = entry.name.toLowerCase();
          // Include if: all languages, matching lang, or default to English
          if (
            lang === "all" ||
            lang === dirName ||
            (!lang && dirName === "en")
          ) {
            files.push(
              ...findMarkdownFiles(fullPath, ig, relativePath, options),
            );
          }
          // Skip other locales by default
        } else {
          files.push(...findMarkdownFiles(fullPath, ig, relativePath, options));
        }
      } else if (entry.isFile()) {
        const lowerName = entry.name.toLowerCase();
        const hasDocumentationExtension = DOCUMENTATION_EXTENSIONS.some((ext) =>
          lowerName.endsWith(ext),
        );

        if (hasDocumentationExtension) {
          // Skip non-doc markdown files
          // Find matching extension to remove it for checking ignored files
          const matchingExt = DOCUMENTATION_EXTENSIONS.find((ext) =>
            lowerName.endsWith(ext),
          );
          if (matchingExt) {
            const baseName = lowerName.slice(0, -matchingExt.length);
            if (IGNORED_FILES.has(baseName)) continue;
          }
          // Skip test fixture files (e.g., component.expect.md, hook.test.md)
          if (matchingExt) {
            const nameWithoutExt = lowerName.slice(0, -matchingExt.length);
            const nameParts = nameWithoutExt.split(".");
            if (nameParts.length > 1) {
              const lastPart = nameParts[nameParts.length - 1] || '';
              if (FIXTURE_SUFFIXES.includes(lastPart)) {
                continue;
              }
            }
          }
          files.push(relativePath);
        }
      }
    }
  } catch {
    // Directory read failed
  }

  return files;
}

export interface ReadLocalDocsOptions {
  /** Path to docs folder within the repository */
  path?: string;
  /** Language filter: "all" includes everything, specific code (e.g., "en") includes only that locale */
  lang?: string;
}

/**
 * Read all markdown files from a local directory.
 * Respects .gitignore from the base path (repo root).
 * By default, filters out non-English locale directories.
 * Deduplicates files by content hash (keeps first occurrence).
 */
export function readLocalDocsFiles(
  basePath: string,
  options: ReadLocalDocsOptions = {},
): Array<{ path: string; content: string }> {
  const { path: docsPath, lang } = options;
  const searchPath = docsPath ? join(basePath, docsPath) : basePath;

  if (!existsSync(searchPath)) {
    throw new Error(`Directory not found: ${searchPath}`);
  }

  // Load gitignore from repo root
  const ig = loadGitignore(basePath);

  const markdownFiles = findMarkdownFiles(searchPath, ig, "", { lang });
  const files: Array<{ path: string; content: string }> = [];
  const seenHashes = new Set<string>();

  for (const filePath of markdownFiles) {
    try {
      const fullPath = join(searchPath, filePath);
      const content = readFileSync(fullPath, "utf-8");

      // Skip duplicate content (keep first occurrence)
      const hash = contentHash(content);
      if (seenHashes.has(hash)) {
        continue;
      }
      seenHashes.add(hash);

      // Use relative path from docs folder for storage
      const storagePath = docsPath ? join(docsPath, filePath) : filePath;
      files.push({ path: storagePath, content });
    } catch {
      // Skip files that can't be read
    }
  }

  return files;
}

/**
 * Extract version from ref or return 'latest'.
 */
export function extractVersion(ref?: string): string {
  if (!ref) return "latest";
  return ref.startsWith("v") ? ref.slice(1) : ref;
}

/**
 * Parsed semantic version for comparison.
 */
interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  original: string;
}

/**
 * Parse a monorepo-style tag into package name and version.
 * Handles formats:
 * - "package@1.2.3" -> { packageName: "package", version: "1.2.3" }
 * - "@scope/package@1.2.3" -> { packageName: "@scope/package", version: "1.2.3" }
 * - "v1.2.3" or "1.2.3" -> { packageName: null, version: "1.2.3" }
 */
export function parseMonorepoTag(tag: string): {
  packageName: string | null;
  version: string;
} {
  // Handle scoped packages: @scope/package@version
  const scopedMatch = tag.match(/^(@[^@]+\/[^@]+)@(.+)$/);
  if (scopedMatch) {
    return {
      packageName: scopedMatch[1] as string,
      version: scopedMatch[2] as string,
    };
  }

  // Handle unscoped packages: package@version (but not @scope/... which is handled above)
  const unscopedMatch = tag.match(/^([^@]+)@(.+)$/);
  if (unscopedMatch) {
    return {
      packageName: unscopedMatch[1] as string,
      version: unscopedMatch[2] as string,
    };
  }

  // Plain version tag (v1.2.3 or 1.2.3)
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  return { packageName: null, version };
}

/**
 * Parse a version string into components.
 * Returns null if the string is not a valid semver-like version.
 */
function parseVersion(tag: string): ParsedVersion | null {
  // Extract version from monorepo-style tags (e.g., "ai@6.0.68" -> "6.0.68")
  const { version } = parseMonorepoTag(tag);

  // Match semver pattern: major.minor.patch[-prerelease]
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) return null;

  // Groups 1-3 are guaranteed to exist when regex matches (required groups)
  // Group 4 (prerelease) is optional
  return {
    major: Number.parseInt(match[1] as string, 10),
    minor: Number.parseInt(match[2] as string, 10),
    patch: Number.parseInt(match[3] as string, 10),
    prerelease: match[4] ?? null,
    original: tag,
  };
}

/**
 * Check if a version is a prerelease.
 * Detects common prerelease patterns: canary, alpha, beta, rc, next, dev, etc.
 */
function isPrerelease(version: ParsedVersion): boolean {
  return version.prerelease !== null;
}

/**
 * Compare two parsed versions.
 * Returns positive if a > b, negative if a < b, 0 if equal.
 */
function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Filter tags by package name for monorepo support.
 * - If packageName is provided, only return tags matching that package
 * - If no package-specific tags found, fall back to plain version tags
 * - If packageName is not provided, return all tags
 */
function filterTagsByPackage(tags: string[], packageName?: string): string[] {
  if (!packageName) {
    return tags;
  }

  // Normalize package name for comparison (handle both "ai" and "@ai-sdk/gateway" styles)
  const normalizedName = packageName.toLowerCase();

  // Filter tags that match the package name
  const matchingTags = tags.filter((tag) => {
    const parsed = parseMonorepoTag(tag);
    if (parsed.packageName === null) {
      return false; // Plain version tags don't match specific packages
    }
    return parsed.packageName.toLowerCase() === normalizedName;
  });

  // If we found package-specific tags, use those
  if (matchingTags.length > 0) {
    return matchingTags;
  }

  // Fall back to plain version tags (for non-monorepo repos)
  return tags.filter((tag) => parseMonorepoTag(tag).packageName === null);
}

/**
 * Find the latest stable version from a list of git tags.
 * Filters out prereleases and returns the highest semver version.
 * If packageName is provided, filters tags to only those matching the package.
 */
export function findLatestStableVersion(
  tags: string[],
  packageName?: string,
): string | null {
  const filteredTags = filterTagsByPackage(tags, packageName);
  const versions = filteredTags
    .map(parseVersion)
    .filter((v): v is ParsedVersion => v !== null)
    .filter((v) => !isPrerelease(v));

  if (versions.length === 0) return null;

  // Sort descending by version
  versions.sort((a, b) => compareVersions(b, a));

  const latest = versions[0];
  return latest ? latest.original : null;
}

/**
 * Detect version from a directory by checking:
 * 1. All git tags - finds highest stable (non-prerelease) version by semver
 * 2. Falls back to 'latest'
 *
 * When a stable version is found, checks out to that tag so the code matches.
 * Handles shallow clones by fetching tags and the specific tag's commit.
 *
 * @param dirPath - Path to the git repository
 * @param packageName - Optional package name for monorepo support (e.g., "ai" or "@ai-sdk/gateway")
 */
export function detectVersion(dirPath: string, packageName?: string): string {
  try {
    // Fetch all tags (needed for shallow clones)
    execSync("git fetch --tags --quiet 2>/dev/null", {
      cwd: dirPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    // List all tags
    const tagsOutput = execSync("git tag -l 2>/dev/null", {
      cwd: dirPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (tagsOutput) {
      const tags = tagsOutput.split("\n").filter(Boolean);
      const latestStable = findLatestStableVersion(tags, packageName);
      if (latestStable) {
        // Fetch and checkout to the detected tag so code matches the version
        try {
          // Fetch the specific tag (for shallow clones that don't have the commit)
          execSync(
            `git fetch --depth=1 origin tag ${latestStable} --no-tags 2>/dev/null`,
            {
              cwd: dirPath,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          // Checkout to the tag
          execSync(`git checkout ${latestStable} 2>/dev/null`, {
            cwd: dirPath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch {
          // Checkout failed, continue with current HEAD
        }

        // Extract version from monorepo-style tags (e.g., "ai@6.0.68" -> "6.0.68")
        const { version } = parseMonorepoTag(latestStable);
        return version;
      }
    }
  } catch {
    // Not a git repo or no tags
  }

  return "latest";
}

/**
 * Tag information with metadata for sorting and display.
 */
export interface TagInfo {
  /** The full tag name (e.g., "ai@6.0.68" or "v1.2.3") */
  name: string;
  /** Parsed package name from tag, or null for plain version tags */
  packageName: string | null;
  /** Parsed version string */
  version: string;
  /** Whether this is a prerelease version */
  isPrerelease: boolean;
  /** Tag creation timestamp (Unix seconds) */
  timestamp: number;
}

/**
 * Get the default branch name (main or master).
 */
export function getDefaultBranch(dirPath: string): string {
  try {
    // Try to get the default branch from remote HEAD
    const result = execSync(
      "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null",
      {
        cwd: dirPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
    // Extract branch name from "refs/remotes/origin/main"
    const match = result.match(/refs\/remotes\/origin\/(.+)$/);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Fallback: check if main or master exists
  }

  try {
    execSync("git show-ref --verify --quiet refs/heads/main", {
      cwd: dirPath,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return "main";
  } catch {
    // main doesn't exist
  }

  return "master";
}

/**
 * Fetch git tags with metadata (creation date, prerelease status).
 * Returns up to `limit` tags sorted by creation date (most recent first).
 */
export function fetchTagsWithMetadata(dirPath: string, limit = 100): TagInfo[] {
  try {
    // Fetch all tags (needed for shallow clones)
    execSync("git fetch --tags --quiet 2>/dev/null", {
      cwd: dirPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Get tags with creation date, sorted by date descending
    // Format: timestamp<tab>tagname
    const output = execSync(
      `git tag -l --sort=-creatordate --format='%(creatordate:unix)\t%(refname:short)' 2>/dev/null | head -n ${limit}`,
      {
        cwd: dirPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();

    if (!output) {
      return [];
    }

    const tags: TagInfo[] = [];

    for (const line of output.split("\n")) {
      const [timestampStr, tagName] = line.split("\t");
      if (!tagName || !timestampStr) continue;

      const timestamp = Number.parseInt(timestampStr, 10);
      const { packageName, version } = parseMonorepoTag(tagName);

      // Check if it's a prerelease by parsing and checking
      const parsed = parseVersion(tagName);
      const isPre = parsed ? isPrerelease(parsed) : false;

      tags.push({
        name: tagName,
        packageName,
        version,
        isPrerelease: isPre,
        timestamp,
      });
    }

    return tags;
  } catch {
    return [];
  }
}

/**
 * Sort tags for interactive selection:
 * 1. Stable versions first, sorted by timestamp (most recent first)
 * 2. Prereleases after, sorted by timestamp (most recent first)
 */
export function sortTagsForSelection(tags: TagInfo[]): TagInfo[] {
  const stable = tags.filter((t) => !t.isPrerelease);
  const prerelease = tags.filter((t) => t.isPrerelease);

  // Both are already sorted by timestamp from git, but let's ensure it
  stable.sort((a, b) => b.timestamp - a.timestamp);
  prerelease.sort((a, b) => b.timestamp - a.timestamp);

  return [...stable, ...prerelease];
}

/**
 * Checkout a specific git ref (tag or branch).
 */
export function checkoutRef(dirPath: string, ref: string): void {
  try {
    // Fetch the specific ref (for shallow clones)
    execSync(`git fetch --depth=1 origin tag ${ref} --no-tags 2>/dev/null`, {
      cwd: dirPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Tag fetch failed, try as branch
    try {
      execSync(`git fetch --depth=1 origin ${ref} 2>/dev/null`, {
        cwd: dirPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Fetch failed, continue anyway
    }
  }

  execSync(`git checkout ${ref} 2>/dev/null`, {
    cwd: dirPath,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}
