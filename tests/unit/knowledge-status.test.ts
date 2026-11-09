// The `knowledge` line of `status`: how many entries the agent can be shown, how many are
// pinned, and how many were shown in the last day. Read from the index as it is.
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { pinnedLine } from "../../src/modules/knowledge/contribute.ts";
import { pinnedEntries } from "../../src/modules/knowledge/index-store.ts";
import { ensureRepo } from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import type { EntryChange, ScopeRef } from "../../src/modules/knowledge/types.ts";
import { formatStatus, knowledgeStatus, statusReport } from "../../src/status/report.ts";
import type { Db } from "../../src/store/db.ts";
import { type Fixture, knowledgeFixture } from "../helpers/knowledge.ts";

const WORKSPACE: ScopeRef = { scope: "workspace" };
const SHARED: ScopeRef = { scope: "shared" };
const NOW = Date.UTC(2026, 10, 9, 8, 0, 0);
const HOUR = 3_600_000;

let fx: Fixture;
beforeEach(() => {
  fx = knowledgeFixture("knowledge-status");
});
afterEach(() => {
  fx.close();
});

const change = (title: string, over: Partial<EntryChange> = {}): EntryChange => ({
  title,
  kind: "strategy",
  area: "sales",
  context: "",
  subject: "",
  body: `About ${title.toLowerCase()}.`,
  ...over,
});

/** Writes as a person, at `at`: the entry's `updated` is that moment. */
function write(ref: ScopeRef, title: string, over: Partial<EntryChange> = {}, at = NOW): string {
  const store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Zoë" }, now: () => at });
  const result = writeEntry(store, ref, change(title, over), personAuthor(store));
  if (result.kind !== "written") throw new Error("not written");
  return result.entry.id;
}

function shown(db: Db, sessionId: number, entryId: string, at: number): void {
  const repo = db
    .query<{ repo_id: number }, [string]>("SELECT repo_id FROM knowledge_entries WHERE id = ?")
    .get(entryId);
  db.run(
    `INSERT INTO knowledge_shown (session_id, context_epoch, repo_id, entry_id, event, rule, at)
     VALUES (?, 0, ?, ?, 'prompt', 'words', ?)`,
    [sessionId, repo?.repo_id ?? 0, entryId, at],
  );
}

/** Two repositories, five active entries, two pinned, a draft; one entry shown twice lately. */
function seed(): void {
  const first = write(WORKSPACE, "Discovery call script", { pinned: true }, NOW - 3 * HOUR);
  write(WORKSPACE, "Pricing rules for agencies");
  write(WORKSPACE, "A draft that is not shown", { status: "draft" });
  write(SHARED, "Discount ladder", { pinned: true }, NOW - 2 * HOUR);
  const old = write(SHARED, "Onboarding checklist");
  write(SHARED, "Renewal reminders");
  shown(fx.db, 1, first, NOW - HOUR);
  shown(fx.db, 2, first, NOW - 2 * HOUR);
  shown(fx.db, 3, old, NOW - 25 * HOUR);
}

describe("status: knowledge", () => {
  test("counts the active entries of every repository, the pinned, and those shown in 24 h", () => {
    seed();
    expect(knowledgeStatus(fx.db, NOW, true)).toEqual({
      on: true,
      entries: 5,
      pinned: 2,
      shown24h: 1,
    });
  });

  test("prints its line beside the sharing line", () => {
    seed();
    const report = statusReport(fx.db, null, fx.dataDir, { env: {}, now: NOW });
    expect(report.knowledge).toEqual({ on: true, entries: 5, pinned: 2, shown24h: 1 });
    const lines = formatStatus(report).split("\n");
    expect(lines).toContain("knowledge 5 entries · 2 pinned · 1 shown in 24 h");
    const at = lines.indexOf("knowledge 5 entries · 2 pinned · 1 shown in 24 h");
    expect(lines[at + 1]?.startsWith("sharing   ")).toBe(true);
  });

  test("one entry, one shown", () => {
    const id = write(WORKSPACE, "Discovery call script");
    shown(fx.db, 1, id, NOW - HOUR);
    const report = statusReport(fx.db, null, fx.dataDir, { env: {}, now: NOW });
    expect(formatStatus(report).split("\n")).toContain(
      "knowledge 1 entry · 0 pinned · 1 shown in 24 h",
    );
  });

  test("says off when the setting turned the module off", () => {
    seed();
    expect(
      formatStatus({
        ...statusReport(null, null, "/d"),
        knowledge: knowledgeStatus(fx.db, NOW, false),
      }).split("\n"),
    ).toContain("knowledge off");
    const report = statusReport(fx.db, null, fx.dataDir, {
      env: { WIZARDINGCODE_MODULES: "memory" },
      now: NOW,
    });
    expect(report.knowledge?.on).toBe(false);
    expect(formatStatus(report).split("\n")).toContain("knowledge off");
  });

  test("has no line where the knowledge tables do not exist, nor with no database", () => {
    const bare = new Database(":memory:") as unknown as Db;
    expect(knowledgeStatus(bare, NOW, true)).toBeNull();
    bare.close();
    for (const table of ["knowledge_shown", "knowledge_fts", "knowledge_proposals"]) {
      fx.db.run(`DROP TABLE ${table}`);
    }
    fx.db.run("DROP TABLE knowledge_entries");
    expect(knowledgeStatus(fx.db, NOW, true)).toBeNull();
    const report = statusReport(null, null, "/d");
    expect(report.knowledge).toBeNull();
    expect(
      formatStatus(report)
        .split("\n")
        .some((line) => line.startsWith("knowledge")),
    ).toBe(false);
  });
});

describe("the pinned entries, for session start and doctor", () => {
  test("are the pinned, active entries of the repositories given, newest first", () => {
    seed();
    write(WORKSPACE, "A pinned draft", { pinned: true, status: "draft" });
    const workspace = ensureRepo(fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Zoë" } }), WORKSPACE);
    const shared = ensureRepo(fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Zoë" } }), SHARED);
    const both = pinnedEntries(fx.db, [workspace.id, shared.id]);
    expect(both.map((entry) => entry.title)).toEqual(["Discount ladder", "Discovery call script"]);
    expect(pinnedEntries(fx.db, [workspace.id]).map((entry) => entry.slug)).toEqual([
      "discovery-call-script",
    ]);
    expect(pinnedEntries(fx.db, [])).toEqual([]);
    expect(both.map(pinnedLine)).toEqual([
      "- shared/discount-ladder · strategy · sales · Discount ladder",
      "- workspace/discovery-call-script · strategy · sales · Discovery call script",
    ]);
  });
});
