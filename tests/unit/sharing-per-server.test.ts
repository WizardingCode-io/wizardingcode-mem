// The policy per server (ADR 0027): the confirmed servers as destinations, a server's lists
// intersected with the file's and the environment's, the level `receive`, the one-server
// rule, the unbound row, the team row's removal, and the ledger's `local_hash`.
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderTaxonomy } from "../../src/modules/knowledge/entry.ts";
import {
  aliasBoundTo,
  boundServerOf,
  DESTINATIONS,
  destinationsOf,
  effectiveLevel,
  epochOf,
  levelOf,
} from "../../src/sharing/levels.ts";
import { decide, loadPolicy } from "../../src/sharing/policy.ts";
import { ledgerRecords } from "../../src/sharing/report.ts";
import {
  counterOf,
  levelRows,
  previewLevel,
  recentChanges,
  reconcileLevels,
  serverLists,
  setLevel,
  setLevelMessage,
  setServerLists,
} from "../../src/sharing/store.ts";
import type { EntryItem } from "../../src/sharing/types.ts";
import { openDb } from "../../src/store/db.ts";

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-sharing-per-server-"));
  db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = 1_700_000_000_000;
const ALIAS = "remote:github.com/acme/site";
const alias = (id: number) => `${ALIAS}-${id}`;

function project(id: number, extraAlias?: string): void {
  db.run("INSERT INTO projects (id, key, name, created_at) VALUES (?, ?, ?, 1)", [
    id,
    `${alias(id)}#${id}`,
    `p${id}`,
  ]);
  db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [alias(id), id]);
  if (extraAlias !== undefined)
    db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [extraAlias, id]);
}

function server(
  serverId: string,
  name: string,
  confirmed = true,
  lists = { roots: "", areas: "" },
): void {
  db.run(
    `INSERT INTO sharing_servers (server_id, url, name, device_id, device_alias, member_id,
       member_name, role, contract, instance, confirmed_at, roots, areas, added_at)
     VALUES (?, ?, ?, 'd', 'laptop', 'm', 'Ana', 'member', 1, 'i', ?, ?, ?, ?)`,
    [
      serverId,
      `https://${serverId}.example.com`,
      name,
      confirmed ? NOW : null,
      lists.roots,
      lists.areas,
      NOW,
    ],
  );
}

function rawLevel(
  projectId: number,
  destination: string,
  level: string,
  boundAlias = alias(projectId),
): void {
  db.run(
    `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
     VALUES (?, ?, ?, ?, ?, 'cli')`,
    [projectId, destination, level, boundAlias, NOW],
  );
}

const set = (
  projectId: number,
  destination: string,
  level: "local" | "receive" | "knowledge" | "all",
  confirm = false,
) => setLevel(db, { projectId, destination, level, source: "cli", now: NOW, confirm });

const unbound = () =>
  db
    .query<{ server_id: string; alias: string }, []>(
      "SELECT server_id, alias FROM sharing_unbound ORDER BY server_id, alias",
    )
    .all();

function taxonomy(root: "workspace" | "shared", areas: string[]): void {
  const folder = join(dir, "knowledge", root);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "taxonomy.md"),
    renderTaxonomy({
      version: 1,
      updated: "2026-11-10T00:00:00Z",
      areas: areas.map((id) => ({ id, label: id })),
    }),
  );
}

