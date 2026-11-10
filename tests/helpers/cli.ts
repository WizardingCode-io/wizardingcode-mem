const MAIN = new URL("../../src/cli/main.ts", import.meta.url).pathname;

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCli(...args: string[]): Promise<CliResult> {
  return runCliWithInput(undefined, ...args);
}

export function runCliWithInput(input: string | undefined, ...args: string[]): Promise<CliResult> {
  return runCliWith({ ...(input === undefined ? {} : { input }) }, ...args);
}

export interface SpawnedCli {
  proc: ReturnType<typeof Bun.spawn>;
  /** The lines of standard output as they arrive. */
  stdout: AsyncIterable<string>;
  stderr: AsyncIterable<string>;
  exited: Promise<number>;
  kill(signal: NodeJS.Signals): void;
}

/** A readable stream as lines, as they arrive; the last partial line is given at the end. */
async function* linesOf(
  stream: ReadableStream<Uint8Array> | number | undefined,
): AsyncIterable<string> {
  if (!(stream instanceof ReadableStream)) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    let newline = rest.indexOf("\n");
    while (newline !== -1) {
      yield rest.slice(0, newline);
      rest = rest.slice(newline + 1);
      newline = rest.indexOf("\n");
    }
  }
  if (rest !== "") yield rest;
}

/**
 * Starts the CLI as a child whose environment is `options.env` whole, nothing inherited, and
 * gives its output line by line: for a long-running command such as `serve`.
 */
export function spawnCli(
  options: { env: Record<string, string>; cwd?: string },
  ...args: string[]
): SpawnedCli {
  const proc = Bun.spawn([process.execPath, MAIN, ...args], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    proc,
    stdout: linesOf(proc.stdout),
    stderr: linesOf(proc.stderr),
    exited: proc.exited,
    kill: (signal) => proc.kill(signal),
  };
}

export async function runCliWith(
  options: { input?: string; env?: Record<string, string>; cwd?: string },
  ...args: string[]
): Promise<CliResult> {
  const proc = Bun.spawn([process.execPath, MAIN, ...args], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: { ...process.env, ...options.env },
    stdin: options.input === undefined ? "ignore" : new TextEncoder().encode(options.input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}
