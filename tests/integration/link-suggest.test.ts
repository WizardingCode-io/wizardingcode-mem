import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { suggestLinks } from "../../src/links/suggest.ts";
import { openDb } from "../../src/store/db.ts";
import { decideLink, linksOf } from "../../src/store/links.ts";
import { runCliWith } from "../helpers/cli.ts";

let dir: string;
let db: Database;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "link-suggest-")));
  process.env.WIZARDINGCODE_HOME = dir;
  db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Opts {
  remote?: string;
  manifest?: unknown;
  disabled?: boolean;
  noRoot?: boolean;
}
function project(rel: string, opts: Opts = {}): number {
  const root = join(dir, "code", rel);
  if (!opts.noRoot) {
    mkdirSync(root, { recursive: true });
    if (opts.manifest !== undefined)
      writeFileSync(join(root, "package.json"), JSON.stringify(opts.manifest));
  }
  const name = rel.split("/").pop() as string;
  db.run("INSERT INTO projects (key, name, disabled, created_at) VALUES (?, ?, ?, 1)", [
    `path:${root}`,
    name,
    opts.disabled ? 1 : 0,
  ]);
  const id = db.query<{ id: number }, [string]>("SELECT id FROM projects WHERE name = ?").get(name)
    ?.id as number;
  db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [`path:${root}`, id]);
  if (opts.remote) {
    db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [
      `remote:${opts.remote}`,
      id,
    ]);
  }
  return id;
}
const run = () => suggestLinks(db, { now: 10, home: join(dir, "home") });
const all = () =>
  db.query("SELECT from_project, to_project, kind, status, signals FROM project_links").all();

describe("suggestLinks", () => {
  test("same owner and a shared stem: product", () => {
    const a = project("shop-api", { remote: "github.com/acme/shop-api" });
    const b = project("shop-web", { remote: "github.com/acme/shop-web" });
    expect(run().suggested).toBe(1);
    const links = linksOf(db, a);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      from: Math.min(a, b),
      to: Math.max(a, b),
      kind: "product",
      status: "suggested",
    });
    expect(links[0]?.signals).toEqual(["same owner github.com/acme", "shared name shop"]);
  });
  test("an SSH host alias with no dot is a host: same owner and stem give product", () => {
    project("shop-api", { remote: "gh-work/acme/shop-api" });
    project("shop-web", { remote: "gh-work/acme/shop-web" });
    expect(run().suggested).toBe(1);
    expect(all()).toEqual([expect.objectContaining({ kind: "product", status: "suggested" })]);
  });
  test("GitLab subgroups: the group path is the owner", () => {
    project("shop-api", { remote: "gitlab.com/group/sub/shop-api" });
    project("shop-web", { remote: "gitlab.com/group/sub/shop-web" });
    project("shop-cli", { remote: "gitlab.com/group/other/shop-cli" });
    expect(run().suggested).toBe(1);
    expect(all()).toEqual([
      expect.objectContaining({
        kind: "product",
        signals: JSON.stringify(["same owner gitlab.com/group/sub", "shared name shop"]),
      }),
    ]);
  });
  test("the owner's own name alone, or an unrelated pair, suggests nothing", () => {
    project("acme-shop", { remote: "github.com/acme/acme-shop" });
    project("acme-bank", { remote: "github.com/acme/acme-bank" });
    project("alpha", { remote: "github.com/acme/alpha" });
    project("zulu", { remote: "github.com/acme/zulu" });
    expect(run().suggested).toBe(0);
    expect(all()).toEqual([]);
  });
  test("a manifest depending on another known project: uses, one way", () => {
    const app = project("app1", { manifest: { name: "app1", dependencies: { "@acme/lib": "1" } } });
    const lib = project("lib1", { manifest: { name: "@acme/lib" } });
    run();
    expect(all()).toEqual([
      {
        from_project: app,
        to_project: lib,
        kind: "uses",
        status: "suggested",
        signals: JSON.stringify(["package.json depends on @acme/lib"]),
      },
    ]);
  });
  test("file:../lib resolves to the project's root", () => {
    const app = project("app2", { manifest: { dependencies: { l: "file:../lib2" } } });
    const lib = project("lib2");
    run();
    expect(linksOf(db, app).map((l) => [l.from, l.to, l.kind])).toEqual([[app, lib, "uses"]]);
  });
  test("a git url that is another project's remote: uses", () => {
    const app = project("app3", {
      manifest: { dependencies: { l: "git+ssh://git@github.com/zed/lib3.git" } },
    });
    const lib = project("lib3", { remote: "github.com/zed/lib3" });
    run();
    expect(linksOf(db, app).map((l) => [l.from, l.to, l.kind])).toEqual([[app, lib, "uses"]]);
  });
  test("a pnpm workspace with two packages: product", () => {
    const root = join(dir, "code", "mono");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'pkgs/*'\n");
    const a = project("mono/pkgs/one");
    const b = project("mono/pkgs/two");
    project("mono/other/three");
    run();
    const links = linksOf(db, a);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ from: a, to: b, kind: "product" });
    expect(links[0]?.signals).toEqual([`one workspace ${root}`]);
  });
  test("a stray '**' or negated workspace pattern links nothing", () => {
    for (const [file, text] of [
      ["pnpm-workspace.yaml", "packages:\n  - '!**/test/**'\n  - '**'\n"],
      ["package.json", JSON.stringify({ workspaces: ["**", "!x"] })],
    ] as const) {
      mkdirSync(join(dir, "code"), { recursive: true });
      writeFileSync(join(dir, "code", file), text);
      project("clienta/api");
      project("clientb/web");
      expect(run().suggested).toBe(0);
      rmSync(join(dir, "code", file));
      db.run("DELETE FROM projects");
    }
  });
  test("a workspace file in the home directory is never read", () => {
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "package.json"), JSON.stringify({ workspaces: ["code/*"] }));
    mkdirSync(join(home, "code"), { recursive: true });
    const a = join(home, "code", "one");
    const b = join(home, "code", "two");
    for (const [n, root] of [
      ["one", a],
      ["two", b],
    ] as const) {
      mkdirSync(root, { recursive: true });
      db.run("INSERT INTO projects (key, name, created_at) VALUES (?, ?, 1)", [`path:${root}`, n]);
      const id = db.query<{ id: number }, [string]>("SELECT id FROM projects WHERE name = ?").get(n)
        ?.id as number;
      db.run("INSERT INTO project_aliases VALUES (?, ?)", [`path:${root}`, id]);
    }
    expect(run().suggested).toBe(0);
  });
  test("a workspace root that covers fewer than two known projects is ignored", () => {
    const root = join(dir, "code", "mono2");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["pkgs/*"] }));
    project("mono2/pkgs/only");
    expect(run().suggested).toBe(0);
  });
  test("same-named admin repos of one owner, unrelated otherwise: nothing; owner-named shop pair: product", () => {
    project("acme-admin", { remote: "github.com/acme/acme-admin" });
    project("beta-admin", { remote: "github.com/acme/beta-admin" });
    expect(run().suggested).toBe(0);
    const a = project("acme-shop-api", { remote: "github.com/acme/acme-shop-api" });
    project("acme-shop-web", { remote: "github.com/acme/acme-shop-web" });
    expect(run().suggested).toBe(1);
    expect(linksOf(db, a)[0]?.signals).toEqual(["same owner github.com/acme", "shared name shop"]);
  });
  test("a confirmed or rejected pair is not touched", () => {
    const a = project("shop-api", { remote: "github.com/acme/shop-api" });
    project("shop-web", { remote: "github.com/acme/shop-web" });
    run();
    const id = (linksOf(db, a)[0] as { id: number }).id;
    decideLink(db, id, "rejected", 5);
    expect(run().suggested).toBe(0);
    expect(linksOf(db, a)[0]?.status).toBe("rejected");
  });
  test("disabled projects, missing roots, no remote and bad manifests do not crash", () => {
    project("shop-api", { remote: "github.com/acme/shop-api", disabled: true });
    project("shop-web", { remote: "github.com/acme/shop-web" });
    project("shop-gone", { remote: "github.com/acme/shop-gone", noRoot: true });
    project("noremote");
    const bad = project("badmf");
    writeFileSync(join(dir, "code", "badmf", "package.json"), "{ nope");
    expect(bad).toBeGreaterThan(0);
    expect(() => run()).not.toThrow();
    expect(all()).toEqual([]);
  });
  test("maxProjects bounds the run", () => {
    project("shop-api", { remote: "github.com/acme/shop-api" });
    project("shop-web", { remote: "github.com/acme/shop-web" });
    expect(suggestLinks(db, { now: 10, maxProjects: 1 }).suggested).toBe(0);
  });
});

