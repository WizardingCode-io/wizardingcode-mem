import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderTaxonomy } from "../../src/modules/knowledge/entry.ts";
import { epochOf, levelKey, levelOf, policyWith } from "../../src/sharing/levels.ts";
import {
  areasInForce,
  closedPolicy,
  decide,
  isDefault,
  knownAreas,
  loadPolicy,
  resetSharingLog,
} from "../../src/sharing/policy.ts";
import { bumpCounter, COUNTER_KEY, SETTINGS_SEEN_KEY } from "../../src/sharing/store.ts";
import type {
  Decision,
  EntryItem,
  LedgerRecord,
  Level,
  LevelRow,
  MemoryItem,
  Reason,
  SharingPolicy,
} from "../../src/sharing/types.ts";
import { type Db, openDb, withWrite } from "../../src/store/db.ts";
import { setMeta } from "../../src/store/meta.ts";

const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS";
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS";
const HAND_EDIT =
  "the sharing settings changed outside the viewer and the CLI; open the Sharing page or run share status to record it";

// One folder is both the data directory (the env file, the taxonomies, the log) and the
// store directory.
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-sharing-policy-"));
  resetSharingLog();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const open = () => openDb({ dataDir: dir, busyTimeoutMs: 2000 });
const openBare = () => openDb({ dataDir: dir, busyTimeoutMs: 2000, moduleSchemas: [] });
const load = (db: Db | null, env: Record<string, string | undefined> = {}) =>
  loadPolicy(db, dir, env);
const writeEnv = (...lines: string[]) => writeFileSync(join(dir, "env"), `${lines.join("\n")}\n`);

/** A project row known by the given aliases. Returns its id. */
const addProject = (db: Database, name: string, ...aliases: string[]): number => {
  const id = db
    .query<{ id: number }, [string, string]>(
      "INSERT INTO projects (key, name, created_at) VALUES (?, ?, 1) RETURNING id",
    )
    .get(aliases[0] ?? `path:/work/${name}`, name)?.id as number;
  for (const alias of aliases) {
    db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [alias, id]);
  }
  return id;
};

/** A level row written by hand, as a person's choice would have left it. */
const addLevel = (
  db: Database,
  projectId: number,
  level: string,
  boundAlias: string,
  destination = "team",
) =>
  db.run(
    `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
     VALUES (?, ?, ?, ?, 5, 'cli')`,
    [projectId, destination, level, boundAlias],
  );

/** A root's taxonomy file, as the knowledge store writes it. */
const writeTaxonomy = (root: "workspace" | "shared", ...ids: string[]) => {
  const folder = join(dir, "knowledge", root);
  mkdirSync(folder, { recursive: true });
  const areas = ids.map((id) => ({ id, label: `${id.charAt(0).toUpperCase()}${id.slice(1)}` }));
  writeFileSync(
    join(folder, "taxonomy.md"),
    renderTaxonomy({ version: 1, updated: "2026-11-09T00:00:00.000Z", areas }),
  );
};

const WIDGETS = "remote:github.com/acme/widgets";

