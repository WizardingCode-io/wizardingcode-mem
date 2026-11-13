// `serve restore`: puts back the copy of `team.db` an upgrade made before it migrated, for a
// rollback to the image that wrote that schema (ADR 0031). It runs in the newer image, with
// the server stopped. Without `yes` it only reads and prints: the copy, what going back to it
// loses, and the commands the older image must run before it starts. With `yes` it then moves
// the present database aside, whole, and puts the copy in its place. No row of the copy is
// ever written over the present file: the swap is two renames.
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import {
  type Db,
  openTeamCopy,
  openTeamPresent,
  openTeamStaging,
  TEAM_DB_FILE,
  TEAM_LATEST,
  teamBackups,
  teamPaths,
} from "./db.ts";
import { freeBytes as diskFreeBytes } from "./disk.ts";
import { NotATeamDatabaseError } from "./errors.ts";
import { newHexId } from "./ids.ts";
import { readHighWater, SEQUENCE_MARGIN } from "./instance.ts";
import { SERVE_LEASE } from "./lease.ts";
import {
  type AuditRow,
  auditSince,
  checkpointWal,
  claimLease,
  inCopy,
  integrityCheck,
  invitationsUsedSince,
  journalMode,
  leaseOf,
  liveInCopy,
  lostSince,
  quickCheck,
  releaseLease,
  sequenceHighWater,
  teamSchemaVersion,
  withdrawnSince,
} from "./store.ts";

export interface RestoreInput {
  dir: string;
  /** The schema to go back to: the one the older image runs. */
  toSchema: number;
  /** False: read and print. True: also do it. */
  yes: boolean;
  now: () => number;
  /** This binary's schema; tests pass one above the real one. */
  latest?: number;
  freeBytes?: (path: string) => number | null;
  copyFile?: (from: string, to: string) => void;
}

/** How long the restore's own lease keeps a server from starting: the copy of a large file fits in it. */
const RESTORE_LEASE_MS = 900_000;
/** The owner of the restore's lease starts with this; a refusal reads it to say who holds the lease. */
const RESTORE_OWNER = "restore-";

/** A restore that will not run, with the reason in words; nothing was changed. */
export class RestoreRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreRefused";
  }
}

/** What the copy must leave free beside its own size. */
const FREE_MARGIN_BYTES = 1_073_741_824;
const SIDE_FILES = ["-wal", "-shm"] as const;
const P = "docker compose run --rm server serve ";
const LOST = "lost with the restore";
const ITEM_NOTE = "the older image answers no such item if it arrived after the copy";
const NAME_NOTE = "the older image answers no such name if it was created after the copy";
const TOKEN_NOTE = "the device joins again with a new invitation";
const WITHDRAWN_NOTE =
  "the older image's withdrawal is the operator's: its member cannot send the item again until serve reinstate";

const iso = (ms: number): string => new Date(ms).toISOString();
// The same one line as `src/update/reason.ts` has: that folder imports nothing of the server's, nor the server of it.
const firstLine = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";

// What the lines print comes from the database, and some of it from members (a uid's alias, a
// device's label). The operator pastes the commands into a shell on the host, so nothing of
// it reaches a command unquoted, and no control character reaches the terminal at all.
// Control characters, and the format characters (a right-to-left override, a zero-width
// space) that make a line read on screen as something it is not.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it finds
const CONTROL = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/u;
const CONTROL_ALL = new RegExp(CONTROL.source, "gu");
const PLAIN = /^[A-Za-z0-9_.:@/-]+$/;

/**
 * A text for the left side of a line: every control and format character replaced, and no
 * arrow of its own, so the one `->` of a line is the restore's and what follows it is the
 * restore's word (a member's device label must not read as a command to run).
 */
const shown = (text: string): string => text.replace(CONTROL_ALL, "?").replaceAll("->", "-?");

