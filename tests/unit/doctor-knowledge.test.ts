import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knowledgeCheck } from "../../src/doctor/checks.ts";
import { knowledgeDir } from "../../src/modules/knowledge/files.ts";

// `doctor` reports knowledge problems (spec: "flagged in doctor and in the viewer"; final
// review I2): it reads the files of the folder it is run in, never the index.

let base: string;
let home: string;
let repo: string;
let dataDir: string;
let env: Record<string, string | undefined>;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-doctor-knowledge-")));
  home = join(base, "home");
  repo = join(base, "repo");
  dataDir = join(home, ".wizardingcode", "mem");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(repo);
  env = { HOME: home, WIZARDINGCODE_HOME: join(home, ".wizardingcode") };
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const check = (cwd = repo, extra: Record<string, string> = {}) =>
  knowledgeCheck({ dataDir, cwd, env: { ...env, ...extra } });

function entry(slug: string, text: string, root = repo): void {
  mkdirSync(knowledgeDir(root), { recursive: true });
  writeFileSync(join(knowledgeDir(root), `${slug}.md`), text);
}

describe("doctor's knowledge check", () => {
  test("a valid folder: ok, with its counts", () => {
    entry("orders", "---\ntitle: Orders\nkind: rule\nessential: true\n---\nNever deleted.\n");
    entry("money", "---\ntitle: Money\nkind: decision\n---\nIn cents.\n");
    entry("old", "---\ntitle: Old\nkind: decision\nstatus: superseded\n---\nGone.\n");
    expect(check()).toEqual({
      name: "knowledge",
      status: "ok",
      detail: "3 entries (1 essential, 1 draft or superseded)",
    });
  });

  test("an invalid frontmatter: warn, naming the entry and that it is a draft", () => {
    entry("orders", "---\ntitle: Orders\nthis line is wrong\n---\nBody.\n");
    entry("money", "---\ntitle: Money\nkind: decision\n---\nIn cents.\n");
    const found = check();
    expect(found?.status).toBe("warn");
    expect(found?.detail).toMatch(/^1 of 2 entries need attention: orders \(draft\): /);
  });

  test("more than five problems: the first five, then how many more", () => {
    for (let i = 1; i <= 7; i++) entry(`bad-${i}`, "---\ntitle: Bad\nkind: nonsense\n---\nB.\n");
    const found = check();
    expect(found?.status).toBe("warn");
    expect(found?.detail).toMatch(
      /^7 of 7 entries need attention: bad-1: .*bad-5: .*; and 2 more$/,
    );
  });

  test.skipIf(process.platform === "win32")("a linked .wizardingcode: warn", () => {
    const elsewhere = join(base, "elsewhere");
    mkdirSync(join(elsewhere, "knowledge"), { recursive: true });
    symlinkSync(elsewhere, join(repo, ".wizardingcode"));
    const found = check();
    expect(found?.status).toBe("warn");
    expect(found?.detail).toMatch(/is a link/);
  });

  test("run in the home folder: skip, knowledge is off here", () => {
    expect(check(home)).toEqual({
      name: "knowledge",
      status: "skip",
      detail: "knowledge is off here (the home folder or wizardingcode's data)",
    });
  });

  test("no folder: skip", () => {
    expect(check()).toEqual({
      name: "knowledge",
      status: "skip",
      detail: `no knowledge folder in ${repo}`,
    });
  });

  test("the module turned off: skip", () => {
    entry("orders", "---\ntitle: Orders\nthis line is wrong\n---\nBody.\n");
    expect(check(repo, { WIZARDINGCODE_MODULES: "memory" })).toEqual({
      name: "knowledge",
      status: "skip",
      detail: "knowledge is off (WIZARDINGCODE_MODULES)",
    });
  });

  test("the folder's root is the git root, not the folder doctor runs in", () => {
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(join(repo, "src"));
    entry("orders", "---\ntitle: Orders\nkind: rule\n---\nNever deleted.\n");
    expect(check(join(repo, "src"))?.status).toBe("ok");
  });

  test("not run by the viewer (no folder to look at)", () => {
    expect(knowledgeCheck({ dataDir, env })).toBeNull();
  });
});
