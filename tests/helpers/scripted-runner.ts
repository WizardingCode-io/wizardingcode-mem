import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Runner, RunResult } from "../../scripts/release/lib.ts";

export type Answer = Partial<RunResult> & { write?: { file: string; text: string } };

/**
 * A runner that starts no program. It joins the command with spaces, records it, and answers
 * with the first pattern that matches: code 0 and empty output unless the answer says
 * otherwise, code 127 when nothing matches. An answer with `write` first writes `text` to
 * `<the argument after -D>/<file>`, as a download would. An answer given as a function is
 * asked at each call, for a program that answers differently the second time.
 */
export function scripted(answers: Array<[pattern: RegExp, answer: Answer | (() => Answer)]>): {
  run: Runner;
  calls: string[];
} {
  const calls: string[] = [];
  const run: Runner = (cmd) => {
    const line = cmd.join(" ");
    calls.push(line);
    const found = answers.find(([pattern]) => pattern.test(line));
    if (found === undefined) return { code: 127, stdout: "", stderr: `unscripted: ${line}` };
    const answer = typeof found[1] === "function" ? found[1]() : found[1];
    if (answer.write !== undefined) {
      const dir = cmd[cmd.indexOf("-D") + 1] ?? "";
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, answer.write.file), answer.write.text);
    }
    return { code: answer.code ?? 0, stdout: answer.stdout ?? "", stderr: answer.stderr ?? "" };
  };
  return { run, calls };
}
