import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentWriter, personAuthor } from "../../src/modules/knowledge/author.ts";
import {
  DEFAULT_AREAS,
  ENTRY_KEYS,
  PROPOSAL_KEYS,
  parseEntry,
  parseProposal,
  renderEntry,
  renderProposal,
} from "../../src/modules/knowledge/entry.ts";
import {
  DELETE_SEARCH_ROW,
  readRepoState,
  rebuildAll,
  rebuildRepo,
  replaceRepoRows,
  upsertEntry,
} from "../../src/modules/knowledge/index-store.ts";
import { ensureRepo, openRepo } from "../../src/modules/knowledge/repo.ts";
import { DELETE_REPO_SEARCH_ROWS } from "../../src/modules/knowledge/resolve.ts";
import { acceptProposal, writeEntry } from "../../src/modules/knowledge/store.ts";
import type {
  EntryChange,
  KnowledgeEntry,
  KnowledgeProposal,
  KnowledgeStore,
  Repo,
  Taxonomy,
} from "../../src/modules/knowledge/types.ts";
import { openDb } from "../../src/store/db.ts";
import { type CliResult, runCliWith } from "../helpers/cli.ts";
import { commitEntryFiles, type Fixture, knowledgeFixture } from "../helpers/knowledge.ts";

const WORKSPACE = { scope: "workspace" } as const;
const NOW = Date.UTC(2026, 10, 9, 8, 0, 0);
const agent = agentWriter("claude-code");

let fx: Fixture;
let store: KnowledgeStore;
beforeEach(() => {
  fx = knowledgeFixture("knowledge-migration-7");
  store = fx.store({ now: () => NOW, env: { WIZARDINGCODE_MEM_AUTHOR: "Zoë" } });
});
afterEach(() => {
  fx.close();
});

const change = (over: Partial<EntryChange> = {}): EntryChange => ({
  title: "Discovery call script",
  kind: "strategy",
  area: "sales",
  context: "agency clients",
  subject: "discovery call",
  body: "Ask about the budget before the timeline.",
  ...over,
});
const SLUG = "discovery-call-script";
const person = () => personAuthor(store);

function written(result: ReturnType<typeof writeEntry>): KnowledgeEntry {
  if (result.kind !== "written") throw new Error("expected a written entry");
  return result.entry;
}
function proposed(result: ReturnType<typeof writeEntry>): KnowledgeProposal {
  if (result.kind !== "proposed") throw new Error("expected a proposal");
  return result.proposal;
}

const workspace = (): Repo => openRepo(store, WORKSPACE) as Repo;
const entryFile = (repo: Repo, slug = SLUG) => join(repo.path, "entries", `${slug}.md`);

const columnsOf = (name: string) =>
  fx.db
    .query<{ name: string; pk: number; dflt_value: string | null }, []>(
      `PRAGMA table_info(${name})`,
    )
    .all();
const count = (sql: string, ...args: (string | number)[]) =>
  fx.db.query<{ n: number }, (string | number)[]>(sql).get(...args)?.n ?? 0;
const ftsRows = () =>
  fx.db
    .query<{ rowid: number; title: string; repo_id: number; entry_id: string }, []>(
      "SELECT rowid, title, repo_id, entry_id FROM knowledge_fts ORDER BY rowid",
    )
    .all();
const entryRow = (repoId: number, slug = SLUG) =>
  fx.db
    .query<{ id: string; fts_rowid: number | null; pinned: number }, [number, string]>(
      "SELECT id, fts_rowid, pinned FROM knowledge_entries WHERE repo_id = ? AND slug = ?",
    )
    .get(repoId, slug);
const plan = (sql: string, ...args: number[]) =>
  fx.db
    .query<{ detail: string }, number[]>(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...args)
    .map((row) => row.detail);

