/**
 * Package builder for creating documentation packages from markdown files.
 */

import { createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { type DocSection, parseDocument } from "./build.js";
import { openDatabase } from "./database.js";
import { REMOVED_TAGS } from "./html.js";

/**
 * Generate a content hash for section deduplication.
 * Uses first 16 chars of MD5 (sufficient for detecting identical content).
 */
function contentHash(content: string): string {
  return createHash("md5").update(content).digest("hex").slice(0, 16);
}

export interface PackageBuildOptions {
  name: string;
  version: string;
  description?: string;
  sourceUrl?: string;
  /** Git commit SHA used to build this package (for skip-if-unchanged checks) */
  sourceCommit?: string;
}

export interface MarkdownFile {
  path: string;
  content: string;
}

export interface BuildResult {
  path: string;
  sectionCount: number;
  totalTokens: number;
  /** Files dropped whole because splitting or parsing them threw. */
  skippedFiles: number;
}

/**
 * Markdown chunks longer than this are split further before AST parsing.
 *
 * Counted in UTF-16 code units, not bytes: that is what a JS string costs in the heap,
 * which is the resource being bounded here.
 */
const MAX_PARSE_CHUNK_CHARS = 1024 * 1024;

/** Extensions `parseDocument` routes to `parseHtml`. Matched as it matches them. */
const HTML_EXTENSIONS = [".html", ".htm"];

/** Extensions `parseDocument` routes away from remark. Matched as it matches them. */
const NON_MARKDOWN_EXTENSIONS = [...HTML_EXTENSIONS, ".adoc", ".rst"];

/** An ATX `##` heading: up to 3 spaces of indent, then `##` and a space or tab. */
const H2_LINE = /^ {0,3}##([ \t]|$)/;

/** The `<h2>…</h2>` a chunk opens with, if it opens with one. */
const H2_OPENING = /^<h2[\s>][\s\S]*?<\/h2\s*>/i;

/** Longest heading carried forward; past this it is a section body, not a title. */
const MAX_CARRIED_HEADING = 1024;

/**
 * Split markdown into one chunk per `##` section.
 *
 * Fenced code blocks are tracked so that `## ` lines inside them — common in docs that
 * demonstrate markdown — aren't mistaken for headings and split mid-fence. Fence
 * handling follows CommonMark: an opening fence may carry an info string, a closing
 * fence may not, and only the same character in at least the same run length closes.
 */
export function splitMarkdownByHeadings(file: MarkdownFile): MarkdownFile[] {
  const parts: string[] = [];
  let current: string[] = [];
  let openFence: string | null = null;

  for (const line of file.content.split("\n")) {
    const [, marker, info] = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line) ?? [];

    if (marker) {
      if (openFence === null) {
        // Backtick fences can't have a backtick in the info string; that isn't a fence.
        if (marker[0] !== "`" || !info?.includes("`")) openFence = marker;
      } else if (marker.startsWith(openFence) && !info?.trim()) {
        openFence = null;
      }
    } else if (openFence === null && H2_LINE.test(line) && current.length) {
      parts.push(current.join("\n"));
      current = [];
    }

    current.push(line);
  }
  if (current.length) parts.push(current.join("\n"));

  if (parts.length <= 1) return [file];
  return parts.map((content) => ({ path: file.path, content }));
}

/**
 * Move a blind cut off a surrogate pair, which halved becomes two U+FFFD.
 *
 * Only ever moves back by one, and never past `from`, so it can't stall a loop that
 * relies on the cut making progress.
 */
function offSurrogatePair(text: string, from: number, at: number): number {
  const high = text.charCodeAt(at - 1);
  return high >= 0xd800 && high <= 0xdbff && at - 1 > from ? at - 1 : at;
}

/**
 * Split content into chunks of at most `maxChars`, preferring line boundaries.
 *
 * A single line over the limit is cut mid-line. Nothing else bounds it, and a line that
 * long is a data blob — a base64 payload, a minified sample — rather than prose.
 */
function splitBySize(content: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of content.split("\n")) {
    if (current && current.length + line.length + 1 > maxChars) {
      chunks.push(current);
      current = "";
    }

    let rest = line;
    while (rest.length > maxChars) {
      const at = offSurrogatePair(rest, 0, maxChars);
      chunks.push(rest.slice(0, at));
      rest = rest.slice(at);
    }

    current += current ? `\n${rest}` : rest;
  }
  if (current) chunks.push(current);

  return chunks.length ? chunks : [content];
}

