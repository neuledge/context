import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadDefinition,
  type UnversionedDefinition,
  type VersionedDefinition,
} from "./definition.js";
import { createBuildFingerprint, getIngestionRevision } from "./fingerprint.js";
import { publicationSkipReason } from "./publication.js";

const git: UnversionedDefinition = {
  registry: "custom",
  name: "docs",
  description: "Example docs",
  source: {
    type: "git",
    url: "https://example.com/docs.git",
    docs_path: "docs",
    lang: "en",
  },
};
const zip: VersionedDefinition = {
  registry: "custom",
  name: "docs",
  versions: [
    {
      versions: ["1.0"],
      source: {
        type: "zip",
        url: "https://example.com/{version}.zip",
        docs_path: "docs-{version}",
        lang: "en",
      },
    },
  ],
};

describe("build fingerprints", () => {
  const fingerprint = (def = git, commit = "commit", revision = "pipeline") =>
    createBuildFingerprint(def, "latest", commit, revision);

  it("is deterministic and includes the source commit and pipeline revision", () => {
    expect(fingerprint()).toBe(fingerprint());
    expect(fingerprint(git, "changed")).not.toBe(fingerprint());
    expect(fingerprint(git, "commit", "changed")).not.toBe(fingerprint());
    expect(getIngestionRevision()).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    { docs_path: "guides" },
    { exclude_paths: ["private/**"] },
    { url: "https://example.com/other.git" },
    { ref: "stable" },
    { lang: "de" },
  ])("invalidates changed source settings: %j", (change) => {
    expect(
      fingerprint({ ...git, source: { ...git.source, ...change } }),
    ).not.toBe(fingerprint());
  });

  it("normalizes exclusion order, duplicates and omitted defaults", () => {
    const a = {
      ...git,
      source: { ...git.source, exclude_paths: ["a/**", "b/**"] },
    };
    const b = {
      ...git,
      source: { ...git.source, exclude_paths: ["b/**", "a/**", "a/**"] },
    };
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(
      fingerprint({ ...git, source: { ...git.source, exclude_paths: [] } }),
    ).toBe(fingerprint());
  });

  it("ignores YAML formatting and property order", () => {
    const dir = mkdtempSync(join(tmpdir(), "fingerprint-yaml-"));
    const path = join(dir, "docs.yaml");
    try {
      writeFileSync(
        path,
        "name: docs\nsource:\n  type: git\n  url: https://example.com/docs.git\n  docs_path: docs\n",
      );
      const a = loadDefinition(path);
      writeFileSync(
        path,
        "# same settings\nsource: {docs_path: docs, url: https://example.com/docs.git, lang: en, type: git}\nname: docs\n",
      );
      expect(createBuildFingerprint(a, "latest", "commit", "pipeline")).toBe(
        createBuildFingerprint(
          loadDefinition(path),
          "latest",
          "commit",
          "pipeline",
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hashes the effective release entry rather than unrelated releases", () => {
    const changed = {
      ...zip,
      versions: [
        ...zip.versions,
        {
          source: {
            type: "zip" as const,
            url: "https://example.com/{version}.zip",
            docs_path: "docs-{version}",
            lang: "en",
          },
          versions: ["2.0"],
        },
      ],
    };
    expect(createBuildFingerprint(zip, "1.0")).toBe(
      createBuildFingerprint(changed, "1.0"),
    );
    const resolved = {
      ...zip,
      versions: [
        {
          versions: ["1.0"],
          source: {
            type: "zip" as const,
            url: "https://example.com/1.0.zip",
            docs_path: "docs-1.0",
            lang: "en",
          },
        },
      ],
    };
    expect(createBuildFingerprint(zip, "1.0")).toBe(
      createBuildFingerprint(resolved, "1.0"),
    );
  });

  it("ignores language settings that ZIP ingestion does not use", () => {
    const changed: VersionedDefinition = {
      ...zip,
      versions: [
        {
          versions: ["1.0"],
          source: {
            type: "zip",
            url: "https://example.com/{version}.zip",
            docs_path: "docs-{version}",
            lang: "de",
          },
        },
      ],
    };
    expect(createBuildFingerprint(changed, "1.0")).toBe(
      createBuildFingerprint(zip, "1.0"),
    );
  });

  it("skips an existing explicit release only when its fingerprint matches", () => {
    const existing = {
      registry: "custom",
      name: "docs",
      version: "1.0",
      build_fingerprint: createBuildFingerprint(zip, "1.0"),
    };
    expect(publicationSkipReason(zip, "1.0", existing)).toBe(
      "build inputs unchanged",
    );
    expect(
      publicationSkipReason(
        { ...zip, description: "changed" },
        "1.0",
        existing,
      ),
    ).toBeUndefined();
    expect(
      publicationSkipReason(zip, "1.0", {
        ...existing,
        build_fingerprint: "old-pipeline",
      }),
    ).toBeUndefined();
    expect(publicationSkipReason(zip, "1.0", existing, true)).toBeUndefined();
  });

  it("preserves legacy versioned skipping and allows an explicit rebuild", () => {
    const legacy = { registry: "custom", name: "docs", version: "1.0" };
    expect(publicationSkipReason(zip, "1.0", legacy)).toContain(
      "legacy metadata",
    );
    expect(publicationSkipReason(zip, "1.0", legacy, true)).toBeUndefined();
    expect(publicationSkipReason(zip, "1.0", null)).toBeUndefined();
  });

  it("keeps rebuilding unversioned archives with no immutable revision", () => {
    const def: UnversionedDefinition = {
      ...git,
      source: {
        type: "zip",
        url: "https://example.com/latest.zip",
        lang: "en",
      },
    };
    expect(
      publicationSkipReason(def, "latest", {
        registry: "custom",
        name: "docs",
        version: "latest",
        build_fingerprint: createBuildFingerprint(def, "latest"),
      }),
    ).toBeUndefined();
  });
});
