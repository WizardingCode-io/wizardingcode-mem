// What the sharing policy keeps in the database, and the one path that writes the two
// sharing lists to the env file. Nothing here loads a policy: a write reads what it needs
// under its own write lock, so what a caller saw earlier never decides what is written.
import { join } from "node:path";
import { isHostLedAlias, isSharedName, isTeamAlias } from "../core/identity.ts";
import { ENV_FILE, readEnvFile, writeEnvFile } from "../settings/env-file.ts";
import { parseShareList, type SettingKey, type SharingKey } from "../settings/settings.ts";
import { type Db, withWrite } from "../store/db.ts";
import { getMeta, setMeta } from "../store/meta.ts";
import { plural } from "../util/text.ts";
import { DESTINATIONS, destinationsOf, effectiveLevel, levelOf } from "./levels.ts";
import { GENERATION_KEY, newGeneration } from "./migrations.ts";
import {
  isLevel,
  isRoot,
  LEVEL_LABELS,
  LEVELS,
  type Level,
  NAME_STATES,
  nameFlagKey,
  type Root,
  type SharingPolicy,
  shareListText,
  TEAM_DESTINATION,
  widens,
} from "./types.ts";

export { GENERATION_KEY, newGeneration };

/** The `meta` key of the change counter: an integer as text, 0 when absent. */
export const COUNTER_KEY = "sharing.counter";

/**
 * The `meta` key of the baseline: the env file's own lists as last recorded, as JSON. It
 * exists for the audit only: a file that differs from it was edited by hand since.
 */
export const SETTINGS_SEEN_KEY = "sharing.settings_seen";

/** The roots and the areas of one reading: the file's, the baseline's, a server's. Each list sorted. */
export interface Lists {
  roots: Root[];
  areas: string[];
}

const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS" satisfies SharingKey;
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS" satisfies SharingKey;

/** The sharing keys, in the order a preview answers them, with each one's name in the log. */
const LOGGED_AS = { [ROOTS_KEY]: "roots", [AREAS_KEY]: "areas" } as const;
const SHARE_KEYS: readonly SharingKey[] = [ROOTS_KEY, AREAS_KEY];

// --- The counter and the generation ---------------------------------------------------

/** How many changes the policy has seen. */
export function counterOf(db: Db): number {
  const counter = Number(getMeta(db, COUNTER_KEY) ?? 0);
  return Number.isSafeInteger(counter) && counter > 0 ? counter : 0;
}

/** Adds one, once per change, inside the `withWrite` of the change it counts. */
export function bumpCounter(db: Db): number {
  const next = counterOf(db) + 1;
  setMeta(db, COUNTER_KEY, String(next));
  return next;
}

/**
 * The store's generation; null on a store that never ran the sharing schema. It only reads:
 * the migration mints the first one and a restore renews it, nothing else.
 */
export function generationOf(db: Db): string | null {
  return getMeta(db, GENERATION_KEY);
}

// --- The change log -------------------------------------------------------------------

/**
 * Who made a change: a person in the viewer or the CLI, a restore, a hand edit of the env
 * file recorded when it was found, or the engine removing a level that no longer holds.
 */
export type ChangeSource = "viewer" | "cli" | "restore" | "file" | "system";

export interface ChangeRow {
  id: number;
  at: number;
  source: ChangeSource;
  /** `project:<id>`, `roots`, `areas` or `levels`. */
  what: string;
  /** What it was: a level, a list as comma text or `none`, or `rebind` (see `REBIND`). */
  old: string;
  new: string;
}

/**
 * What the log holds as `old` where a level whose alias was gone is set again: it read
 * `local`, and the row says instead that the level was bound to the alias the project
 * has now.
 */
export const REBIND = "rebind";

function logChange(
  db: Db,
  at: number,
  source: ChangeSource,
  what: string,
  old: string,
  next: string,
): void {
  db.run("INSERT INTO sharing_changes (at, source, what, old, new) VALUES (?, ?, ?, ?, ?)", [
    at,
    source,
    what,
    old,
    next,
  ]);
}

/** The newest changes, newest first. */
export function recentChanges(db: Db, limit: number): ChangeRow[] {
  return db
    .query<ChangeRow, [number]>(
      "SELECT id, at, source, what, old, new FROM sharing_changes ORDER BY id DESC LIMIT ?",
    )
    .all(limit);
}

export function lastChange(db: Db): ChangeRow | null {
  return recentChanges(db, 1)[0] ?? null;
}

/** Whether a person's own change (`cli` or `viewer`) to one of `whats` was logged after `at`. */
export function ownChangeAfter(db: Db, at: number, whats: readonly string[]): boolean {
  return (
    (db
      .query<{ n: number }, [number, string]>(
        `SELECT count(*) AS n FROM sharing_changes
          WHERE source IN ('cli', 'viewer') AND at > ? AND what IN (SELECT value FROM json_each(?))`,
      )
      .get(at, JSON.stringify(whats))?.n ?? 0) > 0
  );
}

// --- The levels as stored ---------------------------------------------------------------

