// Members, devices, invitations and roles (D-2, D-3, D-4, D-5, D-9, D-14, D-19, D-23).
import { authorNameProblem } from "../settings/settings.ts";
import { audit } from "./audit.ts";
import type { Db } from "./db.ts";
import { HttpError } from "./errors.ts";
import {
  hashSecret,
  newCode,
  newDeviceAlias,
  newDeviceId,
  newInvitationId,
  newMemberId,
  newToken,
} from "./ids.ts";
import {
  activeDeviceIdsOf,
  countActiveAdminsWithDevices,
  countMembers,
  type DeviceRow,
  deviceById,
  type InvitationRow,
  insertDevice,
  insertInvitation,
  insertMember,
  invitationByCodeHash,
  invitationById,
  listDevices as listDeviceRows,
  listMembers as listMemberRows,
  listOpenInvitations,
  type MemberRow,
  memberById,
  pendingBootstrapInvitation,
  type Role,
  revokeInvitationsOfDevice,
  setDeviceRevoked,
  setDeviceToken,
  setInvitationRevoked,
  setInvitationUsed,
  setMemberDisabled,
  setMemberRole,
  transaction,
} from "./store.ts";

export type { Role };

export interface Member {
  id: string;
  name: string;
  role: Role;
  createdAt: number;
  disabledAt: number | null;
}

