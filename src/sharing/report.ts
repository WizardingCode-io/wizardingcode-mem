// What would leave this machine under a policy: the counts, the lists and the previews.
// Nothing here says what may leave: every item is put to `decide`, and what leaves is what
// it answers `send` for. The SQL only narrows what `decide` is asked. Nothing is sent, and
// nothing runs on a hook.
import { KnowledgeError } from "../modules/knowledge/errors.ts";
import { ensureFresh } from "../modules/knowledge/index-store.ts";
import { KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION } from "../modules/knowledge/migrations.ts";
import { openRepo, withRepoLeases } from "../modules/knowledge/repo.ts";
import { openStore } from "../modules/knowledge/store-open.ts";
import type { KnowledgeStore, Repo, ScopeRef } from "../modules/knowledge/types.ts";
import type { Env } from "../settings/settings.ts";
import { type Db, moduleSchemaState } from "../store/db.ts";
import { logError } from "../util/log.ts";
import { redactForSend } from "./edge.ts";
import { memoryHash } from "./hash.ts";
import { counterOfEpoch, epochOf, isHostLedAlias, levelKey, levelOf } from "./levels.ts";
import { areasInForce, decide, knownAreas } from "./policy.ts";
import { generationOf, hasLevelsTable, hasTable } from "./store.ts";
import {
  type EntryItem,
  entryUid,
  type Item,
  type LedgerRecord,
  type Level,
  type LevelRow,
  type MemoryItem,
  memoryUid,
  type Root,
  type SharingPolicy,
  TEAM_DESTINATION,
} from "./types.ts";

/** How many entries, and how many memories, a list names; the rest are counted. */
export const LIST_CAP = 500;

/** How many memories one query reads to hash them. */
export const HASH_CHUNK = 500;

/**
 * What would leave for the team's server under a policy. `counts`, `perRoot.<root>.entries`
 * and `perProject` are what `decide` sends. A root's entries are those its areas govern: the
 * workspace's count every project's. `areaTotals` are a root's active entries per area
 * whatever the policy, so a switch can say what it would release. `items` names what leaves,
 * `LIST_CAP` of each at most, with how many more there are.
 */
export interface Report {
  counts: { entries: number; memories: number };
  perRoot: Record<Root, { entries: number; areaTotals: Record<string, number> }>;
  perProject: { id: number; level: Level; entries: number; memories: number }[];
  items?: {
    entries: { scope: string; projectId: number; slug: string; title: string; area: string }[];
    memories: { id: number; projectId: number; title: string }[];
    more: { entries: number; memories: number };
  };
}

/** A change a person is about to make: one project's level, the roots, the areas. */
export interface PolicyChange {
  level?: { projectId: number; level: Level };
  roots?: Root[];
  areas?: string[];
}

export interface WouldLeaveOptions {
  /** Only this project's own repository and memories. */
  projectId?: number;
  /** Also name what leaves. */
  list?: boolean;
  /** Bring the index up to date with the repositories' files first. */
  fresh?: boolean;
  /** The caller's clock. */
  now: number;
  /** What brings one repository's index up to date; the knowledge store's own by default. */
  refresh?: (repo: Repo) => void;
}

/** An entry with what a list says of it. */
type ListedEntry = EntryItem & { slug: string; title: string };

/** A memory with its row id, by which its text is read when it is needed. */
type ListedMemory = MemoryItem & { id: number };

const sortedOnce = <T extends string>(list: readonly T[]): T[] => [...new Set(list)].sort();

/**
 * Whether the knowledge tables may be read here: they exist, and their module's schema is
 * the one this version reads. The knowledge module owns its tables; on a store whose module
 * is behind or ahead, no entry is read and none is counted.
 */
function knowledgeReadable(db: Db): boolean {
  return (
    moduleSchemaState(db, KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION) === "current" &&
    hasTable(db, "knowledge_repos")
  );
}

/** The ids as one bound value: a list of any length takes one parameter. */
const idList = (ids: readonly number[]) => JSON.stringify(ids);

// --- Previews -----------------------------------------------------------------------------

