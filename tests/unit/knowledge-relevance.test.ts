import { describe, expect, test } from "bun:test";
import { isRelevant } from "../../src/modules/knowledge/relevance.ts";
import { buildQuery } from "../../src/retrieve/query.ts";
import { PROBE_ENTRIES, PROBE_RELEVANT, PROBE_UNRELATED } from "../fixtures/knowledge-probe.ts";

// The relevance floor against the review's probe: short titles, acronyms and brand names
// ("API versioning", "JSON responses", "We use PostgreSQL, not MongoDB"). A prompt that only
// mentions one of those words in passing must get nothing; one that asks about it must
// get it.

const BORDERLINE = "the user cannot see their projects list after login";

const hits = (prompt: string) => {
  const query = buildQuery(prompt);
  return query === null
    ? []
    : PROBE_ENTRIES.filter((e) => isRelevant(e, query)).map((e) => e.title);
};

describe("the relevance floor, on the review's probe", () => {
  test("every prompt that asks about an entry finds it", () => {
    for (const [prompt, title] of PROBE_RELEVANT) {
      expect({ prompt, found: hits(prompt).includes(title) }).toEqual({ prompt, found: true });
    }
  });

  test("a name or a common word mentioned in passing brings nothing", () => {
    for (const prompt of PROBE_UNRELATED.filter((p) => p !== BORDERLINE)) {
      expect({ prompt, hits: hits(prompt) }).toEqual({ prompt, hits: [] });
    }
  });

  test("the one borderline case left: three words shared with the entry's own text", () => {
    // "user" (its title), "see" and "projects" (its body: "members see only their own
    // projects"): lexically it asks what the entry answers. Pinned so a change is noticed.
    expect(hits(BORDERLINE)).toEqual(["User roles"]);
  });

  test("one name alone is not enough, even when the prompt asks about it", () => {
    // The cost of closing the name back door: a one-word question needs one more word in
    // common with the entry.
    expect(hits("should this new service use MongoDB?")).toEqual([]);
    expect(hits("should this new service keep its data in MongoDB?")).toContain(
      "We use PostgreSQL, not MongoDB",
    );
  });
});
