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
import { knowledgeDir, readEntries } from "../../src/modules/knowledge/files.ts";
import { refreshIndex } from "../../src/modules/knowledge/index-store.ts";
import {
  acceptPromotion,
  listPromotions,
  PROMOTE_LEASE,
  proposePromotions,
  rejectPromotion,
  SHOWN_CONTEXTS_SQL,
} from "../../src/modules/knowledge/promote.ts";
import { sessionBrief } from "../../src/retrieve/brief.ts";
import { notesForFailure } from "../../src/retrieve/failure.ts";
import { notesForFile } from "../../src/retrieve/file.ts";
import { retrieveForPrompt } from "../../src/retrieve/prompt.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { claimLease } from "../../src/store/meta.ts";
import { touchSession } from "../../src/store/sessions.ts";
import { searchTerms } from "../../src/util/words.ts";
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
    sourceTurnId: null,
    files: (input.files ?? []).map((path) => ({ path, role: "changed" as const })),
    now: NOW,
  });
}

/** Records the memory as shown this many more times, each in a context of its own. */
function show(memoryId: number, times: number): void {
  for (let i = 0; i < times; i++) {
    epoch++;
    db.run(
      `INSERT INTO injections (session_id, context_epoch, memory_id, event, tokens, at)
       VALUES (?, ?, ?, 'prompt', 10, ?)`,
      [sessionId, 1000 + epoch, memoryId, NOW],
    );
  }
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
  test("active decisions and conventions of importance 4 or more, shown at least 3 times", () => {
    const decision = memory({ title: "Orders are cancelled through the saga" });
    const convention = memory({ title: "Handlers return problem details", kind: "convention" });
    const twice = memory({ title: "Retry the webhook twice" });
    const minor = memory({ title: "Prefer named exports here", importance: 3 });
    const gotcha = memory({ title: "The clock skews in CI", kind: "gotcha", importance: 5 });
    const archived = memory({ title: "Old queue settled on Redis" });
    db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [archived]);
    for (const id of [decision, convention, minor, gotcha, archived]) show(id, 3);
    show(twice, 2);

    const result = propose();
    expect(result.proposed).toBe(2);
    expect(proposals().map((row) => [row.memory_id, row.slug, row.status])).toEqual([
      [decision, "orders-are-cancelled-through-the-saga", "proposed"],
      [convention, "handlers-return-problem-details", "proposed"],
    ]);
    // Proposing writes nothing anywhere.
    expect(filesIn()).toEqual([]);
  });

  test("shown counts contexts: one context's heading, note and fetches count once", () => {
    const once = memory({ title: "Webhooks are verified before parsing" });
    epoch++;
    for (const event of ["session-start", "prompt", "mcp", "mcp", "mcp"]) {
      db.run(
        `INSERT INTO injections (session_id, context_epoch, memory_id, event, tokens, at)
         VALUES (?, ?, ?, ?, 10, ?)`,
        [sessionId, 1000 + epoch, once, event, NOW],
      );
    }
    show(once, 1);
    expect(propose().proposed).toBe(0);
    show(once, 1);
    expect(propose().proposed).toBe(1);
  });

  test("one of the author's own rules qualifies without being shown", () => {
    const rule = memory({ title: "Run the pinned bun before committing", kind: "convention" });
    const plain = memory({ title: "Keep the queue lease short", kind: "convention" });
    db.run("INSERT INTO user_memories (memory_id, proposal_id, created_at) VALUES (?, NULL, ?)", [
      rule,
      NOW,
    ]);
    propose();
    expect(proposals().map((row) => row.memory_id)).toEqual([rule]);
    expect(plain).toBeGreaterThan(0);
  });

  test("not in a project whose memory is off, nor where knowledge is off", () => {
    const off = memory({ title: "Use the outbox for events" });
    show(off, 3);
    db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [projectId]);
    propose();
    expect(proposals()).toEqual([]);

    db.run("UPDATE projects SET disabled = 0 WHERE id = ?", [projectId]);
    const home = memory({ title: "Use the outbox for commands" });
    show(home, 3);
    // An agent run in the home folder: its "project" is no repository.
    propose({ env: { ...env, HOME: repo } });
    expect(proposals()).toEqual([]);
  });

  test("a memory shown a third time later is proposed on a later pass (the cursor)", () => {
    const id = memory({ title: "Invoices are immutable once sent" });
    show(id, 2);
    expect(propose().proposed).toBe(0);
    // Nothing new: one look and out.
    expect(propose()).toEqual({ proposed: 0, scanned: 0 });
    show(id, 1);
    expect(propose().proposed).toBe(1);
  });

  test("raised to importance 4 later, it is reached through the changed memories", () => {
    const id = memory({ title: "Prices are stored in cents", importance: 3 });
    show(id, 3);
    expect(propose().proposed).toBe(0);
    db.run("UPDATE memories SET importance = 4, updated_at = ? WHERE id = ?", [NOW + 1000, id]);
    expect(propose().proposed).toBe(1);
  });

  test("bounded: a small batch takes several passes and reaches every memory", () => {
    const ids = Array.from({ length: 5 }, (_, i) => memory({ title: `Decision number ${i}` }));
    for (const id of ids) show(id, 3);
    const first = propose({ batch: 2, injectionBatch: 4 });
    expect(first.proposed).toBeLessThan(5);
    for (let i = 0; i < 10; i++) propose({ batch: 2, injectionBatch: 4 });
    expect(proposals().map((row) => row.memory_id)).toEqual(ids);
  });

  test("never while another process holds the lease", () => {
    const id = memory({ title: "Only one migration per release" });
    show(id, 3);
    // The test's own process: alive, so the lease holds.
    expect(claimLease(db, PROMOTE_LEASE, `${process.pid}-other`, Date.now(), 60_000)).toBe(true);
    expect(propose({ owner: `${process.pid}-mine` })).toEqual({ proposed: 0, scanned: 0 });
    expect(proposals()).toEqual([]);
  });

  test("a memory proposed once is never proposed again, rejected or not", () => {
    const id = memory({ title: "Feature flags live in the config service" });
    show(id, 3);
    propose();
    const proposal = proposalFor(id);
    expect(rejectPromotion(db, proposal.id, NOW)).toBe(true);
    expect(rejectPromotion(db, proposal.id, NOW)).toBe(false);
    show(id, 5);
    db.run("UPDATE memories SET body = 'Edited.', updated_at = ? WHERE id = ?", [NOW + 5000, id]);
    propose();
    expect(proposals()).toEqual([{ ...proposal, status: "rejected" }]);
    expect(listPromotions(db, projectId)).toEqual([]);
  });

  test("the shown count reads an index, not every injection record (task 4 minor 3)", () => {
    const plan = db
      .query<{ detail: string }, []>(`EXPLAIN QUERY PLAN ${SHOWN_CONTEXTS_SQL("1, 2, 3")}`)
      .all()
      .map((row) => row.detail)
      .join("\n");
    expect(plan).not.toMatch(/SCAN injections/);
    expect(plan).toMatch(/SEARCH injections USING COVERING INDEX/);
  });

  test("a proposal whose memory is no longer active, or whose project has memory off, is not listed (task 4 minor 4)", () => {
    const archived = memory({ title: "Orders are cancelled through the saga" });
    const superseded = memory({ title: "Handlers return problem details", kind: "convention" });
    const kept = memory({ title: "Sagas own their compensation" });
    for (const id of [archived, superseded, kept]) show(id, 3);
    propose();
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

  test("the open proposals are listed with the memory's text", () => {
    const id = memory({ title: "Sagas own their compensation", body: "Each step undoes itself." });
    show(id, 3);
    propose();
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

describe("accepting a proposal", () => {
  test("writes the entry file, indexes it and marks the memory promoted", () => {
    const decision = memory({ title: "Orders are cancelled through the saga", body: "Body A." });
    const convention = memory({
      title: "Handlers return problem details",
      kind: "convention",
      body: "Body B.",
    });
    show(decision, 3);
    show(convention, 3);
    propose();
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

  test("a name already taken gets a free one; the author's file is untouched", () => {
    mkdirSync(dir, { recursive: true });
    const theirs = "---\ntitle: Theirs\n---\nMine.\n";
    Bun.write(join(dir, "use-the-outbox.md"), theirs);
    const id = memory({ title: "Use the outbox" });
    show(id, 3);
    propose();
    expect(accept(id)).toEqual({
      slug: "use-the-outbox-2",
      path: join(dir, "use-the-outbox-2.md"),
    });
    expect(readFileSync(join(dir, "use-the-outbox.md"), "utf8")).toBe(theirs);
  });

  test("refused where knowledge is off: the home folder, a linked folder", () => {
    const id = memory({ title: "Use the outbox" });
    show(id, 3);
    propose();
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

  test("refused when the memory is no longer an active decision or convention", () => {
    const id = memory({ title: "Use the outbox" });
    show(id, 3);
    propose();
    db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [id]);
    expect(accept(id)).toEqual({ refused: expect.stringMatching(/no longer/) });
    expect(filesIn()).toEqual([]);
  });

  test("refused when memory was turned off for the project meanwhile", () => {
    const id = memory({ title: "Use the outbox" });
    show(id, 3);
    propose();
    db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [projectId]);
    expect(accept(id)).toEqual({ refused: expect.stringMatching(/off/) });
    expect(filesIn()).toEqual([]);
  });
});

describe("accepting holds the write lock only briefly (fix round 1)", () => {
  const ready = (title: string) => {
    const id = memory({ title });
    show(id, 3);
    propose();
    return proposalFor(id);
  };
  const storeFile = () => join(base, "store", "wizardingcode-mem.db");

  test("no file work happens inside a transaction; another writer gets the lock meanwhile", () => {
    const proposal = ready("Use the outbox");
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

  test("a failure recording the decision leaves no file; a retry writes the original name", () => {
    const proposal = ready("Use the outbox");
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

  test("two accepts of one proposal at once write one file", () => {
    const proposal = ready("Use the outbox");
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

describe("a promoted memory's notes (Review Focus 5)", () => {
  const TITLE = "Orders are cancelled through the saga orchestrator";
  const PROMPT = "how are orders cancelled by the saga orchestrator here?";
  let promoted: number;
  let other: number;

  beforeEach(() => {
    promoted = memory({ title: TITLE, files: ["src/orders/cancel.ts"] });
    other = memory({
      title: "Orders keep their saga orchestrator log for audits",
      files: ["src/orders/cancel.ts"],
    });
    show(promoted, 3);
    propose();
    accept(promoted);
  });

  const briefIds = () =>
    sessionBrief(db, { projectId, branch: null, now: NOW }).notes.map((note) => note.id);
  let ctxEpoch = 0;
  const promptIds = () =>
    retrieveForPrompt(db, {
      projectId,
      sessionId,
      epoch: ++ctxEpoch,
      prompt: PROMPT,
      branch: null,
      now: NOW,
    }).map((note) => note.id);
  const fileIds = () =>
    notesForFile(db, {
      projectId,
      sessionId,
      epoch: ++ctxEpoch,
      path: "src/orders/cancel.ts",
      branch: null,
      now: NOW,
    }).map((note) => note.id);
  const failureIds = () =>
    notesForFailure(db, {
      projectId,
      sessionId,
      epoch: ++ctxEpoch,
      error: "Error: orders saga orchestrator cancelled twice",
      branch: null,
      now: NOW,
    }).map((note) => note.id);

  test("hidden at every moment while its entry exists", () => {
    expect(briefIds()).toEqual([other]);
    expect(promptIds()).toEqual([other]);
    expect(fileIds()).toEqual([other]);
  });

  test("edited later, still hidden while the entry exists; turned into a gotcha too", () => {
    db.run(
      "UPDATE memories SET body = 'Edited after.', kind = 'gotcha', updated_at = ? WHERE id = ?",
      [NOW + 1000, promoted],
    );
    db.run("UPDATE memories SET kind = 'gotcha' WHERE id = ?", [other]);
    expect(briefIds()).toEqual([other]);
    expect(promptIds()).toEqual([other]);
    expect(failureIds()).toEqual([other]);
  });

  test("archived, it stays out; brought back while the entry exists, still hidden", () => {
    db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [promoted]);
    expect(briefIds()).toEqual([other]);
    db.run("UPDATE memories SET status = 'active' WHERE id = ?", [promoted]);
    expect(briefIds()).toEqual([other]);
  });

  test("its entry file deleted by hand: the notes come back once the index follows", () => {
    rmSync(join(dir, "orders-are-cancelled-through-the-saga-orchestrator.md"));
    refreshIndex(db, projectId, dir);
    expect(briefIds().sort()).toEqual([promoted, other].sort());
    expect(promptIds().sort()).toEqual([promoted, other].sort());
    expect(fileIds().sort()).toEqual([promoted, other].sort());
  });

  test("its entry retired by the author (draft or superseded): the notes come back (task 4 minor 5)", () => {
    const file = join(dir, "orders-are-cancelled-through-the-saga-orchestrator.md");
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

  test("through the hooks: the knowledge module notices the deletion on the next prompt", () => {
    const moment = (n: number): Omit<MomentInput, "budgetChars"> => ({
      db,
      moment: "prompt",
      projectId,
      branch: null,
      root: repo,
      projectRoot: repo,
      sessionId,
      epoch: 500 + n,
      prompt: PROMPT,
      path: null,
      error: null,
      now: NOW,
    });
    const modules = enabledModules("memory,knowledge", undefined, () => {});
    const before = compose(modules, moment(1)) ?? "";
    expect(before).toContain("<wizardingcode-knowledge>");
    expect(before).not.toContain(`#${promoted}`);
    rmSync(join(dir, "orders-are-cancelled-through-the-saga-orchestrator.md"));
    const after = compose(modules, moment(2)) ?? "";
    expect(after).not.toContain("<wizardingcode-knowledge>");
    expect(after).toContain(TITLE);
  });

  test("the whole folder deleted, or turned into a link: the note comes back at once", () => {
    const moment = (n: number): Omit<MomentInput, "budgetChars"> => ({
      db,
      moment: "prompt",
      projectId,
      branch: null,
      root: repo,
      projectRoot: repo,
      sessionId,
      epoch: 700 + n,
      prompt: PROMPT,
      path: null,
      error: null,
      now: NOW,
    });
    const modules = enabledModules("memory,knowledge", undefined, () => {});
    rmSync(join(repo, ".wizardingcode"), { recursive: true });
    // No folder: the hook does not touch the index (one stat), yet the note is memory's again.
    expect(compose(modules, moment(1)) ?? "").toContain(TITLE);
    if (process.platform !== "win32") {
      const elsewhere = join(base, "elsewhere");
      mkdirSync(join(elsewhere, "knowledge"), { recursive: true });
      symlinkSync(elsewhere, join(repo, ".wizardingcode"));
      expect(compose(modules, moment(2)) ?? "").toContain(TITLE);
    }
  });

  test("with the knowledge module off, memory says the note itself", () => {
    const text =
      compose(
        enabledModules("memory", undefined, () => {}),
        {
          db,
          moment: "prompt",
          projectId,
          branch: null,
          root: repo,
          projectRoot: repo,
          sessionId,
          epoch: 900,
          prompt: PROMPT,
          path: null,
          error: null,
          now: NOW,
        },
      ) ?? "";
    expect(text).toContain(TITLE);
  });

  test("fails open: with the promotion table unreadable, memory shows every note", () => {
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
