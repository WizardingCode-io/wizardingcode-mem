// The host tool's runner (ADR 0033): every program it starts has a time bound, and every
// Docker child an environment that cannot point Docker or Compose at another project.

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The bound was exceeded and the program killed. */
  timedOut: boolean;
}

export type Run = (
  cmd: string[],
  options: { env?: Record<string, string | undefined>; timeoutMs: number },
) => RunResult;

/** Each of these in the environment makes Docker or Compose address something else than the folder's project. */
export const SCRUBBED = [
  "WIZARDINGCODE_MEM_VERSION",
  "COMPOSE_FILE",
  "COMPOSE_PROJECT_NAME",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
] as const;

/** `env` without the variables of `SCRUBBED`. */
export function dockerEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const kept = { ...env };
  for (const name of SCRUBBED) delete kept[name];
  return kept;
}

/** Runs a program under its bound: 124 with `timedOut` when it was killed, 127 when it cannot start. */
export const realRun: Run = (cmd, options) => {
  try {
    const out = Bun.spawnSync(cmd, {
      ...(options.env === undefined ? {} : { env: options.env }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeoutMs,
    });
    const timedOut = out.exitedDueToTimeout === true;
    return {
      code: timedOut ? 124 : (out.exitCode ?? 1),
      stdout: out.stdout.toString(),
      stderr: out.stderr.toString(),
      timedOut,
    };
  } catch (error) {
    return { code: 127, stdout: "", stderr: String(error), timedOut: false };
  }
};

// Text a program or a registry gave, on its way to a terminal, the journal or the state. The
// rule `shown` has in src/team/restore.ts and `clean` in scripts/release/lib.ts, copied on
// purpose (src/host/ imports nothing of either); tests/unit/host-shown.test.ts holds the three equal.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it finds
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu;

/** `text` with every control and format character replaced by `?`, then truncated at `max` characters. */
export function shownText(text: string, max = 500): string {
  return text.replace(UNPRINTABLE, "?").slice(0, max);
}
