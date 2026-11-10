import { describe, expect, test } from "bun:test";
import { knowledgeEvidence } from "../../src/modules/knowledge/policy.ts";
import { buildQuery, type Query } from "../../src/retrieve/query.ts";

// The floor a prompt's candidate has to pass before a hook shows it: ADR 0020's rule, with
// distinct words compared by stem and the area left out.

const query = (prompt: string): Query => {
  const built = buildQuery(prompt);
  if (built === null) throw new Error(`no query in: ${prompt}`);
  return built;
};

const entry = (
  over: Partial<{ title: string; context: string; subject: string; body: string }>,
) => ({
  title: "",
  context: "",
  subject: "",
  body: "",
  ...over,
});

describe("knowledgeEvidence", () => {
  test("a code name from the prompt, found in the entry as a token sequence, is code", () => {
    const money = entry({
      title: "Prices on invoices",
      body: "Round with formatMoney(amount) and never by hand.",
    });
    expect(knowledgeEvidence(query("why does formatMoney round down here"), money)).toBe("code");
  });

  test("three distinct non-generic words shared with the body alone are words", () => {
    const retries = entry({
      title: "Outbound calls",
      body: "The webhook retries with exponential backoff until the gateway answers.",
    });
    expect(
      knowledgeEvidence(query("should the webhook use backoff when the gateway is down"), retries),
    ).toBe("words");
  });

  test("two of the title's non-generic words plus one generic shared word are title", () => {
    // ADR 0020's example: `remove` is generic, `feature` and `flags` are the title's own.
    const flags = entry({
      title: "Feature flags",
      body: "Remove a flag once every client runs the release that made it permanent.",
    });
    expect(knowledgeEvidence(query("which feature flags can we remove now?"), flags)).toBe("title");
  });

  test("two of the title's words and no other shared word are not enough", () => {
    const flags = entry({ title: "Feature flags", body: "Kept in the release notes." });
    expect(knowledgeEvidence(query("feature flags in the dashboard"), flags)).toBeNull();
  });

  test("a generic title word does not count toward the title's two", () => {
    const tests = entry({ title: "Test fixtures", body: "Remove a fixture nobody loads." });
    // Shared: test (generic, in the title), fixtures (the title's own), remove (generic).
    expect(knowledgeEvidence(query("remove the test fixtures"), tests)).toBeNull();
  });

  test("a stopword never counts: two title words and a stopword are not enough", () => {
    const flags = entry({ title: "Feature flags", body: "Which ones stay is in the notes." });
    const built = query("which feature flags");
    expect(built.words).not.toContain("which");
    expect(knowledgeEvidence(built, flags)).toBeNull();
  });

  test("one shared word is never enough", () => {
    const mongo = entry({
      title: "We use PostgreSQL, not MongoDB",
      body: "Every service keeps its rows in PostgreSQL.",
    });
    expect(knowledgeEvidence(query("we don't use MongoDB here, right?"), mongo)).toBeNull();
  });

  test("the area is never read: an area id shared alone gives nothing", () => {
    const launch = {
      ...entry({ title: "Launch plan", body: "Dates and owners." }),
      area: "marketing",
    };
    // With the area read, `marketing` would be the third shared word.
    expect(knowledgeEvidence(query("marketing launch plan"), launch)).toBeNull();
  });

  test("two forms of one word are one shared word", () => {
    const cursor = entry({
      title: "Paging",
      body: "A query keeps its cursor between pages.",
    });
    const built = query("query queries cursor");
    expect(built.words).toEqual(["query", "queries", "cursor"]);
    expect(knowledgeEvidence(built, cursor)).toBeNull();
  });

  test("the rules are tested in order: a code name wins over shared words", () => {
    const both = entry({
      title: "Webhook retries",
      body: "retryWebhook waits with backoff while the gateway is down.",
    });
    expect(
      knowledgeEvidence(query("does retryWebhook back off when the gateway webhook retries"), both),
    ).toBe("code");
  });
});
