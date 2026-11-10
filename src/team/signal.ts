// One signal per server: a held pull waits on it, a push fires it. The timers are injected so
// a test drives them with its clock.

export type Timers = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

export const REAL_TIMERS: Timers = { setTimeout, clearTimeout, setInterval, clearInterval };

export class ChangeSignal {
  private waiters = new Set<(fired: boolean) => void>();
  private count = 0;
  private closed = false;

  constructor(private readonly timers: Timers) {}

  /** True when the signal fired within `ms`, false when the time passed or the signal closed. */
  wait(ms: number): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = (fired: boolean) => {
        this.waiters.delete(done);
        this.timers.clearTimeout(timer);
        resolve(fired);
      };
      const timer = this.timers.setTimeout(() => done(false), ms);
      this.waiters.add(done);
    });
  }

  /** Wakes every waiter with true. */
  fire(): void {
    this.count++;
    for (const waiter of [...this.waiters]) waiter(true);
  }

  /** Wakes every waiter with false and refuses new waits: the server is stopping. */
  close(): void {
    this.closed = true;
    for (const waiter of [...this.waiters]) waiter(false);
  }

  /** How many times the signal fired: what a test reads. */
  fired(): number {
    return this.count;
  }

  /** True once `close()` ran: a held request ends instead of waiting again. */
  isClosed(): boolean {
    return this.closed;
  }
}
