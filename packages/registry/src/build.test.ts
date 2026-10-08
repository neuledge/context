import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getHeadCommit, MissingSourceRefError } from "./build.js";

describe("remote Git commit resolution", () => {
  let root: string;
  let url: string;
  let commit: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "registry-refs-"));
    url = pathToFileURL(root).href;
    git("init", "--initial-branch=main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    writeFileSync(join(root, "doc.md"), "documentation");
    git("add", ".");
    git("commit", "-m", "docs");
    commit = git("rev-parse", "HEAD");
    git("tag", "-a", "annotated", "-m", "release");
    git("tag", "lightweight");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    undefined,
    "main",
    "refs/heads/main",
    "annotated",
    "refs/tags/annotated",
    "lightweight",
    "refs/tags/lightweight",
  ])("resolves %s to the cloned commit", (ref) => {
    expect(getHeadCommit(url, ref)).toBe(commit);
  });

  it("prefers a branch over a same-named annotated tag", () => {
    git("branch", "annotated");
    git("checkout", "annotated");
    writeFileSync(join(root, "doc.md"), "updated documentation");
    git("commit", "-am", "update");
    expect(getHeadCommit(url, "annotated")).toBe(git("rev-parse", "HEAD"));
    expect(getHeadCommit(url, "refs/tags/annotated")).toBe(commit);
  });

  it("distinguishes missing refs from an inaccessible repository", () => {
    expect(() => getHeadCommit(url, "missing-tag")).toThrow(
      MissingSourceRefError,
    );
    expect(() =>
      getHeadCommit(pathToFileURL(join(root, "missing-repo")).href, "main"),
    ).toThrow();
    try {
      getHeadCommit(pathToFileURL(join(root, "missing-repo")).href, "main");
    } catch (error) {
      expect(error).not.toBeInstanceOf(MissingSourceRefError);
    }
  });
});
