import { describe, expect, test } from "bun:test";
import {
  becomes,
  entryCounts,
  entryGroups,
  type KnowledgeListEntry,
  type KnowledgeView,
  knowledgeCrumb,
  knowledgeEmpty,
  knowledgeHash,
  matches,
  openFromHash,
  relativePath,
  sourceMemory,
} from "../../ui/src/knowledge.ts";

// What the Knowledge view decides: how entries group and filter, what an empty page says
// (no folder, knowledge off, the project not known yet), and how paths and sources read.

const entry = (over: Partial<KnowledgeListEntry> & { slug: string }): KnowledgeListEntry => ({
  path: `/repo/.wizardingcode/knowledge/${over.slug}.md`,
  title: over.slug,
  kind: "decision",
  essential: false,
  status: "active",
  tags: [],
  updated: null,
  source: null,
  problem: null,
  ...over,
});

const view = (over: Partial<KnowledgeView>): KnowledgeView => ({
  state: "ok",
  root: "/repo",
  dir: "/repo/.wizardingcode/knowledge",
  problem: null,
  entries: [],
  ...over,
});

describe("entries grouped by kind", () => {
  const entries = [
    entry({ slug: "saga", essential: true }),
    entry({ slug: "naming", kind: "rule" }),
    entry({ slug: "deploy", kind: "howto" }),
    entry({ slug: "outbox" }),
    entry({ slug: "sku", kind: "glossary" }),
    entry({ slug: "layers", kind: "architecture" }),
  ];

  test("in the format's kind order, each group in the order given, empty groups left out", () => {
    expect(
      entryGroups(entries, "all").map((g) => [g.kind, g.label, g.entries.map((e) => e.slug)]),
    ).toEqual([
      ["decision", "Decision", ["saga", "outbox"]],
      ["rule", "Rule", ["naming"]],
      ["glossary", "Glossary", ["sku"]],
      ["architecture", "Architecture", ["layers"]],
      ["howto", "How-to", ["deploy"]],
    ]);
    expect(entryGroups([], "all")).toEqual([]);
  });

  test("filters: essential, needing attention (a problem), retired (draft or superseded)", () => {
    const mixed = [
      entry({ slug: "a", essential: true }),
      entry({ slug: "b", problem: 'kind "x" is not one of …' }),
      entry({ slug: "c", status: "draft" }),
      entry({ slug: "d", status: "superseded", essential: true }),
      entry({ slug: "e" }),
    ];
    expect(entryCounts(mixed)).toEqual({ all: 5, essential: 2, attention: 1, retired: 2 });
    expect(mixed.filter((e) => matches(e, "essential")).map((e) => e.slug)).toEqual(["a", "d"]);
    expect(mixed.filter((e) => matches(e, "attention")).map((e) => e.slug)).toEqual(["b"]);
    expect(mixed.filter((e) => matches(e, "retired")).map((e) => e.slug)).toEqual(["c", "d"]);
    expect(mixed.filter((e) => matches(e, "all"))).toHaveLength(5);
    expect(entryGroups(mixed, "retired").flatMap((g) => g.entries.map((e) => e.slug))).toEqual([
      "c",
      "d",
    ]);
  });

  test("an unknown kind (an older index) is grouped as a decision, never dropped", () => {
    const odd = entry({ slug: "odd", kind: "nonsense" as KnowledgeListEntry["kind"] });
    expect(entryGroups([odd], "all").map((g) => [g.kind, g.entries.length])).toEqual([
      ["decision", 1],
    ]);
  });
});

