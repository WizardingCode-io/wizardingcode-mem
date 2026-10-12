import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { MemoryKind } from "../../src/core/types.ts";
import { compose } from "../../src/engine/compose.ts";
import type { MomentInput } from "../../src/engine/module.ts";
import { enabledModules } from "../../src/engine/modules.ts";
import { heuristicJudge } from "../../src/judge/heuristic.ts";
import type { Judge, StandingVerdict } from "../../src/judge/types.ts";
import { knowledgeDir, readEntries } from "../../src/modules/knowledge/files.ts";
import { refreshIndex } from "../../src/modules/knowledge/index-store.ts";
import {
  acceptPromotion,
  listPromotions,
  PROMOTE_LEASE,
  proposePromotions,
  rejectPromotion,
  SHOWN_SQL,
} from "../../src/modules/knowledge/promote.ts";
import { sessionBrief } from "../../src/retrieve/brief.ts";
import { notesForFailure } from "../../src/retrieve/failure.ts";
import { notesForFile } from "../../src/retrieve/file.ts";
import { retrieveForPrompt } from "../../src/retrieve/prompt.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { claimLease } from "../../src/store/meta.ts";
import { touchSession } from "../../src/store/sessions.ts";
import { openTurn } from "../../src/store/turns.ts";
import { searchTerms } from "../../src/util/words.ts";
import { EPISODIC, STANDING } from "../fixtures/promotion-probe.ts";
import { runCliWith } from "../helpers/cli.ts";

// Memories worth keeping are proposed as knowledge (spec "Promotion from memory"): in the
// background, bounded, with a cursor; accepting writes the entry file on the author's click
// only, and memory then leaves the note to knowledge for as long as the entry exists.

const NOW = new Date(2026, 9, 12, 15, 30).getTime();
const TODAY = "2026-10-12";

let base: string;
let repo: string;
let dir: string;
let db: Db;
let projectId: number;
let sessionId: number;
let env: Record<string, string>;
let epoch = 0;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-knowledge-promote-")));
  repo = join(base, "repo");
  mkdirSync(repo);
  dir = knowledgeDir(repo);
  env = { HOME: join(base, "home"), WIZARDINGCODE_HOME: join(base, "home", ".wizardingcode") };
  db = openDb({ dataDir: join(base, "store"), busyTimeoutMs: 2000 });
  projectId = resolveProject(db, repo, NOW).id;
  sessionId = touchSession(db, {
    agent: "claude-code",
    agentSessionId: "s-1",
    projectId,
    cwd: repo,
    branch: null,
    now: NOW,
  }).id;
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

interface Input {
  title: string;
  body?: string;
  kind?: MemoryKind;
  importance?: number;
  files?: string[];
  project?: number;
  /** The prompt of the turn it was distilled from. */
  prompt?: string;
}

function memory(input: Input): number {
  const body = input.body ?? `${input.title}, because the review asked for it.`;
  return insertMemory(db, {
    projectId: input.project ?? projectId,
    kind: input.kind ?? "decision",
    title: input.title,
    body: body as Redacted,
    terms: searchTerms(input.title, body, input.files ?? []),
    importance: input.importance ?? 4,
    branch: null,
    commit: null,
    origin: "distilled",
    judge: "heuristic",
    judgeVersion: "1",
    sourceTurnId:
      input.prompt === undefined
        ? null
        : openTurn(
            db,
            {
              sessionId,
              projectId: input.project ?? projectId,
              agentTurnId: null,
              transcriptPath: null,
              branch: null,
              commit: null,
              now: NOW,
            },
            input.prompt as Redacted,
          ),
    files: (input.files ?? []).map((path) => ({ path, role: "changed" as const })),
    now: NOW,
  });
}

const DAY = 86_400_000;
let shownSessions = 0;

/** A session of its own in the project, as the agents open them. */
function newSession(): number {
  shownSessions++;
  return touchSession(db, {
    agent: "claude-code",
    agentSessionId: `shown-${shownSessions}`,
    projectId,
    cwd: repo,
    branch: null,
    now: NOW,
  }).id;
}

/** Records one showing of the memory: by default on a prompt, in a session of its own, a day apart. */
function showOnce(
  memoryId: number,
  options: { event?: string; session?: number; at?: number; context?: number } = {},
): void {
  epoch++;
  const session = options.session ?? newSession();
  db.run(
    `INSERT INTO injections (session_id, context_epoch, memory_id, event, tokens, at)
     VALUES (?, ?, ?, ?, 10, ?)`,
    [
      session,
      options.context ?? 1000 + epoch,
      memoryId,
      options.event ?? "prompt",
      options.at ?? NOW - DAY * shownSessions,
    ],
  );
}

/** Records the memory as shown this many more times, each on a prompt in a session of its own, a day apart. */
function show(memoryId: number, times: number): void {
  for (let i = 0; i < times; i++) showOnce(memoryId);
}

