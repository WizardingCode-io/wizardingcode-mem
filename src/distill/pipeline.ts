import type { AgentAdapter, TurnDetail } from "../adapters/types.ts";
import { isFromTheHost } from "../core/host-prompt.ts";
import { relativeTo, rootsOf } from "../core/paths.ts";
import { type Redacted, redact } from "../core/redact.ts";
import type { MemoryKind } from "../core/types.ts";
import type { Model } from "../embed/model.ts";
import type { DistillCandidate, DistillVerdict, Judge } from "../judge/types.ts";
import { withoutNotes } from "../retrieve/render.ts";
import { type Db, withWrite } from "../store/db.ts";
import { insertMemory, reinforce, supersede } from "../store/memories.ts";
import { clip } from "../util/text.ts";
import { searchTerms } from "../util/words.ts";
import { consolidate, type Draft } from "./consolidate.ts";
import { dropNoise, stripHost, withoutSentences } from "./noise.ts";
import {
  CONTEXT_MIN_WORDS,
  KNOWLEDGE_THRESHOLD,
  MAX_FACTS,
  SAVE_THRESHOLD,
  TITLE_MAX_CHARS,
} from "./policy.ts";
import { candidates, wordCount } from "./segment.ts";

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

/**
 * What a turn was stored with: a history turn's transcript tail no longer holds an old
 * turn, and the quality proof reads turns whose transcripts may be gone.
 */
