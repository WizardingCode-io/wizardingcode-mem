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
import { GitTimeoutError, KnowledgeError } from "./errors.ts";
import { projectAliasesOf, resolveRepo } from "./resolve.ts";
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

/** Whether a folder is at the path itself: a link to a folder is not one. */
export function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Whether anything is at the path: a file, a folder, or a link, whatever the link points at. */
export function existsOnDisk(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuses a folder the store did not make: one that is a link, one whose `.git` is a file
 * or a link (a gitfile names another repository, and every later commit would land
 * there), one whose knowledge folders or own files are links, or one with a `.gitmodules`
 * file (the store keeps no repository inside its own). Checked before git is run and
 * before anything is written, so nothing is read or written outside the repository.
 */
export function refuseForeign(repoFolder: string): void {
  const refuse = (path: string, what: string): never => {
    throw new KnowledgeError(
      "invalid",
      `${path} is ${what}; the knowledge store never follows one out of its own repository`,
    );
  };
  const kind = (path: string) => {
    try {
      return lstatSync(path);
    } catch {
      return null;
    }
  };
  const folder = kind(repoFolder);
  if (folder === null) return;
  if (!folder.isDirectory())
    refuse(repoFolder, folder.isSymbolicLink() ? "a link" : "not a folder");
  const git = kind(join(repoFolder, ".git"));
  if (git !== null && !git.isDirectory()) {
    refuse(join(repoFolder, ".git"), git.isSymbolicLink() ? "a link" : "a file, not a folder");
  }
  for (const inner of [ENTRIES_DIR, "proposals", OPEN_DIR, DECIDED_DIR]) {
    const path = join(repoFolder, ...inner.split("/"));
    const found = kind(path);
    if (found !== null && !found.isDirectory()) {
      refuse(path, found.isSymbolicLink() ? "a link" : "not a folder");
    }
  }
  for (const name of [MANIFEST_FILE, TAXONOMY_FILE, ".gitignore"]) {
    const path = join(repoFolder, name);
    const found = kind(path);
    if (found !== null && !found.isFile()) {
      refuse(path, found.isSymbolicLink() ? "a link" : "not a regular file");
    }
  }
  const modules = join(repoFolder, ".gitmodules");
  if (kind(modules) !== null) {
    throw new KnowledgeError(
      "invalid",
      `${modules} names repositories nested in this one, and the knowledge store keeps none; remove it`,
    );
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

/**
 * Writes beside the target and renames over it, so a reader never sees half a file. The
 * temporary file is created new: a name that already exists, a link included, is removed
 * first and never written through.
 */
export function writeFileAtomic(path: string, content: string | Uint8Array): void {
  const temp = join(dirname(path), `.${path.slice(dirname(path).length + 1)}.tmp`);
  rmSync(temp, { force: true });
  try {
    writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

/** The SHA-256 of a file's bytes, first 16 hex: how the index and the intent record name a content. */
export function hashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
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
    // A path is a path: a file a person named with `*` or `[` never matches another.
    GIT_LITERAL_PATHSPECS: "1",
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
    // git never looks into a repository nested in this one.
    "diff.ignoreSubmodules=all",
    "submodule.recurse=false",
    // A new repository keeps the formats the store reads, whatever a later git defaults
    // to: other formats are written to `.git/config` as extensions, which are refused.
    "init.defaultObjectFormat=sha1",
    "init.defaultRefFormat=files",
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
  const fail = (reason: string, timedOut = false): never => {
    const message = `git ${subcommand} in ${repo ?? store.dataDir} failed: ${clip(reason.trim(), STDERR_MAX)}`;
    const error = timedOut ? new GitTimeoutError(message) : new KnowledgeError("git", message);
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
  if (result.exitedDueToTimeout === true) return fail(`timed out after ${timeout} ms`, true);
  if (result.exitCode !== 0) {
    const lookup = args[0] === "config" && args.includes("--global");
    if (lookup && result.exitCode === 1) return { stdout: "", exitCode: 1 };
    return fail(result.stderr?.toString() || `exit ${result.exitCode ?? result.signalCode}`);
  }
  return { stdout: result.stdout?.toString() ?? "", exitCode: 0 };
}

/** Whether a git version is older than the one knowledge needs. The one place that rule lives. */
export function gitTooOld(found: number[]): boolean {
  for (let i = 0; i < GIT_MIN_VERSION.length; i++) {
    const a = found[i] ?? 0;
    const b = GIT_MIN_VERSION[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

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
    if (error instanceof GitTimeoutError) throw error;
  }
  if (found === null || gitTooOld(found)) {
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

/**
 * The settings `git init` writes into a new repository, in git's own lower case. A
 * knowledge repository's configuration may carry these and no other: a list of what is
 * refused would have to name every setting that runs a program or reads another file.
 */
const ALLOWED_SETTINGS = new Set([
  "core.repositoryformatversion",
  "core.filemode",
  "core.bare",
  "core.logallrefupdates",
  "core.ignorecase",
  "core.precomposeunicode",
  "core.symlinks",
]);
/** Files under `.git/` that make git read a configuration other than `.git/config`. */
const REFUSED_FILES = ["commondir", "config.worktree"];

// The tokens of one configuration line, as git's parser takes them: white space, any
// number of section headers, then at most one key. git's white space is these six
// characters; a carriage return alone does not end a line.
const CONFIG_SPACE = /^[ \t\v\f\r]+/;
const CONFIG_HEADER = /^\[([A-Za-z0-9.-]+)(?:[ \t\v\f\r]+"((?:[^"\\]|\\.)*)")?\]/;
const CONFIG_KEY = /^([A-Za-z][A-Za-z0-9-]*)[ \t]*(?:=|$)/;
/** How much of a subsection's name a refusal shows. */
const SHOWN_MAX = 40;

/**
 * Refuses a repository whose own configuration holds anything but the settings `git
 * init` writes, before git is run in it. A folder a person or a later sync dropped under
 * `knowledge/` could carry a configuration that runs a program: a filter runs on add or
 * restore. Read as text, with no process, every line by git's own grammar: a line the
 * store cannot read that way is refused, never skipped. git reads a repository's
 * configuration from `.git/config`, from the directory a `commondir` file names, and from
 * `config.worktree` when the worktree extension is on: the last two are refused outright,
 * so the one file read here is the one git reads.
 */
export function checkRepoConfig(repo: string): void {
  const gitDir = join(repo, ".git");
  const file = join(gitDir, "config");
  const refuse = (name: string): never => {
    throw new KnowledgeError(
      "invalid",
      `the repository's own git configuration sets ${name}, and a knowledge repository carries only the settings git init writes; remove it from ${file}`,
    );
  };
  for (const name of REFUSED_FILES) {
    if (existsOnDisk(join(gitDir, name))) {
      throw new KnowledgeError(
        "invalid",
        `${join(gitDir, name)} makes git read its configuration from somewhere else, which the knowledge store never allows; remove it`,
      );
    }
  }
  // A regular file within the cap, or the repository is refused: git would follow a link
  // to another file, and no configuration `git init` writes is that large.
  const bytes = readRegularFile(file);
  if (bytes === null) return;
  // The decoder drops a leading byte order mark, as git does.
  const text = new TextDecoder().decode(bytes);
  // The section the next key belongs to: its name as git compares it, and as it is shown.
  let section: { name: string; shown: string } | null = null;
  // Every physical line is read, also one that continues the value before it: git reads
  // fewer lines as settings than this does, never more.
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    let rest = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    for (;;) {
      rest = rest.replace(CONFIG_SPACE, "");
      if (rest === "" || rest.startsWith("#") || rest.startsWith(";")) break;
      const header = CONFIG_HEADER.exec(rest);
      if (header !== null) {
        const base = header[1] as string;
        const subsection = header[2];
        section =
          subsection === undefined
            ? { name: base.toLowerCase(), shown: base }
            : {
                name: `${base.toLowerCase()}.${subsection}`,
                // A subsection is any text: shown without what a terminal would act on.
                shown: `${base}.${subsection.replace(/[^\x20-\x7e]/g, "?").slice(0, SHOWN_MAX)}`,
              };
        rest = rest.slice(header[0].length);
        continue;
      }
      const key = CONFIG_KEY.exec(rest)?.[1];
      if (key === undefined || section === null) {
        throw new KnowledgeError(
          "invalid",
          `line ${index + 1} of ${file} is not one the knowledge store reads the way git does, and a knowledge repository carries only the settings git init writes; remove the line`,
        );
      }
      if (!ALLOWED_SETTINGS.has(`${section.name}.${key.toLowerCase()}`)) {
        refuse(`${section.shown}.${key}`);
      }
      // The rest of the line is the key's value.
      break;
    }
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
  // The manifest is already there: `resolveRepo` writes it with the folder.
  const paths = [MANIFEST_FILE, ".gitignore"];
  // Written beside the name and renamed over it: never through a link left at the name.
  writeFileAtomic(join(repo.path, ".gitignore"), `${GITIGNORE.join("\n")}\n`);
  if (repo.ref.scope !== "project") {
    paths.push(TAXONOMY_FILE);
    if (!existsOnDisk(join(repo.path, TAXONOMY_FILE))) {
      const taxonomy = {
        version: 1,
        updated: nowIso(store.now()),
        areas: DEFAULT_AREAS.map((area) => ({ ...area })),
      };
      writeFileAtomic(join(repo.path, TAXONOMY_FILE), renderTaxonomy(taxonomy));
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
 * A project's manifest learns the aliases the project has gained (a remote added to a
 * repository that had none), in a commit of `knowledge.json` alone by the person: the
 * engine's own change is never left for `adopt` to credit to someone. Only on a write
 * path, and under the repository's own lease. A manifest a person is editing is left to
 * them.
 */
function learnAliases(store: KnowledgeStore, repo: Repo): void {
  if (repo.ref.scope !== "project") return;
  const projectId = repo.ref.projectId;
  const unlearned = () => {
    const manifest = readManifest(repo.path);
    const aliases = projectAliasesOf(store, projectId);
    if (manifest === null || aliases === null) return null;
    const known = manifest.project?.aliases ?? [];
    const gained = aliases.filter((alias) => !known.includes(alias));
    return gained.length === 0 ? null : { manifest, known, gained };
  };
  // Most opens have nothing to learn, and take no lease to find that out.
  if (unlearned() === null) return;
  const learn = () => {
    // Read again under the lease: another process may have learned them meanwhile.
    const found = unlearned();
    if (found === null || statusOf(store, repo, [MANIFEST_FILE]).length > 0) return;
    const { manifest, known, gained } = found;
    writeManifest(repo.path, { ...manifest, project: { aliases: [...known, ...gained] } });
    try {
      stagePaths(store, repo, [MANIFEST_FILE], "write");
      commitPaths(
        store,
        repo,
        [MANIFEST_FILE],
        `knowledge: manifest learns ${gained.length === 1 ? "an alias" : `${gained.length} aliases`} of its project`,
        identityOf(personAuthor(store)),
        "write",
      );
    } catch (error) {
      undoStaged(store, repo, { existed: [MANIFEST_FILE], created: [] }, "write");
      throw error;
    }
  };
  if (holds(store, repo.relative)) {
    learn();
    return;
  }
  // The commit is made under the repository's own lease. While another process holds
  // it, the aliases wait for the next write.
  try {
    withRepoLeases(store, [repo.relative], learn);
  } catch (error) {
    if (!(error instanceof KnowledgeError && error.code === "locked")) throw error;
  }
}

/**
 * The one way an operation obtains a repository. Null when the repository does not exist
 * and `create` was not given. Refuses a folder the store did not make and a repository
 * whose own git configuration could run a program, before git runs in it and before
 * anything is written there; then puts back what an interrupted operation left.
 */
export function openRepo(
  store: KnowledgeStore,
  ref: ScopeRef,
  options: { create?: Writer } = {},
): Repo | null {
  // Found first without writing, so that a folder the store did not make is refused
  // before a manifest is written into it.
  const found = resolveRepo(store, ref, {});
  if (found !== null) refuseForeign(found.path);
  const repo =
    options.create === undefined ? found : resolveRepo(store, ref, { create: options.create });
  if (repo === null) return null;
  // A folder with no repository in it, or a creation that stopped before its first commit.
  if (headOf(repo.path) === null) {
    if (options.create === undefined) return null;
    if (isDirectory(join(repo.path, ".git"))) checkRepoConfig(repo.path);
    createRepository(store, repo);
  }
  checkRepoConfig(repo.path);
  revertInterrupted(store, repo);
  if (options.create !== undefined) learnAliases(store, repo);
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

/**
 * The porcelain lines of the given paths (the whole repository when none): `XY path`.
 * A repository nested in this one is never looked into: without the flag, git runs a
 * second `git status` inside it, under that repository's own configuration, which the
 * store never checked. The flag given here wins over any setting, a `.gitmodules` one too.
 */
export function statusOf(store: KnowledgeStore, repo: Repo, paths: string[]): string[] {
  const answer = runGit(
    store,
    repo.path,
    [
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
      "--no-renames",
      "--ignore-submodules=all",
      "--",
      ...paths,
    ],
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
  const foreign = [...paths.existed, ...paths.created].find((path) => !ownPath(path));
  if (foreign !== undefined) {
    throw new KnowledgeError("invalid", `${foreign} is not a path the knowledge store writes`);
  }
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

/**
 * Whether a path is one the store writes or adopts: the manifest, the taxonomy, or a file
 * under `entries/` or `proposals/`. Nothing else is restored, removed or written back by
 * name: not a path that climbs out of the repository, and nothing under `.git`.
 */
export function ownPath(path: string): boolean {
  if (path === MANIFEST_FILE || path === TAXONOMY_FILE) return true;
  const parts = path.split("/");
  if (parts.length < 2 || (parts[0] !== ENTRIES_DIR && parts[0] !== "proposals")) return false;
  return parts.every(
    (part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git",
  );
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

/** The operations that leave a record. A record of any other is not read. */
export const INTENT_OPERATIONS = ["write", "accept", "reject", "adopt", "taxonomy"] as const;
export type IntentOperation = (typeof INTENT_OPERATIONS)[number];

export interface Intent {
  operation: IntentOperation;
  writer: Writer;
  /** Paths the operation changes that exist at HEAD. */
  existed: string[];
  /** Paths the operation creates. */
  created: string[];
  /**
   * What the operation leaves at each path: the hash of the file it writes, or null for a
   * path it removes. The revert acts on a path only while this is still what is there: a
   * file the person edited after the interruption is theirs and is never touched.
   */
  written?: Record<string, string | null>;
  proposalId?: string;
  /** For an adopt: the file under `.git/` that holds the person's bytes as they were. */
  keptBytesFile?: string;
}

const intentPath = (repo: Repo) => join(repo.path, ".git", INTENT_FILE);

export function writeIntent(repo: Repo, intent: Intent): void {
  writeFileAtomic(intentPath(repo), JSON.stringify(intent));
}

const KEPT_NAME = /^wizardingcode-kept-[0-9a-f-]+\.json$/;

/**
 * The record an operation left, or null when there is none the store can act on. The
 * record sits in a folder that may have been dropped here, so it is taken only when it is
 * one the store could have written: a known operation, and no path but the store's own.
 * A record that names `.git/config` would otherwise have the revert write there.
 */
export function readIntent(repo: Repo): Intent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(intentPath(repo), "utf8"));
  } catch {
    return null;
  }
  const plain = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const ownPaths = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string" && ownPath(item));
  if (!plain(raw)) return null;
  const { operation, existed, created, written, keptBytesFile } = raw;
  const operations: readonly unknown[] = INTENT_OPERATIONS;
  if (!operations.includes(operation)) return null;
  if (!ownPaths(existed) || !ownPaths(created)) return null;
  if (written !== undefined && !(plain(written) && ownPaths(Object.keys(written)))) return null;
  if (keptBytesFile !== undefined) {
    if (typeof keptBytesFile !== "string" || !KEPT_NAME.test(keptBytesFile)) return null;
  }
  return raw as unknown as Intent;
}

export function clearIntent(repo: Repo): void {
  rmSync(intentPath(repo), { force: true });
}

/** Keeps files' bytes under `.git/` for an adopt; returns the name the intent records. */
export function keepBytes(repo: Repo, files: Map<string, Uint8Array>): string {
  const name = `wizardingcode-kept-${randomUUID()}.json`;
  const kept: Record<string, string> = {};
  for (const [path, bytes] of files) kept[path] = Buffer.from(bytes).toString("base64");
  writeFileAtomic(join(repo.path, ".git", name), JSON.stringify(kept));
  return name;
}

/**
 * Writes the kept bytes back, byte for byte, and forgets them. With `only`, just those
 * paths: the ones the person did not go on working on. Only entry files are ever kept,
 * so only a file directly under `entries/` is written: a kept file put there by hand
 * writes nowhere else.
 */
export function restoreKept(repo: Repo, name: string | undefined, only?: Set<string>): void {
  if (name === undefined || !KEPT_NAME.test(name)) return;
  const file = join(repo.path, ".git", name);
  let kept: unknown;
  try {
    kept = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return;
  }
  for (const [path, encoded] of Object.entries((kept ?? {}) as Record<string, unknown>)) {
    if (only !== undefined && !only.has(path)) continue;
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== ENTRIES_DIR || !ownPath(path)) continue;
    if (typeof encoded !== "string") continue;
    mkdirSync(join(repo.path, ENTRIES_DIR), { recursive: true, mode: 0o700 });
    writeFileAtomic(join(repo.path, ...parts), Buffer.from(encoded, "base64"));
  }
  rmSync(file, { force: true });
}

export function dropKept(repo: Repo, name: string | undefined): void {
  if (name !== undefined && KEPT_NAME.test(name))
    rmSync(join(repo.path, ".git", name), { force: true });
}

/** What is at a path now, as the intent record names it: a hash, null for nothing, or unknown. */
function stateOf(repo: Repo, path: string): string | null | undefined {
  try {
    const bytes = readRegularFile(join(repo.path, ...path.split("/")));
    return bytes === null ? null : hashOf(bytes);
  } catch {
    // A link, a folder or a file over the cap: not what the engine left.
    return undefined;
  }
}

/** Tells the person, where the caller gave a way to, and always the log. */
function report(store: KnowledgeStore, operation: string, message: string): void {
  store.report?.(message);
  logError(`knowledge.${operation}`, new Error(message), store.dataDir);
}

/**
 * Puts the tree back after an operation that stopped before it finished, and says so.
 *
 * Each path is judged by itself. One that is clean against HEAD needs nothing: its commit
 * landed, or the operation never reached it. Of the others, only a path that is still as
 * the engine left it is put back: an engine write is restored from HEAD, and an adopt,
 * which held the person's own uncommitted work, gets the bytes it kept. A path that is
 * not as the engine left it may be the person's work: it is only taken out of the index
 * and left for `adopt`. A record that does not say what was written puts nothing back.
 * Skipped while another process holds the repository's lease: that operation is not
 * interrupted, it is running.
 */
function revertInterrupted(store: KnowledgeStore, repo: Repo): void {
  const intent = readIntent(repo);
  if (intent === null) {
    // A record nobody can read names no paths; it cannot be acted on, only removed.
    if (existsSync(intentPath(repo)) && !leaseHeldElsewhere(store, repo)) clearIntent(repo);
    return;
  }
  const revert = () => {
    const paths = [...new Set([...intent.existed, ...intent.created])];
    const operation = intent.operation;
    const changed =
      paths.length === 0
        ? new Set<string>()
        : new Set(statusOf(store, repo, paths).map((line) => line.slice(3)));
    const pending = paths.filter((path) => changed.has(path));
    if (pending.length === 0) {
      dropKept(repo, intent.keptBytesFile);
      clearIntent(repo);
      return;
    }
    const asLeft = pending.filter((path) => {
      const written = intent.written?.[path];
      return written !== undefined && stateOf(repo, path) === written;
    });
    const others = pending.filter((path) => !asLeft.includes(path));
    if (operation === "adopt") {
      // The person's own work: taken out of the index, never restored from HEAD.
      unstage(store, repo, pending, operation);
      restoreKept(repo, intent.keptBytesFile, new Set(asLeft));
      dropKept(repo, intent.keptBytesFile);
    } else {
      if (asLeft.length > 0) restoreToHead(store, repo, asLeft, operation);
      if (others.length > 0) unstage(store, repo, others, operation);
    }
    clearIntent(repo);
    if (asLeft.length > 0) {
      report(
        store,
        operation,
        `an interrupted ${operation} in ${repo.relative} was undone: ${asLeft.join(", ")}`,
      );
    }
    if (others.length > 0) {
      report(
        store,
        operation,
        `an interrupted ${operation} in ${repo.relative} left these as they are now, since the store cannot tell them from a person's own work: ${others.join(", ")}; run wizardingcode-mem knowledge adopt to commit them`,
      );
    }
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
