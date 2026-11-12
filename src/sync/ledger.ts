// The sync client's statements over the ledger's seven tables (`sharing_ledger`,
// `sharing_sent_hashes`, `sharing_refusals`, `sharing_conflicts`, `sharing_pending_rows`,
// `sharing_unbound`, `sharing_received_memories`) and the per-server meta keys. The outbound
// and inbound sides write through here, each write guarded by the lease when the loop holds
// one (`guarded`). Outside `src/sync/`, the places that may name these tables are the ones
// `tests/unit/sync-boundary.test.ts` lists (the sharing module, the restore's carry, the
// store's received-memory deletion, the knowledge module's reads and the retrieval's marks).
// Every read is empty on a store without the sharing v2 schema, which `status` and `doctor`
// may open without migrating.
import { hasTable } from "../sharing/store.ts";
import { NAME_STATES, nameFlagKey } from "../sharing/types.ts";
import type { Db } from "../store/db.ts";
import { getMeta, restoreHoldKey, setMeta } from "../store/meta.ts";
import type { SyncContext } from "./context.ts";
import { guarded } from "./state.ts";

/** The `meta` key of the uids a `share server resume` showed, consumed by the withdrawal sweeps. */
export const resumeAuthorisedKey = (serverId: string): string =>
  `sharing.resume_authorised:${serverId}`;

/** How many hashes the sent history keeps per uid. */
export const SENT_HASHES_KEPT = 8;

/** The seven tables, by the column that names the server in each. */
const SERVER_TABLES: readonly [table: string, column: string][] = [
  ["sharing_ledger", "destination"],
  ["sharing_sent_hashes", "destination"],
  ["sharing_refusals", "destination"],
  ["sharing_conflicts", "destination"],
  ["sharing_pending_rows", "server_id"],
  ["sharing_unbound", "server_id"],
  ["sharing_received_memories", "server_id"],
];

/**
 * Whether this connection's store has the ledger's tables, asked once per open: `status` and
 * `doctor` reach here through `openExisting`, which never migrates.
 */
const schemaKnown = new WeakMap<Db, boolean>();
export function hasLedgerTables(db: Db): boolean {
  let known = schemaKnown.get(db);
  if (known === undefined) {
    known = hasTable(db, "sharing_sent_hashes");
    schemaKnown.set(db, known);
  }
  return known;
}

export type ItemKind = "entry" | "memory";

// --- The sent rows ----------------------------------------------------------------------------

export interface SentRow {
  destination: string;
  itemKind: ItemKind;
  itemUid: string;
  direction: "sent" | "applied";
  /** The server's revision. */
  version: number;
  /** The server's hash of what it holds. */
  hash: string;
  policyEpoch: number;
  at: number;
  withdrawnAt: number | null;
  /** The index hash of the file as it was when sent or applied; a memory's `memoryHash`. */
  localHash: string;
  instance: string;
  reason: string;
}

const SENT_COLUMNS = `destination, item_kind AS itemKind, item_uid AS itemUid, direction, version, hash,
  policy_epoch AS policyEpoch, at, withdrawn_at AS withdrawnAt, local_hash AS localHash, instance, reason`;

export function sentRow(db: Db, serverId: string, kind: ItemKind, uid: string): SentRow | null {
  if (!hasLedgerTables(db)) return null;
  return db
    .query<SentRow, [string, ItemKind, string]>(
      `SELECT ${SENT_COLUMNS} FROM sharing_ledger
        WHERE destination = ? AND item_kind = ? AND item_uid = ? AND direction = 'sent'`,
    )
    .get(serverId, kind, uid);
}

/** Every `sent` row of a server not withdrawn, by kind and uid. */
export function liveSentRows(db: Db, serverId: string, kind?: ItemKind): SentRow[] {
  if (!hasLedgerTables(db)) return [];
  return db
    .query<SentRow, [string, ItemKind | null]>(
      `SELECT ${SENT_COLUMNS} FROM sharing_ledger
        WHERE destination = ? AND direction = 'sent' AND withdrawn_at IS NULL
          AND (?2 IS NULL OR item_kind = ?2)
        ORDER BY item_kind, item_uid`,
    )
    .all(serverId, kind ?? null);
}

