// The viewer's server routes (ADR 0027): the list, the add with its counts and its yes, the
// rejoin, the removal, mute and resume, each through the same functions the CLI uses in
// `src/sync/join.ts`, and the sync's state through `src/sync/report.ts`. No answer carries a
// token, and nothing here runs SQL over the sharing tables.
import { setLevelMessage, setServerLists } from "../sharing/store.ts";
import { type ServerJson, serverJson, type SyncJson, syncJson } from "../status/report.ts";
import type { Db } from "../store/db.ts";
import { listServerNames } from "../sync/binding.ts";
import { checkServerUrl, ServerUrlError } from "../sync/client.ts";
import type { SyncContext } from "../sync/context.ts";
import {
  confirmJoin,
  type JoinReason,
  joinServer,
  muteServer,
  rejoinServer,
  removeServer,
  resumePreview,
  resumeServer,
} from "../sync/join.ts";
import { openConflictCount } from "../sync/ledger.ts";
import { syncReport } from "../sync/report.ts";
import { findServer, listServers } from "../sync/servers.ts";

/** An answer the server turns into a response: the status, and the JSON body. */
export interface Answer {
  status: number;
  body: unknown;
}

const refused = (status: number, error: string, extra: Record<string, unknown> = {}): Answer => ({
  status,
  body: { error, ...extra },
});

/**
 * A refusal the page shows as a sentence of its own, answered 200 with `ok: false` and the
 * one-word error: an expected outcome of the person's action (a refused code, a URL that is
 * not a server's), not a fault, so the browser logs no error for it.
 */
const declined = (answer: Answer): Answer => ({
  status: 200,
  body: { ok: false, ...(answer.body as Record<string, unknown>) },
});

/** `GET /api/servers` when the list cannot be read: the page says so in one sentence. */
export function serversUnavailable(): { sync: SyncJson; servers: ServerEntry[]; error: string } {
  return { sync: NO_SYNC, servers: [], error: "unavailable" };
}

/** The sync with nothing of it on record: what a store at sharing v1 answers. */
const NO_SYNC: SyncJson = {
  state: "idle",
  pid: null,
  alive: null,
  idleSince: null,
  stoppedBy: null,
  failedStart: null,
};

export interface ServerEntry extends ServerJson {
  url: string;
  /** The last push or pull the server answered well; null when none did. */
  lastSyncAt: number | null;
  muted: boolean;
}

/** `GET /api/servers`: the sync's state and one entry per listed server. */
export function serversView(
  db: Db,
  dataDir: string,
  now: number,
): { sync: SyncJson; servers: ServerEntry[] } {
  const report = syncReport(db, dataDir, now);
  if (report === null) return { sync: NO_SYNC, servers: [] };
  return {
    sync: syncJson(report.state, report.servers),
    servers: report.servers.map((server) => ({
      ...serverJson(server),
      url: server.url,
      lastSyncAt:
        server.lastPushOkAt === null && server.lastPullOkAt === null
          ? null
          : Math.max(server.lastPushOkAt ?? 0, server.lastPullOkAt ?? 0),
      muted: server.muted,
    })),
  };
}

/** `GET /api/sync`: the `sync` object of `status --json`. */
export function syncView(db: Db, dataDir: string, now: number): SyncJson {
  const report = syncReport(db, dataDir, now);
  return report === null ? NO_SYNC : syncJson(report.state, report.servers);
}

