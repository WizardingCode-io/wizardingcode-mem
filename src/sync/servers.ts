// The server list (`sharing_servers`, `sharing_muted_members`) and the token file
// (`<data dir>/servers.json`, ADR 0027 D-7). A token is never in the database, never logged,
// never returned: it lives in the file alone, written whole under the store's write lock.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hasTable } from "../sharing/store.ts";
import { type Db, withWrite } from "../store/db.ts";
import { writeFileAtomic } from "../util/atomic-write.ts";
import type { SyncContext } from "./context.ts";

// --- The token file -------------------------------------------------------------------------

export const TOKENS_FILE = "servers.json";
const TOKENS_VERSION = 1;

export const tokensPath = (dataDir: string): string => join(dataDir, TOKENS_FILE);

/** The token file cannot be read as the one this client writes; the message names the path. */
export class TokenFileError extends Error {
  constructor(
    readonly path: string,
    why: string,
  ) {
    super(`${path}: ${why}`);
    this.name = "TokenFileError";
  }
}

interface TokenFile {
  version: typeof TOKENS_VERSION;
  tokens: Record<string, string>;
}

function parseTokenFile(path: string, text: string): TokenFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TokenFileError(path, "not JSON; move the file aside and `share server add` again");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new TokenFileError(path, "not an object");
  const file = parsed as Partial<Record<keyof TokenFile, unknown>>;
  if (file.version !== TOKENS_VERSION)
    throw new TokenFileError(path, `version ${String(file.version)} is not ${TOKENS_VERSION}`);
  if (typeof file.tokens !== "object" || file.tokens === null || Array.isArray(file.tokens))
    throw new TokenFileError(path, "tokens is not an object");
  const tokens: Record<string, string> = {};
  for (const [serverId, token] of Object.entries(file.tokens as Record<string, unknown>)) {
    if (typeof token !== "string") throw new TokenFileError(path, `the token of ${serverId}`);
    tokens[serverId] = token;
  }
  return { version: TOKENS_VERSION, tokens };
}

/** The tokens by server id; none when there is no file. A malformed file is refused. */
export function readTokens(dataDir: string): Record<string, string> {
  const path = tokensPath(dataDir);
  if (!existsSync(path)) return {};
  return parseTokenFile(path, readFileSync(path, "utf8")).tokens;
}

