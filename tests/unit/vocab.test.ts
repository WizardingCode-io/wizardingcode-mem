import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { documentCounts } from "../../src/retrieve/vocab.ts";
import { type Db, LATEST_VERSION, openDb, openExisting } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";

let base: string;
let db: Db;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wcmem-vocab-")));
  db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
  const projects = ["a", "b"].map((name) => {
    mkdirSync(join(base, name));
    return resolveProject(db, join(base, name), 0).id;
  });
  const texts = [
    "The queue lease expires.",
    "A lease on the queue.",
    "Código do worker.",
    "Queue only. Йогурт и άλφα.",
  ];
  for (const [i, title] of texts.entries()) {
    insertMemory(db, {
      projectId: projects[i % 2] as number,
      kind: "fix",
      title,
      body: "" as Redacted,
      terms: "",
      importance: 3,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: 0,
    });
  }
});
afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

describe("documentCounts", () => {
  test("counts the memories of the whole index that hold each word", () => {
    const counts = documentCounts(db, ["queue", "lease", "worker"]);
    expect(counts).toEqual(
      new Map([
        ["queue", 3],
        ["lease", 2],
        ["worker", 1],
      ]),
    );
  });

  // The index folds only Latin accents; a word it holds in another form must not read as
  // held by none, which would make it rare. Unknown is left out, for the caller to count.
  test("never says none for a word it cannot find", () => {
    const counts = documentCounts(db, ["йогурт", "άλφα", "absent"]);
    for (const word of ["йогурт", "άλφα", "absent"]) expect(counts.get(word)).not.toBe(0);
  });

  test("folds a word the way the index does", () => {
    expect(documentCounts(db, ["código"]).get("código")).toBe(1);
  });

  test("leaves the schema alone, and works on a read-only connection", () => {
    documentCounts(db, ["queue"]);
    expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(
      LATEST_VERSION,
    );
    expect(
      db
        .query<{ n: number }, []>(
          "SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE '%vocab%'",
        )
        .get()?.n,
    ).toBe(0);
    const readonly = openExisting(join(base, "data")) as Db;
    try {
      expect(documentCounts(readonly, ["lease"]).get("lease")).toBe(2);
    } finally {
      readonly.close();
    }
  });

  test("takes any number of words, again and again on one connection", () => {
    expect(documentCounts(db, [])).toEqual(new Map());
    expect(documentCounts(db, ["queue"]).get("queue")).toBe(3);
    expect(documentCounts(db, ["queue", "queue"]).get("queue")).toBe(3);
  });
});
