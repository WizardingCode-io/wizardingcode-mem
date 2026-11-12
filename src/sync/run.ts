// The sync process (ADR 0027): one lease per data directory, renewed on the injected timers;
// one loop per confirmed server, a tick on `PRAGMA data_version`, a full sweep every minute,
// an idle exit, a stop flag, and the exit codes. The sweep, the pull and the start's steps are
// hooks the outbound and the inbound sides fill; this file owns when they run.
import {
  claimLease,
  clearFailedStart,
  leaseOwned,
  readSyncStop,
  releaseLease,
  SYNC_LEASE,
  SYNC_LEASE_MS,
  SYNC_RENEW_MS,
  takeOverLease,
  writeFailedStart,
} from "../store/meta.ts";
import { CONTRACT } from "../team/contract.ts";
import { probeUi, readUiState } from "../ui/state.ts";
import { brandHome } from "../util/paths.ts";
import { SyncClient } from "./client.ts";
import { closeOrphanConflicts } from "./conflicts.ts";
import { leaseOwnerOf, type SyncContext } from "./context.ts";
import { pullOnce as inboundPull } from "./inbound.ts";
import { logError } from "./log.ts";
import { sweep as outboundSweep } from "./outbound.ts";
import { deleteServerReceived, orphanServerIds, reindexReceived } from "./received.ts";
import {
  CONTRACT_READ_MS,
  confirmedServers,
  readTokens,
  type ServerRow,
  setContract,
  spokenAfterMe,
  totalBacklog,
} from "./servers.ts";
import { guarded, LeaseLost } from "./state.ts";

/** The tick that reads `data_version`. */
export const TICK_MS = 2_000;
/** A tick sweep runs at most this often, measured from the previous one's end. */
export const TICK_SWEEP_GAP_MS = 5_000;
/** The stop flag is read this often. */
export const STOP_CHECK_MS = 5_000;
/** The full sweep, the idle check and the extra aliases' pulls run at this mark. */
export const FULL_SWEEP_MS = 60_000;
/** The process leaves after this long with no hook run, no live viewer and no backlog. */
export const IDLE_MS = 15 * 60_000;
/** A pull that was not held is followed by this wait before the next. */
export const PULL_PAUSE_MS = 5_000;

export type SweepMode = "tick" | "full";

export interface PullOutcome {
  ok: boolean;
  /** True when the server held the request: the loop pulls again at once. */
  held: boolean;
}

/** The three steps the loop runs, as the process wires them (`REAL_HOOKS`); a test replaces any. */
export interface RunHooks {
  /** The start's steps, before any sweep or pull. */
  startSteps(ctx: SyncContext): Promise<void>;
  /** The outbound side: the rows that changed on a tick, everything at the sixty-second mark. */
  sweep(ctx: SyncContext, server: ServerRow, mode: SweepMode): Promise<void>;
  /** The inbound side: one pull, held on the server when `wait` is set, abortable by `signal`. */
  pullOnce(
    ctx: SyncContext,
    server: ServerRow,
    options: { wait: boolean; signal: AbortSignal },
  ): Promise<PullOutcome>;
}

/** How long one read of `/v1/me` may take when the contracts are refreshed. */

/**
 * The active read of the contract spoken (ADR 0028): `/v1/me` of every confirmed, unstopped
 * server with a token (with `onlyBelow`, those whose row speaks below this binary's contract),
 * in parallel, each under its own deadline; an answer sets the row to the lower of this binary's
 * contract and the server's; a 409 with an acceptable value sets that; anything else keeps the
 * stored value. Nothing here throws.
 */
