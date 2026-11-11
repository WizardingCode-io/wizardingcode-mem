// The index of the knowledge store: rows in the engine's database, rebuilt from the files.
// The files in the repositories are the truth; nothing here is the only copy of anything.
import { join } from "node:path";
import { type Db, withWrite } from "../../store/db.ts";
import { logError } from "../../util/log.ts";
import { anyOf } from "../../util/words.ts";
import { parseEntry, parseProposal, UUID, unreadEntry, unreadProposal } from "./entry.ts";
import { isRefusal, KnowledgeError } from "./errors.ts";
import { BM25_WEIGHTS } from "./policy.ts";
import {
  DECIDED_DIR,
  ENTRIES_DIR,
  fingerprintOf,
  hashOf,
  headOf,
  kindAt,
  knowledgeRoot,
  lookAt,
  namesIn,
  OPEN_DIR,
  openRepo,
  readRegularFile,
  refuseLinkedRoots,
  repoPath,
  statusOf,
  taxonomyFor,
  withRepoLeases,
} from "./repo.ts";
import { DELETE_REPO_SEARCH_ROWS, dropRepoRows, listRepos } from "./resolve.ts";
import { requireSchema } from "./schema.ts";
import type {
  KnowledgeEntry,
  KnowledgeProposal,
  KnowledgeStore,
  Repo,
  ScopeRef,
  Taxonomy,
} from "./types.ts";

/** A file with no usable id is indexed under its name, so it is listed and never lost. */
const rowId = (id: string, name: string) =>
  UUID.test(id) || id.startsWith("dup:") ? id : `file:${name}`;

/**
 * How a proposal file is named in such an id: with its folder, `open/<file>` or
 * `decided/<file>`, since the same file name can sit under both.
 */
const proposalName = (path: string) => path.slice("proposals/".length);

/** Deletes one search row by its rowid: the lookup the search table answers without a scan. */
export const DELETE_SEARCH_ROW = "DELETE FROM knowledge_fts WHERE rowid = ?";

/** Only an active entry with no problem is searchable: everything else is listed only. */
const searchable = (entry: KnowledgeEntry) => entry.status === "active" && entry.problem === null;

/**
 * Writes an entry row, and its search row when it is searchable, with no row of its slug
 * or of its id in the way. The caller has removed both, or knows there are none.
 */
