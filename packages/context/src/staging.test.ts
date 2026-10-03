import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPackageTempFile } from "./package-file.js";
import {
  ensurePackagesDirectory,
  OWNER_FILE_NAME,
  OWNER_VERSION,
  sweepAbandonedStaging,
  writeOwnerMetadata,
} from "./staging.js";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    renameSync: vi.fn(fs.renameSync),
    rmSync: vi.fn(fs.rmSync),
  };
});

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "context-staging-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function stageFixture(name: string): string {
  const stagingDirectory = join(directory, `.context-${name}`);
  mkdirSync(stagingDirectory);
  return stagingDirectory;
}

describe("sweepAbandonedStaging", () => {
  it("removes a dead owner's staging directory and its SQLite sidecars", () => {
    const stagingDirectory = stageFixture("fixture");
    writeOwnerMetadata(stagingDirectory, {
      version: OWNER_VERSION,
      pid: 424242,
      hostname: hostname(),
    });
    writeFileSync(join(stagingDirectory, "package.tmp"), "partial database");
    writeFileSync(join(stagingDirectory, "package.tmp-journal"), "journal");
    writeFileSync(join(stagingDirectory, "package.tmp-wal"), "wal");
    writeFileSync(join(stagingDirectory, "package.tmp-shm"), "shm");

    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("No such process"), { code: "ESRCH" });
    });

    sweepAbandonedStaging(directory);

    expect(readdirSync(directory)).toEqual([]);
    expect(kill).toHaveBeenCalledWith(424242, 0);
  });

  it("does not fail package setup when a dead staging directory cannot be removed", () => {
    const stagingDirectory = stageFixture("fixture");
    writeOwnerMetadata(stagingDirectory, {
      version: OWNER_VERSION,
      pid: 424242,
      hostname: hostname(),
    });
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("No such process"), { code: "ESRCH" });
    });
    vi.mocked(rmSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
    });

    expect(() => ensurePackagesDirectory(directory)).not.toThrow();
    expect(readdirSync(directory)).toEqual([".context-fixture"]);
  });

  it("preserves a staging directory whose recorded process is alive", () => {
    const stagingDirectory = stageFixture("fixture");
    writeOwnerMetadata(stagingDirectory, {
      version: OWNER_VERSION,
      pid: 424242,
      hostname: hostname(),
    });

    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

    sweepAbandonedStaging(directory);

    expect(readdirSync(directory)).toEqual([".context-fixture"]);
    expect(kill).toHaveBeenCalledWith(424242, 0);
  });

  it("preserves an unmarked staging directory", () => {
    stageFixture("fixture");
    const kill = vi.spyOn(process, "kill");

    sweepAbandonedStaging(directory);

    expect(readdirSync(directory)).toEqual([".context-fixture"]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("preserves malformed owner metadata", () => {
    const stagingDirectory = stageFixture("fixture");
    writeFileSync(join(stagingDirectory, OWNER_FILE_NAME), "{not-json");
    const kill = vi.spyOn(process, "kill");

    sweepAbandonedStaging(directory);

    expect(readdirSync(directory)).toEqual([".context-fixture"]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("preserves unsupported owner metadata versions", () => {
    const stagingDirectory = stageFixture("fixture");
    writeOwnerMetadata(stagingDirectory, {
      version: OWNER_VERSION + 1,
      pid: 424242,
      hostname: hostname(),
    });
    const kill = vi.spyOn(process, "kill");

    sweepAbandonedStaging(directory);

    expect(readdirSync(directory)).toEqual([".context-fixture"]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("preserves owner metadata without a positive PID", () => {
    const stagingDirectory = stageFixture("fixture");
    writeOwnerMetadata(stagingDirectory, {
      version: OWNER_VERSION,
      pid: 0,
      hostname: hostname(),
    });
    const kill = vi.spyOn(process, "kill");

    sweepAbandonedStaging(directory);

    expect(readdirSync(directory)).toEqual([".context-fixture"]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("preserves foreign-host owner metadata", () => {
    const stagingDirectory = stageFixture("fixture");
    writeOwnerMetadata(stagingDirectory, {
      version: OWNER_VERSION,
      pid: 424242,
      hostname: "elsewhere.example",
    });
    const kill = vi.spyOn(process, "kill");

    sweepAbandonedStaging(directory);

    expect(readdirSync(directory)).toEqual([".context-fixture"]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("preserves when the liveness probe is refused with EPERM", () => {
    const stagingDirectory = stageFixture("fixture");
    writeOwnerMetadata(stagingDirectory, {
      version: OWNER_VERSION,
      pid: 424242,
      hostname: hostname(),
    });
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("Operation not permitted"), {
        code: "EPERM",
      });
    });

    sweepAbandonedStaging(directory);

    expect(readdirSync(directory)).toEqual([".context-fixture"]);
  });

  it("preserves on any other liveness probe error", () => {
    const stagingDirectory = stageFixture("fixture");
    writeOwnerMetadata(stagingDirectory, {
      version: OWNER_VERSION,
      pid: 424242,
      hostname: hostname(),
    });
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("Invalid argument"), { code: "EINVAL" });
    });

    sweepAbandonedStaging(directory);

    expect(readdirSync(directory)).toEqual([".context-fixture"]);
  });

  it("skips symlinks and directory junctions without following them", () => {
    const target = join(directory, "target");
    mkdirSync(target);
    writeFileSync(join(target, "kept.txt"), "kept");
    writeOwnerMetadata(target, {
      version: OWNER_VERSION,
      pid: 424242,
      hostname: hostname(),
    });
    symlinkSync(
      target,
      join(directory, ".context-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const kill = vi.spyOn(process, "kill");

    sweepAbandonedStaging(directory);

    expect(readdirSync(directory).sort()).toEqual([".context-link", "target"]);
    expect(readFileSync(join(target, "kept.txt"), "utf8")).toEqual("kept");
    expect(kill).not.toHaveBeenCalled();
  });

  it("leaves legacy .downloading-* entries untouched", () => {
    const legacy = join(directory, ".downloading-legacy.db");
    writeFileSync(legacy, "partial download");
    const stagingDirectory = stageFixture("fixture");
    writeOwnerMetadata(stagingDirectory, {
      version: OWNER_VERSION,
      pid: 424242,
      hostname: hostname(),
    });
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("No such process"), { code: "ESRCH" });
    });

    sweepAbandonedStaging(directory);

    expect(readdirSync(directory)).toEqual([".downloading-legacy.db"]);
    expect(readFileSync(legacy, "utf8")).toEqual("partial download");
  });

  it("sweeps are safe to run concurrently", async () => {
    const stagingDirectory = stageFixture("fixture");
    writeOwnerMetadata(stagingDirectory, {
      version: OWNER_VERSION,
      pid: 424242,
      hostname: hostname(),
    });
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("No such process"), { code: "ESRCH" });
    });

    await Promise.all([
      sweepAbandonedStaging(directory),
      sweepAbandonedStaging(directory),
    ]);

    expect(readdirSync(directory)).toEqual([]);
  });
});

describe("createPackageTempFile ownership", () => {
  it("marks newly created staging directories with the current owner", () => {
    const temp = createPackageTempFile(directory);
    try {
      const stagingDirectories = readdirSync(directory);
      expect(stagingDirectories).toHaveLength(1);
      const owner = JSON.parse(
        readFileSync(
          join(directory, stagingDirectories[0], OWNER_FILE_NAME),
          "utf8",
        ),
      );
      expect(owner).toEqual({
        version: OWNER_VERSION,
        pid: process.pid,
        hostname: hostname(),
      });
    } finally {
      temp.cleanup();
    }
  });

  it("removes a just-created staging directory when owner publication fails", () => {
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error("owner publication failed");
    });

    expect(() => createPackageTempFile(directory)).toThrow(
      "owner publication failed",
    );
    expect(readdirSync(directory)).toEqual([]);
  });
});
