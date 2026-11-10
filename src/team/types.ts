// The types the server's modules share: the limits, the request context the routes build and
// the domain reads, and what a handler adds to its log line. A leaf: type imports only, so
// the edge (`routes.ts`) and the domain (`push.ts`, `feed.ts`) both depend on it and never on
// each other.
import type { Db } from "./db.ts";
import type { Buckets } from "./limits.ts";
import type { RequestLine, TeamLog } from "./log.ts";
import type { ChangeSignal } from "./signal.ts";

export interface Limits {
  bodyBytes: number;
  itemsPerPush: number;
  itemBytes: number;
  pullItems: number;
  pullBytes: number;
  pullWaitSeconds: number;
  requestsPerMinute: number;
  payloadBytesPerHour: number;
  joinsPerMinute: number;
  /** Requests with a missing or wrong token, per source address and minute. */
  authFailuresPerMinute: number;
  /** Pulls one device may hold open at once; past it a pull answers at once. */
  heldPullsPerDevice: number;
  /** Aliases one pull may name. */
  aliasesPerPull: number;
  minFreeBytes: number;
  minFreeBytesHealth: number;
}

export interface Context {
  db: Db;
  now: () => number;
  serverId: string;
  instance: () => string;
  trustProxy: boolean;
  limits: Limits;
  buckets: Buckets;
  signal: ChangeSignal;
  /** The pulls each device holds open now. */
  held: Map<string, number>;
  freeBytes: (path: string) => number | null;
  dataDir: string;
  log: TeamLog;
  /** After a route wrote a feed or an audit row: the high-water file always, the signal and the mirror timer when `feed`. */
  onWrite: (what: { feed: boolean }) => void;
}

/** What a handler adds to the request's log line. */
export type Meta = Partial<Pick<RequestLine, "deviceId" | "memberId" | "held" | "pull" | "push">>;
