// `wizardingcode-mem share` from a shell: a project's level, the roots and the areas, what
// is shared, and why one item leaves or stays. Each case runs the real command in a project
// folder that has a git remote, against its own data directory. No case has a terminal:
// a widening is confirmed with --yes or refused.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { resetGitCaches } from "../../src/modules/knowledge/repo.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { type CliResult, runCliWith } from "../helpers/cli.ts";
import { realGit } from "../helpers/stub-git.ts";

const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS";
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS";
const REMOTE = "remote:github.com/acme/site";
const SLUG = "discovery-call-script";
const LONG = 60_000;

let dir: string;
let dataDir: string;
let home: string;
let project: string;
let projectId: number;
let env: Record<string, string>;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-sharing-cli-")));
  dataDir = join(dir, "data");
  home = join(dir, "home");
  project = join(home, "work", "site");
  mkdirSync(dataDir);
  mkdirSync(project, { recursive: true });
  realGit(project, "init", "-q");
  realGit(project, "remote", "add", "origin", "https://github.com/acme/site.git");
  env = {
    WIZARDINGCODE_MEM_DATA_DIR: dataDir,
    WIZARDINGCODE_HOME: join(dir, "brand"),
    HOME: home,
    PATH: process.env.PATH ?? "",
    WIZARDINGCODE_MEM_DISTILL: "off",
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
    WIZARDINGCODE_MEM_MIGRATE: "off",
  };
  resetGitCaches();
  // Known before any command runs: `share` never makes a project of a folder.
  projectId = withDb((db) => resolveProject(db, project, 1).id);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function withDb<T>(fn: (db: Db) => T): T {
  const db = openDb({ dataDir, busyTimeoutMs: 5000 });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const shareIn = (cwd: string, ...args: string[]): Promise<CliResult> =>
  runCliWith({ env, cwd }, "share", ...args);
const share = (...args: string[]): Promise<CliResult> => shareIn(project, ...args);

/** A workspace entry in the sales area, written as a person writes one. */
const writeEntry = (scope = "workspace"): Promise<CliResult> =>
  runCliWith(
    { env, cwd: project },
    "knowledge",
    "write",
    "--scope",
    scope,
    "--title",
    "Discovery call script",
    "--kind",
    "strategy",
    "--area",
    "sales",
    "--body",
    "The body.",
  );

const addMemory = (): number =>
  withDb((db) =>
    insertMemory(db, {
      projectId,
      kind: "decision",
      title: "Deploys need the staging flag",
      body: "Without it the deploy goes to production." as Redacted,
      terms: "",
      importance: 3,
      branch: null,
      commit: null,
      origin: "distilled",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: 1,
    }),
  );

interface LevelRow {
  projectId: number;
  level: string;
  boundAlias: string;
  source: string;
}
const levels = () =>
  withDb((db) =>
    db
      .query<LevelRow, []>(
        `SELECT project_id AS projectId, level, bound_alias AS boundAlias, source
           FROM sharing_levels ORDER BY project_id`,
      )
      .all(),
  );

interface Change {
  what: string;
  old: string;
  new: string;
  source: string;
}
const changes = () =>
  withDb((db) =>
    db.query<Change, []>("SELECT what, old, new, source FROM sharing_changes ORDER BY id").all(),
  );

const envFile = () =>
  existsSync(join(dataDir, "env")) ? readFileSync(join(dataDir, "env"), "utf8") : "";

describe("share project", () => {
  test(
    "sets the level of the current folder's project when the person says yes",
    async () => {
      const result = await share("project", "knowledge", "--yes");
      expect(result).toEqual({ stdout: "sharing: site → Knowledge\n", stderr: "", exitCode: 0 });
      expect(levels()).toEqual([
        { projectId, level: "knowledge", boundAlias: REMOTE, source: "cli" },
      ]);
      expect(changes()).toEqual([
        { what: `project:${projectId}`, old: "local", new: "knowledge", source: "cli" },
      ]);

      // The level it already has: said, and neither written nor logged again.
      const again = await share("project", "knowledge");
      expect(again).toEqual({
        stdout: "sharing: site → Knowledge (unchanged)\n",
        stderr: "",
        exitCode: 0,
      });
      expect(changes()).toHaveLength(1);
    },
    LONG,
  );

  test(
    "a widening nobody can confirm is refused, and nothing is written",
    async () => {
      const result = await share("project", "all");
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("widening needs --yes");
      expect(levels()).toEqual([]);
      expect(changes()).toEqual([]);

      await share("project", "knowledge", "--yes");
      const further = await share("project", "all");
      expect(further.exitCode).toBe(1);
      expect(further.stderr).toContain("widening needs --yes");
      expect(levels().map((row) => row.level)).toEqual(["knowledge"]);
    },
    LONG,
  );

  test(
    "lowering asks nothing",
    async () => {
      await share("project", "all", "--yes");
      const lower = await share("project", "knowledge");
      expect(lower).toEqual({ stdout: "sharing: site → Knowledge\n", stderr: "", exitCode: 0 });
      const result = await share("project", "local");
      expect(result).toEqual({ stdout: "sharing: site → Nothing\n", stderr: "", exitCode: 0 });
      expect(levels()).toEqual([]);
      // A project that shares nothing is set to Nothing with no change.
      expect((await share("project", "local")).stdout).toBe(
        "sharing: site → Nothing (unchanged)\n",
      );
      expect(changes().map((change) => [change.old, change.new])).toEqual([
        ["local", "all"],
        ["all", "knowledge"],
        ["knowledge", "local"],
      ]);
    },
    LONG,
  );

  test("a folder that is not a known project is refused, and no project is made of it", async () => {
    const unknown = join(home, "work", "unknown");
    mkdirSync(unknown);
    const result = await shareIn(unknown, "project", "knowledge", "--yes");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("not a known project");
    expect(withDb((db) => db.query("SELECT count(*) AS n FROM projects").get())).toEqual({ n: 1 });
    expect(levels()).toEqual([]);
  });

  test(
    "a project without a git remote cannot share, and is told so before it is asked anything",
    async () => {
      const plain = join(home, "work", "plain");
      mkdirSync(plain);
      realGit(plain, "init", "-q");
      withDb((db) => resolveProject(db, plain, 1));
      const result = await shareIn(plain, "project", "knowledge", "--yes");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no git remote");
      // Without --yes it is the same refusal, not the one about confirming.
      const unasked = await shareIn(plain, "project", "knowledge");
      expect(unasked.exitCode).toBe(1);
      expect(unasked.stderr).toContain("no git remote");
      expect(unasked.stderr).not.toContain("widening");
      expect(levels()).toEqual([]);
      // Nothing is what it shares already.
      expect((await shareIn(plain, "project", "local")).exitCode).toBe(0);
    },
    LONG,
  );

  test("a project with memory off cannot share", async () => {
    withDb((db) => db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [projectId]));
    const result = await share("project", "knowledge", "--yes");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("memory is off for this project");
    expect(levels()).toEqual([]);
  });

  test("a level that is not one of the three prints the usage, with what each level shares", async () => {
    const result = await share("project", "wide");
    expect(result.exitCode).toBe(64);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage: wizardingcode-mem share");
    for (const level of [
      "local (Nothing)",
      "knowledge (Knowledge)",
      "all (Knowledge and memories)",
    ]) {
      expect(result.stderr).toContain(level);
    }
    expect((await share("project")).exitCode).toBe(64);
    expect((await share("project", "all", "--force")).exitCode).toBe(64);
    expect(levels()).toEqual([]);
  });
});