export interface Device {
  id: string;
  alias: string;
  memberId: string;
  label: string;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

export interface Invitation {
  id: string;
  role: Role;
  name: string | null;
  forMember: string | null;
  createdByDevice: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedByDevice: string | null;
  revokedAt: number | null;
}

export const LAST_ADMIN_HINT =
  "promote another member, or invite a device for this admin with serve invite --for <id>, then retry";
const LABEL_MAX = 80;
const EXPIRY_DEFAULT_HOURS = 72;
const EXPIRY_MAX_HOURS = 720;
const BOOTSTRAP_HOURS = 24;
const HOUR_MS = 3_600_000;

export const toMember = (row: MemberRow): Member => ({
  id: row.id,
  name: row.name,
  role: row.role,
  createdAt: row.created_at,
  disabledAt: row.disabled_at,
});

export const toDevice = (row: DeviceRow): Device => ({
  id: row.id,
  alias: row.alias,
  memberId: row.member_id,
  label: row.label,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  revokedAt: row.revoked_at,
});

const toInvitation = (row: InvitationRow): Invitation => ({
  id: row.id,
  role: row.role,
  name: row.name,
  forMember: row.for_member,
  createdByDevice: row.created_by_device,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  usedAt: row.used_at,
  usedByDevice: row.used_by_device,
  revokedAt: row.revoked_at,
});

/** Part 1's author rule, as the client applies it: 1 to 80 characters, no line break, not `agent:`. */
export function checkName(name: unknown): string {
  if (typeof name !== "string" || authorNameProblem(name) !== null) {
    throw new HttpError(400, { error: "name" });
  }
  return name;
}

export function checkLabel(label: unknown): string {
  if (
    typeof label !== "string" ||
    label.length === 0 ||
    label.length > LABEL_MAX ||
    /[\r\n]/.test(label)
  ) {
    throw new HttpError(400, { error: "label" });
  }
  return label;
}

/** An integer 1 to 720; 72 by default. */
export function checkExpiry(hours: unknown): number {
  if (hours === undefined) return EXPIRY_DEFAULT_HOURS;
  if (
    typeof hours !== "number" ||
    !Number.isInteger(hours) ||
    hours < 1 ||
    hours > EXPIRY_MAX_HOURS
  ) {
    throw new HttpError(400, { error: "expiresInHours" });
  }
  return hours;
}

export function checkRole(role: unknown): Role {
  if (role !== "admin" && role !== "member") throw new HttpError(400, { error: "role" });
  return role;
}

/** Mints an invitation; the code is returned once and only its hash is stored. */
export function mintInvitation(
  db: Db,
  input: {
    role: Role;
    name: string | null;
    forMember: string | null;
    createdByDevice: string | null;
    expiresInHours: number;
    now: number;
  },
): { invitation: Invitation; code: string } {
  if (input.forMember !== null && memberById(db, input.forMember) === null) {
    throw new HttpError(404, { error: "member unknown" });
  }
  const code = newCode();
  const row = {
    id: newInvitationId(),
    codeHash: hashSecret(code),
    role: input.role,
    name: input.name,
    forMember: input.forMember,
    createdByDevice: input.createdByDevice,
    createdAt: input.now,
    expiresAt: input.now + input.expiresInHours * HOUR_MS,
  };
  insertInvitation(db, row);
  const stored = invitationById(db, row.id) as InvitationRow;
  return { invitation: toInvitation(stored), code };
}

export function listInvitations(db: Db, now: number): Invitation[] {
  return listOpenInvitations(db, now).map(toInvitation);
}

/** True when an open invitation was revoked; false when none with that id is open. */
export function revokeInvitation(db: Db, id: string, now: number): boolean {
  const row = invitationById(db, id);
  if (row === null || row.used_at !== null || row.revoked_at !== null) return false;
  setInvitationRevoked(db, id, now);
  return true;
}

/**
 * A join: the code's hash must match an open invitation. A device invitation adds a device to
 * its member; a member invitation creates the member; the bootstrap invitation creates the
 * admin, named by the body or `admin`. One transaction; the token appears once, in the answer.
 */
export function join(
  db: Db,
  input: { code: string; label: string; name?: string; now: number },
): { token: string; device: Device; member: Member } {
  return transaction(db, () => {
    const invitation = invitationByCodeHash(db, hashSecret(input.code));
    if (invitation === null) throw new HttpError(404, { error: "invitation unknown" });
    if (invitation.used_at !== null) throw new HttpError(410, { error: "invitation used" });
    if (invitation.revoked_at !== null) throw new HttpError(410, { error: "invitation revoked" });
    if (invitation.expires_at <= input.now)
      throw new HttpError(410, { error: "invitation expired" });

    let member: MemberRow;
    if (invitation.for_member !== null) {
      const existing = memberById(db, invitation.for_member);
      if (existing === null) throw new HttpError(404, { error: "member unknown" });
      member = existing;
    } else {
      const isBootstrap = invitation.name === null && invitation.created_by_device === null;
      const name = isBootstrap
        ? input.name === undefined
          ? "admin"
          : checkName(input.name)
        : invitation.name;
      const id = newMemberId();
      insertMember(db, { id, name: name as string, role: invitation.role, createdAt: input.now });
      member = memberById(db, id) as MemberRow;
    }
    const token = newToken();
    const device = {
      id: newDeviceId(),
      alias: newDeviceAlias(),
      memberId: member.id,
      tokenHash: hashSecret(token),
      label: input.label,
      createdAt: input.now,
    };
    insertDevice(db, device);
    setInvitationUsed(db, invitation.id, input.now, device.id);
    return {
      token,
      device: toDevice(deviceById(db, device.id) as DeviceRow),
      member: toMember(member),
    };
  });
}

export function listMembers(db: Db): Member[] {
  return listMemberRows(db).map(toMember);
}

export function listDevices(db: Db, memberId?: string): Device[] {
  return listDeviceRows(db, memberId).map(toDevice);
}

/** The only admin with `disabled_at` null and an unrevoked device, once `except` is taken out. */
export function isLastActiveAdmin(
  db: Db,
  memberId: string,
  except: { deviceId?: string } = {},
): boolean {
  const member = memberById(db, memberId);
  if (member === null || member.role !== "admin" || member.disabled_at !== null) return false;
  const others = countActiveAdminsWithDevices(db, { memberId });
  if (others > 0) return false;
  // The member is the one active admin: the act must leave them a device.
  if (except.deviceId === undefined) return true;
  return activeDeviceIdsOf(db, memberId).filter((id) => id !== except.deviceId).length === 0;
}

const lastAdminStays = () =>
  new HttpError(409, { error: "the last admin stays", hint: LAST_ADMIN_HINT });

/** Sets `revoked_at` and revokes the device's unused invitations; refused for the last admin's last device. */
export function revokeDevice(db: Db, id: string, now: number): void {
  transaction(db, () => {
    const device = deviceById(db, id);
    if (device === null) throw new HttpError(404, { error: "device unknown" });
    if (device.revoked_at === null && isLastActiveAdmin(db, device.member_id, { deviceId: id })) {
      throw lastAdminStays();
    }
    setDeviceRevoked(db, id, now);
    revokeInvitationsOfDevice(db, id, now);
  });
}

/** Revokes every device of the member and marks the member disabled; refused for the last admin. */
export function disableMember(db: Db, id: string, now: number): { devices: number } {
  return transaction(db, () => {
    const member = memberById(db, id);
    if (member === null) throw new HttpError(404, { error: "member unknown" });
    if (isLastActiveAdmin(db, id)) throw lastAdminStays();
    const devices = activeDeviceIdsOf(db, id);
    for (const deviceId of devices) {
      setDeviceRevoked(db, deviceId, now);
      revokeInvitationsOfDevice(db, deviceId, now);
    }
    if (member.disabled_at === null) setMemberDisabled(db, id, now);
    return { devices: devices.length };
  });
}

/** Clears the disable; the devices stay revoked, a device invitation brings the member back. */
export function enableMember(db: Db, id: string): void {
  transaction(db, () => {
    if (memberById(db, id) === null) throw new HttpError(404, { error: "member unknown" });
    setMemberDisabled(db, id, null);
  });
}

/** Refused when it would demote the last active admin. */
export function setRole(db: Db, id: string, role: Role, now: number): void {
  transaction(db, () => {
    const member = memberById(db, id);
    if (member === null) throw new HttpError(404, { error: "member unknown" });
    if (member.role === "admin" && role === "member") {
      if (isLastActiveAdmin(db, id)) throw lastAdminStays();
      // A demoted admin's open invitations vouch for a permission they no longer hold.
      for (const device of listDeviceRows(db, id)) revokeInvitationsOfDevice(db, device.id, now);
    }
    setMemberRole(db, id, role);
  });
}

/** What both edges hand to `mintInvitation`: a member by role and name, or a device for a member. */
export interface InviteInput {
  role?: unknown;
  name?: unknown;
  forMember?: unknown;
  expiresInHours?: unknown;
}

/** One invitation from either edge's input, with the audit detail both record. */
export function inviteFrom(
  db: Db,
  input: InviteInput,
  createdByDevice: string | null,
  now: number,
): { invitation: Invitation; code: string; detail: string } {
  const expiresInHours = checkExpiry(input.expiresInHours);
  const made =
    input.forMember !== undefined
      ? mintInvitation(db, {
          role: "member",
          name: null,
          forMember: typeof input.forMember === "string" ? input.forMember : "",
          createdByDevice,
          expiresInHours,
          now,
        })
      : mintInvitation(db, {
          role: checkRole(input.role),
          name: checkName(input.name),
          forMember: null,
          createdByDevice,
          expiresInHours,
          now,
        });
  const detail =
    made.invitation.forMember === null
      ? `${made.invitation.role} ${made.invitation.name}`
      : `device for ${made.invitation.forMember}`;
  return { ...made, detail };
}

/** A new token for the device, answered once; the old one is invalid from this transaction on. */
export function rotateToken(db: Db, deviceId: string): string {
  return transaction(db, () => {
    const token = newToken();
    setDeviceToken(db, deviceId, hashSecret(token));
    return token;
  });
}

/**
 * At the first start with no members and no open admin invitation: mints the bootstrap
 * invitation, hands the code to `print` (the only time it is seen) and audits it. True when
 * one was minted.
 */
export function bootstrapIfEmpty(db: Db, now: number, print: (code: string) => void): boolean {
  if (countMembers(db) > 0 || pendingBootstrapInvitation(db, now) !== null) return false;
  const { code } = mintInvitation(db, {
    role: "admin",
    name: null,
    forMember: null,
    createdByDevice: null,
    expiresInHours: BOOTSTRAP_HOURS,
    now,
  });
  audit(db, {
    at: now,
    source: "bootstrap",
    action: "bootstrap",
    detail: `valid ${BOOTSTRAP_HOURS} hours`,
  });
  print(code);
  return true;
}

export const BOOTSTRAP_VALID_HOURS = BOOTSTRAP_HOURS;