describe("distill", () => {
  test("writes suggestions after a drain, and a hook does not", async () => {
    db.close();
    const dataDir = join(dir, "data");
    mkdirSync(dataDir);
    const d = openDb({ dataDir, busyTimeoutMs: 2000 });
    for (const n of ["shop-api", "shop-web"]) {
      const root = join(dir, "code", n);
      mkdirSync(root, { recursive: true });
      d.run("INSERT INTO projects (key, name, created_at) VALUES (?, ?, 1)", [`path:${root}`, n]);
      const id = d.query<{ id: number }, [string]>("SELECT id FROM projects WHERE name = ?").get(n)
        ?.id as number;
      d.run("INSERT INTO project_aliases VALUES (?, ?)", [`path:${root}`, id]);
      d.run("INSERT INTO project_aliases VALUES (?, ?)", [`remote:github.com/acme/${n}`, id]);
    }
    d.close();
    const env = { WIZARDINGCODE_MEM_DATA_DIR: dataDir, WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off" };
    await runCliWith(
      {
        input: JSON.stringify({ session_id: "s", cwd: dir, prompt: "hello there" }),
        env: { ...env, WIZARDINGCODE_MEM_DISTILL: "off" },
      },
      "hook",
      "claude-code",
      "prompt",
    );
    const count = () => {
      const x = openDb({ dataDir, busyTimeoutMs: 2000 });
      try {
        return (x.query("SELECT count(*) AS n FROM project_links").get() as { n: number }).n;
      } finally {
        x.close();
      }
    };
    expect(count()).toBe(0);
    const result = await runCliWith({ env: { ...env, WIZARDINGCODE_MEM_DISTILL: "" } }, "distill");
    expect(result.exitCode).toBe(0);
    expect(count()).toBe(1);
    db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
  }, 30_000);
});