/** A level as stored: `level` is whatever the row holds, not yet checked against the levels. */
export interface StoredLevel {
  projectId: number;
  destination: string;
  level: string;
  boundAlias: string;
  setAt: number;
  source: ChangeSource;
  /** The registry id of the shared name the level is bound to; null for a remote, and before the column. */
  nameId: string | null;
}

/** Whether the store holds a table (or a view) of this name, asked of `sqlite_master`. */
export function hasTable(db: Db, name: string): boolean {
  return (
    db.query<unknown, [string]>("SELECT 1 FROM sqlite_master WHERE name = ?").get(name) !== null
  );
}

/**
 * Whether the store ever ran the sharing schema, asked of `sqlite_master` by name. The
 * recorded module version cannot say: a store no module ever migrated reads as current.
 */
export function hasLevelsTable(db: Db): boolean {
  return hasTable(db, "sharing_levels");
}

/**
 * Every stored level, as written; what each is worth now is `effectiveLevel`'s to say. The
 * table must exist: a reader of a store that may never have run the sharing schema asks
 * `hasLevelsTable` first.
 */
export function levelRows(db: Db): StoredLevel[] {
  return db
    .query<StoredLevel, []>(
      `SELECT project_id AS projectId, destination, level, bound_alias AS boundAlias,
              set_at AS setAt, source, ${nameIdColumn(db)} AS nameId
         FROM sharing_levels ORDER BY project_id, destination`,
    )
    .all();
}

/** Whether `sharing_levels` has the column `name_id` (sharing 3), asked of the table once per open. */
const nameIdKnown = new WeakMap<Db, boolean>();
function hasNameIdColumn(db: Db): boolean {
  let known = nameIdKnown.get(db);
  if (known === undefined) {
    known = db
      .query<{ name: string }, []>("PRAGMA table_info(sharing_levels)")
      .all()
      .some((column) => column.name === "name_id");
    nameIdKnown.set(db, known);
  }
  return known;
}

/** The column to read the name's id from: `NULL` on a store whose sharing namespace is older. */
function nameIdColumn(db: Db): string {
  return hasNameIdColumn(db) ? "name_id" : "NULL";
}

/** What a refusal's sentence may name: the shared name (its slug) and the other project. */
export interface RefusalDetail {
  name?: string;
  other?: string;
}

const SET_LEVEL_MESSAGES = {
  "no-project": "this folder is not a known project; start a session here first",
  "no-name": "this project has no git remote; give it a shared name",
  "has-remote":
    "this project is matched by its git remote; a teammate adds the same remote to join it",
  renamed: (detail: RefusalDetail) =>
    `this project is shared as \`${detail.name ?? "another name"}\`; set it to Nothing first to leave that name`,
  "name-taken": (detail: RefusalDetail) =>
    `\`${detail.name ?? "that name"}\` is the shared name of \`${detail.other ?? "another project"}\`; that project forgets its name at Nothing`,
  "name-bound": "this project is shared under its name; set it to Nothing first to forget it",
  disabled: "memory is off for this project",
  invalid: `the level is one of ${LEVELS.join(", ")}`,
  "one-server": "this project is bound to another server; set it to Nothing there first",
  "needs-confirm": "confirm: true is required to widen sharing",
} as const;

/** Why a level was not set, or a name not forgotten. */
export type SetLevelRefusal = keyof typeof SET_LEVEL_MESSAGES;

/** A refusal, as a sentence a person can act on; the detail fills the names a sentence holds. */
export function setLevelMessage(reason: SetLevelRefusal, detail: RefusalDetail = {}): string {
  const entry: string | ((detail: RefusalDetail) => string) | undefined =
    SET_LEVEL_MESSAGES[reason];
  if (entry === undefined) throw new Error(`no sentence for the refusal ${reason}`);
  return typeof entry === "function" ? entry(detail) : entry;
}

// --- Setting a project's level ----------------------------------------------------------

/** What a level depends on in its project: that it exists, that memory is on, its aliases. */
export interface ProjectState {
  known: boolean;
  disabled: boolean;
  /** Every alias of the project, by name. */
  aliases: string[];
}

/**
 * A project as a write must see it: read inside the caller's transaction, so that the level
 * is judged against the project as it is when the write happens.
 */
export function projectState(db: Db, projectId: number): ProjectState {
  const project = db
    .query<{ disabled: number }, [number]>("SELECT disabled FROM projects WHERE id = ?")
    .get(projectId);
  if (project === null) return { known: false, disabled: false, aliases: [] };
  const aliases = db
    .query<{ alias: string }, [number]>(
      "SELECT alias FROM project_aliases WHERE project_id = ? ORDER BY alias",
    )
    .all(projectId);
  return {
    known: true,
    disabled: project.disabled === 1,
    aliases: aliases.map((row) => row.alias),
  };
}

/**
 * What setting a level would do under the policy a person is looking at: the level in
 * force, and whether the new one lets more leave. The check made before a person is asked;
 * `setLevel` checks again, against what the store holds by then.
 */
