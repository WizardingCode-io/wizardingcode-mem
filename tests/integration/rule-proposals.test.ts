import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { MemoryKind } from "../../src/core/types.ts";
import type { Model } from "../../src/embed/model.ts";
import { heuristicJudge } from "../../src/judge/heuristic.ts";
import type { Judge } from "../../src/judge/types.ts";
import {
  acceptProposal,
  proposeRules,
  rejectProposal,
  SAID_ALWAYS,
  undoUserRule,
} from "../../src/links/rules.ts";
import { searchMemories } from "../../src/mcp/tools.ts";
import { sessionBrief } from "../../src/retrieve/brief.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { touchSession } from "../../src/store/sessions.ts";
import { searchTerms } from "../../src/util/words.ts";

const NOW = Date.UTC(2026, 9, 12, 12);
const RULE = "Run the tests with the pinned bun before every commit";
const RULE_BODY = "The global bun diverges from the pinned one and hangs gzip streams.";

let base: string;
let db: Db;
let a: number;
let b: number;
let c: number;
let seq = 0;

interface Input {
  title: string;
  body?: string;
  kind?: MemoryKind;
  importance?: number;
  prompt?: string;
}

function memory(projectId: number, input: Input, model: Model | null = null): number {
  let turnId: number | null = null;
  if (input.prompt !== undefined) {
    seq++;
    const session = touchSession(db, {
      agent: "claude-code",
      agentSessionId: `s-${seq}`,
      projectId,
      cwd: base,
      branch: null,
      now: NOW,
    }).id;
    turnId =
      db
        .query<{ id: number }, [number, number, string, number, number]>(
          `INSERT INTO turns (session_id, project_id, seq, state, prompt, final_text, started_at, ended_at)
           VALUES (?, ?, 1, 'done', ?, 'ok', ?, ?) RETURNING id`,
        )
        .get(session, projectId, input.prompt, NOW, NOW)?.id ?? null;
  }
  return insertMemory(
    db,
    {
      projectId,
      kind: input.kind ?? "convention",
      title: input.title,
      body: (input.body ?? "") as Redacted,
      terms: searchTerms(input.title, input.body ?? "", []),
      importance: input.importance ?? 3,
      branch: null,
      commit: null,
      origin: "distilled",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: turnId,
      files: [],
      now: NOW,
    },
    model,
  );
}

const link = (from: number, to: number, status = "confirmed") =>
  db.run(
    `INSERT INTO project_links (from_project, to_project, kind, status, origin, signals, created_at)
     VALUES (?, ?, 'product', ?, 'manual', '[]', ?)`,
    [from, to, status, NOW],
  );

interface ProposalRow {
  id: number;
  memory_ids: string;
  title: string;
  body: string;
  reason: string;
  status: string;
  user_memory_id: number | null;
}
const proposals = () => db.query<ProposalRow, []>("SELECT * FROM rule_proposals ORDER BY id").all();
const statusOf = (id: number) =>
  db
    .query<{ status: string; superseded_by: number | null }, [number]>(
      "SELECT status, superseded_by FROM memories WHERE id = ?",
    )
    .get(id);

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-rules-")));
  process.env.WIZARDINGCODE_HOME = base;
  db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
  const project = (name: string) => {
    const dir = join(base, name);
    mkdirSync(dir);
    return resolveProject(db, dir, NOW).id;
  };
  a = project("alpha");
  b = project("bravo");
  c = project("charlie");
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

const propose = (judge: Judge = heuristicJudge, model: Model | null = null) =>
  proposeRules(db, { judge, now: NOW, model });

describe("SAID_ALWAYS", () => {
  test("matches a rule said to hold everywhere, in Portuguese or English", () => {
    for (const text of [
      "usa sempre o bun fixado",
      "em todos os projetos quero testes primeiro",
      "Always write the test first",
      "in every project, explicit .ts imports",
      "do this in every repo",
      "in all projects keep English docs",
    ]) {
      expect(SAID_ALWAYS.test(text)).toBe(true);
    }
    expect(SAID_ALWAYS.test("the hallways are long")).toBe(false);
    expect(SAID_ALWAYS.test("fix the retry")).toBe(false);
  });
});

