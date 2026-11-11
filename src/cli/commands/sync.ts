// `wizardingcode-mem sync`: the sync client as a process (ADR 0027). `--auto` is what the hooks
// and the viewer spawn; `--once` runs one round and exits; `stop` sets the flag and waits.
import pkg from "../../../package.json" with { type: "json" };
import { openDb } from "../../store/db.ts";
import { clearSyncStop, stopSync } from "../../store/meta.ts";
import type { SyncContext } from "../../sync/context.ts";
import { EXIT_START_FAILED, runSync } from "../../sync/run.ts";
import { SYNC_SWITCH } from "../../sync/spawn.ts";
import { realClock, realTimers } from "../../util/clock.ts";
import { logError } from "../../util/log.ts";
import { defaultDataDir, resolvePaths } from "../../util/paths.ts";
import { EXIT_USAGE } from "../exit.ts";

const USAGE = `Usage: wizardingcode-mem sync --auto | --once | stop
  --auto   run until idle; what a session's hooks start (one per data directory)
  --once   the start's steps, one sweep and one pull per server, then exit
  stop     ask a running sync to leave, and wait for it (at most 30 s)
`;

const err = (line: string) => process.stderr.write(`${line}\n`);

/** How long the store's statements wait for another process's lock. */
const BUSY_TIMEOUT_MS = 5_000;

function context(): SyncContext {
  const dataDir = defaultDataDir();
  const { storeDir } = resolvePaths();
  return {
    db: openDb({ busyTimeoutMs: BUSY_TIMEOUT_MS }),
    dataDir,
    storeDir,
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    clock: realClock,
    timers: realTimers,
    pid: process.pid,
    version: pkg.version,
    log: err,
  };
}

async function stop(): Promise<number> {
  const ctx = context();
  try {
    const released = await stopSync(ctx.db, {
      who: "sync stop",
      clock: realClock,
      timers: realTimers,
    });
    clearSyncStop(ctx.db);
    if (!released) {
      err("the sync did not stop within 30 s");
      return 1;
    }
    process.stdout.write("sync stopped\n");
    return 0;
  } finally {
    ctx.db.close();
  }
}

export async function run(argv: string[]): Promise<number> {
  const [mode] = argv;
  if (mode === "stop") return stop();
  if (mode !== "--auto" && mode !== "--once") {
    process.stderr.write(USAGE);
    return EXIT_USAGE;
  }
  const once = mode === "--once";
  if (!once && process.env[SYNC_SWITCH] === "off") return 0;
  let ctx: SyncContext;
  try {
    ctx = context();
  } catch (error) {
    // The store itself cannot be opened: nowhere to write the failed-start mark.
    logError("sync.start", error);
    err(`start failed: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_START_FAILED;
  }
  try {
    return await runSync(ctx, { once, signals: true });
  } finally {
    ctx.db.close();
  }
}
