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
  type Dirent,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  type Stats,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { headOfGitDir } from "../../core/git.ts";
import { claimLease, KNOWLEDGE_LEASE_PREFIX, releaseLease } from "../../store/meta.ts";
import { writeFileAtomic } from "../../util/atomic-write.ts";
import { logError } from "../../util/log.ts";
import { clip } from "../../util/text.ts";
import { identityOf, personAuthor } from "./author.ts";
import { DEFAULT_AREAS, ENTRY_MAX_BYTES, nowIso, parseTaxonomy, renderTaxonomy } from "./entry.ts";
import { GitTimeoutError, KnowledgeError } from "./errors.ts";
import { projectAliasesOf, resolveRepo } from "./resolve.ts";
import type {
  GitHost,
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
/** What the store keeps in a repository's folder, and what each is when it is there. */
const OWN_LAYOUT: [name: string, kind: "folder" | "file"][] = [
  [".git", "folder"],
  [ENTRIES_DIR, "folder"],
  ["proposals", "folder"],
  [OPEN_DIR, "folder"],
  [DECIDED_DIR, "folder"],
  [MANIFEST_FILE, "file"],
  [TAXONOMY_FILE, "file"],
  [".gitignore", "file"],
];

// --- Where things are ---------------------------------------------------------------

export function knowledgeRoot(dataDir: string): string {
  return join(dataDir, "knowledge");
}

/**
 * The refusal for a look at the disk that failed, or null when the failure only says that
 * nothing is there. The error's code is named; the permissions are pointed at only when
 * the code says so.
 */
function unseen(path: string, error: unknown): KnowledgeError | null {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") return null;
  const hint =
    code === "EACCES" || code === "EPERM"
      ? "; check the permissions of that path and of the folders above it"
      : "";
  return new KnowledgeError(
    "invalid",
    `${path} cannot be looked at (${code})${hint}. The knowledge store never takes what it cannot see for gone`,
  );
}

/**
 * What `lstat` finds at a path itself, without following a link; null when nothing is
 * there. Only "not there" is nothing. Any other failure to look (a folder above that
 * cannot be searched, a disk fault) is a refusal that names its cause: what the store
 * could not see is never taken for gone.
 */
export function lookAt(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    const refusal = unseen(path, error);
    if (refusal === null) return null;
    throw refusal;
  }
}

/** What is at a path itself (`lookAt`): a folder, something else (a link, a file), or nothing. */
export function kindAt(path: string): "folder" | "other" | "absent" {
  const found = lookAt(path);
  if (found === null) return "absent";
  return found.isDirectory() ? "folder" : "other";
}

/** The names in a folder, none when it is not there; a folder that cannot be listed is a refusal. */
export function namesIn(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch (error) {
    const refusal = unseen(folder, error);
    if (refusal === null) return [];
    throw refusal;
  }
}

/**
 * Refuses a `knowledge/` or a `knowledge/projects/` that is not a folder itself, or that
 * cannot be looked at. Every repository is listed and created under these two: through a
 * link at either, a whole repository, with the person's name in it, would be made in
 * another folder. Checked before anything under them is listed or created.
 */
export function refuseLinkedRoots(dataDir: string): void {
  const root = knowledgeRoot(dataDir);
  for (const folder of [root, join(root, "projects")]) refuseLinkedRootsAt(folder);
}

/** The same refusal for one root: the received tree (`knowledge/received/`) asks it for its own. */
export function refuseLinkedRootsAt(folder: string): void {
  if (kindAt(folder) === "other") {
    throw new KnowledgeError(
      "invalid",
      `${folder} is not a folder of its own (a link, or a file); the knowledge store keeps its repositories under it and never follows a link out of the data directory. Remove it; to keep the knowledge on another disk, make the data directory itself a link`,
    );
  }
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

/**
 * Whether a folder is at the path itself: a link to a folder is not one. Any failure to
 * look reads as "no" here, unlike `kindAt`: it is used only inside a repository, behind
 * one of the refusals that ask with `kindAt`, `lookAt` or `namesIn`, and never to decide
 * whether a repository is there.
 */
function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Whether anything is at the path: a file, a folder, or a link, whatever the link points
 * at. Any failure to look reads as "no" here too, under the same limit as `isDirectory`.
 */
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
 * there), one whose knowledge folders or own files are links, one with a `.gitmodules`
 * file (the store keeps no repository inside its own), or one whose `.git` holds anything
 * but regular files and folders (one named socket aside: `refuseLinksInside`). Checked
 * before git is run and before anything is written, so nothing is read or written
 * outside the repository.
 */