describe("loadPolicy: the store", () => {
  test("a store that never ran the sharing schema reads every default", () => {
    const db = openBare();
    const widgets = addProject(db, "widgets", WIDGETS);
    const gears = addProject(db, "gears", "path:/work/gears");
    const policy = load(db);
    expect(policy.closed).toBe(false);
    expect(policy.levels.size).toBe(0);
    expect(policy.problems).toEqual([]);
    expect(policy.projects).toEqual(new Set([widgets, gears]));
    expect([...policy.destinations]).toEqual(["team"]);
    expect(levelOf(policy, widgets, "team")).toEqual({ level: "local", reason: "level-local" });
    expect(isDefault(policy)).toBe(true);
    db.close();
  });

  test("a sharing schema newer than this binary closes the policy", () => {
    const db = open();
    const widgets = addProject(db, "widgets", WIDGETS);
    addLevel(db, widgets, "all", WIDGETS);
    db.run(
      "INSERT INTO module_migrations (module, version, name, applied_at) VALUES ('sharing', 3, 'x', 0)",
    );
    const policy = load(db);
    expect(policy.closed).toBe(true);
    expect(policy.problems).toEqual(["the sharing schema is newer than this binary"]);
    expect(policy.problems[0]).toContain("newer");
    expect(policy.levels.size).toBe(0);
    expect(policy.epoch).toBe(0);
    // Not a failure to read: nothing is logged.
    expect(existsSync(join(dir, "logs", "wizardingcode-mem.log"))).toBe(false);
    db.close();
  });

  test("with no database there is no project and no level, and nothing throws", () => {
    writeEnv(`${ROOTS_KEY}=workspace`, `${AREAS_KEY}=workspace:sales`);
    const policy = load(null);
    expect(policy.closed).toBe(false);
    expect(policy.levels.size).toBe(0);
    expect(policy.projects.size).toBe(0);
    // The settings still read: the roots in force, and every area inert without a taxonomy.
    expect([...policy.roots]).toEqual(["workspace"]);
    expect(policy.areas.size).toBe(0);
    expect(policy.inert).toEqual(["workspace:sales"]);
    expect(policy.settings).toEqual({ roots: ["workspace"], areas: ["workspace:sales"] });
    expect(policy.epoch).toBe(epochOf(0, { roots: ["workspace"], areas: [] }));
  });

  test("a database that throws closes the policy, and is logged once per process", () => {
    const broken = {
      query: () => {
        throw new Error("boom");
      },
    } as unknown as Db;
    const log = join(dir, "logs", "wizardingcode-mem.log");
    const logged = () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line.includes("sharing") && line.includes("boom"));

    writeEnv(`${ROOTS_KEY}=workspace`);
    const policy = load(broken);
    expect(policy.closed).toBe(true);
    expect(policy.problems).toHaveLength(1);
    expect(policy.problems[0]).toContain("boom");
    expect(policy.epoch).toBe(0);
    expect(policy.roots.size).toBe(0);
    expect(policy.areas.size).toBe(0);
    expect(policy.levels.size).toBe(0);
    expect(policy.projects.size).toBe(0);
    expect(policy.destinations.size).toBe(0);
    expect(policy.settings).toEqual({ roots: [], areas: [] });

    expect(load(broken).closed).toBe(true);
    expect(logged()).toHaveLength(1);

    // The flag is the process's: cleared, the next failure is logged again.
    resetSharingLog();
    load(broken);
    expect(logged()).toHaveLength(2);
  });
});

