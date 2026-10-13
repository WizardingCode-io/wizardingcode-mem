import { describe, expect, test } from "bun:test";
import { EPISODIC_PATTERNS, looksEpisodic } from "../../src/modules/knowledge/episodic.ts";
import { EPISODIC, STANDING } from "../fixtures/promotion-probe.ts";

// Session artifacts are not knowledge (final review I1, layer 2): a memory that names a
// commit, a pull request, an agent's id, or the work of a session, or whose title copies the
// prompt it came from, records something that happened, not something that stays true.

describe("looksEpisodic", () => {
  for (const memory of EPISODIC) {
    test(`episodic (${memory.family}): ${memory.title}`, () => {
      expect(looksEpisodic(memory.title, memory.body, memory.prompt ?? null)).toBe(
        memory.family as string,
      );
    });
  }

  for (const memory of STANDING) {
    test(`standing: ${memory.title}`, () => {
      expect(looksEpisodic(memory.title, memory.body, memory.prompt ?? null)).toBeNull();
    });
  }

  test("every pattern family in the probe is a named pattern, or the prompt copy", () => {
    const names = new Set([...EPISODIC_PATTERNS.map((p) => p.name), "prompt-copy"]);
    for (const memory of EPISODIC) expect(names.has(memory.family as string)).toBe(true);
    expect(EPISODIC.length).toBeGreaterThanOrEqual(20);
    expect(STANDING.length).toBeGreaterThanOrEqual(10);
  });

  test("a title is a prompt copy only when most of it is a run of the prompt's opening", () => {
    const title = "Orders are never deleted, only cancelled";
    // The user stated it once, in passing, far into a long prompt: not a copy of its opening.
    const late = `${"we looked at the export and the totals again ".repeat(8)}orders are never deleted only cancelled`;
    expect(looksEpisodic(title, "Body.", late)).toBeNull();
    // A few of the title's words scattered in the prompt: not a copy.
    expect(looksEpisodic(title, "Body.", "why are orders cancelled and never deleted?")).toBeNull();
    // The title is the prompt's opening.
    expect(looksEpisodic(title, "Body.", "orders are never deleted, only cancelled. ok?")).toBe(
      "prompt-copy",
    );
    expect(looksEpisodic(title, "Body.", null)).toBeNull();
  });

  test("hex words, versions and plain numbers are not commits or pull requests", () => {
    for (const text of [
      "Pin the parser at 4.2.1 until 5.0 ships",
      "Colors are tokens like accent-500 and #ffffff in app.css",
      "Use port 5432 and keep 2 replicas",
      "A decade of orders stays in cold storage",
      "Session tokens expire after 30 minutes",
      "The task runner is make, not npm scripts",
    ]) {
      expect({ text, found: looksEpisodic(text, "", null) }).toEqual({ text, found: null });
    }
  });
});
