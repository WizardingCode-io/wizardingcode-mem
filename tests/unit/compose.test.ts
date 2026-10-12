import { describe, expect, test } from "bun:test";
import { MOMENT_BUDGET } from "../../src/engine/budget.ts";
import { compose } from "../../src/engine/compose.ts";
import type { EngineModule, Moment, MomentInput } from "../../src/engine/module.ts";
import type { Db } from "../../src/store/db.ts";

const input = (moment: Moment = "prompt"): Omit<MomentInput, "budgetChars"> => ({
  db: {} as Db,
  moment,
  projectId: 1,
  branch: null,
  root: "/work/app",
  projectRoot: "/work/app",
  sessionId: 1,
  epoch: 0,
  prompt: moment === "prompt" ? "why" : null,
  path: null,
  error: null,
  now: 0,
});

/** A module that says `text` and remembers the budget it was given. */
function says(
  id: string,
  share: EngineModule["share"],
  text: string | null,
  budgets: number[] = [],
) {
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

  test("the blank lines between contributions come out of the budget, so the text fits it", () => {
    // Modules that fill whatever they are given.
    const fill = (id: string, share: EngineModule["share"]): EngineModule => ({
      id,
      name: id,
      share,
      contribute: (given) => "x".repeat(given.budgetChars),
    });
    const full = [fill("a", 0.4), fill("b", 0.4), fill("c", "remainder")];
    const out = compose(full, input("prompt"));
    expect(out?.length).toBeLessThanOrEqual(2400);
    // Alone, a module still has the whole budget: no separator to pay for.
    const alone: number[] = [];
    compose([says("m", "remainder", "x", alone)], input("prompt"));
    expect(alone).toEqual([2400]);
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
    // Two blank lines between three modules come off the budget first.
    expect(b).toEqual([2400 - 4 - Math.floor(0.7 * 2400)]);
    expect(c).toEqual([0]);
    expect([...a, ...b, ...c].reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(2400);
  });

  test("a share outside 0..1 is read as its nearest bound", () => {
    const a: number[] = [];
    const b: number[] = [];
    compose([says("a", -1, "x", a), says("b", 5, "y", b)], input("file-read"));
    expect(a).toEqual([0]);
    expect(b).toEqual([1200 - 2]);
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
  test("a module without contribute takes no share", () => {
    const tools: EngineModule = { id: "tools-only", name: "Tools only", share: 0.5 };
    const budgets: number[] = [];
    compose([tools, says("b", 1, "x", budgets)], input("prompt"));
    expect(budgets).toEqual([2400]);
  });
});

describe("compose: the remainder", () => {
  test("a remainder module alone gets the whole budget, and its text unchanged", () => {
    const budgets: number[] = [];
    const out = compose([says("memory", "remainder", " text\n", budgets)], input("session-start"));
    expect(out).toBe(" text\n");
    expect(budgets).toEqual([4200]);
  });

  test("the others' text comes off the top, wherever the remainder module stands", () => {
    const memory: number[] = [];
    const other: number[] = [];
    const out = compose(
      [says("memory", "remainder", "first", memory), says("other", 0.25, "second", other)],
      input("prompt"),
    );
    // The engine's order in the text, whoever was asked first.
    expect(out).toBe("first\n\nsecond");
    expect(other).toEqual([600]);
    // What the other actually said, and the blank line that joins it, and no more.
    expect(memory).toEqual([2400 - "second".length - 2]);
  });

  test("a share its module leaves unused stays with the remainder, to the character", () => {
    for (const silent of [null, ""]) {
      const memory: number[] = [];
      const out = compose(
        [says("memory", "remainder", "first", memory), says("other", 0.2, silent)],
        input("session-start"),
      );
      expect(out).toBe("first");
      expect(memory).toEqual([4200]);
    }
  });

  test("a share that overran and was dropped stays with the remainder too", () => {
    const memory: number[] = [];
    compose(
      [says("memory", "remainder", "x", memory), says("other", 0.25, "y".repeat(601))],
      input("prompt"),
    );
    expect(memory).toEqual([2400]);
  });

  test("a throwing module's share stays with the remainder", () => {
    const memory: number[] = [];
    const thrower: EngineModule = {
      id: "broken",
      name: "Broken",
      share: 0.2,
      contribute: () => {
        throw new Error("broken");
      },
    };
    const out = compose([says("memory", "remainder", "kept", memory), thrower], input("prompt"));
    expect(out).toBe("kept");
    expect(memory).toEqual([2400]);
  });

  test("shares that fill the whole budget leave the remainder nothing, and the text fits", () => {
    const memory: number[] = [];
    const fill = (id: string, share: number): EngineModule => ({
      id,
      name: id,
      share,
      contribute: (given) => "x".repeat(given.budgetChars),
    });
    const out = compose(
      [says("memory", "remainder", "x", memory), fill("a", 0.7), fill("b", 0.7)],
      input("prompt"),
    );
    expect(memory).toEqual([0]);
    expect(out?.length).toBeLessThanOrEqual(2400);
  });

  test("a module without contribute leaves the remainder whole", () => {
    const memory: number[] = [];
    const tools: EngineModule = { id: "tools-only", name: "Tools only", share: 0.5 };
    compose([says("memory", "remainder", "x", memory), tools], input("file-read"));
    expect(memory).toEqual([1200]);
  });
});
