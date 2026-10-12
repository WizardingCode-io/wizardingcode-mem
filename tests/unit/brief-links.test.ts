import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  LINKED_MIN_IMPORTANCE,
  LINKED_POOL,
  LINKED_SHARE,
  MAX_LINKED_NOTES,
  sessionBrief,
  USER_SHARE,
} from "../../src/retrieve/brief.ts";
import { renderHeading } from "../../src/retrieve/render.ts";
import { type Fixture, linksFixture, NOW } from "../helpers/links-fixture.ts";

const BUDGET = 4200;

let f: Fixture;
beforeEach(() => {
  f = linksFixture();
});
afterEach(() => f.close());

const brief = (projectId = f.app) => sessionBrief(f.db, { projectId, branch: null, now: NOW });
const pinned = () => {
  const { text, notes } = brief();
  return { text, ids: notes.map((note) => note.id) };
};
const lines = (text: string, label: string) =>
  text.split("\n").filter((line) => line.startsWith("- #") && line.endsWith(` (${label})`));
const importance = (id: number) =>
  f.db.query<{ n: number }, [number]>("SELECT importance AS n FROM memories WHERE id = ?").get(id)
    ?.n ?? 0;
const size = (found: string[]) => found.reduce((sum, line) => sum + line.length + 1, 0);
/** Memories of importance 5 with long titles, more than a 15% share can hold. */
function important(projectId: number, n: number, importance = 5): number[] {
  return Array.from({ length: n }, (_, i) =>
    f.memory(projectId, {
      kind: "convention",
      title: `Rule ${i}: every public function in this codebase keeps its argument checks at the top`,
      importance,
    }),
  );
}

describe("session brief with no links and no user rules", () => {
  test("is what it was before links existed (pinned)", () => {
    expect(pinned()).toMatchSnapshot();
  });

  test("links that are only suggested or rejected change nothing", () => {
    const before = pinned();
    important(f.lib, 3);
    important(f.site, 3);
    f.link(f.app, f.lib, "uses", "suggested");
    f.link(f.app, f.site, "product", "rejected");
    expect(pinned()).toEqual(before);
  });

  test("a library does not see the project that uses it", () => {
    const before = pinned();
    important(f.consumer, 3);
    f.link(f.consumer, f.app, "uses");
    expect(pinned()).toEqual(before);
  });

  test("a confirmed link to a project with nothing important leaves the whole budget to the project", () => {
    const before = pinned();
    f.db.run("UPDATE memories SET importance = ? WHERE project_id = ?", [
      LINKED_MIN_IMPORTANCE - 1,
      f.lib,
    ]);
    important(f.lib, 3, LINKED_MIN_IMPORTANCE - 1);
    f.link(f.app, f.lib, "uses");
    expect(pinned()).toEqual(before);
  });
});

describe("session brief with linked projects", () => {
  test("shows only important memories, within their share, labelled with the project", () => {
    const before = pinned();
    const strong = important(f.lib, 10);
    const weak = important(f.lib, 3, LINKED_MIN_IMPORTANCE - 1);
    f.link(f.app, f.lib, "uses");
    const { text, notes } = brief();
    const linked = lines(text, "from lib");
    expect(linked.length).toBeGreaterThan(0);
    expect(size(linked)).toBeLessThanOrEqual(LINKED_SHARE * BUDGET);
    expect(text.length).toBeLessThanOrEqual(BUDGET);
    const ids = notes.map((note) => note.id);
    for (const id of weak) expect(ids).not.toContain(id);
    const fromLib = notes.filter((note) => note.origin === "from lib").map((note) => note.id);
    expect(fromLib.length).toBe(linked.length);
    expect(fromLib.some((id) => strong.includes(id))).toBe(true);
    for (const id of fromLib) expect(importance(id)).toBeGreaterThanOrEqual(LINKED_MIN_IMPORTANCE);
    // The project's own notes come first, in the order they had.
    const own = ids.filter((id) => !fromLib.includes(id));
    expect(own).toEqual(before.ids.slice(0, own.length));
    expect(ids.slice(0, own.length)).toEqual(own);
  });

  test("a product link is read both ways", () => {
    const fromSite = important(f.site, 2);
    f.link(f.site, f.app, "product");
    expect(lines(brief().text, "from site").length).toBeGreaterThanOrEqual(2);
    expect(brief().notes.map((note) => note.id)).toEqual(expect.arrayContaining(fromSite));
  });

  test("the library's own brief does not show the projects that use it", () => {
    important(f.app, 3);
    f.link(f.app, f.lib, "uses");
    expect(brief(f.lib).text).not.toContain("(from ");
  });

  test("a linked project with memory off adds nothing", () => {
    const before = pinned();
    important(f.lib, 3);
    important(f.site, 3);
    f.link(f.app, f.lib, "uses");
    f.link(f.app, f.site, "product");
    f.db.run("UPDATE projects SET disabled = 1 WHERE id IN (?, ?)", [f.lib, f.site]);
    expect(pinned()).toEqual(before);
  });

  test("a broken links table gives today's brief", () => {
    const before = pinned();
    important(f.lib, 3);
    f.link(f.app, f.lib, "uses");
    f.db.run("DROP TABLE project_links");
    expect(pinned()).toEqual(before);
  });
});

