import { describe, expect, test } from "bun:test";
import { LOGGED_UID_MAX, type PushResult, summarizePush } from "../../src/team/push.ts";

describe("the push summary for the request's log line", () => {
  test("counts by result, lists the refusals with reason and rule, and clips a refused uid to LOGGED_UID_MAX", () => {
    const long = "u".repeat(LOGGED_UID_MAX + 100);
    const results = [
      { uid: "a", result: "applied", revision: 1, hash: "h" },
      { uid: "b", result: "stale", current: { revision: 2, hash: "h2" }, appliedAs: null },
      { uid: "c", result: "withdrawn" },
      { uid: "d", result: "refused", reason: "secret", rule: "aws-key" },
      { uid: long, result: "refused", reason: "shape" },
    ] as unknown as PushResult[];
    expect(summarizePush(results)).toEqual({
      applied: 1,
      stale: 1,
      refused: 2,
      withdrawn: 1,
      refusals: [
        { uid: "d", reason: "secret", rule: "aws-key" },
        { uid: "u".repeat(LOGGED_UID_MAX), reason: "shape" },
      ],
    });
    expect(LOGGED_UID_MAX).toBe(256);
  });
});
