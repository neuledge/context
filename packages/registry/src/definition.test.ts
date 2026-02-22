import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareSemver,
  constructTag,
  listDefinitions,
  loadDefinition,
  type PackageDefinition,
  resolveVersionEntry,
} from "./definition.js";

describe("compareSemver", () => {
  it("compares equal versions", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
  });

  it("compares major versions", () => {
    expect(compareSemver("2.0.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("compares minor versions", () => {
    expect(compareSemver("1.2.0", "1.1.0")).toBeGreaterThan(0);
  });

  it("compares patch versions", () => {
    expect(compareSemver("1.0.2", "1.0.1")).toBeGreaterThan(0);
  });

  it("handles missing patch", () => {
    expect(compareSemver("1.0", "1.0.0")).toBe(0);
  });
});

describe("constructTag", () => {
  it("constructs v-prefixed tags", () => {
    expect(constructTag("v{version}", "1.2.3")).toBe("v1.2.3");
  });

  it("constructs scoped tags", () => {
    expect(constructTag("nextjs@{version}", "15.0.0")).toBe("nextjs@15.0.0");
  });

  it("constructs plain version tags", () => {
    expect(constructTag("{version}", "1.0.0")).toBe("1.0.0");
  });
});

describe("loadDefinition", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "def-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses a valid YAML definition", () => {
    const yaml = `
name: next
description: "The React Framework"
repository: https://github.com/vercel/next.js
versions:
  - min_version: "15.0.0"
    source:
      type: git
      url: https://github.com/vercel/next.js
      docs_path: docs
    tag_pattern: "v{version}"
`;
    const npmDir = join(tempDir, "npm");
    mkdirSync(npmDir);
    writeFileSync(join(npmDir, "next.yaml"), yaml);

    const def = loadDefinition(join(npmDir, "next.yaml"));

    expect(def.name).toBe("next");
    expect(def.registry).toBe("npm");
    expect(def.description).toBe("The React Framework");
    expect(def.versions).toHaveLength(1);
    expect(def.versions[0].source.lang).toBe("en");
    expect(def.versions[0].tag_pattern).toBe("v{version}");
  });

  it("throws when name doesn't match filename", () => {
    const yaml = `
name: nextjs
versions:
  - min_version: "15.0.0"
    source:
      type: git
      url: https://github.com/vercel/next.js
`;
    const npmDir = join(tempDir, "npm");
    mkdirSync(npmDir);
    writeFileSync(join(npmDir, "next.yaml"), yaml);

    expect(() => loadDefinition(join(npmDir, "next.yaml"))).toThrow(
      /doesn't match filename/,
    );
  });

  it("throws on invalid YAML", () => {
    const npmDir = join(tempDir, "npm");
    mkdirSync(npmDir);
    writeFileSync(join(npmDir, "bad.yaml"), "name: 123\nversions: nope");

    expect(() => loadDefinition(join(npmDir, "bad.yaml"))).toThrow();
  });
});

describe("listDefinitions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "list-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("scans registry directory for definitions", () => {
    mkdirSync(join(tempDir, "npm"));
    mkdirSync(join(tempDir, "pip"));
    writeFileSync(
      join(tempDir, "npm", "test.yaml"),
      'name: test\nversions:\n  - min_version: "1.0.0"\n    source:\n      type: git\n      url: https://github.com/test/test\n',
    );
    writeFileSync(
      join(tempDir, "pip", "testpip.yaml"),
      'name: testpip\nversions:\n  - min_version: "1.0.0"\n    source:\n      type: git\n      url: https://github.com/test/test\n',
    );

    const defs = listDefinitions(tempDir);
    expect(defs).toHaveLength(2);
    expect(defs[0].registry).toBe("npm");
    expect(defs[1].registry).toBe("pip");
  });
});

describe("resolveVersionEntry", () => {
  const makeDef = (
    versions: Array<{
      min_version: string;
      max_version?: string;
    }>,
  ) =>
    ({
      name: "test",
      registry: "npm",
      versions: versions.map((v) => ({
        ...v,
        source: {
          type: "git" as const,
          url: "https://example.com",
          lang: "en",
        },
        tag_pattern: "v{version}",
      })),
    }) as unknown as PackageDefinition;

  it("matches version in open-ended range", () => {
    const def = makeDef([{ min_version: "15.0.0" }]);
    expect(resolveVersionEntry(def, "15.1.0")).toBeDefined();
    expect(resolveVersionEntry(def, "16.0.0")).toBeDefined();
    expect(resolveVersionEntry(def, "14.9.9")).toBeUndefined();
  });

  it("matches version in bounded range", () => {
    const def = makeDef([{ min_version: "9.0.0", max_version: "15.0.0" }]);
    expect(resolveVersionEntry(def, "9.0.0")).toBeDefined();
    expect(resolveVersionEntry(def, "14.9.9")).toBeDefined();
    expect(resolveVersionEntry(def, "15.0.0")).toBeUndefined();
  });

  it("returns first matching entry (top-to-bottom)", () => {
    const def = makeDef([
      { min_version: "15.0.0" },
      { min_version: "9.0.0", max_version: "15.0.0" },
    ]);

    const entry = resolveVersionEntry(def, "15.0.0");
    expect(entry).toBeDefined();
    // Should match the first entry (15.0.0+), not the second
    expect(entry?.max_version).toBeUndefined();
  });
});
