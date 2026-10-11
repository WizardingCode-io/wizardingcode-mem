import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCode } from "../../src/adapters/claude-code/adapter.ts";
import { ADAPTERS } from "../../src/adapters/index.ts";
import type { HookInput } from "../../src/adapters/types.ts";
import type { HookEvent } from "../../src/core/types.ts";
import { type DistillDeps, drainQueue } from "../../src/distill/queue.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { heuristicJudge } from "../../src/judge/heuristic.ts";
import type { Judge } from "../../src/judge/types.ts";
import { getMemories, searchMemories } from "../../src/mcp/tools.ts";
import { type Db, openDb } from "../../src/store/db.ts";

let base: string;
let project: string;
let db: Db;
let clock: number;
let spawned: number;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-distill-")));
  project = join(base, "project");
  mkdirSync(project);
  db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
  clock = 1_700_000_000_000;
  spawned = 0;
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

function hook(event: HookEvent, extra: Partial<HookInput> = {}): string {
  clock += 1000;
  return handleHook({ db, now: () => clock, spawnDistill: () => void spawned++ }, claudeCode, {
    agent: "claude-code",
    event,
    sessionId: "s1",
    cwd: project,
    turnId: null,
    transcriptPath: null,
    prompt: null,
    finalText: null,
    source: null,
    subagent: false,
    ...extra,
  });
}

let turnCounter = 0;
/** Queues one finished turn, as the prompt and turn-end hooks would. */
function turn(prompt: string, finalText: string, transcriptPath: string | null = null): string {
  const turnId = `p${++turnCounter}`;
  hook("prompt", { turnId, prompt, transcriptPath });
  hook("turn-end", { turnId, finalText, transcriptPath });
  return turnId;
}

const deps = (judge: Judge = heuristicJudge): DistillDeps => ({
  db,
  judge,
  adapters: ADAPTERS,
  now: () => clock,
});
const drain = (judge?: Judge) =>
  drainQueue(deps(judge), { owner: "test", maxTurns: 50, maxMs: 10_000 });

interface MemoryRow {
  id: number;
  kind: string;
  title: string;
  body: string;
  status: string;
  superseded_by: number | null;
  evidence_count: number;
  importance: number;
  judge: string;
  origin: string;
  branch: string | null;
}
const memories = () =>
  db
    .query<MemoryRow, []>(
      "SELECT id, kind, title, body, status, superseded_by, evidence_count, importance, judge, origin, branch FROM memories ORDER BY id",
    )
    .all();
const turnStates = () =>
  db
    .query<{ state: string }, []>("SELECT state FROM turns ORDER BY id")
    .all()
    .map((row) => row.state);

const FIX =
  "Fixed: the root cause was the busy timeout being set after the first query. Moved the pragma to the top of `openDb` in src/store/db.ts.";

