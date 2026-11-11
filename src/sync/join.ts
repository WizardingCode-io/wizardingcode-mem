// Joining a server, confirming it, re-joining it, leaving it and resuming it (ADR 0027): the
// token to the file first, then the pending row; the yes in one transaction; the removal
// behind the stop flag. Every outcome is a value: the CLI and the viewer say it their way.
import { hostname } from "node:os";
import { loadPolicy } from "../sharing/policy.ts";
import { type Report, wouldLeave } from "../sharing/report.ts";
import {
  bumpCounter,
  type ChangeSource,
  confirmServer,
  logServerChange,
  removeServerLevels,
} from "../sharing/store.ts";
import { TEAM_DESTINATION } from "../sharing/types.ts";
import { withWrite } from "../store/db.ts";
import { clearSyncStop, restoreHoldKey, stopSync } from "../store/meta.ts";
import type { Limits } from "../team/contract.ts";
import { type ClientFailed, checkServerUrl, ServerUrlError, SyncClient } from "./client.ts";
import type { SyncContext } from "./context.ts";
import { authorisedUids, clearServerLedger, openConflictCount, writeAuthorised } from "./ledger.ts";
import { isComponent } from "./naming.ts";
import { type Withdrawal, withdrawAll, wouldWithdraw } from "./outbound.ts";
import { deleteServerReceived } from "./received.ts";
import {
  confirmedServers,
  deleteServerRows,
  findServer,
  forgetToken,
  hostOf,
  insertPending,
  listServers,
  muteMember,
  replaceDevice,
  type ServerRow,
  setMuted,
  writeToken,
} from "./servers.ts";
import { readHold } from "./state.ts";

export type JoinReason =
  | "url"
  | "already-joined"
  | "unknown-server"
  | "server-id"
  | ClientFailed["kind"];

export interface Failure<R extends string = JoinReason> {
  ok: false;
  reason: R;
  message: string;
  /** `withdraw-left`: how many items could not be withdrawn. */
  left?: number;
}

export interface Joined {
  ok: true;
  serverId: string;
  /** The server's name as shown: the server's, else the URL's host. */
  name: string;
  host: string;
  member: { id: string; name: string; role: string };
  instance: string;
  /** Null when `me` could not be read after the join; the row is written all the same. */
  limits: Limits | null;
  /** True when no other server is confirmed: the `team` rows are what would leave. */
  first: boolean;
  /** True when a listed, stopped server got a new device instead of a new row. */
  rejoined: boolean;
  wouldLeave: Report;
}

/** What a client failure says to the person. */
export function failureMessage(failure: ClientFailed): string {
  switch (failure.kind) {
    case "refused":
      return `the server refused: ${failure.error}`;
    case "gone":
      return `the code is used or expired (${failure.error}); ask an admin for a new one`;
    case "unauthorized":
      return `the server refused the token: ${failure.error}`;
    case "disabled":
      return "the member was disabled; ask an admin";
    case "forbidden":
      return `the server refused: ${failure.error}`;
    case "contract":
      return `this client speaks 1, the server accepts ${failure.accepted.join(", ")}; upgrade wizardingcode-mem`;
    case "tooLarge":
      return "the server refused the request as too large";
    case "rate":
      return `the server is rate limiting this device; try again in ${Math.ceil(failure.retryAfterMs / 1000)} s`;
    case "server":
      return `the server failed (${failure.status}: ${failure.error})`;
    case "redirect":
      return "the server answered with a redirect, which the client never follows; use the server's own origin";
    case "network":
      return `the server could not be reached: ${failure.error}`;
    case "deadline":
      return "the server did not answer in time";
    case "aborted":
      return "the request was stopped";
  }
}

const failed = (failure: ClientFailed): Failure => ({
  ok: false,
  reason: failure.kind,
  message: failureMessage(failure),
});

export interface JoinInput {
  url: string;
  code: string;
  /** The device's label on the server; this machine's host name by default. */
  label?: string;
  /** The person's name, for a bootstrap code. */
  name?: string;
}

