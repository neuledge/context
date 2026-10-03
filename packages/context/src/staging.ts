/**
 * Ownership and reclamation for `.context-*` package staging directories.
 *
 * `createPackageTempFile` stages a package inside a private `.context-*`
 * directory and removes it in the operation's `finally`. A hard shutdown
 * (SIGKILL, power loss, or a crash before `finally` runs) can leave that
 * directory behind. Each new staging directory therefore carries a small
 * owner marker, published atomically before the directory is handed back to
 * the writer, so a later setup step can tell an abandoned directory from one
 * whose writer is still alive.
 *
 * Scope note: only directories created after this protocol (`owner.json`)
 * can be reclaimed safely. Legacy `.downloading-*` temporary files predate the
 * protocol, carry no owner marker, and may belong to an active older writer,
 * so they are deliberately left untouched here. Unmarked `.context-*`
 * directories are likewise preserved.
 *
 * PID liveness is meaningful only within one PID namespace. The default package
 * directory is local to the user; do not use this sweep for a shared directory
 * mounted by processes in separate containers or hosts.
 */

import {
  type Dirent,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

export const STAGING_PREFIX = ".context-";
export const OWNER_FILE_NAME = "owner.json";
export const OWNER_VERSION = 1;

export interface OwnerMetadata {
  version: number;
  pid: number;
  hostname: string;
}

/** Ensure a package directory exists and reclaim abandoned staging left in it. */
export function ensurePackagesDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true });
  sweepAbandonedStaging(directory);
}

/**
 * Remove `.context-*` staging directories whose recorded owner process is no
 * longer running. Only immediate child directories participate; symlinks are
 * never followed or removed, and legacy `.downloading-*` entries are never
 * touched. Any entry without a valid owner marker is preserved: the writer may
 * be an older version that predates the protocol, or the marker may not have
 * been published yet.
 */
export function sweepAbandonedStaging(directory: string): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // Cleanup is best-effort: a directory that cannot be listed must not stop
    // the build or download that triggered the sweep.
    return;
  }

  for (const entry of entries) {
    if (!entry.name.startsWith(STAGING_PREFIX)) continue;
    // A Windows junction may look like an ordinary directory to Dirent and
    // lstat, but readlink succeeds for both junctions and symbolic links.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const stagingDirectory = join(directory, entry.name);
    try {
      readlinkSync(stagingDirectory);
      continue;
    } catch (error) {
      // EINVAL is how readlink reports a real directory. On any other error,
      // preserve the path because it may be an inaccessible link or junction.
      if ((error as NodeJS.ErrnoException).code !== "EINVAL") continue;
    }
    try {
      if (!lstatSync(stagingDirectory).isDirectory()) continue;
    } catch {
      // The entry may have disappeared or be inaccessible; preserve it.
      continue;
    }

    const owner = readOwnerMetadata(stagingDirectory);
    if (!owner) continue;
    // Hostname is a conservative extra check, not proof that PID namespaces
    // match; the configured package directory must remain local to one namespace.
    if (owner.hostname !== hostname()) continue;

    if (isProcessAbsent(owner.pid)) {
      try {
        rmSync(stagingDirectory, { recursive: true, force: true });
      } catch {
        // Reclamation is best-effort; a locked or unreadable leftover must not
        // make subsequent package work fail.
      }
    }
  }
}

/**
 * Write the current process's ownership marker atomically: a sweep that runs
 * concurrently sees either no marker (preserve) or a complete marker (owner
 * process already recorded), never a half-written one.
 */
export function writeOwnerMetadata(
  stagingDirectory: string,
  owner: OwnerMetadata = {
    version: OWNER_VERSION,
    pid: process.pid,
    hostname: hostname(),
  },
): void {
  const target = join(stagingDirectory, OWNER_FILE_NAME);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(owner));
  renameSync(temporary, target);
}

function readOwnerMetadata(stagingDirectory: string): OwnerMetadata | null {
  try {
    const raw = readFileSync(join(stagingDirectory, OWNER_FILE_NAME), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isOwnerMetadata(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isOwnerMetadata(value: unknown): value is OwnerMetadata {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === OWNER_VERSION &&
    typeof record.pid === "number" &&
    Number.isInteger(record.pid) &&
    record.pid > 0 &&
    typeof record.hostname === "string" &&
    record.hostname.length > 0
  );
}

/**
 * Probe a recorded owner PID without signaling it. A process is considered
 * absent only when `process.kill(pid, 0)` throws `ESRCH`. Success means the
 * process is alive; `EPERM` means it exists but belongs to someone else; any
 * other error is ambiguous. All of those preserve the directory, so PID reuse
 * or a transient probe failure can only leave a directory behind, never delete
 * an active writer's staging.
 */
function isProcessAbsent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