export function previewLevel(
  policy: SharingPolicy,
  projectId: number,
  level: Level,
  destination: string = policy.server ?? TEAM_DESTINATION,
): { current: Level; widened: boolean } {
  const current = levelOf(policy, projectId, destination).level;
  return { current, widened: widens(current, level) };
}

export interface SetLevelInput {
  projectId: number;
  destination: string;
  level: Level;
  source: Extract<ChangeSource, "viewer" | "cli">;
  now: number;
  /** A person agreed to let more leave. Without it a widening is refused. */
  confirm: boolean;
  /** The remote alias of the folder the person is in: bound to, when it is the project's. */
  remoteAlias?: string | null;
  /** A shared name (`name:<slug>`, through `sharedNameOf`) to bind to, created or joined (ADR 0028). */
  as?: string | null;
  /** The registry id of the name created or joined, stored with the row. */
  nameId?: string | null;
  /** Answer what the write would do, and write nothing: a read, never the write lock. */
  dryRun?: boolean;
  /** The caller read the re-created flag for the bound name: joining it again is confirmed again. */
  recreated?: boolean;
}

/**
 * What a level set did. `old` is the level that was in force; `boundAlias` the alias the
 * level is bound to, empty for `local`; `rebound` says that a level whose alias was gone is
 * bound to another one now; `named` that this call gave the project its shared name. A
 * refusal names the other server (`one-server`) or the other project (`name-taken`).
 */
export type SetLevelOutcome =
  | {
      ok: true;
      old: Level;
      widened: boolean;
      boundAlias: string;
      rebound: boolean;
      named: boolean;
    }
  | { ok: false; reason: SetLevelRefusal; server?: string; other?: string };

type Bound = { level: string; boundAlias: string; nameId: string | null };

function storedLevel(db: Db, projectId: number, destination: string): Bound | null {
  return db
    .query<Bound, [number, string]>(
      `SELECT level, bound_alias AS boundAlias, ${nameIdColumn(db)} AS nameId FROM sharing_levels
        WHERE project_id = ? AND destination = ?`,
    )
    .get(projectId, destination);
}

/** Whether a level above Nothing is stored for the project, on any destination. */
function boundAboveNothing(db: Db, projectId: number): boolean {
  return (
    db
      .query<unknown, [number]>(
        "SELECT 1 FROM sharing_levels WHERE project_id = ? AND level != 'local' LIMIT 1",
      )
      .get(projectId) !== null
  );
}

/** The project an alias names, with its name; null for an alias no project carries. */
function ownerOfAlias(db: Db, alias: string): { projectId: number; name: string } | null {
  return db
    .query<{ projectId: number; name: string }, [string]>(
      `SELECT a.project_id AS projectId, p.name FROM project_aliases a
         JOIN projects p ON p.id = a.project_id WHERE a.alias = ?`,
    )
    .get(alias);
}

function removeLevel(db: Db, projectId: number, destination: string): void {
  db.run("DELETE FROM sharing_levels WHERE project_id = ? AND destination = ?", [
    projectId,
    destination,
  ]);
}

/** The confirmed server, other than `destination`, a project is bound to above Nothing; null when none. */
function otherBinding(
  db: Db,
  projectId: number,
  destination: string,
  destinations: ReadonlySet<string>,
): string | null {
  const rows = db
    .query<{ destination: string }, [number, string]>(
      "SELECT destination FROM sharing_levels WHERE project_id = ? AND level != 'local' AND destination != ?",
    )
    .all(projectId, destination);
  return rows.map((row) => row.destination).find((other) => destinations.has(other)) ?? null;
}

/**
 * The unbound row of a server and alias (ADR 0027): written when the last enabled project bound
 * under the alias goes to Nothing, so the pull's reconcile removes the received copies; removed
 * when a project is bound under it again. Only for a server: the team's default has no pull.
 */
function noteUnbound(
  db: Db,
  serverId: string,
  alias: string,
  projectId: number,
  now: number,
): void {
  if (!hasTable(db, "sharing_unbound")) return;
  const stillBound =
    db
      .query<{ n: number }, [string, string, number]>(
        `SELECT count(*) AS n FROM sharing_levels l JOIN projects p ON p.id = l.project_id
          WHERE l.destination = ? AND l.bound_alias = ? AND l.level != 'local'
            AND l.project_id != ? AND p.disabled = 0`,
      )
      .get(serverId, alias, projectId)?.n ?? 0;
  if (stillBound > 0) return;
  db.run("INSERT OR IGNORE INTO sharing_unbound (server_id, alias, at) VALUES (?, ?, ?)", [
    serverId,
    alias,
    now,
  ]);
}

function clearUnbound(db: Db, serverId: string, alias: string): void {
  if (!hasTable(db, "sharing_unbound")) return;
  db.run("DELETE FROM sharing_unbound WHERE server_id = ? AND alias = ?", [serverId, alias]);
}