export function storedDetail(db: Db, turnId: number): TurnDetail {
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

/**
 * Why the drain skipped a turn. A skipped turn keeps it in its `last_error` column as
 * `skip:<reason>` (`skipMark`): the column is cleared whenever a turn becomes done or
 * skipped, and holds an error only for a pending or failed turn, so no migration is needed.
 */
export type SkipReason = "saved" | "empty" | "not-worth" | "no-title";
export const skipMark = (reason: SkipReason): string => `skip:${reason}`;

/** The judge found the turn worth a memory, if a sentence can title it. */
const worthKeeping = (verdict: DistillVerdict): verdict is DistillVerdict & { kind: MemoryKind } =>
  verdict.worthSaving >= SAVE_THRESHOLD && verdict.kind !== "none";

/**
 * The memory a verdict allows, or null. The title must be knowledge: the judge's choice
 * when that sentence reaches the threshold, otherwise the surest sentence that does; with
 * none, no memory, whatever `worthSaving` said.
 */
export function buildDraft(
  prompt: string,
  cands: DistillCandidate[],
  verdict: DistillVerdict,
  detail: TurnDetail,
): Draft | null {
  if (!worthKeeping(verdict)) return null;
  // `durable` keeps its name in the verdict: it is the per-candidate knowledge probability.
  const knowledge = (candidate: DistillCandidate) => verdict.durable[candidate.idx] ?? 0;
  const surestFirst = (a: DistillCandidate, b: DistillCandidate) =>
    knowledge(b) - knowledge(a) || a.idx - b.idx;
  const known = cands.filter((candidate) => knowledge(candidate) >= KNOWLEDGE_THRESHOLD);
  const chosen = cands.find((candidate) => candidate.idx === verdict.titleIdx);
  const title =
    chosen !== undefined && knowledge(chosen) >= KNOWLEDGE_THRESHOLD
      ? chosen
      : [...known].sort(surestFirst)[0];
  if (title === undefined) return null;

  // The strongest facts, shown in the order they were written.
  const facts = [...known]
    .sort(surestFirst)
    .slice(0, MAX_FACTS)
    .sort((a, b) => a.idx - b.idx)
    .filter((candidate) => candidate.idx !== title.idx)
    .map((candidate) => candidate.text as string);

  // What the user had asked gives the answer's sentences their referent. A bare "ok"
  // gives none, and a rule taken from the prompt itself needs none.
  const asked = prompt.replace(/\s+/g, " ").trim();
  if (title.source === "final" && wordCount(asked) >= CONTEXT_MIN_WORDS) {
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

/**
 * The titles and facts of every note this session had been shown when the turn ended. A
 * note shown later cannot have been repeated in the turn. With no end recorded, every note
 * of the session counts. A memory made from this same turn never counts: a late turn-end
 * moves `ended_at` later (`completeTurn`, `src/store/turns.ts`), past the moment the
 * memory of its first ending was shown, and it would take the turn's own sentences away.
 * Exported for the quality proof, which shows the labeller the turn as the pipeline reads it.
 */
export function toldInSession(
  db: Db,
  turnId: number,
  sessionId: number,
  endedAt: number | null,
): string[] {
  return db
    .query<{ title: string; body: string }, [number, number | null, number | null, number]>(
      `SELECT DISTINCT m.title, m.body FROM injections i JOIN memories m ON m.id = i.memory_id
        WHERE i.session_id = ? AND (? IS NULL OR i.at <= ?)
          AND (m.source_turn_id IS NULL OR m.source_turn_id <> ?)`,
    )
    .all(sessionId, endedAt, endedAt, turnId)
    .flatMap((note) => [note.title, ...note.body.split("\n")]);
}

export interface PreparedTexts {
  /** What the judge reads as `user_prompt`, and what the `Context:` line quotes. */
  prompt: Redacted;
  /** What the judge reads as `assistant_final_message`. */
  finalText: Redacted;
  /** What the judge rates: the sentences the noise filter kept, re-indexed from 0. */
  candidates: DistillCandidate[];
  /** The sentences the noise filter dropped, each with the name of its pattern. */
  dropped: { text: string; pattern: string }[];
}

/**
 * The first step of `prepareTexts`: the notes the session had been shown removed, the
 * host's blocks still in. A host notification is not the user speaking: no rule comes
 * from it, and it gives the answer no context, so its prompt is empty. Exported so that
 * the quality proof shows the labeller exactly the texts the filter starts from.
 */
export function unfilteredTexts(
  prompt: string,
  finalText: string | null,
  told: string[],
): { prompt: string; finalText: string } {
  return {
    prompt: isFromTheHost(prompt) ? "" : withoutNotes(prompt, told),
    finalText: withoutNotes(finalText ?? "", told),
  };
}

/**
 * A turn's texts as a judge sees them, and the sentences it rates: the notes the session
 * had been shown (`told`) and the host's blocks are removed, the texts are segmented, the
 * noise filter runs, and the sentences it dropped are taken out of the texts too, so that
 * neither the host's frame nor a noise sentence reaches the judge or the `Context:` line.
 * Pure. Text cut from redacted text is itself redacted.
 */
export function prepareTexts(
  prompt: Redacted,
  finalText: Redacted | null,
  told: string[],
): PreparedTexts {
  const before = unfilteredTexts(prompt, finalText, told);
  const asked = stripHost(before.prompt);
  const answer = stripHost(before.finalText);
  const segmented = candidates(asked, answer).map((candidate) => ({
    ...candidate,
    text: candidate.text as Redacted,
  }));
  const { kept, dropped } = dropNoise(segmented);
  const droppedFrom = (source: "prompt" | "final") =>
    dropped
      .filter(({ candidate }) => candidate.source === source)
      .map(({ candidate }) => candidate.text);
  return {
    prompt: withoutSentences(asked, droppedFrom("prompt")) as Redacted,
    finalText: withoutSentences(answer, droppedFrom("final")) as Redacted,
    candidates: kept,
    dropped: dropped.map(({ candidate, pattern }) => ({ text: candidate.text, pattern })),
  };
}

export interface PreparedTurn extends PreparedTexts {
  detail: TurnDetail;
}

/** What `prepareTurn` reads of a turn. */
export type TurnTexts = Pick<QueuedTurn, "id" | "sessionId" | "endedAt" | "prompt" | "finalText">;

/** The turn as a judge will see it. The live drain and the quality proof both start here. */
export function prepareTurn(db: Db, turn: TurnTexts, detail: TurnDetail): PreparedTurn {
  const told = toldInSession(db, turn.id, turn.sessionId, turn.endedAt);
  return { ...prepareTexts(turn.prompt, turn.finalText, told), detail };
}

/**
 * What `draftTurn` found: a draft, or why there is none. A turn the filter emptied has no
 * verdict, since the judge was not asked; a refused one keeps its verdict for the proof.
 */
export type DraftedTurn =
  | { skipped: "empty"; verdict: null; draft: null }
  | { skipped: "not-worth" | "no-title"; verdict: DistillVerdict; draft: null }
  | { skipped: null; verdict: DistillVerdict; draft: Draft };

/**
 * The judge's verdict and the draft it allows. With no candidate left there is nothing to
 * select from: the judge is not asked, and there is no verdict.
 */
export async function draftTurn(judge: Judge, prepared: PreparedTurn): Promise<DraftedTurn> {
  if (prepared.candidates.length === 0) return { skipped: "empty", verdict: null, draft: null };
  const verdict = await judge.distill({
    prompt: prepared.prompt,
    finalText: prepared.finalText,
    candidates: prepared.candidates,
    filesChanged: prepared.detail.filesChanged,
    commands: prepared.detail.commands as Redacted[],
    hadErrors: prepared.detail.errors.length > 0,
  });
  const draft = buildDraft(prepared.prompt, prepared.candidates, verdict, prepared.detail);
  // buildDraft refuses for one of two reasons: the verdict, or no knowledge sentence to title by.
  if (draft !== null) return { skipped: null, verdict, draft };
  return { skipped: worthKeeping(verdict) ? "no-title" : "not-worth", verdict, draft };
}

/**
 * Turns one queued turn into at most one memory. Judgments are asked for outside any
 * transaction; the memory and the turn's new state are then written together, so a
 * crash at any point either repeats the work or loses nothing.
 */
export async function distillTurn(
  deps: DistillDeps,
  turn: QueuedTurn,
): Promise<"done" | SkipReason> {
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

  // One write sets the state and the reason, so a skipped turn never lacks its reason and a
  // done turn never keeps an earlier error.
  const finish = (outcome: "done" | SkipReason) => {
    const [state, mark] = outcome === "done" ? ["done", null] : ["skipped", skipMark(outcome)];
    db.run(
      "UPDATE turns SET state = ?, lease_owner = NULL, lease_until = NULL, last_error = ? WHERE id = ?",
      [state, mark, turn.id],
    );
  };
  // What the agent chose to save, it saved in its own words: nothing to add.
  if (detail.savedMemory) {
    finish("saved");
    return "saved";
  }

  const drafted = await draftTurn(deps.judge, prepareTurn(db, turn, detail));
  if (drafted.skipped !== null) {
    finish(drafted.skipped);
    return drafted.skipped;
  }
  const { verdict, draft } = drafted;

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