describe("migration 7: the schema", () => {
  test("a fresh database records 6 then 7, and has the new columns and tables", () => {
    expect(
      fx.db
        .query<{ version: number; name: string }, []>(
          "SELECT version, name FROM module_migrations WHERE module = 'knowledge' ORDER BY version",
        )
        .all()
        .map((row) => [row.version, row.name]),
    ).toEqual([
      [6, "knowledge_store"],
      [7, "knowledge_agent"],
      [8, "knowledge_received"],
    ]);
    const entries = columnsOf("knowledge_entries");
    expect(entries.find((column) => column.name === "pinned")?.dflt_value).toBe("0");
    expect(entries.map((column) => column.name)).toContain("fts_rowid");
    expect(columnsOf("knowledge_proposals").map((column) => column.name)).toEqual(
      expect.arrayContaining(["contradicts", "on_behalf_of", "judged_by", "judge_version"]),
    );
    expect(columnsOf("knowledge_fts").map((column) => column.name)).toEqual([
      "title",
      "area",
      "context",
      "subject",
      "body",
      "repo_id",
      "entry_id",
    ]);
    const shown = columnsOf("knowledge_shown");
    expect(shown.map((column) => column.name)).toEqual([
      "session_id",
      "context_epoch",
      "repo_id",
      "entry_id",
      "event",
      "rule",
      "at",
    ]);
    expect(
      shown
        .filter((column) => column.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name),
    ).toEqual(["session_id", "context_epoch", "repo_id", "entry_id"]);
    const indexes = (column: string) =>
      fx.db
        .query<{ name: string }, []>(`PRAGMA index_info(${column})`)
        .all()
        .map((row) => row.name);
    expect(indexes("knowledge_shown_entry")).toEqual(["repo_id", "entry_id"]);
    expect(indexes("knowledge_shown_at")).toEqual(["at"]);
  });

  test("the two id columns are stored and never matched", () => {
    const entryId = "7d0c2b8e-4f0a-4c2e-9a0b-1b2c3d4e5f60";
    fx.db.run(
      `INSERT INTO knowledge_fts (title, area, context, subject, body, repo_id, entry_id)
       VALUES ('Lease renewal', 'code', '', '', 'Renew the lease before it expires.', 3, ?)`,
      [entryId],
    );
    const match = (expression: string) =>
      fx.db
        .query<{ entry_id: string }, [string]>(
          "SELECT entry_id FROM knowledge_fts WHERE knowledge_fts MATCH ?",
        )
        .all(expression);
    expect(match('"3"')).toEqual([]);
    expect(match('{title area context subject body} : ("step" OR "3")')).toEqual([]);
    expect(match('"7d0c2b8e"')).toEqual([]);
    expect(match('"4f0a"')).toEqual([]);
    expect(match('"renew"')).toEqual([{ entry_id: entryId }]);
  });
});

