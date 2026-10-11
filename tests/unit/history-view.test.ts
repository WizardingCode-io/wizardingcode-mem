import { describe, expect, test } from "bun:test";
import {
  awaitingStart,
  type HistoryStatus,
  historyCardDescription,
  importLabel,
  judgesWithTypeSafe,
  offerWhere,
  progressOf,
  progressPoller,
  sessionsFound,
  shouldOffer,
  sizeOf,
} from "../../ui/src/history.ts";

const status = (over: Partial<HistoryStatus> = {}): HistoryStatus => ({
  transcripts: { claudeCode: 12, codex: 3 },
  run: { state: "never", startedAt: null, finishedAt: null, last: null },
  queue: { pending: 0, done: 0, skipped: 0, failed: 0 },
  index: { exists: false, files: 0, turns: 0, bytes: 0 },
  replace: { projectsReady: 0, wouldArchive: 0, replaced: 0 },
  offer: { dismissed: false },
  ...over,
});

describe("the one-time offer", () => {
  test("shows when there are past sessions, nothing ran and it was not dismissed", () => {
    expect(shouldOffer(status())).toBe(true);
  });
  test("stays away without transcripts, after a run, or once dismissed", () => {
    expect(shouldOffer(status({ transcripts: { claudeCode: 0, codex: 0 } }))).toBe(false);
    for (const state of ["running", "done", "failed"] as const) {
      expect(
        shouldOffer(status({ run: { state, startedAt: 1, finishedAt: null, last: null } })),
      ).toBe(false);
    }
    expect(shouldOffer(status({ offer: { dismissed: true } }))).toBe(false);
    expect(shouldOffer(null)).toBe(false);
  });
});

describe("what the card says", () => {
  test("counts the sessions of every agent", () => {
    expect(sessionsFound(status())).toBe(15);
  });
  test("progress counts settled turns over all queued", () => {
    expect(progressOf({ pending: 6, done: 3, skipped: 1, failed: 0 })).toEqual({
      settled: 4,
      total: 10,
      percent: 40,
    });
    expect(progressOf({ pending: 0, done: 0, skipped: 0, failed: 0 })).toEqual({
      settled: 0,
      total: 0,
      percent: 0,
    });
    // Rounded down: 100% only when nothing is left.
    expect(progressOf({ pending: 1, done: 199, skipped: 0, failed: 0 }).percent).toBe(99);
  });
  test("the import button continues what a stopped or partial run left", () => {
    expect(importLabel(status())).toBe("Import");
    expect(
      importLabel(
        status({
          run: { state: "failed", startedAt: 1, finishedAt: 2, last: null },
          queue: { pending: 4, done: 2, skipped: 0, failed: 0 },
        }),
      ),
    ).toBe("Continue");
    expect(
      importLabel(status({ run: { state: "done", startedAt: 1, finishedAt: 2, last: null } })),
    ).toBe("Import new sessions");
  });
  test("sizes read in KB or MB", () => {
    expect(sizeOf(512 * 1024)).toBe("512 KB");
    expect(sizeOf(42.1 * 1024 * 1024)).toBe("42.1 MB");
  });
});

describe("a run just asked for", () => {
  const at = 1_000_000;
  test("counts as starting until the background process records its own start", () => {
    const never = { state: "never" as const, startedAt: null, finishedAt: null, last: null };
    const old = {
      state: "done" as const,
      startedAt: at - 60_000,
      finishedAt: at - 50_000,
      last: null,
    };
    const mine = { state: "done" as const, startedAt: at + 200, finishedAt: at + 900, last: null };
    expect(awaitingStart(never, at, at + 1000)).toBe(true);
    expect(awaitingStart(old, at, at + 1000)).toBe(true);
    // It ran (and maybe finished) after the request: what it says is true.
    expect(awaitingStart(mine, at, at + 1000)).toBe(false);
    // A process that never came is not waited for forever.
    expect(awaitingStart(never, at, at + 16_000)).toBe(false);
    expect(awaitingStart(never, null, at)).toBe(false);
  });
});

