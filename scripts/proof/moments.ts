// A replay of real history through the file-read and tool-failed lookups, for ADR 0015.
// Run by hand, against a temporary copy of a database, never the live one:
//
//   sqlite3 -readonly ~/.wizardingcode/mem/wizardingcode-mem.db ".backup '<dir>/wizardingcode-mem.db'"
//   bun scripts/proof/moments.ts <dir>/wizardingcode-mem.db ~/.claude/projects [--days 30] [--memories then|now] [--seed 1] [--json out.json] [--full]
//
// It walks the Claude Code transcripts of the last days (only read), and for every
// successful Read and every failed Bash command asks notesForFile / notesForFailure what
// the hook would have injected, in a fresh session per transcript, recording what was
// shown so that "once per context" holds as it does live. Prompts and session starts are
// replayed too, because what they inject is not repeated on a read or a failure.
//
// --memories then (the default) hides every memory created after the moment replayed:
// a memory distilled from a session must not answer that same session's earlier reads.
// --memories now uses today's memories throughout, which is what a session would meet now.
//
// The copy is written to (sessions, turns, injections, and memory status for "then").
// By default its output is anonymous: projects become "project A", "project B", files
// become their extension, and the examples show how many notes each would inject, never
// their titles. --full shows project names, file paths, first error lines (redacted) and
// note titles, for the author's own eyes on their own machine; never commit that output.

import { readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import { turnDetailFromLines } from "../../src/adapters/claude-code/transcript.ts";
import { isObject, type Json, readLines, text } from "../../src/adapters/common/jsonl.ts";
import { relativeTo, rootsOf } from "../../src/core/paths.ts";
import { findProject, type ProjectRef } from "../../src/core/project.ts";
import { sessionBrief } from "../../src/retrieve/brief.ts";
import { failureQuery, notesForFailure } from "../../src/retrieve/failure.ts";
import { notesForFile } from "../../src/retrieve/file.ts";
import { recordInjections } from "../../src/retrieve/notes.ts";
import { notYetShown, retrieveForPrompt } from "../../src/retrieve/prompt.ts";
import type { Note } from "../../src/retrieve/render.ts";
import { DB_FILE, type Db, openDb } from "../../src/store/db.ts";
import { advanceEpoch, touchSession } from "../../src/store/sessions.ts";
import { resolvePaths } from "../../src/util/paths.ts";

// ---- arguments ---------------------------------------------------------------------

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};
const [copyPath, transcriptsRoot] = args.filter(
  (arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
if (copyPath === undefined || transcriptsRoot === undefined) {
  console.error(
    "usage: bun scripts/proof/moments.ts <copy.db> <transcripts root> [--days 30] [--memories then|now] [--seed 1] [--json out.json] [--full]",
  );
  process.exit(1);
}
const DAYS = Number(option("days", "30"));
const MEMORIES = option("memories", "then");
const SEED = Number(option("seed", "1"));
const JSON_OUT = option("json", "");
const FULL = args.includes("--full");
if (MEMORIES !== "then" && MEMORIES !== "now") throw new Error("--memories is then or now");

const copy = resolve(copyPath);
if (basename(copy) !== DB_FILE) throw new Error(`the copy must be named ${DB_FILE}`);
// Never the live database: this script writes.
if (resolve(dirname(copy)) === resolve(resolvePaths().storeDir)) {
  throw new Error("refusing to replay into the live database; take a copy first");
}

// ---- transcripts -------------------------------------------------------------------

type Event =
  | { kind: "prompt"; at: number; t: number; cwd: string; branch: string | null; prompt: string }
  | {
      kind: "turn-done";
      at: number;
      t: number;
      cwd: string;
      filesRead: string[];
      filesChanged: string[];
    }
  | { kind: "compact"; at: number; t: number }
  | { kind: "read"; at: number; t: number; cwd: string; branch: string | null; file: string }
  | { kind: "failure"; at: number; t: number; cwd: string; branch: string | null; error: string };

const MAX_TEXT = 32 * 1024;
const cutoff = Date.now() - DAYS * 86_400_000;
// What a failed tool result says when the command never ran: the user stopped or refused
// it, a permission check or auto mode's classifier denied it, or a sibling call failed.
// The hook is told is_interrupt, or is not called at all.
const NOT_A_FAILURE: [string, RegExp][] = [
  [
    "interrupted or refused by the user",
    /^(The user doesn't want to proceed|\[Request interrupted)/,
  ],
  ["denied by a permission rule", /^Permission to use/],
  [
    "denied or unjudged by auto mode",
    /^(Permission for this action was denied|The server-side auto mode classifier)/,
  ],
  ["cancelled before running", /^<tool_use_error>/],
];
const notRun = new Map<string, number>();

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isObject(part) ? (text(part.text) ?? "") : ""))
    .filter((part) => part !== "")
    .join("\n");
}