function writeTokens(dataDir: string, tokens: Record<string, string>): void {
  const file: TokenFile = { version: TOKENS_VERSION, tokens };
  writeFileAtomic(tokensPath(dataDir), `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * Reads, changes and writes the file inside the store's write lock, which spans processes, so
 * two writers (the CLI and the viewer) never interleave.
 */
function changeTokens(
  ctx: SyncContext,
  change: (tokens: Record<string, string>) => Record<string, string>,
): void {
  withWrite(ctx.db, () => {
    writeTokens(ctx.dataDir, change(readTokens(ctx.dataDir)));
  });
}

export function writeToken(ctx: SyncContext, serverId: string, token: string): void {
  changeTokens(ctx, (tokens) => ({ ...tokens, [serverId]: token }));
}

export function forgetToken(ctx: SyncContext, serverId: string): void {
  changeTokens(ctx, (tokens) => {
    const { [serverId]: _gone, ...rest } = tokens;
    return rest;
  });
}

// --- The rows -------------------------------------------------------------------------------

/** Why a server is stopped; each has its remedy for the person. */
export type Stopped = "contract" | "unauthorized" | "rejoin" | "disabled";

export const STOPPED_REMEDIES: Readonly<Record<Stopped, string>> = {
  contract: "upgrade wizardingcode-mem",
  unauthorized: "this device was revoked; ask an admin for a code, then `share server rejoin`",
  rejoin: "the server was rebuilt; ask an admin for a code, then `share server rejoin`",
  disabled: "the member was disabled; ask an admin",
};

const STOPPED_VALUES: readonly string[] = ["contract", "unauthorized", "rejoin", "disabled"];

/** The pull cursors: the main pull's, the aliases it names, and one per alias past the set. */
export interface Cursors {
  main: number;
  mainAliases: string[];
  extra: Record<string, number>;
}

export const EMPTY_CURSORS: Readonly<Cursors> = { main: 0, mainAliases: [], extra: {} };

export interface ServerRow {
  serverId: string;
  url: string;
  name: string;
  deviceId: string;
  deviceAlias: string;
  memberId: string;
  memberName: string;
  role: string;
  contract: number;
  instance: string;
  /** Null while pending: the sweep, the pull and the spawn skip the row. */
  confirmedAt: number | null;
  cursors: Cursors;
  roots: string;
  areas: string;
  muted: boolean;
  stopped: Stopped | null;
  snapshotDue: boolean;
  lastSweepAt: number | null;
  lastSweepMaxId: number;
  lastSweepEpoch: number | null;
  lastSweepGeneration: string | null;
  addedAt: number;
  lastPushAt: number | null;
  lastPushOkAt: number | null;
  lastPullAt: number | null;
  lastPullOkAt: number | null;
  backlog: number;
  retryAt: number | null;
  failures: number;
  lastError: string | null;
  lastErrorAt: number | null;
  lastRequestId: string | null;
}

interface RawRow {
  server_id: string;
  url: string;
  name: string;
  device_id: string;
  device_alias: string;
  member_id: string;
  member_name: string;
  role: string;
  contract: number;
  instance: string;
  confirmed_at: number | null;
  cursors: string;
  roots: string;
  areas: string;
  muted: number;
  stopped: string | null;
  snapshot_due: number;
  last_sweep_at: number | null;
  last_sweep_max_id: number;
  last_sweep_epoch: number | null;
  last_sweep_generation: string | null;
  added_at: number;
  last_push_at: number | null;
  last_push_ok_at: number | null;
  last_pull_at: number | null;
  last_pull_ok_at: number | null;
  backlog: number;
  retry_at: number | null;
  failures: number;
  last_error: string | null;
  last_error_at: number | null;
  last_request_id: string | null;
}

const COLUMNS = `server_id, url, name, device_id, device_alias, member_id, member_name, role,
  contract, instance, confirmed_at, cursors, roots, areas, muted, stopped, snapshot_due,
  last_sweep_at, last_sweep_max_id, last_sweep_epoch, last_sweep_generation, added_at,
  last_push_at, last_push_ok_at, last_pull_at, last_pull_ok_at, backlog, retry_at, failures,
  last_error, last_error_at, last_request_id`;

/** The stored JSON read back; anything missing or malformed reads as the empty cursors. */
export function parseCursors(text: string): Cursors {
  try {
    const parsed = JSON.parse(text) as Partial<Record<keyof Cursors, unknown>>;
    if (typeof parsed !== "object" || parsed === null) return { ...EMPTY_CURSORS, extra: {} };
    const extra: Record<string, number> = {};
    if (typeof parsed.extra === "object" && parsed.extra !== null)
      for (const [alias, cursor] of Object.entries(parsed.extra as Record<string, unknown>))
        if (typeof cursor === "number" && Number.isInteger(cursor) && cursor >= 0)
          extra[alias] = cursor;
    return {
      main:
        typeof parsed.main === "number" && Number.isInteger(parsed.main) && parsed.main >= 0
          ? parsed.main
          : 0,
      mainAliases: Array.isArray(parsed.mainAliases)
        ? parsed.mainAliases.filter((alias): alias is string => typeof alias === "string")
        : [],
      extra,
    };
  } catch {
    return { main: 0, mainAliases: [], extra: {} };
  }
}

function rowOf(raw: RawRow): ServerRow {
  return {
    serverId: raw.server_id,
    url: raw.url,
    name: raw.name,
    deviceId: raw.device_id,
    deviceAlias: raw.device_alias,
    memberId: raw.member_id,
    memberName: raw.member_name,
    role: raw.role,
    contract: raw.contract,
    instance: raw.instance,
    confirmedAt: raw.confirmed_at,
    cursors: parseCursors(raw.cursors),
    roots: raw.roots,
    areas: raw.areas,
    muted: raw.muted === 1,
    stopped:
      raw.stopped !== null && STOPPED_VALUES.includes(raw.stopped)
        ? (raw.stopped as Stopped)
        : null,
    snapshotDue: raw.snapshot_due === 1,
    lastSweepAt: raw.last_sweep_at,
    lastSweepMaxId: raw.last_sweep_max_id,
    lastSweepEpoch: raw.last_sweep_epoch,
    lastSweepGeneration: raw.last_sweep_generation,
    addedAt: raw.added_at,
    lastPushAt: raw.last_push_at,
    lastPushOkAt: raw.last_push_ok_at,
    lastPullAt: raw.last_pull_at,
    lastPullOkAt: raw.last_pull_ok_at,
    backlog: raw.backlog,
    retryAt: raw.retry_at,
    failures: raw.failures,
    lastError: raw.last_error,
    lastErrorAt: raw.last_error_at,
    lastRequestId: raw.last_request_id,
  };
}

/**
 * Whether this connection's store has the sharing v2 tables, asked of `sqlite_master` once per
 * open: a store opened without the sharing schema (`openExisting` never migrates) has no server
 * row and every reader here says so without touching a table.
 */
const schemaKnown = new WeakMap<Db, boolean>();
export function hasServerTables(db: Db): boolean {
  let known = schemaKnown.get(db);
  if (known === undefined) {
    known = hasTable(db, "sharing_servers");
    schemaKnown.set(db, known);
  }
  return known;
}

/** Every server row, pending ones included, by id. */
export function listServers(db: Db): ServerRow[] {
  if (!hasServerTables(db)) return [];
  return db
    .query<RawRow, []>(`SELECT ${COLUMNS} FROM sharing_servers ORDER BY server_id`)
    .all()
    .map(rowOf);
}

/** The rows the sweep, the pull and the spawn work on: confirmed, by id. */
export function confirmedServers(db: Db): ServerRow[] {
  return listServers(db).filter((row) => row.confirmedAt !== null);
}

/** True when at least one server is confirmed. */
export function serversConfigured(db: Db): boolean {
  return confirmedServers(db).length > 0;
}

export function serverById(db: Db, serverId: string): ServerRow | null {
  if (!hasServerTables(db)) return null;
  const raw = db
    .query<RawRow, [string]>(`SELECT ${COLUMNS} FROM sharing_servers WHERE server_id = ?`)
    .get(serverId);
  return raw === null ? null : rowOf(raw);
}

/** The host of a server's URL, what a person names it by. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A reference (a name or a host) that matches more than one server. */
export class ServerRefAmbiguous extends Error {
  constructor(
    readonly ref: string,
    readonly ids: string[],
  ) {
    super(
      `\`${ref}\` names ${ids.length === 2 ? "two" : ids.length} servers: ${ids.join(", ")}; use the id`,
    );
    this.name = "ServerRefAmbiguous";
  }
}

