// The store's writes that read a project's state: a level set, and the two reconciles.
// Projects are made by `resolveProject` on plain folders (no git: a `path:` alias only),
// and a `remote:` alias is given by hand where a case needs one.
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import { KNOWLEDGE_MIGRATIONS, KNOWLEDGE_MODULE } from "../../src/modules/knowledge/migrations.ts";
import { levelOf } from "../../src/sharing/levels.ts";
import { SHARING_MIGRATIONS, SHARING_MODULE } from "../../src/sharing/migrations.ts";
import { loadPolicy } from "../../src/sharing/policy.ts";
import {
  applySettingsPatch,
  counterOf,
  forgetName,
  levelRows,
  previewLevel,
  projectState,
  recentChanges,
  reconcileLevels,
  reconcileSettings,
  type SetLevelInput,
  setLevel,
  settingsSeen,
} from "../../src/sharing/store.ts";
import type { Level } from "../../src/sharing/types.ts";
import { DB_FILE, type Db, openDb } from "../../src/store/db.ts";

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
  as?: string | null;
  nameId?: string | null;
  dryRun?: boolean;
  recreated?: boolean;
  source?: SetLevelInput["source"];
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

const policy = (env: Record<string, string | undefined> = {}) => loadPolicy(db, dir, env);
const changes = () =>
  recentChanges(db, 50)
    .reverse()
    .map(({ what, old, new: next, source, at }) => ({ what, old, new: next, source, at }));
const writeEnv = (...lines: string[]) => writeFileSync(join(dir, "env"), `${lines.join("\n")}\n`);
const disable = (projectId: number) =>
  db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [projectId]);
/** The project's aliases a team could know it by: everything but the folder's own. */
const teamAliases = (projectId: number) =>
  projectState(db, projectId).aliases.filter((alias) => !alias.startsWith("path:"));
