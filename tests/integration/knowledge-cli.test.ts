import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentWriter } from "../../src/modules/knowledge/author.ts";
import { parseEntry } from "../../src/modules/knowledge/entry.ts";
import {
  hashOf,
  headOf,
  repoPath,
  resetGitCaches,
  writeManifest,
} from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import { openStore } from "../../src/modules/knowledge/store-open.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { type CliResult, runCliWith } from "../helpers/cli.ts";
import { realGit } from "../helpers/stub-git.ts";

let dir: string;
let dataDir: string;
let home: string;
let project: string;
let env: Record<string, string>;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-knowledge-cli-")));
  dataDir = join(dir, "data");
  home = join(dir, "home");
  project = join(home, "work", "site");
  mkdirSync(dataDir);
  mkdirSync(project, { recursive: true });
  // A project in git: its git directory is what ties a knowledge repository to it.
  realGit(project, "init", "-q");
  env = {
    WIZARDINGCODE_MEM_DATA_DIR: dataDir,
    WIZARDINGCODE_HOME: join(dir, "brand"),
    HOME: home,
    PATH: process.env.PATH ?? "",
  };
  resetGitCaches();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const cli = (...args: string[]): Promise<CliResult> => runCliWith({ env }, "knowledge", ...args);
const cliIn = (cwd: string, ...args: string[]): Promise<CliResult> =>
  runCliWith({ env, cwd }, "knowledge", ...args);

const WRITE = [
  "write",
  "--scope",
  "workspace",
  "--title",
  "Discovery call script",
  "--kind",
  "strategy",
  "--area",
  "sales",
  "--context",
  "agency clients",
  "--subject",
  "discovery call",
];
const SLUG = "discovery-call-script";
const workspace = () => join(dataDir, "knowledge", "workspace");
const entryFile = (slug = SLUG) => join(workspace(), "entries", `${slug}.md`);

