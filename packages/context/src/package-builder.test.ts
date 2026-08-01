import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initDatabase, openDatabase } from "./database.js";
import {
  buildPackage,
  splitForParsing,
  splitMarkdownByHeadings,
} from "./package-builder.js";

describe("buildPackage", () => {
  beforeAll(async () => {
    await initDatabase();
  });

  const testDbPath = join(tmpdir(), `test-package-${Date.now()}.db`);

  afterEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it("creates a valid package database", () => {
    const files = [
      {
        path: "docs/intro.md",
        content: `---
title: Introduction
---

# Getting Started

## Overview

This is the overview section.

## Installation

Run the install command.
`,
      },
    ];

    const result = buildPackage(testDbPath, files, {
      name: "test-lib",
      version: "1.0.0",
      description: "A test library",
      sourceUrl: "https://github.com/test/test-lib",
    });

    expect(result.path).toBe(testDbPath);
    expect(result.sectionCount).toBeGreaterThan(0);

    // Verify database structure
    const db = openDatabase(testDbPath, { readonly: true });
    try {
      // Check metadata
      const name = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("name") as { value: string };
      expect(name.value).toBe("test-lib");

      const version = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("version") as { value: string };
      expect(version.value).toBe("1.0.0");

      const description = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("description") as { value: string };
      expect(description.value).toBe("A test library");

      // Check chunks exist
      const chunkCount = db
        .prepare("SELECT COUNT(*) as count FROM chunks")
        .get() as { count: number };
      expect(chunkCount.count).toBeGreaterThan(0);

      // Check FTS index works
      const ftsResults = db
        .prepare("SELECT * FROM chunks_fts WHERE chunks_fts MATCH ?")
        .all("overview");
      expect(ftsResults.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("handles multiple files", () => {
    const files = [
      {
        path: "docs/intro.md",
        content:
          "# Intro\n\n## Getting Started\n\nThis is where you begin your journey with the library.",
      },
      {
        path: "docs/api.md",
        content:
          "# API\n\n## Methods\n\nThis section documents all the available API methods and their parameters.",
      },
    ];

    const result = buildPackage(testDbPath, files, {
      name: "multi-file",
      version: "2.0.0",
    });

    expect(result.sectionCount).toBeGreaterThanOrEqual(2);
  });

  it("skips a file that cannot be split, and says how many it skipped", () => {
    // Splitting used to run outside the per-file guard, so anything it threw on took
    // the whole registry build down with it instead of costing one document.
    const files = [
      {
        path: "docs/valid.md",
        content:
          "# Valid\n\n## Section\n\nThis is a valid markdown file with sufficient content for indexing.",
      },
      { path: "docs/broken.md", content: undefined as unknown as string },
    ];

    const result = buildPackage(testDbPath, files, {
      name: "skip-unsplittable",
      version: "1.0.0",
    });

    expect(result.sectionCount).toBeGreaterThan(0);
    expect(result.skippedFiles).toBe(1);
  });

  it("skips files that fail to parse", () => {
    const files = [
      {
        path: "docs/valid.md",
        content:
          "# Valid\n\n## Section\n\nThis is a valid markdown file with sufficient content for indexing.",
      },
      {
        path: "docs/binary.png",
        content: "\x89PNG\r\n\x1a\n", // Binary content that will fail markdown parsing
      },
    ];

    // Should not throw
    const result = buildPackage(testDbPath, files, {
      name: "skip-invalid",
      version: "1.0.0",
    });

    expect(result.sectionCount).toBeGreaterThan(0);
  });

  it("overwrites existing database", () => {
    // Create initial package
    buildPackage(testDbPath, [], { name: "old", version: "1.0.0" });

    // Overwrite with new package
    const result = buildPackage(
      testDbPath,
      [{ path: "docs/new.md", content: "# New\n\n## Section\n\nNew content." }],
      { name: "new", version: "2.0.0" },
    );

    // Verify new package
    const db = openDatabase(testDbPath, { readonly: true });
    try {
      const name = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("name") as { value: string };
      expect(name.value).toBe("new");
    } finally {
      db.close();
    }

    expect(result.path).toBe(testDbPath);
  });

  it("deduplicates sections with identical content from different files", () => {
    // Simulate the vercel/ai repo scenario where multiple README.md files
    // have the same "Skill for Coding Agents" section
    const sharedContent = `If you use coding agents such as Claude Code or Cursor, we highly recommend adding the AI SDK skill to your repository.`;

    const files = [
      {
        path: "packages/deepseek/README.md",
        content: `# DeepSeek Provider\n\n## Overview\n\nDeepSeek provider for the AI SDK.\n\n## Skill for Coding Agents\n\n${sharedContent}`,
      },
      {
        path: "packages/elevenlabs/README.md",
        content: `# ElevenLabs Provider\n\n## Overview\n\nElevenLabs provider for the AI SDK.\n\n## Skill for Coding Agents\n\n${sharedContent}`,
      },
      {
        path: "packages/fal/README.md",
        content: `# Fal Provider\n\n## Overview\n\nFal provider for the AI SDK.\n\n## Skill for Coding Agents\n\n${sharedContent}`,
      },
    ];

    const result = buildPackage(testDbPath, files, {
      name: "test-dedup",
      version: "1.0.0",
    });

    // Verify that the shared section is only stored once
    const db = openDatabase(testDbPath, { readonly: true });
    try {
      const sharedSections = db
        .prepare(
          "SELECT doc_path, section_title FROM chunks WHERE section_title = ?",
        )
        .all("Skill for Coding Agents") as { doc_path: string }[];

      // Should only have 1 entry, not 3
      expect(sharedSections.length).toBe(1);
      // First occurrence wins (deepseek)
      expect(sharedSections[0].doc_path).toBe("packages/deepseek/README.md");

      // Overview sections should all be kept since content differs
      const overviewSections = db
        .prepare("SELECT doc_path FROM chunks WHERE section_title = ?")
        .all("Overview") as { doc_path: string }[];
      expect(overviewSections.length).toBe(3);
    } finally {
      db.close();
    }

    // 3 unique Overview sections + 1 shared "Skill for Coding Agents" = 4 sections
    expect(result.sectionCount).toBe(4);
  });

  it("deduplicates sections with same content but different titles", () => {
    const sharedContent = `This is the shared installation instructions for all packages.`;

    const files = [
      {
        path: "packages/a/README.md",
        content: `# Package A\n\n## Getting Started\n\n${sharedContent}`,
      },
      {
        path: "packages/b/README.md",
        content: `# Package B\n\n## Installation\n\n${sharedContent}`,
      },
    ];

    buildPackage(testDbPath, files, {
      name: "test-content-dedup",
      version: "1.0.0",
    });

    const db = openDatabase(testDbPath, { readonly: true });
    try {
      // Content is identical, so only one should be stored (even though titles differ)
      const sections = db
        .prepare("SELECT doc_path, section_title FROM chunks WHERE content = ?")
        .all(sharedContent) as { doc_path: string; section_title: string }[];

      expect(sections.length).toBe(1);
      // First occurrence wins
      expect(sections[0].doc_path).toBe("packages/a/README.md");
      expect(sections[0].section_title).toBe("Getting Started");
    } finally {
      db.close();
    }
  });

  it("keeps sections with same title but different content", () => {
    const files = [
      {
        path: "packages/a/README.md",
        content: `# Package A\n\n## Installation\n\nInstall package A with npm install a.`,
      },
      {
        path: "packages/b/README.md",
        content: `# Package B\n\n## Installation\n\nInstall package B with npm install b.`,
      },
    ];

    buildPackage(testDbPath, files, {
      name: "test-same-title",
      version: "1.0.0",
    });

    const db = openDatabase(testDbPath, { readonly: true });
    try {
      const sections = db
        .prepare("SELECT doc_path FROM chunks WHERE section_title = ?")
        .all("Installation") as { doc_path: string }[];

      // Both should be kept since content differs
      expect(sections.length).toBe(2);
    } finally {
      db.close();
    }
  });

  it("extracts sections from representative HTML pages", () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Blog Post</title></head>
<body>
<nav><a href="/">Home</a></nav>
<article>
<h1>Things I Don't Know as of 2018</h1>
<p>People often assume that I know way more than I actually do.</p>
<h2>Backend</h2>
<p>I don't know how to configure a Linux server.</p>
<h2>CSS</h2>
<p>I can't center a div without googling.</p>
</article>
<footer>Copyright 2018</footer>
<script>console.log('hi');</script>
</body>
</html>`;

    const result = buildPackage(
      testDbPath,
      [{ path: "example.com/post.html", content: html }],
      { name: "test-html", version: "1.0.0" },
    );

    expect(result.sectionCount).toBeGreaterThan(0);

    const db = openDatabase(testDbPath, { readonly: true });
    try {
      const chunks = db
        .prepare("SELECT section_title FROM chunks ORDER BY id")
        .all() as { section_title: string }[];

      expect(chunks.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  // A page with `h1` + `h3`, or with div-based headings, has no `##`/`<h2>` anywhere,
  // so the whole document is one "Introduction" section. Split for parsing, each chunk
  // used to restart the part counter and repeat the same run of titles.
  it.each([
    [
      "flat.md",
      "---\ntitle: Flat Guide\n---\n\n# Flat Guide\n\n",
      (i: number) => `### Item ${i}\n\n${`w${i} `.repeat(600)}\n\n`,
    ],
    [
      "flat.html",
      "<html><body><h1>Flat Guide</h1>",
      (i: number) => `<h3>Item ${i}</h3><p>${`w${i} `.repeat(600)}</p>`,
    ],
  ])("numbers %s parts continuously across a split", (path, head, block) => {
    let content = head;
    for (let i = 0; content.length < 1.1 * 1024 * 1024; i++)
      content += block(i);
    // Or the file was never split and the rest of this proves nothing.
    expect(splitForParsing({ path, content }).length).toBeGreaterThan(1);

    buildPackage(testDbPath, [{ path, content }], {
      name: "test-parts",
      version: "1.0.0",
    });

    const db = openDatabase(testDbPath, { readonly: true });
    try {
      const rows = db
        .prepare("SELECT section_title, doc_title FROM chunks ORDER BY id")
        .all() as { section_title: string; doc_title: string }[];

      expect(rows.map((r) => r.section_title)).toEqual(
        rows.map((_, i) =>
          i ? `Introduction (part ${i + 1})` : "Introduction",
        ),
      );
      // Frontmatter must reach continuation chunks too, or they index under the filename.
      expect(new Set(rows.map((r) => r.doc_title))).toEqual(
        new Set([path === "flat.md" ? "Flat Guide" : "flat.html"]),
      );
    } finally {
      db.close();
    }
  });

  it("restarts numbering at a section the split did not cut through", () => {
    // Only a chunk's leading run, under the heading carried across the cut, continues
    // the previous chunk. `## Second` is a section of the document's own.
    let body = "";
    for (let i = 0; body.length < 1.1 * 1024 * 1024; i++)
      body += `${`w${i} `.repeat(600)}\n\n`;

    buildPackage(
      testDbPath,
      [
        {
          path: "two.md",
          content: `## First\n\n${body}## Second\n\nA short closing section of prose.`,
        },
      ],
      { name: "test-parts-reset", version: "1.0.0" },
    );

    const db = openDatabase(testDbPath, { readonly: true });
    try {
      const titles = (
        db.prepare("SELECT section_title FROM chunks ORDER BY id").all() as {
          section_title: string;
        }[]
      ).map((r) => r.section_title);

      expect(titles.at(-2)).toMatch(/^First \(part \d+\)$/);
      expect(titles.at(-1)).toBe("Second");
    } finally {
      db.close();
    }
  });
});

describe("splitMarkdownByHeadings", () => {
  it("splits into preamble + one part per ## heading", () => {
    const file = {
      path: "test.txt",
      content: "# Docs\n\nIntro.\n\n## Workers\n\nA.\n\n## Pages\n\nB.",
    };
    const result = splitMarkdownByHeadings(file);

    expect(result).toHaveLength(3);
    expect(result[0]?.content).toContain("Intro.");
    expect(result[0]?.content).not.toContain("## Workers");
    expect(result[1]?.content).toMatch(/^## Workers/);
    expect(result[2]?.content).toMatch(/^## Pages/);
  });

  it("returns the file unchanged when there is nothing to split", () => {
    const noHeadings = { path: "a.md", content: "# Title\n\nOne section." };
    const single = { path: "b.txt", content: "## Only\n\nContent." };

    expect(splitMarkdownByHeadings(noHeadings)).toEqual([noHeadings]);
    expect(splitMarkdownByHeadings(single)).toEqual([single]);
  });

  it("ignores ## lines inside fenced code blocks", () => {
    const file = {
      path: "docs.md",
      content: [
        "## Real",
        "",
        "```markdown",
        "## Not a heading",
        "```",
        "",
        "## Also real",
      ].join("\n"),
    };
    const result = splitMarkdownByHeadings(file);

    expect(result).toHaveLength(2);
    expect(result[0]?.content).toContain("## Not a heading");
    expect(result[0]?.content).toContain("```markdown\n## Not a heading\n```");
    expect(result[1]?.content).toMatch(/^## Also real/);
  });

  it("tracks ~~~ fences and longer closing fences", () => {
    const file = {
      path: "docs.md",
      content: [
        "## Real",
        "",
        "~~~",
        "## Inside tilde fence",
        "~~~",
        "",
        "````",
        "```",
        "## Inside nested fence",
        "````",
        "",
        "## After", // proves the fences actually closed, not just that nothing split
      ].join("\n"),
    };

    const result = splitMarkdownByHeadings(file);

    expect(result).toHaveLength(2);
    expect(result[1]?.content).toMatch(/^## After/);
  });

  it("does not let an info-string line close an open fence", () => {
    // CommonMark: an opening fence may carry an info string, a closing fence may not.
    const file = {
      path: "docs.md",
      content: [
        "## Real",
        "",
        "```",
        "```js",
        "## Still inside the block",
        "```",
        "",
        "## After",
      ].join("\n"),
    };

    const result = splitMarkdownByHeadings(file);

    expect(result).toHaveLength(2);
    expect(result[0]?.content).toContain("## Still inside the block");
    expect(result[1]?.content).toMatch(/^## After/);
  });

  it("recognises indented and tab-separated ## headings", () => {
    const file = {
      path: "docs.md",
      content: "## A\nx\n   ## B\ny\n##\tC\nz",
    };

    expect(splitMarkdownByHeadings(file)).toHaveLength(3);
  });

  it("keeps doc path on every part", () => {
    const file = {
      path: "cloudflare.com/llms-full.txt",
      content: "## Workers\nA.\n\n## Pages\nB.",
    };

    for (const part of splitMarkdownByHeadings(file)) {
      expect(part.path).toBe("cloudflare.com/llms-full.txt");
    }
  });
});

describe("splitForParsing", () => {
  const oversized = (body: string) => body.repeat(Math.ceil(2e6 / body.length));

  it("leaves files under the size threshold alone", () => {
    const file = { path: "small.md", content: "## A\nx\n\n## B\ny" };
    expect(splitForParsing(file)).toEqual([file]);
  });

  it("bounds chunk size for a large file with no headings", () => {
    const file = { path: "flat.txt", content: oversized("no headings here\n") };
    const result = splitForParsing(file);

    expect(result.length).toBeGreaterThan(1);
    for (const part of result) {
      expect(part.content.length).toBeLessThanOrEqual(1024 * 1024);
    }
  });

  it("bounds chunk size when a single ## section is still too large", () => {
    const file = {
      path: "huge.txt",
      content: `## One\n${oversized("filler line\n")}\n## Two\nsmall`,
    };
    const result = splitForParsing(file);

    for (const part of result) {
      expect(part.content.length).toBeLessThanOrEqual(1024 * 1024);
    }
    expect(result.at(-1)?.content).toMatch(/^## Two/);
  });

  it("bounds a single line longer than the limit", () => {
    // Nothing about line structure bounds a base64 blob or a minified sample.
    const file = { path: "blob.md", content: "x".repeat(3 * 1024 * 1024) };
    const result = splitForParsing(file);

    expect(result.length).toBeGreaterThan(1);
    for (const part of result) {
      expect(part.content.length).toBeLessThanOrEqual(1024 * 1024);
    }
  });

  it("carries frontmatter and section heading into continuation chunks", () => {
    // Both feed doc_title / section_title, so a continuation must not lose them.
    const file = {
      path: "doc.md",
      content: `---\ntitle: Real Title\n---\n\n## One\n${oversized("filler line\n")}\n## Two\nsmall`,
    };
    const result = splitForParsing(file);

    for (const part of result.slice(1)) {
      expect(part.content).toMatch(/^---\ntitle: Real Title\n---\n/);
    }
    // Continuations of the oversized section keep its heading.
    expect(result[2]?.content).toContain("## One");
  });

  it("never line-splits formats that parse by line scanning", () => {
    for (const path of ["big.rst", "big.adoc"]) {
      const file = { path, content: oversized("plain text\n") };
      expect(splitForParsing(file)).toEqual([file]);
    }
  });

  it("splits uppercase extensions that still route to the markdown parser", () => {
    // parseDocument's checks are case-sensitive, so .RST is parsed as markdown.
    const file = { path: "big.RST", content: oversized("plain text\n") };
    expect(splitForParsing(file).length).toBeGreaterThan(1);
  });
});

describe("splitForParsing (HTML)", () => {
  const MAX = 1024 * 1024;
  const words = (count: number) => "word ".repeat(count);
  const sections = (count: number) =>
    Array.from(
      { length: count },
      (_, i) =>
        `<section><h2>S${i}</h2><p>${"word ".repeat(200)}</p></section>`,
    ).join("");
  /** How many `<tag>` are still open at the end of `text`. */
  const depth = (text: string, tag: string) =>
    (text.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length -
    (text.match(new RegExp(`</${tag}[\\s>]`, "g")) ?? []).length;

  it("cuts an oversized page at section starts", () => {
    const file = {
      path: "big.html",
      content: `<html><body>${sections(1200)}</body></html>`,
    };
    const result = splitForParsing(file);

    expect(result.length).toBeGreaterThan(1);
    for (const part of result) {
      expect(part.content.length).toBeLessThanOrEqual(MAX);
    }
    // Cutting at the matching `</h2>` instead would strand the heading in the
    // previous chunk, leaving its section titled "Introduction".
    for (const part of result.slice(1)) {
      expect(part.content).toMatch(/^<h2[\s>]/);
    }
    // Nothing may be dropped or duplicated at a boundary.
    expect(result.map((p) => p.content).join("")).toBe(file.content);
  });

  it("keeps cuts out of scripts, comments and raw text", () => {
    // A cut inside any of them loses text rather than splitting it: the truncated
    // element swallows the rest of its chunk and its tail returns in the next as
    // prose. The markup inside each is what a cut would be tempted by; `<TEXTAREA>`
    // also pins the close-tag search staying case-insensitive.
    const pad = `<p>${"word ".repeat(200)}</p>`.repeat(1000);

    for (const body of [
      `<script>${"var x = '<h2>';".repeat(20000)}</script>`,
      `<!-- <h2>old heading</h2>${"<p>draft</p>".repeat(25000)} -->`,
      `<TEXTAREA>${"<h2>sample</h2>".repeat(20000)}</TEXTAREA>`,
    ]) {
      // `pad` alone fits a chunk, so the element always straddles a boundary.
      const result = splitForParsing({
        path: "big.html",
        content: pad + body + pad,
      });

      expect(result.length).toBeGreaterThan(1);
      expect(result.filter((p) => p.content.includes(body))).toHaveLength(1);
    }
  });

  it("keeps cuts out of the elements the HTML parser strips", () => {
    // A cut inside one leaves its opening tag in the previous chunk, so the next
    // chunk's parser never sees it: the sidebar is converted to prose and indexed,
    // and a heading the whole-file parse dropped comes back as a section title.
    const unit = (i: number) =>
      `<article><header><h2>Chrome${i}</h2></header>` +
      `<h2>S${i}</h2><p>${words(60)}</p></article>` +
      // `src=foo/` is one unquoted attribute value, so this iframe is open, not
      // self-closing. Reading it as closed lets its `</iframe>` cancel the aside.
      `<aside><iframe src=foo/>${words(5)}</iframe>` +
      `<aside><p>${words(10)}</p></aside>` +
      `<h2>Sidebar${i}</h2><p>${words(120)}</p></aside>`;
    const content = Array.from({ length: 1400 }, (_, i) => unit(i)).join("");
    const result = splitForParsing({ path: "big.html", content });

    // Nesting is why the scan tracks what is open rather than searching for the next
    // close tag: the inner `</aside>` does not end the outer one.
    expect(result.length).toBeGreaterThan(1);
    for (const [i, part] of result.entries()) {
      const before = result
        .slice(0, i)
        .map((p) => p.content)
        .join("");
      expect(depth(before, "aside")).toBe(0);
      expect(depth(before, "header")).toBe(0);
      expect(part.content.length).toBeLessThanOrEqual(MAX);
    }
  });

  it("ignores a close tag that matches nothing open", () => {
    // `</header>` inside an `<aside>` closes nothing. Counting it against the aside
    // ends that element's suppression early, and a cut then lands inside the aside:
    // its opening tag stays in the previous chunk, `turndown.remove` stops applying,
    // and the sidebar is indexed as prose. Measured before the open elements were
    // tracked by name: 1, 1, 0, 4, 0, 0 and 5 leaked sections over a 2.8-9.7MB sweep.
    const content = Array.from(
      { length: 6000 },
      (_, i) =>
        `<h2>S${i}</h2><p>${words(50)}</p>` +
        `<aside><p>x</p></header><h2>Sidebar${i}</h2><p>${words(50)}</p></aside>`,
    ).join("");
    const result = splitForParsing({ path: "big.html", content });

    expect(result.length).toBeGreaterThan(1);
    for (const [i, part] of result.entries()) {
      const before = result
        .slice(0, i)
        .map((p) => p.content)
        .join("");
      expect(depth(before, "aside")).toBe(0);
      expect(part.content.length).toBeLessThanOrEqual(MAX);
    }
  });

  it("drops what follows a stripped raw-text element that never closes", () => {
    // Everything after an unterminated `<script>` is its text content — that is what
    // the whole-file parse makes of it, and turndown drops the element — so chunking
    // the tail hands raw JavaScript to the parser as prose and resurrects sections the
    // page never had. `<textarea>` is raw text too but is not stripped, so its tail is
    // real content and has to survive.
    const tail = `<h2>TAIL</h2><p>${words(200)}</p>`.repeat(200);

    // `<title attr=x/>` is here because an unquoted attribute value swallows the `/`,
    // so it is an *open* tag and must still truncate. Reading it as self-closing keeps
    // a tail the parser never had.
    for (const tag of ["script", "style", "title", "title attr=x/"]) {
      const result = splitForParsing({
        path: "big.html",
        content: `${sections(1100)}<${tag}>x${tail}`,
      });

      const kept = result.map((p) => p.content).join("");
      expect(kept).toContain("<h2>S0</h2>");
      expect(kept).not.toContain("<h2>TAIL</h2>");
    }

    const keptTextarea = splitForParsing({
      path: "big.html",
      content: `${sections(1100)}<textarea>x${tail}`,
    })
      .map((p) => p.content)
      .join("");
    expect(keptTextarea).toContain("<h2>TAIL</h2>");

    // A page whose script opens and never closes holds no content at all, which is
    // also exactly what parsing it whole yields.
    expect(
      splitForParsing({
        path: "big.html",
        content: `<script>${"var q = 2;\n".repeat(120000)}`,
      }),
    ).toHaveLength(0);
  });

  it("keeps the tail when a stripped raw-text element closes itself", () => {
    // `<svg><title/></svg>` is well-formed, and inline SVG is common in a page big
    // enough to split. Reading that `<title/>` as open would truncate the document
    // at it — deleting every section after — since no `</title>` ever follows.
    const tail = `<h2>TAIL</h2><p>${words(200)}</p>`.repeat(200);

    for (const open of ["<title/>", "<title />", "<script/>", "<style/>"]) {
      const result = splitForParsing({
        path: "big.html",
        content: `${sections(1100)}<svg>${open}</svg>${tail}`,
      });

      // Under the cap the file comes back whole and `toContain` passes for free.
      expect(result.length).toBeGreaterThan(1);
      expect(result.map((p) => p.content).join("")).toContain("<h2>TAIL</h2>");
    }
  });

  it("runs a CDATA section to ]]>, not to the first >", () => {
    // `<![CDATA[ a > <script> ]]>` holds a `>` in its body. Ending the section there
    // exposes the `<script>` as a real unterminated element and truncates the document.
    const tail = `<h2>TAIL</h2><p>${words(200)}</p>`.repeat(200);
    const result = splitForParsing({
      path: "big.html",
      content: `${sections(1100)}<svg><![CDATA[ a > <script> ]]></svg>${tail}`,
    });

    expect(result.length).toBeGreaterThan(1);
    expect(result.map((p) => p.content).join("")).toContain("<h2>TAIL</h2>");
  });

  it("does not read the body of a bogus comment as markup", () => {
    // `<!foo …>` and `<?php …?>` end at the next `>` and hold no markup. Scanning in
    // finds a `<script>` that never closes and truncates the document at it.
    const tail = `<h2>TAIL</h2><p>${words(200)}</p>`.repeat(200);

    for (const bogus of ["<!foo <script> bar>", '<?php echo "<script>"; ?>']) {
      const result = splitForParsing({
        path: "big.html",
        content: `${sections(1100)}${bogus}${tail}`,
      });

      // Under the cap the file comes back whole and `toContain` passes for free.
      expect(result.length).toBeGreaterThan(1);
      expect(result.map((p) => p.content).join("")).toContain("<h2>TAIL</h2>");
    }
  });

  it("reads markup inside an attribute value as an attribute value", () => {
    // An HTML parser sees quoted text here; a scan that resumes inside the tag it has
    // just yielded sees markup. Either way of acting on a phantom `<script>` loses a
    // well-formed page: suppression it opens and never closes starves the splitter of
    // candidates until a chunk begins at the `<` inside the attribute, and turndown
    // then drops that entire chunk as script text — 1008 of 1200 sections at the first
    // title below. The second is why a back-search for an enclosing tag is not enough:
    // the `>` closing `<b>` makes the `<script` look like real markup, and the whole
    // document is given up as an unterminated script.
    for (const title of ['"<script>"', '"<b><script>"', "'<b><script>'"]) {
      const content = `<div title=${title}>${sections(1200)}`;
      const result = splitForParsing({ path: "big.html", content });

      expect(result.map((p) => p.content).join("")).toContain("<h2>S1199</h2>");
      // A chunk that starts anywhere but a heading started inside the attribute.
      for (const part of result.slice(1)) {
        expect(part.content).toMatch(/^<h2[\s>]/);
      }
    }
  });

  it("recovers cut points after an element that is never closed", () => {
    // Suppressing candidates to the end of the file would leave every later cut
    // blind and landing mid-tag. An unclosed element costs only the chunk it opens.
    const file = {
      path: "big.html",
      content: `<nav><p>menu</p>${sections(2600)}`,
    };
    const result = splitForParsing(file);

    expect(result.length).toBeGreaterThan(2);
    for (const part of result.slice(2)) {
      expect(part.content).toMatch(/^<h2[\s>]/);
    }
  });

  it("keeps a self-closing stripped element from suppressing cut points", () => {
    // `<svg/>` is over the moment it opens, so every candidate after it still counts.
    const file = {
      path: "big.html",
      content: `<svg/><svg />${sections(2600)}`,
    };

    for (const part of splitForParsing(file).slice(1)) {
      expect(part.content).toMatch(/^<h2[\s>]/);
    }
  });

  it("scans a hostile page once, not once per tag", () => {
    // Both searches driven by these tags — for a `</textarea`, and for the `>` that
    // would end a `<svg ` — are monotone in the offset, so each may only be resumed.
    // Restarted per tag they are quadratic: 40s and 1.4s at 1MB, 5.4min and 25s at 3MB.
    // A page that stalls the split stalls the whole registry build behind it.
    for (const content of [
      "<textarea ".repeat(120000),
      "<svg ".repeat(400000),
      // Not only the fruitless search: a `>` the scan has already passed is just as
      // costly to look for again.
      `${"<svg ".repeat(400000)}>`,
    ]) {
      expect(
        splitForParsing({ path: "hostile.html", content }).length,
      ).toBeGreaterThan(1);
    }

    // The same page made of `<script ` costs even less: the first one never closes, so
    // the rest of the file is its text and there is nothing further to scan or chunk.
    expect(
      splitForParsing({
        path: "hostile.html",
        content: "<script ".repeat(140000),
      }),
    ).toHaveLength(0);
  }, 3000);

  it("carries a chunk's own heading into its continuations, and only its own", () => {
    // Mirrors the markdown path, which would otherwise title these "Introduction".
    // Only the opening heading: any later `<h2>` may be one the parser was going to
    // strip, and promoting that would index page chrome as a section title.
    const file = {
      path: "big.html",
      content: `<h2>Only</h2><header><h2>Chrome</h2></header><p>${words(600000)}</p>`,
    };
    const result = splitForParsing(file);

    expect(result.length).toBeGreaterThan(1);
    for (const part of result) {
      expect(part.content.startsWith("<h2>Only</h2>")).toBe(true);
      expect(part.content.length).toBeLessThanOrEqual(MAX);
    }
  });

  it("bounds a stretch of markup with no tag to cut at", () => {
    // No trailing close tag, so only the bound after the last tag ends this.
    const file = { path: "blob.htm", content: `<p>${"x".repeat(3 * MAX)}` };
    const result = splitForParsing(file);

    expect(result.length).toBeGreaterThan(1);
    for (const part of result) {
      expect(part.content.length).toBeLessThanOrEqual(MAX);
    }
  });

  it("never cuts a blind chunk through a surrogate pair", () => {
    // Halving one would turn a single emoji into two U+FFFD.
    for (const path of ["blob.htm", "blob.md"]) {
      for (const part of splitForParsing({
        path,
        content: `x${"😀".repeat(MAX)}`,
      })) {
        expect(part.content).not.toMatch(/[\uD800-\uDBFF]$/);
        expect(part.content).not.toMatch(/^[\uDC00-\uDFFF]/);
      }
    }
  });
});
