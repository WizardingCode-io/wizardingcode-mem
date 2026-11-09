// The store's writes that read a project's state: a level set, and the two reconciles.
// Projects are made by `resolveProject` on plain folders (no git: a `path:` alias only),
// and a `remote:` alias is given by hand where a case needs one.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import { levelOf } from "../../src/sharing/levels.ts";
import { loadPolicy } from "../../src/sharing/policy.ts";
import {
  applySettingsPatch,
  type ChangeSource,
  counterOf,
  levelRows,
  previewLevel,
  projectState,
  recentChanges,
  reconcileLevels,
  reconcileSettings,
  setLevel,
  settingsSeen,
} from "../../src/sharing/store.ts";
import type { Level } from "../../src/sharing/types.ts";
import { type Db, openDb } from "../../src/store/db.ts";

const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS";
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS";
const NOW = 1000;
const HAND_EDIT =
  "the sharing settings changed outside the viewer and the CLI; open the Sharing page or run share status to record it";

// One folder is the data directory (the env file) and the store directory; the projects'
// folders are under it.
let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-sharing-writes-"));
  db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const remote = (name: string) => `remote:github.com/${name}`;

const addAlias = (projectId: number, alias: string) =>
  db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [alias, projectId]);
const dropAlias = (alias: string) => db.run("DELETE FROM project_aliases WHERE alias = ?", [alias]);

/** A project on a folder without git, known by its path and by the remote aliases given. */
const project = (name: string, ...remotes: string[]): number => {
  const folder = join(dir, "work", name);
  mkdirSync(folder, { recursive: true });
  const id = resolveProject(db, folder, 1).id;
  for (const alias of remotes) addAlias(id, alias);
  return id;
};

interface Over {
  confirm?: boolean;
  remoteAlias?: string | null;
  source?: ChangeSource;
  now?: number;
  destination?: string;
}

/** Sets a level as a person who confirmed would, but for what a case overrides. */
const set = (projectId: number, level: Level, over: Over = {}) =>
  setLevel(db, {
    projectId,
    destination: "team",
    level,
    source: "cli",
    now: NOW,
    confirm: true,
    ...over,
  });

const policy = (env: Record<string, string | undefined> = {}) => loadPolicy(db, dir, env, NOW);
const changes = () =>
  recentChanges(db, 50)
    .reverse()
    .map(({ what, old, new: next, source, at }) => ({ what, old, new: next, source, at }));
const writeEnv = (...lines: string[]) => writeFileSync(join(dir, "env"), `${lines.join("\n")}\n`);
const disable = (projectId: number) =>
  db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [projectId]);

describe("projectState", () => {
  test("is the project's disabled flag and its aliases, by name", () => {
    const widgets = project("widgets", remote("x/y"), remote("a/b"));
    const state = projectState(db, widgets);
    expect(state.known).toBe(true);
    expect(state.disabled).toBe(false);
    expect(state.aliases).toHaveLength(3);
    expect(state.aliases.slice(1)).toEqual([remote("a/b"), remote("x/y")]);
    expect(state.aliases[0]?.startsWith("path:")).toBe(true);
    disable(widgets);
    expect(projectState(db, widgets).disabled).toBe(true);
  });

  test("an id no project has is not known", () => {
    expect(projectState(db, 999)).toEqual({ known: false, disabled: false, aliases: [] });
  });
});

