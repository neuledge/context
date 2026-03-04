import { describe, expect, it } from "vitest";
import {
  parseAsciidoc,
  parseDocument,
  parseMarkdown,
  parseRestructuredText,
} from "./build.js";

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

describe("parseAsciidoc", () => {
  it("extracts document title and sections", () => {
    const source = `= Getting Started Guide

== Installation

Install the package using your package manager of choice.

== Configuration

Configure the application by editing the config file.

== Usage

Use the library by importing it into your project.
`;

    const result = parseAsciidoc(source, "docs/getting-started.adoc");

    expect(result.frontmatter.title).toBe("Getting Started Guide");
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].sectionTitle).toBe("Installation");
    expect(result.sections[1].sectionTitle).toBe("Configuration");
    expect(result.sections[2].sectionTitle).toBe("Usage");
  });

  it("extracts attributes as frontmatter", () => {
    const source = `:doctitle: My API Reference
:description: Complete API reference for the library

= My API Reference

== Methods

The library provides several useful methods for data manipulation.
`;

    const result = parseAsciidoc(source, "docs/api.adoc");

    expect(result.frontmatter.title).toBe("My API Reference");
    expect(result.frontmatter.description).toBe(
      "Complete API reference for the library",
    );
  });

  it("handles content before first section as Introduction", () => {
    const source = `= Guide

This is introductory content that appears before any section headings.

== First Section

Section content with enough text for the parser to recognize it properly.
`;

    const result = parseAsciidoc(source, "docs/guide.adoc");

    expect(result.sections[0].sectionTitle).toBe("Introduction");
    expect(result.sections[0].content).toContain("introductory content");
    expect(result.sections[1].sectionTitle).toBe("First Section");
  });

  it("falls back to filename when no title", () => {
    const source = `== Section One

This section has sufficient content for the parser to include it in the output.
`;

    const result = parseAsciidoc(source, "docs/my-feature.adoc");

    expect(result.sections[0].docTitle).toBe("my-feature");
  });

  it("detects code blocks", () => {
    const source = `= Code Examples

== With Code

Here is an example:

\`\`\`java
public class Main {}
\`\`\`

== Without Code

This section contains only plain text without any code blocks or examples.
`;

    const result = parseAsciidoc(source, "docs/code.adoc");

    expect(result.sections[0].hasCode).toBe(true);
    expect(result.sections[1].hasCode).toBe(false);
  });
});

describe("parseRestructuredText", () => {
  it("extracts sections with underline-style headings", () => {
    const source = `Getting Started
===============

Installation
------------

Install the package using pip install.

Configuration
-------------

Configure by editing settings.py in your project root.

Usage
-----

Import and use the library in your application code.
`;

    const result = parseRestructuredText(source, "docs/getting-started.rst");

    expect(result.frontmatter.title).toBe("Getting Started");
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].sectionTitle).toBe("Installation");
    expect(result.sections[1].sectionTitle).toBe("Configuration");
    expect(result.sections[2].sectionTitle).toBe("Usage");
  });

  it("handles different underline characters for heading hierarchy", () => {
    const source = `Document Title
==============

Section One
-----------

Content in section one with enough text for the parser.

Subsection
~~~~~~~~~~

This is a subsection and should be included as content.

Section Two
-----------

Content in section two with enough text for the parser to include it.
`;

    const result = parseRestructuredText(source, "docs/hierarchy.rst");

    expect(result.frontmatter.title).toBe("Document Title");
    // Subsection (~) content should be part of Section One, not a separate section
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].sectionTitle).toBe("Section One");
    expect(result.sections[0].content).toContain("subsection");
    expect(result.sections[1].sectionTitle).toBe("Section Two");
  });

  it("falls back to filename when no title heading", () => {
    const source = `Some plain text content that has enough length to meet the minimum token threshold for indexing.
`;

    const result = parseRestructuredText(source, "docs/my-module.rst");

    expect(result.frontmatter.title).toBe("my-module");
  });

  it("detects code blocks", () => {
    const source = `Guide
=====

With Code
---------

Here is an example of Python code:

\`\`\`python
def hello():
    print("hello")
\`\`\`

Without Code
------------

This section contains only plain text without any code blocks or examples.
`;

    const result = parseRestructuredText(source, "docs/guide.rst");

    expect(result.sections[0].hasCode).toBe(true);
    expect(result.sections[1].hasCode).toBe(false);
  });
});

describe("parseDocument", () => {
  it("dispatches .md files to parseMarkdown", () => {
    const source = `## Section

Content for the markdown parser to process and include in output.
`;

    const result = parseDocument(source, "docs/test.md");
    expect(result.sections[0].sectionTitle).toBe("Section");
  });

  it("dispatches .adoc files to parseAsciidoc", () => {
    const source = `= Title

== Section

Content for the asciidoc parser to process and include in output.
`;

    const result = parseDocument(source, "docs/test.adoc");
    expect(result.frontmatter.title).toBe("Title");
  });

  it("dispatches .rst files to parseRestructuredText", () => {
    const source = `Title
=====

Section
-------

Content for the restructuredtext parser to process and include.
`;

    const result = parseDocument(source, "docs/test.rst");
    expect(result.frontmatter.title).toBe("Title");
  });
});