/** A confirmed server, so that the destinations are the servers (ADR 0027). */
const server = (serverId: string) =>
  db.run(
    `INSERT INTO sharing_servers (server_id, url, name, device_id, device_alias, member_id,
       member_name, role, contract, instance, confirmed_at, roots, areas, added_at)
     VALUES (?, ?, ?, 'd', 'laptop', 'm', 'Ana', 'member', 1, 'i', ?, '', '', ?)`,
    [serverId, `https://${serverId}.example.com`, serverId, NOW, NOW],
  );

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
  test("a project without a git remote or a shared name cannot be set above local", () => {
    const plain = project("plain");
    expect(set(plain, "knowledge")).toEqual({ ok: false, reason: "no-name" });
    expect(set(plain, "all")).toEqual({ ok: false, reason: "no-name" });
    // Nobody is asked to confirm what would then be refused: this comes first.
    expect(set(plain, "knowledge", { confirm: false })).toEqual({
      ok: false,
      reason: "no-name",
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

  test("the refusals come in one order: the level, the project, memory off, no name, then the confirmation", () => {
    const plain = project("plain");
    disable(plain);
    const unconfirmed = { confirm: false };
    expect(set(999, "wide" as Level, unconfirmed)).toEqual({ ok: false, reason: "invalid" });
    expect(set(999, "knowledge", unconfirmed)).toEqual({ ok: false, reason: "no-project" });
    // Memory off and no name: memory off is said first.
    expect(set(plain, "knowledge", unconfirmed)).toEqual({ ok: false, reason: "disabled" });
    db.run("UPDATE projects SET disabled = 0 WHERE id = ?", [plain]);
    expect(set(plain, "knowledge", unconfirmed)).toEqual({ ok: false, reason: "no-name" });
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
      named: false,
    });
    expect(levelRows(db)).toEqual([
      {
        projectId: widgets,
        destination: "team",
        level: "knowledge",
        boundAlias: remote("x/y"),
        setAt: 77,
        source: "viewer",
        nameId: null,
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
      named: false,
    });
    expect(counterOf(db)).toBe(2);
    expect(set(widgets, "knowledge", { confirm: false, now: 2000 })).toEqual({
      ok: true,
      old: "all",
      widened: false,
      boundAlias: remote("x/y"),
      rebound: false,
      named: false,
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
      named: false,
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
      named: false,
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
      named: false,
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
      named: false,
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
      named: false,
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
      named: false,
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
      reason: "no-name",
    });
  });

  test("only a host-led remote: a project whose remotes are local paths is refused", () => {
    const local = project(
      "local",
      "remote:/users/someone/repo",
      "remote:../other",
      "remote:c:\\x",
      "remote:server/repo",
    );
    for (const given of [undefined, "remote:/users/someone/repo"]) {
      expect(set(local, "knowledge", { remoteAlias: given })).toEqual({
        ok: false,
        reason: "no-name",
      });
    }
    expect(levelRows(db)).toEqual([]);
    expect(changes()).toEqual([]);
    expect(counterOf(db)).toBe(0);
  });

  test("a host-led remote beside a path remote is the one bound, also when the path is given", () => {
    const widgets = project("widgets", "remote:/users/someone/repo", X);
    expect(set(widgets, "knowledge", { remoteAlias: "remote:/users/someone/repo" })).toMatchObject({
      ok: true,
      boundAlias: X,
    });
    expect(levelRows(db)[0]?.boundAlias).toBe(X);
    set(widgets, "local");
    expect(set(widgets, "all")).toMatchObject({ ok: true, boundAlias: X });
  });

  test("a change of level keeps the alias the level is bound to", () => {
    const widgets = project("widgets", X, A);
    set(widgets, "knowledge", { remoteAlias: X });
    expect(set(widgets, "all")).toMatchObject({ boundAlias: X, rebound: false });
    expect(levelRows(db)[0]?.boundAlias).toBe(X);
    // Also when the caller names another alias of the project: the bound alias wins while
    // the project carries it (ADR 0028); after Nothing, the alias named binds.
    expect(set(widgets, "knowledge", { remoteAlias: A })).toMatchObject({ boundAlias: X });
    expect(levelRows(db)[0]?.boundAlias).toBe(X);
    set(widgets, "local");
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
      named: false,
    });
    expect(levelRows(db)).toEqual([
      {
        projectId: widgets,
        destination: "team",
        level: "knowledge",
        boundAlias: NEW,
        setAt: 2000,
        source: "cli",
        nameId: null,
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
      named: false,
    });
    expect(changes().at(-1)).toMatchObject({ old: "rebind", new: "all" });
  });

  test("with no remote left, it cannot be set again", () => {
    const widgets = project("widgets", OLD);
    set(widgets, "knowledge");
    dropAlias(OLD);
    expect(set(widgets, "knowledge")).toEqual({ ok: false, reason: "no-name" });
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

describe("setLevel: a shared name (ADR 0028)", () => {
  const NAME = "name:wizardingcode";
  const ID = "0123456789abcdef";
  const OTHER_ID = "fedcba9876543210";

  test("as on a project with a path alias alone inserts the name and binds the level to it, with the id", () => {
    const plain = project("plain");
    expect(set(plain, "knowledge", { as: NAME, nameId: ID, now: 77 })).toEqual({
      ok: true,
      old: "local",
      widened: true,
      boundAlias: NAME,
      rebound: false,
      named: true,
    });
    expect(teamAliases(plain)).toEqual([NAME]);
    expect(levelRows(db)).toEqual([
      {
        projectId: plain,
        destination: "team",
        level: "knowledge",
        boundAlias: NAME,
        setAt: 77,
        source: "cli",
        nameId: ID,
      },
    ]);
    expect(changes()).toEqual([
      { what: `project:${plain}`, old: "local", new: "knowledge", source: "cli", at: 77 },
    ]);
    expect(counterOf(db)).toBe(1);
    expect(levelOf(policy(), plain, "team")).toEqual({ level: "knowledge", reason: "allowed" });

    // The same call again writes nothing and names nothing.
    expect(set(plain, "knowledge", { as: NAME, nameId: ID, confirm: false })).toEqual({
      ok: true,
      old: "knowledge",
      widened: false,
      boundAlias: NAME,
      rebound: false,
      named: false,
    });
    expect(changes()).toHaveLength(1);
    expect(counterOf(db)).toBe(1);
  });

  test("on a server the log names the server", () => {
    server("s1");
    const plain = project("plain");
    expect(set(plain, "receive", { destination: "s1", as: NAME, nameId: ID })).toMatchObject({
      ok: true,
      boundAlias: NAME,
      named: true,
    });
    expect(changes()).toEqual([
      { what: `project:${plain}@s1`, old: "local", new: "receive", source: "cli", at: NOW },
    ]);
  });

  test("a level change without as keeps the name and its id, also after a remote is added", () => {
    const plain = project("plain");
    set(plain, "knowledge", { as: NAME, nameId: ID });
    expect(set(plain, "all")).toMatchObject({
      ok: true,
      boundAlias: NAME,
      rebound: false,
      named: false,
    });
    expect(levelRows(db)[0]).toMatchObject({ boundAlias: NAME, nameId: ID, level: "all" });
    addAlias(plain, remote("acme/x"));
    expect(set(plain, "knowledge", { confirm: false })).toMatchObject({
      ok: true,
      boundAlias: NAME,
      rebound: false,
    });
    expect(levelRows(db)[0]).toMatchObject({ boundAlias: NAME, nameId: ID, level: "knowledge" });
    // The folder's remote named by the caller does not move the binding either.
    expect(set(plain, "all", { remoteAlias: remote("acme/x") })).toMatchObject({
      ok: true,
      boundAlias: NAME,
    });
    expect(changes().map((change) => change.what)).toEqual(Array(4).fill(`project:${plain}`));
  });

  test("the refusals, in order: memory off, has-remote, renamed, name-taken, no-name, then the confirmation", () => {
    const plain = project("plain");
    disable(plain);
    expect(set(plain, "knowledge", { as: NAME, confirm: false })).toEqual({
      ok: false,
      reason: "disabled",
    });
    db.run("UPDATE projects SET disabled = 0 WHERE id = ?", [plain]);
    // A host-led remote and no name: the remote is the identity, a name is refused.
    addAlias(plain, remote("acme/x"));
    expect(set(plain, "knowledge", { as: NAME, confirm: false })).toEqual({
      ok: false,
      reason: "has-remote",
    });
    expect(set(plain, "knowledge", { as: NAME })).toEqual({ ok: false, reason: "has-remote" });
    dropAlias(remote("acme/x"));
    // Bound to a name above Nothing: another name is refused.
    set(plain, "knowledge", { as: NAME, nameId: ID });
    expect(set(plain, "knowledge", { as: "name:other", confirm: false })).toEqual({
      ok: false,
      reason: "renamed",
    });
    expect(set(plain, "all", { as: "name:other" })).toEqual({ ok: false, reason: "renamed" });
    // Another project's name is refused, naming that project.
    const gears = project("gears");
    expect(set(gears, "knowledge", { as: NAME })).toEqual({
      ok: false,
      reason: "name-taken",
      other: "plain",
    });
    // Nothing to bind to.
    expect(set(gears, "knowledge")).toEqual({ ok: false, reason: "no-name" });
    expect(set(gears, "knowledge", { confirm: false })).toEqual({ ok: false, reason: "no-name" });
    // A name binding without confirm, at every level.
    expect(set(gears, "receive", { as: "name:gears", confirm: false })).toEqual({
      ok: false,
      reason: "needs-confirm",
    });
    expect(set(gears, "knowledge", { as: "name:gears", confirm: false })).toEqual({
      ok: false,
      reason: "needs-confirm",
    });
    expect(teamAliases(gears)).toEqual([]);
    expect(levelRows(db)).toHaveLength(1);
    expect(teamAliases(plain)).toEqual([NAME]);
  });

  test("one-server comes before the confirmation, and renamed before one-server", () => {
    server("s1");
    server("s2");
    const plain = project("plain");
    set(plain, "knowledge", { destination: "s1", as: NAME, nameId: ID });
    expect(set(plain, "knowledge", { destination: "s2", as: NAME, confirm: false })).toEqual({
      ok: false,
      reason: "one-server",
      server: "s1",
    });
    expect(set(plain, "knowledge", { destination: "s2", as: "name:other" })).toEqual({
      ok: false,
      reason: "renamed",
    });
  });

  test("needs-confirm for a name binding: no row bound to it, or the re-created flag; bound to it, a no-op", () => {
    const plain = project("plain");
    expect(set(plain, "receive", { as: NAME, confirm: false })).toEqual({
      ok: false,
      reason: "needs-confirm",
    });
    expect(set(plain, "receive", { as: NAME, nameId: ID })).toMatchObject({
      ok: true,
      named: true,
    });
    // Bound to it: the same as again is a no-op, confirm or not.
    expect(set(plain, "receive", { as: NAME, confirm: false })).toEqual({
      ok: true,
      old: "receive",
      widened: false,
      boundAlias: NAME,
      rebound: false,
      named: false,
    });
    expect(changes()).toHaveLength(1);
    // The name was re-created on the server: joining it again is confirmed again, and the
    // write takes the new id.
    expect(set(plain, "receive", { as: NAME, recreated: true, confirm: false })).toEqual({
      ok: false,
      reason: "needs-confirm",
    });
    expect(levelRows(db)[0]?.nameId).toBe(ID);
    expect(
      set(plain, "receive", { as: NAME, nameId: OTHER_ID, recreated: true, now: 2000 }),
    ).toMatchObject({ ok: true, boundAlias: NAME, named: false });
    expect(levelRows(db)[0]).toMatchObject({ nameId: OTHER_ID, setAt: 2000 });
    expect(changes()).toHaveLength(2);
    expect(counterOf(db)).toBe(2);
  });

  test("dryRun answers the same outcomes, writes nothing, and never takes the write lock", () => {
    const plain = project("plain");
    const dry = { dryRun: true } as const;
    expect(set(plain, "knowledge", { as: NAME, confirm: false, ...dry })).toEqual({
      ok: false,
      reason: "needs-confirm",
    });
    expect(set(plain, "knowledge", { as: NAME, nameId: ID, ...dry })).toEqual({
      ok: true,
      old: "local",
      widened: true,
      boundAlias: NAME,
      rebound: false,
      named: true,
    });
    expect(set(plain, "knowledge", { ...dry })).toEqual({ ok: false, reason: "no-name" });
    expect(teamAliases(plain)).toEqual([]);
    expect(levelRows(db)).toEqual([]);
    expect(changes()).toEqual([]);
    expect(counterOf(db)).toBe(0);

    // A second connection holds the write lock: a dry run is a read and still answers at once.
    const other = new Database(join(dir, DB_FILE));
    other.run("BEGIN IMMEDIATE");
    const started = Date.now();
    try {
      expect(set(plain, "knowledge", { as: NAME, nameId: ID, ...dry })).toMatchObject({
        ok: true,
        named: true,
      });
      expect(set(plain, "local", { ...dry })).toMatchObject({ ok: true, old: "local" });
    } finally {
      other.run("ROLLBACK");
      other.close();
    }
    expect(Date.now() - started).toBeLessThan(1500);

    // The write after the dry run writes; a dry run of local then leaves the row.
    expect(set(plain, "knowledge", { as: NAME, nameId: ID })).toMatchObject({
      ok: true,
      named: true,
    });
    expect(set(plain, "local", { ...dry })).toMatchObject({ ok: true, old: "knowledge" });
    expect(levelRows(db)).toHaveLength(1);
    expect(counterOf(db)).toBe(1);
  });

  test("local removes the level and keeps the name; set again, the carried name binds", () => {
    const plain = project("plain");
    set(plain, "knowledge", { as: NAME, nameId: ID });
    expect(set(plain, "local", { confirm: false, now: 2000 })).toEqual({
      ok: true,
      old: "knowledge",
      widened: false,
      boundAlias: "",
      rebound: false,
      named: false,
    });
    expect(levelRows(db)).toEqual([]);
    expect(teamAliases(plain)).toEqual([NAME]);
    expect(set(plain, "knowledge", { confirm: false })).toEqual({
      ok: false,
      reason: "needs-confirm",
    });
    expect(set(plain, "knowledge", { nameId: ID })).toMatchObject({
      ok: true,
      boundAlias: NAME,
      named: false,
    });
    expect(levelRows(db)[0]).toMatchObject({ boundAlias: NAME, nameId: ID });
  });

  test("as with another name at Nothing replaces the name, logged once as name:<id>", () => {
    const plain = project("plain");
    set(plain, "knowledge", { as: "name:a", nameId: ID });
    set(plain, "local");
    expect(set(plain, "knowledge", { as: "name:b", nameId: OTHER_ID, now: 3000 })).toMatchObject({
      ok: true,
      boundAlias: "name:b",
      named: true,
    });
    expect(teamAliases(plain)).toEqual(["name:b"]);
    expect(levelRows(db)).toEqual([
      {
        projectId: plain,
        destination: "team",
        level: "knowledge",
        boundAlias: "name:b",
        setAt: 3000,
        source: "cli",
        nameId: OTHER_ID,
      },
    ]);
    expect(changes().slice(2)).toEqual([
      { what: `name:${plain}`, old: "name:a", new: "name:b", source: "cli", at: 3000 },
      { what: `project:${plain}`, old: "local", new: "knowledge", source: "cli", at: 3000 },
    ]);
    expect(counterOf(db)).toBe(3);
  });

  test("a malformed as is the caller's mistake", () => {
    const plain = project("plain");
    expect(() => set(plain, "knowledge", { as: "name:Bad" })).toThrow("name:Bad");
    expect(() => set(plain, "knowledge", { as: "wizardingcode" })).toThrow("wizardingcode");
    expect(levelRows(db)).toEqual([]);
  });
});

describe("forgetName", () => {
  const NAME = "name:wizardingcode";

  test("refused while a level above Nothing is stored, on the team default and on a server", () => {
    const plain = project("plain");
    set(plain, "knowledge", { as: NAME, nameId: "0123456789abcdef" });
    expect(forgetName(db, plain, NOW, "cli")).toEqual({ ok: false, reason: "name-bound" });
    set(plain, "local");
    server("s1");
    set(plain, "receive", { destination: "s1", as: NAME });
    expect(forgetName(db, plain, NOW, "cli")).toEqual({ ok: false, reason: "name-bound" });
    expect(teamAliases(plain)).toEqual([NAME]);
  });

  test("a project with no name, and an id no project has", () => {
    const plain = project("plain");
    expect(forgetName(db, plain, NOW, "cli")).toEqual({ ok: false, reason: "no-name" });
    expect(forgetName(db, 999, NOW, "cli")).toEqual({ ok: false, reason: "no-project" });
    expect(changes()).toEqual([]);
    expect(counterOf(db)).toBe(0);
  });

  test("otherwise deletes the row, logs name:<id> to nothing and counts once", () => {
    const plain = project("plain");
    set(plain, "knowledge", { as: NAME, nameId: "0123456789abcdef" });
    set(plain, "local");
    expect(forgetName(db, plain, 4000, "viewer")).toEqual({ ok: true, alias: NAME });
    expect(teamAliases(plain)).toEqual([]);
    expect(changes().at(-1)).toEqual({
      what: `name:${plain}`,
      old: NAME,
      new: "",
      source: "viewer",
      at: 4000,
    });
    expect(counterOf(db)).toBe(3);
    expect(forgetName(db, plain, 4001, "viewer")).toEqual({ ok: false, reason: "no-name" });
    expect(counterOf(db)).toBe(3);
  });
});

describe("levelRows on a store whose sharing namespace is older", () => {
  test("answers nameId null where the column is not there, and throws nothing", () => {
    const old = mkdtempSync(join(tmpdir(), "wizardingcode-mem-sharing-writes-old-"));
    const older = openDb({
      dataDir: old,
      busyTimeoutMs: 2000,
      moduleSchemas: [
        { module: KNOWLEDGE_MODULE, migrations: KNOWLEDGE_MIGRATIONS },
        { module: SHARING_MODULE, migrations: SHARING_MIGRATIONS.slice(0, 2) },
      ],
    });
    try {
      older.run("INSERT INTO projects (key, name, created_at) VALUES ('path:/p', 'p', 1)");
      older.run(
        "INSERT INTO project_aliases (alias, project_id) VALUES ('remote:github.com/a/b', 1)",
      );
      older.run(
        `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
         VALUES (1, 'team', 'knowledge', 'remote:github.com/a/b', 5, 'cli')`,
      );
      expect(levelRows(older)).toEqual([
        {
          projectId: 1,
          destination: "team",
          level: "knowledge",
          boundAlias: "remote:github.com/a/b",
          setAt: 5,
          source: "cli",
          nameId: null,
        },
      ]);
    } finally {
      older.close();
      rmSync(old, { recursive: true, force: true });
    }
  });
});
