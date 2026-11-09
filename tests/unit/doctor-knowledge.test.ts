import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type Check, type DoctorContext, runChecks } from "../../src/doctor/checks.ts";
import { doctorContext } from "../../src/doctor/context.ts";
import { agentWriter, personAuthor } from "../../src/modules/knowledge/author.ts";
import { KNOWLEDGE_SCHEMA_VERSION } from "../../src/modules/knowledge/migrations.ts";
import { ensureRepo, openRepo, repoPath, writeManifest } from "../../src/modules/knowledge/repo.ts";
import { adopt, writeEntry } from "../../src/modules/knowledge/store.ts";
import type { EntryChange, KnowledgeStore, Repo } from "../../src/modules/knowledge/types.ts";
import { type Fixture, knowledgeFixture } from "../helpers/knowledge.ts";

const WORKSPACE = { scope: "workspace" } as const;
const NOW = Date.UTC(2026, 10, 9, 8, 0, 0);

let fx: Fixture;
let store: KnowledgeStore;
beforeEach(() => {
  fx = knowledgeFixture("doctor-knowledge");
  store = fx.store({ env: { WIZARDINGCODE_MEM_AUTHOR: "Zoë" } });
});
afterEach(() => {
  fx.close();
});

const change = (over: Partial<EntryChange> = {}): EntryChange => ({
  title: "Discovery call script",
  kind: "strategy",
  area: "sales",
  context: "",
  subject: "",
  body: "The body.",
  ...over,
});
const person = () => personAuthor(store);
const workspace = (): Repo => openRepo(store, WORKSPACE) as Repo;

/** The environment `doctor` runs git and reads the settings with. */
const env = (over: Record<string, string | undefined> = {}) => ({
  PATH: process.env.PATH,
  HOME: fx.home,
  WIZARDINGCODE_MEM_AUTHOR: "Zoë",
  ...over,
});

function checks(over: Partial<DoctorContext> = {}): Check[] {
  return runChecks({ ...doctorContext(fx.dataDir, Date.now()), env: env(), ...over });
}
function knowledge(over: Partial<DoctorContext> = {}): Check {
  const found = checks(over).find((check) => check.name === "knowledge");
  if (found === undefined) throw new Error("no knowledge check");
  return found;
}

