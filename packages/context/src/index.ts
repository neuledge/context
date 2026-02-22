// Public API

// Build utilities
export { type DocSection, type ParsedDoc, parseMarkdown } from "./build.js";
// Config
export {
  addServer,
  getDefaultServer,
  getServers,
  removeServer,
  type ServerConfig,
} from "./config.js";
// Download
export {
  type DownloadOptions,
  downloadPackage,
  type RemotePackage,
  type SearchOptions,
  searchPackages,
} from "./download.js";
// Git utilities
export {
  cloneRepository,
  detectLocalDocsFolder,
  extractRepoName,
  extractVersion,
  type GitCloneResult,
  isGitUrl,
  type LocalDocsResult,
  parseGitUrl,
  readLocalDocsFiles,
} from "./git.js";
export {
  type BuildResult,
  buildPackage,
  type MarkdownFile,
  type PackageBuildOptions,
} from "./package-builder.js";
// Types
export type { DocSnippet, SearchResult } from "./search.js";
export { ContextServer } from "./server.js";
export {
  type PackageInfo,
  type PackageMeta,
  PackageStore,
  readPackageInfo,
} from "./store.js";