/** How a join's failure is answered: the status, and the one-word error the page switches on. */
function joinFailure(reason: JoinReason, message: string): Answer {
  switch (reason) {
    case "url":
      return refused(400, "url", { detail: message });
    case "already-joined":
      return refused(409, "joined", { detail: message });
    case "unknown-server":
      return refused(404, "unknown-server", { detail: message });
    case "refused":
    case "gone":
    case "unauthorized":
    case "forbidden":
    case "disabled":
      return refused(403, "code", { detail: message });
    case "server-id":
    case "contract":
    case "tooLarge":
      return refused(400, reason, { detail: message });
    case "oldServer":
      return refused(400, "contract", { detail: message });
    case "conflict":
      return refused(409, "conflict", { detail: message });
    case "rate":
      return refused(429, "rate", { detail: message });
    default:
      return refused(502, "network", { detail: message });
  }
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * `POST /api/servers`: with `code`, the join (the token to the file, the row pending) and the
 * counts of what would leave; with `yes`, the confirmation of the pending row for that URL,
 * after which the sync is started.
 */
export async function addServerRoute(
  ctx: SyncContext,
  body: Record<string, unknown>,
  startSyncNow: () => void,
): Promise<Answer> {
  const url = text(body.url);
  if (url === undefined) return declined(refused(400, "url"));
  if (body.yes === true) {
    let origin: string;
    try {
      origin = checkServerUrl(url);
    } catch (error) {
      if (error instanceof ServerUrlError)
        return declined(refused(400, "url", { detail: error.message }));
      throw error;
    }
    const pending = listServers(ctx.db).find(
      (row) => row.url === origin && row.confirmedAt === null,
    );
    if (pending === undefined) return declined(refused(404, "pending"));
    confirmJoin(ctx, pending.serverId, "viewer");
    startSyncNow();
    return { status: 200, body: { ok: true, confirmed: true } };
  }
  const code = text(body.code);
  if (code === undefined) return declined(refused(400, "code"));
  const label = text(body.label);
  const name = text(body.name);
  const joined = await joinServer(ctx, {
    url,
    code,
    ...(label === undefined ? {} : { label }),
    ...(name === undefined ? {} : { name }),
  });
  if (!joined.ok) return declined(joinFailure(joined.reason, joined.message));
  const report = joined.wouldLeave;
  return {
    status: 200,
    body: {
      ok: true,
      confirm: true,
      server: {
        id: joined.serverId,
        name: joined.name,
        member: joined.member.name,
        role: joined.member.role,
      },
      counts: {
        entries: report.counts.entries,
        memories: report.counts.memories,
        byProject: report.perProject
          .filter((row) => row.entries + row.memories > 0)
          .map((row) => ({ project: row.id, entries: row.entries, memories: row.memories })),
      },
    },
  };
}

/** `POST /api/servers/<id>/rejoin`: a new device for a listed server, from a code. */
export async function rejoinRoute(
  ctx: SyncContext,
  serverId: string,
  body: Record<string, unknown>,
): Promise<Answer> {
  const code = text(body.code);
  if (code === undefined) return refused(400, "code");
  const label = text(body.label);
  const result = await rejoinServer(ctx, serverId, {
    code,
    ...(label === undefined ? {} : { label }),
  });
  if (!result.ok) return joinFailure(result.reason, result.message);
  return { status: 200, body: { rejoined: true } };
}

/** `DELETE /api/servers/<id>`: the removal, with every refusal the CLI makes, by status. */
export async function removeRoute(
  ctx: SyncContext,
  serverId: string,
  body: Record<string, unknown>,
): Promise<Answer> {
  if (findServer(ctx.db, serverId) === null) return refused(404, "unknown-server");
  const result = await removeServer(ctx, serverId, {
    withdraw: body.withdraw === true,
    yes: body.yes === true,
    source: "viewer",
  });
  if (result.ok) return { status: 200, body: { removed: true } };
  switch (result.reason) {
    case "unknown-server":
      return refused(404, "unknown-server");
    case "open-conflicts":
      return refused(409, "conflicts", { open: openConflictCount(ctx.db, serverId) });
    case "sync-running":
      return refused(503, "sync", { detail: result.message });
    case "withdraw-left":
      return refused(409, "withdraw", { left: result.left ?? 0, detail: result.message });
  }
}

const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS";
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS";
const listOf = (value: string | null | undefined): string[] | undefined =>
  value === undefined || value === null ? undefined : value === "none" || value === "" ? [] : value.split(",");

/**
 * The sharing keys of `PUT /api/settings` with a `server`: the named server's roots and areas,
 * never the file's. A wider list needs the request's `confirm`. Null when written.
 */
export function setServerListsRoute(
  db: Db,
  serverId: string,
  changes: Partial<Record<string, string | null>>,
  confirmed: boolean,
  now: number,
): Answer | null {
  const roots = listOf(changes[ROOTS_KEY]);
  const areas = listOf(changes[AREAS_KEY]);
  try {
    // The store refuses a widening the request did not confirm (ADR 0025's rule, in the store).
    const outcome = setServerLists(
      db,
      serverId,
      { ...(roots === undefined ? {} : { roots }), ...(areas === undefined ? {} : { areas }) },
      { source: "viewer", now, confirm: confirmed },
    );
    if (!outcome.ok)
      return refused(400, "needs-confirm", { detail: setLevelMessage("needs-confirm") });
  } catch (error) {
    return refused(400, "invalid", {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
}

/** `POST /api/servers/<id>/mute|unmute`, the whole server or one member of it. */
export function muteRoute(
  ctx: SyncContext,
  serverId: string,
  body: Record<string, unknown>,
  muted: boolean,
): Answer {
  const memberId = text(body.member);
  const result = muteServer(ctx, serverId, {
    muted,
    source: "viewer",
    ...(memberId === undefined ? {} : { memberId }),
  });
  if (!result.ok) return refused(404, "unknown-server");
  return { status: 200, body: { muted } };
}

/** `POST /api/servers/<id>/resume`: the withdrawals a resume would release, per project; with `yes`, the release. */
export function resumeRoute(
  ctx: SyncContext,
  serverId: string,
  body: Record<string, unknown>,
): Answer {
  const previews = resumePreview(ctx, serverId);
  if ("ok" in previews) return refused(404, "unknown-server");
  if (body.yes !== true) return { status: 200, body: { preview: previews } };
  const { released } = resumeServer(ctx, previews);
  return { status: 200, body: { resumed: true, released } };
}

/**
 * `GET /api/servers/<id>/names`: the server's live names, reassembled from its pages up to
 * 1,000 (ADR 0028), for the dock's field. A row the list does not hold is `unknown-server`; a
 * row not yet confirmed has no token to ask with, `pending`; a server at contract 1 (after the
 * one `/v1/me` read, or on a bare 404, the row then set to 1) `contract`; a failure `unreachable`.
 */
export async function serverNamesView(ctx: SyncContext, serverId: string): Promise<Answer> {
  const row = findServer(ctx.db, serverId);
  if (row === null) return refused(404, "unknown-server");
  if (row.confirmedAt === null) return refused(409, "pending");
  const listed = await listServerNames(ctx, row);
  if (listed.ok) {
    return { status: 200, body: { names: listed.names, truncated: listed.truncated } };
  }
  if (listed.reason === "contract") return refused(409, "contract");
  return refused(502, "unreachable", { detail: listed.message ?? listed.reason });
}
