// Writing knowledge. Every write is one commit by its author; a write on a stale version
// is refused, never applied over the other; an agent's write is a proposal file until a
// person accepts it. The store cannot tell a person from an agent: the entry point that
// calls it says which, and passes the writer.
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { CONTROL } from "../../core/agent-name.ts";
import { redact } from "../../core/redact.ts";
import { withWrite } from "../../store/db.ts";
import { authorOf, identityOf, personAuthor, syncCommitter } from "./author.ts";
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
  splitFrontmatterLines,
  TITLE_MAX,
  UUID,
} from "./entry.ts";
import { KnowledgeError } from "./errors.ts";
import {
  countOpen,
  countOpenAll,
  ensureFresh,
  entrySlugById,
  rebuildRepo,
  recordedFingerprint,
  recordRepoAfter,
  taxonomyOrNull,
  upsertEntry,
  upsertProposal,
} from "./index-store.ts";
import {
  type Change,
  clearIntent,
  commitChange,
  commitPaths,
  DECIDED_DIR,
  dropKept,
  ENTRIES_DIR,
  ensureRepo,
  existsOnDisk,
  fingerprintOf,
  hashOf,
  headOf,
  keepBytes,
  keptFileName,
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
  unstage,
  withRepoLeases,
  writeFileAtomic,
  writeIntent,
} from "./repo.ts";
import { requireSchema } from "./schema.ts";
import type {
  AgentWriter,
  EntryChange,
  Identity,
  KnowledgeEntry,
  KnowledgeProposal,
  KnowledgeStore,
  PersonWriter,
  Repo,
  ScopeRef,
  SyncWriter,
  Taxonomy,
  Writer,
} from "./types.ts";

/** How many proposals may wait for a person: for one target, and in one repository. */
const OPEN_PER_TARGET = 5;
const OPEN_PER_REPO = 200;

const ADOPT = "wizardingcode-mem knowledge adopt";

const invalid = (message: string) => new KnowledgeError("invalid", message);

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

export function checkArea(area: string, taxonomy: Taxonomy): void {
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

/** Refuses a path that is not as the last commit left it: a hand edit is adopted first. */
export function requireClean(store: KnowledgeStore, repo: Repo, path: string): void {
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
    hash: hashOf(bytes),
  };
}

const stale = (current: number, based: number, what: string) =>
  new KnowledgeError(
    "stale",
    `stale: the entry is at version ${current}, the ${what} was based on version ${based}`,
  );

// --- The commit and the failure rule -----------------------------------------------------

/** What `commit` hands to `settle`: whether the index can trust the folders it finds after. */
export interface Committed {
  /**
   * The folders were as the index knew them when the operation began to write. When they
   * were not, a file was added or removed by hand since the last refresh: the index is
   * then told to read the repository again, instead of recording folders it has not read.
   */
  undisturbed: boolean;
}

/**
 * Commits a change (`commitChange`), and says whether the folders were as the index knew
 * them when it began. The intent record stays until the caller has indexed the result.
 */
export function commit(store: KnowledgeStore, repo: Repo, change: Change): Committed {
  const recorded = recordedFingerprint(store, repo);
  const undisturbed = recorded !== null && recorded === fingerprintOf(repo.path);
  commitChange(store, repo, change);
  return { undisturbed };
}

/**
 * Indexes what a commit changed, records the repository's new head, and forgets the
 * intent. The head and the fingerprint are taken before the transaction, and the
 * fingerprint is recorded only when nothing but this operation changed the folders.
 */
export function settle(
  store: KnowledgeStore,
  repo: Repo,
  committed: Committed,
  index: () => void,
): void {
  const head = headOf(repo.path);
  const fingerprint = committed.undisturbed ? fingerprintOf(repo.path) : null;
  store.renew?.();
  withWrite(store.db, () => {
    index();
    recordRepoAfter(store, repo, head, fingerprint);
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
    /** Undefined keeps the current entry's value; a new entry is not pinned. */
    pinned: boolean | undefined;
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
    pinned: next.pinned ?? current?.entry.pinned ?? false,
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
  if (writer.kind === "sync") {
    throw invalid(
      "the sync never writes an entry through writeEntry; a teammate's revision is applied by applyRevision",
    );
  }
  if (writer.kind === "agent") {
    return { kind: "proposed", proposal: propose(store, ref, change, writer, { quota: true }) };
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
      pinned: change.pinned,
      what: "write",
    });
    const path = entryPath(slug);
    const text = checkSize(renderEntry(entry));
    const committed = commit(store, repo, {
      operation: "write",
      writer,
      write: [{ path, text }],
      remove: [],
      existed: current === null ? [] : [path],
      created: current === null ? [path] : [],
      message: `knowledge: ${current === null ? "create" : "update"} ${slug} (v${entry.version})`,
    });
    settle(store, repo, committed, () =>
      upsertEntry(store, repo.id, entry, path, hashOf(Buffer.from(text))),
    );
    return { kind: "written" as const, entry };
  });
}

