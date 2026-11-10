// The rate limiter: token buckets in memory, per key, reset on restart (D-15).

export class Bucket {
  private readonly state = new Map<string, { tokens: number; at: number }>();

  /**
   * `capacity` tokens at most, refilled at `perSecond`; a take of `amount` succeeds while the
   * key has that many, else says how long until it would.
   */
  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly now: () => number,
  ) {}

  take(key: string, amount = 1): { ok: true } | { ok: false; retryAfterSec: number } {
    const at = this.now();
    const entry = this.state.get(key) ?? { tokens: this.capacity, at };
    const refilled = Math.min(
      this.capacity,
      entry.tokens + ((at - entry.at) / 1000) * this.perSecond,
    );
    if (refilled >= amount) {
      this.state.set(key, { tokens: refilled - amount, at });
      return { ok: true };
    }
    this.state.set(key, { tokens: refilled, at });
    const wait = (amount - refilled) / this.perSecond;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(wait)) };
  }

  /** Drops the keys idle for ten minutes; the hourly interval calls it. */
  sweep(): void {
    const cutoff = this.now() - 10 * 60_000;
    for (const [key, entry] of this.state) if (entry.at < cutoff) this.state.delete(key);
  }

  size(): number {
    return this.state.size;
  }
}

export type Buckets = { devices: Bucket; joins: Bucket; bytes: Bucket; auth: Bucket };

/**
 * The buckets the routes take from: requests per device, joins per address, applied bytes
 * per device, and failed authentications per address.
 */
export function createBuckets(
  limits: {
    requestsPerMinute: number;
    joinsPerMinute: number;
    payloadBytesPerHour: number;
    authFailuresPerMinute: number;
  },
  now: () => number,
): Buckets {
  return {
    devices: new Bucket(limits.requestsPerMinute, limits.requestsPerMinute / 60, now),
    joins: new Bucket(limits.joinsPerMinute, limits.joinsPerMinute / 60, now),
    bytes: new Bucket(limits.payloadBytesPerHour, limits.payloadBytesPerHour / 3600, now),
    auth: new Bucket(limits.authFailuresPerMinute, limits.authFailuresPerMinute / 60, now),
  };
}
