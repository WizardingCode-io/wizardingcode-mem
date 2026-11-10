// What the knowledge store's tests share: a data directory, a throwaway home, a database,
// and stores whose environment the test controls. No test touches the person's git
// configuration or depends on the shell beyond `PATH`.
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderEntry } from "../../src/modules/knowledge/entry.ts";
import { KnowledgeError } from "../../src/modules/knowledge/errors.ts";
import { resetGitCaches } from "../../src/modules/knowledge/repo.ts";
import { openStore } from "../../src/modules/knowledge/store-open.ts";
import type { KnowledgeEntry, KnowledgeStore } from "../../src/modules/knowledge/types.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { realGit } from "./stub-git.ts";

export interface StoreOverrides {
  env?: Record<string, string | undefined>;
  now?: () => number;
  gitTimeoutMs?: number;
  dataDir?: string;
}

export interface Fixture {
  dir: string;
  dataDir: string;
  home: string;
  db: Db;
  /** A store on the fixture's data directory; `env` is merged over `PATH` and `HOME`. */
  store(overrides?: StoreOverrides): KnowledgeStore;
  /** A `PATH` with `first` ahead of the test's own. */
  pathWith(first: string): string;
  /** A folder with no programs in it, for a `PATH` without git. */
  emptyBin(): string;
  /** A project row with its aliases; the first alias is its key. Returns the project id. */
  addProject(...aliases: string[]): number;
  close(): void;
}

export function knowledgeFixture(name: string): Fixture {
  const dir = mkdtempSync(join(tmpdir(), `wizardingcode-mem-${name}-`));
  const dataDir = join(dir, "data");
  const home = join(dir, "home");
  mkdirSync(dataDir);
  mkdirSync(home);
  const db = openDb({ dataDir, busyTimeoutMs: 2000 });
  resetGitCaches();
  return {
    dir,
    dataDir,
    home,
    db,
    store: (overrides = {}) =>
      openStore({
        db,
        dataDir: overrides.dataDir ?? dataDir,
        env: { PATH: process.env.PATH, HOME: home, ...overrides.env },
        ...(overrides.now === undefined ? {} : { now: overrides.now }),
        ...(overrides.gitTimeoutMs === undefined ? {} : { gitTimeoutMs: overrides.gitTimeoutMs }),
      }),
    pathWith: (first) => `${first}:${process.env.PATH ?? ""}`,
    emptyBin: () => {
      const empty = join(dir, "empty-bin");
      mkdirSync(empty, { recursive: true });
      return empty;
    },
    addProject: (...aliases) => {
      const key = aliases[0] as string;
      const id = db
        .query<{ id: number }, [string, string]>(
          "INSERT INTO projects (key, name, created_at) VALUES (?, ?, 1) RETURNING id",
        )
        .get(key, key.split("/").pop() ?? key)?.id as number;
      for (const alias of aliases) {
        db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [alias, id]);
      }
      return id;
    },
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** What a corpus entry says; the rest of the entry takes the defaults of `entryFiles`. */
export type CorpusEntry = Pick<KnowledgeEntry, "slug" | "title" | "body"> & Partial<KnowledgeEntry>;

/**
 * Writes entries into a repository's `entries/` folder in the store's own format, then
 * stages them with one `git add` and commits them once, by hand: a corpus of thousands
 * of entries without thousands of commits. The index is not told; a rebuild reads them.
 */
export function commitEntryFiles(repoPath: string, entries: CorpusEntry[]): void {
  const folder = join(repoPath, "entries");
  mkdirSync(folder, { recursive: true });
  for (const entry of entries) {
    const full: KnowledgeEntry = {
      id: randomUUID(),
      kind: "knowledge",
      area: "code",
      context: "",
      subject: "",
      status: "active",
      author: "Corpus",
      version: 1,
      created: "2026-11-01T08:00:00.000Z",
      updated: "2026-11-01T08:00:00.000Z",
      supersedes: null,
      pinned: false,
      extra: [],
      problem: null,
      ...entry,
    };
    writeFileSync(join(folder, `${entry.slug}.md`), renderEntry(full));
  }
  realGit(repoPath, "add", "-A");
  realGit(
    repoPath,
    "-c",
    "user.name=Corpus",
    "-c",
    "user.email=corpus@example.invalid",
    "commit",
    "-q",
    "-m",
    "corpus",
  );
}

/** The code of the `KnowledgeError` a call throws; null when it does not throw. */
export function codeOf(fn: () => unknown): string | null {
  try {
    fn();
  } catch (error) {
    return error instanceof KnowledgeError ? error.code : `other: ${String(error)}`;
  }
  return null;
}

/** The error a call throws, for a test that reads its message. */
export function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to throw");
}
