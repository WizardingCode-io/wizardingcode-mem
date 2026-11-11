// The push: an entry or a memory sent or withdrawn, one item at a time, each in its own
// transaction, in the order the spec gives its rules (D-6, D-7, D-8, D-12, D-15, D-20).
import { entryUid } from "../sharing/types.ts";
import type { Caller } from "./auth.ts";
import type { PushItemShape, PushReason, PushResultShape } from "./contract.ts";
import { parseEntryUid } from "./contract.ts";
import type { Db } from "./db.ts";
import { HttpError, unknownItem } from "./errors.ts";
import { memoryKey, splitMemoryKey } from "./ids.ts";
import { disableMember } from "./members.ts";
import {
  currentChangeOf,
  deviceByAlias,
  deviceById,
  type EntryRow,
  entryByUuid,
  insertChange,
  insertRevision,
  isPurged,
  listDevices,
  type MemoryRow,
  memoriesOfDevices,
  memoryByKey,
  revisionMatching,
  sequenceHighWater,
  setEntryLock,
  setEntryWithdrawn,
  setMemoryLock,
  setMemoryWithdrawn,
  transaction,
  upsertEntry,
  upsertMemory,
  workspaceEntriesOf,
} from "./store.ts";
import type { Context } from "./types.ts";
import { checkEntryPayload, checkMemoryPayload, type Refusal } from "./validate.ts";

/** The shapes are the contract's; the names stay for the server's own modules and tests. */
export type PushItem = PushItemShape;
export type PushResult = PushResultShape;

/** Who writes a tombstone the item's owner did not ask for: an admin's ids, or the CLI's (`OPERATOR` in ids.ts). */
export type Actor = { memberId: string; deviceId: string };

const refused = (uid: string, refusal: Refusal | PushReason): PushResult =>
  typeof refusal === "string"
    ? { uid, result: "refused", reason: refusal }
    : refusal.rule === undefined
      ? { uid, result: "refused", reason: refusal.reason }
      : { uid, result: "refused", reason: refusal.reason, rule: refusal.rule };

// --- The envelope -----------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseItem(raw: unknown, index: number): PushItem {
  const bad = () => new HttpError(400, { error: `item ${index}` });
  if (!isObject(raw)) throw bad();
  if (raw.op !== "send" && raw.op !== "withdraw") throw bad();
  if (raw.kind !== "entry" && raw.kind !== "memory") throw bad();
  if (typeof raw.uid !== "string" || raw.uid === "") throw bad();
  const baseRevision = raw.baseRevision === undefined ? 0 : raw.baseRevision;
  if (typeof baseRevision !== "number" || !Number.isInteger(baseRevision) || baseRevision < 0) {
    throw bad();
  }
  const baseHash = raw.baseHash === undefined ? "" : raw.baseHash;
  if (typeof baseHash !== "string") throw bad();
  const item: PushItem = { op: raw.op, kind: raw.kind, uid: raw.uid, baseRevision, baseHash };
  if (raw.payload !== undefined) item.payload = raw.payload;
  return item;
}

/** `{ epoch, items }`: 400 `epoch`, `items` or `item <index>`; a send without a payload is kept. */
export function parsePushBody(
  body: Record<string, unknown>,
  maxItems: number,
): { epoch: number | null; items: PushItem[] } {
  const epoch = body.epoch === undefined || body.epoch === null ? null : body.epoch;
  if (epoch !== null && (typeof epoch !== "number" || !Number.isInteger(epoch))) {
    throw new HttpError(400, { error: "epoch" });
  }
  const items = body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > maxItems) {
    throw new HttpError(400, { error: "items" });
  }
  return { epoch: epoch as number | null, items: items.map((raw, index) => parseItem(raw, index)) };
}

// --- Tombstones -------------------------------------------------------------------------

/** An entry's tombstone: the feed row, the `withdraw` revision with the hash kept, the row's state. */
function tombstoneEntry(
  db: Db,
  row: EntryRow,
  actor: Actor,
  now: number,
  epoch: number | null,
  lock: boolean,
): number {
  const revision = row.revision + 1;
  const seq = insertChange(db, {
    kind: "entry",
    uid: entryUid(row.scope as "workspace" | "shared" | "project", row.remote_alias, row.uuid),
    key: row.uuid,
    op: "tombstone",
    scope: row.scope,
    remoteAlias: row.remote_alias,
    revision,
    hash: row.hash,
    movedTo: null,
    memberId: actor.memberId,
    deviceId: actor.deviceId,
    clientEpoch: epoch,
    at: now,
  });
  insertRevision(db, {
    uuid: row.uuid,
    revision,
    seq,
    op: "withdraw",
    scope: row.scope,
    remoteAlias: row.remote_alias,
    slug: row.slug,
    frontmatter: "",
    body: "",
    hash: row.hash,
    writerMember: actor.memberId,
    writerDevice: actor.deviceId,
    clientEpoch: epoch,
    at: now,
  });
  setEntryWithdrawn(db, row.uuid, { revision, withdrawnAt: now, lock });
  return revision;
}

