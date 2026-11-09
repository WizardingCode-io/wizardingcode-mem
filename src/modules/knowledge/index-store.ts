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
  // No knowledge folder at all under this data directory, and repositories in the index:
  // they were written under another data directory that shares this database, or the
  // folder was removed whole, and the store cannot tell which. Read as "every repository
  // is gone", the first would forget the rows of repositories that are all still on the
  // disk. So the person says which: an empty folder made by hand means they are gone.
  const root = knowledgeRoot(store.dataDir);
  const known = held().length;
  if (known > 0 && kindAt(root) === "absent") {
    throw new KnowledgeError(
      "invalid",
      `${root} is not there, and the index holds ${known === 1 ? "a repository" : `${known} repositories`} under it; nothing was forgotten. If the knowledge is under another data directory (WIZARDINGCODE_MEM_DATA_DIR, WIZARDINGCODE_HOME), run rebuild under that one. If the folder was removed on purpose, make it again, empty, and run rebuild once more`,
    );
  }
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
      "DELETE FROM knowledge_fts WHERE rowid NOT IN (SELECT fts_rowid FROM knowledge_entries WHERE fts_rowid IS NOT NULL)",
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

/** An indexed entry as a search finds it: where it is, and how well it matched. */
export type Hit = KnowledgeEntry & {
  repoId: number;
  scope: "workspace" | "project" | "shared";
  hash: string;
  /** bm25's score, lower is better; 0 outside a search. */
  bm25: number;
};

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
): Hit[] {
  if (repoIds.length === 0 || limit <= 0) return [];
  return db
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
}

/**
 * The pinned, active, problem-free entries of the given repositories, newest `updated`
 * first: what a session start shows.
 */
export function pinnedEntries(db: Db, repoIds: number[]): Hit[] {
  if (repoIds.length === 0) return [];
  return db
    .query<HitRow, number[]>(
      `SELECT ${HIT_COLUMNS}, 0 AS rank
         FROM knowledge_entries e
         JOIN knowledge_repos r ON r.id = e.repo_id
        WHERE e.repo_id IN (${placeholders(repoIds)})
          AND e.pinned = 1 AND e.status = 'active' AND e.problem IS NULL
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
  return {
    rows: n("SELECT count(*) AS n FROM knowledge_fts"),
    active: n(
      "SELECT count(*) AS n FROM knowledge_entries WHERE status = 'active' AND problem IS NULL",
    ),
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
): Hit[] {
  const match = ftsMatch(tokens);
  if (match === null || repoIds.length === 0 || limit <= 0) return [];
  const without = filters.without ?? null;
  return db
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
}
