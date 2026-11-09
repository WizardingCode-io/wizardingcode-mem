// The `sharing` line of `status`: what the current project shares and what would leave,
// from the index as it is. `status` opens the store read-only, so the line is read with no
// write and no git call.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectRef } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { resetGitCaches } from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import { openStore } from "../../src/modules/knowledge/store-open.ts";
import type { ScopeRef } from "../../src/modules/knowledge/types.ts";
import { resetSharingLog } from "../../src/sharing/policy.ts";
import { applySettingsPatch, setLevel } from "../../src/sharing/store.ts";
import { formatStatus, statusReport } from "../../src/status/report.ts";
import { DB_FILE, type Db, openDb, openExisting } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { runCliWith } from "../helpers/cli.ts";

const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS";
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS";
const NOW = Date.UTC(2026, 10, 9, 8, 0, 0);
const REMOTE = "remote:github.com/acme/widgets";
const DEFAULT_LINE = "sharing   nothing leaves this machine (every default)";

interface Fixture {
  dir: string;
  dataDir: string;
  env: Record<string, string | undefined>;
}

function fixtureIn(dir: string): Fixture {
  const dataDir = join(dir, "data");
  const home = join(dir, "home");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { dir, dataDir, env: { PATH: process.env.PATH, HOME: home } };
}

const newDir = () => mkdtempSync(join(tmpdir(), "wizardingcode-mem-status-sharing-"));

/** A project known by its remote alias, which is also its key. */
function addProject(db: Db, remote: string): ProjectRef {
  const name = remote.split("/").pop() ?? remote;
  const id = db
    .query<{ id: number }, [string, string]>(
      "INSERT INTO projects (key, name, created_at) VALUES (?, ?, 1) RETURNING id",
    )
    .get(remote, name)?.id as number;
  db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [remote, id]);
  return {
    id,
    key: remote,
    name,
    root: "/work/widgets",
    branch: null,
    commit: null,
    disabled: false,
  };
}

const projectRef = (db: Db): ProjectRef => {
  const row = db
    .query<{ id: number; key: string; name: string }, []>("SELECT id, key, name FROM projects")
    .get();
  if (row === null) throw new Error("no project");
  return { ...row, root: "/work/widgets", branch: null, commit: null, disabled: false };
};

