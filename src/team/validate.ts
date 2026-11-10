// What a pushed payload must be before the server reads its database: the shape, the uid
// grammar, the slug, the size, the hash recomputed over the bytes received, the entry read
// by part 1's parser, and the secret check. Pure: no database, no clock.
import { findSecrets } from "../core/redact.ts";
import {
  AREA_ID,
  AREA_MAX,
  checkSlug,
  ENTRY_MAX_BYTES,
  parseEntry,
  UUID,
} from "../modules/knowledge/entry.ts";
import { hashOf } from "../modules/knowledge/repo.ts";
import type { KnowledgeEntry } from "../modules/knowledge/types.ts";
import { memoryHash } from "../sharing/hash.ts";
import { isHostLedAlias } from "../sharing/levels.ts";
import {
  OUTGOING_ENTRY_KEYS,
  OUTGOING_MEMORY_KEYS,
  type OutgoingEntry,
  type OutgoingMemory,
} from "../sharing/types.ts";
import type { PushReason } from "./contract.ts";
import { MEMORY_UID } from "./ids.ts";

export type EntryScope = "workspace" | "shared" | "project";

export interface Refusal {
  result: "refused";
  reason: PushReason;
  rule?: string;
}

const refuse = (reason: PushReason, rule?: string): Refusal =>
  rule === undefined ? { result: "refused", reason } : { result: "refused", reason, rule };

/** Part 1's `UUID` without its anchors, to build the uid grammar. */
export const UUID_BODY = UUID.source.slice(1, -1);

/** `workspace:<uuid>`, `shared:<uuid>` or `project:<alias>:<uuid>`; the alias is checked apart. */
export const ENTRY_UID = new RegExp(
  `^(workspace|shared):(${UUID_BODY})$|^project:(remote:[^,\\s]{1,200}):(${UUID_BODY})$`,
);

export interface EntryUid {
  scope: EntryScope;
  remoteAlias: string | null;
  uuid: string;
}

/** The parts of an entry's uid; null when it is not one, or its alias is not host-led. */
export function parseEntryUid(uid: string): EntryUid | null {
  const match = ENTRY_UID.exec(uid);
  if (match === null) return null;
  if (match[1] !== undefined) {
    return { scope: match[1] as EntryScope, remoteAlias: null, uuid: match[2] as string };
  }
  const alias = match[3] as string;
  if (!isHostLedAlias(alias)) return null;
  return { scope: "project", remoteAlias: alias, uuid: match[4] as string };
}

/** The file's bytes: the UTF-8 of the frontmatter block and the body as the client split them. */
export function entryBytes(payload: OutgoingEntry): Uint8Array {
  return Buffer.from(payload.frontmatter + payload.body, "utf8");
}

/** A plain object whose sorted keys are exactly `keys`. */
export function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const own = Object.keys(value).sort();
  return own.length === keys.length && own.every((key, i) => key === keys[i]);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function typedEntry(
  value: Record<string, unknown>,
): value is Record<string, unknown> & OutgoingEntry {
  return (
    value.kind === "entry" &&
    isString(value.uid) &&
    (value.scope === "workspace" || value.scope === "shared" || value.scope === "project") &&
    isString(value.slug) &&
    isString(value.frontmatter) &&
    isString(value.body) &&
    isString(value.hash) &&
    (value.remoteAlias === null || isString(value.remoteAlias)) &&
    isFiniteNumber(value.version)
  );
}

/** A memory's kind or status: one word the client store would write. */
export const KIND_WORD = /^[a-z][a-z0-9_-]{0,31}$/;

export function typedMemory(
  value: Record<string, unknown>,
): value is Record<string, unknown> & OutgoingMemory {
  return (
    value.kind === "memory" &&
    isString(value.uid) &&
    isString(value.remoteAlias) &&
    isString(value.title) &&
    isString(value.body) &&
    isString(value.memoryKind) &&
    KIND_WORD.test(value.memoryKind) &&
    isString(value.status) &&
    KIND_WORD.test(value.status) &&
    isString(value.hash) &&
    isFiniteNumber(value.importance) &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt) &&
    isFiniteNumber(value.version)
  );
}

export interface CheckedEntry {
  payload: OutgoingEntry;
  bytes: Uint8Array;
  hash: string;
  entry: KnowledgeEntry;
  scope: EntryScope;
  remoteAlias: string | null;
  uuid: string;
}

/** The spec's steps 1 to 5 for an entry send, in order; the first fault answers. */
export function checkEntryPayload(item: { uid: string; payload: unknown }): CheckedEntry | Refusal {
  const { payload } = item;
  if (!hasExactKeys(payload, OUTGOING_ENTRY_KEYS) || !typedEntry(payload)) return refuse("shape");
  if (payload.uid !== item.uid) return refuse("shape");
  const parsed = parseEntryUid(payload.uid);
  if (parsed === null) return refuse("shape");
  if (payload.scope !== parsed.scope || payload.remoteAlias !== parsed.remoteAlias) {
    return refuse("shape");
  }
  try {
    checkSlug(payload.slug);
  } catch {
    return refuse("slug");
  }
  const bytes = entryBytes(payload);
  if (bytes.byteLength > ENTRY_MAX_BYTES) return refuse("size");
  const hash = hashOf(bytes);
  if (hash !== payload.hash) return refuse("hash");
  const text = payload.frontmatter + payload.body;
  const entry = parseEntry(text, payload.slug, null);
  if (entry.problem !== null || entry.id !== parsed.uuid) return refuse("shape");
  if (!AREA_ID.test(entry.area) || entry.area.length > AREA_MAX) return refuse("shape");
  const secret = findSecrets(text, { env: {} })[0];
  if (secret !== undefined) return refuse("secret", secret.rule);
  return {
    payload,
    bytes,
    hash,
    entry,
    scope: parsed.scope,
    remoteAlias: parsed.remoteAlias,
    uuid: parsed.uuid,
  };
}

export interface CheckedMemory {
  payload: OutgoingMemory;
  hash: string;
  size: number;
}

/** The spec's steps 1 to 4 for a memory send, in order. */
export function checkMemoryPayload(item: {
  uid: string;
  payload: unknown;
}): CheckedMemory | Refusal {
  const { payload } = item;
  if (!hasExactKeys(payload, OUTGOING_MEMORY_KEYS) || !typedMemory(payload)) return refuse("shape");
  if (
    payload.uid !== item.uid ||
    !MEMORY_UID.test(payload.uid) ||
    !isHostLedAlias(payload.remoteAlias)
  )
    return refuse("shape");
  const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (size > ENTRY_MAX_BYTES) return refuse("size");
  const hash = memoryHash(payload);
  if (hash !== payload.hash) return refuse("hash");
  const secret =
    findSecrets(payload.title, { env: {} })[0] ?? findSecrets(payload.body, { env: {} })[0];
  if (secret !== undefined) return refuse("secret", secret.rule);
  return { payload, hash, size };
}
