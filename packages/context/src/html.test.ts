import { describe, expect, it } from "vitest";
import { parseHtml } from "./html.js";

describe("DocBook HTML examples", () => {
  it("preserves bare preformatted blocks, indentation and inline markup as code", () => {
    const parsed = parseHtml(
      `<h1>systemd.service</h1><h2>Example</h2>
      <pre class="programlisting">[Service]\nExecStart=/usr/bin/<em>example</em> \\\n        --flag=&lt;value&gt;</pre>`,
      "systemd.service.html",
    );
    expect(parsed.sections[0]?.hasCode).toBe(true);
    expect(parsed.sections[0]?.content).toContain(
      "[Service]\nExecStart=/usr/bin/example",
    );
    expect(parsed.sections[0]?.content).toContain("        --flag=<value>");
  });

  it("keeps backtick runs inside a single fenced code block", () => {
    const parsed = parseHtml(
      "<h1>Guide</h1><h2>Example</h2><pre>first\n```\nlast</pre>",
      "guide.html",
    );
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.hasCode).toBe(true);
    expect(parsed.sections[0]?.content).toContain(
      "````\nfirst\n```\nlast\n````",
    );
  });

  it("preserves language detection for existing pre/code blocks", () => {
    const parsed = parseHtml(
      '<h1>Guide</h1><h2>Example</h2><pre><code class="language-sh">echo hello</code></pre>',
      "guide.html",
    );
    expect(parsed.sections[0]?.content).toContain("```sh\necho hello\n```");
  });

  it.each([
    ["spaces", "  ", "  "],
    ["newlines", "\n  ", "\n"],
    ["tabs", "\t", "\t\n"],
    ["comments", "\n<!-- example -->\n  ", "\n<!-- end -->\n"],
  ])("preserves language and indentation with %s around code", (_, before, after) => {
    const parsed = parseHtml(
      `<h1>Guide</h1><h2>Example</h2><pre>${before}<code class="highlight language-sh">if true; then\n  echo hello\nfi\n</code>${after}</pre>`,
      "guide.html",
    );
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.hasCode).toBe(true);
    expect(parsed.sections[0]?.content).toBe(
      "```sh\nif true; then\n  echo hello\nfi\n```",
    );
  });

  it("keeps embedded backticks inside a language fence with wrapper whitespace", () => {
    const parsed = parseHtml(
      '<h1>Guide</h1><h2>Example</h2><pre>\n  <code class="language-markdown">first\n```\nlast</code>\n</pre>',
      "guide.html",
    );
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.hasCode).toBe(true);
    expect(parsed.sections[0]?.content).toBe(
      "````markdown\nfirst\n```\nlast\n````",
    );
  });

  it.each([
    [
      'prefix <code class="language-sh">echo hello</code> suffix',
      "prefix echo hello suffix",
    ],
    [
      '<span>prefix </span><code class="language-sh">echo hello</code>',
      "prefix echo hello",
    ],
    [
      '  <code class="language-sh">echo hello</code><code> suffix</code>',
      "  echo hello suffix",
    ],
  ])("preserves meaningful siblings in mixed preformatted content: %s", (content, expected) => {
    const parsed = parseHtml(
      `<h1>Guide</h1><h2>Example</h2><pre>${content}</pre>`,
      "guide.html",
    );
    expect(parsed.sections[0]?.content).toBe(`\`\`\`\n${expected}\n\`\`\``);
  });
});

describe("HTML headings", () => {
  it("keeps linked heading text and drops permalink anchors", () => {
    const parsed = parseHtml(
      `<h1>Design FAQ</h1>
      <h2><a class="toc-backref" href="#id3" role="doc-backlink">Why are Python strings immutable?</a><a class="headerlink" href="#why" title="Link to this heading">¶</a></h2>
      <p>There are several advantages.</p>
      <h3>Performance<a class="headerlink" href="#performance" title="Link to this heading">¶</a></h3>
      <p>Strings of fixed size can be stored efficiently.</p>
      <h2>Constants added by the <a class="reference internal" href="site.html#module-site"><code class="xref py py-mod docutils literal notranslate"><span class="pre">site</span></code></a> module<a class="headerlink" href="#constants" title="Link to this heading">¶</a></h2>
      <p>The site module adds several constants.</p>
      <h2 id="traits">Traits<a class="anchor" href="#traits">§</a></h2>
      <p>Shared behaviour for types.</p>
      <h2 id="setup"><span>Setup<a class="hash-link" href="#setup" aria-label="Direct link">&#8203;</a></span></h2>
      <p>Install the package first.</p>`,
      "faq/design.html",
    );
    expect(parsed.sections.map((s) => s.sectionTitle)).toEqual([
      "Why are Python strings immutable?",
      "Constants added by the site module",
      "Traits",
      "Setup",
    ]);
    // Only section titles change: anchors in other headings stay in the content, which
    // keeps its link ratio (and so the table-of-contents filter's verdict) as before.
    expect(parsed.sections[0]?.content).toContain("[¶](#performance");
  });
});