/**
 * `share server add`: the URL checked, the join, the token to the file first, then the
 * pending row (a listed, stopped server gets the new device instead, as a re-join), `me` for
 * the limits, and what would leave for this server. The row stays pending until `confirmJoin`.
 */
export async function joinServer(ctx: SyncContext, input: JoinInput): Promise<Joined | Failure> {
  let origin: string;
  try {
    origin = checkServerUrl(input.url);
  } catch (error) {
    if (!(error instanceof ServerUrlError)) throw error;
    return { ok: false, reason: "url", message: error.message };
  }
  const alreadyThere = listServers(ctx.db).find(
    (row) => row.url === origin && row.confirmedAt !== null && row.stopped === null,
  );
  if (alreadyThere !== undefined) return alreadyJoined(alreadyThere);

  const client = new SyncClient(ctx, { url: origin, token: null });
  const joined = await client.join(input.code, input.label ?? hostname(), input.name);
  if (!joined.ok) return failed(joined);
  const answer = joined.body;
  // The id names the server's folder under the received root: one the store writes no path
  // for could never hold a received entry, so the join is refused before anything is written.
  if (!isComponent("server", answer.serverId))
    return {
      ok: false,
      reason: "server-id",
      message: `the server's id ${JSON.stringify(answer.serverId)} is not one this client can store; nothing was written`,
    };
  const existing = listServers(ctx.db).find((row) => row.serverId === answer.serverId);
  if (existing !== undefined && existing.confirmedAt !== null && existing.stopped === null)
    return alreadyJoined(existing);

  const device = {
    deviceId: answer.deviceId,
    deviceAlias: answer.deviceAlias,
    memberId: answer.memberId,
    memberName: answer.name,
    role: answer.role,
    contract: answer.contract,
    instance: answer.instance,
  };
  const host = hostOf(origin);
  const rejoined = existing !== undefined && existing.confirmedAt !== null;
  // The token first: a crash after it leaves a token for a pending row, which doctor reports
  // and a re-run of add replaces; the reverse would leave a row that can never sync.
  writeToken(ctx, answer.serverId, answer.token);
  if (rejoined) replaceDevice(ctx.db, answer.serverId, device);
  else
    insertPending(ctx.db, {
      ...device,
      serverId: answer.serverId,
      url: origin,
      name: host,
      addedAt: ctx.clock.now,
    });

  const me = await new SyncClient(ctx, { url: origin, token: answer.token }).me();
  const first = confirmedServers(ctx.db).every((row) => row.serverId === answer.serverId);
  const destination = first ? TEAM_DESTINATION : answer.serverId;
  const policy = loadPolicy(ctx.db, ctx.dataDir, ctx.env, first ? undefined : answer.serverId);
  const report = wouldLeave(ctx.db, ctx.dataDir, ctx.env, policy, {
    now: ctx.clock.now,
    destination,
  });
  return {
    ok: true,
    serverId: answer.serverId,
    name: host,
    host,
    member: { id: answer.memberId, name: answer.name, role: answer.role },
    instance: answer.instance,
    limits: me.ok ? me.body.limits : null,
    first,
    rejoined,
    wouldLeave: report,
  };
}

const alreadyJoined = (row: ServerRow): Failure => ({
  ok: false,
  reason: "already-joined",
  message: `${row.name} (${row.serverId}) is already joined; \`share server rejoin\` replaces the device`,
});

/** The person's yes: `confirmServer`'s one transaction, logged as the caller's (`cli` or `viewer`). */
export function confirmJoin(
  ctx: SyncContext,
  serverId: string,
  source: ChangeSource = "cli",
): ReturnType<typeof confirmServer> {
  return confirmServer(ctx.db, ctx.dataDir, serverId, ctx.clock.now, source);
}

/** The server a reference names, or the refusal. */
function resolve(ctx: SyncContext, ref: string): ServerRow | Failure<"unknown-server"> {
  const row = findServer(ctx.db, ref);
  return (
    row ?? {
      ok: false,
      reason: "unknown-server",
      message: `\`${ref}\` names no server; \`share server list\` shows them`,
    }
  );
}

