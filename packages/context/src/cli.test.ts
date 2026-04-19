import { describe, expect, it } from "vitest";
import {
  detectSourceType,
  fetchWebPage,
  packageNameFromUrl,
  parseRegistryPackage,
  resolveLlmsTxtUrls,
  suggestPackageNameFromUrl,
} from "./cli.js";

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
    it("detects HTTP .db URLs", () => {
      expect(detectSourceType("http://example.com/package.db")).toBe("url");
      expect(detectSourceType("http://cdn.example.com/nextjs@15.db")).toBe(
        "url",
      );
    });

    it("detects HTTPS .db URLs", () => {
      expect(detectSourceType("https://example.com/package.db")).toBe("url");
      expect(
        detectSourceType(
          "https://github.com/user/repo/releases/download/v1/package.db",
        ),
      ).toBe("url");
    });
  });

  describe("website sources", () => {
    it("detects plain website URLs as website", () => {
      expect(detectSourceType("https://react-aria.adobe.com")).toBe("website");
      expect(detectSourceType("https://mui.com/material-ui")).toBe("website");
      expect(detectSourceType("https://www.prisma.io/docs")).toBe("website");
    });

    it("detects explicit llms.txt URLs as website", () => {
      expect(detectSourceType("https://react-aria.adobe.com/llms.txt")).toBe(
        "website",
      );
      expect(
        detectSourceType("https://mui.com/material-ui/llms-full.txt"),
      ).toBe("website");
    });

    it("detects http website URLs as website", () => {
      expect(detectSourceType("http://example.com")).toBe("website");
      expect(detectSourceType("http://example.com/docs")).toBe("website");
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

describe("parseRegistryPackage", () => {
  it("parses simple registry/name", () => {
    expect(parseRegistryPackage("npm/next")).toEqual({
      registry: "npm",
      name: "next",
    });
    expect(parseRegistryPackage("pip/django")).toEqual({
      registry: "pip",
      name: "django",
    });
  });

  it("parses scoped packages", () => {
    expect(parseRegistryPackage("npm/@trpc/server")).toEqual({
      registry: "npm",
      name: "@trpc/server",
    });
    expect(parseRegistryPackage("npm/@tanstack/react-query")).toEqual({
      registry: "npm",
      name: "@tanstack/react-query",
    });
  });

  it("returns null for invalid formats", () => {
    expect(parseRegistryPackage("next")).toBeNull();
    expect(parseRegistryPackage("")).toBeNull();
    expect(parseRegistryPackage("/next")).toBeNull();
    expect(parseRegistryPackage("npm/")).toBeNull();
  });

  it("parses inline @version suffix", () => {
    expect(parseRegistryPackage("npm/next@16.1.7")).toEqual({
      registry: "npm",
      name: "next",
      version: "16.1.7",
    });
    expect(parseRegistryPackage("pip/django@4.2.0")).toEqual({
      registry: "pip",
      name: "django",
      version: "4.2.0",
    });
  });

  it("parses scoped packages with @version", () => {
    expect(parseRegistryPackage("npm/@trpc/server@10.0.0")).toEqual({
      registry: "npm",
      name: "@trpc/server",
      version: "10.0.0",
    });
  });

  it("ignores empty @version suffix", () => {
    expect(parseRegistryPackage("npm/next@")).toEqual({
      registry: "npm",
      name: "next",
    });
  });
});

describe("resolveLlmsTxtUrls", () => {
  it("returns direct URL when pointing to llms.txt", () => {
    expect(resolveLlmsTxtUrls("https://example.com/llms.txt")).toEqual([
      "https://example.com/llms.txt",
    ]);
    expect(resolveLlmsTxtUrls("https://example.com/llms-full.txt")).toEqual([
      "https://example.com/llms-full.txt",
    ]);
  });

  it("returns direct URL for subpath llms.txt", () => {
    expect(resolveLlmsTxtUrls("https://mui.com/material-ui/llms.txt")).toEqual([
      "https://mui.com/material-ui/llms.txt",
    ]);
  });

  it("appends llms-full.txt and llms.txt for bare URLs", () => {
    expect(resolveLlmsTxtUrls("https://react-aria.adobe.com")).toEqual([
      "https://react-aria.adobe.com/llms-full.txt",
      "https://react-aria.adobe.com/llms.txt",
    ]);
  });

  it("handles URLs with trailing slash", () => {
    expect(resolveLlmsTxtUrls("https://react-aria.adobe.com/")).toEqual([
      "https://react-aria.adobe.com/llms-full.txt",
      "https://react-aria.adobe.com/llms.txt",
    ]);
  });

  it("handles URLs with subpath", () => {
    expect(resolveLlmsTxtUrls("https://www.prisma.io/docs")).toEqual([
      "https://www.prisma.io/docs/llms-full.txt",
      "https://www.prisma.io/docs/llms.txt",
    ]);
  });
});

describe("packageNameFromUrl", () => {
  it("extracts hostname", () => {
    expect(packageNameFromUrl("https://react-aria.adobe.com")).toBe(
      "react-aria.adobe.com",
    );
    expect(packageNameFromUrl("https://mui.com/material-ui")).toBe("mui.com");
  });

  it("strips www prefix", () => {
    expect(packageNameFromUrl("https://www.prisma.io/docs")).toBe("prisma.io");
  });
});

describe("suggestPackageNameFromUrl", () => {
  it("returns hostname for domain roots", () => {
    expect(suggestPackageNameFromUrl("https://overreacted.io/")).toBe(
      "overreacted.io",
    );
    expect(suggestPackageNameFromUrl("https://example.com")).toBe(
      "example.com",
    );
  });

  it("includes sanitized path for specific pages", () => {
    expect(
      suggestPackageNameFromUrl(
        "https://overreacted.io/things-i-dont-know-as-of-2018/",
      ),
    ).toBe("overreacted.io-things-i-dont-know-as-of-2018");
    expect(
      suggestPackageNameFromUrl("https://example.com/blog/my-first-post"),
    ).toBe("example.com-blog-my-first-post");
  });

  it("strips www prefix", () => {
    expect(
      suggestPackageNameFromUrl("https://www.example.com/article/hello-world"),
    ).toBe("example.com-article-hello-world");
  });

  it("handles paths with special characters", () => {
    expect(suggestPackageNameFromUrl("https://site.com/a_b.c/d+e")).toBe(
      "site.com-a-b-c-d-e",
    );
  });
});

describe("fetchWebPage", () => {
  function makeFetch(
    responses: Record<
      string,
      { body: string; status?: number; contentType?: string }
    >,
  ): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const r = responses[url];
      if (!r) {
        return new Response("not found", { status: 404 });
      }
      return new Response(r.body, {
        status: r.status ?? 200,
        headers: { "content-type": r.contentType ?? "text/markdown" },
      });
    }) as typeof fetch;
  }

  it("returns markdown content unchanged", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/post": {
        body: "# Hello\n\nWorld",
        contentType: "text/markdown",
      },
    });
    const page = await fetchWebPage("https://example.com/post", fetchImpl);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.content).toBe("# Hello\n\nWorld");
    expect(page.title).toBeUndefined();
  });

  it("extracts HTML responses into clean markdown via defuddle", async () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Real Article</title></head>
<body>
<nav><a href="/">Home</a><a href="/subscribe">Subscribe</a></nav>
<aside class="subscribe-cta">Subscribe now for $5/month!</aside>
<article>
<h1>Real Article</h1>
<p>This is the main article content that should survive extraction.</p>
<p>A second paragraph to give defuddle enough signal.</p>
</article>
<aside class="recommendations">More from this author</aside>
<footer>Copyright 2026</footer>
</body>
</html>`;
    const fetchImpl = makeFetch({
      "https://example.com/page": {
        body: html,
        contentType: "text/html; charset=utf-8",
      },
    });
    const page = await fetchWebPage("https://example.com/page", fetchImpl);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.content).toContain("main article content");
    expect(page.content).not.toContain("Subscribe now");
    expect(page.content).not.toContain("More from this author");
    expect(page.title).toBe("Real Article");
  });

  it("sniffs HTML when content-type is missing", async () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head><body>
<article><h1>T</h1><p>Some readable body text of reasonable length so defuddle has signal to work with.</p></article>
</body></html>`;
    const fetchImpl = makeFetch({
      "https://example.com/page": {
        body: html,
        contentType: "",
      },
    });
    const page = await fetchWebPage("https://example.com/page", fetchImpl);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.content).toContain("readable body text");
  });

  it("reports unsupported content type for PDFs", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/paper.pdf": {
        body: "%PDF-1.4...",
        contentType: "application/pdf",
      },
    });
    const page = await fetchWebPage("https://example.com/paper.pdf", fetchImpl);
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.reason).toMatch(/unsupported content type.*pdf/);
  });

  it("reports HTTP status for failed requests", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/bad": { body: "error", status: 500 },
    });
    const page = await fetchWebPage("https://example.com/bad", fetchImpl);
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.reason).toMatch(/HTTP 500/);
  });

  it("reports empty body reason", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/empty": { body: "   " },
    });
    const page = await fetchWebPage("https://example.com/empty", fetchImpl);
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.reason).toMatch(/empty response body/);
  });

  it("reports size cap when content-length exceeds 10 MB", async () => {
    const fetchImpl = (async () => {
      return new Response("<html>big</html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-length": "20971520",
        },
      });
    }) as typeof fetch;
    const page = await fetchWebPage(
      "https://example.com/huge",
      fetchImpl,
      1000,
    );
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.reason).toMatch(/10 MB size cap/);
  });

  it("reports timeout reason", async () => {
    const fetchImpl = (async (_input, init) => {
      return new Promise<Response>((_, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as typeof fetch;
    const page = await fetchWebPage("https://example.com/slow", fetchImpl, 100);
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.reason).toMatch(/timed out after 100ms/);
  });
});
