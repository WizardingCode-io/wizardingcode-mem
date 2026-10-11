import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCode } from "../../src/adapters/claude-code/adapter.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { MemoryKind } from "../../src/core/types.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { notesForFile } from "../../src/retrieve/file.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { searchTerms } from "../../src/util/words.ts";
import moments from "./moments.json" with { type: "json" };
import golden from "./retrieval.json" with { type: "json" };

// The moments (a file read, later a failed tool) are looked up against the same hand-written
// memories as retrieval.json. Every case must give exactly the expected notes.

const NOW = Date.UTC(2026, 9, 5);
let base: string;
let project: string;
let db: Db;
let projectId: number;
const ids = new Map<string, number>();

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-moments-")));
  project = join(base, "project");
  mkdirSync(project);
  db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
  projectId = resolveProject(db, project, NOW).id;
  for (const memory of golden.memories) {
    ids.set(
      memory.key,
      insertMemory(db, {
        projectId,
        kind: memory.kind as MemoryKind,
        title: memory.title,
        body: memory.body as Redacted,
        terms: searchTerms(memory.title, memory.body, memory.files),
        importance: 3,
        branch: null,
        commit: null,
        origin: "manual",
        judge: "heuristic",
        judgeVersion: "1",
        sourceTurnId: null,
        files: memory.files.map((path) => ({ path, role: "changed" as const })),
        now: NOW,
      }),
    );
  }
});
afterAll(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

let sessions = 0;
const keyOf = (id: number) => [...ids].find(([, value]) => value === id)?.[0];

/** Reads one file through the hook, in a session of its own, and returns the ids shown. */
function readThroughHook(file: string, session: string, extra: { cwd?: string } = {}): number[] {
  const out = handleHook({ db, now: () => NOW, spawnDistill: () => {} }, claudeCode, {
    agent: "claude-code",
    event: "file-read",
    sessionId: session,
    cwd: extra.cwd ?? project,
    turnId: null,
    transcriptPath: null,
    prompt: null,
    finalText: null,
    source: null,
    toolFile: file,
    toolError: null,
    subagent: false,
  });
  if (out === "") return [];
  const text: string = JSON.parse(out).hookSpecificOutput.additionalContext;
  return [...text.matchAll(/^- #(\d+) \[/gm)].map((m) => Number(m[1]));
}

describe("golden set: a file is read", () => {
  moments.fileRead.forEach((item, index) => {
    test(`reading ${item.read}`, () => {
      const got = readThroughHook(join(project, item.read), `golden-${index}`).map(keyOf);
      expect(got.sort()).toEqual([...item.expect].sort());
    });
  });

  test("the notes come once per context, and again after a clear", () => {
    const file = join(project, "src/store/db.ts");
    const session = `once-${++sessions}`;
    expect(readThroughHook(file, session)).toHaveLength(2);
    expect(readThroughHook(file, session)).toEqual([]);
    const cleared = handleHook({ db, now: () => NOW, spawnDistill: () => {} }, claudeCode, {
      agent: "claude-code",
      event: "session-start",
      sessionId: session,
      cwd: project,
      turnId: null,
      transcriptPath: null,
      prompt: null,
      finalText: null,
      source: "clear",
      toolFile: null,
      toolError: null,
      subagent: false,
    });
    expect(cleared).toBeString();
    // The brief only names notes, so the full notes are still owed.
    expect(readThroughHook(file, session)).toHaveLength(2);
  });

  test("a path outside the project, a relative path or a path through .. gives nothing and never throws", () => {
    expect(readThroughHook(join(base, "elsewhere/src/store/db.ts"), "o1")).toEqual([]);
    expect(readThroughHook("src/store/db.ts", "o2")).toEqual([]);
    expect(readThroughHook(join(project, "../escape/src/store/db.ts"), "o3")).toEqual([]);
    // Resolved: it points inside the project.
    expect(readThroughHook(join(project, "src/hooks/../store/db.ts"), "o4")).toHaveLength(2);
  });

  test("a Windows path is read relative to a Windows project", () => {
    const got = readThroughHook("C:\\work\\shop\\src\\store\\db.ts", "w1", {
      cwd: "C:\\work\\shop",
    });
    // The project there is another one: no memories, but no failure either.
    expect(got).toEqual([]);
  });

  test("two file reads on one database both succeed", () => {
    const a = readThroughHook(join(project, "src/store/db.ts"), "two-a");
    const b = readThroughHook(join(project, "src/store/meta.ts"), "two-b");
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(1);
  });

  test("notesForFile asks only for the project's own path", () => {
    expect(
      notesForFile(db, {
        projectId,
        sessionId: 999_999,
        epoch: 0,
        path: "src/store/db.ts",
        branch: null,
        now: NOW,
      }),
    ).toHaveLength(2);
  });
});
