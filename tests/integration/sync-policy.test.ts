// The policy per server where it is read outside the sharing module (ADR 0027): the viewer's
// project list, status's sharing line, doctor's sharing check, and `share … --server`.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import { type DoctorContext, runChecks } from "../../src/doctor/checks.ts";
import { renderTaxonomy } from "../../src/modules/knowledge/entry.ts";
import { resetGitCaches } from "../../src/modules/knowledge/repo.ts";
import { loadPolicy, resetSharingLog } from "../../src/sharing/policy.ts";
import {
  levelRows,
  recentChanges,
  SETTINGS_SEEN_KEY,
  serverLists,
} from "../../src/sharing/store.ts";
import { statusReport } from "../../src/status/report.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { setMeta } from "../../src/store/meta.ts";
import { listProjects } from "../../src/ui/api.ts";
import { runCliWith } from "../helpers/cli.ts";
import { realGit } from "../helpers/stub-git.ts";

const NOW = 1_700_000_000_000;
const REMOTE = "remote:github.com/acme/site";

let dir: string;
let dataDir: string;
let home: string;
let project: string;
let projectId: number;
let env: Record<string, string>;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-sync-policy-")));
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
    WIZARDINGCODE_MEM_SYNC: "off",
  };
  resetGitCaches();
  resetSharingLog();
  projectId = withDb((db) => {
    // The env file below is the baseline, not a hand edit.
    setMeta(
      db,
      SETTINGS_SEEN_KEY,
      JSON.stringify({ roots: ["workspace"], areas: ["workspace:sales"] }),
    );
    return resolveProject(db, project, 1).id;
  });
  const folder = join(dataDir, "knowledge", "workspace");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "taxonomy.md"),
    renderTaxonomy({
      version: 1,
      updated: "2026-11-10T00:00:00Z",
      areas: [{ id: "sales", label: "Sales" }],
    }),
  );
  writeFileSync(
    join(dataDir, "env"),
    "WIZARDINGCODE_MEM_SHARE_ROOTS=workspace\nWIZARDINGCODE_MEM_SHARE_AREAS=workspace:sales\n",
  );
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

function server(db: Db, serverId: string, name: string, confirmed = true): void {
  db.run(
    `INSERT INTO sharing_servers (server_id, url, name, device_id, device_alias, member_id,
       member_name, role, contract, instance, confirmed_at, roots, areas, added_at)
     VALUES (?, ?, ?, 'd', 'laptop', 'm', 'Ana', 'member', 1, 'i', ?, 'workspace', 'workspace:sales', ?)`,
    [serverId, `https://${serverId}.example.com`, name, confirmed ? NOW : null, NOW],
  );
}

function level(db: Db, destination: string, lvl: string, id = projectId): void {
  db.run(
    `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
     VALUES (?, ?, ?, ?, ?, 'cli')`,
    [id, destination, lvl, REMOTE, NOW],
  );
}

const share = (...args: string[]) => runCliWith({ env, cwd: project }, "share", ...args);

/** Every host's file missing, no command found: the sharing check is what is read. */
function doctorContext(): DoctorContext {
  const missing = (name: string) => join(dir, "nowhere", name);
  return {
    dataDir,
    storeDir: dataDir,
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
    env,
    gitVersion: () => [2, 40, 0],
  };
}

describe("the readers outside the sharing module", () => {
  test("the viewer's project list, status's line and doctor's check read the bound server's level, never team", () => {
    withDb((db) => {
      server(db, "s1", "Alpha");
      server(db, "s2", "Beta");
      level(db, "s2", "knowledge");
      const policy = loadPolicy(db, dataDir, env);
      expect(policy.server).toBe("s1");
      const listed = listProjects(db, policy).find((row) => row.id === projectId);
      expect(listed).toMatchObject({ sharing: "knowledge", sharingReason: "allowed" });
      const ref = resolveProject(db, project, 1);
      const status = statusReport(db, ref, dataDir, { env, now: NOW });
      expect(status.sharing.level).toBe("knowledge");
      const check = runChecks(doctorContext()).find((c) => c.name === "sharing");
      expect(check?.detail).not.toContain("outside");
      expect(check?.status).toBe("ok");
      expect(check?.detail).toContain("knowledge: 1 project");
      // A team row left by an older binary reads Nothing once a server is confirmed.
      db.run("DELETE FROM sharing_levels");
      level(db, "team", "all");
      const stale = listProjects(db, loadPolicy(db, dataDir, env)).find(
        (row) => row.id === projectId,
      );
      expect(stale?.sharing).toBe("local");
      expect(statusReport(db, ref, dataDir, { env, now: NOW }).sharing.level).toBe("local");
    });
  });
});

describe("share … --server", () => {
  test("project receive --server binds without sending; the only confirmed server is the default; a second server is refused", async () => {
    withDb((db) => {
      server(db, "s1", "Alpha");
      server(db, "s2", "Beta", false);
    });
    const bound = await share("project", "receive", "--server", "Alpha");
    expect(bound.exitCode).toBe(0);
    expect(bound.stdout).toContain("Receive only");
    expect(withDb((db) => levelRows(db).map((row) => [row.destination, row.level]))).toEqual([
      ["s1", "receive"],
    ]);
    const widened = await share("project", "knowledge");
    expect(widened.exitCode).toBe(1);
    expect(widened.stderr).toContain("--yes");
    const yes = await share("project", "knowledge", "--yes");
    expect(yes.exitCode).toBe(0);
    expect(withDb((db) => levelRows(db).map((row) => [row.destination, row.level]))).toEqual([
      ["s1", "knowledge"],
    ]);
    const pending = await share("project", "receive", "--server", "Beta");
    expect(pending.exitCode).toBe(1);
    expect(pending.stderr).toContain("not confirmed");
    withDb((db) =>
      db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = 's2'", [NOW]),
    );
    const other = await share("project", "receive", "--server", "s2");
    expect(other.exitCode).toBe(1);
    expect(other.stderr).toContain("bound to");
    const ambiguous = await share("project", "receive");
    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguous.stderr).toContain("--server");
    const unknown = await share("status", "--server", "nobody");
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("names no server");
  });

  test("roots and areas --server edit the server's lists; without it the env file's; status and explain take --server", async () => {
    withDb((db) => {
      server(db, "s1", "Alpha");
      server(db, "s2", "Beta");
    });
    const roots = await share("roots", "none", "--server", "s1");
    expect(roots.exitCode).toBe(0);
    expect(withDb((db) => serverLists(db, "s1"))).toEqual({
      roots: [],
      areas: ["workspace:sales"],
    });
    expect(withDb((db) => recentChanges(db, 1)[0])).toMatchObject({
      what: "roots@s1",
      old: "workspace",
      new: "none",
    });
    const wider = await share("roots", "workspace,shared", "--server", "s1");
    expect(wider.exitCode).toBe(1);
    expect(wider.stderr).toContain("--yes");
    const widerYes = await share("roots", "workspace,shared", "--server", "s1", "--yes");
    expect(widerYes.exitCode).toBe(0);
    expect(withDb((db) => serverLists(db, "s1").roots)).toEqual(["shared", "workspace"]);
    const file = await share("areas", "none", "--yes");
    expect(file.exitCode).toBe(0);
    expect(withDb((db) => serverLists(db, "s1").areas)).toEqual(["workspace:sales"]);
    const status = await share("status", "--server", "s2");
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("roots     workspace");
    expect(status.stdout).toContain("areas     none");
    const explain = await share("explain", "workspace/nothing", "--server", "s2");
    expect(explain.exitCode).toBe(1);
    expect(explain.stderr).toContain("not found");
  });
});
