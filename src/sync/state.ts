// The per-server state: the cursors, the breaker, the last answers, and the report `status`,
// `doctor` and the viewer read. Every write of the loop goes through `guarded`, which refuses
// once the sync lease is no longer the process's own (the spec's rule 3).
import { isSharedName, NAME_PREFIX } from "../core/identity.ts";
import { redact } from "../core/redact.ts";
import { boundAliasesOf } from "../sharing/levels.ts";
import { NAME_STATES, type NameState, nameFlagKey } from "../sharing/types.ts";
import { type Db, withWrite } from "../store/db.ts";
import {
  failedStartBackoffMs,
  getMeta,
  leaseOwned,
  parseLease,
  processAlive,
  readFailedStart,
  readSyncStop,
  restoreHoldKey,
  SYNC_LEASE,
  setMeta,
} from "../store/meta.ts";
import type { ClientFailed } from "./client.ts";
import type { SyncContext } from "./context.ts";
import {
  type Cursors,
  hasServerTables,
  hostOf,
  listServers,
  parseCursors,
  readTokens,
  type ServerRow,
  STOPPED_REMEDIES,
  type Stopped,
} from "./servers.ts";

/** The lease is no longer ours: the process writes nothing more and exits. */
export class LeaseLost extends Error {
  constructor() {
    super("the sync lease is no longer ours");
    this.name = "LeaseLost";
  }
}

/**
 * One write transaction that first checks the lease is still the context's (when the context
 * holds one). A command that holds no lease (`share server …`) writes unguarded.
 */
export function guarded<T>(ctx: SyncContext, fn: () => T): T {
  return withWrite(ctx.db, () => {
    if (ctx.lease !== undefined && !leaseOwned(ctx.db, SYNC_LEASE, ctx.lease))
      throw new LeaseLost();
    return fn();
  });
}

// --- The cursors ------------------------------------------------------------------------------

export function cursorsOf(db: Db, serverId: string): Cursors {
  const row = db
    .query<{ cursors: string }, [string]>("SELECT cursors FROM sharing_servers WHERE server_id = ?")
    .get(serverId);
  return parseCursors(row?.cursors ?? "{}");
}

function writeCursors(db: Db, serverId: string, cursors: Cursors): void {
  db.run("UPDATE sharing_servers SET cursors = ? WHERE server_id = ?", [
    JSON.stringify(cursors),
    serverId,
  ]);
}

/** Which cursor: the main pull's, or the one of an alias past the main set. */
export type CursorRef = "main" | { extra: string };

/** Saves a cursor, keeping the larger of the stored and the new value: it never moves back. */
export function setCursor(
  ctx: SyncContext,
  serverId: string,
  which: CursorRef,
  value: number,
): void {
  guarded(ctx, () => {
    const cursors = cursorsOf(ctx.db, serverId);
    if (which === "main") cursors.main = Math.max(cursors.main, value);
    else cursors.extra[which.extra] = Math.max(cursors.extra[which.extra] ?? 0, value);
    writeCursors(ctx.db, serverId, cursors);
  });
}

/** Changes the cursors as a whole (the main set, an alias dropped); the cursors keep their floor. */
export function updateCursors(
  ctx: SyncContext,
  serverId: string,
  change: (cursors: Cursors) => Cursors,
): Cursors {
  return guarded(ctx, () => {
    const before = cursorsOf(ctx.db, serverId);
    const after = change(structuredClone(before));
    after.main = Math.max(after.main, before.main);
    for (const [alias, cursor] of Object.entries(after.extra))
      after.extra[alias] = Math.max(cursor, before.extra[alias] ?? 0);
    writeCursors(ctx.db, serverId, after);
    return after;
  });
}

// --- The state columns --------------------------------------------------------------------------

