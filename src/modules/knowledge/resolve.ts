// Which folder is which repository. The workspace and the shared repositories have fixed
// folders. A project's repository is found by its manifest, not by its folder name: a
// project that gains a remote, or whose index rows were lost, still finds the same folder.
import { mkdirSync, readdirSync } from "node:fs";
import { withWrite } from "../../store/db.ts";
import { nowIso } from "./entry.ts";
import { KnowledgeError } from "./errors.ts";
import {
  existsOnDisk,
  isDirectory,
  knowledgeRoot,
  projectFolderName,
  readManifest,
  refuseForeign,
  refuseLinkedRoots,
  repoFolder,
  repoPath,
  writeManifest,
} from "./repo.ts";
import { requireSchema } from "./schema.ts";
import type { KnowledgeStore, Manifest, Repo, ScopeRef, Writer } from "./types.ts";

const PROJECTS = "knowledge/projects";

/** Only these aliases tie a manifest to a project: a folder path can be reused by another repository. */
const strong = (alias: string) => alias.startsWith("remote:") || alias.startsWith("gitdir:");
const aliasRank = (alias: string) =>
  alias.startsWith("remote:")
    ? 0
    : alias.startsWith("gitdir:")
      ? 1
      : alias.startsWith("path:")
        ? 2
        : 3;

interface RepoRow {
  id: number;
  scope: string;
  project_id: number;
  path: string;
}

function rowFor(store: KnowledgeStore, ref: ScopeRef): RepoRow | null {
  return store.db
    .query<RepoRow, [string, number]>(
      "SELECT id, scope, project_id, path FROM knowledge_repos WHERE scope = ? AND project_id = ?",
    )
    .get(ref.scope, ref.scope === "project" ? ref.projectId : 0);
}

function rowAt(store: KnowledgeStore, relative: string): RepoRow | null {
  return store.db
    .query<RepoRow, [string]>(
      "SELECT id, scope, project_id, path FROM knowledge_repos WHERE path = ?",
    )
    .get(relative);
}

/** The `knowledge_repos` row of a repository at a folder, written when missing or moved. */
function saveRow(store: KnowledgeStore, ref: ScopeRef, relative: string): number {
  const existing = rowFor(store, ref);
  if (existing !== null && existing.path === relative) return existing.id;
  return withWrite(store.db, () => {
    const projectId = ref.scope === "project" ? ref.projectId : 0;
    const current = rowFor(store, ref);
    if (current !== null) {
      if (current.path === relative) return current.id;
      // The repository is in another folder now: what was indexed describes the old one.
      store.db.run("DELETE FROM knowledge_entries WHERE repo_id = ?", [current.id]);
      store.db.run("DELETE FROM knowledge_proposals WHERE repo_id = ?", [current.id]);
      store.db.run(
        "UPDATE knowledge_repos SET path = ?, head = NULL, fingerprint = NULL, indexed_at = 0 WHERE id = ?",
        [relative, current.id],
      );
      return current.id;
    }
    return store.db
      .query<{ id: number }, [string, number, string]>(
        "INSERT INTO knowledge_repos (scope, project_id, path, indexed_at) VALUES (?, ?, ?, 0) RETURNING id",
      )
      .get(ref.scope, projectId, relative)?.id as number;
  });
}

/** A project's aliases, the strongest first; null when there is no such project. */
function projectAliases(
  store: KnowledgeStore,
  projectId: number,
): { key: string; aliases: string[] } | null {
  const project = store.db
    .query<{ key: string }, [number]>("SELECT key FROM projects WHERE id = ?")
    .get(projectId);
  if (project === null) return null;
  const aliases = store.db
    .query<{ alias: string }, [number]>("SELECT alias FROM project_aliases WHERE project_id = ?")
    .all(projectId)
    .map((row) => row.alias)
    .sort((a, b) => aliasRank(a) - aliasRank(b) || a.localeCompare(b));
  return { key: project.key, aliases };
}

interface ProjectFolder {
  relative: string;
  manifest: Manifest | null;
}

