// A memory's hash on its way out. A leaf: one function over the fields the contract names.
import { createHash } from "node:crypto";
import { MEMORY_HASH_FIELDS, type OutgoingMemory } from "./types.ts";

const HASH_HEX = 16;

/**
 * The hash of an outgoing memory: the first sixteen hex characters of the SHA-256 of the
 * fields in `MEMORY_HASH_FIELDS`, in that order, one per line. The title and the body are
 * given already redacted, so the hash is of what leaves. It covers nothing else: a rejudge
 * changes it, a use count does not.
 */
export function memoryHash(
  fields: Pick<OutgoingMemory, (typeof MEMORY_HASH_FIELDS)[number]>,
): string {
  const text = MEMORY_HASH_FIELDS.map((field) => String(fields[field])).join("\n");
  return createHash("sha256").update(text).digest("hex").slice(0, HASH_HEX);
}
