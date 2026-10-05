import { afterEach, describe, expect, it, vi } from "vitest";
import { type WatchFn, type WatchHandle, watchDirectory } from "./watch.js";

class FakeWatchHandle implements WatchHandle {
  closed = false;
  unrefed = false;
  private errorListener: ((error: Error) => void) | null = null;

  on(event: "error", listener: (error: Error) => void): this {
    if (event === "error") this.errorListener = listener;
    return this;
  }

  close(): void {
    this.closed = true;
  }

  unref(): void {
    this.unrefed = true;
  }

  emitError(error: Error): void {
    this.errorListener?.(error);
  }
}

interface FakeWatch {
  handles: FakeWatchHandle[];
  changeListeners: Array<(eventType: string, filename: string | null) => void>;
  watchFn: WatchFn;
}

function makeFakeWatch(): FakeWatch {
  const handles: FakeWatchHandle[] = [];
  const changeListeners: Array<
    (eventType: string, filename: string | null) => void
  > = [];
  const watchFn: WatchFn = (_directory, listener) => {
    const handle = new FakeWatchHandle();
    handles.push(handle);
    changeListeners.push(listener);
    return handle;
  };
  return { handles, changeListeners, watchFn };
}

describe("watchDirectory", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces bursts and still fires for events spaced across the window", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const fake = makeFakeWatch();
    const stop = watchDirectory("/packages", callback, {
      watchFn: fake.watchFn,
      exists: () => true,
      debounceMs: 200,
    });

    const change = fake.changeListeners[0];
    expect(change).toBeDefined();

    // Two events within the window collapse into one callback.
    change?.("change", "a.db");
    vi.advanceTimersByTime(100);
    change?.("change", "b.db");
    vi.advanceTimersByTime(100);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);

    // An event arriving after the window fires a second callback.
    change?.("change", "c.db");
    vi.advanceTimersByTime(200);
    expect(callback).toHaveBeenCalledTimes(2);

    stop();
  });

  it("contains callback exceptions and keeps firing for later events", () => {
    vi.useFakeTimers();
    const callback = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("reload failed");
      })
      .mockImplementation(() => {});
    const fake = makeFakeWatch();
    const stop = watchDirectory("/packages", callback, {
      watchFn: fake.watchFn,
      exists: () => true,
      debounceMs: 200,
    });

    const change = fake.changeListeners[0];
    expect(change).toBeDefined();

    change?.("change", "a.db");
    vi.advanceTimersByTime(200);
    expect(callback).toHaveBeenCalledTimes(1);

    // The first callback threw, but the watcher survived and still fires.
    change?.("change", "b.db");
    vi.advanceTimersByTime(200);
    expect(callback).toHaveBeenCalledTimes(2);

    stop();
  });

  it("survives an ENOSPC watcher error and re-attaches", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const fake = makeFakeWatch();
    const stop = watchDirectory("/packages", callback, {
      watchFn: fake.watchFn,
      exists: () => true,
      debounceMs: 200,
      retryMs: 50,
    });

    expect(fake.handles).toHaveLength(1);
    const first = fake.handles[0];
    const enospc = Object.assign(new Error("no space left"), {
      code: "ENOSPC",
    });

    first?.emitError(enospc);
    expect(first?.closed).toBe(true);

    // After the retry interval a fresh watcher is attached.
    vi.advanceTimersByTime(50);
    expect(fake.handles).toHaveLength(2);

    // Re-attaching schedules a reload, then later events still work.
    vi.advanceTimersByTime(200);
    expect(callback).toHaveBeenCalledTimes(1);

    fake.changeListeners[1]?.("change", "a.db");
    vi.advanceTimersByTime(200);
    expect(callback).toHaveBeenCalledTimes(2);

    stop();
  });

  it("recovers after the watched directory is removed and recreated", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const fake = makeFakeWatch();
    const exists = { current: true };
    const stop = watchDirectory("/packages", callback, {
      watchFn: fake.watchFn,
      exists: () => exists.current,
      debounceMs: 200,
      retryMs: 50,
    });

    const first = fake.handles[0];
    const change = fake.changeListeners[0];

    // The directory disappears; the final rename event triggers removal
    // detection (a detach + poll) rather than a reload.
    exists.current = false;
    change?.("rename", "packages");
    vi.advanceTimersByTime(200);
    expect(callback).not.toHaveBeenCalled();
    expect(first?.closed).toBe(true);

    // While it stays gone the watcher keeps polling without reloading.
    vi.advanceTimersByTime(200);
    expect(fake.handles).toHaveLength(1);
    expect(callback).not.toHaveBeenCalled();

    // Recreation re-attaches the watcher and reloads.
    exists.current = true;
    vi.advanceTimersByTime(50);
    expect(fake.handles).toHaveLength(2);

    vi.advanceTimersByTime(200);
    expect(callback).toHaveBeenCalledTimes(1);

    stop();
  });

  it("re-attaches on a rename even when the directory already exists again", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const fake = makeFakeWatch();
    const stop = watchDirectory("/packages", callback, {
      watchFn: fake.watchFn,
      exists: () => true,
      debounceMs: 200,
      retryMs: 50,
    });

    const first = fake.handles[0];
    const rename = fake.changeListeners[0];

    // The directory is removed and recreated before the debounce expires: the
    // rename event arrives with the path present again, but the first watcher
    // is still attached to the old inode and must be replaced.
    rename?.("rename", "packages");

    expect(first?.closed).toBe(true);
    expect(fake.handles).toHaveLength(2);

    // The rename itself schedules a reload...
    vi.advanceTimersByTime(200);
    expect(callback).toHaveBeenCalledTimes(1);

    // ...and the replacement watcher keeps observing later changes.
    fake.changeListeners[1]?.("change", "a.db");
    vi.advanceTimersByTime(200);
    expect(callback).toHaveBeenCalledTimes(2);

    stop();
  });
});
