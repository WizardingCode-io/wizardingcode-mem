// Writing knowledge. Every write is one commit by its author; a write on a stale version
// is refused, never applied over the other; an agent's write is a proposal file until a
// person accepts it. The store cannot tell a person from an agent: the entry point that
// calls it says which, and passes the writer.
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { redact } from "../../core/redact.ts";
import { moduleSchemaState, withWrite } from "../../store/db.ts";
import { authorOf, identityOf } from "./author.ts";
import {
  AREA_ID,
  AREA_MAX,
  checkSlug,
  ENTRY_MAX_BYTES,
  FIELD_MAX,
  KINDS,
  nowIso,
  parseEntry,
  parseFrontmatter,
  parseProposal,
  parseTaxonomy,
  renderEntry,
  renderProposal,
  SLUG,
  STATUSES,
  slugify,
  TITLE_MAX,
  UUID,
} from "./entry.ts";
import { KnowledgeError, ModuleSchemaTooNewError } from "./errors.ts";
import {
  countOpen,
  countOpenAll,
  ensureFresh,
  fileHash,
  rebuildRepo,
  recordRepoNow,
  taxonomyOrNull,
  upsertEntry,
  upsertProposal,
} from "./index-store.ts";
import { KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION } from "./migrations.ts";
import {
  clearIntent,
  commitPaths,
  DECIDED_DIR,
  dropKept,
  ENTRIES_DIR,
  ensureRepo,
  keepBytes,
  MANIFEST_FILE,
  OPEN_DIR,
  openRepo,
  parseManifest,
  pathsAtHead,
  readRegularFile,
  removePaths,
  repoFolder,
  requireGit,
  restoreKept,
  rootOf,
  runGit,
  showAtHead,
  stagePaths,
  statusOf,
  TAXONOMY_FILE,
  taxonomyFor,
  undoStaged,
  unstage,
  withRepoLeases,
  writeFileAtomic,
  writeIntent,
} from "./repo.ts";
import type {
  AgentWriter,
  EntryChange,
  KnowledgeEntry,
  KnowledgeProposal,
  KnowledgeStore,
  PersonWriter,
  Repo,
  ScopeRef,
  Taxonomy,
  Writer,
} from "./types.ts";

/** How many proposals may wait for a person: for one target, and in one repository. */
const OPEN_PER_TARGET = 5;
const OPEN_PER_REPO = 200;

const ADOPT = "wizardingcode-mem knowledge adopt";

const invalid = (message: string) => new KnowledgeError("invalid", message);

/** Refuses to read or write tables a newer wizardingcode-mem wrote. */
export function requireSchema(store: KnowledgeStore): void {
  if (moduleSchemaState(store.db, KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION) === "too-new") {
    throw new ModuleSchemaTooNewError(KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION);
  }
}

// --- The shape of what is written -------------------------------------------------------

interface Fields {
  title: string;
  kind: string;
  area: string;
  context: string;
  subject: string;
  status: string;
}

const oneLine = (text: string) => !/[\r\n]/.test(text);

/** The fields' patterns and lengths; a bad one is refused with the field named. */
function checkFields(fields: Fields): Fields {
  const title = fields.title.trim();
  if (title === "" || title.length > TITLE_MAX || !oneLine(title)) {
    throw invalid(`title: 1 to ${TITLE_MAX} characters, on one line`);
  }
  if (!KINDS.test(fields.kind)) {
    throw invalid("kind: one of knowledge, strategy, persona, pattern");
  }
  if (!AREA_ID.test(fields.area) || fields.area.length > AREA_MAX) {
    throw invalid("area: the id of an area of the taxonomy");
  }
  for (const key of ["context", "subject"] as const) {
    if (fields[key].length > FIELD_MAX || !oneLine(fields[key])) {
      throw invalid(`${key}: at most ${FIELD_MAX} characters, on one line`);
    }
  }
  if (!STATUSES.test(fields.status)) throw invalid("status: one of active, draft, archived");
  // Named one by one: a caller's object may carry more than these six.
  return {
    title,
    kind: fields.kind,
    area: fields.area,
    context: fields.context,
    subject: fields.subject,
    status: fields.status,
  };
}

