// How the host's tool replaces a file, and the one line of .env it owns (ADR 0033). A file
// is replaced whole: a temporary file beside it, synced, renamed over it, the directory
// synced, so a power cut leaves the old file or the new one and never half of either. The
// steps go through a writer a test can watch; src/util/atomic-write.ts does not sync.
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { DIGEST } from "./signature.ts";

export interface Writer {
  write(path: string, text: string, mode: number): void;
  sync(path: string): void;
  rename(from: string, to: string): void;
  syncDir(dir: string): void;
}

function fsync(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export const realWriter: Writer = {
  write(path, text, mode) {
    const fd = openSync(path, "w", mode);
    try {
      writeSync(fd, text);
    } finally {
      closeSync(fd);
    }
  },
  sync: fsync,
  rename: renameSync,
  syncDir: fsync,
};

/** Replaces `path` by `text` at `mode`, through a temporary file in the same directory. */
export function replaceFile(writer: Writer, path: string, text: string, mode: number): void {
  const dir = dirname(path);
  const temporary = join(dir, `.${basename(path)}.${process.pid}.tmp`);
  writer.write(temporary, text, mode);
  writer.sync(temporary);
  writer.rename(temporary, path);
  writer.syncDir(dir);
}

/** True when something is at `path` and it is a symbolic link. */
export function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The permission bits of the file at `path`. */
export const modeOf = (path: string): number => statSync(path).mode & 0o777;

const KEY = "WIZARDINGCODE_MEM_VERSION";
const LINE = new RegExp(`^${KEY}=(.*)$`);
const VALUE = /^(\d+\.\d+\.\d+)(?:@(sha256:[0-9a-f]{64}))?$/;

export interface EnvLine {
  /** What the line names, without quotes. */
  value: string;
  version: string;
  digest: string | null;
}

/** The lines of `text` with their endings kept apart, so a rewrite keeps every other byte. */
function linesOf(text: string): Array<{ body: string; ending: string }> {
  return [...text.matchAll(/([^\r\n]*)(\r\n|\n|$)/g)]
    .map((match) => ({ body: match[1] ?? "", ending: match[2] ?? "" }))
    .filter(
      (line, index, all) => !(index === all.length - 1 && line.body === "" && line.ending === ""),
    );
}

/**
 * The one `WIZARDINGCODE_MEM_VERSION=` line of a .env: a plain version, or a version with an
 * image digest, quoted or not. Null when there is none, more than one, or anything else in it.
 */
export function readEnvLine(text: string): EnvLine | null {
  const found = linesOf(text)
    .map((line) => LINE.exec(line.body)?.[1])
    .filter((value): value is string => value !== undefined);
  if (found.length !== 1) return null;
  const raw = (found[0] as string).trim();
  const unquoted = /^"(.*)"$/.exec(raw)?.[1] ?? /^'(.*)'$/.exec(raw)?.[1] ?? raw;
  const match = VALUE.exec(unquoted);
  if (match === null) return null;
  const digest = match[2] ?? null;
  if (digest !== null && !DIGEST.test(digest)) return null;
  return { value: unquoted, version: match[1] as string, digest };
}

/** `text` with that one line naming `value`, and every other byte as it was. */
export function withEnvLine(text: string, value: string): string {
  return linesOf(text)
    .map((line) => (LINE.test(line.body) ? `${KEY}=${value}` : line.body) + line.ending)
    .join("");
}
