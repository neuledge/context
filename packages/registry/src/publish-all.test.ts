import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `publish-all` walks every definition in sorted order. A throw that escapes the
 * loop abandons every package after it, so these run the real CLI and assert on
 * what the nightly job would actually see.
 *
 * Definitions use a registry with no version fetcher, which makes discovery
 * throw before any network call.
 */
describe("publish-all — a failing definition must not abandon the rest", () => {
  let dir: string;
  let out: string;

  const define = (registry: string, name: string): void => {
    mkdirSync(join(dir, registry), { recursive: true });
    writeFileSync(
      join(dir, registry, `${name}.yaml`),
      [
        `name: ${name}`,
        `description: "test"`,
        `versions:`,
        `  - min_version: "1.0.0"`,
        `    source:`,
        `      type: git`,
        `      url: https://example.invalid/${name}`,
        `      docs_path: docs`,
        "",
      ].join("\n"),
    );
  };

  const runPublishAll = (): { status: number; output: string } => {
    try {
      const stdout = execFileSync(
        "npx",
        ["tsx", "src/cli.ts", "publish-all", "--dir", dir, "--output", out],
        { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" },
      );
      return { status: 0, output: stdout };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return {
        status: e.status ?? 1,
        output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
      };
    }
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "registry-defs-"));
    out = mkdtempSync(join(tmpdir(), "registry-out-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it("records a discovery failure and still reaches the summary", () => {
    define("unsupported", "aaa");
    define("unsupported", "zzz");

    const { status, output } = runPublishAll();

    // Both are recorded, not thrown — and the run reports rather than crashing.
    expect(output).toContain("--- Summary ---");
    expect(output).toContain("Failed: 2");
    expect(output).toContain("unsupported/aaa");
    expect(output).toContain("unsupported/zzz");
    expect(status).not.toBe(0);
  }, 60_000);

  it("does not abandon definitions sorted after a failing one", () => {
    define("unsupported", "aaa");
    define("unsupported", "mmm");
    define("unsupported", "zzz");

    const { output } = runPublishAll();

    // The bug this guards: `aaa` throwing meant `mmm` and `zzz` were never seen.
    expect(output).toContain("Failed: 3");
  }, 60_000);
});
