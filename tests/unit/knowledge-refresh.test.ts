import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { refreshStale } from "../../src/modules/knowledge/index-store.ts";
import {
  fingerprintOf,
  headOf,
  KNOWLEDGE_LEASE_MS,
  leaseKey,
  openRepo,
} from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import type { KnowledgeStore, Repo, ScopeRef } from "../../src/modules/knowledge/types.ts";
import { claimLease } from "../../src/store/meta.ts";
import { runCliWith } from "../helpers/cli.ts";
import { commitEntryFiles, type Fixture, knowledgeFixture } from "../helpers/knowledge.ts";

// The drain's refresh: each repository the index knows is compared with the disk, and at
// most `limit` that differ are rebuilt, the least recently indexed first, each under its
// lease and in its own transaction. Nothing it meets leaves it as a throw.

const NOW = Date.UTC(2026, 10, 9, 8, 0, 0);

let fx: Fixture;
let store: KnowledgeStore;
let clock = NOW;
beforeEach(() => {
  fx = knowledgeFixture("knowledge-refresh");
  clock = NOW;
  store = fx.store({ now: () => clock, env: { WIZARDINGCODE_MEM_AUTHOR: "Zoë" } });
});
afterEach(() => {
  fx.close();
});

let entries = 0;
/** One entry written through the store, which makes the repository and indexes it. */
function seeded(ref: ScopeRef): Repo {
  const result = writeEntry(
    store,
    ref,
    {
      slug: `entry-${++entries}`,
      title: `Entry ${entries}`,
      kind: "knowledge",
      area: "code",
      context: "",
      subject: "",
      body: "The ledger sync retries the webhook with backoff.",
    },
    personAuthor(store),
  );
  if (result.kind !== "written") throw new Error("expected a written entry");
  return openRepo(store, ref) as Repo;
}

function project(name: string): number {
  const dir = join(fx.dir, name);
  mkdirSync(dir, { recursive: true });
  return resolveProject(fx.db, dir, NOW).id;
}

/** Four repositories, indexed in this order: the workspace's first, project B's last. */
function fourRepos(): Repo[] {
  const repos = [
    seeded({ scope: "workspace" }),
    seeded({ scope: "shared" }),
    seeded({ scope: "project", projectId: project("a") }),
    seeded({ scope: "project", projectId: project("b") }),
  ];
  for (const [i, repo] of repos.entries()) {
    fx.db.run("UPDATE knowledge_repos SET indexed_at = ? WHERE id = ?", [NOW + i, repo.id]);
  }
  return repos;
}

let byHand = 0;
/** A commit made outside the store: HEAD moves and the index does not know it. */
function commitByHand(repo: Repo): string {
  const slug = `by-hand-${++byHand}`;
  commitEntryFiles(repo.path, [{ slug, title: `By hand ${byHand}`, body: "Written by hand." }]);
  return slug;
}

interface RepoRow {
  head: string | null;
  fingerprint: string | null;
  indexed_at: number;
}
const rowOf = (repo: Repo) =>
  fx.db
    .query<RepoRow, [number]>(
      "SELECT head, fingerprint, indexed_at FROM knowledge_repos WHERE id = ?",
    )
    .get(repo.id);
const fresh = (repo: Repo) => {
  const row = rowOf(repo);
  return row?.head === headOf(repo.path) && row?.fingerprint === fingerprintOf(repo.path);
};
const count = (sql: string, ...args: (string | number)[]) =>
  fx.db.query<{ n: number }, (string | number)[]>(sql).get(...args)?.n ?? 0;