export interface StatePatch {
  snapshotDue?: boolean;
  lastSweepAt?: number | null;
  lastSweepMaxId?: number;
  lastSweepEpoch?: number | null;
  lastSweepGeneration?: string | null;
  backlog?: number;
  retryAt?: number | null;
  failures?: number;
  lastError?: string | null;
  lastErrorAt?: number | null;
  lastRequestId?: string | null;
  lastPushAt?: number | null;
  lastPushOkAt?: number | null;
  lastPullAt?: number | null;
  lastPullOkAt?: number | null;
  roots?: string;
  areas?: string;
}

const PATCH_COLUMNS: Readonly<Record<keyof StatePatch, string>> = {
  snapshotDue: "snapshot_due",
  lastSweepAt: "last_sweep_at",
  lastSweepMaxId: "last_sweep_max_id",
  lastSweepEpoch: "last_sweep_epoch",
  lastSweepGeneration: "last_sweep_generation",
  backlog: "backlog",
  retryAt: "retry_at",
  failures: "failures",
  lastError: "last_error",
  lastErrorAt: "last_error_at",
  lastRequestId: "last_request_id",
  lastPushAt: "last_push_at",
  lastPushOkAt: "last_push_ok_at",
  lastPullAt: "last_pull_at",
  lastPullOkAt: "last_pull_ok_at",
  roots: "roots",
  areas: "areas",
};