function checkArea(area: string, taxonomy: Taxonomy): void {
  if (taxonomy.areas.some((known) => known.id === area)) return;
  throw invalid(
    `area: ${area} is not in the taxonomy (${taxonomy.areas.map((known) => known.id).join(", ")})`,
  );
}

function checkBase(base: number | undefined): number {
  if (base === undefined) return 0;
  if (!Number.isSafeInteger(base) || base < 0) throw invalid("base version: a whole number from 0");
  return base;
}

function checkSize(text: string): string {
  if (Buffer.byteLength(text) > ENTRY_MAX_BYTES) {
    throw invalid("the text is over 256 KiB, the cap for one file");
  }
  return text;
}

/** The body as it is stored: LF line endings, whatever the caller's were. */
const bodyOf = (body: string) => body.replaceAll("\r\n", "\n");

const entryPath = (slug: string) => `${ENTRIES_DIR}/${slug}.md`;
const openPath = (id: string) => `${OPEN_DIR}/${id}.md`;
const decidedPath = (id: string) => `${DECIDED_DIR}/${id}.md`;
const absolute = (repo: Repo, path: string) => join(repo.path, ...path.split("/"));

// --- The leases and the repository -----------------------------------------------------

/**
 * Runs `fn` on the repository holding its root's lease and then its own, both refreshed
 * against their files. The area check and the commit happen under the same leases, so a
 * taxonomy change cannot slip between them.
 */
function underLeases<T>(
  store: KnowledgeStore,
  ref: ScopeRef,
  create: boolean,
  fn: (repo: Repo, taxonomy: Taxonomy) => T,
): T {
  const rootRef = rootOf(ref);
  const rootFolder = repoFolder(rootRef);
  return withRepoLeases(store, [rootFolder], () => {
    const repo = create ? ensureRepo(store, ref) : openRepo(store, ref);
    if (repo === null) {
      throw new KnowledgeError("missing", `there is no ${ref.scope} knowledge repository yet`);
    }
    const run = () => {
      if (repo.relative !== rootFolder) {
        const root = openRepo(store, rootRef);
        if (root !== null) ensureFresh(store, root);
      }
      ensureFresh(store, repo);
      const taxonomy = taxonomyFor(store, ref);
      if (taxonomy === null) {
        throw new KnowledgeError("missing", `the ${rootRef.scope} repository has no taxonomy`);
      }
      return fn(repo, taxonomy);
    };
    return repo.relative === rootFolder ? run() : withRepoLeases(store, [repo.relative], run);
  });
}

/**
 * The target of a write must be a regular file or nothing, indexed without a problem that
 * makes it unusable, and as the last commit left it (D-11: a hand edit is never swept
 * into another author's commit).
 */
function checkTarget(store: KnowledgeStore, repo: Repo, slug: string): void {
  const path = entryPath(slug);
  let stat: ReturnType<typeof lstatSync> | null = null;
  try {
    stat = lstatSync(absolute(repo, path));
  } catch {
    // Nothing there: a new entry.
  }
  if (stat !== null && !stat.isFile()) {
    throw invalid(
      stat.isSymbolicLink()
        ? `${path} is a symbolic link; the knowledge store never follows links`
        : `${path} is not a regular file`,
    );
  }
  const indexed = store.db
    .query<{ id: string; problem: string | null }, [number, string]>(
      "SELECT id, problem FROM knowledge_entries WHERE repo_id = ? AND slug = ?",
    )
    .get(repo.id, slug);
  if (indexed?.problem != null && /^(?:file|dup):/.test(indexed.id)) {
    throw invalid(
      `${path} cannot be changed: ${indexed.problem}; fix the file by hand, then run ${ADOPT}`,
    );
  }
  requireClean(store, repo, path);
}