describe("loadPolicy: the levels", () => {
  test("a level bound to an alias the project still has is in force", () => {
    const db = open();
    const widgets = addProject(db, "widgets", WIDGETS, "path:/work/widgets");
    const gears = addProject(db, "gears", "path:/work/gears");
    addLevel(db, widgets, "knowledge", WIDGETS);
    const policy = load(db);
    expect(policy.levels.get(levelKey(widgets, "team"))).toEqual({
      projectId: widgets,
      destination: "team",
      level: "knowledge",
      boundAlias: WIDGETS,
      reason: "allowed",
    });
    expect(levelOf(policy, widgets, "team")).toEqual({ level: "knowledge", reason: "allowed" });
    expect(policy.problems).toEqual([]);
    // A known project with no row shares nothing; an id nobody knows has no project.
    expect(levelOf(policy, gears, "team")).toEqual({ level: "local", reason: "level-local" });
    expect(levelOf(policy, 999, "team")).toEqual({ level: "local", reason: "no-project" });
    expect(levelOf(policy, 0, "team")).toEqual({ level: "local", reason: "no-project" });
    db.close();
  });

  test("a disabled project's level reads local, with a problem naming the project", () => {
    const db = open();
    const widgets = addProject(db, "widgets", WIDGETS);
    addLevel(db, widgets, "knowledge", WIDGETS);
    db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [widgets]);
    const policy = load(db);
    expect(policy.levels.get(levelKey(widgets, "team"))).toEqual({
      projectId: widgets,
      destination: "team",
      level: "local",
      boundAlias: WIDGETS,
      reason: "disabled",
    });
    expect(levelOf(policy, widgets, "team")).toEqual({ level: "local", reason: "disabled" });
    expect(policy.problems).toEqual([
      "memory is off for widgets; its level is Nothing until you turn memory on and set it again",
    ]);
    db.close();
  });

  test("a level whose alias the project lost reads local, with a problem naming the project", () => {
    const db = open();
    const widgets = addProject(db, "widgets", WIDGETS, "path:/work/widgets");
    addLevel(db, widgets, "all", WIDGETS);
    db.run("DELETE FROM project_aliases WHERE alias = ?", [WIDGETS]);
    const policy = load(db);
    expect(levelOf(policy, widgets, "team")).toEqual({ level: "local", reason: "unbound-alias" });
    expect(policy.levels.get(levelKey(widgets, "team"))?.boundAlias).toBe(WIDGETS);
    expect(policy.problems).toEqual([
      "widgets lost the git remote its level was bound to; its level is Nothing until you set it again",
    ]);
    db.close();
  });

  test("an alias that now names another project is lost too", () => {
    const db = open();
    const widgets = addProject(db, "widgets", "path:/work/widgets");
    addProject(db, "fork", WIDGETS);
    addLevel(db, widgets, "all", WIDGETS);
    expect(levelOf(load(db), widgets, "team")).toEqual({
      level: "local",
      reason: "unbound-alias",
    });
    db.close();
  });

  test("a row whose project is gone is dropped", () => {
    const db = open();
    addLevel(db, 999, "all", "remote:github.com/acme/gone");
    const policy = load(db);
    expect(policy.levels.size).toBe(0);
    expect(policy.problems).toEqual([]);
    expect(levelOf(policy, 999, "team")).toEqual({ level: "local", reason: "no-project" });
    db.close();
  });

  test("a level this version does not know reads local, with a problem", () => {
    const db = open();
    const widgets = addProject(db, "widgets", WIDGETS);
    addLevel(db, widgets, "wide", WIDGETS);
    const policy = load(db);
    expect(levelOf(policy, widgets, "team")).toEqual({ level: "local", reason: "level-local" });
    expect(policy.problems).toEqual([
      "widgets has a level this version does not know; its level is Nothing until you set it again",
    ]);
    db.close();
  });

  test("a row stored at local reads as no row does, and is no problem", () => {
    const db = open();
    const widgets = addProject(db, "widgets", WIDGETS);
    addLevel(db, widgets, "local", WIDGETS);
    const policy = load(db);
    expect(levelOf(policy, widgets, "team")).toEqual({ level: "local", reason: "level-local" });
    expect(policy.problems).toEqual([]);
    expect(isDefault(policy)).toBe(true);
    db.close();
  });

  test("levels are kept per destination: a row for another one does not stand for the team's", () => {
    const db = open();
    const widgets = addProject(db, "widgets", WIDGETS);
    addLevel(db, widgets, "all", WIDGETS, "other");
    const policy = load(db);
    expect(levelOf(policy, widgets, "team")).toEqual({ level: "local", reason: "level-local" });
    expect(levelOf(policy, widgets, "other")).toEqual({
      level: "local",
      reason: "unknown-destination",
    });
    expect(policy.levels.has(`${widgets}@other`)).toBe(true);
    expect(policy.levels.has(`${widgets}@team`)).toBe(false);
    expect(policy.levels.get(`${widgets}@other`)?.level).toBe("local");
    expect(policy.problems).toEqual([]);

    addLevel(db, widgets, "knowledge", WIDGETS);
    const both = load(db);
    expect(levelOf(both, widgets, "team")).toEqual({ level: "knowledge", reason: "allowed" });
    expect(both.levels.size).toBe(2);
    db.close();
  });
});