/**
 * `REMOVED_TAGS` numbered, so the open-element stack below can hold integers.
 *
 * A page of nothing but `<svg ` pushes one entry per five characters, and holding that
 * many short strings alive costs the collector about a third of the scan; the same
 * count of small integers is a packed array of a couple of megabytes and costs nothing.
 */
const REMOVED_TAG_IDS = new Map([...REMOVED_TAGS].map((tag, id) => [tag, id]));

/** A tag name at a known `<`. Sticky: it matches there or not at all, never searches. */
const TAG_NAME = /<(\/?)([a-zA-Z][^\s/>]*)/y;

/** The quote opening an attribute value, at a known `=`. Sticky, as above. */
const ATTR_VALUE = /\s*(["'])?/y;

/** Elements whose content is raw text: a `<` inside them never opens a tag. */
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

/**
 * Raw-text elements the HTML parser also strips.
 *
 * `textarea` is deliberately absent: it is raw text, but turndown keeps its text, so a
 * `<textarea>` that never closes still has indexable content after it.
 */
const STRIPPED_RAW_TEXT = new Set(
  [...RAW_TEXT_TAGS].filter((tag) => REMOVED_TAGS.has(tag)),
);

/**
 * The `>` ending the tag whose name ends at `from`, or -1 if the tag never ends.
 *
 * Quoted attribute values are jumped over, so the `<` and `>` in `<div title="<b>">` are
 * read as the value they are and not as structure. Reading them as structure is what let
 * a `<script` inside an attribute pass for a real one and drop a whole document.
 *
 * The tag is walked, not tokenized: attribute names and unquoted values need no state,
 * since nothing inside them ends the tag but the `>`. Only the quote is approximated —
 * it counts as opening a value where one belongs, just after `=`, which is also where
 * the real tokenizer accepts one. Elsewhere it is ordinary text, so `<div a=b"c>` ends
 * at that `>` rather than hunting for a matching quote. Both ways of being wrong about
 * an oddity like `<a href=x=y">` end the tag too late rather than too early, which costs
 * cut candidates: cutting more bluntly is recoverable, cutting inside a tag is not.
 */
function tagEnd(html: string, from: number): number {
  for (let i = from; i < html.length; i++) {
    if (html[i] === ">") return i;
    if (html[i] !== "=") continue;

    ATTR_VALUE.lastIndex = i + 1;
    const [, quote] = ATTR_VALUE.exec(html) ?? [];
    if (!quote) continue;

    // A value whose quote never closes swallows the rest of the file, as it does for a
    // real parser: the tag never ends, and everything after it is inside it.
    const close = html.indexOf(quote, ATTR_VALUE.lastIndex);
    if (close < 0) return -1;
    i = close;
  }

  return -1;
}

/**
 * Yield the offset, lowercased name and shape of every tag in an HTML source, and return
 * the offset at which the document stops holding indexable content.
 *
 * Tag markup itself is skipped, so an attribute value is never read as document text and
 * the `<script` in `<div title="<script>">` is not seen at all. A tag with no `>` ends
 * the scan: the rest of the file is inside it, and later cuts there are merely blunt.
 *
 * Comments and terminated raw-text element bodies are skipped, because a cut inside one
 * loses content rather than splitting it: the truncated `<script>` or `<!--` swallows
 * the rest of its chunk, and its tail reappears in the next chunk as prose.
 *
 * An unterminated `<!--`, or an unterminated `<textarea>`, is scanned into rather than
 * abandoned. Giving up looks safer but isn't: it leaves the entire remainder of the file
 * with no cut candidate, so every later cut is blind and can land mid-tag, spilling raw
 * attribute markup into the index, and the tail is resurrected either way.
 *
 * A `<script>`, `<style>` or `<title>` that never closes is different, and is where the
 * scan stops. Everything after it is that element's text content — that is what the
 * whole-file parse sees — and turndown drops the element, so the tail is not content to
 * be placed well but content that does not exist. The returned offset is where it
 * starts; scanning on would only decide where to cut a region the parser never had.
 */
function* scanTags(
  html: string,
): Generator<
  [offset: number, name: string, closing: boolean, selfClosing: boolean],
  number
> {
  let i = 0;
  // A close tag that could not be found from one offset cannot be found from a later
  // one, and these searches only ever start further into the file, so one failure per
  // name settles it. Re-running the search is what makes it quadratic: 1MB of
  // `<script ` with no `</script` anywhere rescanned the whole remainder per tag and
  // took 40s, against 50ms once the failure is remembered.
  const unclosed = new Set<string>();

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? lt + 4 : end + 3;
      continue;
    }

    TAG_NAME.lastIndex = lt;
    const [match, closing, tag] = TAG_NAME.exec(html) ?? [];
    if (!match || !tag) {
      i = lt + 1;
      continue;
    }

    const name = tag.toLowerCase();
    const nameEnd = lt + match.length;
    const end = tagEnd(html, nameEnd);

    // `/>` usually closes the tag on the spot, and counting `<svg/>` open would suppress
    // candidates that did not need it. But an unquoted attribute value swallows the `/`,
    // so `<iframe src=foo/>` is an *open* iframe whose real `</iframe>` would then cancel
    // an enclosing `<aside>`. Only a `/` that ends the tag name or follows a quote or
    // space is read as closing; guessing "open" is the safe way round, costing at most
    // one suppressed cut candidate.
    const selfClosing =
      html[end - 1] === "/" &&
      (end - 1 === nameEnd || /["'\s]/.test(html[end - 2] ?? ""));

    yield [lt, name, !!closing, selfClosing];

    // Past the tag, not back into it. Resuming at `lt + 1` re-read the tag's own markup
    // as document text, which is how an attribute value came to be scanned for tags.
    // A tag that never ends leaves nothing after it to scan: the rest of the file is
    // inside it, so the scan is over rather than restarted from within. That is also
    // what keeps this linear — tags are walked once because they never overlap — and
    // resuming anywhere inside one makes the whole scan quadratic again.
    i = end < 0 ? html.length : end + 1;

    if (!closing && RAW_TEXT_TAGS.has(name) && !unclosed.has(name)) {
      const close = new RegExp(`</${name}`, "gi");
      close.lastIndex = i;
      const found = close.exec(html)?.index;
      if (found != null) i = found;
      else if (STRIPPED_RAW_TEXT.has(name)) return lt;
      else unclosed.add(name);
    }
  }

  return html.length;
}

/** Chunks of an HTML document, and how many of them hold indexable content. */
interface HtmlSplit {
  /** A lossless partition of the input: joining these reproduces it exactly. */
  chunks: string[];
  /** Chunks before the tail of a stripped raw-text element that never closes. */
  contentChunks: number;
}

/**
 * Split HTML into chunks of at most `maxChars`, cutting at tag boundaries.
 *
 * Each cut lands on the last `<h2` that fits, so chunks hold whole sections and
 * `parseHtml` still names them from their heading; failing that, on the last tag that
 * fits. A stretch of text with no tag at all is cut mid-way — nothing else bounds it,
 * and it is a data blob rather than markup.
 *
 * Offsets inside a `REMOVED_TAGS` element are skipped while the element is smaller than
 * a chunk. Cutting there leaves the opening `<aside>` in the previous chunk, so
 * `turndown.remove` no longer applies to the tail and the sidebar is indexed as prose —
 * and in reverse, a `<h2>` inside a stripped `<header>` becomes a real heading once the
 * `<header>` is gone.
 *
 * Fragments are safe to hand to a parser in a way markdown fragments are not: HTML
 * parsing auto-closes whatever the cut left open, so a chunk degrades to slightly
 * flatter nesting instead of the following text changing meaning.
 */
function splitHtmlBySize(html: string, maxChars: number): HtmlSplit {
  const chunks: string[] = [];
  let start = 0;
  let lastTag = 0;
  let lastHeading = 0;
  // The open `REMOVED_TAGS` elements the scan is inside, innermost last. Bounded by the
  // cap below: suppression is dropped once it has spanned `maxChars`, and the shortest
  // opening tag that reaches this stack is five characters, so a 1MB chunk limit caps it
  // at about 210k entries however deeply the page nests.
  const open: number[] = [];

  // Both candidates were recorded while they still fit, and `start` only moves
  // forward, so every chunk cut here is within the limit.
  const packTo = (offset: number) => {
    while (offset - start > maxChars) {
      const at =
        lastHeading > start
          ? lastHeading
          : lastTag > start
            ? lastTag
            : offSurrogatePair(html, start, start + maxChars);
      chunks.push(html.slice(start, at));
      start = at;
    }
  };

  // Iterated by hand rather than with `for…of`, which discards the generator's return
  // value — here, the offset at which indexable content ends.
  const tags = scanTags(html);
  let tag = tags.next();

  // Opening `<h2` only: cutting at the matching `</h2` would strand the heading in
  // the previous chunk and leave its section titled "Introduction".
  for (; !tag.done; tag = tags.next()) {
    const [offset, name, closing, selfClosing] = tag.value;
    packTo(offset);

    // Suppression that has outrun a whole chunk has nothing left to protect: the cut
    // lands inside the element whichever candidate wins, so take the tag boundary.
    // This also caps the damage of an element that is opened and never closed.
    if (open.length && offset - lastTag > maxChars) open.length = 0;

    const removedId = REMOVED_TAG_IDS.get(name);
    const isRemoved = removedId !== undefined;
    // These elements nest — `<article><header>` inside a `<header>` is ordinary — so
    // the body is skipped by tracking what is open, not by searching for the next close
    // tag. Names are tracked and not merely a depth, because a stray `</header>` inside
    // an `<aside>` would otherwise end the aside's suppression early and let a cut land
    // inside it. A close tag that does not match the innermost open element is ignored
    // rather than hunted for further up the stack: that hunt is what would make this
    // quadratic, and ignoring it is also what an HTML parser does with these elements,
    // whose mismatched end tags are dropped instead of closing an ancestor. Mis-nesting
    // like `<aside><nav></aside>` therefore leaves the stack stuck open, which only
    // costs cut candidates until the cap above clears it.
    if (closing && isRemoved && open[open.length - 1] === removedId) open.pop();

    if (!open.length) {
      lastTag = offset;
      if (name === "h2" && !closing) lastHeading = offset;
    }

    if (!closing && isRemoved && !selfClosing) open.push(removedId);
  }

  // Cut exactly where content ends, so the tail can be dropped a whole chunk at a time.
  // The tail is still emitted — these chunks stay a lossless partition of the input, and
  // which of them are worth parsing is `splitForParsing`'s call. In the usual case,
  // where content ends with the document, everything below is a no-op.
  const contentEnd = tag.value;
  packTo(contentEnd);
  if (start < contentEnd) chunks.push(html.slice(start, contentEnd));
  start = contentEnd;
  const contentChunks = chunks.length;

  packTo(html.length);
  if (start < html.length) chunks.push(html.slice(start));

  return { chunks, contentChunks };
}

/** The document's leading YAML frontmatter block, if it opens with one. */
function leadingFrontmatter(content: string): string {
  return /^---\n[\s\S]*?\n---\n/.exec(content)?.[0] ?? "";
}

/**
 * Break an oversized file into chunks small enough to parse without exhausting the heap.
 *
 * remark builds a full AST for whatever it is given, so a multi-megabyte document (a
 * site's `llms-full.txt`, say) can OOM the process. Splitting by `##` keeps sections
 * intact where possible; the size fallback bounds the rest, so a file with no headings
 * — or one enormous section — can't crash the build either.
 *
 * HTML is split on tag structure instead, because `parseHtml` builds a DOM before it
 * builds an AST and the DOM is what actually hurts: converting an 8MB page peaked at
 * 1451MB RSS, of which the full pipeline added only 40MB more. Converting first and
 * reusing the markdown split would therefore bound nothing — the source has to be cut
 * before turndown sees it. AsciiDoc and reStructuredText are left whole; both parse
 * with plain line scanning, so neither is a heap risk.
 */
export function splitForParsing(file: MarkdownFile): MarkdownFile[] {
  if (file.content.length <= MAX_PARSE_CHUNK_CHARS) return [file];

  if (HTML_EXTENSIONS.some((ext) => file.path.endsWith(ext))) {
    // `parseHtml` titles a section from the `<h2>` opening it, so a chunk cut where no
    // heading fit would otherwise be indexed as "Introduction". Carry the heading a
    // chunk opened with into its continuations, exactly as the markdown path carries a
    // `##` line. Only that heading: any other `<h2>` in the chunk may be one
    // `turndown.remove` was going to drop, and promoting it would index chrome as a
    // section title. The budget is reduced by what may be carried so the prefixed chunk
    // still fits; `splitHtmlBySize` itself stays lossless.
    let carried = "";
    const { chunks, contentChunks } = splitHtmlBySize(
      file.content,
      MAX_PARSE_CHUNK_CHARS - MAX_CARRIED_HEADING,
    );

    // Chunks past `contentChunks` are the text of a `<script>`, `<style>` or `<title>`
    // that never closes, which is what the whole-file parse makes of them too. Parsing
    // them would index raw JavaScript as prose; a page whose script is unterminated
    // right at the top therefore yields nothing, exactly as it does whole.
    return chunks.slice(0, contentChunks).map((chunk) => {
      const opening = H2_OPENING.exec(chunk)?.[0];
      if (!opening) return { path: file.path, content: carried + chunk };

      carried = opening.length <= MAX_CARRIED_HEADING ? opening : "";
      return { path: file.path, content: chunk };
    });
  }

  const isMarkdown = !NON_MARKDOWN_EXTENSIONS.some((ext) =>
    file.path.endsWith(ext),
  );
  if (!isMarkdown) return [file];

  // `parseMarkdown` reads frontmatter only at offset 0 and titles a section from the
  // `##` line opening it, so a continuation chunk would otherwise index under the
  // filename with a section title of "Introduction". Carry both forward instead.
  const frontmatter = leadingFrontmatter(file.content);
  const chunks: MarkdownFile[] = [];

  splitMarkdownByHeadings(file).forEach((part, index) => {
    const prefix = index === 0 ? "" : frontmatter;

    if (prefix.length + part.content.length <= MAX_PARSE_CHUNK_CHARS) {
      chunks.push({ path: file.path, content: prefix + part.content });
      return;
    }

    const heading = /^ {0,3}##[ \t].*/.exec(part.content)?.[0];
    const carried = heading ? `${prefix + heading}\n` : prefix;

    for (const [i, content] of splitBySize(
      part.content,
      MAX_PARSE_CHUNK_CHARS - carried.length,
    ).entries()) {
      chunks.push({
        path: file.path,
        content: i === 0 ? prefix + content : carried + content,
      });
    }
  });

  return chunks;
}

/**
 * Build a documentation package from markdown files.
 */
export function buildPackage(
  outputPath: string,
  files: MarkdownFile[],
  options: PackageBuildOptions,
): BuildResult {
  // Remove existing file if present
  if (existsSync(outputPath)) {
    unlinkSync(outputPath);
  }

  const db = openDatabase(outputPath);

  try {
    // Create schema
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY,
        doc_path TEXT NOT NULL,
        doc_title TEXT NOT NULL,
        section_title TEXT NOT NULL,
        content TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        has_code INTEGER DEFAULT 0
      );
      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        doc_title, section_title, content,
        content='chunks', content_rowid='id',
        tokenize='porter unicode61'
      );
    `);

    // Insert metadata
    const insertMeta = db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?)",
    );
    insertMeta.run("name", options.name);
    insertMeta.run("version", options.version);
    if (options.description) {
      insertMeta.run("description", options.description);
    }
    if (options.sourceUrl) {
      insertMeta.run("source_url", options.sourceUrl);
    }
    if (options.sourceCommit) {
      insertMeta.run("source_commit", options.sourceCommit);
    }

    // Parse and insert chunks
    const insertChunk = db.prepare(`
      INSERT INTO chunks (doc_path, doc_title, section_title, content, tokens, has_code)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const allSections: DocSection[] = [];
    const seenHashes = new Set<string>();
    let skippedFiles = 0;

    for (const file of files) {
      try {
        // Splitting is inside the guard on purpose: it walks untrusted markup, so a
        // throw there has to cost one file rather than the whole registry build. Doing
        // it per file also keeps only one file's chunks alive at a time.
        const sections = splitForParsing(file).flatMap(
          (chunk) => parseDocument(chunk.content, chunk.path).sections,
        );

        for (const section of sections) {
          // Deduplicate sections with identical content (ignore titles)
          const hash = contentHash(section.content);
          if (!seenHashes.has(hash)) {
            seenHashes.add(hash);
            allSections.push(section);
          }
        }
      } catch {
        // A file that cannot be split or parsed is dropped whole, so a half-indexed
        // document never reaches the package. The failure is counted rather than
        // logged: `buildPackage` has no logger, and a silent skip is how a registry
        // build loses documents without anyone noticing.
        skippedFiles++;
      }
    }

    // Insert all sections in a transaction
    const insertAll = db.transaction((sections: DocSection[]) => {
      for (const section of sections) {
        insertChunk.run(
          section.docPath,
          section.docTitle,
          section.sectionTitle,
          section.content,
          section.tokens,
          section.hasCode ? 1 : 0,
        );
      }
    });

    insertAll(allSections);

    // Rebuild FTS index
    db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");

    const totalTokens = allSections.reduce((sum, s) => sum + s.tokens, 0);

    return {
      path: outputPath,
      sectionCount: allSections.length,
      totalTokens,
      skippedFiles,
    };
  } finally {
    db.close();
  }
}