/** Every folder under `knowledge/projects/`, in name order, with its manifest when it has one. */
function projectFolders(store: KnowledgeStore): ProjectFolder[] {
  let names: string[];
  try {
    names = readdirSync(repoPath(store.dataDir, PROJECTS)).sort();
  } catch {
    return [];
  }
  return names
    .filter(
      (name) =>
        !name.startsWith(".") && isDirectory(repoPath(store.dataDir, `${PROJECTS}/${name}`)),
    )
    .map((name) => {
      const relative = `${PROJECTS}/${name}`;
      return { relative, manifest: readManifest(repoPath(store.dataDir, relative)) };
    });
}

interface Match {
  /** The folder the project takes; null when no manifest names it. */
  taken: string | null;
  /** Other manifests that name the project too. */
  others: string[];
  /** Manifests that name the project and already belong to another one. */
  claimed: { path: string; byProjectId: number }[];
}

/**
 * The folder of a project among the manifests. The folder its row names wins while it
 * still holds a manifest; else the manifest matched by a remote, else the newest. A
 * manifest mapped to another project is never taken by a second one.
 */
function matchProject(
  store: KnowledgeStore,
  projectId: number,
  aliases: string[],
  folders: ProjectFolder[],
): Match {
  const mine = new Set(aliases.filter(strong));
  const candidates: { relative: string; byRemote: boolean; createdAt: string }[] = [];
  const claimed: Match["claimed"] = [];
  const row = rowFor(store, { scope: "project", projectId });
  let rowFolder: string | null = null;
  for (const folder of folders) {
    if (folder.manifest === null || folder.manifest.scope !== "project") continue;
    if (row !== null && row.path === folder.relative) {
      rowFolder = folder.relative;
      continue;
    }
    const shared = (folder.manifest.project?.aliases ?? []).filter((alias) => mine.has(alias));
    if (shared.length === 0) continue;
    const owner = rowAt(store, folder.relative);
    if (owner !== null && owner.project_id !== projectId) {
      claimed.push({ path: folder.relative, byProjectId: owner.project_id });
      continue;
    }
    candidates.push({
      relative: folder.relative,
      byRemote: shared.some((alias) => alias.startsWith("remote:")),
      createdAt: folder.manifest.createdAt,
    });
  }
  if (rowFolder !== null) {
    return { taken: rowFolder, others: candidates.map((c) => c.relative), claimed };
  }
  const byRemote = candidates.filter((candidate) => candidate.byRemote);
  const pool = byRemote.length > 0 ? byRemote : candidates;
  // The newest; two created at the same instant fall back to the folder name, so two scans agree.
  const taken = [...pool].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.relative.localeCompare(b.relative),
  )[0];
  return {
    taken: taken?.relative ?? null,
    others: candidates.filter((c) => c !== taken).map((c) => c.relative),
    claimed,
  };
}

