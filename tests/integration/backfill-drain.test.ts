import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BackfillReport, backfillLine, runBackfill } from "../../src/backfill/run.ts";
import { heuristicJudge } from "../../src/judge/heuristic.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { claimDrain, releaseDrain } from "../../src/store/meta.ts";

// A history import shares the queue with the live drain the hooks start. Finding the drain
// held is not finding the queue empty: the import waits for it, within its time, and says
// so when it runs out of time with turns still waiting.

let base: string;
let db: Db;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wcmem-backfill-drain-")));
  mkdirSync(join(base, "shop"));
  db = openDb({ dataDir: join(base, "mem"), busyTimeoutMs: 2000 });
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

const line = (cwd: string, o: object) =>
  JSON.stringify({ sessionId: "s1", cwd, gitBranch: "main", isSidechain: false, ...o });
function transcript(n: number): string {
  const root = join(base, "claude");
  mkdirSync(join(root, "-shop"), { recursive: true });
  const cwd = join(base, "shop");
  const start = Date.now() - 3 * 86_400_000;
  const items: string[] = [];
  for (let i = 0; i < n; i++) {
    const at = new Date(start + i * 60_000).toISOString();
    items.push(
      line(cwd, {
        type: "user",
        promptId: `p${i}`,
        timestamp: at,
        message: { role: "user", content: `why does module${i} fail under load?` },
      }),
      line(cwd, {
        type: "assistant",
        timestamp: at,
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Fixed: the root cause was that \`worker${i}Pool\` never released connection ${i}.`,
            },
          ],
        },
      }),
    );
  }
  writeFileSync(join(root, "-shop", "s1.jsonl"), `${items.join("\n")}\n`);
  return root;
}

/** A clock that only moves when the import waits. */
function clock() {
  let at = Date.now();
  const waits: number[] = [];
  return {
    now: () => at,
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
      at += ms;
    },
  };
}

const run = (root: string, time: ReturnType<typeof clock>, maxMs: number, onWait?: () => void) =>
  runBackfill(
    {
      db,
      judge: heuristicJudge,
      now: time.now,
      roots: { claudeCode: root, codex: join(base, "codex") },
      sleep: async (ms) => {
        await time.sleep(ms);
        onWait?.();
      },
    },
    { days: 30, maxMs, agents: ["claude-code"] },
  );

describe("history import and the live drain", () => {
  test("an empty queue ends the import at once, without waiting", async () => {
    const time = clock();
    const report = await run(transcript(0), time, 60_000);
    expect(time.waits).toEqual([]);
    expect(report).toMatchObject({ distilled: 0, remaining: 0, drainHeld: false });
  });

  test("a drain held by another process is waited for, then the import distils everything", async () => {
    const root = transcript(5);
    const time = clock();
    claimDrain(db, "live-drain", time.now(), 120_000);
    const report = await run(root, time, 60_000, () => releaseDrain(db, "live-drain"));
    expect(time.waits.length).toBeGreaterThan(0);
    expect(report).toMatchObject({ queued: 5, distilled: 5, remaining: 0, drainHeld: false });
  });

  test("held for the whole time: the turns remain, and the report says another process was distilling", async () => {
    const root = transcript(5);
    const time = clock();
    claimDrain(db, "live-drain", time.now(), 10 * 60_000);
    const report = await run(root, time, 30_000);
    expect(time.waits.length).toBeGreaterThan(1);
    expect(time.waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(30_000);
    expect(report).toMatchObject({ queued: 5, distilled: 0, remaining: 5, drainHeld: true });
    expect(backfillLine(report)).toContain(
      "5 remaining because another process was distilling; run it again to continue",
    );
  });

  test("the report line, when nothing was held", () => {
    const report: BackfillReport = {
      transcripts: 1,
      queued: 2,
      known: 0,
      skipped: 0,
      skippedBy: { window: 0, host: 0, disabled: 0, unresolved: 0 },
      distilled: 2,
      ready: 1,
      remaining: 0,
      drainHeld: false,
    };
    expect(backfillLine(report)).toBe(
      "history: 1 transcripts, 2 queued, 0 known, 0 skipped (window 0, host 0, disabled 0, unresolved 0), 2 distilled, 0 remaining, 1 projects ready for replace-imports\n",
    );
  });
});
