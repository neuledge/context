#!/usr/bin/env node

/**
 * Registry CLI for local testing and CI publishing.
 * Not shipped to users — used for building and publishing context packages.
 */

import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  buildFromDefinition,
  buildUnversioned,
  getHeadCommit,
} from "./build.js";
import { isVersioned, listDefinitions } from "./definition.js";
import { checkPackageExists, publishPackage } from "./publish.js";
import { discoverVersions } from "./version-check.js";

const DEFAULT_REGISTRY_DIR = resolve(
  import.meta.dirname,
  "../../..",
  "registry",
);

const program = new Command()
  .name("registry")
  .description("Build context documentation packages from definitions");

program
  .command("list")
  .description("List all package definitions")
  .option("--dir <path>", "Registry directory", DEFAULT_REGISTRY_DIR)
  .action((opts) => {
    const definitions = listDefinitions(opts.dir);
    if (definitions.length === 0) {
      console.log("No definitions found.");
      return;
    }

    for (const def of definitions) {
      if (isVersioned(def)) {
        const ranges = def.versions
          .map(
            (v) =>
              `${v.min_version}${v.max_version ? `-${v.max_version}` : "+"}`,
          )
          .join(", ");
        console.log(`${def.registry}/${def.name}  [${ranges}]`);
      } else {
        console.log(`${def.registry}/${def.name}  (unversioned)`);
      }
    }
  });

program
  .command("check [name]")
  .description("Discover available versions from registry APIs")
  .option("--dir <path>", "Registry directory", DEFAULT_REGISTRY_DIR)
  .option("--since <days>", "Only versions published in the last N days")
  .action(async (name, opts) => {
    const definitions = name
      ? [findDefinition(opts.dir, name)]
      : listDefinitions(opts.dir);

    for (const def of definitions) {
      const versions = await discoverVersions(def, {
        since: opts.since ? Number(opts.since) : undefined,
      });

      console.log(
        `\n${def.registry}/${def.name} (${versions.length} versions):`,
      );
      for (const v of versions.slice(0, 20)) {
        const date = v.publishedAt
          ? ` (${new Date(v.publishedAt).toISOString().slice(0, 10)})`
          : "";
        console.log(`  ${v.version}${date}`);
      }
      if (versions.length > 20) {
        console.log(`  ... and ${versions.length - 20} more`);
      }
    }
  });

program
  .command("build <name> [version]")
  .description("Build a .db package for a specific version")
  .option("--dir <path>", "Registry directory", DEFAULT_REGISTRY_DIR)
  .option("--output <path>", "Output directory", "./dist-packages")
  .action((name, version, opts) => {
    const def = findDefinition(opts.dir, name);
    mkdirSync(opts.output, { recursive: true });

    if (isVersioned(def)) {
      if (!version) {
        throw new Error(
          `Version required for versioned package "${name}". Use: registry build ${name} <version>`,
        );
      }
      console.log(`Building ${def.registry}/${def.name}@${version}...`);
      const result = buildFromDefinition(def, version, opts.output);
      console.log(
        `Built: ${result.path} (${result.sectionCount} sections, ${result.totalTokens} tokens)`,
      );
    } else {
      console.log(
        `Building ${def.registry}/${def.name}@latest (unversioned)...`,
      );
      const result = buildUnversioned(def, opts.output);
      console.log(
        `Built: ${result.path} (${result.sectionCount} sections, ${result.totalTokens} tokens)`,
      );
    }
  });

