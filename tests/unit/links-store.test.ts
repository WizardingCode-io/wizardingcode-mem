import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LATEST_VERSION, MIGRATIONS, openDb } from "../../src/store/db.ts";
import {
  decideLink,
  isUserMemory,
  linkProjects,
  linksOf,
  suggestLink,
  unlinkProjects,
  visibleProjects,
} from "../../src/store/links.ts";

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "links-store-"));
  process.env.WIZARDINGCODE_HOME = dir; // the error log must not reach a real data dir
  db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function project(name: string): number {
  db.run("INSERT INTO projects (key, name, created_at) VALUES (?, ?, 1)", [`path:/${name}`, name]);
  return db.query<{ id: number }, [string]>("SELECT id FROM projects WHERE name = ?").get(name)
    ?.id as number;
}
const names = (id: number) => visibleProjects(db, id).map((v) => v.name);

describe("store/links", () => {
  test("migration 7 on a v6 database keeps memories and vectors", () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), "links-store-"));
    const before = openDb({
      dataDir: dir,
      busyTimeoutMs: 2000,
      migrations: MIGRATIONS.slice(0, 6),
    });
    before.run("INSERT INTO projects (key, name, created_at) VALUES ('path:/p', 'p', 1)");
    before.run(
      `INSERT INTO memories (project_id, kind, title, body, importance, origin, judge, judge_version, created_at, updated_at)
       VALUES (1, 'decision', 't', 'b', 3, 'manual', 'heuristic', '1', 1, 1)`,
    );
    before.run(
      "INSERT INTO memory_vectors (memory_id, model, scale, vec) VALUES (1, 'm@1', 1, x'01')",
    );
    before.close();
    db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
    expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(
      LATEST_VERSION,
    );
    expect(db.query("SELECT count(*) AS n FROM memories").get()).toEqual({ n: 1 });
    expect(db.query("SELECT count(*) AS n FROM memory_vectors").get()).toEqual({ n: 1 });
    expect(db.query("SELECT count(*) AS n FROM project_links").get()).toEqual({ n: 0 });
    expect(isUserMemory(db, 1)).toBe(false);
  });

  test("product is read both ways, whichever order it was linked in", () => {
    const a = project("a");
    const b = project("b");
    const link = linkProjects(db, b, a, "product", 10);
    expect(link.from).toBe(a);
    expect(link.to).toBe(b);
    expect(names(a)).toEqual(["b"]);
    expect(names(b)).toEqual(["a"]);
    expect(visibleProjects(db, a)[0]).toEqual({ id: b, name: "b", relation: "product" });
  });

  test("uses is visible from the consumer only", () => {
    const app = project("app");
    const lib = project("lib");
    linkProjects(db, app, lib, "uses", 10);
    expect(visibleProjects(db, app)).toEqual([{ id: lib, name: "lib", relation: "uses" }]);
    expect(visibleProjects(db, lib)).toEqual([]);
  });

  test("links never chain", () => {
    const a = project("a");
    const b = project("b");
    const c = project("c");
    linkProjects(db, a, b, "product", 1);
    linkProjects(db, b, c, "product", 1);
    expect(names(a)).toEqual(["b"]);
    expect(names(c)).toEqual(["b"]);
  });

  test("suggested and rejected links are not visible", () => {
    const a = project("a");
    const b = project("b");
    const c = project("c");
    suggestLink(db, a, b, "product", ["x"], 1);
    const id = suggestLink(db, a, c, "product", ["x"], 1) as number;
    decideLink(db, id, "rejected", 2);
    expect(visibleProjects(db, a)).toEqual([]);
  });

  test("suggestLink refreshes a suggested pair, skips confirmed and rejected ones", () => {
    const a = project("a");
    const b = project("b");
    const c = project("c");
    const id = suggestLink(db, b, a, "product", ["one"], 1) as number;
    expect(suggestLink(db, a, b, "product", ["two"], 2)).toBe(id);
    expect(linksOf(db, a)[0]?.signals).toEqual(["two"]);
    decideLink(db, id, "confirmed", 3);
    expect(suggestLink(db, a, b, "product", ["three"], 4)).toBeNull();
    expect(linksOf(db, a)[0]?.signals).toEqual(["two"]);

    const rid = suggestLink(db, a, c, "uses", [], 1) as number;
    decideLink(db, rid, "rejected", 2);
    expect(suggestLink(db, a, c, "uses", [], 3)).toBeNull();
    expect(suggestLink(db, a, a, "uses", [], 3)).toBeNull();
  });

  test("linkProjects refuses self-links and unknown ids", () => {
    const a = project("a");
    expect(() => linkProjects(db, a, a, "product", 1)).toThrow();
    expect(() => linkProjects(db, a, 9999, "uses", 1)).toThrow();
  });

  test("linkProjects turns a rejected or suggested pair into confirmed, one row per pair", () => {
    const a = project("a");
    const b = project("b");
    const id = suggestLink(db, a, b, "uses", [], 1) as number;
    decideLink(db, id, "rejected", 2);
    const link = linkProjects(db, a, b, "uses", 3);
    expect(link.id).toBe(id);
    expect(link.status).toBe("confirmed");
    expect(link.decidedAt).toBe(3);
    linkProjects(db, a, b, "uses", 4);
    expect(db.query("SELECT count(*) AS n FROM project_links").get()).toEqual({ n: 1 });
  });

  test("uses in both directions is two rows", () => {
    const a = project("a");
    const b = project("b");
    linkProjects(db, a, b, "uses", 1);
    linkProjects(db, b, a, "uses", 1);
    expect(linksOf(db, a)).toHaveLength(2);
    expect(names(a)).toEqual(["b"]);
    expect(names(b)).toEqual(["a"]);
  });

  test("unlink goes back to rejected, and decideLink/unlink answer null for unknown ids", () => {
    const a = project("a");
    const b = project("b");
    const link = linkProjects(db, a, b, "product", 1);
    expect(unlinkProjects(db, link.id, 5)?.status).toBe("rejected");
    expect(visibleProjects(db, a)).toEqual([]);
    expect(suggestLink(db, a, b, "product", [], 6)).toBeNull();
    expect(unlinkProjects(db, 999, 1)).toBeNull();
    expect(decideLink(db, 999, "confirmed", 1)).toBeNull();
  });

  test("deleting a project removes its links", () => {
    const a = project("a");
    const b = project("b");
    linkProjects(db, a, b, "product", 1);
    db.run("DELETE FROM projects WHERE id = ?", [b]);
    expect(linksOf(db, a)).toEqual([]);
  });

  test("isUserMemory reads the marker", () => {
    const a = project("a");
    db.run(
      `INSERT INTO memories (project_id, kind, title, body, importance, origin, judge, judge_version, created_at, updated_at)
       VALUES (?, 'convention', 't', 'b', 3, 'manual', 'heuristic', '1', 1, 1)`,
      [a],
    );
    const m = db.query<{ id: number }, []>("SELECT id FROM memories").get()?.id as number;
    expect(isUserMemory(db, m)).toBe(false);
    db.run("INSERT INTO user_memories (memory_id, created_at) VALUES (?, 1)", [m]);
    expect(isUserMemory(db, m)).toBe(true);
  });

  test("a project with memory off is never visible, whatever its links", () => {
    const a = project("a");
    const b = project("b");
    const c = project("c");
    linkProjects(db, a, b, "product", 1);
    linkProjects(db, a, c, "uses", 1);
    db.run("UPDATE projects SET disabled = 1 WHERE id IN (?, ?)", [b, c]);
    expect(visibleProjects(db, a)).toEqual([]);
  });

  test("visibleProjects without the table returns []", () => {
    const a = project("a");
    db.run("DROP TABLE project_links");
    expect(visibleProjects(db, a)).toEqual([]);
  });

  test("a pair decided in any kind or direction is never suggested again", () => {
    const a = project("pa");
    const b = project("pb");
    const id = suggestLink(db, a, b, "product", ["x"], 1) as number;
    decideLink(db, id, "rejected", 2);
    expect(suggestLink(db, a, b, "uses", ["y"], 3)).toBeNull();
    expect(suggestLink(db, b, a, "uses", ["y"], 3)).toBeNull();
    const c = project("pc");
    const d = project("pd");
    linkProjects(db, c, d, "uses", 1);
    expect(suggestLink(db, d, c, "uses", ["z"], 3)).toBeNull();
    expect(suggestLink(db, c, d, "product", ["z"], 3)).toBeNull();
  });

  describe("deciding one row decides the pair", () => {
    const status = (id: number) =>
      db
        .query<{ status: string }, [number]>("SELECT status FROM project_links WHERE id = ?")
        .get(id)?.status;
    const pending = (id: number) => linksOf(db, id).filter((l) => l.status === "suggested");
    function pair() {
      const web = project("acme-web");
      const lib = project("acme-shared");
      const product = suggestLink(db, lib, web, "product", ["same owner"], 1) as number;
      const uses = suggestLink(db, web, lib, "uses", ["package.json depends on acme-shared"], 1);
      return { web, lib, product, uses: uses as number };
    }

    test("confirming uses rejects the product sibling: the library still sees nothing", () => {
      const { web, lib, product, uses } = pair();
      decideLink(db, uses, "confirmed", 2);
      expect(status(product)).toBe("rejected");
      expect(pending(web)).toEqual([]);
      expect(visibleProjects(db, lib)).toEqual([]);
      expect(names(web)).toEqual(["acme-shared"]);
    });

    test("rejecting one rejects the other", () => {
      const { web, product, uses } = pair();
      decideLink(db, product, "rejected", 2);
      expect(status(uses)).toBe("rejected");
      expect(pending(web)).toEqual([]);
    });

    test("a link by hand rejects the pair's pending suggestions", () => {
      const { web, lib, product, uses } = pair();
      linkProjects(db, web, lib, "uses", 2);
      expect(status(uses)).toBe("confirmed");
      expect(status(product)).toBe("rejected");
      expect(visibleProjects(db, lib)).toEqual([]);
    });

    test("unlinking rejects a sibling still pending", () => {
      const { web, product, uses } = pair();
      db.run("UPDATE project_links SET status = 'confirmed' WHERE id = ?", [uses]);
      unlinkProjects(db, uses, 3);
      expect(status(uses)).toBe("rejected");
      expect(status(product)).toBe("rejected");
      expect(pending(web)).toEqual([]);
    });

    test("other pairs are untouched", () => {
      const { web, uses } = pair();
      const other = project("other");
      const kept = suggestLink(db, web, other, "uses", ["x"], 1) as number;
      decideLink(db, uses, "confirmed", 2);
      expect(status(kept)).toBe("suggested");
    });

    test("a pair confirmed both ways reads as product, whatever the row order", () => {
      const a = project("a");
      const b = project("b");
      linkProjects(db, a, b, "uses", 1);
      linkProjects(db, a, b, "product", 2);
      expect(visibleProjects(db, a)).toEqual([{ id: b, name: "b", relation: "product" }]);
      const c = project("c");
      const d = project("d");
      linkProjects(db, c, d, "product", 1);
      linkProjects(db, c, d, "uses", 2);
      expect(visibleProjects(db, c)).toEqual([{ id: d, name: "d", relation: "product" }]);
    });
  });
});
