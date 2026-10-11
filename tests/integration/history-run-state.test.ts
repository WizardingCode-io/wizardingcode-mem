import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withHistoryRun } from "../../src/history/run-state.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { claimLease, getMeta, leaseActive, setMeta } from "../../src/store/meta.ts";

let base: string;
let db: Db;
const NOW = Date.UTC(2026, 9, 11, 12);

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-run-state-")));
  db = openDb({ dataDir: base, busyTimeoutMs: 2000 });
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

describe("withHistoryRun", () => {
  test("a failure while recording the start still releases the lease", async () => {
    db.run(
      `CREATE TRIGGER no_state BEFORE INSERT ON meta WHEN NEW.key = 'history.run.state'
       BEGIN SELECT RAISE(ABORT, 'cannot record'); END`,
    );
    let ran = false;
    await expect(
      withHistoryRun(
        db,
        () => NOW,
        () => {
          ran = true;
          return {};
        },
      ),
    ).rejects.toThrow();
    expect(ran).toBe(false);
    expect(leaseActive(db, "history.lease", NOW)).toBe(false);
    expect(getMeta(db, "history.lease")).toBeNull();
  });

  test("the previous run's report and finish time are gone while the new one works", async () => {
    setMeta(db, "history.run.report", '{"old":true}');
    setMeta(db, "history.run.finished_at", "123");
    let seen: [string | null, string | null] = ["x", "x"];
    await withHistoryRun(
      db,
      () => NOW,
      () => {
        seen = [getMeta(db, "history.run.report"), getMeta(db, "history.run.finished_at")];
        return { fresh: true };
      },
    );
    expect(seen).toEqual([null, null]);
    expect(getMeta(db, "history.run.report")).toBe('{"fresh":true}');
  });

  test("a run that lost its lease stops at the next renewal and leaves the lease to its new owner", async () => {
    let afterRenew = false;
    await expect(
      withHistoryRun(
        db,
        () => NOW,
        (renew) => {
          setMeta(
            db,
            "history.lease",
            JSON.stringify({ owner: `${process.pid}-other`, until: NOW + 60_000 }),
          );
          renew();
          afterRenew = true;
          return {};
        },
      ),
    ).rejects.toThrow(/lease/);
    expect(afterRenew).toBe(false);
    // The run that lost the lease leaves the state to the one that has it.
    expect(getMeta(db, "history.run.state")).toBe("running");
    expect(leaseActive(db, "history.lease", NOW)).toBe(true);
    expect(claimLease(db, "history.lease", `${process.pid}-third`, NOW, 1000)).toBe(false);
  });
});