describe("loadPolicy: the roots and the areas", () => {
  const AREAS = "workspace:sales,workspace:legal,shared:ops";
  const ALL = ["shared:ops", "workspace:legal", "workspace:sales"];

  test("an area is in force only when its root's taxonomy holds it", () => {
    writeEnv(`${ROOTS_KEY}=shared,workspace`, `${AREAS_KEY}=${AREAS}`);
    writeTaxonomy("workspace", "sales", "marketing");
    const db = open();
    const policy = load(db);
    expect([...policy.roots].sort()).toEqual(["shared", "workspace"]);
    expect([...policy.areas]).toEqual(["workspace:sales"]);
    // No shared taxonomy file: every shared id is inert.
    expect(policy.inert).toEqual(["shared:ops", "workspace:legal"]);
    expect(policy.settings).toEqual({ roots: ["shared", "workspace"], areas: ALL });
    expect(policy.fileLists).toEqual({ roots: ["shared", "workspace"], areas: ALL });
    expect(policy.problems).toContain(
      "areas not in the taxonomy, ignored: shared:ops, workspace:legal",
    );
    db.close();
  });

  test("the environment narrows the lists in force, never the file's own", () => {
    writeEnv(`${AREAS_KEY}=${AREAS}`);
    writeTaxonomy("workspace", "sales", "marketing");
    const db = open();
    const policy = load(db, { [AREAS_KEY]: "workspace:sales" });
    expect(policy.settings.areas).toEqual(["workspace:sales"]);
    expect(policy.fileLists.areas).toEqual(ALL);
    expect([...policy.areas]).toEqual(["workspace:sales"]);
    expect(policy.inert).toEqual([]);
    db.close();
  });

  test("what the settings emptied or ignored is a problem of the policy", () => {
    writeEnv(`${ROOTS_KEY}=workspace,everything`);
    const db = open();
    const policy = load(db, { [AREAS_KEY]: "workspace:sales" });
    expect(policy.roots.size).toBe(0);
    expect(policy.problems).toEqual([
      `${ROOTS_KEY}: token 2 is not a root; the list was emptied`,
      `the environment's ${AREAS_KEY} names 1 more than the file; ignored`,
    ]);
    db.close();
  });

  test("knownAreas reads each root's taxonomy, and is null where none can be read", () => {
    expect(knownAreas(dir)).toEqual({ workspace: null, shared: null });
    writeTaxonomy("workspace", "sales", "marketing");
    mkdirSync(join(dir, "knowledge", "shared"), { recursive: true });
    writeFileSync(join(dir, "knowledge", "shared", "taxonomy.md"), "not a taxonomy\n");
    expect(knownAreas(dir)).toEqual({
      workspace: [
        { id: "sales", label: "Sales" },
        { id: "marketing", label: "Marketing" },
      ],
      shared: null,
    });
  });

  test("areasInForce parts the listed ids by their root's taxonomy", () => {
    const sales = [{ id: "sales", label: "Sales" }];
    expect(
      areasInForce(["shared:sales", "workspace:legal", "workspace:sales"], {
        workspace: sales,
        shared: null,
      }),
    ).toEqual({ areas: ["workspace:sales"], inert: ["shared:sales", "workspace:legal"] });
    expect(areasInForce([], { workspace: sales, shared: sales })).toEqual({
      areas: [],
      inert: [],
    });
  });

  test("a taxonomy behind a link is not read", () => {
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(join(dir, "knowledge"));
    writeFileSync(
      join(elsewhere, "taxonomy.md"),
      renderTaxonomy({
        version: 1,
        updated: "2026-11-09T00:00:00.000Z",
        areas: [{ id: "sales", label: "Sales" }],
      }),
    );
    symlinkSync(elsewhere, join(dir, "knowledge", "workspace"));
    expect(knownAreas(dir).workspace).toBeNull();
  });
});

describe("loadPolicy: the epoch and the baseline", () => {
  test("the epoch is the counter over the lists in force: it moves with either", () => {
    writeEnv(`${ROOTS_KEY}=workspace`);
    const db = open();
    setMeta(db, COUNTER_KEY, "3");
    const policy = load(db);
    expect(policy.epoch).toBe(epochOf(3, { roots: ["workspace"], areas: [] }));
    expect(policy.epoch).toBe(epochOf(3, policy.settings));
    expect(load(db).epoch).toBe(policy.epoch);

    // A hand edit of the file moves it with no write.
    writeEnv(`${ROOTS_KEY}=workspace,shared`);
    const edited = load(db);
    expect(edited.epoch).not.toBe(policy.epoch);
    expect(edited.epoch).toBe(epochOf(3, { roots: ["shared", "workspace"], areas: [] }));

    // So does an environment that narrows.
    expect(load(db, { [ROOTS_KEY]: "workspace" }).epoch).toBe(policy.epoch);

    withWrite(db, () => bumpCounter(db));
    const counted = load(db);
    expect(counted.epoch).not.toBe(edited.epoch);
    expect(counted.epoch).toBe(epochOf(4, counted.settings));
    db.close();
  });

  test("the epoch covers the areas in force: an inert id moves it when its area is added", () => {
    writeEnv(`${ROOTS_KEY}=workspace`, `${AREAS_KEY}=workspace:legal,workspace:sales`);
    writeTaxonomy("workspace", "sales");
    const db = open();
    setMeta(db, COUNTER_KEY, "3");
    const policy = load(db);
    expect(policy.inert).toEqual(["workspace:legal"]);
    expect(policy.settings.areas).toEqual(["workspace:legal", "workspace:sales"]);
    expect(policy.epoch).toBe(epochOf(3, { roots: ["workspace"], areas: ["workspace:sales"] }));
    expect(policy.epoch).not.toBe(epochOf(3, policy.settings));

    // The area added to the taxonomy: the same lists and counter let more leave.
    writeTaxonomy("workspace", "sales", "legal");
    const added = load(db);
    expect(added.inert).toEqual([]);
    expect(added.settings).toEqual(policy.settings);
    expect(added.epoch).not.toBe(policy.epoch);
    expect(added.epoch).toBe(epochOf(3, added.settings));
    expect(added.epoch).toBe(
      epochOf(3, { roots: ["workspace"], areas: ["workspace:legal", "workspace:sales"] }),
    );
    db.close();
  });

  test("a file that differs from the baseline was edited by hand: a problem until recorded", () => {
    writeEnv(`${ROOTS_KEY}=workspace`);
    const db = open();
    const policy = load(db);
    expect(policy.settingsSeen).toEqual({ roots: [], areas: [] });
    expect(policy.fileLists).toEqual({ roots: ["workspace"], areas: [] });
    expect(policy.problems).toEqual([HAND_EDIT]);
    expect(policy.problems[0]?.startsWith("the sharing settings changed outside the viewer")).toBe(
      true,
    );

    setMeta(db, SETTINGS_SEEN_KEY, JSON.stringify({ roots: ["workspace"], areas: [] }));
    const recorded = load(db);
    expect(recorded.settingsSeen).toEqual({ roots: ["workspace"], areas: [] });
    expect(recorded.problems).toEqual([]);
    // The file is compared, not the lists in force: a narrowing environment is no hand edit.
    expect(load(db, { [ROOTS_KEY]: "none" }).problems).toEqual([]);

    // A list removed by hand is an edit too.
    writeEnv();
    expect(load(db).problems).toEqual([HAND_EDIT]);
    db.close();
  });
});

