// A clock a test moves by hand and timers that fire only when it is advanced past their due
// time: what the team server and the sync client take instead of the real ones.
import type { Clock, Timers } from "../../src/util/clock.ts";

export type { Clock, Timers };

interface Scheduled {
  id: number;
  due: number;
  fn: () => void;
  every: number | null;
}

export const CLOCK_START = 1_700_000_000_000;

/** A clock stopped at `at` until a test advances it; `fakeTimers` gives it its `advance`. */
export function fakeClock(at: number = CLOCK_START): Clock {
  return { now: at, advance: () => undefined };
}

/** Timers that fire only when the clock is advanced past their due time. */
export function fakeTimers(clock: Clock): Timers & { pending(): number } {
  const scheduled: Scheduled[] = [];
  let next = 1;
  const add = (fn: () => void, ms: number, every: number | null) => {
    const entry = { id: next++, due: clock.now + Math.max(0, ms), fn, every };
    scheduled.push(entry);
    return entry.id as unknown as ReturnType<typeof setTimeout>;
  };
  const remove = (id: unknown) => {
    const index = scheduled.findIndex((entry) => entry.id === (id as number));
    if (index >= 0) scheduled.splice(index, 1);
  };
  clock.advance = (ms: number) => {
    const target = clock.now + ms;
    for (;;) {
      const due = scheduled.filter((entry) => entry.due <= target).sort((a, b) => a.due - b.due)[0];
      if (due === undefined) break;
      clock.now = Math.max(clock.now, due.due);
      if (due.every === null) remove(due.id);
      else due.due += due.every;
      due.fn();
    }
    clock.now = target;
  };
  return {
    setTimeout: ((fn: () => void, ms: number) => add(fn, ms, null)) as unknown as typeof setTimeout,
    clearTimeout: remove as unknown as typeof clearTimeout,
    setInterval: ((fn: () => void, ms: number) =>
      add(fn, ms, Math.max(1, ms))) as unknown as typeof setInterval,
    clearInterval: remove as unknown as typeof clearInterval,
    pending: () => scheduled.length,
  };
}