export function refuseForeign(repoFolder: string): void {
  /** Whatever is at the path must be what the store keeps there: a folder, or a regular file. */
  const mustBe = (path: string, wanted: "folder" | "file"): void => {
    let found: ReturnType<typeof lstatSync>;
    try {
      found = lstatSync(path);
    } catch {
      return;
    }
    if (wanted === "folder" ? found.isDirectory() : found.isFile()) return;
    throw new KnowledgeError(
      "invalid",
      found.isSymbolicLink()
        ? `${path} is a link; the knowledge store never follows one out of its own repository`
        : `${path} is not a ${wanted === "folder" ? "folder" : "regular file"}, which is what the knowledge store keeps there`,
    );
  };
  if (!existsOnDisk(repoFolder)) return;
  mustBe(repoFolder, "folder");
  for (const [name, wanted] of OWN_LAYOUT) mustBe(join(repoFolder, ...name.split("/")), wanted);
  const modules = join(repoFolder, ".gitmodules");
  if (existsOnDisk(modules)) {
    throw new KnowledgeError(
      "invalid",
      `${modules} names repositories nested in this one, and the knowledge store keeps none; remove it`,
    );
  }
  refuseLinksInside(join(repoFolder, ".git"));
}

/**
 * The socket a person's own git leaves at the top of `.git` while its file monitor runs.
 * The store's git never uses it: every call passes `core.fsmonitor=false`.
 */
const FSMONITOR_SOCKET = "fsmonitor--daemon.ipc";

/**
 * Refuses a `.git` that holds anything but regular files and folders. git writes inside
 * it: its commit message and a line of its log in place, objects and branches into its
 * folders. Through a link there, git would write into another file, or commit into
 * another repository. Every entry is read with its kind, at every depth, except the files
 * inside the folders of `objects/`: git only reads those or replaces them whole, and
 * listing them on every open costs milliseconds that grow with the history. A folder that
 * cannot be listed is refused too: git goes through it by name all the same, so what it
 * holds would go unchecked. Only a folder that is not there has nothing to check. The
 * one thing let through that is neither a file nor a folder is `FSMONITOR_SOCKET`, at
 * the top of `.git`.
 */
function refuseLinksInside(gitDir: string): void {
  const objects = join(gitDir, "objects");
  const walk = (folder: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw new KnowledgeError(
        "invalid",
        `${folder} cannot be listed (${code}), so the knowledge store cannot check what git would write through`,
      );
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (folder !== objects) walk(path);
      } else if (entry.isFile()) continue;
      else if (folder === gitDir && entry.name === FSMONITOR_SOCKET && entry.isSocket()) continue;
      else {
        throw new KnowledgeError(
          "invalid",
          `${path} is ${entry.isSymbolicLink() ? "a link" : "not a regular file"}, and the knowledge store never lets git write through one; remove it`,
        );
      }
    }
  };
  walk(gitDir);
}

/**
 * Reads a regular file, never through a link: `lstat` first, then an open that refuses a
 * link as the second guard. Null when there is no file; a `KnowledgeError` for anything
 * that is not a regular file, or one over the cap.
 */
