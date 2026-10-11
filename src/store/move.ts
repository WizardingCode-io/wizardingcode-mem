// Moving the database to another directory: an external disk, a NAS mounted as a folder.
// The copy is a consistent snapshot taken while writers are held off; the settings file
// then points every later process at the new place; the old file is kept, renamed.
import { Database } from "bun:sqlite";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, resolve, win32 } from "node:path";
import { ENV_FILE, writeEnvFile } from "../settings/env-file.ts";
import { DB_FILE, LATEST_VERSION } from "./db.ts";
import { anyLeaseActive } from "./meta.ts";

export interface TargetReport {
  path: string;
  exists: boolean;
  /** A database is already there: moving onto it would lose it. */
  hasDb: boolean;
  writable: boolean;
  /** On a network filesystem, as far as this machine can tell. */
  network: boolean;
  fsType: string | null;
  warnings: string[];
}

const NETWORK_FS = /^(nfs|smbfs|cifs|afpfs|webdav|fuse\.sshfs|sshfs|9p)/i;
const NO_PERMISSIONS_FS = /^(exfat|msdos|vfat|fat32|ntfs)/i;

/** The filesystem type of the mount holding `path`, from the system's mount table. */
function fsTypeOf(path: string): string | null {
  try {
    const mounts: { point: string; type: string }[] = [];
    if (process.platform === "linux") {
      for (const line of readFileSync("/proc/mounts", "utf8").split("\n")) {
        const [, point, type] = line.split(" ");
        if (point && type) mounts.push({ point, type });
      }
    } else if (process.platform === "darwin") {
      const out = Bun.spawnSync(["mount"], { stdout: "pipe", stderr: "ignore" });
      for (const line of out.stdout.toString().split("\n")) {
        const match = /^.+ on (.+) \(([^,)]+)/.exec(line);
        if (match) mounts.push({ point: match[1] as string, type: match[2] as string });
      }
    } else {
      return null;
    }
    const best = mounts
      .filter(
        (m) => path === m.point || path.startsWith(m.point.endsWith("/") ? m.point : `${m.point}/`),
      )
      .sort((a, b) => b.point.length - a.point.length)[0];
    return best?.type ?? null;
  } catch {
    return null;
  }
}

/** What a move to `path` would meet. Never throws; problems come back as warnings. */
export function inspectTarget(path: string): TargetReport {
  const warnings: string[] = [];
  const unc = /^\\\\/.test(path);
  if (!(isAbsolute(path) || win32.isAbsolute(path))) {
    return {
      path,
      exists: false,
      hasDb: false,
      writable: false,
      network: false,
      fsType: null,
      warnings: ["the path must be absolute"],
    };
  }
  const exists = existsSync(path);
  const hasDb = exists && existsSync(join(path, DB_FILE));
  // The nearest existing ancestor decides the filesystem and whether we may write.
  let probe = path;
  while (!existsSync(probe)) {
    const parent = resolve(probe, "..");
    if (parent === probe) break;
    probe = parent;
  }
  let writable = false;
  try {
    accessSync(probe, constants.W_OK);
    writable = existsSync(probe) && statSync(probe).isDirectory();
  } catch {
    writable = false;
  }
  const fsType = unc ? "smb" : existsSync(probe) ? fsTypeOf(probe) : null;
  const network = unc || (fsType !== null && NETWORK_FS.test(fsType));
  if (network) {
    warnings.push(
      "this is a network filesystem: SQLite's locking is not reliable there, and a copy taken over the network can be corrupted. A folder on a disk attached to this machine is safe; for a NAS, prefer backups to it.",
    );
  }
  if (fsType !== null && NO_PERMISSIONS_FS.test(fsType)) {
    warnings.push(
      "this filesystem keeps no permissions: anyone who can read the disk can read the memories.",
    );
  }
  if (
    /[\\/](?:Dropbox|OneDrive|Google Drive|iCloud Drive|Mobile Documents)[\\/]/i.test(`${path}/`)
  ) {
    warnings.push(
      "this folder is synced by another program, which can copy the database behind SQLite's back.",
    );
  }
  if (hasDb) warnings.push("a wizardingcode-mem database is already there; it would be lost.");
  if (!writable) warnings.push("cannot write there.");
  return { path, exists, hasDb, writable, network, fsType, warnings };
}