/** The `applied` row of an own entry: a teammate's revision applied to the file. */
export function appliedRow(db: Db, serverId: string, uid: string): SentRow | null {
  if (!hasLedgerTables(db)) return null;
  return db
    .query<SentRow, [string, string]>(
      `SELECT ${SENT_COLUMNS} FROM sharing_ledger
        WHERE destination = ? AND item_kind = 'entry' AND item_uid = ? AND direction = 'applied'`,
    )
    .get(serverId, uid);
}

/** The sent row of an own entry's uuid under any uid of this server: the move rule reads it. */
export function sentRowByUuid(db: Db, serverId: string, uuid: string): SentRow | null {
  if (!hasLedgerTables(db)) return null;
  return db
    .query<SentRow, [string, string]>(
      `SELECT ${SENT_COLUMNS} FROM sharing_ledger
        WHERE destination = ? AND item_kind = 'entry' AND direction = 'sent'
          AND withdrawn_at IS NULL AND item_uid LIKE '%:' || ?
        ORDER BY at DESC LIMIT 1`,
    )
    .get(serverId, uuid);
}

export interface SentWrite {
  revision: number;
  hash: string;
  localHash: string;
  instance: string;
  epoch: number;
  at: number;
}

/** An `applied` answer: the sent row written or replaced, and the hash added to the sent history. */
export function writeSent(
  ctx: SyncContext,
  serverId: string,
  kind: ItemKind,
  uid: string,
  write: SentWrite,
): void {
  guarded(ctx, () => {
    ctx.db.run(
      `INSERT INTO sharing_ledger (destination, item_kind, item_uid, direction, version, hash,
         policy_epoch, at, withdrawn_at, local_hash, instance, reason)
       VALUES (?, ?, ?, 'sent', ?, ?, ?, ?, NULL, ?, ?, '')
       ON CONFLICT (destination, item_kind, item_uid, direction) DO UPDATE SET
         version = excluded.version, hash = excluded.hash, policy_epoch = excluded.policy_epoch,
         at = excluded.at, withdrawn_at = NULL, local_hash = excluded.local_hash,
         instance = excluded.instance, reason = ''`,
      [
        serverId,
        kind,
        uid,
        write.revision,
        write.hash,
        write.epoch,
        write.at,
        write.localHash,
        write.instance,
      ],
    );
    ctx.db.run(
      `INSERT OR REPLACE INTO sharing_sent_hashes (destination, item_kind, item_uid, hash, revision, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [serverId, kind, uid, write.hash, write.revision, write.at],
    );
    ctx.db.run(
      `DELETE FROM sharing_sent_hashes WHERE destination = ? AND item_kind = ? AND item_uid = ?
          AND hash NOT IN (SELECT hash FROM sharing_sent_hashes
                            WHERE destination = ? AND item_kind = ? AND item_uid = ?
                            ORDER BY revision DESC, at DESC LIMIT ?)`,
      [serverId, kind, uid, serverId, kind, uid, SENT_HASHES_KEPT],
    );
  });
}

/** A teammate's revision applied to an own file: the `applied` row, and the sent row moved to it. */
export function writeApplied(
  ctx: SyncContext,
  serverId: string,
  uid: string,
  write: Omit<SentWrite, "epoch"> & {
    /** The member whose revision was applied: the `reason` column of an `applied` row holds the name. */
    reason?: string;
  },
): void {
  guarded(ctx, () => {
    ctx.db.run(
      `INSERT INTO sharing_ledger (destination, item_kind, item_uid, direction, version, hash,
         policy_epoch, at, withdrawn_at, local_hash, instance, reason)
       VALUES (?, 'entry', ?, 'applied', ?, ?, 0, ?, NULL, ?, ?, ?)
       ON CONFLICT (destination, item_kind, item_uid, direction) DO UPDATE SET
         version = excluded.version, hash = excluded.hash, at = excluded.at, withdrawn_at = NULL,
         local_hash = excluded.local_hash, instance = excluded.instance, reason = excluded.reason`,
      [
        serverId,
        uid,
        write.revision,
        write.hash,
        write.at,
        write.localHash,
        write.instance,
        write.reason ?? "",
      ],
    );
    moveSent(ctx, serverId, uid, write);
  });
}

/** The sent row's revision, hash and local hash moved to a revision this machine now holds. */
export function moveSent(
  ctx: SyncContext,
  serverId: string,
  uid: string,
  to: { revision: number; hash: string; localHash: string; instance?: string },
): void {
  guarded(ctx, () => {
    ctx.db.run(
      `UPDATE sharing_ledger SET version = ?, hash = ?, local_hash = ?, withdrawn_at = NULL, reason = '',
              instance = COALESCE(?, instance)
        WHERE destination = ? AND item_kind = 'entry' AND item_uid = ? AND direction = 'sent'`,
      [to.revision, to.hash, to.localHash, to.instance ?? null, serverId, uid],
    );
  });
}

/** A moved entry's old uid: withdrawn with the reason `moved`, no withdraw sent. */
export function retireMoved(ctx: SyncContext, serverId: string, oldUid: string, at: number): void {
  markWithdrawn(ctx, serverId, "entry", oldUid, at, "moved");
}

export function markWithdrawn(
  ctx: SyncContext,
  serverId: string,
  kind: ItemKind,
  uid: string,
  at: number,
  reason: string,
): void {
  guarded(ctx, () => {
    ctx.db.run(
      `UPDATE sharing_ledger SET withdrawn_at = ?, reason = ?
        WHERE destination = ? AND item_kind = ? AND item_uid = ? AND direction = 'sent'`,
      [at, reason, serverId, kind, uid],
    );
  });
}

/** The `sent` row and its `applied` row gone: a purge, a snapshot's clearing, a removal. */
export function clearSent(ctx: SyncContext, serverId: string, kind: ItemKind, uid: string): void {
  guarded(ctx, () => {
    ctx.db.run(
      `DELETE FROM sharing_ledger WHERE destination = ? AND item_kind = ? AND item_uid = ?
          AND direction IN ('sent', 'applied')`,
      [serverId, kind, uid],
    );
  });
}

export function sentHashes(db: Db, serverId: string, kind: ItemKind, uid: string): string[] {
  if (!hasLedgerTables(db)) return [];
  return db
    .query<{ hash: string }, [string, ItemKind, string]>(
      `SELECT hash FROM sharing_sent_hashes WHERE destination = ? AND item_kind = ? AND item_uid = ?
        ORDER BY revision DESC, at DESC`,
    )
    .all(serverId, kind, uid)
    .map((row) => row.hash);
}

// --- Refusals and purges -------------------------------------------------------------------------

/** The hash a purged key's refusal row carries: the uid is refused whatever its hash. */
export const PURGED_HASH = "*";

export function writeRefusal(
  ctx: SyncContext,
  serverId: string,
  kind: ItemKind,
  uid: string,
  hash: string,
  reason: string,
  rule: string | null,
  at: number,
): void {
  guarded(ctx, () => {
    ctx.db.run(
      `INSERT OR REPLACE INTO sharing_refusals (destination, item_kind, item_uid, hash, reason, rule, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [serverId, kind, uid, hash, reason, rule, at],
    );
  });
}

/** A `purged` answer: the uid refused for good, its ledger rows cleared. */
export function purgedKey(
  ctx: SyncContext,
  serverId: string,
  kind: ItemKind,
  uid: string,
  at: number,
): void {
  guarded(ctx, () => {
    writeRefusal(ctx, serverId, kind, uid, PURGED_HASH, "purged", null, at);
    clearSent(ctx, serverId, kind, uid);
  });
}

/** Why an item is not sent again: a refusal recorded for its hash, or a purge of its uid. */
export function refusalFor(
  db: Db,
  serverId: string,
  kind: ItemKind,
  uid: string,
  hash: string,
): { reason: string; rule: string | null } | null {
  if (!hasLedgerTables(db)) return null;
  return db
    .query<{ reason: string; rule: string | null }, [string, ItemKind, string, string, string]>(
      `SELECT reason, rule FROM sharing_refusals
        WHERE destination = ? AND item_kind = ? AND item_uid = ? AND hash IN (?, ?)
        ORDER BY CASE hash WHEN '*' THEN 0 ELSE 1 END LIMIT 1`,
    )
    .get(serverId, kind, uid, PURGED_HASH, hash);
}

// --- Conflicts ------------------------------------------------------------------------------------

export interface ConflictRow {
  destination: string;
  itemUid: string;
  at: number;
  localText: string;
  localVersion: number;
  localHash: string;
  serverRevision: number;
  serverHash: string;
  proposalId: string | null;
  resolvedAt: number | null;
}

const CONFLICT_COLUMNS = `destination, item_uid AS itemUid, at, local_text AS localText,
  local_version AS localVersion, local_hash AS localHash, server_revision AS serverRevision,
  server_hash AS serverHash, proposal_id AS proposalId, resolved_at AS resolvedAt`;

export function writeConflict(
  ctx: SyncContext,
  serverId: string,
  uid: string,
  row: Omit<ConflictRow, "destination" | "itemUid" | "resolvedAt">,
): void {
  guarded(ctx, () => {
    ctx.db.run(
      `INSERT OR REPLACE INTO sharing_conflicts (destination, item_uid, at, local_text, local_version,
         local_hash, server_revision, server_hash, proposal_id, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        serverId,
        uid,
        row.at,
        row.localText,
        row.localVersion,
        row.localHash,
        row.serverRevision,
        row.serverHash,
        row.proposalId,
      ],
    );
  });
}

/** Closes the row of a proposal a person decided; plain, for the CLI after the store's write. */
export function closeConflict(db: Db, proposalId: string, at: number): number {
  if (!hasLedgerTables(db)) return 0;
  return db.run(
    "UPDATE sharing_conflicts SET resolved_at = ? WHERE proposal_id = ? AND resolved_at IS NULL",
    [at, proposalId],
  ).changes;
}

export function openConflicts(db: Db, serverId?: string): ConflictRow[] {
  if (!hasLedgerTables(db)) return [];
  return db
    .query<ConflictRow, [string | null]>(
      `SELECT ${CONFLICT_COLUMNS} FROM sharing_conflicts
        WHERE resolved_at IS NULL AND (?1 IS NULL OR destination = ?1)
        ORDER BY destination, item_uid, at`,
    )
    .all(serverId ?? null);
}

/** Open conflicts of a server: rows whose `resolved_at` is null. */
export function openConflictCount(db: Db, serverId: string): number {
  if (!hasLedgerTables(db)) return 0;
  return (
    db
      .query<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM sharing_conflicts WHERE destination = ? AND resolved_at IS NULL",
      )
      .get(serverId)?.n ?? 0
  );
}

// --- Pending rows and unbound aliases ------------------------------------------------------------

export interface PendingRow {
  serverId: string;
  seq: number;
  uid: string;
  kind: ItemKind;
  payload: string;
  reason: string;
  tries: number;
  at: number;
}

export function pendingRows(db: Db, serverId: string): PendingRow[] {
  if (!hasLedgerTables(db)) return [];
  return db
    .query<PendingRow, [string]>(
      `SELECT server_id AS serverId, seq, uid, kind, payload, reason, tries, at
         FROM sharing_pending_rows WHERE server_id = ? ORDER BY seq`,
    )
    .all(serverId);
}

export function writePendingRow(ctx: SyncContext, row: PendingRow): void {
  guarded(ctx, () => {
    ctx.db.run(
      `INSERT OR REPLACE INTO sharing_pending_rows (server_id, seq, uid, kind, payload, reason, tries, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.serverId, row.seq, row.uid, row.kind, row.payload, row.reason, row.tries, row.at],
    );
  });
}

/**
 * The pending rows of a uid up to a seq: what the hourly re-apply drops once the row at that
 * seq applied. An older row of the uid that still failed goes with it, since the copy is past
 * it now and it must never come back over a later revision; a newer row that still fails
 * stays set aside.
 */
export function deletePendingRowsUpTo(
  ctx: SyncContext,
  serverId: string,
  uid: string,
  seq: number,
): void {
  guarded(ctx, () => {
    ctx.db.run("DELETE FROM sharing_pending_rows WHERE server_id = ? AND uid = ? AND seq <= ?", [
      serverId,
      uid,
      seq,
    ]);
  });
}

/** Every pending row of a server: what a rebuilt server (a new instance) drops with its cursors. */
export function deletePendingRows(ctx: SyncContext, serverId: string): void {
  guarded(ctx, () => {
    ctx.db.run("DELETE FROM sharing_pending_rows WHERE server_id = ?", [serverId]);
  });
}

/** Rows set aside after ten failed applies, waiting for a retry. */
export function pendingRowCount(db: Db, serverId: string): number {
  if (!hasLedgerTables(db)) return 0;
  return (
    db
      .query<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM sharing_pending_rows WHERE server_id = ?",
      )
      .get(serverId)?.n ?? 0
  );
}

