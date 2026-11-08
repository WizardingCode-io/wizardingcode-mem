import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCode } from "../../src/adapters/claude-code/adapter.ts";
import type { HookInput } from "../../src/adapters/types.ts";
import type { ProjectRef } from "../../src/core/project.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { formatStatus, statusReport } from "../../src/status/report.ts";
import { type Db, openDb } from "../../src/store/db.ts";

let base: string;
let project: string;
let db: Db;
let clock: number;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-status-skips-")));
  project = join(base, "project");
  mkdirSync(project);
  db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
  clock = 1_700_000_000_000;
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

function hook(event: "prompt" | "turn-end", extra: Partial<HookInput>): void {
  clock += 1000;
  handleHook({ db, now: () => clock, spawnDistill: () => {} }, claudeCode, {
    agent: "claude-code",
    event,
    sessionId: "s1",
    cwd: project,
    turnId: null,
    transcriptPath: null,
    prompt: null,
    finalText: null,
    source: null,
    toolFile: null,
    toolError: null,
    subagent: false,
    ...extra,
  });
}

/** Queues one turn per reason given and marks it skipped with it (null: skipped before reasons). */
function skippedTurns(reasons: (string | null)[]): ProjectRef {
  reasons.forEach((_, i) => {
    hook("prompt", { turnId: `p${i}`, prompt: `question ${i}` });
    hook("turn-end", { turnId: `p${i}`, finalText: `answer ${i}` });
  });
  const ids = db.query<{ id: number }, []>("SELECT id FROM turns ORDER BY id").all();
  ids.forEach(({ id }, i) => {
    db.run("UPDATE turns SET state = 'skipped', last_error = ? WHERE id = ?", [
      reasons[i] ?? null,
      id,
    ]);
  });
  const row = db
    .query<{ id: number; key: string; name: string }, []>("SELECT id, key, name FROM projects")
    .get();
  if (row === null) throw new Error("no project");
  return { ...row, root: project, branch: null, commit: null, disabled: false };
}

test("status counts the project's skipped turns by reason, those with none as unknown", () => {
  const ref = skippedTurns([
    "skip:no-title",
    "skip:no-title",
    "skip:not-worth",
    "skip:empty",
    "skip:saved",
    null,
  ]);
  const report = statusReport(db, ref, "/d");
  expect(report.turns.skipped).toBe(6);
  expect(report.turns.skippedBy).toEqual({
    saved: 1,
    empty: 1,
    notWorth: 1,
    noTitle: 2,
    unknown: 1,
  });
  expect(formatStatus(report)).toContain(
    "turns     0 distilled · 6 skipped (saved 1, empty 1, not-worth 1, no-title 2, unknown 1) · 0 failed · 0 queued",
  );
});

test("the status line names only the reasons that occurred, and nothing when none was skipped", () => {
  const ref = skippedTurns(["skip:no-title"]);
  expect(formatStatus(statusReport(db, ref, "/d"))).toContain(
    "turns     0 distilled · 1 skipped (no-title 1) · 0 failed · 0 queued",
  );
  db.run("UPDATE turns SET state = 'done', last_error = NULL");
  expect(formatStatus(statusReport(db, ref, "/d"))).toContain(
    "turns     1 distilled · 0 skipped · 0 failed · 0 queued",
  );
});

test("only the project's own skipped turns count, and a reason it does not know is unknown", () => {
  const ref = skippedTurns(["skip:bogus", "skip:constructor"]);
  const other = join(base, "other");
  mkdirSync(other);
  hook("prompt", { cwd: other, sessionId: "s2", turnId: "o1", prompt: "question in other" });
  hook("turn-end", { cwd: other, sessionId: "s2", turnId: "o1", finalText: "answer in other" });
  db.run("UPDATE turns SET state = 'skipped', last_error = 'skip:no-title' WHERE project_id <> ?", [
    ref.id,
  ]);
  expect(db.query("SELECT count(*) AS n FROM turns WHERE project_id <> ?").get(ref.id)).toEqual({
    n: 1,
  });
  const report = statusReport(db, ref, "/d");
  expect(report.turns.skipped).toBe(2);
  expect(report.turns.skippedBy).toEqual({
    saved: 0,
    empty: 0,
    notWorth: 0,
    noTitle: 0,
    unknown: 2,
  });
});