const counts = {
  transcripts: 0,
  transcriptsWithEvents: 0,
  transcriptsUnknownProject: 0,
  compactions: 0,
  prompts: 0,
  reads: 0,
  readsUnknownProject: 0,
  readsOutsideProject: 0,
  failures: 0,
  failuresNotRun: 0,
  failuresUnknownProject: 0,
  failuresEmptyQuery: 0,
};

const transcripts: string[] = [];
for (const dir of readdirSync(transcriptsRoot)) {
  const full = join(transcriptsRoot, dir);
  if (!statSync(full).isDirectory()) continue;
  for (const file of readdirSync(full)) {
    // Top-level session files only: a subagent's transcript lives in a folder below.
    if (!file.endsWith(".jsonl")) continue;
    const path = join(full, file);
    if (statSync(path).mtimeMs >= cutoff) transcripts.push(path);
  }
}
transcripts.sort();

const events: Event[] = [];
let order = 0;
for (const [t, path] of transcripts.entries()) {
  counts.transcripts++;
  const uses = new Map<string, { name: string; file: string | null }>();
  let turnLines: Json[] = [];
  let turnCwd: string | null = null;
  let lastAt = 0;
  let mark = events.length;
  const flushTurn = () => {
    if (turnLines.length > 0 && turnCwd !== null && lastAt >= cutoff) {
      const detail = turnDetailFromLines(turnLines, null);
      if (detail.filesRead.length + detail.filesChanged.length > 0) {
        events.push({
          kind: "turn-done",
          at: lastAt,
          t,
          cwd: turnCwd,
          filesRead: detail.filesRead,
          filesChanged: detail.filesChanged,
        });
      }
    }
    turnLines = [];
  };
  for (const raw of readLines(path, 1024 * 1024)) {
    let line: Json;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isObject(parsed)) continue;
      line = parsed;
    } catch {
      continue;
    }
    if (line.isSidechain === true) continue;
    const at = Date.parse(text(line.timestamp) ?? "");
    if (Number.isNaN(at)) continue;
    lastAt = at;
    const cwd = text(line.cwd);
    const branch = text(line.gitBranch);
    if (line.type === "system" && line.subtype === "compact_boundary") {
      if (at >= cutoff) events.push({ kind: "compact", at, t });
      continue;
    }
    const content = isObject(line.message) ? line.message.content : undefined;
    const isPrompt =
      line.type === "user" && text(line.promptId) !== null && typeof content === "string";
    if (isPrompt) {
      flushTurn();
      turnCwd = cwd;
      if (at >= cutoff && cwd !== null) {
        events.push({ kind: "prompt", at, t, cwd, branch, prompt: content.slice(0, MAX_TEXT) });
      }
    }
    turnLines.push(line);
    if (!Array.isArray(content) || cwd === null) continue;
    for (const block of content) {
      if (!isObject(block)) continue;
      if (block.type === "tool_use" && isObject(block.input)) {
        const id = text(block.id);
        if (id !== null)
          uses.set(id, { name: text(block.name) ?? "", file: text(block.input.file_path) });
      } else if (block.type === "tool_result") {
        const use = uses.get(text(block.tool_use_id) ?? "");
        if (use === undefined || at < cutoff) continue;
        if (use.name === "Read" && block.is_error !== true && use.file !== null) {
          events.push({ kind: "read", at, t, cwd, branch, file: use.file });
        } else if (use.name === "Bash" && block.is_error === true) {
          const error = resultText(block.content);
          const reason = NOT_A_FAILURE.find(([, pattern]) => pattern.test(error.trimStart()));
          if (reason !== undefined) {
            counts.failuresNotRun++;
            notRun.set(reason[0], (notRun.get(reason[0]) ?? 0) + 1);
          } else
            events.push({ kind: "failure", at, t, cwd, branch, error: error.slice(0, MAX_TEXT) });
        }
      }
    }
  }
  flushTurn();
  if (events.length > mark) counts.transcriptsWithEvents++;
  mark = events.length;
}
// Sessions overlap in time; memories appear in time. One clock for all of them.
const sequenced = events.map((event) => ({ event, order: order++ }));
sequenced.sort((a, b) => a.event.at - b.event.at || a.order - b.order);

