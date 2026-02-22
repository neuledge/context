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
name: nextjs
package: next
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
    // Put it under a "npm" directory to simulate registry/npm/nextjs.yaml
    const npmDir = join(tempDir, "npm");
    mkdirSync(npmDir);
    const filePath = join(npmDir, "nextjs.yaml");
    writeFileSync(filePath, yaml);

    const def = loadDefinition(filePath);

    expect(def.name).toBe("nextjs");
    expect(def.registryPackage).toBe("next");
    expect(def.registry).toBe("npm");
    expect(def.description).toBe("The React Framework");
    expect(def.versions).toHaveLength(1);
    expect(def.versions[0].source.lang).toBe("en");
    expect(def.versions[0].tag_pattern).toBe("v{version}");
  });

  it("defaults registryPackage to name when package is omitted", () => {
    const yaml = `
name: react
versions:
  - min_version: "18.0.0"
    source:
      type: git
      url: https://github.com/reactjs/react.dev
`;
    const npmDir = join(tempDir, "npm");
    mkdirSync(npmDir);
    writeFileSync(join(npmDir, "react.yaml"), yaml);

    const def = loadDefinition(join(npmDir, "react.yaml"));
    expect(def.registryPackage).toBe("react");
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
    const yaml = `
name: test-pkg
versions:
  - min_version: "1.0.0"
    source:
      type: git
      url: https://github.com/test/test
`;
    mkdirSync(join(tempDir, "npm"));
    mkdirSync(join(tempDir, "pip"));
    writeFileSync(join(tempDir, "npm", "test.yaml"), yaml);
    writeFileSync(
      join(tempDir, "pip", "test.yaml"),
      yaml.replace("test-pkg", "test-pip"),
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
      registryPackage: "test",
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
