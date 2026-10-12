import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { MEMORY_KINDS, type MemoryKind } from "../../src/core/types.ts";
import { type Db, openDb, withWrite } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { touchSession } from "../../src/store/sessions.ts";
import { searchTerms } from "../../src/util/words.ts";

// A store with one current project ("app") among others, filled deterministically, for the
// tests of what retrieval reads from linked projects and from the author's own rules.

export const DAY = 86_400_000;
export const NOW = Date.UTC(2026, 9, 12, 12);

const WORDS =
  "cache queue lease retry timeout migration index schema token session worker pool socket buffer parser render router handler adapter payload transcript hook judge branch commit deploy build bundle signal process thread lock journal checkpoint vacuum trigger column cursor batch stream chunk header config fallback breaker backoff deadline budget latency".split(
    " ",
  );

function generator(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % max;
  };
}

export interface MemoryInput {
  title: string;
  body?: string;
  kind?: MemoryKind;
  importance?: number;
  ageDays?: number;
  files?: string[];
}

export interface Fixture {
  base: string;
  db: Db;
  /** The current project. */
  app: number;
  /** A library app uses. */
  lib: number;
  /** Another part of app's product. */
  site: number;
  /** A project that uses app. */
  consumer: number;
  /** A project with no link to app. */
  other: number;
  sessionId: number;
  memory(projectId: number, input: MemoryInput): number;
  link(from: number, to: number, kind: "product" | "uses", status?: string): void;
  userRule(memoryId: number): void;
  close(): void;
}

/** The same store on every run: app's memories, a last turn, and memories in four other projects. */
export function linksFixture(): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-links-")));
  process.env.WIZARDINGCODE_HOME = base; // the error log must not reach a real data dir
  const db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
  const project = (name: string) => {
    const dir = join(base, name);
    mkdirSync(dir);
    return resolveProject(db, dir, NOW).id;
  };
  const app = project("app");
  const lib = project("lib");
  const site = project("site");
  const consumer = project("consumer");
  const other = project("other");
  const sessionId = touchSession(db, {
    agent: "claude-code",
    agentSessionId: "links-1",
    projectId: app,
    cwd: join(base, "app"),
    branch: null,
    now: NOW,
  }).id;

  const memory = (projectId: number, input: MemoryInput) => {
    const files = (input.files ?? []).map((path) => ({ path, role: "changed" as const }));
    return insertMemory(db, {
      projectId,
      kind: input.kind ?? "decision",
      title: input.title,
      body: (input.body ?? "") as Redacted,
      terms: searchTerms(input.title, input.body ?? "", input.files ?? []),
      importance: input.importance ?? 3,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files,
      now: NOW - (input.ageDays ?? 0) * DAY,
    });
  };

  const next = generator(2026);
  const word = () => WORDS[next(WORDS.length)] as string;
  withWrite(db, () => {
    for (let i = 0; i < 70; i++) {
      memory(app, {
        kind: MEMORY_KINDS[i % MEMORY_KINDS.length] as MemoryKind,
        title: `The ${word()} ${word()} must ${word()} before the ${word()} ${word()}.`,
        body: `Because the ${word()} ${word()} would otherwise ${word()} the ${word()}.`,
        importance: 1 + (i % 5),
        ageDays: next(120),
        files: i % 3 === 0 ? [`src/${word()}/${word()}.ts`] : [],
      });
    }
    for (const projectId of [lib, site, consumer, other]) {
      for (let i = 0; i < 12; i++) {
        memory(projectId, {
          kind: MEMORY_KINDS[i % MEMORY_KINDS.length] as MemoryKind,
          title: `In this one the ${word()} ${word()} wraps the ${word()} ${word()}.`,
          body: `So the ${word()} never ${word()} the ${word()}.`,
          importance: 1 + (i % 5),
          ageDays: next(60),
        });
      }
    }
    db.run(
      `INSERT INTO turns (session_id, project_id, seq, state, prompt, final_text, started_at, ended_at)
       VALUES (?, ?, 1, 'done', 'Make the queue retry with backoff', 'The queue now retries with exponential backoff and jitter.', ?, ?)`,
      [sessionId, app, NOW - DAY, NOW - DAY + 60_000],
    );
  });

  return {
    base,
    db,
    app,
    lib,
    site,
    consumer,
    other,
    sessionId,
    memory,
    link(from, to, kind, status = "confirmed") {
      db.run(
        `INSERT INTO project_links (from_project, to_project, kind, status, origin, signals, created_at)
         VALUES (?, ?, ?, ?, 'manual', '[]', ?)`,
        [from, to, kind, status, NOW],
      );
    },
    userRule(memoryId) {
      db.run("INSERT INTO user_memories (memory_id, proposal_id, created_at) VALUES (?, NULL, ?)", [
        memoryId,
        NOW,
      ]);
    },
    close() {
      db.close();
      rmSync(base, { recursive: true, force: true });
    },
  };
}

/** Prompts that find several of app's memories in the fixture. */
export const PROMPTS = [
  "why does the queue retry fail when the lease timeout hits the worker pool?",
  "the parser buffer and the router handler break the payload stream",
  "how should the cache index migration handle the schema checkpoint?",
  "the deploy bundle signal and the journal vacuum trigger",
];