/**
 * The alias a level is bound to as it is written (ADR 0028): the one a stored level above
 * Nothing is bound to already, while the project still carries it and a team can know the
 * project by it, so that a change of level alone never moves the name a team knows the
 * project by; else the first of the candidates, in the caller's order (`as`, the name the
 * project carries, the folder's host-led remote, the first host-led remote by bytes).
 * Undefined with no candidate: a project with nothing a team can match.
 */
function aliasToBind(
  candidates: readonly (string | null)[],
  stored: Bound | null,
  carried: readonly string[],
): string | undefined {
  if (
    stored !== null &&
    stored.level !== "local" &&
    carried.includes(stored.boundAlias) &&
    isTeamAlias(stored.boundAlias)
  ) {
    return stored.boundAlias;
  }
  return candidates.find((candidate): candidate is string => candidate !== null);
}

/**
 * Sets one project's level for one destination. Everything is read inside the write's own
 * transaction, never taken from a policy the caller loaded: another process may have moved
 * the row or the project since. What can never be done is refused before a confirmation is
 * asked for, so nobody confirms a widening that is then refused, and every caller gets the
 * refusals in one order from here (ADR 0025, ADR 0028):
 *
 * 1. The level must be one of the levels (`invalid`) and the project exist (`no-project`).
 * 2. `local` removes the stored row, also one that only reads `local` (a disabled project,
 *    a lost alias): the person chose Nothing, and nothing may bring the level back. It is
 *    refused for nothing else, and the project's shared name is kept.
 * 3. Above `local` the project must have memory on (`disabled`). With `as`, a shared name
 *    the project does not carry: a project with a host-led remote and no name is matched by
 *    its remote (`has-remote`); one shared above Nothing under another name keeps that name
 *    (`renamed`); another project's name is not this one's (`name-taken`, with that project's
 *    name).
 * 4. The level is bound to one alias (`aliasToBind`): the one it is bound to already while
 *    the project carries it, else `as`, else the name the project carries, else the folder's
 *    host-led remote, else the project's first host-led remote by bytes; with none,
 *    `no-name`. One server per project (`one-server`).
 * 5. A later level than the one in force is a widening, and a binding that creates or joins
 *    a shared name (`as`, with no stored row bound to it, or the name re-created on the
 *    server) is a step a person takes: either without `confirm` is `needs-confirm`.
 * 6. The level already in force, under the same binding, writes nothing and logs nothing.
 *    Any other is written: a new name's alias row first (an older name of the project
 *    replaced, logged as `name:<id>` from the old to the new), then the level row with the
 *    name's id, logged as `project:<id>` (`project:<id>@<server>` once a server is confirmed)
 *    from the level in force to the new one, and counted once. A stored level whose alias was
 *    gone is thereby bound to an alias the project has now: the log says `rebind` for what it
 *    was, and the outcome says `rebound`.
 *
 * `dryRun` runs the same chain in a deferred read transaction, writes nothing and answers
 * what the write would, so a caller can ask a server for the name between the two.
 * A destination that is not configured, and an `as` that is no shared name, are the
 * caller's mistake, not a person's: they throw.
 */
