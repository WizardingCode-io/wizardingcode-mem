import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { backupName, lastBackup, restoreBackup, runBackup } from "../../src/backup/backup.ts";
import { backupDue } from "../../src/backup/schedule.ts";
import { folderTarget, parseBackupName, parseS3Url } from "../../src/backup/target.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { DB_FILE, type Db, LATEST_VERSION, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { claimLease, leaseActive, releaseLease } from "../../src/store/meta.ts";

const NOW = Date.UTC(2026, 9, 6, 10, 30, 15);
const HOUR = 3_600_000;

let base: string;
let storeDir: string;
let folder: string;
let db: Db;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-backup-")));
  storeDir = join(base, "store");
  folder = join(base, "nas", "backups");
  mkdirSync(join(base, "project"));
  db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
  const projectId = resolveProject(db, join(base, "project"), NOW).id;
  for (let i = 0; i < 4; i++) {
    insertMemory(db, {
      projectId,
      kind: "fix",
      title: `Fix ${i}`,
      body: "" as Redacted,
      terms: "",
      importance: 3,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: NOW,
    });
  }
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

const memories = (path: string) => {
  const probe = new Database(path, { readonly: true });
  try {
    return probe.query<{ n: number }, []>("SELECT count(*) AS n FROM memories").get()?.n ?? -1;
  } finally {
    probe.close();
  }
};
function gunzipTo(gz: string, out: string): void {
  writeFileSync(out, gunzipSync(readFileSync(gz)));
}
const run = (now = NOW, keep = 10) =>
  runBackup({ db, storeDir, target: folderTarget(folder), keep, now, owner: "test" });

describe("backupName", () => {
  test("sorts by time and carries the schema version", () => {
    expect(backupName(NOW, 2)).toBe("wizardingcode-mem-20261006T103015Z-v2.db.gz");
  });

  test("still knows the copies made under the old name", () => {
    expect(parseBackupName("shibaox-mem-20261006T103015Z-v2.db.gz")).toEqual({
      at: NOW,
      version: 2,
    });
  });
});

describe("runBackup to a folder", () => {
  test("writes a compressed, consistent copy and remembers it", async () => {
    const outcome = await run();
    expect(outcome).toMatchObject({ ok: true, name: backupName(NOW, LATEST_VERSION) });
    const gz = join(folder, backupName(NOW, LATEST_VERSION));
    expect(existsSync(gz)).toBe(true);
    const restored = join(base, "check.db");
    gunzipTo(gz, restored);
    expect(memories(restored)).toBe(4);
    const probe = new Database(restored, { readonly: true });
    expect(probe.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check).toBe(
      "ok",
    );
    probe.close();
    expect(lastBackup(db)).toMatchObject({
      name: backupName(NOW, LATEST_VERSION),
      at: NOW,
      label: folder,
    });
    expect((lastBackup(db) as { bytes: number }).bytes).toBeGreaterThan(0);
    // Nothing of ours is left in the store besides the database.
    expect(readdirSync(join(storeDir, "backups")).filter((n) => n.startsWith(".tmp"))).toEqual([]);
  });

  test("keeps only the newest N, and leaves other people's files alone", async () => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "..", "notes.txt"), "x");
    writeFileSync(join(folder, "unrelated.db.gz"), "x");
    for (let i = 0; i < 4; i++) await run(NOW + i * HOUR, 2);
    const ours = readdirSync(folder)
      .filter((n) => n.startsWith("wizardingcode-mem-"))
      .sort();
    expect(ours).toEqual([
      backupName(NOW + 2 * HOUR, LATEST_VERSION),
      backupName(NOW + 3 * HOUR, LATEST_VERSION),
    ]);
    expect(existsSync(join(folder, "unrelated.db.gz"))).toBe(true);
  });

  test("two at once: the second leaves at once", async () => {
    claimLease(db, "backup.lease", "someone else", NOW, 60_000);
    expect(await run()).toMatchObject({ ok: false, reason: "busy" });
    expect(existsSync(folder) && readdirSync(folder).length > 0).toBe(false);
  });

  test("a target it cannot write to is a failure, not a crash", async () => {
    writeFileSync(join(base, "a-file"), "in the way");
    const outcome = await runBackup({
      db,
      storeDir,
      target: folderTarget(join(base, "a-file", "deeper")),
      keep: 3,
      now: NOW,
      owner: "test",
    });
    expect(outcome).toMatchObject({ ok: false, reason: "failed" });
    expect(lastBackup(db)).toBeNull();
  });
});

