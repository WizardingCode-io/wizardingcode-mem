// The one request this product makes by itself: which release is the latest. It reads the
// redirect github.com answers for `releases/latest` and nothing else: no body, no API, no
// download. Everything that is not that redirect is a reason, never a version.
import { isPlainVersion } from "../util/version.ts";
import { reason } from "./reason.ts";
import { lastFailed, readState, type UpdateState, writeState } from "./state.ts";

export const REQUEST_LIMIT_MS = 5000;
const ATTEMPT_WINDOW_MS = 60_000;
const AFTER_FAILURE_MS = 3_600_000;
const AFTER_SUCCESS_MS = 86_400_000;

export type Latest = { ok: true; version: string } | { ok: false; reason: string };

/** The latest plain release of `repository`, or why it could not be read. */
export async function latestRelease(
  fetchImpl: typeof fetch,
  repository: string,
  options: { timeoutMs?: number } = {},
): Promise<Latest> {
  const base = `https://github.com/${repository}/releases`;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<"timed out">((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve("timed out");
    }, options.timeoutMs ?? REQUEST_LIMIT_MS);
  });
  try {
    const answer = await Promise.race([
      fetchImpl(`${base}/latest`, {
        method: "GET",
        redirect: "manual",
        // Nothing of the product's version, the platform or the machine.
        headers: { "User-Agent": "wizardingcode-mem" },
        signal: abort.signal,
      }),
      limit,
    ]);
    if (answer === "timed out") return { ok: false, reason: "timed out" };
    if (answer.status !== 301 && answer.status !== 302) {
      return {
        ok: false,
        reason: /^\d{3}$/.test(String(answer.status))
          ? `HTTP ${answer.status}`
          : "not a release redirect",
      };
    }
    const location = answer.headers.get("location") ?? "";
    const prefix = `${base}/tag/v`;
    const version = location.startsWith(prefix) ? location.slice(prefix.length) : "";
    return isPlainVersion(version)
      ? { ok: true, version }
      : { ok: false, reason: "not a release redirect" };
  } catch {
    return { ok: false, reason: abort.signal.aborted ? "timed out" : "offline" };
  } finally {
    // An armed timer would keep the process alive after the answer.
    clearTimeout(timer);
  }
}

/** Whether the automatic check may ask now. */
export function due(state: UpdateState | null, now: number): boolean {
  if (state === null) return true;
  const { attemptAt, checkedAt, failedAt } = state;
  // A clock that went back, or a file from another machine: never a reason to stop checking.
  if ([attemptAt, checkedAt, failedAt].some((at) => at !== null && at > now)) return true;
  // Another process is asking, or has just asked.
  if (attemptAt !== null && now - attemptAt < ATTEMPT_WINDOW_MS) return false;
  if (checkedAt === null && failedAt === null) return true;
  if (lastFailed(state)) return now - (failedAt as number) >= AFTER_FAILURE_MS;
  return now - (checkedAt as number) >= AFTER_SUCCESS_MS;
}

export type Mode = "check" | "off" | "off-unknown" | "ci";

/** What the key's value and the environment allow; in doubt, no request. */
export function mode(value: string | null, env: Record<string, string | undefined>): Mode {
  if (value === "off") return "off";
  if (value !== null && value !== "check") return "off-unknown";
  return env.CI ? "ci" : "check";
}

export interface CheckResult {
  /** Whether this call made a request. */
  asked: boolean;
  state: UpdateState | null;
  /** Why the state could not be written, when it could not. */
  error?: string;
}

/**
 * Asks once and records what came of it. The automatic check asks only in mode `check` and
 * when due; a forced one (a person typed `update`) asks in CI too and whatever the age.
 */
export async function checkForRelease(input: {
  dataDir: string;
  mode: Mode;
  now: number;
  fetch: typeof fetch;
  repository: string;
  force?: boolean;
}): Promise<CheckResult> {
  const before = readState(input.dataDir);
  const allowed = input.force
    ? input.mode === "check" || input.mode === "ci"
    : input.mode === "check" && due(before, input.now);
  if (!allowed) return { asked: false, state: before };
  const past = (at: number | null) => (at !== null && at > input.now ? null : at);
  const attempt: UpdateState = {
    latest: before?.latest ?? null,
    checkedAt: past(before?.checkedAt ?? null),
    failedAt: past(before?.failedAt ?? null),
    reason: before?.reason ?? null,
    attemptAt: input.now,
  };
  try {
    writeState(input.dataDir, attempt);
  } catch (error) {
    return { asked: false, state: before, error: reason(error) };
  }
  const answer = await latestRelease(input.fetch, input.repository);
  const after: UpdateState = answer.ok
    ? { ...attempt, latest: answer.version, checkedAt: input.now, reason: null }
    : { ...attempt, failedAt: input.now, reason: answer.reason };
  try {
    writeState(input.dataDir, after);
  } catch (error) {
    return { asked: true, state: attempt, error: reason(error) };
  }
  return { asked: true, state: after };
}