describe("isDefault", () => {
  test("is true on a fresh store", () => {
    const db = open();
    addProject(db, "widgets", WIDGETS);
    expect(isDefault(load(db))).toBe(true);
    db.close();
  });

  test("is false with one root, one area, one level above local, or one problem", () => {
    expect(isDefault(policyWith({}))).toBe(true);
    expect(isDefault(policyWith({ roots: new Set(["workspace"]) }))).toBe(false);
    expect(isDefault(policyWith({ areas: new Set(["workspace:sales"]) }))).toBe(false);
    expect(isDefault(policyWith({ problems: ["something"] }))).toBe(false);
    const row = (level: Level, reason: Reason): LevelRow => ({
      projectId: 1,
      destination: "team",
      level,
      boundAlias: WIDGETS,
      reason,
    });
    const withLevel = (level: Level, reason: Reason) =>
      policyWith({ projects: new Set([1]), levels: new Map([["1@team", row(level, reason)]]) });
    expect(isDefault(withLevel("knowledge", "allowed"))).toBe(false);
    expect(isDefault(withLevel("all", "allowed"))).toBe(false);
    // A row that reads local lets nothing leave.
    expect(isDefault(withLevel("local", "unknown-destination"))).toBe(true);
    expect(isDefault(closedPolicy("it failed"))).toBe(false);
  });

  test("is false on a store with one root in force", () => {
    writeEnv(`${ROOTS_KEY}=workspace`);
    const db = open();
    setMeta(db, SETTINGS_SEEN_KEY, JSON.stringify({ roots: ["workspace"], areas: [] }));
    const policy = load(db);
    expect(policy.problems).toEqual([]);
    expect(isDefault(policy)).toBe(false);
    db.close();
  });
});

describe("closedPolicy", () => {
  test("is closed, empty, with the one problem", () => {
    const policy = closedPolicy("it failed");
    expect(policy.closed).toBe(true);
    expect(policy.epoch).toBe(0);
    expect(policy.problems).toEqual(["it failed"]);
    expect(policy.destinations.size).toBe(0);
    expect(policy.projects.size).toBe(0);
    expect(policy.roots.size).toBe(0);
    expect(policy.areas.size).toBe(0);
    expect(policy.inert).toEqual([]);
    expect(policy.settings).toEqual({ roots: [], areas: [] });
    expect(policy.fileLists).toEqual({ roots: [], areas: [] });
    expect(policy.settingsSeen).toEqual({ roots: [], areas: [] });
    expect(policy.levels.size).toBe(0);
  });
});

// --- decide ---------------------------------------------------------------------------

const P = 7;
const Q = 8;
const DOWN = 9;
const EPOCH = 42;

const levelRow = (
  projectId: number,
  level: Level,
  reason: Reason = "allowed",
): [string, LevelRow] => [
  levelKey(projectId, "team"),
  { projectId, destination: "team", level, boundAlias: "remote:x", reason },
];

/** A policy over the known projects P, Q and DOWN, for the team destination. */
const policy = (parts: Partial<SharingPolicy> = {}): SharingPolicy =>
  policyWith({ epoch: EPOCH, projects: new Set([P, Q, DOWN]), ...parts });

const entry = (over: Partial<EntryItem> = {}): EntryItem => ({
  kind: "entry",
  uid: "workspace:u1",
  scope: "workspace",
  projectId: 0,
  area: "sales",
  status: "active",
  problem: null,
  version: 3,
  hash: "h1",
  ...over,
});