interface Row {
  id: number;
  project_id: number;
  memory_id: number;
  slug: string;
  status: string;
}
const proposals = () =>
  db
    .query<Row, []>(
      "SELECT id, project_id, memory_id, slug, status FROM knowledge_proposals ORDER BY id",
    )
    .all();
const propose = (extra: Partial<Parameters<typeof proposePromotions>[1]> = {}) =>
  proposePromotions(db, { now: NOW, env, ...extra });
const proposalFor = (memoryId: number) => {
  const found = proposals().find((row) => row.memory_id === memoryId);
  if (found === undefined) throw new Error(`no proposal for memory ${memoryId}`);
  return found;
};
const accept = (memoryId: number) =>
  acceptPromotion(db, proposalFor(memoryId).id, { now: NOW, env });

/** Every file under the repository, so a write anywhere shows up. */
function filesIn(at = repo, prefix = ""): string[] {
  if (!existsSync(at)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...filesIn(join(at, entry.name), rel));
    else found.push(rel);
  }
  return found;
}

describe("which memories are proposed", () => {
  test("active decisions and conventions of importance 4 or more, shown at least 3 times", async () => {
    const decision = memory({ title: "Orders are cancelled through the saga" });
    const convention = memory({ title: "Handlers return problem details", kind: "convention" });
    const twice = memory({ title: "Retry the webhook twice" });
    const minor = memory({ title: "Prefer named exports here", importance: 3 });
    const gotcha = memory({ title: "The clock skews in CI", kind: "gotcha", importance: 5 });
    const archived = memory({ title: "Old queue settled on Redis" });
    db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [archived]);
    for (const id of [decision, convention, minor, gotcha, archived]) show(id, 3);
    show(twice, 2);

    const result = await propose();
    expect(result.proposed).toBe(2);
    expect(proposals().map((row) => [row.memory_id, row.slug, row.status])).toEqual([
      [decision, "orders-are-cancelled-through-the-saga", "proposed"],
      [convention, "handlers-return-problem-details", "proposed"],
    ]);
    // Proposing writes nothing anywhere.
    expect(filesIn()).toEqual([]);
  });

  test("shown counts sessions: one session's heading, notes and fetches count once", async () => {
    const once = memory({ title: "Webhooks are verified before parsing" });
    const session = newSession();
    for (const [i, event] of ["prompt", "mcp", "mcp", "file-read", "tool-failed"].entries()) {
      showOnce(once, { event, session, context: 1 + i, at: NOW - 5 * DAY + i * DAY });
    }
    showOnce(once);
    expect((await propose()).proposed).toBe(0);
    showOnce(once);
    expect((await propose()).proposed).toBe(1);
  });

  test("one of the author's own rules qualifies without being shown", async () => {
    const rule = memory({ title: "Run the pinned bun before committing", kind: "convention" });
    const plain = memory({ title: "Keep the queue lease short", kind: "convention" });
    db.run("INSERT INTO user_memories (memory_id, proposal_id, created_at) VALUES (?, NULL, ?)", [
      rule,
      NOW,
    ]);
    await propose();
    expect(proposals().map((row) => row.memory_id)).toEqual([rule]);
    expect(plain).toBeGreaterThan(0);
  });

  test("not in a project whose memory is off, nor where knowledge is off", async () => {
    const off = memory({ title: "Use the outbox for events" });
    show(off, 3);
    db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [projectId]);
    await propose();
    expect(proposals()).toEqual([]);

    db.run("UPDATE projects SET disabled = 0 WHERE id = ?", [projectId]);
    const home = memory({ title: "Use the outbox for commands" });
    show(home, 3);
    // An agent run in the home folder: its "project" is no repository.
    await propose({ env: { ...env, HOME: repo } });
    expect(proposals()).toEqual([]);
  });

  test("a memory shown a third time later is proposed on a later pass (the cursor)", async () => {
    const id = memory({ title: "Invoices are immutable once sent" });
    show(id, 2);
    expect((await propose()).proposed).toBe(0);
    // Nothing new: one look and out.
    expect(await propose()).toEqual({ proposed: 0, scanned: 0 });
    show(id, 1);
    expect((await propose()).proposed).toBe(1);
  });

  test("raised to importance 4 later, it is reached through the changed memories", async () => {
    const id = memory({ title: "Prices are stored in cents", importance: 3 });
    show(id, 3);
    expect((await propose()).proposed).toBe(0);
    db.run("UPDATE memories SET importance = 4, updated_at = ? WHERE id = ?", [NOW + 1000, id]);
    expect((await propose()).proposed).toBe(1);
  });

  test("bounded: a small batch takes several passes and reaches every memory", async () => {
    const ids = Array.from({ length: 5 }, (_, i) => memory({ title: `Decision number ${i}` }));
    for (const id of ids) show(id, 3);
    const first = await propose({ batch: 2, injectionBatch: 4 });
    expect(first.proposed).toBeLessThan(5);
    for (let i = 0; i < 10; i++) await propose({ batch: 2, injectionBatch: 4 });
    expect(proposals().map((row) => row.memory_id)).toEqual(ids);
  });

  test("never while another process holds the lease", async () => {
    const id = memory({ title: "Only one migration per release" });
    show(id, 3);
    // The test's own process: alive, so the lease holds.
    expect(claimLease(db, PROMOTE_LEASE, `${process.pid}-other`, Date.now(), 60_000)).toBe(true);
    expect(await propose({ owner: `${process.pid}-mine` })).toEqual({ proposed: 0, scanned: 0 });
    expect(proposals()).toEqual([]);
  });

  test("a memory proposed once is never proposed again, rejected or not", async () => {
    const id = memory({ title: "Feature flags live in the config service" });
    show(id, 3);
    await propose();
    const proposal = proposalFor(id);
    expect(rejectPromotion(db, proposal.id, NOW)).toBe(true);
    expect(rejectPromotion(db, proposal.id, NOW)).toBe(false);
    show(id, 5);
    db.run("UPDATE memories SET body = 'Edited.', updated_at = ? WHERE id = ?", [NOW + 5000, id]);
    await propose();
    expect(proposals()).toEqual([{ ...proposal, status: "rejected" }]);
    expect(listPromotions(db, projectId)).toEqual([]);
  });

  test("the shown count reads an index, not every injection record (task 4 minor 3, migration 5)", async () => {
    const plan = db
      .query<{ detail: string }, []>(`EXPLAIN QUERY PLAN ${SHOWN_SQL("1, 2, 3")}`)
      .all()
      .map((row) => row.detail)
      .join("\n");
    expect(plan).not.toMatch(/SCAN injections/);
    expect(plan).toMatch(/SEARCH injections USING COVERING INDEX/);
  });

  test("a proposal whose memory is no longer active, or whose project has memory off, is not listed (task 4 minor 4)", async () => {
    const archived = memory({ title: "Orders are cancelled through the saga" });
    const superseded = memory({ title: "Handlers return problem details", kind: "convention" });
    const kept = memory({ title: "Sagas own their compensation" });
    for (const id of [archived, superseded, kept]) show(id, 3);
    await propose();
    expect(
      listPromotions(db, projectId)
        .map((p) => p.memoryId)
        .sort(),
    ).toEqual([archived, superseded, kept].sort());
    db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [archived]);
    db.run("UPDATE memories SET status = 'superseded' WHERE id = ?", [superseded]);
    expect(listPromotions(db, projectId).map((p) => p.memoryId)).toEqual([kept]);
    expect(listPromotions(db).map((p) => p.memoryId)).toEqual([kept]);
    db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [projectId]);
    expect(listPromotions(db, projectId)).toEqual([]);
  });

  test("the open proposals are listed with the memory's text", async () => {
    const id = memory({ title: "Sagas own their compensation", body: "Each step undoes itself." });
    show(id, 3);
    await propose();
    expect(listPromotions(db, projectId)).toEqual([
      {
        id: proposalFor(id).id,
        projectId,
        memoryId: id,
        slug: "sagas-own-their-compensation",
        title: "Sagas own their compensation",
        body: "Each step undoes itself.",
        kind: "decision",
        createdAt: NOW,
      },
    ]);
  });
});

