// The team server's random ids, tokens and codes, and the grammars that recognise them.
// A leaf over node:crypto.
import { createHash, getRandomValues, timingSafeEqual } from "node:crypto";

/** Lower case, for ids a person reads in a log or a folder name. */
export const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
/** Upper case, for invitation codes a person types or pastes. */
export const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** `length` characters of the alphabet, five random bits each (the alphabets have 32 characters). */
export function randomBase32(length: number, alphabet: string = BASE32): string {
  const bytes = getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[(bytes[i] as number) & 31];
  return out;
}

export const newMemberId = (): string => randomBase32(12);
export const newDeviceId = (): string => randomBase32(12);
export const newDeviceAlias = (): string => randomBase32(8);
export const newInvitationId = (): string => randomBase32(12);

/** 16 hex characters: the server's id, its instance, a request id, a lease owner's suffix. */
export function newHexId(): string {
  return Buffer.from(getRandomValues(new Uint8Array(8))).toString("hex");
}

/** A device token: `wcm1_` and 32 random bytes as base64url, 43 characters, no padding. */
export function newToken(): string {
  return `wcm1_${Buffer.from(getRandomValues(new Uint8Array(32))).toString("base64url")}`;
}

/** An invitation code: `wci1_` and 130 random bits as 26 base32 characters. */
export function newCode(): string {
  return `wci1_${randomBase32(26, CODE_ALPHABET)}`;
}

/** What is stored for a token or a code: the SHA-256 of its UTF-8 bytes, as hex. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** A constant-time comparison of two digests; false at once when their lengths differ. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export const TOKEN = /^wcm1_[A-Za-z0-9_-]{43}$/;
export const CODE = /^wci1_[A-Z2-7]{26}$/;
/** A client's own request id, echoed when it has this shape. */
export const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Part 4's memory uid: the client store's generation (eight hex characters) and the row id. */
export const MEMORY_UID = /^[0-9a-f]{8}:\d{1,18}$/;

/** A memory's key on the server: the device's id (no colon in it) and the client's uid. */
export function memoryKey(deviceId: string, uid: string): string {
  return `${deviceId}:${uid}`;
}

/** The key split at its first colon: the one place the key's grammar is read. */
export function splitMemoryKey(key: string): { deviceId: string; uid: string } {
  const colon = key.indexOf(":");
  return { deviceId: key.slice(0, colon), uid: key.slice(colon + 1) };
}

/** The operator at a shell: the actor of a CLI write, and the member a feed row shows for it. */
export const OPERATOR_ID = "operator";
export const OPERATOR = { memberId: OPERATOR_ID, deviceId: "cli" } as const;

/** `127.0.0.0/8`, `::1` and `localhost`: the hosts a server may answer in plain HTTP without a warning. */
export function isLoopback(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower === "::1" || lower === "[::1]") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower);
}
