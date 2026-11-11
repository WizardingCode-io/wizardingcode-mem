// Received memories in retrieval (ADR 0027): a third of the brief and of a prompt's notes,
// after the person's own, marked `(team: <server>)`; the rows of a muted server or member, of
// an unbound project and of an unlisted server left out; `replace-imports` sparing them.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { replaceImports } from "../../src/backfill/replace.ts";
import { rejudgeRemaining } from "../../src/judge/rejudge.ts";
import { RECEIVED_SHARE, sessionBrief } from "../../src/retrieve/brief.ts";
import { retrieveForPrompt } from "../../src/retrieve/prompt.ts";
import { receivedMarks } from "../../src/retrieve/received.ts";
import { renderHeading } from "../../src/retrieve/render.ts";
import { DAY, type Fixture, linksFixture, NOW, PROMPTS } from "../helpers/links-fixture.ts";

const BUDGET = 4200;
const SERVER = "f39bae1956c669f9";
const ALIAS = "remote:github.com/acme/app";
const BOB = "r27ju6vmw3ly";

let f: Fixture;
beforeEach(() => {
  f = linksFixture();
  f.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [ALIAS, f.app]);
});
afterEach(() => f.close());

function server(confirmed = true, muted = false): void {
  f.db.run(
    `INSERT OR REPLACE INTO sharing_servers (server_id, url, name, device_id, device_alias, member_id,
       member_name, role, contract, instance, confirmed_at, muted, added_at)
     VALUES (?, 'https://team.acme.test', 'Acme team', 'd', 'laptop', 'me', 'Ana', 'member', 1, 'i', ?, ?, 1)`,
    [SERVER, confirmed ? NOW : null, muted ? 1 : 0],
  );
}

function bound(): void {
  f.db.run(
    `INSERT OR REPLACE INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
     VALUES (?, ?, 'receive', ?, ?, 'cli')`,
    [f.app, SERVER, ALIAS, NOW],
  );
}

/** A memory of app that came from Bob through the server. */
function received(
  title: string,
  body = "The worker pool lease timeout makes the queue retry fail.",
): number {
  const id = f.memory(f.app, { kind: "gotcha", title, body, importance: 5 });
  f.db.run(
    `INSERT INTO sharing_received_memories (memory_id, server_id, remote_uid, member_id, member_name, revision, hash, remote_kind, remote_importance, remote_status)
     VALUES (?, ?, ?, ?, 'Bob', 1, 'h', 'gotcha', 5, 'active')`,
    [id, SERVER, `remote:desk:a1b2c3d4:${id}`, BOB],
  );
  return id;
}

const brief = () => sessionBrief(f.db, { projectId: f.app, branch: null, now: NOW });
const teamLines = (text: string) =>
  text.split("\n").filter((line) => line.startsWith("- #") && line.endsWith(" (team: Acme team)"));
const retrieve = (prompt: string) =>
  retrieveForPrompt(f.db, {
    projectId: f.app,
    sessionId: f.sessionId,
    epoch: 0,
    prompt,
    branch: null,
    now: NOW,
  });

describe("the brief", () => {
  test("received memories come after the person's own, marked, within a third of the budget; none without a listed server", () => {
    const before = brief();
    const ids = Array.from({ length: 12 }, (_, i) =>
      received(
        `Bob's rule ${i}: every public function in this codebase keeps its argument checks at the top`,
      ),
    );
    // No server row yet: the copies are left out entirely, the brief is as before.
    expect(brief().text).toBe(before.text);
    server();
    bound();
    const { text, notes } = brief();
    const team = teamLines(text);
    expect(team.length).toBeGreaterThan(0);
    expect(team.length).toBeLessThan(ids.length);
    const size = team.reduce((sum, line) => sum + line.length + 1, 0);
    expect(size).toBeLessThanOrEqual(RECEIVED_SHARE * BUDGET);
    // After the person's own notes: the first team line comes after the last own line.
    const lines = text.split("\n");
    const firstTeam = lines.findIndex((line) => line.endsWith(" (team: Acme team)"));
    const lastOwn = lines.reduce(
      (last, line, i) =>
        line.startsWith("- #") &&
        !line.includes("(team:") &&
        !line.includes("(you)") &&
        !line.includes("(from ")
          ? i
          : last,
      -1,
    );
    expect(firstTeam).toBeGreaterThan(lastOwn);
    expect(notes.filter((note) => note.origin === "team: Acme team").length).toBe(team.length);
    for (const line of team) expect(line).toContain("Bob's rule");
    expect(renderHeading).toBeDefined();
  });

  test("a muted server, a muted member, an unbound project and an unconfirmed server hide them", () => {
    received("Bob's rule: keep the argument checks at the top of every function");
    server();
    bound();
    expect(teamLines(brief().text)).toHaveLength(1);
    f.db.run("INSERT INTO sharing_muted_members (server_id, member_id) VALUES (?, ?)", [
      SERVER,
      BOB,
    ]);
    expect(teamLines(brief().text)).toHaveLength(0);
    f.db.run("DELETE FROM sharing_muted_members");
    server(true, true);
    expect(teamLines(brief().text)).toHaveLength(0);
    server(true, false);
    f.db.run("DELETE FROM sharing_levels");
    expect(teamLines(brief().text)).toHaveLength(0);
    bound();
    server(false);
    expect(teamLines(brief().text)).toHaveLength(0);
    server(true);
    expect(teamLines(brief().text)).toHaveLength(1);
    const marks = receivedMarks(f.db, f.app);
    expect([...marks.values()]).toEqual([{ server: "Acme team", visible: true }]);
  });
});

