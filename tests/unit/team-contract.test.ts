import { describe, expect, test } from "bun:test";
import { projectFolderName } from "../../src/modules/knowledge/repo.ts";
import { OUTGOING_ENTRY_KEYS, OUTGOING_MEMORY_KEYS } from "../../src/sharing/types.ts";
import { isComponent } from "../../src/sync/naming.ts";
import {
  ACCEPTED_CONTRACTS,
  CONTRACT,
  CONTRACT_FINGERPRINT,
  contractFingerprint,
  fingerprintOf,
  PUSH_REASONS,
  RESULT_SHAPES,
  repoFolder,
} from "../../src/team/contract.ts";

/**
 * The pair this test pins, written here and not read from the module: a change to the key
 * lists, the shapes or the reasons changes the fingerprint, and this line then fails until
 * `CONTRACT` moves on and the new pair is written beside it.
 */
const PINNED: Record<number, string> = {
  1: "7a5bb7c74b149f93f7a3aac1bb32b54e501ec9765d6724b6e5ee791433f69f1d",
  2: "ac340c80764de18d6810837742f07786d4bd7cbe43bd205905ac278d0277e911",
};

describe("the contract fingerprint pins part 4's key lists, the result shapes and the reason codes", () => {
  test("the computed fingerprint equals the one pinned here for the current contract", () => {
    expect(CONTRACT).toBe(2);
    expect(contractFingerprint()).toBe(PINNED[CONTRACT] as string);
    expect(CONTRACT_FINGERPRINT).toBe(PINNED[CONTRACT] as string);
    expect(ACCEPTED_CONTRACTS).toEqual([1, 2]);
  });

  test("contract 2 adds the name shapes, nameId on a feed item and the two name reasons (ADR 0028)", () => {
    expect(RESULT_SHAPES.nameItem).toEqual([
      "alias",
      "createdAt",
      "createdBy",
      "entries",
      "id",
      "lastChangeAt",
      "memories",
    ]);
    expect(RESULT_SHAPES.namesPage).toEqual(["items", "more", "next"]);
    // The two 409 bodies the client reads, pinned with the bump (ADR 0027's debt, ADR 0028).
    expect(RESULT_SHAPES.contractRefusal).toEqual(["accepted", "error", "instance", "serverId"]);
    expect(RESULT_SHAPES.nameConflict).toEqual(["error", "instance", "name", "serverId"]);
    expect(RESULT_SHAPES.feedItem).toContain("nameId");
    expect(PUSH_REASONS).toContain("name");
    expect(PUSH_REASONS).toContain("name-purged");
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

  test("repoFolder: a shared name's folder is its slug and a hash of the alias, apart from any remote's (ADR 0028)", () => {
    const named = repoFolder("project", "name:wizardingcode", null);
    expect(named).toBe(
      `projects/wizardingcode-${projectFolderName("name:wizardingcode").slice(0, 8)}`,
    );
    expect(named).not.toBe(repoFolder("project", "remote:github.com/x/wizardingcode", null));
    const long = `name:${"x".repeat(80)}`;
    const folders = [
      named,
      repoFolder("project", "remote:github.com/x/wizardingcode", null),
      repoFolder("project", long, null),
    ];
    for (const folder of folders) {
      expect(folder.startsWith("projects/")).toBe(true);
      expect(isComponent("project-folder", folder.slice("projects/".length))).toBe(true);
    }
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
      "name",
      "name-purged",
      "rate",
      "storage",
    ]);
  });
});
