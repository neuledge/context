#!/usr/bin/env node

/**
 * Registry CLI for local testing and CI.
 * Not shipped to users — used for building and publishing context packages.
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { buildFromDefinition } from "./build.js";
import { listDefinitions } from "./definition.js";
import { checkPackageExists, publishPackage } from "./publish.js";
import { discoverVersions } from "./version-check.js";

const DEFAULT_REGISTRY_DIR = resolve(
  import.meta.dirname,
  "../../..",
  "registry",
);

const program = new Command()
  .name("registry")
  .description("Build and publish context documentation packages");

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
      const ranges = def.versions
        .map(
          (v) => `${v.min_version}${v.max_version ? `-${v.max_version}` : "+"}`,
        )
        .join(", ");
      console.log(`${def.registry}/${def.name}  [${ranges}]`);
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
  .command("build <name> <version>")
  .description("Build a .db package for a specific version")
  .option("--dir <path>", "Registry directory", DEFAULT_REGISTRY_DIR)
  .option("--output <path>", "Output directory", "./dist-packages")
  .action((name, version, opts) => {
    const def = findDefinition(opts.dir, name);
    mkdirSync(opts.output, { recursive: true });

    console.log(`Building ${def.registry}/${def.name}@${version}...`);
    const result = buildFromDefinition(def, version, opts.output);
    console.log(
      `Built: ${result.path} (${result.sectionCount} sections, ${result.totalTokens} tokens)`,
    );
  });

program
  .command("publish <name> <version>")
  .description("Build and publish a .db package")
  .option("--dir <path>", "Registry directory", DEFAULT_REGISTRY_DIR)
  .option("--output <path>", "Output directory", "./dist-packages")
  .action(async (name, version, opts) => {
    const def = findDefinition(opts.dir, name);
    mkdirSync(opts.output, { recursive: true });

    // Check if already published
    const exists = await checkPackageExists(def.registry, def.name, version);
    if (exists) {
      console.log(
        `${def.registry}/${def.name}@${version} already published, skipping.`,
      );
      return;
    }

    console.log(`Building ${def.registry}/${def.name}@${version}...`);
    const result = buildFromDefinition(def, version, opts.output);
    console.log(
      `Built: ${result.sectionCount} sections, ${result.totalTokens} tokens`,
    );

    console.log("Publishing...");
    await publishPackage(def.registry, def.name, version, result.path);
    console.log(`Published ${def.registry}/${def.name}@${version}`);
  });

program
  .command("publish-all")
  .description("Build and publish all missing versions")
  .option("--dir <path>", "Registry directory", DEFAULT_REGISTRY_DIR)
  .option("--output <path>", "Output directory", "./dist-packages")
  .option("--since <days>", "Only versions published in the last N days", "7")
  .action(async (opts) => {
    const definitions = listDefinitions(opts.dir);
    mkdirSync(opts.output, { recursive: true });

    const since = opts.since ? Number(opts.since) : undefined;
    let succeeded = 0;
    let skipped = 0;
    const failures: Array<{ pkg: string; error: string }> = [];

    for (const def of definitions) {
      let versions: Awaited<ReturnType<typeof discoverVersions>>;
      try {
        versions = await discoverVersions(def, { since });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push({ pkg: `${def.registry}/${def.name}`, error: msg });
        console.error(
          `Failed to discover versions for ${def.registry}/${def.name}: ${msg}`,
        );
        continue;
      }

      for (const v of versions) {
        const key = `${v.registry}/${v.name}@${v.version}`;

        try {
          const exists = await checkPackageExists(
            v.registry,
            v.name,
            v.version,
          );
          if (exists) {
            skipped++;
            continue;
          }

          console.log(`Building ${key}...`);
          const result = buildFromDefinition(def, v.version, opts.output);
          console.log(
            `  ${result.sectionCount} sections, ${result.totalTokens} tokens`,
          );

          await publishPackage(v.registry, v.name, v.version, result.path);
          console.log(`  Published ${key}`);
          succeeded++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push({ pkg: key, error: msg });
          console.error(`  Failed ${key}: ${msg}`);
        }
      }
    }

    console.log(
      `\nDone: ${succeeded} published, ${skipped} skipped, ${failures.length} failed`,
    );
    if (failures.length > 0) {
      console.error("\nFailures:");
      for (const f of failures) {
        console.error(`  ${f.pkg}: ${f.error}`);
      }
      process.exitCode = 1;
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
