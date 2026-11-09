import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface GitInfo {
  /** The working tree: the directory that holds `.git`. */
  root: string;
  /** The repository's own directory, shared by all of its worktrees. */
  commonDir: string;
  branch: string | null;
  /** Commit the working tree is on; null before the first commit. */
  head: string | null;
  originUrl: string | null;
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const SHA = /^[0-9a-f]{40,64}$/;

function resolveRef(gitDir: string, commonDir: string, ref: string): string | null {
  for (const dir of new Set([gitDir, commonDir])) {
    const loose = read(join(dir, ref))?.trim();
    if (loose !== undefined && SHA.test(loose)) return loose;
  }
  for (const line of read(join(commonDir, "packed-refs"))?.split("\n") ?? []) {
    const [sha, name] = line.trim().split(" ");
    if (name === ref && sha !== undefined && SHA.test(sha)) return sha;
  }
  return null;
}

/**
 * The commit a git directory's HEAD is on, read from that directory alone: it never walks
 * up to a parent repository. Null before the first commit, or when this is no git directory.
 */
export function headOfGitDir(gitDir: string): string | null {
  const head = read(join(gitDir, "HEAD"))?.trim() ?? "";
  const ref = head.match(/^ref:\s*(.+)$/)?.[1];
  if (ref === undefined) return SHA.test(head) ? head : null;
  // A ref is a name under `refs/`. Anything else in HEAD (a path that climbs out of the
  // git directory, an absolute path) is not followed: it would read another file.
  const parts = ref.split("/");
  if (parts[0] !== "refs" || parts.some((part) => part === "" || part === "." || part === "..")) {
    return null;
  }
  return resolveRef(gitDir, gitDir, ref);
}

function originUrl(commonDir: string): string | null {
  let inOrigin = false;
  for (const raw of read(join(commonDir, "config"))?.split("\n") ?? []) {
    const line = raw.trim();
    const section = line.match(/^\[(.+)\]$/)?.[1];
    if (section !== undefined) {
      inOrigin = /^remote\s+"origin"$/.test(section.trim());
    } else if (inOrigin) {
      const url = line.match(/^url\s*=\s*(.+)$/)?.[1];
      if (url !== undefined) return url.trim();
    }
  }
  return null;
}

/**
 * Reads repository state straight from `.git`. Hooks run on every prompt, so this
 * never starts a `git` process.
 */
export function readGitInfo(cwd: string): GitInfo | null {
  let dir = realpath(cwd);
  let dotGit = join(dir, ".git");
  while (!existsSync(dotGit)) {
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
    dotGit = join(dir, ".git");
  }

  let gitDir = dotGit;
  if (!isDirectory(dotGit)) {
    // A worktree or submodule: `.git` is a file that points at the real directory.
    const pointer = read(dotGit)
      ?.match(/^gitdir:\s*(.+)$/m)?.[1]
      ?.trim();
    if (pointer === undefined) return null;
    gitDir = resolve(dir, pointer);
  }
  const common = read(join(gitDir, "commondir"))?.trim();
  const commonDir = realpath(common === undefined ? gitDir : resolve(gitDir, common));

  const head = read(join(gitDir, "HEAD"))?.trim() ?? "";
  const ref = head.match(/^ref:\s*(.+)$/)?.[1];
  return {
    root: dir,
    commonDir,
    branch: ref?.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null,
    head: ref === undefined ? (SHA.test(head) ? head : null) : resolveRef(gitDir, commonDir, ref),
    originUrl: originUrl(commonDir),
  };
}

/**
 * Reduces a remote URL to `host/path`: no scheme, credentials, port or `.git`.
 * The same repository reached over HTTPS and over SSH yields the same string.
 */
export function normalizeRemote(url: string): string {
  const trimmed = url.trim();
  const clean = (path: string) => path.replace(/\/+$/, "").replace(/\.git$/i, "");

  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme !== null) {
    const rest = trimmed.slice(scheme[0].length);
    if (scheme[1]?.toLowerCase() === "file") return clean(rest);
    const slash = rest.indexOf("/");
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    const host = authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d+$/, "");
    return `${host}/${clean(slash === -1 ? "" : rest.slice(slash + 1))}`.toLowerCase();
  }

  // scp-like `user@host:path`. A drive letter (`C:\repo`) is a local path, not a host.
  const scp = trimmed.match(/^(?:[^@/\s]+@)?([^:/\s]{2,}):(.+)$/);
  if (scp !== null && !trimmed.startsWith("/")) {
    return `${scp[1]}/${clean(scp[2] ?? "")}`.toLowerCase();
  }
  return clean(trimmed);
}
