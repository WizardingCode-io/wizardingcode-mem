import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heuristicJudge } from "../../src/judge/heuristic.ts";
import { projectLinksTool } from "../../src/mcp/links-tool.ts";
import type { ToolContext } from "../../src/mcp/tools.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { linkProjects, linksOf, suggestLink, visibleProjects } from "../../src/store/links.ts";

const NOW = Date.UTC(2026, 9, 12, 12);
let dir: string;
let db: Db;
let shop: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "links-tool-"));
  process.env.WIZARDINGCODE_HOME = dir; // the error log must not reach a real data dir
  db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
  shop = project("shop");
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function project(name: string, key = `path:/${name}`): number {
  db.run("INSERT INTO projects (key, name, created_at) VALUES (?, ?, 1)", [key, name]);
  return db.query<{ id: number }, [string]>("SELECT id FROM projects WHERE key = ?").get(key)
    ?.id as number;
}
const context = (projectId: number | null = shop): ToolContext => ({
  db,
  judge: heuristicJudge,
  projectId,
  root: "",
  branch: null,
  now: NOW,
});
const tool = (args: Parameters<typeof projectLinksTool>[1], projectId?: number | null) =>
  projectLinksTool(context(projectId), args);
const seen = (id: number) => visibleProjects(db, id).map((v) => v.name);

describe("project_links", () => {
  test("list says when there is nothing", () => {
    expect(tool({ action: "list" })).toBe("No linked projects and no suggestions for shop.");
  });

  test("list shows confirmed links and pending suggestions with their signals, not rejected ones", () => {
    const web = project("web");
    const lib = project("lib");
    const app = project("app");
    const api = project("api");
    const old = project("old");
    const product = linkProjects(db, web, shop, "product", NOW);
    const uses = linkProjects(db, shop, lib, "uses", NOW);
    const usedBy = linkProjects(db, app, shop, "uses", NOW);
    const suggested = suggestLink(db, shop, api, "product", ["remote owner + “shop”"], NOW);
    const rejected = suggestLink(db, shop, old, "product", [], NOW) as number;
    db.run("UPDATE project_links SET status = 'rejected' WHERE id = ?", [rejected]);
    expect(tool({ action: "list" })).toBe(
      [
        "Linked to shop:",
        `- #${product.id} web · same product`,
        `- #${uses.id} lib · shop uses it`,
        `- #${usedBy.id} app · uses shop (shop does not see app)`,
        "Suggested (confirm or reject by id):",
        `- #${suggested} api · same product? Signals: remote owner + “shop”`,
      ].join("\n"),
    );
  });

  test("links both kinds; uses means this project uses the named one", () => {
    const web = project("web");
    const lib = project("lib");
    expect(tool({ action: "link", project: "web", kind: "product" })).toMatch(
      /^Linked shop and web as one product \(#\d+\)\.$/,
    );
    expect(tool({ action: "link", project: "lib", kind: "uses" })).toMatch(
      /^Linked: shop uses lib \(#\d+\)\. lib does not see shop\.$/,
    );
    expect(seen(shop)).toEqual(["lib", "web"]);
    expect(seen(web)).toEqual(["shop"]);
    expect(seen(lib)).toEqual([]);
  });

  test("names are matched exactly first, then without case; unknown and ambiguous are refused with candidates", () => {
    project("Web");
    project("web", "path:/elsewhere/web");
    project("Docs");
    project("DOCS", "path:/elsewhere/docs");
    expect(tool({ action: "link", project: "Web", kind: "product" })).toStartWith(
      "Linked shop and Web",
    );
    expect(tool({ action: "link", project: "docs", kind: "product" })).toBe(
      "More than one project is called “docs”: Docs (path:/Docs), DOCS (path:/elsewhere/docs). Name it by its key.",
    );
    expect(tool({ action: "link", project: "path:/Docs", kind: "product" })).toStartWith(
      "Linked shop and Docs",
    );
    expect(tool({ action: "link", project: "nope", kind: "uses" })).toBe(
      "No project called “nope”. Projects: Web, web, Docs, DOCS.",
    );
  });

  test("a project cannot be linked to itself", () => {
    expect(tool({ action: "link", project: "shop", kind: "product" })).toBe(
      "A project cannot be linked to itself.",
    );
    expect(linksOf(db, shop)).toEqual([]);
  });

  test("unlink ends every confirmed link with the named project", () => {
    const web = project("web");
    linkProjects(db, shop, web, "product", NOW);
    linkProjects(db, shop, web, "uses", NOW);
    const out = tool({ action: "unlink", project: "web" });
    expect(out).toMatch(/^Unlinked shop and web \(#\d+, #\d+\)\.$/);
    expect(seen(shop)).toEqual([]);
    expect(linksOf(db, shop).map((l) => l.status)).toEqual(["rejected", "rejected"]);
    expect(tool({ action: "unlink", project: "web" })).toBe("shop is not linked to web.");
  });

  test("confirm and reject act on suggestions only", () => {
    const api = project("api");
    const old = project("old");
    const a = suggestLink(db, shop, api, "product", [], NOW) as number;
    const b = suggestLink(db, shop, old, "product", [], NOW) as number;
    expect(tool({ action: "confirm", id: a })).toBe(
      `Confirmed #${a}: shop and api as one product.`,
    );
    expect(seen(shop)).toEqual(["api"]);
    expect(tool({ action: "reject", id: b })).toBe(
      `Rejected #${b}: it will not be suggested again.`,
    );
    expect(tool({ action: "reject", id: a })).toBe(
      `#${a} is confirmed, not a suggestion. To end it, unlink api.`,
    );
    expect(tool({ action: "confirm", id: b })).toBe(
      `#${b} is rejected, not a suggestion. To link them after all, link old.`,
    );
    expect(seen(shop)).toEqual(["api"]);
  });

  test("confirming one kind of a pair rejects its other suggestion", () => {
    const lib = project("lib");
    const uses = suggestLink(db, shop, lib, "uses", ["package.json depends on lib"], NOW) as number;
    const product = suggestLink(db, shop, lib, "product", ["same owner"], NOW) as number;
    tool({ action: "confirm", id: uses });
    expect(linksOf(db, shop).find((l) => l.id === product)?.status).toBe("rejected");
    expect(seen(lib)).toEqual([]);
  });

  test("confirm and reject refuse an unknown id or another project's link", () => {
    const x = project("x");
    const y = project("y");
    const theirs = suggestLink(db, x, y, "product", [], NOW) as number;
    expect(tool({ action: "confirm", id: 999 })).toBe("No link #999 for shop.");
    expect(tool({ action: "reject", id: theirs })).toBe(`No link #${theirs} for shop.`);
  });

  test("needs a project", () => {
    expect(tool({ action: "list" }, null)).toBe(
      "project_links works inside a project: there is none here.",
    );
  });

  test("an action missing its argument is refused", () => {
    expect(tool({ action: "link" } as never)).toBe(
      "link needs project (a name) and kind (product or uses).",
    );
    expect(tool({ action: "unlink" } as never)).toBe("unlink needs project (a name).");
    expect(tool({ action: "confirm" } as never)).toBe("confirm needs id (from list).");
  });
});