describe("proposeRules", () => {
  test("the same convention in two unlinked projects becomes one proposal with both", async () => {
    const one = memory(a, { title: RULE, body: RULE_BODY, importance: 3 });
    const two = memory(b, { title: RULE, body: RULE_BODY, importance: 4 });
    expect(await propose()).toEqual({ proposed: 1 });
    const [row] = proposals();
    expect(JSON.parse(row?.memory_ids ?? "[]")).toEqual([one, two].sort((x, y) => x - y));
    expect(row).toMatchObject({ reason: "repeated", status: "proposed", title: RULE });
    // Running again proposes nothing new.
    expect(await propose()).toEqual({ proposed: 0 });
    expect(proposals()).toHaveLength(1);
  });

  test("projects linked to each other already share their memories: no proposal", async () => {
    memory(a, { title: RULE, body: RULE_BODY });
    memory(b, { title: RULE, body: RULE_BODY });
    link(a, b);
    expect(await propose()).toEqual({ proposed: 0 });
    expect(proposals()).toHaveLength(0);
  });

  test("a decision whose prompt said 'sempre' is proposed alone", async () => {
    const id = memory(a, {
      kind: "decision",
      title: "Documents in the repository are written in English",
      prompt: "escreve sempre os documentos em inglês",
    });
    expect(await propose()).toEqual({ proposed: 1 });
    const [row] = proposals();
    expect(JSON.parse(row?.memory_ids ?? "[]")).toEqual([id]);
    expect(row?.reason).toBe("said-always");
  });

  test("a fix is never proposed, repeated or said always", async () => {
    memory(a, { kind: "fix", title: RULE, body: RULE_BODY });
    memory(b, { kind: "fix", title: RULE, body: RULE_BODY });
    memory(c, { kind: "fix", title: "Fixed the retry loop", prompt: "always fix it this way" });
    expect(await propose()).toEqual({ proposed: 0 });
  });

  test("a rejected set is never proposed again", async () => {
    memory(a, { title: RULE, body: RULE_BODY });
    memory(b, { title: RULE, body: RULE_BODY });
    await propose();
    const [row] = proposals();
    expect(rejectProposal(db, row?.id ?? 0, NOW)).toBe(true);
    expect(await propose()).toEqual({ proposed: 0 });
    expect(proposals().map((p) => p.status)).toEqual(["rejected"]);
    expect(rejectProposal(db, row?.id ?? 0, NOW)).toBe(false);
  });

  test("a judge saying the rule belongs to its project drops it", async () => {
    memory(a, { title: RULE, body: RULE_BODY });
    memory(b, { title: RULE, body: RULE_BODY });
    const asked: { title: string; projects: string[] }[] = [];
    const judge: Judge = {
      ...heuristicJudge,
      personal: async (input) => {
        asked.push({ title: input.title, projects: input.projects });
        return { personal: false, confidence: 0.9 };
      },
    };
    expect(await propose(judge)).toEqual({ proposed: 0 });
    expect(asked).toEqual([{ title: RULE, projects: ["alpha", "bravo"] }]);
    // The verdict is remembered: the same group is not asked about on every drain.
    expect(await propose(judge)).toEqual({ proposed: 0 });
    expect(asked).toHaveLength(1);
  });

  test("a judge saying it is personal keeps it", async () => {
    memory(a, { title: RULE, body: RULE_BODY });
    memory(b, { title: RULE, body: RULE_BODY });
    const yes: Judge = {
      ...heuristicJudge,
      personal: async () => ({ personal: true, confidence: 0.8 }),
    };
    expect(await propose(yes)).toEqual({ proposed: 1 });
  });

  test("the fallback judge, which has no `personal`, keeps the proposal", async () => {
    memory(a, { title: RULE, body: RULE_BODY });
    memory(b, { title: RULE, body: RULE_BODY });
    expect(heuristicJudge.personal).toBeUndefined();
    expect(await propose(heuristicJudge)).toEqual({ proposed: 1 });
  });

  test("with the model, the same rule in other words is grouped by meaning", async () => {
    // Two texts that share no word, which this stand-in model says mean the same.
    const model: Model = {
      id: "stand-in@1",
      pack: { header: { dims: 4 } } as unknown as Model["pack"],
      embed: (text) =>
        /pinned|fixado/.test(text)
          ? new Float32Array([1, 0, 0, 0])
          : new Float32Array([0, 1, 0, 0]),
    };
    const one = memory(a, { title: RULE }, model);
    const two = memory(b, { title: "Usar o binário fixado antes de cada entrega" }, model);
    memory(c, { title: "Unrelated convention about naming" }, model);
    expect(await propose(heuristicJudge, null)).toEqual({ proposed: 0 });
    expect(await propose(heuristicJudge, model)).toEqual({ proposed: 1 });
    expect(JSON.parse(proposals()[0]?.memory_ids ?? "[]")).toEqual([one, two]);
  });
});