describe("backupDue", () => {
  test("is due when none was ever made, after the interval, and never when turned off", async () => {
    expect(backupDue(db, 24, NOW)).toBe(true);
    expect(backupDue(db, 0, NOW)).toBe(false);
    await run();
    expect(backupDue(db, 24, NOW + 23 * HOUR)).toBe(false);
    expect(backupDue(db, 24, NOW + 25 * HOUR)).toBe(true);
    expect(backupDue(db, 0, NOW + 25 * HOUR)).toBe(false);
  });
});

describe("restoreBackup", () => {
  test("puts the copy in place and keeps what was there", async () => {
    await run();
    db.run("DELETE FROM memories");
    expect(memories(join(storeDir, DB_FILE))).toBe(0);
    db.close();
    const outcome = await restoreBackup({
      storeDir,
      target: folderTarget(folder),
      name: backupName(NOW, LATEST_VERSION),
      now: NOW + HOUR,
    });
    expect(outcome).toMatchObject({ ok: true });
    expect(memories(join(storeDir, DB_FILE))).toBe(4);
    const replaced = readdirSync(storeDir).filter((n) => /\.replaced-\d+$/.test(n));
    expect(replaced).toHaveLength(1);
    expect(memories(join(storeDir, replaced[0] as string))).toBe(0);
    db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
    expect(memories(join(storeDir, DB_FILE))).toBe(4);
  });

  test("refuses a copy that is not a sound database of a version it knows", async () => {
    mkdirSync(folder, { recursive: true });
    const garbage = backupName(NOW, 2);
    writeFileSync(join(folder, garbage), gzipSync("not a database"));
    const newer = openDb({ dataDir: join(base, "newer"), busyTimeoutMs: 2000 });
    newer.run("PRAGMA user_version = 99");
    newer.close();
    writeFileSync(
      join(folder, backupName(NOW + HOUR, 99)),
      gzipSync(readFileSync(join(base, "newer", DB_FILE))),
    );
    db.close();
    for (const name of [
      garbage,
      backupName(NOW + HOUR, 99),
      "wizardingcode-mem-20990101T000000Z-v2.db.gz",
    ]) {
      const outcome = await restoreBackup({
        storeDir,
        target: folderTarget(folder),
        name,
        now: NOW,
      });
      expect(outcome.ok).toBe(false);
    }
    expect(memories(join(storeDir, DB_FILE))).toBe(4);
    expect(readdirSync(storeDir).filter((n) => n.includes("replaced"))).toEqual([]);
    db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
  });
});

describe("parseS3Url", () => {
  test("splits bucket and prefix", () => {
    expect(parseS3Url("s3://my-bucket/some/prefix")).toEqual({
      bucket: "my-bucket",
      prefix: "some/prefix/",
    });
    expect(parseS3Url("s3://my-bucket")).toEqual({ bucket: "my-bucket", prefix: "" });
    expect(parseS3Url("s3://my-bucket/")).toEqual({ bucket: "my-bucket", prefix: "" });
    expect(parseS3Url("/a/folder")).toBeNull();
  });
});

describe("leases", () => {
  test("a lease whose owner process is gone no longer counts", () => {
    expect(claimLease(db, "backup.lease", `${process.pid}-live`, NOW, 60_000)).toBe(true);
    expect(leaseActive(db, "backup.lease", NOW)).toBe(true);
    releaseLease(db, "backup.lease", `${process.pid}-live`);

    expect(claimLease(db, "backup.lease", "999999-gone", NOW, 60_000)).toBe(true);
    expect(leaseActive(db, "backup.lease", NOW)).toBe(false);
    // And it can be taken over.
    expect(claimLease(db, "backup.lease", "someone", NOW, 60_000)).toBe(true);
    // An owner that names no process is trusted until it expires.
    expect(leaseActive(db, "backup.lease", NOW)).toBe(true);
    expect(leaseActive(db, "backup.lease", NOW + 61_000)).toBe(false);
  });
});