/**
 * `knowledge take` (ADR 0027): a received entry copied into the matching own repository as
 * the person's write, under the given uuid, so the own entry is what the results show for it
 * from then on. A new entry at version 1; refused when an entry with the uuid or the slug is
 * already here. Never `adopt`, which keeps its one meaning.
 */
export function writeTaken(
  store: KnowledgeStore,
  ref: ScopeRef,
  change: EntryChange,
  uuid: string,
  person: PersonWriter,
): KnowledgeEntry {
  requireSchema(store);
  requireGit(store);
  if (person.kind !== "person") throw invalid("an entry is taken by a person, never by an agent");
  if (!UUID.test(uuid)) throw invalid("the id of the received entry is not a uuid");
  const fields = checkFields({ ...change, status: change.status ?? "active" });
  const slug = change.slug === undefined ? slugify(fields.title) : checkSlug(change.slug);
  const body = bodyOf(change.body);
  return underLeases(store, ref, true, (repo, taxonomy) => {
    checkArea(fields.area, taxonomy);
    checkTarget(store, repo, slug);
    if (entrySlugById(store, repo.id, uuid) !== null) {
      throw new KnowledgeError("exists", `${uuid} is already an entry of this repository`);
    }
    const current = readCurrent(repo, slug, taxonomy);
    if (current !== null) {
      throw new KnowledgeError(
        "exists",
        `${entryPath(slug)} exists at version ${current.entry.version}; take it under another slug`,
      );
    }
    const entry = nextEntry(null, 0, {
      slug,
      id: uuid,
      fields,
      body,
      author: authorOf(person),
      now: nowIso(store.now()),
      supersedes: null,
      pinned: change.pinned,
      what: "take",
    });
    const path = entryPath(slug);
    const text = checkSize(renderEntry(entry));
    const committed = commit(store, repo, {
      operation: "write",
      writer: person,
      write: [{ path, text }],
      remove: [],
      existed: [],
      created: [path],
      message: `knowledge: take ${slug} (v1)`,
    });
    settle(store, repo, committed, () =>
      upsertEntry(store, repo.id, entry, path, hashOf(Buffer.from(text))),
    );
    return entry;
  });
}

// --- An agent's write: a proposal ------------------------------------------------------

/**
 * The slug a proposal takes: the caller's, checked, or the one made from the redacted
 * title. A caller's slug that redaction would change is refused: it would name a file
 * after a secret.
 */
export function proposalSlug(store: KnowledgeStore, change: EntryChange): string {
  if (change.slug !== undefined) {
    checkSlug(change.slug);
    if (redact(change.slug, { env: store.env }) !== change.slug) {
      throw invalid("slug: it reads as a secret and would be redacted; choose another");
    }
    return change.slug;
  }
  return slugify(redact(change.title, { env: store.env }).trim());
}

/**
 * The version a proposal is based on; 0 for a new entry. A caller's slug that names an
 * entry is a change to it, at the current version unless the caller gave one; a slug made
 * from the title is a new entry. Refused when the target does not match: an entry that
 * exists for a new one, none for a change, another version than the base.
 */
export function proposalBase(
  slug: string,
  change: EntryChange,
  current: { version: number } | null,
): number {
  const base =
    change.baseVersion === undefined
      ? change.slug !== undefined && current !== null
        ? current.version
        : 0
      : checkBase(change.baseVersion);
  if (base === 0 && current !== null) {
    throw new KnowledgeError(
      "exists",
      `${entryPath(slug)} exists at version ${current.version}; propose a change with its slug and base version ${current.version}`,
    );
  }
  if (base > 0 && current === null) {
    throw new KnowledgeError("missing", `there is no entry ${slug} to change`);
  }
  if (current !== null && current.version !== base) {
    throw stale(current.version, base, "proposal");
  }
  return base;
}

/** How a proposal is written: under the quotas (an agent's), or outside them and committed by another (the sync's). */
interface ProposeOptions {
  quota: boolean;
  /** The commit's author and committer when they are not the proposer: the person, with the sync as committer. */
  commitAs?: { writer: Writer; committer: Identity };
}

