// The repositories of the knowledge store and the one way git is run in them.
//
// Every git call goes through `runGit`: a bounded, synchronous process whose command
// line and environment are built here and nowhere else, so that nothing of the person's
// git setup (hooks, templates, signing, fsmonitor, filters, includes) runs in these
// repositories and a parent git tree never receives a commit. Never on a hook path.
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { headOfGitDir } from "../../core/git.ts";
import { claimLease, KNOWLEDGE_LEASE_PREFIX, releaseLease } from "../../store/meta.ts";
import { logError } from "../../util/log.ts";
import { clip } from "../../util/text.ts";
import { identityOf, personAuthor } from "./author.ts";
import { DEFAULT_AREAS, ENTRY_MAX_BYTES, nowIso, parseTaxonomy, renderTaxonomy } from "./entry.ts";
import { KnowledgeError } from "./errors.ts";
import { resolveRepo } from "./resolve.ts";
import type {
  Identity,
  KnowledgeStore,
  Manifest,
  Repo,
  RootRef,
  ScopeRef,
  Taxonomy,
  Writer,
} from "./types.ts";

export const GIT_TIMEOUT_MS = 15000;
export const KNOWLEDGE_LEASE_MS = 60000;
/** `GIT_CONFIG_GLOBAL`, which keeps the person's configuration out, arrived in 2.32. */
export const GIT_MIN_VERSION = [2, 32, 0];

const STDERR_MAX = 300;
/** How a killed call is named in its error: `requireGit` tells it from a missing git by it. */
const TIMED_OUT = "timed out";
export const MANIFEST_FILE = "knowledge.json";
export const TAXONOMY_FILE = "taxonomy.md";
const INTENT_FILE = "wizardingcode-op.json";
const GITIGNORE = [".DS_Store", "Thumbs.db", ".obsidian/", "*.swp", "*~", "*.tmp", ".*.md.tmp"];
export const ENTRIES_DIR = "entries";
export const OPEN_DIR = "proposals/open";
export const DECIDED_DIR = "proposals/decided";
const FOLDERS = [ENTRIES_DIR, OPEN_DIR, DECIDED_DIR];

// --- Where things are ---------------------------------------------------------------

export function knowledgeRoot(dataDir: string): string {
  return join(dataDir, "knowledge");
}

/** What git is pointed at instead of the person's templates, hooks and configuration. */
export function supportPaths(dataDir: string): {
  template: string;
  noHooks: string;
  emptyConfig: string;
} {
  const root = knowledgeRoot(dataDir);
  return {
    template: join(root, ".template"),
    noHooks: join(root, ".no-hooks"),
    emptyConfig: join(root, ".gitconfig-empty"),
  };
}

export function ensureSupportFolders(dataDir: string): void {
  const paths = supportPaths(dataDir);
  mkdirSync(knowledgeRoot(dataDir), { recursive: true, mode: 0o700 });
  mkdirSync(paths.template, { recursive: true, mode: 0o700 });
  mkdirSync(paths.noHooks, { recursive: true, mode: 0o700 });
  // An empty file is portable where `/dev/null` is not.
  if (!existsSync(paths.emptyConfig)) writeFileSync(paths.emptyConfig, "", { mode: 0o600 });
}

/** A repository's path relative to the data directory, with forward slashes. */
export function repoFolder(ref: ScopeRef, projectFolder?: string): string {
  if (ref.scope !== "project") return `knowledge/${ref.scope}`;
  if (projectFolder === undefined) throw new Error("a project repository needs its folder name");
  return `knowledge/projects/${projectFolder}`;
}

/** The absolute path of a repository folder given relative to the data directory. */
export function repoPath(dataDir: string, relative: string): string {
  return join(dataDir, ...relative.split("/"));
}

/** A project's folder is named from its remote, or its key: never from a path a person typed. */
export function projectFolderName(aliasOrKey: string): string {
  return createHash("sha256").update(aliasOrKey).digest("hex").slice(0, 16);
}

