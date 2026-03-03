#!/usr/bin/env node

/**
 * Registry CLI for local testing.
 * Not shipped to users — used for building context packages from definitions.
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { buildFromDefinition, buildUnversioned } from "./build.js";
import { isVersioned, listDefinitions } from "./definition.js";
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