describe("share roots and share areas", () => {
  test("the roots are written to the env file and logged when the person says yes", async () => {
    const result = await share("roots", "workspace", "--yes");
    expect(result).toEqual({ stdout: "sharing: roots → workspace\n", stderr: "", exitCode: 0 });
    expect(envFile()).toContain(`${ROOTS_KEY}=workspace\n`);
    expect(changes()).toEqual([{ what: "roots", old: "none", new: "workspace", source: "cli" }]);
  });

  test(
    "a wider list nobody can confirm is refused, and nothing is written",
    async () => {
      await share("roots", "workspace", "--yes");
      // Another root is more, even with the first one left out.
      const result = await share("roots", "shared");
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("widening needs --yes");
      expect(envFile()).toContain(`${ROOTS_KEY}=workspace\n`);
      expect(changes()).toHaveLength(1);
    },
    LONG,
  );

  test(
    "the areas are written and logged likewise",
    async () => {
      const refused = await share("areas", "workspace:sales");
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain("widening needs --yes");
      expect(envFile()).not.toContain(AREAS_KEY);

      const result = await share("areas", "workspace:sales,shared:marketing", "--yes");
      expect(result).toEqual({
        stdout: "sharing: areas → shared:marketing,workspace:sales\n",
        stderr: "",
        exitCode: 0,
      });
      expect(envFile()).toContain(`${AREAS_KEY}=shared:marketing,workspace:sales\n`);
      expect(changes()).toEqual([
        { what: "areas", old: "none", new: "shared:marketing,workspace:sales", source: "cli" },
      ]);
    },
    LONG,
  );

  test("a list that is not one prints the setting's rule and the usage", async () => {
    const areas = await share("areas", "Sales");
    expect(areas.exitCode).toBe(64);
    expect(areas.stderr).toContain(
      "a comma list of root-qualified area ids such as workspace:sales, or none",
    );
    expect(areas.stderr).toContain("Usage: wizardingcode-mem share");
    const roots = await share("roots", "everything", "--yes");
    expect(roots.exitCode).toBe(64);
    expect(roots.stderr).toContain("a comma list of workspace and shared, or none");
    expect((await share("roots")).exitCode).toBe(64);
    expect(envFile()).toBe("");
    expect(changes()).toEqual([]);
  });

  test(
    "lowering asks nothing",
    async () => {
      await share("roots", "shared,workspace", "--yes");
      expect(await share("roots", "workspace")).toEqual({
        stdout: "sharing: roots → workspace\n",
        stderr: "",
        exitCode: 0,
      });
      expect(await share("roots", "none")).toEqual({
        stdout: "sharing: roots → none\n",
        stderr: "",
        exitCode: 0,
      });
      expect(changes().map((change) => [change.old, change.new])).toEqual([
        ["none", "shared,workspace"],
        ["shared,workspace", "workspace"],
        ["workspace", "none"],
      ]);
      expect((await share("roots", "none")).stdout).toBe("sharing: roots → none (unchanged)\n");
      expect(changes()).toHaveLength(3);
    },
    LONG,
  );
});

