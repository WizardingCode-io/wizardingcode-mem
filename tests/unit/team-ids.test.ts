import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  BASE32,
  CODE,
  CODE_ALPHABET,
  hashSecret,
  isLoopback,
  MEMORY_UID,
  memoryKey,
  newCode,
  newDeviceAlias,
  newDeviceId,
  newHexId,
  newInvitationId,
  newMemberId,
  newToken,
  OPERATOR,
  OPERATOR_ID,
  REQUEST_ID,
  randomBase32,
  sameHash,
  splitMemoryKey,
  TOKEN,
} from "../../src/team/ids.ts";

describe("the team's ids, tokens and codes", () => {
  test("a device token is wcm1_ and 43 base64url characters, fresh every time", () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(TOKEN);
    expect(b).toMatch(TOKEN);
    expect(a).not.toBe(b);
    expect(a).not.toContain("=");
  });

  test("an invitation code is wci1_ and 26 upper-case base32 characters", () => {
    const code = newCode();
    expect(code).toMatch(CODE);
    for (const char of code.slice(5)) expect(CODE_ALPHABET).toContain(char);
    expect(newCode()).not.toBe(code);
  });

  test("ids are lower-case base32 of their length, and the hex id is 16 hex characters", () => {
    expect(newMemberId()).toMatch(/^[a-z2-7]{12}$/);
    expect(newDeviceId()).toMatch(/^[a-z2-7]{12}$/);
    expect(newInvitationId()).toMatch(/^[a-z2-7]{12}$/);
    expect(newDeviceAlias()).toMatch(/^[a-z2-7]{8}$/);
    expect(newHexId()).toMatch(/^[0-9a-f]{16}$/);
    const sample = randomBase32(200);
    for (const char of sample) expect(BASE32).toContain(char);
    expect(sample).toHaveLength(200);
  });

  test("hashSecret is the SHA-256 of the UTF-8 bytes, and sameHash compares in constant time", () => {
    const secret = newToken();
    expect(hashSecret(secret)).toBe(createHash("sha256").update(secret, "utf8").digest("hex"));
    expect(sameHash(hashSecret(secret), hashSecret(secret))).toBe(true);
    expect(sameHash(hashSecret(secret), hashSecret(newToken()))).toBe(false);
    expect(sameHash("abc", "abcd")).toBe(false);
    expect(sameHash("", "")).toBe(true);
  });

  test("a client's request id is 1 to 64 safe characters", () => {
    expect("req-1_A").toMatch(REQUEST_ID);
    expect("a".repeat(64)).toMatch(REQUEST_ID);
    expect("a".repeat(65)).not.toMatch(REQUEST_ID);
    expect("with space").not.toMatch(REQUEST_ID);
    expect("").not.toMatch(REQUEST_ID);
  });

  test("a memory's key joins the device id and the uid and splits at the first colon; the uid grammar; the operator", () => {
    expect(memoryKey("abcdefghijkl", "a1b2c3d4:17")).toBe("abcdefghijkl:a1b2c3d4:17");
    expect(splitMemoryKey("abcdefghijkl:a1b2c3d4:17")).toEqual({
      deviceId: "abcdefghijkl",
      uid: "a1b2c3d4:17",
    });
    expect(MEMORY_UID.test("a1b2c3d4:17")).toBe(true);
    for (const bad of ["a1b2c3d4", "a1b2c3d4:", "A1B2C3D4:1", "a1b2c3d4:1@2", "a1b2c3d:1", "x:1"]) {
      expect({ bad, ok: MEMORY_UID.test(bad) }).toEqual({ bad, ok: false });
    }
    expect(OPERATOR).toEqual({ memberId: OPERATOR_ID, deviceId: "cli" });
    expect(OPERATOR_ID).toBe("operator");
  });

  test("loopback is 127.0.0.0/8, ::1 and localhost", () => {
    for (const host of ["127.0.0.1", "127.0.0.2", "127.255.0.9", "::1", "localhost", "LOCALHOST"]) {
      expect({ host, loopback: isLoopback(host) }).toEqual({ host, loopback: true });
    }
    for (const host of ["0.0.0.0", "10.0.0.5", "128.0.0.1", "::", "example.com", ""]) {
      expect({ host, loopback: isLoopback(host) }).toEqual({ host, loopback: false });
    }
  });
});
