// doctor's `sharing` check: what the policy allows, or every problem its loader raised.
// It only looks: the store is opened read-only and nothing is reconciled.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Check, type DoctorContext, runChecks } from "../../src/doctor/checks.ts";
import { renderTaxonomy } from "../../src/modules/knowledge/entry.ts";
import { epochOf } from "../../src/sharing/levels.ts";
import { resetSharingLog } from "../../src/sharing/policy.ts";
import { applySettingsPatch, counterOf, setLevel } from "../../src/sharing/store.ts";
import type { Level } from "../../src/sharing/types.ts";
import { type Db, openDb } from "../../src/store/db.ts";

const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS";
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS";
const NOW = Date.UTC(2026, 10, 9, 8, 0, 0);
const DEFAULT = "nothing leaves this machine (every default)";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-doctor-sharing-"));
  mkdirSync(join(dir, "home"));
  resetSharingLog();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const missing = (name: string) => join(dir, "nowhere", name);

/** Every host's file missing, no command found, and the environment the test gives. */
function context(env: Record<string, string | undefined> = {}): DoctorContext {
  return {
    dataDir: dir,
    storeDir: dir,
    settingsPath: missing("settings.json"),
    codexHooksPath: missing("codex.json"),
    cursorHooksPath: missing("cursor.json"),
    geminiSettingsPath: missing("gemini.json"),
    opencodePluginPath: missing("opencode.ts"),
    qwenSettingsPath: missing("qwen.json"),
    droidSettingsPath: missing("droid.json"),
    copilotHooksPath: missing("copilot.json"),
    antigravityHooksPath: missing("antigravity.json"),
    claudeDesktopConfigPath: missing("claude_desktop_config.json"),
    which: () => null,
    now: NOW,
    legacyVariables: [],
    env: { PATH: process.env.PATH, HOME: join(dir, "home"), ...env },
    gitVersion: () => [2, 40, 0],
  };
}

const checks = (env: Record<string, string | undefined> = {}): Check[] => runChecks(context(env));
function sharing(env: Record<string, string | undefined> = {}): Check {
  const found = checks(env).find((check) => check.name === "sharing");
  if (found === undefined) throw new Error("no sharing check");
  return found;
}

const open = () => openDb({ dataDir: dir, busyTimeoutMs: 2000 });
const writeEnv = (...lines: string[]) => writeFileSync(join(dir, "env"), `${lines.join("\n")}\n`);

/** A root's taxonomy file, as the knowledge store writes it. */
function writeTaxonomy(root: "workspace" | "shared", ...ids: string[]): void {
  const folder = join(dir, "knowledge", root);
  mkdirSync(folder, { recursive: true });
  const areas = ids.map((id) => ({ id, label: id }));
  writeFileSync(
    join(folder, "taxonomy.md"),
    renderTaxonomy({ version: 1, updated: "2026-11-09T00:00:00.000Z", areas }),
  );
}

/** A project known by its remote alias. Returns its id. */
function addProject(db: Db, name: string): number {
  const remote = `remote:github.com/acme/${name}`;
  const id = db
    .query<{ id: number }, [string, string]>(
      "INSERT INTO projects (key, name, created_at) VALUES (?, ?, 1) RETURNING id",
    )
    .get(remote, name)?.id as number;
  db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [remote, id]);
  return id;
}

function share(db: Db, projectId: number, level: Level): void {
  const outcome = setLevel(db, {
    projectId,
    destination: "team",
    level,
    source: "cli",
    now: NOW,
    confirm: true,
  });
  if (!outcome.ok) throw new Error(outcome.reason);
}

describe("doctor: sharing", () => {
  test("is skipped with no database", () => {
    expect(sharing()).toMatchObject({ status: "skip" });
  });

  test("a fresh store: nothing leaves", () => {
    open().close();
    expect(sharing()).toEqual({ name: "sharing", status: "ok", detail: DEFAULT });
  });

  test("what is allowed, the projects per level and the epoch", () => {
    writeTaxonomy("workspace", "sales", "marketing");
    const db = open();
    applySettingsPatch(
      db,
      dir,
      { [ROOTS_KEY]: "workspace", [AREAS_KEY]: "workspace:sales,workspace:marketing" },
      "cli",
      NOW,
      true,
    );
    share(db, addProject(db, "widgets"), "knowledge");
    share(db, addProject(db, "gears"), "all");
    expect(counterOf(db)).toBe(3);
    db.close();
    const epoch = epochOf(3, {
      roots: ["workspace"],
      areas: ["workspace:marketing", "workspace:sales"],
    });
    expect(sharing()).toEqual({
      name: "sharing",
      status: "ok",
      detail: `roots: workspace · 2 allowed areas · knowledge: 1 project · knowledge and memories: 1 project · epoch ${epoch}`,
    });
  });

  test("an emptied list is named by the token's place, never its value", () => {
    open().close();
    writeEnv(`${AREAS_KEY}=workspace:Sales!`);
    const check = sharing();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("token 1");
    expect(check.detail).not.toContain("Sales!");
  });

  test("an environment value that would widen is ignored, and said", () => {
    const db = open();
    applySettingsPatch(db, dir, { [ROOTS_KEY]: "workspace" }, "cli", NOW, true);
    db.close();
    const check = sharing({ [ROOTS_KEY]: "workspace,shared" });
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("environment");
    expect(check.detail).toContain("ignored");
  });

  test("a level whose remote is gone names its project", () => {
    const db = open();
    const widgets = addProject(db, "widgets");
    share(db, widgets, "knowledge");
    db.run("DELETE FROM project_aliases WHERE project_id = ?", [widgets]);
    db.close();
    const check = sharing();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("widgets");
  });

  test("an area id no taxonomy holds is named", () => {
    writeTaxonomy("workspace", "sales");
    const db = open();
    applySettingsPatch(db, dir, { [AREAS_KEY]: "workspace:legal" }, "cli", NOW, true);
    db.close();
    const check = sharing();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("workspace:legal");
  });

  test("a hand edit of the env file nobody recorded", () => {
    const db = open();
    applySettingsPatch(db, dir, { [ROOTS_KEY]: "workspace" }, "cli", NOW, true);
    db.close();
    writeEnv(`${ROOTS_KEY}=shared,workspace`);
    const check = sharing();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("changed outside the viewer and the CLI");
  });

  test("comes after knowledge, and every other check is still there", () => {
    open().close();
    const names = checks().map((check) => check.name);
    expect(names.indexOf("sharing")).toBe(names.indexOf("knowledge") + 1);
    for (const name of ["data directory", "database", "backups", "knowledge", "Claude Code"]) {
      expect(names).toContain(name);
    }
    expect(names.filter((name) => name === "sharing")).toHaveLength(1);
  });
});
