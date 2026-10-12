import pkg from "../../package.json" with { type: "json" };
import type { ProjectRef } from "../core/project.ts";
import type { HistoryStatus } from "../history/status.ts";
import { USAGE_KEYS } from "../judge/index.ts";
import { loadSettings } from "../settings/settings.ts";
import type { Db } from "../store/db.ts";
import { getMeta } from "../store/meta.ts";

export interface Latency {
  event: string;
  p50: number;
  p95: number;
  runs: number;
}

export interface StatusReport {
  version: string;
  project: { name: string; key: string } | null;
  memories: { active: number; stale: number; superseded: number; archived: number };
  turns: { distilled: number; skipped: number; failed: number; queued: number };
  hooks: { latency: Latency[]; runs: number; errors: number };
  /** Requests wizardingcode-mem itself made to a model. The heuristic judge makes none. */
  modelCalls: number;
  judge: JudgeReport;
  dataDir: string;
  /** The history import across projects; set by callers that look at the transcripts. */
  history?: HistoryStatus;
}

const EVENT_ORDER = [
  "session-start",
  "prompt",
  "file-read",
  "tool-failed",
  "turn-end",
  "session-end",
];

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

/** Runs per event considered for latency: enough for a percentile, few enough to be about now.
 *  Per event, so that frequent file reads do not push out the rarer prompt and session samples. */
const RECENT_RUNS = 200;

export function hookLatency(db: Db): StatusReport["hooks"] {
  const rows = db
    .query<{ event: string; ms: number; outcome: string }, [number]>(
      `SELECT event, ms, outcome FROM (
         SELECT *, row_number() OVER (PARTITION BY event ORDER BY id DESC) AS recent FROM hook_runs
       ) WHERE recent <= ? ORDER BY ms`,
    )
    .all(RECENT_RUNS);
  const byEvent = new Map<string, number[]>();
  for (const row of rows) byEvent.set(row.event, [...(byEvent.get(row.event) ?? []), row.ms]);
  const latency = [...byEvent]
    .sort(([a], [b]) => EVENT_ORDER.indexOf(a) - EVENT_ORDER.indexOf(b))
    .map(([event, samples]) => ({
      event,
      p50: percentile(samples, 50),
      p95: percentile(samples, 95),
      runs: samples.length,
    }));
  return { latency, runs: rows.length, errors: rows.filter((row) => row.outcome !== "ok").length };
}

export interface JudgeReport {
  configured: "typesafe" | "heuristic";
  requests: number;
  inputTokens: number;
  /** Active memories of the project, by the judge that produced them. */
  byJudge: Record<string, number>;
}

/** TypeSafe's published input price, used only to show an estimate. */
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

function judgeReport(db: Db | null, project: ProjectRef | null, dataDir: string): JudgeReport {
  const settings = loadSettings(process.env, dataDir);
  const configured =
    settings.typesafeKey === null || settings.typesafe === "off" ? "heuristic" : "typesafe";
  if (db === null) return { configured, requests: 0, inputTokens: 0, byJudge: {} };
  const byJudge: Record<string, number> = {};
  if (project !== null) {
    for (const row of db
      .query<{ judge: string; n: number }, [number]>(
        "SELECT judge, count(*) AS n FROM memories WHERE project_id = ? AND status = 'active' GROUP BY judge ORDER BY n DESC",
      )
      .all(project.id)) {
      byJudge[row.judge] = row.n;
    }
  }
  return {
    configured,
    requests: Number(getMeta(db, USAGE_KEYS.requests) ?? 0),
    inputTokens: Number(getMeta(db, USAGE_KEYS.inputTokens) ?? 0),
    byJudge,
  };
}