describe("distill: from a queued turn to a memory", () => {
  test("a turn worth keeping becomes one memory", async () => {
    turn("the tests fail with a timeout", FIX);
    expect(await drain()).toEqual({ claimed: 1, done: 1, skipped: 0, failed: 0 });
    expect(memories()).toEqual([
      {
        id: 1,
        kind: "fix",
        title: "Fixed: the root cause was the busy timeout being set after the first query.",
        body: "Moved the pragma to the top of `openDb` in src/store/db.ts.\nContext: the tests fail with a timeout",
        status: "active",
        superseded_by: null,
        evidence_count: 1,
        importance: 2,
        judge: "heuristic",
        origin: "distilled",
        branch: null,
      },
    ]);
    expect(turnStates()).toEqual(["done"]);
    expect(db.query("SELECT memory_id, relation FROM memory_sources").all()).toEqual([
      { memory_id: 1, relation: "origin" },
    ]);
  });

  test("a memory records the version of the judge that produced it, not of the wrapper", async () => {
    turn("the tests fail with a timeout", FIX);
    const wrapper: Judge = {
      ...heuristicJudge,
      name: "fallback",
      version: "9+1",
      versions: { typesafe: "9", heuristic: "1" },
    };
    await drain(wrapper);
    expect(db.query("SELECT judge, judge_version FROM memories").all()).toEqual([
      { judge: "heuristic", judge_version: "1" },
    ]);
  });

  test("a turn not worth keeping is skipped", async () => {
    turn("thanks!", "You're welcome! Let me know if you need anything else.");
    expect(await drain()).toEqual({ claimed: 1, done: 0, skipped: 1, failed: 0 });
    expect(memories()).toEqual([]);
    expect(turnStates()).toEqual(["skipped"]);
  });

  test("a user's rule is stored in the user's words, with no context line", async () => {
    turn("Never mock the database in these tests. Always use a real SQLite file.", "Understood.");
    await drain();
    expect(memories()[0]).toMatchObject({
      kind: "convention",
      title: "Never mock the database in these tests.",
      body: "Always use a real SQLite file.",
      importance: 3,
    });
  });

  test("the memory can be found by words from the question that led to it", async () => {
    turn("the tests fail with a timeout", FIX);
    await drain();
    const hits = db
      .query<{ rowid: number }, [string]>(
        "SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?",
      )
      .all('"timeout" OR "opendb"');
    expect(hits).toEqual([{ rowid: 1 }]);
    // camelCase identifiers are also indexed by their parts.
    expect(
      db.query("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'open'").all(),
    ).toHaveLength(1);
  });

  test("files from the transcript become anchors, relative to the project", async () => {
    const transcript = join(base, "t.jsonl");
    const toolUse = (name: string, input: Record<string, unknown>) =>
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", id: "t", name, input }] },
      });
    writeFileSync(
      transcript,
      [
        JSON.stringify({
          type: "user",
          promptId: "p1",
          message: { role: "user", content: "the tests fail with a timeout" },
        }),
        toolUse("Read", { file_path: join(project, "src/store/db.ts") }),
        toolUse("Edit", { file_path: join(project, "src/store/db.ts") }),
        toolUse("Read", { file_path: "/etc/hosts" }),
        toolUse("Bash", { command: "bun test" }),
      ].join("\n"),
    );
    turnCounter = 0;
    turn("the tests fail with a timeout", FIX, transcript);
    await drain();
    expect(db.query("SELECT path, role FROM memory_files ORDER BY path").all()).toEqual([
      { path: "src/store/db.ts", role: "changed" },
    ]);
    expect(
      db
        .query<{ files_changed: string; commands: string }, []>(
          "SELECT files_changed, commands FROM turns",
        )
        .get(),
    ).toEqual({ files_changed: '["src/store/db.ts"]', commands: '["bun test"]' });
  });

  test("a secret in a long command is removed whole, wherever the size limit falls", async () => {
    const key = ["sk-ant-", "api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"].join("");
    const transcript = join(base, "long.jsonl");
    const bash = (id: string, command: string) =>
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
        },
      });
    writeFileSync(
      transcript,
      [
        JSON.stringify({ type: "user", promptId: "k1", message: { role: "user", content: "x" } }),
        // The key starts before the 500th character and ends after it.
        bash("t1", `echo ${"x".repeat(459)} && ./deploy.sh ${key}`),
        JSON.stringify({
          type: "user",
          promptId: "k1",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "t1",
                is_error: true,
                content: `${"y".repeat(460)} DATABASE_URL=postgres://app:${"Sup3rS3cretPassw0rd"}@db/app refused`,
              },
            ],
          },
        }),
      ].join("\n"),
    );
    hook("prompt", { turnId: "k1", prompt: "run the deploy script", transcriptPath: transcript });
    hook("turn-end", { turnId: "k1", finalText: "It failed.", transcriptPath: transcript });
    await drain();
    const stored = db
      .query<{ commands: string; errors: string }, []>("SELECT commands, errors FROM turns")
      .get();
    const text = `${stored?.commands} ${stored?.errors}`;
    expect(text).not.toContain("sk-ant-");
    expect(text).not.toContain("Sup3r");
    for (const item of [
      ...JSON.parse(stored?.commands ?? "[]"),
      ...JSON.parse(stored?.errors ?? "[]"),
    ]) {
      expect(item.length).toBeLessThanOrEqual(500);
    }
  });

  test("distilling the same turn again stores nothing new", async () => {
    turn("the tests fail with a timeout", FIX);
    await drain();
    db.run("UPDATE turns SET state = 'pending', attempts = 0");
    await drain();
    expect(memories()).toHaveLength(1);
    expect(memories()[0]?.evidence_count).toBe(1);
  });
});