describe("accepting and undoing", () => {
  async function proposed(): Promise<{ id: number; sources: number[] }> {
    const one = memory(a, { title: RULE, body: RULE_BODY, importance: 3 });
    const two = memory(b, { title: RULE, body: RULE_BODY, importance: 5 });
    await propose();
    return { id: proposals()[0]?.id ?? 0, sources: [one, two] };
  }

  test("accept writes your memory, supersedes the copies, and any project's brief shows it", async () => {
    const { id, sources } = await proposed();
    const result = acceptProposal(db, id, NOW + 1);
    if (!("userMemoryId" in result)) throw new Error(result.refused);
    const mine = db
      .query<{ kind: string; importance: number; origin: string; title: string }, [number]>(
        "SELECT kind, importance, origin, title FROM memories WHERE id = ?",
      )
      .get(result.userMemoryId);
    expect(mine).toEqual({ kind: "convention", importance: 5, origin: "manual", title: RULE });
    expect(
      db.query("SELECT 1 FROM user_memories WHERE memory_id = ?").get(result.userMemoryId),
    ).not.toBeNull();
    for (const source of sources) {
      expect(statusOf(source)).toEqual({
        status: "superseded",
        superseded_by: result.userMemoryId,
      });
    }
    expect(proposals()[0]).toMatchObject({
      status: "accepted",
      user_memory_id: result.userMemoryId,
    });
    const { text } = sessionBrief(db, { projectId: c, branch: null, now: NOW + 2 });
    expect(text).toContain(`#${result.userMemoryId} `);
    expect(text).toContain(`${RULE} (you)`);
    // Accepted once is enough.
    expect(acceptProposal(db, id, NOW + 3)).toHaveProperty("refused");
  });

  test("accept is refused when fewer than two copies are still active", async () => {
    const { id, sources } = await proposed();
    db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [sources[0] ?? 0]);
    expect(acceptProposal(db, id, NOW + 1)).toHaveProperty("refused");
    expect(db.query("SELECT COUNT(*) AS n FROM user_memories").get()).toEqual({ n: 0 });
    expect(proposals()[0]?.status).toBe("proposed");
  });

  test("undo archives your memory and puts the copies back", async () => {
    const { id, sources } = await proposed();
    const result = acceptProposal(db, id, NOW + 1);
    if (!("userMemoryId" in result)) throw new Error(result.refused);
    expect(undoUserRule(db, result.userMemoryId, NOW + 2)).toBe(true);
    expect(statusOf(result.userMemoryId)?.status).toBe("archived");
    for (const source of sources) {
      expect(statusOf(source)).toEqual({ status: "active", superseded_by: null });
    }
    // Undone is a decision: the set does not come back as a proposal.
    expect(await propose()).toEqual({ proposed: 0 });
    expect(undoUserRule(db, sources[0] ?? 0, NOW + 3)).toBe(false);
  });

  test("search in another project finds your rule, labelled as yours", async () => {
    const { id } = await proposed();
    const result = acceptProposal(db, id, NOW + 1);
    if (!("userMemoryId" in result)) throw new Error(result.refused);
    const found = searchMemories(
      {
        db,
        judge: heuristicJudge,
        projectId: c,
        root: join(base, "charlie"),
        branch: null,
        now: NOW,
      },
      { query: "pinned bun commit" },
    );
    expect(found).toContain(`#${result.userMemoryId} `);
    expect(found).toContain(`${RULE} (you)`);
  });
});