function requireClean(store: KnowledgeStore, repo: Repo, path: string): void {
  if (statusOf(store, repo, [path]).length === 0) return;
  throw new KnowledgeError("dirty", `${path} was changed outside the engine; run ${ADOPT} first`);
}

interface Current {
  entry: KnowledgeEntry;
  hash: string;
}

function readCurrent(repo: Repo, slug: string, taxonomy: Taxonomy | null): Current | null {
  const bytes = readRegularFile(absolute(repo, entryPath(slug)));
  if (bytes === null) return null;
  return {
    entry: parseEntry(new TextDecoder().decode(bytes), slug, taxonomy),
    hash: fileHash(bytes),
  };
}

const stale = (current: number, based: number, what: string) =>
  new KnowledgeError(
    "stale",
    `stale: the entry is at version ${current}, the ${what} was based on version ${based}`,
  );

// --- The commit and the failure rule -----------------------------------------------------

interface Commit {
  operation: string;
  writer: Writer;
  /** Files written and staged. */
  write: { path: string; text: string }[];
  /** Files removed from the repository. */
  remove: string[];
  /** Of all those paths, the ones HEAD holds, and the ones it does not. */
  existed: string[];
  created: string[];
  message: string;
  proposalId?: string;
}

/**
 * Writes, stages and commits only the given paths. The intent record goes first and stays
 * until the caller has indexed the result. When anything fails, every path is put back to
 * what HEAD holds; when even that fails, the record is left for the next open to act on.
 */
function commit(store: KnowledgeStore, repo: Repo, change: Commit): void {
  writeIntent(repo, {
    operation: change.operation,
    writer: change.writer,
    existed: change.existed,
    created: change.created,
    ...(change.proposalId === undefined ? {} : { proposalId: change.proposalId }),
  });
  try {
    for (const file of change.write) {
      const target = absolute(repo, file.path);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileAtomic(target, file.text);
    }
    const written = change.write.map((file) => file.path);
    stagePaths(store, repo, written, change.operation);
    if (change.remove.length > 0) removePaths(store, repo, change.remove, change.operation);
    commitPaths(
      store,
      repo,
      [...written, ...change.remove],
      change.message,
      identityOf(change.writer),
      change.operation,
    );
  } catch (error) {
    try {
      undoStaged(
        store,
        repo,
        { existed: change.existed, created: change.created },
        change.operation,
      );
      clearIntent(repo);
    } catch {
      // The intent record stays: the next `openRepo` puts the tree back.
    }
    throw error;
  }
}

/** Indexes what a commit changed, records the repository's new head, and forgets the intent. */
function settle(store: KnowledgeStore, repo: Repo, index: () => void): void {
  store.renew?.();
  withWrite(store.db, () => {
    index();
    recordRepoNow(store, repo);
  });
  clearIntent(repo);
}

// --- A person's write ------------------------------------------------------------------

/** The text of an entry's next version; refused when the base is not the current version. */
function nextEntry(
  current: Current | null,
  base: number,
  next: {
    slug: string;
    id: string;
    fields: Fields;
    body: string;
    author: string;
    now: string;
    supersedes: string | null;
    what: string;
  },
): KnowledgeEntry {
  if (base > 0) {
    if (current === null) {
      throw new KnowledgeError("missing", `there is no entry ${next.slug} to change`);
    }
    if (current.entry.version !== base) throw stale(current.entry.version, base, next.what);
  }
  return {
    id: current === null ? next.id : current.entry.id,
    slug: next.slug,
    ...next.fields,
    author: next.author,
    version: base + 1,
    created: current?.entry.created ?? next.now,
    updated: next.now,
    supersedes: next.supersedes ?? current?.entry.supersedes ?? null,
    body: next.body,
    // Keys this version does not know are kept as they were written.
    extra: current?.entry.extra ?? [],
    problem: null,
  };
}

/**
 * Writes an entry. A person's write is a commit; an agent's is a proposal. `baseVersion`
 * absent or 0 means a new entry. The id is the store's: a caller never sets one.
 */
