import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "./database.js";
import { initDatabase, openDatabase } from "./database.js";
import { buildPackage } from "./package-builder.js";
import type { DocSnippet } from "./search.js";
import { search } from "./search.js";

const FIXTURE_DIR = new URL("./fixtures/retrieval/", import.meta.url);
const FIXTURE_NAMES = [
  "systemd.service.html",
  "systemctl.html",
  "spring-configuration.md",
  "gdscript-signals.md",
  "csharp-signals.md",
];
const TOP_K = 3;
const TOKEN_BUDGET = 2000;

function contentTokens(results: DocSnippet[]): number {
  return results.reduce((sum, r) => sum + Math.ceil(r.content.length / 4), 0);
}

describe("retrieval through package ingestion", () => {
  let testDir: string;
  let db: DatabaseConnection;

  beforeAll(async () => {
    await initDatabase();
    testDir = mkdtempSync(join(tmpdir(), "context-retrieval-"));
    const packagePath = join(testDir, "retrieval.db");
    const built = buildPackage(
      packagePath,
      FIXTURE_NAMES.map((name) => ({
        path: `docs/${name}`,
        content: readFileSync(new URL(name, FIXTURE_DIR), "utf8"),
      })),
      { name: "retrieval-fixtures", version: "1.0.0" },
    );
    expect(built.skippedFiles).toBe(0);
    db = openDatabase(packagePath, { readonly: true });
  });

  afterAll(() => {
    db?.close();
    if (testDir) rmSync(testDir, { recursive: true, force: true });
  });

  it.each([
    {
      topic: "ExecStart=",
      file: "systemd.service.html",
      title: "systemd.service.html > ExecStart",
      code: "ExecStart=/usr/bin/example --serve",
    },
    {
      topic: "systemctl --user",
      file: "systemctl.html",
      title: "systemctl.html > User services",
      code: "systemctl --user start example.service",
    },
    {
      topic: "spring.main.banner-mode",
      file: "spring-configuration.md",
      title: "Spring Boot configuration > Banner mode",
      code: "spring.main.banner-mode=off",
    },
    {
      topic: "GDScript signals",
      file: "gdscript-signals.md",
      title: "GDScript signals > Declaring and emitting signals",
      code: "health_changed.emit(80)",
    },
    {
      topic: "C# signals",
      file: "csharp-signals.md",
      title: "C# signals > Declaring and emitting signals",
      code: "EmitSignal(SignalName.HealthChanged, 80);",
    },
  ])("retrieves attributed documentation and code for $topic", (fixture) => {
    const result = search(db, fixture.topic);
    const sources = [...new Set(result.results.map((r) => r.source))];
    expect(result.library).toBe("retrieval-fixtures@1.0.0");
    expect(result.version).toBe("1.0.0");
    expect(sources.slice(0, TOP_K)).toContain(`docs/${fixture.file}`);
    expect(contentTokens(result.results)).toBeLessThanOrEqual(TOKEN_BUDGET);

    const snippet = result.results.find((r) => r.title === fixture.title);
    expect(snippet?.source).toBe(`docs/${fixture.file}`);
    const codeBlocks = snippet?.content.match(/```[^\n]*\n[\s\S]*?\n```/g);
    expect(codeBlocks?.some((block) => block.includes(fixture.code))).toBe(
      true,
    );
  });

  it.each([
    ["GDScript signals", "gdscript-signals.md"],
    ["C# signals", "csharp-signals.md"],
  ])("ranks the intended language first for %s", (topic, file) => {
    expect(search(db, topic).results[0]?.source).toBe(`docs/${file}`);
  });

  it("preserves examples when matching content exceeds the token budget", () => {
    const content = readFileSync(
      new URL("gdscript-signals.md", FIXTURE_DIR),
      "utf8",
    );
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `docs/example-${i}.md`,
      content: `${content}\nThis is signal example ${i}.\n`,
    }));
    const packagePath = join(testDir, "budget.db");
    const built = buildPackage(packagePath, files, {
      name: "budget-fixtures",
      version: "1.0.0",
    });
    expect(built.skippedFiles).toBe(0);
    expect(built.totalTokens).toBeGreaterThan(TOKEN_BUDGET);

    const budgetDb = openDatabase(packagePath, { readonly: true });
    try {
      const result = search(budgetDb, "GDScript signals");
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.length).toBeLessThan(files.length);
      expect(contentTokens(result.results)).toBeLessThanOrEqual(TOKEN_BUDGET);
      for (const snippet of result.results) {
        expect(files.map((file) => file.path)).toContain(snippet.source);
        expect(snippet.title).toBe(
          "GDScript signals > Declaring and emitting signals",
        );
        expect(snippet.content).toContain(
          content.match(/```gdscript\n[\s\S]*?\n```/)?.[0],
        );
      }
    } finally {
      budgetDb.close();
    }
  });
});