function propose(
  store: KnowledgeStore,
  ref: ScopeRef,
  change: EntryChange,
  writer: AgentWriter | SyncWriter,
  options: ProposeOptions,
): KnowledgeProposal {
  // A proposal enters a history the engine never rewrites, and a session's text may carry
  // a secret. The limits apply to what is stored: the text after redaction.
  const clean = (text: string): string => redact(text, { env: store.env });
  const slug = proposalSlug(store, change);
  const status = change.status;
  const fields = checkFields({
    title: clean(change.title),
    kind: change.kind,
    area: change.area,
    context: clean(change.context),
    subject: clean(change.subject),
    status: status ?? "active",
  });
  const body = bodyOf(clean(change.body));
  const extras = change.proposal;

  return underLeases(store, ref, true, (repo, taxonomy) => {
    checkArea(fields.area, taxonomy);
    checkTarget(store, repo, slug);
    const current = readCurrent(repo, slug, taxonomy);
    const base = proposalBase(slug, change, current === null ? null : current.entry);

    if (options.quota) {
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
      contradicts: extras?.contradicts ?? [],
      onBehalfOf: extras?.onBehalfOf ?? null,
      judgedBy: extras?.judgedBy ?? null,
      judgeVersion: extras?.judgeVersion ?? null,
      extra: [],
      problem: null,
    };
    const path = openPath(proposal.id);
    const text = checkSize(renderProposal(proposal));
    const committed = commit(store, repo, {
      operation: "write",
      writer: options.commitAs?.writer ?? writer,
      write: [{ path, text }],
      remove: [],
      existed: [],
      created: [path],
      message: `knowledge: propose ${proposal.id} for ${slug}`,
      proposalId: proposal.id,
      ...(options.commitAs === undefined ? {} : { committer: options.commitAs.committer }),
    });
    settle(store, repo, committed, () =>
      upsertProposal(store, repo.id, proposal, path, hashOf(Buffer.from(text))),
    );
    return proposal;
  });
}

// --- The sync's writes (ADR 0027) ---------------------------------------------------------

/**
 * The text with its `pinned` line as the local file has it: the server's line, if any, is
 * dropped, and `pinned: true` is put before the closing `---` when the local entry is pinned.
 * Every other byte stays, so the hash equals the server's whenever the entry has no pin. A
 * text without a frontmatter is left as it is.
 */
function withLocalPin(text: string, pinned: boolean): string {
  const split = splitFrontmatterLines(text);
  if (split === null) return text;
  const front = pinned ? [...split.front, "pinned: true"] : split.front;
  return [split.open, ...front, split.close, ...split.body].join("\n");
}

function requireSyncWriter(writer: Writer, what: string): SyncWriter {
  if (writer.kind !== "sync")
    throw invalid(`${what} is the sync's own write, never a person's or an agent's`);
  return writer;
}

/**
 * Applies a teammate's revision to the person's own entry: the server's text, verbatim but
 * for the local `pinned` line, committed under the member's name with the sync as committer
 * (`commitChange` under the repository's leases, which throw `locked`). The new version and
 * hash are what the ledger records.
 */
export function applyRevision(
  store: KnowledgeStore,
  ref: ScopeRef,
  uuid: string,
  text: string,
  writer: Writer,
  options: { uid: string; revision: number },
): { version: number; hash: string } {
  requireSchema(store);
  requireGit(store);
  const sync = requireSyncWriter(writer, "applying a revision");
  if (!UUID.test(uuid)) throw invalid("entry id: the id of an own entry");
  return underLeases(store, ref, false, (repo, taxonomy) => {
    const slug = entrySlugById(store, repo.id, uuid);
    if (slug === null) throw new KnowledgeError("missing", `there is no entry ${uuid} to revise`);
    checkTarget(store, repo, slug);
    const current = readCurrent(repo, slug, taxonomy);
    if (current === null)
      throw new KnowledgeError("missing", `there is no entry ${slug} to revise`);
    // The server's text verbatim but for the pin, which is this machine's alone.
    const applied = checkSize(withLocalPin(text, current.entry.pinned));
    const path = entryPath(slug);
    const committed = commit(store, repo, {
      operation: "apply",
      writer: sync,
      committer: syncCommitter(sync),
      write: [{ path, text: applied }],
      remove: [],
      existed: [path],
      created: [],
      message: `sync: apply ${options.uid} revision ${options.revision} from ${sync.serverName}`,
    });
    const entry = parseEntry(applied, slug, taxonomy);
    const hash = hashOf(Buffer.from(applied));
    settle(store, repo, committed, () => upsertEntry(store, repo.id, entry, path, hash));
    return { version: entry.version, hash };
  });
}

