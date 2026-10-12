import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knowledgeDir } from "../../src/modules/knowledge/files.ts";
import {
  essentialEntries,
  refreshIndex,
  searchKnowledge,
} from "../../src/modules/knowledge/index-store.ts";
import { type Db, openDb } from "../../src/store/db.ts";

let base: string;
let dir: string;
let db: Db;
let projectId: number;
let otherId: number;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "wizardingcode-mem-knowledge-index-"));
  db = openDb({ dataDir: join(base, "store"), busyTimeoutMs: 2000 });
  db.run("INSERT INTO projects (key, name, created_at) VALUES ('path:/a', 'a', 1)");
  db.run("INSERT INTO projects (key, name, created_at) VALUES ('path:/b', 'b', 1)");
  projectId = 1;
  otherId = 2;
  dir = knowledgeDir(join(base, "repo"));
  mkdirSync(dir, { recursive: true });
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

function entry(
  slug: string,
  fields: {
    title: string;
    kind?: string;
    essential?: boolean;
    status?: string;
    tags?: string[];
    updated?: string;
  },
  body: string,
): void {
  const lines = [
    "---",
    `title: ${fields.title}`,
    `kind: ${fields.kind ?? "rule"}`,
    ...(fields.essential === undefined ? [] : [`essential: ${fields.essential}`]),
    ...(fields.status === undefined ? [] : [`status: ${fields.status}`]),
    ...(fields.tags === undefined ? [] : [`tags: [${fields.tags.join(", ")}]`]),
    ...(fields.updated === undefined ? [] : [`updated: ${fields.updated}`]),
    "---",
    body,
  ];
  writeFileSync(join(dir, `${slug}.md`), `${lines.join("\n")}\n`);
}

const slugs = (entries: { slug: string }[]) => entries.map((found) => found.slug);
const rows = () =>
  db
    .query<{ n: number }, [number]>(
      "SELECT count(*) AS n FROM knowledge_entries WHERE project_id = ?",
    )
    .get(projectId)?.n;