/** The alias of a device, or nothing for one the server does not hold: what a memory's feed uid carries. */
export const deviceAlias = (db: Db, deviceId: string): string =>
  deviceById(db, deviceId)?.alias ?? "";

/** A memory's feed uid: the device's alias and the memory's own uid, as the devices read it. */
export const memoryFeedUid = (deviceAlias: string, uid: string): string =>
  `remote:${deviceAlias}:${uid}`;

function tombstoneMemory(
  db: Db,
  row: MemoryRow,
  deviceAlias: string,
  actor: Actor,
  now: number,
  epoch: number | null,
  lock: boolean,
): number {
  const revision = row.revision + 1;
  insertChange(db, {
    kind: "memory",
    uid: memoryFeedUid(deviceAlias, row.uid),
    key: memoryKey(row.device_id, row.uid),
    op: "tombstone",
    scope: "project",
    remoteAlias: row.remote_alias,
    revision,
    hash: row.hash,
    movedTo: null,
    memberId: actor.memberId,
    deviceId: actor.deviceId,
    clientEpoch: epoch,
    at: now,
  });
  setMemoryWithdrawn(db, row.device_id, row.uid, { revision, withdrawnAt: now, lock });
  return revision;
}

// --- Sends ------------------------------------------------------------------------------

type Gates = { bytes: (deviceId: string, size: number) => boolean; lowDisk: () => boolean };

const stale = (
  uid: string,
  current: PushResult["current"],
  appliedAs: number | null,
): PushResult =>
  appliedAs === null
    ? { uid, result: "stale", current }
    : { uid, result: "stale", current, appliedAs };

/** The thirteen steps of an entry send. */
export function applyEntry(
  db: Db,
  caller: Caller,
  item: PushItem,
  epoch: number | null,
  now: number,
  gates: Gates,
): PushResult {
  const checked = checkEntryPayload({ uid: item.uid, payload: item.payload });
  if ("result" in checked) return refused(item.uid, checked);
  const { payload, bytes, hash, scope, remoteAlias, uuid } = checked;
  return transaction(db, () => {
    if (isPurged(db, uuid)) return refused(item.uid, "purged");
    const row = entryByUuid(db, uuid);
    if (
      row !== null &&
      row.withdrawn_at === null &&
      row.hash === hash &&
      row.scope === scope &&
      row.remote_alias === remoteAlias &&
      row.slug === payload.slug
    ) {
      return { uid: item.uid, result: "applied", revision: row.revision, hash: row.hash };
    }
    if (row !== null) {
      const creator = row.created_by_member === caller.member.id;
      if ((row.scope === "workspace" || scope === "workspace") && !creator) {
        return refused(item.uid, "not-owner");
      }
      if (row.locked_by_admin !== 0) return refused(item.uid, "withdrawn-by-admin");
      if (item.baseRevision !== row.revision || item.baseHash !== row.hash) {
        const appliedAs = revisionMatching(
          db,
          uuid,
          hash,
          scope,
          remoteAlias,
          payload.slug,
          caller.device.id,
        );
        return stale(item.uid, { revision: row.revision, hash: row.hash }, appliedAs);
      }
    } else if (item.baseRevision !== 0 || item.baseHash !== "") {
      return stale(item.uid, { revision: 0, hash: "" }, null);
    }
    if (!gates.bytes(caller.device.id, bytes.byteLength)) return refused(item.uid, "rate");
    if (gates.lowDisk()) return refused(item.uid, "storage");

    const revision = (row?.revision ?? 0) + 1;
    const seq = insertChange(db, {
      kind: "entry",
      uid: item.uid,
      key: uuid,
      op: "upsert",
      scope,
      remoteAlias,
      revision,
      hash,
      movedTo: null,
      memberId: caller.member.id,
      deviceId: caller.device.id,
      clientEpoch: epoch,
      at: now,
    });
    if (row !== null && (row.scope !== scope || row.remote_alias !== remoteAlias)) {
      insertChange(db, {
        kind: "entry",
        uid: entryUid(row.scope as "workspace" | "shared" | "project", row.remote_alias, uuid),
        key: `${uuid}@${revision}`,
        op: "tombstone",
        scope: row.scope,
        remoteAlias: row.remote_alias,
        revision,
        hash,
        movedTo: item.uid,
        memberId: caller.member.id,
        deviceId: caller.device.id,
        clientEpoch: epoch,
        at: now,
      });
    }
    upsertEntry(db, {
      uuid,
      scope,
      remoteAlias,
      slug: payload.slug,
      createdByMember: row?.created_by_member ?? caller.member.id,
      revision,
      hash,
      size: bytes.byteLength,
      writerMember: caller.member.id,
      writerDevice: caller.device.id,
      updatedAt: now,
    });
    insertRevision(db, {
      uuid,
      revision,
      seq,
      op: "send",
      scope,
      remoteAlias,
      slug: payload.slug,
      frontmatter: payload.frontmatter,
      body: payload.body,
      hash,
      writerMember: caller.member.id,
      writerDevice: caller.device.id,
      clientEpoch: epoch,
      at: now,
    });
    return { uid: item.uid, result: "applied", revision, hash };
  });
}