function insertEntry(
  store: KnowledgeStore,
  repoId: number,
  entry: KnowledgeEntry,
  path: string,
  hash: string,
): void {
  const id = rowId(entry.id, entry.slug);
  const ftsRowid = searchable(entry)
    ? Number(
        store.db
          .query(
            `INSERT INTO knowledge_fts (title, area, context, subject, body, repo_id, entry_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(entry.title, entry.area, entry.context, entry.subject, entry.body, repoId, id)
          .lastInsertRowid,
      )
    : null;
  // A plain insert: with foreign keys on, an INSERT OR REPLACE here cost fifteen times as
  // much per row (measured at 2,000 rows), and a rebuild's transaction writes thousands.
  store.db
    .query(
      `INSERT INTO knowledge_entries
         (repo_id, id, slug, path, title, kind, area, context, subject, status, author, version,
          created, updated, supersedes, body, problem, hash, pinned, fts_rowid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      repoId,
      id,
      entry.slug,
      path,
      entry.title,
      entry.kind,
      entry.area,
      entry.context,
      entry.subject,
      entry.status,
      entry.author,
      entry.version,
      entry.created,
      entry.updated,
      entry.supersedes,
      entry.body,
      entry.problem,
      hash,
      entry.pinned ? 1 : 0,
      ftsRowid,
    );
}

/**
 * One row per slug and one per id: a problem row and a later good row for the same file
 * never collide, and an entry renamed to another slug leaves no row under the old one. The
 * search rows of the rows it replaces go with them, by the rowids those rows hold.
 */
export function upsertEntry(
  store: KnowledgeStore,
  repoId: number,
  entry: KnowledgeEntry,
  path: string,
  hash: string,
): void {
  const id = rowId(entry.id, entry.slug);
  const replaced = store.db
    .query<{ fts_rowid: number }, [number, string, string]>(
      `SELECT fts_rowid FROM knowledge_entries
        WHERE repo_id = ? AND (slug = ? OR id = ?) AND fts_rowid IS NOT NULL`,
    )
    .all(repoId, entry.slug, id);
  for (const row of replaced) store.db.query(DELETE_SEARCH_ROW).run(row.fts_rowid);
  store.db
    .query("DELETE FROM knowledge_entries WHERE repo_id = ? AND (slug = ? OR id = ?)")
    .run(repoId, entry.slug, id);
  insertEntry(store, repoId, entry, path, hash);
}

/** The folder says whether a proposal is open; a decided one says how in its frontmatter. */
function stateOf(proposal: KnowledgeProposal, path: string): "open" | "accepted" | "rejected" {
  if (path.startsWith(`${OPEN_DIR}/`)) return "open";
  return proposal.decision ?? "rejected";
}

/** A decided proposal is indexed without its body: the file keeps it. */
export function upsertProposal(
  store: KnowledgeStore,
  repoId: number,
  proposal: KnowledgeProposal,
  path: string,
  hash: string,
): void {
  const state = stateOf(proposal, path);
  store.db
    .query(
      `INSERT OR REPLACE INTO knowledge_proposals
         (repo_id, id, path, state, entry_id, slug, base_version, base_hash, proposed_by,
          proposed_at, decided_by, decided_at, decided_version, title, kind, area, context,
          subject, status, body, problem, hash, contradicts, on_behalf_of, judged_by,
          judge_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      repoId,
      rowId(proposal.id, proposalName(path)),
      path,
      state,
      proposal.entryId,
      proposal.slug,
      proposal.baseVersion,
      proposal.baseHash,
      proposal.proposedBy,
      proposal.proposedAt,
      proposal.decidedBy,
      proposal.decidedAt,
      proposal.decidedVersion,
      proposal.title,
      proposal.kind,
      proposal.area,
      proposal.context,
      proposal.subject,
      proposal.status,
      state === "open" ? proposal.body : "",
      proposal.problem,
      hash,
      JSON.stringify(proposal.contradicts),
      proposal.onBehalfOf,
      proposal.judgedBy,
      proposal.judgeVersion,
    );
}

/**
 * What the index was built from: `ensureFresh` compares these with the repository. A null
 * fingerprint says the folders were not read as they are now, so the next refresh rebuilds.
 */
export function recordRepo(
  store: KnowledgeStore,
  repoId: number,
  head: string | null,
  fingerprint: string | null,
  overCap: number,
  dirtyChecked: boolean,
): void {
  store.db.run(
    `UPDATE knowledge_repos
        SET head = ?, fingerprint = ?, over_cap = ?, dirty_checked = ?, indexed_at = ?
      WHERE id = ?`,
    [head, fingerprint, overCap, dirtyChecked ? 1 : 0, store.now(), repoId],
  );
}

/** The fingerprint the index holds for the repository; null when it holds none. */
export function recordedFingerprint(store: KnowledgeStore, repo: Repo): string | null {
  return (
    store.db
      .query<{ fingerprint: string | null }, [number]>(
        "SELECT fingerprint FROM knowledge_repos WHERE id = ?",
      )
      .get(repo.id)?.fingerprint ?? null
  );
}

/**
 * Records the head and the fingerprint a write took before its transaction, keeping what
 * the last rebuild found about the folders (the files over the cap, the dirty check).
 */
export function recordRepoAfter(
  store: KnowledgeStore,
  repo: Repo,
  head: string | null,
  fingerprint: string | null,
): void {
  const row = store.db
    .query<{ over_cap: number; dirty_checked: number }, [number]>(
      "SELECT over_cap, dirty_checked FROM knowledge_repos WHERE id = ?",
    )
    .get(repo.id);
  recordRepo(
    store,
    repo.id,
    head,
    fingerprint,
    row?.over_cap ?? 0,
    (row?.dirty_checked ?? 1) === 1,
  );
}

interface EntryRow {
  id: string;
  slug: string;
  title: string;
  kind: string;
  area: string;
  context: string;
  subject: string;
  status: string;
  author: string;
  version: number;
  created: string | null;
  updated: string | null;
  supersedes: string | null;
  pinned: number;
  body: string;
  problem: string | null;
}

/** The repository's entries as indexed, by slug. Unknown frontmatter keys are in the files only. */
export function listEntries(store: KnowledgeStore, repoId: number): KnowledgeEntry[] {
  return store.db
    .query<EntryRow, [number]>(
      `SELECT id, slug, title, kind, area, context, subject, status, author, version, created,
              updated, supersedes, pinned, body, problem
         FROM knowledge_entries WHERE repo_id = ? ORDER BY slug`,
    )
    .all(repoId)
    .map((row) => ({ ...row, pinned: row.pinned === 1, extra: [] }));
}

interface ProposalRow {
  id: string;
  state: "open" | "accepted" | "rejected";
  entry_id: string;
  slug: string;
  base_version: number;
  base_hash: string;
  proposed_by: string;
  proposed_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decided_version: number | null;
  title: string;
  kind: string;
  area: string;
  context: string;
  subject: string;
  status: string;
  body: string;
  problem: string | null;
  contradicts: string;
  on_behalf_of: string | null;
  judged_by: string | null;
  judge_version: string | null;
}

/** The repository's proposals as indexed: the open ones first, then by id. */
export function listProposals(
  store: KnowledgeStore,
  repoId: number,
  state?: "open" | "accepted" | "rejected",
): KnowledgeProposal[] {
  return store.db
    .query<ProposalRow, [number, string | null, string | null]>(
      `SELECT id, state, entry_id, slug, base_version, base_hash, proposed_by, proposed_at,
              decided_by, decided_at, decided_version, title, kind, area, context, subject,
              status, body, problem, contradicts, on_behalf_of, judged_by, judge_version
         FROM knowledge_proposals
        WHERE repo_id = ? AND (? IS NULL OR state = ?)
        ORDER BY state = 'open' DESC, id`,
    )
    .all(repoId, state ?? null, state ?? null)
    .map((row) => ({
      id: row.id,
      entryId: row.entry_id,
      slug: row.slug,
      baseVersion: row.base_version,
      baseHash: row.base_hash,
      proposedBy: row.proposed_by,
      proposedAt: row.proposed_at,
      title: row.title,
      kind: row.kind,
      area: row.area,
      context: row.context,
      subject: row.subject,
      status: row.status,
      body: row.body,
      decision: row.state === "open" ? null : row.state,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at,
      decidedVersion: row.decided_version,
      contradicts: idsOf(row.contradicts),
      onBehalfOf: row.on_behalf_of,
      judgedBy: row.judged_by,
      judgeVersion: row.judge_version,
      extra: [],
      problem: row.problem,
    }));
}

/** The ids a JSON list column holds; none when it holds anything else. */
function idsOf(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Open proposals for one target: by entry id for an existing entry, by slug for a new one. */
export function countOpen(
  store: KnowledgeStore,
  repoId: number,
  target: { entryId: string } | { slug: string },
): number {
  const [column, value] =
    "entryId" in target ? ["entry_id", target.entryId] : ["slug", target.slug];
  return (
    store.db
      .query<{ n: number }, [number, string]>(
        `SELECT count(*) AS n FROM knowledge_proposals WHERE repo_id = ? AND state = 'open' AND ${column} = ?`,
      )
      .get(repoId, value)?.n ?? 0
  );
}

/** The slug of the entry an id names in a repository, as the index knows it; null when none. */
export function entrySlugById(store: KnowledgeStore, repoId: number, id: string): string | null {
  return (
    store.db
      .query<{ slug: string }, [number, string]>(
        "SELECT slug FROM knowledge_entries WHERE repo_id = ? AND id = ?",
      )
      .get(repoId, id)?.slug ?? null
  );
}

export function countOpenAll(store: KnowledgeStore, repoId: number): number {
  return (
    store.db
      .query<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM knowledge_proposals WHERE repo_id = ? AND state = 'open'",
      )
      .get(repoId)?.n ?? 0
  );
}

/** The root's taxonomy, or null when it does not exist or cannot be read: a rebuild never fails on it. */
export function taxonomyOrNull(store: KnowledgeStore, repo: Pick<Repo, "ref">): Taxonomy | null {
  try {
    return taxonomyFor(store, repo.ref);
  } catch (error) {
    if (error instanceof KnowledgeError) return null;
    throw error;
  }
}

/** How many names of one folder are indexed; the rest are counted, printed and warned about. */
export const FOLDER_CAP = 5000;
/** A long rebuild extends its leases once per this many files. */
const RENEW_EVERY = 500;
const CHANGED_OUTSIDE = "changed outside the engine; run wizardingcode-mem knowledge adopt";

const also = (problem: string | null, more: string) =>
  problem === null ? more : `${problem}; ${more}`;

/**
 * The names of a folder to index: the visible ones, in byte order so that two rebuilds
 * agree, cut at the cap. Only `.md` files are knowledge; `over` counts what the cap left out.
 * A folder that is not there holds none (git does not keep an empty one); a folder that
 * cannot be listed is a refusal (`namesIn`), so its rows are never replaced by none.
 */
function listFolder(repo: Repo, folder: string): { names: string[]; over: number } {
  const visible = namesIn(join(repo.path, ...folder.split("/")))
    .filter((name) => !name.startsWith("."))
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return {
    names: visible.slice(0, FOLDER_CAP).filter((name) => name.endsWith(".md")),
    over: Math.max(0, visible.length - FOLDER_CAP),
  };
}

/**
 * A listed file's bytes, or why it was not read. A link, a folder or anything else that
 * is not a regular file is never opened: it is listed with its problem. Null only for a
 * name that went away since it was listed; a name that cannot be looked at is a refusal
 * (`lookAt`), so a folder that lists and cannot be searched does not read as empty.
 */
function readListed(path: string): { bytes: Uint8Array } | { problem: string } | null {
  const stat = lookAt(path);
  if (stat === null) return null;
  if (stat.isSymbolicLink()) {
    return { problem: "a symbolic link; the knowledge store never follows links" };
  }
  if (!stat.isFile()) return { problem: "not a regular file" };
  try {
    const bytes = readRegularFile(path);
    return bytes === null ? null : { bytes };
  } catch (error) {
    if (error instanceof KnowledgeError) return { problem: error.message };
    throw error;
  }
}

/** The paths git lists as changed; null when git cannot be asked, and the check is skipped. */
function changedPaths(store: KnowledgeStore, repo: Repo): Set<string> | null {
  try {
    return new Set(statusOf(store, repo, [ENTRIES_DIR, "proposals"]).map((line) => line.slice(3)));
  } catch (error) {
    if (error instanceof KnowledgeError && error.code === "git") return null;
    throw error;
  }
}

export interface RebuildResult {
  entries: number;
  proposals: number;
  open: number;
  problems: number;
  overCap: number;
  dirtyChecked: boolean;
}

/** What a repository's files hold, read and parsed, before git or the database has a say. */
export interface RepoFiles {
  entries: { entry: KnowledgeEntry; path: string; hash: string }[];
  proposals: { proposal: KnowledgeProposal; path: string; hash: string }[];
  /** Files the folder caps left out. */
  overCap: number;
}

/**
 * Reads a repository's entries and proposals from its files. No file fails it: one that
 * cannot be read, has no usable id, or shares another's id is listed under its name with
 * its problem. What does fail it is a folder that cannot be listed, or a name in it that
 * cannot be looked at: a refusal that names the path (`listFolder`, `readListed`), so
 * that no caller replaces the repository's rows with fewer than its files. It touches
 * neither git nor the database, so `doctor` reads the same way.
 */
export function readRepoFiles(store: KnowledgeStore, repo: Repo): RepoFiles {
  const taxonomy = taxonomyOrNull(store, repo);
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  let read = 0;
  let overCap = 0;
  const renewed = () => {
    if (++read % RENEW_EVERY === 0) store.renew?.();
  };

  const entries: { entry: KnowledgeEntry; path: string; hash: string }[] = [];
  const entryIds = new Map<string, string>();
  const listed = listFolder(repo, ENTRIES_DIR);
  overCap += listed.over;
  for (const name of listed.names) {
    const path = `${ENTRIES_DIR}/${name}`;
    const slug = name.slice(0, -".md".length);
    const file = readListed(join(repo.path, ENTRIES_DIR, name));
    if (file === null) continue;
    renewed();
    let entry =
      "problem" in file
        ? unreadEntry(slug, file.problem)
        : parseEntry(decode(file.bytes), slug, taxonomy);
    if (UUID.test(entry.id)) {
      // Of the files that share an id, the first name in byte order keeps it.
      const first = entryIds.get(entry.id);
      if (first === undefined) entryIds.set(entry.id, slug);
      else {
        entry = {
          ...entry,
          id: `dup:${slug}`,
          status: "draft",
          problem: also(
            entry.problem,
            `its id is also the id of ${first}; one of them needs its own`,
          ),
        };
      }
    }
    entries.push({ entry, path, hash: "problem" in file ? "" : hashOf(file.bytes) });
  }

  const proposals: { proposal: KnowledgeProposal; path: string; hash: string }[] = [];
  const proposalIds = new Set<string>();
  // The open folder first: of an id under both folders, the open file keeps it.
  for (const folder of [OPEN_DIR, DECIDED_DIR]) {
    const names = listFolder(repo, folder);
    overCap += names.over;
    for (const name of names.names) {
      const path = `${folder}/${name}`;
      const file = readListed(join(repo.path, ...folder.split("/"), name));
      if (file === null) continue;
      renewed();
      let proposal =
        "problem" in file
          ? unreadProposal(name, file.problem)
          : parseProposal(decode(file.bytes), name, taxonomy);
      if (UUID.test(proposal.id)) {
        if (proposalIds.has(proposal.id)) {
          proposal = {
            ...proposal,
            id: `dup:${proposalName(path)}`,
            problem: also(proposal.problem, "its id is also the id of another proposal file"),
          };
        } else proposalIds.add(proposal.id);
      }
      // A file moved here by hand says nothing of how it was decided: listed, with why.
      if (folder === DECIDED_DIR && proposal.decision === null && !("problem" in file)) {
        proposal = {
          ...proposal,
          problem: also(proposal.problem, "under proposals/decided with no decision"),
        };
      }
      proposals.push({ proposal, path, hash: "problem" in file ? "" : hashOf(file.bytes) });
    }
  }
  return { entries, proposals, overCap };
}

/** What a rebuild reads before its transaction: git's answers and the files. */
export interface RepoState {
  head: string | null;
  fingerprint: string;
  /** The paths git lists as changed; null when git could not be asked. */
  changed: Set<string> | null;
  files: RepoFiles;
}

/**
 * Everything a rebuild needs from the disk and from git, read with no lock held: the
 * write transaction that follows only replaces rows, so a hook waits for it as briefly as
 * it can. The head and the fingerprint are taken before the files are read: a file added
 * while they are read then shows as a fingerprint the index does not hold, and the next
 * refresh reads the repository again. Writes nothing.
 */
export function readRepoState(store: KnowledgeStore, repo: Repo): RepoState {
  const head = headOf(repo.path);
  const fingerprint = fingerprintOf(repo.path);
  const changed = changedPaths(store, repo);
  return { head, fingerprint, changed, files: readRepoFiles(store, repo) };
}

/** The files as they are indexed: one git lists as changed is a draft with a problem. */
function marked(state: RepoState): Pick<RepoFiles, "entries" | "proposals"> {
  const { changed, files } = state;
  return {
    entries: files.entries.map((file) =>
      changed?.has(file.path)
        ? {
            ...file,
            entry: {
              ...file.entry,
              status: "draft",
              problem: also(file.entry.problem, CHANGED_OUTSIDE),
            },
          }
        : file,
    ),
    proposals: files.proposals.map((file) =>
      changed?.has(file.path)
        ? {
            ...file,
            proposal: { ...file.proposal, problem: also(file.proposal.problem, CHANGED_OUTSIDE) },
          }
        : file,
    ),
  };
}

/**
 * The one write transaction of a rebuild: the repository's search rows go by the rowids
 * its entry rows hold, then its entry and proposal rows, and the rows of `state` are
 * written in their place. No statement reads another repository's rows. The rows of what
 * was shown stay: a rebuild does not unsay what a session was shown.
 */
export function replaceRepoRows(store: KnowledgeStore, repo: Repo, state: RepoState): void {
  const { entries, proposals } = marked(state);
  withWrite(store.db, () => {
    store.db.query(DELETE_REPO_SEARCH_ROWS).run(repo.id);
    store.db.run("DELETE FROM knowledge_entries WHERE repo_id = ?", [repo.id]);
    store.db.run("DELETE FROM knowledge_proposals WHERE repo_id = ?", [repo.id]);
    // The files hold one slug per name and one id per entry (`readRepoFiles`): nothing to replace.
    for (const { entry, path, hash } of entries) insertEntry(store, repo.id, entry, path, hash);
    for (const { proposal, path, hash } of proposals) {
      upsertProposal(store, repo.id, proposal, path, hash);
    }
    recordRepo(
      store,
      repo.id,
      state.head,
      state.fingerprint,
      state.files.overCap,
      state.changed !== null,
    );
  });
}

/**
 * Replaces the repository's rows with what its files hold, in one transaction. A file git
 * lists as changed is a draft with a problem until a person adopts it.
 */
export function rebuildRepo(store: KnowledgeStore, repo: Repo): RebuildResult {
  requireSchema(store);
  const state = readRepoState(store, repo);
  store.renew?.();
  replaceRepoRows(store, repo, state);
  const { entries, proposals } = marked(state);
  return {
    entries: entries.length,
    proposals: proposals.length,
    open: proposals.filter(({ path }) => path.startsWith(`${OPEN_DIR}/`)).length,
    problems:
      entries.filter(({ entry }) => entry.problem !== null).length +
      proposals.filter(({ proposal }) => proposal.problem !== null).length,
    overCap: state.files.overCap,
    dirtyChecked: state.changed !== null,
  };
}

/** What a command over several repositories did: one result each, or why one was refused. */
export type InEachRepo<T> = ReturnType<typeof listRepos> & {
  results: Map<string, T>;
  /** The repositories the store refused, each with why. */
  refused: Map<string, string>;
};

/**
 * Opens each listed repository of a scope (every scope when none is given) and does
 * `work` in it. A repository the store refuses, at its opening or during the work, is set
 * aside with why and does not stop the others; any other failure stops the command. A
 * listed folder with no repository in it has no result. The one place this rule lives,
 * for `rebuild`, `list` and `adopt`.
 */
export function inEachRepo<T>(
  store: KnowledgeStore,
  scope: ScopeRef["scope"] | undefined,
  work: (repo: Repo) => T,
): InEachRepo<T> {
  const listed = listRepos(store);
  const repos = listed.repos.filter((repo) => scope === undefined || repo.ref.scope === scope);
  const results = new Map<string, T>();
  const refused = new Map<string, string>();
  for (const found of repos) {
    try {
      const repo = openRepo(store, found.ref);
      if (repo !== null) results.set(repo.relative, work(repo));
    } catch (error) {
      if (!isRefusal(error)) throw error;
      refused.set(found.relative, error.message);
    }
  }
  return { ...listed, repos, results, refused };
}

/**
 * No knowledge folder at all under this data directory, and repositories in the index: they
 * were written under another data directory that shares this database, or the folder was
 * removed whole, and the store cannot tell which. Read as "every repository is gone", a
 * rebuild would forget the rows of repositories that are all still on the disk, and a write
 * would make a second copy of a repository beside the first. So the person says which: an
 * empty folder made by hand means they are gone. `rebuild` and every write of an agent
 * refuse in this state; `verb` says what was not done, `who` who should run under the other
 * data directory.
 */
export function requireKnowledgeRoot(
  store: KnowledgeStore,
  verb: "forgotten" | "written",
  who: "rebuild" | "the agent",
  scope?: ScopeRef["scope"],
): void {
  const root = knowledgeRoot(store.dataDir);
  // A rebuild of one scope looks at that scope's rows (a scope the index holds nothing of
  // has nothing to forget); a write looks at every row, since it would make a folder tree
  // here beside the one that holds them.
  const known =
    scope === undefined
      ? store.db.query<{ n: number }, []>("SELECT count(*) AS n FROM knowledge_repos").get()?.n
      : store.db
          .query<{ n: number }, [string]>(
            "SELECT count(*) AS n FROM knowledge_repos WHERE scope = ?",
          )
          .get(scope)?.n;
  if (known !== undefined && known > 0 && kindAt(root) === "absent") {
    throw new KnowledgeError(
      "invalid",
      `${root} is not there, and the index holds ${known === 1 ? "a repository" : `${known} repositories`} under it; nothing was ${verb}. If the knowledge is under another data directory (WIZARDINGCODE_MEM_DATA_DIR, WIZARDINGCODE_HOME), run ${who} under that one. If the folder was removed on purpose, make it again, empty, and run ${who === "rebuild" ? "rebuild" : "knowledge rebuild"} once more`,
    );
  }
}

/**
 * Rebuilds every repository under the data directory (or every one of a scope), and
 * forgets the rows of repositories whose folder is gone: the ones with nothing at their
 * name. A link or a file put where a folder was is set aside by name, and its rows stay.
 * A project folder is mapped to its project by its row, else through its manifest; a
 * folder no project claims is reported and indexes nothing. Refused, with nothing
 * forgotten, when the data directory has no knowledge folder at all and the index holds
 * repositories: the rows are another data directory's until the person says otherwise.
 */
export function rebuildAll(
  store: KnowledgeStore,
  scope?: ScopeRef["scope"],
): InEachRepo<RebuildResult> {
  requireSchema(store);
  const held = () =>
    store.db
      .query<{ id: number; scope: string; path: string }, []>(
        "SELECT id, scope, path FROM knowledge_repos",
      )
      .all()
      .filter((row) => scope === undefined || row.scope === scope);
  requireKnowledgeRoot(store, "forgotten", "rebuild", scope);
  const all = inEachRepo(store, scope, (repo) =>
    withRepoLeases(store, [repo.relative], () => rebuildRepo(store, repo)),
  );
  for (const row of held()) {
    // Only a name with nothing at it is gone. A folder that cannot be looked at refuses
    // the rebuild (`kindAt`); a link or a file put where the folder was has been set aside
    // by name above (`inEachRepo`). The rows of both stay.
    if (kindAt(repoPath(store.dataDir, row.path)) !== "absent") continue;
    withWrite(store.db, () => {
      dropRepoRows(store.db, row.id);
      store.db.run("DELETE FROM knowledge_repos WHERE id = ?", [row.id]);
    });
  }
  // A search row no entry row points at is the index writer's gap: `doctor` reports it,
  // and this pass is how `knowledge rebuild` repairs it, whatever the scope rebuilt.
  withWrite(store.db, () => {
    store.db.run(
      `DELETE FROM knowledge_fts
        WHERE rowid NOT IN (SELECT fts_rowid FROM knowledge_entries WHERE fts_rowid IS NOT NULL)
          AND rowid NOT IN (SELECT fts_rowid FROM knowledge_received WHERE fts_rowid IS NOT NULL)`,
    );
  });
  return all;
}

/** Rebuilds the repository's rows when its HEAD or its fingerprint is not what was indexed. */
export function ensureFresh(store: KnowledgeStore, repo: Repo): void {
  requireSchema(store);
  const row = store.db
    .query<{ head: string | null; fingerprint: string | null }, [number]>(
      "SELECT head, fingerprint FROM knowledge_repos WHERE id = ?",
    )
    .get(repo.id);
  if (row?.head === headOf(repo.path) && row.fingerprint === fingerprintOf(repo.path)) return;
  rebuildRepo(store, repo);
}

// --- The drain's refresh --------------------------------------------------------------

interface HeldRepo {
  id: number;
  scope: ScopeRef["scope"];
  project_id: number;
  path: string;
  head: string | null;
  fingerprint: string | null;
}

const refOf = (row: HeldRepo): ScopeRef =>
  row.scope === "project" ? { scope: "project", projectId: row.project_id } : { scope: row.scope };

/**
 * One repository of the refresh: forgotten when its folder is gone, left alone when the
 * index holds what the disk holds (`ensureFresh`'s comparison), otherwise rebuilt under its
 * lease in its own transaction. True only for a rebuild.
 */
function refreshOne(store: KnowledgeStore, row: HeldRepo): boolean {
  const path = repoPath(store.dataDir, row.path);
  if (kindAt(path) === "absent") {
    withWrite(store.db, () => {
      dropRepoRows(store.db, row.id);
      store.db.run("DELETE FROM knowledge_repos WHERE id = ?", [row.id]);
    });
    return false;
  }
  if (row.head === headOf(path) && row.fingerprint === fingerprintOf(path)) return false;
  const repo = openRepo(store, refOf(row));
  if (repo === null) return false;
  withRepoLeases(store, [repo.relative], () => rebuildRepo(store, repo));
  return true;
}

/**
 * The drain's refresh: brings into the index the repositories whose files changed, so
 * that the hooks, which read no file, see them. Every repository the index knows is
 * compared with the disk, the least recently indexed first, and at most `limit` that
 * differ are rebuilt. A repository whose folder is gone is forgotten, as `rebuildAll`
 * forgets it; with the knowledge root itself absent nothing is forgotten, since the rows
 * may be another data directory's. A lease held elsewhere passes a repository over; any
 * other failure is logged; neither counts, and none leaves this function. Returns the
 * repositories rebuilt.
 */
export function refreshStale(store: KnowledgeStore, limit: number): number {
  const log = (error: unknown) => logError("knowledge.refresh", error, store.dataDir);
  let rebuilt = 0;
  try {
    requireSchema(store);
    const rows = store.db
      .query<HeldRepo, []>(
        "SELECT id, scope, project_id, path, head, fingerprint FROM knowledge_repos ORDER BY indexed_at, id",
      )
      .all();
    if (rows.length === 0) return 0;
    const root = knowledgeRoot(store.dataDir);
    if (kindAt(root) === "absent") {
      log(new Error(`${root} is not there; the index keeps its repositories`));
      return 0;
    }
    // The states rebuild refuses (the root or its projects folder a link or a file): every
    // repository path would then read as absent, or through the link. Refused, logged once,
    // nothing forgotten, as rebuildAll's own rule.
    refuseLinkedRoots(store.dataDir);
    for (const row of rows) {
      if (rebuilt >= limit) break;
      try {
        if (refreshOne(store, row)) rebuilt++;
      } catch (error) {
        if (!(error instanceof KnowledgeError && error.code === "locked")) log(error);
      }
    }
  } catch (error) {
    log(error);
  }
  return rebuilt;
}

// --- Reading the index on the hook path and in the tools ----------------------------------

/** Where a received entry came from (ADR 0027). */
export interface HitProvenance {
  serverId: string;
  serverName: string;
  memberId: string;
  memberName: string;
  uid: string;
  /** The entry's own uuid: what a reference's eight hex name, `knowledge take` and `knowledge_get`'s `id:` line show. */
  id: string;
  /** The member is this device's own: an item of theirs from another device. */
  ownDevice: boolean;
}

/** A teammate's revision applied to an own entry, not yet edited by the person since. */
export interface RevisedBy {
  serverId: string;
  serverName: string;
  memberName: string;
  /** The entry is pinned, and its pin is held until the person edits or pins it again. */
  pinHeld: boolean;
}

/** An indexed entry as a search finds it: where it is, and how well it matched. */
export type Hit = KnowledgeEntry & {
  /** `RECEIVED_REPO_ID` for a received entry. */
  repoId: number;
  scope: "workspace" | "project" | "shared";
  hash: string;
  /** bm25's score, lower is better; 0 outside a search. */
  bm25: number;
  /** Set on a received entry: the server and the member it came from. */
  received?: HitProvenance;
  /** Set on an own entry a teammate revised, by the `applied` ledger row whose local hash is the index's. */
  revisedBy?: RevisedBy;
};

/**
 * What a read passes to see received entries: the project asked for, or null for none. Its
 * received project items are those under the alias its level binds it with (`RECEIVED_VISIBLE`
 * reads the binding itself), so no caller names an alias.
 */
export interface ReceivedScope {
  projectId: number | null;
}

/** Whether the store has the sharing tables these reads join; asked once per open. */
const sharingKnown = new WeakMap<Db, boolean>();
function hasSharingTables(db: Db): boolean {
  let known = sharingKnown.get(db);
  if (known === undefined) {
    known =
      (db
        .query<{ n: number }, []>(
          `SELECT count(*) AS n FROM sqlite_master
            WHERE name IN ('sharing_servers', 'sharing_muted_members', 'sharing_levels', 'sharing_ledger')`,
        )
        .get()?.n ?? 0) === 4;
    sharingKnown.set(db, known);
  }
  return known;
}

/**
 * The received rows an agent may see, by the module's own SQL over the sharing tables: only
 * listed, confirmed, unmuted servers; never a muted member; every server's shared and
 * workspace items, and the project items under the alias the asked project's level binds it
 * to that server with (`boundAliasesOf`'s rule: the level's `bound_alias`, still one of the
 * project's aliases), so the copies of any other alias, which no pull refreshes, stay out.
 * The one parameter is the project id, null for none.
 */
const RECEIVED_VISIBLE = `
  JOIN sharing_servers s ON s.server_id = x.server_id AND s.confirmed_at IS NOT NULL AND s.muted = 0
  WHERE x.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM knowledge_entries e2 WHERE e2.id = x.id)
    AND NOT EXISTS (SELECT 1 FROM sharing_muted_members mm
                     WHERE mm.server_id = x.server_id AND mm.member_id = x.member_id)
    AND (x.scope IN ('workspace', 'shared')
         OR (x.scope = 'project'
             AND EXISTS (SELECT 1 FROM sharing_levels l
                          JOIN projects p ON p.id = l.project_id
                          JOIN project_aliases a ON a.project_id = l.project_id AND a.alias = l.bound_alias
                         WHERE l.project_id = ? AND l.destination = x.server_id AND l.level != 'local'
                           AND p.disabled = 0 AND l.bound_alias = x.remote_alias)))`;

const RECEIVED_HIT_COLUMNS = `x.server_id, x.uid, x.scope, x.remote_alias, x.project_id, x.member_id, x.member_name,
  x.id, x.slug, x.path, x.title, x.kind, x.area, x.context, x.subject, x.status, x.author, x.version,
  x.body, x.hash, x.revision, x.received_at, x.fts_rowid, s.name AS server_name,
  (x.member_id = s.member_id) AS own_device`;

type ReceivedHitRow = ReceivedRaw & { server_name: string; own_device: number; rank?: number };

/** A received row as a hit: repository 0, the entry id the search table keys it by, its provenance. */
export function hitOfReceived(raw: ReceivedHitRow): Hit {
  return {
    id: receivedEntryId(raw.server_id, raw.uid),
    slug: raw.slug,
    title: raw.title,
    kind: raw.kind,
    area: raw.area,
    context: raw.context,
    subject: raw.subject,
    status: raw.status,
    author: raw.author,
    version: raw.version,
    created: null,
    updated: null,
    supersedes: null,
    pinned: false,
    body: raw.body,
    extra: [],
    problem: null,
    repoId: RECEIVED_REPO_ID,
    scope: raw.scope,
    hash: raw.hash,
    bm25: raw.rank ?? 0,
    received: {
      serverId: raw.server_id,
      serverName: raw.server_name,
      memberId: raw.member_id,
      memberName: raw.member_name,
      uid: raw.uid,
      id: raw.id,
      ownDevice: raw.own_device === 1,
    },
  };
}

/** The received hits a browse lists: active, visible, newest received first. */
function browseReceived(
  db: Db,
  received: ReceivedScope,
  filters: { area?: string; kind?: string },
  limit: number,
): Hit[] {
  if (!hasSharingTables(db) || !hasReceivedTable(db)) return [];
  return db
    .query<ReceivedHitRow, (string | number | null)[]>(
      `SELECT ${RECEIVED_HIT_COLUMNS}, 0 AS rank FROM knowledge_received x ${RECEIVED_VISIBLE}
          AND (? IS NULL OR x.area = ?)
          AND (? IS NULL OR x.kind = ?)
        ORDER BY x.received_at DESC, x.server_id, x.slug
        LIMIT ?`,
    )
    .all(
      received.projectId,
      filters.area ?? null,
      filters.area ?? null,
      filters.kind ?? null,
      filters.kind ?? null,
      limit,
    )
    .map(hitOfReceived);
}

/** The received hits a search finds, best first by bm25, those already shown left out. */
function searchReceived(
  db: Db,
  match: string,
  received: ReceivedScope,
  filters: { area?: string; kind?: string },
  excludeShown: Set<string> | null,
  limit: number,
): Hit[] {
  if (!hasSharingTables(db) || !hasReceivedTable(db)) return [];
  return db
    .query<ReceivedHitRow, (string | number | null)[]>(
      `SELECT ${RECEIVED_HIT_COLUMNS}, bm25(knowledge_fts, ${BM25_WEIGHTS.join(", ")}) AS rank
         FROM knowledge_fts f
         JOIN knowledge_received x ON x.fts_rowid = f.rowid ${RECEIVED_VISIBLE}
          AND knowledge_fts MATCH ?
          AND f.repo_id = ${RECEIVED_REPO_ID}
          AND (? IS NULL OR x.area = ?)
          AND (? IS NULL OR x.kind = ?)
          AND (${RECEIVED_REPO_ID} || ':' || x.server_id || '|' || x.uid) NOT IN (SELECT value FROM json_each(?))
        ORDER BY rank, x.server_id, x.slug
        LIMIT ?`,
    )
    .all(
      received.projectId,
      match,
      filters.area ?? null,
      filters.area ?? null,
      filters.kind ?? null,
      filters.kind ?? null,
      JSON.stringify([...(excludeShown ?? [])]),
      limit,
    )
    .map(hitOfReceived);
}

/**
 * Marks the own entries a teammate revised: an `applied` ledger row whose `local_hash` is the
 * entry's index hash and whose uid ends with the entry's id, read from the sharing tables by
 * the module's own SQL. A derived state: a rebuild loses nothing, and the person's next edit
 * (a new hash) releases it. The pin of such an entry is held.
 */
function withRevisions(db: Db, hits: Hit[]): Hit[] {
  if (hits.length === 0 || !hasSharingTables(db)) return hits;
  const own = hits.filter((hit) => hit.repoId !== RECEIVED_REPO_ID);
  if (own.length === 0) return hits;
  const rows = db
    .query<
      {
        repo_id: number;
        id: string;
        server_id: string;
        server_name: string;
        reason: string;
      },
      [string]
    >(
      `SELECT e.repo_id, e.id, l.destination AS server_id, s.name AS server_name, l.reason
         FROM knowledge_entries e
         JOIN sharing_ledger l ON ${APPLIED_ROW_OF_ENTRY}
         JOIN sharing_servers s ON s.server_id = l.destination
        WHERE e.repo_id || ':' || e.id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(own.map((hit) => `${hit.repoId}:${hit.id}`)));
  if (rows.length === 0) return hits;
  const byEntry = new Map(rows.map((row) => [`${row.repo_id}:${row.id}`, row]));
  return hits.map((hit) => {
    const row =
      hit.repoId === RECEIVED_REPO_ID ? undefined : byEntry.get(`${hit.repoId}:${hit.id}`);
    if (row === undefined) return hit;
    return {
      ...hit,
      revisedBy: {
        serverId: row.server_id,
        serverName: row.server_name,
        memberName: row.reason,
        pinHeld: hit.pinned,
      },
    };
  });
}

/**
 * The one rule that ties an own entry `e` to the `applied` ledger row `l` of a teammate's
 * revision: the row's local hash is the entry's index hash (no edit since the apply) and its
 * uid ends with the entry's id. The revised-by marker and the held pin both read it.
 */
const APPLIED_ROW_OF_ENTRY = `l.direction = 'applied' AND l.item_kind = 'entry'
                     AND l.local_hash = e.hash AND l.item_uid LIKE '%:' || e.id`;

/**
 * The own entries whose pin is not held: no teammate's revision applied since the person's
 * last edit (`APPLIED_ROW_OF_ENTRY` finds none). What the pinned block keeps.
 */
const PIN_NOT_HELD = `NOT EXISTS (SELECT 1 FROM sharing_ledger l WHERE ${APPLIED_ROW_OF_ENTRY})`;

/** The received row a `knowledge_get` reference names: the server, the slug and the uuid's first eight. */
export function receivedByFile(
  db: Db,
  serverId: string,
  slug: string,
  hex8: string,
  received: ReceivedScope,
): Hit | null {
  if (!hasSharingTables(db) || !hasReceivedTable(db)) return null;
  const raw = db
    .query<ReceivedHitRow, [number | null, string, string, string]>(
      `SELECT ${RECEIVED_HIT_COLUMNS}, 0 AS rank FROM knowledge_received x ${RECEIVED_VISIBLE}
          AND x.server_id = ? AND x.slug = ? AND x.id LIKE ? || '%'`,
    )
    .get(received.projectId, serverId, slug, hex8);
  return raw === null ? null : hitOfReceived(raw);
}

/**
 * The one match string the search table is given: any of the tokens, each quoted by
 * `anyOf`, confined to the text columns so that no term reaches an id column. A token is
 * one term: a word, or an identifier the index reads as a phrase. Null with no token.
 */
export function ftsMatch(tokens: string[]): string | null {
  const terms = [...new Set(tokens.filter((token) => token !== ""))];
  if (terms.length === 0) return null;
  return `{title area context subject body} : (${anyOf(terms)})`;
}

interface HitRow extends EntryRow {
  repo_id: number;
  scope: Hit["scope"];
  hash: string;
  rank: number;
}

const toHit = (row: HitRow): Hit => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  kind: row.kind,
  area: row.area,
  context: row.context,
  subject: row.subject,
  status: row.status,
  author: row.author,
  version: row.version,
  created: row.created,
  updated: row.updated,
  supersedes: row.supersedes,
  pinned: row.pinned === 1,
  body: row.body,
  extra: [],
  problem: row.problem,
  repoId: row.repo_id,
  scope: row.scope,
  hash: row.hash,
  bm25: row.rank,
});