export async function refreshContracts(
  ctx: SyncContext,
  options: { onlyBelow?: boolean } = {},
): Promise<void> {
  const tokens = readTokens(ctx.dataDir);
  const rows = confirmedServers(ctx.db).filter(
    (row) =>
      row.stopped === null &&
      row.serverId in tokens &&
      (options.onlyBelow !== true || row.contract < CONTRACT),
  );
  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        const client = new SyncClient(ctx, {
          url: row.url,
          token: tokens[row.serverId] as string,
          contract: row.contract,
        });
        const me = await client.me({ deadlineMs: CONTRACT_READ_MS });
        const next = spokenAfterMe(me, row.contract);
        if (next !== row.contract) guarded(ctx, () => setContract(ctx.db, row.serverId, next));
      } catch (error) {
        logError(ctx, row.serverId, "contract", error);
      }
    }),
  );
}

/**
 * The start's steps, in order, before any sweep or pull: the received copies of a server id
 * with no row deleted (a crashed `remove`, a restore), the received folder re-indexed as the
 * truth, the conflicts rows whose proposal is decided or gone closed, and the contracts read.
 */
export async function startSteps(ctx: SyncContext): Promise<void> {
  for (const serverId of orphanServerIds(ctx)) deleteServerReceived(ctx, serverId);
  reindexReceived(ctx);
  closeOrphanConflicts(ctx);
  await refreshContracts(ctx);
}

/** The hooks as the process runs them. */
export const REAL_HOOKS: RunHooks = {
  startSteps,
  sweep: async (ctx, server, mode) => {
    await outboundSweep(ctx, server, { full: mode === "full" });
  },
  pullOnce: (ctx, server, options) => inboundPull(ctx, server, options),
};

export interface RunOptions {
  /** `sync --once`: the start's steps, one sweep and one pull per server, then exit. */
  once: boolean;
  hooks?: Partial<RunHooks>;
  /** Whether a viewer is live (`readUiState` and `probeUi`); a test gives its own. */
  viewerLive?: () => Promise<boolean>;
  /** Install the SIGTERM and SIGINT handlers: the process does, a test does not. */
  signals?: boolean;
}

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_REFUSED = 2;
export const EXIT_START_FAILED = 3;

type Stopping = null | "stop-flag" | "signal" | "idle" | "lost";

function dataVersion(ctx: SyncContext): number {
  return ctx.db.query<{ data_version: number }, []>("PRAGMA data_version").get()?.data_version ?? 0;
}

function lastHookRunAt(ctx: SyncContext): number | null {
  return (
    ctx.db.query<{ at: number | null }, []>("SELECT max(at) AS at FROM hook_runs").get()?.at ?? null
  );
}

const backlogOf = (ctx: SyncContext): number => totalBacklog(ctx.db);

async function realViewerLive(ctx: SyncContext): Promise<boolean> {
  const state = readUiState(brandHome(ctx.env), ctx.dataDir);
  return state !== null && (await probeUi(state));
}

/** The confirmed rows whose token is missing: a start that cannot run. */
function missingTokens(ctx: SyncContext, servers: ServerRow[]): string[] {
  const tokens = readTokens(ctx.dataDir);
  return servers.filter((server) => !(server.serverId in tokens)).map((server) => server.serverId);
}

/**
 * `sync --auto` and `sync --once`. Exit codes: 0 on the idle exit, on a signal, on the stop
 * flag and on `--once` with every server ok; 1 on `--once` with a stopped server or a failed
 * batch, and on a lost lease; 2 on `--once` refused while `--auto` holds the lease; 3 on a
 * failed start, which writes `sync.last_failed_start`.
 */
