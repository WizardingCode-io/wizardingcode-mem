import type { AgentAdapter, TurnDetail } from "../adapters/types.ts";
import { isFromTheHost } from "../core/host-prompt.ts";
import { relativeTo, rootsOf } from "../core/paths.ts";
import { type Redacted, redact } from "../core/redact.ts";
import type { Model } from "../embed/model.ts";
import type { DistillCandidate, DistillVerdict, Judge } from "../judge/types.ts";
import { withoutNotes } from "../retrieve/render.ts";
import { type Db, withWrite } from "../store/db.ts";
import { insertMemory, reinforce, supersede } from "../store/memories.ts";
import { clip } from "../util/text.ts";
import { searchTerms } from "../util/words.ts";
import { consolidate, type Draft } from "./consolidate.ts";
import { DURABLE_THRESHOLD, MAX_FACTS, SAVE_THRESHOLD, TITLE_MAX_CHARS } from "./policy.ts";
import { candidates } from "./segment.ts";

export interface DistillDeps {
  db: Db;
  judge: Judge;
  adapters: Partial<Record<string, AgentAdapter>>;
  now: () => number;
  /** The semantic model, loaded once per drain: new memories get their vector as they are written. */
  model?: Model | null;
}

/** A queued turn, as claimed from the queue. Its text was redacted when it was stored. */
export interface QueuedTurn {
  id: number;
  sessionId: number;
  projectId: number;
  agent: string;
  cwd: string;
  agentTurnId: string | null;
  prompt: Redacted;
  finalText: Redacted | null;
  transcriptPath: string | null;
  branch: string | null;
  commit: string | null;
  attempts: number;
  /** Where the turn came from: a hook, or an agent's transcript read afterwards. */
  origin: "live" | "history";
  /** When the turn ended; history memories are dated by it. */
  endedAt: number | null;
}

const MAX_CHANGED_FILES = 10;
const MAX_READ_FILES = 5;
const CONTEXT_MAX_CHARS = 160;
const DETAIL_MAX_CHARS = 500;
const EMPTY: TurnDetail = {
  filesRead: [],
  filesChanged: [],
  commands: [],
  errors: [],
  savedMemory: false,
};

