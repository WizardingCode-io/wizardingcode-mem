// Runs one index pass against the given directories, then exits.
import { join } from "node:path";
import { openHistoryDb } from "../../src/history/db.ts";
import { indexAll } from "../../src/history/index-pass.ts";
import { openDb } from "../../src/store/db.ts";

const [store, claude, codex] = process.argv.slice(2);
if (store === undefined || claude === undefined || codex === undefined)
  throw new Error("usage: history-index-worker <store> <claude-root> <codex-root>");
const main = openDb({ dataDir: join(store, "main"), busyTimeoutMs: 5000 });
const hdb = openHistoryDb(store, { create: true, busyTimeoutMs: 5000 });
if (hdb === null) throw new Error("no history db");
indexAll(
  hdb,
  main,
  { claudeCode: claude, codex },
  { now: Date.now(), maxMs: 60_000, agents: ["claude-code", "codex"] },
);
hdb.close();
main.close();
