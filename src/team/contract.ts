// The contract between the team server and part 6's client: what the server accepts, the
// shapes it answers with, and one fingerprint that pins them, so a change to part 4's key
// lists or to a shape without a contract bump fails a test.
import { createHash } from "node:crypto";
import { OUTGOING_ENTRY_KEYS, OUTGOING_MEMORY_KEYS } from "../sharing/types.ts";

/** The contract this binary speaks. */
export const CONTRACT = 1;

/** The contracts this server accepts: from the first bump on, the current one and the one before it. */
export const ACCEPTED_CONTRACTS: readonly number[] = [1];

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
  "7a5bb7c74b149f93f7a3aac1bb32b54e501ec9765d6724b6e5ee791433f69f1d";
