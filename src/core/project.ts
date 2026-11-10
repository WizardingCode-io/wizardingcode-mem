import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { type Db, withWrite } from "../store/db.ts";
import { normalizeRemote, readGitInfo } from "./git.ts";

export interface ProjectRef {
  id: number;
  key: string;
  name: string;
  /** Working tree root, or the directory itself outside git. */
  root: string;
  branch: string | null;
  commit: string | null;
  disabled: boolean;
}

function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The names a working directory's project may be known by, strongest first. */
function identify(cwd: string) {
  const git = readGitInfo(cwd);
  const root = git?.root ?? realpath(cwd);
  const remote = git?.originUrl ? normalizeRemote(git.originUrl) : null;
  const remoteAlias = remote === null ? null : `remote:${remote}`;
  const aliases = [
    ...(remoteAlias === null ? [] : [remoteAlias]),
    ...(git === null ? [] : [`gitdir:${git.commonDir}`]),
    `path:${root}`,
  ];
  return { git, root, remote, remoteAlias, aliases };
}

/**
 * The `remote:` alias a working directory's repository gives its project, exactly as
 * `resolveProject` records it in `project_aliases`; null without a git remote. Never writes.
 */
export function remoteAliasOf(cwd: string): string | null {
  return identify(cwd).remoteAlias;
}

/** The project a working directory belongs to, if it is already known. Never writes. */
export function findProject(db: Db, cwd: string): ProjectRef | null {
  const { git, root, aliases } = identify(cwd);
  for (const alias of aliases) {
    const row = db
      .query<{ id: number; key: string; name: string; disabled: number }, [string]>(
        `SELECT p.id, p.key, p.name, p.disabled
           FROM project_aliases a JOIN projects p ON p.id = a.project_id WHERE a.alias = ?`,
      )
      .get(alias);
    if (row !== null) {
      return {
        id: row.id,
        key: row.key,
        name: row.name,
        root,
        branch: git?.branch ?? null,
        commit: git?.head ?? null,
        disabled: row.disabled === 1,
      };
    }
  }
  return null;
}

/**
 * Maps a working directory to a project, creating it on first sight.
 *
 * A project is known by several aliases, strongest first: its remote, its git
 * directory (shared by worktrees), its path. Any one of them finds it, and the others
 * are then recorded, so a project that gains a remote or is cloned again stays one
 * project. Forks have different remotes and are different projects.
 */
export function resolveProject(db: Db, cwd: string, now: number = Date.now()): ProjectRef {
  const { git, root, remote, remoteAlias, aliases } = identify(cwd);

  const owner = db.query<{ project_id: number }, [string]>(
    "SELECT project_id FROM project_aliases WHERE alias = ?",
  );
  const hasRemote = db.query<{ n: number }, [number]>(
    "SELECT count(*) AS n FROM project_aliases WHERE project_id = ? AND alias LIKE 'remote:%'",
  );

  /** Which project this is, and whether every alias already points at it. */
  const lookup = () => {
    const owners = aliases.map((alias) => ({ alias, id: owner.get(alias)?.project_id ?? null }));
    let id = owners.find((entry) => entry.alias === remoteAlias)?.id ?? null;
    if (id === null) {
      const local = owners.find((entry) => entry.alias !== remoteAlias && entry.id !== null);
      // A folder known under another remote now holds a different repository. Its
      // path must not carry the first repository's memories into this one.
      const reused =
        local !== undefined &&
        remoteAlias !== null &&
        (hasRemote.get(local.id as number)?.n ?? 0) > 0;
      id = local === undefined || reused ? null : local.id;
    }
    return { id, settled: id !== null && owners.every((entry) => entry.id === id) };
  };

  // Memories imported from another tool know their project only by its folder name.
  // The first directory seen with that name, and not yet a project of its own, is it.
  const adoptable = () => {
    for (const name of new Set([basename(root), basename(remote ?? root)])) {
      const id = owner.get(`imported:${name}`)?.project_id;
      if (id !== undefined) return id;
    }
    return null;
  };

  let { id, settled } = lookup();
  if (!settled) {
    id = withWrite(db, () => {
      // Looked up again under the write lock: another hook may have just created it.
      const projectId =
        lookup().id ??
        adoptable() ??
        (db
          .query<{ id: number }, [string, string, number]>(
            "INSERT INTO projects (key, name, created_at) VALUES (?, ?, ?) RETURNING id",
          )
          .get(aliases[0] as string, basename(remote ?? root), now)?.id as number);
      for (const alias of aliases) {
        // A remote names one project for good. A folder or git directory names
        // whichever project is in it now.
        db.run(
          alias === remoteAlias
            ? "INSERT OR IGNORE INTO project_aliases (alias, project_id) VALUES (?, ?)"
            : `INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)
               ON CONFLICT (alias) DO UPDATE SET project_id = excluded.project_id`,
          [alias, projectId],
        );
      }
      return projectId;
    });
  }
  if (id === null) throw new Error("project could not be resolved");

  const row = db
    .query<{ key: string; name: string; disabled: number }, [number]>(
      "SELECT key, name, disabled FROM projects WHERE id = ?",
    )
    .get(id);
  return {
    id,
    key: row?.key ?? (aliases[0] as string),
    name: row?.name ?? basename(root),
    root,
    branch: git?.branch ?? null,
    commit: git?.head ?? null,
    disabled: row?.disabled === 1,
  };
}
