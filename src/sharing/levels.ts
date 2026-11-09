// How a project's level reads, and the policy's epoch. A leaf over `types.ts`: the store
// (which writes levels) and the loader (which reads them) both import it, and the store
// never imports the loader, so the two apply one rule.
import { isLevel, type Level, type Reason, type SharingPolicy, TEAM_DESTINATION } from "./types.ts";

/**
 * The destinations there are: the team's server, alone. The roots and the areas apply to
 * these, and a level stored for any other reads `local`: a destination a later version
 * adds starts with every project at Nothing.
 */
export const DESTINATIONS: ReadonlySet<string> = new Set([TEAM_DESTINATION]);

/** The key of one project's level for one destination in `SharingPolicy.levels`. */
export function levelKey(projectId: number, destination: string): string {
  return `${projectId}@${destination}`;
}

/**
 * The level a stored row is worth now, and why. One rule for the loader and for a write:
 * a destination that is not configured, a project that is not known, and a project with no
 * row share nothing, and a row stored at `local` says what no row says; a row reads `local`
 * while its project is disabled or no longer carries the remote alias the level was set
 * under, and when its level is not one this version knows (the loader reports that one as a
 * problem). Otherwise the row's level is in force.
 */
export function effectiveLevel(
  row: { level: string; boundAlias: string } | null,
  project: { known: boolean; disabled: boolean; aliases: string[] },
  destination: string,
  destinations: ReadonlySet<string>,
): { level: Level; reason: Reason } {
  const local = (reason: Reason) => ({ level: "local" as const, reason });
  if (!destinations.has(destination)) return local("unknown-destination");
  if (!project.known) return local("no-project");
  if (row === null || row.level === "local") return local("level-local");
  if (project.disabled) return local("disabled");
  if (!project.aliases.includes(row.boundAlias)) return local("unbound-alias");
  if (!isLevel(row.level)) return local("level-local");
  return { level: row.level, reason: "allowed" };
}

/**
 * A project's level for a destination under a loaded policy. Project 0 and an id the policy
 * does not know have no project (an orphan folder, an ambiguous manifest). A known project
 * without a row shares nothing: a project at Nothing has no row.
 */
export function levelOf(
  policy: SharingPolicy,
  projectId: number,
  destination: string,
): { level: Level; reason: Reason } {
  if (!policy.destinations.has(destination)) {
    return { level: "local", reason: "unknown-destination" };
  }
  if (projectId === 0 || !policy.projects.has(projectId)) {
    return { level: "local", reason: "no-project" };
  }
  const row = policy.levels.get(levelKey(projectId, destination));
  return row === undefined
    ? { level: "local", reason: "level-local" }
    : { level: row.level, reason: row.reason };
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HASH_BITS = 20;

/** FNV-1a over the text's UTF-8 bytes, its 32 bits folded to 20. */
function hash20(text: string): number {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
  }
  return ((hash >>> HASH_BITS) ^ hash) & (2 ** HASH_BITS - 1);
}

/**
 * The policy's epoch, derived and never stored: the change counter above twenty bits of a
 * hash of the lists in force, the roots and the areas their taxonomy holds. A hand edit of
 * the env file moves it with no write, and so does an area added to a taxonomy that a list
 * already names; the counter keeps apart two policies with the same lists at different
 * times. Equal epochs mean the same lists in force and no recorded change between.
 */
export function epochOf(counter: number, inForce: { roots: string[]; areas: string[] }): number {
  return counter * 2 ** HASH_BITS + hash20(`${inForce.roots.join(",")}|${inForce.areas.join(",")}`);
}

/** A hand-built policy, for tests: open, empty, for the team destination, but for `parts`. */
export function policyWith(parts: Partial<SharingPolicy>): SharingPolicy {
  return {
    epoch: 0,
    closed: false,
    destinations: new Set(DESTINATIONS),
    projects: new Set(),
    roots: new Set(),
    areas: new Set(),
    inert: [],
    settings: { roots: [], areas: [] },
    fileLists: { roots: [], areas: [] },
    settingsSeen: { roots: [], areas: [] },
    levels: new Map(),
    problems: [],
    ...parts,
  };
}
