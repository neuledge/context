import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("automatic ingestion revision", () => {
  let root: string;
  const script = resolve(
    import.meta.dirname,
    "../../../scripts/generate-ingestion-revision.mjs",
  );
  function write(path: string, content: string) {
    const file = resolve(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  function revision() {
    execFileSync(process.execPath, [script, root]);
    return JSON.parse(
      readFileSync(
        resolve(root, "packages/registry/dist/ingestion-revision.json"),
        "utf8",
      ),
    ) as { revision: string; files: string[]; dependencies: string[] };
  }
  const lock = (version = "1.0") =>
    JSON.stringify({
      importers: {
        "packages/registry": {
          devDependencies: { typescript: { version: "5.9" } },
        },
        "packages/context": { dependencies: { parser: { version: "1.0" } } },
      },
      packages: {
        "parser@1.0": { resolution: { integrity: "parser" } },
        [`helper@${version}`]: {
          resolution: { integrity: `helper-${version}` },
        },
        "typescript@5.9": { resolution: { integrity: "ts" } },
      },
      snapshots: {
        "parser@1.0": { dependencies: { helper: version } },
        [`helper@${version}`]: {},
        "typescript@5.9": {},
      },
    });

  beforeEach(() => {
    root = mkdtempSync(resolve(tmpdir(), "ingestion-revision-"));
    write(
      "packages/registry/src/build.ts",
      'import { buildPackage } from "@neuledge/context";\n',
    );
    write(
      "packages/context/src/index.ts",
      'export { buildPackage } from "./package-builder.js";\nexport { server } from "./server.js";\n',
    );
    write(
      "packages/context/src/package-builder.ts",
      'import parser from "parser";\nimport { helper } from "./helper.js";\nexport function buildPackage() { return helper(parser); }\n',
    );
    write(
      "packages/context/src/helper.ts",
      "export const helper = (x) => x;\n",
    );
    write("pnpm-lock.yaml", lock());
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("follows helpers and workspace exports while ignoring unrelated files and line endings", () => {
    const original = revision();
    expect(original.files).toContain("packages/context/src/helper.ts");
    expect(original.files).not.toContain("packages/context/src/server.ts");
    write("README.md", "unrelated documentation");
    write("packages/context/src/helper.test.ts", "unrelated test");
    write("packages/context/src/server.ts", "unrelated server");
    write(
      "packages/context/src/helper.ts",
      "export const helper = (x) => x;\r\n",
    );
    expect(revision().revision).toBe(original.revision);
    write(
      "packages/context/src/helper.ts",
      "export const helper = (x) => x + 1;\n",
    );
    expect(revision().revision).not.toBe(original.revision);
  });

  it("invalidates transitive dependency changes but ignores lockfile serialization", () => {
    const original = revision();
    expect(original.dependencies).toContain("helper@1.0");
    write("pnpm-lock.yaml", JSON.stringify(JSON.parse(lock()), null, 2));
    expect(revision().revision).toBe(original.revision);
    write("pnpm-lock.yaml", lock("2.0"));
    expect(revision().revision).not.toBe(original.revision);
  });

  it("discovers newly imported helpers without a manually maintained file list", () => {
    const original = revision();
    write(
      "packages/context/src/helper.ts",
      'export { helper } from "./nested.js";\n',
    );
    write(
      "packages/context/src/nested.ts",
      "export const helper = (x) => x;\n",
    );
    const changed = revision();
    expect(changed.files).toContain("packages/context/src/nested.ts");
    expect(changed.revision).not.toBe(original.revision);
  });

  it.each([
    false,
    true,
  ])("follows peer-suffixed dependencies with suffixed package records: %s", (suffixedPackages) => {
    const data = JSON.parse(lock());
    data.importers["packages/context"].dependencies.parser.version =
      "1.0(peer@1.0)";
    for (const name of ["parser", "helper"]) {
      const key = `${name}@1.0`;
      const peerKey = `${key}(peer@1.0)`;
      data.snapshots[peerKey] = data.snapshots[key];
      delete data.snapshots[key];
      if (suffixedPackages) {
        data.packages[peerKey] = data.packages[key];
        delete data.packages[key];
      }
    }
    data.snapshots["parser@1.0(peer@1.0)"].dependencies.helper =
      "1.0(peer@1.0)";
    write("pnpm-lock.yaml", JSON.stringify(data));
    const original = revision();
    expect(original.dependencies).toContain("helper@1.0(peer@1.0)");
    const key = suffixedPackages ? "helper@1.0(peer@1.0)" : "helper@1.0";
    data.packages[key].resolution.integrity = "changed-peer-dependency";
    write("pnpm-lock.yaml", JSON.stringify(data));
    expect(revision().revision).not.toBe(original.revision);
  });

  it("covers real ingestion inputs and agrees with source and built revisions", () => {
    const repository = resolve(import.meta.dirname, "../../..");
    const generated = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `import { generateIngestionRevision } from ${JSON.stringify(new URL("../../../scripts/generate-ingestion-revision.mjs", import.meta.url).href)}; console.log(JSON.stringify(generateIngestionRevision()));`,
        ],
        { cwd: repository, encoding: "utf8" },
      ),
    );
    expect(generated.files).toEqual(
      expect.arrayContaining([
        "packages/registry/src/build.ts",
        "packages/registry/src/source.ts",
        "packages/registry/src/html-index.ts",
        "packages/registry/src/zip.ts",
        "packages/context/src/package-builder.ts",
        "packages/context/src/build.ts",
        "packages/context/src/html.ts",
      ]),
    );
    expect(generated.files).not.toContain("packages/context/src/cli.ts");
    for (const entry of ["src/fingerprint.ts", "dist/fingerprint.js"]) {
      const revision = execFileSync(
        process.execPath,
        [
          ...(entry.startsWith("src/") ? ["--import", "tsx"] : []),
          "--input-type=module",
          "--eval",
          `import { getIngestionRevision } from ${JSON.stringify(new URL(entry, new URL("../", import.meta.url)).href)}; console.log(getIngestionRevision());`,
        ],
        { encoding: "utf8" },
      ).trim();
      expect(revision).toBe(generated.revision);
    }
  });
});
