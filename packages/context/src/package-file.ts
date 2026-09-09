/** Staging and replacement shared by package builds, copies, and downloads. */
import { copyFileSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPackageFileName, readPackageInfo } from "./store.js";

export function createPackageTempFile(directory: string) {
  // Keep staging on the destination filesystem for rename, and outside *.db
  // discovery. A private directory also contains any SQLite journal files.
  const tempDir = mkdtempSync(join(directory, ".context-"));
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