export function unboundAliases(db: Db, serverId: string): { alias: string; at: number }[] {
  if (!hasLedgerTables(db)) return [];
  return db
    .query<{ alias: string; at: number }, [string]>(
      "SELECT alias, at FROM sharing_unbound WHERE server_id = ? ORDER BY alias",
    )
    .all(serverId);
}

export function deleteUnbound(ctx: SyncContext, serverId: string, alias: string): void {
  guarded(ctx, () => {
    ctx.db.run("DELETE FROM sharing_unbound WHERE server_id = ? AND alias = ?", [serverId, alias]);
  });
}

// --- Received entries: the ledger rows the received store keeps -----------------------------------

/** The `received` row of an entry copy, upserted on each revision applied. */
export function writeReceivedEntryRow(
  ctx: SyncContext,
  serverId: string,
  uid: string,
  revision: number,
  hash: string,
  at: number,
): void {
  guarded(ctx, () => {
    ctx.db.run(
      `INSERT INTO sharing_ledger (destination, item_kind, item_uid, direction, version, hash,
         policy_epoch, at, withdrawn_at, local_hash, instance, reason)
       VALUES (?, 'entry', ?, 'received', ?, ?, 0, ?, NULL, '', '', '')
       ON CONFLICT (destination, item_kind, item_uid, direction) DO UPDATE SET
         version = excluded.version, hash = excluded.hash, at = excluded.at, withdrawn_at = NULL`,
      [serverId, uid, revision, hash, at],
    );
  });
}