/** What a history turn was queued with: its transcript's tail no longer holds an old turn. */
function storedDetail(db: Db, turnId: number): TurnDetail {
  const row = db
    .query<{ filesRead: string; filesChanged: string; commands: string; errors: string }, [number]>(
      `SELECT files_read AS filesRead, files_changed AS filesChanged, commands, errors
         FROM turns WHERE id = ?`,
    )
    .get(turnId);
  const parse = (json: string | undefined): string[] => {
    try {
      const value: unknown = JSON.parse(json ?? "[]");
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    filesRead: parse(row?.filesRead),
    filesChanged: parse(row?.filesChanged),
    commands: parse(row?.commands),
    errors: parse(row?.errors),
    savedMemory: false,
  };
}

function readDetail(deps: DistillDeps, turn: QueuedTurn): TurnDetail {
  const adapter = deps.adapters[turn.agent];
  const raw =
    turn.origin === "history"
      ? storedDetail(deps.db, turn.id)
      : adapter !== undefined && turn.transcriptPath !== null
        ? adapter.readTurnDetail(turn.transcriptPath, turn.agentTurnId)
        : null;
  if (raw === null) return EMPTY;
  const roots = rootsOf(turn.cwd);
  return {
    filesRead: relativeTo(roots, raw.filesRead),
    filesChanged: relativeTo(roots, raw.filesChanged),
    // Redacted first, cut second: a secret cut in half would no longer be recognised.
    commands: raw.commands.map((command) => clip(redact(command), DETAIL_MAX_CHARS, "…")),
    errors: raw.errors.map((error) => clip(redact(error), DETAIL_MAX_CHARS, "…")),
    savedMemory: raw.savedMemory,
  };
}

function buildDraft(
  prompt: string,
  cands: DistillCandidate[],
  verdict: DistillVerdict,
  detail: TurnDetail,
): Draft | null {
  if (verdict.worthSaving < SAVE_THRESHOLD || verdict.kind === "none") return null;
  const durability = (candidate: DistillCandidate) => verdict.durable[candidate.idx] ?? 0;
  const durable = cands.filter((candidate) => durability(candidate) >= DURABLE_THRESHOLD);
  const title = cands.find((candidate) => candidate.idx === verdict.titleIdx) ?? durable[0];
  if (title === undefined) return null;

  // The strongest facts, shown in the order they were written.
  const facts = [...durable]
    .sort((a, b) => durability(b) - durability(a) || a.idx - b.idx)
    .slice(0, MAX_FACTS)
    .sort((a, b) => a.idx - b.idx)
    .filter((candidate) => candidate.idx !== title.idx)
    .map((candidate) => candidate.text as string);

  // What the user had asked gives the assistant's sentences their referent. A rule
  // taken from the prompt itself needs none.
  const asked = prompt.replace(/\s+/g, " ").trim();
  if (title.source === "final" && asked !== "") {
    facts.push(`Context: ${clip(asked, CONTEXT_MAX_CHARS, "…")}`);
  }

  const changed = detail.filesChanged.slice(0, MAX_CHANGED_FILES);
  const read = detail.filesRead.filter((path) => !changed.includes(path)).slice(0, MAX_READ_FILES);
  return {
    kind: verdict.kind,
    title: clip(title.text, TITLE_MAX_CHARS, "…"),
    body: facts.join("\n") as Redacted,
    importance: verdict.importance,
    files: [
      ...changed.map((path) => ({ path, role: "changed" as const })),
      ...read.map((path) => ({ path, role: "read" as const })),
    ],
  };
}

/** The titles and facts of every note this session was shown. */
function toldInSession(db: Db, sessionId: number): string[] {
  return db
    .query<{ title: string; body: string }, [number]>(
      `SELECT DISTINCT m.title, m.body FROM injections i JOIN memories m ON m.id = i.memory_id
        WHERE i.session_id = ?`,
    )
    .all(sessionId)
    .flatMap((note) => [note.title, ...note.body.split("\n")]);
}

/**
 * Turns one queued turn into at most one memory. Judgments are asked for outside any
 * transaction; the memory and the turn's new state are then written together, so a
 * crash at any point either repeats the work or loses nothing.
 */
export async function distillTurn(
  deps: DistillDeps,
  turn: QueuedTurn,
): Promise<"done" | "skipped"> {
  const { db } = deps;
  const detail = readDetail(deps, turn);
  db.run(
    "UPDATE turns SET files_read = ?, files_changed = ?, commands = ?, errors = ? WHERE id = ?",
    [
      JSON.stringify(detail.filesRead),
      JSON.stringify(detail.filesChanged),
      JSON.stringify(detail.commands),
      JSON.stringify(detail.errors),
      turn.id,
    ],
  );

  const finish = (state: "done" | "skipped") =>
    db.run(
      "UPDATE turns SET state = ?, lease_owner = NULL, lease_until = NULL, last_error = NULL WHERE id = ?",
      [state, turn.id],
    );
  // What the agent chose to save, it saved in its own words: nothing to add.
  if (detail.savedMemory) {
    finish("skipped");
    return "skipped";
  }

  // Text cut from redacted text is itself redacted.
  const told = toldInSession(db, turn.sessionId);
  // A host notification is not the user speaking: no rule comes from it, and it gives
  // the answer no context.
  const prompt = (isFromTheHost(turn.prompt) ? "" : withoutNotes(turn.prompt, told)) as Redacted;
  const finalText = withoutNotes(turn.finalText ?? "", told) as Redacted;
  const cands = candidates(prompt, finalText).map((candidate) => ({
    ...candidate,
    text: candidate.text as Redacted,
  }));
  const verdict = await deps.judge.distill({
    prompt,
    finalText,
    candidates: cands,
    filesChanged: detail.filesChanged,
    commands: detail.commands as Redacted[],
    hadErrors: detail.errors.length > 0,
  });

  const draft = buildDraft(prompt, cands, verdict, detail);
  if (draft === null) {
    finish("skipped");
    return "skipped";
  }

  const action = await consolidate(deps, turn.projectId, draft, turn.id);
  // A turn read back from history is remembered as of when it happened, so that
  // recency and supersession treat it as if it had been captured then.
  const now = turn.origin === "history" && turn.endedAt !== null ? turn.endedAt : deps.now();
  withWrite(db, () => {
    if (action.type === "duplicate") {
      reinforce(db, action.targetId, turn.id, now);
    } else {
      const id = insertMemory(
        db,
        {
          projectId: turn.projectId,
          kind: draft.kind,
          title: draft.title,
          body: draft.body,
          terms: searchTerms(
            draft.title,
            draft.body,
            draft.files.map((file) => file.path),
          ),
          importance: draft.importance,
          branch: turn.branch,
          commit: turn.commit,
          origin: "distilled",
          judge: verdict.source,
          judgeVersion: deps.judge.versions[verdict.source] ?? deps.judge.version,
          sourceTurnId: turn.id,
          files: draft.files,
          now,
        },
        deps.model ?? null,
      );
      for (const oldId of action.supersedes) {
        if (oldId !== id) {
          // A history memory must not supersede a newer memory.
          // If the old memory is newer than the new one, reverse the supersession.
          const oldCreatedAt = db
            .query<{ created_at: number }, [number]>("SELECT created_at FROM memories WHERE id = ?")
            .get(oldId)?.created_at;
          if (oldCreatedAt !== undefined && oldCreatedAt > now) {
            // The old memory is newer; the new (history) memory should step aside.
            supersede(db, id, oldId, now);
          } else {
            // The old memory is older or same age; it is superseded by the new one.
            supersede(db, oldId, id, now);
          }
        }
      }
    }
    finish("done");
  });
  return "done";
}
