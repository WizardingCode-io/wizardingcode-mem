// What would leave under a policy: the counts, the lists and the previews. The entries are
// written by the knowledge store into real repositories, once, into a template that each
// case copies; the memories are rows of the store.
import type { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Redacted } from "../../src/core/redact.ts";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { KNOWLEDGE_MIGRATIONS, KNOWLEDGE_MODULE } from "../../src/modules/knowledge/migrations.ts";
import { resetGitCaches } from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import { openStore } from "../../src/modules/knowledge/store-open.ts";
import type { ScopeRef } from "../../src/modules/knowledge/types.ts";
import { redactForSend } from "../../src/sharing/edge.ts";
import { memoryHash } from "../../src/sharing/hash.ts";
import { epochOf, levelOf } from "../../src/sharing/levels.ts";
import { SHARING_MIGRATIONS, SHARING_MODULE } from "../../src/sharing/migrations.ts";
import { closedPolicy, decide, loadPolicy } from "../../src/sharing/policy.ts";
import {
  areaTotals,
  entryItems,
  findEntry,
  findMemory,
  HASH_CHUNK,
  importedStayCounts,
  LIST_CAP,
  ledgerRecords,
  memoryItems,
  type Report,
  withChange,
  withHashes,
  wouldLeave,
} from "../../src/sharing/report.ts";
import { applySettingsPatch, generationOf, setLevel } from "../../src/sharing/store.ts";
import {
  ENTRY_ITEM_KEYS,
  type Level,
  MEMORY_ITEM_KEYS,
  type SharingPolicy,
} from "../../src/sharing/types.ts";
import { type Db, openDb, withWrite } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";

const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS";
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS";
const NOW = Date.UTC(2026, 10, 9, 8, 0, 0);
const HEX16 = /^[0-9a-f]{16}$/;
const WORKSPACE = { scope: "workspace" } as const;
const SHARED = { scope: "shared" } as const;
// Project A is made first, and its repository's folder (named from a hash of the remote)
// sorts after B's: an order by project id is not an order by path.
const A_REMOTE = "remote:github.com/acme/widgets";
const B_REMOTE = "remote:github.com/acme/gears";

/** A data directory with its store, and the environment its git and its redaction see. */
interface Fixture {
  dir: string;
  dataDir: string;
  env: Record<string, string | undefined>;
  db: Db;
}

/** Opens the store of a folder that holds `data/` and a throwaway `home/`, made when missing. */
function openFixture(dir: string): Fixture {
  const dataDir = join(dir, "data");
  const home = join(dir, "home");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  resetGitCaches();
  return {
    dir,
    dataDir,
    env: { PATH: process.env.PATH, HOME: home },
    db: openDb({ dataDir, busyTimeoutMs: 2000 }),
  };
}

function closeFixture(fx: Fixture): void {
  fx.db.close();
  rmSync(fx.dir, { recursive: true, force: true });
}

const newDir = () => mkdtempSync(join(tmpdir(), "wizardingcode-mem-sharing-report-"));

/** A project known by its remote alias, which is also its key. Returns its id. */
function addProject(db: Database, remote: string): number {
  const id = db
    .query<{ id: number }, [string, string]>(
      "INSERT INTO projects (key, name, created_at) VALUES (?, ?, 1) RETURNING id",
    )
    .get(remote, remote.split("/").pop() ?? remote)?.id as number;
  db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [remote, id]);
  return id;
}

/** Sets a level as a person who confirmed would. */
function share(db: Db, projectId: number, level: Level): void {
  const outcome = setLevel(db, {
    projectId,
    destination: "team",
    level,
    source: "cli",
    now: NOW,
    confirm: true,
  });
  if (!outcome.ok) throw new Error(`the level was refused: ${outcome.reason}`);
}

/** A memory as a distilled turn leaves it. Returns its id. */
function memory(
  db: Db,
  projectId: number,
  title: string,
  origin: "distilled" | "imported" = "distilled",
): number {
  return insertMemory(db, {
    projectId,
    kind: "decision",
    title,
    body: `${title}, in full.` as Redacted,
    terms: "",
    importance: 3,
    branch: null,
    commit: null,
    origin,
    judge: "heuristic",
    judgeVersion: "1",
    sourceTurnId: null,
    files: [],
    now: NOW,
  });
}

const bulkTitle = (n: number) => `Memory ${n}`;
const bulkBody = (n: number) => `What memory ${n} holds.`;

/** Active memories of a project, by one prepared statement in one transaction. Returns their ids. */
function manyMemories(db: Db, projectId: number, count: number): number[] {
  const insert = db.prepare<{ id: number }, [number, string, string, number, number]>(
    `INSERT INTO memories (project_id, kind, title, body, importance, origin, judge,
                           judge_version, created_at, updated_at)
     VALUES (?, 'decision', ?, ?, 3, 'distilled', 'heuristic', '1', ?, ?) RETURNING id`,
  );
  return withWrite(db, () =>
    Array.from(
      { length: count },
      (_, n) => insert.get(projectId, bulkTitle(n), bulkBody(n), NOW, NOW)?.id as number,
    ),
  );
}

/** The hash of the nth memory of `manyMemories` as it would leave. */
const bulkHash = (n: number, env: Fixture["env"]) =>
  memoryHash({
    memoryKind: "decision",
    importance: 3,
    status: "active",
    title: redactForSend(bulkTitle(n), env),
    body: redactForSend(bulkBody(n), env),
  });

