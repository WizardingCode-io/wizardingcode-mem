// The sharing policy as loaded, and the one predicate that rules under it. The loader
// reads the settings, the store and the two taxonomies once and never throws: whatever
// fails, the policy is closed and nothing leaves. `decide` reads nothing but its arguments,
// so the same policy, item and records always get the same answer.
import { join } from "node:path";
import { parseTaxonomy } from "../modules/knowledge/entry.ts";
import {
  kindAt,
  knowledgeRoot,
  readRegularFile,
  repoFolder,
  repoPath,
  TAXONOMY_FILE,
} from "../modules/knowledge/repo.ts";
import { type Env, loadSettings } from "../settings/settings.ts";
import { type Db, moduleSchemaState } from "../store/db.ts";
import { logError } from "../util/log.ts";
import { DESTINATIONS, effectiveLevel, epochOf, levelKey, levelOf } from "./levels.ts";
import { SHARING_MODULE, SHARING_SCHEMA_VERSION } from "./migrations.ts";
import {
  changedLists,
  counterOf,
  fileListsOf,
  hasLevelsTable,
  levelRows,
  settingsSeen,
} from "./store.ts";
import {
  type Decision,
  type EntryItem,
  type Item,
  LEVEL_LABELS,
  type LedgerRecord,
  type LevelRow,
  type MemoryItem,
  type Reason,
  ROOTS,
  type Root,
  type SharingPolicy,
  widens,
} from "./types.ts";

// --- The taxonomies ---------------------------------------------------------------------

/** The areas of one root's taxonomy: what a listed area id is checked against. */
type Areas = { id: string; label: string }[];

/**
 * A root's areas as its taxonomy file holds them, read as the knowledge store reads it:
 * no git, and never through a link. Null when the file is missing or cannot be read as a
 * taxonomy, and when a link stands at `knowledge/` or at the root's name.
 */
function areasOf(dataDir: string, root: Root): Areas | null {
  try {
    const folder = repoPath(dataDir, repoFolder({ scope: root }));
    if (kindAt(knowledgeRoot(dataDir)) !== "folder" || kindAt(folder) !== "folder") return null;
    const bytes = readRegularFile(join(folder, TAXONOMY_FILE));
    if (bytes === null) return null;
    const taxonomy = parseTaxonomy(new TextDecoder().decode(bytes));
    return "problem" in taxonomy ? null : taxonomy.areas;
  } catch {
    // What cannot be looked at names no area: every id listed for the root is then inert.
    return null;
  }
}

/** Each root's areas, ids and labels; null for a root with no taxonomy that can be read. */
export function knownAreas(dataDir: string): Record<Root, Areas | null> {
  return { workspace: areasOf(dataDir, "workspace"), shared: areasOf(dataDir, "shared") };
}

/**
 * The listed area ids apart: those their root's taxonomy holds, which are in force, and
 * the rest, which are inert and allow nothing. A root with no taxonomy has no area in force.
 * Each part keeps the order of the list. The one filter for the loader and for a preview.
 */
export function areasInForce(
  listed: readonly string[],
  taxonomies: Record<Root, Areas | null>,
): { areas: string[]; inert: string[] } {
  const known = new Set(
    ROOTS.flatMap((root) => (taxonomies[root] ?? []).map((area) => `${root}:${area.id}`)),
  );
  return {
    areas: listed.filter((id) => known.has(id)),
    inert: listed.filter((id) => !known.has(id)),
  };
}

// --- What the store holds ---------------------------------------------------------------

const TOO_NEW = "the sharing schema is newer than this binary";
const HAND_EDIT =
  "the sharing settings changed outside the viewer and the CLI; open the Sharing page or run share status to record it";

/**
 * How the problem that names the inert area ids opens, the ids after it. Exported for a
 * reader that says those ids in its own words and leaves this sentence out.
 */
export const INERT_PROBLEM = "areas not in the taxonomy, ignored:";