/** An entry row and its repository's scope, as every reader below selects them. */
const HIT_COLUMNS = `e.id, e.slug, e.title, e.kind, e.area, e.context, e.subject, e.status, e.author,
              e.version, e.created, e.updated, e.supersedes, e.pinned, e.body, e.problem,
              e.repo_id, e.hash, r.scope`;

/** `repo_id IN (?, …)` for the given ids; never empty, the callers return before. */
const placeholders = (ids: number[]) => ids.map(() => "?").join(", ");

/**
 * The active, problem-free entries of the given repositories with no search: the pinned
 * first, then the newest `updated`. What `knowledge_search` lists for a query with no token.
 */
export function browseEntries(
  db: Db,
  repoIds: number[],
  filters: { area?: string; kind?: string },
  limit: number,
  received?: ReceivedScope,
): Hit[] {
  if (limit <= 0) return [];
  const local =
    repoIds.length === 0
      ? []
      : db
          .query<HitRow, (string | number | null)[]>(
            `SELECT ${HIT_COLUMNS}, 0 AS rank
         FROM knowledge_entries e
         JOIN knowledge_repos r ON r.id = e.repo_id
        WHERE e.repo_id IN (${placeholders(repoIds)})
          AND e.status = 'active' AND e.problem IS NULL
          AND (? IS NULL OR e.area = ?)
          AND (? IS NULL OR e.kind = ?)
        ORDER BY e.pinned DESC, e.updated DESC, e.repo_id, e.slug
        LIMIT ?`,
          )
          .all(
            ...repoIds,
            filters.area ?? null,
            filters.area ?? null,
            filters.kind ?? null,
            filters.kind ?? null,
            limit,
          )
          .map(toHit);
  if (received === undefined) return local;
  // The own entries first (the pinned among them first), then the received, newest first.
  return withRevisions(db, [...local, ...browseReceived(db, received, filters, limit)]).slice(
    0,
    limit,
  );
}