describe("structural evidence: what counts as shown (final review I1, layer 1)", () => {
  test("shown at session start in 5 sessions on 5 days: not proposed", async () => {
    const id = memory({ title: "Plan for this afternoon's refactor of the cart" });
    for (let i = 0; i < 5; i++) showOnce(id, { event: "session-start", at: NOW - i * DAY });
    expect((await propose()).proposed).toBe(0);
  });

  test("shown on prompts in 3 contexts of one session: not proposed", async () => {
    const id = memory({ title: "Use the outbox for the cart events" });
    const session = newSession();
    for (let i = 0; i < 3; i++) showOnce(id, { session, context: 1 + i, at: NOW - i * DAY });
    expect((await propose()).proposed).toBe(0);
  });

  test("shown on prompts and fetches in 3 sessions over 2 days: proposed", async () => {
    const id = memory({ title: "Money is stored in integer cents" });
    showOnce(id, { at: NOW - 2 * DAY });
    showOnce(id, { event: "mcp", at: NOW - DAY });
    showOnce(id, { event: "file-read", at: NOW });
    expect((await propose()).proposed).toBe(1);
  });

  test("3 sessions within one day are not enough; a fourth a day later is (never lost)", async () => {
    const id = memory({ title: "Orders are never deleted, only cancelled" });
    for (let i = 0; i < 3; i++) showOnce(id, { at: NOW + i * 3_600_000 });
    expect((await propose()).proposed).toBe(0);
    showOnce(id, { at: NOW + DAY });
    expect((await propose()).proposed).toBe(1);
  });

  test("the author's own rule is proposed without any showing", async () => {
    const id = memory({ title: "Run the pinned bun before committing", kind: "convention" });
    db.run("INSERT INTO user_memories (memory_id, proposal_id, created_at) VALUES (?, NULL, ?)", [
      id,
      NOW,
    ]);
    showOnce(id, { event: "session-start" });
    expect((await propose()).proposed).toBe(1);
  });

  test("migration 5 replaces the contexts index with one that carries the event and the time", async () => {
    const names = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'injections' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(names).toContain("injections_memory_shown");
    expect(names).not.toContain("injections_memory_contexts");
  });

  test("the index comes back at the next pass after a core rebuild dropped it (self-repair)", async () => {
    db.run("DROP INDEX injections_memory_shown");
    const id = memory({ title: "Invoices are immutable once sent" });
    show(id, 3);
    expect((await propose()).proposed).toBe(1);
    expect(
      db
        .query<{ n: number }, []>(
          "SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'injections_memory_shown'",
        )
        .get()?.n,
    ).toBe(1);
  });
});

