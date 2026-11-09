import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
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
  lines.push(`exec ${quoted(REAL_GIT)} "$@"`);
  const script = join(dir, "git");
  writeFileSync(script, `${lines.join("\n")}\n`);
  chmodSync(script, 0o755);
  return dir;
}

/** The real git, for a test that inspects a repository itself. Never the stub. */
export function realGit(cwd: string, ...args: string[]): string {
  if (REAL_GIT === null) throw new Error("realGit needs a real git on PATH");
  const result = Bun.spawnSync([REAL_GIT, ...args], {
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