describe("previewLevel", () => {
  test("a later level than the one in force widens, an earlier or the same one does not", () => {
    const widgets = project("widgets", remote("x/y"));
    expect(previewLevel(policy(), widgets, "knowledge")).toEqual({
      current: "local",
      widened: true,
    });
    expect(previewLevel(policy(), widgets, "local")).toEqual({ current: "local", widened: false });

    set(widgets, "knowledge");
    expect(previewLevel(policy(), widgets, "all")).toEqual({ current: "knowledge", widened: true });
    expect(previewLevel(policy(), widgets, "knowledge")).toEqual({
      current: "knowledge",
      widened: false,
    });

    set(widgets, "all");
    expect(previewLevel(policy(), widgets, "local")).toEqual({ current: "all", widened: false });
    expect(previewLevel(policy(), widgets, "knowledge")).toEqual({
      current: "all",
      widened: false,
    });
  });

  test("a level that reads local is previewed as local", () => {
    const widgets = project("widgets", remote("x/y"));
    set(widgets, "all");
    disable(widgets);
    expect(previewLevel(policy(), widgets, "knowledge")).toEqual({
      current: "local",
      widened: true,
    });
    expect(previewLevel(policy(), 999, "knowledge")).toEqual({ current: "local", widened: true });
  });
});

describe("setLevel: what it refuses", () => {
  test("a project without a git remote cannot be set above local", () => {
    const plain = project("plain");
    expect(set(plain, "knowledge")).toEqual({ ok: false, reason: "no-remote" });
    expect(set(plain, "all")).toEqual({ ok: false, reason: "no-remote" });
    // Nobody is asked to confirm what would then be refused: this comes first.
    expect(set(plain, "knowledge", { confirm: false })).toEqual({
      ok: false,
      reason: "no-remote",
    });
    expect(levelRows(db)).toEqual([]);
    expect(changes()).toEqual([]);
    expect(counterOf(db)).toBe(0);
  });

  test("a widening without confirm is refused and nothing is written", () => {
    const widgets = project("widgets", remote("x/y"));
    expect(set(widgets, "knowledge", { confirm: false })).toEqual({
      ok: false,
      reason: "needs-confirm",
    });
    expect(set(widgets, "all", { confirm: false })).toEqual({ ok: false, reason: "needs-confirm" });
    expect(levelRows(db)).toEqual([]);
    expect(changes()).toEqual([]);
    expect(counterOf(db)).toBe(0);
  });

  test("a disabled project cannot be set above local", () => {
    const widgets = project("widgets", remote("x/y"));
    disable(widgets);
    expect(set(widgets, "knowledge")).toEqual({ ok: false, reason: "disabled" });
    expect(set(widgets, "knowledge", { confirm: false })).toEqual({
      ok: false,
      reason: "disabled",
    });
    expect(levelRows(db)).toEqual([]);
    expect(counterOf(db)).toBe(0);
  });

  test("an id no project has is refused", () => {
    expect(set(999, "knowledge")).toEqual({ ok: false, reason: "no-project" });
    expect(set(999, "knowledge", { confirm: false })).toEqual({ ok: false, reason: "no-project" });
    expect(set(0, "local")).toEqual({ ok: false, reason: "no-project" });
  });

  test("a level that is not one of the three is refused", () => {
    const widgets = project("widgets", remote("x/y"));
    expect(set(widgets, "wide" as Level)).toEqual({ ok: false, reason: "invalid" });
    expect(levelRows(db)).toEqual([]);
  });

  test("the refusals come in one order: the level, the project, memory off, no remote, then the confirmation", () => {
    const plain = project("plain");
    disable(plain);
    const unconfirmed = { confirm: false };
    expect(set(999, "wide" as Level, unconfirmed)).toEqual({ ok: false, reason: "invalid" });
    expect(set(999, "knowledge", unconfirmed)).toEqual({ ok: false, reason: "no-project" });
    // Memory off and no remote: memory off is said first.
    expect(set(plain, "knowledge", unconfirmed)).toEqual({ ok: false, reason: "disabled" });
    db.run("UPDATE projects SET disabled = 0 WHERE id = ?", [plain]);
    expect(set(plain, "knowledge", unconfirmed)).toEqual({ ok: false, reason: "no-remote" });
    addAlias(plain, remote("p/q"));
    expect(set(plain, "knowledge", unconfirmed)).toEqual({ ok: false, reason: "needs-confirm" });
    expect(set(plain, "knowledge")).toMatchObject({ ok: true, boundAlias: remote("p/q") });
  });

  test("a destination that is not configured is not written for", () => {
    const widgets = project("widgets", remote("x/y"));
    expect(() => set(widgets, "knowledge", { destination: "other" })).toThrow("other");
    expect(() => set(widgets, "local", { destination: "other" })).toThrow("other");
    expect(levelRows(db)).toEqual([]);
    expect(counterOf(db)).toBe(0);
  });
});