describe("session artifacts are not proposed (final review I1, layer 2)", () => {
  test("the probe: no episodic memory proposed, at least 9 of 10 standing rules kept", async () => {
    const ids = new Map<number, string>();
    for (const m of [...EPISODIC, ...STANDING]) {
      const id = memory({
        title: m.title,
        body: m.body,
        kind: m.kind,
        ...(m.prompt === undefined ? {} : { prompt: m.prompt }),
      });
      ids.set(id, m.family ?? "standing");
      show(id, 3);
    }
    const dropped: { id: number; layer: string; reason: string }[] = [];
    await propose({ onDrop: (drop) => dropped.push(drop) });
    const proposedIds = proposals().map((row) => row.memory_id);
    const kinds = proposedIds.map((id) => ids.get(id));
    expect(kinds.filter((kind) => kind !== "standing")).toEqual([]);
    expect(kinds.filter((kind) => kind === "standing").length).toBeGreaterThanOrEqual(9);
    // Each drop is reported with its layer and the pattern that caught it.
    expect(dropped.length).toBe(EPISODIC.length);
    for (const drop of dropped) {
      expect(drop).toEqual({ id: drop.id, layer: "episodic", reason: ids.get(drop.id) as string });
    }
  });

  test("the author's own rule is proposed even when it reads like a session record", async () => {
    const id = memory({ title: "Never merge a PR #12-style hotfix today without a review" });
    db.run("INSERT INTO user_memories (memory_id, proposal_id, created_at) VALUES (?, NULL, ?)", [
      id,
      NOW,
    ]);
    expect((await propose()).proposed).toBe(1);
  });

  test("dropped for its text, it is looked at again once edited", async () => {
    const id = memory({
      title: "Dispatched the cart work; money is stored in cents",
      body: "Amounts are integers.",
    });
    show(id, 3);
    expect((await propose()).proposed).toBe(0);
    db.run("UPDATE memories SET title = 'Money is stored in cents', updated_at = ? WHERE id = ?", [
      NOW + 1000,
      id,
    ]);
    expect((await propose()).proposed).toBe(1);
  });
});

