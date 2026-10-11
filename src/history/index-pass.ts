import type { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import {
  listClaudeCodeTranscripts,
  readClaudeCodeHistory,
} from "../adapters/claude-code/history.ts";
import { listCodexTranscripts, readCodexHistory } from "../adapters/codex/history.ts";
import { isFromTheHost } from "../core/host-prompt.ts";
import { type ProjectRef, resolveProject } from "../core/project.ts";
import { FINAL_TEXT_MAX_CHARS, PROMPT_MAX_CHARS, stored } from "../hooks/handle.ts";
import type { Db } from "../store/db.ts";
import { logError } from "../util/log.ts";

type Agent = "claude-code" | "codex";

export interface IndexReport {
  files: number;
  indexed: number;
  unchanged: number;
  removed: number;
  turns: number;
  /** Files that could not be read or resolved; left out of the manifest for the next pass. */
  failed: number;
}

/**
 * Replaces one transcript's rows in the index with its current turns, in one write
 * transaction: a concurrent pass sees either the old file or the new one, never half of each.
 * Returns how many turns were stored.
 */
export function indexTranscript(
  hdb: Database,
  main: Db,
  agent: Agent,
  path: string,
  options: { now: number; projects: Map<string, ProjectRef> },
): number {
  const stat = statSync(path);
  const turns = (
    agent === "claude-code" ? readClaudeCodeHistory(path) : readCodexHistory(path)
  ).filter((turn) => !isFromTheHost(turn.prompt));
  // Projects resolve outside the transaction: resolveProject writes to the main database.
  // A failure leaves the file out of the manifest, so the next pass tries it again.
  const rows = turns.flatMap((turn) => {
    let project = options.projects.get(turn.cwd);
    if (project === undefined) {
      project = resolveProject(main, turn.cwd, options.now);
      options.projects.set(turn.cwd, project);
    }
    if (project.disabled) return [];
    return [
      {
        turn,
        project,
        prompt: stored(turn.prompt, PROMPT_MAX_CHARS),
        final: turn.finalText === null ? null : stored(turn.finalText, FINAL_TEXT_MAX_CHARS),
      },
    ];
  });
  hdb
    .transaction(() => {
      hdb.run("DELETE FROM files WHERE path = ?", [path]); // cascades; triggers clean turns_fts
      hdb.run("INSERT INTO files (path, agent, size, mtime, indexed_at) VALUES (?, ?, ?, ?, ?)", [
        path,
        agent,
        stat.size,
        Math.trunc(stat.mtimeMs),
        options.now,
      ]);
      for (const { turn, project, prompt, final } of rows) {
        hdb.run(
          `INSERT INTO turns (path, agent, session_id, turn_id, project_id, project_name, cwd,
                              started_at, ended_at, prompt, final_text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            path,
            agent,
            turn.sessionId,
            turn.turnId,
            project.id,
            project.name,
            turn.cwd,
            turn.startedAt,
            turn.endedAt,
            prompt,
            final,
          ],
        );
      }
    })
    .immediate();
  return rows.length;
}

/**
 * Brings the index up to date: new and changed transcripts are read again, vanished ones
 * leave. Stops starting new files once `maxMs` is spent; the next run carries on.
 */
export function indexAll(
  hdb: Database,
  main: Db,
  roots: { claudeCode: string; codex: string },
  options: { now: number; maxMs: number; agents: Agent[] },
): IndexReport {
  const report: IndexReport = {
    files: 0,
    indexed: 0,
    unchanged: 0,
    removed: 0,
    turns: 0,
    failed: 0,
  };
  const deadline = Date.now() + options.maxMs;
  try {
    // A project turned off after its turns were indexed takes them out of the index.
    const disabled = main
      .query<{ id: number }, []>("SELECT id FROM projects WHERE disabled = 1")
      .all()
      .map((row) => row.id);
    if (disabled.length > 0) {
      hdb.run("DELETE FROM turns WHERE project_id IN (SELECT value FROM json_each(?))", [
        JSON.stringify(disabled),
      ]);
    }
  } catch (error) {
    logError("history-index", error);
  }
  const projects = new Map<string, ProjectRef>();
  const known = hdb.query<{ size: number; mtime: number }, [string]>(
    "SELECT size, mtime FROM files WHERE path = ?",
  );
  for (const agent of options.agents) {
    const paths =
      agent === "claude-code"
        ? listClaudeCodeTranscripts(roots.claudeCode, 0)
        : listCodexTranscripts(roots.codex, 0);
    const present = new Set<string>();
    for (const path of paths) {
      present.add(path);
      report.files++;
      if (Date.now() >= deadline) continue;
      try {
        const stat = statSync(path);
        const before = known.get(path);
        if (before?.size === stat.size && before.mtime === Math.trunc(stat.mtimeMs)) {
          report.unchanged++;
          continue;
        }
        report.turns += indexTranscript(hdb, main, agent, path, {
          now: options.now,
          projects,
        });
        report.indexed++;
      } catch (error) {
        report.failed++;
        logError("history-index", error);
      }
    }
    try {
      const gone = hdb
        .query<{ path: string }, [string]>("SELECT path FROM files WHERE agent = ?")
        .all(agent)
        .filter((row) => !present.has(row.path));
      hdb
        .transaction(() => {
          for (const row of gone) hdb.run("DELETE FROM files WHERE path = ?", [row.path]);
        })
        .immediate();
      report.removed += gone.length;
    } catch (error) {
      logError("history-index", error);
    }
  }
  return report;
}