export function setLevel(db: Db, input: SetLevelInput): SetLevelOutcome {
  const { projectId, destination, level, source, now } = input;
  const as = input.as ?? null;
  if (as !== null && !isSharedName(as)) throw new Error(`${as} is not a shared name`);
  const destinations = destinationsOf(db);
  if (!destinations.has(destination)) {
    throw new Error(`the sharing destination ${destination} is not configured`);
  }
  const ofServer = destinations !== DESTINATIONS;
  const write = input.dryRun !== true;
  const refused = (
    reason: SetLevelRefusal,
    extra: { server?: string; other?: string } = {},
  ): SetLevelOutcome => ({ ok: false, reason, ...extra });
  const done = (
    old: Level,
    widened: boolean,
    boundAlias: string,
    rebound: boolean,
    named: boolean,
  ): SetLevelOutcome => ({ ok: true, old, widened, boundAlias, rebound, named });
  // The log names the server once there is one (ADR 0027); the team's default as before.
  const what = ofServer ? `project:${projectId}@${destination}` : `project:${projectId}`;
  const run = (): SetLevelOutcome => {
    if (!isLevel(level)) return refused("invalid");
    const project = projectState(db, projectId);
    if (!project.known) return refused("no-project");
    const stored = storedLevel(db, projectId, destination);
    const inForce = effectiveLevel(stored, project, destination, destinations);
    // The level as the person set it, while the row is in force: `receive` reads `local`
    // for what leaves, but a stored `receive` set to `receive` again changes nothing.
    const current: Level =
      stored !== null &&
      isLevel(stored.level) &&
      (inForce.reason === "allowed" || inForce.reason === "level-receive")
        ? stored.level
        : inForce.level;

    if (level === "local") {
      // A row stored at `local` already says Nothing: there is nothing to remove or log.
      if (write && stored !== null && stored.level !== level) {
        removeLevel(db, projectId, destination);
        logChange(db, now, source, what, stored.level, level);
        if (ofServer) noteUnbound(db, destination, stored.boundAlias, projectId, now);
        // Nothing leaves the name's flags behind (missing, re-created, purged; ADR 0028).
        if (ofServer && isSharedName(stored.boundAlias)) {
          for (const state of NAME_STATES) {
            db.run("DELETE FROM meta WHERE key = ?", [
              nameFlagKey(state, destination, stored.boundAlias),
            ]);
          }
        }
        bumpCounter(db);
      }
      return done(inForce.level, false, "", false, false);
    }

    if (project.disabled) return refused("disabled");
    const remotes = project.aliases.filter(isHostLedAlias).sort();
    const name = project.aliases.find(isSharedName) ?? null;
    // A name the project does not carry yet: this call's alias row, once the rules allow it.
    const naming = as !== null && as !== name;
    if (naming) {
      if (remotes.length > 0 && name === null) return refused("has-remote");
      if (name !== null && boundAboveNothing(db, projectId)) return refused("renamed");
      const owner = ownerOfAlias(db, as);
      if (owner !== null && owner.projectId !== projectId) {
        return refused("name-taken", { other: owner.name });
      }
    }
    const carried = naming
      ? [...project.aliases.filter((alias) => alias !== name), as]
      : project.aliases;
    const folderRemote =
      typeof input.remoteAlias === "string" && remotes.includes(input.remoteAlias)
        ? input.remoteAlias
        : null;
    const boundAlias = aliasToBind(
      [as, naming ? null : name, folderRemote, remotes[0] ?? null],
      stored,
      carried,
    );
    if (boundAlias === undefined) return refused("no-name");
    // One server per project (ADR 0027): bound elsewhere, it is refused here.
    const elsewhere = ofServer ? otherBinding(db, projectId, destination, destinations) : null;
    if (elsewhere !== null) return refused("one-server", { server: elsewhere });
    const sameBinding =
      stored !== null && stored.level !== "local" && stored.boundAlias === boundAlias;
    const binding = as !== null && (!sameBinding || input.recreated === true);
    const widened = widens(inForce.level, level);
    if ((widened || binding) && !input.confirm) return refused("needs-confirm");
    if (stored !== null && current === level && !binding) {
      return done(current, widened, stored.boundAlias, false, false);
    }

    const rebound = inForce.reason === "unbound-alias";
    if (write) {
      if (naming) {
        if (name !== null) {
          db.run("DELETE FROM project_aliases WHERE alias = ? AND project_id = ?", [
            name,
            projectId,
          ]);
          logChange(db, now, source, `name:${projectId}`, name, as);
        }
        db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [as, projectId]);
      }
      // The name's registry id travels with the row: the caller's, else the one the row
      // holds for the same name; null for a remote.
      const nameId = isSharedName(boundAlias)
        ? (input.nameId ??
          (stored !== null && stored.boundAlias === boundAlias ? stored.nameId : null))
        : null;
      db.run(
        `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source, name_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (project_id, destination) DO UPDATE SET
           level = excluded.level, bound_alias = excluded.bound_alias,
           set_at = excluded.set_at, source = excluded.source, name_id = excluded.name_id`,
        [projectId, destination, level, boundAlias, now, source, nameId],
      );
      logChange(db, now, source, what, rebound ? REBIND : current, level);
      if (ofServer) clearUnbound(db, destination, boundAlias);
      bumpCounter(db);
    }
    return done(current, widened, boundAlias, rebound, naming);
  };
  return write ? withWrite(db, run) : db.transaction(run)();
}

/** What forgetting a project's shared name did, or why it was refused. */
export type ForgetNameOutcome =
  | { ok: true; alias: string }
  | { ok: false; reason: "name-bound" | "no-name" | "no-project" };

/**
 * Forgets a project's shared name (ADR 0028): refused while a level above Nothing is stored
 * for the project on any destination (`name-bound`), for a project with no name (`no-name`)
 * and for an id the store does not know (`no-project`); else the alias row is deleted, the
 * change logged as `name:<project id>` from the alias to nothing, and the counter moved once.
 */
export function forgetName(
  db: Db,
  projectId: number,
  now: number,
  source: Extract<ChangeSource, "viewer" | "cli">,
): ForgetNameOutcome {
  return withWrite(db, (): ForgetNameOutcome => {
    const project = projectState(db, projectId);
    if (!project.known) return { ok: false, reason: "no-project" };
    const name = project.aliases.find(isSharedName);
    if (name === undefined) return { ok: false, reason: "no-name" };
    if (boundAboveNothing(db, projectId)) return { ok: false, reason: "name-bound" };
    db.run("DELETE FROM project_aliases WHERE alias = ? AND project_id = ?", [name, projectId]);
    logChange(db, now, source, `name:${projectId}`, name, "");
    bumpCounter(db);
    return { ok: true, alias: name };
  });
}

// --- Levels that no longer hold ---------------------------------------------------------

/**
 * Removes every stored level whose downgrade still holds: its project has memory off, or
 * no longer carries the alias the level was set under. Each row is read with its project
 * inside this transaction, so a level a person has just set again is seen as it is now and
 * kept. Each removal is logged as the system's, from the stored level to `local`, and the
 * counter moves once. Without this a level would come back unasked when memory is turned
 * on again or the alias returns. Nothing else is removed: a row for a destination or with
 * a level this version does not know may be a newer version's.
 */
