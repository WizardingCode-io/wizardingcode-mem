import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { normalizeRemote } from "../core/git.ts";
import type { Db } from "../store/db.ts";
import { suggestLink } from "../store/links.ts";
import { logError } from "../util/log.ts";
import {
  type Manifest,
  nameStems,
  parseRemote,
  primaryManifest,
  readManifests,
  sharedStem,
} from "./signals.ts";

const MAX_WORKSPACE_MEMBERS = 30;

interface Known {
  id: number;
  name: string;
  root: string;
  remotes: string[];
  manifest: Manifest;
}

function load(db: Db, maxProjects: number): Known[] {
  const rows = db
    .query<{ id: number; name: string; alias: string }, [number]>(
      `SELECT p.id AS id, p.name AS name, a.alias AS alias
         FROM projects p JOIN project_aliases a ON a.project_id = p.id
        WHERE p.disabled = 0 AND a.alias LIKE 'path:%'
        ORDER BY p.id LIMIT ?`,
    )
    .all(maxProjects);
  const known = new Map<number, Known>();
  for (const row of rows) {
    const root = row.alias.slice("path:".length);
    if (known.has(row.id) || !existsSync(root)) continue;
    const remotes = db
      .query<{ alias: string }, [number]>(
        "SELECT alias FROM project_aliases WHERE project_id = ? AND alias LIKE 'remote:%'",
      )
      .all(row.id)
      .map((r) => r.alias.slice("remote:".length));
    known.set(row.id, { id: row.id, name: row.name, root, remotes, manifest: readManifests(root) });
  }
  return [...known.values()];
}

function ownerStems(owner: string): Set<string> {
  return new Set([owner, ...nameStems(owner)]);
}

const MAX_LEVELS = 6;

/**
 * Workspace roots: ancestors (never the home directory or above) whose declared workspaces cover at
 * least two known project roots. Each project belongs to its nearest such root. Manifests are
 * read once per directory.
 */
function workspaceGroups(projects: Known[], home: string): Map<string, Known[]> {
  const cache = new Map<string, string[]>();
  const globsOf = (dir: string) => {
    const known = cache.get(dir);
    if (known) return known;
    const globs = readManifests(dir).workspaces;
    cache.set(dir, globs);
    return globs;
  };
  const inside = (dir: string) => dir !== home && !home.startsWith(`${dir}/`) && dir !== "/";
  const covered = new Map<string, Known[]>();
  const nearest = new Map<number, string[]>();
  for (const p of projects) {
    const dirs: string[] = [];
    let dir = dirname(p.root);
    for (
      let i = 0;
      i < MAX_LEVELS && inside(dir) && dir !== dirname(dir);
      i++, dir = dirname(dir)
    ) {
      const globs = globsOf(dir);
      const rel = relative(dir, p.root);
      if (globs.some((g) => new Bun.Glob(g).match(rel))) {
        dirs.push(dir);
        covered.set(dir, [...(covered.get(dir) ?? []), p]);
      }
    }
    nearest.set(p.id, dirs);
  }
  const groups = new Map<string, Known[]>();
  for (const p of projects) {
    const root = (nearest.get(p.id) ?? []).find((d) => (covered.get(d)?.length ?? 0) >= 2);
    if (root) groups.set(root, [...(groups.get(root) ?? []), p]);
  }
  return groups;
}

/**
 * Proposes links from exact signals: a shared owner and name stem, a manifest that names another
 * project, one workspace. Only proposes; confirmed and rejected pairs are never touched.
 * Runs in the background drain, never on a hook path.
 */
export function suggestLinks(
  db: Db,
  options: { now: number; maxProjects?: number; home?: string },
): { suggested: number } {
  let suggested = 0;
  const projects = load(db, options.maxProjects ?? 200);
  const put = (a: number, b: number, kind: "product" | "uses", signals: string[]) => {
    if (suggestLink(db, a, b, kind, signals, options.now) !== null) suggested++;
  };

  // 1. Same owner and a shared name stem (not the owner's own name).
  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const a = projects[i] as Known;
      const b = projects[j] as Known;
      for (const ra of a.remotes) {
        const pa = parseRemote(ra);
        if (!pa) continue;
        let hit: string[] | null = null;
        for (const rb of b.remotes) {
          const pb = parseRemote(rb);
          if (!pb || pa.host !== pb.host || pa.owner !== pb.owner) continue;
          const stem = sharedStem(pa.name, pb.name, ownerStems(pa.owner));
          if (stem !== null) {
            hit = [`same owner ${pa.host}/${pa.owner}`, `shared name ${stem}`];
            break;
          }
        }
        if (hit) {
          put(a.id, b.id, "product", hit);
          break;
        }
      }
    }
  }

  // 2. A's manifest names B.
  for (const a of projects) {
    const file = primaryManifest(a.root) ?? "manifest";
    for (const b of projects) {
      if (a.id === b.id) continue;
      let signal: string | null = null;
      if (b.manifest.packageName && a.manifest.deps.includes(b.manifest.packageName)) {
        signal = `${file} depends on ${b.manifest.packageName}`;
      } else {
        const local = a.manifest.localPaths.find((p) => resolve(a.root, p) === b.root);
        if (local) signal = `${file} depends on ${local}`;
        else {
          const git = a.manifest.gitUrls.find((url) =>
            b.remotes.includes(normalizeRemote(url.replace(/^git\+/, ""))),
          );
          if (git) signal = `${file} depends on ${git}`;
        }
      }
      if (signal) put(a.id, b.id, "uses", [signal]);
    }
  }

  // 3. One workspace.
  const byWorkspace = workspaceGroups(projects, options.home ?? homedir());
  for (const [root, members] of byWorkspace) {
    const some = members.slice(0, MAX_WORKSPACE_MEMBERS);
    for (let i = 0; i < some.length; i++) {
      for (let j = i + 1; j < some.length; j++) {
        put((some[i] as Known).id, (some[j] as Known).id, "product", [`one workspace ${root}`]);
      }
    }
  }
  return { suggested };
}

/** Never throws: a failure here must not change the drain's outcome. */
export function suggestLinksSafely(db: Db, now: number): number {
  try {
    return suggestLinks(db, { now }).suggested;
  } catch (error) {
    logError("links.suggest", error);
    return 0;
  }
}