/** The change counter an epoch was made from: what `epochOf` puts above its hash. */

/** The levels with one project's replaced. A project at Nothing has no level. */
function withLevel(
  levels: ReadonlyMap<string, LevelRow>,
  { projectId, level }: NonNullable<PolicyChange["level"]>,
): Map<string, LevelRow> {
  const next = new Map(levels);
  const key = levelKey(projectId, TEAM_DESTINATION);
  if (level === "local") next.delete(key);
  else {
    const boundAlias = levels.get(key)?.boundAlias ?? "";
    next.set(key, {
      projectId,
      destination: TEAM_DESTINATION,
      level,
      boundAlias,
      reason: "allowed",
    });
  }
  return next;
}

/**
 * The policy as it would read once a change is made, built in memory: nothing is written.
 * Given roots replace the roots; given areas replace the areas, sorted as the settings sort
 * them and split by the taxonomies as the loader splits them; a given level replaces that
 * project's for the team's server. The epoch is one change further than the policy's, over
 * the lists then in force, so a preview is never taken for the policy it was built from.
 * What the policy says of the env file, and its problems, stay as loaded: a preview is read
 * for what would leave. A policy that could not be loaded stays closed.
 */
export function withChange(
  policy: SharingPolicy,
  change: PolicyChange,
  dataDir: string,
): SharingPolicy {
  if (policy.closed) return policy;
  const roots = change.roots === undefined ? null : sortedOnce(change.roots);
  const listed = change.areas === undefined ? null : sortedOnce(change.areas);
  const split = listed === null ? null : areasInForce(listed, knownAreas(dataDir));
  const next: SharingPolicy = {
    ...policy,
    roots: roots === null ? policy.roots : new Set(roots),
    areas: split === null ? policy.areas : new Set(split.areas),
    inert: split === null ? policy.inert : split.inert,
    settings: {
      roots: roots ?? policy.settings.roots,
      areas: listed ?? policy.settings.areas,
    },
    levels: change.level === undefined ? policy.levels : withLevel(policy.levels, change.level),
  };
  const inForce = { roots: [...next.roots], areas: [...next.areas] };
  return { ...next, epoch: epochOf(counterOfEpoch(policy.epoch) + 1, inForce) };
}

// --- The entries ----------------------------------------------------------------------------

/** The root whose areas govern an entry: the workspace's for itself and for every project. */
const rootOf = (scope: EntryItem["scope"]): Root => (scope === "shared" ? "shared" : "workspace");

/**
 * The remote alias each project's entries are named by. A project with a level: the alias
 * the level is bound to, as stored, also when the project no longer carries it, so that what
 * was sent under that name is still found and can be withdrawn. A project with none: its
 * first remote alias by name, the one a level would be bound to.
 */
function entryAliases(db: Db): Map<number, string> {
  type Named = { projectId: number; alias: string };
  // Only a host-led alias names a project to a team (ADR 0025): a path alias never does, not
  // as the first by name and not as the alias a row was bound to before the rule.
  const first = new Map<number, string>();
  const remotes = db
    .query<Named, []>(
      `SELECT project_id AS projectId, alias FROM project_aliases
        WHERE alias LIKE 'remote:%' ORDER BY alias`,
    )
    .all();
  for (const { projectId, alias } of remotes) {
    if (!first.has(projectId) && isHostLedAlias(alias)) first.set(projectId, alias);
  }
  const bound = hasLevelsTable(db)
    ? db
        .query<Named, [string]>(
          `SELECT project_id AS projectId, bound_alias AS alias FROM sharing_levels
            WHERE destination = ?`,
        )
        .all(TEAM_DESTINATION)
        .filter(({ alias }) => isHostLedAlias(alias))
    : [];
  // Listed last, the alias a level is bound to replaces the project's first.
  return new Map([
    ...first,
    ...bound.map(({ projectId, alias }): [number, string] => [projectId, alias]),
  ]);
}

interface EntryRow {
  scope: EntryItem["scope"];
  projectId: number;
  id: string;
  slug: string;
  title: string;
  area: string;
  status: string;
  problem: string | null;
  version: number;
  hash: string;
}

