// The contract between the team server and part 6's client: what the server accepts, the
// shapes it answers with, and one fingerprint that pins them, so a change to part 4's key
// lists or to a shape without a contract bump fails a test.
import { createHash } from "node:crypto";
import { hasLetterOrDigit, isTeamAlias, stripTeamPrefix } from "../core/identity.ts";
import { slugify, UUID } from "../modules/knowledge/entry.ts";
import { projectFolderName } from "../modules/knowledge/repo.ts";
import {
  OUTGOING_ENTRY_KEYS,
  OUTGOING_MEMORY_KEYS,
  type OutgoingEntry,
  type OutgoingMemory,
} from "../sharing/types.ts";
import type { Limits } from "./types.ts";

export type { Limits };

// --- The entry uid ----------------------------------------------------------------------------
// `entryUid` (src/sharing/types.ts) writes it; this is its one parser, for the server's
// validation and the client's reads alike.

/** Part 1's `UUID` without its anchors, to build the uid grammar. */
const UUID_BODY = UUID.source.slice(1, -1);

/** `workspace:<uuid>`, `shared:<uuid>` or `project:<alias>:<uuid>` (a remote or a shared name); the alias is checked apart. */
const ENTRY_UID = new RegExp(
  `^(workspace|shared):(${UUID_BODY})$|^project:((?:remote|name):[^,\\s]{1,200}):(${UUID_BODY})$`,
);

/** The parts of an entry's uid: a project's always has its alias, the other scopes never do. */
export type EntryUid =
  | { scope: "workspace" | "shared"; remoteAlias: null; uuid: string }
  | { scope: "project"; remoteAlias: string; uuid: string };

/** The parts of an entry's uid; null when it is not one, or its alias names no project to a team. */
export function parseEntryUid(uid: string): EntryUid | null {
  const match = ENTRY_UID.exec(uid);
  if (match === null) return null;
  if (match[1] !== undefined) {
    return {
      scope: match[1] as "workspace" | "shared",
      remoteAlias: null,
      uuid: match[2] as string,
    };
  }
  const alias = match[3] as string;
  if (!isTeamAlias(alias)) return null;
  return { scope: "project", remoteAlias: alias, uuid: match[4] as string };
}

/** The contract this binary speaks: 2 since the shared names (ADR 0028). */
export const CONTRACT = 2;

/** The contracts this server accepts: the current one and the one before it. */
export const ACCEPTED_CONTRACTS: readonly number[] = [1, 2];

/** Why a pushed item was refused: a fixed list, part of the contract. */
export const PUSH_REASONS = [
  "shape",
  "size",
  "hash",
  "slug",
  "secret",
  "purged",
  "not-owner",
  "withdrawn-by-admin",
  "unknown",
  "name",
  "name-purged",
  "rate",
  "storage",
] as const;
export type PushReason = (typeof PUSH_REASONS)[number];

/** The sorted key lists of the answers the client reads; a field added here is a contract change. */
export const RESULT_SHAPES: Readonly<Record<string, readonly string[]>> = {
  pushResult: ["appliedAs", "current", "hash", "reason", "result", "revision", "rule", "uid"],
  feedItem: [
    "at",
    "device",
    "hash",
    "kind",
    "member",
    "movedTo",
    "nameId",
    "op",
    "payload",
    "remoteAlias",
    "revision",
    "scope",
    "seq",
    "uid",
  ],
  pullPage: ["instance", "items", "more", "next", "serverId", "snapshot"],
  join: [
    "contract",
    "deviceAlias",
    "deviceId",
    "instance",
    "memberId",
    "name",
    "role",
    "serverId",
    "token",
  ],
  me: ["contract", "device", "instance", "limits", "member", "now", "serverId"],
  refusal: ["error", "instance", "serverId"],
  /** A 409 on the contract header: the list the server accepts (ADR 0028 pins it; it was sent since 1). */
  contractRefusal: ["accepted", "error", "instance", "serverId"],
  /** A 409 `exists` on a name's create: the live name's item (ADR 0028). */
  nameConflict: ["error", "instance", "name", "serverId"],
  nameItem: ["alias", "createdAt", "createdBy", "entries", "id", "lastChangeAt", "memories"],
  namesPage: ["items", "more", "next"],
};

export interface ContractParts {
  entry: readonly string[];
  memory: readonly string[];
  reasons: readonly string[];
  shapes: Readonly<Record<string, readonly string[]>>;
}

/** The SHA-256 of the parts, as JSON, in a fixed order. */
export function fingerprintOf(parts: ContractParts): string {
  const text = JSON.stringify({
    entry: [...parts.entry],
    memory: [...parts.memory],
    reasons: [...parts.reasons],
    shapes: Object.fromEntries(
      Object.keys(parts.shapes)
        .sort()
        .map((name) => [name, [...(parts.shapes[name] as readonly string[])]]),
    ),
  });
  return createHash("sha256").update(text).digest("hex");
}

