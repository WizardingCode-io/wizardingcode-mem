// A team's data directory as a restore meets it: a server that ran, an upgrade that migrated,
// rows written since, and a copy taken while the last row was only in the log. All times are
// wall time; nothing here uses the fake clock.
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryUid } from "../../src/sharing/types.ts";
import {
  type Migration,
  openTeamForWrite,
  TEAM_LATEST,
  TEAM_MIGRATIONS,
  teamPaths,
} from "../../src/team/db.ts";
import {
  currentMarks,
  type Marks,
  readHighWater,
  writeHighWater,
} from "../../src/team/instance.ts";
import { createTeamLog } from "../../src/team/log.ts";
import { fileNameFor, runMirror } from "../../src/team/mirror.ts";
import { type AuditSource, getMeta, insertAudit } from "../../src/team/store.ts";
import {
  adminOf,
  api,
  entryPayload,
  memberOf,
  memoryPayload,
  pushOne,
  sendOf,
  startTestServer,
} from "./team.ts";

/** The tests stand in for a newer binary by a schema one above the real one. */
export const NEXT = TEAM_LATEST + 1;
const PROBE_MIGRATION: Migration = {
  version: NEXT,
  name: "restore_probe",
  sql: "CREATE TABLE restore_probe (x INTEGER)",
};
export const NEXT_MIGRATIONS: readonly Migration[] = [...TEAM_MIGRATIONS, PROBE_MIGRATION];

const images: string[] = [];

