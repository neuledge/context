import { describe, expect, it } from "vitest";
import { excludeFiles } from "./glob.js";

const files = (...paths: string[]) => paths.map((path) => ({ path }));

describe("excludeFiles", () => {
  it("returns the input untouched when no patterns are given", () => {
    const input = files("a.md", "b.md");
    expect(excludeFiles(input, undefined)).toBe(input);
    expect(excludeFiles(input, [])).toBe(input);
  });

  it("matches ** across segments and * within one", () => {
    const input = files(
      "tutorials/scripting/c_sharp/basics.md",
      "tutorials/scripting/gdscript/basics.md",
      "index.md",
      "nested/index.md",
    );

    expect(
      excludeFiles(input, ["tutorials/scripting/c_sharp/**"]).map(
        (f) => f.path,
      ),
    ).toEqual([
      "tutorials/scripting/gdscript/basics.md",
      "index.md",
      "nested/index.md",
    ]);

    // A single * must not cross a separator, so "nested/index.md" survives.
    expect(excludeFiles(input, ["*.md"]).map((f) => f.path)).toEqual([
      "tutorials/scripting/c_sharp/basics.md",
      "tutorials/scripting/gdscript/basics.md",
      "nested/index.md",
    ]);
  });

  it("matches relative to docs_path, as zip sources do", () => {
    // Git file paths keep the docs_path prefix; the pattern must not have to.
    const input = files("docs/api/internal/secret.md", "docs/api/public.md");

    expect(
      excludeFiles(input, ["internal/**"], "docs/api").map((f) => f.path),
    ).toEqual(["docs/api/public.md"]);

    // Without the docs_path the same pattern matches nothing, since the
    // stored path still carries the prefix.
    expect(excludeFiles(input, ["internal/**"]).map((f) => f.path)).toEqual(
      input.map((f) => f.path),
    );
  });

  it("can exclude everything, leaving the caller to reject an empty build", () => {
    // The builders check for zero files after filtering; an over-broad pattern
    // must therefore be able to empty the list rather than silently no-op.
    expect(excludeFiles(files("a.md", "b.md"), ["**"])).toHaveLength(0);
  });

  it("treats glob metacharacters in a pattern literally where unsupported", () => {
    const input = files("a+b.md", "axb.md");
    expect(excludeFiles(input, ["a+b.md"]).map((f) => f.path)).toEqual([
      "axb.md",
    ]);
  });
});
