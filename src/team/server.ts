// `wizardingcode-mem serve`: one process per data directory, over its own database, answering
// the sync API; one lease, one change signal, one set of buckets, injected clock and timers.

import { type Db, openTeamDb, teamPaths } from "./db.ts";
import { freeBytes as diskFreeBytes } from "./disk.ts";
import { isLoopback } from "./ids.ts";
import { checkRestore, currentMarks, writeHighWater } from "./instance.ts";
import { holdLease, SERVE_LEASE, SERVE_RENEW_MS, SERVE_TTL_MS } from "./lease.ts";
import { Bucket, type Buckets } from "./limits.ts";
import { createTeamLog, installLogSink } from "./log.ts";
import { BOOTSTRAP_VALID_HOURS, bootstrapIfEmpty } from "./members.ts";
import { type Context, handle, type Limits } from "./routes.ts";
import { ChangeSignal, REAL_TIMERS, type Timers } from "./signal.ts";
import { getMeta } from "./store.ts";

export type { Timers };

export const LIMITS: Limits = {
  bodyBytes: 1_048_576,
  itemsPerPush: 200,
  itemBytes: 262_144,
  pullItems: 500,
  pullBytes: 2_097_152,
  pullWaitSeconds: 25,
  requestsPerMinute: 600,
  payloadBytesPerHour: 67_108_864,
  joinsPerMinute: 10,
  minFreeBytes: 209_715_200,
  minFreeBytesHealth: 104_857_600,
};

const IDLE_TIMEOUT_S = 120;
/** Above the published cap, so the handler's own 413 (with a request id) answers first. */
const MAX_REQUEST_BODY = 2_097_152;
const HOUR_MS = 3_600_000;

export interface ServerOptions {
  dataDir: string;
  host: string;
  port: number;
  trustProxy: boolean;
  now?: () => number;
  timers?: Timers;
  onBootstrap?: (code: string) => void;
  env?: Record<string, string | undefined>;
  freeBytes?: (path: string) => number | null;
  stdout?: (line: string) => void;
  gitPath?: string;
  mirrorChild?: (dataDir: string) => Promise<void>;
}

export interface TeamServer {
  origin: string;
  port: number;
  serverId: string;
  instance: () => string;
  stop(): Promise<void>;
  /** Resolves when the server has stopped, by `stop()` or on its own (a lost lease). */
  stopped(): Promise<void>;
  /** 0 after a stop asked for, 1 after a lost lease; null while running. */
  exitCode(): number | null;
  options: { idleTimeout: number; maxRequestBodySize: number };
  db: Db;
  signalFired(): number;
  /** The rate buckets, for a test that drains one. */
  buckets: Buckets;
}

export async function startTeamServer(options: ServerOptions): Promise<TeamServer> {
  const now = options.now ?? Date.now;
  const timers = options.timers ?? REAL_TIMERS;
  const sink = options.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const log = createTeamLog(sink, now);
  const uninstall = installLogSink(log);
  const paths = teamPaths(options.dataDir);

  let db: Db;
  try {
    db = openTeamDb(options.dataDir);
  } catch (error) {
    uninstall();
    throw error;
  }

  let lease: ReturnType<typeof holdLease>;
  try {
    lease = holdLease(db, SERVE_LEASE, "serve", SERVE_TTL_MS, now);
  } catch (error) {
    db.close();
    uninstall();
    throw new Error(`another serve holds ${options.dataDir} (${(error as Error).message})`);
  }

  const restore = checkRestore(db, paths.feedFile, now());
  if (restore.renewed) {
    log.line({
      level: "warn",
      event: "restore-detected",
      file: restore.file,
      database: restore.db,
    });
  }
  bootstrapIfEmpty(db, now(), (code) => {
    log.line({ event: "bootstrap", code, validHours: BOOTSTRAP_VALID_HOURS });
    options.onBootstrap?.(code);
  });

  const serverId = getMeta(db, "server.id") as string;
  const instance = () => getMeta(db, "server.instance") as string;
  const signal = new ChangeSignal(timers);
  const buckets: Buckets = {
    devices: new Bucket(LIMITS.requestsPerMinute, LIMITS.requestsPerMinute / 60, now),
    joins: new Bucket(LIMITS.joinsPerMinute, LIMITS.joinsPerMinute / 60, now),
    bytes: new Bucket(LIMITS.payloadBytesPerHour, LIMITS.payloadBytesPerHour / 3600, now),
  };

  let exit: number | null = null;
  let stopping: Promise<void> | null = null;
  let resolveStopped: () => void = () => undefined;
  const stoppedPromise = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  const ctx: Context = {
    db,
    now,
    serverId,
    instance,
    trustProxy: options.trustProxy,
    limits: LIMITS,
    buckets,
    signal,
    freeBytes: options.freeBytes ?? diskFreeBytes,
    dataDir: options.dataDir,
    log,
    onWrite: ({ feed }) => {
      writeHighWater(paths.feedFile, currentMarks(db));
      if (feed) signal.fire();
    },
  };

  if (!isLoopback(options.host) && !options.trustProxy) {
    log.line({ level: "warn", event: "plain-http", host: options.host });
  }

  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    idleTimeout: IDLE_TIMEOUT_S,
    maxRequestBodySize: MAX_REQUEST_BODY,
    fetch: (request, bunServer) => handle(ctx, request, bunServer),
  });

  const stop = (code: number): Promise<void> => {
    if (stopping !== null) return stopping;
    exit = code;
    stopping = (async () => {
      signal.close();
      timers.clearInterval(renewal);
      timers.clearInterval(hourly);
      await server.stop();
      lease.release();
      uninstall();
      db.close();
      resolveStopped();
    })();
    return stopping;
  };

  const renewal = timers.setInterval(() => {
    if (!lease.renew()) {
      log.line({ level: "error", event: "lease-lost", dataDir: options.dataDir });
      void stop(1);
    }
  }, SERVE_RENEW_MS);
  const hourly = timers.setInterval(() => {
    buckets.devices.sweep();
    buckets.joins.sweep();
    buckets.bytes.sweep();
  }, HOUR_MS);

  log.line({
    event: "listening",
    host: options.host,
    port: server.port,
    dataDir: options.dataDir,
    serverId,
    instance: instance(),
  });

  return {
    origin: `http://${options.host}:${server.port}`,
    port: server.port ?? options.port,
    serverId,
    instance,
    stop: () => stop(0),
    stopped: () => stoppedPromise,
    exitCode: () => exit,
    options: { idleTimeout: IDLE_TIMEOUT_S, maxRequestBodySize: MAX_REQUEST_BODY },
    db,
    signalFired: () => signal.fired(),
    buckets,
  };
}
