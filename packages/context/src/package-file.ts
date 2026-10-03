/** Staging and replacement shared by package builds, copies, and downloads. */
import { copyFileSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeOwnerMetadata } from "./staging.js";
import { getPackageFileName, readPackageInfo } from "./store.js";

export function createPackageTempFile(directory: string) {
  // Keep staging on the destination filesystem for rename, and outside *.db
  // discovery. A private directory also contains any SQLite journal files.
  // Callers ensure the package store when needed; this can also be an arbitrary
  // user-supplied output directory, which must not be swept here.
  const tempDir = mkdtempSync(join(directory, ".context-"));
  try {
    // Publish the owner marker before the staging directory is returned, so a
    // concurrent sweep can never see a directory that is in use but unowned.
    writeOwnerMetadata(tempDir);
  } catch (error) {
    // The directory was never exposed to the writer; remove it and surface the
    // original failure rather than leaving an unmarked directory behind.
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
  const path = join(tempDir, "package.tmp");

  return {
    path,
    install(outputPath?: string) {
      const info = readPackageInfo(path);
      const destination =
        outputPath ??
        join(directory, getPackageFileName(info.name, info.version));

      // Rename replaces an existing file. Never unlink it first: a failed
      // rename (including a Windows sharing violation) must preserve it.
      renameSync(path, destination);
      return { ...info, path: destination };
    },
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

export function copyPackageFile(sourcePath: string, outputPath: string): void {
  const temp = createPackageTempFile(dirname(outputPath));
  try {
    copyFileSync(sourcePath, temp.path);
    temp.install(outputPath);
  } finally {
    temp.cleanup();
  }
}