export async function runSync(ctx: SyncContext, options: RunOptions): Promise<number> {
  const hooks: RunHooks = { ...REAL_HOOKS, ...options.hooks };
  const owner = leaseOwnerOf(ctx);
  const now = () => ctx.clock.now;

  if (options.once) {
    if (!claimLease(ctx.db, SYNC_LEASE, owner, now(), SYNC_LEASE_MS)) {
      ctx.log("sync is running; `sync --once` refused");
      return EXIT_REFUSED;
    }
  } else if (!takeOverLease(ctx.db, SYNC_LEASE, owner, now())) {
    // A second `--auto` while the lease is live: nothing to do.
    return EXIT_OK;
  }
  ctx.lease = owner;

  const leave = (code: number): number => {
    if (leaseOwned(ctx.db, SYNC_LEASE, owner)) releaseLease(ctx.db, SYNC_LEASE, owner);
    ctx.lease = undefined;
    return code;
  };

  // The start: what is needed to run at all.
  const servers = confirmedServers(ctx.db);
  const missing = missingTokens(ctx, servers);
  if (missing.length > 0) {
    const reason = `token missing for ${missing.join(", ")}; share server rejoin`;
    writeFailedStart(ctx.db, now(), reason);
    ctx.log(`start failed: ${reason}`);
    return leave(EXIT_START_FAILED);
  }
  try {
    await hooks.startSteps(ctx);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeFailedStart(ctx.db, now(), reason);
    logError(ctx, "-", "start", error);
    return leave(EXIT_START_FAILED);
  }
  clearFailedStart(ctx.db);

  // The rows again: the start's steps may have moved a contract spoken.
  if (options.once) return leave(await runOnce(ctx, hooks, confirmedServers(ctx.db)));
  return leave(await runLoop(ctx, hooks, options));
}

/** One full sweep and one pull per server, no `wait`; a failure in one never stops another. */
async function runOnce(ctx: SyncContext, hooks: RunHooks, servers: ServerRow[]): Promise<number> {
  let code = EXIT_OK;
  for (const server of servers) {
    if (server.stopped !== null) {
      ctx.log(`${server.name}: stopped (${server.stopped}); share server rejoin`);
      code = EXIT_FAILED;
      continue;
    }
    try {
      await hooks.sweep(ctx, server, "full");
      const pulled = await hooks.pullOnce(ctx, server, {
        wait: false,
        signal: new AbortController().signal,
      });
      if (!pulled.ok) code = EXIT_FAILED;
    } catch (error) {
      if (error instanceof LeaseLost) return EXIT_FAILED;
      logError(ctx, server.serverId, "once", error);
      code = EXIT_FAILED;
    }
  }
  return code;
}