/** Removes the `received` row of one copy, entry or memory. */
export function deleteReceivedRow(
  ctx: SyncContext,
  serverId: string,
  kind: ItemKind,
  uid: string,
): void {
  guarded(ctx, () => {
    ctx.db.run(
      `DELETE FROM sharing_ledger WHERE destination = ? AND item_kind = ? AND item_uid = ?
          AND direction = 'received'`,
      [serverId, kind, uid],
    );
  });
}

/** Removes every `received` row of a server: the removal's and the orphan deletion's. */
export function deleteReceivedRows(ctx: SyncContext, serverId: string): void {
  guarded(ctx, () => {
    ctx.db.run("DELETE FROM sharing_ledger WHERE destination = ? AND direction = 'received'", [
      serverId,
    ]);
  });
}

/**
 * A memory copy's provenance row and its `received` row, by the remote uid; the memory itself
 * goes through `deleteReceivedMemory` first, when there is one.
 */
export function deleteReceivedMemoryRow(ctx: SyncContext, serverId: string, uid: string): void {
  guarded(ctx, () => {
    ctx.db.run("DELETE FROM sharing_received_memories WHERE server_id = ? AND remote_uid = ?", [
      serverId,
      uid,
    ]);
    ctx.db.run(
      `DELETE FROM sharing_ledger WHERE destination = ? AND item_kind = 'memory' AND item_uid = ?
          AND direction = 'received'`,
      [serverId, uid],
    );
  });
}

