// What the viewer decides about the history import: when to offer it, what the card says,
// and the progress poll. Pure, so the tests drive it without a browser.
// No import from api.ts: it reads the page's location, and the tests load this file without one.

/** The history import as the server reports it (src/history/status.ts); api.ts re-exports these. */
export type HistoryRunState = "never" | "running" | "done" | "failed";
export interface HistoryRun {
  state: HistoryRunState;
  startedAt: number | null;
  finishedAt: number | null;
  last: unknown | null;
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
  queue: HistoryQueue;
  index: { exists: boolean; files: number; turns: number; bytes: number };
  replace: { projectsReady: number; wouldArchive: number; replaced: number };
  offer: { dismissed: boolean };
}
export type HistoryProgress = Pick<HistoryStatus, "run" | "queue">;

/** Every past session found, across agents. */
export const sessionsFound = (s: HistoryStatus): number => s.transcripts.claudeCode + s.transcripts.codex;

/** The one-time offer: past sessions exist, nothing ever ran, and it was not turned down. */
export const shouldOffer = (s: HistoryStatus | null): boolean =>
  s !== null && sessionsFound(s) > 0 && s.run.state === "never" && !s.offer.dismissed;

/** Turns settled (done, skipped or failed) over all queued, rounded down: 100 only at the end. */
export function progressOf(q: HistoryQueue): { settled: number; total: number; percent: number } {
  const settled = q.done + q.skipped + q.failed;
  const total = settled + q.pending;
  return { settled, total, percent: total === 0 ? 0 : Math.floor((settled / total) * 100) };
}

/** The import button: a first import, the rest of an unfinished one, or what came since. */
export function importLabel(s: HistoryStatus): string {
  if (s.run.state === "never") return "Import";
  if (s.run.state === "failed" || s.queue.pending > 0) return "Continue";
  return "Import new sessions";
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
