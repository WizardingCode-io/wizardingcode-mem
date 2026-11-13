// Every SQL statement of the team server lives here: one exported function per statement,
// taking the connection and plain values and returning plain rows, plus `transaction`, the one
// way the rest of the server opens a transaction, and the lease and meta functions reused from
// the client store. Another engine would be a second file behind these signatures (D-1).
import { type Db, withWrite } from "../store/db.ts";
import {
  claimLease as coreClaimLease,
  getMeta as coreGetMeta,
  leaseActive as coreLeaseActive,
  releaseLease as coreReleaseLease,
  setMeta as coreSetMeta,
} from "../store/meta.ts";

// --- Transactions, meta, leases -------------------------------------------------------

/** Runs `fn` in a transaction that takes the write lock up front: the one transaction the server has. */
export function transaction<T>(db: Db, fn: () => T): T {
  return withWrite(db, fn);
}

export const getMeta = coreGetMeta;
export const setMeta = coreSetMeta;

export function clearMeta(db: Db, key: string): void {
  db.run("DELETE FROM meta WHERE key = ?", [key]);
}
export const leaseActive = coreLeaseActive;
export const releaseLease = coreReleaseLease;

/** Takes or extends the lease; false when another owner holds a fresh one. The owner never names a pid. */
export function claimLease(
  db: Db,
  key: string,
  owner: string,
  now: number,
  ttlMs: number,
): boolean {
  return coreClaimLease(db, key, owner, now, ttlMs);
}

/** The lease as stored (`owner`, `until`), fresh or not; null without one. */
export function leaseOf(db: Db, key: string): { owner: string; until: number } | null {
  const raw = coreGetMeta(db, key);
  if (raw === null) return null;
  try {
    const lease = JSON.parse(raw) as { owner?: unknown; until?: unknown };
    return typeof lease.owner === "string" && typeof lease.until === "number"
      ? { owner: lease.owner, until: lease.until }
      : null;
  } catch {
    return null;
  }
}

// --- The sequences ----------------------------------------------------------------------

export type SequenceTable = "changes" | "audit";

/** The `AUTOINCREMENT` high-water of a table; 0 while the table has no row yet. */
export function sequenceHighWater(db: Db, table: SequenceTable): number {
  return (
    db.query<{ seq: number }, [string]>("SELECT seq FROM sqlite_sequence WHERE name = ?").get(table)
      ?.seq ?? 0
  );
}

/**
 * Moves the high-water up to `to`, inserting the row when the table never had one; never
 * lowers it. Two statements: the caller runs it inside `transaction` where a writer may race.
 */
export function advanceSequence(db: Db, table: SequenceTable, to: number): void {
  const current = db
    .query<{ seq: number }, [string]>("SELECT seq FROM sqlite_sequence WHERE name = ?")
    .get(table);
  if (current === null) {
    db.run("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)", [table, to]);
  } else if (current.seq < to) {
    db.run("UPDATE sqlite_sequence SET seq = ? WHERE name = ?", [to, table]);
  }
}

/** Runs `fn` in a deferred transaction: one snapshot for several reads. */
export function readTransaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)();
}

/** The team schema the file is at (`user_version`): what `serve status` prints. */
export function teamSchemaVersion(db: Db): number {
  return db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
}

/** `PRAGMA quick_check` answers `ok`. */
export function quickCheck(db: Db): boolean {
  return db.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check === "ok";
}

/** `PRAGMA integrity_check` answers `ok`. */
export function integrityCheck(db: Db): boolean {
  return (
    db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check ===
    "ok"
  );
}

/** The file's journal mode, lower case (`wal`, `delete`). */
export function journalMode(db: Db): string {
  return (
    db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode ?? ""
  ).toLowerCase();
}

// --- Members ----------------------------------------------------------------------------

export type Role = "admin" | "member";

export interface MemberRow {
  id: string;
  name: string;
  role: Role;
  created_at: number;
  disabled_at: number | null;
}

const MEMBER_COLUMNS = "id, name, role, created_at, disabled_at";

export function insertMember(
  db: Db,
  row: { id: string; name: string; role: Role; createdAt: number },
): void {
  db.run("INSERT INTO members (id, name, role, created_at) VALUES (?, ?, ?, ?)", [
    row.id,
    row.name,
    row.role,
    row.createdAt,
  ]);
}

