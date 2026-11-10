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

/** Moves the high-water up to `to`, inserting the row when the table never had one; never lowers it. */
export function advanceSequence(db: Db, table: SequenceTable, to: number): void {
  withWrite(db, () => {
    const current = db
      .query<{ seq: number }, [string]>("SELECT seq FROM sqlite_sequence WHERE name = ?")
      .get(table);
    if (current === null) {
      db.run("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)", [table, to]);
    } else if (current.seq < to) {
      db.run("UPDATE sqlite_sequence SET seq = ? WHERE name = ?", [to, table]);
    }
  });
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

export function insertAudit(
  db: Db,
  row: {
    at: number;
    source: string;
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

/** The newest rows first. */
export function listAudit(db: Db, limit: number): AuditRow[] {
  return db
    .query<
      {
        id: number;
        at: number;
        source: string;
        device_id: string | null;
        address: string | null;
        action: string;
        target: string | null;
        detail: string;
      },
      [number]
    >(
      "SELECT id, at, source, device_id, address, action, target, detail FROM audit ORDER BY id DESC LIMIT ?",
    )
    .all(limit)
    .map((row) => ({
      id: row.id,
      at: row.at,
      source: row.source,
      deviceId: row.device_id,
      address: row.address,
      action: row.action,
      target: row.target,
      detail: row.detail,
    }));
}