const logLines = (scope: string) => {
  const file = join(fx.dataDir, "logs", "wizardingcode-mem.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.includes(` ${scope} `));
};

describe("refreshStale", () => {
  test("rebuilds at most the limit, the least recently indexed first; the next run the rest", () => {
    const repos = fourRepos();
    for (const repo of repos) commitByHand(repo);
    expect(repos.map(fresh)).toEqual([false, false, false, false]);
    clock += 60_000;
    expect(refreshStale(store, 3)).toBe(3);
    expect(repos.map(fresh)).toEqual([true, true, true, false]);
    expect(refreshStale(store, 3)).toBe(1);
    expect(repos.map(fresh)).toEqual([true, true, true, true]);
  });

  test("a repository that matches the disk is not rebuilt, and nothing is written", () => {
    const repos = fourRepos();
    const before = repos.map((repo) => rowOf(repo)?.indexed_at);
    const changes = () =>
      fx.db.query<{ n: number }, []>("SELECT total_changes() AS n").get()?.n ?? 0;
    const written = changes();
    clock += 60_000;
    expect(refreshStale(store, 3)).toBe(0);
    expect(repos.map((repo) => rowOf(repo)?.indexed_at)).toEqual(before);
    expect(changes()).toBe(written);
  });

  test("a repository whose folder is gone is forgotten whole, and does not count", () => {
    const [, , gone, last] = fourRepos() as [Repo, Repo, Repo, Repo];
    fx.db.run(
      "INSERT INTO knowledge_shown (session_id, context_epoch, repo_id, entry_id, event, rule, at) VALUES (1, 0, ?, 'x', 'prompt', 'words', 1)",
      [gone.id],
    );
    rmSync(gone.path, { recursive: true, force: true });
    commitByHand(last);
    expect(refreshStale(store, 1)).toBe(1);
    expect(fresh(last)).toBe(true);
    expect(count("SELECT count(*) AS n FROM knowledge_repos WHERE id = ?", gone.id)).toBe(0);
    expect(count("SELECT count(*) AS n FROM knowledge_entries WHERE repo_id = ?", gone.id)).toBe(0);
    expect(count("SELECT count(*) AS n FROM knowledge_shown WHERE repo_id = ?", gone.id)).toBe(0);
    expect(count("SELECT count(*) AS n FROM knowledge_fts WHERE repo_id = ?", gone.id)).toBe(0);
    expect(count("SELECT count(*) AS n FROM knowledge_fts")).toBe(
      count("SELECT count(*) AS n FROM knowledge_entries WHERE fts_rowid IS NOT NULL"),
    );
  });

  test("with the knowledge root gone, nothing is forgotten and the fact is logged once", () => {
    const repos = fourRepos();
    for (const repo of repos) commitByHand(repo);
    const rows = () => [
      count("SELECT count(*) AS n FROM knowledge_repos"),
      count("SELECT count(*) AS n FROM knowledge_entries"),
      count("SELECT count(*) AS n FROM knowledge_fts"),
    ];
    const before = rows();
    renameSync(join(fx.dataDir, "knowledge"), join(fx.dir, "moved-away"));
    const logged = logLines("knowledge.refresh").length;
    expect(refreshStale(store, 3)).toBe(0);
    expect(rows()).toEqual(before);
    expect(logLines("knowledge.refresh").length).toBe(logged + 1);
  });

  test("a repository whose lease another process holds is passed over, unlogged, uncounted", () => {
    const repos = fourRepos();
    for (const repo of repos) commitByHand(repo);
    const [, held] = repos as [Repo, Repo];
    expect(
      claimLease(fx.db, leaseKey(held.relative), `${process.pid}-other`, clock, KNOWLEDGE_LEASE_MS),
    ).toBe(true);
    expect(refreshStale(store, 3)).toBe(3);
    expect(repos.map(fresh)).toEqual([true, false, true, true]);
    expect(logLines("knowledge.refresh")).toEqual([]);
  });

  test("a rebuild that fails is logged, uncounted, and the others are rebuilt", () => {
    const repos = fourRepos();
    for (const repo of repos) commitByHand(repo);
    const [, broken] = repos as [Repo, Repo];
    appendFileSync(join(broken.path, ".git", "config"), "[user]\n\tname = Someone\n");
    expect(refreshStale(store, 3)).toBe(3);
    expect(repos.map(fresh)).toEqual([true, false, true, true]);
    expect(logLines("knowledge.refresh")).toHaveLength(1);
  });

  test("an entry edited in place and not committed keeps its committed text", () => {
    const repo = seeded({ scope: "workspace" });
    const file = join(repo.path, "entries", `entry-${entries}.md`);
    const committed = readFileSync(file, "utf8");
    writeFileSync(file, committed.replace("with backoff", "at once"));
    expect(fresh(repo)).toBe(true);
    expect(refreshStale(store, 3)).toBe(0);
    const body = fx.db
      .query<{ body: string }, [string]>("SELECT body FROM knowledge_entries WHERE slug = ?")
      .get(`entry-${entries}`)?.body;
    expect(body).toContain("with backoff");
  });

  test("an entry file added by hand and not committed is indexed as a draft with a problem", () => {
    const repo = seeded({ scope: "workspace" });
    const committed = readFileSync(join(repo.path, "entries", `entry-${entries}.md`), "utf8");
    writeFileSync(
      join(repo.path, "entries", "added-by-hand.md"),
      committed.replace(/^id: .*$/m, "id: 0b6f3c62-1d6a-4a43-9a52-5d1d1b8d2c11"),
    );
    expect(fresh(repo)).toBe(false);
    expect(refreshStale(store, 3)).toBe(1);
    const row = fx.db
      .query<{ status: string; problem: string | null; fts_rowid: number | null }, []>(
        "SELECT status, problem, fts_rowid FROM knowledge_entries WHERE slug = 'added-by-hand'",
      )
      .get();
    expect(row?.status).toBe("draft");
    expect(row?.problem).toContain("changed outside the engine");
    expect(row?.fts_rowid).toBeNull();
  });
});

describe("the drain", () => {
  test("distill rebuilds a repository whose HEAD moved", async () => {
    const repo = seeded({ scope: "workspace" });
    const slug = commitByHand(repo);
    expect(fresh(repo)).toBe(false);
    const result = await runCliWith(
      {
        env: {
          WIZARDINGCODE_MEM_DATA_DIR: fx.dataDir,
          HOME: fx.home,
          WIZARDINGCODE_MEM_AUTHOR: "Zoë",
        },
      },
      "distill",
    );
    expect(result.exitCode).toBe(0);
    expect(fresh(repo)).toBe(true);
    expect(count("SELECT count(*) AS n FROM knowledge_entries WHERE slug = ?", slug)).toBe(1);
  }, 30_000);
});
