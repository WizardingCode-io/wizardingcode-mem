import type { Pill } from "./history";

/** Semantic search as the server reports it (src/embed/status.ts); api.ts re-exports it. */
export interface SemanticStatus {
  model: {
    present: boolean;
    bytes: number;
    expectedBytes: number;
    enabled: boolean;
    source: "env" | "file" | "default";
    problem: string | null;
  };
  download: { running: boolean; done: number; total: number; error: string | null };
  backfill: { running: boolean };
  memories: { active: number; withVectors: number };
  offer: { dismissed: boolean };
}

const MB = 1024 * 1024;
const NEUTRAL = { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" };
const BLUE = { bg: "var(--blue-soft)", fg: "var(--blue-text)" };
const OK = { bg: "var(--ok-soft)", fg: "var(--ok)" };
const WARN = { bg: "var(--warn-soft)", fg: "var(--warn)" };
const DANGER = { bg: "var(--danger-soft)", fg: "var(--danger)" };

const n = (v: number) => v.toLocaleString("en-GB");
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The model row's pill. */
export function modelPill(s: SemanticStatus): Pill {
  if (s.download.running) return { label: "Downloading", ...BLUE, shape: "" };
  if (!s.model.present) {
    return s.download.error !== null
      ? { label: "Failed", ...WARN, shape: "square" }
      : { label: "Not downloaded", ...NEUTRAL, shape: "" };
  }
  if (!s.model.enabled) return { label: "Off", ...NEUTRAL, shape: "" };
  if (s.model.problem !== null) return { label: "Unreadable", ...DANGER, shape: "square" };
  return { label: "Ready", ...OK, shape: "" };
}

/** The model row's line: its size, the bytes so far, or what went wrong. */
export function modelLine(s: SemanticStatus): string {
  if (s.download.running) {
    const total = s.download.total || s.model.expectedBytes;
    return `${(s.download.done / MB).toFixed(1)} of ${(total / MB).toFixed(1)} MB`;
  }
  if (!s.model.present) {
    if (s.download.error !== null) return capital(s.download.error);
    return `${Math.round(s.model.expectedBytes / MB)} MB · downloaded once, then used offline`;
  }
  if (s.model.enabled && s.model.problem !== null) return `Cannot be read: ${s.model.problem}`;
  return `${Math.round(s.model.bytes / MB)} MB · on this machine`;
}

export function downloadPercent(s: SemanticStatus): number {
  const total = s.download.total;
  return total > 0 ? Math.min(100, Math.floor((s.download.done / total) * 100)) : 0;
}

/** The memories row: how many active memories have a vector of the model. */
export const vectorsLine = (s: SemanticStatus): string =>
  `${n(s.memories.withVectors)} of ${n(s.memories.active)} active memories`;

export const vectorsPercent = (s: SemanticStatus): number =>
  s.memories.active > 0 ? Math.min(100, Math.floor((s.memories.withVectors / s.memories.active) * 100)) : 100;

/** Null while there is no model to make vectors with, or it is switched off. */
export function vectorsPill(s: SemanticStatus): Pill | null {
  if (s.backfill.running) return { label: "Backfilling", ...BLUE, shape: "" };
  if (!s.model.present || !s.model.enabled) return null;
  return s.memories.withVectors >= s.memories.active
    ? { label: "Complete", ...OK, shape: "" }
    : { label: "Partial", ...WARN, shape: "" };
}

/** How long a run asked for may take to show itself before polling stops waiting for it. */
const START_GRACE_MS = 15_000;
export const SEMANTIC_POLL_MS = 2000;

/** Poll while a download or a backfill runs, or one was asked for moments ago. */
export const semanticBusy = (s: SemanticStatus, requestedAt: number | null, now: number): boolean =>
  s.download.running || s.backfill.running || (requestedAt !== null && now - requestedAt < START_GRACE_MS);

/**
 * A download that just ended with memories still lacking vectors: the backfill it hands over to
 * is about to show, so the poll keeps waiting for it (a grace, like a run just asked for).
 */
export const awaitingBackfill = (before: SemanticStatus, after: SemanticStatus): boolean =>
  before.download.running &&
  !after.download.running &&
  !after.backfill.running &&
  after.model.present &&
  after.model.enabled &&
  after.memories.withVectors < after.memories.active;