describe("the destinations", () => {
  test("destinationsOf: team while none is confirmed, the confirmed ids after; a bare store reads team", () => {
    expect(destinationsOf(null)).toEqual(DESTINATIONS);
    expect([...destinationsOf(db)]).toEqual(["team"]);
    server("s2", "Beta", false);
    expect([...destinationsOf(db)]).toEqual(["team"]);
    server("s1", "Alpha");
    expect([...destinationsOf(db)]).toEqual(["s1"]);
    db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = 's2'", [NOW]);
    expect([...destinationsOf(db)]).toEqual(["s1", "s2"]);
    const bare = openDb({ dataDir: join(dir, "bare"), busyTimeoutMs: 2000, moduleSchemas: [] });
    expect([...destinationsOf(bare)]).toEqual(["team"]);
    expect(loadPolicy(bare, join(dir, "bare"), {}).destinations).toEqual(new Set(["team"]));
    bare.close();
  });

  test("boundServerOf: the server a project is bound to, null when none or when only team", () => {
    project(1);
    project(2);
    server("s1", "Alpha");
    rawLevel(1, "s1", "receive");
    rawLevel(2, "team", "knowledge");
    expect(boundServerOf(db, 1)).toBe("s1");
    expect(boundServerOf(db, 2)).toBeNull();
    expect(boundServerOf(db, 3)).toBeNull();
  });

  test("aliasBoundTo: the level's own alias binds; another alias of the same project does not", () => {
    const other = "remote:github.com/acme/other";
    project(1, other);
    project(2);
    server("s1", "One");
    rawLevel(1, "s1", "knowledge");
    rawLevel(2, "s1", "local");
    expect(aliasBoundTo(db, "s1", alias(1))).toBe(true);
    // The same rule as boundAliasesOf: the alias the level names, not any alias the project has.
    expect(aliasBoundTo(db, "s1", other)).toBe(false);
    expect(aliasBoundTo(db, "s1", alias(2))).toBe(false);
    expect(aliasBoundTo(db, "s2", alias(1))).toBe(false);
  });

  test("effectiveLevel reads a receive row in force as local with level-receive", () => {
    const known = { known: true, disabled: false, aliases: [alias(1)] };
    const row = { level: "receive", boundAlias: alias(1) };
    expect(effectiveLevel(row, known, "s1", new Set(["s1"]))).toEqual({
      level: "local",
      reason: "level-receive",
    });
    expect(effectiveLevel(row, { ...known, disabled: true }, "s1", new Set(["s1"]))).toEqual({
      level: "local",
      reason: "disabled",
    });
    expect(effectiveLevel(row, known, "s1", new Set(["s2"]))).toEqual({
      level: "local",
      reason: "unknown-destination",
    });
  });
});

describe("loadPolicy per server", () => {
  test("with a server: the lists intersected (server, file, environment), the epoch of that server, the levels per destination", () => {
    taxonomy("workspace", ["sales", "legal", "ops"]);
    taxonomy("shared", ["ops"]);
    writeFileSync(
      join(dir, "env"),
      "WIZARDINGCODE_MEM_SHARE_ROOTS=workspace,shared\nWIZARDINGCODE_MEM_SHARE_AREAS=workspace:sales,workspace:legal,shared:ops\n",
    );
    project(1);
    project(2);
    server("s1", "Alpha", true, {
      roots: "workspace",
      areas: "workspace:sales,workspace:ops,shared:ops",
    });
    server("s2", "Beta", true, { roots: "workspace,shared", areas: "shared:ops" });
    rawLevel(1, "s1", "knowledge");
    rawLevel(2, "s2", "all");
    const one = loadPolicy(db, dir, {}, "s1");
    expect(one.closed).toBe(false);
    expect(one.server).toBe("s1");
    expect([...one.destinations]).toEqual(["s1", "s2"]);
    expect([...one.roots]).toEqual(["workspace"]);
    expect([...one.areas]).toEqual(["shared:ops", "workspace:sales"]);
    expect(one.epoch).toBe(
      epochOf(counterOf(db), { roots: ["workspace"], areas: ["shared:ops", "workspace:sales"] }),
    );
    expect(levelOf(one, 1, "s1")).toEqual({ level: "knowledge", reason: "allowed" });
    expect(levelOf(one, 2, "s2")).toEqual({ level: "all", reason: "allowed" });
    expect(levelOf(one, 2, "s1")).toEqual({ level: "local", reason: "level-local" });
    expect(levelOf(one, 1, "team")).toEqual({ level: "local", reason: "unknown-destination" });

    const two = loadPolicy(db, dir, {}, "s2");
    expect(two.server).toBe("s2");
    expect([...two.roots]).toEqual(["shared", "workspace"]);
    expect([...two.areas]).toEqual(["shared:ops"]);
    expect(two.epoch).not.toBe(one.epoch);
    // The environment only narrows.
    const narrowed = loadPolicy(db, dir, { WIZARDINGCODE_MEM_SHARE_ROOTS: "shared" }, "s2");
    expect([...narrowed.roots]).toEqual(["shared"]);
    // Without a server: the first confirmed server by name.
    const first = loadPolicy(db, dir, {});
    expect(first.server).toBe("s1");
    expect([...first.roots]).toEqual(["workspace"]);
    // A pending server is no destination; naming it loads the confirmed set with that server's lists.
    server("s3", "Gamma", false);
    expect(loadPolicy(db, dir, {}, "s3").destinations.has("s3")).toBe(false);
    // The settings' problems and the file's lists are the policy's as before.
    expect(one.fileLists).toEqual({
      roots: ["shared", "workspace"],
      areas: ["shared:ops", "workspace:legal", "workspace:sales"],
    });
  });

  test("without a confirmed server the policy reads team as part 4 did, whatever the server rows", () => {
    project(1);
    rawLevel(1, "team", "knowledge");
    server("s1", "Alpha", false);
    const policy = loadPolicy(db, dir, {});
    expect(policy.server).toBeNull();
    expect([...policy.destinations]).toEqual(["team"]);
    expect(levelOf(policy, 1, "team")).toEqual({ level: "knowledge", reason: "allowed" });
  });

  test("a project at receive decides keep with level-receive and is never sent", () => {
    project(1);
    server("s1", "Alpha", true, { roots: "workspace", areas: "workspace:sales" });
    rawLevel(1, "s1", "receive");
    const policy = loadPolicy(db, dir, {}, "s1");
    expect(levelOf(policy, 1, "s1")).toEqual({ level: "local", reason: "level-receive" });
    const item: EntryItem = {
      kind: "entry",
      uid: `project:${alias(1)}:11111111-2222-4333-8444-555555555555`,
      scope: "project",
      projectId: 1,
      area: "sales",
      status: "active",
      problem: null,
      version: 1,
      hash: "h",
    };
    expect(decide(policy, "s1", item, [])).toEqual({
      answer: "keep",
      reason: "level-receive",
      epoch: policy.epoch,
    });
  });
});