describe("Sphinx generated indexes", () => {
  // Sphinx's page chrome, as the Python docs ship it: plain divs, not <nav>/<footer>,
  // so turndown keeps its text, which counts against a page's link ratio.
  const page = (body: string) => `<body>
    <div class="related" role="navigation" aria-label="Related"><h3>Navigation</h3><ul>
      <li class="right"><a href="genindex.html" title="General Index">index</a></li>
      <li class="right"><a href="py-modindex.html" title="Python Module Index">modules</a> |</li>
      <li><a href="index.html">3.14.7 Documentation</a> &#187;</li><li>Index</li></ul></div>
    <div class="document"><div class="body" role="main">${body}</div></div>
    <div class="footer">&copy; <a href="copyright.html">Copyright</a> 2001 Python Software Foundation.
      This page is licensed under the Python Software Foundation License Version 2.
      Examples, recipes, and other code in the documentation are additionally licensed under the Zero Clause BSD License.
      The Python Software Foundation is a non-profit corporation. Last updated on Sep 21, 2026 (09:26 UTC).</div>
  </body>`;

  it.each([
    [
      "genindex.html",
      `<h1 id="index">Index</h1><p>Index pages by letter:</p>
      <div class="genindex-jumpbox"><p><a href="genindex-A.html"><strong>A</strong></a>
        | <a href="genindex-B.html"><strong>B</strong></a> | <a href="genindex-C.html"><strong>C</strong></a></p>
      <p><a href="genindex-all.html"><strong>Full index on one page</strong> (can be huge)</a></p></div>`,
    ],
    [
      "genindex-O.html",
      `<h1 id="index">Index &#x2013; O</h1>
      <table style="width: 100%" class="indextable"><tr><td style="width: 33%; vertical-align: top;"><ul>
        <li>objects<ul><li><a href="builtins/stdtypes.html#index-8">comparing</a></li>
          <li><a href="library/pickle.html#index-0">flattening</a></li></ul></li>
        <li>oct()<ul><li><a href="builtins/functions.html#oct">built-in function</a></li></ul></li>
        <li>octal<ul><li><a href="builtins/stdtypes.html#index-12">literals</a></li></ul></li>
      </ul></td></tr></table>`,
    ],
    [
      "py-modindex.html",
      `<h1>Python Module Index</h1>
      <div class="modindex-jumpbox"><a href="#cap-a"><strong>a</strong></a> | <a href="#cap-c"><strong>c</strong></a></div>
      <table class="indextable modindextable">
        <tr class="cap" id="cap-a"><td></td><td><strong>a</strong></td><td></td></tr>
        <tr><td></td><td><a href="library/abc.html#module-abc"><code class="xref">abc</code></a></td>
          <td><em>Abstract base classes according to PEP 3119.</em></td></tr>
        <tr class="cap" id="cap-c"><td></td><td><strong>c</strong></td><td></td></tr>
        <tr><td></td><td><a href="library/cmath.html#module-cmath"><code class="xref">cmath</code></a></td>
          <td><em>Mathematical functions for complex numbers.</em></td></tr>
      </table>`,
    ],
  ])("leaves %s out of the index", (path, body) => {
    expect(parseHtml(page(body), path).sections).toEqual([]);
  });

  it("still indexes a page that has the same chrome", () => {
    const body = `<h1>errno — Standard errno system symbols</h1>
      <p>This module makes available standard <code>errno</code> system symbols.</p>`;
    expect(parseHtml(page(body), "library/errno.html").sections).toHaveLength(
      1,
    );
  });
});