describe("distill: the queue", () => {
  const throwing = (times: number): Judge => {
    let left = times;
    return {
      ...heuristicJudge,
      distill: async (input) => {
        if (left-- > 0) throw new Error("judge unavailable");
        return heuristicJudge.distill(input);
      },
    };
  };

  test("work interrupted by a failure is done on the next run", async () => {
    turn("the tests fail with a timeout", FIX);
    // One run retries until the attempts run out, so fail exactly once per run.
    const judge = throwing(1);
    const first = await drainQueue(deps(judge), { owner: "a", maxTurns: 1, maxMs: 10_000 });
    expect(first).toEqual({ claimed: 1, done: 0, skipped: 0, failed: 0 });
    expect(turnStates()).toEqual(["pending"]);
    expect(memories()).toEqual([]);

    await drain(judge);
    expect(turnStates()).toEqual(["done"]);
    expect(memories()).toHaveLength(1);
  });

  test("a turn that keeps failing is given up on after three attempts, with the reason kept", async () => {
    turn("the tests fail with a timeout", FIX);
    const report = await drain(throwing(99));
    expect(report).toEqual({ claimed: 3, done: 0, skipped: 0, failed: 1 });
    expect(db.query("SELECT state, attempts, last_error FROM turns").all()).toEqual([
      { state: "failed", attempts: 3, last_error: "Error: judge unavailable" },
    ]);
    expect((await drain()).claimed).toBe(0);
  });

  test("one bad turn does not hold up the ones behind it", async () => {
    turn("the tests fail with a timeout", FIX);
    turn("Never mock the database in these tests.", "Understood.");
    let calls = 0;
    const judge: Judge = {
      ...heuristicJudge,
      distill: async (input) => {
        if (calls++ < 3) throw new Error("only the first turn fails");
        return heuristicJudge.distill(input);
      },
    };
    await drain(judge);
    expect(turnStates()).toEqual(["failed", "done"]);
  });

  test("a turn abandoned mid-way by a dead process is picked up once its lease runs out", async () => {
    turn("the tests fail with a timeout", FIX);
    db.run(
      "UPDATE turns SET state = 'processing', attempts = 1, lease_owner = 'dead', lease_until = ?",
      [clock + 60_000],
    );
    expect((await drain()).claimed).toBe(0);
    clock += 120_000;
    expect((await drain()).done).toBe(1);
  });

  test("stops at the requested number of turns", async () => {
    for (let i = 0; i < 3; i++)
      turn(`question ${i} about the tests failing`, FIX.replace("busy", `busy${i}`));
    const report = await drainQueue(deps(), { owner: "test", maxTurns: 2, maxMs: 10_000 });
    expect(report.claimed).toBe(2);
    expect(turnStates().filter((state) => state === "pending")).toHaveLength(1);
  });

  test("only one process drains at a time", async () => {
    turn("the tests fail with a timeout", FIX);
    db.run("INSERT INTO meta (key, value) VALUES ('drain.lease', ?)", [
      JSON.stringify({ owner: "someone-else", until: clock + 60_000 }),
    ]);
    expect(await drain()).toEqual({ claimed: 0, done: 0, skipped: 0, failed: 0 });
    expect(turnStates()).toEqual(["pending"]);

    clock += 120_000;
    expect((await drain()).done).toBe(1);
    expect(db.query("SELECT 1 FROM meta WHERE key = 'drain.lease'").all()).toEqual([]);
  });

  test("a hook does not start a second drain while one is running", () => {
    turn("the tests fail with a timeout", FIX);
    const before = spawned;
    db.run("INSERT INTO meta (key, value) VALUES ('drain.lease', ?)", [
      JSON.stringify({ owner: "running", until: clock + 60_000 }),
    ]);
    hook("session-start", { source: "startup" });
    expect(spawned).toBe(before);
  });

  test("keeps the latency log bounded", async () => {
    db.run(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2100)
       INSERT INTO hook_runs (at, agent, event, ms, outcome) SELECT i, 'claude-code', 'prompt', 1, 'ok' FROM n`,
    );
    await drain();
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM hook_runs").get()?.n).toBe(2000);
    expect(db.query<{ at: number }, []>("SELECT min(at) AS at FROM hook_runs").get()?.at).toBe(101);
  });
});

describe("distill: what must not become a memory", () => {
  const RETRY_FIX =
    "Fixed: the root cause was a missing rethrow in `retryWithBackoff`, which now rethrows after the last attempt.";

  /** Learns the busy-timeout fix, then shows it to a second session. Returns what that session saw. */
  async function toldTheNote(): Promise<string> {
    turn("the tests fail with a timeout", FIX);
    await drain();
    db.run("DELETE FROM turns");
    const out = hook("prompt", {
      sessionId: "s2",
      turnId: "q1",
      prompt: "why is openDb slow here?",
    });
    const notes = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(notes).toContain("the root cause was the busy timeout");
    return notes;
  }
  const answer = (finalText: string) =>
    hook("turn-end", { sessionId: "s2", turnId: "q1", finalText });

  test("a notification from the host gives no context line: nobody asked anything", async () => {
    turn(
      "<task-notification>\n<task-id>bq7x</task-id>\n<output-file>/tmp/claude/tasks/bq7x.output</output-file>\n<status>completed</status>\n</task-notification>",
      FIX,
    );
    await drain();
    expect(memories()).toHaveLength(1);
    expect(memories()[0]?.body).toBe("Moved the pragma to the top of `openDb` in src/store/db.ts.");
    expect(
      db.query("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'bq7x'").all(),
    ).toEqual([]);
  });

  test("a rule inside a subagent's report is not taken for the user's", async () => {
    turn(
      '<agent-message from="a1">\nNever mock the database in these tests. Always use a real SQLite file.\n</agent-message>',
      "Understood.",
    );
    expect(await drain()).toEqual({ claimed: 1, done: 0, skipped: 1, failed: 0 });
    expect(memories()).toEqual([]);
  });

  test("what the agent was told is not learned back when it repeats it", async () => {
    const notes = await toldTheNote();
    answer(`Here is what I was given:\n${notes}\nSo nothing needs to change here.`);
    await drain();
    expect(memories()).toHaveLength(1);
    expect(memories()[0]?.evidence_count).toBe(1);
    expect(turnStates()).toEqual(["skipped"]);
  });

  test("a note quoted without its wrapper is not learned back either", async () => {
    await toldTheNote();
    answer(
      "As noted before: Fixed: the root cause was the busy timeout being set after the first query. Moved the pragma to the top of `openDb` in src/store/db.ts. So nothing new here.",
    );
    await drain();
    expect(memories()).toHaveLength(1);
    expect(memories()[0]?.evidence_count).toBe(1);
  });

  test("something new said alongside a repeated note is still learned, without the repeat", async () => {
    const notes = await toldTheNote();
    answer(`${notes}\n\nSeparately, the retry helper swallowed errors. ${RETRY_FIX}`);
    await drain();
    const [first, added] = memories();
    expect(memories()).toHaveLength(2);
    expect(first?.evidence_count).toBe(1);
    expect(added?.title).toContain("retryWithBackoff");
    expect(added?.body).not.toContain("busy timeout");
    expect(added?.body).not.toContain("wizardingcode-mem-notes");
  });

  /** The MCP server does not know the session: it knows the project and the moment. */
  function mcpContext() {
    const projectId = db.query<{ id: number }, []>("SELECT id FROM projects").get()?.id ?? 0;
    return { db, judge: heuristicJudge, projectId, root: project, branch: null, now: clock };
  }

  test("what the agent read itself through memory_get, mid-turn, is not learned back when it repeats it", async () => {
    turn("the tests fail with a timeout", FIX);
    await drain();
    db.run("DELETE FROM turns");
    // A second session asks something the notes do not answer, then fetches the note itself.
    hook("prompt", {
      sessionId: "s2",
      turnId: "q1",
      prompt: "give me the full note on the pragma",
    });
    const id = memories()[0]?.id ?? 0;
    const read = getMemories(mcpContext(), { ids: [id] });
    expect(read).toContain("busy timeout");
    answer(`From memory: ${read}\nNothing to change.`);
    await drain();
    expect(memories()).toHaveLength(1);
    expect(memories()[0]?.evidence_count).toBe(1);
    expect(turnStates()).toEqual(["skipped"]);
  });

  test("a memory_search result repeated back is not learned either", async () => {
    turn("the tests fail with a timeout", FIX);
    await drain();
    db.run("DELETE FROM turns");
    hook("prompt", { sessionId: "s2", turnId: "q1", prompt: "anything about pragmas?" });
    const found = searchMemories(mcpContext(), { query: "pragma" });
    expect(found).toContain("busy timeout");
    answer(`I found this: ${found}`);
    await drain();
    expect(memories()).toHaveLength(1);
    expect(turnStates()).toEqual(["skipped"]);
  });

  test("a read with no turn open anywhere in the project is recorded against no session", () => {
    turn("the tests fail with a timeout", FIX);
    const id = memories()[0]?.id ?? 0;
    getMemories(mcpContext(), { ids: [id] });
    expect(db.query("SELECT count(*) AS n FROM injections WHERE event = 'mcp'").get()).toEqual({
      n: 0,
    });
  });

  function savingTurn(outcome: { content: string; is_error?: boolean }): void {
    const transcript = join(base, "saved.jsonl");
    writeFileSync(
      transcript,
      [
        JSON.stringify({ type: "user", promptId: "m1", message: { role: "user", content: "x" } }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "t",
                name: "mcp__wizardingcode-mem__memory_save",
                input: { text: "Never keep test data in staging.", kind: "gotcha" },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          promptId: "m1",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "t", ...outcome }],
          },
        }),
      ].join("\n"),
    );
    hook("prompt", {
      turnId: "m1",
      prompt: "Remember this: never keep test data in staging, it is rebuilt every night.",
      transcriptPath: transcript,
    });
    hook("turn-end", { turnId: "m1", finalText: "Saved.", transcriptPath: transcript });
  }

  test("a turn in which the agent saved a memory itself is not distilled again", async () => {
    savingTurn({ content: "Saved as #1." });
    await drain();
    expect(memories()).toEqual([]);
    expect(turnStates()).toEqual(["skipped"]);
  });

  test("if that save failed, the turn is distilled after all", async () => {
    savingTurn({ content: "wizardingcode-mem: database is locked", is_error: true });
    await drain();
    expect(memories().map((memory) => memory.kind)).toEqual(["convention"]);
    expect(turnStates()).toEqual(["done"]);
  });

  test("distilling a turn again after its ending changed updates its memory, not adds one", async () => {
    hook("prompt", { turnId: "c1", prompt: "the parser accepts empty input" });
    hook("turn-end", {
      turnId: "c1",
      finalText:
        "Fixed: the root cause was a missing length check in `parseInput`, which now rejects empty input.",
    });
    await drain();
    hook("turn-end", {
      turnId: "c1",
      finalText:
        "Fixed: the root cause was a missing length check in `parseInput`. The regression test in tests/parser.test.ts now covers empty input because it was missed before.",
    });
    await drain();
    expect(memories()).toHaveLength(1);
    expect(memories()[0]?.body).toContain("tests/parser.test.ts");
    expect(memories()[0]?.evidence_count).toBe(1);
    expect(turnStates()).toEqual(["done"]);
  });
});

describe("distill: upkeep", () => {
  test("after a drain, memories whose files have disappeared are marked", async () => {
    mkdirSync(join(project, "src"));
    writeFileSync(join(project, "src/pool.ts"), "");
    const transcript = join(base, "upkeep.jsonl");
    writeFileSync(
      transcript,
      [
        JSON.stringify({ type: "user", promptId: "u1", message: { role: "user", content: "x" } }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "t",
                name: "Edit",
                input: { file_path: join(project, "src/pool.ts") },
              },
            ],
          },
        }),
      ].join("\n"),
    );
    hook("prompt", {
      turnId: "u1",
      prompt: "the pool leaks connections",
      transcriptPath: transcript,
    });
    hook("turn-end", {
      turnId: "u1",
      finalText:
        "Fixed: the root cause was that `workerPool` never released its connection. The pool in src/pool.ts now releases it in a finally block.",
      transcriptPath: transcript,
    });
    await drain();
    expect(db.query("SELECT stale FROM memories").all()).toEqual([{ stale: 0 }]);

    rmSync(join(project, "src/pool.ts"));
    turn("thanks!", "You're welcome!");
    await drain();
    expect(db.query("SELECT stale FROM memories").all()).toEqual([{ stale: 1 }]);
  });
});

describe("distill: consolidation", () => {
  test("the same lesson learned twice reinforces one memory", async () => {
    turn("the tests fail with a timeout", FIX);
    turn("timeouts again in the database tests", FIX);
    await drain();
    expect(memories()).toHaveLength(1);
    expect(memories()[0]?.evidence_count).toBe(2);
    expect(db.query("SELECT relation FROM memory_sources ORDER BY turn_id").all()).toEqual([
      { relation: "origin" },
      { relation: "duplicate" },
    ]);
    expect(turnStates()).toEqual(["done", "done"]);
  });

  test("a statement that replaces an older one supersedes it", async () => {
    turn(
      "how many retries?",
      "We decided the retry limit is three attempts because the upstream service recovers quickly.",
    );
    turn(
      "raise the retries",
      "The retry limit is five attempts because the upstream service recovers slowly; it is no longer three attempts.",
    );
    await drain();
    const [old, current] = memories();
    expect(old).toMatchObject({ status: "superseded", superseded_by: current?.id });
    expect(current).toMatchObject({ status: "active", superseded_by: null });
    expect(
      db
        .query("SELECT relation FROM memory_sources WHERE memory_id = ? ORDER BY turn_id")
        .all(current?.id as number),
    ).toEqual([{ relation: "origin" }]);
  });

  test("unrelated lessons are both kept", async () => {
    turn("the tests fail with a timeout", FIX);
    turn("Never mock the database in these tests.", "Understood.");
    await drain();
    expect(memories().map((memory) => memory.status)).toEqual(["active", "active"]);
  });

  test("a superseded memory is not compared against again", async () => {
    turn(
      "q1",
      "We decided the retry limit is three attempts because the upstream service recovers quickly.",
    );
    turn(
      "q2",
      "The retry limit is five attempts because the upstream service recovers slowly; it is no longer three attempts.",
    );
    turn(
      "q3",
      "The retry limit is five attempts because the upstream service recovers slowly; it is no longer three attempts.",
    );
    await drain();
    expect(memories().map((memory) => [memory.status, memory.evidence_count])).toEqual([
      ["superseded", 1],
      ["active", 2],
    ]);
  });
});
