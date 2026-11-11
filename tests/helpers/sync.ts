// The sync client in a test: a data directory with its store, a context with a clock and
// timers the test drives and a `fetch` the test gives (the in-process team server, or a stub).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULE_SCHEMAS } from "../../src/engine/module-schemas.ts";
import type { Env } from "../../src/settings/settings.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import type { ModuleSchema } from "../../src/store/migration.ts";
import type { Fetch, SyncContext } from "../../src/sync/context.ts";
import { CLOCK_START, type Clock, fakeClock, fakeTimers, type Timers } from "./clock.ts";

export { spawnCli } from "./cli.ts";
export { CLOCK_START, type Clock, fakeClock, fakeTimers, type Timers };

export interface SyncTestStore {
  dataDir: string;
  storeDir: string;
  db: Db;
  clock: Clock;
  timers: Timers & { pending(): number };
  /** The lines the context logged. */
  lines: string[];
  ctx: SyncContext;
  close(): void;
}

const dirs: string[] = [];

/** A `fetch` for a client with nothing to reach: every call fails as the network would. */
export const noFetch: Fetch = () => Promise.reject(new TypeError("fetch failed: no server"));

export interface SyncStoreOptions {
  fetch?: Fetch;
  clock?: Clock;
  timers?: Timers & { pending(): number };
  env?: Env;
  /** The schemas to open the store with: the current ones unless a test wants an older store. */
  moduleSchemas?: readonly ModuleSchema[];
  version?: string;
  pid?: number;
}

/** A fresh data directory, its store open, and a context over them. */
export function openSyncStore(options: SyncStoreOptions = {}): SyncTestStore {
  const dataDir = mkdtempSync(join(tmpdir(), "wcm-sync-"));
  dirs.push(dataDir);
  const env: Env = {
    WIZARDINGCODE_HOME: dataDir,
    WIZARDINGCODE_MEM_DISTILL: "off",
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
    WIZARDINGCODE_MEM_MIGRATE: "off",
    WIZARDINGCODE_MEM_UI_BROWSER: "none",
    ...options.env,
  };
  const db = openDb({
    dataDir,
    busyTimeoutMs: 2000,
    moduleSchemas: options.moduleSchemas ?? MODULE_SCHEMAS,
  });
  const clock = options.clock ?? fakeClock(CLOCK_START);
  const timers = options.timers ?? fakeTimers(clock);
  const lines: string[] = [];
  const ctx: SyncContext = {
    db,
    dataDir,
    storeDir: dataDir,
    env,
    fetch: options.fetch ?? noFetch,
    clock,
    timers,
    pid: options.pid ?? process.pid,
    version: options.version ?? "0.8.0",
    log: (line) => lines.push(line),
  };
  return {
    dataDir,
    storeDir: dataDir,
    db,
    clock,
    timers,
    lines,
    ctx,
    close: () => {
      try {
        db.close();
      } catch {
        // Already closed by the test.
      }
    },
  };
}

/** Removes every data directory the tests made; call it in `afterAll`. */
export function cleanSyncDirs(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** A fake row of a joined server, as the join would write it; `confirmedAt` null is pending. */
export function serverFixture(serverId: string, overrides: Record<string, unknown> = {}) {
  return {
    serverId,
    url: `https://${serverId}.example.com`,
    name: `Team ${serverId}`,
    deviceId: `dev-${serverId}`,
    deviceAlias: `laptop-${serverId}`,
    memberId: "mem-1",
    memberName: "Ana",
    role: "member",
    contract: 1,
    instance: `inst-${serverId}`,
    addedAt: CLOCK_START,
    ...overrides,
  };
}

/** Lets every promise a fake timer woke run: a few turns of the real event loop. */
export async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