/** A ledger row: what was sent to the team's server for one item. */
const sent = (db: Db, kind: "memory" | "entry", uid: string, hash: string) =>
  db.run(
    `INSERT INTO sharing_ledger (destination, item_kind, item_uid, direction, version, hash,
                                 policy_epoch, at)
     VALUES ('team', ?, ?, 'sent', ?, ?, 0, ?)`,
    [kind, uid, NOW, hash, NOW],
  );

/** A database that counts the statements run through it. */
function counted(db: Db): { db: Db; runs: () => number } {
  let runs = 0;
  const RUNS = new Set<string | symbol>(["all", "get", "values", "run", "iterate"]);
  const statement = (made: object): object =>
    new Proxy(made, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (RUNS.has(property)) runs++;
          return value.apply(target, args);
        };
      },
    });
  const proxy = new Proxy(db, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        return property === "query" || property === "prepare" ? statement(result) : result;
      };
    },
  });
  return { db: proxy, runs: () => runs };
}

const logOf = (fx: Fixture) => join(fx.dataDir, "logs", "wizardingcode-mem.log");

describe("with knowledge in the workspace, the shared repository and two projects", () => {
  let template: string;
  let A: number;
  let B: number;
  let fx: Fixture;

  // The workspace: three active sales entries, a draft one, an active finance one. The shared
  // repository: two active marketing entries. Project A, at Knowledge: one sales entry and
  // one code entry. Project B, at Nothing: one sales entry. Allowed: both roots, and the
  // areas workspace:sales and shared:marketing.
  beforeAll(() => {
    template = mkdtempSync(join(tmpdir(), "wizardingcode-mem-sharing-report-template-"));
    const made = openFixture(template);
    const store = openStore({ db: made.db, dataDir: made.dataDir, env: made.env, now: () => NOW });
    const person = personAuthor(store);
    A = addProject(made.db, A_REMOTE);
    B = addProject(made.db, B_REMOTE);
    const write = (ref: ScopeRef, title: string, area: string, status = "active") =>
      writeEntry(
        store,
        ref,
        {
          title,
          kind: "knowledge",
          area,
          context: "agency clients",
          subject: "discovery call",
          status,
          body: `${title}, in full.`,
        },
        person,
      );
    for (const title of ["Sales one", "Sales two", "Sales three"]) write(WORKSPACE, title, "sales");
    write(WORKSPACE, "Sales draft", "sales", "draft");
    write(WORKSPACE, "Finance one", "finance");
    write(SHARED, "Marketing one", "marketing");
    write(SHARED, "Marketing two", "marketing");
    write({ scope: "project", projectId: A }, "Widgets sales", "sales");
    write({ scope: "project", projectId: A }, "Widgets code", "code");
    write({ scope: "project", projectId: B }, "Gears sales", "sales");
    share(made.db, A, "knowledge");
    applySettingsPatch(
      made.db,
      made.dataDir,
      { [ROOTS_KEY]: "shared,workspace", [AREAS_KEY]: "shared:marketing,workspace:sales" },
      "cli",
      NOW,
      true,
    );
    made.db.close();
  }, 60_000);
  afterAll(() => {
    rmSync(template, { recursive: true, force: true });
  });

  beforeEach(() => {
    const dir = newDir();
    cpSync(template, dir, { recursive: true, preserveTimestamps: true });
    fx = openFixture(dir);
  });
  afterEach(() => {
    closeFixture(fx);
  });

  const policy = () => loadPolicy(fx.db, fx.dataDir, fx.env);
  const leaves = (
    options: Partial<Parameters<typeof wouldLeave>[4]> = {},
    under: SharingPolicy = policy(),
  ) => wouldLeave(fx.db, fx.dataDir, fx.env, under, { now: NOW, ...options });
  const of = (report: Report, projectId: number) =>
    report.perProject.find((project) => project.id === projectId);
  const repoOf = (projectId: number) =>
    fx.db
      .query<{ path: string }, [number]>(
        "SELECT path FROM knowledge_repos WHERE scope = 'project' AND project_id = ?",
      )
      .get(projectId)?.path as string;
  const generation = () => generationOf(fx.db) as string;
  const entry = (slug: string) => {
    const found = entryItems(fx.db).find((item) => item.slug === slug);
    if (found === undefined) throw new Error(`no entry ${slug}`);
    return found;
  };

  test("with the knowledge module behind or ahead, no entry is read and nothing throws", () => {
    expect(leaves().counts.entries).toBeGreaterThan(0);
    for (const version of [5, 99]) {
      fx.db.run(
        `UPDATE module_migrations SET version = ? WHERE module = ?
            AND version = (SELECT max(version) FROM module_migrations WHERE module = ?)`,
        [version, KNOWLEDGE_MODULE, KNOWLEDGE_MODULE],
      );
      const report = leaves();
      expect(report.counts.entries).toBe(0);
      expect(report.perRoot.workspace).toEqual({ entries: 0, areaTotals: {} });
      expect(report.perRoot.shared).toEqual({ entries: 0, areaTotals: {} });
      expect(areaTotals(fx.db)).toEqual({ workspace: {}, shared: {} });
      expect(entryItems(fx.db)).toEqual([]);
      expect(findEntry(fx.db, "workspace/sales-one", null)).toBeNull();
    }
  });

  /** One memory `all` sends, and one of each kind it leaves behind. */
  function sixMemories(projectId: number): { sent: number; all: number[] } {
    const active = memory(fx.db, projectId, "Deploys need the staging flag");
    const stale = memory(fx.db, projectId, "The old deploy script");
    fx.db.run("UPDATE memories SET stale = 1 WHERE id = ?", [stale]);
    const branch = memory(fx.db, projectId, "This branch renames the flag");
    fx.db.run("UPDATE memories SET scope = 'branch' WHERE id = ?", [branch]);
    const archived = memory(fx.db, projectId, "The flag before last");
    fx.db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [archived]);
    const imported = memory(fx.db, projectId, "Brought from another tool", "imported");
    const rule = memory(fx.db, projectId, "Always run the linter");
    fx.db.run("INSERT INTO user_memories (memory_id, created_at) VALUES (?, ?)", [rule, NOW]);
    return { sent: active, all: [active, stale, branch, archived, imported, rule] };
  }

  describe("the counts", () => {
    test("count the entries decide sends: allowed areas, in an allowed root or a project above Nothing", () => {
      const report = leaves();
      expect(report.counts).toEqual({ entries: 6, memories: 0 });
      // The workspace's areas govern every project: A's sales entry is counted under it.
      // The totals are every active entry of an area, B's included, whatever the policy.
      expect(report.perRoot.workspace).toEqual({
        entries: 4,
        areaTotals: { sales: 5, finance: 1, code: 1 },
      });
      expect(report.perRoot.shared).toEqual({ entries: 2, areaTotals: { marketing: 2 } });
      expect(report.perProject).toEqual([
        { id: A, level: "knowledge", entries: 1, memories: 0, imported: 0 },
        { id: B, level: "local", entries: 0, memories: 0, imported: 0 },
      ]);
      expect(report.items).toBeUndefined();
      expect(areaTotals(fx.db)).toEqual({
        workspace: { sales: 5, finance: 1, code: 1 },
        shared: { marketing: 2 },
      });
    });

    test("a project's entries are known by the remote alias its level is bound to", () => {
      const items = entryItems(fx.db, A);
      expect(items.map((item) => item.slug)).toEqual(["widgets-code", "widgets-sales"]);
      for (const item of items) {
        expect(item.uid.startsWith("project:remote:")).toBe(true);
        expect(item.uid.startsWith(`project:${A_REMOTE}:`)).toBe(true);
        expect(item).toMatchObject({ kind: "entry", scope: "project", projectId: A });
      }
      const all = entryItems(fx.db);
      expect(all).toHaveLength(10);
      expect(all.filter((item) => item.scope === "workspace")).toHaveLength(5);
      for (const item of all.filter((item) => item.scope !== "project")) {
        expect(item.uid.startsWith(`${item.scope}:`)).toBe(true);
        expect(item.projectId).toBe(0);
      }
    });

    test("a project with no level is known by the alias a level would be bound to; one with no remote by none", () => {
      const [gears] = entryItems(fx.db, B);
      expect(gears?.uid.startsWith(`project:${B_REMOTE}:`)).toBe(true);
      // The alias gone, the entry has no name a team could know it by, and still an uid.
      fx.db.run("DELETE FROM project_aliases WHERE project_id = ?", [B]);
      const [nameless] = entryItems(fx.db, B);
      expect(nameless?.uid.startsWith("project::")).toBe(true);
      expect(leaves().counts.entries).toBe(6);
    });

    test("a path alias never names a project's entries, bound or first by name", () => {
      // The path sorts before any host, so the first alias by name would be it.
      fx.db.run("INSERT OR IGNORE INTO project_aliases (alias, project_id) VALUES (?, ?)", [
        B_REMOTE,
        B,
      ]);
      fx.db.run("INSERT OR IGNORE INTO project_aliases (alias, project_id) VALUES (?, ?)", [
        "remote:/Users/x/gears",
        B,
      ]);
      const [gears] = entryItems(fx.db, B);
      expect(gears?.uid.startsWith(`project:${B_REMOTE}:`)).toBe(true);
      // A row bound to a path alias, written before the host-led rule, names nothing either.
      fx.db.run(
        `INSERT INTO sharing_levels (project_id, destination, level, bound_alias, set_at, source)
          VALUES (?, 'team', 'knowledge', 'remote:/Users/x/gears', 1, 'cli')`,
        [B],
      );
      const [bound] = entryItems(fx.db, B);
      expect(bound?.uid.startsWith(`project:${B_REMOTE}:`)).toBe(true);
      fx.db.run("DELETE FROM sharing_levels WHERE project_id = ?", [B]);
      fx.db.run("DELETE FROM project_aliases WHERE alias = ?", ["remote:/Users/x/gears"]);
    });

    test("a project bound to a shared name is known by it: the uid names the name, the memories count (ADR 0028)", () => {
      fx.db.run("DELETE FROM project_aliases WHERE project_id = ?", [B]);
      const named = setLevel(fx.db, {
        projectId: B,
        destination: "team",
        level: "all",
        source: "cli",
        now: NOW,
        confirm: true,
        as: "name:gears",
        nameId: "0123456789abcdef",
      });
      expect(named).toMatchObject({ ok: true, boundAlias: "name:gears", named: true });
      const [gears] = entryItems(fx.db, B);
      expect(gears?.uid.startsWith("project:name:gears:")).toBe(true);
      expect(gears).toMatchObject({ kind: "entry", scope: "project", projectId: B });
      const sentId = memory(fx.db, B, "Gears deploy note");
      const report = leaves({ list: true });
      expect(of(report, B)).toEqual({ id: B, level: "all", entries: 1, memories: 1, imported: 0 });
      expect(report.counts.entries).toBe(7);
      expect(report.items?.memories.map((item) => item.id)).toContain(sentId);
      expect(report.items?.entries.find((item) => item.projectId === B)?.slug).toBe("gears-sales");

      // With no level, the name the project carries is the alias a level would be bound to;
      // beside a remote the name still comes first.
      share(fx.db, B, "local");
      expect(entryItems(fx.db, B)[0]?.uid.startsWith("project:name:gears:")).toBe(true);
      fx.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [B_REMOTE, B]);
      expect(entryItems(fx.db, B)[0]?.uid.startsWith("project:name:gears:")).toBe(true);
    });

    test("perProject counts the imported memories that stay: active, imported, not received", () => {
      share(fx.db, A, "all");
      memory(fx.db, A, "Brought one", "imported");
      memory(fx.db, A, "Brought two", "imported");
      const received = memory(fx.db, A, "Brought by a teammate", "imported");
      fx.db.run(
        `INSERT INTO sharing_received_memories (memory_id, server_id, remote_uid, member_id,
           member_name, revision, hash, remote_kind, remote_importance, remote_status)
         VALUES (?, 's1', 'u1', 'm1', 'Ana', 1, 'h', 'decision', 3, 'active')`,
        [received],
      );
      const archived = memory(fx.db, A, "Brought and archived", "imported");
      fx.db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [archived]);
      memory(fx.db, B, "B brought", "imported");
      const report = leaves();
      expect(of(report, A)).toEqual({ id: A, level: "all", entries: 1, memories: 0, imported: 2 });
      expect(of(report, B)).toEqual({
        id: B,
        level: "local",
        entries: 0,
        memories: 0,
        imported: 1,
      });
      expect(importedStayCounts(fx.db)).toEqual(
        new Map([
          [A, 2],
          [B, 1],
        ]),
      );
      // For one project, that project's count alone.
      expect(leaves({ projectId: A }).perProject).toEqual([
        { id: A, level: "all", entries: 1, memories: 0, imported: 2 },
      ]);
    });

    test("a project at all sends the memories decide sends, and no other", () => {
      share(fx.db, A, "all");
      const { sent: sentId, all } = sixMemories(A);
      memory(fx.db, B, "B keeps its memories");
      const under = policy();
      const report = leaves({}, under);
      expect(report.counts).toEqual({ entries: 6, memories: 1 });
      expect(of(report, A)).toEqual({
        id: A,
        level: "all",
        entries: 1,
        memories: 1,
        imported: 1,
      });
      expect(of(report, B)?.memories).toBe(0);

      // Every memory of A, read by hand and passed to decide: the count restates no rule.
      interface Row {
        id: number;
        status: string;
        stale: number;
        scope: "project" | "branch";
        origin: string;
        updatedAt: number;
        isUserRule: number;
      }
      const rulings = fx.db
        .query<Row, [number]>(
          `SELECT m.id, m.status, m.stale, m.scope, m.origin, m.updated_at AS updatedAt,
                  u.memory_id IS NOT NULL AS isUserRule
             FROM memories m LEFT JOIN user_memories u ON u.memory_id = m.id
            WHERE m.project_id = ? ORDER BY m.id`,
        )
        .all(A)
        .map((row) => ({
          id: row.id,
          ...decide(
            under,
            "team",
            {
              kind: "memory",
              uid: `${generation()}:${row.id}`,
              projectId: A,
              status: row.status,
              stale: row.stale === 1,
              scope: row.scope,
              origin: row.origin,
              isUserRule: row.isUserRule === 1,
              version: row.updatedAt,
              hash: null,
            },
            [],
          ),
        }));
      expect(rulings.map((ruling) => ruling.reason)).toEqual([
        "allowed",
        "stale",
        "branch-scope",
        "status",
        "imported",
        "user-rule",
      ]);
      const sending = rulings.filter((ruling) => ruling.answer === "send");
      expect(sending.map((ruling) => ruling.id)).toEqual([sentId]);
      expect(report.counts.memories).toBe(sending.length);
      // The candidates are every memory of the projects at all, whatever its state.
      expect(memoryItems(fx.db, under, generation()).map((item) => item.id)).toEqual(all);
    });

    test("for one project, the counts are that project's only", () => {
      share(fx.db, A, "all");
      sixMemories(A);
      const report = leaves({ projectId: A });
      expect(report.counts).toEqual({ entries: 1, memories: 1 });
      expect(report.perProject).toEqual([
        { id: A, level: "all", entries: 1, memories: 1, imported: 1 },
      ]);
      expect(report.perRoot.workspace.entries).toBe(1);
      expect(report.perRoot.shared.entries).toBe(0);
      expect(leaves({ projectId: B }).counts).toEqual({ entries: 0, memories: 0 });
    });

    test("what the server already has is not counted; what changed since is", () => {
      sent(fx.db, "entry", entry("sales-one").uid, entry("sales-one").hash);
      sent(fx.db, "entry", entry("sales-two").uid, "another-hash");
      // A draft the server has is to be withdrawn, which is not leaving.
      sent(fx.db, "entry", entry("sales-draft").uid, entry("sales-draft").hash);
      expect(leaves().counts.entries).toBe(5);
    });

    test("what came from another destination is read with the ledger, and never travels on", () => {
      const record = (slug: string, direction: "sent" | "received") =>
        fx.db.run(
          `INSERT INTO sharing_ledger (destination, item_kind, item_uid, direction, version, hash,
                                       policy_epoch, at)
           VALUES ('elsewhere', 'entry', ?, ?, 1, ?, 0, ?)`,
          [entry(slug).uid, direction, entry(slug).hash, NOW],
        );
      record("sales-one", "received");
      // What was sent elsewhere says nothing of what the team's server has.
      record("sales-two", "sent");
      const ledger = ledgerRecords(fx.db, "team", "entry");
      expect([...ledger.keys()]).toEqual([entry("sales-one").uid]);
      expect(ledger.get(entry("sales-one").uid)).toEqual([
        {
          destination: "elsewhere",
          direction: "received",
          version: 1,
          hash: entry("sales-one").hash,
          withdrawnAt: null,
        },
      ]);
      expect(leaves().counts.entries).toBe(5);
      expect(leaves({ list: true }).items?.entries.map((item) => item.slug)).not.toContain(
        "sales-one",
      );
    });
  });

  describe("a preview", () => {
    test("of a project's level counts under it, and writes nothing", () => {
      const stored = policy();
      const preview = withChange(
        stored,
        { level: { projectId: B, level: "knowledge" } },
        fx.dataDir,
      );
      const report = leaves({}, preview);
      expect(of(report, B)).toEqual({
        id: B,
        level: "knowledge",
        entries: 1,
        memories: 0,
        imported: 0,
      });
      expect(report.counts.entries).toBe(7);
      expect(preview.epoch).not.toBe(stored.epoch);

      // The policy it was built from, and the one in the store, still count none of B's.
      expect(levelOf(stored, B, "team").level).toBe("local");
      expect(of(leaves({}, stored), B)?.entries).toBe(0);
      expect(of(leaves(), B)?.entries).toBe(0);
      expect(policy().epoch).toBe(stored.epoch);
    });

    test("of a level on a project with no row and a carried name counts it under the name", () => {
      fx.db.run("DELETE FROM project_aliases WHERE project_id = ?", [B]);
      fx.db.run("INSERT INTO project_aliases (alias, project_id) VALUES ('name:gears', ?)", [B]);
      const preview = withChange(
        policy(),
        { level: { projectId: B, level: "knowledge" } },
        fx.dataDir,
      );
      const report = leaves({}, preview);
      expect(of(report, B)).toEqual({
        id: B,
        level: "knowledge",
        entries: 1,
        memories: 0,
        imported: 0,
      });
      expect(entryItems(fx.db, B)[0]?.uid.startsWith("project:name:gears:")).toBe(true);
    });

    test("of a lower level counts less", () => {
      const preview = withChange(policy(), { level: { projectId: A, level: "local" } }, fx.dataDir);
      const report = leaves({}, preview);
      expect(of(report, A)).toEqual({
        id: A,
        level: "local",
        entries: 0,
        memories: 0,
        imported: 0,
      });
      expect(report.counts.entries).toBe(5);
    });

    test("of the areas counts the entries of an area added", () => {
      const stored = policy();
      const preview = withChange(
        stored,
        { areas: ["workspace:sales", "workspace:finance", "shared:marketing"] },
        fx.dataDir,
      );
      const report = leaves({}, preview);
      expect(report.counts.entries).toBe(7);
      expect(report.perRoot.workspace.entries).toBe(5);
      expect([...stored.areas].sort()).toEqual(["shared:marketing", "workspace:sales"]);
      expect(leaves().counts.entries).toBe(6);
    });

    test("filters the areas by the taxonomies as the loader does, and takes its epoch from the lists in force", () => {
      const stored = policy();
      const preview = withChange(
        stored,
        { areas: ["workspace:sales", "workspace:no-such-area", "shared:marketing"] },
        fx.dataDir,
      );
      expect([...preview.areas]).toEqual(["shared:marketing", "workspace:sales"]);
      expect(preview.inert).toEqual(["workspace:no-such-area"]);
      expect(preview.settings.areas).toEqual([
        "shared:marketing",
        "workspace:no-such-area",
        "workspace:sales",
      ]);
      expect(leaves({}, preview).counts.entries).toBe(6);
      // One change further than the policy it was built from, over the lists in force.
      const counter = Math.floor(stored.epoch / 2 ** 20);
      expect(preview.epoch).toBe(
        epochOf(counter + 1, {
          roots: ["shared", "workspace"],
          areas: ["shared:marketing", "workspace:sales"],
        }),
      );
    });

    test("of no root counts the projects' entries only", () => {
      const report = leaves({}, withChange(policy(), { roots: [] }, fx.dataDir));
      expect(report.counts.entries).toBe(1);
      expect(report.perRoot.workspace.entries).toBe(1);
      expect(report.perRoot.shared.entries).toBe(0);
      expect(of(report, A)?.entries).toBe(1);
    });

    test("of roots and areas together applies both", () => {
      const preview = withChange(
        policy(),
        { roots: ["workspace"], areas: ["workspace:finance", "shared:marketing"] },
        fx.dataDir,
      );
      expect([...preview.roots]).toEqual(["workspace"]);
      const report = leaves({}, preview);
      // The finance entry alone: the shared root is off, and no sales area is allowed.
      expect(report.counts.entries).toBe(1);
      expect(report.perRoot).toMatchObject({ workspace: { entries: 1 }, shared: { entries: 0 } });
      expect(of(report, A)?.entries).toBe(0);
    });

    test("of every change at once applies the three", () => {
      const preview = withChange(
        policy(),
        {
          level: { projectId: B, level: "all" },
          roots: ["shared"],
          areas: ["workspace:sales", "shared:marketing"],
        },
        fx.dataDir,
      );
      memory(fx.db, B, "B would send this one");
      const report = leaves({}, preview);
      expect(report.counts).toEqual({ entries: 4, memories: 1 });
      expect(of(report, B)).toEqual({ id: B, level: "all", entries: 1, memories: 1, imported: 0 });
    });

    test("of a policy that failed to load stays closed", () => {
      const preview = withChange(closedPolicy("broken"), { roots: ["workspace"] }, fx.dataDir);
      expect(preview.closed).toBe(true);
      expect(leaves({}, preview).counts).toEqual({ entries: 0, memories: 0 });
    });
  });

  describe("a list", () => {
    test("names the entries and the memories that leave", () => {
      share(fx.db, A, "all");
      const { sent: sentId } = sixMemories(A);
      const report = leaves({ list: true });
      expect(report.items?.entries).toEqual([
        { scope: "workspace", projectId: 0, slug: "sales-one", title: "Sales one", area: "sales" },
        {
          scope: "workspace",
          projectId: 0,
          slug: "sales-three",
          title: "Sales three",
          area: "sales",
        },
        { scope: "workspace", projectId: 0, slug: "sales-two", title: "Sales two", area: "sales" },
        {
          scope: "shared",
          projectId: 0,
          slug: "marketing-one",
          title: "Marketing one",
          area: "marketing",
        },
        {
          scope: "shared",
          projectId: 0,
          slug: "marketing-two",
          title: "Marketing two",
          area: "marketing",
        },
        {
          scope: "project",
          projectId: A,
          slug: "widgets-sales",
          title: "Widgets sales",
          area: "sales",
        },
      ]);
      expect(report.items?.memories).toEqual([
        { id: sentId, projectId: A, title: "Deploys need the staging flag" },
      ]);
      expect(report.items?.more).toEqual({ entries: 0, memories: 0 });
      expect(report.counts).toEqual({ entries: 6, memories: 1 });
    });
  });

  describe("fresh", () => {
    test("refreshes the workspace, the shared repository and the projects above Nothing, in that order", () => {
      const seen: string[] = [];
      const report = leaves({ fresh: true, refresh: (repo) => void seen.push(repo.relative) });
      expect(seen).toEqual(["knowledge/workspace", "knowledge/shared", repoOf(A)]);
      expect(seen).not.toContain(repoOf(B));
      expect(report.counts.entries).toBe(6);
    });

    test("takes the projects by id", () => {
      share(fx.db, B, "knowledge");
      // By path, B's repository would come first.
      expect(repoOf(B) < repoOf(A)).toBe(true);
      const seen: string[] = [];
      leaves({ fresh: true, refresh: (repo) => void seen.push(repo.relative) });
      expect(seen).toEqual(["knowledge/workspace", "knowledge/shared", repoOf(A), repoOf(B)]);
    });

    test("is not the default: with fresh false or absent nothing is refreshed", () => {
      const seen: string[] = [];
      const refresh = (repo: { relative: string }) => void seen.push(repo.relative);
      leaves({ fresh: false, refresh });
      leaves({ refresh });
      expect(seen).toEqual([]);
    });

    test("a refresh that fails is logged with its repository, and the index answers as it is", () => {
      const report = leaves({
        fresh: true,
        refresh: () => {
          throw new Error("no git");
        },
      });
      expect(report.counts).toEqual({ entries: 6, memories: 0 });
      const lines = readFileSync(logOf(fx), "utf8")
        .split("\n")
        .filter((line) => line.includes("sharing.refresh"));
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain("knowledge/workspace");
      expect(lines[0]).toContain("no git");
      expect(lines[1]).toContain("knowledge/shared");
      expect(lines[2]).toContain(repoOf(A));
    });

    test("brings the index up to date with the files before it counts", () => {
      rmSync(join(fx.dataDir, "knowledge", "workspace", "entries", "sales-one.md"));
      expect(leaves().counts.entries).toBe(6);
      expect(leaves({ fresh: true }).counts.entries).toBe(5);
      expect(leaves().counts.entries).toBe(5);
      expect(existsSync(logOf(fx))).toBe(false);
    });
  });

  describe("one item", () => {
    test("an entry is found by its scope and slug, as the predicate reads it", () => {
      const item = findEntry(fx.db, "workspace/sales-one", null);
      expect(item).toMatchObject({
        kind: "entry",
        scope: "workspace",
        projectId: 0,
        area: "sales",
        status: "active",
        problem: null,
        version: 1,
      });
      expect(item?.uid).toMatch(/^workspace:[0-9a-f-]{36}$/);
      expect(Object.keys(item ?? {}).sort()).toEqual([...ENTRY_ITEM_KEYS]);
      expect(decide(policy(), "team", item as NonNullable<typeof item>, [])).toMatchObject({
        answer: "send",
        reason: "allowed",
      });
      expect(findEntry(fx.db, "workspace/sales-draft", null)?.status).toBe("draft");
      expect(findEntry(fx.db, "shared/marketing-one", null)?.scope).toBe("shared");
    });

    test("a project's entry is found in the project given", () => {
      const item = findEntry(fx.db, "project/widgets-sales", A);
      expect(item).toMatchObject({ scope: "project", projectId: A, area: "sales" });
      expect(item?.uid.startsWith(`project:${A_REMOTE}:`)).toBe(true);
      expect(findEntry(fx.db, "project/widgets-sales", B)).toBeNull();
      expect(findEntry(fx.db, "project/widgets-sales", null)).toBeNull();
    });

    test("an entry that is not there is null", () => {
      expect(findEntry(fx.db, "nope/x", null)).toBeNull();
      expect(findEntry(fx.db, "workspace/nope", null)).toBeNull();
      expect(findEntry(fx.db, "workspace", null)).toBeNull();
      expect(findEntry(fx.db, "workspace/sales-one/more", null)).toBeNull();
    });

    test("a memory is found by its row id, with the hash of what would leave", () => {
      const id = memory(fx.db, A, "Deploys need <private>the key</private> set");
      const rule = memory(fx.db, A, "Always run the linter");
      fx.db.run("INSERT INTO user_memories (memory_id, created_at) VALUES (?, ?)", [rule, NOW]);
      const item = findMemory(fx.db, fx.env, generation(), id);
      expect(item).toEqual({
        kind: "memory",
        uid: `${generation()}:${id}`,
        projectId: A,
        status: "active",
        stale: false,
        scope: "project",
        origin: "distilled",
        isUserRule: false,
        version: NOW,
        hash: memoryHash({
          memoryKind: "decision",
          importance: 3,
          status: "active",
          title: "Deploys need [PRIVATE] set",
          body: "Deploys need [PRIVATE] set, in full.",
        }),
      });
      expect(Object.keys(item ?? {}).sort()).toEqual([...MEMORY_ITEM_KEYS]);
      expect(findMemory(fx.db, fx.env, generation(), rule)?.isUserRule).toBe(true);
      expect(findMemory(fx.db, fx.env, generation(), 999)).toBeNull();
    });
  });
});