/** What a person is told about a stored level that reads `local`, by what made it so. */
const LEVEL_PROBLEMS: Partial<Record<Reason, (project: string) => string>> = {
  disabled: (project) =>
    `memory is off for ${project}; its level is ${LEVEL_LABELS.local} until you turn memory on and set it again`,
  "unbound-alias": (project) =>
    `${project} lost the git remote its level was bound to; its level is ${LEVEL_LABELS.local} until you set it again`,
  // Raised for a stored level that is not one of the levels; a row stored at `local` reads
  // `level-local` too, and is no problem.
  "level-local": (project) =>
    `${project} has a level this version does not know; its level is ${LEVEL_LABELS.local} until you set it again`,
};

interface ProjectRow {
  id: number;
  name: string;
  disabled: number;
}

/** What the policy takes from the store. */
interface Stored {
  projects: Map<number, ProjectRow>;
  levels: Map<string, LevelRow>;
  /** One sentence per stored level that reads `local` against what a person chose. */
  problems: string[];
  counter: number;
  seen: SharingPolicy["settingsSeen"];
}

/** A store that does not exist yet: no project, no level, no change, no baseline. */
const noStore = (): Stored => ({
  projects: new Map(),
  levels: new Map(),
  problems: [],
  counter: 0,
  seen: { roots: [], areas: [] },
});

/** Every project the store knows, by id. */
function projectsOf(db: Db): Map<number, ProjectRow> {
  const rows = db.query<ProjectRow, []>("SELECT id, name, disabled FROM projects").all();
  return new Map(rows.map((row) => [row.id, row]));
}

/** Each project's aliases, by project id: a level holds while its project carries its alias. */
function aliasesOf(db: Db): Map<number, string[]> {
  const byProject = new Map<number, string[]>();
  const rows = db
    .query<{ projectId: number; alias: string }, []>(
      "SELECT project_id AS projectId, alias FROM project_aliases",
    )
    .all();
  for (const { projectId, alias } of rows) {
    byProject.set(projectId, [...(byProject.get(projectId) ?? []), alias]);
  }
  return byProject;
}

/**
 * The stored levels as they read now, each through `effectiveLevel`. A row whose project
 * is gone is dropped. A row for a destination that is not configured is kept, reading
 * `local`, under its own key: it never stands for another destination's. A row stored at
 * `local` chose nothing, so whatever it reads for is no problem.
 */
function levelsOf(db: Db, projects: Map<number, ProjectRow>): Pick<Stored, "levels" | "problems"> {
  const levels = new Map<string, LevelRow>();
  const problems: string[] = [];
  const rows = levelRows(db);
  const aliases = rows.length === 0 ? new Map<number, string[]>() : aliasesOf(db);
  for (const row of rows) {
    const project = projects.get(row.projectId);
    if (project === undefined) continue;
    const state = {
      known: true,
      disabled: project.disabled === 1,
      aliases: aliases.get(row.projectId) ?? [],
    };
    const { level, reason } = effectiveLevel(row, state, row.destination, DESTINATIONS);
    levels.set(levelKey(row.projectId, row.destination), {
      projectId: row.projectId,
      destination: row.destination,
      level,
      boundAlias: row.boundAlias,
      reason,
    });
    const problem = row.level === "local" ? undefined : LEVEL_PROBLEMS[reason];
    if (problem !== undefined) problems.push(problem(project.name));
  }
  return { levels, problems };
}

/**
 * What the store holds for the policy; null when its sharing schema is newer than this
 * binary. Whether the store ever ran the sharing schema is asked of the table by name,
 * since the recorded version cannot say; one that never did has no level, and every
 * project in it shares nothing.
 */
