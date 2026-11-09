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
