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

    // Nesting is why the scan counts depth rather than searching for the next close
    // tag: the inner `</aside>` does not end the outer one.
    const depth = (text: string, tag: string) =>
      (text.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length -
      (text.match(new RegExp(`</${tag}[\\s>]`, "g")) ?? []).length;

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
    // Both searches driven by these tags — for a `</script`, and for the `>` that
    // would end a `<svg ` — are monotone in the offset, so each may only be resumed.
    // Restarted per tag they are quadratic: 40s and 1.4s at 1MB, 5.4min and 25s at 3MB.
    // `buildPackage` splits outside its per-file `try` and with no timeout, so a single
    // malformed page stalls the whole registry build.
    for (const content of [
      "<script ".repeat(140000),
      "<svg ".repeat(400000),
      // Not only the fruitless search: a `>` the scan has already passed is just as
      // costly to look for again.
      `${"<svg ".repeat(400000)}>`,
    ]) {
      expect(
        splitForParsing({ path: "hostile.html", content }).length,
      ).toBeGreaterThan(1);
    }
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