export function writeEntry(
  store: KnowledgeStore,
  ref: ScopeRef,
  change: EntryChange,
  writer: Writer,
): { kind: "written"; entry: KnowledgeEntry } | { kind: "proposed"; proposal: KnowledgeProposal } {
  requireSchema(store);
  requireGit(store);
  if (change.supersedes !== undefined && !UUID.test(change.supersedes)) {
    throw invalid("supersedes: the id of the entry this one replaces");
  }
  if (writer.kind === "agent") {
    return { kind: "proposed", proposal: propose(store, ref, change, writer) };
  }

  const status = change.status;
  const fields = checkFields({ ...change, status: status ?? "active" });
  const slug = change.slug === undefined ? slugify(fields.title) : checkSlug(change.slug);
  const base = checkBase(change.baseVersion);
  const body = bodyOf(change.body);
  return underLeases(store, ref, true, (repo, taxonomy) => {
    checkArea(fields.area, taxonomy);
    checkTarget(store, repo, slug);
    const current = readCurrent(repo, slug, taxonomy);
    if (base === 0 && current !== null) {
      throw new KnowledgeError(
        "exists",
        `${entryPath(slug)} exists at version ${current.entry.version}; write with base version ${current.entry.version} to change it`,
      );
    }
    const entry = nextEntry(current, base, {
      slug,
      id: randomUUID(),
      // An unsaid status keeps the entry's own.
      fields: { ...fields, status: status ?? current?.entry.status ?? "active" },
      body,
      author: authorOf(writer),
      now: nowIso(store.now()),
      supersedes: change.supersedes ?? null,
      what: "write",
    });
    const path = entryPath(slug);
    const text = checkSize(renderEntry(entry));
    commit(store, repo, {
      operation: "write",
      writer,
      write: [{ path, text }],
      remove: [],
      existed: current === null ? [] : [path],
      created: current === null ? [path] : [],
      message: `knowledge: ${current === null ? "create" : "update"} ${slug} (v${entry.version})`,
    });
    settle(store, repo, () =>
      upsertEntry(store, repo.id, entry, path, fileHash(Buffer.from(text))),
    );
    return { kind: "written" as const, entry };
  });
}

// --- An agent's write: a proposal ------------------------------------------------------

