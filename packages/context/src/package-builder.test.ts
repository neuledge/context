import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildPackage } from "./package-builder.js";

describe("buildPackage", () => {
  const testDbPath = join(tmpdir(), `test-package-${Date.now()}.db`);

  afterEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it("creates a valid package database", () => {
    const files = [
      {
        path: "docs/intro.md",
        content: `---
title: Introduction
---

# Getting Started

## Overview

This is the overview section.

## Installation

Run the install command.
`,
      },
    ];

    const result = buildPackage(testDbPath, files, {
      name: "test-lib",
      version: "1.0.0",
      description: "A test library",
      sourceUrl: "https://github.com/test/test-lib",
    });

    expect(result.path).toBe(testDbPath);
    expect(result.sectionCount).toBeGreaterThan(0);

    // Verify database structure
    const db = new Database(testDbPath, { readonly: true });
    try {
      // Check metadata
      const name = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("name") as { value: string };
      expect(name.value).toBe("test-lib");

      const version = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("version") as { value: string };
      expect(version.value).toBe("1.0.0");

      const description = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("description") as { value: string };
      expect(description.value).toBe("A test library");

      // Check chunks exist
      const chunkCount = db
        .prepare("SELECT COUNT(*) as count FROM chunks")
        .get() as { count: number };
      expect(chunkCount.count).toBeGreaterThan(0);

      // Check FTS index works
      const ftsResults = db
        .prepare("SELECT * FROM chunks_fts WHERE chunks_fts MATCH ?")
        .all("overview");
      expect(ftsResults.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("handles multiple files", () => {
    const files = [
      {
        path: "docs/intro.md",
        content:
          "# Intro\n\n## Getting Started\n\nThis is where you begin your journey with the library.",
      },
      {
        path: "docs/api.md",
        content:
          "# API\n\n## Methods\n\nThis section documents all the available API methods and their parameters.",
      },
    ];

    const result = buildPackage(testDbPath, files, {
      name: "multi-file",
      version: "2.0.0",
    });

    expect(result.sectionCount).toBeGreaterThanOrEqual(2);
  });

  it("skips files that fail to parse", () => {
    const files = [
      {
        path: "docs/valid.md",
        content:
          "# Valid\n\n## Section\n\nThis is a valid markdown file with sufficient content for indexing.",
      },
      {
        path: "docs/binary.png",
        content: "\x89PNG\r\n\x1a\n", // Binary content that will fail markdown parsing
      },
    ];

    // Should not throw
    const result = buildPackage(testDbPath, files, {
      name: "skip-invalid",
      version: "1.0.0",
    });

    expect(result.sectionCount).toBeGreaterThan(0);
  });

  it("overwrites existing database", () => {
    // Create initial package
    buildPackage(testDbPath, [], { name: "old", version: "1.0.0" });

    // Overwrite with new package
    const result = buildPackage(
      testDbPath,
      [{ path: "docs/new.md", content: "# New\n\n## Section\n\nNew content." }],
      { name: "new", version: "2.0.0" },
    );

    // Verify new package
    const db = new Database(testDbPath, { readonly: true });
    try {
      const name = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("name") as { value: string };
      expect(name.value).toBe("new");
    } finally {
      db.close();
    }

    expect(result.path).toBe(testDbPath);
  });

  it("deduplicates sections with identical content from different files", () => {
    // Simulate the vercel/ai repo scenario where multiple README.md files
    // have the same "Skill for Coding Agents" section
    const sharedContent = `If you use coding agents such as Claude Code or Cursor, we highly recommend adding the AI SDK skill to your repository.`;

    const files = [
      {
        path: "packages/deepseek/README.md",
        content: `# DeepSeek Provider\n\n## Overview\n\nDeepSeek provider for the AI SDK.\n\n## Skill for Coding Agents\n\n${sharedContent}`,
      },
      {
        path: "packages/elevenlabs/README.md",
        content: `# ElevenLabs Provider\n\n## Overview\n\nElevenLabs provider for the AI SDK.\n\n## Skill for Coding Agents\n\n${sharedContent}`,
      },
      {
        path: "packages/fal/README.md",
        content: `# Fal Provider\n\n## Overview\n\nFal provider for the AI SDK.\n\n## Skill for Coding Agents\n\n${sharedContent}`,
      },
    ];

    const result = buildPackage(testDbPath, files, {
      name: "test-dedup",
      version: "1.0.0",
    });

    // Verify that the shared section is only stored once
    const db = new Database(testDbPath, { readonly: true });
    try {
      const sharedSections = db
        .prepare(
          "SELECT doc_path, section_title FROM chunks WHERE section_title = ?",
        )
        .all("Skill for Coding Agents") as { doc_path: string }[];

      // Should only have 1 entry, not 3
      expect(sharedSections.length).toBe(1);
      // First occurrence wins (deepseek)
      expect(sharedSections[0].doc_path).toBe("packages/deepseek/README.md");

      // Overview sections should all be kept since content differs
      const overviewSections = db
        .prepare("SELECT doc_path FROM chunks WHERE section_title = ?")
        .all("Overview") as { doc_path: string }[];
      expect(overviewSections.length).toBe(3);
    } finally {
      db.close();
    }

    // 3 unique Overview sections + 1 shared "Skill for Coding Agents" = 4 sections
    expect(result.sectionCount).toBe(4);
  });

  it("deduplicates sections with same content but different titles", () => {
    const sharedContent = `This is the shared installation instructions for all packages.`;

    const files = [
      {
        path: "packages/a/README.md",
        content: `# Package A\n\n## Getting Started\n\n${sharedContent}`,
      },
      {
        path: "packages/b/README.md",
        content: `# Package B\n\n## Installation\n\n${sharedContent}`,
      },
    ];

    buildPackage(testDbPath, files, {
      name: "test-content-dedup",
      version: "1.0.0",
    });

    const db = new Database(testDbPath, { readonly: true });
    try {
      // Content is identical, so only one should be stored (even though titles differ)
      const sections = db
        .prepare("SELECT doc_path, section_title FROM chunks WHERE content = ?")
        .all(sharedContent) as { doc_path: string; section_title: string }[];

      expect(sections.length).toBe(1);
      // First occurrence wins
      expect(sections[0].doc_path).toBe("packages/a/README.md");
      expect(sections[0].section_title).toBe("Getting Started");
    } finally {
      db.close();
    }
  });

  it("keeps sections with same title but different content", () => {
    const files = [
      {
        path: "packages/a/README.md",
        content: `# Package A\n\n## Installation\n\nInstall package A with npm install a.`,
      },
      {
        path: "packages/b/README.md",
        content: `# Package B\n\n## Installation\n\nInstall package B with npm install b.`,
      },
    ];

    buildPackage(testDbPath, files, {
      name: "test-same-title",
      version: "1.0.0",
    });

    const db = new Database(testDbPath, { readonly: true });
    try {
      const sections = db
        .prepare("SELECT doc_path FROM chunks WHERE section_title = ?")
        .all("Installation") as { doc_path: string }[];

      // Both should be kept since content differs
      expect(sections.length).toBe(2);
    } finally {
      db.close();
    }
  });
});
