import { describe, expect, it, vi } from "vitest";
import { parseLlmsTxt } from "./llmstxt.js";

describe("parseLlmsTxt", () => {
  it("parses llms.txt index only", () => {
    const source = {
      index: `# Project Name

> A great project for doing things.

## Getting Started

- [Installation Guide](https://example.com/docs/install)
- [Quick Start](https://example.com/docs/quickstart)

## API Reference

- [Authentication](https://example.com/docs/auth)
- [Endpoints](https://example.com/docs/api)
`,
      baseUrl: "https://example.com",
    };

    const docs = parseLlmsTxt(source);
    expect(docs).toHaveLength(1);
    expect(docs[0].path).toBe("llms.txt");
    expect(docs[0].sections.length).toBeGreaterThan(0);
    // First section should contain the project heading
    expect(docs[0].sections[0].docTitle).toBeTruthy();
  });

  it("parses llms.txt index and llms-full.txt", () => {
    const source = {
      index: `# Project Name

> A great project.

## Docs
- [Getting Started](https://example.com/docs/start)
`,
      full: `# Project Name

> A great project.

## Getting Started

To get started, install the package:

\`\`\`bash
npm install project-name
\`\`\`

Then create a new instance:

\`\`\`typescript
import { create } from "project-name";
const instance = create();
\`\`\`
`,
      baseUrl: "https://example.com",
    };

    const docs = parseLlmsTxt(source);
    expect(docs).toHaveLength(2);
    expect(docs[0].path).toBe("llms.txt");
    expect(docs[1].path).toBe("llms-full.txt");
    expect(docs[1].sections.length).toBeGreaterThan(0);
  });
});

describe("fetchLlmsTxt", () => {
  it("fetches llms.txt and llms-full.txt", async () => {
    const mockIndex = "# Test\n> Description";
    const mockFull = "# Test\nFull content here.";

    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/llms.txt")) {
        return new Response(mockIndex, { status: 200 });
      }
      if (url.endsWith("/llms-full.txt")) {
        return new Response(mockFull, { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });

    try {
      const { fetchLlmsTxt } = await import("./llmstxt.js");
      const result = await fetchLlmsTxt("https://example.com");

      expect(result.index).toBe(mockIndex);
      expect(result.full).toBe(mockFull);
      expect(result.baseUrl).toBe("https://example.com");
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("throws when llms.txt is not found", async () => {
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("Not found", { status: 404 }));

    try {
      const { fetchLlmsTxt } = await import("./llmstxt.js");
      await expect(fetchLlmsTxt("https://example.com")).rejects.toThrow(
        "Failed to fetch llms.txt",
      );
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("handles missing llms-full.txt gracefully", async () => {
    const mockIndex = "# Test\n> Description";

    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/llms.txt")) {
        return new Response(mockIndex, { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });

    try {
      const { fetchLlmsTxt } = await import("./llmstxt.js");
      const result = await fetchLlmsTxt("https://example.com");

      expect(result.index).toBe(mockIndex);
      expect(result.full).toBeUndefined();
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("strips trailing slashes from base URL", async () => {
    const mockIndex = "# Test";

    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string) => {
      expect(url).not.toContain("//llms.txt");
      return new Response(mockIndex, { status: 200 });
    });

    try {
      const { fetchLlmsTxt } = await import("./llmstxt.js");
      const result = await fetchLlmsTxt("https://example.com///");
      expect(result.baseUrl).toBe("https://example.com");
    } finally {
      globalThis.fetch = globalFetch;
    }
  });
});