function propose(
  store: KnowledgeStore,
  ref: ScopeRef,
  change: EntryChange,
  writer: AgentWriter,
): KnowledgeProposal {
  // A proposal enters a history the engine never rewrites, and a session's text may carry
  // a secret. The limits apply to what is stored: the text after redaction.
  const clean = (text: string): string => redact(text, { env: store.env });
  if (change.slug !== undefined) {
    checkSlug(change.slug);
    if (clean(change.slug) !== change.slug) {
      throw invalid("slug: it reads as a secret and would be redacted; choose another");
    }
  }
  const status = change.status;
  const fields = checkFields({
    title: clean(change.title),
    kind: change.kind,
    area: change.area,
    context: clean(change.context),
    subject: clean(change.subject),
    status: status ?? "active",
  });
  const slug = change.slug ?? slugify(fields.title);
  const body = bodyOf(clean(change.body));

  return underLeases(store, ref, true, (repo, taxonomy) => {
    checkArea(fields.area, taxonomy);
    checkTarget(store, repo, slug);
    const current = readCurrent(repo, slug, taxonomy);
    // A caller's slug that names an entry is a change to it; a slug from the title is a new entry.
    const base =
      change.baseVersion === undefined
        ? change.slug !== undefined && current !== null
          ? current.entry.version
          : 0
        : checkBase(change.baseVersion);
    if (base === 0 && current !== null) {
      throw new KnowledgeError(
        "exists",
        `${entryPath(slug)} exists at version ${current.entry.version}; propose a change with its slug and base version ${current.entry.version}`,
      );
    }
    if (base > 0 && current === null) {
      throw new KnowledgeError("missing", `there is no entry ${slug} to change`);
    }
    if (current !== null && current.entry.version !== base) {
      throw stale(current.entry.version, base, "proposal");
    }

    const waiting = countOpen(
      store,
      repo.id,
      current === null ? { slug } : { entryId: current.entry.id },
    );
    if (waiting >= OPEN_PER_TARGET) {
      throw new KnowledgeError(
        "quota",
        `there are already ${OPEN_PER_TARGET} open proposals for ${slug}; a person decides them first`,
      );
    }
    if (countOpenAll(store, repo.id) >= OPEN_PER_REPO) {
      throw new KnowledgeError(
        "quota",
        `the repository has ${OPEN_PER_REPO} open proposals waiting for a person`,
      );
    }

    const proposal: KnowledgeProposal = {
      id: randomUUID(),
      entryId: current?.entry.id ?? randomUUID(),
      slug,
      baseVersion: base,
      baseHash: current?.hash ?? "",
      proposedBy: authorOf(writer),
      proposedAt: nowIso(store.now()),
      ...fields,
      status: status ?? current?.entry.status ?? "active",
      body,
      decision: null,
      decidedBy: null,
      decidedAt: null,
      decidedVersion: null,
      extra: [],
      problem: null,
    };
    const path = openPath(proposal.id);
    const text = checkSize(renderProposal(proposal));
    commit(store, repo, {
      operation: "write",
      writer,
      write: [{ path, text }],
      remove: [],
      existed: [],
      created: [path],
      message: `knowledge: propose ${proposal.id} for ${slug}`,
      proposalId: proposal.id,
    });
    settle(store, repo, () =>
      upsertProposal(store, repo.id, proposal, path, fileHash(Buffer.from(text))),
    );
    return proposal;
  });
}

// --- A person decides a proposal -------------------------------------------------------

function checkDecider(person: PersonWriter, proposalId: string): void {
  if (person.kind !== "person")
    throw invalid("a proposal is decided by a person, never by an agent");
  // Before any path is built: an id is a file name here.
  if (!UUID.test(proposalId)) throw invalid("proposal id: the id of an open proposal");
}

/** The open proposal as its file holds it: open in the index, a regular file, and clean. */
function openProposal(
  store: KnowledgeStore,
  repo: Repo,
  proposalId: string,
  taxonomy: Taxonomy | null,
): KnowledgeProposal {
  const row = store.db
    .query<{ state: string }, [number, string]>(
      "SELECT state FROM knowledge_proposals WHERE repo_id = ? AND id = ?",
    )
    .get(repo.id, proposalId);
  const path = openPath(proposalId);
  const bytes = row?.state === "open" ? readRegularFile(absolute(repo, path)) : null;
  if (bytes === null) {
    throw new KnowledgeError("missing", `there is no open proposal ${proposalId}`);
  }
  requireClean(store, repo, path);
  const proposal = parseProposal(new TextDecoder().decode(bytes), `${proposalId}.md`, taxonomy);
  // A proposal edited by hand can carry any text where an id should be.
  if (!UUID.test(proposal.entryId)) {
    throw invalid(`the proposal's entry id is not an id; fix ${path} by hand, then run ${ADOPT}`);
  }
  const owner = store.db
    .query<{ slug: string }, [number, string, string]>(
      "SELECT slug FROM knowledge_entries WHERE repo_id = ? AND id = ? AND slug <> ?",
    )
    .get(repo.id, proposal.entryId, proposal.slug);
  if (owner !== null) {
    throw invalid(`the proposal's entry id already belongs to the entry ${owner.slug}`);
  }
  return proposal;
}

/**
 * Accepts an agent's proposal: the entry is written with the proposal's content and the
 * proposal moves to `proposals/decided/`, in one commit by the person that names the agent.
 */
