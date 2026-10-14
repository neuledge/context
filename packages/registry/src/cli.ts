#!/usr/bin/env node

/**
 * Registry CLI for local testing and CI publishing.
 * Not shipped to users — used for building and publishing context packages.
 */

import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { isMissingRefError } from "@neuledge/context";
import { Command } from "commander";
import {
  buildFromDefinition,
  buildUnversioned,
  MissingSourceRefError,
} from "./build.js";
import {
  isExplicitVersionEntry,
  isVersioned,
  listDefinitions,
} from "./definition.js";
import { formatBuilt } from "./format.js";
import { publishDefinition } from "./publication.js";
import { type AvailableVersion, discoverVersions } from "./version-check.js";

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
          .map((v) => {
            if (isExplicitVersionEntry(v)) {
              return v.versions.join(", ");
            }
            return `${v.min_version}${v.max_version ? `-${v.max_version}` : "+"}`;
          })
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
  .action(async (name, version, opts) => {
    const def = findDefinition(opts.dir, name);
    mkdirSync(opts.output, { recursive: true });

    if (isVersioned(def)) {
      if (!version) {
        throw new Error(
          `Version required for versioned package "${name}". Use: registry build ${name} <version>`,
        );
      }
      console.log(`Building ${def.registry}/${def.name}@${version}...`);
      const result = await buildFromDefinition(def, version, opts.output);
      console.log(`Built: ${result.path} (${formatBuilt(result)})`);
    } else {
      console.log(
        `Building ${def.registry}/${def.name}@latest (unversioned)...`,
      );
      const result = await buildUnversioned(def, opts.output);
      console.log(`Built: ${result.path} (${formatBuilt(result)})`);
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
  .option(
    "--force",
    "Rebuild and upload even when already published or unchanged",
  )
  .action(async (name, version, opts) => {
    const def = findDefinition(opts.dir, name);
    mkdirSync(opts.output, { recursive: true });

    if (isVersioned(def) && !version) {
      throw new Error(
        `Version required for versioned package "${name}". Use: registry publish ${name} <version>`,
      );
    }
    await publishDefinition(
      def,
      isVersioned(def) ? version : "latest",
      opts.output,
      {
        force: opts.force,
      },
    );
  });

program
  .command("publish-all")
  .description(
    "Check all definitions, build and publish missing or stale versions",
  )
  .option("--dir <path>", "Registry directory", DEFAULT_REGISTRY_DIR)
  .option(
    "--output <path>",
    "Output directory for build artifacts",
    "./dist-packages",
  )
  .option(
    "--since <days>",
    "Only versions published on registry in last N days (omit to include all)",
  )
  .option(
    "--latest <count>",
    "Only the N most recent minor versions per package",
  )
  .option(
    "--force",
    "Rebuild and upload even when already published or unchanged",
  )
  .action(async (opts) => {
    const definitions = listDefinitions(opts.dir);
    mkdirSync(opts.output, { recursive: true });

    let succeeded = 0;
    let skipped = 0;
    const skipReasons = new Map<string, number>();
    const recordSkip = (reason: string) => {
      skipped++;
      skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
    };
    const failures: { id: string; error: string }[] = [];

    for (const def of definitions) {
      // Discovery talks to a third-party registry API, so it can fail for
      // reasons that have nothing to do with this package — a 404 for a renamed
      // module, a 429, an upstream outage. Record it like a build failure
      // instead of letting it throw out of the loop: definitions are processed
      // in sorted order, so an unguarded throw here silently abandons every
      // package after this one and prints no summary at all.
      let versions: AvailableVersion[];
      try {
        versions = await discoverVersions(def, {
          since: opts.since ? Number(opts.since) : undefined,
          latest: opts.latest ? Number(opts.latest) : undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const id = `${def.registry}/${def.name}`;
        console.error(`  FAILED ${id} (version discovery): ${message}`);
        failures.push({ id, error: message });
        continue;
      }

      for (const ver of versions) {
        const id = `${def.registry}/${def.name}@${ver.version}`;
        try {
          const result = await publishDefinition(
            def,
            ver.version,
            opts.output,
            {
              force: opts.force,
              quietSkips: true,
              onSkip: recordSkip,
            },
          );
          if (!result) {
            continue;
          }
          // Keep failed uploads on disk for recovery; remove successful artifacts.
          rmSync(result.path, { force: true });

          succeeded++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Tags can disappear after publication or not have been pushed yet.
          if (
            err instanceof MissingSourceRefError ||
            isMissingRefError(message)
          ) {
            console.warn(
              `  WARNING ${id}: source tag unavailable; skipping (${message})`,
            );
            recordSkip("source tag unavailable");
            continue;
          }
          console.error(`  FAILED ${id}: ${message}`);
          failures.push({ id, error: message });
        }
      }
    }

    // Summary
    console.log(`\n--- Summary ---`);
    console.log(`Succeeded: ${succeeded}`);
    console.log(`Skipped: ${skipped}`);
    for (const [reason, count] of skipReasons) {
      console.log(`  ${reason}: ${count}`);
    }
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
