// The knowledge module's shapes. A leaf: types only, so every other file of the module
// imports it without a cycle.
import type { Settings } from "../../settings/settings.ts";
import type { Db } from "../../store/db.ts";

/** Which repository: the workspace's, the shared one, or one project's. */
export type ScopeRef =
  | { scope: "workspace" }
  | { scope: "shared" }
  | { scope: "project"; projectId: number };

/** A repository that holds a taxonomy: the workspace's (also every project's root) or the shared one. */
export type RootRef = { scope: "workspace" } | { scope: "shared" };

/** `source` tells the fallback name `you` from a person who is really named so. */
export type PersonWriter = { kind: "person"; name: string; source: "setting" | "git" | "default" };
export type AgentWriter = { kind: "agent"; id: string };
export type Writer = PersonWriter | AgentWriter;

/** What git records as the author and the committer of a commit. */
export type Identity = { name: string; email: string };

/**
 * What the git runner needs of whoever calls it: the store, or the team server's mirror.
 * `env` is the only environment git ever sees; `root` is the folder git never looks above
 * (the store's `knowledge/` when absent); `extraConfig` are `-c` settings appended after the
 * runner's own, for a host whose repositories another user owns.
 */
export interface GitHost {
  dataDir: string;
  env: Record<string, string | undefined>;
  gitTimeoutMs: number;
  /** Extends the leases the running operation holds; null outside one. Throws when one was lost. */
  renew: (() => void) | null;
  root?: string;
  extraConfig?: readonly string[];
  /** The first part of the scope a failed git call is logged under; `knowledge` when absent. */
  logScope?: string;
}

/**
 * What every function of the store is given. `env` is the only environment git ever sees,
 * `now` the only clock, so a test controls both. A store is a `GitHost`.
 */
export interface KnowledgeStore extends GitHost {
  db: Db;
  dataDir: string;
  env: Record<string, string | undefined>;
  now: () => number;
  settings: Settings;
  gitTimeoutMs: number;
  /** Extends the leases the running operation holds; null outside one. Throws when one was lost. */
  renew: (() => void) | null;
  /**
   * Where the store tells the person what it did on its own, such as putting back an
   * operation that was interrupted. Null says it to the log only.
   */
  report: ((message: string) => void) | null;
}

export interface Repo {
  ref: ScopeRef;
  /** Absolute. */
  path: string;
  /** Relative to the data directory, with forward slashes: the `knowledge_repos.path` value. */
  relative: string;
  /** The `knowledge_repos` row. */
  id: number;
}

/** `knowledge.json`: what ties a repository's folder to its scope and, for a project, to its aliases. */
export interface Manifest {
  format: 1;
  scope: ScopeRef["scope"];
  project?: { aliases: string[] };
  createdAt: string;
}

export interface KnowledgeEntry {
  /** Empty when the file carries none or a malformed one. */
  id: string;
  slug: string;
  title: string;
  kind: string;
  area: string;
  context: string;
  subject: string;
  status: string;
  author: string;
  version: number;
  created: string | null;
  updated: string | null;
  supersedes: string | null;
  /** Shown at every session start. Only a person's write sets it; false when the file says nothing. */
  pinned: boolean;
  body: string;
  /** The frontmatter lines of the keys this version does not know, in the file's order. */
  extra: string[];
  /** Why the file is not a valid entry; such an entry is always a draft. */
  problem: string | null;
}

export interface KnowledgeProposal {
  id: string;
  /** The id of the entry the proposal changes, or the id a new entry will take. */
  entryId: string;
  slug: string;
  /** The target's version when the proposal was made; 0 for a new entry. */
  baseVersion: number;
  baseHash: string;
  proposedBy: string;
  proposedAt: string | null;
  title: string;
  kind: string;
  area: string;
  context: string;
  subject: string;
  status: string;
  body: string;
  decision: "accepted" | "rejected" | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decidedVersion: number | null;
  /** The ids of the entries the judge found the proposal contradicts. */
  contradicts: string[];
  /** The person the agent worked for when it proposed. */
  onBehalfOf: string | null;
  /** The judge that compared the proposal with its neighbours, and its version; null with none. */
  judgedBy: string | null;
  judgeVersion: string | null;
  extra: string[];
  problem: string | null;
}

/** What a caller asks the store to write. The id is never the caller's. */
export interface EntryChange {
  slug?: string;
  title: string;
  kind: string;
  area: string;
  context: string;
  subject: string;
  status?: string;
  body: string;
  /** Absent or 0: a new entry. */
  baseVersion?: number;
  supersedes?: string;
  /** A person's write only: undefined keeps the entry's value (false for a new entry). */
  pinned?: boolean;
  /** An agent's write only: what the proposal records beside the change. */
  proposal?: ProposalExtras;
}

/** What an agent's proposal records beside its change; `contradicts` holds entry ids. */
export interface ProposalExtras {
  contradicts: string[];
  onBehalfOf: string;
  judgedBy: string | null;
  judgeVersion: string | null;
}

export interface Taxonomy {
  version: number;
  updated: string;
  areas: { id: string; label: string }[];
}

/** An item of a block list in the frontmatter: `- scalar` or `- key: value`. */
export type ListItem = string | { key: string; value: string };