export function reconcileLevels(db: Db, now: number): { removed: number[] } {
  return withWrite(db, () => {
    const removed: number[] = [];
    const destinations = destinationsOf(db);
    for (const row of levelRows(db)) {
      const project = projectState(db, row.projectId);
      const { reason } = effectiveLevel(row, project, row.destination, destinations);
      // Once a server is confirmed, a row for the team's default or for a destination that is
      // not a confirmed server no longer holds either (ADR 0027).
      const unconfirmed = destinations !== DESTINATIONS && !destinations.has(row.destination);
      if (reason !== "disabled" && reason !== "unbound-alias" && !unconfirmed) continue;
      removeLevel(db, row.projectId, row.destination);
      logChange(db, now, "system", `project:${row.projectId}`, row.level, "local");
      removed.push(row.projectId);
    }
    if (removed.length > 0) bumpCounter(db);
    return { removed };
  });
}

// --- The two lists: the file and the baseline -------------------------------------------

const strings = (value: unknown): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];

/** Whether two lists hold the same ids, in whatever order. Neither repeats an id, as parsed. */
const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/** The baseline; the empty lists when none was recorded, or when it cannot be read. */
export function settingsSeen(db: Db): Lists {
  let seen: { roots?: unknown; areas?: unknown } | null = null;
  try {
    seen = JSON.parse(getMeta(db, SETTINGS_SEEN_KEY) ?? "null");
  } catch {
    // A baseline nobody can read is no baseline: the file then reads as edited by hand.
  }
  return { roots: strings(seen?.roots).filter(isRoot), areas: strings(seen?.areas) };
}

/** A server's own lists, as its row holds them; an invalid list reads as empty, as the env lists do. */
export function serverLists(db: Db, serverId: string): Lists {
  const row = db
    .query<{ roots: string; areas: string }, [string]>(
      "SELECT roots, areas FROM sharing_servers WHERE server_id = ?",
    )
    .get(serverId);
  if (row === null) return { roots: [], areas: [] };
  return {
    roots: parseShareList(row.roots === "" ? null : row.roots, ROOTS_KEY).list.filter(isRoot),
    areas: parseShareList(row.areas === "" ? null : row.areas, AREAS_KEY).list,
  };
}

/** What `setServerLists` did, or why it refused: a widening the caller did not confirm. */
export type ServerListsOutcome =
  | { ok: true; changed: ("roots" | "areas")[] }
  | { ok: false; reason: "needs-confirm"; widening: { roots: string[]; areas: string[] } };

/**
 * Sets a server's own lists (`share roots | areas --server`, the viewer's Sharing card), each
 * validated as the env lists are. As `setLevel` and `applySettingsPatch` do, a list that adds
 * an id is a widening and needs `confirm`, refused in the store itself, under the write lock,
 * so no caller can widen past it. Each list that changes is logged as `roots@<serverId>` or
 * `areas@<serverId>`, and the counter moves once when one did.
 */
export function setServerLists(
  db: Db,
  serverId: string,
  lists: { roots?: readonly string[]; areas?: readonly string[] },
  options: { source: ChangeSource; now: number; confirm: boolean },
): ServerListsOutcome {
  const { source, now } = options;
  const next: Partial<Lists> = {};
  if (lists.roots !== undefined) {
    const parsed = parseShareList(shareListText(lists.roots), ROOTS_KEY);
    if (parsed.problem !== null) throw new Error(parsed.problem);
    next.roots = parsed.list.filter(isRoot);
  }
  if (lists.areas !== undefined) {
    const parsed = parseShareList(shareListText(lists.areas), AREAS_KEY);
    if (parsed.problem !== null) throw new Error(parsed.problem);
    next.areas = parsed.list;
  }
  return withWrite(db, (): ServerListsOutcome => {
    const exists =
      db
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM sharing_servers WHERE server_id = ?",
        )
        .get(serverId)?.n ?? 0;
    if (exists === 0) throw new Error(`server ${serverId} is not listed`);
    const current = serverLists(db, serverId);
    const widening = {
      roots: (next.roots ?? []).filter((root) => !(current.roots as string[]).includes(root)),
      areas: (next.areas ?? []).filter((area) => !current.areas.includes(area)),
    };
    if (!options.confirm && (widening.roots.length > 0 || widening.areas.length > 0))
      return { ok: false, reason: "needs-confirm", widening };
    const changed: ("roots" | "areas")[] = [];
    for (const list of ["roots", "areas"] as const) {
      const value = next[list];
      if (value === undefined || sameList(value, current[list])) continue;
      changed.push(list);
      logChange(
        db,
        now,
        source,
        `${list}@${serverId}`,
        shareListText(current[list]),
        shareListText(value),
      );
      db.run(`UPDATE sharing_servers SET ${list} = ? WHERE server_id = ?`, [
        value.join(","),
        serverId,
      ]);
    }
    if (changed.length > 0) bumpCounter(db);
    return { ok: true, changed };
  });
}

