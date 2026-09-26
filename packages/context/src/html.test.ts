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
});