describe("with a project that shares its memories", () => {
  let fx: Fixture;
  let A: number;
  beforeEach(() => {
    fx = openFixture(newDir());
    A = addProject(fx.db, A_REMOTE);
    share(fx.db, A, "all");
  });
  afterEach(() => {
    closeFixture(fx);
  });

  const policy = () => loadPolicy(fx.db, fx.dataDir, fx.env);
  const generation = () => generationOf(fx.db) as string;
  const uidOf = (id: number | undefined) => `${generation()}:${id}`;

  test("a list holds the first 500 that leave and counts the rest", () => {
    const ids = manyMemories(fx.db, A, LIST_CAP + 1);
    const report = wouldLeave(fx.db, fx.dataDir, fx.env, policy(), { now: NOW, list: true });
    expect(LIST_CAP).toBe(500);
    expect(report.counts.memories).toBe(501);
    expect(report.items?.memories).toHaveLength(500);
    expect(report.items?.memories[0]).toEqual({
      id: ids[0] as number,
      projectId: A,
      title: "Memory 0",
    });
    expect(report.items?.memories.at(-1)).toEqual({
      id: ids[499] as number,
      projectId: A,
      title: "Memory 499",
    });
    expect(report.items?.more).toEqual({ entries: 0, memories: 1 });
  }, 30_000);

  test("hashes are computed for the uids asked for only, 500 ids to a query", () => {
    manyMemories(fx.db, A, LIST_CAP + 1);
    const items = memoryItems(fx.db, policy(), generation());
    expect(items).toHaveLength(501);
    expect(items.every((item) => item.hash === null)).toBe(true);
    expect(items[0]).toMatchObject({ kind: "memory", projectId: A, version: NOW });

    const listed = new Set(items.slice(0, LIST_CAP).map((item) => item.uid));
    withHashes(fx.db, fx.env, items, listed);
    for (const item of items.slice(0, LIST_CAP)) expect(item.hash).toMatch(HEX16);
    expect(items[0]?.hash).toBe(bulkHash(0, fx.env));
    expect(items[LIST_CAP]?.hash).toBeNull();

    manyMemories(fx.db, A, 1200 - items.length);
    const all = memoryItems(fx.db, policy(), generation());
    expect(all).toHaveLength(1200);
    const counter = counted(fx.db);
    withHashes(counter.db, fx.env, all, new Set(all.map((item) => item.uid)));
    expect(HASH_CHUNK).toBe(500);
    expect(counter.runs()).toBe(3);
    expect(all.every((item) => HEX16.test(item.hash ?? ""))).toBe(true);
  }, 30_000);

  test("the ledger is read once per destination and kind, grouped by item", () => {
    const ids = manyMemories(fx.db, A, LIST_CAP + 1);
    const last = uidOf(ids.at(-1));
    sent(fx.db, "memory", last, "0123456789abcdef");
    const ledger = ledgerRecords(fx.db, "team", "memory");
    expect([...ledger.keys()]).toEqual([last]);
    expect(ledger.get(last)).toEqual([
      {
        destination: "team",
        direction: "sent",
        version: NOW,
        hash: "0123456789abcdef",
        withdrawnAt: null,
      },
    ]);
    expect(ledgerRecords(fx.db, "team", "entry").size).toBe(0);
    expect(ledgerRecords(fx.db, "elsewhere", "memory").size).toBe(0);

    const items = memoryItems(fx.db, policy(), generation());
    withHashes(fx.db, fx.env, items, new Set(ledger.keys()));
    expect(items.at(-1)?.hash).toBe(bulkHash(LIST_CAP, fx.env));
    expect(items.slice(0, LIST_CAP).every((item) => item.hash === null)).toBe(true);

    // The server has another version of it: it leaves again, with the 500 others.
    const report = wouldLeave(fx.db, fx.dataDir, fx.env, policy(), { now: NOW });
    expect(report.counts.memories).toBe(501);
    // A withdrawn record is read as it is.
    fx.db.run("UPDATE sharing_ledger SET withdrawn_at = 7 WHERE item_uid = ?", [last]);
    expect(ledgerRecords(fx.db, "team", "memory").get(last)?.[0]?.withdrawnAt).toBe(7);
  }, 30_000);

  test("90,000 memories are counted in the time a person waits for a page", () => {
    const ids = manyMemories(fx.db, A, 90_000);
    // A hundred of them the server already has, as they are now.
    withWrite(fx.db, () => {
      for (let n = 0; n < 90_000; n += 900) {
        sent(fx.db, "memory", uidOf(ids[n]), bulkHash(n, fx.env));
      }
    });
    const under = policy();
    const started = performance.now();
    const report = wouldLeave(fx.db, fx.dataDir, fx.env, under, { now: NOW, fresh: false });
    const elapsed = performance.now() - started;
    console.log(
      `wouldLeave over 90,000 memories: ${Math.round(elapsed)} ms (target 1,000 ms, bound 5,000 ms)`,
    );
    // 89,900 to send and 100 the server already has: 89,900 leave.
    expect(report.counts).toEqual({ entries: 0, memories: 89_900 });
    expect(report.perProject).toEqual([
      { id: A, level: "all", entries: 0, memories: 89_900, imported: 0 },
    ]);
    expect(elapsed).toBeLessThan(5_000);
  }, 30_000);
});

