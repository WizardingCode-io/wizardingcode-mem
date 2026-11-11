import type { Redacted } from "../core/redact.ts";
import { SAVE_THRESHOLD } from "../distill/policy.ts";
import type { Db } from "../store/db.ts";
import { withWrite } from "../store/db.ts";
import type { DistillInput, DistillVerdict, Judge } from "./types.ts";

// Judges imported memories again with TypeSafe. The importer could only map the other
// tool's type onto ours and give every memory of a type the same importance; here each
// memory gets its own kind and importance, and what is not worth keeping is archived
// (never deleted). A memory stays `judge = 'claude-mem'` until a TypeSafe verdict is
// written for it, so a run picks up exactly where the last one stopped, and a memory
// the service failed on is tried again next time. Only active memories are judged: a
// superseded one is already out of the way, and is not worth a request.

export interface RejudgeOptions {
  judge: Judge;
  now: number;
  /** Stop after this many memories; by default, all of them. */
  limit?: number;
  /** Requests in flight at once. */
  concurrency?: number;
  /** Called after each batch, with the running totals. */
  onProgress?: (report: RejudgeReport) => void;
}

export interface RejudgeReport {
  judged: number;
  archived: number;
  kindChanged: number;
  failed: number;
  /** Imported memories still waiting for a TypeSafe verdict. */
  remaining: number;
}

/**
 * The import rejudge keeps the version 1 questions (ADR 0023, D-2): the wording it asks in,
 * and the version it stamps, both from this one constant, so they cannot drift apart.
 */
export const IMPORT_WORDING = 1;
export const IMPORT_JUDGE_VERSION = String(IMPORT_WORDING);

/** After this many failures in a row the service is taken to be down and the run stops. */
export const STOP_AFTER_FAILURES = 5;
const BATCH = 200;
const SOURCE_JUDGE = "claude-mem";

interface Row {
  id: number;
  kind: string;
  title: string;
  body: string;
}

function pending(db: Db, afterId: number, limit: number): Row[] {
  return db
    .query<Row, [string, number, number]>(
      `SELECT id, kind, title, body FROM memories
       WHERE origin = 'imported' AND judge = ? AND status = 'active' AND id > ?
       ORDER BY id LIMIT ?`,
    )
    .all(SOURCE_JUDGE, afterId, limit);
}

/** How many imported memories the rejudge would still select: its own selection, for the tests too. */
export function rejudgeRemaining(db: Db): number {
  return (
    db
      .query<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM memories WHERE origin = 'imported' AND judge = ? AND status = 'active'",
      )
      .get(SOURCE_JUDGE)?.n ?? 0
  );
}

function filesChanged(db: Db, memoryId: number): string[] {
  return db
    .query<{ path: string }, [number]>(
      "SELECT path FROM memory_files WHERE memory_id = ? AND role = 'changed' ORDER BY path",
    )
    .all(memoryId)
    .map((row) => row.path);
}

/** The memory as the judge sees it: a turn with no prompt, no candidates to rate, and the text as its final message. */
function asInput(db: Db, row: Row): DistillInput {
  return {
    prompt: "" as Redacted,
    finalText: `${row.title}\n${row.body}` as Redacted,
    candidates: [],
    filesChanged: filesChanged(db, row.id),
    commands: [],
    hadErrors: false,
    wording: IMPORT_WORDING,
  };
}

/** A verdict TypeSafe gave, or null when it did not answer. */
type Outcome = { row: Row; verdict: DistillVerdict | null };

async function judgeAll(
  db: Db,
  judge: Judge,
  rows: Row[],
  concurrency: number,
  onOutcome: (outcome: Outcome) => void,
  stop: () => boolean,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  let next = 0;
  const worker = async () => {
    while (next < rows.length && !stop()) {
      const row = rows[next++] as Row;
      let verdict: DistillVerdict | null = null;
      try {
        verdict = await judge.distill(asInput(db, row));
      } catch {
        verdict = null;
      }
      // A verdict from the fallback is the heuristic judge's reading of a memory it was
      // never tuned for: not worth writing over what the importer recorded.
      const outcome = { row, verdict: verdict?.source === "typesafe" ? verdict : null };
      outcomes.push(outcome);
      onOutcome(outcome);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return outcomes.sort((a, b) => a.row.id - b.row.id);
}

export async function rejudge(db: Db, options: RejudgeOptions): Promise<RejudgeReport> {
  if (options.judge.versions.typesafe === undefined)
    throw new Error("rejudge needs a judge that can answer through TypeSafe");
  const report: RejudgeReport = { judged: 0, archived: 0, kindChanged: 0, failed: 0, remaining: 0 };
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  let failuresInARow = 0;
  const down = () => failuresInARow >= STOP_AFTER_FAILURES;

  const update = db.prepare<unknown, [string, number, string, string, number]>(
    "UPDATE memories SET kind = ?, importance = ?, status = ?, judge = 'typesafe', judge_version = ? WHERE id = ?",
  );

  // Within a run, a memory is tried once: the cursor moves past failures, and the next
  // run finds them again because they are still the importer's.
  let afterId = 0;
  while (report.judged + report.failed < limit && !down()) {
    const rows = pending(db, afterId, Math.min(BATCH, limit - report.judged - report.failed));
    if (rows.length === 0) break;
    const outcomes = await judgeAll(
      db,
      options.judge,
      rows,
      options.concurrency ?? 4,
      ({ verdict }) => {
        failuresInARow = verdict === null ? failuresInARow + 1 : 0;
      },
      down,
    );
    withWrite(db, () => {
      for (const { row, verdict } of outcomes) {
        afterId = Math.max(afterId, row.id);
        if (verdict === null) {
          report.failed++;
          continue;
        }
        const keep = verdict.worthSaving >= SAVE_THRESHOLD;
        const kind = keep && verdict.kind !== "none" ? verdict.kind : row.kind;
        update.run(
          kind,
          verdict.importance,
          keep ? "active" : "archived",
          IMPORT_JUDGE_VERSION,
          row.id,
        );
        report.judged++;
        if (!keep) report.archived++;
        if (kind !== row.kind) report.kindChanged++;
      }
    });
    options.onProgress?.({ ...report, remaining: rejudgeRemaining(db) });
  }
  report.remaining = rejudgeRemaining(db);
  return report;
}
