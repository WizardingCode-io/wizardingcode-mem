// `wizardingcode-mem serve`: the team server, and the subcommands an operator runs beside it
// (ADR 0026). The server logs to standard output; every subcommand sends the log to standard
// error, so its own output stands alone on standard output.
import { SchemaTooNewError } from "../../store/db.ts";
import { readAudit } from "../../team/audit.ts";
import { type Db, openTeamExisting, openTeamForWrite, teamPaths } from "../../team/db.ts";
import {
  HttpError,
  LeaseHeldError,
  NotATeamDatabaseError,
  SchemaBehindError,
  ServerRunningError,
  TEAM_SCHEMA_TOO_NEW,
} from "../../team/errors.ts";
import { OPERATOR } from "../../team/ids.ts";
import { currentMarks, renewInstance, writeHighWater } from "../../team/instance.ts";
import { requireNoServer } from "../../team/lease.ts";
import { createTeamLog, installLogSink, type TeamLog } from "../../team/log.ts";
import {
  checkRole,
  enableMember,
  inviteFrom,
  listDevices,
  listInvitations,
  listMembers,
  revokeDevice,
  revokeInvitation,
  setRole,
} from "../../team/members.ts";
import { purgeItem, runMirror } from "../../team/mirror.ts";
import { disableWithItems, reinstateByAdmin, withdrawByAdmin } from "../../team/push.ts";
import { startTeamServer } from "../../team/server.ts";
import { readStatus, renderStatus } from "../../team/status.ts";
import { insertAudit, sequenceHighWater } from "../../team/store.ts";
import { defaultDataDir } from "../../util/paths.ts";
import { EXIT_USAGE } from "../exit.ts";

const USAGE = `Usage: wizardingcode-mem serve [--data <dir>] [--host <addr>] [--port <n>] [--trust-proxy]
       wizardingcode-mem serve [--data <dir>] <subcommand> ...

Subcommands (each takes --data <dir> as well; health takes --url alone):
       invite --role admin|member --name <name> [--expires <hours>]
       invite --for <member id> [--expires <hours>]
       invitations
       invitation revoke <id>
       members
       revoke <device id>
       disable <member id> [--withdraw]
       enable <member id>
       role <member id> admin|member
       withdraw entry <uid> | memory remote:<alias>:<uid>
       reinstate entry <uid> | memory remote:<alias>:<uid>
       status [--json]
       audit [--limit <n>]
       mirror [--rebuild]
       purge entry <uid> | memory remote:<alias>:<uid> --yes
       instance renew
       health [--url <origin>]

The data directory is --data, WIZARDINGCODE_MEM_TEAM_DATA, or <data dir>/team.
`;

type Env = Record<string, string | undefined>;

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const HEALTH_TIMEOUT_MS = 3000;

const out = (line: string) => process.stdout.write(`${line}\n`);
const err = (line: string) => process.stderr.write(`${line}\n`);
const emit = (event: Record<string, unknown>) => out(JSON.stringify(event));

/** `WIZARDINGCODE_MEM_TEAM_DATA`, or `team/` under the product's data directory. */
export function resolveTeamDir(env: Env): string {
  const set = env.WIZARDINGCODE_MEM_TEAM_DATA;
  return set !== undefined && set !== "" ? set : `${defaultDataDir(env)}/team`;
}

interface ServeArgs {
  data: string;
  host: string;
  port: number;
  trustProxy: boolean;
}

