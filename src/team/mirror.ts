// The mirror: an export of the entries to git repositories under `repos/`, one commit per
// applied revision, written from the database by `serve mirror` (hourly, after a quiet minute
// following a push, or by hand) and rebuilt from `entry_revisions` (D-10, D-26). Git runs
// through part 1's runner, synchronously, in the child process; never on a request.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { slugify } from "../modules/knowledge/entry.ts";
import {
  commitPaths,
  type GitHost,
  headOf,
  projectFolderName,
  removePaths,
  runGit,
  stagePaths,
  writeFileAtomic,
} from "../modules/knowledge/repo.ts";
import type { Identity } from "../modules/knowledge/types.ts";
import { entryUid } from "../sharing/types.ts";
import { selfCommand } from "../util/self.ts";
import { type Db, teamPaths } from "./db.ts";
import { HttpError } from "./errors.ts";
import { holdLease, MIRROR_LEASE, MIRROR_TTL_MS } from "./lease.ts";
import type { TeamLog } from "./log.ts";
import { parseFeedUid } from "./push.ts";
import type { Timers } from "./signal.ts";
import {
  allRevisions,
  deleteEntry,
  deleteMemory,
  deleteRevisions,
  deviceById,
  entriesPendingMirror,
  entryByUuid,
  insertChange,
  insertPurged,
  markPurged,
  memberById,
  memoryByKey,
  type RevisionRow,
  resetMirrorRevisions,
  revisionAt,
  revisionsOf,
  setMeta,
  setMirrorRevision,
  transaction,
} from "./store.ts";

export const SERVER_IDENTITY: Identity = {
  name: "wizardingcode-mem serve",
  email: "server@team.wizardingcode.invalid",
};

/** A commit's author: the member, under an address that names their id and resolves nowhere. */
export function memberIdentity(member: { id: string; name: string }): Identity {
  return { name: member.name, email: `${member.id}@members.wizardingcode.invalid` };
}

/** The slug of a name, or `fallback` when nothing of it survives: never the raw text. */
function slugOf(text: string, fallback: string): string {
  const letters = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return letters === "" ? fallback : slugify(text);
}

/**
 * The repository a scope and alias name, relative to `repos/`: `shared`; a project by the
 * slug of its alias and a hash of it; a member's workspace by their id and the slug of their
 * name. Built from ids and slugs, so a name such as `../x` stays under its parent.
 */
export function repoFolder(
  scope: string,
  remoteAlias: string | null,
  member: { id: string; name: string } | null,
): string {
  if (scope === "shared") return "shared";
  if (scope === "project") {
    const alias = remoteAlias ?? "";
    const slug = slugOf(alias.replace(/^remote:/, ""), "project");
    return `projects/${slug}-${projectFolderName(alias).slice(0, 8)}`;
  }
  const who = member ?? { id: "unknown", name: "" };
  return `members/${who.id}-${slugOf(who.name, "member")}`;
}

/** A fixed file name: two entries with one slug never collide, and a slug change is a rename. */
export function fileNameFor(uuid: string, slug: string): string {
  return `entries/${slug}--${uuid.slice(0, 8)}.md`;
}

export const MIRROR_GIT_TIMEOUT_MS = 60_000;

/** The runner's host for the mirror: `repos/` as the ceiling, a long timeout, the volume's owner trusted. */
export function mirrorHost(
  dataDir: string,
  env: Record<string, string | undefined>,
  gitPath?: string,
): GitHost {
  const path = gitPath === undefined ? (env.PATH ?? "") : `${gitPath}:${env.PATH ?? ""}`;
  return {
    dataDir,
    env: { ...env, PATH: path },
    gitTimeoutMs: MIRROR_GIT_TIMEOUT_MS,
    renew: null,
    root: teamPaths(dataDir).repos,
    extraConfig: ["-c", "safe.directory=*"],
  };
}

export interface MirrorContext {
  db: Db;
  dataDir: string;
  env: Record<string, string | undefined>;
  gitPath?: string;
  log: TeamLog;
  now: () => number;
}

export interface MirrorRun {
  commits: number;
  errors: { folder: string; message: string }[];
}

/** The run's lease went to another holder: the run stops before it touches a repository again. */
class MirrorLeaseLostError extends Error {
  constructor() {
    super("the mirror lease was lost to another holder");
    this.name = "MirrorLeaseLostError";
  }
}

/** A failure inside one repository, named by its folder. */
class MirrorRepoError extends Error {
  constructor(
    readonly folder: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "MirrorRepoError";
  }
}