function readStore(db: Db): Stored | null {
  const hasLevels = hasLevelsTable(db);
  if (moduleSchemaState(db, SHARING_MODULE, SHARING_SCHEMA_VERSION) === "too-new") return null;
  const projects = projectsOf(db);
  const { levels, problems } = hasLevels ? levelsOf(db, projects) : noStore();
  return { projects, levels, problems, counter: counterOf(db), seen: settingsSeen(db) };
}

// --- The loader -------------------------------------------------------------------------

/**
 * The policy, read once. Throws where anything it needs cannot be read. The epoch is taken
 * over the lists in force, the areas after the taxonomy filter: an inert id that comes
 * into force when its area is added to the taxonomy lets more leave, and moves the epoch
 * with no write, as a hand edit of the env file does.
 */
function readPolicy(db: Db | null, dataDir: string, env: Env): SharingPolicy {
  const { roots, areas: listed, problems: emptiedOrIgnored } = loadSettings(env, dataDir).sharing;
  const fileLists = fileListsOf(dataDir);
  const stored = db === null ? noStore() : readStore(db);
  if (stored === null) return closedPolicy(TOO_NEW);
  const { areas, inert } = areasInForce(listed, knownAreas(dataDir));
  const settings = { roots, areas: listed };
  return {
    epoch: epochOf(stored.counter, { roots, areas }),
    closed: false,
    destinations: new Set(DESTINATIONS),
    projects: new Set(stored.projects.keys()),
    roots: new Set(roots),
    areas: new Set(areas),
    inert,
    settings,
    fileLists,
    settingsSeen: stored.seen,
    levels: stored.levels,
    problems: [
      ...emptiedOrIgnored,
      ...stored.problems,
      ...(inert.length > 0 ? [`${INERT_PROBLEM} ${inert.join(", ")}`] : []),
      ...(changedLists(fileLists, stored.seen).length > 0 ? [HAND_EDIT] : []),
    ],
  };
}

/** A policy that could not be loaded: closed and empty, so nothing leaves, with why. */
export function closedPolicy(problem: string): SharingPolicy {
  return {
    epoch: 0,
    closed: true,
    destinations: new Set(),
    projects: new Set(),
    roots: new Set(),
    areas: new Set(),
    inert: [],
    settings: { roots: [], areas: [] },
    fileLists: { roots: [], areas: [] },
    settingsSeen: { roots: [], areas: [] },
    levels: new Map(),
    problems: [problem],
  };
}

/** Whether this process already logged a policy that failed to load. */
let failureLogged = false;

/** Forgets that a failure was logged. For tests. */
export function resetSharingLog(): void {
  failureLogged = false;
}

/**
 * The policy in force: what the settings, the store and the taxonomies say now. With no
 * database there is no project and no level, and the settings are read alone. It never
 * throws: a failure to read anything gives a closed policy, under which nothing leaves,
 * logged once per process, since every reader would otherwise log the same failure.
 * `_now` is the caller's clock, which every reader of the policy passes; no step reads it.
 */
export function loadPolicy(db: Db | null, dataDir: string, env: Env, _now: number): SharingPolicy {
  try {
    return readPolicy(db, dataDir, env);
  } catch (error) {
    if (!failureLogged) {
      failureLogged = true;
      logError("sharing", error, dataDir);
    }
    const why = error instanceof Error ? error.message : String(error);
    return closedPolicy(`the sharing policy could not be loaded (${why}); nothing leaves`);
  }
}

/** Whether nothing was chosen and nothing is wrong: no root, no area, no level, no problem. */
export function isDefault(policy: SharingPolicy): boolean {
  return (
    policy.roots.size === 0 &&
    policy.areas.size === 0 &&
    policy.problems.length === 0 &&
    [...policy.levels.values()].every((row) => row.level === "local")
  );
}

// --- The predicate ----------------------------------------------------------------------

/**
 * Why a project's level does not reach `needed`; null when it does. A project at
 * `knowledge` asked for its memories says so; one that shares nothing gives what made its
 * level read `local`.
 */