describe("the progress poll", () => {
  // A hand-driven clock: each scheduled tick waits until run() is called.
  function clock() {
    const queue: (() => void)[] = [];
    return {
      schedule: (fn: () => void, ms: number) => {
        expect(ms).toBe(3000);
        queue.push(fn);
        return queue.length;
      },
      cancel: (handle: number) => {
        queue[handle - 1] = () => {};
      },
      pending: () => queue.length,
      async run() {
        const fn = queue.shift();
        fn?.();
        await new Promise((r) => setTimeout(r, 0));
      },
    };
  }
  const running = { state: "running" as const, startedAt: 1, finishedAt: null, last: null };
  const done = { state: "done" as const, startedAt: 1, finishedAt: 2, last: null };
  const q = { pending: 0, done: 1, skipped: 0, failed: 0 };

  test("polls only while a run is going, and says when it ends", async () => {
    const c = clock();
    const answers = [
      { run: running, queue: q },
      { run: done, queue: q },
    ];
    const seen: string[] = [];
    let finished = 0;
    const poller = progressPoller({
      load: async () => answers.shift() ?? { run: done, queue: q },
      apply: (p) => void seen.push(p.run.state),
      finished: () => void finished++,
      schedule: c.schedule,
      cancel: c.cancel,
    });
    poller.sync("never");
    expect(c.pending()).toBe(0);
    poller.sync("running");
    poller.sync("running"); // already polling: no second loop
    expect(c.pending()).toBe(1);
    await c.run();
    expect(seen).toEqual(["running"]);
    expect(c.pending()).toBe(1);
    await c.run();
    expect(seen).toEqual(["running", "done"]);
    expect(finished).toBe(1);
    expect(c.pending()).toBe(0);
  });

  test("a load in flight counts as polling: no second loop", async () => {
    const c = clock();
    let release: (() => void) | undefined;
    const poller = progressPoller({
      load: () =>
        new Promise((resolve) => {
          release = () => resolve({ run: running, queue: q });
        }),
      apply: () => poller.sync("running"),
      finished: () => {},
      schedule: c.schedule,
      cancel: c.cancel,
    });
    poller.sync("running");
    await c.run(); // the tick is now waiting on load
    poller.sync("running");
    expect(c.pending()).toBe(0);
    release?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(c.pending()).toBe(1);
  });

  test("stops when the card goes away", async () => {
    const c = clock();
    let loads = 0;
    const poller = progressPoller({
      load: async () => {
        loads++;
        return { run: running, queue: q };
      },
      apply: () => {},
      finished: () => {},
      schedule: c.schedule,
      cancel: c.cancel,
    });
    poller.sync("running");
    poller.stop();
    await c.run();
    expect(loads).toBe(0);
  });
});

describe("what the history copy says leaves the machine", () => {
  test("TypeSafe judges only with a key and the switch not off", () => {
    expect(judgesWithTypeSafe(true, "on")).toBe(true);
    expect(judgesWithTypeSafe(true, null)).toBe(true);
    expect(judgesWithTypeSafe(true, "off")).toBe(false);
    expect(judgesWithTypeSafe(false, "on")).toBe(false);
  });
  test("the card says nothing leaves, unless TypeSafe judges", () => {
    expect(historyCardDescription(false)).toBe(
      "Learn from the sessions your agents had before. Nothing leaves this machine.",
    );
    expect(historyCardDescription(true)).toBe(
      "Learn from the sessions your agents had before. It runs on this machine, except TypeSafe judgements (a key is set).",
    );
  });
  test("the offer says where it runs, and names TypeSafe when it judges", () => {
    expect(offerWhere(false)).toBe("It runs in the background, on this machine.");
    expect(offerWhere(true)).toBe(
      "It runs in the background, on this machine, except TypeSafe judgements (a key is set).",
    );
  });
});