describe("a teammate's copy in a linked project", () => {
  test("is shown from the linked project while visible there, and hidden in the brief and the prompt when its member is muted", () => {
    server();
    bound();
    // lib, linked to app, bound to the server under its own alias, holds Bob's memory.
    const LIB_ALIAS = "remote:github.com/acme/lib";
    f.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [LIB_ALIAS, f.lib]);
    f.db.run(
      `INSERT OR REPLACE INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
       VALUES (?, ?, 'receive', ?, ?, 'cli')`,
      [f.lib, SERVER, LIB_ALIAS, NOW],
    );
    f.link(f.app, f.lib, "product");
    const title =
      "Bob's lib rule: the queue retry backoff doubles until the worker pool lease ends";
    const id = f.memory(f.lib, {
      kind: "gotcha",
      title,
      body: "Theirs, in the library.",
      importance: 5,
    });
    f.db.run(
      `INSERT INTO sharing_received_memories (memory_id, server_id, remote_uid, member_id, member_name, revision, hash, remote_kind, remote_importance, remote_status)
       VALUES (?, ?, ?, ?, 'Bob', 1, 'h', 'gotcha', 5, 'active')`,
      [id, SERVER, `remote:desk:a1b2c3d4:${id}`, BOB],
    );
    const queue = PROMPTS[0] as string;
    expect(brief().notes.some((note) => note.id === id && note.origin === "from lib")).toBe(true);
    expect(retrieve(queue).some((note) => note.id === id)).toBe(true);
    f.db.run("INSERT INTO sharing_muted_members (server_id, member_id) VALUES (?, ?)", [
      SERVER,
      BOB,
    ]);
    expect(brief().notes.some((note) => note.id === id)).toBe(false);
    expect(brief().text).not.toContain("Bob's lib rule");
    expect(retrieve(queue).some((note) => note.id === id)).toBe(false);
    // Unmuted again, and the project unbound instead: hidden the same way.
    f.db.run("DELETE FROM sharing_muted_members");
    expect(brief().notes.some((note) => note.id === id)).toBe(true);
    f.db.run("DELETE FROM sharing_levels WHERE project_id = ?", [f.lib]);
    expect(brief().notes.some((note) => note.id === id)).toBe(false);
    expect(retrieve(queue).some((note) => note.id === id)).toBe(false);
  });
});

describe("the prompt's notes", () => {
  test("at most a third of the notes are received, marked; the hidden ones never appear", () => {
    const queue = PROMPTS[0] as string;
    server();
    bound();
    const ids = Array.from({ length: 4 }, (_, i) =>
      received(`The queue retry ${i} fails when the lease timeout hits the worker pool`),
    );
    const notes = retrieve(queue);
    const team = notes.filter((note) => note.origin === "team: Acme team");
    expect(team).toHaveLength(1);
    expect(ids).toContain(team[0]?.id as number);
    expect(notes.length).toBeGreaterThan(1);
    f.db.run("INSERT INTO sharing_muted_members (server_id, member_id) VALUES (?, ?)", [
      SERVER,
      BOB,
    ]);
    expect(retrieve(queue).filter((note) => note.origin === "team: Acme team")).toHaveLength(0);
    expect(retrieve(queue).some((note) => ids.includes(note.id))).toBe(false);
  });
});

describe("history replace-imports and rejudge", () => {
  test("replace-imports archives claude-mem's imports and never a team's; rejudge selects nothing of the team's", () => {
    f.db.run(
      `INSERT INTO turns (session_id, project_id, seq, state, prompt, started_at, ended_at, origin)
       VALUES (?, ?, 900, 'done', 'p', ?, ?, 'history')`,
      [f.sessionId, f.app, NOW - 2 * DAY, NOW - DAY],
    );
    const insert = (judge: string) =>
      Number(
        f.db
          .query<{ id: number }, [number, string, number, number]>(
            `INSERT INTO memories (project_id, kind, title, body, importance, origin, judge, judge_version, created_at, updated_at)
             VALUES (?, 'decision', 'An import', 'b', 3, 'imported', ?, '1', ?, ?) RETURNING id`,
          )
          .get(f.app, judge, NOW - DAY - 1000, NOW - DAY - 1000)?.id,
      );
    const theirs = insert("claude-mem");
    const team = insert(`team:${SERVER}`);
    expect(replaceImports(f.db, f.app, { now: NOW })).toEqual({ archived: 1, spared: 0 });
    const status = (id: number) =>
      f.db.query<{ status: string }, [number]>("SELECT status FROM memories WHERE id = ?").get(id)
        ?.status;
    expect(status(theirs)).toBe("archived");
    expect(status(team)).toBe("active");
    // Rejudge's own selection: the team's rows are never its candidates.
    expect(rejudgeRemaining(f.db)).toBe(0);
    f.db.run("UPDATE memories SET status = 'active' WHERE id = ?", [theirs]);
    expect(rejudgeRemaining(f.db)).toBe(1);
  });
});