describe("the judge, only with a key (final review I1, layer 3)", () => {
  /** A judge that says whether a memory is standing knowledge, by its title. */
  function judgeOf(
    verdict: (title: string) => StandingVerdict | Error,
    asked: string[] = [],
  ): Judge {
    return {
      ...heuristicJudge,
      standing: async (input) => {
        asked.push(input.title);
        const answer = verdict(input.title);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    };
  }

  test("a sure 'not standing' drops the memory, remembered so it is never asked again", async () => {
    const episodic = memory({ title: "Moved the invoices work to the new branch" });
    const rule = memory({ title: "Invoices are immutable once sent" });
    show(episodic, 3);
    show(rule, 3);
    const asked: string[] = [];
    const judge = judgeOf(
      (title) =>
        title.startsWith("Moved")
          ? { standing: false, confidence: 0.9 }
          : { standing: true, confidence: 0.8 },
      asked,
    );
    const dropped: { id: number; layer: string; reason: string }[] = [];
    await propose({ judge, onDrop: (drop) => dropped.push(drop) });
    expect(proposals().map((row) => row.memory_id)).toEqual([rule]);
    expect(dropped).toEqual([{ id: episodic, layer: "judge", reason: "not standing (0.90)" }]);
    // Shown again: not asked again.
    show(episodic, 1);
    asked.length = 0;
    await propose({ judge });
    expect(asked).toEqual([]);
    expect(proposals().map((row) => row.memory_id)).toEqual([rule]);
  });

  test("an unsure verdict, an error or no verdict keeps it: the author decides", async () => {
    const unsure = memory({ title: "Prefer the outbox for order events" });
    const failing = memory({ title: "Prices are stored with their currency" });
    show(unsure, 3);
    show(failing, 3);
    await propose({
      judge: judgeOf((title) =>
        title.startsWith("Prefer") ? { standing: false, confidence: 0.6 } : new Error("down"),
      ),
    });
    expect(proposals().map((row) => row.memory_id)).toEqual([unsure, failing]);
  });

  test("without a judge that can tell, nothing is asked and the exact rules decide", async () => {
    const id = memory({ title: "Invoices are immutable once sent" });
    show(id, 3);
    await propose({ judge: heuristicJudge });
    expect(proposals().map((row) => row.memory_id)).toEqual([id]);
  });

  test("the author's own rule is never asked about", async () => {
    const id = memory({ title: "Run the pinned bun before committing", kind: "convention" });
    db.run("INSERT INTO user_memories (memory_id, proposal_id, created_at) VALUES (?, NULL, ?)", [
      id,
      NOW,
    ]);
    const asked: string[] = [];
    await propose({ judge: judgeOf(() => ({ standing: false, confidence: 1 }), asked) });
    expect(asked).toEqual([]);
    expect(proposals().map((row) => row.memory_id)).toEqual([id]);
  });

  test("bounded: at most 20 questions a pass; the rest wait for the next", async () => {
    const ids = Array.from({ length: 25 }, (_, i) =>
      memory({ title: `Standing rule number ${i}` }),
    );
    for (const id of ids) show(id, 3);
    const asked: string[] = [];
    const judge = judgeOf(() => ({ standing: true, confidence: 0.9 }), asked);
    await propose({ judge });
    expect(asked.length).toBe(20);
    expect(proposals().length).toBe(20);
    await propose({ judge });
    expect(asked.length).toBe(25);
    expect(proposals().map((row) => row.memory_id)).toEqual(ids);
  });
});

describe("accepting a proposal", () => {
  test("writes the entry file, indexes it and marks the memory promoted", async () => {
    const decision = memory({ title: "Orders are cancelled through the saga", body: "Body A." });
    const convention = memory({
      title: "Handlers return problem details",
      kind: "convention",
      body: "Body B.",
    });
    show(decision, 3);
    show(convention, 3);
    await propose();
    expect(existsSync(dir)).toBe(false);

    const first = accept(decision);
    expect(first).toEqual({
      slug: "orders-are-cancelled-through-the-saga",
      path: join(dir, "orders-are-cancelled-through-the-saga.md"),
    });
    expect(readFileSync(join(dir, "orders-are-cancelled-through-the-saga.md"), "utf8")).toBe(
      `---\ntitle: "Orders are cancelled through the saga"\nkind: decision\nessential: false\nstatus: active\nupdated: ${TODAY}\nsource: "memory:${decision}"\n---\nBody A.\n`,
    );
    accept(convention);
    const entries = readEntries(dir);
    expect(entries.map((entry) => [entry.slug, entry.kind, entry.source])).toEqual([
      ["handlers-return-problem-details", "rule", `memory:${convention}`],
      ["orders-are-cancelled-through-the-saga", "decision", `memory:${decision}`],
    ]);
    expect(
      db
        .query<{ slug: string }, [number]>(
          "SELECT slug FROM knowledge_entries WHERE project_id = ? ORDER BY slug",
        )
        .all(projectId)
        .map((row) => row.slug),
    ).toEqual(["handlers-return-problem-details", "orders-are-cancelled-through-the-saga"]);
    expect(
      db
        .query<{ memory_id: number; slug: string }, []>(
          "SELECT memory_id, slug FROM promoted_memories ORDER BY memory_id",
        )
        .all(),
    ).toEqual([
      { memory_id: decision, slug: "orders-are-cancelled-through-the-saga" },
      { memory_id: convention, slug: "handlers-return-problem-details" },
    ]);
    expect(proposals().map((row) => row.status)).toEqual(["accepted", "accepted"]);
    // Decided once.
    expect(accept(decision)).toEqual({ refused: expect.stringMatching(/accepted/) });
  });

  test("a name already taken gets a free one; the author's file is untouched", async () => {
    mkdirSync(dir, { recursive: true });
    const theirs = "---\ntitle: Theirs\n---\nMine.\n";
    Bun.write(join(dir, "use-the-outbox.md"), theirs);
    const id = memory({ title: "Use the outbox" });
    show(id, 3);
    await propose();
    expect(accept(id)).toEqual({
      slug: "use-the-outbox-2",
      path: join(dir, "use-the-outbox-2.md"),
    });
    expect(readFileSync(join(dir, "use-the-outbox.md"), "utf8")).toBe(theirs);
  });

  test("refused where knowledge is off: the home folder, a linked folder", async () => {
    const id = memory({ title: "Use the outbox" });
    show(id, 3);
    await propose();
    const proposal = proposalFor(id);
    expect(acceptPromotion(db, proposal.id, { now: NOW, env: { ...env, HOME: repo } })).toEqual({
      refused: expect.stringMatching(/Knowledge is off here.*Nothing was written/),
    });
    expect(filesIn()).toEqual([]);
    if (process.platform !== "win32") {
      const elsewhere = join(base, "elsewhere");
      mkdirSync(elsewhere);
      symlinkSync(elsewhere, join(repo, ".wizardingcode"));
      expect(acceptPromotion(db, proposal.id, { now: NOW, env })).toEqual({
        refused: expect.stringMatching(/is a link.*Nothing was written/),
      });
      expect(readdirSync(elsewhere)).toEqual([]);
    }
    expect(proposals()[0]?.status).toBe("proposed");
  });

  test("refused when the memory is no longer an active decision or convention", async () => {
    const id = memory({ title: "Use the outbox" });
    show(id, 3);
    await propose();
    db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [id]);
    expect(accept(id)).toEqual({ refused: expect.stringMatching(/no longer/) });
    expect(filesIn()).toEqual([]);
  });

  test("refused when memory was turned off for the project meanwhile", async () => {
    const id = memory({ title: "Use the outbox" });
    show(id, 3);
    await propose();
    db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [projectId]);
    expect(accept(id)).toEqual({ refused: expect.stringMatching(/off/) });
    expect(filesIn()).toEqual([]);
  });
});

