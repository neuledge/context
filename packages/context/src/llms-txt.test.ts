import { describe, expect, it } from "vitest";
import { fetchLinkedDocs, parseLlmsTxtLinks } from "./llms-txt.js";

const SAMPLE_LLMS_TXT = `# Example Library

> A short summary of the library.

Some intro paragraph here.

## Docs

- [Getting Started](/docs/getting-started): Learn the basics
- [API Reference](https://example.com/docs/api)
- [Tutorial](docs/tutorial.md "Tutorial title")

## Examples

- [Counter](https://example.com/examples/counter)
* [Todo App](https://example.com/examples/todo)

## External

- [Other site](https://other.com/page)
`;

describe("parseLlmsTxtLinks", () => {
  it("extracts links grouped by H2 section", () => {
    const links = parseLlmsTxtLinks(
      SAMPLE_LLMS_TXT,
      "https://example.com/llms.txt",
    );

    expect(links).toEqual([
      {
        section: "Docs",
        title: "Getting Started",
        url: "https://example.com/docs/getting-started",
      },
      {
        section: "Docs",
        title: "API Reference",
        url: "https://example.com/docs/api",
      },
      {
        section: "Docs",
        title: "Tutorial",
        url: "https://example.com/docs/tutorial.md",
      },
      {
        section: "Examples",
        title: "Counter",
        url: "https://example.com/examples/counter",
      },
      {
        section: "Examples",
        title: "Todo App",
        url: "https://example.com/examples/todo",
      },
      {
        section: "External",
        title: "Other site",
        url: "https://other.com/page",
      },
    ]);
  });

  it("ignores links in non-list contexts", () => {
    const content = `# Title

See [the docs](https://example.com/docs) for details.

## Section

- [Real link](https://example.com/page)
`;
    const links = parseLlmsTxtLinks(content, "https://example.com/llms.txt");
    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe("https://example.com/page");
  });

  it("resolves relative URLs against the base URL", () => {
    const content = `## Section

- [Relative](../sibling/page.md)
- [Root](/root/page)
`;
    const links = parseLlmsTxtLinks(
      content,
      "https://example.com/docs/llms.txt",
    );
    expect(links.map((l) => l.url)).toEqual([
      "https://example.com/sibling/page.md",
      "https://example.com/root/page",
    ]);
  });

  it("skips invalid URLs", () => {
    const content = `## Section

- [Bad](not a url with spaces)
- [Good](https://example.com/ok)
`;
    const links = parseLlmsTxtLinks(content, "https://example.com/llms.txt");
    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe("https://example.com/ok");
  });
});

describe("fetchLinkedDocs", () => {
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

  it("fetches all linked documents and returns MarkdownFile entries", async () => {
    const llmsTxt = `## Docs

- [A](https://example.com/a)
- [B](https://example.com/b)
`;
    const fetchImpl = makeFetch({
      "https://example.com/a": { body: "# A\n\nContent of A" },
      "https://example.com/b": { body: "# B\n\nContent of B" },
    });

    const files = await fetchLinkedDocs(
      llmsTxt,
      "https://example.com/llms.txt",
      { fetchImpl, concurrency: 2 },
    );

    expect(files).toHaveLength(2);
    expect(files.map((f) => f.path).sort()).toEqual([
      "example.com/a.md",
      "example.com/b.md",
    ]);
    expect(files.find((f) => f.path === "example.com/a.md")?.content).toBe(
      "# A\n\nContent of A",
    );
  });

  it("uses .html extension for HTML responses so parseHtml runs", async () => {
    const llmsTxt = `## Docs

- [Page](https://example.com/page)
`;
    const fetchImpl = makeFetch({
      "https://example.com/page": {
        body: "<html><body><h1>Hi</h1></body></html>",
        contentType: "text/html; charset=utf-8",
      },
    });

    const files = await fetchLinkedDocs(
      llmsTxt,
      "https://example.com/llms.txt",
      { fetchImpl },
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("example.com/page.html");
  });

  it("filters cross-origin links by default", async () => {
    const llmsTxt = `## Docs

- [Same](https://example.com/a)
- [Other](https://other.com/b)
`;
    const fetchImpl = makeFetch({
      "https://example.com/a": { body: "ok" },
      "https://other.com/b": { body: "ok" },
    });

    const files = await fetchLinkedDocs(
      llmsTxt,
      "https://example.com/llms.txt",
      { fetchImpl },
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("example.com/a.md");
  });

  it("allows cross-origin when sameOriginOnly is false", async () => {
    const llmsTxt = `## Docs

- [Same](https://example.com/a)
- [Other](https://other.com/b)
`;
    const fetchImpl = makeFetch({
      "https://example.com/a": { body: "ok-a" },
      "https://other.com/b": { body: "ok-b" },
    });

    const files = await fetchLinkedDocs(
      llmsTxt,
      "https://example.com/llms.txt",
      { fetchImpl, sameOriginOnly: false },
    );

    expect(files).toHaveLength(2);
  });

  it("skips failed fetches without throwing", async () => {
    const llmsTxt = `## Docs

- [Good](https://example.com/good)
- [Bad](https://example.com/bad)
- [Missing](https://example.com/missing)
`;
    const fetchImpl = makeFetch({
      "https://example.com/good": { body: "ok" },
      "https://example.com/bad": { body: "", status: 500 },
      // missing -> 404
    });

    const files = await fetchLinkedDocs(
      llmsTxt,
      "https://example.com/llms.txt",
      { fetchImpl },
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("example.com/good.md");
  });

  it("dedupes repeated link URLs", async () => {
    const llmsTxt = `## A

- [One](https://example.com/x)

## B

- [Two](https://example.com/x)
`;
    const fetchImpl = makeFetch({
      "https://example.com/x": { body: "ok" },
    });

    const files = await fetchLinkedDocs(
      llmsTxt,
      "https://example.com/llms.txt",
      { fetchImpl },
    );

    expect(files).toHaveLength(1);
  });

  it("respects maxLinks", async () => {
    const links = Array.from(
      { length: 10 },
      (_, i) => `- [L${i}](https://example.com/${i})`,
    ).join("\n");
    const llmsTxt = `## Docs\n\n${links}\n`;
    const responses: Record<string, { body: string }> = {};
    for (let i = 0; i < 10; i++) {
      responses[`https://example.com/${i}`] = { body: `doc ${i}` };
    }
    const fetchImpl = makeFetch(responses);

    const files = await fetchLinkedDocs(
      llmsTxt,
      "https://example.com/llms.txt",
      { fetchImpl, maxLinks: 3 },
    );

    expect(files).toHaveLength(3);
  });
});
