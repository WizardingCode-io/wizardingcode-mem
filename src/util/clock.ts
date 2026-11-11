// The clock and the timers a long-running process takes injected (the team server, the sync
// client, a stop that waits for a lease), so a test drives time instead of waiting for it.

export interface Clock {
  /** The time now, in milliseconds since the epoch. */
  now: number;
  /** Moves time forward and fires every timer that became due, in order. The real clock cannot. */
  advance(ms: number): void;
}

export type Timers = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

export const realTimers: Timers = { setTimeout, clearTimeout, setInterval, clearInterval };

/** The wall clock: `now` is read on every access, and `advance` does nothing. */
export const realClock: Clock = {
  get now() {
    return Date.now();
  },
  advance: () => undefined,
};