describe("migration 7: the index writer keeps the search table", () => {
  test("an active entry has one search row, and its row points at it", () => {
    const entry = written(writeEntry(store, WORKSPACE, change(), person()));
    const repo = workspace();
    const rows = ftsRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Discovery call script", entry_id: entry.id });
    expect(entryRow(repo.id)?.fts_rowid).toBe(rows[0]?.rowid as number);
  });

  test("an entry turned draft leaves the search table, and its row points at nothing", () => {
    written(writeEntry(store, WORKSPACE, change(), person()));
    written(
      writeEntry(
        store,
        WORKSPACE,
        change({ slug: SLUG, baseVersion: 1, status: "draft" }),
        person(),
      ),
    );
    expect(ftsRows()).toEqual([]);
    expect(entryRow(workspace().id)?.fts_rowid).toBeNull();
  });

  test("a new title is the search row's title", () => {
    written(writeEntry(store, WORKSPACE, change(), person()));
    written(
      writeEntry(
        store,
        WORKSPACE,
        change({ slug: SLUG, baseVersion: 1, title: "Discovery call questions" }),
        person(),
      ),
    );
    expect(ftsRows().map((row) => row.title)).toEqual(["Discovery call questions"]);
  });

  test("an entry with a problem is never searchable", () => {
    const entry = written(writeEntry(store, WORKSPACE, change(), person()));
    const repo = workspace();
    upsertEntry(
      store,
      repo.id,
      { ...entry, status: "active", problem: "kind is missing" },
      `entries/${SLUG}.md`,
      "",
    );
    expect(ftsRows()).toEqual([]);
    expect(entryRow(repo.id)?.fts_rowid).toBeNull();
    // A file committed with a problem, read by a rebuild.
    commitEntryFiles(repo.path, [
      { slug: "no-kind", title: "No kind", body: "A body.", kind: "nonesuch" },
    ]);
    rebuildRepo(store, repo);
    expect(ftsRows().map((row) => row.title)).toEqual(["Discovery call script"]);
    expect(entryRow(repo.id, "no-kind")?.fts_rowid).toBeNull();
  });

  test("one id under two slugs leaves one entry row and one search row", () => {
    const entry = written(writeEntry(store, WORKSPACE, change(), person()));
    const repo = workspace();
    upsertEntry(store, repo.id, { ...entry, slug: "renamed" }, "entries/renamed.md", "");
    expect(count("SELECT count(*) AS n FROM knowledge_entries WHERE id = ?", entry.id)).toBe(1);
    expect(ftsRows()).toHaveLength(1);
    expect(entryRow(repo.id, "renamed")?.fts_rowid).toBe(ftsRows()[0]?.rowid as number);
  });

  test("the writer deletes a search row by its rowid, never by a scan", () => {
    expect(plan(DELETE_SEARCH_ROW, 1).join("\n")).toContain("VIRTUAL TABLE INDEX 0:=");
  });
});

describe("migration 7: the speed of a rebuild (AC-27)", () => {
  test("a committed repository of 2,000 entries is indexed whole, each rebuild under 2 s", () => {
    const repo = ensureRepo(store, WORKSPACE);
    commitEntryFiles(
      repo.path,
      Array.from({ length: 2000 }, (_, i) => ({
        slug: `entry-${i}`,
        title: `Lease renewal number ${i}`,
        body: `Renew the lease ${i} before the pool reuses its socket.\n\nA second paragraph.`,
      })),
    );
    rebuildRepo(store, repo);
    expect(count("SELECT count(*) AS n FROM knowledge_fts")).toBe(2000);
    for (let run = 0; run < 2; run++) {
      const started = performance.now();
      rebuildRepo(store, repo);
      const ms = performance.now() - started;
      console.log(`rebuildRepo of 2,000 entries, run ${run + 1}: ${ms.toFixed(1)} ms`);
      expect(ms).toBeLessThan(2000);
      expect(count("SELECT count(*) AS n FROM knowledge_fts")).toBe(2000);
    }
    // The transaction alone, as the perf test times it.
    const state = readRepoState(store, repo);
    expect(state.files.entries).toHaveLength(2000);
    replaceRepoRows(store, repo, state);
    expect(count("SELECT count(*) AS n FROM knowledge_fts")).toBe(2000);
  }, 30_000);
});