/**
 * The pinned, active, problem-free entries of the given repositories, newest `updated`
 * first: what a session start shows.
 */
export function pinnedEntries(db: Db, repoIds: number[]): Hit[] {
  if (repoIds.length === 0) return [];
  // An own entry a teammate revised keeps its pin out of the brief until the person edits or
  // pins it again (ADR 0027); received entries are never pinned.
  const notHeld = hasSharingTables(db) ? `AND ${PIN_NOT_HELD}` : "";
  return db
    .query<HitRow, number[]>(
      `SELECT ${HIT_COLUMNS}, 0 AS rank
         FROM knowledge_entries e
         JOIN knowledge_repos r ON r.id = e.repo_id
        WHERE e.repo_id IN (${placeholders(repoIds)})
          AND e.pinned = 1 AND e.status = 'active' AND e.problem IS NULL ${notHeld}
        ORDER BY e.updated DESC, e.repo_id, e.slug`,
    )
    .all(...repoIds)
    .map(toHit);
}

/**
 * The search table's rows and the active, problem-free entries, over every repository.
 * The index writer keeps one row per such entry, so two numbers that differ are a gap
 * that `knowledge rebuild` repairs. Read-only.
 */
export function ftsCount(db: Db): { rows: number; active: number } {
  const n = (sql: string) => db.query<{ n: number }, []>(sql).get()?.n ?? 0;
  const received = hasReceivedTable(db)
    ? n("SELECT count(*) AS n FROM knowledge_received WHERE status = 'active'")
    : 0;
  return {
    rows: n("SELECT count(*) AS n FROM knowledge_fts"),
    active:
      n("SELECT count(*) AS n FROM knowledge_entries WHERE status = 'active' AND problem IS NULL") +
      received,
  };
}

