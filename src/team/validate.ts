// What a pushed payload must be before the server reads its database: the shape, the uid
// grammar, the slug, the size, the hash recomputed over the bytes received, the entry read
// by part 1's parser, and the secret check. Pure: no database, no clock.
import { isTeamAlias } from "../core/identity.ts";
import { findSecrets } from "../core/redact.ts";
import {
  AREA_ID,
  AREA_MAX,
  checkSlug,
  ENTRY_MAX_BYTES,
  parseEntry,
} from "../modules/knowledge/entry.ts";
import { hashOf } from "../modules/knowledge/repo.ts";
import type { KnowledgeEntry } from "../modules/knowledge/types.ts";
import { memoryHash } from "../sharing/hash.ts";
import {
  OUTGOING_ENTRY_KEYS,
  OUTGOING_MEMORY_KEYS,
  type OutgoingEntry,
  type OutgoingMemory,
} from "../sharing/types.ts";
import type { PushReason } from "./contract.ts";
import { entryBytes, parseEntryUid } from "./contract.ts";
import { MEMORY_UID } from "./ids.ts";

export type EntryScope = "workspace" | "shared" | "project";

export interface Refusal {
  result: "refused";
  reason: PushReason;
  rule?: string;
}

const refuse = (reason: PushReason, rule?: string): Refusal =>
  rule === undefined ? { result: "refused", reason } : { result: "refused", reason, rule };

export { entryBytes, parseEntryUid };

/** The rule a send under a shared name the registry never held is refused with (`name`, ADR 0028). */
export const NAME_RULE = "the name is not on this server; create it or pick one from the list";
/** The rule a send under a name the operator purged is refused with (`name-purged`). */
export const NAME_PURGED_RULE = "the operator removed the name from this server";

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
    !isTeamAlias(payload.remoteAlias)
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