describe("migration 7: dropping a repository's rows", () => {
  const shownFor = (repoId: number, entryId: string) =>
    fx.db.run(
      `INSERT INTO knowledge_shown (session_id, context_epoch, repo_id, entry_id, event, rule, at)
       VALUES (1, 0, ?, ?, 'session-start', NULL, 1)`,
      [repoId, entryId],
    );
  const rowsOf = (repoId: number) => ({
    entries: count("SELECT count(*) AS n FROM knowledge_entries WHERE repo_id = ?", repoId),
    proposals: count("SELECT count(*) AS n FROM knowledge_proposals WHERE repo_id = ?", repoId),
    search: count("SELECT count(*) AS n FROM knowledge_fts WHERE repo_id = ?", repoId),
    shown: count("SELECT count(*) AS n FROM knowledge_shown WHERE repo_id = ?", repoId),
  });
  const none = { entries: 0, proposals: 0, search: 0, shown: 0 };

  test("a repository whose folder is gone loses its rows to rebuildAll, and its row", () => {
    const projectId = fx.addProject("path:/work/site");
    const ref = { scope: "project", projectId } as const;
    written(writeEntry(store, WORKSPACE, change(), person()));
    const entry = written(writeEntry(store, ref, change({ title: "In the project" }), person()));
    proposed(writeEntry(store, ref, change({ title: "Proposed in the project" }), agent));
    const project = openRepo(store, ref) as Repo;
    shownFor(project.id, entry.id);
    expect(rowsOf(project.id)).toEqual({ entries: 1, proposals: 1, search: 1, shown: 1 });

    rmSync(project.path, { recursive: true });
    rebuildAll(store);
    expect(rowsOf(project.id)).toEqual(none);
    expect(count("SELECT count(*) AS n FROM knowledge_repos WHERE id = ?", project.id)).toBe(0);
    // The workspace keeps its own.
    expect(rowsOf(workspace().id)).toMatchObject({ entries: 1, search: 1 });
  });

  test("a project repository found again in another folder loses what was indexed from the old one", () => {
    const projectId = fx.addProject("remote:example.com/team/site");
    const ref = { scope: "project", projectId } as const;
    const entry = written(writeEntry(store, ref, change({ title: "In the project" }), person()));
    proposed(writeEntry(store, ref, change({ title: "Proposed in the project" }), agent));
    const before = openRepo(store, ref) as Repo;
    shownFor(before.id, entry.id);
    expect(rowsOf(before.id)).toEqual({ entries: 1, proposals: 1, search: 1, shown: 1 });

    renameSync(before.path, join(fx.dataDir, "knowledge", "projects", "moved-site"));
    const after = openRepo(store, ref) as Repo;
    expect(after.relative).toBe("knowledge/projects/moved-site");
    expect(after.id).toBe(before.id);
    expect(rowsOf(before.id)).toEqual(none);
  });

  test("a search row no entry row points at is gone after rebuildAll", () => {
    written(writeEntry(store, WORKSPACE, change(), person()));
    fx.db.run(
      `INSERT INTO knowledge_fts (title, area, context, subject, body, repo_id, entry_id)
       VALUES ('Stray', 'code', '', '', 'A stray row.', 99, 'stray')`,
    );
    expect(ftsRows()).toHaveLength(2);
    rebuildAll(store);
    expect(ftsRows().map((row) => row.title)).toEqual(["Discovery call script"]);
  });

  test("a repository's search rows are deleted by their rowids, never by a scan", () => {
    expect(plan(DELETE_REPO_SEARCH_ROWS, 1).join("\n")).toContain("VIRTUAL TABLE INDEX 0:=");
  });
});

