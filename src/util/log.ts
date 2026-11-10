import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../core/redact.ts";
import { defaultDataDir } from "./paths.ts";
import { clip } from "./text.ts";

export const LOG_MAX_BYTES = 1024 * 1024;
const MESSAGE_MAX_CHARS = 300;

/** The error's class, with its code when it has one: `SQLiteError(SQLITE_BUSY)`. */
export function errorLabel(error: unknown): string {
  if (!(error instanceof Error)) return "Error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code !== "" ? `${error.name}(${code})` : error.name;
}

/** One error as the sink receives it: what the log line would have carried, already redacted and clipped. */
export type LogSink = (entry: { at: string; scope: string; name: string; message: string }) => void;

let sink: LogSink | null = null;

/**
 * Where `logError` writes when a process has somewhere better than the file: the team
 * server sends every error as a JSON line on its own output. Null restores the file.
 */
export function setLogSink(next: LogSink | null): void {
  sink = next;
}

/**
 * Appends one line to the local error log, or hands it to the sink when one is set.
 * Errors only, never payloads; one previous generation of the file is kept. Logging never
 * fails its caller.
 */
export function logError(scope: string, error: unknown, dataDir: string = defaultDataDir()): void {
  try {
    const name = errorLabel(error);
    const message = error instanceof Error ? error.message : String(error);
    const line = clip(redact(message.replace(/\s+/g, " ")), MESSAGE_MAX_CHARS, "…");
    const at = new Date().toISOString();
    if (sink !== null) {
      sink({ at, scope, name, message: line });
      return;
    }
    const dir = join(dataDir, "logs");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, "wizardingcode-mem.log");
    if (existsSync(file) && statSync(file).size > LOG_MAX_BYTES) renameSync(file, `${file}.1`);
    appendFileSync(file, `${at} ${scope} ${name}: ${line}\n`, { mode: 0o600 });
  } catch {
    // Nowhere to write: there is nothing useful left to do.
  }
}