/** The indexed row of a slug in one repository, whatever its status; null when there is none. */
export function entryAt(db: Db, repoId: number, slug: string): Hit | null {
  const row = db
    .query<HitRow, [number, string]>(
      `SELECT ${HIT_COLUMNS}, 0 AS rank
         FROM knowledge_entries e
         JOIN knowledge_repos r ON r.id = e.repo_id
        WHERE e.repo_id = ? AND e.slug = ?`,
    )
    .get(repoId, slug);
  return row === null ? null : toHit(row);
}

/** Every open proposal of the given repositories, by title and body: a draft's other neighbours. */
export function openProposalTexts(
  db: Db,
  repoIds: number[],
): { repoId: number; id: string; entryId: string; title: string; body: string }[] {
  if (repoIds.length === 0) return [];
  return db
    .query<{ repoId: number; id: string; entryId: string; title: string; body: string }, number[]>(
      `SELECT repo_id AS repoId, id, entry_id AS entryId, title, body
         FROM knowledge_proposals
        WHERE state = 'open' AND repo_id IN (${placeholders(repoIds)})
        ORDER BY repo_id, id`,
    )
    .all(...repoIds);
}

/** The key of an entry a context was shown: `<repo id>:<entry id>`. */
export const shownKey = (repoId: number, entryId: string) => `${repoId}:${entryId}`;