describe("accepting holds the write lock only briefly (fix round 1)", () => {
  const ready = async (title: string) => {
    const id = memory({ title });
    show(id, 3);
    await propose();
    return proposalFor(id);
  };
  const storeFile = () => join(base, "store", "wizardingcode-mem.db");

  test("no file work happens inside a transaction; another writer gets the lock meanwhile", async () => {
    const proposal = await ready("Use the outbox");
    const seen: string[] = [];
    const watch = (name: "linkSync" | "readdirSync" | "mkdirSync" | "openSync") => {
      const original = fs[name] as (...args: unknown[]) => unknown;
      return spyOn(fs, name).mockImplementation(((...args: unknown[]) => {
        if (db.inTransaction) seen.push(name);
        return original(...args);
      }) as never);
    };
    let other = "not tried";
    const original = fs.linkSync;
    const spies = [watch("readdirSync"), watch("mkdirSync"), watch("openSync")];
    const link = spyOn(fs, "linkSync").mockImplementation(((from: string, to: string) => {
      if (db.inTransaction) seen.push("linkSync");
      // A hook in another process taking the write lock while the file is written.
      const hook = new Database(storeFile());
      try {
        hook.run("PRAGMA busy_timeout = 0");
        hook.run("BEGIN IMMEDIATE");
        hook.run("COMMIT");
        other = "got the lock";
      } catch (error) {
        other = String(error);
      } finally {
        hook.close();
      }
      return original(from, to);
    }) as never);
    try {
      expect(acceptPromotion(db, proposal.id, { now: NOW, env })).toEqual({
        slug: "use-the-outbox",
        path: join(dir, "use-the-outbox.md"),
      });
    } finally {
      link.mockRestore();
      for (const spy of spies) spy.mockRestore();
    }
    expect(seen).toEqual([]);
    expect(other).toBe("got the lock");
  });

  test("a failure recording the decision leaves no file; a retry writes the original name", async () => {
    const proposal = await ready("Use the outbox");
    db.run(
      "CREATE TEMP TRIGGER boom BEFORE INSERT ON promoted_memories BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    expect(() => acceptPromotion(db, proposal.id, { now: NOW, env })).toThrow(/boom/);
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
    expect(proposals()[0]?.status).toBe("proposed");
    db.run("DROP TRIGGER boom");
    expect(acceptPromotion(db, proposal.id, { now: NOW, env })).toEqual({
      slug: "use-the-outbox",
      path: join(dir, "use-the-outbox.md"),
    });
    expect(readdirSync(dir)).toEqual(["use-the-outbox.md"]);
  });

  test("two accepts of one proposal at once write one file", async () => {
    const proposal = await ready("Use the outbox");
    const original = fs.linkSync;
    let second: ReturnType<typeof acceptPromotion> | null = null;
    // The second click lands while the first is writing its file.
    const link = spyOn(fs, "linkSync").mockImplementation(((from: string, to: string) => {
      if (second === null) {
        second = { refused: "running" };
        second = acceptPromotion(db, proposal.id, { now: NOW, env });
      }
      return original(from, to);
    }) as never);
    let first: ReturnType<typeof acceptPromotion>;
    try {
      first = acceptPromotion(db, proposal.id, { now: NOW, env });
    } finally {
      link.mockRestore();
    }
    const outcomes = [first, second].map((r) =>
      r !== null && "slug" in r ? "accepted" : "refused",
    );
    expect(outcomes.sort()).toEqual(["accepted", "refused"]);
    expect(readdirSync(dir)).toEqual(["use-the-outbox.md"]);
    expect(db.query<{ slug: string }, []>("SELECT slug FROM promoted_memories").all()).toEqual([
      { slug: "use-the-outbox" },
    ]);
  });
});

describe("a promoted memory's notes (Review Focus 5, ruling K9)", () => {
  const TITLE = "Orders are cancelled through the saga orchestrator";
  const PROMPT = "how are orders cancelled by the saga orchestrator here?";
  const SLUG = "orders-are-cancelled-through-the-saga-orchestrator";
  let promoted: number;
  let other: number;

  beforeEach(async () => {
    promoted = memory({ title: TITLE, files: ["src/orders/cancel.ts"] });
    other = memory({
      title: "Orders keep their saga orchestrator log for audits",
      files: ["src/orders/cancel.ts"],
    });
    show(promoted, 3);
    await propose();
    accept(promoted);
  });

  let ctxEpoch = 0;
  /** A new context; with `entryShown`, knowledge has already put the entry in it. */
  const context = (entryShown: boolean) => {
    const at = ++ctxEpoch;
    if (entryShown) {
      db.run(
        `INSERT INTO knowledge_shown (session_id, context_epoch, project_id, slug, event, at)
         VALUES (?, ?, ?, ?, 'prompt', ?)`,
        [sessionId, at, projectId, SLUG, NOW],
      );
    }
    return at;
  };
  const briefIds = (entryShown = true) =>
    sessionBrief(db, {
      projectId,
      sessionId,
      epoch: context(entryShown),
      branch: null,
      now: NOW,
    }).notes.map((note) => note.id);
  const promptIds = (entryShown = true) =>
    retrieveForPrompt(db, {
      projectId,
      sessionId,
      epoch: context(entryShown),
      prompt: PROMPT,
      branch: null,
      now: NOW,
    }).map((note) => note.id);
  const fileIds = (entryShown = true) =>
    notesForFile(db, {
      projectId,
      sessionId,
      epoch: context(entryShown),
      path: "src/orders/cancel.ts",
      branch: null,
      now: NOW,
    }).map((note) => note.id);
  const failureIds = (entryShown = true) =>
    notesForFailure(db, {
      projectId,
      sessionId,
      epoch: context(entryShown),
      error: "Error: orders saga orchestrator cancelled twice",
      branch: null,
      now: NOW,
    }).map((note) => note.id);

  test("hidden where knowledge showed its entry in this context", async () => {
    expect(briefIds()).toEqual([other]);
    expect(promptIds()).toEqual([other]);
    expect(fileIds()).toEqual([other]);
  });

  test("shown where knowledge did not show its entry in this context: never less visible", async () => {
    expect(briefIds(false).sort()).toEqual([promoted, other].sort());
    expect(promptIds(false).sort()).toEqual([promoted, other].sort());
    expect(fileIds(false).sort()).toEqual([promoted, other].sort());
  });

  test("edited later, still hidden while the entry exists; turned into a gotcha too", async () => {
    db.run(
      "UPDATE memories SET body = 'Edited after.', kind = 'gotcha', updated_at = ? WHERE id = ?",
      [NOW + 1000, promoted],
    );
    db.run("UPDATE memories SET kind = 'gotcha' WHERE id = ?", [other]);
    expect(briefIds()).toEqual([other]);
    expect(promptIds()).toEqual([other]);
    expect(failureIds()).toEqual([other]);
  });

  test("archived, it stays out; brought back while the entry exists, still hidden", async () => {
    db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [promoted]);
    expect(briefIds()).toEqual([other]);
    db.run("UPDATE memories SET status = 'active' WHERE id = ?", [promoted]);
    expect(briefIds()).toEqual([other]);
  });

  test("its entry file deleted by hand: the notes come back once the index follows", async () => {
    rmSync(join(dir, `${SLUG}.md`));
    refreshIndex(db, projectId, dir);
    expect(briefIds().sort()).toEqual([promoted, other].sort());
    expect(promptIds().sort()).toEqual([promoted, other].sort());
    expect(fileIds().sort()).toEqual([promoted, other].sort());
  });

  test("its entry retired by the author (draft or superseded): the notes come back (task 4 minor 5)", async () => {
    const file = join(dir, `${SLUG}.md`);
    const text = readFileSync(file, "utf8");
    for (const status of ["superseded", "draft"]) {
      writeFileSync(file, text.replace("status: active", `status: ${status}`));
      refreshIndex(db, projectId, dir, { force: true });
      expect(briefIds().sort()).toEqual([promoted, other].sort());
      expect(promptIds().sort()).toEqual([promoted, other].sort());
      expect(fileIds().sort()).toEqual([promoted, other].sort());
    }
    // Made active again: the entry says it once more.
    writeFileSync(file, text);
    refreshIndex(db, projectId, dir, { force: true });
    expect(briefIds()).toEqual([other]);
  });

  const hookInput = (
    moment: MomentInput["moment"],
    at: number,
  ): Omit<MomentInput, "budgetChars"> => ({
    db,
    moment,
    projectId,
    branch: null,
    root: repo,
    projectRoot: repo,
    sessionId,
    epoch: at,
    prompt: moment === "prompt" ? PROMPT : null,
    path: moment === "file-read" ? "src/orders/cancel.ts" : null,
    error: moment === "tool-failed" ? "Error: orders saga orchestrator cancelled twice" : null,
    now: NOW,
  });

  test("through the hooks: a file read or a failure where the entry was not shown still says it (K9)", async () => {
    const modules = enabledModules("memory,knowledge", undefined, () => {});
    // A context where knowledge never put the entry: reading the file brings the rule.
    expect(compose(modules, hookInput("file-read", 300)) ?? "").toContain(`#${promoted} `);
    // Failures bring fixes and gotchas only.
    db.run("UPDATE memories SET kind = 'gotcha' WHERE id = ?", [promoted]);
    expect(compose(modules, hookInput("tool-failed", 301)) ?? "").toContain(`#${promoted} `);
    // A prompt shows the entry; in that context memory then leaves the rule to it.
    const prompt = compose(modules, hookInput("prompt", 302)) ?? "";
    expect(prompt).toContain("<wizardingcode-knowledge>");
    expect(prompt).not.toContain(`#${promoted} `);
    expect(compose(modules, hookInput("file-read", 302)) ?? "").not.toContain(`#${promoted} `);
    // The context cleared or compacted: the entry is no longer in front of the agent.
    expect(compose(modules, hookInput("file-read", 303)) ?? "").toContain(`#${promoted} `);
  });

  test("through the hooks: the knowledge module notices the deletion on the next prompt", async () => {
    const modules = enabledModules("memory,knowledge", undefined, () => {});
    const before = compose(modules, hookInput("prompt", 501)) ?? "";
    expect(before).toContain("<wizardingcode-knowledge>");
    expect(before).not.toContain(`#${promoted}`);
    rmSync(join(dir, `${SLUG}.md`));
    const after = compose(modules, hookInput("prompt", 502)) ?? "";
    expect(after).not.toContain("<wizardingcode-knowledge>");
    expect(after).toContain(TITLE);
  });

  test("the whole folder deleted, or turned into a link: the note comes back at once", async () => {
    const modules = enabledModules("memory,knowledge", undefined, () => {});
    // Knowledge showed the entry in this context; then the folder goes.
    context(true);
    rmSync(join(repo, ".wizardingcode"), { recursive: true });
    // No folder: the hook does not touch the index (one stat), yet the note is memory's again.
    expect(compose(modules, hookInput("file-read", ctxEpoch)) ?? "").toContain(TITLE);
    if (process.platform !== "win32") {
      const elsewhere = join(base, "elsewhere");
      mkdirSync(join(elsewhere, "knowledge"), { recursive: true });
      symlinkSync(elsewhere, join(repo, ".wizardingcode"));
      expect(compose(modules, hookInput("prompt", context(true))) ?? "").toContain(TITLE);
    }
  });

  test("with the knowledge module off, memory says the note itself", async () => {
    const at = context(true);
    const text = compose(
      enabledModules("memory", undefined, () => {}),
      hookInput("prompt", at),
    );
    expect(text ?? "").toContain(TITLE);
  });

  test("fails open: with the promotion table unreadable, memory shows every note", async () => {
    db.run("DROP TABLE promoted_memories");
    expect(briefIds().sort()).toEqual([promoted, other].sort());
  });
});