describe("setLevel: what it writes", () => {
  test("a confirmed level is stored bound to the project's remote alias, logged and counted", () => {
    const widgets = project("widgets", remote("x/y"));
    expect(set(widgets, "knowledge", { source: "viewer", now: 77 })).toEqual({
      ok: true,
      old: "local",
      widened: true,
      boundAlias: remote("x/y"),
      rebound: false,
    });
    expect(levelRows(db)).toEqual([
      {
        projectId: widgets,
        destination: "team",
        level: "knowledge",
        boundAlias: remote("x/y"),
        setAt: 77,
        source: "viewer",
      },
    ]);
    expect(changes()).toEqual([
      { what: `project:${widgets}`, old: "local", new: "knowledge", source: "viewer", at: 77 },
    ]);
    expect(counterOf(db)).toBe(1);
    expect(levelOf(policy(), widgets, "team")).toEqual({ level: "knowledge", reason: "allowed" });
  });

  test("going up widens and needs confirm; going down does neither; each change counts once", () => {
    const widgets = project("widgets", remote("x/y"));
    set(widgets, "knowledge");
    expect(set(widgets, "all", { confirm: false })).toEqual({ ok: false, reason: "needs-confirm" });
    expect(set(widgets, "all")).toEqual({
      ok: true,
      old: "knowledge",
      widened: true,
      boundAlias: remote("x/y"),
      rebound: false,
    });
    expect(counterOf(db)).toBe(2);
    expect(set(widgets, "knowledge", { confirm: false, now: 2000 })).toEqual({
      ok: true,
      old: "all",
      widened: false,
      boundAlias: remote("x/y"),
      rebound: false,
    });
    expect(counterOf(db)).toBe(3);
    expect(levelRows(db).map((row) => [row.level, row.setAt])).toEqual([["knowledge", 2000]]);
    expect(changes().map((change) => [change.old, change.new])).toEqual([
      ["local", "knowledge"],
      ["knowledge", "all"],
      ["all", "knowledge"],
    ]);
  });

  test("the same level twice writes nothing and logs nothing", () => {
    const widgets = project("widgets", remote("x/y"));
    set(widgets, "knowledge", { now: 77 });
    expect(set(widgets, "knowledge", { confirm: false, source: "viewer" })).toEqual({
      ok: true,
      old: "knowledge",
      widened: false,
      boundAlias: remote("x/y"),
      rebound: false,
    });
    expect(changes()).toHaveLength(1);
    expect(counterOf(db)).toBe(1);
    expect(levelRows(db).map((row) => [row.setAt, row.source])).toEqual([[77, "cli"]]);

    // Nothing, twice, on a project that never had a level.
    const gears = project("gears", remote("g/h"));
    expect(set(gears, "local", { confirm: false })).toEqual({
      ok: true,
      old: "local",
      widened: false,
      boundAlias: "",
      rebound: false,
    });
    expect(changes()).toHaveLength(1);
    expect(counterOf(db)).toBe(1);
  });

  test("local deletes the row, logs it, and answers no alias", () => {
    const widgets = project("widgets", remote("x/y"));
    set(widgets, "all");
    expect(set(widgets, "local", { confirm: false, now: 2000 })).toEqual({
      ok: true,
      old: "all",
      widened: false,
      boundAlias: "",
      rebound: false,
    });
    expect(levelRows(db)).toEqual([]);
    expect(changes().at(-1)).toEqual({
      what: `project:${widgets}`,
      old: "all",
      new: "local",
      source: "cli",
      at: 2000,
    });
    expect(counterOf(db)).toBe(2);
    expect(levelOf(policy(), widgets, "team")).toEqual({ level: "local", reason: "level-local" });
  });

  test("a project without a remote, or disabled, can still be set to local", () => {
    const widgets = project("widgets", remote("x/y"));
    set(widgets, "all");
    disable(widgets);
    // The stored level reads local while the project is disabled; choosing Nothing removes
    // it for good, so that enabling the project again does not bring it back.
    expect(set(widgets, "local", { confirm: false })).toEqual({
      ok: true,
      old: "local",
      widened: false,
      boundAlias: "",
      rebound: false,
    });
    expect(levelRows(db)).toEqual([]);
    expect(changes().at(-1)).toMatchObject({
      what: `project:${widgets}`,
      old: "all",
      new: "local",
    });
    expect(counterOf(db)).toBe(2);

    const plain = project("plain");
    expect(set(plain, "local")).toMatchObject({ ok: true, old: "local", boundAlias: "" });
  });

  test("a row stored at local already says Nothing: it is neither removed nor logged, and is written over", () => {
    const widgets = project("widgets", remote("x/y"));
    db.run(
      `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
       VALUES (?, 'team', 'local', ?, 5, 'cli')`,
      [widgets, remote("x/y")],
    );
    expect(set(widgets, "local", { confirm: false })).toEqual({
      ok: true,
      old: "local",
      widened: false,
      boundAlias: "",
      rebound: false,
    });
    expect(changes()).toEqual([]);
    expect(counterOf(db)).toBe(0);

    expect(set(widgets, "knowledge", { confirm: false })).toEqual({
      ok: false,
      reason: "needs-confirm",
    });
    expect(set(widgets, "knowledge")).toEqual({
      ok: true,
      old: "local",
      widened: true,
      boundAlias: remote("x/y"),
      rebound: false,
    });
    expect(levelRows(db).map((row) => row.level)).toEqual(["knowledge"]);
    expect(changes().map((change) => [change.old, change.new])).toEqual([["local", "knowledge"]]);
    expect(counterOf(db)).toBe(1);
  });
});

