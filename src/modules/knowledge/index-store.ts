// The index of the knowledge store: rows in the engine's database, rebuilt from the files.
// The files in the repositories are the truth; nothing here is the only copy of anything.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withWrite } from "../../store/db.ts";
import { parseEntry, parseProposal, UUID, unreadEntry, unreadProposal } from "./entry.ts";
import { KnowledgeError } from "./errors.ts";
import {
  DECIDED_DIR,
  ENTRIES_DIR,
  fingerprintOf,
  hashOf,
  headOf,
  isDirectory,
  OPEN_DIR,
  openRepo,
  readRegularFile,
  repoPath,
  statusOf,
  taxonomyFor,
  withRepoLeases,
} from "./repo.ts";
import { listRepos } from "./resolve.ts";
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

/** One row per slug: a problem row and a later good row for the same file never collide. */
export function upsertEntry(
  store: KnowledgeStore,
  repoId: number,
  entry: KnowledgeEntry,
  path: string,
  hash: string,
): void {
  store.db.run("DELETE FROM knowledge_entries WHERE repo_id = ? AND slug = ?", [
    repoId,
    entry.slug,
  ]);
  store.db.run(
    `INSERT OR REPLACE INTO knowledge_entries
       (repo_id, id, slug, path, title, kind, area, context, subject, status, author, version,
        created, updated, supersedes, body, problem, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      repoId,
      rowId(entry.id, entry.slug),
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
    ],
  );
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
  store.db.run(
    `INSERT OR REPLACE INTO knowledge_proposals
       (repo_id, id, path, state, entry_id, slug, base_version, base_hash, proposed_by,
        proposed_at, decided_by, decided_at, decided_version, title, kind, area, context,
        subject, status, body, problem, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
    ],
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
  body: string;
  problem: string | null;
}

/** The repository's entries as indexed, by slug. Unknown frontmatter keys are in the files only. */
export function listEntries(store: KnowledgeStore, repoId: number): KnowledgeEntry[] {
  return store.db
    .query<EntryRow, [number]>(
      `SELECT id, slug, title, kind, area, context, subject, status, author, version, created,
              updated, supersedes, body, problem
         FROM knowledge_entries WHERE repo_id = ? ORDER BY slug`,
    )
    .all(repoId)
    .map((row) => ({ ...row, extra: [] }));
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
              status, body, problem
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
      extra: [],
      problem: row.problem,
    }));
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
export function taxonomyOrNull(store: KnowledgeStore, repo: Repo): Taxonomy | null {
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
 */
function listFolder(repo: Repo, folder: string): { names: string[]; over: number } {
  let all: string[];
  try {
    all = readdirSync(join(repo.path, ...folder.split("/")));
  } catch {
    return { names: [], over: 0 };
  }
  const visible = all
    .filter((name) => !name.startsWith("."))
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return {
    names: visible.slice(0, FOLDER_CAP).filter((name) => name.endsWith(".md")),
    over: Math.max(0, visible.length - FOLDER_CAP),
  };
}

/**
 * A listed file's bytes, or why it was not read. A link, a folder or anything else that
 * is not a regular file is never opened: it is listed with its problem.
 */
function readListed(path: string): { bytes: Uint8Array } | { problem: string } | null {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    return null;
  }
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
 * its problem. It touches neither git nor the database, so `doctor` reads the same way.
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

/**
 * Replaces the repository's rows with what its files hold, in one transaction. A file git
 * lists as changed is a draft with a problem until a person adopts it.
 */
export function rebuildRepo(store: KnowledgeStore, repo: Repo): RebuildResult {
  requireSchema(store);
  // Taken before the files are read: a file added while they are read then shows as a
  // fingerprint the index does not hold, and the next refresh reads the repository again.
  const head = headOf(repo.path);
  const fingerprint = fingerprintOf(repo.path);
  const changed = changedPaths(store, repo);
  const files = readRepoFiles(store, repo);
  const { overCap } = files;
  const entries = files.entries.map((file) =>
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
  );
  const proposals = files.proposals.map((file) =>
    changed?.has(file.path)
      ? {
          ...file,
          proposal: { ...file.proposal, problem: also(file.proposal.problem, CHANGED_OUTSIDE) },
        }
      : file,
  );

  store.renew?.();
  withWrite(store.db, () => {
    store.db.run("DELETE FROM knowledge_entries WHERE repo_id = ?", [repo.id]);
    store.db.run("DELETE FROM knowledge_proposals WHERE repo_id = ?", [repo.id]);
    for (const { entry, path, hash } of entries) upsertEntry(store, repo.id, entry, path, hash);
    for (const { proposal, path, hash } of proposals) {
      upsertProposal(store, repo.id, proposal, path, hash);
    }
    recordRepo(store, repo.id, head, fingerprint, overCap, changed !== null);
  });
  return {
    entries: entries.length,
    proposals: proposals.length,
    open: proposals.filter(({ path }) => path.startsWith(`${OPEN_DIR}/`)).length,
    problems:
      entries.filter(({ entry }) => entry.problem !== null).length +
      proposals.filter(({ proposal }) => proposal.problem !== null).length,
    overCap,
    dirtyChecked: changed !== null,
  };
}

/**
 * Rebuilds every repository under the data directory (or every one of a scope), and
 * forgets the rows of repositories whose folder is gone. A project folder is mapped to its
 * project through its manifest; a folder no project claims is reported and indexes nothing.
 */
export function rebuildAll(
  store: KnowledgeStore,
  scope?: ScopeRef["scope"],
): ReturnType<typeof listRepos> & {
  results: Map<string, RebuildResult>;
  /** The repositories the store refused, each with why: the others are rebuilt all the same. */
  refused: Map<string, string>;
} {
  requireSchema(store);
  const listed = listRepos(store);
  const repos = listed.repos.filter((repo) => scope === undefined || repo.ref.scope === scope);
  const results = new Map<string, RebuildResult>();
  const refused = new Map<string, string>();
  for (const found of repos) {
    try {
      const repo = openRepo(store, found.ref);
      if (repo === null) continue;
      results.set(
        repo.relative,
        withRepoLeases(store, [repo.relative], () => rebuildRepo(store, repo)),
      );
    } catch (error) {
      if (!(error instanceof KnowledgeError && error.code === "invalid")) throw error;
      refused.set(found.relative, error.message);
    }
  }
  const rows = store.db
    .query<{ id: number; scope: string; path: string }, []>(
      "SELECT id, scope, path FROM knowledge_repos",
    )
    .all();
  for (const row of rows) {
    if (scope !== undefined && row.scope !== scope) continue;
    if (isDirectory(repoPath(store.dataDir, row.path))) continue;
    // The folder is gone.
    withWrite(store.db, () => {
      store.db.run("DELETE FROM knowledge_entries WHERE repo_id = ?", [row.id]);
      store.db.run("DELETE FROM knowledge_proposals WHERE repo_id = ?", [row.id]);
      store.db.run("DELETE FROM knowledge_repos WHERE id = ?", [row.id]);
    });
  }
  return { ...listed, repos, results, refused };
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