export function memberById(db: Db, id: string): MemberRow | null {
  return db
    .query<MemberRow, [string]>(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id = ?`)
    .get(id);
}

export function listMembers(db: Db): MemberRow[] {
  return db
    .query<MemberRow, []>(`SELECT ${MEMBER_COLUMNS} FROM members ORDER BY created_at, id`)
    .all();
}

export function setMemberDisabled(db: Db, id: string, at: number | null): void {
  db.run("UPDATE members SET disabled_at = ? WHERE id = ?", [at, id]);
}

export function setMemberRole(db: Db, id: string, role: Role): void {
  db.run("UPDATE members SET role = ? WHERE id = ?", [role, id]);
}

/**
 * How many active admins would still hold an unrevoked device if `except` were revoked or
 * disabled: the rule behind "the last admin stays".
 */
export function countActiveAdminsWithDevices(
  db: Db,
  except: { memberId?: string; deviceId?: string } = {},
): number {
  return (
    db
      .query<{ n: number }, [string, string]>(
        `SELECT count(DISTINCT m.id) AS n FROM members m
           JOIN devices d ON d.member_id = m.id AND d.revoked_at IS NULL AND d.id <> ?
          WHERE m.role = 'admin' AND m.disabled_at IS NULL AND m.id <> ?`,
      )
      .get(except.deviceId ?? "", except.memberId ?? "")?.n ?? 0
  );
}

// --- Devices ----------------------------------------------------------------------------

export interface DeviceRow {
  id: string;
  alias: string;
  member_id: string;
  token_hash: string;
  label: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

const DEVICE_COLUMNS =
  "id, alias, member_id, token_hash, label, created_at, last_seen_at, revoked_at";

export function insertDevice(
  db: Db,
  row: {
    id: string;
    alias: string;
    memberId: string;
    tokenHash: string;
    label: string;
    createdAt: number;
  },
): void {
  db.run(
    "INSERT INTO devices (id, alias, member_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [row.id, row.alias, row.memberId, row.tokenHash, row.label, row.createdAt],
  );
}

export function deviceByTokenHash(db: Db, hash: string): DeviceRow | null {
  return db
    .query<DeviceRow, [string]>(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE token_hash = ?`)
    .get(hash);
}

export function deviceById(db: Db, id: string): DeviceRow | null {
  return db
    .query<DeviceRow, [string]>(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = ?`)
    .get(id);
}

export function deviceByAlias(db: Db, alias: string): DeviceRow | null {
  return db
    .query<DeviceRow, [string]>(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE alias = ?`)
    .get(alias);
}

export function listDevices(db: Db, memberId?: string): DeviceRow[] {
  if (memberId === undefined) {
    return db
      .query<DeviceRow, []>(`SELECT ${DEVICE_COLUMNS} FROM devices ORDER BY created_at, id`)
      .all();
  }
  return db
    .query<DeviceRow, [string]>(
      `SELECT ${DEVICE_COLUMNS} FROM devices WHERE member_id = ? ORDER BY created_at, id`,
    )
    .all(memberId);
}

export function activeDeviceIdsOf(db: Db, memberId: string): string[] {
  return db
    .query<{ id: string }, [string]>(
      "SELECT id FROM devices WHERE member_id = ? AND revoked_at IS NULL",
    )
    .all(memberId)
    .map((row) => row.id);
}

export function setDeviceToken(db: Db, id: string, tokenHash: string): void {
  db.run("UPDATE devices SET token_hash = ? WHERE id = ?", [tokenHash, id]);
}

