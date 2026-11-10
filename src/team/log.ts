// The team server's log: JSON lines, one per request or event, never a token, a code (after
// the bootstrap line) or a payload. Every `logError` of the process goes through it too.
import { redact } from "../core/redact.ts";
import { errorLabel, type LogSink, setLogSink } from "../util/log.ts";
import { clip } from "../util/text.ts";

const MESSAGE_MAX_CHARS = 300;

export interface RequestLine {
  requestId: string;
  deviceId?: string;
  memberId?: string;
  route: string;
  status: number;
  ms: number;
  address?: string;
  held?: number;
  pull?: { since: number; next: number; projects: number; items: number; snapshot: boolean };
  push?: {
    applied: number;
    stale: number;
    refused: number;
    withdrawn: number;
    refusals: { uid: string; reason: string; rule?: string }[];
  };
}

export interface TeamLog {
  /** One line with the fields given; `event` names it, `level` is `info` unless given. */
  line(fields: Record<string, unknown>): void;
  request(fields: RequestLine): void;
  error(scope: string, error: unknown, requestId?: string): void;
}

/** Writes each line to `sink` (standard output for the server, standard error for a subcommand). */
export function createTeamLog(sink: (line: string) => void, now: () => number): TeamLog {
  const write = (fields: Record<string, unknown>) => {
    const { level, ...rest } = fields;
    sink(JSON.stringify({ at: new Date(now()).toISOString(), level: level ?? "info", ...rest }));
  };
  return {
    line: write,
    request: (fields) => write({ event: "request", ...fields }),
    error: (scope, error, requestId) => {
      const message = error instanceof Error ? error.message : String(error);
      write({
        level: "error",
        event: "error",
        scope,
        name: errorLabel(error),
        message: clip(redact(message.replace(/\s+/g, " ")), MESSAGE_MAX_CHARS, "…"),
        ...(requestId === undefined ? {} : { requestId }),
      });
    },
  };
}

/** Routes every `logError` of the process into the log; the returned function restores the file. */
export function installLogSink(log: TeamLog): () => void {
  const sink: LogSink = (entry) =>
    log.line({
      level: "error",
      event: "error",
      scope: entry.scope,
      name: entry.name,
      message: entry.message,
    });
  setLogSink(sink);
  return () => setLogSink(null);
}
