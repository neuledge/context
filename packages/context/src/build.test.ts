import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./build.js";

describe("parseMarkdown", () => {
  it("extracts frontmatter title and description", () => {
    const source = `---
title: Getting Started
description: Learn how to get started
---

# Getting Started

## Installation

Install the package.
`;

    const result = parseMarkdown(source, "docs/getting-started.md");

    expect(result.frontmatter.title).toBe("Getting Started");
    expect(result.frontmatter.description).toBe("Learn how to get started");
  });

  it("chunks content by h2 sections", () => {
    const source = `---
title: Routing
---

# Routing

## Pages

Pages are the basic unit.

## Layouts

Layouts wrap pages.

## Dynamic Routes

Use brackets for dynamic segments.
`;

    const result = parseMarkdown(source, "docs/routing.md");

    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].sectionTitle).toBe("Pages");
    expect(result.sections[1].sectionTitle).toBe("Layouts");
    expect(result.sections[2].sectionTitle).toBe("Dynamic Routes");
  });

  it("uses docTitle from frontmatter", () => {
    const source = `---
title: My Guide
---

## First Section

This section contains enough content to meet the minimum token threshold for indexing.
`;

    const result = parseMarkdown(source, "docs/guide.md");

    expect(result.sections[0].docTitle).toBe("My Guide");
  });

  it("falls back to filename when no frontmatter title", () => {
    const source = `## Section One

This section has sufficient content for the parser to include it in the output.
`;

    const result = parseMarkdown(source, "docs/my-feature.md");

    expect(result.sections[0].docTitle).toBe("my-feature");
  });

  it("detects code blocks", () => {
    const source = `---
title: Code Example
---

## With Code

Here is an example of TypeScript code:

\`\`\`typescript
const x = 1;
\`\`\`

## Without Code

This section contains only plain text without any code blocks or examples.
`;

    const result = parseMarkdown(source, "docs/code.md");

    expect(result.sections[0].hasCode).toBe(true);
    expect(result.sections[1].hasCode).toBe(false);
  });

  it("estimates tokens roughly", () => {
    const source = `---
title: Test
---

## Section

${"a".repeat(400)}
`;

    const result = parseMarkdown(source, "docs/test.md");

    // ~400 chars / 4 = ~100 tokens
    expect(result.sections[0].tokens).toBeGreaterThan(90);
    expect(result.sections[0].tokens).toBeLessThan(110);
  });

  it("removes MDX component tags", () => {
    const source = `---
title: MDX Test
---

## Section

<AppOnly>
App router content.
</AppOnly>

<PagesOnly>
Pages router content.
</PagesOnly>

Regular content.
`;

    const result = parseMarkdown(source, "docs/mdx.mdx");

    expect(result.sections[0].content).not.toContain("<AppOnly>");
    expect(result.sections[0].content).not.toContain("</AppOnly>");
    expect(result.sections[0].content).toContain("App router content");
    expect(result.sections[0].content).toContain("Regular content");
  });

  it("splits large sections at paragraph boundaries", () => {
    // Create content that exceeds MAX_CHUNK_TOKENS (800)
    const largeParagraph = "This is a paragraph. ".repeat(50); // ~1000 chars = ~250 tokens
    const source = `---
title: Large Doc
---

## Big Section

${largeParagraph}

${largeParagraph}

${largeParagraph}

${largeParagraph}
`;

    const result = parseMarkdown(source, "docs/large.md");

    // Should be split into multiple sections
    expect(result.sections.length).toBeGreaterThan(1);
    // Each section should be under the token limit
    for (const section of result.sections) {
      expect(section.tokens).toBeLessThanOrEqual(850); // Some buffer
    }
  });

  it("handles content before first h2 as Introduction", () => {
    const source = `---
title: Guide
---

Some intro text before any h2 heading that explains the purpose of this guide.

## First Section

This is the first section with sufficient content for the parser to recognize it.
`;

    const result = parseMarkdown(source, "docs/guide.md");

    expect(result.sections[0].sectionTitle).toBe("Introduction");
    expect(result.sections[0].content).toContain("intro text");
    expect(result.sections[1].sectionTitle).toBe("First Section");
  });

  it("preserves source path in sections", () => {
    const source = `---
title: Test
---

## Section

This section contains the API reference documentation for the module.
`;

    const result = parseMarkdown(source, "docs/api/reference.md");

    expect(result.sections[0].docPath).toBe("docs/api/reference.md");
  });
});