/**
 * Keeps the person's text of a conflicted entry as a proposal: parsed into the proposal's
 * fields with the `pinned` line dropped, redacted as every proposal is, outside both quotas,
 * on the file's new version and hash, by `sync:<serverId>` on the person's behalf, and
 * committed under the person's own identity with the sync as committer.
 */
export function proposeConflict(
  store: KnowledgeStore,
  ref: ScopeRef,
  uuid: string,
  text: string,
  writer: Writer,
  base: { version: number; hash: string },
): { id: string } {
  requireSchema(store);
  requireGit(store);
  const sync = requireSyncWriter(writer, "a conflict proposal");
  if (!UUID.test(uuid)) throw invalid("entry id: the id of an own entry");
  const repo = openRepo(store, ref);
  if (repo === null)
    throw new KnowledgeError("missing", `there is no ${ref.scope} knowledge repository yet`);
  const slug = entrySlugById(store, repo.id, uuid);
  if (slug === null)
    throw new KnowledgeError("missing", `there is no entry ${uuid} to keep a conflict of`);
  const local = parseEntry(withLocalPin(text, false), slug, null);
  const person = personAuthor(store);
  const current = readCurrent(repo, slug, null);
  if (current === null)
    throw new KnowledgeError("missing", `there is no entry ${slug} to keep a conflict of`);
  if (current.entry.version !== base.version || current.hash !== base.hash) {
    throw stale(current.entry.version, base.version, "conflict proposal");
  }
  const proposal = propose(
    store,
    ref,
    {
      slug,
      title: local.title,
      kind: local.kind,
      area: local.area,
      context: local.context,
      subject: local.subject,
      status: local.status,
      body: local.body,
      baseVersion: base.version,
      proposal: { contradicts: [], onBehalfOf: person.name, judgedBy: null, judgeVersion: null },
    },
    sync,
    { quota: false, commitAs: { writer: person, committer: syncCommitter(sync) } },
  );
  return { id: proposal.id };
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
      // A proposal carries no pin: the entry keeps the one a person gave it.
      pinned: undefined,
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
    const committed = commit(store, repo, {
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
    settle(store, repo, committed, () => {
      upsertEntry(store, repo.id, entry, paths.entry, hashOf(Buffer.from(entryText)));
      upsertProposal(store, repo.id, decided, paths.decided, hashOf(Buffer.from(decidedText)));
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
    const committed = commit(store, repo, {
      operation: "reject",
      writer: person,
      write: [{ path: paths.decided, text }],
      remove: [paths.open],
      existed: [paths.open],
      created: [paths.decided],
      message: `knowledge: reject ${proposalId}`,
      proposalId,
    });
    settle(store, repo, committed, () =>
      upsertProposal(store, repo.id, decided, paths.decided, hashOf(Buffer.from(text))),
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
  // git names a folder, not its files, only where the folder is a repository of its own.
  const nested = changed.find((path) => path.endsWith("/"));
  if (nested !== undefined) {
    throw invalid(
      `${nested} is a git repository of its own, and the knowledge store keeps none inside its folders; move it out of ${repo.relative}, then run ${ADOPT} again`,
    );
  }

  const atHead = pathsAtHead(store, repo, changed, "adopt");
  const present = changed.filter((path) => existsOnDisk(absolute(repo, path)));
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

  const keptName = keptFileName();
  // What adopt leaves at each path: nothing where the file is gone, an entry's rewrite,
  // and otherwise the person's bytes untouched. A file that cannot be read as a regular
  // file has no line here, and an interrupted adopt leaves it as it finds it.
  const written: Record<string, string | null> = {};
  for (const path of [...deleted, ...vanished]) written[path] = null;
  for (const path of present) {
    try {
      const bytes = kept.get(path) ?? readRegularFile(absolute(repo, path));
      if (bytes !== null) written[path] = hashOf(bytes);
    } catch (error) {
      if (!(error instanceof KnowledgeError)) throw error;
    }
  }
  for (const { path, text } of rewrites) written[path] = hashOf(Buffer.from(text));
  writeIntent(repo, {
    operation: "adopt",
    writer: person,
    existed: changed.filter((path) => atHead.has(path)),
    created: changed.filter((path) => !atHead.has(path)),
    written,
    keptBytesFile: keptName,
  });
  // After the record that names them: kept bytes no record names would never be removed.
  keepBytes(repo, kept, keptName);
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
      // One line for each path, whatever the name holds: a line break in a file's name
      // must not put a line of its own into the message.
      const listed = paths.map((path) => path.replace(CONTROL, "?"));
      commitPaths(
        store,
        repo,
        paths,
        `knowledge: adopt ${count} ${count === 1 ? "change" : "changes"} made outside the engine\n\n${listed.join("\n")}`,
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