describe("migration 7: the formats", () => {
  const ID = "7d0c2b8e-4f0a-4c2e-9a0b-1b2c3d4e5f60";
  const OTHER = "0a1b2c3d-4e5f-4061-8293-a4b5c6d7e8f9";
  const PROPOSAL_ID = "11111111-2222-4333-8444-555555555555";
  const NINE: Taxonomy = {
    version: 1,
    updated: "2026-11-08T23:10:00.000Z",
    areas: DEFAULT_AREAS.map((area) => ({ ...area })),
  };
  const ENTRY = (pinned: string | null) => `---
id: ${ID}
title: "Discovery call script"
kind: strategy
area: sales
context: "agency clients"
subject: "discovery call"
status: active
author: "Zoë"
version: 3
created: 2026-11-08T23:10:00.000Z
updated: 2026-11-09T08:00:00.000Z
${pinned === null ? "" : `${pinned}\n`}---
The body.
`;

  test("pinned: true is read and written back; no key is false and writes no line", () => {
    const pinned = parseEntry(ENTRY("pinned: true"), SLUG, NINE);
    expect(pinned.pinned).toBe(true);
    expect(pinned.problem).toBeNull();
    expect(renderEntry(pinned)).toBe(ENTRY("pinned: true"));
    const plain = parseEntry(ENTRY(null), SLUG, NINE);
    expect(plain.pinned).toBe(false);
    expect(renderEntry(plain)).toBe(ENTRY(null));
    expect(parseEntry(ENTRY("pinned: false"), SLUG, NINE).pinned).toBe(false);
    expect(renderEntry(parseEntry(ENTRY("pinned: false"), SLUG, NINE))).toBe(ENTRY(null));
    const maybe = parseEntry(ENTRY("pinned: maybe"), SLUG, NINE);
    expect(maybe.problem).toContain("pinned");
    expect(maybe.status).toBe("draft");
  });

  const PROPOSAL = (extra: string) => `---
id: ${PROPOSAL_ID}
entry: ${ID}
slug: ${SLUG}
base_version: 2
base_hash: 9f1c2d3e4a5b6c7d
proposed_by: agent:claude-code
proposed_at: 2026-11-09T08:10:00.000Z
title: "Discovery call script"
kind: strategy
area: sales
context: "agency clients"
subject: "discovery call"
status: active
${extra}decision: accepted
decided_by: "Zoë"
decided_at: 2026-11-09T09:00:00.000Z
decided_version: 3
---
The proposed body.
`;
  const AGENT_KEYS = `on_behalf_of: "André"
judged_by: heuristic
judge_version: "2"
contradicts:
  - ${ID}
  - ${OTHER}
`;

  test("a proposal's four new keys are read, and written back between status and decision", () => {
    const text = PROPOSAL(AGENT_KEYS);
    const proposal = parseProposal(text, `${PROPOSAL_ID}.md`, NINE);
    expect(proposal.problem).toBeNull();
    expect(proposal).toMatchObject({
      contradicts: [ID, OTHER],
      onBehalfOf: "André",
      judgedBy: "heuristic",
      judgeVersion: "2",
      extra: [],
    });
    expect(renderProposal(proposal)).toBe(text);
  });

  test("a contradicts item that is not an entry id, or a value that is not a list, is a problem", () => {
    const item = parseProposal(
      PROPOSAL(`contradicts:\n  - workspace/a\n`),
      `${PROPOSAL_ID}.md`,
      NINE,
    );
    expect(item.problem).toContain("contradicts");
    const scalar = parseProposal(PROPOSAL(`contradicts: ${ID}\n`), `${PROPOSAL_ID}.md`, NINE);
    expect(scalar.problem).toContain("contradicts");
  });

  test("a proposal with none of the four renders as before", () => {
    const text = PROPOSAL("");
    const proposal = parseProposal(text, `${PROPOSAL_ID}.md`, NINE);
    expect(proposal).toMatchObject({
      contradicts: [],
      onBehalfOf: null,
      judgedBy: null,
      judgeVersion: null,
    });
    expect(renderProposal(proposal)).toBe(text);
  });

  test("the key lists hold the new keys", () => {
    expect(ENTRY_KEYS).toContain("pinned");
    expect(PROPOSAL_KEYS).toEqual(
      expect.arrayContaining(["contradicts", "on_behalf_of", "judged_by", "judge_version"]),
    );
  });
});