/**
 * The indexed entries, each as the predicate reads it: the workspace's, then the shared
 * repository's, then the projects' by project id, each by slug; or only one project's
 * repository's, only one scope's, only the one with a slug. A project with no remote alias
 * has no name a team knows it by: its entries are named by the empty alias, under which
 * nothing was ever sent, and no level can be set for it.
 */
function readEntries(
  db: Db,
  only: { projectId?: number | null; scope?: string; slug?: string },
): ListedEntry[] {
  if (!knowledgeReadable(db)) return [];
  const rows = db
    .query<EntryRow, [number | null, string | null, string | null]>(
      `SELECT r.scope, r.project_id AS projectId, e.id, e.slug, e.title, e.area, e.status,
              e.problem, e.version, e.hash
         FROM knowledge_entries e JOIN knowledge_repos r ON r.id = e.repo_id
        WHERE (?1 IS NULL OR (r.scope = 'project' AND r.project_id = ?1))
          AND (?2 IS NULL OR r.scope = ?2)
          AND (?3 IS NULL OR e.slug = ?3)
        ORDER BY CASE r.scope WHEN 'workspace' THEN 0 WHEN 'shared' THEN 1 ELSE 2 END,
                 r.project_id, e.slug`,
    )
    .all(only.projectId ?? null, only.scope ?? null, only.slug ?? null);
  const aliases = rows.some((row) => row.scope === "project")
    ? entryAliases(db)
    : new Map<number, string>();
  return rows.map((row) => ({
    kind: "entry",
    uid: entryUid(
      row.scope,
      row.scope === "project" ? (aliases.get(row.projectId) ?? "") : null,
      row.id,
    ),
    scope: row.scope,
    projectId: row.projectId,
    area: row.area,
    status: row.status,
    problem: row.problem,
    version: row.version,
    hash: row.hash,
    slug: row.slug,
    title: row.title,
  }));
}

/**
 * Every indexed entry as the predicate reads it, or one project's repository's only; none
 * on a store without the knowledge tables.
 */
export function entryItems(db: Db, projectId?: number): ListedEntry[] {
  return readEntries(db, { projectId });
}

/**
 * The entry a reference names, `<scope>/<slug>`: the workspace's, the shared repository's,
 * or, for `project/<slug>`, the given project's. Null when there is none.
 */
export function findEntry(db: Db, ref: string, projectId: number | null): EntryItem | null {
  const [scope, slug, ...more] = ref.split("/");
  if (scope === undefined || slug === undefined || more.length > 0) return null;
  const ofProject = scope === "project";
  if (ofProject && projectId === null) return null;
  const [found] = readEntries(db, { projectId: ofProject ? projectId : null, scope, slug });
  if (found === undefined) return null;
  const { slug: _slug, title: _title, ...item } = found;
  return item;
}

/**
 * How many active entries without a problem each area holds, per root: the workspace's and
 * every project's under `workspace`, the shared repository's under `shared`. It reads no
 * policy: an area that is off shows what turning it on would release.
 */
export function areaTotals(db: Db): Record<Root, Record<string, number>> {
  const totals: Record<Root, Record<string, number>> = { workspace: {}, shared: {} };
  if (!knowledgeReadable(db)) return totals;
  const rows = db
    .query<{ scope: EntryItem["scope"]; area: string; n: number }, []>(
      `SELECT r.scope, e.area, count(*) AS n
         FROM knowledge_entries e JOIN knowledge_repos r ON r.id = e.repo_id
        WHERE e.status = 'active' AND e.problem IS NULL
        GROUP BY r.scope, e.area`,
    )
    .all();
  for (const { scope, area, n } of rows) {
    const ofRoot = totals[rootOf(scope)];
    ofRoot[area] = (ofRoot[area] ?? 0) + n;
  }
  return totals;
}

// --- The memories ---------------------------------------------------------------------------

