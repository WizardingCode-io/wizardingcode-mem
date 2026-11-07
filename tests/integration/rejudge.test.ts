import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importClaudeMem } from "../../src/import/claude-mem.ts";
import type { SystemOneRequest } from "../../src/judge/client.ts";
import { rejudge } from "../../src/judge/rejudge.ts";
import type { Judge } from "../../src/judge/types.ts";
import { TypeSafeJudge } from "../../src/judge/typesafe.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { makeClaudeMemDb } from "../helpers/claude-mem-db.ts";

let base: string;
let db: Db;
const NOW = Date.UTC(2026, 9, 5);

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "wizardingcode-mem-rejudge-"));
  db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
  const source = join(base, "claude-mem.db");
  makeClaudeMemDb(source, [
    {
      project: "shop",
      type: "discovery",
      title: "The cart total is rounded once, at the end.",
      facts: ["Per-line rounding caused drift."],
      filesModified: ["src/cart/total.ts"],
    },
    { project: "shop", type: "change", title: "Ran the formatter on three files.", facts: [] },
    {
      project: "shop",
      type: "feature",
      title: "Never deploy on Fridays.",
      facts: ["Support is thin at the weekend."],
    },
    { project: "shop", type: "decision", title: "Checked the logs.", facts: [] },
  ]);
  importClaudeMem(db, { sourcePath: source, now: NOW });
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

/** A judge that answers from a table keyed by the memory's title. */
function scripted(
  table: Record<string, { worth: number; kind: string; importance: number }>,
  seen: string[] = [],
): Judge {
  return {
    name: "typesafe",
    version: "2",
    versions: { typesafe: "2" },
    distill: async (input) => {
      const title = input.finalText.split("\n")[0] ?? "";
      seen.push(title);
      const answer = table[title];
      if (answer === undefined) throw new Error(`no scripted answer for "${title}"`);
      return {
        worthSaving: answer.worth,
        kind: answer.kind as never,
        kindConfidence: 0.9,
        importance: answer.importance as never,
        durable: input.candidates.map(() => 0.7),
        titleIdx: null,
        source: "typesafe",
      };
    },
    consolidate: async () => ({ source: "typesafe", perNeighbour: [] }),
  };
}

const TABLE = {
  "The cart total is rounded once, at the end.": { worth: 0.9, kind: "decision", importance: 4 },
  "Ran the formatter on three files.": { worth: 0.1, kind: "none", importance: 1 },
  "Never deploy on Fridays.": { worth: 0.95, kind: "convention", importance: 4 },
  "Checked the logs.": { worth: 0.2, kind: "none", importance: 1 },
};

const rows = () =>
  db
    .query<{ title: string; kind: string; importance: number; status: string; judge: string }, []>(
      "SELECT title, kind, importance, status, judge FROM memories ORDER BY id",
    )
    .all();

