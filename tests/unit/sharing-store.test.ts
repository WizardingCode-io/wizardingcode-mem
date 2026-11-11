import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remoteAliasOf } from "../../src/core/project.ts";
import { loadSettings } from "../../src/settings/settings.ts";
import {
  applySettingsPatch,
  bumpCounter,
  COUNTER_KEY,
  counterOf,
  fileListsOf,
  GENERATION_KEY,
  generationOf,
  lastChange,
  levelRows,
  NeedsConfirm,
  newGeneration,
  previewSettingsPatch,
  recentChanges,
  resetLevels,
  SETTINGS_SEEN_KEY,
  setLevelMessage,
  settingsSeen,
} from "../../src/sharing/store.ts";
import {
  LATEST_VERSION,
  moduleSchemaState,
  openDb,
  openExisting,
  withWrite,
} from "../../src/store/db.ts";
import { getMeta, setMeta } from "../../src/store/meta.ts";

const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS";
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS";
const HEX8 = /^[0-9a-f]{8}$/;

// One folder is both the data directory (the env file) and the store directory.
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-sharing-store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const open = (at: string = dir) => openDb({ dataDir: at, busyTimeoutMs: 2000 });
const openBare = () => openDb({ dataDir: dir, busyTimeoutMs: 2000, moduleSchemas: [] });
const envFile = () => join(dir, "env");
const envText = () => (existsSync(envFile()) ? readFileSync(envFile(), "utf8") : null);

const columnsOf = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => column.name);

const named = (db: Database, name: string) =>
  db.query<{ type: string }, [string]>("SELECT type FROM sqlite_master WHERE name = ?").get(name)
    ?.type ?? null;

const moduleRows = (db: Database) =>
  db
    .query<{ module: string; version: number; name: string }, []>(
      "SELECT module, version, name FROM module_migrations ORDER BY module, version",
    )
    .all();

const backups = () =>
  existsSync(join(dir, "backups"))
    ? readdirSync(join(dir, "backups")).filter((name) => name.endsWith(".db"))
    : [];

const addLevel = (db: Database, projectId: number, level: string) =>
  db.run(
    `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
     VALUES (?, 'team', ?, ?, 5, 'cli')`,
    [projectId, level, `remote:example.com/p${projectId}`],
  );

