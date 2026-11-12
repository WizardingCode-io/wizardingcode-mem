// What a person is told about releases and about the copy their agents run. `updateLine`
// and `agentsLine` are the only places these sentences are written.
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { stagedPath, stagedVersion } from "../install/binary.ts";
import { updateSetting } from "../settings/settings.ts";
import { ago } from "../util/ago.ts";
import { olderThan } from "../util/version.ts";
import { CHANNEL_COMMANDS } from "./channels.ts";
import { type Mode, mode as modeOf } from "./check.ts";
import { lastFailed, readState, type UpdateState } from "./state.ts";

export type Source = "env" | "file" | "default";

export interface StagedFacts {
  path: string;
  exists: boolean;
  /** The version the staged binary answers; null when there is none or it answers none. */
  version: string | null;
  /** Whether this process is the staged binary. */
  isSelf: boolean;
}

/** The staged binary as this process finds it. It is run only when it is another file. */
export function stagedFacts(dataDir: string, running: string): StagedFacts {
  const path = stagedPath(dataDir);
  if (!existsSync(path)) return { path, exists: false, version: null, isSelf: false };
  const isSelf = realpathSync(path) === realpathSync(process.execPath);
  return { path, exists: true, version: isSelf ? running : stagedVersion(path), isSelf };
}

/** Line 1: the first row of the spec's table that applies. */
export function updateLine(input: {
  mode: Mode;
  source: Source;
  /** Whether this call made a request (a typed `update`), CI or not. */
  asked: boolean;
  state: UpdateState | null;
  current: string;
  /** Whether `current` is the staged binary's version (else the running copy's). */
  currentIsStaged: boolean;
  dataDir: string;
  now: number;
}): { line: string; out: boolean } {
  const { state, current, now } = input;
  const say = (line: string, out = false) => ({ line: `update: ${line}`, out });
  if (input.mode === "off") {
    return say(
      input.source === "env"
        ? "off (WIZARDINGCODE_MEM_UPDATE in this command's environment; other processes may not see it)"
        : `off (WIZARDINGCODE_MEM_UPDATE in ${join(input.dataDir, "env")})`,
    );
  }
  if (input.mode === "off-unknown")
    return say("off (WIZARDINGCODE_MEM_UPDATE is neither check nor off)");
  const failed = state !== null && lastFailed(state);
  const failure = failed ? `${state.reason}, ${ago(now, state.failedAt)}` : "";
  const latest = state?.latest ?? null;
  if (state !== null && latest !== null && olderThan(current, latest)) {
    const when = failed
      ? `checked ${ago(now, state.checkedAt)}; last check failed: ${failure}`
      : `checked ${ago(now, state.checkedAt)}`;
    const who = input.currentIsStaged ? `the agents run ${current}` : `this copy is ${current}`;
    return say(`${latest} is out (${when}); ${who}`, true);
  }
  if (input.mode === "ci" && !input.asked) return say("not checked in CI");
  if (state === null || (latest === null && !failed)) return say("not checked yet");
  if (failed) {
    return say(
      `could not check (${failure}); ${latest === null ? "no release known yet" : `last known ${latest}`}`,
    );
  }
  const checked = `(checked ${ago(now, state.checkedAt)})`;
  return latest === current
    ? say(`${latest} is the latest ${checked}`)
    : say(`${current} is ahead of the latest release ${latest} ${checked}`);
}

/** Line 2: what the agents run, when this process is another copy. */
export function agentsLine(running: string, facts: StagedFacts): string | null {
  if (facts.isSelf || !facts.exists) return null;
  if (facts.version === null) {
    return `agents run an unreadable binary from ${facts.path}; this copy is ${running}: wizardingcode-mem install replaces it`;
  }
  if (facts.version === running) return null;
  const plain = `agents run ${facts.version} from ${facts.path}; this copy is ${running}`;
  return olderThan(facts.version, running)
    ? `${plain}: wizardingcode-mem install moves them to it`
    : plain;
}

/** `doctor`'s line: a warning when a release is out, fine otherwise. It reads; it changes nothing. */
export function updateCheck(
  dataDir: string,
  env: Record<string, string | undefined>,
  now: number,
  running: string = pkg.version,
): { name: "update"; status: "ok" | "warn"; detail: string } {
  try {
    const report = updateReport({ dataDir, env, now, running });
    const line = (report.lines[0] as string).replace(/^update: /, "");
    return report.out
      ? {
          name: "update",
          status: "warn",
          detail: `${line}; run wizardingcode-mem update for the commands`,
        }
      : { name: "update", status: "ok", detail: line };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "update", status: "ok", detail: `not checked: ${message.split("\n")[0]}` };
  }
}

export function commandLines(): string[] {
  return CHANNEL_COMMANDS.map((entry) => `  ${entry.channel}: ${entry.command}`);
}

export interface UpdateReport {
  running: string;
  staged: string | null;
  stagedPath: string;
  latest: string | null;
  checkedAt: number | null;
  failedAt: number | null;
  reason: string | null;
  mode: Mode;
  /** Whether a release newer than what runs here is known. */
  out: boolean;
  lines: string[];
}

/** Everything `status`, `doctor` and `update` say, from the data directory alone. */
export function updateReport(input: {
  dataDir: string;
  env: Record<string, string | undefined>;
  now: number;
  running: string;
  facts?: StagedFacts;
  asked?: boolean;
}): UpdateReport {
  const facts = input.facts ?? stagedFacts(input.dataDir, input.running);
  const setting = updateSetting(input.env, input.dataDir);
  const mode = modeOf(setting.value, input.env);
  const state = readState(input.dataDir);
  const first = updateLine({
    mode,
    source: setting.source,
    asked: input.asked ?? false,
    state,
    current: facts.version ?? input.running,
    currentIsStaged: facts.version !== null,
    dataDir: input.dataDir,
    now: input.now,
  });
  const second = agentsLine(input.running, facts);
  return {
    running: input.running,
    staged: facts.version,
    stagedPath: facts.path,
    latest: state?.latest ?? null,
    checkedAt: state?.checkedAt ?? null,
    failedAt: state?.failedAt ?? null,
    reason: state?.reason ?? null,
    mode,
    out: first.out,
    lines: second === null ? [first.line] : [first.line, second],
  };
}