/** The workspace repository is the root of itself and of every project's; the shared one is its own. */
export function rootOf(ref: ScopeRef): RootRef {
  return ref.scope === "shared" ? { scope: "shared" } : { scope: "workspace" };
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Reads a regular file, never through a link: `lstat` first, then an open that refuses a
 * link as the second guard. Null when there is no file; a `KnowledgeError` for anything
 * that is not a regular file, or one over the cap.
 */
export function readRegularFile(path: string): Uint8Array | null {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    return null;
  }
  if (!stat.isFile()) throw new KnowledgeError("invalid", `${path} is not a regular file`);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    throw new KnowledgeError("invalid", `${path} cannot be opened as a regular file`);
  }
  try {
    const size = fstatSync(fd).size;
    if (size > ENTRY_MAX_BYTES) {
      throw new KnowledgeError("invalid", `${path} is over 256 KiB, the cap for one file`);
    }
    const bytes = new Uint8Array(size);
    let read = 0;
    while (read < size) {
      const n = readSync(fd, bytes, read, size - read, read);
      if (n === 0) break;
      read += n;
    }
    return bytes.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** Writes beside the target and renames over it, so a reader never sees half a file. */
export function writeFileAtomic(path: string, content: string | Uint8Array): void {
  const temp = join(dirname(path), `.${path.slice(dirname(path).length + 1)}.tmp`);
  try {
    writeFileSync(temp, content, { mode: 0o600 });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

// --- git ------------------------------------------------------------------------------

const versionByPath = new Map<string, number[]>();
const userNameByHome = new Map<string, string | null>();

/** For tests: forget the git version and the git user name looked up in this process. */
export function resetGitCaches(): void {
  versionByPath.clear();
  userNameByHome.clear();
}

export function parseGitVersion(text: string): number[] | null {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

interface GitOptions {
  /** Names the log line: `knowledge.<operation>`. */
  operation: string;
  /** The author and the committer of a commit. */
  identity?: Identity;
  /** The one lookup that may read the person's configuration: their global `user.name`. */
  allowUserConfig?: boolean;
  /** A call that changes nothing takes no index lock. */
  readOnly?: boolean;
  timeoutMs?: number;
}

export function gitEnv(
  store: KnowledgeStore,
  options: Pick<GitOptions, "identity" | "allowUserConfig" | "readOnly">,
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: store.env.PATH ?? "",
    GIT_TERMINAL_PROMPT: "0",
    // Git never looks for a repository above the knowledge folder.
    GIT_CEILING_DIRECTORIES: knowledgeRoot(store.dataDir),
  };
  if (options.allowUserConfig === true) {
    if (store.env.HOME !== undefined) env.HOME = store.env.HOME;
    if (store.env.XDG_CONFIG_HOME !== undefined) env.XDG_CONFIG_HOME = store.env.XDG_CONFIG_HOME;
  } else {
    env.GIT_CONFIG_GLOBAL = supportPaths(store.dataDir).emptyConfig;
    env.GIT_CONFIG_NOSYSTEM = "1";
  }
  if (options.readOnly === true) env.GIT_OPTIONAL_LOCKS = "0";
  if (options.identity !== undefined) {
    env.GIT_AUTHOR_NAME = options.identity.name;
    env.GIT_AUTHOR_EMAIL = options.identity.email;
    env.GIT_COMMITTER_NAME = options.identity.name;
    env.GIT_COMMITTER_EMAIL = options.identity.email;
  }
  return env;
}

/** A `-c` value wins over the repository's own `.git/config`, so a local setting never runs either. */
function configArgs(dataDir: string): string[] {
  const settings = [
    "commit.gpgsign=false",
    `core.hooksPath=${supportPaths(dataDir).noHooks}`,
    "core.autocrlf=false",
    "init.defaultBranch=main",
    "user.useConfigOnly=false",
    "core.fsmonitor=false",
    "core.untrackedCache=false",
    "core.pager=cat",
    "diff.external=",
    "core.sshCommand=",
  ];
  return settings.flatMap((setting) => ["-c", setting]);
}

/**
 * Runs git, bounded by the timeout, with the environment of the store and nothing else.
 * `repoPath` null is for the calls that have no repository yet: `init`, `--version` and the
 * global `user.name` lookup. A failure is a `KnowledgeError` with code `git`, logged; the
 * exception is a global configuration lookup that finds no value, which git reports as exit 1.
 */
export function runGit(
  store: KnowledgeStore,
  repo: string | null,
  args: string[],
  options: GitOptions & { quiet?: boolean },
): { stdout: string; exitCode: number } {
  // A lease lost to another writer stops the operation before it touches the repository again.
  store.renew?.();
  const subcommand = args.find((arg) => !arg.startsWith("-")) ?? args[0] ?? "";
  const fail = (reason: string): never => {
    const error = new KnowledgeError(
      "git",
      `git ${subcommand} in ${repo ?? store.dataDir} failed: ${clip(reason.trim(), STDERR_MAX)}`,
    );
    if (options.quiet !== true) logError(`knowledge.${options.operation}`, error, store.dataDir);
    throw error;
  };

  const git = Bun.which("git", { PATH: store.env.PATH ?? "" });
  if (git === null) return fail("git was not found on PATH");
  const location = repo === null ? [] : ["--git-dir", join(repo, ".git"), "--work-tree", repo];
  const timeout = options.timeoutMs ?? store.gitTimeoutMs;
  const cwd = repo ?? store.dataDir;
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync([git, ...location, ...configArgs(store.dataDir), ...args], {
      ...(existsSync(cwd) ? { cwd } : {}),
      env: gitEnv(store, options),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (result.exitedDueToTimeout === true) return fail(`${TIMED_OUT} after ${timeout} ms`);
  if (result.exitCode !== 0) {
    const lookup = args[0] === "config" && args.includes("--global");
    if (lookup && result.exitCode === 1) return { stdout: "", exitCode: 1 };
    return fail(result.stderr?.toString() || `exit ${result.exitCode ?? result.signalCode}`);
  }
  return { stdout: result.stdout?.toString() ?? "", exitCode: 0 };
}

const older = (found: number[], wanted: number[]) => {
  for (let i = 0; i < wanted.length; i++) {
    const a = found[i] ?? 0;
    const b = wanted[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
};

/** The installed git's version; refused when git is missing or too old. Looked up once per `PATH`. */
export function requireGit(store: KnowledgeStore): number[] {
  const key = store.env.PATH ?? "";
  const cached = versionByPath.get(key);
  if (cached !== undefined) return cached;
  let found: number[] | null = null;
  try {
    const answer = runGit(store, null, ["--version"], {
      operation: "version",
      readOnly: true,
      quiet: true,
    });
    found = parseGitVersion(answer.stdout);
  } catch (error) {
    if (!(error instanceof KnowledgeError)) throw error;
    // A git that hangs is not a missing git: the person is told what happened.
    if (error.message.includes(TIMED_OUT)) throw error;
  }
  if (found === null || older(found, GIT_MIN_VERSION)) {
    throw new KnowledgeError(
      "git",
      `git ${GIT_MIN_VERSION[0]}.${GIT_MIN_VERSION[1]} or newer is needed to version knowledge; found ${found === null ? "nothing" : found.join(".")}`,
    );
  }
  versionByPath.set(key, found);
  return found;
}

/** The person's global git `user.name`; null when there is none. Looked up once per `HOME`. */
export function gitUserName(store: KnowledgeStore): string | null {
  const key = store.env.HOME ?? "";
  if (userNameByHome.has(key)) return userNameByHome.get(key) ?? null;
  let name: string | null = null;
  try {
    const answer = runGit(store, null, ["config", "--global", "user.name"], {
      operation: "author",
      allowUserConfig: true,
      readOnly: true,
      quiet: true,
    });
    name = answer.exitCode === 0 ? answer.stdout.trim() || null : null;
  } catch (error) {
    if (!(error instanceof KnowledgeError)) throw error;
  }
  userNameByHome.set(key, name);
  return name;
}

const REFUSED_SECTIONS: Record<string, string> = {
  include: "include",
  includeif: "includeIf",
  filter: "filter",
};
const REFUSED_KEYS: Record<string, string> = {
  hookspath: "core.hooksPath",
  fsmonitor: "core.fsmonitor",
  sshcommand: "core.sshCommand",
};

/**
 * Reads the repository's own `.git/config` as text, with no process. A folder a person or
 * a later sync dropped under `knowledge/` could carry a configuration that runs a
 * program on add or restore; such a repository is refused, naming what it sets.
 */
export function checkRepoConfig(repo: string): void {
  const file = join(repo, ".git", "config");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  const refuse = (name: string): never => {
    throw new KnowledgeError(
      "invalid",
      `the repository's own git configuration sets ${name}, which the knowledge store never allows; remove it from ${file}`,
    );
  };
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[\s*([A-Za-z0-9-]+)[^\]]*\]\s*(.*)$/.exec(line);
    if (header !== null) {
      const section = REFUSED_SECTIONS[(header[1] as string).toLowerCase()];
      if (section !== undefined) refuse(section);
      // A key may follow its section on the same line.
      line = header[2] as string;
    }
    const key = /^([A-Za-z][A-Za-z0-9-]*)/.exec(line)?.[1]?.toLowerCase();
    const refused = key === undefined ? undefined : REFUSED_KEYS[key];
    if (refused !== undefined) refuse(refused);
  }
}

// --- The manifest and the taxonomy ----------------------------------------------------

export function parseManifest(text: string): Manifest | { problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { problem: `knowledge.json is not JSON: ${(error as Error).message}` };
  }
  const value = raw as Partial<Manifest> | null;
  if (value === null || typeof value !== "object" || value.format !== 1) {
    return { problem: "knowledge.json is not a format 1 manifest" };
  }
  if (value.scope !== "workspace" && value.scope !== "shared" && value.scope !== "project") {
    return { problem: "knowledge.json names no scope" };
  }
  const aliases = value.project?.aliases;
  if (
    aliases !== undefined &&
    !(Array.isArray(aliases) && aliases.every((a) => typeof a === "string"))
  ) {
    return { problem: "knowledge.json: project.aliases must be a list of texts" };
  }
  return {
    format: 1,
    scope: value.scope,
    ...(aliases === undefined ? {} : { project: { aliases: [...aliases] } }),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
  };
}

/** Null when the repository has no manifest, or one that cannot be read. */
export function readManifest(repo: string): Manifest | null {
  let bytes: Uint8Array | null;
  try {
    bytes = readRegularFile(join(repo, MANIFEST_FILE));
  } catch {
    return null;
  }
  if (bytes === null) return null;
  const manifest = parseManifest(new TextDecoder().decode(bytes));
  return "problem" in manifest ? null : manifest;
}

export function writeManifest(repo: string, manifest: Manifest): void {
  writeFileAtomic(join(repo, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * The taxonomy a repository's areas are checked against: its root's. Null when the root
 * repository does not exist yet. A taxonomy file that cannot be read is refused: no area
 * can be checked against it until a person fixes it.
 */
export function taxonomyFor(store: KnowledgeStore, ref: ScopeRef): Taxonomy | null {
  const root = rootOf(ref);
  const file = join(repoPath(store.dataDir, repoFolder(root)), TAXONOMY_FILE);
  const bytes = readRegularFile(file);
  if (bytes === null) return null;
  const taxonomy = parseTaxonomy(new TextDecoder().decode(bytes));
  if ("problem" in taxonomy) {
    throw new KnowledgeError(
      "invalid",
      `the ${root.scope} taxonomy cannot be read (${taxonomy.problem}); fix ${file} by hand, then run wizardingcode-mem knowledge adopt`,
    );
  }
  return taxonomy;
}

// --- Opening and creating -------------------------------------------------------------

/** Writes what a new repository holds and makes its first commit, always as the person. */
function createRepository(store: KnowledgeStore, repo: Repo): void {
  ensureSupportFolders(store.dataDir);
  mkdirSync(repo.path, { recursive: true, mode: 0o700 });
  if (!isDirectory(join(repo.path, ".git"))) {
    const template = supportPaths(store.dataDir).template;
    runGit(store, null, ["init", "-q", `--template=${template}`, repo.path], {
      operation: "write",
    });
  }
  const paths = [MANIFEST_FILE, ".gitignore"];
  if (!existsSync(join(repo.path, MANIFEST_FILE))) {
    writeManifest(repo.path, {
      format: 1,
      scope: repo.ref.scope,
      createdAt: nowIso(store.now()),
    });
  }
  writeFileSync(join(repo.path, ".gitignore"), `${GITIGNORE.join("\n")}\n`);
  if (repo.ref.scope !== "project") {
    paths.push(TAXONOMY_FILE);
    if (!existsSync(join(repo.path, TAXONOMY_FILE))) {
      const taxonomy = {
        version: 1,
        updated: nowIso(store.now()),
        areas: DEFAULT_AREAS.map((area) => ({ ...area })),
      };
      writeFileSync(join(repo.path, TAXONOMY_FILE), renderTaxonomy(taxonomy));
    }
  }
  for (const folder of FOLDERS) {
    mkdirSync(join(repo.path, ...folder.split("/")), { recursive: true, mode: 0o700 });
  }
  stagePaths(store, repo, paths, "write");
  commitPaths(
    store,
    repo,
    paths,
    "knowledge: repository (format 1)",
    identityOf(personAuthor(store)),
    "write",
  );
}

/**
 * The one way an operation obtains a repository. Null when the repository does not exist
 * and `create` was not given. Refuses a repository whose own git configuration could run
 * a program, and puts back what an interrupted operation left.
 */
export function openRepo(
  store: KnowledgeStore,
  ref: ScopeRef,
  options: { create?: Writer } = {},
): Repo | null {
  const repo = resolveRepo(
    store,
    ref,
    options.create === undefined ? {} : { create: options.create },
  );
  if (repo === null) return null;
  // A folder with no repository in it, or a creation that stopped before its first commit.
  if (headOf(repo.path) === null) {
    if (options.create === undefined) return null;
    if (isDirectory(join(repo.path, ".git"))) checkRepoConfig(repo.path);
    createRepository(store, repo);
  }
  checkRepoConfig(repo.path);
  revertInterrupted(store, repo);
  return repo;
}

/** The repository, created when missing: the root first, so its taxonomy exists to check against. */
export function ensureRepo(store: KnowledgeStore, ref: ScopeRef): Repo {
  requireGit(store);
  const person = personAuthor(store);
  if (ref.scope === "project") openRepo(store, rootOf(ref), { create: person });
  const repo = openRepo(store, ref, { create: person });
  if (repo === null) throw new KnowledgeError("missing", "the repository could not be created");
  return repo;
}

/** The repository's HEAD, read from its own `.git` and never from a parent's. */
export function headOf(repo: string): string | null {
  const gitDir = join(repo, ".git");
  return isDirectory(gitDir) ? headOfGitDir(gitDir) : null;
}

/**
 * `<entries>:<open>:<decided>:<newest folder mtime ms>`: three listings and three `stat`
 * calls, no per-file `stat`. It changes when a file is added, removed or renamed; an edit
 * in place changes neither it nor HEAD, and is caught by the dirty checks.
 */
export function fingerprintOf(repo: string): string {
  let newest = 0;
  const counts = FOLDERS.map((folder) => {
    const path = join(repo, ...folder.split("/"));
    try {
      newest = Math.max(newest, Math.trunc(statSync(path).mtimeMs));
      return readdirSync(path).filter((name) => !name.startsWith(".")).length;
    } catch {
      return 0;
    }
  });
  return `${counts.join(":")}:${newest}`;
}

// --- Staging, committing, undoing -------------------------------------------------------

/** The porcelain lines of the given paths (the whole repository when none): `XY path`. */
export function statusOf(store: KnowledgeStore, repo: Repo, paths: string[]): string[] {
  const answer = runGit(
    store,
    repo.path,
    ["status", "--porcelain", "-z", "--untracked-files=all", "--no-renames", "--", ...paths],
    { operation: "status", readOnly: true },
  );
  return answer.stdout.split("\0").filter((line) => line !== "");
}

export function stagePaths(
  store: KnowledgeStore,
  repo: Repo,
  paths: string[],
  operation: string,
): void {
  runGit(store, repo.path, ["add", "--", ...paths], { operation });
}

/** Stages the removal of files, also ones a person already deleted from the disk. */
export function removePaths(
  store: KnowledgeStore,
  repo: Repo,
  paths: string[],
  operation: string,
): void {
  runGit(store, repo.path, ["rm", "-q", "--", ...paths], { operation });
}

/** Commits the given paths and nothing else that may be staged. */
export function commitPaths(
  store: KnowledgeStore,
  repo: Repo,
  paths: string[],
  message: string,
  identity: Identity,
  operation: string,
): void {
  runGit(store, repo.path, ["commit", "-q", "--only", "-m", message, "--", ...paths], {
    operation,
    identity,
  });
}

/**
 * Puts back what the engine itself changed: a path that existed at HEAD is restored from
 * HEAD in the index and on the disk (a plain checkout would restore what was just
 * staged); a path that did not exist is removed from both.
 */
export function undoStaged(
  store: KnowledgeStore,
  repo: Repo,
  paths: { existed: string[]; created: string[] },
  operation: string,
): void {
  if (paths.existed.length > 0) {
    runGit(
      store,
      repo.path,
      ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...paths.existed],
      { operation },
    );
  }
  if (paths.created.length > 0) {
    runGit(store, repo.path, ["rm", "--cached", "-q", "--ignore-unmatch", "--", ...paths.created], {
      operation,
    });
    for (const path of paths.created) rmSync(join(repo.path, ...path.split("/")), { force: true });
  }
}

/** Takes paths out of the index and leaves the files as they are: for a person's own work. */
export function unstage(
  store: KnowledgeStore,
  repo: Repo,
  paths: string[],
  operation: string,
): void {
  runGit(store, repo.path, ["reset", "-q", "--", ...paths], { operation });
}

/** A file's text as HEAD holds it; null when HEAD does not hold it. */
export function showAtHead(store: KnowledgeStore, repo: Repo, path: string): string | null {
  if (!pathsAtHead(store, repo, [path], "adopt").has(path)) return null;
  return runGit(store, repo.path, ["show", `HEAD:${path}`], { operation: "adopt", readOnly: true })
    .stdout;
}

/** The given paths that exist at HEAD. */
export function pathsAtHead(
  store: KnowledgeStore,
  repo: Repo,
  paths: string[],
  operation: string,
): Set<string> {
  if (paths.length === 0) return new Set();
  const answer = runGit(
    store,
    repo.path,
    ["ls-tree", "-r", "-z", "--name-only", "HEAD", "--", ...paths],
    {
      operation,
      readOnly: true,
    },
  );
  return new Set(answer.stdout.split("\0").filter((path) => path !== ""));
}

/** Makes the given paths equal to HEAD, whichever of them HEAD holds. */
export function restoreToHead(
  store: KnowledgeStore,
  repo: Repo,
  paths: string[],
  operation: string,
): void {
  const atHead = pathsAtHead(store, repo, paths, operation);
  undoStaged(
    store,
    repo,
    {
      existed: paths.filter((path) => atHead.has(path)),
      created: paths.filter((path) => !atHead.has(path)),
    },
    operation,
  );
}

// --- The intent record ----------------------------------------------------------------
// What an operation is about to change, written before its first change to the working
// tree and removed after its commit. A killed process leaves it behind, and the next
// `openRepo` puts the tree back by it.

export interface Intent {
  operation: string;
  writer: Writer;
  /** Paths the operation changes that exist at HEAD. */
  existed: string[];
  /** Paths the operation creates. */
  created: string[];
  proposalId?: string;
  /** For an adopt: the file under `.git/` that holds the person's bytes as they were. */
  keptBytesFile?: string;
}

const intentPath = (repo: Repo) => join(repo.path, ".git", INTENT_FILE);

export function writeIntent(repo: Repo, intent: Intent): void {
  writeFileAtomic(intentPath(repo), JSON.stringify(intent));
}

export function readIntent(repo: Repo): Intent | null {
  let text: string;
  try {
    text = readFileSync(intentPath(repo), "utf8");
  } catch {
    return null;
  }
  try {
    const raw = JSON.parse(text) as Partial<Intent>;
    const texts = (value: unknown): value is string[] =>
      Array.isArray(value) && value.every((item) => typeof item === "string");
    if (typeof raw.operation !== "string" || !texts(raw.existed) || !texts(raw.created))
      return null;
    return raw as Intent;
  } catch {
    return null;
  }
}

export function clearIntent(repo: Repo): void {
  rmSync(intentPath(repo), { force: true });
}

const KEPT_NAME = /^wizardingcode-kept-[0-9a-f-]+\.json$/;

/** Keeps files' bytes under `.git/` for an adopt; returns the name the intent records. */
export function keepBytes(repo: Repo, files: Map<string, Uint8Array>): string {
  const name = `wizardingcode-kept-${randomUUID()}.json`;
  const kept: Record<string, string> = {};
  for (const [path, bytes] of files) kept[path] = Buffer.from(bytes).toString("base64");
  writeFileAtomic(join(repo.path, ".git", name), JSON.stringify(kept));
  return name;
}

/** Writes the kept bytes back, byte for byte, and forgets them. */
export function restoreKept(repo: Repo, name: string | undefined): void {
  if (name === undefined || !KEPT_NAME.test(name)) return;
  const file = join(repo.path, ".git", name);
  let kept: Record<string, string>;
  try {
    kept = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    return;
  }
  for (const [path, encoded] of Object.entries(kept)) {
    // The paths were written by the engine; a record edited by hand must not write elsewhere.
    if (path.split("/").some((part) => part === "" || part === "." || part === "..")) continue;
    const target = join(repo.path, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, Buffer.from(encoded, "base64"));
  }
  rmSync(file, { force: true });
}

export function dropKept(repo: Repo, name: string | undefined): void {
  if (name !== undefined && KEPT_NAME.test(name))
    rmSync(join(repo.path, ".git", name), { force: true });
}

/**
 * Puts the tree back after an operation that stopped before it finished. An engine write
 * is restored from HEAD; an adopt held the person's own uncommitted work, so its paths are
 * only unstaged and the kept bytes written back. An operation whose commit landed has
 * nothing to put back. Skipped while another process holds the repository's lease: that
 * operation is not interrupted, it is running.
 */
function revertInterrupted(store: KnowledgeStore, repo: Repo): void {
  const intent = readIntent(repo);
  if (intent === null) {
    // A record nobody can read names no paths; it cannot be acted on, only removed.
    if (existsSync(intentPath(repo)) && !leaseHeldElsewhere(store, repo)) clearIntent(repo);
    return;
  }
  const revert = () => {
    const paths = [...intent.existed, ...intent.created];
    if (intent.operation === "adopt") {
      if (paths.length > 0 && statusOf(store, repo, paths).length > 0) {
        unstage(store, repo, paths, "adopt");
        restoreKept(repo, intent.keptBytesFile);
      } else {
        dropKept(repo, intent.keptBytesFile);
      }
    } else {
      restoreToHead(store, repo, paths, intent.operation);
    }
    clearIntent(repo);
    logError(
      `knowledge.${intent.operation}`,
      new Error(`an interrupted ${intent.operation} in ${repo.path} was reverted`),
      store.dataDir,
    );
  };
  if (holds(store, repo.relative)) {
    revert();
    return;
  }
  try {
    withRepoLeases(store, [repo.relative], revert);
  } catch (error) {
    if (!(error instanceof KnowledgeError && error.code === "locked")) throw error;
  }
}

// --- The leases ---------------------------------------------------------------------

export function leaseKey(relative: string): string {
  return `${KNOWLEDGE_LEASE_PREFIX}${relative}`;
}

/** The repositories each store's running operation holds, so a nested step knows what it has. */
const held = new WeakMap<KnowledgeStore, Map<string, string>>();

const holds = (store: KnowledgeStore, relative: string) => held.get(store)?.has(relative) === true;

function leaseHeldElsewhere(store: KnowledgeStore, repo: Repo): boolean {
  if (holds(store, repo.relative)) return false;
  // Claiming and releasing tells a live owner from a stale row without reading the lease.
  const probe = `${process.pid}-${randomUUID()}`;
  const key = leaseKey(repo.relative);
  if (!claimLease(store.db, key, probe, store.now(), KNOWLEDGE_LEASE_MS)) return true;
  releaseLease(store.db, key, probe);
  return false;
}

/**
 * Runs `fn` holding the lease of each repository, claimed in the given order: the root
 * first, then each repository by path, so that no two operations hold part of the same
 * set. While `fn` runs, `store.renew` extends every lease held, and throws `locked` when
 * one was lost. A lease whose owner process is gone is taken over at once.
 */
export function withRepoLeases<T>(store: KnowledgeStore, relatives: string[], fn: () => T): T {
  const owner = `${process.pid}-${randomUUID()}`;
  const mine = held.get(store) ?? new Map<string, string>();
  held.set(store, mine);
  const locked = () =>
    new KnowledgeError("locked", "another write to this repository is in progress; try again");
  const claimed: string[] = [];
  const outer = store.renew;
  try {
    for (const relative of relatives) {
      if (mine.has(relative)) continue;
      if (!claimLease(store.db, leaseKey(relative), owner, store.now(), KNOWLEDGE_LEASE_MS)) {
        throw locked();
      }
      claimed.push(relative);
      mine.set(relative, owner);
    }
    store.renew = () => {
      outer?.();
      for (const relative of claimed) {
        if (!claimLease(store.db, leaseKey(relative), owner, store.now(), KNOWLEDGE_LEASE_MS)) {
          throw locked();
        }
      }
    };
    return fn();
  } finally {
    store.renew = outer;
    for (const relative of claimed) {
      mine.delete(relative);
      releaseLease(store.db, leaseKey(relative), owner);
    }
  }
}
