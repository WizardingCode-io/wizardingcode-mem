import pkg from "../../package.json" with { type: "json" };
import type { ProjectRef } from "../core/project.ts";
import type { SkipReason } from "../distill/pipeline.ts";
import { noneSkipped, SKIPPED_KEY, type SkippedBy, skippedText } from "../distill/skips.ts";
import { moduleEnabled } from "../engine/modules.ts";
import type { HistoryStatus } from "../history/status.ts";
import { USAGE_KEYS } from "../judge/index.ts";
import { KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION } from "../modules/knowledge/migrations.ts";
import { type Env, loadSettings, publicSettings } from "../settings/settings.ts";
import { destinationOf, levelOf } from "../sharing/levels.ts";
import { isDefault, loadPolicy } from "../sharing/policy.ts";
import { wouldLeave } from "../sharing/report.ts";
import {
  LEVEL_LABELS,
  type Level,
  type Root,
  shareListText,
  TEAM_DESTINATION,
} from "../sharing/types.ts";
import { type Db, moduleSchemaState } from "../store/db.ts";
import { getMeta } from "../store/meta.ts";
import { syncReport } from "../sync/report.ts";
import type { ServerStatus, SyncState } from "../sync/state.ts";
import { plural } from "../util/text.ts";

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
  turns: {
    distilled: number;
    skipped: number;
    /** The skipped turns by reason; `unknown`: skipped with no reason stored (skipped before reasons were kept). */
    skippedBy: SkippedBy & { unknown: number };
    failed: number;
    queued: number;
  };
  hooks: { latency: Latency[]; runs: number; errors: number };
  /** Requests wizardingcode-mem itself made to a model. The heuristic judge makes none. */
  modelCalls: number;
  judge: JudgeReport;
  dataDir: string;
  /** The history import across projects; set by callers that look at the transcripts. */
  history?: HistoryStatus;
  /** Null where the knowledge tables do not exist, or with no database. */
  knowledge: KnowledgeStatus | null;
  sharing: SharingStatus;
  /** The sync's state (ADR 0027); null on a store without the sharing v2 tables. */
  sync: SyncJson | null;
  /** One entry per listed server, as `status --json` prints them; never a token. */
  servers: ServerJson[];
  /** When the report was read, for the relative times its lines print. */
  now: number;
}

/** The sync as `status --json` says it: the lease, the stop flag and the failed-start mark folded. */
export interface SyncJson {
  state: "running" | "stopped" | "failed" | "idle";
  pid: number | null;
  /** False when a lease names a process that is gone (the next session restarts the sync). */
  alive: boolean | null;
  /** The last push or pull of any server, null when none happened. */
  idleSince: number | null;
  stoppedBy: string | null;
  failedStart: { at: number; reason: string; nextTryAt: number } | null;
}

export interface ServerJson {
  id: string;
  name: string;
  host: string;
  member: string;
  role: string;
  state: ServerStatus["state"];
  remedy: string | null;
  cursor: number;
  lastPushAt: number | null;
  lastPushOkAt: number | null;
  lastPullAt: number | null;
  lastPullOkAt: number | null;
  backlog: number;
  dirty: number;
  pending: number;
  conflicts: number;
  hold: { reason: "restore" | "bulk"; count: number } | null;
}

export function syncJson(state: SyncState, servers: ServerStatus[]): SyncJson {
  const stamps = servers.flatMap((server) => [server.lastPushAt ?? 0, server.lastPullAt ?? 0]);
  const idleSince = stamps.length === 0 || Math.max(...stamps) === 0 ? null : Math.max(...stamps);
  const base = { alive: null, idleSince, stoppedBy: null, failedStart: null };
  switch (state.kind) {
    case "running":
      return { ...base, state: "running", pid: state.pid, alive: true };
    case "stopping":
      return { ...base, state: "running", pid: state.pid, alive: true, stoppedBy: state.who };
    case "stopped":
      return { ...base, state: "stopped", pid: null, stoppedBy: state.who };
    case "start-failed":
      return {
        ...base,
        state: "failed",
        pid: null,
        failedStart: { at: state.at, reason: state.reason, nextTryAt: state.nextTryAt },
      };
    case "dead-holder":
      return { ...base, state: "idle", pid: state.pid, alive: false };
    case "not-running":
      return { ...base, state: "idle", pid: null };
  }
}

