import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { MEMORY_KINDS } from "../../src/core/types.ts";
import {
  readRepoState,
  rebuildRepo,
  replaceRepoRows,
  searchEntries,
} from "../../src/modules/knowledge/index-store.ts";
import { CANDIDATES, knowledgeEvidence } from "../../src/modules/knowledge/policy.ts";
import { ensureRepo, openRepo } from "../../src/modules/knowledge/repo.ts";
import { openStore } from "../../src/modules/knowledge/store-open.ts";
import type { KnowledgeStore, Repo, ScopeRef } from "../../src/modules/knowledge/types.ts";
import { visibleRepos } from "../../src/modules/knowledge/visible.ts";
import { buildQuery, matchTerms } from "../../src/retrieve/query.ts";
import { openDb, withWrite } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { hostBinary, runBinary } from "../helpers/binary.ts";
import { type CorpusEntry, commitEntryFiles } from "../helpers/knowledge.ts";

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

// The same store again, the project now linked to ten projects of 2,000 memories each
// (confirmed, some as one product, the rest as libraries it uses), with twenty of the
// author's own rules: what the brief and the prompt read beyond the project must not
// cost the budget.
const LINKED_PROJECTS = 10;
const LINKED_MEMORIES_EACH = 2000;
const USER_RULES = 20;

// The knowledge the measured project sees: the workspace's, the shared and its own
// repository, of 2,000 entries each, 10 of them pinned in each; and 30 other projects'
// repositories of 200 entries, which it does not see, whose words are the prompts' too.
const VISIBLE_ENTRIES = 2000;
const PINNED_EACH = 10;
const HIDDEN_REPOS = 30;
const HIDDEN_ENTRIES = 200;
const KNOWLEDGE_ROWS = 3 * VISIBLE_ENTRIES + HIDDEN_REPOS * HIDDEN_ENTRIES;
/** Half the shortest hook busy timeout (100 ms on a prompt). */
const REBUILD_TRANSACTION_MS = 50;

let binary: string;
let base: string;
let dataDir: string;
let linkedDataDir: string;
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

/** A measured prompt: a paragraph of about twenty searchable words, not a question. */
const promptText = (word: () => string) =>
  `why does the ${word()} ${word()} ${word()} when the ${word()} ${word()} is slow? I checked the ${word()} and the ${word()}, the ${word()} looks fine, but the ${word()} ${word()} keeps hitting the ${word()} ${word()} and then the ${word()} ${word()} fails on the ${word()} ${word()}. Could the ${word()} ${word()} be the problem?`;

/** The prompts the prompt cases send, in order: the first is the unmeasured run. */
function measuredPrompts(count: number): string[] {
  const next = generator(7);
  const word = () => WORDS[next(WORDS.length)] as string;
  return Array.from({ length: count }, () => promptText(word));
}

/** A knowledge store on the measured data directory, with a throwaway home for git. */
function knowledgeStoreOf(db: ReturnType<typeof openDb>): KnowledgeStore {
  const home = join(base, "home");
  mkdirSync(home, { recursive: true });
  return openStore({
    db,
    dataDir,
    env: { PATH: process.env.PATH, HOME: home, WIZARDINGCODE_MEM_AUTHOR: "Perf" },
  });
}

/**
 * The knowledge corpus: each repository made through the store, its entry files written
 * in the store's format, staged and committed once, then indexed by a rebuild. One
 * workspace entry holds the words of the first measured prompt, so that knowledge has an
 * entry to show.
 */