/** The eleven steps of a memory send. */
export function applyMemory(
  db: Db,
  caller: Caller,
  item: PushItem,
  epoch: number | null,
  now: number,
  gates: Gates,
): PushResult {
  const checked = checkMemoryPayload({ uid: item.uid, payload: item.payload });
  if ("result" in checked) return refused(item.uid, checked);
  const { payload, hash, size } = checked;
  const key = memoryKey(caller.device.id, payload.uid);
  return transaction(db, () => {
    if (isPurged(db, key)) return refused(item.uid, "purged");
    const row = memoryByKey(db, caller.device.id, payload.uid);
    if (
      row !== null &&
      row.withdrawn_at === null &&
      row.hash === hash &&
      row.remote_alias === payload.remoteAlias
    ) {
      return { uid: item.uid, result: "applied", revision: row.revision, hash: row.hash };
    }
    if (row !== null && row.locked_by_admin !== 0) return refused(item.uid, "withdrawn-by-admin");
    if (!gates.bytes(caller.device.id, size)) return refused(item.uid, "rate");
    if (gates.lowDisk()) return refused(item.uid, "storage");
    if (row !== null && payload.updatedAt < row.updated_at) {
      return {
        uid: item.uid,
        result: "stale",
        current: { revision: row.revision, hash: row.hash, updatedAt: row.updated_at },
      };
    }
    const revision = (row?.revision ?? 0) + 1;
    const feedUid = memoryFeedUid(caller.device.alias, payload.uid);
    insertChange(db, {
      kind: "memory",
      uid: feedUid,
      key,
      op: "upsert",
      scope: "project",
      remoteAlias: payload.remoteAlias,
      revision,
      hash,
      movedTo: null,
      memberId: caller.member.id,
      deviceId: caller.device.id,
      clientEpoch: epoch,
      at: now,
    });
    if (row !== null && row.remote_alias !== payload.remoteAlias) {
      insertChange(db, {
        kind: "memory",
        uid: feedUid,
        key: `${key}@${revision}`,
        op: "tombstone",
        scope: "project",
        remoteAlias: row.remote_alias,
        revision,
        hash,
        movedTo: feedUid,
        memberId: caller.member.id,
        deviceId: caller.device.id,
        clientEpoch: epoch,
        at: now,
      });
    }
    upsertMemory(db, {
      deviceId: caller.device.id,
      uid: payload.uid,
      remoteAlias: payload.remoteAlias,
      payload: JSON.stringify(payload),
      hash,
      size,
      revision,
      updatedAt: payload.updatedAt,
      memberId: caller.member.id,
      receivedAt: now,
    });
    return { uid: item.uid, result: "applied", revision, hash };
  });
}

// --- Withdraws --------------------------------------------------------------------------

const FEED_MEMORY = /^remote:([a-z2-7]{8}):(.+)$/s;

/**
 * The key an item's uid names: an entry's UUID; a memory's `<device id>:<uid>` from the feed
 * form through the device's alias, or from the caller's own uid. Null when it names nothing.
 */
