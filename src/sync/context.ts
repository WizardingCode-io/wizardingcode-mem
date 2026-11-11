// What every function of the sync client takes: the store, the directories, the environment,
// the network, time, and the process's identity. A test gives its own of each.
import type { Env } from "../settings/settings.ts";
import type { Db } from "../store/db.ts";
import type { Clock, Timers } from "../util/clock.ts";

/** The network as the client sees it: one call, one answer; a test gives its own. */
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface SyncContext {
  db: Db;
  /** The data directory: the token file and the env file (ADR 0010). */
  dataDir: string;
  /** Where the database lives; the same as `dataDir` unless the store was moved. */
  storeDir: string;
  env: Env;
  fetch: Fetch;
  clock: Clock;
  timers: Timers;
  pid: number;
  /** The binary's version, the one `package.json` gives the CLI: part of the lease's owner. */
  version: string;
  /** One line to the log (standard error in the process). */
  log: (line: string) => void;
  /**
   * The sync lease's owner once `runSync` holds it. While set, every write through `state.ts`
   * and `ledger.ts` first checks the lease is still this one and throws `LeaseLost` otherwise
   * (the spec's rule 3); a command that holds no lease leaves it unset.
   */
  lease?: string;
}

/** The owner a process writes into the sync lease: `sync-<pid>-<version>`. */
export const leaseOwnerOf = (ctx: Pick<SyncContext, "pid" | "version">): string =>
  `sync-${ctx.pid}-${ctx.version}`;
