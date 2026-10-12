import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { retrieveForPrompt } from "../../src/retrieve/prompt.ts";
import { renderNotes } from "../../src/retrieve/render.ts";
import { type Fixture, linksFixture, NOW, PROMPTS } from "../helpers/links-fixture.ts";

let f: Fixture;
beforeEach(() => {
  f = linksFixture();
});
afterEach(() => f.close());

const retrieve = (prompt: string, projectId = f.app) =>
  retrieveForPrompt(f.db, {
    projectId,
    sessionId: f.sessionId,
    epoch: 0,
    prompt,
    branch: null,
    now: NOW,
  });
const pinned = () =>
  PROMPTS.map((prompt) => {
    const notes = retrieve(prompt);
    return { prompt, ids: notes.map((note) => note.id), text: renderNotes(notes) };
  });

const QUEUE = PROMPTS[0] as string;
/** Matches the first prompt better than anything in app. */
const strong = (projectId: number, n = 1) =>
  Array.from({ length: n }, (_, i) =>
    f.memory(projectId, {
      kind: "gotcha",
      title: `The queue retry ${i} fails when the lease timeout hits the worker pool`,
      body: "The worker pool lease timeout makes the queue retry fail.",
      importance: 5,
    }),
  );

describe("prompt notes with no links and no user rules", () => {
  test("are what they were before links existed (pinned)", () => {
    expect(pinned()).toMatchSnapshot();
  });

  test("links that are only suggested or rejected change nothing", () => {
    const before = pinned();
    strong(f.lib);
    strong(f.site);
    f.link(f.app, f.lib, "uses", "suggested");
    f.link(f.app, f.site, "product", "rejected");
    expect(pinned()).toEqual(before);
  });

  test("a library does not see the project that uses it", () => {
    const before = pinned();
    strong(f.consumer, 2);
    f.link(f.consumer, f.app, "uses");
    expect(pinned()).toEqual(before);
  });

  test("a broken links table gives today's notes", () => {
    const before = pinned();
    strong(f.lib, 2);
    f.link(f.app, f.lib, "uses");
    f.db.run("DROP TABLE project_links");
    expect(pinned()).toEqual(before);
  });

  test("a broken rules table gives today's notes", () => {
    const before = pinned();
    for (const id of strong(f.other, 2)) f.userRule(id);
    f.db.run("DROP TABLE user_memories");
    expect(pinned()).toEqual(before);
  });
});

describe("prompt notes from linked projects", () => {
  test("at most one, labelled, when it beats the project's best", () => {
    const before = retrieve(QUEUE).map((note) => note.id);
    const linked = strong(f.lib, 3);
    f.link(f.app, f.lib, "uses");
    const notes = retrieve(QUEUE);
    const fromLib = notes.filter((note) => linked.includes(note.id));
    expect(fromLib.length).toBe(1);
    expect(notes[0]?.id).toBe(fromLib[0]?.id as number);
    expect(fromLib[0]?.origin).toBe("from lib");
    expect(renderNotes(notes)).toContain(" (from lib)\n");
    // The project's own notes keep their order.
    const own = notes.slice(1).map((note) => note.id);
    expect(own).toEqual(before.slice(0, own.length));
  });

  test("none when it does not beat the project's best", () => {
    const before = pinned();
    const weak = f.memory(f.lib, {
      kind: "change",
      title: "Old aside: queue worker pool lease noted",
      importance: 1,
      ageDays: 400,
    });
    f.link(f.app, f.lib, "uses");
    expect(pinned()).toEqual(before);
    // It does match: with nothing of the project's own to beat, it is shown.
    f.db.run("UPDATE memories SET status = 'archived' WHERE project_id = ?", [f.app]);
    expect(retrieve(QUEUE).map((note) => note.id)).toEqual([weak]);
  });

  test("one when the project has nothing for the prompt", () => {
    const zebra = "how do the zebra giraffe elephant herds migrate across the savanna?";
    expect(retrieve(zebra)).toEqual([]);
    for (let i = 0; i < 3; i++) {
      f.memory(f.site, {
        title: `Zebra giraffe elephant herds migrate across the savanna ${i}`,
        importance: 2,
      });
    }
    f.link(f.app, f.site, "product");
    const notes = retrieve(zebra);
    expect(notes.length).toBe(1);
    expect(notes[0]?.origin).toBe("from site");
  });
});

describe("prompt notes with the author's rules", () => {
  test("a rule from any project competes with the project's own notes, labelled (you)", () => {
    const [rule] = strong(f.other) as [number];
    f.userRule(rule);
    const notes = retrieve(QUEUE);
    const mine = notes.find((note) => note.id === rule);
    expect(mine?.origin).toBe("you");
    expect(renderNotes(notes)).toContain(" (you)\n");
  });

  test("a project's own memory that is a rule is labelled (you)", () => {
    const [rule] = strong(f.app) as [number];
    f.userRule(rule);
    const notes = retrieve(QUEUE);
    expect(notes.filter((note) => note.id === rule).map((note) => note.origin)).toEqual(["you"]);
  });

  test("a rule kept in a project with memory off is not shown", () => {
    const before = pinned();
    const [rule] = strong(f.other) as [number];
    f.userRule(rule);
    f.db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [f.other]);
    expect(retrieve(QUEUE).map((note) => note.id)).not.toContain(rule);
    expect(pinned()).toEqual(before);
  });

  test("a linked project with memory off adds nothing", () => {
    const before = pinned();
    const [theirs] = strong(f.lib) as [number];
    f.link(f.app, f.lib, "uses");
    f.db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [f.lib]);
    expect(retrieve(QUEUE).map((note) => note.id)).not.toContain(theirs);
    expect(pinned()).toEqual(before);
  });

  test("a rule that does not match the prompt is not shown", () => {
    const before = pinned();
    const id = f.memory(f.other, { title: "Zebra giraffe elephant rule", importance: 5 });
    f.userRule(id);
    expect(pinned()).toEqual(before);
  });
});
