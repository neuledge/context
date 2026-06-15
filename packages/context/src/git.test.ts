import { describe, expect, it } from "vitest";
import {
  findLatestStableVersion,
  isMissingRefError,
  isTransientGitError,
  parseMonorepoTag,
} from "./git.js";

describe("isTransientGitError", () => {
  it("detects connection failures", () => {
    expect(
      isTransientGitError(
        "fatal: unable to access 'https://github.com/vuejs/docs/': Failed to connect to github.com port 443 after 135337 ms: Couldn't connect to server",
      ),
    ).toBe(true);
  });

  it("detects DNS failures", () => {
    expect(
      isTransientGitError(
        "fatal: unable to access 'https://github.com/x/y/': Could not resolve host: github.com",
      ),
    ).toBe(true);
  });

  it("detects server errors", () => {
    expect(
      isTransientGitError("error: The requested URL returned error: 503"),
    ).toBe(true);
  });

  it("rejects permanent errors", () => {
    expect(
      isTransientGitError("fatal: Remote branch v99.0.0 not found in upstream"),
    ).toBe(false);
    expect(isTransientGitError("remote: Repository not found.")).toBe(false);
    expect(
      isTransientGitError("fatal: Authentication failed for 'https://...'"),
    ).toBe(false);
  });
});

describe("isMissingRefError", () => {
  it("detects a tag not pushed yet (npm ahead of git)", () => {
    expect(
      isMissingRefError(
        "Git clone failed: Cloning into '/tmp/context-git-9itQYk'...\nfatal: Remote branch v4.1.9 not found in upstream origin",
      ),
    ).toBe(true);
  });

  it("detects a missing pathspec/reference on checkout", () => {
    expect(
      isMissingRefError("error: pathspec 'v4.1.9' did not match any file(s)"),
    ).toBe(true);
  });

  it("rejects transient and unrelated errors", () => {
    expect(isMissingRefError("Could not resolve host: github.com")).toBe(false);
    expect(isMissingRefError("remote: Repository not found.")).toBe(false);
  });
});

describe("parseMonorepoTag", () => {
  it("parses plain version tags", () => {
    expect(parseMonorepoTag("1.2.3")).toEqual({
      packageName: null,
      version: "1.2.3",
    });
  });

  it("parses v-prefixed version tags", () => {
    expect(parseMonorepoTag("v1.2.3")).toEqual({
      packageName: null,
      version: "1.2.3",
    });
  });

  it("parses unscoped package tags", () => {
    expect(parseMonorepoTag("ai@6.0.68")).toEqual({
      packageName: "ai",
      version: "6.0.68",
    });
  });

  it("parses scoped package tags", () => {
    expect(parseMonorepoTag("@ai-sdk/gateway@2.0.31")).toEqual({
      packageName: "@ai-sdk/gateway",
      version: "2.0.31",
    });
  });

  it("parses prerelease versions in package tags", () => {
    expect(parseMonorepoTag("ai@6.0.68-canary.0")).toEqual({
      packageName: "ai",
      version: "6.0.68-canary.0",
    });
  });

  it("handles scoped packages with prerelease", () => {
    expect(parseMonorepoTag("@ai-sdk/openai@1.0.0-beta.1")).toEqual({
      packageName: "@ai-sdk/openai",
      version: "1.0.0-beta.1",
    });
  });
});

describe("findLatestStableVersion", () => {
  it("returns null for empty tags", () => {
    expect(findLatestStableVersion([])).toBeNull();
  });

  it("finds latest stable version from plain tags", () => {
    const tags = ["v1.0.0", "v1.2.3", "v1.1.0"];
    expect(findLatestStableVersion(tags)).toBe("v1.2.3");
  });

  it("filters out prerelease versions", () => {
    const tags = ["v1.0.0", "v2.0.0-canary.0", "v1.2.3"];
    expect(findLatestStableVersion(tags)).toBe("v1.2.3");
  });

  describe("monorepo support", () => {
    const monorepoTags = [
      "ai@6.0.68",
      "ai@6.0.67",
      "ai@6.0.66-canary.0",
      "@ai-sdk/gateway@2.0.31",
      "@ai-sdk/gateway@2.0.30",
      "@ai-sdk/openai@1.0.0",
      "@ai-sdk/openai@1.0.1-beta.0",
    ];

    it("filters by unscoped package name", () => {
      expect(findLatestStableVersion(monorepoTags, "ai")).toBe("ai@6.0.68");
    });

    it("filters by scoped package name", () => {
      expect(findLatestStableVersion(monorepoTags, "@ai-sdk/gateway")).toBe(
        "@ai-sdk/gateway@2.0.31",
      );
    });

    it("excludes prerelease versions when filtering by package", () => {
      // ai@6.0.66-canary.0 should be excluded
      const tags = ["ai@6.0.66-canary.0", "ai@6.0.65"];
      expect(findLatestStableVersion(tags, "ai")).toBe("ai@6.0.65");
    });

    it("returns null if no matching package found", () => {
      expect(findLatestStableVersion(monorepoTags, "nonexistent")).toBeNull();
    });

    it("falls back to plain version tags when package not found in monorepo", () => {
      const mixedTags = ["ai@6.0.68", "v1.0.0", "v2.0.0"];
      // When looking for "react", there are no package-prefixed tags,
      // so it should fall back to plain version tags
      expect(findLatestStableVersion(mixedTags, "react")).toBe("v2.0.0");
    });

    it("handles case-insensitive package matching", () => {
      expect(findLatestStableVersion(monorepoTags, "AI")).toBe("ai@6.0.68");
      expect(findLatestStableVersion(monorepoTags, "@AI-SDK/Gateway")).toBe(
        "@ai-sdk/gateway@2.0.31",
      );
    });

    it("without package name, returns highest version across all tags", () => {
      // Without filtering, ai@6.0.68 has the highest version numbers
      const result = findLatestStableVersion(monorepoTags);
      expect(result).toBe("ai@6.0.68");
    });
  });

  describe("version comparison", () => {
    it("compares major versions correctly", () => {
      const tags = ["v2.0.0", "v1.9.9", "v10.0.0"];
      expect(findLatestStableVersion(tags)).toBe("v10.0.0");
    });

    it("compares minor versions correctly", () => {
      const tags = ["v1.2.0", "v1.10.0", "v1.9.0"];
      expect(findLatestStableVersion(tags)).toBe("v1.10.0");
    });

    it("compares patch versions correctly", () => {
      const tags = ["v1.2.3", "v1.2.10", "v1.2.9"];
      expect(findLatestStableVersion(tags)).toBe("v1.2.10");
    });
  });
});