describe("share status", () => {
  test("on a fresh store says that nothing is shared and nothing changed yet", async () => {
    const result = await share("status");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^sharing {3}epoch \d+ · no change yet$/);
    expect(lines.slice(1)).toEqual([
      "roots     none",
      "areas     none",
      "projects  0 knowledge · 0 knowledge and memories · 1 nothing",
      "this      site: Nothing",
      "leaves    0 entries · 0 memories",
    ]);
    expect(changes()).toEqual([]);
  });

  test(
    "after changes says what is shared, the last change, and what would leave",
    async () => {
      expect((await writeEntry()).exitCode).toBe(0);
      await share("roots", "workspace", "--yes");
      await share("areas", "workspace:sales", "--yes");
      await share("project", "knowledge", "--yes");
      const result = await share("status");
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trimEnd().split("\n");
      expect(lines[0]).toMatch(
        new RegExp(
          `^sharing {3}epoch \\d+ · last change: project:${projectId} local → knowledge, \\S+, from the cli$`,
        ),
      );
      expect(lines.slice(1)).toEqual([
        "roots     workspace",
        "areas     workspace:sales",
        "projects  1 knowledge · 0 knowledge and memories · 0 nothing",
        `this      site: Knowledge (bound to ${REMOTE})`,
        "leaves    1 entry · 0 memories",
      ]);
      // From a folder that is no project, the machine's sharing is said all the same.
      const elsewhere = await shareIn(home, "status");
      expect(elsewhere.stdout).toContain("this      not a known project\n");
      expect(elsewhere.stdout).toContain("leaves    1 entry · 0 memories\n");
    },
    LONG,
  );

  test(
    "records a hand edit of the env file before it prints",
    async () => {
      await share("roots", "workspace", "--yes");
      writeFileSync(join(dataDir, "env"), `${ROOTS_KEY}=shared,workspace\n`);
      const result = await share("status");
      expect(result.stdout).toContain("roots     shared,workspace\n");
      expect(result.stdout).toMatch(
        /^sharing {3}epoch \d+ · last change: roots workspace → shared,workspace, \S+, from the file$/m,
      );
      expect(result.stdout).not.toContain("problem ");
      expect(changes().at(-1)).toEqual({
        what: "roots",
        old: "workspace",
        new: "shared,workspace",
        source: "file",
      });
      // Recorded once.
      await share("status");
      expect(changes()).toHaveLength(2);
    },
    LONG,
  );

  test(
    "removes a level whose project lost its remote, and says Nothing",
    async () => {
      await share("project", "knowledge", "--yes");
      withDb((db) => db.run("DELETE FROM project_aliases WHERE alias = ?", [REMOTE]));
      const result = await share("status");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("this      site: Nothing\n");
      expect(result.stdout).toContain(
        "projects  0 knowledge · 0 knowledge and memories · 1 nothing\n",
      );
      expect(result.stdout).not.toContain("problem ");
      expect(levels()).toEqual([]);
      expect(changes().at(-1)).toEqual({
        what: `project:${projectId}`,
        old: "knowledge",
        new: "local",
        source: "system",
      });
    },
    LONG,
  );

  test(
    "an area in no taxonomy is said on the areas line, and not a second time",
    async () => {
      await share("areas", "workspace:nope", "--yes");
      const result = await share("status");
      expect(result.stdout).toContain(
        "areas     none (workspace:nope not in the taxonomy; ignored)\n",
      );
      expect(result.stdout).not.toContain("problem ");
      expect(result.stdout.match(/taxonomy/g)).toHaveLength(1);
    },
    LONG,
  );

  test(
    "a problem of the policy is said after the areas",
    async () => {
      await share("project", "knowledge", "--yes");
      // A level this version does not know, as a newer one may have left it.
      withDb((db) => db.run("UPDATE sharing_levels SET level = 'everything'"));
      const lines = (await share("status")).stdout.trimEnd().split("\n");
      expect(lines[2]).toBe("areas     none");
      expect(lines[3]).toBe(
        "problem   site has a level this version does not know; its level is Nothing until you set it again",
      );
      expect(lines[4]).toStartWith("projects  ");
    },
    LONG,
  );

  test(
    "--list names what would leave",
    async () => {
      expect((await writeEntry()).exitCode).toBe(0);
      await share("roots", "workspace", "--yes");
      await share("areas", "workspace:sales", "--yes");
      await share("project", "all", "--yes");
      const id = addMemory();
      const result = await share("status", "--list");
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trimEnd().split("\n");
      expect(lines.slice(-3)).toEqual([
        "leaves    1 entry · 1 memory",
        `entry   workspace/${SLUG}  sales  Discovery call script`,
        `memory  ${id}  Deploys need the staging flag`,
      ]);
      // Without --list no item is named.
      const plain = await share("status");
      expect(plain.stdout).not.toContain("entry   ");
      expect(plain.stdout).not.toContain("memory  ");
      expect((await share("status", "--all")).exitCode).toBe(64);
    },
    LONG,
  );
});

