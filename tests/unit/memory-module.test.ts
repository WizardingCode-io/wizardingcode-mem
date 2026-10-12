import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { MOMENT_BUDGET } from "../../src/engine/budget.ts";
import type { Moment, MomentInput } from "../../src/engine/module.ts";
import { memory } from "../../src/modules/memory/index.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { touchSession } from "../../src/store/sessions.ts";
import { completeTurn, openTurn } from "../../src/store/turns.ts";

// Under F5 memory gets what the other modules leave, so it must fit any budget it is
// given (F6): never longer than the budget, and never recording as shown a note that it
// did not put in its text.

let base: string;
let db: Db;
let projectId: number;
const NOW = Date.UTC(2026, 9, 12);
const MOMENTS: Moment[] = ["session-start", "prompt", "file-read", "tool-failed"];
const BUDGETS = [0, 40, 120, 300, 450, 600, 800, 1000, 1200, 1800, 2400, 3000, 4200];

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "wizardingcode-mem-memory-module-"));
  db = openDb({ dataDir: base, busyTimeoutMs: 2000 });
  projectId = resolveProject(db, base, NOW).id;
  const sizes = [60, 180, 320, 480, 650];
  for (const [i, size] of sizes.entries()) {
    insertMemory(db, {
      projectId,
      kind: i % 2 === 0 ? "gotcha" : "fix",
      title: `Login token refresh fails after expiry ${i}`,
      body: `The login token refresh fails when the expiry passes. ${"detail ".repeat(size / 7)}` as Redacted,
      terms: "",
      importance: 5 - (i % 3),
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [{ path: "src/auth/login-token.ts", role: "changed" }],
      now: NOW - i,
    });
  }
  // A long last turn: the brief's "where things stood" block alone is several hundred characters.
  const previous = touchSession(db, {
    agent: "claude-code",
    agentSessionId: "before",
    projectId,
    cwd: base,
    branch: null,
    now: NOW - 10_000,
  });
  const turn = {
    sessionId: previous.id,
    projectId,
    agentTurnId: "t0",
    transcriptPath: null,
    branch: null,
    commit: null,
    now: NOW - 10_000,
  };
  openTurn(db, turn, "Why does the login token refresh fail? ".repeat(10) as Redacted);
  completeTurn(
    db,
    turn,
    "The login token refresh failed because of expiry. ".repeat(14) as Redacted,
  );
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

let sessions = 0;
function contribute(moment: Moment, budgetChars: number) {
  const session = touchSession(db, {
    agent: "claude-code",
    agentSessionId: `s${++sessions}`,
    projectId,
    cwd: base,
    branch: null,
    now: NOW,
  });
  const input: MomentInput = {
    db,
    moment,
    projectId,
    branch: null,
    root: base,
    projectRoot: base,
    sessionId: session.id,
    epoch: session.contextEpoch,
    prompt: moment === "prompt" ? "why does the login token refresh fail after expiry" : null,
    path: moment === "file-read" ? "src/auth/login-token.ts" : null,
    error: moment === "tool-failed" ? "Error: login token refresh fails after expiry" : null,
    now: NOW,
    budgetChars,
  };
  const text = memory.contribute?.(input) ?? null;
  const recorded = db
    .query<{ id: number }, [number]>(
      "SELECT memory_id AS id FROM injections WHERE session_id = ? ORDER BY memory_id",
    )
    .all(session.id)
    .map((row) => row.id);
  const shown = [...(text ?? "").matchAll(/#(\d+) \[/g)].map((match) => Number(match[1]));
  return { text, recorded, shown: shown.sort((a, b) => a - b) };
}

describe("memory under a reduced budget", () => {
  for (const moment of MOMENTS) {
    test(`${moment}: never longer than its budget, and records only what it shows`, () => {
      for (const budget of BUDGETS) {
        const { text, recorded, shown } = contribute(moment, budget);
        expect({ budget, length: (text ?? "").length <= budget }).toEqual({ budget, length: true });
        expect({ budget, recorded }).toEqual({ budget, recorded: shown });
      }
    });

    test(`${moment}: at the whole budget it has something to say`, () => {
      const { text, shown } = contribute(moment, MOMENT_BUDGET[moment]);
      expect(text).not.toBeNull();
      expect(shown.length).toBeGreaterThan(0);
    });
  }
});