export function setDeviceRevoked(db: Db, id: string, at: number): void {
  db.run("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [at, id]);
}

export function touchDevice(db: Db, id: string, at: number): void {
  db.run("UPDATE devices SET last_seen_at = ? WHERE id = ?", [at, id]);
}

// --- Invitations ------------------------------------------------------------------------

export interface InvitationRow {
  id: string;
  code_hash: string;
  role: Role;
  name: string | null;
  for_member: string | null;
  created_by_device: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  used_by_device: string | null;
  revoked_at: number | null;
}

const INVITATION_COLUMNS =
  "id, code_hash, role, name, for_member, created_by_device, created_at, expires_at, used_at, used_by_device, revoked_at";

export function insertInvitation(
  db: Db,
  row: {
    id: string;
    codeHash: string;
    role: Role;
    name: string | null;
    forMember: string | null;
    createdByDevice: string | null;
    createdAt: number;
    expiresAt: number;
  },
): void {
  db.run(
    `INSERT INTO invitations (id, code_hash, role, name, for_member, created_by_device, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.codeHash,
      row.role,
      row.name,
      row.forMember,
      row.createdByDevice,
      row.createdAt,
      row.expiresAt,
    ],
  );
}

export function invitationByCodeHash(db: Db, hash: string): InvitationRow | null {
  return db
    .query<InvitationRow, [string]>(
      `SELECT ${INVITATION_COLUMNS} FROM invitations WHERE code_hash = ?`,
    )
    .get(hash);
}

export function invitationById(db: Db, id: string): InvitationRow | null {
  return db
    .query<InvitationRow, [string]>(`SELECT ${INVITATION_COLUMNS} FROM invitations WHERE id = ?`)
    .get(id);
}

/** Unused, unexpired, unrevoked. */
export function listOpenInvitations(db: Db, now: number): InvitationRow[] {
  return db
    .query<InvitationRow, [number]>(
      `SELECT ${INVITATION_COLUMNS} FROM invitations
        WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at, id`,
    )
    .all(now);
}

export function setInvitationUsed(db: Db, id: string, at: number, deviceId: string): void {
  db.run("UPDATE invitations SET used_at = ?, used_by_device = ? WHERE id = ?", [at, deviceId, id]);
}

export function setInvitationRevoked(db: Db, id: string, at: number): void {
  db.run(
    "UPDATE invitations SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND used_at IS NULL",
    [at, id],
  );
}

export function revokeInvitationsOfDevice(db: Db, deviceId: string, at: number): void {
  db.run(
    "UPDATE invitations SET revoked_at = ? WHERE created_by_device = ? AND revoked_at IS NULL AND used_at IS NULL",
    [at, deviceId],
  );
}

/** The bootstrap invitation: role admin, no name, bound to no member, made by no device; open. */
export function pendingBootstrapInvitation(db: Db, now: number): InvitationRow | null {
  return db
    .query<InvitationRow, [number]>(
      `SELECT ${INVITATION_COLUMNS} FROM invitations
        WHERE role = 'admin' AND name IS NULL AND for_member IS NULL AND created_by_device IS NULL
          AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(now);
}

export function countMembers(db: Db): number {
  return db.query<{ n: number }, []>("SELECT count(*) AS n FROM members").get()?.n ?? 0;
}

export function memberCounts(db: Db): { active: number; disabled: number } {
  const row = db
    .query<{ active: number | null; disabled: number | null }, []>(
      "SELECT sum(disabled_at IS NULL) AS active, sum(disabled_at IS NOT NULL) AS disabled FROM members",
    )
    .get();
  return { active: row?.active ?? 0, disabled: row?.disabled ?? 0 };
}

export function deviceCounts(db: Db): { active: number; revoked: number } {
  const row = db
    .query<{ active: number | null; revoked: number | null }, []>(
      "SELECT sum(revoked_at IS NULL) AS active, sum(revoked_at IS NOT NULL) AS revoked FROM devices",
    )
    .get();
  return { active: row?.active ?? 0, revoked: row?.revoked ?? 0 };
}

/** How many entries the mirror has yet to export. */
export function pendingMirrorCount(db: Db): number {
  return (
    db
      .query<{ n: number }, []>(
        "SELECT count(*) AS n FROM entries WHERE mirror_revision < revision",
      )
      .get()?.n ?? 0
  );
}

// --- Entries ----------------------------------------------------------------------------

export interface EntryRow {
  uuid: string;
  scope: string;
  project_alias: string | null;
  slug: string;
  created_by_member: string;
  revision: number;
  hash: string;
  size: number;
  writer_member: string;
  writer_device: string;
  updated_at: number;
  withdrawn_at: number | null;
  locked_by_admin: number;
  mirror_revision: number;
}

const ENTRY_COLUMNS =
  "uuid, scope, project_alias, slug, created_by_member, revision, hash, size, writer_member, writer_device, updated_at, withdrawn_at, locked_by_admin, mirror_revision";

export function entryByUuid(db: Db, uuid: string): EntryRow | null {
  return db
    .query<EntryRow, [string]>(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE uuid = ?`)
    .get(uuid);
}

/** Inserts the row or replaces its attributes; `created_by_member` and `mirror_revision` stay. A send clears the tombstone. */
export function upsertEntry(
  db: Db,
  row: {
    uuid: string;
    scope: string;
    projectAlias: string | null;
    slug: string;
    createdByMember: string;
    revision: number;
    hash: string;
    size: number;
    writerMember: string;
    writerDevice: string;
    updatedAt: number;
  },
): void {
  db.run(
    `INSERT INTO entries (uuid, scope, project_alias, slug, created_by_member, revision, hash, size, writer_member, writer_device, updated_at, withdrawn_at, locked_by_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)
     ON CONFLICT(uuid) DO UPDATE SET
       scope = excluded.scope, project_alias = excluded.project_alias, slug = excluded.slug,
       revision = excluded.revision, hash = excluded.hash, size = excluded.size,
       writer_member = excluded.writer_member, writer_device = excluded.writer_device,
       updated_at = excluded.updated_at, withdrawn_at = NULL, locked_by_admin = 0`,
    [
      row.uuid,
      row.scope,
      row.projectAlias,
      row.slug,
      row.createdByMember,
      row.revision,
      row.hash,
      row.size,
      row.writerMember,
      row.writerDevice,
      row.updatedAt,
    ],
  );
}

/** The tombstone: the revision moves on, the hash stays; `lock` also sets the admin's lock. */
export function setEntryWithdrawn(
  db: Db,
  uuid: string,
  row: { revision: number; withdrawnAt: number; lock: boolean },
): void {
  db.run(
    "UPDATE entries SET revision = ?, withdrawn_at = ?, locked_by_admin = CASE WHEN ? THEN 1 ELSE locked_by_admin END WHERE uuid = ?",
    [row.revision, row.withdrawnAt, row.lock ? 1 : 0, uuid],
  );
}

export function setEntryLock(db: Db, uuid: string, locked: boolean): void {
  db.run("UPDATE entries SET locked_by_admin = ? WHERE uuid = ?", [locked ? 1 : 0, uuid]);
}

export interface RevisionRow {
  uuid: string;
  revision: number;
  seq: number;
  op: "send" | "withdraw";
  scope: string;
  project_alias: string | null;
  slug: string;
  frontmatter: string;
  body: string;
  hash: string;
  writer_member: string;
  writer_device: string;
  client_epoch: number | null;
  at: number;
}

const REVISION_COLUMNS =
  "uuid, revision, seq, op, scope, project_alias, slug, frontmatter, body, hash, writer_member, writer_device, client_epoch, at";

export function insertRevision(
  db: Db,
  row: {
    uuid: string;
    revision: number;
    seq: number;
    op: "send" | "withdraw";
    scope: string;
    projectAlias: string | null;
    slug: string;
    frontmatter: string;
    body: string;
    hash: string;
    writerMember: string;
    writerDevice: string;
    clientEpoch: number | null;
    at: number;
  },
): void {
  db.run(
    `INSERT INTO entry_revisions (${REVISION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.uuid,
      row.revision,
      row.seq,
      row.op,
      row.scope,
      row.projectAlias,
      row.slug,
      row.frontmatter,
      row.body,
      row.hash,
      row.writerMember,
      row.writerDevice,
      row.clientEpoch,
      row.at,
    ],
  );
}

/** The newest `send` revision of the entry by that device with those bytes and attributes; null when none. */
export function revisionMatching(
  db: Db,
  uuid: string,
  hash: string,
  scope: string,
  projectAlias: string | null,
  slug: string,
  writerDevice: string,
): number | null {
  return (
    db
      .query<{ revision: number }, [string, string, string, string, string | null, string]>(
        `SELECT revision FROM entry_revisions
          WHERE uuid = ? AND hash = ? AND writer_device = ? AND op = 'send'
            AND scope = ? AND project_alias IS ? AND slug = ?
          ORDER BY revision DESC LIMIT 1`,
      )
      .get(uuid, hash, writerDevice, scope, projectAlias, slug)?.revision ?? null
  );
}

export function revisionsOf(db: Db, uuid: string): RevisionRow[] {
  return db
    .query<RevisionRow, [string]>(
      `SELECT ${REVISION_COLUMNS} FROM entry_revisions WHERE uuid = ? ORDER BY revision`,
    )
    .all(uuid);
}

export function revisionAt(db: Db, uuid: string, revision: number): RevisionRow | null {
  return db
    .query<RevisionRow, [string, number]>(
      `SELECT ${REVISION_COLUMNS} FROM entry_revisions WHERE uuid = ? AND revision = ?`,
    )
    .get(uuid, revision);
}

/** The member's live workspace entries. */
export function workspaceEntriesOf(db: Db, memberId: string): EntryRow[] {
  return db
    .query<EntryRow, [string]>(
      `SELECT ${ENTRY_COLUMNS} FROM entries
        WHERE scope = 'workspace' AND created_by_member = ? AND withdrawn_at IS NULL ORDER BY uuid`,
    )
    .all(memberId);
}

/** Rows a replay or an export reads per batch: a read snapshot spans one batch, never the history. */
export const REVISION_BATCH = 200;

/** The key of a revision the mirror has not exported, with its entry's creator. */
export interface PendingKey {
  seq: number;
  uuid: string;
  revision: number;
  creator: string;
}

/**
 * The pending revisions after `seq` in feed order, keys alone, so the sort holds no text: the
 * entries through the partial index as the outer loop (`CROSS JOIN` fixes it), their revisions
 * past the exported mark, at most `LIMIT`.
 */
const PENDING_SQL = `SELECT r.seq, r.uuid, r.revision, e.created_by_member AS creator
   FROM entries e CROSS JOIN entry_revisions r ON r.uuid = e.uuid
   WHERE e.mirror_revision < e.revision AND r.revision > e.mirror_revision AND r.seq > ?
   ORDER BY r.seq LIMIT ?`;

/** The keys of the revisions the mirror has not exported, after `seq`, in feed order, one batch. */
export function pendingRevisionsAfter(db: Db, seq: number): PendingKey[] {
  return db.query<PendingKey, [number, number]>(PENDING_SQL).all(seq, REVISION_BATCH);
}

/** The planner's lines for the pending query: a test reads them for the partial index's name. */
export function explainPendingMirror(db: Db): string[] {
  return db
    .query<{ detail: string }, [number, number]>(`EXPLAIN QUERY PLAN ${PENDING_SQL}`)
    .all(0, REVISION_BATCH)
    .map((row) => row.detail);
}

export function setMirrorRevision(db: Db, uuid: string, revision: number): void {
  db.run("UPDATE entries SET mirror_revision = ? WHERE uuid = ?", [revision, uuid]);
}

/** Every entry pending again: what `--rebuild` does before it replays. */
export function resetMirrorRevisions(db: Db): void {
  db.run("UPDATE entries SET mirror_revision = 0");
}

/**
 * Every revision in feed order, `REVISION_BATCH` rows a read: a replay never holds the whole
 * history, nor one read snapshot across its git calls; `false` from `fn` ends the walk.
 */
export function forEachRevision(db: Db, fn: (revision: RevisionRow) => boolean | undefined): void {
  let after = 0;
  for (;;) {
    const rows = db
      .query<RevisionRow, [number, number]>(
        `SELECT ${REVISION_COLUMNS} FROM entry_revisions WHERE seq > ? ORDER BY seq LIMIT ?`,
      )
      .all(after, REVISION_BATCH);
    if (rows.length === 0) return;
    for (const revision of rows) {
      if (fn(revision) === false) return;
      after = revision.seq;
    }
  }
}

/**
 * A truncating checkpoint: the log's frames go into the file and the log is cut to nothing,
 * so text a purge erased does not outlive it there; false when a reader held the log.
 */
export function checkpointWal(db: Db, waitMs?: number): boolean {
  // With `waitMs`, the wait for a reader is that long instead of the connection's busy timeout,
  // which is put back after: the server's own tick must not hold its requests for seconds.
  const before = db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get()?.timeout ?? 0;
  if (waitMs !== undefined) db.run(`PRAGMA busy_timeout = ${Math.trunc(waitMs)}`);
  try {
    const row = db.query<{ busy: number }, []>("PRAGMA wal_checkpoint(TRUNCATE)").get();
    return row !== null && row.busy === 0;
  } finally {
    if (waitMs !== undefined) db.run(`PRAGMA busy_timeout = ${before}`);
  }
}

/** Deletes the entry's revisions; the count. Run before `deleteEntry`: the foreign key is on. */
export function deleteRevisions(db: Db, uuid: string): number {
  return db.run("DELETE FROM entry_revisions WHERE uuid = ?", [uuid]).changes;
}

export function deleteEntry(db: Db, uuid: string): void {
  db.run("DELETE FROM entries WHERE uuid = ?", [uuid]);
}

// --- Memories ---------------------------------------------------------------------------

export interface MemoryRow {
  device_id: string;
  uid: string;
  project_alias: string;
  payload: string;
  hash: string;
  size: number;
  revision: number;
  updated_at: number;
  member_id: string;
  received_at: number;
  withdrawn_at: number | null;
  locked_by_admin: number;
}

const MEMORY_COLUMNS =
  "device_id, uid, project_alias, payload, hash, size, revision, updated_at, member_id, received_at, withdrawn_at, locked_by_admin";

export function memoryByKey(db: Db, deviceId: string, uid: string): MemoryRow | null {
  return db
    .query<MemoryRow, [string, string]>(
      `SELECT ${MEMORY_COLUMNS} FROM memories WHERE device_id = ? AND uid = ?`,
    )
    .get(deviceId, uid);
}

/** Inserts or replaces the device's row; a send clears the tombstone and the lock. */
export function upsertMemory(
  db: Db,
  row: {
    deviceId: string;
    uid: string;
    projectAlias: string;
    payload: string;
    hash: string;
    size: number;
    revision: number;
    updatedAt: number;
    memberId: string;
    receivedAt: number;
  },
): void {
  db.run(
    `INSERT INTO memories (device_id, uid, project_alias, payload, hash, size, revision, updated_at, member_id, received_at, withdrawn_at, locked_by_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)
     ON CONFLICT(device_id, uid) DO UPDATE SET
       project_alias = excluded.project_alias, payload = excluded.payload, hash = excluded.hash,
       size = excluded.size, revision = excluded.revision, updated_at = excluded.updated_at,
       received_at = excluded.received_at, withdrawn_at = NULL, locked_by_admin = 0`,
    [
      row.deviceId,
      row.uid,
      row.projectAlias,
      row.payload,
      row.hash,
      row.size,
      row.revision,
      row.updatedAt,
      row.memberId,
      row.receivedAt,
    ],
  );
}

export function setMemoryWithdrawn(
  db: Db,
  deviceId: string,
  uid: string,
  row: { revision: number; withdrawnAt: number; lock: boolean },
): void {
  db.run(
    "UPDATE memories SET revision = ?, withdrawn_at = ?, locked_by_admin = CASE WHEN ? THEN 1 ELSE locked_by_admin END WHERE device_id = ? AND uid = ?",
    [row.revision, row.withdrawnAt, row.lock ? 1 : 0, deviceId, uid],
  );
}

export function setMemoryLock(db: Db, deviceId: string, uid: string, locked: boolean): void {
  db.run("UPDATE memories SET locked_by_admin = ? WHERE device_id = ? AND uid = ?", [
    locked ? 1 : 0,
    deviceId,
    uid,
  ]);
}

export function deleteMemory(db: Db, deviceId: string, uid: string): void {
  db.run("DELETE FROM memories WHERE device_id = ? AND uid = ?", [deviceId, uid]);
}

/** The live memories of the given devices. */
export function memoriesOfDevices(db: Db, deviceIds: readonly string[]): MemoryRow[] {
  if (deviceIds.length === 0) return [];
  const marks = deviceIds.map(() => "?").join(", ");
  return db
    .query<MemoryRow, string[]>(
      `SELECT ${MEMORY_COLUMNS} FROM memories WHERE device_id IN (${marks}) AND withdrawn_at IS NULL ORDER BY device_id, uid`,
    )
    .all(...deviceIds);
}

// --- The feed ---------------------------------------------------------------------------

export type ChangeOp = "upsert" | "tombstone" | "purge";

export interface ChangeRow {
  seq: number;
  kind: "entry" | "memory";
  uid: string;
  key: string;
  op: ChangeOp;
  scope: string;
  project_alias: string | null;
  revision: number;
  hash: string;
  moved_to: string | null;
  member_id: string;
  device_id: string;
  client_epoch: number | null;
  at: number;
  current: number;
}

const CHANGE_COLUMNS =
  "seq, kind, uid, key, op, scope, project_alias, revision, hash, moved_to, member_id, device_id, client_epoch, at, current";

/** Writes the key's new current row and retires its older one; returns the new `seq`. */
export function insertChange(
  db: Db,
  row: {
    kind: "entry" | "memory";
    uid: string;
    key: string;
    op: ChangeOp;
    scope: string;
    projectAlias: string | null;
    revision: number;
    hash: string;
    movedTo: string | null;
    memberId: string;
    deviceId: string;
    clientEpoch: number | null;
    at: number;
  },
): number {
  db.run("UPDATE changes SET current = 0 WHERE key = ? AND current = 1", [row.key]);
  const inserted = db.run(
    `INSERT INTO changes (kind, uid, key, op, scope, project_alias, revision, hash, moved_to, member_id, device_id, client_epoch, at, current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      row.kind,
      row.uid,
      row.key,
      row.op,
      row.scope,
      row.projectAlias,
      row.revision,
      row.hash,
      row.movedTo,
      row.memberId,
      row.deviceId,
      row.clientEpoch,
      row.at,
    ],
  );
  return Number(inserted.lastInsertRowid);
}

/** The key's current row; null when it never had one. */
export function currentChangeOf(db: Db, key: string): ChangeRow | null {
  return db
    .query<ChangeRow, [string]>(
      `SELECT ${CHANGE_COLUMNS} FROM changes WHERE key = ? AND current = 1 ORDER BY seq DESC LIMIT 1`,
    )
    .get(key);
}

/** What a pull asks for: the scopes it reads and the aliases it names. */
export interface FeedQuery {
  since: number;
  limit: number;
  projects: readonly string[];
  /** `all`: shared, every workspace and the named aliases; `project`: the one named alias alone. */
  scope: "all" | "project";
}

/**
 * One indexed range per scope (`changes_scope`: scope, alias, current, seq), each ordered and
 * bounded on its own, merged by `seq` and bounded again: no range scans the table.
 */
function feedSql(query: FeedQuery): { sql: string; params: (string | number)[] } | null {
  const ranges: string[] = [];
  const params: (string | number)[] = [];
  const range = (where: string) =>
    `SELECT * FROM (SELECT ${CHANGE_COLUMNS} FROM changes WHERE ${where} AND current = 1 AND seq > ? ORDER BY seq LIMIT ?)`;
  if (query.scope === "all") {
    ranges.push(range("scope = 'shared' AND project_alias IS NULL"));
    params.push(query.since, query.limit);
    ranges.push(range("scope = 'workspace' AND project_alias IS NULL"));
    params.push(query.since, query.limit);
  }
  for (const alias of query.projects) {
    ranges.push(range("scope = 'project' AND project_alias = ?"));
    params.push(alias, query.since, query.limit);
  }
  if (ranges.length === 0) return null;
  params.push(query.limit);
  return { sql: `${ranges.join(" UNION ALL ")} ORDER BY seq LIMIT ?`, params };
}

/** The current rows after `since` in the query's ranges, oldest first, at most `limit`. */
export function changesSince(db: Db, query: FeedQuery): ChangeRow[] {
  const built = feedSql(query);
  if (built === null) return [];
  return db.query<ChangeRow, (string | number)[]>(built.sql).all(...built.params);
}

/** Whether any current row after `since` is visible to the query: the same ranges, limit one. */
export function hasChanges(db: Db, query: FeedQuery): boolean {
  return changesSince(db, { ...query, limit: 1 }).length > 0;
}

/** The query planner's lines for the pull's statement: a test reads them for a `SCAN`. */
export function explainChangesSince(db: Db, query: FeedQuery): string[] {
  const built = feedSql(query);
  if (built === null) return [];
  return db
    .query<{ detail: string }, (string | number)[]>(`EXPLAIN QUERY PLAN ${built.sql}`)
    .all(...built.params)
    .map((row) => row.detail);
}

export function explainHasChanges(db: Db, query: FeedQuery): string[] {
  return explainChangesSince(db, { ...query, limit: 1 });
}

/** Turns every row of a key, its move tombstones included, into a `purge` row with no hash; the count. */
export function markPurged(db: Db, key: string): number {
  // The move tombstones' keys are `<key>@<n>`: every string between `<key>@` and `<key>A`
  // (the character after `@`), a range the `changes_key` index serves.
  return db.run(
    "UPDATE changes SET op = 'purge', hash = '', moved_to = NULL WHERE key = ? OR (key > ? || '@' AND key < ? || 'A')",
    [key, key, key],
  ).changes;
}

// --- The registry of shared names (ADR 0028) -------------------------------------------------

export interface NameRow {
  alias: string;
  id: string;
  created_by_member: string;
  created_by_device: string;
  created_at: number;
  purged_at: number | null;
}

const NAME_COLUMNS = "alias, id, created_by_member, created_by_device, created_at, purged_at";

export function insertName(
  db: Db,
  row: { alias: string; id: string; memberId: string; deviceId: string; at: number },
): void {
  db.run(
    "INSERT INTO names (alias, id, created_by_member, created_by_device, created_at) VALUES (?, ?, ?, ?, ?)",
    [row.alias, row.id, row.memberId, row.deviceId, row.at],
  );
}

/** The row, purged or not; null for an alias the registry never held. */
export function nameByAlias(db: Db, alias: string): NameRow | null {
  return db
    .query<NameRow, [string]>(`SELECT ${NAME_COLUMNS} FROM names WHERE alias = ?`)
    .get(alias);
}

/** The row while it is not purged; null otherwise. */
export function liveNameByAlias(db: Db, alias: string): NameRow | null {
  return db
    .query<NameRow, [string]>(
      `SELECT ${NAME_COLUMNS} FROM names WHERE alias = ? AND purged_at IS NULL`,
    )
    .get(alias);
}

/** Whether another name holds the id: a given id is used only when unused. */
export function nameIdInUse(db: Db, id: string): boolean {
  return (
    db.query<{ alias: string }, [string]>("SELECT alias FROM names WHERE id = ?").get(id) !== null
  );
}

/** The live entries and memories under an alias, and the latest `updated_at` of either; by the two partial indexes. */
export function nameCountsOf(
  db: Db,
  alias: string,
): { entries: number; memories: number; lastChangeAt: number | null } {
  const entries = db
    .query<{ n: number; last: number | null }, [string]>(
      "SELECT count(*) AS n, max(updated_at) AS last FROM entries WHERE project_alias = ? AND withdrawn_at IS NULL",
    )
    .get(alias);
  const memories = db
    .query<{ n: number; last: number | null }, [string]>(
      "SELECT count(*) AS n, max(updated_at) AS last FROM memories WHERE project_alias = ? AND withdrawn_at IS NULL",
    )
    .get(alias);
  const lasts = [entries?.last ?? null, memories?.last ?? null].filter(
    (value): value is number => value !== null,
  );
  return {
    entries: entries?.n ?? 0,
    memories: memories?.n ?? 0,
    lastChangeAt: lasts.length === 0 ? null : Math.max(...lasts),
  };
}

/** The live names after `after` by alias, `limit` of them, and whether more follow (one row past the limit is read). */
export function listLiveNames(
  db: Db,
  after: string | null,
  limit: number,
): { rows: NameRow[]; more: boolean } {
  const rows =
    after === null
      ? db
          .query<NameRow, [number]>(
            `SELECT ${NAME_COLUMNS} FROM names WHERE purged_at IS NULL ORDER BY alias LIMIT ?`,
          )
          .all(limit + 1)
      : db
          .query<NameRow, [string, number]>(
            `SELECT ${NAME_COLUMNS} FROM names WHERE purged_at IS NULL AND alias > ? ORDER BY alias LIMIT ?`,
          )
          .all(after, limit + 1);
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

/** The ids of the live names among `aliases`, by alias: what a feed page's `nameId` reads. */
export function nameIdsOf(db: Db, aliases: readonly string[]): Map<string, string> {
  const wanted = [...new Set(aliases)];
  if (wanted.length === 0) return new Map();
  const marks = wanted.map(() => "?").join(", ");
  return new Map(
    db
      .query<{ alias: string; id: string }, string[]>(
        `SELECT alias, id FROM names WHERE purged_at IS NULL AND alias IN (${marks})`,
      )
      .all(...wanted)
      .map((row) => [row.alias, row.id]),
  );
}

/** The not-withdrawn entries and memories under an alias: what a purge of the name prints. */
export function currentItemsUnder(db: Db, alias: string): { entries: number; memories: number } {
  const counts = nameCountsOf(db, alias);
  return { entries: counts.entries, memories: counts.memories };
}

/** Marks the name purged; `already` when it was, `none` for an alias the registry never held. */
export function purgeName(db: Db, alias: string, at: number): "purged" | "already" | "none" {
  const row = nameByAlias(db, alias);
  if (row === null) return "none";
  if (row.purged_at !== null) return "already";
  db.run("UPDATE names SET purged_at = ? WHERE alias = ?", [at, alias]);
  return "purged";
}

/** How many names are live. */
export function countLiveNames(db: Db): number {
  return (
    db.query<{ n: number }, []>("SELECT count(*) AS n FROM names WHERE purged_at IS NULL").get()
      ?.n ?? 0
  );
}

// --- Purged keys ------------------------------------------------------------------------

export function insertPurged(db: Db, key: string, at: number): void {
  db.run("INSERT OR IGNORE INTO purged (key, at) VALUES (?, ?)", [key, at]);
}

export function isPurged(db: Db, key: string): boolean {
  return (
    db.query<{ key: string }, [string]>("SELECT key FROM purged WHERE key = ?").get(key) !== null
  );
}

// --- The audit --------------------------------------------------------------------------

export interface AuditRow {
  id: number;
  at: number;
  source: string;
  deviceId: string | null;
  address: string | null;
  action: string;
  target: string | null;
  detail: string;
}

/** Who caused an audit row: a request, the operator's shell, the first start, or the server itself. */
export type AuditSource = "api" | "cli" | "bootstrap" | "system";

export function insertAudit(
  db: Db,
  row: {
    at: number;
    source: AuditSource;
    deviceId?: string | null;
    address?: string | null;
    action: string;
    target?: string | null;
    detail?: string;
  },
): void {
  db.run(
    "INSERT INTO audit (at, source, device_id, address, action, target, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      row.at,
      row.source,
      row.deviceId ?? null,
      row.address ?? null,
      row.action,
      row.target ?? null,
      row.detail ?? "",
    ],
  );
}

interface AuditRecord {
  id: number;
  at: number;
  source: string;
  device_id: string | null;
  address: string | null;
  action: string;
  target: string | null;
  detail: string;
}

const AUDIT_COLUMNS = "id, at, source, device_id, address, action, target, detail";

const auditRow = (row: AuditRecord): AuditRow => ({
  id: row.id,
  at: row.at,
  source: row.source,
  deviceId: row.device_id,
  address: row.address,
  action: row.action,
  target: row.target,
  detail: row.detail,
});

/** The newest rows first. */
export function listAudit(db: Db, limit: number): AuditRow[] {
  return db
    .query<AuditRecord, [number]>(`SELECT ${AUDIT_COLUMNS} FROM audit ORDER BY id DESC LIMIT ?`)
    .all(limit)
    .map(auditRow);
}

// --- What a restore loses ---------------------------------------------------------------

export interface LostSince {
  entriesCreated: number;
  entriesRevised: number;
  memories: number;
  names: number;
  members: number;
  devices: number;
}

/** The rows written after `at`, by kind: what going back to a copy taken at `at` gives up. */
export function lostSince(db: Db, at: number): LostSince {
  const n = (sql: string, ...values: number[]): number =>
    db.query<{ n: number }, number[]>(sql).get(...values)?.n ?? 0;
  return {
    entriesCreated: n(
      "SELECT count(*) AS n FROM entry_revisions WHERE revision = 1 AND at > ?",
      at,
    ),
    // A withdrawal is a revision too; it is counted apart (`withdrawnSince`).
    entriesRevised: n(
      `SELECT count(DISTINCT r.uuid) AS n FROM entry_revisions r
       WHERE r.revision > 1 AND r.op = 'send' AND r.at > ?
         AND EXISTS (SELECT 1 FROM entry_revisions f WHERE f.uuid = r.uuid AND f.revision = 1 AND f.at <= ?)`,
      at,
      at,
    ),
    memories: n("SELECT count(*) AS n FROM memories WHERE received_at > ?", at),
    names: n("SELECT count(*) AS n FROM names WHERE created_at > ?", at),
    members: n("SELECT count(*) AS n FROM members WHERE created_at > ?", at),
    devices: n("SELECT count(*) AS n FROM devices WHERE created_at > ?", at),
  };
}

/** Every audit row after `at`, oldest first. */
export function auditSince(db: Db, at: number): AuditRow[] {
  return db
    .query<AuditRecord, [number]>(`SELECT ${AUDIT_COLUMNS} FROM audit WHERE at > ? ORDER BY id ASC`)
    .all(at)
    .map(auditRow);
}

export interface Withdrawal {
  kind: string;
  uid: string;
  key: string;
  /** The item's revision at the withdrawal: what an audit row of the same withdrawal names. */
  revision: number;
}

/** The items whose current feed row is a withdrawal made after `at`, oldest first: by a member's push or by an admin. */
export function withdrawnSince(db: Db, at: number): Withdrawal[] {
  return db
    .query<Withdrawal, [number]>(
      "SELECT kind, uid, key, revision FROM changes WHERE current = 1 AND op = 'tombstone' AND at > ? ORDER BY seq",
    )
    .all(at);
}

/** Whether `copy` holds the item live: its current feed row there is an upsert. The feed's `key`, `current` and `op` are unchanged since schema 1. */
export function liveInCopy(copy: Db, key: string): boolean {
  return (
    copy
      .query<{ found: number }, [string]>(
        "SELECT 1 AS found FROM changes WHERE key = ? AND current = 1 AND op = 'upsert'",
      )
      .get(key) !== null
  );
}

/** The three tables a restore asks an upgrade copy about; each has had `id` since schema 1. */
const IN_COPY = {
  devices: "SELECT 1 AS found FROM devices WHERE id = ?",
  members: "SELECT 1 AS found FROM members WHERE id = ?",
  invitations: "SELECT 1 AS found FROM invitations WHERE id = ?",
} as const;

/** Whether `copy` holds the row: the statement comes from a closed list, never from the caller's text. */
export function inCopy(copy: Db, table: keyof typeof IN_COPY, id: string): boolean {
  return copy.query<{ found: number }, [string]>(IN_COPY[table]).get(id) !== null;
}

/** The ids of the invitations used after `at` that are neither expired nor revoked: a copy taken at `at` holds them open. */
export function invitationsUsedSince(db: Db, at: number, now: number): string[] {
  return db
    .query<{ id: string }, [number, number]>(
      "SELECT id FROM invitations WHERE used_at > ? AND expires_at > ? AND revoked_at IS NULL ORDER BY created_at, id",
    )
    .all(at, now)
    .map((row) => row.id);
}