export const serverJson = (server: ServerStatus): ServerJson => ({
  id: server.serverId,
  name: server.name,
  host: server.host,
  member: server.member,
  role: server.role,
  state: server.state,
  remedy: server.remedy,
  cursor: server.cursor,
  lastPushAt: server.lastPushAt,
  lastPushOkAt: server.lastPushOkAt,
  lastPullAt: server.lastPullAt,
  lastPullOkAt: server.lastPullOkAt,
  backlog: server.backlog,
  dirty: server.dirtyPaths,
  pending: server.pendingRows,
  conflicts: server.openConflicts,
  hold: server.hold === null ? null : { reason: server.hold.reason, count: server.hold.count },
});

/** `3 s ago`, `12 min ago`, `5 h ago`, `3 d ago`; `never` for null. */
export function ago(now: number, at: number | null): string {
  if (at === null) return "never";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** `in 4 min`, `in 2 h`; `now` once the time has come. */
function inTime(now: number, at: number): string {
  const seconds = Math.round((at - now) / 1000);
  if (seconds <= 0) return "now";
  if (seconds < 60) return `in ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `in ${minutes} min` : `in ${Math.round(minutes / 60)} h`;
}

/** The `sync` line of `status`. */
export function formatSync(sync: SyncJson, now: number): string {
  switch (sync.state) {
    case "running":
      if (sync.stoppedBy !== null)
        return `sync      stopping (pid ${sync.pid}), asked by ${sync.stoppedBy}`;
      return `sync      running (pid ${sync.pid})${sync.idleSince === null ? "" : `, idle since ${ago(now, sync.idleSince)}`}`;
    case "stopped":
      return `sync      stopped by ${sync.stoppedBy}; starts again with the next session`;
    case "failed": {
      const failed = sync.failedStart;
      return failed === null
        ? "sync      start failed"
        : `sync      start failed: ${failed.reason}; next try ${inTime(now, failed.nextTryAt)}`;
    }
    case "idle":
      return sync.pid !== null && sync.alive === false
        ? `sync      lease held by pid ${sync.pid}, which is gone; the next session restarts it`
        : "sync      not running; starts with the next session or sync --once";
  }
}

/** One `server` line of `status`. */
export function formatServer(server: ServerJson, now: number): string {
  const state = server.remedy === null ? server.state : `${server.state}: ${server.remedy}`;
  const parts = [
    `${server.name} · ${server.host} · ${server.member} (${server.role})`,
    state,
    `cursor ${server.cursor}`,
    `push ${ago(now, server.lastPushAt)} (ok ${ago(now, server.lastPushOkAt)})`,
    `pull ${ago(now, server.lastPullAt)} (ok ${ago(now, server.lastPullOkAt)})`,
    `backlog ${server.backlog}`,
    `${server.dirty} dirty`,
    `${server.pending} pending`,
    plural(server.conflicts, "conflict"),
  ];
  if (server.hold !== null) {
    parts.push(
      `held: ${server.hold.reason}${server.hold.count > 0 ? ` (${server.hold.count})` : ""}`,
    );
  }
  return `server    ${parts.join(" · ")}`;
}

/** What the agent can be shown from the knowledge index, over every repository. */
export interface KnowledgeStatus {
  /** Whether the modules setting has the module on. */
  on: boolean;
  /** Active, problem-free entries. */
  entries: number;
  /** The pinned ones among them. */
  pinned: number;
  /** Distinct entries shown in the last 24 hours, at a prompt or a session start. */
  shown24h: number;
}

/**
 * What the sharing policy says for the current project, and what would leave under it from
 * the index as it is: this project's own repository and memories, or, with no project, the
 * machine's, at the level Nothing.
 */
export interface SharingStatus {
  level: Level;
  roots: Root[];
  /** The allowed areas in force: listed, and in their root's taxonomy. */
  areas: number;
  wouldLeave: { entries: number; memories: number };
  problems: number;
  /** The lists the environment narrowed: the file allows more than is in force. */
  narrowedByEnv: ("roots" | "areas")[];
  /**
   * Nothing leaves this machine by any choice: no root, no area, no project above Nothing,
   * no problem (`isDefault`), and no list narrowed by the environment.
   */
  default: boolean;
  /** The projects other than this one whose level in force is above Nothing. */
  othersSharing: number;
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

/**
 * The project's skipped turns by the reason the drain stored in `last_error` (`skipMark`).
 * A skipped turn with any other value, NULL included, is `unknown`.
 */
function skippedBy(db: Db | null, project: ProjectRef | null): StatusReport["turns"]["skippedBy"] {
  const by = { ...noneSkipped(), unknown: 0 };
  if (db === null || project === null) return by;
  const rows = db
    .query<{ reason: string | null; n: number }, [number]>(
      "SELECT last_error AS reason, count(*) AS n FROM turns WHERE project_id = ? AND state = 'skipped' GROUP BY last_error",
    )
    .all(project.id);
  for (const { reason, n } of rows) {
    const name = reason?.startsWith("skip:") ? reason.slice(5) : "";
    // Own keys only: a stored `skip:constructor` must not reach the object's prototype.
    const key = Object.hasOwn(SKIPPED_KEY, name) ? SKIPPED_KEY[name as SkipReason] : undefined;
    by[key ?? "unknown"] += n;
  }
  return by;
}

const DAY_MS = 86_400_000;
const KNOWLEDGE_TABLES = ["knowledge_entries", "knowledge_shown"];

/**
 * The knowledge line's figures, read from the index as it is: no file, no git, no write.
 * Null with no database, where the knowledge tables do not exist, and where the module's
 * schema is not the one this binary knows (the module's rule: such tables are left alone).
 */
export function knowledgeStatus(db: Db | null, now: number, on: boolean): KnowledgeStatus | null {
  if (db === null) return null;
  if (moduleSchemaState(db, KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION) !== "current") return null;
  const tables = db
    .query<{ n: number }, string[]>(
      `SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN (${KNOWLEDGE_TABLES.map(() => "?").join(", ")})`,
    )
    .get(...KNOWLEDGE_TABLES)?.n;
  if (tables !== KNOWLEDGE_TABLES.length) return null;
  const counts = db
    .query<{ entries: number; pinned: number | null }, []>(
      `SELECT count(*) AS entries, sum(pinned) AS pinned FROM knowledge_entries
        WHERE status = 'active' AND problem IS NULL`,
    )
    .get();
  const shown =
    db
      .query<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM (SELECT DISTINCT repo_id, entry_id FROM knowledge_shown WHERE at > ?)",
      )
      .get(now - DAY_MS)?.n ?? 0;
  return { on, entries: counts?.entries ?? 0, pinned: counts?.pinned ?? 0, shown24h: shown };
}

/** Whether the modules setting has knowledge on; an unknown id is not logged from here. */
const knowledgeOn = (env: Env, dataDir: string) => moduleEnabled(KNOWLEDGE_MODULE, env, dataDir);

/** The `knowledge` line of `status`. */
export function formatKnowledge(knowledge: KnowledgeStatus): string {
  if (!knowledge.on) return "knowledge off";
  const { entries, pinned, shown24h } = knowledge;
  return `knowledge ${plural(entries, "entry", "entries")} · ${pinned} pinned · ${shown24h} shown in 24 h`;
}

/** The setting behind each list, whose source says whether the environment narrowed it. */
const SHARING_LISTS = {
  roots: "WIZARDINGCODE_MEM_SHARE_ROOTS",
  areas: "WIZARDINGCODE_MEM_SHARE_AREAS",
} as const;

/**
 * The sharing line's figures. Read-only: the policy is loaded and counted as it stands, with
 * no reconcile and no git, so a store that never ran the sharing schema reads every default
 * and nothing is written to it.
 */
function sharingStatus(
  db: Db | null,
  project: ProjectRef | null,
  dataDir: string,
  env: Env,
  now: number,
): SharingStatus {
  const policy = loadPolicy(db, dataDir, env);
  const projectId = project?.id;
  const report = wouldLeave(db, dataDir, env, policy, {
    now,
    fresh: false,
    ...(projectId === undefined ? {} : { projectId }),
  });
  const sources = publicSettings(env, dataDir);
  const narrowedByEnv = (["roots", "areas"] as const).filter(
    (list) => sources[SHARING_LISTS[list]].source === "env",
  );
  // Over every known project, as `perProject` reads levels: that list holds this project
  // alone when the counts are this project's.
  // Each project's level is the one of the server it is bound to (`destinationOf`, ADR 0027);
  // with no store open, the team's default.
  const destinationFor = (id: number) =>
    db === null ? TEAM_DESTINATION : destinationOf(db, policy, id);
  const othersSharing = [...policy.projects].filter(
    (id) => id !== projectId && levelOf(policy, id, destinationFor(id)).level !== "local",
  ).length;
  return {
    level:
      projectId === undefined
        ? "local"
        : levelOf(policy, projectId, destinationFor(projectId)).level,
    roots: [...policy.roots].sort(),
    areas: policy.areas.size,
    wouldLeave: report.counts,
    problems: policy.problems.length,
    narrowedByEnv,
    default: isDefault(policy) && narrowedByEnv.length === 0,
    othersSharing,
  };
}

/**
 * The `sharing` line of `status`. The default sentence is about the machine, so it is said
 * only when nothing leaves it by any choice and no list is narrowed by the environment (a
 * narrowed list hides what the file allows). Otherwise the line gives this project's level
 * and counts, and says how many other projects share.
 */
export function formatSharing(sharing: StatusReport["sharing"]): string {
  const { level, roots, areas, problems, narrowedByEnv, othersSharing } = sharing;
  if (sharing.default) return "sharing   nothing leaves this machine (every default)";
  const byEnv = (list: "roots" | "areas") =>
    narrowedByEnv.includes(list) ? " (set by the environment)" : "";
  const { entries, memories } = sharing.wouldLeave;
  const parts = [
    `this project: ${LEVEL_LABELS[level]}`,
    `roots: ${shareListText(roots)}${byEnv("roots")}`,
    `${plural(areas, "allowed area")}${byEnv("areas")}`,
    `would leave: ${plural(entries, "entry", "entries")}, ${plural(memories, "memory", "memories")} (index as it is)`,
  ];
  if (othersSharing > 0) {
    parts.push(
      othersSharing === 1 ? "1 other project shares" : `${othersSharing} other projects share`,
    );
  }
  if (problems > 0) parts.push(`${plural(problems, "problem")}; see doctor`);
  return `sharing   ${parts.join(" · ")}`;
}

/** `env` and `now` default to the process's: the sharing line reads the settings with them. */
export function statusReport(
  db: Db | null,
  project: ProjectRef | null,
  dataDir: string,
  options: { env?: Env; now?: number } = {},
): StatusReport {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const live = db === null ? null : syncReport(db, dataDir, now);
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
      skippedBy: skippedBy(db, project),
      failed: count("turns WHERE project_id = ? AND state = 'failed'"),
      queued: count("turns WHERE project_id = ? AND state IN ('open', 'pending', 'processing')"),
    },
    hooks: db === null ? { latency: [], runs: 0, errors: 0 } : hookLatency(db),
    modelCalls: 0,
    judge: judgeReport(db, project, dataDir),
    dataDir,
    knowledge: knowledgeStatus(db, now, knowledgeOn(env, dataDir)),
    sharing: sharingStatus(db, project, dataDir, env, now),
    sync: live === null ? null : syncJson(live.state, live.servers),
    servers: live === null ? [] : live.servers.map(serverJson),
    now,
  };
}

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
      `turns     ${turns.distilled} distilled · ${skippedText(turns.skipped, turns.skippedBy)} · ${turns.failed} failed · ${turns.queued} queued`,
    );
  }
  // Printed whether or not anything is stored here: knowledge and what leaves concern the
  // machine, not this project's memories.
  if (report.knowledge !== null) lines.push(formatKnowledge(report.knowledge));
  lines.push(formatSharing(report.sharing));
  // The sync's line once a server is listed, or when something of it stands (a lease, a flag,
  // a failed start): a store with no server prints what it printed before.
  const sync = report.sync;
  if (sync !== null && (report.servers.length > 0 || sync.state !== "idle" || sync.pid !== null)) {
    lines.push(formatSync(sync, report.now));
  }
  for (const server of report.servers) lines.push(formatServer(server, report.now));
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