describe("the empty page", () => {
  test("no folder: where the files go, and that nothing is written without a click", () => {
    const empty = knowledgeEmpty(view({ state: "missing" }));
    expect(empty?.title).toBe("No knowledge in this project yet");
    expect(empty?.text).toContain(".wizardingcode/knowledge/");
    expect(empty?.folder).toBe("/repo/.wizardingcode/knowledge");
  });

  test("a folder with no entries says the same about where they go", () => {
    expect(knowledgeEmpty(view({ state: "ok" }))?.title).toBe("No entries yet");
  });

  test("knowledge off: the reason, and no folder offered", () => {
    const off = knowledgeEmpty(
      view({ state: "off", problem: "Knowledge is off here: this folder is the home folder." }),
    );
    expect(off?.title).toBe("Knowledge is off here");
    expect(off?.text).toBe("Knowledge is off here: this folder is the home folder.");
    expect(off?.folder).toBeNull();
  });

  test("the project's folder not known yet", () => {
    expect(knowledgeEmpty(view({ state: "unknown", root: null, dir: null }))?.title).toBe(
      "Where this project lives is not known yet",
    );
  });

  test("entries there: no empty page", () => {
    expect(knowledgeEmpty(view({ entries: [entry({ slug: "a" })] }))).toBeNull();
  });
});

describe("paths, sources and what a proposal becomes", () => {
  test("a file inside the project reads from the project's root", () => {
    expect(relativePath("/repo/.wizardingcode/knowledge/a.md", "/repo")).toBe(
      ".wizardingcode/knowledge/a.md",
    );
    expect(relativePath("/elsewhere/a.md", "/repo")).toBe("/elsewhere/a.md");
    expect(relativePath("/repo-two/a.md", "/repo")).toBe("/repo-two/a.md");
    expect(relativePath("/repo/a.md", null)).toBe("/repo/a.md");
  });

  test("a source naming a memory gives its id; anything else does not", () => {
    expect(sourceMemory("memory:1234")).toBe(1234);
    expect(sourceMemory("memory:x")).toBeNull();
    expect(sourceMemory("https://example.com")).toBeNull();
    expect(sourceMemory(null)).toBeNull();
  });

  test("a decision stays a decision; a convention becomes a rule", () => {
    expect(becomes("decision")).toBe("decision");
    expect(becomes("convention")).toBe("rule");
  });
});

describe("the address", () => {
  test("the page alone, an entry or a proposal", () => {
    expect(knowledgeHash(null)).toBe("#knowledge");
    expect(knowledgeHash("e:orders-saga")).toBe("#knowledge/e:orders-saga");
    expect(knowledgeHash("p12")).toBe("#knowledge/p12");
  });

  test("read back: what is open, or null; anything else is not this page's", () => {
    expect(openFromHash("#knowledge")).toEqual({ open: null });
    expect(openFromHash("#knowledge/e:orders-saga")).toEqual({ open: "e:orders-saga" });
    expect(openFromHash("#knowledge/p12")).toEqual({ open: "p12" });
    expect(openFromHash("#knowledge/e:../x")).toEqual({ open: null });
    expect(openFromHash("#knowledge/e:..%2Fx")).toEqual({ open: null });
    expect(openFromHash(knowledgeHash("e:Notes on SKUs"))).toEqual({ open: "e:Notes on SKUs" });
    expect(openFromHash("#projects/12")).toBeNull();
    expect(openFromHash("")).toBeNull();
  });
});

describe("the header's numbers on the Knowledge page (task 5 minor)", () => {
  const proposal = {
    id: 1,
    projectId: 1,
    memoryId: 9,
    slug: "x",
    title: "X",
    body: "",
    kind: "decision" as const,
    createdAt: 0,
  };
  test("entries, essential ones, ones needing attention and proposals, not memory's counts", () => {
    const entries = [
      entry({ slug: "a", essential: true }),
      entry({ slug: "b", problem: "bad line" }),
      entry({ slug: "c" }),
    ];
    expect(knowledgeCrumb(view({ entries }), [proposal])).toEqual({
      entries: 3,
      essential: 1,
      attention: 1,
      proposals: 1,
    });
  });
  test("no proposals counted where knowledge is off; nothing before the page has loaded", () => {
    expect(knowledgeCrumb(view({ state: "off", entries: [] }), [proposal])).toEqual({
      entries: 0,
      essential: 0,
      attention: 0,
      proposals: 0,
    });
    expect(knowledgeCrumb(null, [])).toBeNull();
  });
});