function withDb<T>(fn: (db: Db) => T): T {
  const db = openDb({ dataDir, busyTimeoutMs: 5000 });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** An agent's proposal, written through the store as part 2's tools will. */
function propose(body: string): string {
  return withDb((db) => {
    const store = openStore({ db, dataDir, env });
    const result = writeEntry(
      store,
      { scope: "workspace" },
      {
        slug: SLUG,
        title: "Discovery call script",
        kind: "strategy",
        area: "sales",
        context: "agency clients",
        subject: "discovery call",
        body,
      },
      agentWriter("claude-code"),
    );
    if (result.kind !== "proposed") throw new Error("expected a proposal");
    return result.proposal.id;
  });
}

/** The index as JSON, without what a rebuild is free to change. */
function indexRows(): unknown {
  return withDb((db) => ({
    repos: db
      .query("SELECT scope, project_id, path, head FROM knowledge_repos ORDER BY path")
      .all(),
    entries: db
      .query(
        `SELECT r.path AS repo, e.id, e.slug, e.path, e.title, e.kind, e.area, e.context, e.subject,
                e.status, e.author, e.version, e.created, e.updated, e.supersedes, e.body,
                e.problem, e.hash
           FROM knowledge_entries e JOIN knowledge_repos r ON r.id = e.repo_id
          ORDER BY r.path, e.slug`,
      )
      .all(),
    proposals: db
      .query(
        `SELECT r.path AS repo, p.id, p.path, p.state, p.entry_id, p.slug, p.base_version,
                p.base_hash, p.proposed_by, p.proposed_at, p.decided_by, p.decided_at,
                p.decided_version, p.title, p.kind, p.area, p.context, p.subject, p.status,
                p.body, p.problem, p.hash
           FROM knowledge_proposals p JOIN knowledge_repos r ON r.id = p.repo_id
          ORDER BY r.path, p.id`,
      )
      .all(),
  }));
}

describe("knowledge write", () => {
  test("writes an entry, then its next version, and refuses a stale one", async () => {
    const first = await cli(...WRITE, "--body", "The body.");
    expect(first).toEqual({ stdout: `written ${SLUG} (v1)\n`, stderr: "", exitCode: 0 });
    const entry = parseEntry(readFileSync(entryFile(), "utf8"), SLUG, null);
    expect(entry).toMatchObject({ version: 1, author: "you", body: "The body.", area: "sales" });
    expect(
      withDb((db) => db.query("SELECT slug, version, author FROM knowledge_entries").all()),
    ).toEqual([{ slug: SLUG, version: 1, author: "you" }]);

    const second = await cli(...WRITE, "--slug", SLUG, "--base", "1", "--body", "Better.");
    expect(second.stdout).toBe(`written ${SLUG} (v2)\n`);
    expect(second.exitCode).toBe(0);

    const stale = await cli(...WRITE, "--slug", SLUG, "--base", "1", "--body", "Late.");
    expect(stale.exitCode).toBe(1);
    expect(stale.stdout).toBe("");
    expect(stale.stderr).toStartWith("wizardingcode-mem: stale");
    expect(readFileSync(entryFile(), "utf8")).toContain("Better.");
  });

  test("takes the body from a file or from standard input", async () => {
    const bodyFile = join(dir, "script.md");
    writeFileSync(bodyFile, "From a file.\n\nTwo paragraphs.\n");
    expect((await cli(...WRITE, "--body-file", bodyFile)).exitCode).toBe(0);
    expect(parseEntry(readFileSync(entryFile(), "utf8"), SLUG, null).body).toBe(
      "From a file.\n\nTwo paragraphs.",
    );

    const piped = await runCliWith(
      { env, input: "From standard input.\n" },
      "knowledge",
      ...WRITE,
      "--title",
      "Piped entry",
    );
    expect(piped.stdout).toBe("written piped-entry (v1)\n");
    expect(
      parseEntry(readFileSync(entryFile("piped-entry"), "utf8"), "piped-entry", null).body,
    ).toBe("From standard input.");
  });

  test("--scope project writes into the repository of the project of the current folder", async () => {
    const args = WRITE.map((arg) => (arg === "workspace" ? "project" : arg));
    const result = await cliIn(project, ...args, "--body", "For this project.");
    expect(result).toEqual({ stdout: `written ${SLUG} (v1)\n`, stderr: "", exitCode: 0 });
    const rows = withDb((db) =>
      db
        .query<{ scope: string; project_id: number; path: string }, []>(
          "SELECT scope, project_id, path FROM knowledge_repos WHERE scope = 'project'",
        )
        .all(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.project_id).toBeGreaterThan(0);
    expect(
      readFileSync(
        join(repoPath(dataDir, rows[0]?.path as string), "entries", `${SLUG}.md`),
        "utf8",
      ),
    ).toContain("For this project.");
    // The workspace repository exists, as the root, and holds no entry.
    expect(() => readFileSync(entryFile(), "utf8")).toThrow();
  });

  test("a missing required option, a bad option and a failure have their exit codes", async () => {
    for (const missing of ["--scope", "--title", "--kind", "--area"]) {
      const at = WRITE.indexOf(missing);
      const args = [...WRITE.slice(0, at), ...WRITE.slice(at + 2)];
      const result = await cli(...args, "--body", "x");
      expect(result.exitCode).toBe(64);
      expect(result.stderr).toContain("Usage: wizardingcode-mem knowledge");
      expect(result.stderr).toContain(missing);
    }
    expect((await cli(...WRITE, "--base", "one", "--body", "x")).exitCode).toBe(64);
    expect((await cli(...WRITE, "--nonsense", "x")).exitCode).toBe(64);
    expect((await cli(...WRITE, "--scope")).exitCode).toBe(64);
    const scope = WRITE.map((arg) => (arg === "workspace" ? "galaxy" : arg));
    expect((await cli(...scope, "--body", "x")).exitCode).toBe(64);

    const refused = await cli(
      ...WRITE.map((arg) => (arg === "sales" ? "legal" : arg)),
      "--body",
      "x",
    );
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toStartWith("wizardingcode-mem: area: legal is not in the taxonomy");
  });
});

describe("knowledge area", () => {
  test("adds, renames and removes an area", async () => {
    expect((await cli("area", "add", "legal", "Legal")).stdout).toBe("taxonomy v2\n");
    expect((await cli("area", "rename", "people", "Team")).stdout).toBe("taxonomy v3\n");
    const taxonomy = readFileSync(join(workspace(), "taxonomy.md"), "utf8");
    expect(taxonomy).toContain("  - legal: Legal\n");
    expect(taxonomy).toContain("  - people: Team\n");

    await cli(...WRITE, "--body", "The body.");
    const used = await cli("area", "remove", "sales");
    expect(used.exitCode).toBe(1);
    expect(used.stderr).toContain(SLUG);
    expect((await cli("area", "remove", "video")).stdout).toBe("taxonomy v4\n");

    expect((await cli("area", "add", "partners", "Partners", "--scope", "shared")).stdout).toBe(
      "taxonomy v2\n",
    );
    expect((await cli("area", "add", "legal")).exitCode).toBe(64);
    expect((await cli("area", "paint", "legal", "Legal")).exitCode).toBe(64);
    expect((await cli("area", "add", "x", "X", "--scope", "project")).exitCode).toBe(64);
  });
});

describe("knowledge accept and reject", () => {
  test("a person decides an agent's proposals", async () => {
    await cli(...WRITE, "--body", "The body.");
    const first = propose("The agent's first.");
    const second = propose("The agent's second.");

    const accepted = await cli("accept", "--scope", "workspace", first);
    expect(accepted).toEqual({
      stdout: `accepted ${first} into ${SLUG} (v2)\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(readFileSync(entryFile(), "utf8")).toContain("The agent's first.");

    const rejected = await cli("reject", "--scope", "workspace", second);
    expect(rejected).toEqual({ stdout: `rejected ${second}\n`, stderr: "", exitCode: 0 });

    expect((await cli("accept", first)).exitCode).toBe(64);
    expect((await cli("reject", "--scope", "workspace")).exitCode).toBe(64);
    const gone = await cli("accept", "--scope", "workspace", first);
    expect(gone.exitCode).toBe(1);
    expect(gone.stderr).toStartWith("wizardingcode-mem: there is no open proposal");
  });
});

describe("knowledge list, rebuild and adopt", () => {
  test("list prints the entries and the proposals of each repository", async () => {
    expect((await cli("list")).stdout).toBe("no knowledge repository yet\n");
    await cli(...WRITE, "--body", "The body.");
    const proposal = propose("The agent's.");
    const listed = await cli("list");
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toBe(
      [
        "knowledge/workspace",
        `  ${SLUG}  strategy  sales  active  v1  you`,
        `  open  ${proposal}  ${SLUG}  by agent:claude-code`,
        "",
      ].join("\n"),
    );
    expect((await cli("list", "--scope", "shared")).stdout).toBe("shared: no repository\n");
  });

  test("rebuild recreates the rows from the files, for every repository", async () => {
    await cli(...WRITE, "--body", "The body.");
    await cli(...WRITE, "--title", "A second entry", "--body", "More.");
    const proposal = propose("The agent's.");
    await cliIn(
      project,
      ...WRITE.map((arg) => (arg === "workspace" ? "project" : arg)),
      "--body",
      "For this project.",
    );
    const before = indexRows() as { repos: { path: string; head: string | null }[] };
    const projectPath = before.repos.find((repo) => repo.path.includes("/projects/"))
      ?.path as string;
    expect(before.repos.map((repo) => repo.head)).toEqual(
      before.repos.map((repo) => headOf(repoPath(dataDir, repo.path))),
    );

    withDb((db) => {
      db.run("DELETE FROM knowledge_entries");
      db.run("DELETE FROM knowledge_proposals");
      db.run("DELETE FROM knowledge_repos");
    });
    const rebuilt = await cli("rebuild");
    expect(rebuilt.exitCode).toBe(0);
    expect(rebuilt.stderr).toBe("");
    expect(rebuilt.stdout.trim().split("\n").sort()).toEqual(
      [
        "knowledge/workspace: 2 entries, 1 proposal (1 open)",
        `${projectPath}: 1 entry, 0 proposals (0 open)`,
      ].sort(),
    );
    expect(indexRows()).toEqual(before);
    expect(proposal).toMatch(/^[0-9a-f-]{36}$/);

    expect((await cli("rebuild", "--scope", "project")).stdout).toBe(
      `${projectPath}: 1 entry, 0 proposals (0 open)\n`,
    );
    expect((await cli("rebuild", "--scope", "shared")).stdout).toBe("shared: no repository\n");
  });

  test("a hand edit is a problem until it is adopted", async () => {
    await cli(...WRITE, "--body", "The body.");
    writeFileSync(entryFile(), readFileSync(entryFile(), "utf8").replace("The body.", "By hand."));

    const rebuilt = await cli("rebuild");
    expect(rebuilt.stdout).toBe("knowledge/workspace: 1 entry, 0 proposals (0 open), 1 problem\n");
    expect(
      withDb((db) =>
        db.query<{ problem: string }, []>("SELECT problem FROM knowledge_entries").get(),
      )?.problem,
    ).toContain("knowledge adopt");

    const adopted = await cli("adopt");
    expect(adopted).toEqual({
      stdout: "knowledge/workspace: adopted 1 change\n",
      stderr: "",
      exitCode: 0,
    });
    expect(realGit(workspace(), "log", "-1", "--format=%an").trim()).toBe("you");
    const entry = parseEntry(readFileSync(entryFile(), "utf8"), SLUG, null);
    expect(entry).toMatchObject({ version: 2, body: "By hand.", author: "you" });
    expect(entry.updated).not.toBe(entry.created);
    expect((await cli("rebuild")).stdout).toBe(
      "knowledge/workspace: 1 entry, 0 proposals (0 open)\n",
    );
    expect((await cli("adopt")).stdout).toBe("knowledge/workspace: clean\n");
  });

  test("adopt prints the problems that remain", async () => {
    await cli(...WRITE, "--body", "The body.");
    writeFileSync(
      entryFile("odd"),
      "---\ntitle: Odd\nkind: rule\narea: sales\nstatus: active\nversion: 1\n---\nA note.\n",
    );
    const adopted = await cli("adopt");
    expect(adopted.exitCode).toBe(0);
    const lines = adopted.stdout.trim().split("\n");
    expect(lines[0]).toBe("knowledge/workspace: adopted 1 change");
    expect(lines[1]).toContain("entries/odd.md");
    expect(lines[1]).toContain("kind");
  });

  test("rebuild names orphan and ambiguous folders", async () => {
    await cliIn(
      project,
      ...WRITE.map((arg) => (arg === "workspace" ? "project" : arg)),
      "--body",
      "For this project.",
    );
    const folder = (name: string, aliases: string[]) => {
      const relative = `knowledge/projects/${name}`;
      mkdirSync(repoPath(dataDir, relative), { recursive: true });
      writeManifest(repoPath(dataDir, relative), {
        format: 1,
        scope: "project",
        project: { aliases },
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      return relative;
    };
    const orphans = [
      folder("orphan-a", ["gitdir:/nobody/a/.git"]),
      folder("orphan-b", ["gitdir:/nobody/b/.git"]),
    ];
    // A second manifest that names this project's own git directory.
    const mine = withDb((db) =>
      db
        .query<{ alias: string }, []>(
          "SELECT alias FROM project_aliases WHERE alias LIKE 'gitdir:%'",
        )
        .all(),
    );
    expect(mine).toEqual([{ alias: `gitdir:${join(project, ".git")}` }]);
    const twin = folder("twin", [`gitdir:${join(project, ".git")}`]);

    const rebuilt = await cli("rebuild");
    expect(rebuilt.exitCode).toBe(0);
    const lines = rebuilt.stdout.trim().split("\n");
    for (const orphan of orphans) expect(lines).toContain(`orphan ${orphan}`);
    expect(lines).toContain(`ambiguous ${twin}`);
    expect(lines.filter((line) => line.startsWith("orphan "))).toHaveLength(2);
  });

  test("rebuild says how many files a folder left out", async () => {
    await cli(...WRITE, "--body", "The body.");
    for (let n = 0; n < 5000; n++) {
      const id = `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
      writeFileSync(
        entryFile(`e-${String(n).padStart(4, "0")}`),
        `---\nid: ${id}\ntitle: T\nkind: knowledge\narea: sales\nstatus: active\nversion: 1\n---\n`,
      );
    }
    const rebuilt = await cli("rebuild");
    expect(rebuilt.exitCode).toBe(0);
    expect(rebuilt.stdout).toContain("1 file over the cap");
    expect(rebuilt.stdout).toContain("5000 entries");
  }, 60_000);

  test("tables a newer version wrote are refused by every command, and left as they are", async () => {
    await cli(...WRITE, "--body", "The body.");
    withDb((db) => {
      db.run("UPDATE knowledge_entries SET title = 'theirs'");
      db.run(
        "INSERT INTO module_migrations (module, version, name, applied_at) VALUES ('knowledge', 7, 'x', 0)",
      );
    });
    for (const args of [
      ["list"],
      ["rebuild"],
      ["adopt"],
      ["area", "add", "legal", "Legal"],
      [...WRITE, "--title", "Another", "--body", "x"],
    ]) {
      const result = await cli(...args);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("newer than this wizardingcode-mem supports");
    }
    expect(
      withDb((db) => db.query<{ title: string }, []>("SELECT title FROM knowledge_entries").all()),
    ).toEqual([{ title: "theirs" }]);
  });

  test("a write that was interrupted is undone at the next command, and the person is told", async () => {
    await cli(...WRITE, "--body", "The body.");
    // What a killed write leaves: its file, and its record of what it wrote.
    writeFileSync(entryFile("half"), "half written\n");
    writeFileSync(
      join(workspace(), ".git", "wizardingcode-op.json"),
      JSON.stringify({
        operation: "write",
        writer: { kind: "person", name: "you", source: "default" },
        existed: [],
        created: ["entries/half.md"],
        written: { "entries/half.md": hashOf(Buffer.from("half written\n")) },
      }),
    );
    const listed = await cli("list");
    expect(listed.exitCode).toBe(0);
    expect(listed.stderr).toBe(
      "wizardingcode-mem: an interrupted write in knowledge/workspace was undone: entries/half.md\n",
    );
    expect(existsSync(entryFile("half"))).toBe(false);
    expect(listed.stdout).toContain(SLUG);
    expect((await cli("list")).stderr).toBe("");
  });

  test("an unknown subcommand prints the usage and exits 64", async () => {
    for (const args of [["nonsense"], []]) {
      const result = await cli(...args);
      expect(result.exitCode).toBe(64);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Usage: wizardingcode-mem knowledge");
    }
  });
});
