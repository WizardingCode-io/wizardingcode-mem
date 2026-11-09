// The index of the knowledge store: rows in the engine's database, rebuilt from the files.
// The files in the repositories are the truth; nothing here is the only copy of anything.
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { withWrite } from "../../store/db.ts";
import { parseEntry, parseProposal, UUID } from "./entry.ts";
import { KnowledgeError } from "./errors.ts";
import {
  DECIDED_DIR,
  ENTRIES_DIR,
  fingerprintOf,
  headOf,
  OPEN_DIR,
  readRegularFile,
  taxonomyFor,
} from "./repo.ts";
import type { KnowledgeEntry, KnowledgeProposal, KnowledgeStore, Repo, Taxonomy } from "./types.ts";

/** The SHA-256 of a file's bytes as read, first 16 hex. */
export function fileHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** A file with no usable id is indexed under its name, so it is listed and never lost. */
const rowId = (id: string, name: string) =>
  UUID.test(id) || id.startsWith("dup:") ? id : `file:${name}`;

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

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

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
      rowId(proposal.id, fileName(path)),
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

/** What the index was built from: `ensureFresh` compares these with the repository. */
export function recordRepo(
  store: KnowledgeStore,
  repoId: number,
  head: string | null,
  fingerprint: string,
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

/** Records the repository as it is now, keeping what the last rebuild found about its folders. */
export function recordRepoNow(store: KnowledgeStore, repo: Repo): void {
  const row = store.db
    .query<{ over_cap: number; dirty_checked: number }, [number]>(
      "SELECT over_cap, dirty_checked FROM knowledge_repos WHERE id = ?",
    )
    .get(repo.id);
  recordRepo(
    store,
    repo.id,
    headOf(repo.path),
    fingerprintOf(repo.path),
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

/** The `.md` names of a folder, in order. */
function markdownNames(repo: Repo, folder: string): string[] {
  try {
    return readdirSync(join(repo.path, ...folder.split("/")))
      .filter((name) => !name.startsWith(".") && name.endsWith(".md"))
      .sort();
  } catch {
    return [];
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

/** Replaces the repository's rows with what its files hold, in one transaction. */
export function rebuildRepo(store: KnowledgeStore, repo: Repo): RebuildResult {
  const taxonomy = taxonomyOrNull(store, repo);
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

  const entries: { entry: KnowledgeEntry; path: string; hash: string }[] = [];
  for (const name of markdownNames(repo, ENTRIES_DIR)) {
    const bytes = readRegularFile(join(repo.path, ENTRIES_DIR, name));
    if (bytes === null) continue;
    const slug = name.slice(0, -".md".length);
    entries.push({
      entry: parseEntry(decode(bytes), slug, taxonomy),
      path: `${ENTRIES_DIR}/${name}`,
      hash: fileHash(bytes),
    });
  }
  const proposals: { proposal: KnowledgeProposal; path: string; hash: string }[] = [];
  for (const folder of [OPEN_DIR, DECIDED_DIR]) {
    for (const name of markdownNames(repo, folder)) {
      const bytes = readRegularFile(join(repo.path, ...folder.split("/"), name));
      if (bytes === null) continue;
      proposals.push({
        proposal: parseProposal(decode(bytes), name, taxonomy),
        path: `${folder}/${name}`,
        hash: fileHash(bytes),
      });
    }
  }

  store.renew?.();
  withWrite(store.db, () => {
    store.db.run("DELETE FROM knowledge_entries WHERE repo_id = ?", [repo.id]);
    store.db.run("DELETE FROM knowledge_proposals WHERE repo_id = ?", [repo.id]);
    for (const { entry, path, hash } of entries) upsertEntry(store, repo.id, entry, path, hash);
    for (const { proposal, path, hash } of proposals) {
      upsertProposal(store, repo.id, proposal, path, hash);
    }
    recordRepo(store, repo.id, headOf(repo.path), fingerprintOf(repo.path), 0, true);
  });
  return {
    entries: entries.length,
    proposals: proposals.length,
    open: proposals.filter(({ path }) => path.startsWith(`${OPEN_DIR}/`)).length,
    problems:
      entries.filter(({ entry }) => entry.problem !== null).length +
      proposals.filter(({ proposal }) => proposal.problem !== null).length,
    overCap: 0,
    dirtyChecked: true,
  };
}

/** Rebuilds the repository's rows when its HEAD or its fingerprint is not what was indexed. */
export function ensureFresh(store: KnowledgeStore, repo: Repo): void {
  const row = store.db
    .query<{ head: string | null; fingerprint: string | null }, [number]>(
      "SELECT head, fingerprint FROM knowledge_repos WHERE id = ?",
    )
    .get(repo.id);
  if (row?.head === headOf(repo.path) && row.fingerprint === fingerprintOf(repo.path)) return;
  rebuildRepo(store, repo);
}
