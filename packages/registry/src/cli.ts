#!/usr/bin/env node

/**
 * Registry CLI — for local testing and CI.
 * Not shipped to users; used internally for managing registry definitions.
 *
 * Commands:
 *   registry list                           List all definitions
 *   registry check [name]                   Discover available versions
 *   registry build <name> <version>         Build a .db for a specific version
 *   registry publish <name> <version>       Build and publish a version
 *   registry publish-all [--since <days>]   Build and publish all missing versions
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { buildVersion } from "./build.js";
import { listDefinitions } from "./definition.js";
import { checkExists, publishPackage } from "./publish.js";
import { getAvailableVersions } from "./version-check.js";

// Resolve registry directory relative to the repo root (two levels up from packages/registry/)
const REGISTRY_DIR = resolve(
  new URL(".", import.meta.url).pathname,
  "../../../registry",
);

const program = new Command()
  .name("registry")
  .description("Registry management CLI for context documentation packages");

program
  .command("list")
  .description("List all definitions in the registry")
  .action(() => {
    const defs = listDefinitions(REGISTRY_DIR);
    if (defs.length === 0) {
      console.log("No definitions found.");
      return;
    }

    console.log(`Found ${defs.length} definition(s):\n`);
    for (const def of defs) {
      const ranges = def.versions
        .map(
          (v) =>
            `${v.min_version}${v.max_version ? ` – <${v.max_version}` : "+"}`,
        )
        .join(", ");
      console.log(`  ${def.registry}/${def.name}  (${ranges})`);
      console.log(`    ${def.description}`);
    }
  });

program
  .command("check")
  .description("Discover available versions from the registry API")
  .argument("[name]", "Filter to a specific package name (e.g., nextjs)")
  .option("--since <days>", "Only versions published in the last N days")
  .action(async (name: string | undefined, options: { since?: string }) => {
    const defs = listDefinitions(REGISTRY_DIR).filter(
      (d) => name == null || d.name === name,
    );

    if (defs.length === 0) {
      console.error(`No definitions found${name ? ` for: ${name}` : ""}`);
      process.exit(1);
    }

    const since =
      options.since != null
        ? new Date(Date.now() - parseInt(options.since, 10) * 86400 * 1000)
        : undefined;

    for (const def of defs) {
      try {
        const versions = await getAvailableVersions(def, { since });
        if (versions.length === 0) {
          console.log(`${def.registry}/${def.name}: no matching versions`);
        } else {
          const list = versions.map((v) => v.version).join(", ");
          console.log(`${def.registry}/${def.name}: ${list}`);
        }
      } catch (err) {
        console.error(
          `Error checking ${def.registry}/${def.name}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  });

program
  .command("build")
  .description("Build a .db package for a specific version")
  .argument("<name>", "Package name (e.g., nextjs)")
  .argument("<version>", "Version string (e.g., 15.0.4)")
  .option("--output <dir>", "Output directory", ".")
  .action(
    async (name: string, version: string, options: { output: string }) => {
      const def = findDefinition(name);
      const outputDir = resolve(options.output);

      console.log(`Building ${def.registry}/${name}@${version}...`);
      try {
        const result = await buildVersion(def, version, { outputDir });
        console.log(
          `✓ Built: ${result.dbPath} (${result.sectionCount} sections, ${result.totalTokens} tokens)`,
        );
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    },
  );

program
  .command("publish")
  .description("Build and publish a package version to the server")
  .argument("<name>", "Package name (e.g., nextjs)")
  .argument("<version>", "Version string (e.g., 15.0.4)")
  .action(async (name: string, version: string) => {
    const def = findDefinition(name);

    // Check if already published
    const exists = await checkExists(def.registry, name, version);
    if (exists) {
      console.log(`${def.registry}/${name}@${version} already published.`);
      return;
    }

    const tempDir = mkdtempSync(join(tmpdir(), "registry-build-"));
    try {
      console.log(`Building ${def.registry}/${name}@${version}...`);
      const result = await buildVersion(def, version, { outputDir: tempDir });
      console.log(`✓ Built (${result.sectionCount} sections)`);

      console.log(`Publishing...`);
      await publishPackage(def.registry, name, version, result.dbPath);
      console.log(`✓ Published ${def.registry}/${name}@${version}`);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

program
  .command("publish-all")
  .description(
    "Build and publish all missing versions (used by CI). Use --since to limit to recent versions.",
  )
  .option(
    "--since <days>",
    "Only consider versions published to the registry in the last N days",
  )
  .action(async (options: { since?: string }) => {
    const defs = listDefinitions(REGISTRY_DIR);
    const since =
      options.since != null
        ? new Date(Date.now() - parseInt(options.since, 10) * 86400 * 1000)
        : undefined;

    let succeeded = 0;
    const failed: string[] = [];

    for (const def of defs) {
      let versions: Awaited<ReturnType<typeof getAvailableVersions>>;
      try {
        versions = await getAvailableVersions(def, { since });
      } catch (err) {
        const msg = `${def.registry}/${def.name}: version discovery failed — ${err instanceof Error ? err.message : err}`;
        console.error(msg);
        failed.push(msg);
        continue;
      }

      for (const { version } of versions) {
        const label = `${def.registry}/${def.name}@${version}`;
        try {
          const exists = await checkExists(def.registry, def.name, version);
          if (exists) {
            console.log(`  skip ${label} (already published)`);
            continue;
          }

          const tempDir = mkdtempSync(join(tmpdir(), "registry-build-"));
          try {
            process.stdout.write(`  build ${label}...`);
            const result = await buildVersion(def, version, {
              outputDir: tempDir,
            });
            process.stdout.write(
              ` ${result.sectionCount} sections, publishing...`,
            );
            await publishPackage(
              def.registry,
              def.name,
              version,
              result.dbPath,
            );
            console.log(` ✓`);
            succeeded++;
          } finally {
            rmSync(tempDir, { recursive: true, force: true });
          }
        } catch (err) {
          console.log(` ✗`);
          const msg = `${label}: ${err instanceof Error ? err.message : err}`;
          console.error(`  Error: ${msg}`);
          failed.push(msg);
        }
      }
    }

    console.log(`\nDone: ${succeeded} published, ${failed.length} failed.`);
    if (failed.length > 0) {
      console.error("\nFailed:");
      for (const f of failed) {
        console.error(`  - ${f}`);
      }
      process.exit(1);
    }
  });

function findDefinition(name: string) {
  const defs = listDefinitions(REGISTRY_DIR);
  const def = defs.find((d) => d.name === name);
  if (!def) {
    const available = defs.map((d) => d.name).join(", ");
    console.error(`Unknown package: ${name}`);
    if (available) console.error(`Available: ${available}`);
    process.exit(1);
  }
  return def;
}

program.parse();