/** The known projects, or the one asked for, whose level for the team's server passes, by id. */
function projectsAt(
  policy: SharingPolicy,
  only: number | undefined,
  passes: (level: Level) => boolean,
): number[] {
  const ids = only === undefined ? [...policy.projects].sort((a, b) => a - b) : [only];
  return ids.filter((id) => passes(levelOf(policy, id, TEAM_DESTINATION).level));
}

interface MemoryRow {
  id: number;
  projectId: number;
  status: string;
  stale: number;
  scope: MemoryItem["scope"];
  origin: string;
  updatedAt: number;
  isUserRule: number;
}

/** What the predicate reads of a memory, and never its text. The join is an input, not a rule. */
const MEMORY_ROWS = `
  SELECT m.id, m.project_id AS projectId, m.status, m.stale, m.scope, m.origin,
         m.updated_at AS updatedAt, u.memory_id IS NOT NULL AS isUserRule
    FROM memories m LEFT JOIN user_memories u ON u.memory_id = m.id`;

const memoryOf = (row: MemoryRow, generation: string): ListedMemory => ({
  kind: "memory",
  id: row.id,
  uid: memoryUid(generation, row.id),
  projectId: row.projectId,
  status: row.status,
  stale: row.stale === 1,
  scope: row.scope,
  origin: row.origin,
  isUserRule: row.isUserRule === 1,
  version: row.updatedAt,
  hash: null,
});

/**
 * The memories `decide` is asked about, by row id: every memory, whatever its state, of the
 * projects at `all` (or of the one asked for, when it is). No other project's memory is ever
 * sent, so leaving them out changes nothing that leaves; which of these leave is `decide`'s
 * to say. Each carries no hash: `withHashes` computes the ones that are needed.
 */
export function memoryItems(
  db: Db,
  policy: SharingPolicy,
  generation: string,
  projectId?: number,
): ListedMemory[] {
  const projects = projectsAt(policy, projectId, (level) => level === "all");
  if (projects.length === 0) return [];
  return db
    .query<MemoryRow, [string]>(
      `${MEMORY_ROWS} WHERE m.project_id IN (SELECT value FROM json_each(?)) ORDER BY m.id`,
    )
    .all(idList(projects))
    .map((row) => memoryOf(row, generation));
}

interface HashRow {
  id: number;
  kind: string;
  importance: number;
  status: string;
  title: string;
  body: string;
}

/**
 * Fills the hash of the memories whose uid is asked for: the hash of what would leave, the
 * title and the body redacted as the edge redacts them. The texts are read `HASH_CHUNK`
 * memories to a query, so a store's worth of memories is never read at once, and only for
 * the uids given: a hash matters where a ledger record is compared with it.
 */