interface RepoMeta {
  scope: string;
  remoteAlias?: string;
  memberId?: string;
  memberName?: string;
}

const OPERATION = "mirror";

/**
 * The repository at `folder`, made when absent: `git init -q --template=`, `knowledge.json`,
 * `entries/.gitkeep`, one commit by the server. A folder with `.git` and no HEAD (a run cut
 * after init) is completed the same way. An `index.lock` left by a dead run is removed first:
 * the caller holds the mirror lease, so no other run is alive.
 */
export function ensureMirrorRepo(
  host: GitHost,
  folder: string,
  meta: RepoMeta,
  now: number,
): string {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const gitDir = join(folder, ".git");
  rmSync(join(gitDir, "index.lock"), { force: true });
  if (!existsSync(gitDir)) {
    runGit(host, null, ["init", "-q", "--template=", folder], { operation: OPERATION });
  }
  if (headOf(folder) === null) {
    const manifest = {
      format: 1,
      scope: meta.scope,
      ...(meta.remoteAlias === undefined ? {} : { remoteAlias: meta.remoteAlias }),
      ...(meta.memberId === undefined ? {} : { memberId: meta.memberId }),
      ...(meta.memberName === undefined ? {} : { memberName: meta.memberName }),
      mirror: true,
      createdAt: new Date(now).toISOString(),
    };
    writeFileAtomic(join(folder, "knowledge.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    mkdirSync(join(folder, "entries"), { recursive: true, mode: 0o700 });
    writeFileAtomic(join(folder, "entries", ".gitkeep"), "");
    const paths = ["knowledge.json", "entries/.gitkeep"];
    stagePaths(host, { path: folder }, paths, OPERATION);
    commitPaths(
      host,
      { path: folder },
      paths,
      `team: init ${meta.scope}`,
      SERVER_IDENTITY,
      OPERATION,
    );
  }
  return folder;
}

interface Placed {
  relative: string;
  meta: RepoMeta;
}

/** Where a revision lives: the folder its scope, alias or creator names, and the manifest for it. */
function placeOf(db: Db, revision: RevisionRow, creator: string): Placed {
  if (revision.scope === "workspace") {
    const name = memberById(db, creator)?.name ?? creator;
    return {
      relative: repoFolder("workspace", null, { id: creator, name }),
      meta: { scope: "workspace", memberId: creator, memberName: name },
    };
  }
  if (revision.scope === "project") {
    return {
      relative: repoFolder("project", revision.remote_alias, null),
      meta: { scope: "project", remoteAlias: revision.remote_alias ?? "" },
    };
  }
  return { relative: "shared", meta: { scope: "shared" } };
}

const uidOf = (revision: RevisionRow) =>
  entryUid(
    revision.scope as "workspace" | "shared" | "project",
    revision.remote_alias,
    revision.uuid,
  );

/**
 * One revision as commits: a move removes the file from the previous folder in a commit
 * there; a send writes the file (and removes the old name on a slug change); a withdraw
 * removes it. With `only`, the folders outside the set are left as they are: a replay.
 * Returns 1 when the revision reached a repository, 0 when `only` kept it out.
 */
function applyRevision(
  db: Db,
  host: GitHost,
  root: string,
  revision: RevisionRow,
  previous: RevisionRow | null,
  creator: string,
  only: ReadonlySet<string> | null,
  now: number,
): number {
  const here = placeOf(db, revision, creator);
  const writer = memberById(db, revision.writer_member);
  const author = memberIdentity({
    id: revision.writer_member,
    name: writer?.name ?? revision.writer_member,
  });
  const uid = uidOf(revision);
  const trailers = `\n\nRevision: ${revision.revision}\nUid: ${uid}\nHash: ${revision.hash}\n`;
  const file = fileNameFor(revision.uuid, revision.slug);
  let touched = 0;
  const inRepo = <T>(relative: string, fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof MirrorLeaseLostError) throw error;
      throw new MirrorRepoError(relative, error);
    }
  };

  const livePrevious = previous !== null && previous.op === "send" ? previous : null;
  const there = livePrevious === null ? null : placeOf(db, livePrevious, creator);
  if (livePrevious !== null && there !== null && there.relative !== here.relative) {
    if (only === null || only.has(there.relative)) {
      inRepo(there.relative, () => {
        const path = ensureMirrorRepo(host, join(root, there.relative), there.meta, now);
        const oldFile = fileNameFor(livePrevious.uuid, livePrevious.slug);
        if (existsSync(join(path, oldFile))) {
          removePaths(host, { path }, [oldFile], OPERATION);
          commitPaths(
            host,
            { path },
            [oldFile],
            `team: move ${uid}${trailers}`,
            author,
            OPERATION,
            SERVER_IDENTITY,
          );
        }
      });
      touched = 1;
    }
  }

  if (only !== null && !only.has(here.relative)) return touched;
  inRepo(here.relative, () => {
    const path = ensureMirrorRepo(host, join(root, here.relative), here.meta, now);
    if (revision.op === "send") {
      const paths = [file];
      if (
        livePrevious !== null &&
        there?.relative === here.relative &&
        livePrevious.slug !== revision.slug
      ) {
        const oldFile = fileNameFor(livePrevious.uuid, livePrevious.slug);
        if (existsSync(join(path, oldFile))) {
          removePaths(host, { path }, [oldFile], OPERATION);
          paths.push(oldFile);
        }
      }
      writeFileAtomic(join(path, file), revision.frontmatter + revision.body);
      stagePaths(host, { path }, [file], OPERATION);
      commitPaths(
        host,
        { path },
        paths,
        `team: send ${uid}${trailers}`,
        author,
        OPERATION,
        SERVER_IDENTITY,
      );
    } else if (existsSync(join(path, file))) {
      removePaths(host, { path }, [file], OPERATION);
      commitPaths(
        host,
        { path },
        [file],
        `team: withdraw ${uid}${trailers}`,
        author,
        OPERATION,
        SERVER_IDENTITY,
      );
    }
  });
  return 1;
}