// ---- the copy ----------------------------------------------------------------------

const db: Db = openDb({ dataDir: dirname(copy), busyTimeoutMs: 5000 });

// "then": every active memory is hidden, and shown again once the clock passes its birth.
const hidden =
  MEMORIES === "then"
    ? db
        .query<{ id: number; createdAt: number }, []>(
          "SELECT id, created_at AS createdAt FROM memories WHERE status = 'active' ORDER BY created_at, id",
        )
        .all()
    : [];
let revealed = 0;
if (MEMORIES === "then") db.run("UPDATE memories SET status = 'archived' WHERE status = 'active'");
const reveal = (now: number) => {
  const ids: number[] = [];
  while (revealed < hidden.length && (hidden[revealed]?.createdAt ?? 0) <= now) {
    ids.push((hidden[revealed] as { id: number }).id);
    revealed++;
  }
  for (let i = 0; i < ids.length; i += 500) {
    db.run(
      `UPDATE memories SET status = 'active' WHERE id IN (${ids.slice(i, i + 500).join(",")})`,
    );
  }
};

const projects = new Map<string, ProjectRef | null>();
const projectOf = (cwd: string) => {
  if (!projects.has(cwd)) {
    const found = findProject(db, cwd);
    projects.set(cwd, found === null || found.disabled ? null : found);
  }
  return projects.get(cwd) ?? null;
};

interface Live {
  sessionId: number;
  epoch: number;
  projectId: number;
  seq: number;
}
const sessions = new Map<number, Live>();
const knownTranscripts = new Set<number>();
const unknownTranscripts = new Set<number>();

function open(t: number, project: ProjectRef, cwd: string, branch: string | null, now: number) {
  let live = sessions.get(t);
  if (live !== undefined) return live;
  const session = touchSession(db, {
    agent: "claude-code",
    agentSessionId: `replay:${basename(transcripts[t] as string)}`,
    projectId: project.id,
    cwd,
    branch,
    now,
  });
  live = { sessionId: session.id, epoch: session.contextEpoch, projectId: project.id, seq: 0 };
  sessions.set(t, live);
  brief(live, branch, now);
  return live;
}

function brief(live: Live, branch: string | null, now: number) {
  const notes = sessionBrief(db, { projectId: live.projectId, branch, now }).notes;
  recordInjections(db, {
    sessionId: live.sessionId,
    epoch: live.epoch,
    event: "session-start",
    notes,
    now,
  });
}

// ---- the replay --------------------------------------------------------------------

interface Hit {
  kind: "read" | "failure";
  label: string;
  project: string;
  titles: string[];
  noteIds: number[];
  overlapOnly: number;
}
const hits: Hit[] = [];
const readsLooked = { n: 0 };
const readsWithLinked = { n: 0 };
const readsWithMoreThanOne = { n: 0 };
const failuresLooked = { n: 0 };
const filesRead = new Map<string, number>();
const overlap = { events: 0, notes: 0, eventsOnlyThroughOverlap: 0 };
let promptInjections = 0;

