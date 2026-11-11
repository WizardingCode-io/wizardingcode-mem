// The questions a command asks a person on the terminal: yes or no, and a secret typed
// with no echo (an invitation code).
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

// --- A secret ------------------------------------------------------------------------------

/** Where a secret is typed: a terminal in raw mode, so nothing is echoed. */
export interface SecretIo {
  isTTY: boolean;
  /** One line, typed with no echo; null at the end of input, on Ctrl-C and when nothing can be read. */
  readLine: () => string | null;
}

const SECRET_MAX = 256;

/** This process's terminal in raw mode for one line: Enter ends it, Backspace edits it, Ctrl-C and Ctrl-D give null. */
export const terminalSecretIo: SecretIo = {
  get isTTY() {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
  },
  readLine() {
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (raw: boolean) => void };
    const raw = stdin.isRaw === true;
    stdin.setRawMode?.(true);
    try {
      let line = "";
      const one = Buffer.alloc(1);
      for (;;) {
        let read = 0;
        try {
          read = readSync(0, one, 0, 1, null);
        } catch {
          return null;
        }
        if (read === 0) return null;
        const byte = one[0] as number;
        if (byte === 3 || byte === 4) return null;
        if (byte === 13 || byte === 10) return line;
        if (byte === 127 || byte === 8) {
          line = line.slice(0, -1);
          continue;
        }
        if (byte >= 32 && line.length < SECRET_MAX) line += String.fromCharCode(byte);
      }
    } finally {
      stdin.setRawMode?.(raw);
    }
  },
};

/**
 * Asks for a secret on the terminal, never echoed. Without a terminal the answer is null and
 * nothing is printed: a script gives the secret as an argument instead. An empty line is null.
 */
export function askSecret(question: string, io: SecretIo = terminalSecretIo): string | null {
  if (!io.isTTY) return null;
  process.stdout.write(`${question} `);
  const line = io.readLine();
  process.stdout.write("\n");
  if (line === null) return null;
  const trimmed = line.trim();
  return trimmed === "" ? null : trimmed;
}
