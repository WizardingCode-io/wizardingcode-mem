// What a person is told about releases and about the copy their agents run. `updateLine`
// and `agentsLine` write the two lines; `reportOrReason` writes the one said when they cannot
// be built, and the `update` command adds how to turn the check on.
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { type Source, updateSetting } from "../settings/settings.ts";
import { ago } from "../util/ago.ts";
import { olderThan } from "../util/version.ts";
import { CHANNEL_COMMANDS } from "./channels.ts";
import { type Mode, mode as modeOf } from "./mode.ts";
import { firstLine } from "./reason.ts";
import { type StagedFacts, stagedFacts } from "./staged.ts";
import { lastFailed, readState, type UpdateState } from "./state.ts";

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
  if (facts.refused) {
    return `the staged binary at ${facts.path} was not run: this command runs as root, or the folder belongs to another user`;
  }
  if (facts.version === null) {
    return `agents run an unreadable binary from ${facts.path}; this copy is ${running}: wizardingcode-mem install replaces it`;
  }
  if (facts.version === running) return null;
  const plain = `agents run ${facts.version} from ${facts.path}; this copy is ${running}`;
  return olderThan(facts.version, running)
    ? `${plain}: wizardingcode-mem install moves them to it`
    : plain;
}

/**
 * The report, or the reason it could not be built: `status` and `doctor` both say it, so a
 * notice never disappears without a word.
 */
export function reportOrReason(build: () => UpdateReport): {
  report: UpdateReport | undefined;
  lines: string[];
} {
  try {
    const report = build();
    return { report, lines: report.lines };
  } catch (error) {
    return { report: undefined, lines: [`update: not checked: ${firstLine(error)}`] };
  }
}

/** `doctor`'s line: a warning when a release is out, fine otherwise. It reads; it changes nothing. */
export function updateCheck(
  dataDir: string,
  env: Record<string, string | undefined>,
  now: number,
): { name: "update"; status: "ok" | "warn"; detail: string } {
  const { report, lines } = reportOrReason(() =>
    updateReport({ dataDir, env, now, running: pkg.version }),
  );
  const line = (lines[0] as string).replace(/^update: /, "");
  return report?.out
    ? {
        name: "update",
        status: "warn",
        detail: `${line}; run wizardingcode-mem update for the commands`,
      }
    : { name: "update", status: "ok", detail: line };
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
  /** One line per channel when a release is out; none otherwise. */
  commands: string[];
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
    commands: first.out ? commandLines() : [],
  };
}
