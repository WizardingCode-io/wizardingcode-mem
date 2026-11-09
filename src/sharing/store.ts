// What the sharing policy keeps in the database, and the one path that writes the two
// sharing lists to the env file. Nothing here loads a policy: a write reads what it needs
// under its own write lock, so what a caller saw earlier never decides what is written.
import { join } from "node:path";
import { ENV_FILE, readEnvFile, writeEnvFile } from "../settings/env-file.ts";
import { parseShareList, type SettingKey, type SharingKey } from "../settings/settings.ts";
import { type Db, withWrite } from "../store/db.ts";
import { getMeta, setMeta } from "../store/meta.ts";
import { plural } from "../util/text.ts";
import { GENERATION_KEY, newGeneration } from "./migrations.ts";
import { isRoot, LEVEL_LABELS, LEVELS, type Root, shareListText } from "./types.ts";

export { GENERATION_KEY, newGeneration };

/** The `meta` key of the change counter: an integer as text, 0 when absent. */
export const COUNTER_KEY = "sharing.counter";

/**
 * The `meta` key of the baseline: the env file's own lists as last recorded, as JSON. It
 * exists for the audit only: a file that differs from it was edited by hand since.
 */
export const SETTINGS_SEEN_KEY = "sharing.settings_seen";

/** The roots and the areas of one reading: the file's, the baseline's. Each list sorted. */
interface Lists {
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
  old: string;
  new: string;
}

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

// --- The levels as stored ---------------------------------------------------------------

/** A level as stored: `level` is whatever the row holds, not yet checked against the levels. */
export interface StoredLevel {
  projectId: number;
  destination: string;
  level: string;
  boundAlias: string;
  setAt: number;
  source: ChangeSource;
}

/**
 * Every stored level, as written; what each is worth now is `effectiveLevel`'s to say. The
 * table must exist: a reader of a store that may never have run the sharing schema asks
 * `sqlite_master` first.
 */
export function levelRows(db: Db): StoredLevel[] {
  return db
    .query<StoredLevel, []>(
      `SELECT project_id AS projectId, destination, level, bound_alias AS boundAlias,
              set_at AS setAt, source
         FROM sharing_levels ORDER BY project_id, destination`,
    )
    .all();
}

const SET_LEVEL_MESSAGES = {
  "no-project": "this folder is not a known project; start a session here first",
  "no-remote": "this project has no git remote; a team can only match projects by their remote",
  disabled: "memory is off for this project",
  invalid: `the level is one of ${LEVELS.join(", ")}`,
  "needs-confirm": "confirm: true is required to widen sharing",
} as const;

/** Why a level was not set. */
export type SetLevelRefusal = keyof typeof SET_LEVEL_MESSAGES;

/** A refusal to set a level, as a sentence a person can act on. */
export function setLevelMessage(reason: SetLevelRefusal): string {
  return SET_LEVEL_MESSAGES[reason];
}

// --- The two lists: the file and the baseline -------------------------------------------

const strings = (value: unknown): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];

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
 * Writes a settings patch to the env file: the one path for a patch that holds a sharing
 * key. In one transaction the file's lists are read, a widening without `confirm` is refused
 * (`NeedsConfirm`), each sharing key in the patch is logged with its old and new list, the
 * counter moves once, the file is written, and the baseline becomes the file's new lists.
 * The rows are written before the file, so what can fail in the database fails with the file
 * untouched; a file write that throws rolls the rows back. A patch with no sharing key only
 * writes the file.
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
    const sharing = previewSettingsPatch(dataDir, changes);
    if (!confirm && sharing.some((change) => change.widened)) throw new NeedsConfirm();
    for (const change of sharing) {
      logChange(
        db,
        now,
        source,
        LOGGED_AS[change.key],
        shareListText(change.old),
        shareListText(change.new),
      );
    }
    if (sharing.length > 0) bumpCounter(db);
    io.writeEnvFile(join(dataDir, ENV_FILE), changes);
    if (sharing.length > 0) setMeta(db, SETTINGS_SEEN_KEY, JSON.stringify(fileListsOf(dataDir)));
    return { sharing };
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

function hasLevelsTable(db: Db): boolean {
  return db.query("SELECT 1 FROM sqlite_master WHERE name = 'sharing_levels'").get() !== null;
}