/** The fingerprint of what this binary speaks. */
export function contractFingerprint(): string {
  return fingerprintOf({
    entry: OUTGOING_ENTRY_KEYS,
    memory: OUTGOING_MEMORY_KEYS,
    reasons: PUSH_REASONS,
    shapes: RESULT_SHAPES,
  });
}

/** The pinned value: when `contractFingerprint()` differs, bump `CONTRACT` and repin. */
export const CONTRACT_FINGERPRINT =
  "ac340c80764de18d6810837742f07786d4bd7cbe43bd205905ac278d0277e911";

// --- The wire: headers, grammars and bytes both sides agree on -----------------------------

/** The header a client names its contract in; absent, the server assumes the current one. */
export const CONTRACT_HEADER = "X-WCM-Contract";
/** The header a request id travels in, both ways. */
export const REQUEST_ID_HEADER = "x-request-id";
/** What a request id may be; another is replaced by one of the server's. */
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** `127.0.0.0/8`, `::1` and `localhost`: the hosts a server may answer in plain HTTP without a warning. */
export function isLoopback(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower === "::1" || lower === "[::1]") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower);
}

/** The file's bytes: the UTF-8 of the frontmatter block and the body as the client split them. */
export function entryBytes(payload: OutgoingEntry): Uint8Array {
  return Buffer.from(payload.frontmatter + payload.body, "utf8");
}

/** A slug of the text, or `fallback` when no letter or digit survives. */
function slugOf(text: string, fallback: string): string {
  return hasLetterOrDigit(text) ? slugify(text) : fallback;
}

/**
 * The repository a scope and alias name, relative to `repos/` on the server and to a server's
 * received folder on a client: `shared`; a project by the slug of its alias and a hash of it;
 * a member's workspace by their id and the slug of their name. Built from ids and slugs, so a
 * name such as `../x` stays under its parent.
 */
export function repoFolder(
  scope: string,
  remoteAlias: string | null,
  member: { id: string; name: string } | null,
): string {
  if (scope === "shared") return "shared";
  if (scope === "project") {
    const alias = remoteAlias ?? "";
    const slug = slugOf(stripTeamPrefix(alias), "project");
    return `projects/${slug}-${projectFolderName(alias).slice(0, 8)}`;
  }
  const who = member ?? { id: "unknown", name: "" };
  return `members/${who.id}-${slugOf(who.name, "member")}`;
}

/** A fixed file name: two entries with one slug never collide, and a slug change is a rename. */
export function fileNameFor(uuid: string, slug: string): string {
  return `entries/${slug}--${uuid.slice(0, 8)}.md`;
}

// --- The answers the client reads: the shapes `RESULT_SHAPES` pins, as types ------------------

export interface JoinAnswer {
  token: string;
  deviceId: string;
  deviceAlias: string;
  memberId: string;
  name: string;
  role: string;
  contract: number;
  serverId: string;
  instance: string;
}

export interface MeAnswer {
  member: { id: string; name: string; role: string };
  device: { id: string; alias: string; label: string };
  serverId: string;
  instance: string;
  contract: number;
  now: number;
  limits: Limits;
}

export interface PushItemShape {
  op: "send" | "withdraw";
  kind: "entry" | "memory";
  uid: string;
  baseRevision: number;
  baseHash: string;
  payload?: unknown;
}

export interface PushResultShape {
  uid: string;
  result: "applied" | "stale" | "refused" | "withdrawn";
  revision?: number;
  hash?: string;
  current?: { revision: number; hash: string; updatedAt?: number };
  appliedAs?: number;
  reason?: PushReason;
  rule?: string;
}

export interface FeedItemShape {
  seq: number;
  kind: "entry" | "memory";
  uid: string;
  op: "upsert" | "tombstone" | "purge";
  scope: string;
  remoteAlias: string | null;
  revision: number;
  hash: string;
  movedTo?: string;
  /** On an `upsert` under a shared name, the registry's id for it at the time of the page; null otherwise (ADR 0028). */
  nameId: string | null;
  payload?: { frontmatter: string; body: string } | OutgoingMemory;
  member: { id: string; name: string };
  device?: string;
  at: number;
}

export interface PullPageShape {
  serverId: string;
  instance: string;
  next: number;
  more: boolean;
  snapshot: boolean;
  items: FeedItemShape[];
}

/** A shared name as the registry answers it (ADR 0028). */
export interface NameItemShape {
  alias: string;
  id: string;
  createdAt: number;
  createdBy: { id: string; name: string };
  entries: number;
  memories: number;
  lastChangeAt: number | null;
}

/** One page of the live names, by alias. */
export interface NamesPageShape {
  items: NameItemShape[];
  more: boolean;
  next: string | null;
}

/**
 * The body of a refusal: the error, and the ids when the server has them; on a contract
 * refusal the accepted list; on a name's `exists` the live name's item. A 429's retry delay
 * travels in the `Retry-After` header, never in the body.
 */
export interface RefusalShape {
  error: string;
  serverId?: string;
  instance?: string;
  accepted?: number[];
  name?: NameItemShape;
}
