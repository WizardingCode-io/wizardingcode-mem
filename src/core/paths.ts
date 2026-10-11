import { realpathSync } from "node:fs";
import { readGitInfo } from "./git.ts";

function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Project-relative paths with forward slashes. Files outside the project are not anchors. */
export function relativeTo(roots: string[], paths: string[]): string[] {
  const relative = new Set<string>();
  for (const path of paths) {
    const normalised = path.replaceAll("\\", "/");
    const root = roots.find((candidate) => normalised.startsWith(`${candidate}/`));
    if (root !== undefined) relative.add(normalised.slice(root.length + 1));
  }
  return [...relative];
}

const ROOTS_CACHE_MAX = 256;
const rootsCache = new Map<string, string[]>();

/** The directories a path is made relative to; cached, since a history drain and every file read ask. */
export function rootsOf(turnCwd: string): string[] {
  const cached = rootsCache.get(turnCwd);
  if (cached !== undefined) return cached;
  const cwd = realpath(turnCwd);
  const roots = [...new Set([readGitInfo(cwd)?.root ?? cwd, cwd, turnCwd])].map((root) =>
    root.replaceAll("\\", "/"),
  );
  if (rootsCache.size >= ROOTS_CACHE_MAX) rootsCache.clear();
  rootsCache.set(turnCwd, roots);
  return roots;
}