export function acceptProposal(
  store: KnowledgeStore,
  ref: ScopeRef,
  proposalId: string,
  person: PersonWriter,
): KnowledgeEntry {
  requireSchema(store);
  requireGit(store);
  checkDecider(person, proposalId);
  return underLeases(store, ref, false, (repo, taxonomy) => {
    const proposal = openProposal(store, repo, proposalId, taxonomy);
    if (proposal.problem !== null) {
      throw invalid(`the proposal cannot be accepted: ${proposal.problem}`);
    }
    const slug = checkSlug(proposal.slug);
    const fields = checkFields(proposal);
    checkArea(fields.area, taxonomy);
    checkTarget(store, repo, slug);
    const current = readCurrent(repo, slug, taxonomy);
    if (proposal.baseVersion === 0 && current !== null) {
      throw new KnowledgeError(
        "exists",
        `a proposal for a new entry ${slug}, but the entry now exists at version ${current.entry.version}; a person decides between them`,
      );
    }
    const now = nowIso(store.now());
    const entry = nextEntry(current, proposal.baseVersion, {
      slug,
      id: proposal.entryId,
      fields,
      body: proposal.body,
      author: authorOf(person),
      now,
      supersedes: null,
      what: "proposal",
    });
    const decided: KnowledgeProposal = {
      ...proposal,
      decision: "accepted",
      decidedBy: authorOf(person),
      decidedAt: now,
      decidedVersion: entry.version,
    };
    const paths = {
      entry: entryPath(slug),
      open: openPath(proposalId),
      decided: decidedPath(proposalId),
    };
    const entryText = checkSize(renderEntry(entry));
    const decidedText = renderProposal(decided);
    commit(store, repo, {
      operation: "accept",
      writer: person,
      write: [
        { path: paths.entry, text: entryText },
        { path: paths.decided, text: decidedText },
      ],
      remove: [paths.open],
      existed: current === null ? [paths.open] : [paths.open, paths.entry],
      created: current === null ? [paths.decided, paths.entry] : [paths.decided],
      message: `knowledge: accept ${proposalId} into ${slug} (v${entry.version})\n\nProposed by ${proposal.proposedBy}.`,
      proposalId,
    });
    settle(store, repo, () => {
      upsertEntry(store, repo.id, entry, paths.entry, fileHash(Buffer.from(entryText)));
      upsertProposal(store, repo.id, decided, paths.decided, fileHash(Buffer.from(decidedText)));
    });
    return entry;
  });
}

/** Rejects a proposal: the file moves to `proposals/decided/` with the decision. Nothing is deleted. */
export function rejectProposal(
  store: KnowledgeStore,
  ref: ScopeRef,
  proposalId: string,
  person: PersonWriter,
): KnowledgeProposal {
  requireSchema(store);
  requireGit(store);
  checkDecider(person, proposalId);
  return underLeases(store, ref, false, (repo) => {
    // No taxonomy: a proposal that names an unknown area can still be rejected.
    const proposal = openProposal(store, repo, proposalId, null);
    if (proposal.id !== proposalId) {
      throw invalid(
        `the proposal's file cannot be read as a proposal; fix ${openPath(proposalId)} by hand, then run ${ADOPT}`,
      );
    }
    const decided: KnowledgeProposal = {
      ...proposal,
      decision: "rejected",
      decidedBy: authorOf(person),
      decidedAt: nowIso(store.now()),
      decidedVersion: null,
      problem: null,
    };
    const paths = { open: openPath(proposalId), decided: decidedPath(proposalId) };
    const text = renderProposal(decided);
    commit(store, repo, {
      operation: "reject",
      writer: person,
      write: [{ path: paths.decided, text }],
      remove: [paths.open],
      existed: [paths.open],
      created: [paths.decided],
      message: `knowledge: reject ${proposalId}`,
      proposalId,
    });
    settle(store, repo, () =>
      upsertProposal(store, repo.id, decided, paths.decided, fileHash(Buffer.from(text))),
    );
    return decided;
  });
}

// --- Reading -----------------------------------------------------------------------------

