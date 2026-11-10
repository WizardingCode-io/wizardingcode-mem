// `serve status`: what an operator reads about a team server from its data directory, with
// or without the server running, through a read-only connection.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { headOf } from "../modules/knowledge/repo.ts";
import { openTeamExisting, teamPaths } from "./db.ts";
import { freeBytes } from "./disk.ts";
import { type Marks, readHighWater } from "./instance.ts";
import { SERVE_LEASE } from "./lease.ts";
import {
  deviceCounts,
  getMeta,
  leaseOf,
  memberCounts,
  pendingBootstrapInvitation,
  pendingMirrorCount,
  sequenceHighWater,
  teamSchemaVersion,
} from "./store.ts";

export interface MirrorLast {
  at: number;
  commits: number;
  error: string | null;
}

export interface TeamStatus {
  version: string;
  schema: number;
  serverId: string;
  instance: string;
  members: { active: number; disabled: number };
  devices: { active: number; revoked: number };
  pendingBootstrap: boolean;
  lastSeq: number;
  marks: Marks;
  mirror: { last: MirrorLast | null; pending: number };
  heads: { folder: string; head: string | null }[];
  freeBytes: number | null;
  lease: { owner: string; until: number } | null;
}

/** The repositories under `repos/` and their heads: `shared`, then the projects, then the members. */
function repoHeads(root: string): TeamStatus["heads"] {
  const heads: TeamStatus["heads"] = [];
  if (existsSync(join(root, "shared")))
    heads.push({ folder: "shared", head: headOf(join(root, "shared")) });
  for (const parent of ["projects", "members"]) {
    const folder = join(root, parent);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      heads.push({ folder: `${parent}/${name}`, head: headOf(path) });
    }
  }
  return heads;
}

function mirrorLast(raw: string | null): MirrorLast | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MirrorLast>;
    return typeof parsed.at === "number" && typeof parsed.commits === "number"
      ? {
          at: parsed.at,
          commits: parsed.commits,
          error: typeof parsed.error === "string" ? parsed.error : null,
        }
      : null;
  } catch {
    return null;
  }
}

/** Null when the directory holds no team database. */
export function readStatus(dir: string, now: number): TeamStatus | null {
  const db = openTeamExisting(dir);
  if (db === null) return null;
  try {
    const paths = teamPaths(dir);
    return {
      version: pkg.version,
      schema: teamSchemaVersion(db),
      serverId: getMeta(db, "server.id") ?? "",
      instance: getMeta(db, "server.instance") ?? "",
      members: memberCounts(db),
      devices: deviceCounts(db),
      pendingBootstrap: pendingBootstrapInvitation(db, now) !== null,
      lastSeq: sequenceHighWater(db, "changes"),
      marks: readHighWater(paths.feedFile),
      mirror: { last: mirrorLast(getMeta(db, "mirror.last")), pending: pendingMirrorCount(db) },
      heads: repoHeads(paths.repos),
      freeBytes: freeBytes(dir),
      lease: leaseOf(db, SERVE_LEASE),
    };
  } finally {
    db.close();
  }
}

/** One `key: value` line per field; nested fields as `mirror.pending`, the heads as `heads.<folder>`. */
export function renderStatus(status: TeamStatus): string {
  const lines = [
    `version: ${status.version}`,
    `schema: ${status.schema}`,
    `serverId: ${status.serverId}`,
    `instance: ${status.instance}`,
    `members.active: ${status.members.active}`,
    `members.disabled: ${status.members.disabled}`,
    `devices.active: ${status.devices.active}`,
    `devices.revoked: ${status.devices.revoked}`,
    `pendingBootstrap: ${status.pendingBootstrap}`,
    `lastSeq: ${status.lastSeq}`,
    `marks.changes: ${status.marks.changes}`,
    `marks.audit: ${status.marks.audit}`,
  ];
  if (status.mirror.last === null) {
    lines.push("mirror.last: none");
  } else {
    lines.push(
      `mirror.last.at: ${new Date(status.mirror.last.at).toISOString()}`,
      `mirror.last.commits: ${status.mirror.last.commits}`,
      `mirror.last.error: ${status.mirror.last.error ?? "none"}`,
    );
  }
  lines.push(`mirror.pending: ${status.mirror.pending}`);
  for (const { folder, head } of status.heads) lines.push(`heads.${folder}: ${head ?? "none"}`);
  lines.push(`freeBytes: ${status.freeBytes ?? "unknown"}`);
  if (status.lease === null) {
    lines.push("lease: none");
  } else {
    lines.push(
      `lease.owner: ${status.lease.owner}`,
      `lease.until: ${new Date(status.lease.until).toISOString()}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