/** Every folder a revision touches: its own, and the one it left on a move. */
function foldersOf(
  db: Db,
  revision: RevisionRow,
  previous: RevisionRow | null,
  creator: string,
): string[] {
  const folders = [placeOf(db, revision, creator).relative];
  if (previous !== null && previous.op === "send") {
    const left = placeOf(db, previous, creator).relative;
    if (left !== folders[0]) folders.push(left);
  }
  return folders;
}

interface Pending {
  revision: RevisionRow;
  creator: string;
}

/** The revisions the mirror has not exported, in the order of their `seq`. */
function pendingRevisions(db: Db): Pending[] {
  const pending: Pending[] = [];
  for (const entry of entriesPendingMirror(db)) {
    for (const revision of revisionsOf(db, entry.uuid)) {
      if (revision.revision > entry.mirror_revision) {
        pending.push({ revision, creator: entry.created_by_member });
      }
    }
  }
  return pending.sort((a, b) => a.revision.seq - b.revision.seq);
}

const summary = (errors: MirrorRun["errors"]) =>
  errors.length === 0
    ? null
    : errors.map((error) => `${error.folder}: ${error.message}`).join("; ");

/** Takes the mirror lease and gives a host whose every git call renews it, or stops the run. */
function underMirrorLease<T>(
  ctx: MirrorContext,
  fn: (host: GitHost, errors: MirrorRun["errors"]) => T,
  record: (result: T | null, errors: MirrorRun["errors"]) => void,
): T {
  const lease = holdLease(ctx.db, MIRROR_LEASE, "mirror", MIRROR_TTL_MS, ctx.now);
  const host: GitHost = {
    ...mirrorHost(ctx.dataDir, ctx.env, ctx.gitPath),
    renew: () => {
      if (!lease.renew()) throw new MirrorLeaseLostError();
    },
  };
  const errors: MirrorRun["errors"] = [];
  let result: T | null = null;
  try {
    result = fn(host, errors);
    return result;
  } finally {
    record(result, errors);
    lease.release();
  }
}

/**
 * The export: every pending revision in `seq` order, each as commits; a repository that
 * fails is recorded and skipped for the rest of the run, the others go on; a lost lease
 * ends the run. `rebuild` removes every repository first and replays from the start.
 */
