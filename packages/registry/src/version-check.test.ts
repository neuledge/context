import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Definition } from "./definition.js";
import { getAvailableVersions } from "./version-check.js";

const npmDef: Definition = {
  name: "nextjs",
  packageName: "next",
  description: "The React Framework",
  repository: "https://github.com/vercel/next.js",
  registry: "npm",
  versions: [
    {
      min_version: "14.0.0",
      source: {
        type: "git",
        url: "https://github.com/vercel/next.js",
        lang: "en",
      },
      tag_pattern: "v{version}",
    },
  ],
};

describe("getAvailableVersions", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("registry.npmjs.org")) {
          return {
            ok: true,
            json: async () => ({
              versions: {
                "14.0.0": {},
                "14.0.1": {},
                "14.1.0": {},
                "14.2.0": {},
                "14.2.1": {},
                "15.0.0": {},
                "15.0.0-canary.1": {},
                "15.0.1": {},
                "15.1.0-beta.0": {},
                "13.5.0": {}, // below min_version, should be excluded
              },
              time: {
                "14.0.0": "2024-01-01T00:00:00.000Z",
                "14.0.1": "2024-01-15T00:00:00.000Z",
                "14.1.0": "2024-02-01T00:00:00.000Z",
                "14.2.0": "2024-03-01T00:00:00.000Z",
                "14.2.1": "2024-03-15T00:00:00.000Z",
                "15.0.0": "2024-10-01T00:00:00.000Z",
                "15.0.0-canary.1": "2024-09-01T00:00:00.000Z",
                "15.0.1": "2024-11-01T00:00:00.000Z",
                "15.1.0-beta.0": "2024-11-15T00:00:00.000Z",
                "13.5.0": "2023-09-01T00:00:00.000Z",
              },
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns latest patch per minor, excluding prereleases", async () => {
    const versions = await getAvailableVersions(npmDef);
    const versionStrings = versions.map((v) => v.version);

    // Should include latest patch per minor
    expect(versionStrings).toContain("15.0.1");
    expect(versionStrings).toContain("14.2.1");
    expect(versionStrings).toContain("14.1.0");
    expect(versionStrings).toContain("14.0.1");

    // Should exclude prereleases
    expect(versionStrings).not.toContain("15.0.0-canary.1");
    expect(versionStrings).not.toContain("15.1.0-beta.0");

    // Should exclude versions below min_version
    expect(versionStrings).not.toContain("13.5.0");

    // Should not include non-latest patches (14.0.0 superseded by 14.0.1)
    expect(versionStrings).not.toContain("14.0.0");
    expect(versionStrings).not.toContain("14.2.0");
    expect(versionStrings).not.toContain("15.0.0");
  });

  it("filters by since date", async () => {
    // Only versions published after 2024-10-01
    const since = new Date("2024-10-01T00:00:00.000Z");
    const versions = await getAvailableVersions(npmDef, { since });
    const versionStrings = versions.map((v) => v.version);

    expect(versionStrings).toContain("15.0.1");
    expect(versionStrings).not.toContain("14.2.1");
    expect(versionStrings).not.toContain("14.1.0");
  });

  it("returns versions sorted by semver descending", async () => {
    const versions = await getAvailableVersions(npmDef);
    const vStrings = versions.map((v) => v.version);

    // First version should be the highest
    const first = vStrings[0];
    const _last = vStrings[vStrings.length - 1];
    expect(first).toBe("15.0.1");

    // Verify descending order
    for (let i = 0; i < vStrings.length - 1; i++) {
      const a = vStrings[i].replace(/^v/, "").split(".").map(Number);
      const b = vStrings[i + 1].replace(/^v/, "").split(".").map(Number);
      const aGtB =
        (a[0] ?? 0) > (b[0] ?? 0) ||
        ((a[0] ?? 0) === (b[0] ?? 0) && (a[1] ?? 0) > (b[1] ?? 0)) ||
        ((a[0] ?? 0) === (b[0] ?? 0) &&
          (a[1] ?? 0) === (b[1] ?? 0) &&
          (a[2] ?? 0) >= (b[2] ?? 0));
      expect(aGtB).toBe(true);
    }
  });

  it("throws for unsupported registry", async () => {
    const cargoDef = { ...npmDef, registry: "cargo" };
    await expect(getAvailableVersions(cargoDef)).rejects.toThrow(
      "Unsupported registry",
    );
  });
});
