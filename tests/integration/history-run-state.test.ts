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
        "import",
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
      "import",
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
    let clock = NOW;
    await expect(
      withHistoryRun(
        db,
        () => clock,
        "import",
        (renew) => {
          setMeta(
            db,
            "history.lease",
            JSON.stringify({ owner: `${process.pid}-other`, until: NOW + 60_000 }),
          );
          clock += 10_000;
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

  test("renewals within ten seconds of the last one write nothing", async () => {
    let clock = NOW;
    const until = () =>
      (JSON.parse(getMeta(db, "history.lease") ?? "{}") as { until: number }).until;
    const seen: number[] = [];
    await withHistoryRun(
      db,
      () => clock,
      "import",
      (renew) => {
        seen.push(until());
        clock += 4_000;
        renew();
        seen.push(until());
        clock += 6_000;
        renew();
        seen.push(until());
        return {};
      },
    );
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(NOW + 10_000 + 120_000);
  });

  test("a renewal that meets a busy database is logged and the run goes on", async () => {
    const quick = openDb({ dataDir: base, busyTimeoutMs: 1 });
    const other = openDb({ dataDir: base, busyTimeoutMs: 2000 });
    let clock = NOW;
    try {
      const outcome = await withHistoryRun(
        quick,
        () => clock,
        "import",
        (renew) => {
          other.run("BEGIN IMMEDIATE");
          try {
            clock += 30_000;
            renew();
          } finally {
            other.run("COMMIT");
          }
          return { went: true };
        },
      );
      expect(outcome).toEqual({ report: { went: true } });
      expect(getMeta(db, "history.run.state")).toBe("done");
    } finally {
      other.close();
      quick.close();
    }
  });

  test("a lease that cannot be released does not hide the error that ended the run", async () => {
    db.run(
      `CREATE TRIGGER keep_lease BEFORE DELETE ON meta WHEN OLD.key = 'history.lease'
       BEGIN SELECT RAISE(ABORT, 'cannot release'); END`,
    );
    await expect(
      withHistoryRun(
        db,
        () => NOW,
        "import",
        () => {
          throw new Error("the work broke");
        },
      ),
    ).rejects.toThrow("the work broke");
  });

  test("records the run's kind; an import also records itself apart, which an index run leaves alone", async () => {
    let during: (string | null)[] = [];
    await withHistoryRun(
      db,
      () => NOW,
      "import",
      () => {
        during = [getMeta(db, "history.run.kind"), getMeta(db, "history.import.state")];
        return {};
      },
    );
    expect(during).toEqual(["import", "running"]);
    expect(getMeta(db, "history.import.state")).toBe("done");
    expect(getMeta(db, "history.import.started_at")).toBe(String(NOW));
    expect(getMeta(db, "history.import.finished_at")).toBe(String(NOW));

    await withHistoryRun(
      db,
      () => NOW + 1000,
      "index",
      () => ({}),
    );
    expect(getMeta(db, "history.run.kind")).toBe("index");
    expect(getMeta(db, "history.run.state")).toBe("done");
    expect(getMeta(db, "history.import.state")).toBe("done");
    expect(getMeta(db, "history.import.finished_at")).toBe(String(NOW));

    await expect(
      withHistoryRun(
        db,
        () => NOW + 2000,
        "import",
        () => {
          throw new Error("broke");
        },
      ),
    ).rejects.toThrow("broke");
    expect(getMeta(db, "history.import.state")).toBe("failed");
  });
});