function ensureParents(store: KnowledgeStore, path: string): void {
  mkdirSync(knowledgeRoot(store.dataDir), { recursive: true, mode: 0o700 });
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

/**
 * The repository of a scope: its folder and its index row. Null when there is none and
 * `create` was not given. With `create`, the folder and its manifest are written when
 * missing; the repository itself is initialised by `openRepo`, which also teaches a
 * project's manifest the aliases the project has gained, in a commit. Refused on tables a
 * newer version wrote: resolving writes the repository's row.
 */
export function resolveRepo(
  store: KnowledgeStore,
  ref: ScopeRef,
  options: { create?: Writer; folderName?: (aliasOrKey: string) => string },
): Repo | null {
  requireSchema(store);
  refuseLinkedRoots(store.dataDir);
  const create = options.create !== undefined;
  if (ref.scope !== "project") {
    const relative = repoFolder(ref);
    const path = repoPath(store.dataDir, relative);
    if (!isDirectory(path)) {
      // A link or a file where the folder goes is refused, never created through.
      refuseForeign(path);
      if (!create) return null;
      ensureParents(store, path);
    }
    if (create && readManifest(path) === null) {
      writeManifest(path, { format: 1, scope: ref.scope, createdAt: nowIso(store.now()) });
    }
    return { ref, path, relative, id: saveRow(store, ref, relative) };
  }

  const project = projectAliases(store, ref.projectId);
  if (project === null) throw new KnowledgeError("missing", `there is no project ${ref.projectId}`);
  const match = matchProject(store, ref.projectId, project.aliases, projectFolders(store));
  let relative = match.taken;
  if (relative === null) {
    if (!create) return null;
    const remote = project.aliases.find((alias) => alias.startsWith("remote:"));
    const name = (options.folderName ?? projectFolderName)(remote ?? project.key);
    // Anything already at the name, a link included, makes it taken: a new folder is new.
    const taken = (candidate: string) =>
      existsOnDisk(repoPath(store.dataDir, candidate)) || rowAt(store, candidate) !== null;
    relative = repoFolder(ref, name);
    for (let n = 2; taken(relative); n++) relative = repoFolder(ref, `${name}-${n}`);
    ensureParents(store, repoPath(store.dataDir, relative));
    writeManifest(repoPath(store.dataDir, relative), {
      format: 1,
      scope: "project",
      project: { aliases: project.aliases },
      createdAt: nowIso(store.now()),
    });
  }
  const path = repoPath(store.dataDir, relative);
  return { ref, path, relative, id: saveRow(store, ref, relative) };
}

/** A project's aliases, the strongest first; null when there is no such project. */
export function projectAliasesOf(store: KnowledgeStore, projectId: number): string[] | null {
  return projectAliases(store, projectId)?.aliases ?? null;
}

/**
 * Every repository under the data directory, mapped to its scope. A project folder no
 * project claims is an orphan and gets no row; a manifest a project matched but did not
 * take is ambiguous; a manifest wanted by a second project is claimed.
 */
export function listRepos(store: KnowledgeStore): {
  repos: Repo[];
  orphans: string[];
  ambiguous: { projectId: number; taken: string; others: string[] }[];
  claimed: { path: string; byProjectId: number; wantedBy: number }[];
} {
  requireSchema(store);
  const { found, ...rest } = scanRepos(store);
  return {
    ...rest,
    repos: found.map((repo) => ({ ...repo, id: saveRow(store, repo.ref, repo.relative) })),
  };
}

/** A repository folder and the scope it belongs to, before it has an index row. */
export interface FoundRepo {
  ref: ScopeRef;
  path: string;
  relative: string;
}

/**
 * What `listRepos` finds, without writing anything: for a caller that holds the database
 * read-only, such as `doctor`.
 */
export function scanRepos(store: KnowledgeStore): {
  found: FoundRepo[];
  orphans: string[];
  ambiguous: { projectId: number; taken: string; others: string[] }[];
  claimed: { path: string; byProjectId: number; wantedBy: number }[];
} {
  refuseLinkedRoots(store.dataDir);
  const found: FoundRepo[] = [];
  for (const scope of ["workspace", "shared"] as const) {
    const relative = repoFolder({ scope });
    const path = repoPath(store.dataDir, relative);
    if (isDirectory(path)) found.push({ ref: { scope }, path, relative });
  }

  const folders = projectFolders(store);
  // The projects worth asking: the ones a row or a manifest's alias points at.
  const projectIds = new Set<number>();
  for (const folder of folders) {
    const row = rowAt(store, folder.relative);
    if (row !== null && row.scope === "project") projectIds.add(row.project_id);
    for (const alias of (folder.manifest?.project?.aliases ?? []).filter(strong)) {
      const owner = store.db
        .query<{ project_id: number }, [string]>(
          "SELECT project_id FROM project_aliases WHERE alias = ?",
        )
        .get(alias);
      if (owner !== null) projectIds.add(owner.project_id);
    }
  }

  const ambiguous: { projectId: number; taken: string; others: string[] }[] = [];
  const claimed: { path: string; byProjectId: number; wantedBy: number }[] = [];
  const accounted = new Set<string>();
  for (const projectId of [...projectIds].sort((a, b) => a - b)) {
    const project = projectAliases(store, projectId);
    if (project === null) continue;
    const match = matchProject(store, projectId, project.aliases, folders);
    if (match.taken === null) continue;
    const relative = match.taken;
    found.push({
      ref: { scope: "project", projectId },
      path: repoPath(store.dataDir, relative),
      relative,
    });
    accounted.add(relative);
    if (match.others.length > 0) {
      ambiguous.push({ projectId, taken: relative, others: match.others });
      for (const other of match.others) accounted.add(other);
    }
    for (const claim of match.claimed) claimed.push({ ...claim, wantedBy: projectId });
  }
  const orphans = folders
    .map((folder) => folder.relative)
    .filter((relative) => !accounted.has(relative));
  return { found, orphans, ambiguous, claimed };
}