/**
 * The active, problem-free entries of the given repositories that match any of the tokens,
 * best first by bm25 with the title weighted highest. The repositories, the filters and
 * the entries already shown are confined inside the query, so another project's entry is
 * never a candidate. Takes a database, not a store, since a hook calls it; it does not
 * check the schema, which its callers do.
 */
export function searchEntries(
  db: Db,
  tokens: string[],
  repoIds: number[],
  filters: { area?: string; kind?: string; without?: { repoId: number; entryId: string } },
  excludeShown: Set<string> | null,
  limit: number,
  received?: ReceivedScope,
): Hit[] {
  const match = ftsMatch(tokens);
  if (match === null || limit <= 0) return [];
  if (repoIds.length === 0 && received === undefined) return [];
  const without = filters.without ?? null;
  const local =
    repoIds.length === 0
      ? []
      : db
          .query<HitRow, (string | number | null)[]>(
            `SELECT ${HIT_COLUMNS}, bm25(knowledge_fts, ${BM25_WEIGHTS.join(", ")}) AS rank
         FROM knowledge_fts f
         JOIN knowledge_entries e ON e.repo_id = f.repo_id AND e.id = f.entry_id
         JOIN knowledge_repos r ON r.id = e.repo_id
        WHERE knowledge_fts MATCH ?
          AND f.repo_id IN (${repoIds.map(() => "?").join(", ")})
          AND e.status = 'active' AND e.problem IS NULL
          AND (? IS NULL OR e.area = ?)
          AND (? IS NULL OR e.kind = ?)
          AND NOT (e.repo_id IS ? AND e.id IS ?)
          AND (e.repo_id || ':' || e.id) NOT IN (SELECT value FROM json_each(?))
        ORDER BY rank, e.repo_id, e.slug
        LIMIT ?`,
          )
          .all(
            match,
            ...repoIds,
            filters.area ?? null,
            filters.area ?? null,
            filters.kind ?? null,
            filters.kind ?? null,
            without?.repoId ?? null,
            without?.entryId ?? null,
            JSON.stringify([...(excludeShown ?? [])]),
            limit,
          )
          .map(toHit);
  if (received === undefined) return local;
  const merged = [...local, ...searchReceived(db, match, received, filters, excludeShown, limit)];
  merged.sort((a, b) => a.bm25 - b.bm25 || a.repoId - b.repoId || a.slug.localeCompare(b.slug));
  return withRevisions(db, merged.slice(0, limit));
}

