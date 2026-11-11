// The sharing store's writes for a server operation (ADR 0027): the confirmation of a joined
// server, the removal of its levels, and the change rows a server operation logs.
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy } from "../../src/sharing/policy.ts";
import { wouldLeave } from "../../src/sharing/report.ts";
import {
  confirmServer,
  counterOf,
  levelRows,
  logServerChange,
  recentChanges,
  removeServerLevels,
  SETTINGS_SEEN_KEY,
  settingsSeen,
} from "../../src/sharing/store.ts";
import { openDb, withWrite } from "../../src/store/db.ts";
import { getMeta } from "../../src/store/meta.ts";

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-sharing-server-writes-"));
  db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = 1_700_000_000_000;
const ALIAS = "remote:github.com/acme/site";

function project(id: number, alias = `${ALIAS}-${id}`): void {
  db.run("INSERT INTO projects (id, key, name, created_at) VALUES (?, ?, ?, 1)", [
    id,
    `${alias}#${id}`,
    `p${id}`,
  ]);
  db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [alias, id]);
}

function server(
  serverId: string,
  url = `https://${serverId}.example.com`,
  confirmedAt: number | null = null,
): void {
  db.run(
    `INSERT INTO sharing_servers (server_id, url, name, device_id, device_alias, member_id,
       member_name, role, contract, instance, confirmed_at, added_at)
     VALUES (?, ?, ?, 'd', 'laptop', 'm', 'Ana', 'member', 1, 'i', ?, ?)`,
    [serverId, url, `Team ${serverId}`, confirmedAt, NOW],
  );
}

function level(projectId: number, destination: string, level: string): void {
  db.run(
    `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
     VALUES (?, ?, ?, ?, ?, 'cli')`,
    [projectId, destination, level, `${ALIAS}-${projectId}`, NOW],
  );
}

function ledger(destination: string, uid: string): void {
  db.run(
    `INSERT INTO sharing_ledger (destination, item_kind, item_uid, direction, version, hash, policy_epoch, at)
     VALUES (?, 'entry', ?, 'sent', 1, 'h', 1, ?)`,
    [destination, uid, NOW],
  );
}

const serverRow = (serverId: string) =>
  db
    .query<{ confirmed_at: number | null; roots: string; areas: string }, [string]>(
      "SELECT confirmed_at, roots, areas FROM sharing_servers WHERE server_id = ?",
    )
    .get(serverId);

const ledgerDestinations = () =>
  db
    .query<{ destination: string; item_uid: string }, []>(
      "SELECT destination, item_uid FROM sharing_ledger ORDER BY destination, item_uid",
    )
    .all();

describe("logServerChange and removeServerLevels", () => {
  test("a server change is one row with the given what, old and new", () => {
    logServerChange(db, "server:s1", "", "s1.example.com", NOW);
    logServerChange(db, "server:s1", "mute", "", NOW + 1, "viewer");
    expect(recentChanges(db, 5).reverse()).toMatchObject([
      { at: NOW, source: "cli", what: "server:s1", old: "", new: "s1.example.com" },
      { at: NOW + 1, source: "viewer", what: "server:s1", old: "mute", new: "" },
    ]);
  });

  test("removeServerLevels deletes that server's levels only, logs each as the system's, and counts once", () => {
    project(1);
    project(2);
    project(3);
    level(1, "s1", "knowledge");
    level(2, "s1", "all");
    level(3, "s2", "knowledge");
    const before = counterOf(db);
    const removed = withWrite(db, () => removeServerLevels(db, "s1", NOW));
    expect(removed).toEqual({ removed: [1, 2] });
    expect(levelRows(db).map((row) => [row.projectId, row.destination])).toEqual([[3, "s2"]]);
    expect(counterOf(db)).toBe(before + 1);
    expect(recentChanges(db, 5).reverse()).toMatchObject([
      { source: "system", what: "project:1@s1", old: "knowledge", new: "local" },
      { source: "system", what: "project:2@s1", old: "all", new: "local" },
    ]);
    expect(removeServerLevels(db, "s1", NOW)).toEqual({ removed: [] });
    expect(counterOf(db)).toBe(before + 1);
  });
});

