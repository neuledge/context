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
  "code_of_conduct.md",
  "contributing.md",
  "changelog.md",
  "history.md",
  "license.md",
  "security.md",
  "pull_request_template.md",
  "issue_template.md",
  "claude.md", // AI assistant configuration
]);

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
        if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) {
          const lowerName = entry.name.toLowerCase();
          // Skip non-doc markdown files
          if (IGNORED_FILES.has(lowerName)) continue;
          // Skip test fixture files (e.g., component.expect.md, hook.test.md)
          if (
            lowerName.endsWith(".expect.md") ||
            lowerName.endsWith(".test.md") ||
            lowerName.endsWith(".spec.md")
          ) {
            continue;
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
  docsPath?: string;
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
  const { docsPath, lang } = options;
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
 * Parse a version string into components.
 * Returns null if the string is not a valid semver-like version.
 */
function parseVersion(tag: string): ParsedVersion | null {
  // Remove 'v' prefix if present
  const version = tag.startsWith("v") ? tag.slice(1) : tag;

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
 * Find the latest stable version from a list of git tags.
 * Filters out prereleases and returns the highest semver version.
 */
function findLatestStableVersion(tags: string[]): string | null {
  const versions = tags
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
 */
export function detectVersion(dirPath: string): string {
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
      const latestStable = findLatestStableVersion(tags);
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

        return latestStable.startsWith("v")
          ? latestStable.slice(1)
          : latestStable;
      }
    }
  } catch {
    // Not a git repo or no tags
  }

  return "latest";
}
