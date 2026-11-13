// What the viewer says of releases (ADR 0030): the report `status` prints, in the page's
// shape, and the release whose banner was dismissed. It reads what the daily check kept in
// `update.json`; it never asks the network, and it loads no code that does.
import pkg from "../../package.json" with { type: "json" };
import { updateSetting } from "../settings/settings.ts";
import type { Db } from "../store/db.ts";
import { getMeta, setMeta } from "../store/meta.ts";
import { CHANNEL_COMMANDS } from "../update/channels.ts";
import type { Mode } from "../update/mode.ts";
import { firstLine } from "../update/reason.ts";
import { type UpdateReport, updateReport } from "../update/report.ts";
import { lastFailed, readState } from "../update/state.ts";

/** The `meta` key of the release whose banner the person dismissed. */
export const UPDATE_DISMISSED = "update.dismissed";

export interface ViewerUpdate {
  running: string;
  staged: string | null;
  latest: string | null;
  checkedAt: number | null;
  failedAt: number | null;
  reason: string | null;
  mode: Mode;
  /** Whether a release newer than what runs here is known. */
  out: boolean;
  /** Whether the last check failed, a release still known or not. */
  failed: boolean;
  /** False when the report itself could not be built: `line` then says why. */
  built: boolean;
  /** The report's first line, without its label. */
  line: string;
  /** What the agents run, when it is another copy than this one. */
  agents: string | null;
  /** One per channel while a release is out; none otherwise. */
  commands: { channel: string; command: string; shell: boolean }[];
  /** Whether the setting comes from the environment, where the page cannot change it. */
  fromEnvironment: boolean;
  /** Whether the banner shows: a release is out, and it is not the one dismissed. */
  banner: boolean;
}

export interface ViewerUpdateInput {
  db: Db;
  dataDir: string;
  env: Record<string, string | undefined>;
  now: number;
  /** The report's builder; `updateReport` unless a test gives its own. */
  build?: () => UpdateReport;
}

/**
 * The answer of `GET /api/update`. A report that cannot be built is said in the same shape,
 * so the card never goes missing: `line` says why, and nothing is out.
 */
export function viewerUpdate(input: ViewerUpdateInput): ViewerUpdate {
  const { db, dataDir, env, now } = input;
  const build = input.build ?? (() => updateReport({ dataDir, env, now, running: pkg.version }));
  let report: UpdateReport;
  try {
    report = build();
  } catch (error) {
    return {
      running: pkg.version,
      staged: null,
      latest: null,
      checkedAt: null,
      failedAt: null,
      reason: null,
      mode: "check",
      out: false,
      failed: false,
      built: false,
      line: `not checked: ${firstLine(error)}`,
      agents: null,
      commands: [],
      fromEnvironment: false,
      banner: false,
    };
  }
  const [first = "", second] = report.lines;
  return {
    running: report.running,
    staged: report.staged,
    latest: report.latest,
    checkedAt: report.checkedAt,
    failedAt: report.failedAt,
    reason: report.reason,
    mode: report.mode,
    out: report.out,
    failed: lastFailed({
      latest: report.latest,
      checkedAt: report.checkedAt,
      attemptAt: null,
      failedAt: report.failedAt,
      reason: report.reason,
    }),
    built: true,
    line: first.replace(/^update: /, ""),
    agents: second ?? null,
    commands: report.out
      ? CHANNEL_COMMANDS.map(({ channel, command, shell }) => ({ channel, command, shell }))
      : [],
    fromEnvironment: updateSetting(env, dataDir).source === "env",
    banner: report.out && report.latest !== null && getMeta(db, UPDATE_DISMISSED) !== report.latest,
  };
}

/**
 * Keeps the latest release `update.json` names as dismissed, and says which; null, and
 * nothing kept, when none is known. Nothing of the request is read.
 */
export function dismissUpdate(db: Db, dataDir: string): string | null {
  const latest = readState(dataDir)?.latest ?? null;
  if (latest !== null) setMeta(db, UPDATE_DISMISSED, latest);
  return latest;
}
