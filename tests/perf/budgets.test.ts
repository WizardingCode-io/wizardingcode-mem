import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { MEMORY_KINDS } from "../../src/core/types.ts";
import { openDb, withWrite } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { hostBinary, runBinary } from "../helpers/binary.ts";

// A hook sits between the user and the model on every prompt. These budgets are for
// the compiled binary, measured from outside, against a project with 5,000 memories in
// a store that also holds 60,000 memories of other projects: one user, many repositories.

const MEMORIES = 5000;
const OTHER_PROJECTS = 6;
const OTHER_MEMORIES_EACH = 10_000;
const RUNS = 30;
const WINDOWS = process.platform === "win32";
const BASE_BUDGET_MS = {
  prompt: WINDOWS ? 200 : 80,
  "session-start": WINDOWS ? 300 : 150,
  "turn-end": WINDOWS ? 150 : 60,
  "file-read": WINDOWS ? 150 : 50,
  "tool-failed": WINDOWS ? 150 : 50,
};

const BASE_WORDS =
  "cache queue lease retry timeout migration index schema token session worker pool socket buffer parser render router handler adapter payload transcript hook judge memory branch commit merge rebase deploy build bundle binary signal process thread lock mutex pragma journal checkpoint vacuum trigger column table query cursor batch stream chunk header footer config setting flag option default override fallback breaker backoff jitter deadline budget latency throughput percentile sample metric counter gauge log trace span error warning failure crash restart shutdown startup install upgrade rollback snapshot backup restore export import".split(
    " ",
  );
// Real text has a long tail of words. A hundred would make every word common, and
// every search far more expensive than it is on real memories.
const WORDS = [
  ...BASE_WORDS,
  ...BASE_WORDS.flatMap((a) => BASE_WORDS.slice(0, 12).map((b) => `${a}${b}`)),
];

let binary: string;
let base: string;
let dataDir: string;
let project: string;

/** The file the agent reads: three memories about it sit among the 65,000. */
const READ_FILE = "src/pool/lease.ts";

/** Deterministic pseudo-random numbers: the same corpus on every run. */
function generator(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % max;
  };
}

beforeAll(() => {
  binary = hostBinary();
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-perf-")));
  dataDir = join(base, "data");
  project = join(base, "project");
  mkdirSync(project);

  const db = openDb({ dataDir, busyTimeoutMs: 5000 });
  const projectId = resolveProject(db, project).id;
  const others = Array.from({ length: OTHER_PROJECTS }, (_, i) => {
    const dir = join(base, `other-${i}`);
    mkdirSync(dir);
    return resolveProject(db, dir).id;
  });
  const next = generator(42);
  const word = () => WORDS[next(WORDS.length)] as string;
  const now = Date.now();
  withWrite(db, () => {
    const total = MEMORIES + OTHER_PROJECTS * OTHER_MEMORIES_EACH;
    for (let i = 0; i < total; i++) {
      const file = `src/${word()}/${word()}${i % 97}.ts`;
      insertMemory(db, {
        projectId: i < MEMORIES ? projectId : (others[(i - MEMORIES) % OTHER_PROJECTS] as number),
        kind: MEMORY_KINDS[i % MEMORY_KINDS.length] as (typeof MEMORY_KINDS)[number],
        title: `The ${word()} ${word()} must ${word()} before the ${word()} ${word()}${i}.`,
        body: `Because the ${word()} ${word()} would otherwise ${word()} the ${word()}.\nContext: why does the ${word()} ${word()} fail` as Redacted,
        terms: file,
        importance: 1 + (i % 5),
        branch: null,
        commit: null,
        origin: "manual",
        judge: "heuristic",
        judgeVersion: "1",
        sourceTurnId: null,
        files: [{ path: file, role: "changed" }],
        now: now - next(200) * 86_400_000,
      });
    }
    const linked = [
      ["gotcha", "A lease must be released before the pool reuses its socket."],
      ["fix", "SQLITE_BUSY on the lease table came from a missing busy_timeout."],
      ["decision", "Leases expire after thirty seconds, not on process exit."],
    ] as const;
    for (const [kind, title] of linked) {
      insertMemory(db, {
        projectId,
        kind,
        title,
        body: "Context: the pool lease in src/pool/lease.ts." as Redacted,
        terms: READ_FILE,
        importance: 4,
        branch: null,
        commit: null,
        origin: "manual",
        judge: "heuristic",
        judgeVersion: "1",
        sourceTurnId: null,
        files: [{ path: READ_FILE, role: "changed" }],
        now: now - 86_400_000,
      });
    }
  });
  db.close();
}, 180_000);

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] as number;
}

// On a developer's machine the tail is held to the budget. On a shared CI runner the
// tail is noise (one run gave 62 ms, the next 248 ms, with the same binary), so there
// the median is held to a budget with slack, and the tail is only reported.
const CI = Boolean(process.env.CI);
const SLACK = CI ? 2.5 : 1;
function judged(samples: number[]): { shown: string; value: number } {
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  return { shown: `p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`, value: CI ? p50 : p95 };
}

