// What the sharing policy is made of: the levels, the roots, the area ids, the reasons, and
// the shapes the predicate reads and a sync sends. A leaf: it imports nothing, so the
// settings (on the hook path) and the viewer read it without loading the store or a module.

// --- Levels -------------------------------------------------------------------------

/** How much of one project may leave this machine for one destination. */
export type Level = "local" | "knowledge" | "all";

/** Narrowest first: a level later in the list lets more leave. */
export const LEVELS: readonly Level[] = ["local", "knowledge", "all"];

/** What a person reads for each level. */
export const LEVEL_LABELS: Record<Level, string> = {
  local: "Nothing",
  knowledge: "Knowledge",
  all: "Knowledge and memories",
};

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/** Whether going from one level to another lets more leave: the change a person confirms. */
export function widens(from: Level, to: Level): boolean {
  return LEVELS.indexOf(to) > LEVELS.indexOf(from);
}

// --- Roots, areas, destinations -----------------------------------------------------

/** A knowledge repository that belongs to no project. Each leaves only when named. */
export type Root = "workspace" | "shared";

export const ROOTS: readonly Root[] = ["workspace", "shared"];

export function isRoot(value: string): value is Root {
  return (ROOTS as readonly string[]).includes(value);
}

/**
 * A root-qualified area id, `workspace:sales`. The id after the colon takes exactly what the
 * knowledge store takes for an area id (its `AREA_ID`, at most 40 characters). The pattern is
 * repeated here so that this file stays a leaf; a test runs the same strings through both.
 */
export const SHARE_AREA = /^(workspace|shared):([a-z0-9][a-z0-9-]{0,39})$/;

/** The one destination there is so far: the team's server. The roots and areas apply to it. */
export const TEAM_DESTINATION = "team";

/** The token that means the empty list in either sharing setting. */
export const NONE = "none";

/** A sharing list as a setting holds it and a person reads it: comma text, or `none` when empty. */
export function shareListText(list: readonly string[]): string {
  return list.length === 0 ? NONE : list.join(",");
}

// --- Reasons ------------------------------------------------------------------------

/** Why an item leaves or stays: the fixed codes a ruling carries. */
export const REASONS = [
  "allowed",
  "already-sent",
  "policy-failed",
  "unknown-destination",
  "received-same",
  "received-elsewhere",
  "problem",
  "status",
  "root-off",
  "level-local",
  "level-knowledge",
  "disabled",
  "unbound-alias",
  "no-project",
  "area-private",
  "area-inert",
  "stale",
  "branch-scope",
  "imported",
  "user-rule",
] as const;

export type Reason = (typeof REASONS)[number];

/** One sentence per reason, for a person. */
export const REASON_TEXT: Record<Reason, string> = {
  allowed: "The policy lets it leave.",
  "already-sent": "The server already has this version.",
  "policy-failed": "The policy could not be loaded; nothing leaves.",
  "unknown-destination": "This destination is not configured.",
  "received-same": "It came from this destination and has not changed since.",
  "received-elsewhere": "It came from another destination and never travels on.",
  problem: "The entry has a problem; run knowledge adopt.",
  status: "Only active items leave.",
  "root-off": "Its repository is not allowed to leave.",
  "level-local": "This project shares nothing.",
  "level-knowledge": "This project shares knowledge only; memories stay.",
  disabled: "Memory is off for this project.",
  "unbound-alias": "The level was set under a git remote this project no longer has.",
  "no-project": "No project owns it.",
  "area-private": "Its area is not allowed.",
  "area-inert": "Its area is listed but not in the taxonomy.",
  stale: "Stale memories stay.",
  "branch-scope": "Branch-bound memories stay.",
  imported: "Imported memories stay.",
  "user-rule": "Your own rules stay.",
};

// --- What the predicate reads -------------------------------------------------------

/** A knowledge entry as the predicate sees it: where it lives and what state it is in. */
export interface EntryItem {
  kind: "entry";
  uid: string;
  scope: "workspace" | "shared" | "project";
  /** 0 for the workspace's and the shared repository's entries, and for a folder no project owns. */
  projectId: number;
  area: string;
  status: string;
  problem: string | null;
  version: number;
  hash: string;
}

/** A memory as the predicate sees it. */
export interface MemoryItem {
  kind: "memory";
  uid: string;
  projectId: number;
  status: string;
  stale: boolean;
  scope: "project" | "branch";
  origin: string;
  isUserRule: boolean;
  version: number;
  /** Null when the caller did not compute it: against a sent record, that reads as changed. */
  hash: string | null;
}

export type Item = EntryItem | MemoryItem;

// --- What leaves with an item -------------------------------------------------------

/** An entry on its way out: its file's current content and nothing of its repository. */
export interface OutgoingEntry {
  kind: "entry";
  uid: string;
  scope: EntryItem["scope"];
  slug: string;
  /** The project's remote alias, which is how a team matches projects; null outside a project. */
  remoteAlias: string | null;
  frontmatter: string;
  body: string;
  version: number;
  hash: string;
}