describe("confirmServer", () => {
  test("the first server: confirmed, logged, the team rows moved, the lists copied, the baseline re-set", () => {
    writeFileSync(
      join(dir, "env"),
      "WIZARDINGCODE_MEM_SHARE_ROOTS=workspace\nWIZARDINGCODE_MEM_SHARE_AREAS=workspace:sales,shared:ops\n",
      { mode: 0o600 },
    );
    project(1);
    project(2);
    level(1, "team", "knowledge");
    level(2, "team", "all");
    ledger("team", "workspace:a");
    ledger("team", "workspace:b");
    server("s1", "https://one.example.com:8443");
    const before = counterOf(db);
    const outcome = confirmServer(db, dir, "s1", NOW + 5);
    expect(outcome).toEqual({ first: true, moved: { levels: 2, ledger: 2 } });
    expect(serverRow("s1")).toEqual({
      confirmed_at: NOW + 5,
      roots: "workspace",
      areas: "shared:ops,workspace:sales",
    });
    expect(levelRows(db).map((row) => [row.projectId, row.destination, row.level])).toEqual([
      [1, "s1", "knowledge"],
      [2, "s1", "all"],
    ]);
    expect(ledgerDestinations()).toEqual([
      { destination: "s1", item_uid: "workspace:a" },
      { destination: "s1", item_uid: "workspace:b" },
    ]);
    expect(recentChanges(db, 1)[0]).toMatchObject({
      at: NOW + 5,
      source: "cli",
      what: "server:s1",
      old: "",
      new: "one.example.com:8443",
    });
    expect(counterOf(db)).toBe(before + 1);
    expect(settingsSeen(db)).toEqual({
      roots: ["workspace"],
      areas: ["shared:ops", "workspace:sales"],
    });
    // The loader reads the moved rows under the server, in force.
    const policy = loadPolicy(db, dir, {}, "s1");
    expect(policy.closed).toBe(false);
    expect(policy.destinations.has("s1")).toBe(true);
    expect(policy.levels.get("1@s1")?.level).toBe("knowledge");
    expect(policy.levels.get("2@s1")?.level).toBe("all");
    const report = wouldLeave(db, dir, {}, policy, { now: NOW, destination: "s1" });
    expect(report.perProject).toEqual([
      { id: 1, level: "knowledge", entries: 0, memories: 0 },
      { id: 2, level: "all", entries: 0, memories: 0 },
    ]);
  });

  test("with no team rows nothing moves; a second server moves nothing and is not the first", () => {
    project(1);
    server("s1");
    db.run("DELETE FROM meta WHERE key = ?", [SETTINGS_SEEN_KEY]);
    expect(confirmServer(db, dir, "s1", NOW)).toEqual({
      first: true,
      moved: { levels: 0, ledger: 0 },
    });
    expect(getMeta(db, SETTINGS_SEEN_KEY)).toBe(JSON.stringify({ roots: [], areas: [] }));
    level(1, "team", "knowledge");
    server("s2");
    const before = counterOf(db);
    expect(withWrite(db, () => confirmServer(db, dir, "s2", NOW + 1, "viewer"))).toEqual({
      first: false,
      moved: { levels: 0, ledger: 0 },
    });
    expect(serverRow("s2")?.confirmed_at).toBe(NOW + 1);
    expect(levelRows(db).map((row) => row.destination)).toEqual(["team"]);
    expect(counterOf(db)).toBe(before + 1);
    expect(recentChanges(db, 1)[0]).toMatchObject({
      what: "server:s2",
      old: "",
      new: "s2.example.com",
      source: "viewer",
    });
  });

  test("refuses a server that is not listed", () => {
    expect(() => confirmServer(db, dir, "nope", NOW)).toThrow(/nope/);
  });
});
