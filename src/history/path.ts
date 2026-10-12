import { join } from "node:path";

// Kept free of SQLite so the hooks can ask whether the index exists without loading it.
export const HISTORY_DB_FILE = "history.db";

export function historyDbPath(storeDir: string): string {
  return join(storeDir, HISTORY_DB_FILE);
}
