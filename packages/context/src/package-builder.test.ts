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
});