/**
 * The env file's own lists, before any environment: what a person chose, and the same for
 * two processes whose environments differ. An invalid token empties its list, as it does
 * when the settings load.
 */
export function fileListsOf(dataDir: string): Lists {
  const file = readEnvFile(join(dataDir, ENV_FILE));
  const list = (key: SharingKey) => parseShareList(file[key] ?? null, key).list;
  return { roots: list(ROOTS_KEY).filter(isRoot), areas: list(AREAS_KEY) };
}

/**
 * Which of the file's lists differ from the baseline: a hand edit nobody recorded yet. One
 * rule for the loader, which reports it, and for the reconcile, which records it.
 */
export function changedLists(file: Lists, seen: Lists): ("roots" | "areas")[] {
  return (["roots", "areas"] as const).filter((list) => !sameList(file[list], seen[list]));
}

/** What a patch does to one sharing list of the file. A widening is an id added. */
export interface SettingsChange {
  key: SharingKey;
  old: string[];
  new: string[];
  widened: boolean;
}

/**
 * What a patch would do to the file's own lists, one answer per sharing key the patch holds,
 * roots first: the check every path makes before it asks a person or writes. `changes` is
 * what `validatePatch` answered; null clears a key, which empties its list.
 */
export function previewSettingsPatch(
  dataDir: string,
  changes: Partial<Record<SettingKey, string | null>>,
): SettingsChange[] {
  const file = readEnvFile(join(dataDir, ENV_FILE));
  return SHARE_KEYS.filter((key) => key in changes).map((key) => {
    const old = parseShareList(file[key] ?? null, key).list;
    const next = parseShareList(changes[key] ?? null, key).list;
    return { key, old, new: next, widened: next.some((id) => !old.includes(id)) };
  });
}

/** A widening nobody confirmed. Nothing was written. */
export class NeedsConfirm extends Error {
  constructor() {
    super(setLevelMessage("needs-confirm"));
    this.name = "NeedsConfirm";
  }
}

/**
 * Records a hand edit of the env file, inside the caller's transaction: for each of the
 * file's own lists that differs from the baseline, a change with the file as its source;
 * then the counter moves once and the baseline becomes the file's lists. The file's lists
 * are read here and are never a caller's, which an environment may have narrowed: two
 * processes with different environments record the same thing, once. With the file as last
 * recorded it writes nothing. Returns the lists that had changed.
 */
function recordHandEdit(db: Db, dataDir: string, now: number): ("roots" | "areas")[] {
  const file = fileListsOf(dataDir);
  const seen = settingsSeen(db);
  const changed = changedLists(file, seen);
  if (changed.length === 0) return changed;
  for (const list of changed) {
    logChange(db, now, "file", list, shareListText(seen[list]), shareListText(file[list]));
  }
  bumpCounter(db);
  setMeta(db, SETTINGS_SEEN_KEY, JSON.stringify(file));
  return changed;
}

/**
 * Records a hand edit of the env file nobody recorded yet (`recordHandEdit`), in its own
 * transaction: what the viewer, the CLI and a sync do when they look. An audit only: the
 * epoch moved when the file did.
 */
export function reconcileSettings(
  db: Db,
  dataDir: string,
  now: number,
): { changed: ("roots" | "areas")[] } {
  return withWrite(db, () => ({ changed: recordHandEdit(db, dataDir, now) }));
}

/**
 * Writes a settings patch to the env file: the one path for a patch that holds a sharing
 * key. In one transaction: a hand edit of the file nobody recorded yet is recorded first
 * (`recordHandEdit`), so no caller has to reconcile before it saves and a patch that repeats
 * an edited list does not swallow the edit; then the patch is judged against the file's
 * lists as they are: a widening without `confirm` is refused (`NeedsConfirm`), each list the
 * patch changes is logged with its old and new value, the counter moves once when a list
 * changed, the file is written, and the baseline becomes the file's new lists. So the
 * counter moves once for a hand edit found and once for the patch's own change. A list the
 * patch repeats as the file holds it is no change: it writes no row and leaves the counter,
 * so a save that changes nothing neither grows the log nor moves the epoch. The rows are
 * written before the file, so what can fail in the database fails with the file untouched;
 * a refusal and a file write that throws roll every row back, the hand edit's included,
 * which stays to be recorded. A patch with no sharing key changes no list.
 */
export function applySettingsPatch(
  db: Db,
  dataDir: string,
  changes: Partial<Record<SettingKey, string | null>>,
  source: ChangeSource,
  now: number,
  confirm: boolean,
  io: { writeEnvFile: typeof writeEnvFile } = { writeEnvFile },
): { sharing: SettingsChange[] } {
  return withWrite(db, () => {
    recordHandEdit(db, dataDir, now);
    const sharing = previewSettingsPatch(dataDir, changes);
    if (!confirm && sharing.some((change) => change.widened)) throw new NeedsConfirm();
    const changed = sharing.filter((change) => !sameList(change.old, change.new));
    for (const change of changed) {
      logChange(
        db,
        now,
        source,
        LOGGED_AS[change.key],
        shareListText(change.old),
        shareListText(change.new),
      );
    }
    if (changed.length > 0) bumpCounter(db);
    io.writeEnvFile(join(dataDir, ENV_FILE), changes);
    if (sharing.length > 0) setMeta(db, SETTINGS_SEEN_KEY, JSON.stringify(fileListsOf(dataDir)));
    return { sharing };
  });
}

