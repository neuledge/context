import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDocument } from "@neuledge/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HtmlIndexSource } from "./definition.js";
import { downloadHtmlIndex, resolveIndexUrl } from "./html-index.js";

const base = "https://docs.example/man/258/";
const source: HtmlIndexSource = {
  type: "html-index",
  url: "https://docs.example/man/{version}/",
  concurrency: 2,
  max_pages: 20,
};
const html = (body: string) =>
  new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
const page = (name: string) =>
  `<html><body><h1>${name}</h1><p>Reference for ${name}.</p></body></html>`;

describe("HTML index downloads", () => {
  let cacheDir: string;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "html-index-"));
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  const download = (overrides: Partial<HtmlIndexSource> = {}) =>
    downloadHtmlIndex({ ...source, ...overrides }, "258", { cacheDir });

  it("follows only scoped HTML links once, excluding fragments, navigation and queries", async () => {
    fetchMock.mockImplementation(async (input) =>
      input.toString() === base
        ? html(`<base href="https://evil.example/"><a href="systemctl.html#one">one</a>
          <a href="systemctl.html#two">two</a><a href="./systemctl.html">three</a>
          <a href="index.html">index</a><a href="#A">A</a><a href="/man/257/old.html">old</a>
          <a href="../latest/new.html">latest</a><a href="https://other.example/a.html">external</a>
          <a href="https://docs.example:444/man/258/a.html">port</a><a href="script.js">script</a>
          <a href="systemctl.html?view=print">query</a><a href="%2e%2e/escape.html">escape</a>
          <a href="%2fescape.html">separator</a><a href="%252e%252e/escape.html">double</a>
          <a href="https://user:secret@docs.example/man/258/a.html">credentials</a>
          <a href="http://docs.example/man/258/a.html">http</a><a href="%zz.html">invalid</a>`)
        : html(page("systemctl")),
    );
    const files = await download({ exclude_paths: ["index.html"] });
    expect(files.map((file) => file.path)).toEqual(["systemctl.html"]);
    expect(fetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      base,
      `${base}systemctl.html`,
    ]);
  });

  it("does not crawl links found inside manual pages", async () => {
    fetchMock
      .mockResolvedValueOnce(html('<a href="one.html">one</a>'))
      .mockResolvedValueOnce(html(`${page("one")}<a href="two.html">two</a>`));
    expect(await download()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses pinned downloads and refetches a corrupted cache entry", async () => {
    fetchMock.mockImplementation(async (input) =>
      html(
        input.toString() === base ? '<a href="one.html">one</a>' : page("one"),
      ),
    );
    const first = await download();
    expect(await download()).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const cached = readdirSync(cacheDir)[0];
    expect(cached).toBeDefined();
    writeFileSync(join(cacheDir, cached as string), "interrupted JSON");
    expect(await download()).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("deduplicates identical aliases deterministically and limits concurrency", async () => {
    let active = 0;
    let maximum = 0;
    fetchMock.mockImplementation(async (input) => {
      if (input.toString() === base)
        return html(
          '<a href="b.html">b</a><a href="a.html">a</a><a href="c.html">c</a>',
        );
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return html(page("shared"));
    });
    expect((await download()).map((file) => file.path)).toEqual(["a.html"]);
    expect(maximum).toBe(2);
  });

  it.each([
    "https://other.example/page.html",
    "../257/page.html",
    "../latest/page.html",
    "/man/258evil/page.html",
    "page.html?view=print",
  ])("rejects redirects outside the pinned scope: %s", async (location) => {
    fetchMock
      .mockResolvedValueOnce(html('<a href="one.html">one</a>'))
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location } }),
      );
    await expect(download()).rejects.toThrow(
      "redirect leaves the pinned directory",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows scoped redirects and resolves links relative to the final index", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "sub/index.html" },
        }),
      )
      .mockResolvedValueOnce(html('<a href="one.html">one</a>'))
      .mockResolvedValueOnce(html(page("one")));
    expect((await download())[0]?.path).toBe("sub/one.html");
    expect(fetchMock.mock.calls[2]?.[0].toString()).toBe(`${base}sub/one.html`);
  });

  it("bounds redirect loops", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: base } }),
    );
    await expect(download()).rejects.toThrow("Too many HTML redirects");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("fails on empty or over-limit indexes without fetching partial documentation", async () => {
    fetchMock.mockResolvedValueOnce(
      html('<a href="a.html">a</a><a href="b.html">b</a>'),
    );
    await expect(download({ max_pages: 1 })).rejects.toThrow("max_pages");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(download({ exclude_paths: ["*.html"] })).rejects.toThrow(
      "No documentation links",
    );
  });

  it("fails the whole download on a missing page and retains completed cache entries", async () => {
    fetchMock
      .mockResolvedValueOnce(
        html('<a href="a.html">a</a><a href="b.html">b</a>'),
      )
      .mockResolvedValueOnce(html(page("a")))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }));
    await expect(download({ concurrency: 1 })).rejects.toThrow("HTTP 404");
    fetchMock.mockResolvedValueOnce(html(page("b")));
    expect(await download()).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("retries transient responses without caching errors", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(html('<a href="a.html">a</a>'))
      .mockResolvedValueOnce(html(page("a")));
    expect(await download()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(readdirSync(cacheDir)).toHaveLength(2);
  });

  it.each([
    [() => new Response("plain text"), "Expected HTML"],
    [() => html(" "), "Empty HTML"],
    [
      () =>
        new Response("partial", {
          status: 206,
          headers: { "content-type": "text/html" },
        }),
      "HTTP 206",
    ],
    [
      () =>
        new Response("large", {
          headers: {
            "content-type": "text/html",
            "content-length": String(11 * 1024 * 1024),
          },
        }),
      "exceeds 10 MiB",
    ],
    [() => html("a".repeat(10 * 1024 * 1024 + 1)), "exceeds 10 MiB"],
  ] as const)("rejects invalid or oversized responses", async (response, message) => {
    fetchMock.mockResolvedValueOnce(response());
    await expect(download()).rejects.toThrow(message);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("times out stalled response bodies and stops after two retries", async () => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      expect(milliseconds).toBe(30_000);
      return realTimeout(30);
    });
    fetchMock.mockImplementation(async (_input, init) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<html>"));
          init?.signal?.addEventListener(
            "abort",
            () => {
              controller.error(init.signal?.reason);
            },
            { once: true },
          );
        },
      });
      return new Response(body, { headers: { "content-type": "text/html" } });
    });
    await expect(download()).rejects.toThrow(/timeout/i);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("keeps options, tables and code from rendered DocBook HTML", async () => {
    fetchMock
      .mockResolvedValueOnce(html('<a href="systemd.service.html">service</a>'))
      .mockResolvedValueOnce(
        html(`<html><body><h1>systemd.service</h1>
        <div class="refsect1"><h2>Options</h2><dl><dt>Type=</dt><dd><p>Controls startup.</p></dd></dl>
        <table><tr><th>Specifier</th><th>Meaning</th></tr><tr><td>%n</td><td>Full unit name</td></tr></table>
        <pre class="programlisting">[Service]\nExecStart=/usr/bin/example</pre></div></body></html>`),
      );
    const [file] = await download();
    expect(file).toBeDefined();
    const parsed = parseDocument(file?.content ?? "", file?.path ?? "");
    expect(parsed.sections.some((section) => section.hasCode)).toBe(true);
    const result = JSON.stringify(parsed);
    for (const text of [
      "Type=",
      "Controls startup",
      "%n",
      "Full unit name",
      "ExecStart=/usr/bin/example",
    ]) {
      expect(result).toContain(text);
    }
  });
});

describe("pinned HTML index URLs", () => {
  it.each([
    "latest",
    "stable",
    "main",
    "../258",
    "258/../../latest",
    "258?x=1",
  ])("rejects release %s", (version) => {
    expect(() => resolveIndexUrl(source.url, version)).toThrow();
  });
  it.each([
    "http://docs.example/{version}/",
    "https://docs.example/latest/",
    "https://docs.example/?version={version}",
    "https://user:secret@docs.example/{version}/",
    "https://docs.example/{version}/?x=1",
    "https://docs.example/{version}/#a",
    "https://docs.example/{version}/../latest/",
    "https://{version}.example/latest/",
  ])("rejects unpinned template %s", (url) => {
    expect(() => resolveIndexUrl(url, "258")).toThrow();
  });
});