describe("on a fresh store", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = fixtureIn(newDir());
    resetSharingLog();
  });
  afterEach(() => {
    rmSync(fx.dir, { recursive: true, force: true });
  });

  test("the line says that nothing leaves", () => {
    const db = openDb({ dataDir: fx.dataDir, busyTimeoutMs: 2000 });
    const project = addProject(db, REMOTE);
    const report = statusReport(db, project, fx.dataDir, { env: fx.env, now: NOW });
    expect(report.sharing).toEqual({
      level: "local",
      roots: [],
      areas: 0,
      wouldLeave: { entries: 0, memories: 0 },
      problems: 0,
      narrowedByEnv: [],
      default: true,
      othersSharing: 0,
    });
    expect(formatStatus(report).split("\n")).toContain(DEFAULT_LINE);
    db.close();
  });

  /** Project A at Nothing, and B at Knowledge and memories with one memory that leaves. */
  function otherProjectSharing(db: Db): ProjectRef {
    const a = addProject(db, REMOTE);
    const b = addProject(db, "remote:github.com/acme/gears");
    const outcome = setLevel(db, {
      projectId: b.id,
      destination: "team",
      level: "all",
      source: "cli",
      now: NOW,
      confirm: true,
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    insertMemory(db, {
      projectId: b.id,
      kind: "decision",
      title: "Deploys need the staging flag",
      body: "Deploys need the staging flag, in full." as Redacted,
      terms: "",
      importance: 3,
      branch: null,
      commit: null,
      origin: "distilled",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: NOW,
    });
    return a;
  }

  test("another project above Nothing: the default sentence is not said, and the others are counted", () => {
    const db = openDb({ dataDir: fx.dataDir, busyTimeoutMs: 2000 });
    const a = otherProjectSharing(db);
    const report = statusReport(db, a, fx.dataDir, { env: fx.env, now: NOW });
    expect(report.sharing).toEqual({
      level: "local",
      roots: [],
      areas: 0,
      wouldLeave: { entries: 0, memories: 0 },
      problems: 0,
      narrowedByEnv: [],
      default: false,
      othersSharing: 1,
    });
    const lines = formatStatus(report).split("\n");
    expect(lines).not.toContain(DEFAULT_LINE);
    expect(lines).toContain(
      "sharing   this project: Nothing · roots: none · 0 allowed areas · would leave: 0 entries, 0 memories (index as it is) · 1 other project shares",
    );
    db.close();
  });

  test("another project above Nothing, with no project here: the machine's counts", () => {
    const db = openDb({ dataDir: fx.dataDir, busyTimeoutMs: 2000 });
    otherProjectSharing(db);
    const report = statusReport(db, null, fx.dataDir, { env: fx.env, now: NOW });
    expect(report.sharing).toMatchObject({
      level: "local",
      default: false,
      othersSharing: 1,
      wouldLeave: { entries: 0, memories: 1 },
    });
    expect(formatStatus(report).split("\n")).not.toContain(DEFAULT_LINE);
    db.close();
  });

  test("a store that never ran the sharing schema reads the default line, and nothing is written", () => {
    const bare = openDb({ dataDir: fx.dataDir, busyTimeoutMs: 2000, moduleSchemas: [] });
    addProject(bare, REMOTE);
    bare.close();
    const path = join(fx.dataDir, DB_FILE);
    const before = { bytes: readFileSync(path), mtime: statSync(path).mtimeMs };
    const db = openExisting(fx.dataDir) as Db;
    const report = statusReport(db, projectRef(db), fx.dataDir, { env: fx.env, now: NOW });
    expect(formatStatus(report).split("\n")).toContain(DEFAULT_LINE);
    expect(db.query("SELECT 1 FROM sqlite_master WHERE name LIKE 'sharing_%'").all()).toEqual([]);
    expect(db.query("SELECT key FROM meta WHERE key LIKE 'sharing.%'").all()).toEqual([]);
    db.close();
    expect(readFileSync(path).equals(before.bytes)).toBe(true);
    expect(statSync(path).mtimeMs).toBe(before.mtime);
  });

  test("a list the environment narrows prints the whole line, and says who set it", () => {
    const db = openDb({ dataDir: fx.dataDir, busyTimeoutMs: 2000 });
    const project = addProject(db, REMOTE);
    applySettingsPatch(db, fx.dataDir, { [ROOTS_KEY]: "workspace" }, "cli", NOW, true);
    const env = { ...fx.env, [ROOTS_KEY]: "none" };
    const report = statusReport(db, project, fx.dataDir, { env, now: NOW });
    expect(report.sharing).toMatchObject({ level: "local", roots: [], areas: 0, problems: 0 });
    expect(report.sharing.narrowedByEnv).toEqual(["roots"]);
    expect(report.sharing.default).toBe(false);
    const lines = formatStatus(report).split("\n");
    expect(lines).not.toContain(DEFAULT_LINE);
    expect(lines).toContain(
      "sharing   this project: Nothing · roots: none (set by the environment) · 0 allowed areas · would leave: 0 entries, 0 memories (index as it is)",
    );
    db.close();
  });
});

