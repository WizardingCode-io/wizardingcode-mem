import type { HistoryTurn } from "../adapters/history.ts";
import { isFromTheHost } from "../core/host-prompt.ts";
import { type ProjectRef, resolveProject } from "../core/project.ts";
import { redact } from "../core/redact.ts";
import { FINAL_TEXT_MAX_CHARS, PROMPT_MAX_CHARS, stored } from "../hooks/handle.ts";
import { type Db, withWrite } from "../store/db.ts";
import { touchSession } from "../store/sessions.ts";
import { clip } from "../util/text.ts";

const DETAIL_MAX_CHARS = 500;

export interface EnqueueReport {
  queued: number;
  /** Already in the queue or already captured by the hooks. */
  known: number;
  /** Outside the window, from the host, from a disabled project, or from a folder that cannot be resolved. */
  skipped: number;
}

const list = (values: string[], redacted: boolean) =>
  JSON.stringify(values.map((v) => (redacted ? clip(redact(v), DETAIL_MAX_CHARS, "…") : v)));

/**
 * Queues finished history turns that started at or after `sinceMs`, oldest first. Idempotent.
 * `projects` caches the project of each working directory (git runs once per directory);
 * a caller importing many files can share one map across calls.
 */
export function enqueueHistory(
  db: Db,
  turns: HistoryTurn[],
  options: { sinceMs: number; now: number; projects?: Map<string, ProjectRef> },
): EnqueueReport {
  const report: EnqueueReport = { queued: 0, known: 0, skipped: 0 };
  const projects = options.projects ?? new Map<string, ProjectRef>();
  const ordered = [...turns].sort((a, b) => a.startedAt - b.startedAt);
  for (const turn of ordered) {
    if (turn.startedAt < options.sinceMs || isFromTheHost(turn.prompt)) {
      report.skipped++;
      continue;
    }
    let project = projects.get(turn.cwd);
    if (project === undefined) {
      try {
        project = resolveProject(db, turn.cwd, options.now);
      } catch {
        report.skipped++;
        continue;
      }
      projects.set(turn.cwd, project);
    }
    if (project.disabled) {
      report.skipped++;
      continue;
    }
    const projectId = project.id;
    withWrite(db, () => {
      const session = touchSession(db, {
        agent: turn.agent,
        agentSessionId: turn.sessionId,
        projectId,
        cwd: turn.cwd,
        branch: turn.branch,
        now: turn.endedAt,
      });
      const inserted = db.run(
        `INSERT INTO turns (session_id, project_id, seq, agent_turn_id, state, completeness, origin,
                            prompt, final_text, files_read, files_changed, commands, errors,
                            transcript_path, branch, started_at, ended_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM turns WHERE session_id = ?), ?,
                 'pending', 'full', 'history', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_id, agent_turn_id) WHERE agent_turn_id IS NOT NULL DO NOTHING`,
        [
          session.id,
          projectId,
          session.id,
          turn.turnId,
          stored(turn.prompt, PROMPT_MAX_CHARS),
          turn.finalText === null ? null : stored(turn.finalText, FINAL_TEXT_MAX_CHARS),
          list(turn.detail.filesRead, false),
          list(turn.detail.filesChanged, false),
          list(turn.detail.commands, true),
          list(turn.detail.errors, true),
          turn.transcriptPath,
          turn.branch,
          turn.startedAt,
          turn.endedAt,
        ],
      );
      if (inserted.changes === 1) report.queued++;
      else report.known++;
    });
  }
  return report;
}
