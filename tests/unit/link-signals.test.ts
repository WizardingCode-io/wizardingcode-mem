import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nameStems, parseRemote, readManifests, sharedStem } from "../../src/links/signals.ts";

describe("parseRemote", () => {
  test("HTTPS, SSH and self-hosted hosts", () => {
    const want = { host: "github.com", owner: "acme", name: "shop-api" };
    expect(parseRemote("github.com/acme/shop-api")).toEqual(want);
    expect(parseRemote("https://github.com/acme/shop-api.git")).toEqual(want);
    expect(parseRemote("git@github.com:acme/shop-api.git")).toEqual(want);
    expect(parseRemote("git.corp.example/team/tool")).toEqual({
      host: "git.corp.example",
      owner: "team",
      name: "tool",
    });
  });
  test("garbage is null", () => {
    expect(parseRemote("")).toBeNull();
    expect(parseRemote("nonsense")).toBeNull();
    expect(parseRemote("/some/local/path")).toBeNull();
    expect(parseRemote("host/owner")).toBeNull();
  });
});

describe("stems", () => {
  test("splits, lower-cases and drops short and generic parts", () => {
    expect(nameStems("Shop-API_web.v2")).toEqual(["shop"]);
    expect(nameStems("client-a-api")).toEqual([]);
  });
  test("agency words are generic; every shared stem is considered", () => {
    expect(sharedStem("acme-admin", "beta-admin")).toBeNull();
    expect(sharedStem("a-wordpress-theme", "b-wordpress-theme")).toBeNull();
    expect(sharedStem("acme-shop-api", "acme-shop-web")).toBe("acme");
    expect(sharedStem("acme-shop-api", "acme-shop-web", new Set(["acme"]))).toBe("shop");
  });
  test("shared stem", () => {
    expect(sharedStem("shop-api", "shop-web")).toBe("shop");
    expect(sharedStem("acme-api", "zeta-web")).toBeNull();
    expect(sharedStem("client-a-api", "client-b-web")).toBeNull();
  });
});

describe("readManifests", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "link-signals-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("package.json", () => {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "@acme/app",
        dependencies: {
          "@acme/lib": "^1",
          local: "file:../lib",
          g: "git+https://github.com/a/b.git",
        },
        devDependencies: { x: "1" },
        workspaces: ["packages/*"],
      }),
    );
    const m = readManifests(root);
    expect(m.packageName).toBe("@acme/app");
    expect(m.deps).toEqual(expect.arrayContaining(["@acme/lib", "local", "x"]));
    expect(m.localPaths).toEqual(["../lib"]);
    expect(m.gitUrls).toEqual(["git+https://github.com/a/b.git"]);
    expect(m.workspaces).toEqual(["packages/*"]);
  });
  test("composer, go.mod and Cargo.toml", () => {
    writeFileSync(
      join(root, "composer.json"),
      JSON.stringify({ name: "acme/x", require: { "acme/y": "1" } }),
    );
    const c = readManifests(root);
    expect(c.packageName).toBe("acme/x");
    expect(c.deps).toContain("acme/y");
    rmSync(join(root, "composer.json"));
    writeFileSync(
      join(root, "go.mod"),
      "module github.com/acme/x\n\nrequire github.com/acme/y v1.0.0\nrequire (\n\tgithub.com/acme/z v1\n)\n",
    );
    const g = readManifests(root);
    expect(g.packageName).toBe("github.com/acme/x");
    expect(g.deps).toEqual(expect.arrayContaining(["github.com/acme/y", "github.com/acme/z"]));
    rmSync(join(root, "go.mod"));
    writeFileSync(
      join(root, "Cargo.toml"),
      '[package]\nname = "x"\n\n[dependencies]\ny = { path = "../y" }\nz = "1"\n',
    );
    const r = readManifests(root);
    expect(r.packageName).toBe("x");
    expect(r.deps).toEqual(expect.arrayContaining(["y", "z"]));
    expect(r.localPaths).toEqual(["../y"]);
  });
  test("exclusions and bare wildcards are not workspace patterns", () => {
    writeFileSync(
      join(root, "pnpm-workspace.yaml"),
      "packages:\n  - 'apps/*'\n  - '!**/test/**'\n  - '**'\n  - '*'\n  - '**/*'\n",
    );
    expect(readManifests(root).workspaces).toEqual(["apps/*"]);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["!x", "**", "pkgs/*"] }),
    );
    expect(readManifests(root).workspaces).toEqual(["pkgs/*", "apps/*"]);
  });
  test("pnpm-workspace.yaml", () => {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n  - libs/*\n");
    expect(readManifests(root).workspaces).toEqual(["apps/*", "libs/*"]);
  });
  test("malformed, huge or absent manifests give empty fields", () => {
    const empty = { packageName: null, deps: [], localPaths: [], gitUrls: [], workspaces: [] };
    expect(readManifests(join(root, "missing"))).toEqual(empty);
    writeFileSync(join(root, "package.json"), "{ not json");
    expect(readManifests(root)).toEqual(empty);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "big", pad: "x".repeat(10_000_000) }),
    );
    expect(readManifests(root)).toEqual(empty);
    mkdirSync(join(root, "Cargo.toml"));
    expect(readManifests(root)).toEqual(empty);
  });
});