/** The first line of an error worth showing: past the exit code, redacted, short. */
function firstLine(error: string): string {
  const lines = error.split("\n").filter((line) => line.trim() !== "");
  const first = lines.find((line) => !/^Exit code \d+$/.test(line.trim())) ?? "";
  return failureQuery(first).slice(0, 160);
}

const started = Date.now();
db.run("BEGIN IMMEDIATE");
let pending = 0;
for (const { event } of sequenced) {
  if (++pending % 500 === 0) {
    db.run("COMMIT");
    db.run("BEGIN IMMEDIATE");
  }
  if (MEMORIES === "then") reveal(event.at);
  const now = MEMORIES === "then" ? event.at : Date.now();
  if (event.kind === "compact") {
    const live = sessions.get(event.t);
    if (live === undefined) continue;
    counts.compactions++;
    live.epoch = advanceEpoch(db, live.sessionId);
    brief(live, null, now);
    continue;
  }
  const project = projectOf(event.cwd);
  if (event.kind === "read") counts.reads++;
  if (event.kind === "failure") counts.failures++;
  if (project === null) {
    if (event.kind === "read") counts.readsUnknownProject++;
    if (event.kind === "failure") counts.failuresUnknownProject++;
    if (!knownTranscripts.has(event.t)) unknownTranscripts.add(event.t);
    continue;
  }
  knownTranscripts.add(event.t);
  unknownTranscripts.delete(event.t);
  const branch = event.kind === "turn-done" ? null : event.branch;
  const live = open(event.t, project, event.cwd, branch, now);

  switch (event.kind) {
    case "prompt": {
      counts.prompts++;
      const notes = retrieveForPrompt(db, {
        projectId: project.id,
        sessionId: live.sessionId,
        epoch: live.epoch,
        prompt: event.prompt,
        branch,
        now,
      });
      promptInjections += notes.length;
      recordInjections(db, {
        sessionId: live.sessionId,
        epoch: live.epoch,
        event: "prompt",
        notes,
        now,
      });
      break;
    }
    case "turn-done": {
      // What the distiller stores for a finished turn, which is where session files come from.
      const roots = rootsOf(event.cwd);
      live.seq++;
      db.run(
        `INSERT INTO turns (session_id, project_id, seq, state, prompt, files_read, files_changed, started_at, ended_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM turns WHERE session_id = ?), 'done', '', ?, ?, ?, ?)`,
        [
          live.sessionId,
          project.id,
          live.sessionId,
          JSON.stringify(relativeTo(roots, event.filesRead)),
          JSON.stringify(relativeTo(roots, event.filesChanged)),
          event.at,
          event.at,
        ],
      );
      break;
    }
    case "read": {
      // As the hook: resolved first, then made project-relative.
      const normalised = posix.normalize(event.file.replaceAll("\\", "/"));
      const [path] = relativeTo(rootsOf(event.cwd), [normalised]);
      if (path === undefined) {
        counts.readsOutsideProject++;
        break;
      }
      readsLooked.n++;
      const key = `${project.name}\t${path}`;
      filesRead.set(key, (filesRead.get(key) ?? 0) + 1);
      // How many notes the lookup could choose from, to tell the budget from the evidence.
      const linked =
        db
          .query<{ n: number }, [number, string]>(
            `SELECT count(DISTINCT m.id) AS n FROM memories m JOIN memory_files f ON f.memory_id = m.id
              WHERE m.project_id = ? AND f.path = ? AND m.status = 'active'
                AND m.kind IN ('gotcha', 'fix', 'convention', 'decision')
                AND ${notYetShown(db, live.sessionId, live.epoch)}`,
          )
          .get(project.id, path)?.n ?? 0;
      if (linked > 0) readsWithLinked.n++;
      if (linked > 1) readsWithMoreThanOne.n++;
      const notes = notesForFile(db, {
        projectId: project.id,
        sessionId: live.sessionId,
        epoch: live.epoch,
        path,
        branch,
        now,
      });
      recordInjections(db, {
        sessionId: live.sessionId,
        epoch: live.epoch,
        event: "file-read",
        notes,
        now,
      });
      if (notes.length > 0) hits.push(hit("read", path, project, notes, 0));
      break;
    }
    case "failure": {
      if (failureQuery(event.error) === "") {
        counts.failuresEmptyQuery++;
        break;
      }
      failuresLooked.n++;
      const input = {
        projectId: project.id,
        sessionId: live.sessionId,
        epoch: live.epoch,
        error: event.error,
        branch,
        now,
      };
      const notes = notesForFailure(db, input);
      // The same lookup with the session's files forgotten: what only the overlap brought.
      db.run("SAVEPOINT without_files");
      db.run("DELETE FROM turns WHERE session_id = ?", [live.sessionId]);
      const without = new Set(notesForFailure(db, input).map((note) => note.id));
      db.run("ROLLBACK TO without_files");
      db.run("RELEASE without_files");
      const onlyThroughOverlap = notes.filter((note) => !without.has(note.id)).length;
      recordInjections(db, {
        sessionId: live.sessionId,
        epoch: live.epoch,
        event: "tool-failed",
        notes,
        now,
      });
      if (notes.length > 0) {
        if (onlyThroughOverlap > 0) {
          overlap.events++;
          overlap.notes += onlyThroughOverlap;
          if (onlyThroughOverlap === notes.length) overlap.eventsOnlyThroughOverlap++;
        }
        hits.push(hit("failure", firstLine(event.error), project, notes, onlyThroughOverlap));
      }
      break;
    }
  }
}
db.run("COMMIT");
counts.transcriptsUnknownProject = unknownTranscripts.size;
const seconds = (Date.now() - started) / 1000;
db.close();