const memory = (over: Partial<MemoryItem> = {}): MemoryItem => ({
  kind: "memory",
  uid: "ab12cd34:5",
  projectId: P,
  status: "active",
  stale: false,
  scope: "project",
  origin: "distilled",
  isUserRule: false,
  version: 100,
  hash: "m1",
  ...over,
});

const record = (over: Partial<LedgerRecord> = {}): LedgerRecord => ({
  destination: "team",
  direction: "sent",
  version: 3,
  hash: "h1",
  withdrawnAt: null,
  ...over,
});

const ruling = (answer: Decision["answer"], reason: Reason): Decision => ({
  answer,
  reason,
  epoch: EPOCH,
});
const send = ruling("send", "allowed");
const keep = (reason: Reason) => ruling("keep", reason);

describe("decide: entries", () => {
  const workspaceSales = policy({
    roots: new Set(["workspace"]),
    areas: new Set(["workspace:sales"]),
    inert: ["workspace:legal"],
  });

  test("an active, problem-free workspace entry in an allowed area leaves", () => {
    expect(decide(workspaceSales, "team", entry(), [])).toEqual(send);
  });

  test("a draft, an archived entry and one with a problem stay", () => {
    expect(decide(workspaceSales, "team", entry({ status: "draft" }), [])).toEqual(keep("status"));
    expect(decide(workspaceSales, "team", entry({ status: "archived" }), [])).toEqual(
      keep("status"),
    );
    expect(decide(workspaceSales, "team", entry({ problem: "area is missing" }), [])).toEqual(
      keep("problem"),
    );
    // A file that cannot be read as an entry is a draft with a problem: the problem is why.
    expect(
      decide(workspaceSales, "team", entry({ status: "draft", problem: "no frontmatter" }), []),
    ).toEqual(keep("problem"));
  });

  test("with its root off it stays, whatever its area", () => {
    const rootOff = policy({ areas: new Set(["workspace:sales"]) });
    expect(decide(rootOff, "team", entry(), [])).toEqual(keep("root-off"));
    expect(decide(rootOff, "team", entry({ area: "finance" }), [])).toEqual(keep("root-off"));
  });

  test("an area that is not listed is private, and one listed in no taxonomy is inert", () => {
    expect(decide(workspaceSales, "team", entry({ area: "finance" }), [])).toEqual(
      keep("area-private"),
    );
    expect(decide(workspaceSales, "team", entry({ area: "legal" }), [])).toEqual(
      keep("area-inert"),
    );
  });

  test("the shared repository has its own root and its own areas", () => {
    const shared = entry({ uid: "shared:u2", scope: "shared" });
    const sharedSales = policy({ roots: new Set(["shared"]), areas: new Set(["shared:sales"]) });
    expect(decide(sharedSales, "team", shared, [])).toEqual(send);
    const workspaceOnly = policy({
      roots: new Set(["shared"]),
      areas: new Set(["workspace:sales"]),
    });
    expect(decide(workspaceOnly, "team", shared, [])).toEqual(keep("area-private"));
    expect(decide(workspaceSales, "team", shared, [])).toEqual(keep("root-off"));
    // And the workspace's entry does not leave under the shared repository's root.
    expect(decide(sharedSales, "team", entry(), [])).toEqual(keep("root-off"));
  });

  describe("a project's entry", () => {
    const inProject = (projectId: number) =>
      entry({ uid: "project:remote:x:u3", scope: "project", projectId });
    const areas = new Set(["workspace:sales"]);

    test("leaves with its project at knowledge or all, under the workspace's areas, no root needed", () => {
      for (const level of ["knowledge", "all"] as const) {
        const allowed = policy({ areas, levels: new Map([levelRow(P, level)]) });
        expect(decide(allowed, "team", inProject(P), [])).toEqual(send);
        expect(decide(allowed, "team", { ...inProject(P), area: "finance" }, [])).toEqual(
          keep("area-private"),
        );
      }
      // The shared repository's areas say nothing about a project's entries.
      const sharedAreas = policy({
        areas: new Set(["shared:sales"]),
        levels: new Map([levelRow(P, "knowledge")]),
      });
      expect(decide(sharedAreas, "team", inProject(P), [])).toEqual(keep("area-private"));
    });

    test("stays with its project at no level, even with the workspace root on", () => {
      const noLevel = policy({ roots: new Set(["workspace"]), areas });
      expect(decide(noLevel, "team", inProject(P), [])).toEqual(keep("level-local"));
    });

    test("stays with what downgraded its project's level, named as effectiveLevel named it", () => {
      const downgraded = (reason: Reason) =>
        policy({ areas, levels: new Map([levelRow(DOWN, "local", reason)]) });
      for (const reason of ["level-local", "disabled", "unbound-alias"] as const) {
        expect(decide(downgraded(reason), "team", inProject(DOWN), [])).toEqual(keep(reason));
        expect(decide(downgraded(reason), "team", memory({ projectId: DOWN }), [])).toEqual(
          keep(reason),
        );
      }
    });

    test("a local row that claims allowed is a broken rule, never read as Nothing", () => {
      // effectiveLevel never makes that pair. A policy built by hand with it must not get a
      // plausible refusal that hides the broken rule.
      const broken = policy({ areas, levels: new Map([levelRow(DOWN, "local", "allowed")]) });
      const names = new RegExp(`local.*allowed.*${DOWN}.*team`);
      expect(() => decide(broken, "team", inProject(DOWN), [])).toThrow(names);
      expect(() => decide(broken, "team", memory({ projectId: DOWN }), [])).toThrow(names);
    });

    test("stays when no project owns it", () => {
      const allowed = policy({ areas, levels: new Map([levelRow(P, "all")]) });
      expect(decide(allowed, "team", inProject(0), [])).toEqual(keep("no-project"));
      expect(decide(allowed, "team", inProject(999), [])).toEqual(keep("no-project"));
    });
  });
});