export function withHashes(db: Db, env: Env, items: ListedMemory[], uids: Set<string>): void {
  const wanted = new Map(items.filter((item) => uids.has(item.uid)).map((item) => [item.id, item]));
  const ids = [...wanted.keys()];
  for (let start = 0; start < ids.length; start += HASH_CHUNK) {
    const rows = db
      .query<HashRow, [string]>(
        `SELECT id, kind, importance, status, title, body FROM memories
          WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .all(idList(ids.slice(start, start + HASH_CHUNK)));
    for (const row of rows) {
      const item = wanted.get(row.id);
      if (item === undefined) continue;
      item.hash = memoryHash({
        memoryKind: row.kind,
        importance: row.importance,
        status: row.status,
        title: redactForSend(row.title, env),
        body: redactForSend(row.body, env),
      });
    }
  }
}

/** The memory of a row id as the predicate reads it, with its hash; null when there is none. */
export function findMemory(db: Db, env: Env, generation: string, id: number): MemoryItem | null {
  const row = db.query<MemoryRow, [number]>(`${MEMORY_ROWS} WHERE m.id = ?`).get(id);
  if (row === null) return null;
  const found = memoryOf(row, generation);
  withHashes(db, env, [found], new Set([found.uid]));
  const { id: _id, ...item } = found;
  return item;
}

// --- The ledger -----------------------------------------------------------------------------

/**
 * The ledger records `decide` reads for a destination's items of one kind, by item uid: what
 * was sent to the destination and received from it, and what was received from any other,
 * since an item that came from elsewhere never travels on. One scan, grouped in memory:
 * never a list of uids, which a store's worth of memories would make longer than SQLite
 * binds. Empty on a store without the ledger.
 */
export function ledgerRecords(
  db: Db,
  destination: string,
  kind: "memory" | "entry",
): Map<string, LedgerRecord[]> {
  const records = new Map<string, LedgerRecord[]>();
  if (!hasTable(db, "sharing_ledger")) return records;
  const rows = db
    .query<LedgerRecord & { uid: string }, [string, string]>(
      `SELECT item_uid AS uid, destination, direction, version, hash, withdrawn_at AS withdrawnAt
         FROM sharing_ledger
        WHERE item_kind = ? AND (destination = ? OR direction = 'received')`,
    )
    .all(kind, destination);
  for (const { uid, ...record } of rows) {
    const ofItem = records.get(uid);
    if (ofItem === undefined) records.set(uid, [record]);
    else ofItem.push(record);
  }
  return records;
}

// --- What would leave -----------------------------------------------------------------------

const NO_RECORDS: readonly LedgerRecord[] = [];

/** The items `decide` sends to the team's server, in the order given. */
function leaving<T extends Item>(
  policy: SharingPolicy,
  items: T[],
  ledger: Map<string, LedgerRecord[]>,
): T[] {
  return items.filter(
    (item) =>
      decide(policy, TEAM_DESTINATION, item, ledger.get(item.uid) ?? NO_RECORDS).answer === "send",
  );
}

/**
 * The memories that would leave. A store with no generation never ran the sharing schema:
 * its memories have no identity to leave under. The hash is computed for the candidates the
 * ledger has a record of, the only ones it is compared for.
 */
function leavingMemories(
  db: Db,
  env: Env,
  policy: SharingPolicy,
  projectId: number | undefined,
): ListedMemory[] {
  const generation = generationOf(db);
  const candidates = generation === null ? [] : memoryItems(db, policy, generation, projectId);
  if (candidates.length === 0) return candidates;
  const ledger = ledgerRecords(db, TEAM_DESTINATION, "memory");
  const recorded = candidates.filter((item) => ledger.has(item.uid)).map((item) => item.uid);
  withHashes(db, env, candidates, new Set(recorded));
  return leaving(policy, candidates, ledger);
}

/** The titles of the memories a list names. */
function titlesOf(db: Db, memories: ListedMemory[]): Map<number, string> {
  if (memories.length === 0) return new Map();
  const rows = db
    .query<{ id: number; title: string }, [string]>(
      "SELECT id, title FROM memories WHERE id IN (SELECT value FROM json_each(?))",
    )
    .all(idList(memories.map((item) => item.id)));
  return new Map(rows.map((row) => [row.id, row.title]));
}

/** The index of one repository brought up to date; one being written is read as it stands. */
function refreshIndex(store: KnowledgeStore, repo: Repo): void {
  try {
    withRepoLeases(store, [repo.relative], () => ensureFresh(store, repo));
  } catch (error) {
    if (!(error instanceof KnowledgeError && error.code === "locked")) throw error;
  }
}

/**
 * Brings the index up to date with the files of the repositories that can release entries:
 * the workspace's, the shared one, then each project's above Nothing, by project id; for
 * one project, its own when it is above Nothing. A repository that cannot be opened or
 * refreshed is logged with its path and does not stop the others: its entries are counted
 * as the index has them.
 */
function refreshRepos(
  db: Db,
  dataDir: string,
  env: Env,
  policy: SharingPolicy,
  options: WouldLeaveOptions,
): void {
  if (!knowledgeReadable(db)) return;
  const store = openStore({ db, dataDir, env, now: () => options.now });
  const refresh = options.refresh ?? ((repo: Repo) => refreshIndex(store, repo));
  const projects = projectsAt(policy, options.projectId, (level) => level !== "local");
  const refs: ScopeRef[] = [
    ...(options.projectId === undefined
      ? ([{ scope: "workspace" }, { scope: "shared" }] as const)
      : []),
    ...projects.map((projectId) => ({ scope: "project" as const, projectId })),
  ];
  for (const ref of refs) {
    let named = ref.scope === "project" ? `project ${ref.projectId}` : `knowledge/${ref.scope}`;
    try {
      const repo = openRepo(store, ref);
      if (repo === null) continue;
      named = repo.relative;
      refresh(repo);
    } catch (error) {
      logError(`sharing.refresh ${named}`, error, dataDir);
    }
  }
}

/** How many of the ids there are of each. */
function tally(ids: Iterable<number>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** What `decide` sends of a store, before it is counted. */
interface Leaving {
  entries: ListedEntry[];
  memories: ListedMemory[];
  totals: Record<Root, Record<string, number>>;
  /** The titles of the memories a list names, by row id; none when no list is asked for. */
  titles: Map<number, string>;
}

/** Where there is no database, nothing leaves. */
const nothingLeaves = (): Leaving => ({
  entries: [],
  memories: [],
  totals: { workspace: {}, shared: {} },
  titles: new Map(),
});

/**
 * What `decide` sends, read from the store: each indexed entry, and each memory of a
 * project at `all`, is put to it with its ledger records.
 */
function readLeaving(
  db: Db,
  env: Env,
  policy: SharingPolicy,
  { projectId, list }: WouldLeaveOptions,
): Leaving {
  const sent = ledgerRecords(db, TEAM_DESTINATION, "entry");
  const entries = leaving(policy, entryItems(db, projectId), sent);
  const memories = leavingMemories(db, env, policy, projectId);
  const titles = list === true ? titlesOf(db, memories.slice(0, LIST_CAP)) : new Map();
  return { entries, memories, totals: areaTotals(db), titles };
}

/** What a list names: the first `LIST_CAP` of each kind, and how many more there are. */
function listOf({ entries, memories, titles }: Leaving): NonNullable<Report["items"]> {
  return {
    entries: entries
      .slice(0, LIST_CAP)
      .map(({ scope, projectId, slug, title, area }) => ({ scope, projectId, slug, title, area })),
    memories: memories
      .slice(0, LIST_CAP)
      .map(({ id, projectId }) => ({ id, projectId, title: titles.get(id) ?? "" })),
    more: {
      entries: Math.max(0, entries.length - LIST_CAP),
      memories: Math.max(0, memories.length - LIST_CAP),
    },
  };
}

/**
 * What would leave for the team's server under the policy given, which may be a preview:
 * what `decide` sends (`readLeaving`), counted in all, per root and per project, and named
 * when a list is asked for. With `fresh`, the repositories that can release entries are
 * brought up to date first (`refreshRepos`); without, the index is read as it is and
 * nothing is written. With no database, nothing leaves.
 */
export function wouldLeave(
  db: Db | null,
  dataDir: string,
  env: Env,
  policy: SharingPolicy,
  options: WouldLeaveOptions,
): Report {
  if (db !== null && options.fresh === true) refreshRepos(db, dataDir, env, policy, options);
  const found = db === null ? nothingLeaves() : readLeaving(db, env, policy, options);
  const { entries, memories, totals } = found;
  const ofRoot = (root: Root) => entries.filter((entry) => rootOf(entry.scope) === root).length;
  const projectEntries = tally(
    entries.filter((entry) => entry.scope === "project").map((entry) => entry.projectId),
  );
  const projectMemories = tally(memories.map((item) => item.projectId));
  return {
    counts: { entries: entries.length, memories: memories.length },
    perRoot: {
      workspace: { entries: ofRoot("workspace"), areaTotals: totals.workspace },
      shared: { entries: ofRoot("shared"), areaTotals: totals.shared },
    },
    perProject: projectsAt(policy, options.projectId, () => true).map((id) => ({
      id,
      level: levelOf(policy, id, TEAM_DESTINATION).level,
      entries: projectEntries.get(id) ?? 0,
      memories: projectMemories.get(id) ?? 0,
    })),
    ...(options.list === true ? { items: listOf(found) } : {}),
  };
}