/** The flag, then the environment, then the default. */
export function parseServeArgs(argv: string[], env: Env): ServeArgs | { error: string } {
  const parsed = parseFlags(argv, {
    data: "value",
    host: "value",
    port: "value",
    "trust-proxy": "flag",
  });
  if ("error" in parsed) return parsed;
  if (parsed.rest.length > 0) return { error: `unexpected argument "${parsed.rest[0]}"` };
  const port = Number(parsed.values.port ?? env.WIZARDINGCODE_MEM_TEAM_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    return { error: "port must be 0 to 65535" };
  return {
    data: (parsed.values.data as string | undefined) ?? resolveTeamDir(env),
    host:
      (parsed.values.host as string | undefined) ?? env.WIZARDINGCODE_MEM_TEAM_HOST ?? DEFAULT_HOST,
    port,
    trustProxy:
      parsed.values["trust-proxy"] === true || env.WIZARDINGCODE_MEM_TEAM_TRUST_PROXY === "on",
  };
}

type FlagKind = "value" | "flag";
interface Flags {
  values: Record<string, string | true>;
  rest: string[];
}

/** `--name value` and `--flag`; anything else is positional; an unknown `--x` is an error. */
function parseFlags(argv: string[], known: Record<string, FlagKind>): Flags | { error: string } {
  const values: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const kind = known[name];
    if (kind === undefined) return { error: `unknown flag ${arg}` };
    if (kind === "flag") {
      values[name] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { error: `${arg} needs a value` };
    values[name] = value;
    i++;
  }
  return { values, rest };
}

/**
 * `--data <dir>` taken out of a subcommand's arguments wherever it stands, so every
 * subcommand reads the directory the same way the server does (the child the server starts
 * passes it this way).
 */
function takeData(
  argv: string[],
): { data: string | undefined; rest: string[] } | { error: string } {
  const rest: string[] = [];
  let data: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--data") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) return { error: "--data needs a value" };
      data = value;
      i++;
      continue;
    }
    rest.push(arg);
  }
  return { data, rest };
}

function usage(message?: string): number {
  if (message !== undefined) err(`wizardingcode-mem serve: ${message}\n`);
  process.stderr.write(USAGE);
  return EXIT_USAGE;
}

/** What a thrown error means for the exit code, and its line on standard error. */
function exitFor(error: unknown): number {
  if (error instanceof SchemaTooNewError) {
    err(
      `wizardingcode-mem serve: team.db is at a newer schema than this binary; upgrade the image (${error.message})`,
    );
    return TEAM_SCHEMA_TOO_NEW;
  }
  if (error instanceof HttpError) {
    const hint = typeof error.body.hint === "string" ? ` (${error.body.hint})` : "";
    err(`wizardingcode-mem serve: ${String(error.body.error)}${hint}`);
    return error.status === 400 ? EXIT_USAGE : 1;
  }
  if (error instanceof LeaseHeldError) {
    err("wizardingcode-mem serve: a mirror run is in progress");
    return 1;
  }
  if (
    error instanceof SchemaBehindError ||
    error instanceof NotATeamDatabaseError ||
    error instanceof ServerRunningError
  ) {
    err(`wizardingcode-mem serve: ${error.message}`);
    return 1;
  }
  err(`wizardingcode-mem serve: ${error instanceof Error ? error.message : String(error)}`);
  return 1;
}

// --- The server ---------------------------------------------------------------------------

async function runServer(argv: string[]): Promise<number> {
  const args = parseServeArgs(argv, process.env);
  if ("error" in args) return usage(args.error);
  let server: Awaited<ReturnType<typeof startTeamServer>>;
  try {
    server = await startTeamServer({
      dataDir: args.data,
      host: args.host,
      port: args.port,
      trustProxy: args.trustProxy,
      stdout: out,
    });
  } catch (error) {
    return exitFor(error);
  }
  const bye = () => {
    void server.stop();
  };
  process.once("SIGTERM", bye);
  process.once("SIGINT", bye);
  await server.stopped();
  process.off("SIGTERM", bye);
  process.off("SIGINT", bye);
  return server.exitCode() ?? 0;
}

// --- The subcommands ------------------------------------------------------------------------

interface Shell {
  dir: string;
  log: TeamLog;
  now: number;
}

/** A writer: the database for write, the act, one audit row, the high-water file; the database closed. */
function write<T>(
  shell: Shell,
  fn: (db: Db) => {
    result: T;
    audit: { action: string; target?: string | null; detail?: string } | null;
  },
): T {
  const db = openTeamForWrite(shell.dir, shell.now);
  try {
    const { result, audit: row } = fn(db);
    if (row !== null) {
      insertAudit(db, {
        at: shell.now,
        source: "cli",
        action: row.action,
        target: row.target ?? null,
        detail: row.detail ?? "",
      });
    }
    writeHighWater(teamPaths(shell.dir).feedFile, currentMarks(db));
    return result;
  } finally {
    db.close();
  }
}