function levelRefusal(
  policy: SharingPolicy,
  projectId: number,
  destination: string,
  needed: "knowledge" | "all",
): Reason | null {
  const { level, reason } = levelOf(policy, projectId, destination);
  if (!widens(level, needed)) return null;
  if (level === "knowledge") return "level-knowledge";
  return reason === "allowed" ? "level-local" : reason;
}

/**
 * Why an entry may not leave; null when it may. It must be readable and active. A
 * workspace or shared entry needs its root allowed; a project's entry needs its project at
 * `knowledge` or `all`, and no root. Then its area must be allowed: the workspace's areas
 * govern the workspace and every project, the shared repository has its own.
 */
function entryRefusal(policy: SharingPolicy, destination: string, item: EntryItem): Reason | null {
  if (item.problem !== null) return "problem";
  if (item.status !== "active") return "status";
  if (item.scope === "project") {
    const refusal = levelRefusal(policy, item.projectId, destination, "knowledge");
    if (refusal !== null) return refusal;
  } else if (!policy.roots.has(item.scope)) {
    return "root-off";
  }
  const area = `${item.scope === "shared" ? "shared" : "workspace"}:${item.area}`;
  if (policy.areas.has(area)) return null;
  return policy.inert.includes(area) ? "area-inert" : "area-private";
}

/**
 * Why a memory may not leave; null when it may. Its project must be at `all`, and the
 * memory one of the set `all` means, which is this list and nothing else: active, not
 * stale, the project's own and not a branch's, not imported, not one of the person's rules.
 */
function memoryRefusal(
  policy: SharingPolicy,
  destination: string,
  item: MemoryItem,
): Reason | null {
  const refusal = levelRefusal(policy, item.projectId, destination, "all");
  if (refusal !== null) return refusal;
  if (item.status !== "active") return "status";
  if (item.stale) return "stale";
  if (item.scope !== "project") return "branch-scope";
  if (item.origin === "imported") return "imported";
  return item.isUserRule ? "user-rule" : null;
}

/**
 * The ruling for one item and one destination, under a loaded policy and the item's
 * ledger records. Pure. In this order:
 *
 * 1. A closed policy keeps everything.
 * 2. So does a destination that is not configured, whatever the roots and the areas say.
 * 3. What came from another destination never travels on. The version received from this
 *    destination is never echoed back; one this machine wrote since goes on to step 4.
 * 4. Whether the policy allows the item, with the reason when it does not.
 * 5. Against what was sent to this destination and not withdrawn: an allowed item the
 *    server already has (the same hash; a hash that was not computed counts as changed)
 *    is kept and any other allowed item is sent; an item no longer allowed is withdrawn
 *    when the server has it and kept when it does not. A record's version is
 *    informational: the hash decides.
 */
export function decide(
  policy: SharingPolicy,
  destination: string,
  item: Item,
  records: readonly LedgerRecord[],
): Decision {
  const ruling = (answer: Decision["answer"], reason: Reason): Decision => ({
    answer,
    reason,
    epoch: policy.epoch,
  });
  if (policy.closed) return ruling("keep", "policy-failed");
  if (!policy.destinations.has(destination)) return ruling("keep", "unknown-destination");

  const received = records.filter((record) => record.direction === "received");
  if (received.some((record) => record.destination !== destination)) {
    return ruling("keep", "received-elsewhere");
  }
  if (received.some((record) => record.hash === item.hash)) return ruling("keep", "received-same");

  const refusal =
    item.kind === "entry"
      ? entryRefusal(policy, destination, item)
      : memoryRefusal(policy, destination, item);
  const sent = records.find(
    (record) =>
      record.direction === "sent" &&
      record.destination === destination &&
      record.withdrawnAt === null,
  );
  if (refusal !== null) return ruling(sent === undefined ? "keep" : "withdraw", refusal);
  return sent !== undefined && sent.hash === item.hash
    ? ruling("keep", "already-sent")
    : ruling("send", "allowed");
}