describe("decide: memories", () => {
  const atAll = policy({ levels: new Map([levelRow(P, "all")]) });

  test("an active memory of a project at all leaves", () => {
    expect(decide(atAll, "team", memory(), [])).toEqual(send);
    expect(decide(atAll, "team", memory({ origin: "manual" }), [])).toEqual(send);
  });

  test("at knowledge the memories stay, and at no level everything does", () => {
    const atKnowledge = policy({ levels: new Map([levelRow(P, "knowledge")]) });
    expect(decide(atKnowledge, "team", memory(), [])).toEqual(keep("level-knowledge"));
    expect(decide(policy(), "team", memory(), [])).toEqual(keep("level-local"));
    expect(decide(atAll, "team", memory({ projectId: Q }), [])).toEqual(keep("level-local"));
    expect(decide(atAll, "team", memory({ projectId: 999 }), [])).toEqual(keep("no-project"));
    const disabled = policy({ levels: new Map([levelRow(DOWN, "local", "disabled")]) });
    expect(decide(disabled, "team", memory({ projectId: DOWN }), [])).toEqual(keep("disabled"));
  });

  test("the meaning of all: active, not stale, the project's own, not imported, not a user rule", () => {
    const cases: [Partial<MemoryItem>, Reason][] = [
      [{ status: "archived" }, "status"],
      [{ stale: true }, "stale"],
      [{ scope: "branch" }, "branch-scope"],
      [{ origin: "imported" }, "imported"],
      [{ isUserRule: true }, "user-rule"],
    ];
    for (const [over, reason] of cases) {
      expect(decide(atAll, "team", memory(over), [])).toEqual(keep(reason));
    }
    // The level comes first: below all, that is the reason whatever the memory is.
    expect(decide(policy(), "team", memory({ status: "archived" }), [])).toEqual(
      keep("level-local"),
    );
  });
});

describe("decide: destinations", () => {
  test("a destination that is not configured gets nothing, whatever the policy allows", () => {
    const everything = policy({
      roots: new Set(["workspace", "shared"]),
      areas: new Set(["workspace:sales", "shared:sales"]),
      levels: new Map([levelRow(P, "all")]),
    });
    expect(decide(everything, "team", entry(), [])).toEqual(send);
    expect(decide(everything, "other", entry(), [])).toEqual(keep("unknown-destination"));
    expect(decide(everything, "other", memory(), [])).toEqual(keep("unknown-destination"));
    expect(decide(everything, "other", entry(), [record({ destination: "other" })])).toEqual(
      keep("unknown-destination"),
    );
  });
});

