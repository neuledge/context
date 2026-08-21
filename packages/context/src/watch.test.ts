import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchDirectory } from "./watch.js";

/** Give the watcher's debounce window time to close before asserting. */
const settle = () => new Promise((r) => setTimeout(r, 400));

describe("watchDirectory", () => {
  let dir: string;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "context-watch-"));
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it("fires when a file appears", async () => {
    let calls = 0;
    stop = watchDirectory(dir, () => {
      calls++;
    });

    writeFileSync(join(dir, "demo.db"), "x");
    await settle();

    expect(calls).toBe(1);
  });

  it("collapses a burst into one call", async () => {
    let calls = 0;
    stop = watchDirectory(dir, () => {
      calls++;
    });

    // What one install looks like: a temp file, then a rename into place.
    writeFileSync(join(dir, ".downloading-demo.db"), "x");
    writeFileSync(join(dir, "demo.db"), "x");
    writeFileSync(join(dir, "other.db"), "x");
    await settle();

    expect(calls).toBe(1);
  });

  it("stops firing once stopped", async () => {
    let calls = 0;
    const cancel = watchDirectory(dir, () => {
      calls++;
    });
    cancel();

    writeFileSync(join(dir, "demo.db"), "x");
    await settle();

    expect(calls).toBe(0);
  });

  it("survives a callback that throws", async () => {
    let calls = 0;
    stop = watchDirectory(dir, () => {
      calls++;
      throw new Error("refresh failed");
    });

    writeFileSync(join(dir, "one.db"), "x");
    await settle();
    writeFileSync(join(dir, "two.db"), "x");
    await settle();

    // A throwing refresh must not tear the watcher down: the second write is
    // still observed.
    expect(calls).toBe(2);
  });

  it("is a no-op for a directory that does not exist", async () => {
    let calls = 0;
    const missing = join(dir, "absent");
    stop = watchDirectory(missing, () => {
      calls++;
    });

    mkdirSync(missing);
    writeFileSync(join(missing, "demo.db"), "x");
    await settle();

    expect(calls).toBe(0);
  });
});