/**
 * `share server rejoin`: a listed server (stopped or not) joined again with a new code; the
 * token and the device columns replaced, `stopped` cleared, a snapshot due; the ledger, the
 * levels and the received items stay.
 */
export async function rejoinServer(
  ctx: SyncContext,
  ref: string,
  input: { code: string; label?: string },
): Promise<{ ok: true; serverId: string; member: Joined["member"] } | Failure> {
  const row = resolve(ctx, ref);
  if ("ok" in row) return row;
  const client = new SyncClient(ctx, { url: row.url, token: null });
  const joined = await client.join(input.code, input.label ?? hostname());
  if (!joined.ok) return failed(joined);
  const answer = joined.body;
  if (answer.serverId !== row.serverId)
    return {
      ok: false,
      reason: "unknown-server",
      message: `${row.url} answers as another server (${answer.serverId}); remove ${row.serverId} and add it`,
    };
  writeToken(ctx, row.serverId, answer.token);
  replaceDevice(ctx.db, row.serverId, {
    deviceId: answer.deviceId,
    deviceAlias: answer.deviceAlias,
    memberId: answer.memberId,
    memberName: answer.name,
    role: answer.role,
    contract: answer.contract,
    instance: answer.instance,
  });
  return {
    ok: true,
    serverId: row.serverId,
    member: { id: answer.memberId, name: answer.name, role: answer.role },
  };
}

export type RemoveReason = "unknown-server" | "sync-running" | "open-conflicts" | "withdraw-left";

export interface Removed {
  ok: true;
  serverId: string;
  name: string;
  levels: number;
  rows: number;
}

/**
 * `share server remove`: the sync stopped through the flag (refused when it does not leave
 * within 30 s), then in one transaction the server's ledger rows, its levels, its change row,
 * its mutes and its row; then the token. The device stays listed on the server until an
 * admin revokes it. Open conflicts refuse without `yes`.
 */
export async function removeServer(
  ctx: SyncContext,
  ref: string,
  options: { withdraw: boolean; yes: boolean; source?: ChangeSource },
  deps: {
    /** The received copies and memories of the server, deleted inside the transaction. */
    deleteReceived?: (serverId: string) => void;
    /** The withdrawal of every sent item before the removal. */
    withdrawAll?: (serverId: string) => Promise<{ ok: boolean; left: number }>;
  } = {},
): Promise<Removed | Failure<RemoveReason>> {
  const deleteReceived =
    deps.deleteReceived ??
    ((serverId: string) => {
      deleteServerReceived(ctx, serverId);
    });
  const withdrawEvery =
    deps.withdrawAll ??
    ((serverId: string) => {
      const target = findServer(ctx.db, serverId);
      return target === null ? Promise.resolve({ ok: false, left: 0 }) : withdrawAll(ctx, target);
    });
  const row = resolve(ctx, ref);
  if ("ok" in row) return row;
  const conflicts = openConflictCount(ctx.db, row.serverId);
  if (conflicts > 0 && !options.yes)
    return {
      ok: false,
      reason: "open-conflicts",
      message: `${row.name} has ${conflicts} open conflict${conflicts === 1 ? "" : "s"}; decide them, or remove with --yes to drop them`,
    };
  const released = await stopSync(ctx.db, {
    who: "share server remove",
    clock: ctx.clock,
    timers: ctx.timers,
  });
  if (!released) {
    clearSyncStop(ctx.db);
    return {
      ok: false,
      reason: "sync-running",
      message: "the sync is running; run `sync stop` first",
    };
  }
  try {
    if (options.withdraw) {
      const withdrawn = await withdrawEvery(row.serverId);
      if (!withdrawn.ok)
        return {
          ok: false,
          reason: "withdraw-left",
          left: withdrawn.left,
          message: `${withdrawn.left} item${withdrawn.left === 1 ? "" : "s"} could not be withdrawn; the server is still listed, and its token still valid`,
        };
    }
    const now = ctx.clock.now;
    // The received folder goes first (a crash between it and the rows leaves rows the
    // start re-indexes); the rows, the levels, the change row and the server's row in one
    // transaction; then the token.
    const result = withWrite(ctx.db, () => {
      deleteReceived(row.serverId);
      const { rows } = clearServerLedger(ctx.db, row.serverId);
      const { removed } = removeServerLevels(ctx.db, row.serverId, now);
      logServerChange(
        ctx.db,
        `server:${row.serverId}`,
        hostOf(row.url),
        "",
        now,
        options.source ?? "cli",
      );
      deleteServerRows(ctx.db, row.serverId);
      bumpCounter(ctx.db);
      return { levels: removed.length, rows };
    });
    forgetToken(ctx, row.serverId);
    return { ok: true, serverId: row.serverId, name: row.name, ...result };
  } finally {
    clearSyncStop(ctx.db);
  }
}

