import type { Run, RunResult } from "../../src/host/run.ts";

/** One program the host's tool started: its command, the environment it was given, its time bound. */
export interface HostCall {
  line: string;
  cmd: string[];
  env: Record<string, string | undefined> | undefined;
  timeoutMs: number;
}

/**
 * A runner that starts no program. It records each call and asks `answer` what the program
 * said: code 0 and empty output unless the answer says otherwise, code 127 when it gives none.
 */
export function hostRunner(answer: (call: HostCall) => Partial<RunResult> | undefined): {
  run: Run;
  calls: HostCall[];
} {
  const calls: HostCall[] = [];
  const run: Run = (cmd, options) => {
    const call: HostCall = {
      line: cmd.join(" "),
      cmd,
      env: options.env,
      timeoutMs: options.timeoutMs,
    };
    calls.push(call);
    const given = answer(call);
    if (given === undefined)
      return { code: 127, stdout: "", stderr: `unscripted: ${call.line}`, timedOut: false };
    return {
      code: given.code ?? 0,
      stdout: given.stdout ?? "",
      stderr: given.stderr ?? "",
      timedOut: given.timedOut ?? false,
    };
  };
  return { run, calls };
}
