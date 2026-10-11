import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCode } from "../../src/adapters/claude-code/adapter.ts";
import type { HookInput } from "../../src/adapters/types.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { failureQuery } from "../../src/retrieve/failure.ts";
import { notesForFile } from "../../src/retrieve/file.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { searchTerms } from "../../src/util/words.ts";

const NOW = Date.UTC(2026, 9, 5);

describe("failureQuery", () => {
  test("drops the exit-code line and the host's truncation marker", () => {
    const text = failureQuery(
      "Exit code 1\nfirst part ... [1234 characters truncated] ... last part",
    );
    expect(text).toBe("first part last part");
  });
  test("drops a timeout line", () => {
    expect(failureQuery("Command timed out after 2m 0s")).toBe("");
    expect(failureQuery("Exit code 1")).toBe("");
  });
  test("redacts a secret before anything else", () => {
    const key = ["sk-ant-", "api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"].join("");
    const text = failureQuery(`Exit code 1\nauth failed with ${key}`);
    expect(text).toContain("[REDACTED:");
    expect(text).not.toContain("AbCdEfGhIjKl");
  });
  test("collapses whitespace and clips to 2000 characters", () => {
    expect(failureQuery("a \n\n  b\t c")).toBe("a b c");
    expect(failureQuery("word ".repeat(1000)).length).toBeLessThanOrEqual(2000);
  });
});

describe("tool-failed through the hook", () => {
  let base: string;
  let project: string;
  let db: Db;
  let projectId: number;
  const add = (
    title: string,
    body: string,
    kind: "fix" | "gotcha" | "decision",
    files: string[] = [],
  ) =>
    insertMemory(db, {
      projectId,
      kind,
      title,
      body: body as Redacted,
      terms: searchTerms(title, body, files),
      importance: 3,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: files.map((path) => ({ path, role: "changed" as const })),
      now: NOW,
    });

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-failure-")));
    project = join(base, "project");
    mkdirSync(project);
    db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
    projectId = resolveProject(db, project, NOW).id;
    add(
      "SQLITE_BUSY on first query",
      "Set a busy timeout so SQLITE_BUSY database locked is retried.",
      "fix",
    );
    add(
      "Decision about locking",
      "We decided on SQLITE_BUSY handling with a busy timeout, database locked.",
      "decision",
    );
    add("Long note one", `Database locked sqlite_busy details. ${"x ".repeat(700)}`, "fix");
    add("Short second", "Database locked sqlite_busy short.", "fix");
  });
  afterAll(() => {
    db.close();
    rmSync(base, { recursive: true, force: true });
  });

  const fire = (event: HookInput["event"], session: string, extra: Partial<HookInput>) =>
    handleHook({ db, now: () => NOW, spawnDistill: () => {} }, claudeCode, {
      agent: "claude-code",
      event,
      sessionId: session,
      cwd: project,
      turnId: null,
      transcriptPath: null,
      prompt: null,
      finalText: null,
      source: null,
      toolFile: null,
      toolError: null,
      subagent: false,
      ...extra,
    });
  const idsIn = (out: string) =>
    out === ""
      ? []
      : [
          ...(JSON.parse(out).hookSpecificOutput.additionalContext as string).matchAll(
            /^- #(\d+) \[/gm,
          ),
        ].map((m) => Number(m[1]));

  test("only fixes and gotchas, with the failure intro", () => {
    const out = fire("tool-failed", "f1", {
      toolError: "Exit code 1\nSQLITE_BUSY: database locked",
    });
    const text: string = JSON.parse(out).hookSpecificOutput.additionalContext;
    expect(text).toContain("may bear on this failure");
    expect(text).not.toContain("Decision about locking");
    expect(idsIn(out).length).toBeGreaterThan(0);
    expect(idsIn(out).length).toBeLessThanOrEqual(2);
  });
  test("an interrupted tool (no error) or an empty query gives nothing", () => {
    expect(fire("tool-failed", "f2", { toolError: null })).toBe("");
    expect(fire("tool-failed", "f3", { toolError: "Exit code 1" })).toBe("");
  });
  test("a note shown on a failure is not repeated by the next failure or prompt", () => {
    const error = "Exit code 1\nSQLITE_BUSY: database locked on the very first query";
    const first = idsIn(fire("tool-failed", "f4", { toolError: error }));
    expect(first.length).toBeGreaterThan(0);
    const second = idsIn(fire("tool-failed", "f4", { toolError: error }));
    for (const id of first) expect(second).not.toContain(id);
    const prompt = idsIn(
      fire("prompt", "f4", { prompt: "SQLITE_BUSY database locked busy timeout" }),
    );
    for (const id of first) expect(prompt).not.toContain(id);
  });
});

describe("notesForFile budget", () => {
  test("a long first note does not hide a short second one", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-budget-")));
    const db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
    try {
      const projectId = resolveProject(db, base, NOW).id;
      const add = (title: string, body: string) =>
        insertMemory(db, {
          projectId,
          kind: "fix",
          title,
          body: body as Redacted,
          terms: searchTerms(title, body, ["a.ts"]),
          importance: 5,
          branch: null,
          commit: null,
          origin: "manual",
          judge: "heuristic",
          judgeVersion: "1",
          sourceTurnId: null,
          files: [{ path: "a.ts", role: "changed" as const }],
          now: NOW,
        });
      const long = add("long", "y ".repeat(700));
      const short = add("short", "brief");
      const second = add("another short", "brief too");
      const notes = notesForFile(db, {
        projectId,
        sessionId: 1,
        epoch: 0,
        path: "a.ts",
        branch: null,
        now: NOW,
      });
      expect(notes.map((n) => n.id)).toContain(short);
      expect(long).toBeGreaterThan(0);
      expect(second).toBeGreaterThan(0);
    } finally {
      db.close();
      rmSync(base, { recursive: true, force: true });
    }
  });
});