export async function runMirror(
  ctx: MirrorContext,
  options: { rebuild: boolean },
): Promise<MirrorRun> {
  const root = teamPaths(ctx.dataDir).repos;
  let commits = 0;
  const errors = underMirrorLease(
    ctx,
    (host, failures) => {
      if (options.rebuild) {
        rmSync(root, { recursive: true, force: true });
        resetMirrorRevisions(ctx.db);
      }
      const failed = new Set<string>();
      const skipped = new Set<string>();
      for (const { revision, creator } of pendingRevisions(ctx.db)) {
        if (skipped.has(revision.uuid)) continue;
        const previous =
          revision.revision > 1 ? revisionAt(ctx.db, revision.uuid, revision.revision - 1) : null;
        const folders = foldersOf(ctx.db, revision, previous, creator);
        if (folders.some((folder) => failed.has(folder))) {
          skipped.add(revision.uuid);
          continue;
        }
        try {
          commits += applyRevision(
            ctx.db,
            host,
            root,
            revision,
            previous,
            creator,
            null,
            ctx.now(),
          );
          setMirrorRevision(ctx.db, revision.uuid, revision.revision);
        } catch (error) {
          if (error instanceof MirrorRepoError) {
            failed.add(error.folder);
            skipped.add(revision.uuid);
            failures.push({ folder: error.folder, message: error.message });
            continue;
          }
          failures.push({
            folder: folders[0] as string,
            message: error instanceof Error ? error.message : String(error),
          });
          break;
        }
      }
      return failures;
    },
    (_result, failures) => {
      setMeta(
        ctx.db,
        "mirror.last",
        JSON.stringify({ at: ctx.now(), commits, error: summary(failures) }),
      );
    },
  );
  return { commits, errors };
}

/**
 * Replays the exported revisions that touch `folders` after those folders were removed: a
 * purge's rebuild. Revisions the mirror has not exported yet are left to the next run.
 */
