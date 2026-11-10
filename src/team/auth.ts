// Who is calling: the device token, the member's state, the role, the contract.
import { ACCEPTED_CONTRACTS } from "./contract.ts";
import type { Db } from "./db.ts";
import { HttpError } from "./errors.ts";
import { hashSecret, sameHash } from "./ids.ts";
import { type Device, type Member, toDevice, toMember } from "./members.ts";
import { deviceByTokenHash, memberById, touchDevice } from "./store.ts";

export interface Caller {
  member: Member;
  device: Device;
}

const SEEN_EVERY_MS = 60_000;

/**
 * The checks in this order: no device for the token's digest → 401; the member disabled → 403;
 * the device revoked → 401. The digest is the lookup key; the compare after it is a convention.
 */
export function authenticate(db: Db, request: Request, now: number): Caller {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const digest = hashSecret(token);
  const device = token === "" ? null : deviceByTokenHash(db, digest);
  if (device === null || !sameHash(device.token_hash, digest)) {
    throw new HttpError(401, { error: "missing or wrong token" });
  }
  const member = memberById(db, device.member_id);
  if (member === null) throw new HttpError(401, { error: "missing or wrong token" });
  if (member.disabled_at !== null) throw new HttpError(403, { error: "member disabled" });
  if (device.revoked_at !== null) throw new HttpError(401, { error: "device revoked" });
  if (device.last_seen_at === null || now - device.last_seen_at >= SEEN_EVERY_MS) {
    touchDevice(db, device.id, now);
  }
  return { member: toMember(member), device: toDevice(device) };
}

export function requireAdmin(caller: Caller): void {
  if (caller.member.role !== "admin") throw new HttpError(403, { error: "admin only" });
}

/** `X-WCM-Contract` absent or one the server accepts; another is 409 with the list. */
export function checkContract(request: Request): void {
  const header = request.headers.get("x-wcm-contract");
  if (header === null) return;
  const contract = Number(header);
  if (!ACCEPTED_CONTRACTS.includes(contract)) {
    throw new HttpError(409, { error: "contract", accepted: [...ACCEPTED_CONTRACTS] });
  }
}