// --- Received entries (ADR 0027) ------------------------------------------------------------------
// Copies of teammates' entries, pulled from a team server by the sync client: rows of
// `knowledge_received`, searchable through `knowledge_fts` under one repository id no
// repository of the store has. This module is their one index writer; it reads the sharing
// tables named here by its own SQL, read-only, and imports nothing of the sharing or sync code.

/** The `repo_id` of every received search row: no repository of the store has it. */
export const RECEIVED_REPO_ID = 0;

/** A received hit's `entry_id` and `Hit.id`: the server and the uid, which no uuid collides with. */
export const receivedEntryId = (serverId: string, uid: string): string => `${serverId}|${uid}`;

export interface ReceivedRow {
  serverId: string;
  uid: string;
  scope: "workspace" | "shared" | "project";
  remoteAlias: string | null;
  /** The enabled project with the alias and the lowest id; 0 outside a project. */
  projectId: number;
  memberId: string;
  memberName: string;
  /** The entry's uuid, as its frontmatter has it. */
  id: string;
  slug: string;
  /** Relative to `knowledge/received/`. */
  path: string;
  title: string;
  kind: string;
  area: string;
  context: string;
  subject: string;
  status: string;
  author: string;
  version: number;
  body: string;
  hash: string;
  revision: number;
  receivedAt: number;
}