function hit(
  kind: Hit["kind"],
  label: string,
  project: ProjectRef,
  notes: Note[],
  overlapOnly: number,
): Hit {
  return {
    kind,
    label,
    project: project.name,
    titles: notes.map((note) => note.title),
    noteIds: notes.map((note) => note.id),
    overlapOnly,
  };
}

// ---- the report --------------------------------------------------------------------

function summary(kind: Hit["kind"], looked: number) {
  const own = hits.filter((h) => h.kind === kind);
  const sizes = own.map((h) => h.titles.length);
  return {
    looked,
    injecting: own.length,
    share: looked === 0 ? 0 : own.length / looked,
    notes: sizes.reduce((a, b) => a + b, 0),
    mean: sizes.length === 0 ? 0 : sizes.reduce((a, b) => a + b, 0) / sizes.length,
    max: Math.max(0, ...sizes),
    distinctNotes: new Set(own.flatMap((h) => h.noteIds)).size,
  };
}

/** Deterministic pseudo-random numbers, so the same examples come back on a rerun. */
function generator(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % max;
  };
}
function sample<T>(items: T[], n: number, next: (max: number) => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) out.push(pool.splice(next(pool.length), 1)[0] as T);
  return out;
}

const reads = summary("read", readsLooked.n);
const failures = summary("failure", failuresLooked.n);
const byFile = new Map<string, number>();
for (const h of hits.filter((h) => h.kind === "read")) {
  const key = `${h.project}\t${h.label}`;
  byFile.set(key, (byFile.get(key) ?? 0) + 1);
}
// Anonymous by default: a project is a letter, a file its extension.
const letters = new Map<string, string>();
const projectLabel = (name: string) => {
  if (FULL) return name;
  if (!letters.has(name)) {
    const n = letters.size;
    letters.set(
      name,
      `project ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? Math.floor(n / 26) : ""}`,
    );
  }
  return letters.get(name) as string;
};
const fileLabel = (path: string) => {
  if (FULL) return path;
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1];
  return extension === undefined ? "a file" : `a .${extension} file`;
};
const topFiles = [...byFile.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 10)
  .map(([key, injections]) => {
    const [project, path] = key.split("\t") as [string, string];
    return {
      project: projectLabel(project),
      path: fileLabel(path),
      injections,
      reads: filesRead.get(key) ?? 0,
    };
  });
