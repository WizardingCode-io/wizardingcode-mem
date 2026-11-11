// The sync logs errors only: one line per distinct message per server and operation, under
// `sync.<serverId>.<operation>`, never a token, a code or a payload (the line goes through
// `describeError`, which redacts and clips). A repeat is counted in memory until the message
// changes; the next line says how many the previous one stood for.
import { describeError, logError as logToFile } from "../util/log.ts";
import type { SyncContext } from "./context.ts";

interface Last {
  message: string;
  count: number;
}

const last = new Map<string, Last>();

export function logError(
  ctx: SyncContext,
  serverId: string,
  operation: string,
  error: unknown,
): void {
  const scope = `sync.${serverId}.${operation}`;
  const { name, message } = describeError(error);
  const previous = last.get(scope);
  if (previous !== undefined && previous.message === message) {
    previous.count++;
    return;
  }
  const suffix =
    previous !== undefined && previous.count > 1
      ? ` (after ${previous.count} of the previous)`
      : "";
  last.set(scope, { message, count: 1 });
  ctx.log(`${scope} ${name}: ${message}${suffix}`);
  const carried = suffix === "" ? error : Object.assign(new Error(`${message}${suffix}`), { name });
  logToFile(scope, carried, ctx.dataDir);
}

/** How many times the last message of a scope was seen; for the tests. */
export function logCount(serverId: string, operation: string): number {
  return last.get(`sync.${serverId}.${operation}`)?.count ?? 0;
}

/** Forgets every count: a test's clean slate. */
export function resetLog(): void {
  last.clear();
}