interface ReceivedRaw {
  server_id: string;
  uid: string;
  scope: ReceivedRow["scope"];
  remote_alias: string | null;
  project_id: number;
  member_id: string;
  member_name: string;
  id: string;
  slug: string;
  path: string;
  title: string;
  kind: string;
  area: string;
  context: string;
  subject: string;
  status: string;
  author: string;
  version: number;
  body: string;
  hash: string;
  revision: number;
  received_at: number;
  fts_rowid: number | null;
}

const RECEIVED_COLUMNS = `server_id, uid, scope, remote_alias, project_id, member_id, member_name, id, slug,
  path, title, kind, area, context, subject, status, author, version, body, hash, revision,
  received_at, fts_rowid`;

const receivedOf = (raw: ReceivedRaw): ReceivedRow => ({
  serverId: raw.server_id,
  uid: raw.uid,
  scope: raw.scope,
  remoteAlias: raw.remote_alias,
  projectId: raw.project_id,
  memberId: raw.member_id,
  memberName: raw.member_name,
  id: raw.id,
  slug: raw.slug,
  path: raw.path,
  title: raw.title,
  kind: raw.kind,
  area: raw.area,
  context: raw.context,
  subject: raw.subject,
  status: raw.status,
  author: raw.author,
  version: raw.version,
  body: raw.body,
  hash: raw.hash,
  revision: raw.revision,
  receivedAt: raw.received_at,
});

/** Whether the store has the received table (knowledge v8); asked once per open. */
const receivedKnown = new WeakMap<Db, boolean>();
export function hasReceivedTable(db: Db): boolean {
  let known = receivedKnown.get(db);
  if (known === undefined) {
    known =
      db
        .query<unknown, []>("SELECT 1 FROM sqlite_master WHERE name = 'knowledge_received'")
        .get() !== null;
    receivedKnown.set(db, known);
  }
  return known;
}

/**
 * Writes or replaces a received row, and its search row when the entry is active: the one
 * writer of `knowledge_fts` rows for received entries. Plain statements, inside the caller's
 * transaction.
 */
export function indexReceivedRow(db: Db, row: ReceivedRow): void {
  const old = db
    .query<{ fts_rowid: number | null }, [string, string]>(
      "SELECT fts_rowid FROM knowledge_received WHERE server_id = ? AND uid = ?",
    )
    .get(row.serverId, row.uid);
  if (old?.fts_rowid !== null && old?.fts_rowid !== undefined) {
    db.query(DELETE_SEARCH_ROW).run(old.fts_rowid);
  }
  const ftsRowid =
    row.status === "active"
      ? Number(
          db
            .query(
              `INSERT INTO knowledge_fts (title, area, context, subject, body, repo_id, entry_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              row.title,
              row.area,
              row.context,
              row.subject,
              row.body,
              RECEIVED_REPO_ID,
              receivedEntryId(row.serverId, row.uid),
            ).lastInsertRowid,
        )
      : null;
  db.run(
    `INSERT OR REPLACE INTO knowledge_received (${RECEIVED_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.serverId,
      row.uid,
      row.scope,
      row.remoteAlias,
      row.projectId,
      row.memberId,
      row.memberName,
      row.id,
      row.slug,
      row.path,
      row.title,
      row.kind,
      row.area,
      row.context,
      row.subject,
      row.status,
      row.author,
      row.version,
      row.body,
      row.hash,
      row.revision,
      row.receivedAt,
      ftsRowid,
    ],
  );
}

/** Drops a received row and its search row; nothing when there is none. */
export function dropReceivedRow(db: Db, serverId: string, uid: string): boolean {
  const old = db
    .query<{ fts_rowid: number | null }, [string, string]>(
      "SELECT fts_rowid FROM knowledge_received WHERE server_id = ? AND uid = ?",
    )
    .get(serverId, uid);
  if (old === null) return false;
  if (old.fts_rowid !== null) db.query(DELETE_SEARCH_ROW).run(old.fts_rowid);
  db.run("DELETE FROM knowledge_received WHERE server_id = ? AND uid = ?", [serverId, uid]);
  return true;
}

/** The received rows, every server's or one's, by server, scope and slug. */
export function receivedRows(db: Db, serverId?: string): ReceivedRow[] {
  if (!hasReceivedTable(db)) return [];
  return db
    .query<ReceivedRaw, [string | null]>(
      `SELECT ${RECEIVED_COLUMNS} FROM knowledge_received
        WHERE (?1 IS NULL OR server_id = ?1) ORDER BY server_id, scope, slug, uid`,
    )
    .all(serverId ?? null)
    .map(receivedOf);
}

export function receivedRow(db: Db, serverId: string, uid: string): ReceivedRow | null {
  if (!hasReceivedTable(db)) return null;
  const raw = db
    .query<ReceivedRaw, [string, string]>(
      `SELECT ${RECEIVED_COLUMNS} FROM knowledge_received WHERE server_id = ? AND uid = ?`,
    )
    .get(serverId, uid);
  return raw === null ? null : receivedOf(raw);
}

/** The server ids that have received rows. */
export function receivedServerIds(db: Db): string[] {
  if (!hasReceivedTable(db)) return [];
  return db
    .query<{ server_id: string }, []>(
      "SELECT DISTINCT server_id FROM knowledge_received ORDER BY server_id",
    )
    .all()
    .map((row) => row.server_id);
}

/**
 * The server a name or an id names, read from the sharing module's table by this module's
 * own SQL: `knowledge_get` resolves `<server>:<file>` with it. A name two servers share is
 * `ambiguous` with their ids; a name with a colon can never be named. Null when the table is
 * absent or nothing matches.
 */
export function serverByName(
  db: Db,
  name: string,
): { serverId: string; name: string } | { ambiguous: string[] } | null {
  const present =
    db.query<unknown, []>("SELECT 1 FROM sqlite_master WHERE name = 'sharing_servers'").get() !==
    null;
  if (!present) return null;
  const byId = db
    .query<{ serverId: string; name: string }, [string]>(
      "SELECT server_id AS serverId, name FROM sharing_servers WHERE server_id = ?",
    )
    .get(name);
  if (byId !== null) return byId;
  const byName = db
    .query<{ serverId: string; name: string }, [string]>(
      "SELECT server_id AS serverId, name FROM sharing_servers WHERE name = ? ORDER BY server_id",
    )
    .all(name);
  if (byName.length > 1) return { ambiguous: byName.map((row) => row.serverId) };
  return byName[0] ?? null;
}
