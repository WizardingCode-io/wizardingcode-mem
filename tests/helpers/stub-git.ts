import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StubBehaviour {
  /** The first call of this subcommand exits 1 with `stderr`; later ones reach the real git. */
  failOnce?: string;
  /** Every call of this subcommand exits 1 with `stderr`. */
  fail?: string;
  /** Sleeps this long before anything else. */
  sleepMs?: number;
  stderr?: string;
  /** What `--version` prints as the version. */
  version?: string;
  /** The script writes its environment here on every call. */
  dumpEnvTo?: string;
  /** The script appends its arguments here on every call: one line per call, tab-separated. */
  recordArgsTo?: string;
  /** Arguments put ahead of the caller's on every call that reaches the real git. */
  prepend?: string[];
  /** The real git writes its own trace (`GIT_TRACE`) here: what it ran, in its words. */
  traceTo?: string;
  /** Sleeps this long before this subcommand alone; the others run at once. */
  stallOn?: { subcommand: string; ms: number };
}

const REAL_GIT = Bun.which("git");

const quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * Writes an executable `git` into `dir` that forwards to the real git, except for what
 * `behaviour` asks. Returns the folder to put first on `PATH`.
 *
 * The subcommand is the first argument that does not start with `-` and is not the value
 * of `--git-dir`, `--work-tree`, `-c` or `-C`.
 */
export function stubGit(dir: string, behaviour: StubBehaviour): string {
  if (REAL_GIT === null) throw new Error("stubGit needs a real git on PATH");
  mkdirSync(dir, { recursive: true });
  const stderr = quoted(behaviour.stderr ?? "fatal: stub");
  const lines = ["#!/bin/sh"];
  if (behaviour.sleepMs !== undefined) lines.push(`sleep ${behaviour.sleepMs / 1000}`);
  if (behaviour.dumpEnvTo !== undefined) lines.push(`env > ${quoted(behaviour.dumpEnvTo)}`);
  if (behaviour.recordArgsTo !== undefined) {
    lines.push(`{ printf '%s\\t' "$@"; printf '\\n'; } >> ${quoted(behaviour.recordArgsTo)}`);
  }
  if (behaviour.version !== undefined) {
    // The caller's `-c` settings come before `--version`, so every argument is looked at.
    lines.push(
      'for arg in "$@"; do',
      `  if [ "$arg" = "--version" ]; then echo ${quoted(`git version ${behaviour.version}`)}; exit 0; fi`,
      "done",
    );
  }
  lines.push(
    'sub=""',
    "skip=0",
    'for arg in "$@"; do',
    '  if [ "$skip" = 1 ]; then skip=0; continue; fi',
    '  case "$arg" in',
    "    --git-dir|--work-tree|-c|-C) skip=1 ;;",
    "    -*) ;;",
    '    *) sub="$arg"; break ;;',
    "  esac",
    "done",
  );
  if (behaviour.stallOn !== undefined) {
    const { subcommand, ms } = behaviour.stallOn;
    lines.push(`if [ "$sub" = ${quoted(subcommand)} ]; then sleep ${ms / 1000}; fi`);
  }
  if (behaviour.fail !== undefined) {
    lines.push(`if [ "$sub" = ${quoted(behaviour.fail)} ]; then echo ${stderr} >&2; exit 1; fi`);
  }
  if (behaviour.failOnce !== undefined) {
    const marker = quoted(join(dir, ".failed-once"));
    lines.push(
      `if [ "$sub" = ${quoted(behaviour.failOnce)} ] && [ ! -e ${marker} ]; then`,
      `  : > ${marker}`,
      `  echo ${stderr} >&2`,
      "  exit 1",
      "fi",
    );
  }
  const prepended = (behaviour.prepend ?? []).map((arg) => `${quoted(arg)} `).join("");
  // The trace is the stub's to ask for: the runner's own environment is closed and never carries it.
  if (behaviour.traceTo !== undefined) lines.push(`export GIT_TRACE=${quoted(behaviour.traceTo)}`);
  lines.push(`exec ${quoted(REAL_GIT)} ${prepended}"$@"`);
  const script = join(dir, "git");
  writeFileSync(script, `${lines.join("\n")}\n`);
  chmodSync(script, 0o755);
  return dir;
}

/**
 * The calls a stub recorded with `recordArgsTo`, one argument list per call; none when the
 * file is not there yet. A record ends with a tab and a newline, since a commit message
 * spans lines inside its argument.
 */
export function recordedCalls(file: string): string[][] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\t\n")
    .filter((record) => record !== "" && record !== "\n")
    .map((record) => record.replace(/^\n/, "").split("\t"));
}

/** The commands git itself says it ran, in order, from a trace taken with `traceTo`: `commit …`, `maintenance run …`. */
export function tracedCommands(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => /trace: built-in: git (.*)$/.exec(line)?.[1])
    .filter((command): command is string => command !== undefined);
}

/**
 * The commits of a trace, when each is followed by the runner's own maintenance command and
 * the trace holds no other maintenance and nothing detached; null otherwise, and for a trace
 * with no commit.
 */
export function commitsEachMaintained(file: string): number | null {
  const commands = tracedCommands(file).filter((command) =>
    /^(commit|maintenance)\b/.test(command),
  );
  const commits = commands.filter((command) => command.startsWith("commit "));
  const paired = commands.every((command, index) =>
    index % 2 === 0 ? command.startsWith("commit ") : command === "maintenance run --auto --quiet",
  );
  const whole = commits.length > 0 && commands.length === commits.length * 2 && paired;
  return whole && !readFileSync(file, "utf8").includes("--detach") ? commits.length : null;
}

/**
 * The real git, for a test that inspects a repository itself. Never the stub. A commit made
 * through it starts no maintenance: a detached one would still be writing in a repository
 * the test goes on to remove.
 */
export function realGit(cwd: string, ...args: string[]): string {
  if (REAL_GIT === null) throw new Error("realGit needs a real git on PATH");
  const result = Bun.spawnSync([REAL_GIT, "-c", "maintenance.auto=false", ...args], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}
