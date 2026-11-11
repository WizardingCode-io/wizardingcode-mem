// What `status`, `doctor` and the viewer read of the sync (ADR 0027): the process's state and
// one entry per server with the ledger's counts, through `state.ts` and `ledger.ts`; none of
// those readers runs SQL of its own over the sharing tables.
import type { Db } from "../store/db.ts";
import { dirtyKey, getMeta } from "../store/meta.ts";
import { openConflictCount, pendingRowCount } from "./ledger.ts";
import { hasServerTables } from "./servers.ts";
import { type ServerStatus, type SyncState, statusReport, syncState } from "./state.ts";

export interface SyncReport {
  state: SyncState;
  servers: ServerStatus[];
}

/**
 * The sync as it stands: null on a store without the sharing v2 tables, so a reader prints no
 * line and raises no warning of it there. Never a token.
 */
export function syncReport(db: Db, dataDir: string, now: number): SyncReport | null {
  if (!hasServerTables(db)) return null;
  const servers = statusReport(db, dataDir, (conn, serverId) => ({
    dirtyPaths: Number(getMeta(conn, dirtyKey(serverId)) ?? 0),
    pendingRows: pendingRowCount(conn, serverId),
    openConflicts: openConflictCount(conn, serverId),
  }));
  return { state: syncState(db, now), servers };
}
