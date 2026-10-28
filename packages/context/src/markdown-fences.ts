/**
 * Fenced code blocks in Markdown, read from the lines of the text.
 *
 * The heading splitter, the paragraph splitter and the `hasCode` flag all use this, so
 * they agree on where a block starts and ends. Two splitters with their own rules could
 * disagree, and one would cut a block the other kept whole.
 *
 * Fences follow CommonMark: an opening fence is three or more backticks or tildes and may
 * carry an info string (with no backtick, for a backtick fence), and only a bare run of
 * the same character, at least as long, closes it. List items are not parsed, so two
 * rules stand in for them: any indent opens a fence, and so does a list marker before it
 * (`1. ```bash`), because fences in list items are indented; a closing fence has no list
 * marker and sits at most 3 columns right of where its opening fence starts (tabs stop
 * every 4 columns), so a fence shown inside a code example does not close the block
 * around it.
 *
 * A fence that never closes is read as text, so a stray one does not swallow the rest of
 * the document. CommonMark runs it to the end instead.
 *
 * This reads the text rather than remark's tree on purpose: without MDX support remark
 * reads a fence under a JSX line such as `<Section>` as part of an HTML block, which
 * would leave most code in MDX docs unprotected.
 */

/** A fence line: indent, an optional list marker it opens behind, the run, the rest. */
const FENCE_LINE = /^([ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/;

type FenceChar = "`" | "~";

interface Fence {
  char: FenceChar;
  length: number;
  /** The column the run starts at. */
  column: number;
  /** Behind a list marker, which an opening fence may be and a closing one not. */
  item: boolean;
  info: string;
}

/** The column after `text` when it starts at column `from`, with tab stops every 4. */
function columnAfter(text: string, from = 0): number {
  let column = from;
  for (const char of text)
    column = char === "\t" ? column + 4 - (column % 4) : column + 1;
  return column;
}

function parseFence(line: string, tildes: boolean): Fence | null {
  const [, indent = "", item = "", run, info = ""] =
    FENCE_LINE.exec(line) ?? [];
  if (!run || (!tildes && run[0] === "~")) return null;
  return {
    char: run[0] as FenceChar,
    length: run.length,
    column: columnAfter(item, columnAfter(indent)),
    item: item !== "",
    info,
  };
}

function canOpen(fence: Fence | null): fence is Fence {
  // A backtick fence's info string can't hold a backtick: ```npm i``` is inline code.
  return fence !== null && (fence.char !== "`" || !fence.info.includes("`"));
}

/** Blockquote markers in front of a line. */
const QUOTE_MARKERS = /^[ \t]*(?:>[ \t]?)+/;

/**
 * Whether `line` opens a fenced code block, closed or not (see `fencedBlocks` for
 * `tildes`). A fence in a blockquote counts here (`> ```js`, which turndown writes for
 * some Sphinx examples), though `fencedBlocks` does not pair quoted fences: a quote can
 * end before its block closes, so a bare fence after it would close the wrong block.
 */
export function opensFence(line: string, tildes = true): boolean {
  return canOpen(parseFence(line.replace(QUOTE_MARKERS, ""), tildes));
}

function canClose(fence: Fence): boolean {
  return !fence.item && !fence.info.trim();
}

function closes(fence: Fence | null, open: Fence): boolean {
  return (
    fence !== null &&
    canClose(fence) &&
    fence.char === open.char &&
    fence.length >= open.length &&
    fence.column <= open.column + 3
  );
}

/**
 * The fenced code blocks in `lines`, as `[first, last]` line indexes, in order.
 *
 * Pass `tildes: false` for AsciiDoc and reStructuredText, which underline headings with
 * `~~~` and do not fence code with it.
 */
export function fencedBlocks(
  lines: readonly string[],
  tildes = true,
): [number, number][] {
  const fences = lines.map((line) => parseFence(line, tildes));

  // The longest bare run of each character after each line. A fence with no run as
  // long after it can never close, so it is text without scanning ahead; the scan is
  // left for a fence whose only closers are indented too far.
  const longest: Record<FenceChar, number>[] = [];
  let after: Record<FenceChar, number> = { "`": 0, "~": 0 };
  for (let i = lines.length - 1; i >= 0; i--) {
    longest[i] = after;
    const fence = fences[i];
    if (fence && canClose(fence) && fence.length > after[fence.char]) {
      after = { ...after, [fence.char]: fence.length };
    }
  }

  const blocks: [number, number][] = [];
  const failed: Fence[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = fences[i] ?? null;
    if (
      !canOpen(open) ||
      (longest[i]?.[open.char] ?? 0) < open.length ||
      // Its closers are among those of a fence that already failed to close.
      failed.some(
        (f) =>
          f.char === open.char &&
          f.length <= open.length &&
          f.column >= open.column,
      )
    ) {
      continue;
    }

    let last = i + 1;
    while (last < lines.length && !closes(fences[last] ?? null, open)) last++;
    if (last === lines.length) {
      failed.push(open);
      continue;
    }
    blocks.push([i, last]);
    i = last;
  }
  return blocks;
}

/** For each of `lines`, whether it is part of a fenced code block, fences included. */
export function fencedLines(lines: readonly string[]): boolean[] {
  const inside = lines.map(() => false);
  for (const [first, last] of fencedBlocks(lines)) {
    inside.fill(true, first, last + 1);
  }
  return inside;
}