describe("session brief with the author's rules", () => {
  test("shows them within their share, labelled (you), after the project's notes", () => {
    const before = pinned();
    const rules = important(f.other, 20);
    for (const id of rules) f.userRule(id);
    const { text, notes } = brief();
    const mine = lines(text, "you");
    expect(mine.length).toBeGreaterThan(0);
    expect(size(mine)).toBeLessThanOrEqual(USER_SHARE * BUDGET);
    expect(text.length).toBeLessThanOrEqual(BUDGET);
    const ids = notes.map((note) => note.id);
    const own = ids.filter((id) => !rules.includes(id));
    expect(own).toEqual(before.ids.slice(0, own.length));
    expect(ids.slice(0, own.length)).toEqual(own);
  });

  test("one of the project's own memories that is a rule is shown once, as yours", () => {
    const [id] = important(f.app, 1) as [number];
    f.userRule(id);
    const { text, notes } = brief();
    expect(notes.filter((note) => note.id === id).length).toBe(1);
    expect(lines(text, "you").length).toBe(1);
  });

  test("one of the project's own rules that does not fit the share stays among the project's notes", () => {
    for (const id of important(f.other, 20)) f.userRule(id);
    // Older than the other rules, so it ranks after them and the full share leaves it out.
    const own = f.memory(f.app, {
      kind: "convention",
      title: "Keep the queue retries bounded",
      importance: 5,
      ageDays: 30,
    });
    f.userRule(own);
    const { notes } = brief();
    const shown = notes.filter((note) => note.id === own);
    expect(shown.length).toBe(1);
    // Shown in the project's part of the list, before anything from outside it.
    const firstOutside = notes.findIndex((note) => note.origin !== undefined && note.id !== own);
    expect(notes.indexOf(shown[0] as (typeof notes)[number])).toBeLessThan(firstOutside);
    expect(shown[0]?.origin).toBe("you");
  });

  test("a rule kept in a project with memory off is not shown", () => {
    const before = pinned();
    for (const id of important(f.other, 3)) f.userRule(id);
    f.db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [f.other]);
    expect(pinned()).toEqual(before);
  });

  test("an archived rule is not shown", () => {
    const before = pinned();
    const [id] = important(f.other, 1) as [number];
    f.userRule(id);
    f.db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [id]);
    expect(pinned()).toEqual(before);
  });

  test("what the shares leave unused goes to the project", () => {
    const before = pinned();
    const [id] = important(f.other, 1) as [number];
    f.userRule(id);
    f.link(f.app, f.lib, "uses");
    const { text, notes } = brief();
    // One rule line displaces at most one or two of the project's notes, not 30% of them.
    expect(notes.length).toBeGreaterThanOrEqual(before.ids.length - 1);
    expect(text.length).toBeGreaterThan(BUDGET - 250);
  });

  test("a broken rules table gives today's brief", () => {
    const before = pinned();
    for (const id of important(f.other, 3)) f.userRule(id);
    f.db.run("DROP TABLE user_memories");
    expect(pinned()).toEqual(before);
  });

  test("both shares together, linked notes before the author's", () => {
    for (const id of important(f.other, 5)) f.userRule(id);
    important(f.lib, 5);
    f.link(f.app, f.lib, "uses");
    const { text } = brief();
    const all = text.split("\n").filter((line) => line.startsWith("- #"));
    const firstLinked = all.findIndex((line) => line.endsWith("(from lib)"));
    const firstMine = all.findIndex((line) => line.endsWith("(you)"));
    expect(firstLinked).toBeGreaterThan(0);
    expect(firstMine).toBeGreaterThan(firstLinked);
    expect(text.length).toBeLessThanOrEqual(BUDGET);
  });
});

describe("constants and headings", () => {
  test("the shares and limits", () => {
    expect([
      USER_SHARE,
      LINKED_SHARE,
      LINKED_MIN_IMPORTANCE,
      MAX_LINKED_NOTES,
      LINKED_POOL,
    ]).toEqual([0.15, 0.15, 4, 1, 50]);
  });

  test("a heading names where a note comes from, and only when it comes from elsewhere", () => {
    const note = {
      id: 7,
      kind: "decision" as const,
      title: "Use one writer",
      body: "",
      createdAt: NOW,
      files: [],
      stale: false,
    };
    expect(renderHeading(note)).toBe("#7 [decision · 2026-10-12] Use one writer");
    expect(renderHeading({ ...note, origin: "you" })).toBe(
      "#7 [decision · 2026-10-12] Use one writer (you)",
    );
    expect(renderHeading({ ...note, origin: "from lib" })).toBe(
      "#7 [decision · 2026-10-12] Use one writer (from lib)",
    );
  });
});
