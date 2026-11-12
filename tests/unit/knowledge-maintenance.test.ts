// No git process outlives the call that started it: a commit starts no maintenance by
// itself, and the runner runs git's own maintenance after it, in the foreground.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { KnowledgeError } from "../../src/modules/knowledge/errors.ts";
import { commitPaths, ensureRepo, type GitHost, runGit } from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import type { EntryChange, KnowledgeStore } from "../../src/modules/knowledge/types.ts";
import { type Fixture, knowledgeFixture } from "../helpers/knowledge.ts";
import { commitsEachMaintained, realGit, recordedCalls, stubGit } from "../helpers/stub-git.ts";

const WORKSPACE = { scope: "workspace" } as const;
const SETTINGS = ["maintenance.auto=false", "maintenance.autoDetach=false", "gc.autoDetach=false"];
const author = { name: "Ana Lopes", email: "ana@members.wizardingcode.invalid" };

let fx: Fixture;
beforeEach(() => {
  fx = knowledgeFixture("knowledge-maintenance");
});
afterEach(() => fx.close());

const change = (title: string): EntryChange => ({
  title,
  kind: "strategy",
  area: "sales",
  context: "agency clients",
  subject: "discovery call",
  body: "Ask about the budget before the timeline.",
});

const write = (store: KnowledgeStore, title: string) =>
  writeEntry(store, WORKSPACE, change(title), personAuthor(store));

const clean = (path: string) => realGit(path, "status", "--porcelain").trim() === "";
const subjects = (path: string) => realGit(path, "log", "--format=%s").trim().split("\n");
const logged = () => {
  const file = join(fx.dataDir, "logs", "wizardingcode-mem.log");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};

describe("the settings and the trace of a store write", () => {
  test("every call carries the three settings; git ran the runner's maintenance after each commit, and nothing detached", () => {
    const record = join(fx.dir, "args.txt");
    const trace = join(fx.dir, "trace.txt");
    const stub = stubGit(join(fx.dir, "tracing-git"), { recordArgsTo: record, traceTo: trace });
    const store = fx.store({ env: { PATH: fx.pathWith(stub), WIZARDINGCODE_MEM_AUTHOR: "Zoë" } });

    expect(write(store, "First entry").kind).toBe("written");
    expect(write(store, "Second entry").kind).toBe("written");

    const calls = recordedCalls(record);
    expect(calls.length).toBeGreaterThan(4);
    for (const args of calls) for (const setting of SETTINGS) expect(args).toContain(setting);

    // Each commit is followed by the runner's own call, the only maintenance there is; a
    // trace without it, or with anything detached, gives null.
    expect(commitsEachMaintained(trace)).toBeGreaterThanOrEqual(2);
  });
});

describe("a maintenance that does not end well is not the commit's", () => {
  test("a maintenance call that fails: the write returns, the entry is committed, the tree equals HEAD, the failure is logged", () => {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    const failing = stubGit(join(fx.dir, "failing-git"), {
      fail: "maintenance",
      stderr: "fatal: no maintenance today",
    });
    const store = fx.store({
      env: { PATH: fx.pathWith(failing), WIZARDINGCODE_MEM_AUTHOR: "Zoë" },
    });

    const result = write(store, "Kept all the same");
    expect(result.kind).toBe("written");
    expect(existsSync(join(repo.path, "entries", "kept-all-the-same.md"))).toBe(true);
    expect(subjects(repo.path)[0]).toContain("kept-all-the-same");
    expect(clean(repo.path)).toBe(true);
    expect(logged()).toContain("git maintenance in");
    expect(logged()).toContain("no maintenance today");
  });

  test("a maintenance call that passes the timeout: the same, and the log says it timed out", () => {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    const stalled = stubGit(join(fx.dir, "stalled-git"), {
      stallOn: { subcommand: "maintenance", ms: 6000 },
    });
    const store = fx.store({
      env: { PATH: fx.pathWith(stalled), WIZARDINGCODE_MEM_AUTHOR: "Zoë" },
      gitTimeoutMs: 2000,
    });

    const result = write(store, "Slow to compact");
    expect(result.kind).toBe("written");
    expect(existsSync(join(repo.path, "entries", "slow-to-compact.md"))).toBe(true);
    expect(subjects(repo.path)[0]).toContain("slow-to-compact");
    expect(clean(repo.path)).toBe(true);
    expect(logged()).toMatch(/git maintenance in .* timed out after 2000 ms/);
  }, 20_000);

  test("a lease lost at the maintenance call: the write returns and nothing is undone", () => {
    const repo = ensureRepo(fx.store(), WORKSPACE);
    const record = join(fx.dir, "lease-args.txt");
    const recording = stubGit(join(fx.dir, "recording-git"), { recordArgsTo: record });
    const store = fx.store({
      env: { PATH: fx.pathWith(recording), WIZARDINGCODE_MEM_AUTHOR: "Zoë" },
    });
    // The renewal that comes right after the commit is the maintenance call's.
    let lost = 0;
    store.renew = () => {
      const last = recordedCalls(record).at(-1);
      if (lost === 0 && last?.includes("commit") === true) {
        lost++;
        throw new KnowledgeError("locked", "another write to this repository is in progress");
      }
    };

    const result = write(store, "Written under a lost lease");
    store.renew = null;
    expect(lost).toBe(1);
    expect(result.kind).toBe("written");
    expect(existsSync(join(repo.path, "entries", "written-under-a-lost-lease.md"))).toBe(true);
    expect(subjects(repo.path)[0]).toContain("written-under-a-lost-lease");
    expect(clean(repo.path)).toBe(true);
    // No git ran without the lease: the last call recorded is still the commit.
    expect(recordedCalls(record).at(-1)).toContain("commit");
  });

  test("an error that is not the store's is logged, and is not the commit's either", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(join(repo.path, "entries", "a.md"), "one\n");
    runGit(store, repo.path, ["add", "--", "entries/a.md"], { operation: "test" });
    let renewals = 0;
    const host: GitHost = {
      ...store,
      renew: () => {
        // The commit's renewal, then the maintenance call's.
        if (++renewals === 2) throw new RangeError("not the store's");
      },
    };
    commitPaths(host, repo, ["entries/a.md"], "test: a", author, "test");
    expect(renewals).toBe(2);
    expect(subjects(repo.path)[0]).toBe("test: a");
    expect(logged()).toMatch(/knowledge\.test RangeError: not the store's/);
  });
});