describe("setLevel: the alias a level is bound to", () => {
  const X = remote("x/y");
  const A = remote("a/b");

  test("the alias given, when it is the project's", () => {
    const widgets = project("widgets", X, A);
    expect(set(widgets, "knowledge", { remoteAlias: X })).toMatchObject({ boundAlias: X });
    expect(levelRows(db)[0]?.boundAlias).toBe(X);
  });

  test("the project's first remote alias by name, when the one given is not the project's", () => {
    const widgets = project("widgets", X, A);
    project("fork", remote("f/k"));
    expect(set(widgets, "knowledge", { remoteAlias: "remote:other" })).toMatchObject({
      boundAlias: A,
    });
    set(widgets, "local");
    // Another project's alias is not this project's.
    expect(set(widgets, "knowledge", { remoteAlias: remote("f/k") })).toMatchObject({
      boundAlias: A,
    });
  });

  test("the project's first remote alias by name, when none is given", () => {
    const widgets = project("widgets", X, A);
    expect(set(widgets, "knowledge")).toMatchObject({ boundAlias: A });
    set(widgets, "local");
    expect(set(widgets, "knowledge", { remoteAlias: null })).toMatchObject({ boundAlias: A });
  });

  test("never a path or a git directory: only a remote names a project for a team", () => {
    const plain = project("plain");
    const path = projectState(db, plain).aliases[0] as string;
    expect(path.startsWith("path:")).toBe(true);
    expect(set(plain, "knowledge", { remoteAlias: path })).toEqual({
      ok: false,
      reason: "no-remote",
    });
  });

  test("a change of level keeps the alias the level is bound to", () => {
    const widgets = project("widgets", X, A);
    set(widgets, "knowledge", { remoteAlias: X });
    expect(set(widgets, "all")).toMatchObject({ boundAlias: X, rebound: false });
    expect(levelRows(db)[0]?.boundAlias).toBe(X);
    // Unless the caller names another alias of the project.
    expect(set(widgets, "knowledge", { remoteAlias: A })).toMatchObject({ boundAlias: A });
    expect(levelRows(db)[0]?.boundAlias).toBe(A);
  });
});