describe("with a project at Knowledge and allowed areas", () => {
  let template: string;
  let fx: Fixture;

  // The workspace holds one sales entry, which makes its taxonomy (sales and marketing among
  // its areas); the project, at Knowledge, three sales entries in its own repository. The
  // workspace root and the areas workspace:sales and workspace:marketing are allowed.
  beforeAll(() => {
    template = newDir();
    const made = fixtureIn(template);
    resetGitCaches();
    const db = openDb({ dataDir: made.dataDir, busyTimeoutMs: 2000 });
    const store = openStore({ db, dataDir: made.dataDir, env: made.env, now: () => NOW });
    const person = personAuthor(store);
    const project = addProject(db, REMOTE);
    const write = (ref: ScopeRef, title: string) =>
      writeEntry(
        store,
        ref,
        {
          title,
          kind: "knowledge",
          area: "sales",
          context: "agency clients",
          subject: "discovery call",
          body: `${title}, in full.`,
        },
        person,
      );
    write({ scope: "workspace" }, "Workspace sales");
    for (const title of ["Widgets one", "Widgets two", "Widgets three"]) {
      write({ scope: "project", projectId: project.id }, title);
    }
    const outcome = setLevel(db, {
      projectId: project.id,
      destination: "team",
      level: "knowledge",
      source: "cli",
      now: NOW,
      confirm: true,
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    applySettingsPatch(
      db,
      made.dataDir,
      { [ROOTS_KEY]: "workspace", [AREAS_KEY]: "workspace:sales,workspace:marketing" },
      "cli",
      NOW,
      true,
    );
    db.close();
  }, 60_000);
  afterAll(() => {
    rmSync(template, { recursive: true, force: true });
  });

  beforeEach(() => {
    const dir = newDir();
    cpSync(template, dir, { recursive: true, preserveTimestamps: true });
    fx = fixtureIn(dir);
    resetSharingLog();
  });
  afterEach(() => {
    rmSync(fx.dir, { recursive: true, force: true });
  });

  const read = (env = fx.env, withProject = true) => {
    const db = openExisting(fx.dataDir) as Db;
    try {
      return statusReport(db, withProject ? projectRef(db) : null, fx.dataDir, { env, now: NOW });
    } finally {
      db.close();
    }
  };

  test("the line names the level, the roots, the areas and this project's counts", () => {
    const report = read();
    expect(report.sharing).toEqual({
      level: "knowledge",
      roots: ["workspace"],
      areas: 2,
      wouldLeave: { entries: 3, memories: 0 },
      problems: 0,
      narrowedByEnv: [],
      default: false,
      othersSharing: 0,
    });
    expect(formatStatus(report).split("\n")).toContain(
      "sharing   this project: Knowledge · roots: workspace · 2 allowed areas · would leave: 3 entries, 0 memories (index as it is)",
    );
  });

  test("a problem is counted, and doctor named for it", () => {
    const report = read({ ...fx.env, [ROOTS_KEY]: "workspace,shared" });
    expect(report.sharing.problems).toBe(1);
    expect(report.sharing.narrowedByEnv).toEqual([]);
    const line = formatStatus(report)
      .split("\n")
      .find((text) => text.startsWith("sharing   "));
    expect(line).toEndWith(" · 1 problem; see doctor");
  });

  test("with no project, the level is Nothing and the counts are the machine's", () => {
    const report = read(fx.env, false);
    expect(report.sharing.level).toBe("local");
    // The workspace's sales entry and the project's three.
    expect(report.sharing.wouldLeave).toEqual({ entries: 4, memories: 0 });
  });

  test("status --json carries the line's figures", async () => {
    const cwd = join(fx.dir, "elsewhere");
    mkdirSync(cwd);
    const out = await runCliWith(
      {
        cwd,
        env: {
          HOME: fx.env.HOME as string,
          WIZARDINGCODE_MEM_DATA_DIR: fx.dataDir,
          WIZARDINGCODE_MEM_DISTILL: "off",
          WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
          WIZARDINGCODE_MEM_MIGRATE: "off",
        },
      },
      "status",
      "--json",
    );
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout).sharing).toEqual({
      level: "local",
      roots: ["workspace"],
      areas: 2,
      wouldLeave: { entries: 4, memories: 0 },
      problems: 0,
      narrowedByEnv: [],
      default: false,
      // No project here: the project at Knowledge is another one.
      othersSharing: 1,
    });
  });
});