describe("a store without the tables", () => {
  let dir: string;
  beforeEach(() => {
    dir = newDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const sharingOnly = [{ module: SHARING_MODULE, migrations: SHARING_MIGRATIONS }];
  const knowledgeOnly = [{ module: KNOWLEDGE_MODULE, migrations: KNOWLEDGE_MIGRATIONS }];
  const NOTHING: Report = {
    counts: { entries: 0, memories: 0 },
    perRoot: {
      workspace: { entries: 0, areaTotals: {} },
      shared: { entries: 0, areaTotals: {} },
    },
    perProject: [],
    items: { entries: [], memories: [], more: { entries: 0, memories: 0 } },
  };

  test("with no knowledge tables no entry is counted and nothing throws", () => {
    const db = openDb({ dataDir: dir, busyTimeoutMs: 2000, moduleSchemas: sharingOnly });
    const widgets = addProject(db, A_REMOTE);
    share(db, widgets, "all");
    const id = memory(db, widgets, "Deploys need the staging flag");
    const report = wouldLeave(db, dir, {}, loadPolicy(db, dir, {}), {
      now: NOW,
      fresh: true,
      list: true,
    });
    expect(report).toEqual({
      ...NOTHING,
      counts: { entries: 0, memories: 1 },
      perProject: [{ id: widgets, level: "all", entries: 0, memories: 1, imported: 0 }],
      items: {
        entries: [],
        memories: [{ id, projectId: widgets, title: "Deploys need the staging flag" }],
        more: { entries: 0, memories: 0 },
      },
    });
    expect(entryItems(db)).toEqual([]);
    expect(areaTotals(db)).toEqual({ workspace: {}, shared: {} });
    expect(findEntry(db, "workspace/sales-one", null)).toBeNull();
    // Nothing to refresh is nothing to fail at.
    expect(existsSync(join(dir, "logs", "wizardingcode-mem.log"))).toBe(false);
    db.close();
  });

  test("with no sharing tables there is no ledger, and no level to name a project by", () => {
    const db = openDb({ dataDir: dir, busyTimeoutMs: 2000, moduleSchemas: knowledgeOnly });
    expect(ledgerRecords(db, "team", "memory").size).toBe(0);
    expect(entryItems(db)).toEqual([]);
    const report = wouldLeave(db, dir, {}, loadPolicy(db, dir, {}), { now: NOW, list: true });
    expect(report).toEqual(NOTHING);
    db.close();
  });

  test("with no database nothing leaves", () => {
    const policy = loadPolicy(null, dir, {});
    expect(wouldLeave(null, dir, {}, policy, { now: NOW, fresh: true, list: true })).toEqual(
      NOTHING,
    );
    const { items: _, ...counts } = NOTHING;
    expect(wouldLeave(null, dir, {}, policy, { now: NOW })).toEqual(counts);
  });
});
