import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { readEnvFile } from "../../src/settings/env-file.ts";
import { DB_FILE, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { claimDrain, claimLease, EMBED_DOWNLOAD_LEASE } from "../../src/store/meta.ts";
import { inspectTarget, moveStore } from "../../src/store/move.ts";
import { runCliWith } from "../helpers/cli.ts";

const NOW = Date.UTC(2026, 9, 6, 10);
const FIXTURES = new URL("../fixtures/", import.meta.url).pathname;

let base: string;
let dataDir: string;
let target: string;
let project: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-move-")));
  dataDir = join(base, "data");
  target = join(base, "external", "wizardingcode-mem");
  project = join(base, "project");
  mkdirSync(project);
  const db = openDb({ dataDir, busyTimeoutMs: 2000 });
  const projectId = resolveProject(db, project, NOW).id;
  for (let i = 0; i < 3; i++) {
    insertMemory(db, {
      projectId,
      kind: "decision",
      title: `Decision ${i}`,
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
      now: NOW,
    });
  }
  db.close();
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const memories = (dir: string) => {
  const db = new Database(join(dir, DB_FILE), { readonly: true });
  try {
    return db.query<{ n: number }, []>("SELECT count(*) AS n FROM memories").get()?.n ?? 0;
  } finally {
    db.close();
  }
};

describe("moveStore", () => {
  test("copies the database whole, points the settings at it, and keeps the old file", async () => {
    const outcome = await moveStore({ dataDir, from: dataDir, to: target, now: NOW });
    expect(outcome).toMatchObject({ ok: true, to: target });
    expect(memories(target)).toBe(3);
    expect(readEnvFile(join(dataDir, "env")).WIZARDINGCODE_MEM_STORE_DIR).toBe(target);
    expect(existsSync(join(dataDir, DB_FILE))).toBe(false);
    const kept = readdirSync(dataDir).filter((name) => /\.moved-\d+$/.test(name));
    expect(kept).toHaveLength(1);
    expect((outcome as { keptOld: string }).keptOld).toBe(join(dataDir, kept[0] as string));
    expect(memories(target)).toBe(3);
    // Nothing stays open: the target can be opened and written at once.
    const db = openDb({ dataDir: target, busyTimeoutMs: 100 });
    db.run("INSERT INTO meta (key, value) VALUES ('probe', '1')");
    db.close();
  });

  test("every later process follows: a hook from the command line writes to the new store", async () => {
    await moveStore({ dataDir, from: dataDir, to: target, now: NOW });
    const payload = readFileSync(
      join(FIXTURES, "claude-code", "payloads", "user-prompt-submit.json"),
      "utf8",
    ).replace(/"cwd":\s*"[^"]*"/, `"cwd": ${JSON.stringify(project)}`);
    const result = await runCliWith(
      {
        input: payload,
        env: {
          WIZARDINGCODE_MEM_DATA_DIR: dataDir,
          WIZARDINGCODE_MEM_DISTILL: "off",
          WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
        },
      },
      "hook",
      "claude-code",
      "prompt",
    );
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const db = new Database(join(target, DB_FILE), { readonly: true });
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM hook_runs").get()?.n).toBe(1);
    db.close();
    expect(existsSync(join(dataDir, DB_FILE))).toBe(false);
  });

  test("refuses while a history run holds its lease", async () => {
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    claimLease(db, "history.lease", `${process.pid}-h`, NOW, 60_000);
    db.close();
    expect(await moveStore({ dataDir, from: dataDir, to: target, now: NOW })).toMatchObject({
      ok: false,
      reason: "busy",
    });
    expect(existsSync(join(dataDir, DB_FILE))).toBe(true);
    expect(existsSync(join(target, DB_FILE))).toBe(false);
  });

  test("refuses while the search model is downloading (its backfill follows on this store)", async () => {
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    claimLease(db, EMBED_DOWNLOAD_LEASE, `${process.pid}-dl`, NOW, 60_000);
    db.close();
    expect(await moveStore({ dataDir, from: dataDir, to: target, now: NOW })).toMatchObject({
      ok: false,
      reason: "busy",
    });
    expect(existsSync(join(target, DB_FILE))).toBe(false);
  });

  test("refuses while background work holds the database", async () => {
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    claimDrain(db, "someone", NOW, 60_000);
    db.close();
    expect(await moveStore({ dataDir, from: dataDir, to: target, now: NOW })).toMatchObject({
      ok: false,
      reason: "busy",
    });
    expect(existsSync(join(dataDir, DB_FILE))).toBe(true);
    expect(existsSync(join(target, DB_FILE))).toBe(false);
  });

  test("refuses a target that already holds a database, and the same place", async () => {
    openDb({ dataDir: target, busyTimeoutMs: 2000 }).close();
    expect(await moveStore({ dataDir, from: dataDir, to: target, now: NOW })).toMatchObject({
      ok: false,
      reason: "target-has-db",
    });
    expect(await moveStore({ dataDir, from: dataDir, to: dataDir, now: NOW })).toMatchObject({
      ok: false,
      reason: "same",
    });
  });

  test("freezes writers while it copies, so the copy is the whole truth", async () => {
    // A writer with a short patience meets the frozen database and gives up, as hooks do.
    let blocked: unknown = null;
    const outcome = await moveStore({
      dataDir,
      from: dataDir,
      to: target,
      now: NOW,
      onFrozen: () => {
        const writer = new Database(join(dataDir, DB_FILE));
        writer.run("PRAGMA busy_timeout = 50");
        try {
          writer.run("INSERT INTO meta (key, value) VALUES ('late', '1')");
        } catch (error) {
          blocked = error;
        } finally {
          writer.close();
        }
      },
    });
    expect(outcome).toMatchObject({ ok: true });
    expect(String(blocked)).toMatch(/SQLITE_BUSY|database is locked/);
  });
});

describe("inspectTarget", () => {
  test("knows a network share and a folder it can write to", () => {
    const share = inspectTarget("\\\\nas\\share\\wizardingcode-mem");
    expect(share.network).toBe(true);
    expect(share.warnings.join(" ")).toMatch(/network/i);

    const local = inspectTarget(target);
    expect(local).toMatchObject({ exists: false, hasDb: false, writable: true });
    openDb({ dataDir: target, busyTimeoutMs: 2000 }).close();
    expect(inspectTarget(target)).toMatchObject({ exists: true, hasDb: true });
  });

  test("a relative path is refused", () => {
    expect(inspectTarget("relative/path")).toMatchObject({ writable: false });
  });
});
