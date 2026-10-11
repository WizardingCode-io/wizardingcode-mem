import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { notesForFile } from "../../src/retrieve/file.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { touchSession } from "../../src/store/sessions.ts";

let base: string;
let db: Db;
const NOW = Date.UTC(2026, 9, 5);

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "wizardingcode-mem-retrieve-file-"));
  db = openDb({ dataDir: base, busyTimeoutMs: 2000 });
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

test("a short third note is still given when the second is too long for the budget", () => {
  const projectId = resolveProject(db, base, NOW).id;
  const add = (title: string, body: string, importance: number) =>
    insertMemory(db, {
      projectId,
      kind: "gotcha",
      title,
      body: body as Redacted,
      terms: "",
      importance,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [{ path: "a.ts", role: "changed" }],
      now: NOW,
    });
  const first = add("First", "a".repeat(700), 5);
  add("Second", "b".repeat(700), 4);
  const third = add("Third", "short", 3);
  const session = touchSession(db, {
    agent: "claude-code",
    agentSessionId: "s",
    projectId,
    cwd: base,
    branch: null,
    now: NOW,
  });
  const notes = notesForFile(db, {
    projectId,
    sessionId: session.id,
    epoch: session.contextEpoch,
    path: "a.ts",
    branch: null,
    now: NOW,
  });
  expect(notes.map((note) => note.id)).toEqual([first, third]);
});
