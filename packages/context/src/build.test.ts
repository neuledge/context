import { describe, expect, it } from "vitest";
import {
  parseAsciidoc,
  parseDocument,
  parseMarkdown,
  parseRestructuredText,
} from "./build.js";
import { parseHtml } from "./html.js";

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

  it("ignores non-string frontmatter title (malformed YAML)", () => {
    // Svelte 5's docs use unquoted titles like `{let/const ...}` that YAML
    // parses into an object, which must not leak into docTitle (it would break
    // SQLite parameter binding with "Too few parameter values were provided").
    const source = `---
title: {let/const ...}
---

## Declaration tags

Some content about declaration tags.
`;

    const result = parseMarkdown(source, "docs/declaration-tags.md");

    expect(result.frontmatter.title).toBeUndefined();
    // docTitle falls back to the filename-derived title
    expect(typeof result.sections[0]?.docTitle).toBe("string");
    expect(result.sections[0]?.docTitle).toBe("declaration-tags");
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

  it("keeps formatted and linked text in section titles", () => {
    const source = `## Using [superjson](https://github.com/blitz-js/superjson)

Serializes dates and maps.

## **Should I use \`generate\` or \`push\`?**

They are two different commands.

## The *strict* option

Turns on strict checks.
`;

    const result = parseMarkdown(source, "docs/faq.md");

    expect(result.sections.map((s) => s.sectionTitle)).toEqual([
      "Using superjson",
      "Should I use generate or push?",
      "The strict option",
    ]);
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

  it("uses the document's only h1 as docTitle when there is no frontmatter title", () => {
    const body = `## Creating jobs

The send() function creates a job and returns its id once it is stored.
`;

    const single = parseMarkdown(
      `# The [Jobs](#jobs) <Badge text="v10" /> API {#jobs-api}\n\n${body}`,
      "docs/api/jobs.md",
    );
    const several = parseMarkdown(
      `# Jobs\n\n${body}\n# Workers\n\n${body}`,
      "docs/llms-full.md",
    );
    const frontmatter = parseMarkdown(
      `---\ntitle: Job API\n---\n\n# Jobs\n\n${body}`,
      "docs/api/jobs.md",
    );

    expect(single.sections[0].docTitle).toBe("The Jobs API");
    for (const [h1, title] of [
      ["# Preface {.unnumbered}", "Preface"],
      ["# Blocks: `{#each}`", "Blocks: {#each}"],
    ]) {
      expect(
        parseMarkdown(`${h1}\n\n${body}`, "docs/a.qmd").sections[0].docTitle,
      ).toBe(title);
    }
    expect(several.sections[0].docTitle).toBe("llms-full");
    expect(frontmatter.sections[0].docTitle).toBe("Job API");
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

  it("keeps generics and JSX inside code while removing MDX component tags", () => {
    const source = `## Section

<AppOnly>
Call \`createClient<AppRouter>()\` to get a typed \`Promise<Response>\`.
</AppOnly>

\`\`\`tsx
const client = createClient<AppRouter>({});
root.render(<App />);
\`\`\`

~~~java
List<String> names = new ArrayList<String>();
~~~
`;

    const { content } = parseMarkdown(source, "docs/client.mdx").sections[0];

    expect(content).not.toContain("<AppOnly>");
    expect(content).toContain("`createClient<AppRouter>()`");
    expect(content).toContain("`Promise<Response>`");
    expect(content).toContain("const client = createClient<AppRouter>({});");
    expect(content).toContain("root.render(<App />);");
    expect(content).toContain("List<String> names = new ArrayList<String>();");
  });

  it("pairs code fences by line and length", () => {
    const source = `## Section

\`\`\`js
const fence = "\`\`\`";
render(<App />);
\`\`\`

Wrap code in \`\`\` fences.

<AppOnly>App router content.</AppOnly>

\`\`\`\`md
\`\`\`ts
\`\`\`
const client = createClient<AppRouter>();
\`\`\`\`

\`\`\`ts
const rest = createClient<AppRouter>();
`;

    const { content } = parseMarkdown(source, "docs/fences.mdx").sections[0];

    expect(content).not.toContain("<AppOnly>");
    expect(content).toContain("App router content.");
    expect(content).toContain("render(<App />);");
    expect(content).toContain("const client = createClient<AppRouter>();");
    expect(content).toContain("const rest = createClient<AppRouter>();");
  });

  it("keeps generics in a code block split across section parts", () => {
    const filler = `const value = compute("${"x".repeat(300)}");`;
    // Over the 1200-token hard limit: a smaller block is kept whole.
    const code = Array.from({ length: 20 }, () => filler).join("\n\n");
    const source = `## Setup\n\n\`\`\`ts\n${code}\n\nconst trpc = createTRPCClient<AppRouter>({});\n\`\`\`\n`;

    const { sections } = parseMarkdown(source, "docs/setup.md");

    expect(sections.length).toBeGreaterThan(1);
    expect(sections.at(-1)?.content).toContain(
      "createTRPCClient<AppRouter>({});",
    );
  });

  it("keeps generics inside code converted from HTML", () => {
    const { content } = parseHtml(
      '<h2>Section</h2><p>Returns <code>Optional&lt;User&gt;</code>.</p><pre><code class="language-java">Map&lt;String, List&lt;User&gt;&gt; byTeam;\nList&lt;User&gt; users;</code></pre>',
      "users.html",
    ).sections[0];

    expect(content).toContain("`Optional<User>`");
    expect(content).toContain("List<User> users;");
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

  it("keeps a code block with blank lines whole when splitting a section", () => {
    // Two paragraphs of ~250 tokens, then a ~520-token code block with blank lines
    // in it, so the 800-token budget runs out partway through the block.
    const prose = "This is a paragraph. ".repeat(50);
    const comment = `// ${"x".repeat(1000)}`;
    const code = [
      "```js",
      comment,
      "fastify.register(require('@fastify/mongodb'), { forceClose: true })",
      "",
      comment,
      "fastify.get('/user/:id', handler)",
      "```",
    ].join("\n");
    const source = `## Mongo\n\n${prose}\n\n${prose}\n\n<Tip>\n\n${code}\n\n</Tip>\n\n${prose}\n`;

    const { sections } = parseMarkdown(source, "docs/database.md");

    expect(sections.length).toBeGreaterThan(1);
    expect(sections.filter((s) => s.content.includes(code))).toHaveLength(1);
    for (const { content } of sections) {
      expect(content.match(/^```/gm)?.length ?? 0).toBeOneOf([0, 2]);
      expect(content).not.toContain("Tip>");
    }
  });

  // Three ~325-token pieces: over the 800-token budget, under the 1200 hard limit, so
  // the block stays in one section unless a blank line inside it is taken as a break.
  const piece = `// ${"x".repeat(1300)}`;
  it.each([
    ["a longer fence around a shorter one", "````md", "", "```", "````"],
    ["a tilde fence around a backtick one", "~~~md", "", "```", "~~~"],
    ["a fence around a line with an info string", "```md", "", "```js", "```"],
    ["a tilde fence", "~~~js", "", "// step", "~~~"],
    [
      "a fence in a list item",
      "-   Step one:\n    ```js",
      "    ",
      "    // step",
      "    ```",
    ],
    ["a fence after a list marker", "1. ```bash", "   ", "   echo b", "   ```"],
    [
      "a fence shown indented inside a block",
      "```md",
      "",
      "        ```",
      "```",
    ],
    ["a fence shown tab-indented inside a block", "```md", "", "\t```", "```"],
    ["a list item fence shown inside a block", "```md", "", "- ```", "```"],
    [
      "a fence closed at a tab stop after a list marker",
      "1. ```bash",
      "   ",
      "   echo b",
      "   \t```",
    ],
  ])("keeps %s whole when splitting", (_, open, indent, inner, close) => {
    const block = [
      open,
      indent + piece,
      inner,
      "",
      indent + piece,
      "",
      indent + piece,
      close,
    ].join("\n");

    const { sections } = parseMarkdown(`## Example\n\n${block}\n`, "docs/a.md");

    expect(sections.map((s) => s.content)).toEqual([block.trim()]);
  });

  it("keeps an indented code block in MDX tabs whole when splitting", () => {
    const piece = `    // ${"x".repeat(1300)}`;
    const source = `## Example\n\n<Tabs>\n  <Tab>\n    \`\`\`js\n${piece}\n\n${piece}\n\n${piece}\n    \`\`\`\n  </Tab>\n</Tabs>\n`;

    const { sections } = parseMarkdown(source, "docs/a.mdx");

    expect(sections).toHaveLength(1);
    expect(sections[0]?.content.match(/^ *```/gm)).toHaveLength(2);
  });

  it("still splits at lines that hold only MDX tags", () => {
    const prose = "This is a paragraph. ".repeat(40);
    const source = `## Notes\n\n${prose}\n<Tip>\n${prose}\n</Tip>\n${prose}\n<Note>\n${prose}\n</Note>\n${prose}\n`;

    const { sections } = parseMarkdown(source, "docs/notes.mdx");

    expect(sections.length).toBeGreaterThan(1);
    for (const { content, tokens } of sections) {
      expect(tokens).toBeLessThanOrEqual(800);
      expect(content).not.toContain("Tip>");
      expect(content).not.toContain("Note>");
    }
  });

  it("removes MDX tags inside a paragraph when splitting", () => {
    const prose = "This is a paragraph. ".repeat(40);
    const source = `## Notes\n\n${prose}\n\n<Tip>Run it twice.</Tip>\n\n${prose}\n\n${prose}\n\n${prose}\n`;

    const { sections } = parseMarkdown(source, "docs/notes.mdx");

    expect(sections.length).toBeGreaterThan(1);
    expect(sections.map((s) => s.content).join("\n")).toContain(
      "Run it twice.",
    );
    for (const { content } of sections) expect(content).not.toContain("Tip>");
  });

  it("still splits after a fence that never closes", () => {
    const prose = "This is a paragraph. ".repeat(40);
    // The only bare fence after it is indented too far to close it.
    const source = `## Install\n\nRun it:\n\`\`\`\n\n${prose}\n\n${prose}\n\n${prose}\n\n${prose}\n\n        \`\`\`\n`;

    const { sections } = parseMarkdown(source, "docs/install.md");

    expect(sections.length).toBeGreaterThan(1);
    for (const { tokens } of sections) expect(tokens).toBeLessThanOrEqual(800);
  });

  it("still splits at a line that opens with inline code", () => {
    const prose = "This is a paragraph. ".repeat(40);
    const source = `## Install\n\n\`\`\`npm i\`\`\` installs it.\n\n${prose}\n\n${prose}\n\n${prose}\n\n${prose}\n\n\`\`\`js\nrun();\n\`\`\`\n`;

    const { sections } = parseMarkdown(source, "docs/install.md");

    expect(sections.length).toBeGreaterThan(1);
    for (const { tokens } of sections) expect(tokens).toBeLessThanOrEqual(800);
  });

  it.each([
    ["a tilde fence", "~~~sh\nnpm i\n~~~", true],
    ["a fence in a blockquote", "> ```sh\n> npm i\n> ```", true],
    [
      "inline code in triple backticks",
      "```npm i``` installs it, and ```npm t``` tests it.",
      false,
    ],
  ])("sets hasCode for %s", (_, body, hasCode) => {
    const source = `## Install\n\nInstall it first.\n\n${body}\n`;

    const { sections } = parseMarkdown(source, "docs/install.md");

    expect(sections[0]?.hasCode).toBe(hasCode);
  });

  it("sets hasCode on each part of a code block cut at the hard limit", () => {
    const filler = `const value = compute("${"x".repeat(300)}");`;
    const code = Array.from({ length: 20 }, () => filler).join("\n\n");
    const source = `## Setup\n\n\`\`\`ts\n${code}\n\`\`\`\n`;

    const { sections } = parseMarkdown(source, "docs/setup.md");

    expect(sections.length).toBeGreaterThan(1);
    for (const { hasCode } of sections) expect(hasCode).toBe(true);
  });

  // Over the 1200-token hard limit only with the prose on the line before it, so the
  // block is kept whole only if the cut is made at its own fences.
  const row = (i: number) => `  value${i}: "${"x".repeat(200)}",`;
  const rows = Array.from({ length: 12 }, (_, i) => row(i)).join("\n");
  it.each([
    ["a tilde block", `~~~js\nconst config = {\n${rows}\n};\n~~~`],
    [
      "a block with fences in its comments",
      `\`\`\`ts\n/**\n * \`\`\`js\n * load();\n * \`\`\`\n */\nconst config = {\n${rows}\n};\n\`\`\``,
    ],
  ])("cuts a long paragraph at the edges of %s", (_, block) => {
    const prose = "This is a paragraph. ".repeat(130);
    const source = `## Example\n\n${prose}\n${block}\n`;

    const { sections } = parseMarkdown(source, "docs/a.md");

    expect(sections.map((s) => s.content)).toContain(block);
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

  it("keeps prose with long link URLs and skips a list of links", () => {
    const source = `## AWS Lambda adapter

The AWS Lambda adapter is supported for API Gateway [REST API(v1)](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-rest-api.html) and [HTTP API(v2)](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html) use cases.

## Guides

- [Installation](/docs/getting-started/installation)
- [Configuration](/docs/getting-started/configuration)
- [Deployment](/docs/getting-started/deployment)
`;

    const result = parseMarkdown(source, "docs/aws-lambda.md");

    expect(result.sections.map((s) => s.sectionTitle)).toEqual([
      "AWS Lambda adapter",
    ]);
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

  it("keeps generics in a section long enough to split", () => {
    const block = `[source,java]\n----\nList<String> names = load("${"x".repeat(300)}");\n----`;
    const source = `= Guide\n\n== Usage\n\n${Array(12).fill(block).join("\n\n")}\n`;

    const { sections } = parseAsciidoc(source, "docs/guide.adoc");

    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      expect(section.content).toContain("List<String> names");
    }
  });

  it("sets hasCode for a backtick fence", () => {
    const source = "= Guide\n\n== Usage\n\nRun it:\n\n```ruby\nputs 1\n```\n";

    const { sections } = parseAsciidoc(source, "docs/guide.adoc");

    expect(sections[0]?.hasCode).toBe(true);
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

  it("splits a long section with a ~ subheading at paragraphs", () => {
    const prose = "This is a paragraph. ".repeat(40);
    const source = `Title\n=====\n\nGuide\n-----\n\nInstall\n~~~~~~~\n\n${prose}\n\n${prose}\n\n${prose}\n\n${prose}\n\nUpdates\n~~~~~~~\n\n${prose}\n`;

    const { sections } = parseRestructuredText(source, "docs/guide.rst");

    expect(sections.length).toBeGreaterThan(1);
    for (const { tokens } of sections) expect(tokens).toBeLessThanOrEqual(800);
  });

  it("does not read ~ subheading underlines as code", () => {
    const prose = "This is a paragraph. ".repeat(40);
    const body = (text: string) =>
      `Title\n=====\n\nGuide\n-----\n\nInstall\n~~~~~~~\n\n${text}\n\nUpdates\n~~~~~~~\n\n${text}\n`;

    const short = parseRestructuredText(body("Use pip."), "docs/a.rst");
    const long = parseRestructuredText(body(`${prose}\n\n${prose}`), "b.rst");

    expect(long.sections.length).toBeGreaterThan(1);
    for (const { hasCode } of [...short.sections, ...long.sections]) {
      expect(hasCode).toBe(false);
    }
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

  it("dispatches .html files to parseHtml", () => {
    const source = `<html>
<head><title>HTML Doc</title></head>
<body>
<h1>HTML Doc</h1>
<h2>First Section</h2>
<p>Content in the first section of the HTML document for testing.</p>
</body>
</html>`;

    const result = parseDocument(source, "docs/test.html");
    expect(result.sections.length).toBeGreaterThanOrEqual(1);
    expect(result.sections[0].sectionTitle).toBe("First Section");
  });

  it("dispatches .htm files to parseHtml", () => {
    const source = `<html>
<body>
<h1>Title</h1>
<h2>Section</h2>
<p>Content for the htm parser to process and include in the output.</p>
</body>
</html>`;

    const result = parseDocument(source, "docs/test.htm");
    expect(result.sections[0].sectionTitle).toBe("Section");
  });
});

describe("parseHtml", () => {
  it("extracts h1 as doc title and h2 as section boundaries", () => {
    const source = `<html>
<head><title>API Reference</title></head>
<body>
<h1>API Reference</h1>
<h2>Authentication</h2>
<p>Use API keys to authenticate your requests to the service.</p>
<h2>Endpoints</h2>
<p>The following endpoints are available for interacting with the API.</p>
</body>
</html>`;

    const result = parseHtml(source, "docs/api.html");
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].sectionTitle).toBe("Authentication");
    expect(result.sections[1].sectionTitle).toBe("Endpoints");
    expect(result.sections[0].docTitle).toBe("API Reference");
  });

  it.each([
    ["Sphinx", '<a class="headerlink" href="#dictionary-objects">¶</a>'],
    [
      "Docusaurus",
      '<a class="hash-link" href="#dictionary-objects">\u200b</a>',
    ],
  ])("drops the %s permalink from an h1 doc title only", (_, anchor) => {
    const { sections } = parseHtml(
      `<p>Python 3.14 documentation, C API reference manual.</p><h1>Dictionary Objects${anchor}</h1><h2>Lookup</h2><p>PyDict_GetItem returns a borrowed reference.</p>`,
      "c-api/dict.html",
    );

    expect(sections[0].docTitle).toBe("Dictionary Objects");
    // The h1 is part of the Introduction here, whose content is left as it was.
    expect(sections[0].content).toContain("](#dictionary-objects)");
  });

  it("falls back to the file name without .html when there is no h1", () => {
    const { sections } = parseHtml(
      "<h2>Lookup</h2><p>PyDict_GetItem returns a borrowed reference.</p>",
      "c-api/dict.html",
    );

    expect(sections[0].docTitle).toBe("dict");
  });

  it("strips script, style, nav, and footer elements", () => {
    const source = `<html>
<head>
<style>body { color: red; }</style>
<script>alert('hi')</script>
</head>
<body>
<nav><a href="/">Home</a></nav>
<h1>Doc</h1>
<h2>Content</h2>
<p>This is the actual content that should be preserved in the output.</p>
<footer>Copyright 2024</footer>
</body>
</html>`;

    const result = parseHtml(source, "docs/test.html");
    expect(result.sections).toHaveLength(1);
    const content = result.sections[0].content;
    expect(content).not.toContain("alert");
    expect(content).not.toContain("color: red");
    expect(content).not.toContain("Copyright");
    expect(content).toContain("actual content");
  });

  it("preserves code blocks", () => {
    const source = `<html>
<body>
<h1>Guide</h1>
<h2>Example</h2>
<pre><code>const x = 1;
console.log(x);</code></pre>
</body>
</html>`;

    const result = parseHtml(source, "docs/guide.html");
    expect(result.sections[0].content).toContain("const x = 1");
    expect(result.sections[0].hasCode).toBe(true);
  });
});