export function parseFeedUid(
  db: Db,
  kind: "entry" | "memory",
  uid: string,
  callerDeviceId: string | null,
): { key: string } | null {
  if (kind === "entry") {
    const parsed = parseEntryUid(uid);
    return parsed === null ? null : { key: parsed.uuid };
  }
  const feed = FEED_MEMORY.exec(uid);
  if (feed !== null) {
    const device = deviceByAlias(db, feed[1] as string);
    return device === null ? null : { key: memoryKey(device.id, feed[2] as string) };
  }
  return callerDeviceId === null ? null : { key: memoryKey(callerDeviceId, uid) };
}

/** The one retry rule: the tombstone's own actor, on the revision just before it, is answered `withdrawn`. */
function retryOfTombstone(
  db: Db,
  key: string,
  revision: number,
  caller: Caller,
  item: PushItem,
): boolean {
  if (item.baseRevision !== revision - 1) return false;
  const tombstone = currentChangeOf(db, key);
  return (
    tombstone !== null &&
    tombstone.op === "tombstone" &&
    (tombstone.device_id === caller.device.id || tombstone.member_id === caller.member.id)
  );
}

/** The four steps of a withdraw. */
export function applyWithdraw(
  db: Db,
  caller: Caller,
  item: PushItem,
  epoch: number | null,
  now: number,
): PushResult {
  const actor: Actor = { memberId: caller.member.id, deviceId: caller.device.id };
  const admin = caller.member.role === "admin";
  return transaction(db, () => {
    const named = parseFeedUid(db, item.kind, item.uid, caller.device.id);
    if (named === null) return refused(item.uid, "unknown");
    if (item.kind === "entry") {
      const row = entryByUuid(db, named.key);
      if (row === null) return refused(item.uid, "unknown");
      if (row.withdrawn_at !== null) {
        return retryOfTombstone(db, row.uuid, row.revision, caller, item) &&
          item.baseHash === row.hash
          ? { uid: item.uid, result: "withdrawn", revision: row.revision }
          : stale(item.uid, { revision: row.revision, hash: row.hash }, null);
      }
      if (item.baseRevision !== row.revision || item.baseHash !== row.hash) {
        return stale(item.uid, { revision: row.revision, hash: row.hash }, null);
      }
      if (row.created_by_member !== caller.member.id && !admin) {
        return refused(item.uid, "not-owner");
      }
      return {
        uid: item.uid,
        result: "withdrawn",
        revision: tombstoneEntry(db, row, actor, now, epoch, false),
      };
    }
    const { deviceId, uid } = splitMemoryKey(named.key);
    const row = memoryByKey(db, deviceId, uid);
    if (row === null) return refused(item.uid, "unknown");
    const current = { revision: row.revision, hash: row.hash, updatedAt: row.updated_at };
    if (row.withdrawn_at !== null) {
      return retryOfTombstone(db, named.key, row.revision, caller, item)
        ? { uid: item.uid, result: "withdrawn", revision: row.revision }
        : { uid: item.uid, result: "stale", current };
    }
    if (item.baseRevision !== row.revision) return { uid: item.uid, result: "stale", current };
    if (row.member_id !== caller.member.id && !admin) return refused(item.uid, "not-owner");
    const alias = deviceAlias(db, row.device_id);
    return {
      uid: item.uid,
      result: "withdrawn",
      revision: tombstoneMemory(db, row, alias, actor, now, epoch, false),
    };
  });
}

// --- The push ---------------------------------------------------------------------------

/** Every item in order, each its own transaction; the signal and the file after the last. */
export function applyPush(
  ctx: Context,
  caller: Caller,
  body: Record<string, unknown>,
): PushResult[] {
  const { epoch, items } = parsePushBody(body, ctx.limits.itemsPerPush);
  const now = ctx.now();
  let disk: boolean | null = null;
  const gates: Gates = {
    bytes: (deviceId, size) => ctx.buckets.bytes.take(deviceId, size).ok,
    lowDisk: () => {
      if (disk === null) {
        const free = ctx.freeBytes(ctx.dataDir);
        disk = free !== null && free < ctx.limits.minFreeBytes;
      }
      return disk;
    },
  };
  const before = sequenceHighWater(ctx.db, "changes");
  const results = items.map((item) => {
    if (item.op === "withdraw") return applyWithdraw(ctx.db, caller, item, epoch, now);
    return item.kind === "entry"
      ? applyEntry(ctx.db, caller, item, epoch, now, gates)
      : applyMemory(ctx.db, caller, item, epoch, now, gates);
  });
  ctx.onWrite({ feed: sequenceHighWater(ctx.db, "changes") > before });
  return results;
}