export interface MoveOptions {
  /** The data directory: where the settings file that records the store is. */
  dataDir: string;
  from: string;
  to: string;
  now: number;
  /** Tests: runs while writers are held off, before the copy. */
  onFrozen?: () => void;
}

export type MoveOutcome =
  | { ok: true; to: string; keptOld: string; bytes: number }
  | {
      ok: false;
      reason: "same" | "busy" | "target-has-db" | "not-writable" | "copy-failed";
      detail: string;
    };

const FREEZE_WAIT_MS = 10_000;

/**
 * Moves the store from `from` to `to`. Writers are held off with a write transaction on
 * a second connection while `VACUUM INTO` takes a consistent copy; the copy is checked
 * before anything points at it; the old file is renamed, never deleted.
 */
export async function moveStore(options: MoveOptions): Promise<MoveOutcome> {
  const { dataDir, from, to, now } = options;
  if (resolve(from) === resolve(to)) {
    return { ok: false, reason: "same", detail: "the store is already there" };
  }
  const report = inspectTarget(to);
  if (report.hasDb) {
    return { ok: false, reason: "target-has-db", detail: "a database is already there" };
  }
  if (!report.writable) {
    return { ok: false, reason: "not-writable", detail: "cannot write there" };
  }
  const source = join(from, DB_FILE);
  const lock = new Database(source);
  const copier = new Database(source, { readonly: true });
  let frozen = false;
  try {
    lock.run(`PRAGMA busy_timeout = ${FREEZE_WAIT_MS}`);
    if (anyLeaseActive(lock, now)) {
      return {
        ok: false,
        reason: "busy",
        detail: "background work holds the database; try again in a minute",
      };
    }
    lock.run("PRAGMA wal_checkpoint(TRUNCATE)");
    // From here no other process can commit: the copy is the final state.
    lock.run("BEGIN IMMEDIATE");
    frozen = true;
    options.onFrozen?.();
    mkdirSync(to, { recursive: true, mode: 0o700 });
    const tmp = join(to, `${DB_FILE}.tmp`);
    rmSync(tmp, { force: true });
    copier.run(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
    const problem = verifyCopy(lock, tmp);
    if (problem !== null) {
      rmSync(tmp, { force: true });
      return { ok: false, reason: "copy-failed", detail: problem };
    }
    renameSync(tmp, join(to, DB_FILE));
    writeEnvFile(join(dataDir, ENV_FILE), { WIZARDINGCODE_MEM_STORE_DIR: to });
    const keptOld = join(from, `${DB_FILE}.moved-${now}`);
    renameSync(source, keptOld);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(source + suffix)) renameSync(source + suffix, keptOld + suffix);
    }
    return { ok: true, to, keptOld, bytes: statSync(join(to, DB_FILE)).size };
  } catch (error) {
    return {
      ok: false,
      reason: "copy-failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (frozen) {
      try {
        lock.run("ROLLBACK");
      } catch {
        // The lock went with the file.
      }
    }
    copier.close();
    lock.close();
  }
}

/** Null when the copy is sound and complete; otherwise what is wrong with it. */
function verifyCopy(original: Database, copyPath: string): string | null {
  const copy = new Database(copyPath, { readonly: true });
  try {
    const check = copy.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check;
    if (check !== "ok") return `the copy failed its integrity check: ${check ?? "unknown"}`;
    const version = copy
      .query<{ user_version: number }, []>("PRAGMA user_version")
      .get()?.user_version;
    const expected = original
      .query<{ user_version: number }, []>("PRAGMA user_version")
      .get()?.user_version;
    if (version !== expected || (version ?? 0) > LATEST_VERSION) {
      return `the copy has schema version ${version}, the original ${expected}`;
    }
    const count = (db: Database) =>
      db.query<{ n: number }, []>("SELECT count(*) AS n FROM memories").get()?.n ?? -1;
    if (count(copy) !== count(original)) return "the copy does not hold every memory";
    return null;
  } finally {
    copy.close();
  }
}
