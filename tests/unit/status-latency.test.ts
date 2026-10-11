import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookLatency } from "../../src/status/report.ts";
import { type Db, openDb } from "../../src/store/db.ts";

let base: string;
let db: Db;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "wizardingcode-mem-latency-"));
  db = openDb({ dataDir: base, busyTimeoutMs: 2000 });
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

const run = (event: string, ms: number) =>
  db.run(
    "INSERT INTO hook_runs (at, agent, event, ms, outcome) VALUES (1, 'claude-code', ?, ?, 'ok')",
    [event, ms],
  );

test("each event keeps its own last 200 runs: frequent file reads do not push out a prompt", () => {
  run("prompt", 40);
  for (let i = 0; i < 250; i++) run("file-read", 10);
  const { latency } = hookLatency(db);
  expect(latency.find((row) => row.event === "prompt")?.runs).toBe(1);
  expect(latency.find((row) => row.event === "file-read")?.runs).toBe(200);
});