describe("setLevel per server", () => {
  test("receive binds without confirm, is idempotent, logs receive to local; receive to knowledge needs confirm", () => {
    project(1);
    server("s1", "Alpha");
    expect(set(1, "s1", "receive")).toMatchObject({
      ok: true,
      old: "local",
      widened: false,
      boundAlias: alias(1),
    });
    expect(levelRows(db).map((row) => [row.destination, row.level])).toEqual([["s1", "receive"]]);
    const counter = counterOf(db);
    expect(set(1, "s1", "receive")).toMatchObject({ ok: true, old: "receive", widened: false });
    expect(counterOf(db)).toBe(counter);
    expect(set(1, "s1", "knowledge")).toEqual({ ok: false, reason: "needs-confirm" });
    expect(set(1, "s1", "knowledge", true)).toMatchObject({
      ok: true,
      old: "receive",
      widened: true,
    });
    expect(set(1, "s1", "receive")).toMatchObject({ ok: true, old: "knowledge", widened: false });
    expect(set(1, "s1", "local")).toMatchObject({ ok: true, old: "local", widened: false });
    expect(levelRows(db)).toEqual([]);
    const changes = recentChanges(db, 10)
      .reverse()
      .map((c) => [c.what, c.old, c.new]);
    expect(changes).toEqual([
      ["project:1@s1", "local", "receive"],
      ["project:1@s1", "receive", "knowledge"],
      ["project:1@s1", "knowledge", "receive"],
      ["project:1@s1", "receive", "local"],
    ]);
    expect(previewLevel(loadPolicy(db, dir, {}, "s1"), 1, "knowledge", "s1")).toEqual({
      current: "local",
      widened: true,
    });
  });

  test("a project bound to one server is refused another with one-server; the index refuses it in SQL", () => {
    project(1);
    server("s1", "Alpha");
    server("s2", "Beta");
    expect(set(1, "s1", "knowledge", true)).toMatchObject({ ok: true });
    expect(set(1, "s2", "receive")).toEqual({ ok: false, reason: "one-server", server: "s1" });
    expect(setLevelMessage("one-server")).toContain("set it to Nothing there first");
    expect(set(1, "s2", "local")).toMatchObject({ ok: true });
    expect(() => rawLevel(1, "s2", "knowledge")).toThrow(/UNIQUE/);
    expect(set(1, "s1", "local")).toMatchObject({ ok: true });
    expect(set(1, "s2", "receive")).toMatchObject({ ok: true });
    // A destination that is not a confirmed server throws, as before.
    expect(() => set(1, "team", "knowledge", true)).toThrow("team");
    expect(() => set(1, "s9", "knowledge", true)).toThrow("s9");
  });

  test("the unbound row: written when the last enabled project under an alias goes to Nothing, removed when one is bound", () => {
    project(1);
    project(2);
    server("s1", "Alpha");
    // Two projects bound under one alias: the second's row was bound before the alias moved.
    expect(set(1, "s1", "knowledge", true)).toMatchObject({ ok: true });
    rawLevel(2, "s1", "knowledge", alias(1));
    expect(unbound()).toEqual([]);
    expect(set(1, "s1", "local")).toMatchObject({ ok: true });
    expect(unbound()).toEqual([]);
    expect(set(2, "s1", "local")).toMatchObject({ ok: true });
    expect(unbound()).toEqual([{ server_id: "s1", alias: alias(1) }]);
    expect(set(2, "s1", "receive")).toMatchObject({ ok: true });
    expect(unbound()).toEqual([{ server_id: "s1", alias: alias(1) }]);
    expect(set(1, "s1", "receive")).toMatchObject({ ok: true });
    expect(unbound()).toEqual([]);
    // Project 2 is bound under its own alias now: project 1 leaving unbinds alias 1 again.
    expect(set(1, "s1", "local")).toMatchObject({ ok: true });
    expect(unbound()).toEqual([{ server_id: "s1", alias: alias(1) }]);
    // A disabled project still bound under the alias does not keep it bound.
    project(3);
    rawLevel(3, "s1", "knowledge", alias(1));
    db.run("UPDATE projects SET disabled = 1 WHERE id = 3");
    expect(set(1, "s1", "receive")).toMatchObject({ ok: true });
    expect(unbound()).toEqual([]);
    expect(set(1, "s1", "local")).toMatchObject({ ok: true });
    expect(unbound()).toEqual([{ server_id: "s1", alias: alias(1) }]);
  });
});