describe("rejudge", () => {
  test("imported memories get the judge's kind and importance; what is not worth keeping is archived, not deleted", async () => {
    const report = await rejudge(db, { judge: scripted(TABLE), now: NOW, concurrency: 2 });
    expect(report).toEqual({ judged: 4, archived: 2, kindChanged: 2, failed: 0, remaining: 0 });
    expect(rows()).toEqual([
      {
        title: "The cart total is rounded once, at the end.",
        kind: "decision",
        importance: 4,
        status: "active",
        judge: "typesafe",
      },
      {
        title: "Ran the formatter on three files.",
        kind: "change",
        importance: 1,
        status: "archived",
        judge: "typesafe",
      },
      {
        title: "Never deploy on Fridays.",
        kind: "convention",
        importance: 4,
        status: "active",
        judge: "typesafe",
      },
      {
        title: "Checked the logs.",
        kind: "decision",
        importance: 1,
        status: "archived",
        judge: "typesafe",
      },
    ]);
  });

  test("runs again without judging the same memories twice, and picks up from where it stopped", async () => {
    const seen: string[] = [];
    const first = await rejudge(db, { judge: scripted(TABLE, seen), now: NOW, limit: 2 });
    expect(seen).toHaveLength(2);
    expect(first.remaining).toBe(2);
    await rejudge(db, { judge: scripted(TABLE, seen), now: NOW });
    expect(seen).toHaveLength(4);
    const third = await rejudge(db, { judge: scripted(TABLE, seen), now: NOW });
    expect(third.judged).toBe(0);
    expect(seen).toHaveLength(4);
  });

  test("a memory the judge failed on is tried again on the next run", async () => {
    const partial = { ...TABLE };
    delete (partial as Record<string, unknown>)["Checked the logs."];
    await rejudge(db, { judge: scripted(partial), now: NOW });
    const seen: string[] = [];
    const report = await rejudge(db, { judge: scripted(TABLE, seen), now: NOW });
    expect(seen).toEqual(["Checked the logs."]);
    expect(report).toMatchObject({ judged: 1, failed: 0, remaining: 0 });
  });

  test("when TypeSafe is not answering and the fallback is, nothing is written and the run stops", async () => {
    // The importer resumes by source id, so the extra source repeats the four originals first.
    const source = join(base, "more.db");
    makeClaudeMemDb(source, [
      ...Object.keys(TABLE).map((title) => ({
        project: "shop",
        type: "discovery",
        title,
        facts: [],
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        project: "shop",
        type: "discovery",
        title: `Fact number ${i} about the shop.`,
        facts: [],
      })),
    ]);
    importClaudeMem(db, { sourcePath: source, now: NOW });
    let asked = 0;
    const heuristicOnly: Judge = {
      ...scripted({}),
      distill: async (input) => {
        asked++;
        return {
          worthSaving: 0.9,
          kind: "decision",
          kindConfidence: 0.9,
          importance: 5,
          durable: input.candidates.map(() => 0.7),
          titleIdx: null,
          source: "heuristic",
        };
      },
    };
    const report = await rejudge(db, { judge: heuristicOnly, now: NOW, concurrency: 1 });
    expect(asked).toBe(5);
    expect(report).toMatchObject({ judged: 0, failed: 5, remaining: 16 });
    expect(db.query("SELECT count(*) AS n FROM memories WHERE judge = 'claude-mem'").get()).toEqual(
      { n: 16 },
    );
  });

  test("the judge sees the memory as text, with the files it touched, and no candidates to rate", async () => {
    const inputs: unknown[] = [];
    const judge: Judge = {
      ...scripted({}),
      distill: async (input) => {
        inputs.push(input);
        return {
          worthSaving: 0.9,
          kind: "discovery",
          kindConfidence: 0.9,
          importance: 3,
          durable: [],
          titleIdx: null,
          source: "typesafe",
        };
      },
    };
    await rejudge(db, { judge, now: NOW, limit: 1 });
    expect(inputs[0]).toMatchObject({
      prompt: "",
      finalText: "The cart total is rounded once, at the end.\nPer-line rounding caused drift.",
      candidates: [],
      filesChanged: ["src/cart/total.ts"],
      commands: [],
      hadErrors: false,
    });
  });

  test("a judge that fails on one memory leaves it as it was and goes on", async () => {
    const partial = { ...TABLE };
    delete (partial as Record<string, unknown>)["Checked the logs."];
    const report = await rejudge(db, { judge: scripted(partial), now: NOW });
    expect(report.failed).toBe(1);
    expect(report.judged).toBe(3);
    expect(rows()[3]).toMatchObject({
      title: "Checked the logs.",
      judge: "claude-mem",
      status: "active",
    });
  });

  test("an imported memory already superseded is neither judged nor counted", async () => {
    db.run("UPDATE memories SET status = 'superseded', superseded_by = 3 WHERE id = 1");
    const seen: string[] = [];
    const report = await rejudge(db, { judge: scripted(TABLE, seen), now: NOW });
    expect(seen).not.toContain("The cart total is rounded once, at the end.");
    expect(report).toMatchObject({ judged: 3, remaining: 0 });
    expect(rows()[0]).toMatchObject({ status: "superseded", judge: "claude-mem" });
  });

  test("memories that were not imported are left alone", async () => {
    db.run("UPDATE memories SET judge = 'heuristic' WHERE id = 1");
    const seen: string[] = [];
    await rejudge(db, { judge: scripted(TABLE, seen), now: NOW });
    expect(seen).not.toContain("The cart total is rounded once, at the end.");
    expect(rows()[0]?.judge).toBe("heuristic");
  });

  test("archived memories are not retrieved, but still exist", async () => {
    await rejudge(db, { judge: scripted(TABLE), now: NOW });
    expect(db.query("SELECT count(*) AS n FROM memories").get()).toEqual({ n: 4 });
    expect(db.query("SELECT count(*) AS n FROM memories WHERE status = 'active'").get()).toEqual({
      n: 2,
    });
  });
});

/** The real TypeSafe judge, its service a stand-in that records each request and answers yes. */
function recordingTypeSafe(requests: SystemOneRequest[]): TypeSafeJudge {
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as SystemOneRequest);
    return new Response(
      JSON.stringify({
        model: "jev",
        answers: {
          worth: { type: "noul", noul: 0.9 },
          kind: { type: "choice", choice: "decision", probabilities: {}, confidence: 0.9 },
          importance: { type: "score", score: 3, legend: {}, probabilities: {}, confidence: 0.9 },
        },
        usage: { input_tokens: 10, output_tokens: 1 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return new TypeSafeJudge({ apiKey: "recorded", fetch: fetchFn });
}

describe("rejudge keeps the version 1 questions (ADR 0023, D-2)", () => {
  test("asks worth, kind and importance in their version 1 wording, and stamps judge_version '1'", async () => {
    const requests: SystemOneRequest[] = [];
    const report = await rejudge(db, { judge: recordingTypeSafe(requests), now: NOW });
    expect(report).toMatchObject({ judged: 4, failed: 0 });
    expect(requests).toHaveLength(4);
    for (const request of requests) {
      expect(Object.keys(request.questions).sort()).toEqual(["importance", "kind", "worth"]);
      expect(request.questions.worth?.instructions).toBe(
        "Would a developer starting a new coding session on this repository weeks from now work better by knowing something stated in `user_prompt` or `assistant_final_message`?",
      );
      expect(request.questions.kind?.instructions).toBe(
        "What kind of lasting knowledge does this turn mainly contain?",
      );
      expect(request.questions.importance?.instructions).toBe(
        "How costly would it be for a future session not to know this?",
      );
      expect(request.state).not.toHaveProperty("reader");
    }
    expect(
      db.query("SELECT DISTINCT judge_version FROM memories WHERE judge = 'typesafe'").all(),
    ).toEqual([{ judge_version: "1" }]);
  });
});