describe("setLevel: what a caller saw earlier decides nothing", () => {
  test("a row removed since the caller looked: the widening is refused again", () => {
    const widgets = project("widgets", remote("x/y"));
    set(widgets, "all");
    const seen = policy();
    expect(previewLevel(seen, widgets, "all")).toEqual({ current: "all", widened: false });

    // Another process lowered it meanwhile.
    db.run("DELETE FROM sharing_levels WHERE project_id = ?", [widgets]);
    expect(set(widgets, "all", { confirm: false })).toEqual({ ok: false, reason: "needs-confirm" });
    expect(levelRows(db)).toEqual([]);
  });

  test("a project disabled since the caller looked: the write sees it as it is now", () => {
    const widgets = project("widgets", remote("x/y"));
    set(widgets, "knowledge");
    const seen = policy();
    expect(previewLevel(seen, widgets, "knowledge")).toEqual({
      current: "knowledge",
      widened: false,
    });

    disable(widgets);
    expect(set(widgets, "knowledge", { confirm: false })).toEqual({
      ok: false,
      reason: "disabled",
    });
    expect(set(widgets, "knowledge")).toEqual({ ok: false, reason: "disabled" });
    expect(levelRows(db).map((row) => row.level)).toEqual(["knowledge"]);
    expect(counterOf(db)).toBe(1);
  });

  test("an alias lost since the caller looked: setting the level it showed is a widening again", () => {
    const widgets = project("widgets", remote("x/y"));
    set(widgets, "knowledge");
    dropAlias(remote("x/y"));
    addAlias(widgets, remote("n/m"));
    expect(set(widgets, "knowledge", { confirm: false })).toEqual({
      ok: false,
      reason: "needs-confirm",
    });
    expect(levelRows(db)[0]?.boundAlias).toBe(remote("x/y"));
  });
});

describe("setLevel: a level whose alias is gone", () => {
  const OLD = remote("old/name");
  const NEW = remote("new/name");

  test("set again, it is bound to the alias the project has now, and logged as a rebind", () => {
    const widgets = project("widgets", OLD);
    set(widgets, "knowledge");
    dropAlias(OLD);
    addAlias(widgets, NEW);
    expect(levelOf(policy(), widgets, "team")).toEqual({ level: "local", reason: "unbound-alias" });

    // What leaves widens from nothing: it is confirmed like any widening.
    expect(set(widgets, "knowledge", { confirm: false })).toEqual({
      ok: false,
      reason: "needs-confirm",
    });
    expect(set(widgets, "knowledge", { now: 2000 })).toEqual({
      ok: true,
      old: "local",
      widened: true,
      boundAlias: NEW,
      rebound: true,
    });
    expect(levelRows(db)).toEqual([
      {
        projectId: widgets,
        destination: "team",
        level: "knowledge",
        boundAlias: NEW,
        setAt: 2000,
        source: "cli",
      },
    ]);
    expect(changes().at(-1)).toEqual({
      what: `project:${widgets}`,
      old: "rebind",
      new: "knowledge",
      source: "cli",
      at: 2000,
    });
    expect(counterOf(db)).toBe(2);
    expect(levelOf(policy(), widgets, "team")).toEqual({ level: "knowledge", reason: "allowed" });
  });

  test("set to another level, it is rebound as well", () => {
    const widgets = project("widgets", OLD);
    set(widgets, "knowledge");
    dropAlias(OLD);
    addAlias(widgets, NEW);
    expect(set(widgets, "all")).toEqual({
      ok: true,
      old: "local",
      widened: true,
      boundAlias: NEW,
      rebound: true,
    });
    expect(changes().at(-1)).toMatchObject({ old: "rebind", new: "all" });
  });

  test("with no remote left, it cannot be set again", () => {
    const widgets = project("widgets", OLD);
    set(widgets, "knowledge");
    dropAlias(OLD);
    expect(set(widgets, "knowledge")).toEqual({ ok: false, reason: "no-remote" });
    expect(levelRows(db)[0]?.boundAlias).toBe(OLD);
  });
});