const next = generator(SEED);
const readHits = hits.filter((h) => h.kind === "read");
const failureHits = hits.filter((h) => h.kind === "failure");
const half = Math.min(10, failureHits.length);
const examples = [
  ...sample(readHits, 20 - half, next),
  ...sample(failureHits, Math.max(half, 20 - readHits.length), next),
].slice(0, 20);

const result = {
  options: { days: DAYS, memories: MEMORIES, seed: SEED },
  seconds,
  counts,
  promptInjections,
  reads: {
    ...reads,
    distinctFiles: filesRead.size,
    distinctFilesInjecting: byFile.size,
    withLinkedNotes: readsWithLinked.n,
    withMoreThanOneLinked: readsWithMoreThanOne.n,
  },
  notRun: Object.fromEntries(notRun),
  failures: { ...failures, overlap },
  topFiles,
  examples: examples.map(({ kind, label, titles, overlapOnly }) => ({
    kind,
    label: FULL ? label : kind === "read" ? fileLabel(label) : "a failed command",
    notes: titles.length,
    ...(FULL ? { titles } : {}),
    overlapOnly,
  })),
};
if (JSON_OUT !== "") writeFileSync(JSON_OUT, `${JSON.stringify(result, null, 2)}\n`);

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const lines = [
  `# Replay: last ${DAYS} days, memories as of ${MEMORIES} (${seconds.toFixed(0)} s)`,
  "",
  `Transcripts ${counts.transcripts} (with events ${counts.transcriptsWithEvents}, only in unknown projects ${counts.transcriptsUnknownProject}); compactions ${counts.compactions}; prompts replayed ${counts.prompts} (${promptInjections} notes).`,
  "",
  "| | seen | in a known project | looked up | injecting | notes / injecting (mean, max) | distinct notes |",
  "|---|---:|---:|---:|---:|---:|---:|",
  `| Read | ${counts.reads} | ${counts.reads - counts.readsUnknownProject} | ${reads.looked} | ${reads.injecting} (${pct(reads.share)}) | ${reads.mean.toFixed(2)}, ${reads.max} | ${reads.distinctNotes} |`,
  `| Bash failure | ${counts.failures} | ${counts.failures - counts.failuresUnknownProject} | ${failures.looked} | ${failures.injecting} (${pct(failures.share)}) | ${failures.mean.toFixed(2)}, ${failures.max} | ${failures.distinctNotes} |`,
  "",
  `Reads outside the project root: ${counts.readsOutsideProject}. Distinct files read: ${filesRead.size}; that ever injected: ${byFile.size}.`,
  `Reads with at least one eligible linked note: ${readsWithLinked.n}; with more than one: ${readsWithMoreThanOne.n}.`,
  `Failed results that never ran (left out, not counted as seen): ${counts.failuresNotRun} (${[...notRun].map(([reason, n]) => `${reason} ${n}`).join(", ")}); failures with nothing to search: ${counts.failuresEmptyQuery}.`,
  `Failures where the session-files overlap brought a note the text alone would not: ${overlap.events} events, ${overlap.notes} notes; events injecting only through it: ${overlap.eventsOnlyThroughOverlap}.`,
  "",
  "## Top files by injections",
  "",
  "| project | file | injections | reads |",
  "|---|---|---:|---:|",
  ...topFiles.map(
    (f) => `| ${f.project} | ${FULL ? `\`${f.path}\`` : f.path} | ${f.injections} | ${f.reads} |`,
  ),
  "",
  `## Twenty examples (seed ${SEED})`,
  "",
  ...(FULL ? [] : ["Anonymous: run with --full to see paths, error lines and note titles.", ""]),
  ...result.examples.flatMap((e, i) => [
    `${i + 1}. ${e.kind === "read" ? "Read" : "Failure"}: ${FULL ? `\`${e.label}\`` : e.label}, ${e.notes} note(s)${e.overlapOnly > 0 ? ` (${e.overlapOnly} only through session files)` : ""}`,
    ...(e.titles ?? []).map((title) => `   - ${title}`),
  ]),
];
console.log(lines.join("\n"));
