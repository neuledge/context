import { describe, expect, it } from "vitest";
import { extractArticleMarkdown } from "./extract-html.js";

// `extractArticleMarkdown` is the application path that runs Linkedom's own
// selector engine: `parseHTML` builds the document that Defuddle then walks with
// querySelector/querySelectorAll/closest (css-select, css-what, nth-check). The
// turndown-based `parseHtml` tests in html.test.ts never touch that stack, so a
// selector regression there would otherwise slip through the linkedom upgrade.
describe("extractArticleMarkdown", () => {
  it("extracts the article, drops page chrome and permalink anchors, and keeps heading text", async () => {
    const result = await extractArticleMarkdown(
      `<html>
        <head><title>Design FAQ</title></head>
        <body>
          <nav><a href="/about">About</a></nav>
          <header><p>Site header clutter</p></header>
          <article>
            <h1>Design FAQ</h1>
            <h2 id="why">Why are Python strings immutable?<a class="headerlink" href="#why" title="Link to this heading">¶</a></h2>
            <p>There are several advantages.</p>
            <h2 id="traits">Traits<a class="anchor" href="#traits">§</a></h2>
            <p>Shared behaviour for types.</p>
          </article>
          <footer><p>Footer clutter</p></footer>
        </body>
      </html>`,
      "https://docs.example/faq/design.html",
    );

    expect(result?.title).toBe("Design FAQ");
    expect(result?.markdown).toContain("## Why are Python strings immutable?");
    expect(result?.markdown).toContain("There are several advantages.");
    expect(result?.markdown).toContain("## Traits");
    expect(result?.markdown).toContain("Shared behaviour for types.");
    // Permalink anchors are stripped from heading text rather than emitted.
    expect(result?.markdown).not.toContain("¶");
    expect(result?.markdown).not.toContain("§");
    // Chrome outside the article is removed by selector-based extraction.
    expect(result?.markdown).not.toContain("Site header clutter");
    expect(result?.markdown).not.toContain("Footer clutter");
    expect(result?.markdown).not.toContain("About");
  });
});