/** The entry as its file holds it now; null when there is no such entry or no repository. */
export function readEntry(
  store: KnowledgeStore,
  ref: ScopeRef,
  slug: string,
): KnowledgeEntry | null {
  requireSchema(store);
  checkSlug(slug);
  const repo = openRepo(store, ref);
  if (repo === null) return null;
  ensureFresh(store, repo);
  return readCurrent(repo, slug, taxonomyOrNull(store, repo))?.entry ?? null;
}

// --- Hand edits: adopt -------------------------------------------------------------------

const ENTRY_FILE = new RegExp(`^${ENTRIES_DIR}/([^/]+)\\.md$`);

function onDisk(repo: Repo, path: string): boolean {
  try {
    lstatSync(absolute(repo, path));
    return true;
  } catch {
    return false;
  }
}

/**
 * The text an entry file a person wrote by hand is committed as: an id when it has none,
 * the next version, `updated` and the person as author, everything else as they left it.
 * Null when the file is not an entry even so: it is then committed exactly as it is.
 */
function adoptedText(
  text: string,
  slug: string,
  taxonomy: Taxonomy | null,
  headVersion: number | null,
  person: PersonWriter,
  now: string,
): string | null {
  const front = parseFrontmatter(text);
  if ("problem" in front) return null;
  const asWritten = parseEntry(text, slug, null);
  const id = UUID.test(asWritten.id) ? asWritten.id : randomUUID();
  // A file HEAD does not hold starts at 1. One it holds moves forward from the higher of
  // HEAD's version and the number in the file, whatever the person typed there.
  const version = headVersion === null ? 1 : Math.max(headVersion, asWritten.version) + 1;
  const others = front.order
    .filter((key) => key !== "id" && key !== "version")
    .flatMap((key) => front.raw.get(key) ?? []);
  const repaired = parseEntry(
    `---\nid: ${id}\nversion: ${version}\n${others.join("\n")}\n---\n${front.body}\n`,
    slug,
    taxonomy,
  );
  if (repaired.problem !== null) return null;
  return renderEntry({
    ...repaired,
    author: authorOf(person),
    created: repaired.created ?? now,
    updated: now,
  });
}

/**
 * Commits the changes a person made outside the engine, as the person: files edited or
 * added in an editor, files deleted, a taxonomy or a manifest changed by hand. Nothing is
 * skipped or refused, since the person's work must be versioned; a file that is still not
 * a valid entry is committed as it is and returned with its problem. When the commit
 * fails, the person's files are put back byte for byte: their work exists nowhere else.
 */
export function adopt(
  store: KnowledgeStore,
  ref: ScopeRef,
  person: PersonWriter,
): { adopted: number; problems: string[] } {
  requireSchema(store);
  requireGit(store);
  if (person.kind !== "person") throw invalid("changes are adopted by a person, never by an agent");
  const rootFolder = repoFolder(rootOf(ref));
  return withRepoLeases(store, [rootFolder], () => {
    const repo = openRepo(store, ref);
    if (repo === null) {
      throw new KnowledgeError("missing", `there is no ${ref.scope} knowledge repository yet`);
    }
    const run = () => adoptIn(store, repo, person);
    return repo.relative === rootFolder ? run() : withRepoLeases(store, [repo.relative], run);
  });
}