describe("knowledge/index-store", () => {
  test("rebuilt from the files, searchable by title, tags and body", () => {
    entry(
      "orders",
      { title: "Orders are never deleted", tags: ["billing"] },
      "Cancel them instead.",
    );
    entry("cache", { title: "Cache keys", kind: "howto" }, "Prefix every key with the tenant.");
    const result = refreshIndex(db, projectId, dir);
    expect(result).toEqual({ indexed: 2, skipped: false });

    expect(slugs(searchKnowledge(db, projectId, "deleted orders", 5))).toEqual(["orders"]);
    expect(slugs(searchKnowledge(db, projectId, "billing", 5))).toEqual(["orders"]);
    expect(slugs(searchKnowledge(db, projectId, "tenant prefix", 5))).toEqual(["cache"]);
    const [found] = searchKnowledge(db, projectId, "cancel orders", 5);
    expect(found).toMatchObject({
      slug: "orders",
      title: "Orders are never deleted",
      kind: "rule",
      tags: ["billing"],
      body: "Cancel them instead.",
      problem: null,
      path: join(dir, "orders.md"),
    });
    expect(found?.score).toBeGreaterThan(0);
  });

  test("search is confined to the project and honours the limit", () => {
    entry("one", { title: "Alpha retry policy" }, "Retry three times.");
    entry("two", { title: "Beta retry policy" }, "Retry once.");
    refreshIndex(db, projectId, dir);
    expect(searchKnowledge(db, otherId, "retry policy", 5)).toEqual([]);
    expect(searchKnowledge(db, projectId, "retry policy", 1)).toHaveLength(1);
    expect(searchKnowledge(db, projectId, "", 5)).toEqual([]);
    expect(searchKnowledge(db, projectId, '"unbalanced (quote AND OR', 5)).toEqual([]);
  });

  test("fingerprint unchanged: no work; force re-reads", () => {
    entry("orders", { title: "Orders" }, "Body.");
    expect(refreshIndex(db, projectId, dir)).toEqual({ indexed: 1, skipped: false });
    expect(refreshIndex(db, projectId, dir)).toEqual({ indexed: 0, skipped: true });
    // A forced refresh reads the files again, but writes only what changed.
    expect(refreshIndex(db, projectId, dir, { force: true })).toEqual({
      indexed: 0,
      skipped: false,
    });
    const state = db
      .query<{ fingerprint: string | null }, [number]>(
        "SELECT fingerprint FROM knowledge_state WHERE project_id = ?",
      )
      .get(projectId);
    expect(state?.fingerprint).not.toBeNull();
  });

  test("an edited file is re-indexed; a deleted file disappears from the index", () => {
    entry("orders", { title: "Orders" }, "Previously about receipts.");
    entry("cache", { title: "Cache" }, "Keys.");
    refreshIndex(db, projectId, dir);
    entry("orders", { title: "Orders" }, "New wording entirely, about invoices.");
    rmSync(join(dir, "cache.md"));
    expect(refreshIndex(db, projectId, dir)).toEqual({ indexed: 1, skipped: false });
    expect(rows()).toBe(1);
    expect(searchKnowledge(db, projectId, "cache keys", 5)).toEqual([]);
    expect(slugs(searchKnowledge(db, projectId, "invoices", 5))).toEqual(["orders"]);
    expect(searchKnowledge(db, projectId, "receipts", 5)).toEqual([]);
  });

  test("the folder removed: the project's index empties; no folder at all writes nothing", () => {
    expect(refreshIndex(db, projectId, join(base, "nowhere"))).toEqual({
      indexed: 0,
      skipped: true,
    });
    expect(db.query("SELECT count(*) AS n FROM knowledge_state").get()).toEqual({ n: 0 });
    entry("orders", { title: "Orders" }, "Body.");
    refreshIndex(db, projectId, dir);
    rmSync(dir, { recursive: true });
    expect(refreshIndex(db, projectId, dir)).toEqual({ indexed: 0, skipped: false });
    expect(rows()).toBe(0);
    expect(searchKnowledge(db, projectId, "orders body", 5)).toEqual([]);
  });

  test("projects keep their own indexes", () => {
    entry("orders", { title: "Orders" }, "Body.");
    refreshIndex(db, projectId, dir);
    const other = knowledgeDir(join(base, "other"));
    mkdirSync(other, { recursive: true });
    writeFileSync(
      join(other, "orders.md"),
      "---\ntitle: Other orders\nkind: rule\n---\nElsewhere.\n",
    );
    refreshIndex(db, otherId, other);
    expect(searchKnowledge(db, projectId, "orders", 5).map((found) => found.title)).toEqual([
      "Orders",
    ]);
    expect(searchKnowledge(db, otherId, "orders", 5).map((found) => found.title)).toEqual([
      "Other orders",
    ]);
    rmSync(join(other, "orders.md"));
    refreshIndex(db, otherId, other);
    expect(rows()).toBe(1);
  });

  test("essential entries: active only, most recently updated first", () => {
    entry("old", { title: "Old", essential: true, updated: "2026-01-01" }, "B");
    entry("new", { title: "New", essential: true, updated: "2026-10-01" }, "B");
    entry("undated", { title: "Undated", essential: true }, "B");
    entry("draft", { title: "Draft", essential: true, status: "draft" }, "B");
    entry("gone", { title: "Gone", essential: true, status: "superseded" }, "B");
    entry("plain", { title: "Plain" }, "B");
    refreshIndex(db, projectId, dir);
    expect(slugs(essentialEntries(db, projectId))).toEqual(["new", "old", "undated"]);
    expect(essentialEntries(db, otherId)).toEqual([]);
  });

  test("drafts and superseded entries stay searchable, with their status", () => {
    entry("draft", { title: "Draft rollout plan", status: "draft" }, "Rollout.");
    refreshIndex(db, projectId, dir);
    expect(searchKnowledge(db, projectId, "rollout plan", 5)[0]?.status).toBe("draft");
  });

  test("a deleted index is rebuilt from the files", () => {
    entry("orders", { title: "Orders" }, "Body.");
    refreshIndex(db, projectId, dir);
    db.run("DELETE FROM knowledge_entries");
    db.run("DELETE FROM knowledge_state");
    expect(refreshIndex(db, projectId, dir)).toEqual({ indexed: 1, skipped: false });
    expect(slugs(searchKnowledge(db, projectId, "orders body", 5))).toEqual(["orders"]);
  });
});
