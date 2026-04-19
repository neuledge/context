import { describe, expect, it } from "vitest";
import { type AuthConfig, findAuthForUrl, withPlatformAuth } from "./auth.js";

describe("findAuthForUrl", () => {
  it("matches exact hostname", () => {
    const auth: AuthConfig = {
      "medium.com": { cookies: "uid=abc" },
    };
    expect(findAuthForUrl(auth, "https://medium.com/article")).toEqual({
      cookies: "uid=abc",
    });
  });

  it("matches parent domain for subdomains", () => {
    const auth: AuthConfig = {
      "substack.com": { cookies: "sid=xyz" },
    };
    expect(
      findAuthForUrl(auth, "https://rafahari.substack.com/p/post"),
    ).toEqual({
      cookies: "sid=xyz",
    });
  });

  it("prefers more specific domain over parent", () => {
    const auth: AuthConfig = {
      "substack.com": { cookies: "generic" },
      "rafahari.substack.com": { cookies: "specific" },
    };
    expect(
      findAuthForUrl(auth, "https://rafahari.substack.com/p/post"),
    ).toEqual({
      cookies: "specific",
    });
  });

  it("returns null when no match", () => {
    const auth: AuthConfig = {
      "medium.com": { cookies: "uid=abc" },
    };
    expect(findAuthForUrl(auth, "https://example.com")).toBeNull();
  });

  it("returns null for invalid URLs", () => {
    expect(findAuthForUrl({}, "not-a-url")).toBeNull();
  });

  it("stops after one parent domain to avoid overly broad matches", () => {
    // a.b.example.com should match b.example.com (one parent) but not example.com
    const auth: AuthConfig = {
      "b.example.com": { cookies: "specific" },
      "example.com": { cookies: "too-generic" },
    };
    expect(findAuthForUrl(auth, "https://a.b.example.com/page")).toEqual({
      cookies: "specific",
    });

    // c.d.example.com should NOT match example.com (two parents away)
    const auth2: AuthConfig = {
      "example.com": { cookies: "too-generic" },
    };
    expect(findAuthForUrl(auth2, "https://c.d.example.com/page")).toBeNull();
  });
});

describe("withPlatformAuth", () => {
  it("returns base headers when no auth match", () => {
    const result = withPlatformAuth({}, "https://example.com", {
      "User-Agent": "test",
    });
    expect(result.headers).toEqual({ "User-Agent": "test" });
    expect(result.redirect).toBe("follow");
  });

  it("merges cookies from matched auth", () => {
    const auth: AuthConfig = {
      "medium.com": { cookies: "uid=abc" },
    };
    const result = withPlatformAuth(auth, "https://medium.com/article", {
      "User-Agent": "test",
    });
    expect(result.headers).toEqual({
      "User-Agent": "test",
      Cookie: "uid=abc",
    });
  });

  it("merges extra headers from matched auth", () => {
    const auth: AuthConfig = {
      "medium.com": {
        cookies: "uid=abc",
        headers: { "x-frontend": "true" },
      },
    };
    const result = withPlatformAuth(auth, "https://medium.com/article", {
      "User-Agent": "test",
    });
    expect(result.headers).toEqual({
      "User-Agent": "test",
      Cookie: "uid=abc",
      "x-frontend": "true",
    });
  });
});