/**
 * The server a command names: by id first (an id is unique), else by name or host. A name or
 * host that matches more than one server is refused with the ids listed.
 */
export function findServer(db: Db, ref: string): ServerRow | null {
  const byId = serverById(db, ref);
  if (byId !== null) return byId;
  const matches = listServers(db).filter((row) => row.name === ref || hostOf(row.url) === ref);
  if (matches.length > 1)
    throw new ServerRefAmbiguous(
      ref,
      matches.map((row) => row.serverId),
    );
  return matches[0] ?? null;
}

/** What a join gives, written as a pending row (or as the new device of a listed server). */
export interface Device {
  deviceId: string;
  deviceAlias: string;
  memberId: string;
  memberName: string;
  role: string;
  contract: number;
  instance: string;
}

export interface PendingServer extends Device {
  serverId: string;
  url: string;
  name: string;
  addedAt: number;
}

/**
 * Writes the row of a server just joined, `confirmed_at` null, replacing a pending row of the
 * same id (an `add` run again). A confirmed row is never replaced here: `add` refuses it or
 * takes the re-join path first.
 */
export function insertPending(db: Db, server: PendingServer): void {
  withWrite(db, () => {
    const existing = serverById(db, server.serverId);
    if (existing !== null && existing.confirmedAt !== null)
      throw new Error(`server ${server.serverId} is already confirmed`);
    db.run(
      `INSERT OR REPLACE INTO sharing_servers
         (server_id, url, name, device_id, device_alias, member_id, member_name, role, contract,
          instance, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        server.serverId,
        server.url,
        server.name,
        server.deviceId,
        server.deviceAlias,
        server.memberId,
        server.memberName,
        server.role,
        server.contract,
        server.instance,
        server.addedAt,
      ],
    );
  });
}

/**
 * A re-join: the device columns replaced, the stop and the breaker cleared, a snapshot due.
 * The ledger, the levels and the received items stay (the spec's re-join rule).
 */
export function replaceDevice(db: Db, serverId: string, device: Device): void {
  db.run(
    `UPDATE sharing_servers
        SET device_id = ?, device_alias = ?, member_id = ?, member_name = ?, role = ?,
            contract = ?, instance = ?, stopped = NULL, snapshot_due = 1, failures = 0,
            retry_at = NULL, last_error = NULL, last_error_at = NULL
      WHERE server_id = ?`,
    [
      device.deviceId,
      device.deviceAlias,
      device.memberId,
      device.memberName,
      device.role,
      device.contract,
      device.instance,
      serverId,
    ],
  );
}

export function setStopped(db: Db, serverId: string, stopped: Stopped | null): void {
  db.run("UPDATE sharing_servers SET stopped = ? WHERE server_id = ?", [stopped, serverId]);
}

export function setMuted(db: Db, serverId: string, muted: boolean): void {
  db.run("UPDATE sharing_servers SET muted = ? WHERE server_id = ?", [muted ? 1 : 0, serverId]);
}

/** A rebuilt server: the new instance, and a snapshot due since the cursors belonged to the old one. */
export function setInstance(db: Db, serverId: string, instance: string): void {
  db.run("UPDATE sharing_servers SET instance = ?, snapshot_due = 1 WHERE server_id = ?", [
    instance,
    serverId,
  ]);
}

/** The backlog summed over the confirmed, not stopped servers: what keeps an idle sync alive. */
export function totalBacklog(db: Db): number {
  return (
    db
      .query<{ n: number | null }, []>(
        "SELECT sum(backlog) AS n FROM sharing_servers WHERE confirmed_at IS NOT NULL AND stopped IS NULL",
      )
      .get()?.n ?? 0
  );
}

export function muteMember(db: Db, serverId: string, memberId: string, muted: boolean): void {
  if (muted)
    db.run("INSERT OR IGNORE INTO sharing_muted_members (server_id, member_id) VALUES (?, ?)", [
      serverId,
      memberId,
    ]);
  else
    db.run("DELETE FROM sharing_muted_members WHERE server_id = ? AND member_id = ?", [
      serverId,
      memberId,
    ]);
}

export function mutedMembers(db: Db, serverId: string): string[] {
  if (!hasServerTables(db)) return [];
  return db
    .query<{ member_id: string }, [string]>(
      "SELECT member_id FROM sharing_muted_members WHERE server_id = ? ORDER BY member_id",
    )
    .all(serverId)
    .map((row) => row.member_id);
}

/** The server's own row and its mutes; the ledger's tables are `ledger.ts`'s to clear. */
export function deleteServerRows(db: Db, serverId: string): void {
  withWrite(db, () => {
    db.run("DELETE FROM sharing_muted_members WHERE server_id = ?", [serverId]);
    db.run("DELETE FROM sharing_servers WHERE server_id = ?", [serverId]);
  });
}