async function runLoop(ctx: SyncContext, hooks: RunHooks, options: RunOptions): Promise<number> {
  const owner = ctx.lease as string;
  const now = () => ctx.clock.now;
  const viewerLive = options.viewerLive ?? (() => realViewerLive(ctx));
  const startedAt = now();
  let stopping: Stopping = null;
  const aborter = new AbortController();

  // A sleeper the stop wakes, so the loops leave within the stop's five seconds.
  let wakers: (() => void)[] = [];
  const wake = () => {
    const woken = wakers;
    wakers = [];
    for (const waker of woken) waker();
  };
  const pause = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const done = () => {
        ctx.timers.clearTimeout(timer);
        resolve();
      };
      const timer = ctx.timers.setTimeout(() => {
        wakers = wakers.filter((waker) => waker !== done);
        resolve();
      }, ms);
      wakers.push(done);
    });
  const stop = (why: Exclude<Stopping, null>) => {
    if (stopping !== null) return;
    stopping = why;
    aborter.abort();
    wake();
  };

  // The lease: renewed every 20 s; lost means no further write and the exit after the step.
  const renewal = ctx.timers.setInterval(() => {
    if (stopping !== null) return;
    if (!claimLease(ctx.db, SYNC_LEASE, owner, now(), SYNC_LEASE_MS)) stop("lost");
  }, SYNC_RENEW_MS);

  // The stop flag, read every 5 s: the process leaves within five seconds of it.
  const stopCheck = ctx.timers.setInterval(() => {
    if (stopping === null && readSyncStop(ctx.db) !== null) stop("stop-flag");
  }, STOP_CHECK_MS);

  // The tick: `data_version` every 2 s, the sweeps and the idle check.
  let seenVersion = dataVersion(ctx);
  let changed = false;
  let sweeping: Promise<void> | null = null;
  let lastTickSweepEnd = Number.NEGATIVE_INFINITY;
  let lastMark = startedAt;
  const sweepAll = async (mode: SweepMode) => {
    try {
      for (const server of confirmedServers(ctx.db)) {
        if (stopping !== null) break;
        if (server.stopped !== null) continue;
        try {
          await hooks.sweep(ctx, server, mode);
        } catch (error) {
          if (error instanceof LeaseLost) {
            stop("lost");
            break;
          }
          logError(ctx, server.serverId, "sweep", error);
        }
      }
    } finally {
      sweeping = null;
      if (mode === "tick") lastTickSweepEnd = now();
    }
  };
  const idle = async (): Promise<boolean> => {
    const lastRun = lastHookRunAt(ctx) ?? 0;
    if (now() - Math.max(lastRun, startedAt) < IDLE_MS) return false;
    if (backlogOf(ctx) > 0) return false;
    return !(await viewerLive());
  };
  const tick = async () => {
    if (stopping !== null) return;
    const at = now();
    const version = dataVersion(ctx);
    if (version !== seenVersion) {
      seenVersion = version;
      changed = true;
      // A server confirmed by another process since the start gets its pull loop now.
      ensureLoops();
    }
    if (sweeping !== null) return;
    if (at - lastMark >= FULL_SWEEP_MS) {
      lastMark = at;
      changed = false;
      ensureLoops();
      // A server upgraded since the start: its row speaks up again within a minute (ADR 0028).
      await refreshContracts(ctx, { onlyBelow: true });
      sweeping = sweepAll("full");
      await sweeping;
      if (stopping === null && (await idle())) stop("idle");
      return;
    }
    if (changed && at - lastTickSweepEnd >= TICK_SWEEP_GAP_MS) {
      changed = false;
      sweeping = sweepAll("tick");
      await sweeping;
    }
  };
  const ticker = ctx.timers.setInterval(() => void tick(), TICK_MS);

  // One pull loop per confirmed server, concurrently; a failure in one never stops another.
  // The loops are kept by server id: one that leaves (its server removed) is forgotten, and a
  // server confirmed while the process runs gets its loop at the next tick that sees the change.
  const loops = new Map<string, Promise<void>>();
  const pullLoop = async (serverId: string) => {
    while (stopping === null) {
      const server = confirmedServers(ctx.db).find((row) => row.serverId === serverId);
      if (server === undefined) return;
      if (server.stopped !== null) {
        await pause(FULL_SWEEP_MS);
        continue;
      }
      if (server.retryAt !== null && server.retryAt > now()) {
        await pause(Math.min(server.retryAt - now(), FULL_SWEEP_MS));
        continue;
      }
      let outcome: PullOutcome;
      try {
        outcome = await hooks.pullOnce(ctx, server, { wait: true, signal: aborter.signal });
      } catch (error) {
        if (error instanceof LeaseLost) {
          stop("lost");
          return;
        }
        if (stopping !== null) return;
        logError(ctx, serverId, "pull", error);
        outcome = { ok: false, held: false };
      }
      if (stopping !== null) return;
      if (!outcome.held) await pause(PULL_PAUSE_MS);
    }
  };
  function ensureLoops(): void {
    if (stopping !== null) return;
    for (const server of confirmedServers(ctx.db)) {
      if (loops.has(server.serverId)) continue;
      const loop = pullLoop(server.serverId).finally(() => {
        if (loops.get(server.serverId) === loop) loops.delete(server.serverId);
      });
      loops.set(server.serverId, loop);
    }
  }
  ensureLoops();

  const onSignal = () => stop("signal");
  if (options.signals === true) {
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
  }

  // The loop ends when something stops it: every stop wakes the sleepers, this one included.
  await new Promise<void>((resolve) => {
    wakers.push(resolve);
  });
  ctx.timers.clearInterval(renewal);
  ctx.timers.clearInterval(stopCheck);
  ctx.timers.clearInterval(ticker);
  if (options.signals === true) {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }
  await Promise.all([...loops.values()]);
  if (sweeping !== null) await sweeping;
  const why = stopping as Stopping;
  return why === "lost" ? EXIT_FAILED : EXIT_OK;
}
