// What the viewer decides about the history import: when to offer it, what the card says,
// and the progress poll. Pure, so the tests drive it without a browser.
// No import from api.ts: it reads the page's location, and the tests load this file without one.

/** The history runs as the server reports them (src/history/status.ts); api.ts re-exports these. */
export type HistoryRunState = "never" | "running" | "done" | "failed";
export type HistoryRunKind = "import" | "index";
export interface HistoryRun {
  state: HistoryRunState;
  kind: HistoryRunKind;
  startedAt: number | null;
  finishedAt: number | null;
  last: unknown | null;
}
/** The last import, whatever ran after it: an index run never stands for one. */
export interface HistoryImport {
  state: HistoryRunState;
  startedAt: number | null;
  finishedAt: number | null;
}
export interface HistoryQueue {
  pending: number;
  done: number;
  skipped: number;
  failed: number;
}
export interface HistoryStatus {
  transcripts: { claudeCode: number; codex: number };
  run: HistoryRun;
  import: HistoryImport;
  queue: HistoryQueue;
  index: { exists: boolean; files: number; turns: number; bytes: number };
  replace: { projectsReady: number; wouldArchive: number; replaced: number };
  offer: { dismissed: boolean };
}
export type HistoryProgress = Pick<HistoryStatus, "run" | "import" | "queue">;

/** Every past session found, across agents. */
export const sessionsFound = (s: HistoryStatus): number => s.transcripts.claudeCode + s.transcripts.codex;

/** The one-time offer as `/api/history/offer` returns it: whether to show it is the server's call. */
export interface HistoryOffer {
  show: boolean;
  sessions: number;
  transcripts: { claudeCode: number; codex: number };
}

/**
 * Whether a run's judgements go to TypeSafe: a key is set and the switch is not off (as
 * src/judge/index.ts decides). Then not everything stays on this machine, and the copy says so.
 */
export const judgesWithTypeSafe = (keySet: boolean, typesafe: string | null): boolean => keySet && typesafe !== "off";

const EXCEPT_TYPESAFE = "except TypeSafe judgements (a key is set)";

/** The History card's description. */
export const historyCardDescription = (typesafe: boolean): string =>
  `Learn from the sessions your agents had before. ${typesafe ? `It runs on this machine, ${EXCEPT_TYPESAFE}.` : "Nothing leaves this machine."}`;

/** The offer's last sentence: where the import runs. */
export const offerWhere = (typesafe: boolean): string =>
  `It runs in the background, on this machine${typesafe ? `, ${EXCEPT_TYPESAFE}` : ""}.`;

/** The offer's one line: how many sessions, with which agents, and where it runs. */
export function offerLine(offer: HistoryOffer, typesafe: boolean): string {
  const agents = [offer.transcripts.claudeCode > 0 ? "Claude Code" : "", offer.transcripts.codex > 0 ? "Codex" : ""]
    .filter(Boolean)
    .join(" and ");
  const count = offer.sessions;
  return `Learn from your ${count.toLocaleString("en-GB")} past ${count === 1 ? "session" : "sessions"} with ${agents}. ${offerWhere(typesafe)}`;
}

/** Turns settled (done, skipped or failed) over all queued, rounded down: 100 only at the end. */
export function progressOf(q: HistoryQueue): { settled: number; total: number; percent: number } {
  const settled = q.done + q.skipped + q.failed;
  const total = settled + q.pending;
  return { settled, total, percent: total === 0 ? 0 : Math.floor((settled / total) * 100) };
}

/** The import button: a first import, the rest of an unfinished one, or what came since. */
export function importLabel(s: HistoryStatus): string {
  if (s.import.state === "never") return "Import";
  if (s.import.state === "failed" || s.queue.pending > 0) return "Continue";
  return "Import new sessions";
}