function buildKnowledge(db: ReturnType<typeof openDb>, projectId: number): void {
  const store = knowledgeStoreOf(db);
  const next = generator(99);
  const word = () => WORDS[next(WORDS.length)] as string;
  const entries = (prefix: string, count: number, pinned: number): CorpusEntry[] =>
    Array.from({ length: count }, (_, i) => ({
      slug: `${prefix}-${i}`,
      title: `The ${word()} ${word()} must ${word()} before the ${word()} ${word()}`,
      body: `Because the ${word()} ${word()} would otherwise ${word()} the ${word()}.\n\nThe ${word()} ${word()} keeps the ${word()} ${word()} in step.`,
      area: "code",
      pinned: i < pinned,
    }));
  const fill = (ref: ScopeRef, items: CorpusEntry[]) => {
    const repo = ensureRepo(store, ref);
    commitEntryFiles(repo.path, items);
    rebuildRepo(store, repo);
  };
  const [, firstMeasured] = measuredPrompts(2);
  fill({ scope: "workspace" }, [
    ...entries("workspace", VISIBLE_ENTRIES - 1, PINNED_EACH),
    {
      slug: "the-first-measured-prompt",
      title: "What the first measured prompt asks about",
      body: firstMeasured as string,
    },
  ]);
  fill({ scope: "shared" }, entries("shared", VISIBLE_ENTRIES, PINNED_EACH));
  fill({ scope: "project", projectId }, entries("project", VISIBLE_ENTRIES, PINNED_EACH));
  for (let i = 0; i < HIDDEN_REPOS; i++) {
    const dir = join(base, `knowledge-other-${i}`);
    mkdirSync(dir);
    const other = resolveProject(db, dir).id;
    fill({ scope: "project", projectId: other }, entries(`other-${i}`, HIDDEN_ENTRIES, 0));
  }
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

  linkedDataDir = join(base, "data-linked");
  cpSync(dataDir, linkedDataDir, { recursive: true });
  const linkedDb = openDb({ dataDir: linkedDataDir, busyTimeoutMs: 5000 });
  const linkedIds = Array.from({ length: LINKED_PROJECTS }, (_, i) => {
    const dir = join(base, `linked-${i}`);
    mkdirSync(dir);
    return resolveProject(linkedDb, dir).id;
  });
  withWrite(linkedDb, () => {
    const memory = (projectId: number, i: number, importance: number) =>
      insertMemory(linkedDb, {
        projectId,
        kind: MEMORY_KINDS[i % MEMORY_KINDS.length] as (typeof MEMORY_KINDS)[number],
        title: `The ${word()} ${word()} must ${word()} before the ${word()} ${word()}${i}.`,
        body: `Because the ${word()} ${word()} would otherwise ${word()} the ${word()}.` as Redacted,
        terms: `src/${word()}/${word()}.ts`,
        importance,
        branch: null,
        commit: null,
        origin: "manual",
        judge: "heuristic",
        judgeVersion: "1",
        sourceTurnId: null,
        files: [],
        now: now - next(200) * 86_400_000,
      });
    for (const [n, linked] of linkedIds.entries()) {
      for (let i = 0; i < LINKED_MEMORIES_EACH; i++) memory(linked, i, 1 + (i % 5));
      linkedDb.run(
        `INSERT INTO project_links (from_project, to_project, kind, status, origin, signals, created_at)
         VALUES (?, ?, ?, 'confirmed', 'manual', '[]', ?)`,
        [projectId, linked, n < 3 ? "product" : "uses", now],
      );
    }
    for (let i = 0; i < USER_RULES; i++) {
      const id = memory(others[i % OTHER_PROJECTS] as number, i, 5);
      linkedDb.run("INSERT INTO user_memories (memory_id, created_at) VALUES (?, ?)", [id, now]);
    }
  });
  linkedDb.close();

  // After the copy: the linked store measures links and rules, as before.
  const knowledgeDb = openDb({ dataDir, busyTimeoutMs: 5000 });
  buildKnowledge(knowledgeDb, projectId);
  knowledgeDb.close();
}, 480_000);

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
  agent = "claude-code",
  common: Record<string, unknown> | null = null,
  store: string = dataDir,
): Promise<{ shown: string; value: number; outputs: string[] }> {
  const samples: number[] = [];
  const outputs: string[] = [];
  // One run first, unmeasured: the first start of a new binary pays one-off costs.
  for (let run = -1; run < RUNS; run++) {
    const result = await runBinary(binary, ["hook", agent, event], {
      input: JSON.stringify({
        ...(common ?? { session_id: `perf-${event}`, cwd: project }),
        ...payload(run),
      }),
      env: {
        WIZARDINGCODE_MEM_DATA_DIR: store,
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

describe(`the knowledge corpus of ${KNOWLEDGE_ROWS} entries`, () => {
  test("every entry of the corpus is searchable", () => {
    const db = openDb({ dataDir, busyTimeoutMs: 5000 });
    try {
      const rows = db.query<{ n: number }, []>("SELECT count(*) AS n FROM knowledge_fts").get()?.n;
      expect(rows).toBe(KNOWLEDGE_ROWS);
    } finally {
      db.close();
    }
  });

  test("the floor lets through the entry that holds the first measured prompt's words", () => {
    const db = openDb({ dataDir, busyTimeoutMs: 5000 });
    try {
      const [, firstMeasured] = measuredPrompts(2);
      const query = buildQuery(firstMeasured as string);
      if (query === null) throw new Error("the first measured prompt gives no query");
      const repoIds = visibleRepos(db, resolveProject(db, project).id).map((repo) => repo.id);
      const candidates = searchEntries(db, matchTerms(query.match), repoIds, {}, null, CANDIDATES);
      // The hook's search and floor, as `contribute` runs them: the entry is the best
      // candidate, and it passes. Every measured prompt shares the template's own words with
      // it, so in the latency cases it is shown at the unmeasured first run of a session.
      expect(candidates[0]?.slug).toBe("the-first-measured-prompt");
      expect(knowledgeEvidence(query, candidates[0] as (typeof candidates)[number])).toBe("words");
    } finally {
      db.close();
    }
  });

  test(`a rebuild's write transaction at ${VISIBLE_ENTRIES} entries takes under ${REBUILD_TRANSACTION_MS} ms`, () => {
    const db = openDb({ dataDir, busyTimeoutMs: 5000 });
    try {
      const store = knowledgeStoreOf(db);
      const repo = openRepo(store, { scope: "workspace" }) as Repo;
      const state = readRepoState(store, repo);
      expect(state.files.entries).toHaveLength(VISIBLE_ENTRIES);
      const started = performance.now();
      replaceRepoRows(store, repo, state);
      const ms = performance.now() - started;
      console.log(`rebuild write transaction, ${VISIBLE_ENTRIES} entries: ${ms.toFixed(1)} ms`);
      expect(ms).toBeLessThan(REBUILD_TRANSACTION_MS);
    } finally {
      db.close();
    }
  }, 60_000);
});

describe(`hook latency with ${MEMORIES} memories`, () => {
  test(`a prompt is answered within ${BUDGET_MS.prompt} ms`, async () => {
    const next = generator(7);
    const word = () => WORDS[next(WORDS.length)] as string;
    // A real prompt is a paragraph, not a question: twenty or so searchable words.
    const result = await measure("prompt", (run) => ({
      prompt_id: `p${run}`,
      prompt: promptText(word),
    }));
    console.log(`prompt: ${result.shown}`);
    // The measurement only means something if retrieval actually ran and found things.
    expect(result.outputs.filter((out) => out !== "").length).toBeGreaterThan(RUNS / 2);
    // Knowledge searched too, and its floor let entries through: the time measured includes
    // that search and its record.
    expect(result.outputs.some((out) => out.includes("<wizardingcode-knowledge>"))).toBe(true);
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

// The agents added with ADR 0016. Each one's prompt and session-start hooks run through
// the same binary and the same store, with the payload shape the agent's documentation
// gives. Copilot's prompt is capture-only (the host drops a prompt hook's output) and
// Antigravity has no prompt event: its brief comes with the first model invocation.
describe(`hook latency of the newer agents with ${MEMORIES} memories`, () => {
  for (const agent of ["qwen", "droid"] as const) {
    const common = { session_id: `perf-${agent}`, cwd: project };
    test(`${agent}: a prompt is answered within ${BUDGET_MS.prompt} ms`, async () => {
      const next = generator(7);
      const word = () => WORDS[next(WORDS.length)] as string;
      const result = await measure(
        "prompt",
        (run) => {
          const text = promptText(word);
          return agent === "qwen"
            ? { prompt_id: `p${run}`, prompt: text, submitted_prompt: text }
            : { message_id: `m${run}`, prompt: text };
        },
        agent,
        { ...common, session_id: `perf-${agent}-prompt`, cwd: project },
      );
      console.log(`${agent} prompt: ${result.shown}`);
      expect(result.outputs.filter((out) => out !== "").length).toBeGreaterThan(RUNS / 2);
      expect(result.value).toBeLessThanOrEqual(BUDGET_MS.prompt);
    }, 120_000);

    test(`${agent}: a session start is answered within ${BUDGET_MS["session-start"]} ms`, async () => {
      const result = await measure("session-start", () => ({ source: "startup" }), agent, {
        ...common,
        cwd: project,
      });
      console.log(`${agent} session-start: ${result.shown}`);
      expect(result.outputs.every((out) => out.includes("Known about this project"))).toBe(true);
      expect(result.value).toBeLessThanOrEqual(BUDGET_MS["session-start"]);
    }, 120_000);
  }

  test(`copilot: a session start is answered within ${BUDGET_MS["session-start"]} ms`, async () => {
    const result = await measure("session-start", () => ({ source: "startup" }), "copilot", {
      sessionId: "perf-copilot",
      cwd: project,
    });
    console.log(`copilot session-start: ${result.shown}`);
    expect(result.outputs.every((out) => out.includes("Known about this project"))).toBe(true);
    expect(result.value).toBeLessThanOrEqual(BUDGET_MS["session-start"]);
  }, 120_000);

  test(`copilot: a captured prompt returns within ${BUDGET_MS.prompt} ms`, async () => {
    const next = generator(7);
    const word = () => WORDS[next(WORDS.length)] as string;
    const result = await measure("prompt", () => ({ prompt: promptText(word) }), "copilot", {
      sessionId: "perf-copilot-prompt",
      cwd: project,
    });
    console.log(`copilot prompt (capture only): ${result.shown}`);
    // The host drops this hook's output, so we print none.
    expect(result.outputs.every((out) => out === "")).toBe(true);
    expect(result.value).toBeLessThanOrEqual(BUDGET_MS.prompt);
  }, 120_000);

  test(`antigravity: the first model invocation is answered within ${BUDGET_MS["session-start"]} ms`, async () => {
    // The hook name is the host's PreInvocation, which the registered command calls session-start.
    const result = await measure(
      "session-start",
      () => ({ invocationNum: 0, initialNumSteps: 1 }),
      "antigravity",
      { conversationId: "perf-antigravity", workspacePaths: [project] },
    );
    console.log(`antigravity pre-invocation: ${result.shown}`);
    expect(
      result.outputs.every((out) => out.includes("injectSteps") && out.includes("Known about")),
    ).toBe(true);
    expect(result.value).toBeLessThanOrEqual(BUDGET_MS["session-start"]);
  }, 120_000);
});

describe(`hook latency with ${LINKED_PROJECTS} linked projects of ${LINKED_MEMORIES_EACH} memories and ${USER_RULES} rules of the author`, () => {
  test(`a prompt is answered within ${BUDGET_MS.prompt} ms`, async () => {
    const next = generator(7);
    const word = () => WORDS[next(WORDS.length)] as string;
    const result = await measure(
      "prompt",
      (run) => ({
        prompt_id: `p${run}`,
        prompt: `why does the ${word()} ${word()} ${word()} when the ${word()} ${word()} is slow? I checked the ${word()} and the ${word()}, the ${word()} looks fine, but the ${word()} ${word()} keeps hitting the ${word()} ${word()} and then the ${word()} ${word()} fails on the ${word()} ${word()}. Could the ${word()} ${word()} be the problem?`,
      }),
      "claude-code",
      { session_id: "perf-linked-prompt", cwd: project },
      linkedDataDir,
    );
    const outside = result.outputs.filter((out) => /\((?:from [^)]+|you)\)/.test(out)).length;
    console.log(`linked prompt: ${result.shown} (${outside} of ${RUNS} with a note from outside)`);
    expect(result.outputs.filter((out) => out !== "").length).toBeGreaterThan(RUNS / 2);
    expect(result.value).toBeLessThanOrEqual(BUDGET_MS.prompt);
  }, 120_000);

  test(`a session start is answered within ${BUDGET_MS["session-start"]} ms`, async () => {
    const result = await measure(
      "session-start",
      () => ({ source: "startup" }),
      "claude-code",
      { session_id: "perf-linked-start", cwd: project },
      linkedDataDir,
    );
    console.log(`linked session-start: ${result.shown}`);
    // The measurement only means something if both shares were filled.
    expect(
      result.outputs.every((out) => out.includes("(from linked-") && out.includes("(you)")),
    ).toBe(true);
    expect(result.value).toBeLessThanOrEqual(BUDGET_MS["session-start"]);
  }, 120_000);
});
