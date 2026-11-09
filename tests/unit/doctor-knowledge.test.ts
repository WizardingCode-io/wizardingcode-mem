import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Check, type DoctorContext, runChecks } from "../../src/doctor/checks.ts";
import { doctorContext } from "../../src/doctor/context.ts";
import { agentWriter, personAuthor } from "../../src/modules/knowledge/author.ts";
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
      "INSERT INTO module_migrations (module, version, name, applied_at) VALUES ('knowledge', 7, 'x', 0)",
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
    expect(check.detail).toContain("not a regular file");
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