describe("git keeps compacting", () => {
  /** A file whose blob git stores in `objects/17`, the one folder its threshold samples. */
  function sampledBlob(seed: number): string {
    for (let n = seed; ; n += 1000) {
      const content = `loose object ${n}\n`;
      const sha = createHash("sha1").update(`blob ${content.length}\0${content}`).digest("hex");
      if (sha.startsWith("17")) return content;
    }
  }

  test("with work due, the runner's call packs the loose objects before commitPaths returns", () => {
    const store = fx.store();
    const repo = ensureRepo(store, WORKSPACE);
    for (const seed of [1, 2]) {
      const file = join(fx.dir, `blob-${seed}`);
      writeFileSync(file, sampledBlob(seed));
      realGit(repo.path, "hash-object", "-w", file);
    }
    const sampled = join(repo.path, ".git", "objects", "17");
    expect(readdirSync(sampled).length).toBe(2);

    // The host lowers git's threshold; the runner's own three settings ride on the same call.
    const host: GitHost = { ...store, extraConfig: ["-c", "gc.auto=1"] };
    writeFileSync(join(repo.path, "entries", "a.md"), "one\n");
    runGit(host, repo.path, ["add", "--", "entries/a.md"], { operation: "test" });
    commitPaths(host, repo, ["entries/a.md"], "test: a", author, "test");

    const packs = readdirSync(join(repo.path, ".git", "objects", "pack"));
    expect(packs.some((name) => name.endsWith(".pack"))).toBe(true);
    expect(existsSync(sampled) ? readdirSync(sampled) : []).toEqual([]);
    expect(existsSync(join(repo.path, ".git", "objects", "maintenance.lock"))).toBe(false);
    expect(subjects(repo.path)[0]).toBe("test: a");
  });
});

describe("the tests' own git", () => {
  test("starts no maintenance: it reads maintenance.auto as false", () => {
    expect(realGit(fx.dir, "config", "--get", "maintenance.auto").trim()).toBe("false");
  });
});

describe("the documents", () => {
  const root = join(import.meta.dir, "..", "..");
  const adr = readFileSync(join(root, "docs", "adr", "0024-knowledge-module.md"), "utf8");
  const claude = readFileSync(join(root, "CLAUDE.md"), "utf8");
  const flat = (text: string) => text.replace(/\s+/g, " ");

  test("ADR 0024 and CLAUDE.md name the three settings and the runner's own maintenance call", () => {
    for (const text of [adr, claude]) {
      for (const setting of SETTINGS) expect(text).toContain(setting);
      expect(text).toContain("git maintenance run --auto --quiet");
    }
    // The sentence beside it, on the hooks path, is whole.
    expect(claude).toContain(
      "the repository's own `.git/config` (a file) as its hooks path, and no template. No git process outlives the call that started it",
    );
  });

  test("ADR 0024 says the housekeeping still runs, after a commit and in the foreground, and keeps the limit open", () => {
    expect(adr).not.toContain("the store does not turn off git's own housekeeping");
    const paragraphs = adr.split("\n").filter((line) => line.includes("housekeeping"));
    const started = "started by the runner after a commit, in the foreground";
    // The paragraph on what `.git` may hold says it too.
    const held = flat(
      paragraphs.find((line) => line.startsWith("- A `.git` that holds anything")) ?? "",
    );
    expect(held).toContain(started);
    const limit = flat(paragraphs.find((line) => line.includes("are not checked")) ?? "");
    expect(limit).toContain("The files inside the folders of `.git/objects/` are not checked");
    expect(limit).toContain(started);
    expect(limit).toContain("removes and rewrites files below `objects/`");
    expect(limit).toContain("The sync part closes both");
  });
});