describe("decide: the ledger", () => {
  const allowed = policy({ roots: new Set(["workspace"]), areas: new Set(["workspace:sales"]) });
  const atAll = policy({ levels: new Map([levelRow(P, "all")]) });
  const privateArea = entry({ area: "finance" });

  test("what the server already has stays, whatever the versions", () => {
    expect(decide(allowed, "team", entry(), [record()])).toEqual(keep("already-sent"));
    expect(decide(allowed, "team", entry({ version: 9 }), [record({ version: 1 })])).toEqual(
      keep("already-sent"),
    );
    expect(decide(atAll, "team", memory(), [record({ hash: "m1" })])).toEqual(keep("already-sent"));
  });

  test("a changed item leaves again", () => {
    expect(decide(allowed, "team", entry({ hash: "h2" }), [record()])).toEqual(send);
  });

  test("a memory whose hash was not computed counts as changed", () => {
    expect(decide(atAll, "team", memory({ hash: null }), [record({ hash: "m1" })])).toEqual(send);
  });

  test("what was withdrawn leaves again once allowed", () => {
    expect(decide(allowed, "team", entry(), [record({ withdrawnAt: 50 })])).toEqual(send);
  });

  test("what the policy no longer allows is withdrawn, once", () => {
    expect(decide(allowed, "team", privateArea, [record()])).toEqual(
      ruling("withdraw", "area-private"),
    );
    expect(decide(allowed, "team", privateArea, [record({ hash: "older" })])).toEqual(
      ruling("withdraw", "area-private"),
    );
    expect(decide(allowed, "team", privateArea, [record({ withdrawnAt: 50 })])).toEqual(
      keep("area-private"),
    );
    expect(decide(allowed, "team", privateArea, [])).toEqual(keep("area-private"));
    const atKnowledge = policy({ levels: new Map([levelRow(P, "knowledge")]) });
    expect(decide(atKnowledge, "team", memory(), [record({ hash: "m1" })])).toEqual(
      ruling("withdraw", "level-knowledge"),
    );
  });

  test("what was sent to another destination says nothing about this one", () => {
    expect(decide(allowed, "team", entry(), [record({ destination: "other" })])).toEqual(send);
    expect(decide(allowed, "team", privateArea, [record({ destination: "other" })])).toEqual(
      keep("area-private"),
    );
  });

  test("the unchanged version received from this destination is never echoed back", () => {
    const received = record({ direction: "received" });
    expect(decide(allowed, "team", entry(), [received])).toEqual(keep("received-same"));
    expect(decide(allowed, "team", privateArea, [received])).toEqual(keep("received-same"));
  });

  test("a version this machine wrote since may go back, when the policy allows it", () => {
    const received = record({ direction: "received", hash: "theirs" });
    expect(decide(allowed, "team", entry(), [received])).toEqual(send);
    expect(decide(allowed, "team", privateArea, [received])).toEqual(keep("area-private"));
    // Sent back once, it is what the server has.
    expect(decide(allowed, "team", entry(), [received, record()])).toEqual(keep("already-sent"));
  });

  test("what came from another destination never travels on, whatever the hash", () => {
    for (const hash of ["h1", "theirs"]) {
      const elsewhere = record({ destination: "other", direction: "received", hash });
      expect(decide(allowed, "team", entry(), [elsewhere])).toEqual(keep("received-elsewhere"));
      expect(decide(allowed, "team", entry(), [record(), elsewhere])).toEqual(
        keep("received-elsewhere"),
      );
    }
  });

  test("a received memory whose record was lost stays: it is imported", () => {
    expect(decide(atAll, "team", memory({ origin: "imported" }), [])).toEqual(keep("imported"));
  });
});

describe("decide: a closed policy, and purity", () => {
  test("under a closed policy nothing leaves and nothing is withdrawn", () => {
    const closed = policy({
      closed: true,
      roots: new Set(["workspace"]),
      areas: new Set(["workspace:sales"]),
      levels: new Map([levelRow(P, "all")]),
    });
    expect(decide(closed, "team", entry(), [])).toEqual(keep("policy-failed"));
    expect(decide(closed, "team", memory(), [])).toEqual(keep("policy-failed"));
    expect(decide(closed, "team", entry({ area: "finance" }), [record()])).toEqual(
      keep("policy-failed"),
    );
    expect(decide(closedPolicy("it failed"), "team", entry(), [])).toEqual({
      answer: "keep",
      reason: "policy-failed",
      epoch: 0,
    });
  });

  test("the same inputs give equal answers, carrying the policy's epoch, and nothing is changed", () => {
    const allowed = policy({ roots: new Set(["workspace"]), areas: new Set(["workspace:sales"]) });
    const item = Object.freeze(entry());
    const records = Object.freeze([Object.freeze(record({ hash: "older" }))]);
    const first = decide(allowed, "team", item, records);
    const second = decide(allowed, "team", item, records);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.epoch).toBe(allowed.epoch);
    expect(decide(policy({ epoch: 77 }), "team", item, []).epoch).toBe(77);
  });
});
