// The areas knowledge is catalogued by. An area has an immutable id and a label a person
// can change: renaming an area touches the taxonomy file and no entry. Each change is a
// person's write, one commit of `taxonomy.md` alone. An agent cannot change the taxonomy.
import { AREA_ID, AREA_MAX, LABEL_MAX, nowIso, renderTaxonomy } from "./entry.ts";
import { KnowledgeError } from "./errors.ts";
import { rebuildRepo } from "./index-store.ts";
import {
  ensureRepo,
  openRepo,
  repoFolder,
  requireGit,
  TAXONOMY_FILE,
  taxonomyFor,
  withRepoLeases,
} from "./repo.ts";
import { listRepos } from "./resolve.ts";
import { requireSchema } from "./schema.ts";
import { commit, requireClean, settle } from "./store.ts";
import type { KnowledgeStore, PersonWriter, Repo, RootRef, Taxonomy } from "./types.ts";

const invalid = (message: string) => new KnowledgeError("invalid", message);

/** The taxonomy of a root repository as its file holds it. */
export function readTaxonomy(store: KnowledgeStore, root: RootRef): Taxonomy {
  requireSchema(store);
  const taxonomy = taxonomyFor(store, root);
  if (taxonomy === null) {
    throw new KnowledgeError("missing", `there is no ${root.scope} knowledge repository yet`);
  }
  return taxonomy;
}

function checkId(id: string): void {
  if (!AREA_ID.test(id) || id.length > AREA_MAX) {
    throw invalid(
      `area id: lower-case letters, digits and hyphens, at most ${AREA_MAX} characters`,
    );
  }
}

function checkLabel(raw: string): string {
  const label = raw.trim();
  if (label === "" || label.length > LABEL_MAX || /[\r\n]/.test(label)) {
    throw invalid(`area label: 1 to ${LABEL_MAX} characters, on one line`);
  }
  return label;
}

function checkPerson(person: PersonWriter): void {
  if (person.kind !== "person")
    throw invalid("the taxonomy is changed by a person, never by an agent");
}

/**
 * Writes the next version of the taxonomy in one commit of `taxonomy.md`. `repos` are the
 * repositories whose leases are held, the root first; `next` is given the current areas
 * and returns the new ones, or refuses.
 */
function change(
  store: KnowledgeStore,
  root: RootRef,
  person: PersonWriter,
  action: string,
  next: (areas: Taxonomy["areas"], repo: Repo) => Taxonomy["areas"],
): Taxonomy {
  const repo = ensureRepo(store, root);
  requireClean(store, repo, TAXONOMY_FILE);
  const current = readTaxonomy(store, root);
  const taxonomy: Taxonomy = {
    version: current.version + 1,
    updated: nowIso(store.now()),
    areas: next(current.areas, repo),
  };
  const committed = commit(store, repo, {
    operation: "taxonomy",
    writer: person,
    write: [{ path: TAXONOMY_FILE, text: renderTaxonomy(taxonomy) }],
    remove: [],
    existed: [TAXONOMY_FILE],
    created: [],
    message: `knowledge: taxonomy ${action}`,
  });
  // No row changes: only the repository's head moved.
  settle(store, repo, committed, () => undefined);
  return taxonomy;
}

export function addArea(
  store: KnowledgeStore,
  root: RootRef,
  id: string,
  label: string,
  person: PersonWriter,
): Taxonomy {
  requireSchema(store);
  requireGit(store);
  checkPerson(person);
  checkId(id);
  const text = checkLabel(label);
  return withRepoLeases(store, [repoFolder(root)], () =>
    change(store, root, person, `add ${id}`, (areas) => {
      if (areas.some((area) => area.id === id)) {
        throw new KnowledgeError("exists", `the area ${id} is already in the taxonomy`);
      }
      return [...areas, { id, label: text }];
    }),
  );
}

/** Changes the label only: the id is what entries carry, so no entry is touched. */
export function renameArea(
  store: KnowledgeStore,
  root: RootRef,
  id: string,
  label: string,
  person: PersonWriter,
): Taxonomy {
  requireSchema(store);
  requireGit(store);
  checkPerson(person);
  checkId(id);
  const text = checkLabel(label);
  return withRepoLeases(store, [repoFolder(root)], () =>
    change(store, root, person, `rename ${id}`, (areas) => {
      if (!areas.some((area) => area.id === id)) {
        throw new KnowledgeError("missing", `there is no area ${id} in the taxonomy`);
      }
      return areas.map((area) => (area.id === id ? { id, label: text } : area));
    }),
  );
}

/** The repositories that read a root's taxonomy: the root, and for the workspace every project's. */
function readers(store: KnowledgeStore, root: RootRef): string[] {
  const rootFolder = repoFolder(root);
  if (root.scope === "shared") return [rootFolder];
  const projects = listRepos(store)
    .repos.filter((repo) => repo.ref.scope === "project")
    .map((repo) => repo.relative)
    .sort();
  return [rootFolder, ...projects];
}

/**
 * Removes an area nothing carries. Every repository that reads the taxonomy is held and
 * read again from its files first, so that no write runs in any of them until the removal
 * is committed and a stale index hides nothing. Refused while an entry or an open proposal
 * carries the area, naming it.
 */
export function removeArea(
  store: KnowledgeStore,
  root: RootRef,
  id: string,
  person: PersonWriter,
): Taxonomy {
  requireSchema(store);
  requireGit(store);
  checkPerson(person);
  checkId(id);
  const folders = readers(store, root);
  return withRepoLeases(store, folders, () =>
    change(store, root, person, `remove ${id}`, (areas, rootRepo) => {
      if (!areas.some((area) => area.id === id)) {
        throw new KnowledgeError("missing", `there is no area ${id} in the taxonomy`);
      }
      const repos = listRepos(store).repos.filter((repo) => folders.includes(repo.relative));
      for (const found of repos) {
        const repo = found.relative === rootRepo.relative ? rootRepo : openRepo(store, found.ref);
        if (repo === null) continue;
        rebuildRepo(store, repo);
        const entry = store.db
          .query<{ slug: string }, [number, string]>(
            "SELECT slug FROM knowledge_entries WHERE repo_id = ? AND area = ? ORDER BY slug LIMIT 1",
          )
          .get(repo.id, id);
        if (entry !== null) {
          throw invalid(
            `the area ${id} is still carried by the entry ${entry.slug} (${repo.relative}); move it to another area first`,
          );
        }
        const proposal = store.db
          .query<{ id: string }, [number, string]>(
            "SELECT id FROM knowledge_proposals WHERE repo_id = ? AND state = 'open' AND area = ? ORDER BY id LIMIT 1",
          )
          .get(repo.id, id);
        if (proposal !== null) {
          throw invalid(
            `the area ${id} is still carried by the open proposal ${proposal.id} (${repo.relative}); a person decides it first`,
          );
        }
      }
      return areas.filter((area) => area.id !== id);
    }),
  );
}