/** The received memories of a server, or of one alias of it, by memory id. */
export function receivedMemoryIds(db: Db, serverId: string, alias: string | null): number[] {
  if (!hasLedgerTables(db)) return [];
  if (alias === null)
    return db
      .query<{ memory_id: number }, [string]>(
        "SELECT memory_id FROM sharing_received_memories WHERE server_id = ? ORDER BY memory_id",
      )
      .all(serverId)
      .map((row) => row.memory_id);
  return db
    .query<{ memory_id: number }, [string, string]>(
      `SELECT r.memory_id FROM sharing_received_memories r JOIN memories m ON m.id = r.memory_id
        JOIN project_aliases a ON a.project_id = m.project_id
       WHERE r.server_id = ? AND a.alias = ? ORDER BY r.memory_id`,
    )
    .all(serverId, alias)
    .map((row) => row.memory_id);
}

/** The entries the ledger holds for a server, sent or received: what a snapshot is compared against. */
export function entryLedgerUids(
  db: Db,
  serverId: string,
): { uid: string; direction: "sent" | "received" }[] {
  if (!hasLedgerTables(db)) return [];
  return db
    .query<{ uid: string; direction: "sent" | "received" }, [string]>(
      `SELECT item_uid AS uid, direction FROM sharing_ledger
        WHERE destination = ? AND item_kind = 'entry' AND direction IN ('sent', 'received')`,
    )
    .all(serverId);
}

