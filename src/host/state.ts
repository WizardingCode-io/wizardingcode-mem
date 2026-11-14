// The host tool's state (ADR 0033): `<folder>/upgrade-state/state.json`. It holds what Docker
// cannot say: what an apply was about to do, what last changed, what failed to start here.
// One release's tool writes it and the next one's reads it, and the previous one's after a
// way back. So a tool reads every format up to its own, keeps the keys it does not know, and
// never replaces a file it cannot read for certain.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isLink, replaceFile, type Writer } from "./files.ts";

export const FORMAT = 1;
export const REJECTED_KEPT = 10;
export const LOGS_KEPT = 10;
export const HISTORY_KEPT = 200;

/** What an apply is about to do and what it leaves, written before .env changes. */
export interface Intent {
  digest: string;
  id: string;
  version: string;
  fromId: string;
  fromEnvLine: string;
  fromVersion: string;
  /** The database's schema before the apply. */
  schema: number;
  project: string;
  directory: string;
  files: string[];
  volume: string;
  attended: boolean;
  at: number;
}

export interface Rejected {
  digest: string;
  version: string;
  at: number;
  reason: string;
  log?: string;
}

export interface State {
  format: number;
  intent?: Intent;
  lastChange?: {
    kind: "applied" | "rejected" | "down" | "upgrade-failed";
    from: string;
    to: string;
    at: number;
    reason?: string;
    log?: string;
  };
  lastRun?: {
    verb: string;
    outcome: string;
    exit: number;
    at: number;
    candidate?: { version: string; digest: string };
  };
  previous?: { id: string; version: string; envLine: string };
  rejected?: Rejected[];
  [unknown: string]: unknown;
}

/** A state file this tool will not read, and so will not replace. */
export class StateRefused extends Error {
  readonly path: string;
  constructor(path: string, why: string) {
    super(`${path} ${why}; it was left as it is`);
    this.name = "StateRefused";
    this.path = path;
  }
}

export const stateDir = (folder: string): string => join(folder, "upgrade-state");
const stateFile = (folder: string): string => join(stateDir(folder), "state.json");

const SHA = /^sha256:[0-9a-f]{64}$/;
/** A name Docker takes as a name: never empty, never read as an option. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/**
 * An intent whose every field has the form the tool wrote it in. The tool passes its ids, its
 * volume, its project and its files to Docker, so one it did not write is refused, not run.
 */
function isIntent(value: unknown): value is Intent {
  if (typeof value !== "object" || value === null) return false;
  const i = value as Record<string, unknown>;
  const text = (key: string) => typeof i[key] === "string";
  return (
    SHA.test(String(i.digest)) &&
    SHA.test(String(i.id)) &&
    SHA.test(String(i.fromId)) &&
    /^\d+\.\d+\.\d+$/.test(String(i.version)) &&
    text("fromVersion") &&
    text("fromEnvLine") &&
    Number.isInteger(i.schema) &&
    NAME.test(String(i.project)) &&
    NAME.test(String(i.volume)) &&
    typeof i.directory === "string" &&
    i.directory.startsWith("/") &&
    Array.isArray(i.files) &&
    i.files.every((file) => typeof file === "string" && file.startsWith("/")) &&
    typeof i.attended === "boolean" &&
    typeof i.at === "number"
  );
}

/** The state of `folder`: empty with no file; a `StateRefused` for one it cannot read for certain. */
export function readState(folder: string): State {
  const path = stateFile(folder);
  if (isLink(path)) throw new StateRefused(path, "is a symbolic link");
  if (!existsSync(path)) return { format: FORMAT };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new StateRefused(path, "does not parse");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new StateRefused(path, "is not an object");
  const format = (parsed as { format?: unknown }).format;
  if (typeof format !== "number" || !Number.isInteger(format) || format < 1)
    throw new StateRefused(path, "has no format");
  if (format > FORMAT)
    throw new StateRefused(path, `is of format ${format}, which a newer tool wrote`);
  const intent = (parsed as { intent?: unknown }).intent;
  if (intent !== undefined && !isIntent(intent))
    throw new StateRefused(path, "holds an intent this tool cannot read for certain");
  return parsed as State;
}

/** Replaces the state file by `state`, every key of it, at mode 0600. */
export function writeState(writer: Writer, folder: string, state: State): void {
  replaceFile(writer, stateFile(folder), `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

/** Puts `entry` last on the rejected list, once, and keeps the newest ten. */
export function pushRejected(state: State, entry: Rejected): void {
  const others = (state.rejected ?? []).filter((r) => r.digest !== entry.digest);
  state.rejected = [...others, entry].slice(-REJECTED_KEPT);
}

/** One line of the history: the time, the verb, the outcome, the exit, and the two versions. */
export function historyLine(
  at: number,
  verb: string,
  outcome: string,
  exit: number,
  versions: { from: string; to: string },
): string {
  const time = new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");
  return [time, verb, outcome, exit, versions.from, versions.to].join("\t");
}

/** Adds one line to `history.log` and keeps the newest 200. */
export function appendHistory(writer: Writer, folder: string, line: string): void {
  const path = join(stateDir(folder), "history.log");
  const before =
    existsSync(path) && !isLink(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
  replaceFile(writer, path, `${[...before, line].slice(-HISTORY_KEPT).join("\n")}\n`, 0o600);
}

/** Removes all but the ten newest files of `logs/`; their names begin with their time. */
export function pruneLogs(folder: string): void {
  const logs = join(stateDir(folder), "logs");
  if (!existsSync(logs)) return;
  const names = readdirSync(logs)
    .filter((name) => name.endsWith(".log"))
    .sort();
  for (const name of names.slice(0, Math.max(0, names.length - LOGS_KEPT)))
    rmSync(join(logs, name), { force: true });
}