export function readRegularFile(path: string, max = ENTRY_MAX_BYTES): Uint8Array | null {
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
    if (size > max) {
      throw new KnowledgeError(
        "invalid",
        `${path} is over ${max / 1024} KiB, the cap for one file`,
      );
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
export { writeFileAtomic };

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
  /** The author of a commit, and its committer unless `committer` says otherwise. */
  identity?: Identity;
  /** The committer of a commit when it is not the author: the team server signing a member's revision. */
  committer?: Identity;
  /** The one lookup that may read the person's configuration: their global `user.name`. */
  allowUserConfig?: boolean;
  /** A call that changes nothing takes no index lock. */
  readOnly?: boolean;
  timeoutMs?: number;
}

export type { GitHost };

export function gitEnv(
  host: GitHost,
  options: Pick<GitOptions, "identity" | "committer" | "allowUserConfig" | "readOnly">,
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: host.env.PATH ?? "",
    GIT_TERMINAL_PROMPT: "0",
    // Git never looks for a repository above the host's root: the knowledge folder, or the mirror's.
    GIT_CEILING_DIRECTORIES: host.root ?? knowledgeRoot(host.dataDir),
    // A path is a path: a file a person named with `*` or `[` never matches another.
    GIT_LITERAL_PATHSPECS: "1",
  };
  if (options.allowUserConfig === true) {
    if (host.env.HOME !== undefined) env.HOME = host.env.HOME;
    if (host.env.XDG_CONFIG_HOME !== undefined) env.XDG_CONFIG_HOME = host.env.XDG_CONFIG_HOME;
  } else {
    env.GIT_CONFIG_GLOBAL = NO_CONFIG;
    env.GIT_CONFIG_NOSYSTEM = "1";
  }
  if (options.readOnly === true) env.GIT_OPTIONAL_LOCKS = "0";
  if (options.identity !== undefined) {
    const committer = options.committer ?? options.identity;
    env.GIT_AUTHOR_NAME = options.identity.name;
    env.GIT_AUTHOR_EMAIL = options.identity.email;
    env.GIT_COMMITTER_NAME = committer.name;
    env.GIT_COMMITTER_EMAIL = committer.email;
  }
  return env;
}

/**
 * git's own name for no configuration file: its documentation says to set the variable
 * to `/dev/null` to skip the file. Run on macOS; not run on Windows
 * (ADR 0024, known limits).
 */
const NO_CONFIG = "/dev/null";

/**
 * A `-c` value wins over the repository's own `.git/config`, so a local setting never runs
 * either. The store keeps no folder or file of its own for git to be pointed at: one that
 * sat beside the repositories could be filled by whoever can drop a file there.
 */
function configArgs(repo: string | null): string[] {
  const settings = [
    "commit.gpgsign=false",
    "core.autocrlf=false",
    "init.defaultBranch=main",
    "user.useConfigOnly=false",
    "core.fsmonitor=false",
    "core.untrackedCache=false",
    "core.pager=cat",
    "diff.external=",
    "core.sshCommand=",
    // A second layer under the flag `statusOf` passes. A `.gitmodules` setting overrides
    // these two, and only that flag wins over it.
    "diff.ignoreSubmodules=all",
    "submodule.recurse=false",
    // A new repository keeps the formats the store reads, whatever a later git defaults
    // to: other formats are written to `.git/config` as extensions, which are refused.
    "init.defaultObjectFormat=sha1",
    "init.defaultRefFormat=files",
    // No git command starts maintenance by itself: a commit would start it detached, and it
    // would still be writing under `.git/objects` after the call returned. `commitPaths`
    // runs it instead, and the two settings under the first keep that run, and an older
    // git's gc, in the foreground.
    "maintenance.auto=false",
    "maintenance.autoDetach=false",
    "gc.autoDetach=false",
  ];
  // Hooks are looked for inside the repository's own configuration file. Nothing can be
  // inside a file, so git finds no hook. Run on macOS; not run on Windows (ADR 0024, known
  // limits). A call with no repository yet (`init`, `--version`) runs none.
  if (repo !== null) settings.push(`core.hooksPath=${join(repo, ".git", "config")}`);
  return settings.flatMap((setting) => ["-c", setting]);
}

/**
 * Runs git, bounded by the timeout, with the environment of the store and nothing else.
 * `repoPath` null is for the calls that have no repository yet: `init`, `--version` and the
 * global `user.name` lookup. A failure is a `KnowledgeError` with code `git`, logged; the
 * exception is a global configuration lookup that finds no value, which git reports as exit 1.
 */