function writePatch(db: Db, serverId: string, patch: StatePatch): void {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const key of Object.keys(PATCH_COLUMNS) as (keyof StatePatch)[]) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(`${PATCH_COLUMNS[key]} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (sets.length === 0) return;
  values.push(serverId);
  db.run(`UPDATE sharing_servers SET ${sets.join(", ")} WHERE server_id = ?`, values);
}

/** A guarded write of state columns; `last_error` goes through `redact`. */
export function updateState(ctx: SyncContext, serverId: string, patch: StatePatch): void {
  guarded(ctx, () => {
    writePatch(ctx.db, serverId, {
      ...patch,
      ...(typeof patch.lastError === "string" ? { lastError: redact(patch.lastError) } : {}),
    });
  });
}

// --- The breaker ----------------------------------------------------------------------------------

/** The first interval after a failure; it doubles per failure up to the cap. */
export const BACKOFF_MIN_MS = 2_000;
export const BACKOFF_MAX_MS = 10 * 60_000;
/** The jitter added to an interval: up to a fifth of it. */
const JITTER = 0.2;

/** The wait after the n-th consecutive failure: 2 s doubling, with jitter, capped at ten minutes. */
export function backoffMs(failures: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MIN_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS);
  return Math.min(Math.floor(base * (1 + random() * JITTER)), BACKOFF_MAX_MS);
}

export type Answer = {
  kind: "push" | "pull";
  at: number;
  requestId?: string;
} & (
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** A 429's `Retry-After`: waited as given, and no failure for the breaker. */
      retryAfterMs?: number;
    }
);

/**
 * A failed request as `recordAnswer` takes it: the failure's kind and its error when it has
 * one, a rate limit's wait, and the request id when the server gave one. The one conversion
 * the push and the pull make.
 */
export function failureAnswer(kind: Answer["kind"], failure: ClientFailed, at: number): Answer {
  return {
    kind,
    ok: false,
    at,
    error: `${failure.kind}${"error" in failure ? `: ${failure.error}` : ""}`,
    ...(failure.kind === "rate" ? { retryAfterMs: failure.retryAfterMs } : {}),
    ...(failure.requestId === null ? {} : { requestId: failure.requestId }),
  };
}

/**
 * Records a server's answer: a success clears the breaker; a failure counts, stores the error
 * redacted and sets `retry_at` by the backoff, or by `Retry-After` when the server named one.
 */
export function recordAnswer(ctx: SyncContext, serverId: string, answer: Answer): void {
  guarded(ctx, () => {
    const attempt = answer.kind === "push" ? "lastPushAt" : "lastPullAt";
    const success = answer.kind === "push" ? "lastPushOkAt" : "lastPullOkAt";
    const requestId = answer.requestId === undefined ? {} : { lastRequestId: answer.requestId };
    if (answer.ok) {
      writePatch(ctx.db, serverId, {
        [attempt]: answer.at,
        [success]: answer.at,
        failures: 0,
        retryAt: null,
        lastError: null,
        lastErrorAt: null,
        ...requestId,
      });
      return;
    }
    const row = ctx.db
      .query<{ failures: number }, [string]>(
        "SELECT failures FROM sharing_servers WHERE server_id = ?",
      )
      .get(serverId);
    const failures = row?.failures ?? 0;
    const counted = answer.retryAfterMs === undefined ? failures + 1 : failures;
    writePatch(ctx.db, serverId, {
      [attempt]: answer.at,
      failures: counted,
      retryAt:
        answer.retryAfterMs === undefined
          ? answer.at + backoffMs(counted)
          : answer.at + answer.retryAfterMs,
      lastError: redact(answer.error),
      lastErrorAt: answer.at,
      ...requestId,
    });
  });
}

// --- The flags of a shared name (ADR 0028) ----------------------------------------------------------

export { NAME_STATES, type NameState, nameFlagKey };

/** What a flag holds: when it was written, and what the sync knew (an id, a member). */
export interface NameFlag {
  at: number;
  id?: string;
  member?: { id: string; name: string };
}

/** Writes one flag of a name, as the sync's guarded write; a flag already there is replaced. */
export function flagName(
  ctx: SyncContext,
  serverId: string,
  alias: string,
  state: NameState,
  detail: Omit<NameFlag, "at"> = {},
): void {
  guarded(ctx, () => {
    setMeta(
      ctx.db,
      nameFlagKey(state, serverId, alias),
      JSON.stringify({ at: ctx.clock.now, ...detail }),
    );
  });
}

/** Clears one flag of a name, or all three. */
export function clearName(
  ctx: SyncContext,
  serverId: string,
  alias: string,
  state?: NameState,
): void {
  guarded(ctx, () => {
    for (const each of state === undefined ? NAME_STATES : [state]) {
      ctx.db.run("DELETE FROM meta WHERE key = ?", [nameFlagKey(each, serverId, alias)]);
    }
  });
}

/** One flag as stored; null when it is not set or cannot be read. */
export function nameFlag(
  db: Db,
  serverId: string,
  alias: string,
  state: NameState,
): NameFlag | null {
  const raw = getMeta(db, nameFlagKey(state, serverId, alias));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NameFlag>;
    return typeof parsed.at === "number" ? { ...parsed, at: parsed.at } : { at: 0 };
  } catch {
    return { at: 0 };
  }
}

/** The one state a name reads as, when it carries several flags: purged, then re-created, then missing. */
const STATE_ORDER: readonly NameState[] = ["purged", "recreated", "missing"];

/** The flagged names of a server, each with the state it reads as. */
export function flaggedNames(db: Db, serverId: string): Map<string, NameState> {
  const found = new Map<string, NameState>();
  for (const state of [...STATE_ORDER].reverse()) {
    const prefix = nameFlagKey(state, serverId, "");
    const rows = db
      .query<{ key: string }, [number, string]>("SELECT key FROM meta WHERE substr(key, 1, ?) = ?")
      .all(prefix.length, prefix)
      .map((row) => row.key.slice(prefix.length));
    // Written in the reverse of the order, so the state that wins is set last.
    for (const alias of rows) found.set(alias, state);
  }
  return found;
}

/** The state a name reads as for a server, or null when none of its flags is set. */
export function nameStateOf(db: Db, serverId: string, alias: string): NameState | null {
  for (const state of STATE_ORDER) {
    if (getMeta(db, nameFlagKey(state, serverId, alias)) !== null) return state;
  }
  return null;
}

// --- The report ------------------------------------------------------------------------------------

/** The server rows as `status`, `doctor` and the viewer read them. */
export function serverRows(db: Db): ServerRow[] {
  return listServers(db);
}

export type ServerState = "pending" | "token missing" | "ok" | "stopped";

export interface WithdrawalHold {
  reason: "restore" | "bulk";
  at: number;
  /** The withdrawals the last sweep held; 0 until a sweep looked. */
  count: number;
}

/** One shared name bound to a server, as `status`, `doctor` and the viewer read it (ADR 0028). */
export interface NameStatus {
  alias: string;
  slug: string;
  /** Received under the name: the entries, the memories, the distinct members, the latest time. */
  entries: number;
  memories: number;
  members: number;
  lastAt: number | null;
  /** `ok`, or the one flag the name reads as (`nameStateOf`). */
  state: "ok" | NameState;
  /** Who re-created the name on the server, when the flag says so. */
  recreatedBy: string | null;
}

export interface ServerStatus {
  serverId: string;
  name: string;
  host: string;
  url: string;
  member: string;
  memberId: string;
  role: string;
  contract: number;
  state: ServerState;
  stopped: Stopped | null;
  /** What the person does next, when the state asks for something. */
  remedy: string | null;
  /** The cursors' sum: the main pull's and every extra alias's. */
  cursor: number;
  snapshotDue: boolean;
  lastSweepAt: number | null;
  lastPushAt: number | null;
  lastPushOkAt: number | null;
  lastPullAt: number | null;
  lastPullOkAt: number | null;
  backlog: number;
  /** Uncommitted paths the last sweep counted; the outbound side fills it. */
  dirtyPaths: number;
  /** Rows set aside after ten failed applies; the ledger fills it. */
  pendingRows: number;
  openConflicts: number;
  hold: WithdrawalHold | null;
  failures: number;
  retryAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  muted: boolean;
  /** The shared names bound to the server by enabled projects, with what was received under each. */
  names: NameStatus[];
  /** The row speaks 1 while a shared name is bound: nothing of those projects moves (ADR 0028). */
  namesHeld: boolean;
}

/** The per-server counts the ledger gives (`ledger.ts`), beside the row's own columns. */
export interface ServerCounts {
  dirtyPaths: number;
  pendingRows: number;
  openConflicts: number;
}

export type CountsOf = (db: Db, serverId: string) => ServerCounts;

const NO_COUNTS: CountsOf = () => ({ dirtyPaths: 0, pendingRows: 0, openConflicts: 0 });

/** What was received under one name, as the ledger counts it (`receivedNameCounts`). */
export type NamesOf = (
  db: Db,
  serverId: string,
  alias: string,
) => Pick<NameStatus, "entries" | "memories" | "members" | "lastAt">;

const NO_NAMES: NamesOf = () => ({ entries: 0, memories: 0, members: 0, lastAt: null });

/** The shared names bound to a server, each with its counts and the state its flags give it. */
function namesOfServer(db: Db, serverId: string, namesOf: NamesOf): NameStatus[] {
  return boundAliasesOf(db, serverId)
    .filter(isSharedName)
    .map((alias) => {
      const state = nameStateOf(db, serverId, alias) ?? "ok";
      const recreated = state === "recreated" ? nameFlag(db, serverId, alias, "recreated") : null;
      return {
        alias,
        slug: alias.slice(NAME_PREFIX.length),
        ...namesOf(db, serverId, alias),
        state,
        recreatedBy: recreated?.member?.name ?? null,
      };
    });
}

export function readHold(db: Db, serverId: string): WithdrawalHold | null {
  const raw = getMeta(db, restoreHoldKey(serverId));
  if (raw === null) return null;
  try {
    const hold = JSON.parse(raw) as Partial<WithdrawalHold>;
    const count = typeof hold.count === "number" && hold.count >= 0 ? hold.count : 0;
    return (hold.reason === "restore" || hold.reason === "bulk") && typeof hold.at === "number"
      ? { reason: hold.reason, at: hold.at, count }
      : { reason: "restore", at: 0, count };
  } catch {
    return { reason: "restore", at: 0, count: 0 };
  }
}

/**
 * One entry per server for `status`, the viewer and `doctor`: the state, its remedy, the
 * cursors, the last answers, the backlog and a held withdrawal. Never a token. Nothing on a
 * store without the sharing v2 tables.
 */
export function statusReport(
  db: Db,
  dataDir: string,
  countsOf: CountsOf = NO_COUNTS,
  namesOf: NamesOf = NO_NAMES,
): ServerStatus[] {
  if (!hasServerTables(db)) return [];
  const tokens = readTokens(dataDir);
  return listServers(db).map((row) => {
    const counts = countsOf(db, row.serverId);
    const names = namesOfServer(db, row.serverId, namesOf);
    const stateOf = (): [ServerState, string | null] => {
      if (row.confirmedAt === null) return ["pending", "share server add again"];
      if (!(row.serverId in tokens)) return ["token missing", "share server rejoin"];
      if (row.stopped !== null) return ["stopped", STOPPED_REMEDIES[row.stopped]];
      return ["ok", null];
    };
    const [state, remedy] = stateOf();
    return {
      serverId: row.serverId,
      name: row.name,
      host: hostOf(row.url),
      url: row.url,
      member: row.memberName,
      memberId: row.memberId,
      role: row.role,
      contract: row.contract,
      state,
      stopped: row.stopped,
      remedy,
      cursor:
        row.cursors.main +
        Object.values(row.cursors.extra).reduce((sum, cursor) => sum + cursor, 0),
      snapshotDue: row.snapshotDue,
      lastSweepAt: row.lastSweepAt,
      lastPushAt: row.lastPushAt,
      lastPushOkAt: row.lastPushOkAt,
      lastPullAt: row.lastPullAt,
      lastPullOkAt: row.lastPullOkAt,
      backlog: row.backlog,
      dirtyPaths: counts.dirtyPaths,
      pendingRows: counts.pendingRows,
      openConflicts: counts.openConflicts,
      hold: readHold(db, row.serverId),
      failures: row.failures,
      retryAt: row.retryAt,
      lastError: row.lastError,
      lastErrorAt: row.lastErrorAt,
      muted: row.muted,
      names,
      namesHeld: row.contract < 2 && names.length > 0,
    };
  });
}

// --- The sync's own state --------------------------------------------------------------------------

export type SyncState =
  | { kind: "not-running" }
  | { kind: "running"; pid: number; version: string }
  | { kind: "stopping"; who: string; at: number; pid: number; version: string }
  | { kind: "stopped"; who: string; at: number }
  | { kind: "start-failed"; at: number; reason: string; failures: number; nextTryAt: number }
  /** An unexpired lease whose process is gone: the next spawn takes it. */
  | { kind: "dead-holder"; pid: number; version: string };

function holderOf(owner: string): { pid: number; version: string } {
  const match = /^sync-(\d+)-(.+)$/.exec(owner);
  return match === null
    ? { pid: 0, version: "" }
    : { pid: Number(match[1]), version: match[2] ?? "" };
}

/** What `status` says of the process: from the lease, the stop flag and the failed-start mark. */
export function syncState(db: Db, now: number): SyncState {
  const lease = parseLease(getMeta(db, SYNC_LEASE));
  const stop = readSyncStop(db);
  if (lease !== null && lease.until > now) {
    const holder = holderOf(lease.owner);
    if (holder.pid !== 0 && !processAlive(holder.pid)) return { kind: "dead-holder", ...holder };
    return stop === null
      ? { kind: "running", ...holder }
      : { kind: "stopping", who: stop.who, at: stop.at, ...holder };
  }
  if (stop !== null) return { kind: "stopped", who: stop.who, at: stop.at };
  const failed = readFailedStart(db);
  if (failed !== null)
    return {
      kind: "start-failed",
      at: failed.at,
      reason: failed.reason,
      failures: failed.failures,
      nextTryAt: failed.at + failedStartBackoffMs(failed.failures),
    };
  return { kind: "not-running" };
}