/** A reader: null when there is no database. */
function read<T>(shell: Shell, fn: (db: Db) => T): T | null {
  const db = openTeamExisting(shell.dir);
  if (db === null) return null;
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const noDatabase = (shell: Shell) => {
  err(`wizardingcode-mem serve: no team database at ${shell.dir}`);
  return 1;
};

const iso = (ms: number | null) => (ms === null ? "-" : new Date(ms).toISOString());

function invite(shell: Shell, argv: string[]): number {
  const parsed = parseFlags(argv, { role: "value", name: "value", for: "value", expires: "value" });
  if ("error" in parsed) return usage(parsed.error);
  const { values } = parsed;
  if (values.for === undefined && (values.role === undefined || values.name === undefined)) {
    return usage("invite needs --role and --name, or --for <member id>");
  }
  const code = write(shell, (db) => {
    const made = inviteFrom(
      db,
      {
        role: values.role,
        name: values.name,
        forMember: values.for,
        expiresInHours: values.expires === undefined ? undefined : Number(values.expires),
      },
      null,
      shell.now,
    );
    return {
      result: made.code,
      audit: { action: "invitation made", target: made.invitation.id, detail: made.detail },
    };
  });
  out(code);
  return 0;
}

function invitations(shell: Shell): number {
  const lines = read(shell, (db) =>
    listInvitations(db, shell.now).map(
      (row) =>
        `${row.id} ${row.role} ${row.name ?? row.forMember ?? "-"} ${row.createdByDevice ?? "cli"} ${iso(row.expiresAt)}`,
    ),
  );
  if (lines === null) return noDatabase(shell);
  for (const line of lines) out(line);
  return 0;
}

function invitationRevoke(shell: Shell, id: string | undefined): number {
  if (id === undefined) return usage("invitation revoke needs an id");
  const done = write(shell, (db) => {
    const revoked = revokeInvitation(db, id, shell.now);
    return {
      result: revoked,
      audit: revoked ? { action: "invitation revoked", target: id } : null,
    };
  });
  if (!done) {
    err("wizardingcode-mem serve: invitation unknown");
    return 1;
  }
  emit({ event: "invitation-revoked", id });
  return 0;
}

function members(shell: Shell): number {
  const lines = read(shell, (db) => {
    const rows: string[] = [];
    for (const member of listMembers(db)) {
      const devices = listDevices(db, member.id);
      const lastSeen = devices.reduce<number | null>(
        (latest, device) =>
          device.lastSeenAt !== null && (latest === null || device.lastSeenAt > latest)
            ? device.lastSeenAt
            : latest,
        null,
      );
      const state = member.disabledAt === null ? "active" : "disabled";
      rows.push(
        `${member.id} ${member.name} ${member.role} ${state} ${devices.length} ${iso(lastSeen)}`,
      );
      for (const device of devices) {
        rows.push(
          `  ${device.id} ${device.alias} ${device.label} ${iso(device.createdAt)} ${iso(device.lastSeenAt)} ${iso(device.revokedAt)}`,
        );
      }
    }
    return rows;
  });
  if (lines === null) return noDatabase(shell);
  for (const line of lines) out(line);
  return 0;
}

function revoke(shell: Shell, id: string | undefined): number {
  if (id === undefined) return usage("revoke needs a device id");
  write(shell, (db) => {
    revokeDevice(db, id, shell.now);
    return { result: undefined, audit: { action: "device revoked", target: id } };
  });
  emit({ event: "device-revoked", id });
  return 0;
}

function disable(shell: Shell, argv: string[]): number {
  const parsed = parseFlags(argv, { withdraw: "flag" });
  if ("error" in parsed) return usage(parsed.error);
  const id = parsed.rest[0];
  if (id === undefined) return usage("disable needs a member id");
  const done = write(shell, (db) => {
    const result = disableWithItems(db, id, shell.now, parsed.values.withdraw === true, OPERATOR);
    return {
      result,
      audit: { action: "member disabled", target: id, detail: result.detail },
    };
  });
  emit({ event: "member-disabled", id, devices: done.devices, withdrawn: done.withdrawn });
  return 0;
}

function enable(shell: Shell, id: string | undefined): number {
  if (id === undefined) return usage("enable needs a member id");
  write(shell, (db) => {
    enableMember(db, id);
    return { result: undefined, audit: { action: "member enabled", target: id } };
  });
  emit({ event: "member-enabled", id });
  return 0;
}

function role(shell: Shell, id: string | undefined, raw: string | undefined): number {
  if (id === undefined || raw === undefined)
    return usage("role needs a member id and admin|member");
  const wanted = checkRole(raw);
  write(shell, (db) => {
    setRole(db, id, wanted, shell.now);
    return { result: undefined, audit: { action: "role set", target: id, detail: wanted } };
  });
  emit({ event: "role-set", id, role: wanted });
  return 0;
}

function itemKind(raw: string | undefined): "entry" | "memory" | null {
  return raw === "entry" || raw === "memory" ? raw : null;
}

function withdraw(shell: Shell, rawKind: string | undefined, uid: string | undefined): number {
  const kind = itemKind(rawKind);
  if (kind === null || uid === undefined)
    return usage("withdraw needs entry <uid> or memory remote:<alias>:<uid>");
  const { revision } = write(shell, (db) => {
    const result = withdrawByAdmin(db, kind, uid, shell.now, OPERATOR);
    return {
      result,
      audit: {
        action: "item withdrawn",
        target: uid,
        detail: `${kind} revision ${result.revision}`,
      },
    };
  });
  emit({ event: "withdrawn", uid, revision });
  return 0;
}

function reinstate(shell: Shell, rawKind: string | undefined, uid: string | undefined): number {
  const kind = itemKind(rawKind);
  if (kind === null || uid === undefined)
    return usage("reinstate needs entry <uid> or memory remote:<alias>:<uid>");
  write(shell, (db) => {
    reinstateByAdmin(db, kind, uid);
    return { result: undefined, audit: { action: "item reinstated", target: uid, detail: kind } };
  });
  emit({ event: "reinstated", uid });
  return 0;
}

function status(shell: Shell, argv: string[]): number {
  const parsed = parseFlags(argv, { json: "flag" });
  if ("error" in parsed) return usage(parsed.error);
  const report = readStatus(shell.dir, shell.now);
  if (report === null) return noDatabase(shell);
  process.stdout.write(
    parsed.values.json === true ? `${JSON.stringify(report, null, 2)}\n` : renderStatus(report),
  );
  return 0;
}

function auditRows(shell: Shell, argv: string[]): number {
  const parsed = parseFlags(argv, { limit: "value" });
  if ("error" in parsed) return usage(parsed.error);
  const limit = parsed.values.limit === undefined ? undefined : Number(parsed.values.limit);
  const lines = read(shell, (db) =>
    readAudit(db, limit).map(
      (row) =>
        `${iso(row.at)} ${row.source} ${row.action} ${row.target ?? "-"} ${row.deviceId ?? "-"} ${row.address ?? "-"} ${row.detail}`,
    ),
  );
  if (lines === null) return noDatabase(shell);
  for (const line of lines) out(line);
  return 0;
}

async function mirror(shell: Shell, argv: string[]): Promise<number> {
  const parsed = parseFlags(argv, { rebuild: "flag" });
  if ("error" in parsed) return usage(parsed.error);
  const db = openTeamForWrite(shell.dir, shell.now);
  try {
    const run = runMirror(
      { db, dataDir: shell.dir, env: process.env, log: shell.log, now: () => Date.now() },
      { rebuild: parsed.values.rebuild === true },
    );
    emit({ event: "mirror", commits: run.commits, errors: run.errors });
    return run.errors.length === 0 ? 0 : 1;
  } finally {
    db.close();
  }
}

async function purge(shell: Shell, argv: string[]): Promise<number> {
  const parsed = parseFlags(argv, { yes: "flag" });
  if ("error" in parsed) return usage(parsed.error);
  const kind = itemKind(parsed.rest[0]);
  const uid = parsed.rest[1];
  if (kind === null || uid === undefined)
    return usage("purge needs entry <uid> or memory remote:<alias>:<uid>");
  if (parsed.values.yes !== true) return usage("purge erases durably: add --yes");
  const db = openTeamForWrite(shell.dir, shell.now);
  try {
    // The erasure, its audit row and the repositories' replay, under the mirror lease.
    const result = purgeItem(
      { db, dataDir: shell.dir, env: process.env, log: shell.log, now: () => Date.now() },
      kind,
      uid,
      shell.now,
    );
    writeHighWater(teamPaths(shell.dir).feedFile, currentMarks(db));
    emit({ event: "purged", uid, ...result });
    return result.errors.length === 0 ? 0 : 1;
  } finally {
    db.close();
  }
}

function instanceRenew(shell: Shell): number {
  const instance = write(shell, (db) => {
    requireNoServer(db, shell.now, "instance renew");
    const renewed = renewInstance(
      db,
      teamPaths(shell.dir).feedFile,
      shell.now,
      "cli",
      sequenceHighWater(db, "changes"),
      "renewed by hand",
    );
    // `renewInstance` wrote its own audit row.
    return { result: renewed, audit: null };
  });
  emit({ event: "instance-renewed", instance });
  return 0;
}

async function health(argv: string[]): Promise<number> {
  const parsed = parseFlags(argv, { url: "value" });
  if ("error" in parsed) return usage(parsed.error);
  const port = process.env.WIZARDINGCODE_MEM_TEAM_PORT ?? String(DEFAULT_PORT);
  const origin = (parsed.values.url as string | undefined) ?? `http://127.0.0.1:${port}`;
  try {
    const response = await fetch(`${origin.replace(/\/$/, "")}/v1/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const text = await response.text();
    out(text.trim());
    const body = JSON.parse(text) as { ok?: unknown };
    return body.ok === true ? 0 : 1;
  } catch (error) {
    err(
      `wizardingcode-mem serve: health failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

export async function run(argv: string[]): Promise<number> {
  if (argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  const taken = takeData(argv);
  if ("error" in taken) return usage(taken.error);
  const [sub, ...rest] = taken.rest;
  // No subcommand, or flags alone: the server, which parses its own flags (`--data` among them).
  if (sub === undefined || sub.startsWith("--")) return runServer(argv);
  // Every subcommand's log goes to standard error, so standard output carries its own output alone.
  const log = createTeamLog(err, Date.now);
  const uninstall = installLogSink(log);
  const shell: Shell = { dir: taken.data ?? resolveTeamDir(process.env), log, now: Date.now() };
  try {
    switch (sub) {
      case "invite":
        return invite(shell, rest);
      case "invitations":
        return invitations(shell);
      case "invitation":
        if (rest[0] !== "revoke") return usage(`unknown subcommand "invitation ${rest[0] ?? ""}"`);
        return invitationRevoke(shell, rest[1]);
      case "members":
        return members(shell);
      case "revoke":
        return revoke(shell, rest[0]);
      case "disable":
        return disable(shell, rest);
      case "enable":
        return enable(shell, rest[0]);
      case "role":
        return role(shell, rest[0], rest[1]);
      case "withdraw":
        return withdraw(shell, rest[0], rest[1]);
      case "reinstate":
        return reinstate(shell, rest[0], rest[1]);
      case "status":
        return status(shell, rest);
      case "audit":
        return auditRows(shell, rest);
      case "mirror":
        return await mirror(shell, rest);
      case "purge":
        return await purge(shell, rest);
      case "instance":
        if (rest[0] !== "renew") return usage(`unknown subcommand "instance ${rest[0] ?? ""}"`);
        return instanceRenew(shell);
      case "health":
        return await health(rest);
      default:
        return usage(`unknown subcommand "${sub}"`);
    }
  } catch (error) {
    return exitFor(error);
  } finally {
    uninstall();
  }
}