export function statusReport(
  db: Db | null,
  project: ProjectRef | null,
  dataDir: string,
): StatusReport {
  const count = (sql: string) =>
    db === null || project === null
      ? 0
      : (db.query<{ n: number }, [number]>(`SELECT count(*) AS n FROM ${sql}`).get(project.id)?.n ??
        0);
  return {
    version: pkg.version,
    project: project === null ? null : { name: project.name, key: project.key },
    memories: {
      active: count("memories WHERE project_id = ? AND status = 'active'"),
      stale: count("memories WHERE project_id = ? AND status = 'active' AND stale = 1"),
      superseded: count("memories WHERE project_id = ? AND status = 'superseded'"),
      archived: count("memories WHERE project_id = ? AND status = 'archived'"),
    },
    turns: {
      distilled: count("turns WHERE project_id = ? AND state = 'done'"),
      skipped: count("turns WHERE project_id = ? AND state = 'skipped'"),
      failed: count("turns WHERE project_id = ? AND state = 'failed'"),
      queued: count("turns WHERE project_id = ? AND state IN ('open', 'pending', 'processing')"),
    },
    hooks: db === null ? { latency: [], runs: 0, errors: 0 } : hookLatency(db),
    modelCalls: 0,
    judge: judgeReport(db, project, dataDir),
    dataDir,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

function formatHistory(h: HistoryStatus): string[] {
  const { queue, index, replace, run } = h;
  const quiet =
    h.transcripts.claudeCode +
      h.transcripts.codex +
      queue.pending +
      queue.done +
      queue.skipped +
      queue.failed ===
      0 &&
    !index.exists &&
    run.state === "never" &&
    replace.replaced === 0;
  // The import line reports the last import; a later index run does not stand for it.
  if (quiet) return [];
  const lines = [
    "History",
    `  found     ${h.transcripts.claudeCode} Claude Code · ${h.transcripts.codex} Codex transcripts`,
    `  import    ${h.import.state} · ${queue.pending} queued · ${queue.done} distilled · ${queue.skipped} skipped · ${queue.failed} failed`,
    index.exists
      ? `  index     ${plural(index.files, "file")} · ${plural(index.turns, "turn")} · ${megabytes(index.bytes)}`
      : "  index     none yet",
  ];
  if (replace.replaced > 0)
    lines.push(`  replaced  ${replace.replaced} imported memories archived`);
  if (replace.wouldArchive > 0)
    lines.push(
      `  replace   ${replace.wouldArchive} imported memories ready to replace (${plural(replace.projectsReady, "project")})`,
    );
  return lines;
}

export function formatStatus(report: StatusReport): string {
  const lines = [`wizardingcode-mem ${report.version}`];
  const { memories, turns, hooks } = report;
  const empty =
    report.project === null ||
    memories.active +
      memories.superseded +
      memories.archived +
      turns.distilled +
      turns.skipped +
      turns.failed +
      turns.queued ===
      0;
  if (empty) {
    lines.push("No memories yet for this project.");
  } else {
    const stale = memories.stale > 0 ? ` (${memories.stale} stale)` : "";
    lines.push(
      `project   ${report.project?.name} (${report.project?.key})`,
      `memories  ${memories.active} active${stale} · ${memories.superseded} superseded${memories.archived > 0 ? ` · ${memories.archived} archived` : ""}`,
      `turns     ${turns.distilled} distilled · ${turns.skipped} skipped · ${turns.failed} failed · ${turns.queued} queued`,
    );
  }
  if (hooks.runs > 0) {
    const speeds = hooks.latency.map((l) => `${l.event} p50 ${l.p50} ms, p95 ${l.p95} ms`);
    lines.push(
      `hooks     ${[...speeds, `${plural(hooks.runs, "run")}, ${plural(hooks.errors, "error")}`].join(" · ")}`,
    );
  }
  const { judge } = report;
  const who = Object.entries(judge.byJudge)
    .map(([name, n]) => `${name} ${n}`)
    .join(", ");
  lines.push(
    judge.configured === "typesafe"
      ? `judge     typesafe, heuristic as fallback · ${judge.requests} requests, ${judge.inputTokens} input tokens (≈ $${(judge.inputTokens * USD_PER_INPUT_TOKEN).toFixed(4)})${who ? ` · memories by judge: ${who}` : ""}`
      : `judge     heuristic only (no TypeSafe key) · model calls made by wizardingcode-mem: ${report.modelCalls}`,
    `data      ${report.dataDir}`,
  );
  if (report.history) lines.push(...formatHistory(report.history));
  return `${lines.join("\n")}\n`;
}