/** `share server mute | unmute [--member <id>]`: the row or one member's row, and the change logged. */
export function muteServer(
  ctx: SyncContext,
  ref: string,
  options: { muted: boolean; memberId?: string; source?: ChangeSource },
): { ok: true; serverId: string } | Failure<"unknown-server"> {
  const row = resolve(ctx, ref);
  if ("ok" in row) return row;
  const now = ctx.clock.now;
  const source = options.source ?? "cli";
  withWrite(ctx.db, () => {
    const what = `server:${row.serverId}`;
    const mark = options.memberId === undefined ? "mute" : `mute:${options.memberId}`;
    if (options.memberId !== undefined)
      muteMember(ctx.db, row.serverId, options.memberId, options.muted);
    else setMuted(ctx.db, row.serverId, options.muted);
    logServerChange(
      ctx.db,
      what,
      options.muted ? "" : mark,
      options.muted ? mark : "",
      now,
      source,
    );
  });
  return { ok: true, serverId: row.serverId };
}

/** What `share server resume` shows for one server: the withdrawals per project. */
export interface ResumePreview {
  serverId: string;
  name: string;
  hold: { reason: "restore" | "bulk"; at: number } | null;
  perProject: { projectId: number | null; count: number; uids: string[] }[];
  total: number;
}

/** The withdrawal sweep's preview for a server, or every server with a hold when none is named. */
export function resumePreview(
  ctx: SyncContext,
  ref: string | null,
): ResumePreview[] | Failure<"unknown-server"> {
  const rows = ref === null ? confirmedServers(ctx.db) : [resolve(ctx, ref)];
  const previews: ResumePreview[] = [];
  for (const row of rows) {
    if ("ok" in row) return row;
    const held = readHold(ctx.db, row.serverId);
    const hold: ResumePreview["hold"] = held === null ? null : { reason: held.reason, at: held.at };
    const withdrawals: Withdrawal[] = wouldWithdraw(ctx, row);
    const byProject = new Map<number | null, string[]>();
    for (const w of withdrawals) {
      const list = byProject.get(w.projectId) ?? [];
      list.push(w.row.itemUid);
      byProject.set(w.projectId, list);
    }
    previews.push({
      serverId: row.serverId,
      name: row.name,
      hold,
      perProject: [...byProject].map(([projectId, uids]) => ({
        projectId,
        count: uids.length,
        uids,
      })),
      total: withdrawals.length,
    });
  }
  return previews;
}

/**
 * The person's yes to `share server resume` (D-10): the hold cleared, whatever set it, and the
 * uids shown recorded as authorised for the next withdrawal sweeps, which withdraw them with
 * the guard suspended. Nothing else clears a hold.
 */
export function resumeServer(ctx: SyncContext, previews: ResumePreview[]): { released: string[] } {
  const released: string[] = [];
  withWrite(ctx.db, () => {
    for (const preview of previews) {
      ctx.db.run("DELETE FROM meta WHERE key = ?", [restoreHoldKey(preview.serverId)]);
      const shown = preview.perProject.flatMap((p) => p.uids);
      const already = authorisedUids(ctx.db, preview.serverId);
      writeAuthorised(ctx.db, preview.serverId, [...new Set([...already, ...shown])]);
      released.push(preview.serverId);
    }
  });
  return { released };
}
