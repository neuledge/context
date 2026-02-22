import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGitTag,
  compareSemver,
  findMatchingVersion,
  listDefinitionFiles,
  parseDefinition,
} from "./definition.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "def-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeYaml(manager: string, name: string, content: string): string {
  const dir = join(tmpDir, manager);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${name}.yaml`);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

describe("parseDefinition", () => {
  it("parses a valid definition", () => {
    const filePath = writeYaml(
      "npm",
      "nextjs",
      `
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
`,
    );

    const def = parseDefinition(filePath);

    expect(def.name).toBe("nextjs");
    expect(def.packageName).toBe("next");
    expect(def.registry).toBe("npm");
    expect(def.versions).toHaveLength(1);
    expect(def.versions[0].source.lang).toBe("en");
  });

  it("derives registry from directory name", () => {
    const filePath = writeYaml(
      "pip",
      "django",
      `
name: django
description: "The web framework for perfectionists"
repository: https://github.com/django/django
versions:
  - min_version: "4.0.0"
    source:
      type: git
      url: https://github.com/django/django
    tag_pattern: "{version}"
`,
    );

    const def = parseDefinition(filePath);

    expect(def.registry).toBe("pip");
    expect(def.packageName).toBe("django");
  });

  it("defaults packageName to name when package field is absent", () => {
    const filePath = writeYaml(
      "npm",
      "react",
      `
name: react
description: "The library for web UIs"
repository: https://github.com/facebook/react
versions:
  - min_version: "18.0.0"
    source:
      type: git
      url: https://github.com/reactjs/react.dev
    tag_pattern: "v{version}"
`,
    );

    const def = parseDefinition(filePath);

    expect(def.packageName).toBe("react");
  });

  it("throws on invalid YAML schema", () => {
    const filePath = writeYaml(
      "npm",
      "bad",
      `
name: bad
description: "Missing required fields"
`,
    );

    expect(() => parseDefinition(filePath)).toThrow();
  });
});

describe("listDefinitionFiles", () => {
  it("lists yaml files across manager directories", () => {
    writeYaml(
      "npm",
      "react",
      "name: r\ndescription: d\nrepository: https://example.com\nversions: []",
    );
    writeYaml(
      "npm",
      "next",
      "name: n\ndescription: d\nrepository: https://example.com\nversions: []",
    );
    writeYaml(
      "pip",
      "django",
      "name: d\ndescription: d\nrepository: https://example.com\nversions: []",
    );

    const files = listDefinitionFiles(tmpDir);

    expect(files).toHaveLength(3);
    expect(files.some((f) => f.includes("npm"))).toBe(true);
    expect(files.some((f) => f.includes("pip"))).toBe(true);
  });

  it("ignores non-yaml files", () => {
    mkdirSync(join(tmpDir, "npm"), { recursive: true });
    writeFileSync(join(tmpDir, "npm", "README.md"), "docs");
    writeYaml(
      "npm",
      "react",
      "name: r\ndescription: d\nrepository: https://example.com\nversions: []",
    );

    const files = listDefinitionFiles(tmpDir);

    expect(files).toHaveLength(1);
    expect(files[0]).toContain("react.yaml");
  });
});

describe("findMatchingVersion", () => {
  const baseDef = {
    name: "nextjs",
    packageName: "next",
    description: "Framework",
    repository: "https://github.com/vercel/next.js",
    registry: "npm",
    versions: [
      {
        min_version: "15.0.0",
        source: {
          type: "git" as const,
          url: "https://github.com/vercel/next.js",
          lang: "en",
        },
        tag_pattern: "v{version}",
      },
      {
        min_version: "9.0.0",
        max_version: "15.0.0",
        source: {
          type: "git" as const,
          url: "https://github.com/vercel/next-site",
          lang: "en",
        },
        tag_pattern: "v{version}",
      },
    ],
  };

  it("matches the first applicable range", () => {
    const entry = findMatchingVersion(baseDef, "15.0.4");
    expect(entry?.source.url).toContain("next.js");
  });

  it("matches the second range for older versions", () => {
    const entry = findMatchingVersion(baseDef, "14.2.1");
    expect(entry?.source.url).toContain("next-site");
  });

  it("returns null when no range matches", () => {
    const entry = findMatchingVersion(baseDef, "8.9.0");
    expect(entry).toBeNull();
  });

  it("treats max_version as exclusive", () => {
    // 15.0.0 should NOT match the second range (max_version: "15.0.0" is exclusive)
    const entry = findMatchingVersion(baseDef, "15.0.0");
    expect(entry?.source.url).toContain("next.js");
  });
});

describe("buildGitTag", () => {
  it("replaces {version} placeholder", () => {
    expect(buildGitTag("v{version}", "15.0.4")).toBe("v15.0.4");
    expect(buildGitTag("nextjs@{version}", "15.0.4")).toBe("nextjs@15.0.4");
    expect(buildGitTag("{version}", "4.2.0")).toBe("4.2.0");
  });
});

describe("compareSemver", () => {
  it("compares correctly", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemver("1.9.9", "2.0.0")).toBeLessThan(0);
    expect(compareSemver("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareSemver("v15.0.4", "15.0.3")).toBeGreaterThan(0);
  });
});