/**
 * The received memories the ledger holds for a server: each `received` memory row with the
 * memory its provenance names (null for a deduped uid) and that memory's project. What a
 * snapshot's comparison reads beside the entries.
 */
export function receivedMemoryLedger(
  db: Db,
  serverId: string,
): { uid: string; memoryId: number | null; projectId: number | null }[] {
  if (!hasLedgerTables(db)) return [];
  return db
    .query<{ uid: string; memoryId: number | null; projectId: number | null }, [string]>(
      `SELECT l.item_uid AS uid, r.memory_id AS memoryId, m.project_id AS projectId
         FROM sharing_ledger l
         LEFT JOIN sharing_received_memories r ON r.server_id = l.destination AND r.remote_uid = l.item_uid
         LEFT JOIN memories m ON m.id = r.memory_id
        WHERE l.destination = ? AND l.item_kind = 'memory' AND l.direction = 'received'`,
    )
    .all(serverId);
}

/** What was received under a shared name: the counts `status` prints beside it (ADR 0028). */
export interface ReceivedNameCounts {
  entries: number;
  memories: number;
  /** The distinct members the entries and memories came from. */
  members: number;
  lastAt: number | null;
}

const NO_RECEIVED: ReceivedNameCounts = { entries: 0, memories: 0, members: 0, lastAt: null };

/**
 * The received entries of a server under an alias (`knowledge_received`), the received
 * memories of the project the alias names (`sharing_received_memories` joined to the memory
 * and the alias), the distinct members among them and the latest time either arrived.
 */