describe("migration 7: pinned in the store", () => {
  const pinnedOnDisk = (repo: Repo) =>
    readFileSync(entryFile(repo), "utf8").includes("\npinned: true\n");

  test("a person pins, keeps and clears; an agent cannot pin; an accept keeps the pin", () => {
    const first = written(writeEntry(store, WORKSPACE, change({ pinned: true }), person()));
    const repo = workspace();
    expect(first.pinned).toBe(true);
    expect(pinnedOnDisk(repo)).toBe(true);
    expect(entryRow(repo.id)?.pinned).toBe(1);

    const kept = written(
      writeEntry(store, WORKSPACE, change({ slug: SLUG, baseVersion: 1 }), person()),
    );
    expect(kept.pinned).toBe(true);
    expect(pinnedOnDisk(repo)).toBe(true);

    // An agent's change is a proposal, and a proposal carries no pin.
    const proposal = proposed(
      writeEntry(
        store,
        WORKSPACE,
        change({ slug: SLUG, baseVersion: 2, body: "A new body.", pinned: false }),
        agent,
      ),
    );
    const proposalText = readFileSync(
      join(repo.path, "proposals", "open", `${proposal.id}.md`),
      "utf8",
    );
    expect(proposalText).not.toContain("pinned");
    const accepted = acceptProposal(store, WORKSPACE, proposal.id, person());
    expect(accepted.pinned).toBe(true);
    expect(pinnedOnDisk(repo)).toBe(true);

    const cleared = written(
      writeEntry(store, WORKSPACE, change({ slug: SLUG, baseVersion: 3, pinned: false }), person()),
    );
    expect(cleared.pinned).toBe(false);
    expect(pinnedOnDisk(repo)).toBe(false);
    expect(readFileSync(entryFile(repo), "utf8")).not.toContain("pinned");
    expect(entryRow(repo.id)?.pinned).toBe(0);
  });

  test("an agent's write with pinned: true writes a proposal with no pinned", () => {
    const proposal = proposed(writeEntry(store, WORKSPACE, change({ pinned: true }), agent));
    const text = readFileSync(
      join(workspace().path, "proposals", "open", `${proposal.id}.md`),
      "utf8",
    );
    expect(text).not.toContain("pinned");
  });
});

describe("migration 7: knowledge write --pinned and --unpin", () => {
  let dir: string;
  let env: Record<string, string>;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-knowledge-pin-")));
    env = {
      WIZARDINGCODE_MEM_DATA_DIR: join(dir, "data"),
      WIZARDINGCODE_HOME: join(dir, "brand"),
      HOME: dir,
      PATH: process.env.PATH ?? "",
      WIZARDINGCODE_MEM_AUTHOR: "Zoë",
    };
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const WRITE = [
    "knowledge",
    "write",
    "--scope",
    "workspace",
    "--title",
    "Discovery call script",
    "--kind",
    "strategy",
    "--area",
    "sales",
    "--body",
    "The body.",
  ];
  const cli = (...args: string[]): Promise<CliResult> => runCliWith({ env }, ...WRITE, ...args);
  const file = () =>
    readFileSync(join(dir, "data", "knowledge", "workspace", "entries", `${SLUG}.md`), "utf8");
  const indexedPin = () => {
    const db = openDb({ dataDir: join(dir, "data"), busyTimeoutMs: 5000 });
    try {
      return db
        .query<{ pinned: number }, [string]>("SELECT pinned FROM knowledge_entries WHERE slug = ?")
        .get(SLUG)?.pinned;
    } finally {
      db.close();
    }
  };

  test("--pinned sets it, a write with neither keeps it, --unpin clears it", async () => {
    expect((await cli("--pinned")).exitCode).toBe(0);
    expect(file()).toContain("\npinned: true\n");
    expect(indexedPin()).toBe(1);
    expect((await cli("--slug", SLUG, "--base", "1")).exitCode).toBe(0);
    expect(file()).toContain("\npinned: true\n");
    expect((await cli("--slug", SLUG, "--base", "2", "--unpin")).exitCode).toBe(0);
    expect(file()).not.toContain("pinned");
    expect(indexedPin()).toBe(0);
  }, 30_000);

  test("--pinned with --unpin is a usage error", async () => {
    const result = await cli("--pinned", "--unpin");
    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain("give --pinned or --unpin, not both");
  });
});