describe("reconcileLevels and the server's lists", () => {
  test("once a server is confirmed, a team row and a row of an unconfirmed destination are removed with a logged system change", () => {
    project(1);
    project(2);
    project(3);
    rawLevel(1, "team", "knowledge");
    rawLevel(2, "other", "all");
    expect(reconcileLevels(db, NOW)).toEqual({ removed: [] });
    server("s1", "Alpha");
    rawLevel(3, "s1", "knowledge");
    expect(reconcileLevels(db, NOW + 1)).toEqual({ removed: [1, 2] });
    expect(levelRows(db).map((row) => [row.projectId, row.destination])).toEqual([[3, "s1"]]);
    expect(
      recentChanges(db, 2)
        .reverse()
        .map((c) => [c.source, c.what, c.old, c.new]),
    ).toEqual([
      ["system", "project:1", "knowledge", "local"],
      ["system", "project:2", "all", "local"],
    ]);
  });

  test("a row bound to a forgotten shared name is removed as the system's (ADR 0028)", () => {
    project(4, "name:docs");
    server("s1", "Alpha");
    rawLevel(4, "s1", "knowledge", "name:docs");
    expect(reconcileLevels(db, NOW)).toEqual({ removed: [] });
    db.run("DELETE FROM project_aliases WHERE alias = 'name:docs'");
    expect(reconcileLevels(db, NOW + 1)).toEqual({ removed: [4] });
    expect(levelRows(db)).toEqual([]);
    expect(recentChanges(db, 1)[0]).toMatchObject({
      source: "system",
      what: "project:4",
      old: "knowledge",
      new: "local",
    });
  });

  test("setServerLists validates, writes the server's lists, logs roots@<id> and areas@<id>, counts once", () => {
    server("s1", "Alpha");
    const before = counterOf(db);
    expect(
      setServerLists(
        db,
        "s1",
        { roots: ["workspace"], areas: ["workspace:sales", "shared:ops"] },
        { source: "cli", now: NOW, confirm: true },
      ),
    ).toEqual({ ok: true, changed: ["roots", "areas"] });
    expect(serverLists(db, "s1")).toEqual({
      roots: ["workspace"],
      areas: ["shared:ops", "workspace:sales"],
    });
    expect(counterOf(db)).toBe(before + 1);
    expect(
      recentChanges(db, 2)
        .reverse()
        .map((c) => [c.what, c.old, c.new]),
    ).toEqual([
      ["roots@s1", "none", "workspace"],
      ["areas@s1", "none", "shared:ops,workspace:sales"],
    ]);
    expect(
      setServerLists(
        db,
        "s1",
        { roots: ["workspace"] },
        { source: "cli", now: NOW, confirm: false },
      ),
    ).toEqual({ ok: true, changed: [] });
    // A widening is refused in the store until it is confirmed; nothing is written or logged.
    const logged = recentChanges(db, 1)[0];
    expect(
      setServerLists(
        db,
        "s1",
        { areas: ["shared:ops", "workspace:code"] },
        { source: "viewer", now: NOW, confirm: false },
      ),
    ).toEqual({
      ok: false,
      reason: "needs-confirm",
      widening: { roots: [], areas: ["workspace:code"] },
    });
    expect(serverLists(db, "s1").areas).toEqual(["shared:ops", "workspace:sales"]);
    expect(recentChanges(db, 1)[0]).toEqual(logged);
    expect(counterOf(db)).toBe(before + 1);
    // A narrowing needs no confirmation.
    expect(
      setServerLists(
        db,
        "s1",
        { areas: ["shared:ops"] },
        { source: "viewer", now: NOW, confirm: false },
      ),
    ).toEqual({ ok: true, changed: ["areas"] });
    expect(recentChanges(db, 1)[0]).toMatchObject({ what: "areas@s1", source: "viewer" });
    expect(counterOf(db)).toBe(before + 2);
    const options = { source: "cli" as const, now: NOW, confirm: true };
    expect(() => setServerLists(db, "s1", { areas: ["nope"] }, options)).toThrow(/area/);
    expect(() => setServerLists(db, "nope", { roots: [] }, options)).toThrow(/nope/);
    // An invalid stored list reads as empty, as the env lists do.
    db.run("UPDATE sharing_servers SET areas = 'bad token' WHERE server_id = 's1'");
    expect(serverLists(db, "s1").areas).toEqual([]);
  });
});