describe("share explain", () => {
  test(
    "says why an entry leaves and why a memory stays",
    async () => {
      expect((await writeEntry()).exitCode).toBe(0);
      expect((await writeEntry("project")).exitCode).toBe(0);
      await share("roots", "workspace", "--yes");
      await share("areas", "workspace:sales", "--yes");
      const id = addMemory();

      // The project shares nothing yet: its entry stays, the workspace's leaves.
      expect((await share("explain", `project/${SLUG}`)).stdout).toBe(
        `project/${SLUG}: keep · level-local · This project shares nothing.\n`,
      );
      expect(await share("explain", `workspace/${SLUG}`)).toEqual({
        stdout: `workspace/${SLUG}: send · allowed · The policy lets it leave.\n`,
        stderr: "",
        exitCode: 0,
      });

      await share("project", "knowledge", "--yes");
      expect((await share("explain", `project/${SLUG}`)).stdout).toBe(
        `project/${SLUG}: send · allowed · The policy lets it leave.\n`,
      );
      expect(await share("explain", "memory", String(id))).toEqual({
        stdout: `memory ${id}: keep · level-knowledge · This project shares knowledge only; memories stay.\n`,
        stderr: "",
        exitCode: 0,
      });
    },
    LONG,
  );

  test(
    "an item that is not there is not found",
    async () => {
      const entry = await share("explain", "nope/x");
      expect(entry.exitCode).toBe(1);
      expect(entry.stdout).toBe("");
      expect(entry.stderr).toContain("not found");
      const memory = await share("explain", "memory", "999");
      expect(memory.exitCode).toBe(1);
      expect(memory.stderr).toContain("not found");
      expect((await share("explain")).exitCode).toBe(64);
      expect((await share("explain", "memory", "twelve")).exitCode).toBe(64);
    },
    LONG,
  );
});

describe("share", () => {
  test("a subcommand that is not one prints the usage", async () => {
    const result = await share("nonsense");
    expect(result.exitCode).toBe(64);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage: wizardingcode-mem share");
    expect((await share()).exitCode).toBe(64);
  });
});