describe("the background drain", () => {
  test("proposes after the rules, never writing a file; not with knowledge off", async () => {
    db.close();
    const dataDir = join(base, "data");
    db = openDb({ dataDir, busyTimeoutMs: 2000 });
    projectId = resolveProject(db, repo, NOW).id;
    sessionId = touchSession(db, {
      agent: "claude-code",
      agentSessionId: "s-drain",
      projectId,
      cwd: repo,
      branch: null,
      now: NOW,
    }).id;
    const id = memory({ title: "Ship migrations before code" });
    show(id, 3);
    db.close();
    const drain = (modules: string) =>
      runCliWith(
        {
          env: {
            ...env,
            WIZARDINGCODE_MEM_DATA_DIR: dataDir,
            WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
            WIZARDINGCODE_MEM_DISTILL: "",
            WIZARDINGCODE_MODULES: modules,
          },
        },
        "distill",
      );
    expect((await drain("memory")).exitCode).toBe(0);
    db = openDb({ dataDir, busyTimeoutMs: 2000 });
    expect(proposals()).toEqual([]);
    db.close();
    expect((await drain("memory,knowledge")).exitCode).toBe(0);
    db = openDb({ dataDir, busyTimeoutMs: 2000 });
    expect(proposals().map((row) => [row.memory_id, row.status])).toEqual([[id, "proposed"]]);
    expect(filesIn()).toEqual([]);
  }, 30_000);
});