describe("reconcileSettings", () => {
  test("records a hand edit of the file, once, with the file as its source", () => {
    writeEnv(`${ROOTS_KEY}=workspace`);
    expect(policy().problems).toContain(HAND_EDIT);

    expect(reconcileSettings(db, dir, NOW)).toEqual({ changed: ["roots"] });
    expect(changes()).toEqual([
      { what: "roots", old: "none", new: "workspace", source: "file", at: NOW },
    ]);
    expect(counterOf(db)).toBe(1);
    expect(settingsSeen(db)).toEqual({ roots: ["workspace"], areas: [] });
    expect(policy().problems).toEqual([]);

    // The file now equals the baseline: nothing more to record.
    expect(reconcileSettings(db, dir, NOW + 1)).toEqual({ changed: [] });
    expect(changes()).toHaveLength(1);
    expect(counterOf(db)).toBe(1);
  });

  test("both lists edited are two rows and one move of the counter", () => {
    writeEnv(`${ROOTS_KEY}=shared,workspace`, `${AREAS_KEY}=workspace:sales`);
    expect(reconcileSettings(db, dir, NOW)).toEqual({ changed: ["roots", "areas"] });
    expect(changes()).toEqual([
      { what: "roots", old: "none", new: "shared,workspace", source: "file", at: NOW },
      { what: "areas", old: "none", new: "workspace:sales", source: "file", at: NOW },
    ]);
    expect(counterOf(db)).toBe(1);
    expect(settingsSeen(db)).toEqual({
      roots: ["shared", "workspace"],
      areas: ["workspace:sales"],
    });
  });

  test("a list removed by hand is recorded too", () => {
    applySettingsPatch(db, dir, { [ROOTS_KEY]: "workspace" }, "cli", NOW, true);
    writeEnv();
    expect(reconcileSettings(db, dir, NOW + 1)).toEqual({ changed: ["roots"] });
    expect(changes().at(-1)).toEqual({
      what: "roots",
      old: "workspace",
      new: "none",
      source: "file",
      at: NOW + 1,
    });
    expect(counterOf(db)).toBe(2);
  });

  test("with the file as the viewer or the CLI left it, it writes nothing", () => {
    expect(reconcileSettings(db, dir, NOW)).toEqual({ changed: [] });
    applySettingsPatch(db, dir, { [ROOTS_KEY]: "workspace" }, "cli", NOW, true);
    expect(reconcileSettings(db, dir, NOW + 1)).toEqual({ changed: [] });
    expect(changes()).toHaveLength(1);
    expect(counterOf(db)).toBe(1);
  });

  test("two processes with different environments see one file and one baseline: neither writes", () => {
    applySettingsPatch(db, dir, { [ROOTS_KEY]: "shared,workspace" }, "cli", NOW, true);
    const narrowed = policy({ [ROOTS_KEY]: "workspace" });
    const plain = policy();
    expect(narrowed.settings.roots).toEqual(["workspace"]);
    expect(plain.settings.roots).toEqual(["shared", "workspace"]);
    expect(narrowed.fileLists).toEqual(plain.fileLists);
    expect(narrowed.problems).not.toContain(HAND_EDIT);
    expect(plain.problems).not.toContain(HAND_EDIT);

    // The reconcile reads the file, never a caller's narrowed lists.
    expect(reconcileSettings(db, dir, NOW + 1)).toEqual({ changed: [] });
    expect(reconcileSettings(db, dir, NOW + 2)).toEqual({ changed: [] });
    expect(changes()).toHaveLength(1);
    expect(counterOf(db)).toBe(1);
    expect(settingsSeen(db)).toEqual({ roots: ["shared", "workspace"], areas: [] });
  });
});

