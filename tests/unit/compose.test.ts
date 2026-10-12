import { describe, expect, test } from "bun:test";
import { compose, MOMENT_BUDGET } from "../../src/engine/compose.ts";
import type { EngineModule, Moment, MomentInput } from "../../src/engine/module.ts";
import type { Db } from "../../src/store/db.ts";

const input = (moment: Moment = "prompt"): Omit<MomentInput, "budgetChars"> => ({
  db: {} as Db,
  moment,
  projectId: 1,
  branch: null,
  root: "/work/app",
  sessionId: 1,
  epoch: 0,
  prompt: moment === "prompt" ? "why" : null,
  path: null,
  error: null,
  now: 0,
});

/** A module that says `text` and remembers the budget it was given. */
function says(id: string, share: number, text: string | null, budgets: number[] = []) {
  return {
    id,
    name: id,
    share,
    contribute: (given: MomentInput) => {
      budgets.push(given.budgetChars);
      return text;
    },
  } satisfies EngineModule;
}

describe("MOMENT_BUDGET", () => {
  test("is what each moment had before modules", () => {
    expect(MOMENT_BUDGET).toEqual({
      "session-start": 4200,
      prompt: 2400,
      "file-read": 1200,
      "tool-failed": 1200,
    });
  });
});

describe("compose", () => {
  test("joins contributions in module order, with a blank line between them", () => {
    const out = compose([says("a", 0.5, "first"), says("b", 0.5, "second")], input());
    expect(out).toBe("first\n\nsecond");
  });

  test("a module alone with the whole share gets the whole budget, and its text unchanged", () => {
    const budgets: number[] = [];
    const out = compose([says("memory", 1, "  text \n", budgets)], input("session-start"));
    expect(out).toBe("  text \n");
    expect(budgets).toEqual([4200]);
  });

  test("shares are capped in order so that they never sum above the budget", () => {
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];
    compose([says("a", 0.7, "x", a), says("b", 0.7, "y", b), says("c", 0.5, "z", c)], input());
    expect(a).toEqual([Math.floor(0.7 * 2400)]);
    expect(b).toEqual([2400 - Math.floor(0.7 * 2400)]);
    expect(c).toEqual([0]);
    expect([...a, ...b, ...c].reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(2400);
  });

  test("a share outside 0..1 is read as its nearest bound", () => {
    const a: number[] = [];
    const b: number[] = [];
    compose([says("a", -1, "x", a), says("b", 5, "y", b)], input("file-read"));
    expect(a).toEqual([0]);
    expect(b).toEqual([1200]);
  });

  test("a contribution longer than its share is dropped whole, never cut", () => {
    const out = compose(
      [says("a", 0.5, "x".repeat(1201)), says("b", 0.5, "kept")],
      input("prompt"),
    );
    expect(out).toBe("kept");
    // Exactly the share fits.
    expect(compose([says("a", 0.5, "x".repeat(1200))], input("prompt"))).toBe("x".repeat(1200));
  });

  test("a module that throws contributes nothing; the others still do, and the error is told", () => {
    const errors: [string, unknown][] = [];
    const boom = new Error("broken");
    const thrower: EngineModule = {
      id: "broken",
      name: "Broken",
      share: 0.5,
      contribute: () => {
        throw boom;
      },
    };
    const out = compose([thrower, says("b", 0.5, "kept")], input(), (id, error) =>
      errors.push([id, error]),
    );
    expect(out).toBe("kept");
    expect(errors).toEqual([["broken", boom]]);
  });

  test("a throwing module without a listener is still contained", () => {
    const thrower: EngineModule = {
      id: "broken",
      name: "Broken",
      share: 1,
      contribute: () => {
        throw new Error("broken");
      },
    };
    expect(compose([thrower], input())).toBeNull();
  });

  test("null and empty contributions add nothing, not even a blank line", () => {
    const out = compose(
      [
        says("a", 0.25, null),
        says("b", 0.25, "middle"),
        says("c", 0.25, ""),
        says("d", 0.25, null),
      ],
      input(),
    );
    expect(out).toBe("middle");
    expect(compose([says("a", 0.5, null), says("b", 0.5, "")], input())).toBeNull();
  });

  test("a module that contributes to no moment, or not to this one, is skipped", () => {
    const silent: EngineModule = { id: "tools-only", name: "Tools only", share: 0.5 };
    const onlyStart: EngineModule = {
      id: "start",
      name: "Start",
      share: 0.5,
      contribute: (given) => (given.moment === "session-start" ? "hello" : null),
    };
    expect(compose([silent, onlyStart], input("prompt"))).toBeNull();
    expect(compose([silent, onlyStart], input("session-start"))).toBe("hello");
  });

  test("no modules, nothing to say", () => {
    expect(compose([], input())).toBeNull();
  });
});