async function measure(
  event: keyof typeof BUDGET_MS,
  payload: (run: number) => Record<string, unknown>,
): Promise<{ shown: string; value: number; outputs: string[] }> {
  const samples: number[] = [];
  const outputs: string[] = [];
  // One run first, unmeasured: the first start of a new binary pays one-off costs.
  for (let run = -1; run < RUNS; run++) {
    const result = await runBinary(binary, ["hook", "claude-code", event], {
      input: JSON.stringify({ session_id: `perf-${event}`, cwd: project, ...payload(run) }),
      env: {
        WIZARDINGCODE_MEM_DATA_DIR: dataDir,
        WIZARDINGCODE_MEM_DISTILL: "off",
        WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
      },
    });
    expect([result.exitCode, result.stderr]).toEqual([0, ""]);
    if (run >= 0) {
      samples.push(result.ms);
      outputs.push(result.stdout);
    }
  }
  return { ...judged(samples), outputs };
}

const BUDGET_MS = {
  prompt: BASE_BUDGET_MS.prompt * SLACK,
  "session-start": BASE_BUDGET_MS["session-start"] * SLACK,
  "turn-end": BASE_BUDGET_MS["turn-end"] * SLACK,
  "file-read": BASE_BUDGET_MS["file-read"] * SLACK,
  "tool-failed": BASE_BUDGET_MS["tool-failed"] * SLACK,
};

describe(`hook latency with ${MEMORIES} memories`, () => {
  test(`a prompt is answered within ${BUDGET_MS.prompt} ms`, async () => {
    const next = generator(7);
    const word = () => WORDS[next(WORDS.length)] as string;
    // A real prompt is a paragraph, not a question: twenty or so searchable words.
    const result = await measure("prompt", (run) => ({
      prompt_id: `p${run}`,
      prompt: `why does the ${word()} ${word()} ${word()} when the ${word()} ${word()} is slow? I checked the ${word()} and the ${word()}, the ${word()} looks fine, but the ${word()} ${word()} keeps hitting the ${word()} ${word()} and then the ${word()} ${word()} fails on the ${word()} ${word()}. Could the ${word()} ${word()} be the problem?`,
    }));
    console.log(`prompt: ${result.shown}`);
    // The measurement only means something if retrieval actually ran and found things.
    expect(result.outputs.filter((out) => out !== "").length).toBeGreaterThan(RUNS / 2);
    expect(result.value).toBeLessThanOrEqual(BUDGET_MS.prompt);
  }, 120_000);

  test(`a session start is answered within ${BUDGET_MS["session-start"]} ms`, async () => {
    const result = await measure("session-start", () => ({ source: "startup" }));
    console.log(`session-start: ${result.shown}`);
    expect(result.outputs.every((out) => out.includes("Known about this project"))).toBe(true);
    expect(result.value).toBeLessThanOrEqual(BUDGET_MS["session-start"]);
  }, 120_000);

  test(`a turn end returns within ${BUDGET_MS["turn-end"]} ms`, async () => {
    const result = await measure("turn-end", (run) => ({
      prompt_id: `end${run}`,
      last_assistant_message: "Fixed: the root cause was a missing release in src/pool.ts.",
    }));
    console.log(`turn-end: ${result.shown}`);
    expect(result.value).toBeLessThanOrEqual(BUDGET_MS["turn-end"]);
  }, 120_000);

  // Tool-call events: a new session per run, so that each run looks the notes up afresh
  // instead of finding them already shown in this context.
  test(`a file read is answered within ${BUDGET_MS["file-read"]} ms`, async () => {
    const result = await measure("file-read", (run) => ({
      session_id: `perf-file-read-${run}`,
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: join(project, READ_FILE) },
      tool_response: { type: "text", file: { filePath: join(project, READ_FILE) } },
      tool_use_id: `toolu_read_${run}`,
    }));
    console.log(`file-read: ${result.shown}`);
    expect(result.outputs.every((out) => out.includes(READ_FILE))).toBe(true);
    expect(result.value).toBeLessThanOrEqual(BUDGET_MS["file-read"]);
  }, 120_000);

  test(`a failed command is answered within ${BUDGET_MS["tool-failed"]} ms`, async () => {
    const next = generator(11);
    const word = () => WORDS[next(WORDS.length)] as string;
    // About twenty searchable words, one of them an identifier a memory shares.
    const result = await measure("tool-failed", (run) => ({
      session_id: `perf-tool-failed-${run}`,
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "bun test", description: "Run tests" },
      tool_use_id: `toolu_bash_${run}`,
      error: `Exit code 1\nerror: SQLITE_BUSY while the ${word()} ${word()} held the lease table; ${word()} ${word()} ${word()} failed in the ${word()} ${word()} after ${word()} ${word()} and ${word()} ${word()} ${word()} ${word()} retries`,
      is_interrupt: false,
    }));
    console.log(`tool-failed: ${result.shown}`);
    expect(result.outputs.filter((out) => out.includes("SQLITE_BUSY")).length).toBeGreaterThan(
      RUNS / 2,
    );
    expect(result.value).toBeLessThanOrEqual(BUDGET_MS["tool-failed"]);
  }, 120_000);
});