// --- A server operation's writes (ADR 0027) --------------------------------------------

/**
 * One change row of a server operation (`server:<id>` joined, removed, muted; a server's
 * lists), inside the caller's transaction or on its own: a plain statement.
 */
export function logServerChange(
  db: Db,
  what: string,
  old: string,
  next: string,
  now: number,
  source: ChangeSource = "cli",
): void {
  logChange(db, now, source, what, old, next);
}

/**
 * Removes every level stored for a server being removed, each logged as the system's (the
 * person asked for the server to go, not for each project to share nothing), the counter
 * moved once. Plain statements, safe inside the removal's transaction.
 */
export function removeServerLevels(db: Db, serverId: string, now: number): { removed: number[] } {
  const rows = levelRows(db).filter((row) => row.destination === serverId);
  for (const row of rows) {
    removeLevel(db, row.projectId, serverId);
    logChange(db, now, "system", `project:${row.projectId}@${serverId}`, row.level, "local");
  }
  if (rows.length > 0) bumpCounter(db);
  return { removed: rows.map((row) => row.projectId) };
}

/** The host of a server's URL, what the change log names it by. */
function hostOfUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The yes to a joined server, in one transaction: `confirmed_at` set, the change row
 * `server:<id>` from `''` to the host, and, for the first confirmed server, every `team` row
 * of the levels and the ledger moved to it, the env file's own lists copied into its lists
 * and the baseline re-set so the move is not read as a hand edit. The counter moves once:
 * the destinations changed, so every epoch does.
 */
export function confirmServer(
  db: Db,
  dataDir: string,
  serverId: string,
  now: number,
  source: ChangeSource = "cli",
): { first: boolean; moved: { levels: number; ledger: number } } {
  return withWrite(db, () => {
    const row = db
      .query<{ url: string; others: number }, [string]>(
        `SELECT url,
                (SELECT count(*) FROM sharing_servers
                  WHERE confirmed_at IS NOT NULL AND server_id != ?1) AS others
           FROM sharing_servers WHERE server_id = ?1`,
      )
      .get(serverId);
    if (row === null) throw new Error(`server ${serverId} is not listed`);
    const first = row.others === 0;
    db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = ?", [now, serverId]);
    logChange(db, now, source, `server:${serverId}`, "", hostOfUrl(row.url));
    const moved = { levels: 0, ledger: 0 };
    if (first) {
      moved.levels = db.run("UPDATE sharing_levels SET destination = ? WHERE destination = ?", [
        serverId,
        TEAM_DESTINATION,
      ]).changes;
      moved.ledger = db.run("UPDATE sharing_ledger SET destination = ? WHERE destination = ?", [
        serverId,
        TEAM_DESTINATION,
      ]).changes;
      const file = fileListsOf(dataDir);
      db.run("UPDATE sharing_servers SET roots = ?, areas = ? WHERE server_id = ?", [
        file.roots.join(","),
        file.areas.join(","),
        serverId,
      ]);
      setMeta(db, SETTINGS_SEEN_KEY, JSON.stringify(file));
    }
    bumpCounter(db);
    return { first, moved };
  });
}

// --- Restore --------------------------------------------------------------------------

/**
 * Puts every project of a restored copy back to Nothing, since a level chosen when the
 * copy was made says nothing about now. In one transaction: every stored level is deleted
 * and the reset logged once when there was one; the counter moves past both the copy's and
 * `counterFloor` (the replaced store's), so an epoch never comes back; the generation is
 * renewed, since the copy gives its later row ids to other memories; and the baseline becomes
 * `fileLists`, the env file's lists now, so the restore is not read as a hand edit. It runs
 * on a copy that never ran the sharing schema: `meta` is a core table. Returns how many
 * levels it deleted.
 */
export function resetLevels(db: Db, now: number, counterFloor: number, fileLists: Lists): number {
  return withWrite(db, () => {
    const removed = hasLevelsTable(db) ? db.run("DELETE FROM sharing_levels").changes : 0;
    if (removed > 0) {
      logChange(
        db,
        now,
        "restore",
        "levels",
        `${plural(removed, "project")} above ${LEVEL_LABELS.local}`,
        `every project ${LEVEL_LABELS.local}`,
      );
    }
    setMeta(db, COUNTER_KEY, String(Math.max(counterFloor, counterOf(db)) + 1));
    setMeta(db, GENERATION_KEY, newGeneration());
    setMeta(db, SETTINGS_SEEN_KEY, JSON.stringify(fileLists));
    return removed;
  });
}