describe("ledgerRecords with local_hash", () => {
  test("an entry row hands decide its local_hash as the hash; an empty one falls back; applied rows only for the own destination", () => {
    db.run(
      `INSERT INTO sharing_ledger (destination, item_kind, item_uid, direction, version, hash, policy_epoch, at, local_hash, instance, reason)
       VALUES ('s1', 'entry', 'workspace:a', 'sent', 1, 'server-hash', 1, 1, 'index-hash', 'inst', ''),
              ('s1', 'entry', 'workspace:b', 'sent', 1, 'same', 1, 1, '', '', ''),
              ('s1', 'entry', 'workspace:a', 'applied', 2, 'srv2', 1, 2, 'idx2', 'inst', ''),
              ('s2', 'entry', 'workspace:c', 'applied', 2, 'x', 1, 2, 'y', '', ''),
              ('s2', 'entry', 'workspace:d', 'received', 1, 'r', 1, 1, '', '', ''),
              ('s1', 'memory', 'g:1', 'sent', 1, 'mh', 1, 1, 'local-mh', '', ''),
              ('s1', 'memory', 'g:2', 'sent', 1, 'mh2', 1, 1, '', '', '')`,
    );
    const entries = ledgerRecords(db, "s1", "entry");
    expect(entries.get("workspace:a")).toEqual([
      {
        destination: "s1",
        direction: "applied",
        version: 2,
        hash: "idx2",
        withdrawnAt: null,
        localHash: "idx2",
        instance: "inst",
      },
      {
        destination: "s1",
        direction: "sent",
        version: 1,
        hash: "index-hash",
        withdrawnAt: null,
        localHash: "index-hash",
        instance: "inst",
      },
    ]);
    expect(entries.get("workspace:b")).toEqual([
      { destination: "s1", direction: "sent", version: 1, hash: "same", withdrawnAt: null },
    ]);
    expect(entries.get("workspace:c")).toBeUndefined();
    expect(entries.get("workspace:d")).toEqual([
      { destination: "s2", direction: "received", version: 1, hash: "r", withdrawnAt: null },
    ]);
    const memories = ledgerRecords(db, "s1", "memory");
    expect(memories.get("g:1")?.[0]).toMatchObject({ hash: "local-mh", localHash: "local-mh" });
    expect(memories.get("g:2")?.[0]).toEqual({
      destination: "s1",
      direction: "sent",
      version: 1,
      hash: "mh2",
      withdrawnAt: null,
    });
    // A redacted sent entry (its index hash in local_hash) reads already-sent.
    const item: EntryItem = {
      kind: "entry",
      uid: "workspace:a",
      scope: "workspace",
      projectId: 0,
      area: "sales",
      status: "active",
      problem: null,
      version: 1,
      hash: "index-hash",
    };
    taxonomy("workspace", ["sales"]);
    writeFileSync(
      join(dir, "env"),
      "WIZARDINGCODE_MEM_SHARE_ROOTS=workspace\nWIZARDINGCODE_MEM_SHARE_AREAS=workspace:sales\n",
    );
    server("s1", "Alpha", true, { roots: "workspace", areas: "workspace:sales" });
    const policy = loadPolicy(db, dir, {}, "s1");
    expect(decide(policy, "s1", item, entries.get("workspace:a") ?? []).reason).toBe(
      "already-sent",
    );
  });
});