export function receivedNameCounts(db: Db, serverId: string, alias: string): ReceivedNameCounts {
  if (!hasLedgerTables(db) || !hasTable(db, "knowledge_received")) return NO_RECEIVED;
  const entries = db
    .query<{ n: number; last: number | null }, [string, string]>(
      `SELECT count(*) AS n, max(received_at) AS last FROM knowledge_received
        WHERE server_id = ? AND remote_alias = ?`,
    )
    .get(serverId, alias);
  const entryMembers = db
    .query<{ member_id: string }, [string, string]>(
      "SELECT DISTINCT member_id FROM knowledge_received WHERE server_id = ? AND remote_alias = ?",
    )
    .all(serverId, alias)
    .map((row) => row.member_id);
  const memories = db
    .query<{ n: number; last: number | null }, [string, string]>(
      `SELECT count(*) AS n, max(l.at) AS last FROM sharing_received_memories r
         JOIN memories m ON m.id = r.memory_id
         JOIN project_aliases a ON a.project_id = m.project_id
         LEFT JOIN sharing_ledger l ON l.destination = r.server_id AND l.item_uid = r.remote_uid
          AND l.item_kind = 'memory' AND l.direction = 'received'
        WHERE r.server_id = ? AND a.alias = ?`,
    )
    .get(serverId, alias);
  const memoryMembers = db
    .query<{ member_id: string }, [string, string]>(
      `SELECT DISTINCT r.member_id FROM sharing_received_memories r
         JOIN memories m ON m.id = r.memory_id
         JOIN project_aliases a ON a.project_id = m.project_id
        WHERE r.server_id = ? AND a.alias = ?`,
    )
    .all(serverId, alias)
    .map((row) => row.member_id);
  const lasts = [entries?.last ?? null, memories?.last ?? null].filter(
    (value): value is number => value !== null,
  );
  return {
    entries: entries?.n ?? 0,
    memories: memories?.n ?? 0,
    members: new Set([...entryMembers, ...memoryMembers]).size,
    lastAt: lasts.length === 0 ? null : Math.max(...lasts),
  };
}

/** The server ids with a received memory's provenance row. */
export function receivedMemoryServerIds(db: Db): string[] {
  if (!hasLedgerTables(db)) return [];
  return db
    .query<{ server_id: string }, []>(
      "SELECT DISTINCT server_id FROM sharing_received_memories ORDER BY server_id",
    )
    .all()
    .map((row) => row.server_id);
}

// --- Received memories ---------------------------------------------------------------------------

export interface ReceivedMemory {
  serverId: string;
  remoteUid: string;
  /** Null for a uid deduped against an existing memory: its ledger row alone records it. */
  memoryId: number | null;
  memberId: string;
  memberName: string;
  revision: number;
  hash: string;
  remoteKind: string;
  remoteImportance: number;
  remoteStatus: string;
}

/**
 * What this machine holds for a received memory's uid: its provenance row with the memory, or,
 * for a deduped uid, the `received` ledger row alone (`memoryId` null). Null when unknown.
 */
export function receivedMemoryRow(
  db: Db,
  serverId: string,
  remoteUid: string,
): { memoryId: number | null; hash: string; revision: number } | null {
  if (!hasLedgerTables(db)) return null;
  const row = db
    .query<{ memory_id: number; hash: string; revision: number }, [string, string]>(
      "SELECT memory_id, hash, revision FROM sharing_received_memories WHERE server_id = ? AND remote_uid = ?",
    )
    .get(serverId, remoteUid);
  if (row !== null) return { memoryId: row.memory_id, hash: row.hash, revision: row.revision };
  const ledger = db
    .query<{ hash: string; version: number }, [string, string]>(
      `SELECT hash, version FROM sharing_ledger
        WHERE destination = ? AND item_kind = 'memory' AND item_uid = ? AND direction = 'received'`,
    )
    .get(serverId, remoteUid);
  return ledger === null ? null : { memoryId: null, hash: ledger.hash, revision: ledger.version };
}

/**
 * A received memory recorded: its provenance row (when a memory was inserted or kept) and its
 * `received` ledger row, whose `item_uid` is the feed's uid as the server shows it.
 */