/** A status pill: its words and colours (app.css tokens); `square` marks a stop. */
export interface Pill {
  label: string;
  bg: string;
  fg: string;
  shape: "" | "square";
}
const NEUTRAL = { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" };
const BLUE = { bg: "var(--blue-soft)", fg: "var(--blue-text)" };
const OK = { bg: "var(--ok-soft)", fg: "var(--ok)" };
const WARN = { bg: "var(--warn-soft)", fg: "var(--warn)" };

/** The Past sessions row's pill: the last import's state. */
export function importPill(s: HistoryStatus): Pill {
  switch (s.import.state) {
    case "never":
      return { label: "Not imported", ...NEUTRAL, shape: "" };
    case "running":
      return { label: "Importing", ...BLUE, shape: "" };
    case "failed":
      return { label: "Stopped", ...WARN, shape: "square" };
    default:
      // It ended within its time budget with turns still queued: Continue does the rest.
      return s.queue.pending > 0 ? { label: "Partly imported", ...WARN, shape: "" } : { label: "Imported", ...OK, shape: "" };
  }
}

/** The Search index row's pill, when the last run was an index run. */
export function indexPill(s: HistoryStatus): Pill | null {
  if (s.run.kind !== "index") return null;
  if (s.run.state === "running") return { label: "Indexing", ...BLUE, shape: "" };
  if (s.run.state === "done") return { label: "Indexed", ...OK, shape: "" };
  if (s.run.state === "failed") return { label: "Stopped", ...WARN, shape: "square" };
  return null;
}

export const sizeOf = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/** How long a run asked for may take to record its own start before it is given up on. */
export const START_GRACE_MS = 15_000;

/**
 * A run the viewer asked for at `requestedAt` starts in a background process: until that
 * process records a start of its own, what the server says is the run before (or none).
 */
export const awaitingStart = (run: HistoryRun, requestedAt: number | null, now: number): boolean =>
  requestedAt !== null &&
  now - requestedAt < START_GRACE_MS &&
  run.state !== "running" &&
  (run.startedAt ?? 0) < requestedAt;

export const POLL_MS = 3000;

/**
 * Polls the light progress every 3 s while a run goes, and only then. `sync` is told the
 * state the card shows; `finished` runs once when a polled run is no longer running.
 */
export function progressPoller<H>(deps: {
  load: () => Promise<HistoryProgress>;
  apply: (p: HistoryProgress) => void;
  finished: () => void;
  schedule: (fn: () => void, ms: number) => H;
  cancel: (handle: H) => void;
}): { sync: (state: HistoryRunState) => void; stop: () => void } {
  let handle: H | null = null;
  // True from the first scheduled tick until the run ends: a load in flight counts too.
  let polling = false;
  let stopped = false;
  const next = () => {
    handle = deps.schedule(() => void tick(), POLL_MS);
  };
  const tick = async () => {
    handle = null;
    if (stopped || !polling) return;
    let progress: HistoryProgress;
    try {
      progress = await deps.load();
    } catch {
      // A missed poll is tried again on the next tick.
      if (!stopped && polling) next();
      return;
    }
    if (stopped || !polling) return;
    deps.apply(progress);
    if (progress.run.state === "running") next();
    else {
      polling = false;
      deps.finished();
    }
  };
  return {
    sync(state) {
      if (stopped) return;
      if (state === "running" && !polling) {
        polling = true;
        next();
      } else if (state !== "running" && polling) {
        polling = false;
        if (handle !== null) deps.cancel(handle);
        handle = null;
      }
    },
    stop() {
      stopped = true;
      polling = false;
      if (handle !== null) deps.cancel(handle);
      handle = null;
    },
  };
}

/** One past turn from the history index, as `/api/history/search` returns it (src/history/search.ts). */
export interface PastTurn {
  id: number;
  project: string;
  agent: string;
  sessionId: string;
  cwd: string;
  startedAt: number;
  endedAt: number;
  prompt: string;
  answer: string | null;
}
/** No index yet; or the hits, with a sentence when the index could not be read. */
export type PastSearch = { indexed: false } | { indexed: true; hits: PastTurn[]; error?: string };

const AGENT_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
  opencode: "OpenCode",
  qwen: "Qwen Code",
  droid: "Factory Droid",
  copilot: "GitHub Copilot",
};
export const agentName = (agent: string): string => AGENT_NAMES[agent] ?? agent;

export interface DayGroup {
  key: string;
  label: string;
  hits: PastTurn[];
}

/** Past turns by the day they ended: newest day first, and newest first within a day. */
export function dayGroups(hits: PastTurn[], now: number): DayGroup[] {
  const keyOf = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const today = keyOf(now);
  const yesterday = keyOf(new Date(now).setDate(new Date(now).getDate() - 1));
  const thisYear = new Date(now).getFullYear();
  const groups = new Map<string, DayGroup>();
  for (const hit of hits) {
    const key = keyOf(hit.endedAt);
    let group = groups.get(key);
    if (group === undefined) {
      const d = new Date(hit.endedAt);
      const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() === thisYear ? {} : { year: "numeric" }) }).replace(",", "");
      const label = key === today ? `Today · ${date}` : key === yesterday ? `Yesterday · ${date}` : date;
      group = { key, label, hits: [] };
      groups.set(key, group);
    }
    group.hits.push(hit);
  }
  for (const group of groups.values()) group.hits.sort((a, b) => b.endedAt - a.endedAt);
  return [...groups.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}