function adoptIn(
  store: KnowledgeStore,
  repo: Repo,
  person: PersonWriter,
): { adopted: number; problems: string[] } {
  // Nothing else counts: the `.gitignore` covers what editors and Finder leave behind.
  const changed = statusOf(store, repo, [
    ENTRIES_DIR,
    "proposals",
    TAXONOMY_FILE,
    MANIFEST_FILE,
  ]).map((line) => line.slice(3));
  if (changed.length === 0) return { adopted: 0, problems: [] };

  const atHead = pathsAtHead(store, repo, changed, "adopt");
  const present = changed.filter((path) => onDisk(repo, path));
  const deleted = changed.filter((path) => !present.includes(path) && atHead.has(path));
  // A file added to the index by hand and then deleted: there is nothing left to commit.
  const vanished = changed.filter((path) => !present.includes(path) && !atHead.has(path));
  const paths = [...present, ...deleted];

  const taxonomy = taxonomyOrNull(store, repo);
  const now = nowIso(store.now());
  const kept = new Map<string, Uint8Array>();
  const rewrites: { path: string; text: string }[] = [];
  for (const path of present) {
    const slug = ENTRY_FILE.exec(path)?.[1];
    if (slug === undefined || !SLUG.test(slug)) continue;
    let bytes: Uint8Array | null;
    try {
      bytes = readRegularFile(absolute(repo, path));
    } catch {
      // A link or a file over the cap is committed as it is and listed with its problem.
      continue;
    }
    if (bytes === null) continue;
    kept.set(path, bytes);
    const head = atHead.has(path) ? showAtHead(store, repo, path) : null;
    const headVersion = head === null ? null : parseEntry(head, slug, null).version;
    const text = adoptedText(
      new TextDecoder().decode(bytes),
      slug,
      taxonomy,
      headVersion,
      person,
      now,
    );
    if (text !== null) rewrites.push({ path, text });
  }

  const keptName = keepBytes(repo, kept);
  writeIntent(repo, {
    operation: "adopt",
    writer: person,
    existed: changed.filter((path) => atHead.has(path)),
    created: changed.filter((path) => !atHead.has(path)),
    keptBytesFile: keptName,
  });
  const count = paths.length;
  try {
    for (const { path, text } of rewrites) writeFileAtomic(absolute(repo, path), text);
    if (present.length > 0) stagePaths(store, repo, present, "adopt");
    if (deleted.length > 0) removePaths(store, repo, deleted, "adopt");
    if (vanished.length > 0) {
      runGit(store, repo.path, ["rm", "--cached", "-q", "--ignore-unmatch", "--", ...vanished], {
        operation: "adopt",
      });
    }
    if (count > 0) {
      commitPaths(
        store,
        repo,
        paths,
        `knowledge: adopt ${count} ${count === 1 ? "change" : "changes"} made outside the engine\n\n${paths.join("\n")}`,
        identityOf(person),
        "adopt",
      );
    }
  } catch (error) {
    try {
      // The person's own work: only unstaged, and their bytes written back as they were.
      unstage(store, repo, changed, "adopt");
      restoreKept(repo, keptName);
      clearIntent(repo);
    } catch {
      // The intent record stays: the next `openRepo` puts the person's bytes back.
    }
    throw error;
  }
  rebuildRepo(store, repo);
  dropKept(repo, keptName);
  clearIntent(repo);
  return { adopted: count, problems: problemsOf(store, repo) };
}

/** Every problem the repository's files still carry, each with its path. */
function problemsOf(store: KnowledgeStore, repo: Repo): string[] {
  const rows = store.db
    .query<{ path: string; problem: string }, [number, number]>(
      `SELECT path, problem FROM knowledge_entries WHERE repo_id = ? AND problem IS NOT NULL
       UNION ALL
       SELECT path, problem FROM knowledge_proposals WHERE repo_id = ? AND problem IS NOT NULL
       ORDER BY path`,
    )
    .all(repo.id, repo.id);
  const problems = rows.map((row) => `${row.path}: ${row.problem}`);
  const decode = (path: string) => {
    try {
      const bytes = readRegularFile(absolute(repo, path));
      return bytes === null ? null : new TextDecoder().decode(bytes);
    } catch (error) {
      return error instanceof KnowledgeError ? "" : null;
    }
  };
  const taxonomy = decode(TAXONOMY_FILE);
  if (taxonomy !== null) {
    const parsed = parseTaxonomy(taxonomy);
    if ("problem" in parsed) problems.push(`${TAXONOMY_FILE}: ${parsed.problem}`);
  }
  const manifest = decode(MANIFEST_FILE);
  if (manifest !== null) {
    const parsed = parseManifest(manifest);
    if ("problem" in parsed) problems.push(`${MANIFEST_FILE}: ${parsed.problem}`);
  }
  return problems;
}
