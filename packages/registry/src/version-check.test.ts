import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PackageDefinition } from "./definition.js";
import { discoverVersions } from "./version-check.js";

const mockDefinition: PackageDefinition = {
  name: "testpkg",
  registry: "npm",
  versions: [
    {
      min_version: "2.0.0",
      source: {
        type: "git",
        url: "https://github.com/test/test",
        lang: "en",
      },
      tag_pattern: "v{version}",
    },
    {
      min_version: "1.0.0",
      max_version: "2.0.0",
      source: {
        type: "git",
        url: "https://github.com/test/test-old",
        lang: "en",
      },
      tag_pattern: "v{version}",
    },
  ],
};

describe("discoverVersions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches npm versions and filters to defined ranges", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        versions: {
          "1.0.0": {},
          "1.0.1": {},
          "1.1.0": {},
          "2.0.0": {},
          "2.1.0": {},
          "3.0.0-beta.1": {},
          "0.9.0": {},
        },
        time: {
          "1.0.0": "2024-01-01T00:00:00Z",
          "1.0.1": "2024-02-01T00:00:00Z",
          "1.1.0": "2024-03-01T00:00:00Z",
          "2.0.0": "2024-04-01T00:00:00Z",
          "2.1.0": "2024-05-01T00:00:00Z",
          "3.0.0-beta.1": "2024-06-01T00:00:00Z",
          "0.9.0": "2023-12-01T00:00:00Z",
        },
      }),
    } as Response);

    const versions = await discoverVersions(mockDefinition);

    // Should exclude: 0.9.0 (below range), 3.0.0-beta.1 (prerelease)
    // Should deduplicate: 1.0.0 vs 1.0.1 → keep 1.0.1 (latest patch for 1.0)
    expect(versions.map((v) => v.version)).toEqual([
      "2.1.0",
      "2.0.0",
      "1.1.0",
      "1.0.1",
    ]);
  });

  it("filters by --since date", async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        versions: { "2.0.0": {}, "2.1.0": {} },
        time: {
          "2.0.0": old.toISOString(),
          "2.1.0": recent.toISOString(),
        },
      }),
    } as Response);

    const versions = await discoverVersions(mockDefinition, { since: 7 });

    expect(versions.map((v) => v.version)).toEqual(["2.1.0"]);
  });

  it("throws for unsupported registry", async () => {
    const def = { ...mockDefinition, registry: "cargo" };
    await expect(discoverVersions(def)).rejects.toThrow(
      "Unsupported registry: cargo",
    );
  });

  it("throws on HTTP error", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    await expect(discoverVersions(mockDefinition)).rejects.toThrow("404");
  });
});