/** Removes the crash images; the worlds are the team helper's (`cleanTestDirs`). */
export function cleanRestoreDirs(): void {
  for (const dir of images.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const uuidOf = (uid: string) => uid.slice(-36);

export interface WorldIds {
  admin: { memberId: string; deviceId: string };
  ana: { memberId: string; deviceId: string };
  rui: { memberId: string; deviceId: string };
  old: { uid: string; file: string };
  doomed: { uid: string; file: string };
  /** An entry its member withdraws after the upgrade. */
  unshared: { uid: string };
  /** A project's entry whose alias no shell reads as plain text. */
  odd: { uid: string };
  memoryUid: string;
  /** The invitation minted before the upgrade and not used by then. */
  invitation: string;
  instance: string;
  marks: Marks;
}

export interface SinceIds {
  fresh: { uid: string; file: string };
  zoe: { memberId: string; devices: [string, string] };
  /** The invitation made, and used, after the upgrade copy. */
  lateInvitation: string;
}

function mirror(dir: string, db: Database): void {
  const run = runMirror(
    {
      db,
      dataDir: dir,
      env: { PATH: process.env.PATH ?? "", HOME: join(dir, "home") },
      log: createTeamLog(() => {}, Date.now),
      now: Date.now,
    },
    { rebuild: false },
  );
  if (run.errors.length > 0) throw new Error(`mirror: ${JSON.stringify(run.errors)}`);
}

/** A server that ran on the real schema, with members, items, an open invitation and a mirror. */
export async function world(): Promise<{ dir: string; ids: WorldIds }> {
  const dir = mkdtempSync(join(tmpdir(), "wcm-restore-"));
  const t = await startTestServer({ now: Date.now, dataDir: dir });
  const admin = await adminOf(t);
  const ana = await memberOf(t, admin.token, "Ana");
  const rui = await memberOf(t, admin.token, "Rui");
  const old = entryPayload({ scope: "shared", slug: "old" });
  const doomed = entryPayload({ scope: "shared", slug: "doomed" });
  const unshared = entryPayload({ scope: "shared", slug: "unshared" });
  const odd = entryPayload({
    scope: "project",
    remoteAlias: "remote:github.com/acme/it's;$(id)",
    slug: "odd",
  });
  const memory = memoryPayload();
  for (const payload of [old, doomed, unshared, odd, memory]) {
    const result = await pushOne(t.server, ana.token, sendOf(payload));
    if (result.result !== "applied") throw new Error(`push: ${JSON.stringify(result)}`);
  }
  const made = await api(t.server, admin.token, "POST", "/v1/invitations", {
    role: "member",
    name: "Zoe",
  });
  if (made.status !== 201) throw new Error(`invite: ${made.status}`);
  mirror(dir, t.server.db);
  const instance = getMeta(t.server.db, "server.instance") as string;
  await t.close();
  return {
    dir,
    ids: {
      admin,
      ana,
      rui,
      old: { uid: old.uid, file: fileNameFor(uuidOf(old.uid), "old") },
      doomed: { uid: doomed.uid, file: fileNameFor(uuidOf(doomed.uid), "doomed") },
      unshared: { uid: unshared.uid },
      odd: { uid: odd.uid },
      memoryUid: memory.uid,
      invitation: made.body.id as string,
      instance,
      marks: readHighWater(teamPaths(dir).feedFile),
    },
  };
}

/** The real upgrade: the copy under `backups/`, then the migration. The copy's path and its time. */
export function upgrade(dir: string): { copy: string; ms: number } {
  openTeamForWrite(dir, Date.now(), { latest: NEXT, migrations: NEXT_MIGRATIONS }).close();
  const folder = join(dir, "backups");
  const pattern = new RegExp(`^team-(\\d+)-v${TEAM_LATEST}-\\d+\\.db$`);
  const name = readdirSync(folder)
    .filter((file) => pattern.test(file))
    .sort()
    .at(-1);
  if (name === undefined) throw new Error("the upgrade made no copy");
  // Later rows are strictly after the copy's time.
  Bun.sleepSync(5);
  return { copy: join(folder, name), ms: Number(pattern.exec(name)?.[1]) };
}

type Row = Record<string, string | number | null>;

function insertRow(db: Database, table: string, row: Row): number {
  const columns = Object.keys(row);
  const result = db.run(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    columns.map((column) => row[column] ?? null),
  );
  return Number(result.lastInsertRowid);
}

const one = (db: Database, sql: string, ...values: (string | number)[]): Row => {
  const row = db.query<Row, (string | number)[]>(sql).get(...values);
  if (row === null) throw new Error(`no row: ${sql}`);
  return row;
};

/** A new current row of the feed for `key`, cloned from `from` with `changed` over it. */
function change(db: Database, from: Row, changed: Row): number {
  const { seq: _seq, ...rest } = from;
  const row: Row = { ...rest, ...changed, current: 1 };
  db.run("UPDATE changes SET current = 0 WHERE key = ? AND current = 1", [row.key as string]);
  return insertRow(db, "changes", row);
}

export function audit(
  db: Database,
  row: { source?: AuditSource; action: string; target?: string | null; detail?: string },
  deviceId: string | null = null,
): void {
  insertAudit(db, { at: Date.now(), source: row.source ?? "api", deviceId, ...row });
}

/** Opens the present file as it is, with no migration and no schema check. */
export function rawOpen(dir: string, readonly = false): Database {
  const db = new Database(
    join(dir, "team.db"),
    readonly ? { readonly: true } : { readwrite: true },
  );
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

/** What members and the operator did after the upgrade: every kind of row the restore counts or names. */
export function since(dir: string, ids: WorldIds): SinceIds {
  const db = rawOpen(dir);
  try {
    const now = () => Date.now();
    const oldUuid = uuidOf(ids.old.uid);
    const oldChange = one(db, "SELECT * FROM changes WHERE uid = ? AND current = 1", ids.old.uid);
    const oldEntry = one(db, "SELECT * FROM entries WHERE uuid = ?", oldUuid);
    const oldRevision = one(db, "SELECT * FROM entry_revisions WHERE uuid = ?", oldUuid);

    // A new entry.
    const fresh = entryPayload({ scope: "shared", slug: "fresh" });
    const freshUuid = uuidOf(fresh.uid);
    const freshSize = Buffer.byteLength(fresh.frontmatter + fresh.body, "utf8");
    const freshSeq = change(db, oldChange, {
      uid: fresh.uid,
      key: (oldChange.key as string).replaceAll(oldUuid, freshUuid),
      hash: fresh.hash,
      at: now(),
    });
    insertRow(db, "entries", {
      ...oldEntry,
      uuid: freshUuid,
      slug: "fresh",
      hash: fresh.hash,
      size: freshSize,
      updated_at: now(),
      mirror_revision: 0,
    });
    insertRow(db, "entry_revisions", {
      ...oldRevision,
      uuid: freshUuid,
      seq: freshSeq,
      slug: "fresh",
      frontmatter: fresh.frontmatter,
      body: fresh.body,
      hash: fresh.hash,
      at: now(),
    });
    audit(db, { action: "push", target: fresh.uid }, ids.ana.deviceId);

    // Revision 2 of an entry the copy holds.
    const revised = entryPayload({
      scope: "shared",
      uuid: oldUuid,
      slug: "old",
      body: "Revised since the copy.",
      version: 2,
    });
    const revisedSeq = change(db, oldChange, { revision: 2, hash: revised.hash, at: now() });
    insertRow(db, "entry_revisions", {
      ...oldRevision,
      revision: 2,
      seq: revisedSeq,
      frontmatter: revised.frontmatter,
      body: revised.body,
      hash: revised.hash,
      at: now(),
    });
    db.run("UPDATE entries SET revision = 2, hash = ?, size = ?, updated_at = ? WHERE uuid = ?", [
      revised.hash,
      Buffer.byteLength(revised.frontmatter + revised.body, "utf8"),
      now(),
      oldUuid,
    ]);

    // A new memory.
    const memory = one(db, "SELECT * FROM memories LIMIT 1");
    const memoryChange = one(db, "SELECT * FROM changes WHERE kind = 'memory' AND current = 1");
    const lateUid = memoryUid("a1b2c3d4", 2);
    const replaceUid = (text: string) => text.replaceAll(memory.uid as string, lateUid);
    insertRow(db, "memories", { ...memory, uid: lateUid, received_at: now(), updated_at: now() });
    change(db, memoryChange, {
      uid: replaceUid(memoryChange.uid as string),
      key: replaceUid(memoryChange.key as string),
      at: now(),
    });

    // A shared name.
    insertRow(db, "names", {
      alias: "name:late",
      id: randomUUID().replaceAll("-", ""),
      created_by_member: ids.ana.memberId,
      created_by_device: ids.ana.deviceId,
      created_at: now(),
      purged_at: null,
    });
    audit(db, { action: "name created", target: "name:late" }, ids.ana.deviceId);

    // Zoe joins with the invitation made before the copy, then with one made after it.
    const zoe = `zoe-${randomUUID().slice(0, 8)}`;
    const devices: [string, string] = [`${zoe}-d1`, `${zoe}-d2`];
    insertRow(db, "members", {
      id: zoe,
      name: "Zoe",
      role: "member",
      created_at: now(),
      disabled_at: null,
    });
    const lateInvitation = `late-${randomUUID().slice(0, 8)}`;
    insertRow(db, "invitations", {
      id: lateInvitation,
      code_hash: `hash-${lateInvitation}`,
      role: "member",
      name: null,
      for_member: zoe,
      created_by_device: ids.admin.deviceId,
      created_at: now(),
      expires_at: now() + 86_400_000,
      used_at: null,
      used_by_device: null,
      revoked_at: null,
    });
    audit(db, { action: "invitation made", target: lateInvitation, detail: `for ${zoe}` });
    for (const [index, device] of devices.entries()) {
      insertRow(db, "devices", {
        id: device,
        alias: device,
        member_id: zoe,
        token_hash: `hash-${device}`,
        label: "laptop",
        created_at: now(),
        last_seen_at: null,
        revoked_at: null,
      });
      db.run("UPDATE invitations SET used_at = ?, used_by_device = ? WHERE id = ?", [
        now(),
        device,
        index === 0 ? ids.invitation : lateInvitation,
      ]);
      audit(db, { action: "join", target: zoe, detail: "laptop" }, device);
    }

    // Rui's device is revoked and Rui disabled.
    db.run("UPDATE devices SET revoked_at = ? WHERE id = ?", [now(), ids.rui.deviceId]);
    audit(db, { source: "cli", action: "device revoked", target: ids.rui.deviceId });
    db.run("UPDATE members SET disabled_at = ? WHERE id = ?", [now(), ids.rui.memberId]);
    audit(db, {
      source: "cli",
      action: "member disabled",
      target: ids.rui.memberId,
      detail: "devices 1, withdrawn 0",
    });

    // An entry the copy holds is purged.
    const doomedUuid = uuidOf(ids.doomed.uid);
    const doomedKey = one(db, "SELECT key FROM changes WHERE uid = ?", ids.doomed.uid).key;
    db.run("DELETE FROM entry_revisions WHERE uuid = ?", [doomedUuid]);
    db.run("DELETE FROM entries WHERE uuid = ?", [doomedUuid]);
    db.run("INSERT INTO purged (key, at) VALUES (?, ?)", [doomedKey as string, now()]);
    audit(db, {
      source: "cli",
      action: "purged",
      target: ids.doomed.uid,
      detail: "entry: 2 rows, 1 feed rows",
    });

    // Ana withdraws an entry of hers: a member's own push, which writes no audit row.
    const goneUuid = uuidOf(ids.unshared.uid);
    const goneChange = one(
      db,
      "SELECT * FROM changes WHERE uid = ? AND current = 1",
      ids.unshared.uid,
    );
    const goneRevision = one(db, "SELECT * FROM entry_revisions WHERE uuid = ?", goneUuid);
    const goneSeq = change(db, goneChange, { op: "tombstone", revision: 2, at: now() });
    insertRow(db, "entry_revisions", {
      ...goneRevision,
      revision: 2,
      seq: goneSeq,
      op: "withdraw",
      at: now(),
    });
    db.run("UPDATE entries SET revision = 2, withdrawn_at = ?, updated_at = ? WHERE uuid = ?", [
      now(),
      now(),
      goneUuid,
    ]);

    // Ana's device rotates its token.
    audit(db, { action: "token rotated", target: ids.ana.deviceId }, ids.ana.deviceId);

    mirror(dir, db);
    // As the server does after every write.
    writeHighWater(teamPaths(dir).feedFile, currentMarks(db));
    return {
      fresh: { uid: fresh.uid, file: fileNameFor(freshUuid, "fresh") },
      zoe: { memberId: zoe, devices },
      lateInvitation,
    };
  } finally {
    db.close();
  }
}

/**
 * A copy of the directory as a killed server leaves it: one more audit row (`wal only`) that
 * is in the log and not in the file.
 */
export function crashImage(dir: string): string {
  const target = mkdtempSync(join(tmpdir(), "wcm-restore-crash-"));
  images.push(target);
  const db = rawOpen(dir);
  try {
    db.run("PRAGMA wal_autocheckpoint = 0");
    audit(db, { source: "system", action: "wal only" });
    cpSync(dir, target, { recursive: true });
  } finally {
    db.close();
  }
  return target;
}

/** The sha256 of every file under `dir`, but the shared-memory files and an empty log. */
export function dataHashes(dir: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const walk = (folder: string, prefix: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        walk(path, `${name}/`);
        continue;
      }
      if (!entry.isFile() || name.endsWith("-shm")) continue;
      if (name.endsWith("-wal") && statSync(path).size === 0) continue;
      hashes[name] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(dir, "");
  return hashes;
}