program
  .command("publish <name> [version]")
  .description("Build and publish a package to the registry server")
  .option("--dir <path>", "Registry directory", DEFAULT_REGISTRY_DIR)
  .option(
    "--output <path>",
    "Output directory for build artifacts",
    "./dist-packages",
  )
  .action(async (name, version, opts) => {
    const def = findDefinition(opts.dir, name);
    mkdirSync(opts.output, { recursive: true });

    if (isVersioned(def)) {
      if (!version) {
        throw new Error(
          `Version required for versioned package "${name}". Use: registry publish ${name} <version>`,
        );
      }

      // Check if already published
      const existing = await checkPackageExists(
        def.registry,
        def.name,
        version,
      );
      if (existing) {
        console.log(
          `Already published: ${def.registry}/${def.name}@${version}`,
        );
        return;
      }

      console.log(`Building ${def.registry}/${def.name}@${version}...`);
      const result = buildFromDefinition(def, version, opts.output);
      console.log(
        `Built: ${result.path} (${result.sectionCount} sections, ${result.totalTokens} tokens)`,
      );

      console.log(`Publishing ${def.registry}/${def.name}@${version}...`);
      await publishPackage(def.registry, def.name, version, result.path);
      console.log(`Published: ${def.registry}/${def.name}@${version}`);
    } else {
      // Unversioned: check source_commit to skip if unchanged
      const existing = await checkPackageExists(
        def.registry,
        def.name,
        "latest",
      );
      if (existing?.source_commit) {
        const currentCommit = getHeadCommit(def.source.url);
        if (currentCommit === existing.source_commit) {
          console.log(
            `Skipping ${def.registry}/${def.name}@latest (source unchanged: ${currentCommit.slice(0, 8)})`,
          );
          return;
        }
      }

      console.log(
        `Building ${def.registry}/${def.name}@latest (unversioned)...`,
      );
      const result = buildUnversioned(def, opts.output);
      console.log(
        `Built: ${result.path} (${result.sectionCount} sections, ${result.totalTokens} tokens)`,
      );

      console.log(`Publishing ${def.registry}/${def.name}@latest...`);
      await publishPackage(def.registry, def.name, "latest", result.path);
      console.log(`Published: ${def.registry}/${def.name}@latest`);
    }
  });

program
  .command("publish-all")
  .description("Check all definitions, build and publish missing versions")
  .option("--dir <path>", "Registry directory", DEFAULT_REGISTRY_DIR)
  .option(
    "--output <path>",
    "Output directory for build artifacts",
    "./dist-packages",
  )
  .option(
    "--since <days>",
    "Only versions published on registry in last N days",
    "7",
  )
  .action(async (opts) => {
    const definitions = listDefinitions(opts.dir);
    mkdirSync(opts.output, { recursive: true });

    let succeeded = 0;
    let skipped = 0;
    const failures: { id: string; error: string }[] = [];

    for (const def of definitions) {
      const versions = await discoverVersions(def, {
        since: opts.since ? Number(opts.since) : undefined,
      });

      for (const ver of versions) {
        const id = `${def.registry}/${def.name}@${ver.version}`;
        try {
          if (isVersioned(def)) {
            // Check if already published
            const existing = await checkPackageExists(
              def.registry,
              def.name,
              ver.version,
            );
            if (existing) {
              skipped++;
              continue;
            }

            console.log(`Building ${id}...`);
            const result = buildFromDefinition(def, ver.version, opts.output);
            console.log(
              `  Built (${result.sectionCount} sections, ${result.totalTokens} tokens)`,
            );

            console.log(`  Publishing...`);
            await publishPackage(
              def.registry,
              def.name,
              ver.version,
              result.path,
            );
            console.log(`  Published`);

            // Clean up build artifact to save disk space
            rmSync(result.path, { force: true });
          } else {
            // Unversioned: check source_commit
            const existing = await checkPackageExists(
              def.registry,
              def.name,
              "latest",
            );
            if (existing?.source_commit) {
              const currentCommit = getHeadCommit(def.source.url);
              if (currentCommit === existing.source_commit) {
                skipped++;
                continue;
              }
            }

            console.log(`Building ${id}...`);
            const result = buildUnversioned(def, opts.output);
            console.log(
              `  Built (${result.sectionCount} sections, ${result.totalTokens} tokens)`,
            );

            console.log(`  Publishing...`);
            await publishPackage(def.registry, def.name, "latest", result.path);
            console.log(`  Published`);

            rmSync(result.path, { force: true });
          }

          succeeded++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`  FAILED ${id}: ${message}`);
          failures.push({ id, error: message });
        }
      }
    }

    // Summary
    console.log(`\n--- Summary ---`);
    console.log(`Succeeded: ${succeeded}`);
    console.log(`Skipped (already published): ${skipped}`);
    console.log(`Failed: ${failures.length}`);

    if (failures.length > 0) {
      console.log(`\nFailures:`);
      for (const f of failures) {
        console.log(`  ${f.id}: ${f.error}`);
      }
      process.exit(1);
    }
  });

function findDefinition(dir: string, name: string) {
  const definitions = listDefinitions(dir);
  const def = definitions.find((d) => d.name === name);
  if (!def) {
    const available = definitions.map((d) => d.name).join(", ");
    throw new Error(
      `Definition "${name}" not found. Available: ${available || "none"}`,
    );
  }
  return def;
}

await program.parseAsync();
