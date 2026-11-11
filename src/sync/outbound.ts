// The outbound side (ADR 0027): one sweep of a server. Committed text only; `decide` rules
// every item; the payloads leave through the edge; the answers write the ledger; the
// withdrawals run at the sixty-second mark behind D-10's two guards.
import { join } from "node:path";
import { ENTRY_MAX_BYTES, splitFrontmatterLines } from "../modules/knowledge/entry.ts";
import { KnowledgeError } from "../modules/knowledge/errors.ts";
import { ensureFresh } from "../modules/knowledge/index-store.ts";
import {
  ENTRIES_DIR,
  hashOf,
  openRepo,
  readRegularFile,
  statusOf,
  withRepoLeases,
} from "../modules/knowledge/repo.ts";
import { openStore } from "../modules/knowledge/store-open.ts";
import type { KnowledgeStore, Repo, ScopeRef } from "../modules/knowledge/types.ts";
import { redactForSend } from "../sharing/edge.ts";
import { memoryHash } from "../sharing/hash.ts";
import { policyInForce } from "../sharing/in-force.ts";
import { levelKey, levelOf } from "../sharing/levels.ts";
import { decide, loadPolicy } from "../sharing/policy.ts";
import { entryItems, ledgerRecords, memoryItems, withHashes } from "../sharing/report.ts";
import { generationOf, ownChangeAfter } from "../sharing/store.ts";
import type {
  EntryItem,
  Item,
  OutgoingEntry,
  OutgoingMemory,
  SharingPolicy,
} from "../sharing/types.ts";
import { dirtyKey, getMeta, setMeta } from "../store/meta.ts";
import {
  entryBytes,
  type PushItemShape,
  type PushResultShape,
  parseEntryUid,
} from "../team/contract.ts";
import { SyncClient } from "./client.ts";
import { projectByAlias } from "./conflicts.ts";
import type { SyncContext } from "./context.ts";
import {
  authorisedUids,
  consumeAuthorised,
  liveSentRows,
  markWithdrawn,
  moveSent,
  purgedKey,
  refusalFor,
  retireMoved,
  type SentRow,
  sentRow,
  sentRowByUuid,
  setHold,
  writeRefusal,
  writeSent,
} from "./ledger.ts";
import { logError } from "./log.ts";
import { readTokens, type ServerRow } from "./servers.ts";
import { failureAnswer, readHold, recordAnswer, updateState } from "./state.ts";

/** A batch: at most this many items, and this many bytes of the serialized body (under the server's 1 MiB). */
export const BATCH_ITEMS = 200;
export const BATCH_BYTES = 900 * 1024;
/** One item's serialized size may not pass the server's per-item limit (D-15). */
export const ITEM_MAX_BYTES = ENTRY_MAX_BYTES;
/** `ensureFresh` over at most this many repositories per sixty-second sweep. */
export const REFRESH_PER_SWEEP = 3;
/** The server's applied-payload limit per hour, in bytes per millisecond: what a `rate` waits for. */
const RATE_BYTES_PER_MS = (64 * 1024 * 1024) / 3_600_000;
const RATE_MIN_WAIT_MS = 5_000;
const STORAGE_WAIT_MS = 10 * 60_000;
/** D-10: a sweep that would withdraw more than this, or more than half of the sent rows, unexplained, holds. */
export const BULK_ITEMS = 20;

export interface SweepResult {
  sent: number;
  withdrawn: number;
  refused: number;
  /** Withdrawals held under D-10 this sweep. */
  held: number;
  dirty: number;
  stopped: "closed" | "epoch" | "rate" | "storage" | "failure" | "token" | null;
}

const NONE: SweepResult = { sent: 0, withdrawn: 0, refused: 0, held: 0, dirty: 0, stopped: null };

/** A candidate with everything a push needs. */
interface Outgoing {
  item: Item;
  payload: OutgoingEntry | OutgoingMemory;
  /** The hash of what leaves: an entry's redacted bytes, a memory's `memoryHash`. */
  hash: string;
  /** The index hash of the file (an entry) or the `memoryHash` (a memory): `local_hash`. */
  localHash: string;
  base: { revision: number; hash: string };
  /** The old uid when the entry moved (its uuid has a sent row under another uid). */
  movedFrom: string | null;
  live: boolean;
  bytes: number;
  /** Re-sent once on the server's `current` after a rollback; never a third time in one sweep. */
  retried?: boolean;
}