describe("reconcileLevels", () => {
  test("removes the level of a disabled project, logged as the system's", () => {
    const widgets = project("widgets", remote("x/y"));
    set(widgets, "knowledge");
    disable(widgets);
    expect(reconcileLevels(db, 2000)).toEqual({ removed: [widgets] });
    expect(levelRows(db)).toEqual([]);
    expect(changes().at(-1)).toEqual({
      what: `project:${widgets}`,
      old: "knowledge",
      new: "local",
      source: "system",
      at: 2000,
    });
    expect(counterOf(db)).toBe(2);

    // Enabled again, the project shares nothing until a person chooses again.
    db.run("UPDATE projects SET disabled = 0 WHERE id = ?", [widgets]);
    expect(levelOf(policy(), widgets, "team")).toEqual({ level: "local", reason: "level-local" });
    expect(policy().problems).toEqual([]);
  });

  test("removes a level whose alias the project lost", () => {
    const widgets = project("widgets", remote("x/y"));
    set(widgets, "all");
    dropAlias(remote("x/y"));
    expect(reconcileLevels(db, 2000)).toEqual({ removed: [widgets] });
    expect(levelRows(db)).toEqual([]);
    expect(changes().at(-1)).toEqual({
      what: `project:${widgets}`,
      old: "all",
      new: "local",
      source: "system",
      at: 2000,
    });
    expect(counterOf(db)).toBe(2);

    // The alias back, the level does not come back with it.
    addAlias(widgets, remote("x/y"));
    expect(levelOf(policy(), widgets, "team")).toEqual({ level: "local", reason: "level-local" });
  });

  test("several downgrades are one move of the counter", () => {
    const widgets = project("widgets", remote("x/y"));
    const gears = project("gears", remote("g/h"));
    const kept = project("kept", remote("k/l"));
    for (const id of [widgets, gears, kept]) set(id, "knowledge");
    disable(widgets);
    dropAlias(remote("g/h"));
    expect(reconcileLevels(db, 2000)).toEqual({ removed: [widgets, gears] });
    expect(levelRows(db).map((row) => row.projectId)).toEqual([kept]);
    expect(counterOf(db)).toBe(4);
  });

  test("with every level in force it writes nothing", () => {
    const widgets = project("widgets", remote("x/y"));
    set(widgets, "knowledge");
    expect(reconcileLevels(db, 2000)).toEqual({ removed: [] });
    expect(levelRows(db)).toHaveLength(1);
    expect(changes()).toHaveLength(1);
    expect(counterOf(db)).toBe(1);
    expect(reconcileLevels(db, 2000)).toEqual({ removed: [] });
  });

  test("a level downgraded in an earlier view, whose alias is back by now, is kept", () => {
    const widgets = project("widgets", remote("x/y"));
    set(widgets, "knowledge");
    dropAlias(remote("x/y"));
    expect(levelOf(policy(), widgets, "team")).toEqual({ level: "local", reason: "unbound-alias" });

    addAlias(widgets, remote("x/y"));
    expect(reconcileLevels(db, 2000)).toEqual({ removed: [] });
    expect(levelRows(db)).toHaveLength(1);
    expect(counterOf(db)).toBe(1);
    expect(levelOf(policy(), widgets, "team")).toEqual({ level: "knowledge", reason: "allowed" });
  });

  test("a level for a destination this version does not know is left alone", () => {
    const widgets = project("widgets", remote("x/y"));
    db.run(
      `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
       VALUES (?, 'other', 'all', ?, 5, 'cli')`,
      [widgets, remote("gone/gone")],
    );
    disable(widgets);
    expect(reconcileLevels(db, 2000)).toEqual({ removed: [] });
    expect(levelRows(db)).toHaveLength(1);
    expect(counterOf(db)).toBe(0);
  });
});