export function writeReceivedMemoryRow(
  ctx: SyncContext,
  row: ReceivedMemory,
  remoteUid: string,
  at: number,
): void {
  guarded(ctx, () => {
    if (row.memoryId !== null) {
      ctx.db.run(
        `INSERT OR REPLACE INTO sharing_received_memories
           (memory_id, server_id, remote_uid, member_id, member_name, revision, hash,
            remote_kind, remote_importance, remote_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.memoryId,
          row.serverId,
          remoteUid,
          row.memberId,
          row.memberName,
          row.revision,
          row.hash,
          row.remoteKind,
          row.remoteImportance,
          row.remoteStatus,
        ],
      );
    } else {
      ctx.db.run("DELETE FROM sharing_received_memories WHERE server_id = ? AND remote_uid = ?", [
        row.serverId,
        remoteUid,
      ]);
    }
    ctx.db.run(
      `INSERT INTO sharing_ledger (destination, item_kind, item_uid, direction, version, hash,
         policy_epoch, at, withdrawn_at, local_hash, instance, reason)
       VALUES (?, 'memory', ?, 'received', ?, ?, 0, ?, NULL, '', '', '')
       ON CONFLICT (destination, item_kind, item_uid, direction) DO UPDATE SET
         version = excluded.version, hash = excluded.hash, at = excluded.at, withdrawn_at = NULL`,
      [row.serverId, remoteUid, row.revision, row.hash, at],
    );
  });
}

// --- The hold and the authorised list (D-10) -----------------------------------------------------

export function setHold(
  ctx: SyncContext,
  serverId: string,
  reason: "restore" | "bulk",
  at: number,
  count = 0,
): void {
  guarded(ctx, () => {
    setMeta(ctx.db, restoreHoldKey(serverId), JSON.stringify({ reason, at, count }));
  });
}

/** Every ledger row of an item at a server, sent, received and applied alike, oldest first. */
export function ledgerHistory(db: Db, serverId: string, kind: ItemKind, uid: string): SentRow[] {
  if (!hasLedgerTables(db)) return [];
  return db
    .query<SentRow, [string, ItemKind, string]>(
      `SELECT ${SENT_COLUMNS} FROM sharing_ledger
        WHERE destination = ? AND item_kind = ? AND item_uid = ? ORDER BY at, direction`,
    )
    .all(serverId, kind, uid);
}

export function authorisedUids(db: Db, serverId: string): string[] {
  const raw = getMeta(db, resumeAuthorisedKey(serverId));
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((uid): uid is string => typeof uid === "string")
      : [];
  } catch {
    return [];
  }
}

/** The list rewritten as a compact JSON array; the key deleted when the list is empty. */
export function writeAuthorised(db: Db, serverId: string, uids: readonly string[]): void {
  if (uids.length === 0) db.run("DELETE FROM meta WHERE key = ?", [resumeAuthorisedKey(serverId)]);
  else setMeta(db, resumeAuthorisedKey(serverId), JSON.stringify(uids));
}

/** One uid answered: taken out of the list, the key deleted when the list is empty. */
export function consumeAuthorised(ctx: SyncContext, serverId: string, uid: string): void {
  guarded(ctx, () => {
    writeAuthorised(
      ctx.db,
      serverId,
      authorisedUids(ctx.db, serverId).filter((listed) => listed !== uid),
    );
  });
}

// --- The removal --------------------------------------------------------------------------------

/**
 * Every row of the seven tables that names the server, and its hold key and authorised list:
 * plain statements, inside the removal's transaction. The memories the received rows name
 * are the received store's to delete (`deleteServerReceived`), before this.
 */
export function clearServerLedger(db: Db, serverId: string): { rows: number } {
  if (!hasLedgerTables(db)) return { rows: 0 };
  let rows = 0;
  for (const [table, column] of SERVER_TABLES) {
    rows += db.run(`DELETE FROM ${table} WHERE ${column} = ?`, [serverId]).changes;
  }
  db.run("DELETE FROM meta WHERE key IN (?, ?)", [
    restoreHoldKey(serverId),
    resumeAuthorisedKey(serverId),
  ]);
  // The three flags of each shared name bound to the server (ADR 0028).
  for (const state of NAME_STATES) {
    const prefix = nameFlagKey(state, serverId, "");
    db.run("DELETE FROM meta WHERE substr(key, 1, ?) = ?", [prefix.length, prefix]);
  }
  return { rows };
}