/** The sent-row heads each server last saw per repository: a quiet tick compares nothing. */
const seenHeads = new Map<string, Map<number, string | null>>();
/** Where the rotation of `ensureFresh` stands per server. */
const refreshCursor = new Map<string, number>();

/** The alias of a project entry's uid, by the one parser of the uid grammar; null for any other uid. */
const projectOf = (uid: string): string | null => parseEntryUid(uid)?.remoteAlias ?? null;

// --- The repositories -----------------------------------------------------------------------------

/** The ledger's records by uid, as `ledgerRecords` returns them. */
type Ledger = ReturnType<typeof ledgerRecords>;

interface Repos {
  store: KnowledgeStore;
  /** By repo id: the repositories that could be opened. */
  byId: Map<number, Repo>;
  /** By `${scope}:${projectId}`. */
  byRef: Map<string, Repo>;
  /** `${repo id}:${path}` of every uncommitted path. */
  dirty: Set<string>;
}

const refKey = (scope: string, projectId: number) => `${scope}:${projectId}`;

/** The repositories the server's policy can release entries from, opened; a refused one is left out. */
function openRepos(
  ctx: SyncContext,
  policy: SharingPolicy,
  serverId: string,
  refresh: number,
): Repos {
  const store = openStore({
    db: ctx.db,
    dataDir: ctx.dataDir,
    env: ctx.env,
    now: () => ctx.clock.now,
  });
  const refs: ScopeRef[] = [];
  if (policy.roots.has("workspace")) refs.push({ scope: "workspace" });
  if (policy.roots.has("shared")) refs.push({ scope: "shared" });
  for (const row of policy.levels.values()) {
    if (row.destination === serverId && row.level !== "local")
      refs.push({ scope: "project", projectId: row.projectId });
  }
  const byId = new Map<number, Repo>();
  const byRef = new Map<string, Repo>();
  const dirty = new Set<string>();
  const opened: Repo[] = [];
  for (const ref of refs) {
    try {
      const repo = openRepo(store, ref);
      if (repo === null) continue;
      opened.push(repo);
      byId.set(repo.id, repo);
      byRef.set(refKey(ref.scope, ref.scope === "project" ? ref.projectId : 0), repo);
    } catch (error) {
      logError(ctx, serverId, "repo", error);
    }
  }
  if (refresh > 0 && opened.length > 0) {
    // At most three per full sweep, in rotation, so a committed edit made outside the store is
    // seen within a minute without every sweep reading every repository; a preview refreshes
    // them all, so it tells the truth after a restore, whose index is older than the disk.
    const start = refreshCursor.get(serverId) ?? 0;
    const count = Math.min(refresh, opened.length);
    for (let i = 0; i < count; i++) {
      const repo = opened[(start + i) % opened.length] as Repo;
      try {
        withRepoLeases(store, [repo.relative], () => ensureFresh(store, repo));
      } catch (error) {
        if (!(error instanceof KnowledgeError && error.code === "locked"))
          logError(ctx, serverId, "refresh", error);
      }
    }
    refreshCursor.set(serverId, (start + count) % opened.length);
  }
  return { store, byId, byRef, dirty };
}

/** The uncommitted paths under `entries/` of every opened repository, `${repo id}:${path}`. */
function dirtyPaths(ctx: SyncContext, serverId: string, repos: Repos): Set<string> {
  const dirty = new Set<string>();
  for (const repo of repos.byId.values()) {
    try {
      for (const line of statusOf(repos.store, repo, [ENTRIES_DIR]))
        dirty.add(`${repo.id}:${line.slice(3)}`);
    } catch (error) {
      logError(ctx, serverId, "status", error);
    }
  }
  return dirty;
}

// --- The payloads ---------------------------------------------------------------------------------

/** The file split at the end of its frontmatter block, the `pinned` line removed, both redacted. */
export function entryPayloadOf(
  ctx: SyncContext,
  item: EntryItem,
  slug: string,
  text: string,
): { payload: OutgoingEntry; hash: string } | null {
  const split = splitFrontmatterLines(text);
  if (split === null) return null;
  const frontmatter = redactForSend(
    `${[split.open, ...split.front, split.close].join("\n")}\n`,
    ctx.env,
  );
  const body = redactForSend(split.body.join("\n"), ctx.env);
  const payload: OutgoingEntry = {
    kind: "entry",
    uid: item.uid,
    scope: item.scope,
    slug,
    remoteAlias: item.scope === "project" ? projectOf(item.uid) : null,
    frontmatter,
    body,
    version: item.version,
    hash: "",
  };
  payload.hash = hashOf(entryBytes(payload));
  return { payload, hash: payload.hash };
}