/** A text as one shell argument: as it is when plain, single-quoted otherwise; null when it holds a control or format character. */
function arg(text: string): string | null {
  if (text === "" || CONTROL.test(text)) return null;
  return PLAIN.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

const KINDS: readonly string[] = ["entry", "memory"];
const ROLES: readonly string[] = ["admin", "member"];

/** The name in `folder` matching `pattern` whose first group is the greatest number. */
function newest(folder: string, pattern: RegExp): { name: string; n: number } | null {
  let best: { name: string; n: number } | null = null;
  for (const name of readdirSync(folder)) {
    const match = pattern.exec(name);
    if (match === null) continue;
    const n = Number(match[1]);
    if (best === null || n > best.n) best = { name, n };
  }
  return best;
}

function fsyncPath(path: string, flags: "r" | "r+"): void {
  let fd: number | null = null;
  try {
    fd = openSync(path, flags);
    fsyncSync(fd);
  } catch (error) {
    // A directory cannot be synced on every platform; the renames are still in place.
    const code = (error as { code?: unknown }).code;
    if (flags === "r+" || (code !== "EISDIR" && code !== "EPERM" && code !== "EINVAL")) throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** The side files of the database that was at `present` belong with it at `aside`. */
function moveSideFiles(present: string, aside: string): void {
  for (const suffix of SIDE_FILES) {
    if (existsSync(present + suffix)) renameSync(present + suffix, aside + suffix);
  }
}

/**
 * The file now at `present` must be a whole team database in WAL mode. The open is a writer's
 * although it writes no row: the file was moved in without its side files, and a read-only
 * connection that cannot create them fails to open a WAL database on some platforms (macOS).
 */
function checkInPlace(present: string, aside: string): void {
  const check = openTeamStaging(present);
  try {
    if (!integrityCheck(check) || journalMode(check) !== "wal") {
      throw new Error(
        `team.db is the upgrade copy but failed its check; the database as it was is ${aside}`,
      );
    }
  } finally {
    check.close();
  }
}

/**
 * Makes the staging file what the server expects: the open sets WAL (a copy made by
 * `VACUUM INTO` is in the rollback-journal mode); then the whole file is checked and its log
 * cut, and the side files go, so that one rename moves the database.
 */
function prepareStaging(staging: string): void {
  const staged = openTeamStaging(staging);
  try {
    if (!integrityCheck(staged)) {
      throw new RestoreRefused("the staging file failed its integrity check");
    }
    checkpointWal(staged);
  } finally {
    staged.close();
  }
  for (const suffix of SIDE_FILES) rmSync(staging + suffix, { force: true });
  fsyncPath(staging, "r+");
}

interface Redo {
  /** The command the older image runs to do the action again; null when it is lost. */
  command: string | null;
  note?: string;
}

const LOST_REDO: Redo = { command: null };

/** A command over one item: the kind must be one of the two known words, whoever wrote it. */
function itemCommand(
  verb: string,
  kind: string | undefined,
  target: string | null,
  note: string,
  flags = "",
): Redo {
  return target !== null && kind !== undefined && KINDS.includes(kind)
    ? { command: `${P}${verb} ${kind} ${target}${flags}`, note }
    : LOST_REDO;
}

/** The revision an `item withdrawn` audit row names (`<kind> revision <n>`); null out of that shape. */
function auditedRevision(detail: string): number | null {
  const match = /^\S+ revision (\d+)$/.exec(detail);
  return match === null ? null : Number(match[1]);
}

/**
 * What to do again for one audit row. It reads the row's `detail`, a text the writers shape:
 * `<kind> revision <n>` for `item withdrawn` (routes.ts, serve.ts), the kind alone for
 * `item reinstated`, `<kind>: <n> rows, …` for `purged` (mirror.ts), the role for `role set`,
 * `devices <n>, withdrawn <n>` for `member disabled`. A detail that is not in its shape makes
 * the line lost, never a command.
 */
function redo(row: AuditRow, copy: Db): Redo {
  const target = row.target === null ? null : arg(row.target);
  if (row.target === null || target === null) return LOST_REDO;
  const raw = row.target;
  const known = (table: "devices" | "members" | "invitations", command: string, note?: string) =>
    inCopy(copy, table, raw) ? { command, ...(note === undefined ? {} : { note }) } : LOST_REDO;
  const item = (verb: string, kind: string | undefined, flags = ""): Redo =>
    itemCommand(verb, kind, target, ITEM_NOTE, flags);
  switch (row.action) {
    case "device revoked":
      return known("devices", `${P}revoke ${target}`);
    case "member disabled":
      return known(
        "members",
        `${P}disable ${target}${/withdrawn [1-9]/.test(row.detail) ? " --withdraw" : ""}`,
      );
    case "member enabled":
      return known("members", `${P}enable ${target}`);
    case "role set":
      return ROLES.includes(row.detail)
        ? known("members", `${P}role ${target} ${row.detail}`)
        : LOST_REDO;
    // The copy holds the device's old token: the device is revoked.
    case "token rotated":
      return known("devices", `${P}revoke ${target}`, TOKEN_NOTE);
    case "invitation revoked":
      return known("invitations", `${P}invitation revoke ${target}`);
    // An item or a name is never asked of the copy: one that arrived after it is answered by
    // the older image itself, and a purge left unprinted would be an erasure undone in silence.
    case "item withdrawn":
      return item("withdraw", row.detail.split(" ")[0]);
    case "item reinstated":
      return item("reinstate", row.detail);
    case "purged":
      return item("purge", row.detail.split(":")[0], " --yes");
    case "name purged":
      return { command: `${P}purge name ${target} --yes`, note: NAME_NOTE };
    default:
      return LOST_REDO;
  }
}

/** One line of the list, and its note on a line of its own so that the command pastes whole. */
function listed(left: string, todo: Redo): string[] {
  const line = `${left} -> ${todo.command ?? LOST}`;
  return todo.command !== null && todo.note !== undefined ? [line, `  note: ${todo.note}`] : [line];
}

/** Finishes a restore that was killed between its two renames, or refuses. */
function finishCut(dir: string, present: string, staging: string, backups: string): string[] {
  const found = existsSync(backups) ? newest(backups, /^team-before-rollback-(\d+)\.db$/) : null;
  const aside = found === null ? null : join(backups, found.name);
  if (aside === null || !existsSync(staging)) {
    throw new RestoreRefused(
      `team.db is missing and there is no staging file${
        aside === null
          ? `; no aside file was found in ${backups}`
          : `; the database as it was is ${aside}, with its -wal and -shm beside it when they exist: the runbook's Rollback has the moves that put it back`
      }`,
    );
  }
  // The run that was cut may have died before or after it prepared the staging file.
  prepareStaging(staging);
  moveSideFiles(present, aside);
  renameSync(staging, present);
  fsyncPath(dir, "r");
  checkInPlace(present, aside);
  return [
    `finished=${present}`,
    `aside=${aside}`,
    "note=the list of what is lost was printed by the run that was cut",
  ];
}

interface Plan {
  copyPath: string;
  lines: string[];
}

/** Every check, through read-only opens, and the lines; throws `RestoreRefused` before anything is written. */
function plan(input: RestoreInput, latest: number, backups: string): Plan {
  const { dir, toSchema, now } = input;
  let db: Db | null = null;
  let copy: Db | null = null;
  try {
    const presentPath = join(dir, TEAM_DB_FILE);
    if (!existsSync(presentPath)) throw new RestoreRefused(`no team.db in ${dir}`);
    try {
      db = openTeamCopy(presentPath);
    } catch (error) {
      if (!(error instanceof NotATeamDatabaseError)) throw error;
      throw new RestoreRefused("team.db is not a team database");
    }
    const lease = leaseOf(db, SERVE_LEASE);
    if (lease !== null && lease.until > now()) {
      throw new RestoreRefused(
        lease.owner.startsWith(RESTORE_OWNER)
          ? `an earlier restore holds serve.lease until ${iso(lease.until)}: it is still running, or it was killed during its copy; run it again after that time`
          : `serve.lease is held by ${shown(lease.owner)} until ${iso(lease.until)}: stop the server first (a killed server's lease ends within 30 seconds)`,
      );
    }
    const present = teamSchemaVersion(db);
    if (present !== latest) {
      throw new RestoreRefused(
        `team.db is at schema ${present}, this binary runs ${latest}: run the restore with the image that left it`,
      );
    }
    if (toSchema >= latest) {
      throw new RestoreRefused(`nothing to go back to: this binary runs schema ${latest}`);
    }
    if (!existsSync(backups)) throw new RestoreRefused(`no backups folder at ${backups}`);
    const found = newest(
      backups,
      new RegExp(`^${teamBackups(dir).prefix}-(\\d+)-v${toSchema}-\\d+\\.db$`),
    );
    if (found === null) {
      throw new RestoreRefused(`no upgrade copy for schema ${toSchema} in ${backups}`);
    }
    const copyPath = join(backups, found.name);
    const ms = found.n;
    try {
      copy = openTeamCopy(copyPath);
      const version = teamSchemaVersion(copy);
      if (version !== toSchema) {
        throw new RestoreRefused(`${found.name}: its user_version is ${version}, not ${toSchema}`);
      }
      if (!quickCheck(copy)) throw new RestoreRefused(`${found.name} failed quick_check`);
    } catch (error) {
      if (error instanceof RestoreRefused) throw error;
      if (error instanceof NotATeamDatabaseError) {
        throw new RestoreRefused(`${found.name} is not a team database`);
      }
      throw new RestoreRefused(`${found.name}: ${firstLine(error)}`);
    }
    const free = (input.freeBytes ?? diskFreeBytes)(dir);
    const need = statSync(copyPath).size + FREE_MARGIN_BYTES;
    if (free !== null && free < need) {
      throw new RestoreRefused(
        `not enough free space: ${free} bytes free, ${need} needed (the copy and 1 GiB)`,
      );
    }

    const lines = [`would_restore=${copyPath}`, `copied_at=${iso(ms)}`];
    if (free === null) lines.push("disk=unknown");
    const lost = lostSince(db, ms);
    const audit = auditSince(db, ms);
    // A member's own withdrawal writes no audit row: the feed is asked for every item whose
    // current row is a withdrawal since the copy. One is left out only when an audit row
    // carries that very withdrawal, the same item at the same revision (an admin's, which has
    // its own line): matching the item alone would drop a member's withdrawal that came after
    // an admin's withdrawal and reinstatement. One of an item the copy never held is gone
    // with the item. Those a `disable --withdraw` made are listed again; running them twice
    // changes nothing.
    const audited = new Set(
      audit
        .filter((row) => row.action === "item withdrawn" && row.target !== null)
        .map((row) => `${row.target}@${auditedRevision(row.detail)}`),
    );
    const held = copy;
    const withdrawn = withdrawnSince(db, ms).filter(
      (item) => !audited.has(`${item.uid}@${item.revision}`) && liveInCopy(held, item.key),
    );
    const mark = Math.max(
      readHighWater(teamPaths(dir).feedFile).changes,
      sequenceHighWater(db, "changes"),
    );
    const lostChanges = Math.max(0, mark - sequenceHighWater(copy, "changes"));
    lines.push(
      `lost.entries_created=${lost.entriesCreated}`,
      `lost.entries_revised=${lost.entriesRevised}`,
      `lost.memories=${lost.memories}`,
      `lost.names=${lost.names}`,
      `lost.members=${lost.members}`,
      `lost.devices=${lost.devices}`,
      `lost.withdrawn=${withdrawn.length}`,
      `lost.changes=${lostChanges}`,
    );
    // The older image's renewal moves the sequence one margin past its own mark; the clients
    // have seen numbers up to the present mark, so it runs until the sequence is past that.
    const renewals = Math.floor(lostChanges / SEQUENCE_MARGIN) + 1;
    for (let i = 0; i < renewals; i++) lines.push(`run: ${P}instance renew`);
    for (const row of audit) {
      const left = [iso(row.at), row.source, row.action, row.target ?? "-", row.detail]
        .map(shown)
        .join(" ");
      lines.push(...listed(left, redo(row, copy)));
    }
    for (const item of withdrawn) {
      lines.push(
        ...listed(
          `${shown(item.kind)} ${shown(item.uid)} withdrawn since the copy`,
          itemCommand("withdraw", item.kind, arg(item.uid), WITHDRAWN_NOTE),
        ),
      );
    }
    for (const id of invitationsUsedSince(db, ms, now())) {
      const invitation = arg(id);
      const open = invitation !== null && inCopy(copy, "invitations", id);
      lines.push(
        ...listed(
          `invitation ${shown(id)}${open ? " used since the copy" : ""}`,
          open ? { command: `${P}invitation revoke ${invitation}` } : LOST_REDO,
        ),
      );
    }
    lines.push(`run: ${P}mirror --rebuild`);
    return { copyPath, lines };
  } finally {
    copy?.close();
    db?.close();
  }
}

function removeStaging(staging: string): void {
  for (const suffix of ["", ...SIDE_FILES]) rmSync(staging + suffix, { force: true });
}

/** The lines to print. Throws `RestoreRefused` when it will not run; anything else is a fault. */
export function restore(input: RestoreInput): string[] {
  const { dir, yes, now } = input;
  const latest = input.latest ?? TEAM_LATEST;
  const present = join(dir, TEAM_DB_FILE);
  const staging = `${present}.restoring`;
  const backups = teamBackups(dir).folder;

  if (yes && !existsSync(present)) return finishCut(dir, present, staging, backups);

  const { copyPath, lines } = plan(input, latest, backups);
  if (!yes) return lines;

  // The lease lives in the database about to be moved aside: it keeps a server from starting
  // on the present file while the copy is made, and is released before the swap.
  const writer = openTeamPresent(dir, latest);
  const owner = `${RESTORE_OWNER}${newHexId()}`;
  if (!claimLease(writer, SERVE_LEASE, owner, now(), RESTORE_LEASE_MS)) {
    writer.close();
    throw new RestoreRefused("serve.lease was taken: a server started; stop it first");
  }
  try {
    // Only now, with the lease held: a staging file found here is a run cut before its swap,
    // never the copy of a restore still running, which the lease check above would have met.
    removeStaging(staging);
    (input.copyFile ?? copyFileSync)(copyPath, staging);
    prepareStaging(staging);
    if (!claimLease(writer, SERVE_LEASE, owner, now(), RESTORE_LEASE_MS)) {
      throw new RestoreRefused("the lease was lost during the copy: a server started");
    }
    // The present file goes aside whole: its log is written into it first.
    if (!checkpointWal(writer)) throw new RestoreRefused("a reader holds team.db's log");
  } catch (error) {
    removeStaging(staging);
    try {
      releaseLease(writer, SERVE_LEASE, owner);
    } finally {
      writer.close();
    }
    throw error;
  }
  releaseLease(writer, SERVE_LEASE, owner);
  writer.close();

  const aside = join(backups, `team-before-rollback-${now()}.db`);
  renameSync(present, aside);
  moveSideFiles(present, aside);
  renameSync(staging, present);
  fsyncPath(dir, "r");
  checkInPlace(present, aside);

  return [`restored=${copyPath}`, `aside=${aside}`, ...lines.slice(1)];
}