export interface PushSummary {
  applied: number;
  stale: number;
  refused: number;
  withdrawn: number;
  refusals: { uid: string; reason: string; rule?: string }[];
}

/** The most of a refused uid the log line keeps: until the shape check passes, a uid is a member's text. */
export const LOGGED_UID_MAX = 256;

/** What the request's log line carries: the counts and the refused uids, clipped, with their reasons. */
export function summarizePush(results: readonly PushResult[]): PushSummary {
  const summary: PushSummary = { applied: 0, stale: 0, refused: 0, withdrawn: 0, refusals: [] };
  for (const result of results) {
    summary[result.result]++;
    if (result.result === "refused") {
      const uid = result.uid.slice(0, LOGGED_UID_MAX);
      summary.refusals.push(
        result.rule === undefined
          ? { uid, reason: result.reason as string }
          : { uid, reason: result.reason as string, rule: result.rule },
      );
    }
  }
  return summary;
}

// --- The admin's and the operator's acts --------------------------------------------------

/** Tombstones the member's live workspace entries and their devices' live memories; no lock. */
export function tombstoneMemberItems(db: Db, memberId: string, now: number, actor: Actor): number {
  return transaction(db, () => {
    let count = 0;
    for (const row of workspaceEntriesOf(db, memberId)) {
      tombstoneEntry(db, row, actor, now, null, false);
      count++;
    }
    const devices = listDevices(db, memberId);
    const aliases = new Map(devices.map((device) => [device.id, device.alias]));
    for (const row of memoriesOfDevices(
      db,
      devices.map((device) => device.id),
    )) {
      tombstoneMemory(db, row, aliases.get(row.device_id) ?? "", actor, now, null, false);
      count++;
    }
    return count;
  });
}

/**
 * A disable from either edge: the devices revoked, the member's workspace entries and their
 * devices' memories tombstoned when asked, and the audit detail both edges record.
 */
export function disableWithItems(
  db: Db,
  memberId: string,
  now: number,
  withdraw: boolean,
  actor: Actor,
): { devices: number; withdrawn: number; detail: string } {
  const { devices } = disableMember(db, memberId, now);
  const withdrawn = withdraw ? tombstoneMemberItems(db, memberId, now, actor) : 0;
  return { devices, withdrawn, detail: `devices ${devices}, withdrawn ${withdrawn}` };
}

/** Tombstones and locks; on an item already withdrawn, locks alone. 404 `unknown`. */
export function withdrawByAdmin(
  db: Db,
  kind: "entry" | "memory",
  uid: string,
  now: number,
  actor: Actor,
): { revision: number } {
  return transaction(db, () => {
    const named = parseFeedUid(db, kind, uid, null);
    if (named === null) throw unknownItem();
    if (kind === "entry") {
      const row = entryByUuid(db, named.key);
      if (row === null) throw unknownItem();
      if (row.withdrawn_at === null) {
        return { revision: tombstoneEntry(db, row, actor, now, null, true) };
      }
      setEntryLock(db, row.uuid, true);
      return { revision: row.revision };
    }
    const { deviceId, uid: memoryUid } = splitMemoryKey(named.key);
    const row = memoryByKey(db, deviceId, memoryUid);
    if (row === null) throw unknownItem();
    if (row.withdrawn_at === null) {
      const alias = deviceAlias(db, row.device_id);
      return { revision: tombstoneMemory(db, row, alias, actor, now, null, true) };
    }
    setMemoryLock(db, deviceId, memoryUid, true);
    return { revision: row.revision };
  });
}

/** Clears the admin's lock; the item stays withdrawn until its owner re-sends it. 404 `unknown`. */
export function reinstateByAdmin(db: Db, kind: "entry" | "memory", uid: string): void {
  transaction(db, () => {
    const named = parseFeedUid(db, kind, uid, null);
    if (named === null) throw unknownItem();
    if (kind === "entry") {
      if (entryByUuid(db, named.key) === null) throw unknownItem();
      setEntryLock(db, named.key, false);
      return;
    }
    const { deviceId, uid: memoryUid } = splitMemoryKey(named.key);
    if (memoryByKey(db, deviceId, memoryUid) === null) throw unknownItem();
    setMemoryLock(db, deviceId, memoryUid, false);
  });
}
