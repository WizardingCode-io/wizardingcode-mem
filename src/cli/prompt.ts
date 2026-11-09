// The one question a command asks a person: yes or no, on the terminal.
import { readSync } from "node:fs";

/** Where a question is asked and its answer read. */
export interface PromptIo {
  /** Whether a person is there to be asked. */
  isTTY: boolean;
  /** The line typed; null at the end of input, and when nothing can be read. */
  read: () => string | null;
}

const ANSWER_BYTES = 64;
/** Yes, in English and in Portuguese. */
const YES = new Set(["y", "yes", "s", "sim"]);

/** This process's terminal: a person is there when both its input and its output are one. */
export const terminalIo: PromptIo = {
  get isTTY() {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
  },
  read() {
    const buffer = Buffer.alloc(ANSWER_BYTES);
    try {
      const read = readSync(0, buffer, 0, buffer.length, null);
      return read === 0 ? null : buffer.toString("utf8", 0, read);
    } catch {
      return null;
    }
  },
};

/**
 * Asks a yes or no question. Without a terminal the answer is no and nothing is printed:
 * nothing is done unasked. Enter alone gives the default, which the question shows in
 * capitals; the end of input, with nothing typed, is no whatever the default; any answer
 * that is not a yes is no.
 */
export function askYesNo(
  question: string,
  defaultYes: boolean,
  io: PromptIo = terminalIo,
): boolean {
  if (!io.isTTY) return false;
  process.stdout.write(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `);
  const line = io.read();
  if (line === null) return false;
  const answer = line.trim().toLowerCase();
  return answer === "" ? defaultYes : YES.has(answer);
}
