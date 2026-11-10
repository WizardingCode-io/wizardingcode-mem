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

/**
 * The pair this test pins, written here and not read from the module: a change to the key
 * lists, the shapes or the reasons changes the fingerprint, and this line then fails until
 * `CONTRACT` moves on and the new pair is written beside it.
 */
const PINNED: Record<number, string> = {
  1: "7a5bb7c74b149f93f7a3aac1bb32b54e501ec9765d6724b6e5ee791433f69f1d",
};

describe("the contract fingerprint pins part 4's key lists, the result shapes and the reason codes", () => {
  test("the computed fingerprint equals the one pinned here for the current contract", () => {
    expect(CONTRACT).toBe(1);
    expect(contractFingerprint()).toBe(PINNED[CONTRACT] as string);
    expect(CONTRACT_FINGERPRINT).toBe(PINNED[CONTRACT] as string);
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