/** A memory on its way out. */
export interface OutgoingMemory {
  kind: "memory";
  uid: string;
  remoteAlias: string;
  title: string;
  body: string;
  memoryKind: string;
  importance: number;
  status: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  hash: string;
}

/**
 * The sorted keys of a shape, from a record that must name every one of them and no other:
 * a field added to a type and not listed below fails the build, so the lists the contract
 * is pinned by cannot fall behind the types.
 */
function keysOf<T>(keys: Record<keyof T, true>): readonly string[] {
  return Object.keys(keys).sort();
}

export const ENTRY_ITEM_KEYS = keysOf<EntryItem>({
  area: true,
  hash: true,
  kind: true,
  problem: true,
  projectId: true,
  scope: true,
  status: true,
  uid: true,
  version: true,
});

export const MEMORY_ITEM_KEYS = keysOf<MemoryItem>({
  hash: true,
  isUserRule: true,
  kind: true,
  origin: true,
  projectId: true,
  scope: true,
  stale: true,
  status: true,
  uid: true,
  version: true,
});

export const OUTGOING_ENTRY_KEYS = keysOf<OutgoingEntry>({
  body: true,
  frontmatter: true,
  hash: true,
  kind: true,
  remoteAlias: true,
  scope: true,
  slug: true,
  uid: true,
  version: true,
});

export const OUTGOING_MEMORY_KEYS = keysOf<OutgoingMemory>({
  body: true,
  createdAt: true,
  hash: true,
  importance: true,
  kind: true,
  memoryKind: true,
  remoteAlias: true,
  status: true,
  title: true,
  uid: true,
  updatedAt: true,
  version: true,
});

/** The fields of an outgoing memory its hash covers, in this order; the texts already redacted. */
export const MEMORY_HASH_FIELDS = ["memoryKind", "importance", "status", "title", "body"] as const;

// --- Rulings ------------------------------------------------------------------------

/** What was sent to, or received from, a destination for one item. */
export interface LedgerRecord {
  destination: string;
  direction: "sent" | "received";
  /** Informational: the hash decides whether two versions are the same. */
  version: number;
  hash: string;
  withdrawnAt: number | null;
}

/** The predicate's answer for one item and one destination, under the policy of `epoch`. */
export interface Decision {
  answer: "send" | "withdraw" | "keep";
  reason: Reason;
  epoch: number;
}

/**
 * One project's level for one destination, as it reads now. `reason` is `allowed` for a
 * level in force, or what made a stored level read `local` (`disabled`, `unbound-alias`).
 */
export interface LevelRow {
  projectId: number;
  destination: string;
  level: Level;
  boundAlias: string;
  reason: Reason;
}

/** Everything the predicate needs, loaded once: no ruling reads the database or a file. */
export interface SharingPolicy {
  /** Equal for two policies only when the lists are the same and nothing changed between. */
  epoch: number;
  /** The policy could not be loaded: nothing leaves. */
  closed: boolean;
  /** The destinations the roots and areas apply to. */
  destinations: ReadonlySet<string>;
  /** Every known project id. */
  projects: ReadonlySet<number>;
  roots: ReadonlySet<Root>;
  /** Root-qualified, and in their root's taxonomy. */
  areas: ReadonlySet<string>;
  /** Listed in the settings but in no taxonomy: they allow nothing. */
  inert: readonly string[];
  /** The effective lists before the taxonomy filter. */
  settings: { roots: Root[]; areas: string[] };
  /** The env file's own lists, which no environment narrows: what the audit compares. */
  fileLists: { roots: Root[]; areas: string[] };
  /** The file's lists as last recorded; empty lists when never recorded. */
  settingsSeen: { roots: Root[]; areas: string[] };
  /** Keyed by `levelKey(projectId, destination)`. */
  levels: ReadonlyMap<string, LevelRow>;
  /** What was ignored, emptied, pending or failed, one sentence each. */
  problems: readonly string[];
}

// --- Identity -----------------------------------------------------------------------

/**
 * An entry's identity: its id scoped by its repository, so one file copied into two
 * repositories is two items. A project's repository is named by the project's remote alias,
 * the one name a team shares for it; without it the entry has no identity to leave under.
 */
export function entryUid(
  scope: EntryItem["scope"],
  remoteAlias: string | null,
  id: string,
): string {
  if (scope !== "project") return `${scope}:${id}`;
  if (remoteAlias === null) {
    throw new Error("a project's entry has no uid without the project's remote alias");
  }
  return `project:${remoteAlias}:${id}`;
}

/**
 * A memory's identity on this machine: its row id scoped by the store's generation, which a
 * restore renews, since a restored copy gives its later row ids to other memories.
 */
export function memoryUid(generation: string, id: number): string {
  return `${generation}:${id}`;
}
