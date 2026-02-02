import { describe, expect, it } from "vitest";
import { detectSourceType } from "./cli.js";

describe("detectSourceType", () => {
  describe("file sources", () => {
    it("detects local file paths", () => {
      expect(detectSourceType("./package.db")).toBe("file");
      expect(detectSourceType("../packages/nextjs.db")).toBe("file");
      expect(detectSourceType("/home/user/package.db")).toBe("file");
      expect(detectSourceType("package.db")).toBe("file");
    });

    it("detects Windows-style paths as files", () => {
      expect(detectSourceType("C:\\Users\\package.db")).toBe("file");
      expect(detectSourceType(".\\package.db")).toBe("file");
    });
  });

  describe("URL sources", () => {
    it("detects HTTP URLs", () => {
      expect(detectSourceType("http://example.com/package.db")).toBe("url");
      expect(detectSourceType("http://cdn.example.com/nextjs@15.db")).toBe(
        "url",
      );
    });

    it("detects HTTPS URLs", () => {
      expect(detectSourceType("https://example.com/package.db")).toBe("url");
      expect(
        detectSourceType(
          "https://github.com/user/repo/releases/download/v1/package.db",
        ),
      ).toBe("url");
    });
  });

  describe("git sources", () => {
    it("detects GitHub URLs as git", () => {
      expect(detectSourceType("https://github.com/vercel/next.js")).toBe("git");
      expect(detectSourceType("https://github.com/facebook/react")).toBe("git");
      expect(detectSourceType("https://github.com/microsoft/TypeScript")).toBe(
        "git",
      );
    });

    it("detects GitHub URLs with tree/ref as git", () => {
      expect(
        detectSourceType("https://github.com/vercel/next.js/tree/v15.0.0"),
      ).toBe("git");
      expect(
        detectSourceType("https://github.com/facebook/react/tree/main"),
      ).toBe("git");
    });

    it("detects repos with hyphens and underscores", () => {
      expect(detectSourceType("https://github.com/some-org/some-repo")).toBe(
        "git",
      );
      expect(detectSourceType("https://github.com/some_org/some_repo")).toBe(
        "git",
      );
    });

    it("detects repos with dots in name", () => {
      expect(detectSourceType("https://github.com/vercel/next.js")).toBe("git");
      expect(detectSourceType("https://github.com/org/repo.name")).toBe("git");
    });

    it("detects other git hosting providers", () => {
      expect(detectSourceType("https://gitlab.com/org/repo")).toBe("git");
      expect(detectSourceType("https://bitbucket.org/org/repo")).toBe("git");
      expect(detectSourceType("git@github.com:user/repo.git")).toBe("git");
      expect(detectSourceType("ssh://git@github.com/user/repo.git")).toBe(
        "git",
      );
    });

    it("treats owner/repo shorthand as file (not git)", () => {
      expect(detectSourceType("vercel/next.js")).toBe("file");
      expect(detectSourceType("facebook/react")).toBe("file");
    });
  });

  describe("edge cases", () => {
    it("does not confuse paths with slashes as GitHub", () => {
      // Paths with more than one slash are not GitHub repos
      expect(detectSourceType("./some/path/file.db")).toBe("file");
      expect(detectSourceType("packages/context/file.db")).toBe("file");
    });

    it("handles empty and whitespace", () => {
      expect(detectSourceType("")).toBe("file");
      expect(detectSourceType("   ")).toBe("file");
    });
  });
});
