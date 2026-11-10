import { describe, expect, test } from "bun:test";
import { OUTGOING_ENTRY_KEYS, OUTGOING_MEMORY_KEYS } from "../../src/sharing/types.ts";
import {
  ACCEPTED_CONTRACTS,
  CONTRACT,
  CONTRACT_FINGERPRINT,
  contractFingerprint,
  fingerprintOf,
  PUSH_REASONS,
  RESULT_SHAPES,
} from "../../src/team/contract.ts";

describe("the contract fingerprint pins part 4's key lists, the result shapes and the reason codes", () => {
  test("the computed fingerprint equals the pinned one", () => {
    expect(contractFingerprint()).toBe(CONTRACT_FINGERPRINT);
    expect(CONTRACT).toBe(1);
    expect(ACCEPTED_CONTRACTS).toEqual([1]);
  });

  test("a changed key list, shape or reason changes the fingerprint", () => {
    const base = fingerprintOf({
      entry: OUTGOING_ENTRY_KEYS,
      memory: OUTGOING_MEMORY_KEYS,
      reasons: PUSH_REASONS,
      shapes: RESULT_SHAPES,
    });
    expect(base).toBe(CONTRACT_FINGERPRINT);
    expect(
      fingerprintOf({
        entry: [...OUTGOING_ENTRY_KEYS, "extra"],
        memory: OUTGOING_MEMORY_KEYS,
        reasons: PUSH_REASONS,
        shapes: RESULT_SHAPES,
      }),
    ).not.toBe(base);
    expect(
      fingerprintOf({
        entry: OUTGOING_ENTRY_KEYS,
        memory: OUTGOING_MEMORY_KEYS,
        reasons: [...PUSH_REASONS, "other"],
        shapes: RESULT_SHAPES,
      }),
    ).not.toBe(base);
  });

  test("the reason codes are the fixed list", () => {
    expect([...PUSH_REASONS]).toEqual([
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
    ]);
  });
});