function replayFolders(
  ctx: MirrorContext,
  folders: ReadonlyMap<string, RepoMeta>,
): MirrorRun["errors"] {
  const root = teamPaths(ctx.dataDir).repos;
  return underMirrorLease(
    ctx,
    (host, failures) => {
      for (const folder of folders.keys())
        rmSync(join(root, folder), { recursive: true, force: true });
      const only = new Set(folders.keys());
      const exported = new Map<string, { creator: string; mirrorRevision: number }>();
      for (const revision of allRevisions(ctx.db)) {
        let entry = exported.get(revision.uuid);
        if (entry === undefined) {
          const row = entryByUuid(ctx.db, revision.uuid);
          entry = {
            creator: row?.created_by_member ?? revision.writer_member,
            mirrorRevision: row?.mirror_revision ?? 0,
          };
          exported.set(revision.uuid, entry);
        }
        if (revision.revision > entry.mirrorRevision) continue;
        const previous =
          revision.revision > 1 ? revisionAt(ctx.db, revision.uuid, revision.revision - 1) : null;
        try {
          applyRevision(ctx.db, host, root, revision, previous, entry.creator, only, ctx.now());
        } catch (error) {
          failures.push({
            folder:
              error instanceof MirrorRepoError
                ? error.folder
                : placeOf(ctx.db, revision, entry.creator).relative,
            message: error instanceof Error ? error.message : String(error),
          });
          if (!(error instanceof MirrorRepoError)) break;
        }
      }
      // A repository the purged entry alone had filled stays, with its init commit and nothing else.
      for (const [relative, meta] of folders) {
        try {
          ensureMirrorRepo(host, join(root, relative), meta, ctx.now());
        } catch (error) {
          failures.push({
            folder: relative,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return failures;
    },
    (_result, failures) => {
      if (failures.length > 0) {
        setMeta(
          ctx.db,
          "mirror.last",
          JSON.stringify({ at: ctx.now(), commits: 0, error: summary(failures) }),
        );
      }
    },
  );
}

/** A memory's key split at its first colon. */
function splitKey(key: string): { deviceId: string; uid: string } {
  const colon = key.indexOf(":");
  return { deviceId: key.slice(0, colon), uid: key.slice(colon + 1) };
}

const unknown = () => new HttpError(404, { error: "unknown" });

/**
 * Erasure (D-24): one transaction removes the item's row (and an entry's revisions), turns
 * its feed rows into `purge` rows, writes one more `purge` row and records the key; then,
 * for an entry, every repository its revisions touched is removed and replayed without it.
 */
export async function purgeItem(
  ctx: MirrorContext,
  kind: "entry" | "memory",
  uid: string,
  now: number,
): Promise<{ revisions: number; feedRows: number }> {
  const { db } = ctx;
  const named = parseFeedUid(db, kind, uid, null);
  if (named === null) throw unknown();
  const touched = new Map<string, RepoMeta>();
  const result = transaction(db, () => {
    if (kind === "entry") {
      const row = entryByUuid(db, named.key);
      if (row === null) throw unknown();
      for (const revision of revisionsOf(db, row.uuid)) {
        const place = placeOf(db, revision, row.created_by_member);
        touched.set(place.relative, place.meta);
      }
      const revisions = deleteRevisions(db, row.uuid);
      deleteEntry(db, row.uuid);
      const feedRows = markPurged(db, row.uuid);
      insertChange(db, {
        kind: "entry",
        uid: entryUid(row.scope as "workspace" | "shared" | "project", row.remote_alias, row.uuid),
        key: row.uuid,
        op: "purge",
        scope: row.scope,
        remoteAlias: row.remote_alias,
        revision: row.revision,
        hash: "",
        movedTo: null,
        memberId: "operator",
        deviceId: "cli",
        clientEpoch: null,
        at: now,
      });
      insertPurged(db, row.uuid, now);
      return { revisions, feedRows };
    }
    const { deviceId, uid: memoryUid } = splitKey(named.key);
    const row = memoryByKey(db, deviceId, memoryUid);
    if (row === null) throw unknown();
    deleteMemory(db, deviceId, memoryUid);
    const feedRows = markPurged(db, named.key);
    const alias = deviceById(db, deviceId)?.alias ?? "";
    insertChange(db, {
      kind: "memory",
      uid: `remote:${alias}:${memoryUid}`,
      key: named.key,
      op: "purge",
      scope: "project",
      remoteAlias: row.remote_alias,
      revision: row.revision,
      hash: "",
      movedTo: null,
      memberId: "operator",
      deviceId: "cli",
      clientEpoch: null,
      at: now,
    });
    insertPurged(db, named.key, now);
    return { revisions: 1, feedRows };
  });
  if (touched.size > 0) {
    const errors = replayFolders(ctx, touched);
    for (const error of errors) ctx.log.line({ level: "error", event: "mirror-replay", ...error });
  }
  return result;
}

// --- The child and its schedule --------------------------------------------------------

/** One line of the child's output into the log: its own JSON when it is, the text otherwise. */
function forwardLine(log: TeamLog, line: string): void {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    log.line({ ...parsed, child: "mirror" });
  } catch {
    log.line({ event: "mirror-output", text: line });
  }
}

/** Runs `serve mirror` as a child of this process; `signal` ends it early. */
export function spawnMirror(dataDir: string, log: TeamLog, signal: AbortSignal): Promise<void> {
  const child = Bun.spawn(selfCommand("serve", "mirror", "--data", dataDir), {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const onAbort = () => child.kill("SIGTERM");
  signal.addEventListener("abort", onAbort, { once: true });
  const forward = async (stream: ReadableStream<Uint8Array> | number | undefined) => {
    if (!(stream instanceof ReadableStream)) return;
    const text = await new Response(stream).text();
    for (const line of text.split("\n")) if (line.trim() !== "") forwardLine(log, line);
  };
  return Promise.all([forward(child.stdout), forward(child.stderr), child.exited]).then(
    ([, , code]) => {
      signal.removeEventListener("abort", onAbort);
      if (code !== 0) log.line({ level: "warn", event: "mirror-exit", code });
    },
  );
}

export const MIRROR_AFTER_PUSH_MS = 60_000;
export const MIRROR_STOP_WAIT_MS = 20_000;

export interface MirrorSchedule {
  afterPush(): void;
  hourly(): void;
  stop(): Promise<void>;
  child(): Promise<void> | null;
}

/**
 * One timer and at most one child: a push arms or re-arms the quiet-minute timer, the hourly
 * tick and the timer both run the export unless a run is alive; `stop` clears the timer,
 * signals the child and waits for it, for at most `MIRROR_STOP_WAIT_MS`, leaving no timer.
 */
export function scheduleMirror(
  ctx: { dataDir: string; log: TeamLog },
  timers: Timers,
  run: (dataDir: string, signal: AbortSignal) => Promise<void>,
): MirrorSchedule {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let child: { done: Promise<void>; controller: AbortController } | null = null;
  const launch = () => {
    if (child !== null) return;
    const controller = new AbortController();
    const done = run(ctx.dataDir, controller.signal)
      .catch((error: unknown) => ctx.log.error("team.mirror", error))
      .finally(() => {
        child = null;
      });
    child = { done, controller };
  };
  return {
    afterPush: () => {
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        timer = null;
        launch();
      }, MIRROR_AFTER_PUSH_MS);
    },
    hourly: launch,
    child: () => child?.done ?? null,
    stop: async () => {
      if (timer !== null) {
        timers.clearTimeout(timer);
        timer = null;
      }
      const running = child;
      if (running === null) return;
      running.controller.abort();
      await new Promise<void>((resolve) => {
        const limit = timers.setTimeout(resolve, MIRROR_STOP_WAIT_MS);
        running.done.then(() => {
          timers.clearTimeout(limit);
          resolve();
        });
      });
    },
  };
}