interface MemoryText {
  id: number;
  kind: string;
  importance: number;
  status: string;
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}

function memoryTexts(ctx: SyncContext, ids: number[]): Map<number, MemoryText> {
  if (ids.length === 0) return new Map();
  return new Map(
    ctx.db
      .query<MemoryText, [string]>(
        `SELECT id, kind, importance, status, title, body, created_at, updated_at FROM memories
          WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(ids))
      .map((row) => [row.id, row]),
  );
}

function memoryPayloadOf(
  ctx: SyncContext,
  uid: string,
  remoteAlias: string,
  row: MemoryText,
): { payload: OutgoingMemory; hash: string } {
  const fields = {
    memoryKind: row.kind,
    importance: row.importance,
    status: row.status,
    title: redactForSend(row.title, ctx.env),
    body: redactForSend(row.body, ctx.env),
  };
  const hash = memoryHash(fields);
  return {
    payload: {
      kind: "memory",
      uid,
      remoteAlias,
      ...fields,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.updated_at,
      hash,
    },
    hash,
  };
}

const sizeOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

// --- The sweep ------------------------------------------------------------------------------------

/**
 * One sweep of a confirmed, not stopped server: the policy re-read, the candidates (every
 * entry and memory on a sixty-second sweep; on a tick, only what changed), `decide`, the
 * payloads, the batches, the answers, and, on a sixty-second sweep, the withdrawals.
 */
export async function sweep(
  ctx: SyncContext,
  server: ServerRow,
  options: { full: boolean },
): Promise<SweepResult> {
  const serverId = server.serverId;
  const now = () => ctx.clock.now;
  const readStart = now();
  if (server.retryAt !== null && server.retryAt > readStart) return NONE;
  const token = readTokens(ctx.dataDir)[serverId];
  if (token === undefined) return { ...NONE, stopped: "token" };
  const policy = policyInForce(ctx.db, ctx.dataDir, ctx.env, readStart, serverId);
  if (policy.closed) return { ...NONE, stopped: "closed" };
  const generation = generationOf(ctx.db);
  if (generation === null) return NONE;
  const client = new SyncClient(ctx, { url: server.url, token });
  const result: SweepResult = { ...NONE };

  const repos = openRepos(ctx, policy, serverId, options.full ? REFRESH_PER_SWEEP : 0);

  // The epoch or the generation moved since the last sweep: every memory is a candidate.
  const everything =
    options.full ||
    server.lastSweepEpoch !== policy.epoch ||
    server.lastSweepGeneration !== generation;

  // Entries: all of them, compared against the ledger; on a tick only when a repository's head
  // moved since the last look, so a quiet tick reads no entry row.
  const heads = new Map(
    ctx.db
      .query<{ id: number; head: string | null }, []>("SELECT id, head FROM knowledge_repos")
      .all()
      .map((row) => [row.id, row.head]),
  );
  const seen = seenHeads.get(serverId) ?? new Map<number, string | null>();
  const changedRepos = new Set(
    [...heads].filter(([id, head]) => seen.get(id) !== head).map(([id]) => id),
  );
  seenHeads.set(serverId, heads);
  const entriesWanted = everything || changedRepos.size > 0;
  // The working trees are asked only when an entry could leave: a quiet tick spawns no git and
  // keeps the dirty count of the last sweep that looked.
  if (entriesWanted) {
    repos.dirty = dirtyPaths(ctx, serverId, repos);
    setMeta(ctx.db, dirtyKey(serverId), String(repos.dirty.size));
    result.dirty = repos.dirty.size;
  } else {
    result.dirty = Number(getMeta(ctx.db, dirtyKey(serverId)) ?? 0);
  }
  const entries: EntryItem[] = entriesWanted ? entryItems(ctx.db, undefined, serverId) : [];
  // The ledger is read only against candidates: a quiet tick reads no ledger row.
  const entryLedger: Ledger =
    entries.length === 0 ? new Map() : ledgerRecords(ctx.db, serverId, "entry");

  // Memories: by `updated_at` since the previous read's start, or by id above the highest id it saw.
  const projectsAtAll = [...policy.projects].filter(
    (id) => levelOf(policy, id, serverId).level === "all",
  );
  // On a tick, the window: the rows changed since the previous read's start, or inserted above
  // the highest id it saw, through the indexes; a quiet tick reads no memory row.
  const memories =
    projectsAtAll.length === 0
      ? []
      : memoryItems(
          ctx.db,
          policy,
          generation,
          undefined,
          serverId,
          everything
            ? undefined
            : { updatedSince: server.lastSweepAt ?? 0, idAbove: server.lastSweepMaxId },
        );
  let maxMemoryId = server.lastSweepMaxId;
  for (const memory of memories) maxMemoryId = Math.max(maxMemoryId, memory.id);
  const memoryLedger: Ledger =
    memories.length === 0 ? new Map() : ledgerRecords(ctx.db, serverId, "memory");
  withHashes(ctx.db, ctx.env, memories, new Set(memories.map((memory) => memory.uid)));

  // What `decide` sends, with its payload and base.
  const outgoing: Outgoing[] = [];
  const entryByUid = new Map(entries.map((entry) => [entry.uid, entry]));
  const slugs = new Map(
    entries.length === 0
      ? []
      : ctx.db
          .query<{ id: string; repo_id: number; slug: string; path: string }, []>(
            "SELECT id, repo_id, slug, path FROM knowledge_entries",
          )
          .all()
          .map((row) => [`${row.repo_id}:${row.id}`, row]),
  );
  for (const entry of entries) {
    const records = entryLedger.get(entry.uid) ?? [];
    const ruling = decide(policy, serverId, entry, records);
    if (ruling.answer !== "send") continue;
    const repo = repos.byRef.get(refKey(entry.scope, entry.projectId));
    if (repo === undefined) continue;
    const indexed = slugs.get(`${repo.id}:${parseEntryUid(entry.uid)?.uuid}`);
    if (indexed === undefined) continue;
    if (repos.dirty.has(`${repo.id}:${indexed.path}`)) continue;
    const bytes = readRegularFile(join(repo.path, ...indexed.path.split("/")));
    if (bytes === null) continue;
    const built = entryPayloadOf(ctx, entry, indexed.slug, new TextDecoder().decode(bytes));
    if (built === null) continue;
    const refusal = refusalFor(ctx.db, serverId, "entry", entry.uid, built.hash);
    if (refusal !== null) continue;
    const own = sentRow(ctx.db, serverId, "entry", entry.uid);
    const moved = own === null ? sentRowByUuid(ctx.db, serverId, indexed.id) : null;
    const base = own ?? moved;
    outgoing.push({
      item: entry,
      payload: built.payload,
      hash: built.hash,
      localHash: entry.hash,
      base: base === null ? { revision: 0, hash: "" } : { revision: base.version, hash: base.hash },
      movedFrom: moved?.itemUid ?? null,
      live: own === null || changedRepos.has(repo.id),
      bytes: sizeOf({
        op: "send",
        kind: "entry",
        uid: entry.uid,
        baseRevision: 0,
        baseHash: "",
        payload: built.payload,
      }),
    });
  }
  const texts = memoryTexts(
    ctx,
    memories
      .filter(
        (memory) =>
          decide(policy, serverId, memory, memoryLedger.get(memory.uid) ?? []).answer === "send",
      )
      .map((memory) => memory.id),
  );
  for (const memory of memories) {
    const row = texts.get(memory.id);
    if (row === undefined) continue;
    const alias = policy.levels.get(levelKey(memory.projectId, serverId))?.boundAlias;
    if (alias === undefined || alias === "") continue;
    const built = memoryPayloadOf(ctx, memory.uid, alias, row);
    if (refusalFor(ctx.db, serverId, "memory", memory.uid, built.hash) !== null) continue;
    const own = sentRow(ctx.db, serverId, "memory", memory.uid);
    outgoing.push({
      item: memory,
      payload: built.payload,
      hash: built.hash,
      localHash: built.hash,
      base: own === null ? { revision: 0, hash: "" } : { revision: own.version, hash: own.hash },
      movedFrom: null,
      live: row.updated_at >= (server.lastSweepAt ?? 0),
      bytes: sizeOf({
        op: "send",
        kind: "memory",
        uid: memory.uid,
        baseRevision: 0,
        baseHash: "",
        payload: built.payload,
      }),
    });
  }
  // Live changes before the backlog.
  outgoing.sort((a, b) => Number(b.live) - Number(a.live));

  // The items over the per-item limit are refused here, once per hash.
  const sendable: Outgoing[] = [];
  for (const candidate of outgoing) {
    if (candidate.bytes > ITEM_MAX_BYTES) {
      writeRefusal(
        ctx,
        serverId,
        candidate.item.kind,
        candidate.item.uid,
        candidate.hash,
        "too-large",
        null,
        now(),
      );
      result.refused++;
      continue;
    }
    sendable.push(candidate);
  }

  let backlog = sendable.length;
  let stopped: SweepResult["stopped"] = null;
  const pushBatch = async (batch: Outgoing[]): Promise<boolean> => {
    if (batch.length === 0) return true;
    if (loadPolicy(ctx.db, ctx.dataDir, ctx.env, serverId).epoch !== policy.epoch) {
      stopped = "epoch";
      return false;
    }
    const items: PushItemShape[] = batch.map((candidate) => ({
      op: "send",
      kind: candidate.item.kind,
      uid: candidate.item.uid,
      baseRevision: candidate.base.revision,
      baseHash: candidate.base.hash,
      payload: candidate.payload,
    }));
    const answer = await client.push(items, policy.epoch);
    const at = now();
    if (!answer.ok) {
      if (answer.kind === "tooLarge" && batch.length > 1) {
        const half = Math.ceil(batch.length / 2);
        return (await pushBatch(batch.slice(0, half))) && (await pushBatch(batch.slice(half)));
      }
      if (answer.kind === "tooLarge") {
        const [only] = batch as [Outgoing];
        writeRefusal(
          ctx,
          serverId,
          only.item.kind,
          only.item.uid,
          only.hash,
          "too-large",
          null,
          at,
        );
        result.refused++;
        backlog--;
        return true;
      }
      recordAnswer(ctx, serverId, failureAnswer("push", answer, at));
      stopped = "failure";
      return false;
    }
    recordAnswer(ctx, serverId, { kind: "push", ok: true, at, requestId: answer.requestId });
    const bytesSent = sizeOf(items);
    const byUid = new Map(batch.map((candidate) => [candidate.item.uid, candidate]));
    const rollbacks: Outgoing[] = [];
    for (const line of answer.body.results) {
      const candidate = byUid.get(line.uid);
      if (candidate === undefined) continue;
      backlog--;
      const outcome = applyAnswer(
        ctx,
        serverId,
        server.instance,
        policy.epoch,
        candidate,
        line,
        at,
        bytesSent,
      );
      if (outcome === "sent") result.sent++;
      else if (outcome === "refused") result.refused++;
      else if (typeof outcome === "object" && outcome !== null) {
        // A server rollback: re-sent on `current`, once.
        if (candidate.retried !== true) {
          rollbacks.push({ ...candidate, base: outcome.current, retried: true });
          backlog++;
        }
      } else if (outcome !== null) {
        stopped = outcome;
        return false;
      }
    }
    return rollbacks.length === 0 ? true : pushBatch(rollbacks);
  };

  // Batches cut on the serialized body.
  let batch: Outgoing[] = [];
  let bytes = 0;
  for (const candidate of sendable) {
    if (
      batch.length > 0 &&
      (batch.length >= BATCH_ITEMS || bytes + candidate.bytes > BATCH_BYTES)
    ) {
      if (!(await pushBatch(batch))) break;
      batch = [];
      bytes = 0;
    }
    batch.push(candidate);
    bytes += candidate.bytes;
  }
  // The last batch; a stop is what pushBatch sets.
  if (stopped === null) await pushBatch(batch);

  if (options.full && stopped === null) {
    const withdrawn = await withdrawSweep(ctx, server, client, policy, repos, entryByUid, memories);
    result.withdrawn = withdrawn.withdrawn;
    result.held = withdrawn.held;
    if (withdrawn.stopped !== null) stopped = withdrawn.stopped;
  }

  updateState(ctx, serverId, {
    lastSweepAt: readStart,
    lastSweepMaxId: maxMemoryId,
    lastSweepEpoch: policy.epoch,
    lastSweepGeneration: generation,
    backlog: Math.max(0, backlog),
  });
  result.stopped = stopped;
  return result;
}

/** One answer line applied to the ledger. Null when the sweep goes on; a stop otherwise. */
function applyAnswer(
  ctx: SyncContext,
  serverId: string,
  instance: string,
  epoch: number,
  candidate: Outgoing,
  line: PushResultShape,
  at: number,
  bytesSent: number,
):
  | "sent"
  | "refused"
  | "rate"
  | "storage"
  | { current: { revision: number; hash: string } }
  | null {
  const kind = candidate.item.kind;
  const uid = candidate.item.uid;
  if (line.result === "applied") {
    writeSent(ctx, serverId, kind, uid, {
      revision: line.revision ?? candidate.base.revision + 1,
      hash: line.hash ?? candidate.hash,
      localHash: candidate.localHash,
      instance,
      epoch,
      at,
    });
    if (candidate.movedFrom !== null) retireMoved(ctx, serverId, candidate.movedFrom, at);
    return "sent";
  }
  if (line.result === "stale") {
    if (line.appliedAs !== undefined) {
      writeSent(ctx, serverId, kind, uid, {
        revision: line.appliedAs,
        hash: candidate.hash,
        localHash: candidate.localHash,
        instance,
        epoch,
        at,
      });
      return "sent";
    }
    const current = line.current ?? { revision: 0, hash: "" };
    if (kind === "memory") {
      // The server holds a later copy: recorded as sent, the local hash kept, so the next sweep
      // sends nothing until the memory changes here.
      writeSent(ctx, serverId, kind, uid, {
        revision: current.revision,
        hash: current.hash,
        localHash: candidate.localHash,
        instance,
        epoch,
        at,
      });
      return "sent";
    }
    const own = sentRow(ctx.db, serverId, "entry", uid);
    const rollback =
      own === null ||
      current.revision < own.version ||
      (own.instance !== "" && own.instance !== instance);
    if (rollback) {
      // A server rollback: the ledger takes `current`, and the item is re-sent on it.
      if (own !== null)
        moveSent(ctx, serverId, uid, {
          revision: current.revision,
          hash: current.hash,
          localHash: own.localHash,
          instance,
        });
      else
        writeSent(ctx, serverId, kind, uid, {
          revision: current.revision,
          hash: current.hash,
          localHash: "",
          instance,
          epoch,
          at,
        });
      return { current };
    }
    // A teammate's revision: the pull brings it and the inbound side applies it (conflicts.ts).
    return null;
  }
  if (line.result === "withdrawn") {
    markWithdrawn(ctx, serverId, kind, uid, at, "withdrawn");
    return null;
  }
  const reason = line.reason ?? "unknown";
  if (reason === "rate") {
    updateState(ctx, serverId, {
      retryAt: at + Math.max(RATE_MIN_WAIT_MS, bytesSent / RATE_BYTES_PER_MS),
    });
    return "rate";
  }
  if (reason === "storage") {
    updateState(ctx, serverId, { retryAt: at + STORAGE_WAIT_MS });
    return "storage";
  }
  if (reason === "purged") {
    purgedKey(ctx, serverId, kind, uid, at);
    return "refused";
  }
  writeRefusal(ctx, serverId, kind, uid, candidate.hash, reason, line.rule ?? null, at);
  return "refused";
}

// --- The withdrawals (D-10) -------------------------------------------------------------------------

export interface Withdrawal {
  row: SentRow;
  projectId: number | null;
  /** A `cli` or `viewer` change after the sent row explains it: the person narrowed the policy. */
  explained: boolean;
}

/** Whether a person's own narrowing, logged after the row was sent, explains a withdrawal. */
function explainedBy(
  ctx: SyncContext,
  serverId: string,
  row: SentRow,
  projectId: number | null,
): boolean {
  const whats = [`roots@${serverId}`, `areas@${serverId}`, "roots", "areas", `server:${serverId}`];
  if (projectId !== null) whats.push(`project:${projectId}@${serverId}`, `project:${projectId}`);
  return ownChangeAfter(ctx.db, row.at, whats);
}

/**
 * The not-withdrawn sent rows whose item is gone or no longer decides `send`: the withdrawals
 * the sixty-second sweep would make, with the first guard applied (an entry whose repository
 * is missing, refused or unindexed is never withdrawn) and each marked as explained or not.
 */
export function withdrawals(
  ctx: SyncContext,
  server: ServerRow,
  policy: SharingPolicy,
  repos: Repos,
  entryByUid: Map<string, EntryItem>,
  memoriesByUid: Map<string, Item>,
): Withdrawal[] {
  const serverId = server.serverId;
  const entryLedger = ledgerRecords(ctx.db, serverId, "entry");
  const memoryLedger = ledgerRecords(ctx.db, serverId, "memory");
  const found: Withdrawal[] = [];
  for (const row of liveSentRows(ctx.db, serverId)) {
    const alias = projectOf(row.itemUid);
    let projectId: number | null = null;
    if (row.itemKind === "entry") {
      const item = entryByUid.get(row.itemUid);
      if (item !== undefined) {
        projectId = item.scope === "project" ? item.projectId : null;
        const ruling = decide(policy, serverId, item, entryLedger.get(row.itemUid) ?? []);
        if (ruling.answer !== "withdraw") continue;
      } else {
        // Gone from the index: only a deletion inside a present, readable repository withdraws.
        const scope = parseEntryUid(row.itemUid)?.scope ?? "";
        projectId = scope === "project" && alias !== null ? projectByAlias(ctx, alias) : null;
        const repo = repos.byRef.get(refKey(scope, projectId ?? 0));
        if (repo === undefined) continue;
      }
      found.push({ row, projectId, explained: explainedBy(ctx, serverId, row, projectId) });
      continue;
    }
    const item = memoriesByUid.get(row.itemUid);
    projectId = item?.projectId ?? null;
    if (item !== undefined) {
      const ruling = decide(policy, serverId, item, memoryLedger.get(row.itemUid) ?? []);
      if (ruling.answer !== "withdraw") continue;
    }
    found.push({ row, projectId, explained: explainedBy(ctx, serverId, row, projectId) });
  }
  return found;
}

/**
 * One answer line of a withdraw applied to the ledger, as both the sweep and `remove --withdraw`
 * read it: `withdrawn` marks the row; `stale` moves it to the server's current base, to be
 * retried; a refusal that says the item is gone (`unknown`, `purged`, `withdrawn-by-admin`)
 * marks it with that reason; `rate` is the caller's to schedule; anything else changes nothing.
 */
function applyWithdrawLine(
  ctx: SyncContext,
  serverId: string,
  row: SentRow,
  line: PushResultShape,
  at: number,
): "withdrawn" | "stale" | "gone" | "rate" | "other" {
  if (line.result === "withdrawn") {
    markWithdrawn(ctx, serverId, row.itemKind, row.itemUid, at, "withdrawn");
    return "withdrawn";
  }
  if (line.result === "stale" && line.current !== undefined) {
    moveSent(ctx, serverId, row.itemUid, {
      revision: line.current.revision,
      hash: line.current.hash,
      localHash: row.localHash,
    });
    return "stale";
  }
  if (line.result !== "refused") return "other";
  if (line.reason === "rate") return "rate";
  if (
    line.reason === "unknown" ||
    line.reason === "purged" ||
    line.reason === "withdrawn-by-admin"
  ) {
    markWithdrawn(ctx, serverId, row.itemKind, row.itemUid, at, line.reason);
    return "gone";
  }
  return "other";
}

/** What `share server resume` shows: the withdrawals the next sweep would make, per project. */
export function wouldWithdraw(ctx: SyncContext, server: ServerRow): Withdrawal[] {
  const policy = loadPolicy(ctx.db, ctx.dataDir, ctx.env, server.serverId);
  if (policy.closed) return [];
  const generation = generationOf(ctx.db);
  const repos = openRepos(ctx, policy, server.serverId, Number.POSITIVE_INFINITY);
  const entries = new Map(
    entryItems(ctx.db, undefined, server.serverId).map((entry) => [entry.uid, entry]),
  );
  const memories: Item[] =
    generation === null ? [] : memoryItems(ctx.db, policy, generation, undefined, server.serverId);
  withHashes(
    ctx.db,
    ctx.env,
    memories as Parameters<typeof withHashes>[2],
    new Set(memories.map((m) => m.uid)),
  );
  return withdrawals(ctx, server, policy, repos, entries, new Map(memories.map((m) => [m.uid, m])));
}

async function withdrawSweep(
  ctx: SyncContext,
  server: ServerRow,
  client: SyncClient,
  policy: SharingPolicy,
  repos: Repos,
  entryByUid: Map<string, EntryItem>,
  memories: Item[],
): Promise<{ withdrawn: number; held: number; stopped: SweepResult["stopped"] }> {
  const serverId = server.serverId;
  const all = withdrawals(
    ctx,
    server,
    policy,
    repos,
    entryByUid,
    new Map(memories.map((m) => [m.uid, m])),
  );
  if (all.length === 0) return { withdrawn: 0, held: 0, stopped: null };
  const authorised = new Set(authorisedUids(ctx.db, serverId));
  const total = liveSentRows(ctx.db, serverId).length;
  const unexplained = all.filter((w) => !w.explained && !authorised.has(w.row.itemUid));
  let hold = readHold(ctx.db, serverId);
  if (hold === null && (unexplained.length > BULK_ITEMS || unexplained.length * 2 > total)) {
    hold = { reason: "bulk", at: ctx.clock.now, count: unexplained.length };
    setHold(ctx, serverId, hold.reason, hold.at, hold.count);
  }
  const allowed =
    hold === null ? all : all.filter((w) => w.explained || authorised.has(w.row.itemUid));
  const held = all.length - allowed.length;
  // The hold keeps its reason and time and says how many it holds now, for status and doctor.
  if (hold !== null && hold.count !== held) setHold(ctx, serverId, hold.reason, hold.at, held);
  let withdrawn = 0;
  for (let start = 0; start < allowed.length; start += BATCH_ITEMS) {
    const batch = allowed.slice(start, start + BATCH_ITEMS);
    const items: PushItemShape[] = batch.map((w) => ({
      op: "withdraw",
      kind: w.row.itemKind,
      uid: w.row.itemUid,
      baseRevision: w.row.version,
      baseHash: w.row.hash,
    }));
    const answer = await client.push(items, policy.epoch);
    const at = ctx.clock.now;
    if (!answer.ok) {
      recordAnswer(ctx, serverId, failureAnswer("push", answer, at));
      return { withdrawn, held, stopped: "failure" };
    }
    recordAnswer(ctx, serverId, { kind: "push", ok: true, at, requestId: answer.requestId });
    const byUid = new Map(batch.map((w) => [w.row.itemUid, w]));
    for (const line of answer.body.results) {
      const w = byUid.get(line.uid);
      if (w === undefined) continue;
      const outcome = applyWithdrawLine(ctx, serverId, w.row, line, at);
      if (outcome === "rate") {
        // The rest of the set stays authorised: the next sweep finishes it.
        updateState(ctx, serverId, { retryAt: at + RATE_MIN_WAIT_MS });
        return { withdrawn, held, stopped: "rate" };
      }
      if (outcome === "withdrawn") withdrawn++;
      if ((outcome === "withdrawn" || outcome === "gone") && authorised.has(w.row.itemUid))
        consumeAuthorised(ctx, serverId, w.row.itemUid);
    }
  }
  return { withdrawn, held, stopped: null };
}

/**
 * `share server remove --withdraw`: a `withdraw` for every not-withdrawn sent row of the
 * server, a `stale` one retried once on the server's `current` base (the person's intent is
 * explicit). `left` counts what could not be withdrawn; the token is still valid, since the
 * removal happens after this.
 */
export async function withdrawAll(
  ctx: SyncContext,
  server: ServerRow,
): Promise<{ ok: boolean; left: number }> {
  const token = readTokens(ctx.dataDir)[server.serverId];
  if (token === undefined) return { ok: false, left: liveSentRows(ctx.db, server.serverId).length };
  const client = new SyncClient(ctx, { url: server.url, token });
  const epoch = loadPolicy(ctx.db, ctx.dataDir, ctx.env, server.serverId).epoch;
  let rows = liveSentRows(ctx.db, server.serverId);
  for (let round = 0; round < 2 && rows.length > 0; round++) {
    const stale: SentRow[] = [];
    for (let start = 0; start < rows.length; start += BATCH_ITEMS) {
      const batch = rows.slice(start, start + BATCH_ITEMS);
      const answer = await client.push(
        batch.map((row) => ({
          op: "withdraw" as const,
          kind: row.itemKind,
          uid: row.itemUid,
          baseRevision: row.version,
          baseHash: row.hash,
        })),
        epoch,
      );
      const at = ctx.clock.now;
      if (!answer.ok) {
        recordAnswer(ctx, server.serverId, failureAnswer("push", answer, at));
        return { ok: false, left: liveSentRows(ctx.db, server.serverId).length };
      }
      recordAnswer(ctx, server.serverId, {
        kind: "push",
        ok: true,
        at,
        requestId: answer.requestId,
      });
      const byUid = new Map(batch.map((row) => [row.itemUid, row]));
      for (const line of answer.body.results) {
        const row = byUid.get(line.uid);
        if (row === undefined) continue;
        if (applyWithdrawLine(ctx, server.serverId, row, line, at) === "stale") {
          const moved = sentRow(ctx.db, server.serverId, row.itemKind, row.itemUid);
          if (moved !== null) stale.push(moved);
        }
      }
    }
    rows = stale;
  }
  const left = liveSentRows(ctx.db, server.serverId).length;
  return { ok: left === 0, left };
}
