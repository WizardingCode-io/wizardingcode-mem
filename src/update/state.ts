// What the last check for a release found, kept beside the binary it describes and outside
// the store. The file is read strictly: its text can end up on a terminal, so nothing the
// product did not shape is ever let through.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../util/atomic-write.ts";
import { isPlainVersion } from "../util/version.ts";

export interface UpdateState {
  /** The latest release found by the last check that succeeded. */
  latest: string | null;
  checkedAt: number | null;
  /** When a request was last started, whatever became of it. */
  attemptAt: number | null;
  failedAt: number | null;
  /** Why the last failed check failed: one of the fixed texts of `REASON`. */
  reason: string | null;
}

export const STATE_FILE = "update.json";
export const REASON = /^(offline|timed out|not a release redirect|HTTP \d{3})$/;

const time = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));

/** The state on disk, or null when there is none or any field of it is not what we write. */
export function readState(dataDir: string): UpdateState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dataDir, STATE_FILE), "utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { latest, checkedAt, attemptAt, failedAt, reason } = parsed as Record<string, unknown>;
  if (latest === undefined || reason === undefined) return null;
  if (latest !== null && !(typeof latest === "string" && isPlainVersion(latest))) return null;
  if (reason !== null && !(typeof reason === "string" && REASON.test(reason))) return null;
  if (!time(checkedAt) || !time(attemptAt) || !time(failedAt)) return null;
  return { latest, checkedAt, attemptAt, failedAt, reason };
}

export function writeState(dataDir: string, state: UpdateState): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileAtomic(join(dataDir, STATE_FILE), `${JSON.stringify(state)}\n`);
}

/** True when the last thing that happened was a check that failed. */
export function lastFailed(state: UpdateState): boolean {
  return state.failedAt !== null && (state.checkedAt === null || state.failedAt > state.checkedAt);
}
