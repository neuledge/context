#!/usr/bin/env node

/**
 * Test registry definitions by running the actual build process.
 *
 * - `test <name> [version]`: Build a doc package for one definition
 * - `report`: Build all definitions and generate a pass/fail report
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  buildFromDefinition,
  buildUnversioned,
  type RegistryBuildResult,
} from "./build.js";
import {
  compareSemver,
  isVersioned,
  listDefinitions,
  type PackageDefinition,
  type VersionEntry,
} from "./definition.js";
import { discoverVersions } from "./version-check.js";

const DEFAULT_REGISTRY_DIR = resolve(
  import.meta.dirname,
  "../../..",
  "registry",
);

const program = new Command()
  .name("test-registry")
  .description("Test registry definitions by building doc packages");

program
  .command("test <name> [version]")
  .description("Build a doc package for a specific definition")
  .option("--dir <path>", "Registry directory", DEFAULT_REGISTRY_DIR)
  .option("--output <path>", "Output directory", "./dist-test")
  .action(
    async (
      name: string,
      version: string | undefined,
      opts: { dir: string; output: string },
    ) => {
      const definitions = listDefinitions(opts.dir);
      const def = definitions.find((d) => d.name === name);
      if (!def) {
        const available = definitions.map((d) => d.name).join(", ");
        console.error(
          `Definition "${name}" not found. Available: ${available}`,
        );
        process.exit(1);
      }

      const result = await buildDefinition(def, opts.output, version);
      console.log(`  Path:     ${result.path}`);
      console.log(`  Sections: ${result.sectionCount}`);
      console.log(`  Tokens:   ${result.totalTokens}`);
      rmSync(result.path, { force: true });
    },
  );

program
  .command("report")
  .description("Build all definitions and generate a report")
  .option("--dir <path>", "Registry directory", DEFAULT_REGISTRY_DIR)
  .option("--output <path>", "Output directory", "./dist-test")
  .action(async (opts: { dir: string; output: string }) => {
    let definitions: PackageDefinition[];
    try {
      definitions = listDefinitions(opts.dir);
    } catch (err) {
      console.error(
        "Failed to load definitions:",
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    }

    console.log(`Found ${definitions.length} definitions.\n`);

    const results: Array<{
      name: string;
      registry: string;
      status: "pass" | "fail";
      sections?: number;
      tokens?: number;
      version?: string;
      error?: string;
    }> = [];

    for (const def of definitions) {
      const label = `${def.registry}/${def.name}`;
      try {
        const result = await buildDefinition(def, opts.output);
        results.push({
          name: def.name,
          registry: def.registry,
          status: "pass",
          sections: result.sectionCount,
          tokens: result.totalTokens,
          version: result.version,
        });
        console.log(
          `[PASS] ${label}@${result.version}: ${result.sectionCount} sections, ${result.totalTokens} tokens`,
        );
        rmSync(result.path, { force: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          name: def.name,
          registry: def.registry,
          status: "fail",
          error: message,
        });
        console.log(`[FAIL] ${label}: ${message}`);
      }
    }

    const passed = results.filter((r) => r.status === "pass").length;
    const failed = results.filter((r) => r.status === "fail").length;

    console.log(`\n${"=".repeat(60)}`);
    console.log(
      `Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`,
    );

    if (failed > 0) {
      console.log("\nFailed:");
      for (const r of results.filter((r) => r.status === "fail")) {
        console.log(`  ${r.registry}/${r.name}: ${r.error}`);
      }
      process.exit(1);
    }
  });

/**
 * Build a definition, auto-discovering the version for versioned packages.
 * Tries npm/pip API first, falls back to scanning git tags.
 */
async function buildDefinition(
  def: PackageDefinition,
  outputDir: string,
  requestedVersion?: string,
): Promise<RegistryBuildResult> {
  mkdirSync(outputDir, { recursive: true });

  if (!isVersioned(def)) {
    console.log(`Building ${def.registry}/${def.name}@latest...`);
    return buildUnversioned(def, outputDir);
  }

  let version = requestedVersion;
  if (!version) {
    // Try registry API first (npm/pip)
    try {
      const versions = await discoverVersions(def);
      if (versions.length > 0) {
        version = versions[0]?.version;
      }
    } catch {
      // API unavailable, fall through to git tags
    }

    // Fall back to scanning git tags
    if (!version) {
      version = findLatestVersionFromGit(def.versions);
    }

    if (!version) {
      throw new Error("No matching version found (checked API and git tags)");
    }
  }

  console.log(`Building ${def.registry}/${def.name}@${version}...`);
  return buildFromDefinition(def, version, outputDir);
}

/**
 * Discover the latest version by scanning git remote tags.
 * Uses pattern-filtered ls-remote to avoid fetching all tags from large monorepos.
 */
function findLatestVersionFromGit(entries: VersionEntry[]): string | undefined {
  let latest: string | undefined;

  for (const entry of entries) {
    const tags = listRemoteTags(entry.source.url, entry.tag_pattern);

    for (const tag of tags) {
      const version = extractVersionFromTag(tag, entry.tag_pattern);
      if (!version) continue;
      if (compareSemver(version, entry.min_version) < 0) continue;
      if (entry.max_version && compareSemver(version, entry.max_version) >= 0)
        continue;
      if (!latest || compareSemver(version, latest) > 0) {
        latest = version;
      }
    }
  }

  return latest;
}

/**
 * List tags from a git remote, optionally filtered by tag pattern prefix.
 * Pattern filtering is done server-side (much faster for large monorepos).
 */
function listRemoteTags(url: string, tagPattern?: string): string[] {
  // Extract prefix from tag pattern for server-side filtering
  // e.g., "effect@{version}" -> "refs/tags/effect@*"
  const prefix = tagPattern
    ? tagPattern.slice(0, tagPattern.indexOf("{version}"))
    : "";
  const refFilter = prefix ? `"refs/tags/${prefix}*"` : "";

  let output: string;
  try {
    output = execSync(`git ls-remote --tags ${url} ${refFilter}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
    }).trim();
  } catch {
    return [];
  }

  if (!output) return [];

  const tags = new Set<string>();
  for (const line of output.split("\n")) {
    const refName = line.split("\t")[1];
    if (!refName) continue;
    tags.add(refName.replace("refs/tags/", "").replace(/\^\{\}$/, ""));
  }
  return [...tags];
}

/**
 * Extract a version from a git tag using a tag pattern.
 * "v{version}" + "v1.2.3" -> "1.2.3"
 */
function extractVersionFromTag(tag: string, tagPattern: string): string | null {
  const escaped = tagPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `^${escaped.replace("\\{version\\}", "(\\d+\\.\\d+\\.\\d+)")}$`,
  );
  const match = tag.match(regex);
  return match?.[1] ?? null;
}

await program.parseAsync();
