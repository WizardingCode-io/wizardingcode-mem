// The staged binary as a process finds it, and the one rule on who may run it. A leaf of
// this folder: the report and the hand-over both read it.
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { stagedPath, stagedVersion } from "../install/binary.ts";

export interface StagedFacts {
  path: string;
  exists: boolean;
  /** The version the staged binary answers; null when there is none or it answers none. */
  version: string | null;
  /** Whether this process is the staged binary. */
  isSelf: boolean;
  /** Whether the file was left unrun: this command is root, or the folder is another user's. */
  refused: boolean;
}

/** Who is asking: the platform and the effective user, null where there is none. */
export interface Who {
  platform: string;
  uid: number | null;
}
export const whoAmI = (): Who => ({
  platform: process.platform,
  uid: process.geteuid?.() ?? null,
});

/**
 * Whether this process may run the file staged in the data directory. Never as root and
 * never from a folder of another user: that file is the user's to write. Windows has no
 * user ids to compare.
 */
export function mayRunStaged(input: {
  platform: string;
  uid: number | null;
  binOwner: number | null;
}): boolean {
  if (input.platform === "win32") return true;
  return input.uid !== null && input.uid !== 0 && input.binOwner === input.uid;
}

/** Who owns the folder the staged binary is in, or null when that cannot be read. */
export function binOwner(path: string): number | null {
  try {
    return lstatSync(dirname(path)).uid;
  } catch {
    return null;
  }
}

/** The staged binary as this process finds it. It is run only when it is another file, and only by its owner. */
export function stagedFacts(dataDir: string, running: string, who: Who = whoAmI()): StagedFacts {
  const path = stagedPath(dataDir);
  if (!existsSync(path))
    return { path, exists: false, version: null, isSelf: false, refused: false };
  if (realpathSync(path) === realpathSync(process.execPath))
    return { path, exists: true, version: running, isSelf: true, refused: false };
  const allowed = mayRunStaged({ ...who, binOwner: binOwner(path) });
  return {
    path,
    exists: true,
    version: allowed ? stagedVersion(path) : null,
    isSelf: false,
    refused: !allowed,
  };
}