export function runGit(
  host: GitHost,
  repo: string | null,
  args: string[],
  options: GitOptions & { quiet?: boolean },
): { stdout: string; exitCode: number } {
  // A lease lost to another writer stops the operation before it touches the repository again.
  host.renew?.();
  const subcommand = args.find((arg) => !arg.startsWith("-")) ?? args[0] ?? "";
  const fail = (reason: string, timedOut = false): never => {
    const message = `git ${subcommand} in ${repo ?? host.dataDir} failed: ${clip(reason.trim(), STDERR_MAX)}`;
    const error = timedOut ? new GitTimeoutError(message) : new KnowledgeError("git", message);
    if (options.quiet !== true)
      logError(`${host.logScope ?? "knowledge"}.${options.operation}`, error, host.dataDir);
    throw error;
  };

  const git = Bun.which("git", { PATH: host.env.PATH ?? "" });
  if (git === null) return fail("git was not found on PATH");
  const location = repo === null ? [] : ["--git-dir", join(repo, ".git"), "--work-tree", repo];
  const timeout = options.timeoutMs ?? host.gitTimeoutMs;
  const cwd = repo ?? host.dataDir;
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    // The host's extra settings come after the runner's own, so the subcommand lookup above still holds.
    result = Bun.spawnSync(
      [git, ...location, ...configArgs(repo), ...(host.extraConfig ?? []), ...args],
      {
        ...(existsSync(cwd) ? { cwd } : {}),
        env: gitEnv(host, options),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout,
        killSignal: "SIGKILL",
      },
    );
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
/** Files under `.git/` that make git read from somewhere other than this repository. */
const REFUSED_FILES: [file: string, what: string][] = [
  ["commondir", "its configuration"],
  ["config.worktree", "its configuration"],
  ["objects/info/alternates", "objects"],
];
const ONLY_INIT = "a knowledge repository carries only the settings git init writes";

// The tokens of one configuration line, as git's parser takes them: white space, any
// number of section headers, then at most one key. git's white space is six characters:
// the five here, and the line feed the line split has already taken. A carriage return
// alone does not end a line.
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
 * so the one file read here is the one git reads. An `alternates` file, which has git
 * read objects from another repository on the disk, is refused with them.
 */
export function checkRepoConfig(repo: string): void {
  const gitDir = join(repo, ".git");
  const file = join(gitDir, "config");
  for (const [name, what] of REFUSED_FILES) {
    const path = join(gitDir, ...name.split("/"));
    if (existsOnDisk(path)) {
      throw new KnowledgeError(
        "invalid",
        `${path} makes git read ${what} from somewhere else, which the knowledge store never allows; remove it`,
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
          `line ${index + 1} of ${file} is not one the knowledge store reads the way git does, and ${ONLY_INIT}; remove the line`,
        );
      }
      if (!ALLOWED_SETTINGS.has(`${section.name}.${key.toLowerCase()}`)) {
        throw new KnowledgeError(
          "invalid",
          `the repository's own git configuration sets ${section.shown}.${key}, and ${ONLY_INIT}; remove it from ${file}`,
        );
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

const manifestText = (manifest: Manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

export function writeManifest(repo: string, manifest: Manifest): void {
  writeFileAtomic(join(repo, MANIFEST_FILE), manifestText(manifest));
}

/**
 * The taxonomy a repository's areas are checked against: its root's. Null when the root
 * repository does not exist yet, and when a link or a file is at the root's name: the
 * root is refused by name where it is opened, and its taxonomy is never read through the
 * link. A taxonomy file that cannot be read is refused: no area can be checked against
 * it until a person fixes it.
 */
export function taxonomyFor(store: KnowledgeStore, ref: ScopeRef): Taxonomy | null {
  const root = rootOf(ref);
  const folder = repoPath(store.dataDir, repoFolder(root));
  if (kindAt(folder) !== "folder") return null;
  const file = join(folder, TAXONOMY_FILE);
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
  mkdirSync(repo.path, { recursive: true, mode: 0o700 });
  if (!isDirectory(join(repo.path, ".git"))) {
    // An empty template name copies no template: no hook, no attributes, no configuration.
    runGit(store, null, ["init", "-q", "--template=", repo.path], { operation: "write" });
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
    const next: Manifest = { ...manifest, project: { aliases: [...known, ...gained] } };
    // A write like any other, under its record: one that stops midway is put back at the
    // next open, not left for `adopt`.
    commitChange(store, repo, {
      operation: "write",
      writer: personAuthor(store),
      write: [{ path: MANIFEST_FILE, text: manifestText(next) }],
      remove: [],
      existed: [MANIFEST_FILE],
      created: [],
      message: `knowledge: manifest learns ${gained.length === 1 ? "an alias" : `${gained.length} aliases`} of its project`,
    });
    clearIntent(repo);
  };
  // While another process holds the repository, the aliases wait for the next write.
  underOwnLease(store, repo, learn);
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
 * in place changes neither it nor HEAD, and is caught by the dirty checks. A folder that
 * cannot be listed counts as none here, and refuses nothing: the fingerprint then differs
 * from the indexed one, and the rebuild that follows is where the folder is refused
 * before a row is replaced (`listFolder` in `index-store.ts`).
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
  host: GitHost,
  repo: { path: string },
  paths: string[],
  operation: string,
): void {
  runGit(host, repo.path, ["add", "--", ...paths], { operation });
}

/** Stages the removal of files, also ones a person already deleted from the disk. */
export function removePaths(
  host: GitHost,
  repo: { path: string },
  paths: string[],
  operation: string,
): void {
  runGit(host, repo.path, ["rm", "-q", "--", ...paths], { operation });
}

/** Commits the given paths and nothing else that may be staged; the committer is the author unless given. */
export function commitPaths(
  host: GitHost,
  repo: { path: string },
  paths: string[],
  message: string,
  identity: Identity,
  operation: string,
  committer?: Identity,
): void {
  runGit(host, repo.path, ["commit", "-q", "--only", "-m", message, "--", ...paths], {
    operation,
    identity,
    ...(committer === undefined ? {} : { committer }),
  });
  maintain(host, repo.path, operation, identity, committer);
}

/**
 * git's own housekeeping, run by the runner after a commit and to its end: git decides by
 * its thresholds whether anything is due, and no process is left writing in the repository
 * when this returns. Nothing it throws is the commit's, which landed, so nothing it throws
 * changes what the caller does next:
 * - a git that fails or passes the timeout is a `KnowledgeError` that `runGit` has logged;
 * - a lease lost at the call's renewal is raised before git starts, so no git runs without
 *   the lease. The store's is a `KnowledgeError` (`locked`), dropped here. The mirror's is an
 *   error of its own class, logged here like any error of another kind. Either way the
 *   caller meets the loss at its own next git call, where it already handles it.
 */
function maintain(
  host: GitHost,
  repoPath: string,
  operation: string,
  identity: Identity,
  committer?: Identity,
): void {
  try {
    // The commit's identity too, though maintenance writes no commit: the two calls then run
    // in one environment, and what a test or a log sees of git's environment after a commit
    // is still the commit's.
    runGit(host, repoPath, ["maintenance", "run", "--auto", "--quiet"], {
      operation,
      identity,
      ...(committer === undefined ? {} : { committer }),
    });
  } catch (error) {
    if (error instanceof KnowledgeError) return;
    logError(`${host.logScope ?? "knowledge"}.${operation}`, error, host.dataDir);
  }
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
  const all = [...paths.existed, ...paths.created];
  const foreign = all.find((path) => !ownPath(path));
  if (foreign !== undefined) {
    throw new KnowledgeError("invalid", `${foreign} is not a path the knowledge store writes`);
  }
  const linked = all.find((path) => !reachedByFolders(repo.path, path));
  if (linked !== undefined) {
    throw new KnowledgeError(
      "invalid",
      `${linked} is reached through a link, and the knowledge store never follows one out of its own repository`,
    );
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
 * name: not a path that climbs out of the repository, and nothing under `.git`. This reads
 * the path's text only; `reachedByFolders` reads what is on the disk.
 */
function ownPath(path: string): boolean {
  if (path === MANIFEST_FILE || path === TAXONOMY_FILE) return true;
  const parts = path.split("/");
  if (parts.length < 2 || (parts[0] !== ENTRIES_DIR && parts[0] !== "proposals")) return false;
  return parts.every(
    (part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git",
  );
}

/**
 * Whether every folder on the way to a path, inside the repository, is a folder itself.
 * A link among them leads out of the repository, and what lies beyond it is not the
 * store's to read, write or remove, whatever the path says. A folder that is not there
 * leads nowhere.
 */
export function reachedByFolders(repoPath: string, path: string): boolean {
  let folder = repoPath;
  for (const part of path.split("/").slice(0, -1)) {
    folder = join(folder, part);
    if (existsOnDisk(folder) && !isDirectory(folder)) return false;
  }
  return true;
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
const INTENT_OPERATIONS = ["write", "accept", "reject", "adopt", "taxonomy", "apply"] as const;
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

/** What one operation changes in a repository, and how its commit reads. */
export interface Change {
  operation: IntentOperation;
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
  /** Who records the commit when it is not the author: the sync, for what it writes. */
  committer?: Identity;
}

/**
 * Writes, stages and commits only the given paths: the failure rule of every write the
 * engine makes of its own text. The intent record goes first and is left in place, for
 * the caller to remove once it has done what follows the commit. When anything fails,
 * every path is put back to what HEAD holds and the record is removed; when even that
 * fails, the record is left for the next open to act on. The error thrown is the first
 * one, whatever the undo did. `adopt` alone keeps a frame of its own: what it commits is
 * a person's work, which is given back byte for byte and never restored from HEAD.
 */
export function commitChange(store: KnowledgeStore, repo: Repo, change: Change): void {
  // What each path holds once the operation is done: how an interrupted one is told from
  // a file the person edited afterwards.
  const written: Record<string, string | null> = {};
  for (const file of change.write) written[file.path] = hashOf(Buffer.from(file.text));
  for (const path of change.remove) written[path] = null;
  writeIntent(repo, {
    operation: change.operation,
    writer: change.writer,
    existed: change.existed,
    created: change.created,
    written,
    ...(change.proposalId === undefined ? {} : { proposalId: change.proposalId }),
  });
  try {
    for (const file of change.write) {
      const target = join(repo.path, ...file.path.split("/"));
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileAtomic(target, file.text);
    }
    const staged = change.write.map((file) => file.path);
    stagePaths(store, repo, staged, change.operation);
    if (change.remove.length > 0) removePaths(store, repo, change.remove, change.operation);
    commitPaths(
      store,
      repo,
      [...staged, ...change.remove],
      change.message,
      identityOf(change.writer),
      change.operation,
      change.committer,
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

const KEPT_NAME = /^wizardingcode-kept-[0-9a-f-]+\.json$/;

/**
 * A record and a kept-bytes file are read as regular files, never through a link, and
 * whole: an adopt writes them as large as the files it adopts, so a cap on reading them
 * would lose what it kept.
 */
const NO_CAP = Number.POSITIVE_INFINITY;

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What is at the record's path: nothing, a record the store can act on, or one it cannot,
 * with the kept-bytes file it names when the name is one the store gives. The record sits
 * in a folder that may have been dropped here, so it is acted on only when it is one the
 * store could have written: a known operation, and no path but the store's own. A record
 * that names `.git/config` would otherwise have the revert write there.
 */
function readRecord(repo: Repo): { present: boolean; intent: Intent | null; kept?: string } {
  const file = intentPath(repo);
  if (!existsOnDisk(file)) return { present: false, intent: null };
  let raw: unknown;
  try {
    const bytes = readRegularFile(file, NO_CAP);
    raw = bytes === null ? null : JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { present: true, intent: null };
  }
  if (!isPlain(raw)) return { present: true, intent: null };
  const { operation, existed, created, written, keptBytesFile } = raw;
  const named = typeof keptBytesFile === "string" && KEPT_NAME.test(keptBytesFile);
  const kept = named ? { kept: keptBytesFile } : {};
  const rejected = { present: true, intent: null, ...kept };
  const ownPaths = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string" && ownPath(item));
  const operations: readonly unknown[] = INTENT_OPERATIONS;
  if (!operations.includes(operation)) return rejected;
  if (!ownPaths(existed) || !ownPaths(created)) return rejected;
  if (written !== undefined && !(isPlain(written) && ownPaths(Object.keys(written)))) {
    return rejected;
  }
  if (keptBytesFile !== undefined && !named) return rejected;
  return { present: true, intent: raw as unknown as Intent, ...kept };
}

/** The record an operation left, or null when there is none the store can act on. */
export function readIntent(repo: Repo): Intent | null {
  return readRecord(repo).intent;
}

/** Removes whatever is at the record's path, also a folder or a link someone left there. */
export function clearIntent(repo: Repo): void {
  rmSync(intentPath(repo), { force: true, recursive: true });
}

/** A new name for an adopt's kept bytes, under `.git/`. */
export function keptFileName(): string {
  return `wizardingcode-kept-${randomUUID()}.json`;
}

/** Keeps files' bytes under `.git/` for an adopt, under the name the intent records. */
export function keepBytes(
  repo: Repo,
  files: Map<string, Uint8Array>,
  name = keptFileName(),
): string {
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
    const bytes = readRegularFile(file, NO_CAP);
    kept = bytes === null ? null : JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return;
  }
  for (const [path, encoded] of Object.entries(isPlain(kept) ? kept : {})) {
    if (only !== undefined && !only.has(path)) continue;
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== ENTRIES_DIR || !ownPath(path)) continue;
    if (typeof encoded !== "string" || !reachedByFolders(repo.path, path)) continue;
    mkdirSync(join(repo.path, ENTRIES_DIR), { recursive: true, mode: 0o700 });
    writeFileAtomic(join(repo.path, ...parts), Buffer.from(encoded, "base64"));
  }
  rmSync(file, { force: true });
}

export function dropKept(repo: Repo, name: string | undefined): void {
  if (name !== undefined && KEPT_NAME.test(name))
    rmSync(join(repo.path, ".git", name), { force: true, recursive: true });
}

/** What is at a path now, as the intent record names it: a hash, null for nothing, or unknown. */
function stateOf(repo: Repo, path: string): string | null | undefined {
  // Beyond a link is another folder's file: never read as the engine's, so never put back.
  if (!reachedByFolders(repo.path, path)) return undefined;
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
  const record = readRecord(repo);
  if (!record.present) return;
  const intent = record.intent;
  if (intent === null) {
    // A record the store did not write names no path it may touch: it is removed, with
    // the kept bytes it names, nothing is put back, and the person is told.
    underOwnLease(store, repo, () => {
      dropKept(repo, record.kept);
      clearIntent(repo);
      report(
        store,
        "revert",
        `a record of an interrupted operation in ${repo.relative} was not one this version of the store writes; it was removed and nothing was put back`,
      );
    });
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
  underOwnLease(store, repo, revert);
}

// --- The leases ---------------------------------------------------------------------

export function leaseKey(relative: string): string {
  return `${KNOWLEDGE_LEASE_PREFIX}${relative}`;
}

/** The repositories each store's running operation holds, so a nested step knows what it has. */
const held = new WeakMap<KnowledgeStore, Map<string, string>>();

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

/**
 * Runs a step of `openRepo` under the repository's own lease, which the running operation
 * may hold already. While another process holds it the step is not run: that process is
 * working there, and the step waits for a later open. Only that refusal is let pass: a
 * `locked` raised once the step has started is a lease lost midway, and is thrown.
 */
function underOwnLease(store: KnowledgeStore, repo: Repo, step: () => void): void {
  let started = false;
  try {
    withRepoLeases(store, [repo.relative], () => {
      started = true;
      step();
    });
  } catch (error) {
    if (started || !(error instanceof KnowledgeError && error.code === "locked")) throw error;
  }
}
