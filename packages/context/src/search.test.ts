import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "./database.js";
import { initDatabase } from "./database.js";
import { search } from "./search.js";
import { createTestDb, insertChunk, rebuildFtsIndex } from "./test-utils.js";

const TEST_DIR = join(tmpdir(), `context-search-test-${Date.now()}`);

describe("search", () => {
  let db: DatabaseConnection;
  const testPackagePath = join(TEST_DIR, "test.db");

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = createTestDb(testPackagePath, { name: "nextjs", version: "15.0" });
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it("returns library info in result", () => {
    rebuildFtsIndex(db);

    const result = search(db, "anything");

    expect(result.library).toBe("nextjs@15.0");
    expect(result.version).toBe("15.0");
  });

  it("finds matching content by topic", () => {
    insertChunk(db, {
      docPath: "docs/middleware.md",
      docTitle: "Middleware",
      sectionTitle: "Introduction",
      content:
        "Middleware allows you to run code before a request is completed.",
      tokens: 50,
    });
    rebuildFtsIndex(db);

    const result = search(db, "middleware");

    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe("Middleware > Introduction");
    expect(result.results[0].source).toBe("docs/middleware.md");
  });

  it("returns empty results for no matches", () => {
    insertChunk(db, {
      docPath: "docs/routing.md",
      docTitle: "Routing",
      sectionTitle: "Basics",
      content: "Next.js uses a file-system based router.",
      tokens: 30,
    });
    rebuildFtsIndex(db);

    const result = search(db, "authentication");

    expect(result.results).toHaveLength(0);
  });

  it("respects token budget", () => {
    for (let i = 0; i < 5; i++) {
      insertChunk(db, {
        docPath: `docs/section${i}.md`,
        docTitle: `Section ${i}`,
        sectionTitle: "Overview",
        content: `This is documentation about middleware features part ${i}.`,
        tokens: 500,
      });
    }
    rebuildFtsIndex(db);

    const result = search(db, "middleware");

    expect(result.results.length).toBeLessThanOrEqual(4);
  });

  it("groups and orders chunks by document", () => {
    insertChunk(db, {
      docPath: "docs/middleware.md",
      docTitle: "Middleware",
      sectionTitle: "Configuration",
      content: "Configure middleware using matcher.",
      tokens: 30,
    });
    insertChunk(db, {
      docPath: "docs/middleware.md",
      docTitle: "Middleware",
      sectionTitle: "Introduction",
      content: "Middleware runs before requests.",
      tokens: 30,
    });
    rebuildFtsIndex(db);

    const result = search(db, "middleware");

    expect(result.results.every((r) => r.source === "docs/middleware.md")).toBe(
      true,
    );
  });

  it("handles empty query", () => {
    insertChunk(db, {
      docPath: "docs/test.md",
      docTitle: "Test",
      sectionTitle: "Section",
      content: "Some content",
      tokens: 10,
    });
    rebuildFtsIndex(db);

    const result = search(db, "   ");

    expect(result.results).toHaveLength(0);
  });

  it("handles special characters in query", () => {
    insertChunk(db, {
      docPath: "docs/api.md",
      docTitle: "API",
      sectionTitle: "Functions",
      content: "The getData function fetches data.",
      tokens: 20,
    });
    rebuildFtsIndex(db);

    const result = search(db, "getData()");

    expect(result.results).toHaveLength(1);
  });

  it.each([
    '"ExecStart',
    'ExecStart"',
    '"""ExecStart',
    '"ExecStart"',
    '"" ExecStart',
    '"!!!" ExecStart',
    "ExecStart=",
    "(ExecStart*)",
  ])("searches literal terms in %j", (topic) => {
    insertChunk(db, {
      docPath: "man/systemd.service.html",
      docTitle: "Service",
      sectionTitle: "Commands",
      content: "ExecStart sets the command to execute when a service starts.",
      tokens: 20,
    });
    rebuildFtsIndex(db);

    expect(search(db, topic).results.map((r) => r.source)).toEqual([
      "man/systemd.service.html",
    ]);
  });

  it.each([
    "AND",
    "OR",
    "NOT",
    "NEAR",
  ])("treats %s as a literal word, alone and between keywords", (word) => {
    insertChunk(db, {
      docPath: "docs/operators.md",
      docTitle: "Operators",
      sectionTitle: "Example",
      content: `ExecStart service example containing the literal word ${word}.`,
      tokens: 20,
    });
    insertChunk(db, {
      docPath: "docs/service.md",
      docTitle: "Service",
      sectionTitle: "Commands",
      content: "ExecStart service example without the operator word.",
      tokens: 20,
    });
    rebuildFtsIndex(db);

    for (const topic of [word, `ExecStart ${word} service`]) {
      expect(search(db, topic).results.map((r) => r.source)).toEqual([
        "docs/operators.md",
      ]);
    }
  });

  it.each([
    "",
    " \t\n",
    '"',
    '""',
    "= -- . () : * +",
    '"!!!"',
    "___",
  ])("returns no results for a topic without words: %j", (topic) => {
    rebuildFtsIndex(db);
    expect(search(db, topic).results).toEqual([]);
  });

  it("requires adjacent words only inside paired double quotes", () => {
    for (const [docPath, content] of [
      ["docs/phrase.md", "Rendering server components is useful."],
      ["docs/keywords.md", "Rendering components on the server is useful."],
    ] as const) {
      insertChunk(db, {
        docPath,
        docTitle: "Rendering",
        sectionTitle: "Overview",
        content,
        tokens: 20,
      });
    }
    rebuildFtsIndex(db);

    expect(
      search(db, '"server components" rendering').results.map((r) => r.source),
    ).toEqual(["docs/phrase.md"]);
    for (const topic of [
      "server components rendering",
      '"server components rendering',
    ]) {
      expect(
        search(db, topic)
          .results.map((r) => r.source)
          .sort(),
      ).toEqual(["docs/keywords.md", "docs/phrase.md"]);
    }
  });

  it.each(["café", "日本語"])("preserves Unicode keywords: %s", (topic) => {
    insertChunk(db, {
      docPath: "docs/unicode.md",
      docTitle: "Unicode",
      sectionTitle: "Examples",
      content: "Unicode examples include café and 日本語.",
      tokens: 20,
    });
    rebuildFtsIndex(db);

    expect(search(db, topic).results.map((r) => r.source)).toEqual([
      "docs/unicode.md",
    ]);
  });
});