describe("doctor: knowledge", () => {
  test("is skipped while there is no knowledge folder", () => {
    expect(knowledge()).toMatchObject({ status: "skip" });
    const names = checks().map((check) => check.name);
    expect(names.indexOf("knowledge")).toBe(names.indexOf("backups") + 1);
  });

  test("warns that the module is off, before its skip, with no knowledge folder", () => {
    const off = env({ WIZARDINGCODE_MODULES: "memory" });
    expect(knowledge({ env: off })).toEqual({
      name: "knowledge",
      status: "warn",
      detail: "knowledge is off (WIZARDINGCODE_MODULES)",
    });
  });

  test("warns that the module is off beside the counts of a repository", () => {
    writeEntry(store, WORKSPACE, change(), person());
    const check = knowledge({ env: env({ WIZARDINGCODE_MODULES: "memory" }) });
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("knowledge is off (WIZARDINGCODE_MODULES)");
    expect(check.detail).toContain("1 repository, 1 entry");
  });

  test("an unknown module id in the setting writes no line to the log", () => {
    const logs = join(fx.dir, "log-home");
    const before = process.env.WIZARDINGCODE_MEM_DATA_DIR;
    process.env.WIZARDINGCODE_MEM_DATA_DIR = logs;
    try {
      const check = knowledge({ env: env({ WIZARDINGCODE_MODULES: "memory,nonesuch" }) });
      expect(check).toMatchObject({ status: "warn" });
      expect(check.detail).toContain("knowledge is off (WIZARDINGCODE_MODULES)");
    } finally {
      if (before === undefined) delete process.env.WIZARDINGCODE_MEM_DATA_DIR;
      else process.env.WIZARDINGCODE_MEM_DATA_DIR = before;
    }
    expect(existsSync(join(logs, "logs", "wizardingcode-mem.log"))).toBe(false);
  });

  test("warns when the pinned lines exceed the session-start share, with a database and with none", () => {
    // Five pinned lines of over 200 characters each: more than 1,000 characters of pins.
    for (const n of [1, 2, 3, 4, 5]) {
      const title = `Pinned rule number ${n} ${"about discovery calls and the pricing of agencies ".repeat(2)}`;
      writeEntry(store, WORKSPACE, change({ title: title.trim(), pinned: true }), person());
    }
    const elsewhere = join(fx.dir, "no-database-here");
    mkdirSync(elsewhere);
    for (const check of [knowledge(), knowledge({ storeDir: elsewhere })]) {
      expect(check.status).toBe("warn");
      expect(check.detail).toContain("pinned entries exceed the session-start share");
      expect(check.detail).toContain("a project's own pins add to them in that project");
    }
  });

  test("a few short pins are within the share and draw no warning", () => {
    writeEntry(store, WORKSPACE, change({ pinned: true }), person());
    writeEntry(
      store,
      { scope: "shared" },
      change({ title: "Discount ladder", pinned: true }),
      person(),
    );
    const check = knowledge();
    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain("pinned");
  });

  test("warns when the search table and the active entries differ in number", () => {
    writeEntry(store, WORKSPACE, change(), person());
    writeEntry(store, WORKSPACE, change({ title: "Pricing rules for agencies" }), person());
    writeEntry(store, WORKSPACE, change({ title: "Discount ladder" }), person());
    expect(knowledge().status).toBe("ok");
    fx.db.run("DELETE FROM knowledge_fts WHERE rowid = (SELECT min(rowid) FROM knowledge_fts)");
    const check = knowledge();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("FTS rows 2, active entries 3; run knowledge rebuild");
  });

  test("counts the repositories, the entries, the drafts and the open proposals", () => {
    writeEntry(store, WORKSPACE, change(), person());
    writeEntry(store, WORKSPACE, change({ title: "A draft", status: "draft" }), person());
    writeEntry(store, WORKSPACE, change({ slug: "discovery-call-script" }), agentWriter("codex"));
    const check = knowledge();
    expect(check.status).toBe("ok");
    for (const part of ["1 repository", "2 entries", "1 draft", "1 open proposal"]) {
      expect(check.detail).toContain(part);
    }
  });

  test("warns when git is missing or too old, and asks git itself when not told", () => {
    writeEntry(store, WORKSPACE, change(), person());
    const missing = knowledge({ which: () => null });
    expect(missing.status).toBe("warn");
    expect(missing.detail).toContain("git");
    const old = knowledge({ gitVersion: () => [2, 31, 0] });
    expect(old.status).toBe("warn");
    expect(old.detail).toContain("2.31.0");
    expect(knowledge({ gitVersion: () => [2, 32, 0] }).status).toBe("ok");
    // With no version given, the runner asks the git on PATH.
    expect(knowledge().status).toBe("ok");
    const noGit = knowledge({ env: env({ PATH: fx.emptyBin() }) });
    expect(noGit.status).toBe("warn");
    expect(noGit.detail).toContain("git");
  });

  test("warns about a folder that is not a repository", () => {
    ensureRepo(store, WORKSPACE);
    mkdirSync(repoPath(fx.dataDir, "knowledge/projects/stray"), { recursive: true });
    const check = knowledge();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("knowledge/projects/stray");
  });

  test("warns about a stale index lock", () => {
    const repo = ensureRepo(store, WORKSPACE);
    const lock = join(repo.path, ".git", "index.lock");
    writeFileSync(lock, "");
    const now = Date.now();
    utimesSync(lock, new Date(now - 30_000), new Date(now - 30_000));
    expect(knowledge({ now }).status).toBe("ok");
    utimesSync(lock, new Date(now - 61_000), new Date(now - 61_000));
    const check = knowledge({ now });
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("index.lock");
  });

  test("warns about changes made outside the engine", () => {
    writeEntry(store, WORKSPACE, change(), person());
    const repo = workspace();
    const file = join(repo.path, "entries", "discovery-call-script.md");
    writeFileSync(file, `${readFileSync(file, "utf8")}Edited.\n`);
    writeFileSync(join(repo.path, "entries", "new.md"), "---\ntitle: New\n---\n");
    const check = knowledge();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("2 changed outside the engine");
    expect(check.detail).toContain("knowledge adopt");
  });

  test("warns about entries with problems, naming them", () => {
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(
      join(repo.path, "entries", "odd-entry.md"),
      "---\ntitle: Odd\nkind: rule\narea: sales\nstatus: active\nversion: 1\n---\nA note.\n",
    );
    adopt(store, WORKSPACE, person());
    const check = knowledge();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("odd-entry");
    expect(check.detail).not.toContain("changed outside");
  });

  test("warns when nothing names the author", () => {
    ensureRepo(store, WORKSPACE);
    const check = knowledge({ env: env({ WIZARDINGCODE_MEM_AUTHOR: undefined }) });
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(
      "no author configured: set WIZARDINGCODE_MEM_AUTHOR or a git user.name",
    );
    writeFileSync(join(fx.home, ".gitconfig"), "[user]\n\tname = First Writer\n");
    // A fresh process would look the name up again; here the lookup is cached per home.
    expect(knowledge({ env: env({ WIZARDINGCODE_MEM_AUTHOR: "Zoë" }) }).status).toBe("ok");
  });

  test("warns when the knowledge tables are newer than this binary", () => {
    ensureRepo(store, WORKSPACE);
    fx.db.run(
      "INSERT INTO module_migrations (module, version, name, applied_at) VALUES ('knowledge', ?, 'x', 0)",
      [KNOWLEDGE_SCHEMA_VERSION + 1],
    );
    const check = knowledge();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("newer");
  });

  test("a manifest that is not JSON is a warning, and every other check still runs", () => {
    const repo = ensureRepo(store, WORKSPACE);
    const usual = checks().length;
    writeFileSync(join(repo.path, "knowledge.json"), "{ not json");
    const all = checks();
    expect(all).toHaveLength(usual);
    const check = all.find((entry) => entry.name === "knowledge");
    expect(check?.status).toBe("warn");
    expect(check?.detail).toContain("knowledge.json is not JSON");
  });

  test("warns when a project matches two manifests", () => {
    const projectId = fx.addProject("gitdir:/x/.git", "path:/x");
    writeEntry(store, { scope: "project", projectId }, change(), person());
    const twin = "knowledge/projects/twin";
    mkdirSync(repoPath(fx.dataDir, twin), { recursive: true });
    writeManifest(repoPath(fx.dataDir, twin), {
      format: 1,
      scope: "project",
      project: { aliases: ["gitdir:/x/.git"] },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const check = knowledge();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("ambiguous");
    expect(check.detail).toContain(twin);
  });

  test("warns before a folder reaches the cap, and when the index left files out", () => {
    const repo = ensureRepo(store, WORKSPACE);
    for (let n = 0; n < 4001; n++) {
      const id = `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
      writeFileSync(
        join(repo.path, "entries", `e-${String(n).padStart(4, "0")}.md`),
        `---\nid: ${id}\ntitle: T\nkind: knowledge\narea: sales\nstatus: active\nversion: 1\n---\n`,
      );
    }
    const check = knowledge();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("entries/ holds 4001 files; the index keeps 5000");
  }, 30_000);

  test("warns when the index recorded files over the cap", () => {
    const repo = ensureRepo(store, WORKSPACE);
    fx.db.run("UPDATE knowledge_repos SET over_cap = 3 WHERE id = ?", [repo.id]);
    const check = knowledge();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("3 files over the cap");
  });

  test("a fault reading the index is a warning with its cause, never an ok", () => {
    writeEntry(store, WORKSPACE, change(), person());
    const usual = checks().length;
    // Not a table that is missing yet: a table this version cannot read.
    fx.db.run("ALTER TABLE knowledge_repos RENAME COLUMN path TO somewhere");
    const all = checks();
    expect(all).toHaveLength(usual);
    const check = all.find((entry) => entry.name === "knowledge");
    expect(check?.status).toBe("warn");
    expect(check?.detail).toContain("could not be checked");
    expect(check?.detail).toContain("path");
  });

  test("a manifest that is a link is not followed", () => {
    const repo = ensureRepo(store, WORKSPACE);
    const outside = join(fx.dir, "outside.json");
    writeFileSync(outside, '{"format": 1, "scope": "workspace", "createdAt": "x"}');
    rmSync(join(repo.path, "knowledge.json"));
    symlinkSync(outside, join(repo.path, "knowledge.json"));
    const check = knowledge();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("knowledge.json");
    expect(check.detail).toContain("a link");
  });

  test("a linked knowledge folder is a warning, and nothing is read through it", () => {
    const repo = ensureRepo(store, WORKSPACE);
    const outside = join(fx.dir, "outside-entries");
    mkdirSync(outside);
    writeFileSync(
      join(outside, "elsewhere.md"),
      "---\ntitle: Elsewhere\nkind: knowledge\narea: code\nstatus: active\nversion: 1\n---\nA note.\n",
    );
    rmSync(join(repo.path, "entries"), { recursive: true });
    symlinkSync(outside, join(repo.path, "entries"));
    const check = knowledge();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(join(repo.path, "entries"));
    expect(check.detail).toContain("a link");
    expect(check.detail).toContain("0 entries");
  });

  test("a link where every project's repository goes is a warning, and nothing is read through it", () => {
    writeEntry(store, WORKSPACE, change(), person());
    // A repository of another folder, as the link would reach it.
    const outside = join(fx.dir, "outside-projects");
    mkdirSync(join(outside, "abc", ".git"), { recursive: true });
    const projects = join(fx.dataDir, "knowledge", "projects");
    rmSync(projects, { recursive: true, force: true });
    symlinkSync(outside, projects);
    const check = knowledge();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(projects);
    expect(check.detail).not.toContain("abc");
  });

  test("with no database, a link where the project repositories go is still not read through", () => {
    writeEntry(store, WORKSPACE, change(), person());
    const outside = join(fx.dir, "outside-projects");
    mkdirSync(join(outside, "abc", ".git"), { recursive: true });
    const projects = join(fx.dataDir, "knowledge", "projects");
    rmSync(projects, { recursive: true, force: true });
    symlinkSync(outside, projects);
    const elsewhere = join(fx.dir, "no-database-here");
    mkdirSync(elsewhere);
    const check = knowledge({ storeDir: elsewhere });
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(projects);
    expect(check.detail).not.toContain("abc");
  });

  /** The workspace and one project, an entry each; and a store directory that holds no database. */
  function workspaceAndProject() {
    const ref = { scope: "project", projectId: fx.addProject("path:/work/site") } as const;
    writeEntry(store, WORKSPACE, change(), person());
    writeEntry(store, ref, change({ title: "In the project" }), person());
    const elsewhere = join(fx.dir, "no-database-here");
    mkdirSync(elsewhere);
    const relative = (openRepo(store, ref) as Repo).relative;
    return { relative, folder: repoPath(fx.dataDir, relative), elsewhere };
  }

  test("a projects folder it cannot read is a warning that names it, with a database and with none", () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    const { elsewhere } = workspaceAndProject();
    const projects = join(fx.dataDir, "knowledge", "projects");
    // Neither listed nor searched; then listed and not searched.
    for (const bits of [0o000, 0o600]) {
      chmodSync(projects, bits);
      try {
        for (const check of [knowledge(), knowledge({ storeDir: elsewhere })]) {
          expect(check.status).toBe("warn");
          expect(check.detail).toContain(projects);
          expect(check.detail).toContain("EACCES");
        }
      } finally {
        chmodSync(projects, 0o700);
      }
    }
    expect(knowledge({ storeDir: elsewhere }).detail).toContain("2 repositories, 2 entries");
  });

  test("a link or a file where a project's repository was is a warning that names it, and is never read through", () => {
    const { relative, folder, elsewhere } = workspaceAndProject();
    const aside = join(fx.dir, "moved-aside");
    renameSync(folder, aside);
    for (const [put, said] of [
      [() => symlinkSync(aside, folder), "is a link"],
      [() => writeFileSync(folder, "not a folder"), "is not a folder"],
    ] as const) {
      put();
      for (const check of [knowledge(), knowledge({ storeDir: elsewhere })]) {
        expect(check.status).toBe("warn");
        expect(check.detail).toContain(`${relative}: ${folder} ${said}`);
        // Neither counted nor read: the entry behind the link is not in the totals.
        expect(check.detail).toContain("1 repository, 1 entry");
      }
      rmSync(folder, { force: true });
    }
  });

  test("a link or a file where the workspace's repository was is a warning that names it, with a database and with none", () => {
    const { elsewhere } = workspaceAndProject();
    const folder = repoPath(fx.dataDir, "knowledge/workspace");
    const aside = join(fx.dir, "moved-aside");
    renameSync(folder, aside);
    // Behind the link, a taxonomy without the area of the project's entry: read through
    // the link, it would list that entry among the ones with problems.
    const taxonomy = join(aside, "taxonomy.md");
    writeFileSync(
      taxonomy,
      readFileSync(taxonomy, "utf8")
        .split("\n")
        .filter((line) => !line.includes("sales"))
        .join("\n"),
    );
    for (const [put, said] of [
      [() => symlinkSync(aside, folder), "is a link"],
      [() => writeFileSync(folder, "not a folder"), "is not a folder"],
    ] as const) {
      put();
      for (const check of [knowledge(), knowledge({ storeDir: elsewhere })]) {
        expect(check.status).toBe("warn");
        expect(check.detail).toContain(`knowledge/workspace: ${folder} ${said}`);
        // The project's repository is still read, and nothing through the link.
        expect(check.detail).toContain("1 repository, 1 entry");
        expect(check.detail).not.toContain("in-the-project");
      }
      rmSync(folder, { force: true });
    }
  });

  test("an entries folder it cannot read is a warning for that repository, and the others are still checked", () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    const { relative, folder, elsewhere } = workspaceAndProject();
    const entries = join(folder, "entries");
    for (const bits of [0o000, 0o600]) {
      chmodSync(entries, bits);
      try {
        for (const check of [knowledge(), knowledge({ storeDir: elsewhere })]) {
          expect(check.status).toBe("warn");
          expect(check.detail).toContain(`${relative}: `);
          expect(check.detail).toContain(entries);
          expect(check.detail).toContain("EACCES");
          expect(check.detail).toContain("2 repositories, 1 entry");
        }
      } finally {
        chmodSync(entries, 0o700);
      }
    }
  });

  test("with no database, the checks that need it are skipped and said", () => {
    writeEntry(store, WORKSPACE, change(), person());
    const elsewhere = join(fx.dir, "no-database-here");
    mkdirSync(elsewhere);
    const check = knowledge({
      storeDir: elsewhere,
      env: env({ WIZARDINGCODE_MEM_AUTHOR: undefined }),
      now: NOW,
    });
    expect(check.detail).toContain("no database");
    expect(check.detail).not.toContain("no author configured");
    expect(check.detail).toContain("1 repository");
    expect(check.status).toBe("ok");
  });
});