describe("the sharing namespace's tables", () => {
  test("a fresh store gets the three tables, the index and a generation; the core version stays", () => {
    const db = open();
    expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(
      LATEST_VERSION,
    );
    expect(LATEST_VERSION).toBe(7);
    expect(columnsOf(db, "sharing_levels")).toEqual([
      "project_id",
      "destination",
      "level",
      "bound_alias",
      "set_at",
      "source",
    ]);
    expect(columnsOf(db, "sharing_ledger")).toEqual([
      "destination",
      "item_kind",
      "item_uid",
      "direction",
      "version",
      "hash",
      "policy_epoch",
      "at",
      "withdrawn_at",
      "local_hash",
      "instance",
      "reason",
    ]);
    expect(columnsOf(db, "sharing_changes")).toEqual(["id", "at", "source", "what", "old", "new"]);
    expect(named(db, "sharing_changes_at")).toBe("index");
    expect(moduleRows(db)).toContainEqual({
      module: "sharing",
      version: 1,
      name: "sharing_policy",
    });
    expect(generationOf(db)).toMatch(HEX8);
    expect(getMeta(db, GENERATION_KEY)).toBe(generationOf(db));
    db.close();
  });

  test("two fresh stores have different generations", () => {
    const other = mkdtempSync(join(tmpdir(), "wizardingcode-mem-sharing-store-other-"));
    try {
      const first = open();
      const second = open(other);
      expect(generationOf(first)).not.toBe(generationOf(second));
      first.close();
      second.close();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("a second open adds no row and no backup, and keeps the generation", () => {
    const first = open();
    const generation = generationOf(first);
    const recorded = moduleRows(first);
    first.close();
    const db = open();
    expect(moduleRows(db)).toEqual(recorded);
    expect(backups()).toEqual([]);
    expect(generationOf(db)).toBe(generation);
    db.close();
  });

  test("the schema is current, also for a reader that migrates nothing", () => {
    const db = open();
    expect(moduleSchemaState(db, "sharing", 2)).toBe("current");
    const generation = generationOf(db);
    db.close();
    const reader = openExisting(dir);
    expect(reader).not.toBeNull();
    expect(moduleSchemaState(reader as Database, "sharing", 2)).toBe("current");
    expect(generationOf(reader as Database)).toBe(generation);
    reader?.close();
  });

  test("a store that never ran the schema has no table and no generation", () => {
    const db = openBare();
    expect(named(db, "sharing_levels")).toBeNull();
    expect(named(db, "sharing_ledger")).toBeNull();
    expect(named(db, "sharing_changes")).toBeNull();
    expect(generationOf(db)).toBeNull();
    // Asking does not mint one.
    expect(getMeta(db, GENERATION_KEY)).toBeNull();
    db.close();
  });

  test("a generation is eight hex characters, new each time", () => {
    expect(newGeneration()).toMatch(HEX8);
    expect(new Set(Array.from({ length: 8 }, newGeneration)).size).toBeGreaterThan(1);
  });
});

describe("the counter and the baseline", () => {
  test("the counter is 0 until something changes, and each change adds one", () => {
    const db = open();
    expect(counterOf(db)).toBe(0);
    expect(withWrite(db, () => bumpCounter(db))).toBe(1);
    expect(withWrite(db, () => bumpCounter(db))).toBe(2);
    expect(counterOf(db)).toBe(2);
    expect(getMeta(db, COUNTER_KEY)).toBe("2");
    db.close();
  });

  test("the baseline is the empty lists until one is recorded", () => {
    const db = open();
    expect(settingsSeen(db)).toEqual({ roots: [], areas: [] });
    setMeta(db, SETTINGS_SEEN_KEY, JSON.stringify({ roots: ["shared"], areas: ["shared:ops"] }));
    expect(settingsSeen(db)).toEqual({ roots: ["shared"], areas: ["shared:ops"] });
    db.close();
  });

  test("a baseline that cannot be read is the empty lists", () => {
    const db = open();
    for (const text of ["not json", "[]", '{"roots":"workspace","areas":[1]}']) {
      setMeta(db, SETTINGS_SEEN_KEY, text);
      expect(settingsSeen(db)).toEqual({ roots: [], areas: [] });
    }
    db.close();
  });
});

describe("fileListsOf", () => {
  test("reads the env file's own roots and areas", () => {
    writeFileSync(
      envFile(),
      `${ROOTS_KEY}=workspace,shared\n${AREAS_KEY}=workspace:sales,shared:ops\n`,
    );
    expect(fileListsOf(dir)).toEqual({
      roots: ["shared", "workspace"],
      areas: ["shared:ops", "workspace:sales"],
    });
  });

  test("is empty with no file", () => {
    expect(fileListsOf(dir)).toEqual({ roots: [], areas: [] });
  });
});

describe("previewSettingsPatch", () => {
  test("a root added to an empty file widens", () => {
    expect(previewSettingsPatch(dir, { [ROOTS_KEY]: "workspace" })).toEqual([
      { key: ROOTS_KEY, old: [], new: ["workspace"], widened: true },
    ]);
  });

  test("a root removed from the file's list does not", () => {
    writeFileSync(envFile(), `${ROOTS_KEY}=shared,workspace\n`);
    expect(previewSettingsPatch(dir, { [ROOTS_KEY]: "workspace" })).toEqual([
      { key: ROOTS_KEY, old: ["shared", "workspace"], new: ["workspace"], widened: false },
    ]);
  });

  test("answers only for the sharing keys in the patch, roots first", () => {
    expect(previewSettingsPatch(dir, { WIZARDINGCODE_MEM_RETENTION_DAYS: "30" })).toEqual([]);
    expect(
      previewSettingsPatch(dir, { [AREAS_KEY]: "workspace:sales", [ROOTS_KEY]: null }).map(
        (change) => change.key,
      ),
    ).toEqual([ROOTS_KEY, AREAS_KEY]);
  });
});

describe("applySettingsPatch", () => {
  test("a widening without confirm is refused and nothing is written", () => {
    const db = open();
    expect(() =>
      applySettingsPatch(db, dir, { [ROOTS_KEY]: "workspace" }, "cli", 10, false),
    ).toThrow(NeedsConfirm);
    expect(envText()).toBeNull();
    expect(recentChanges(db, 10)).toEqual([]);
    expect(counterOf(db)).toBe(0);
    expect(getMeta(db, SETTINGS_SEEN_KEY)).toBeNull();
    db.close();
  });

  test("with confirm it writes the file, logs the change, moves the counter and sets the baseline", () => {
    const db = open();
    const outcome = applySettingsPatch(db, dir, { [ROOTS_KEY]: "workspace" }, "cli", 10, true);
    expect(outcome).toEqual({
      sharing: [{ key: ROOTS_KEY, old: [], new: ["workspace"], widened: true }],
    });
    expect(loadSettings({}, dir).sharing.roots).toEqual(["workspace"]);
    expect(recentChanges(db, 10)).toEqual([
      { id: 1, at: 10, source: "cli", what: "roots", old: "none", new: "workspace" },
    ]);
    expect(counterOf(db)).toBe(1);
    expect(settingsSeen(db)).toEqual({ roots: ["workspace"], areas: [] });

    const wider = applySettingsPatch(
      db,
      dir,
      { [ROOTS_KEY]: "workspace,shared" },
      "viewer",
      20,
      true,
    );
    expect(wider.sharing).toEqual([
      { key: ROOTS_KEY, old: ["workspace"], new: ["shared", "workspace"], widened: true },
    ]);

    // Lowering asks nothing.
    const cleared = applySettingsPatch(db, dir, { [ROOTS_KEY]: null }, "cli", 30, false);
    expect(cleared.sharing).toEqual([
      { key: ROOTS_KEY, old: ["shared", "workspace"], new: [], widened: false },
    ]);
    expect(lastChange(db)).toEqual({
      id: 3,
      at: 30,
      source: "cli",
      what: "roots",
      old: "shared,workspace",
      new: "none",
    });
    expect(loadSettings({}, dir).sharing.roots).toEqual([]);
    expect(counterOf(db)).toBe(3);
    expect(settingsSeen(db)).toEqual({ roots: [], areas: [] });
    db.close();
  });

  test("a patch with both keys logs two rows and moves the counter once", () => {
    const db = open();
    const outcome = applySettingsPatch(
      db,
      dir,
      { [AREAS_KEY]: "workspace:sales", [ROOTS_KEY]: "shared" },
      "viewer",
      10,
      true,
    );
    expect(outcome.sharing.map((change) => change.key)).toEqual([ROOTS_KEY, AREAS_KEY]);
    expect(
      recentChanges(db, 10)
        .map((change) => [change.what, change.old, change.new, change.source, change.at])
        .sort(),
    ).toEqual([
      ["areas", "none", "workspace:sales", "viewer", 10],
      ["roots", "none", "shared", "viewer", 10],
    ]);
    expect(counterOf(db)).toBe(1);
    expect(settingsSeen(db)).toEqual({ roots: ["shared"], areas: ["workspace:sales"] });
    db.close();
  });

  test("a patch that repeats both lists as the file holds them logs nothing and leaves the counter", () => {
    const db = open();
    const lists = { [ROOTS_KEY]: "shared", [AREAS_KEY]: "workspace:sales" };
    applySettingsPatch(db, dir, lists, "viewer", 10, true);
    const logged = recentChanges(db, 10);
    expect(logged).toHaveLength(2);

    // What the viewer's Save sends: both lists every time, here beside a key that changed.
    const outcome = applySettingsPatch(
      db,
      dir,
      { ...lists, WIZARDINGCODE_MEM_RETENTION_DAYS: "30" },
      "viewer",
      20,
      false,
    );
    expect(outcome.sharing).toEqual([
      { key: ROOTS_KEY, old: ["shared"], new: ["shared"], widened: false },
      { key: AREAS_KEY, old: ["workspace:sales"], new: ["workspace:sales"], widened: false },
    ]);
    expect(recentChanges(db, 10)).toEqual(logged);
    expect(counterOf(db)).toBe(1);
    // The file is still written: the patch held another key.
    expect(loadSettings({}, dir).retentionDays).toBe(30);
    expect(settingsSeen(db)).toEqual({ roots: ["shared"], areas: ["workspace:sales"] });
    db.close();
  });

  test("a list written another way is the same list", () => {
    const db = open();
    applySettingsPatch(db, dir, { [ROOTS_KEY]: "shared,workspace" }, "cli", 10, true);
    applySettingsPatch(
      db,
      dir,
      { [ROOTS_KEY]: " Workspace, shared ,workspace " },
      "cli",
      20,
      false,
    );
    // An absent key and `none` are both the empty list.
    applySettingsPatch(db, dir, { [AREAS_KEY]: "none" }, "cli", 30, false);
    applySettingsPatch(db, dir, { [AREAS_KEY]: null }, "cli", 40, false);
    expect(recentChanges(db, 10).map((change) => change.at)).toEqual([10]);
    expect(counterOf(db)).toBe(1);
    db.close();
  });

  test("a patch that changes one list and repeats the other logs one row and moves the counter once", () => {
    const db = open();
    applySettingsPatch(
      db,
      dir,
      { [ROOTS_KEY]: "shared", [AREAS_KEY]: "workspace:sales" },
      "viewer",
      10,
      true,
    );
    const outcome = applySettingsPatch(
      db,
      dir,
      { [ROOTS_KEY]: "shared", [AREAS_KEY]: "workspace:ops,workspace:sales" },
      "viewer",
      20,
      true,
    );
    expect(outcome.sharing.map((change) => [change.key, change.widened])).toEqual([
      [ROOTS_KEY, false],
      [AREAS_KEY, true],
    ]);
    expect(
      recentChanges(db, 10)
        .filter((change) => change.at === 20)
        .map((change) => [change.what, change.old, change.new, change.source]),
    ).toEqual([["areas", "workspace:sales", "workspace:ops,workspace:sales", "viewer"]]);
    expect(recentChanges(db, 10)).toHaveLength(3);
    expect(counterOf(db)).toBe(2);
    expect(settingsSeen(db)).toEqual({
      roots: ["shared"],
      areas: ["workspace:ops", "workspace:sales"],
    });
    db.close();
  });

  describe("on a file edited by hand since it was last recorded", () => {
    const logged = (db: Database) =>
      recentChanges(db, 10)
        .reverse()
        .map((change) => [change.what, change.old, change.new, change.source, change.at]);

    test("a patch that repeats the edited list records the edit as the file's, and nothing of its own", () => {
      const db = open();
      writeFileSync(envFile(), `${ROOTS_KEY}=workspace\n`);
      const outcome = applySettingsPatch(
        db,
        dir,
        { [ROOTS_KEY]: "workspace" },
        "viewer",
        10,
        false,
      );
      expect(outcome.sharing).toEqual([
        { key: ROOTS_KEY, old: ["workspace"], new: ["workspace"], widened: false },
      ]);
      expect(logged(db)).toEqual([["roots", "none", "workspace", "file", 10]]);
      expect(counterOf(db)).toBe(1);
      expect(settingsSeen(db)).toEqual({ roots: ["workspace"], areas: [] });
      db.close();
    });

    test("a patch that changes another list records the edit, then its own change: two moves of the counter", () => {
      const db = open();
      writeFileSync(envFile(), `${ROOTS_KEY}=workspace\n`);
      applySettingsPatch(
        db,
        dir,
        { [ROOTS_KEY]: "workspace", [AREAS_KEY]: "workspace:sales" },
        "viewer",
        10,
        true,
      );
      expect(logged(db)).toEqual([
        ["roots", "none", "workspace", "file", 10],
        ["areas", "none", "workspace:sales", "viewer", 10],
      ]);
      expect(counterOf(db)).toBe(2);
      expect(settingsSeen(db)).toEqual({ roots: ["workspace"], areas: ["workspace:sales"] });
      db.close();
    });

    test("a patch with no sharing key records the edit too", () => {
      const db = open();
      writeFileSync(envFile(), `${ROOTS_KEY}=workspace\n`);
      applySettingsPatch(db, dir, { WIZARDINGCODE_MEM_RETENTION_DAYS: "30" }, "viewer", 10, false);
      expect(logged(db)).toEqual([["roots", "none", "workspace", "file", 10]]);
      expect(counterOf(db)).toBe(1);
      expect(settingsSeen(db)).toEqual({ roots: ["workspace"], areas: [] });
      expect(loadSettings({}, dir).retentionDays).toBe(30);
      db.close();
    });

    test("the patch is judged against the file as edited, and a refusal records nothing", () => {
      const db = open();
      writeFileSync(envFile(), `${ROOTS_KEY}=workspace\n`);
      expect(() =>
        applySettingsPatch(db, dir, { [ROOTS_KEY]: "workspace,shared" }, "viewer", 10, false),
      ).toThrow(NeedsConfirm);
      expect(logged(db)).toEqual([]);
      expect(counterOf(db)).toBe(0);
      expect(getMeta(db, SETTINGS_SEEN_KEY)).toBeNull();
      expect(envText()).toBe(`${ROOTS_KEY}=workspace\n`);
      db.close();
    });

    test("a file write that throws rolls the record of the edit back with the rest", () => {
      const db = open();
      writeFileSync(envFile(), `${ROOTS_KEY}=workspace\n`);
      const io = {
        writeEnvFile: () => {
          throw new Error("disk");
        },
      };
      expect(() =>
        applySettingsPatch(db, dir, { [AREAS_KEY]: "workspace:sales" }, "cli", 10, true, io),
      ).toThrow("disk");
      expect(logged(db)).toEqual([]);
      expect(counterOf(db)).toBe(0);
      expect(getMeta(db, SETTINGS_SEEN_KEY)).toBeNull();
      db.close();
    });
  });

  test("a patch with no sharing key writes the file and records nothing", () => {
    const db = open();
    const outcome = applySettingsPatch(
      db,
      dir,
      { WIZARDINGCODE_MEM_RETENTION_DAYS: "30" },
      "viewer",
      10,
      false,
    );
    expect(outcome).toEqual({ sharing: [] });
    expect(loadSettings({}, dir).retentionDays).toBe(30);
    expect(recentChanges(db, 10)).toEqual([]);
    expect(counterOf(db)).toBe(0);
    expect(getMeta(db, SETTINGS_SEEN_KEY)).toBeNull();
    db.close();
  });

  test("a file write that throws leaves no row, no counter change and the file as it was", () => {
    const db = open();
    writeFileSync(envFile(), "WIZARDINGCODE_MEM_RETENTION_DAYS=30\n");
    const io = {
      writeEnvFile: () => {
        throw new Error("disk");
      },
    };
    expect(() =>
      applySettingsPatch(db, dir, { [ROOTS_KEY]: "workspace" }, "cli", 10, true, io),
    ).toThrow("disk");
    expect(envText()).toBe("WIZARDINGCODE_MEM_RETENTION_DAYS=30\n");
    expect(recentChanges(db, 10)).toEqual([]);
    expect(counterOf(db)).toBe(0);
    expect(getMeta(db, SETTINGS_SEEN_KEY)).toBeNull();
    db.close();
  });
});

describe("the change log", () => {
  test("lastChange is the newest row and recentChanges the newest first", () => {
    const db = open();
    expect(lastChange(db)).toBeNull();
    applySettingsPatch(db, dir, { [ROOTS_KEY]: "workspace" }, "cli", 10, true);
    applySettingsPatch(db, dir, { [AREAS_KEY]: "workspace:sales" }, "viewer", 20, true);
    applySettingsPatch(db, dir, { [ROOTS_KEY]: "none" }, "cli", 30, false);
    expect(lastChange(db)).toEqual({
      id: 3,
      at: 30,
      source: "cli",
      what: "roots",
      old: "workspace",
      new: "none",
    });
    expect(recentChanges(db, 2).map((change) => change.id)).toEqual([3, 2]);
    expect(recentChanges(db, 10).map((change) => change.id)).toEqual([3, 2, 1]);
    db.close();
  });
});

describe("resetLevels", () => {
  const lists = { roots: ["shared" as const], areas: [] };

  test("deletes every level, logs it once, and never lets the counter fall back", () => {
    const db = open();
    setMeta(db, COUNTER_KEY, "3");
    addLevel(db, 1, "knowledge");
    addLevel(db, 2, "all");
    expect(levelRows(db)).toEqual([
      {
        projectId: 1,
        destination: "team",
        level: "knowledge",
        boundAlias: "remote:example.com/p1",
        setAt: 5,
        source: "cli",
      },
      {
        projectId: 2,
        destination: "team",
        level: "all",
        boundAlias: "remote:example.com/p2",
        setAt: 5,
        source: "cli",
      },
    ]);
    const generation = generationOf(db);

    expect(resetLevels(db, 40, 7, lists)).toBe(2);
    expect(levelRows(db)).toEqual([]);
    expect(recentChanges(db, 10)).toEqual([
      {
        id: 1,
        at: 40,
        source: "restore",
        what: "levels",
        old: "2 projects above Nothing",
        new: "every project Nothing",
      },
    ]);
    expect(counterOf(db)).toBe(8);
    expect(generationOf(db)).toMatch(HEX8);
    expect(generationOf(db)).not.toBe(generation);
    expect(settingsSeen(db)).toEqual({ roots: ["shared"], areas: [] });
    db.close();
  });

  test("one level is one project", () => {
    const db = open();
    addLevel(db, 1, "knowledge");
    expect(resetLevels(db, 40, 0, lists)).toBe(1);
    expect(lastChange(db)?.old).toBe("1 project above Nothing");
    db.close();
  });

  test("a floor below the copy's counter still moves the counter on", () => {
    const db = open();
    setMeta(db, COUNTER_KEY, "3");
    resetLevels(db, 40, 2, lists);
    expect(counterOf(db)).toBe(4);
    db.close();
  });

  test("with no level it logs nothing and still moves the counter, the generation and the baseline", () => {
    const db = open();
    const generation = generationOf(db);
    expect(resetLevels(db, 40, 7, lists)).toBe(0);
    expect(recentChanges(db, 10)).toEqual([]);
    expect(counterOf(db)).toBe(8);
    expect(generationOf(db)).toMatch(HEX8);
    expect(generationOf(db)).not.toBe(generation);
    expect(settingsSeen(db)).toEqual({ roots: ["shared"], areas: [] });
    db.close();
  });

  test("runs on a copy without the sharing tables", () => {
    const db = openBare();
    expect(resetLevels(db, 40, 5, lists)).toBe(0);
    expect(named(db, "sharing_changes")).toBeNull();
    expect(getMeta(db, COUNTER_KEY)).toBe("6");
    expect(getMeta(db, GENERATION_KEY)).toMatch(HEX8);
    expect(JSON.parse(getMeta(db, SETTINGS_SEEN_KEY) ?? "null")).toEqual({
      roots: ["shared"],
      areas: [],
    });
    db.close();
  });
});

describe("setLevelMessage", () => {
  test("says what a person can do about each refusal", () => {
    expect(setLevelMessage("no-project")).toBe(
      "this folder is not a known project; start a session here first",
    );
    expect(setLevelMessage("no-remote")).toBe(
      "this project has no git remote; a team can only match projects by their remote",
    );
    expect(setLevelMessage("disabled")).toBe("memory is off for this project");
    expect(setLevelMessage("invalid")).toBe("the level is one of local, receive, knowledge, all");
    expect(setLevelMessage("needs-confirm")).toBe("confirm: true is required to widen sharing");
  });
});

describe("remoteAliasOf", () => {
  // A real git, under a home of its own: nothing of the person's configuration is read.
  const git = (cwd: string, ...args: string[]) => {
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    const proc = Bun.spawnSync(["git", ...args], {
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: home, GIT_CONFIG_NOSYSTEM: "1" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
  };
  const folder = (name: string) => {
    const path = join(dir, name);
    mkdirSync(path);
    return path;
  };

  test("is the remote alias the project is known by", () => {
    const repo = folder("with-remote");
    git(repo, "init", "-q");
    git(repo, "remote", "add", "origin", "git@github.com:Acme/Widgets.git");
    expect(remoteAliasOf(repo)).toBe("remote:github.com/acme/widgets");
    const inside = join(repo, "src");
    mkdirSync(inside);
    expect(remoteAliasOf(inside)).toBe("remote:github.com/acme/widgets");
  });

  test("is null without a remote, and without git", () => {
    const repo = folder("no-remote");
    git(repo, "init", "-q");
    expect(remoteAliasOf(repo)).toBeNull();
    expect(remoteAliasOf(folder("plain"))).toBeNull();
  });
});
