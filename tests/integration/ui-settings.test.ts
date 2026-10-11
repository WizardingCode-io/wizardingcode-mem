import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { keyFingerprint } from "../../src/judge/key.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { claimLease } from "../../src/store/meta.ts";
import { startUi, type UiServer } from "../../src/ui/server.ts";

const NOW = Date.UTC(2026, 9, 5, 12);
const DAY = 86_400_000;
const KEY = "sk-live-0123456789abcdef";

let base: string;
let dataDir: string;
let server: UiServer | undefined;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-ui-settings-")));
  dataDir = join(base, "data");
  const project = join(base, "shop");
  mkdirSync(project);
  const db = openDb({ dataDir, busyTimeoutMs: 2000 });
  const projectId = resolveProject(db, project, NOW).id;
  insertMemory(db, {
    projectId,
    kind: "decision",
    title: "The cart total is rounded once.",
    body: "" as Redacted,
    terms: "",
    importance: 4,
    branch: null,
    commit: null,
    origin: "manual",
    judge: "heuristic",
    judgeVersion: "1",
    sourceTurnId: null,
    files: [],
    now: NOW,
  });
  // An old, finished turn nothing depends on: what compact would remove.
  const old = NOW - 200 * DAY;
  const sessionId = db
    .query<{ id: number }, [number, number, number]>(
      `INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at)
       VALUES ('claude-code', 'old', ?, '/p', ?, ?) RETURNING id`,
    )
    .get(projectId, old, old)?.id as number;
  db.run(
    `INSERT INTO turns (session_id, project_id, seq, state, prompt, started_at, ended_at)
     VALUES (?, ?, 1, 'done', 'p', ?, ?)`,
    [sessionId, projectId, old, old],
  );
  db.close();
});
afterEach(async () => {
  await server?.stop();
  server = undefined;
  rmSync(base, { recursive: true, force: true });
});

async function start(env: Record<string, string | undefined> = {}): Promise<UiServer> {
  server = await startUi({ dataDir, port: 0, open: false, now: () => NOW, env });
  return server;
}
const api = (s: UiServer, path: string, init: RequestInit = {}) =>
  fetch(`${s.origin}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${s.token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
const count = (db: Db, table: string) =>
  db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0;

describe("wizardingcode-mem ui: settings", () => {
  test("GET shows every setting with its source and never the key itself", async () => {
    writeFileSync(join(dataDir, "env"), `TYPESAFE_API_KEY=${KEY}\n`);
    const s = await start({ WIZARDINGCODE_MEM_RETENTION_DAYS: "45" });
    const response = await api(s, "/api/settings");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(KEY);
    const body = JSON.parse(text);
    expect(body.settings.TYPESAFE_API_KEY).toEqual({
      secret: true,
      set: true,
      fingerprint: keyFingerprint(KEY),
      source: "file",
    });
    expect(body.settings.WIZARDINGCODE_MEM_RETENTION_DAYS).toEqual({ value: "45", source: "env" });
    expect(body.settings.WIZARDINGCODE_MEM_UI_AUTO_OPEN).toEqual({
      value: "on",
      source: "default",
    });
    expect(body.dataDir).toBe(dataDir);
  });

  test("PUT writes the file and answers with the new view, without echoing the secret", async () => {
    const s = await start();
    const response = await api(s, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({ TYPESAFE_API_KEY: KEY, WIZARDINGCODE_MEM_RETENTION_DAYS: 30 }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).settings.TYPESAFE_API_KEY).toMatchObject({ set: true, source: "file" });
    expect(JSON.parse(text).settings.WIZARDINGCODE_MEM_RETENTION_DAYS).toEqual({
      value: "30",
      source: "file",
    });
    expect(readFileSync(join(dataDir, "env"), "utf8")).toBe(
      `TYPESAFE_API_KEY=${KEY}\nWIZARDINGCODE_MEM_RETENTION_DAYS=30\n`,
    );
  });

  test("an empty PUT changes nothing; null clears a key", async () => {
    writeFileSync(join(dataDir, "env"), `TYPESAFE_API_KEY=${KEY}\n`);
    const s = await start();
    expect((await api(s, "/api/settings", { method: "PUT", body: "{}" })).status).toBe(200);
    expect(readFileSync(join(dataDir, "env"), "utf8")).toBe(`TYPESAFE_API_KEY=${KEY}\n`);
    const cleared = await api(s, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({ TYPESAFE_API_KEY: null }),
    });
    const view = (await cleared.json()) as { settings: Record<string, unknown> };
    expect(view.settings.TYPESAFE_API_KEY).toMatchObject({ set: false });
    expect(readFileSync(join(dataDir, "env"), "utf8")).toBe("");
  });

  test("a bad value is refused, key by key, and the file is left alone", async () => {
    writeFileSync(join(dataDir, "env"), "WIZARDINGCODE_MEM_RETENTION_DAYS=30\n");
    const s = await start();
    const response = await api(s, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        WIZARDINGCODE_MEM_RETENTION_DAYS: 0,
        WIZARDINGCODE_MEM_TYPESAFE: "off",
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "some settings could not be saved",
      errors: { WIZARDINGCODE_MEM_RETENTION_DAYS: expect.stringContaining("7") },
    });
    expect(readFileSync(join(dataDir, "env"), "utf8")).toBe(
      "WIZARDINGCODE_MEM_RETENTION_DAYS=30\n",
    );
    expect((await api(s, "/api/settings", { method: "PUT", body: "nope" })).status).toBe(400);
  });

  test("the doctor's checks are served as they are", async () => {
    const s = await start();
    const checks = (await (await api(s, "/api/doctor")).json()) as {
      name: string;
      status: string;
      detail: string;
    }[];
    expect(checks.length).toBeGreaterThan(5);
    for (const check of checks) {
      expect(["ok", "warn", "fail", "skip"]).toContain(check.status);
      expect(typeof check.detail).toBe("string");
    }
    expect(checks.map((c) => c.name)).toContain("TypeSafe");
  });

  test("compact runs from the viewer, dry run first", async () => {
    const s = await start();
    const dry = await (
      await api(s, "/api/compact", { method: "POST", body: JSON.stringify({ dryRun: true }) })
    ).json();
    expect(dry).toMatchObject({ dryRun: true, turns: 1, sessions: 1, hookRuns: 0 });
    let db = openDb({ dataDir, busyTimeoutMs: 2000 });
    expect(count(db, "turns")).toBe(1);
    db.close();

    const real = await (await api(s, "/api/compact", { method: "POST", body: "{}" })).json();
    expect(real).toMatchObject({ dryRun: false, turns: 1, sessions: 1 });
    db = openDb({ dataDir, busyTimeoutMs: 2000 });
    expect(count(db, "turns")).toBe(0);
    expect(count(db, "memories")).toBe(1);
    db.close();
  });
});

describe("wizardingcode-mem ui: compact during a run", () => {
  test("is refused with 409 while a history run holds the lease", async () => {
    const s = await start();
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    claimLease(db, "history.lease", "run-1", NOW, 120_000);
    db.close();
    const r = await api(s, "/api/compact", { method: "POST", body: "{}" });
    expect(r.status).toBe(409);
    const check = openDb({ dataDir, busyTimeoutMs: 2000 });
    expect(count(check, "turns")).toBe(1);
    check.close();
  });
});

describe("wizardingcode-mem ui: storage", () => {
  test("says where the data and the store are, and how big the database is", async () => {
    const s = await start();
    const body = (await (await api(s, "/api/storage")).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ dataDir, storeDir: dataDir, busy: false });
    expect(body.dbBytes as number).toBeGreaterThan(0);
  });

  test("inspects a target, then moves the store there and carries on from it", async () => {
    const s = await start();
    const target = join(base, "external", "mem");
    const report = await (
      await api(s, "/api/storage/inspect", {
        method: "POST",
        body: JSON.stringify({ path: target }),
      })
    ).json();
    expect(report).toMatchObject({ exists: false, hasDb: false, writable: true, network: false });

    const unconfirmed = await api(s, "/api/storage/move", {
      method: "POST",
      body: JSON.stringify({ path: target }),
    });
    expect(unconfirmed.status).toBe(400);

    const moved = await api(s, "/api/storage/move", {
      method: "POST",
      body: JSON.stringify({ path: target, confirm: true }),
    });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ ok: true, to: target });

    const overview = (await (await api(s, "/api/overview")).json()) as {
      storeDir: string;
      projects: unknown[];
    };
    expect(overview.storeDir).toBe(target);
    expect(overview.projects).toHaveLength(1);
    expect(readFileSync(join(dataDir, "env"), "utf8")).toContain(
      `WIZARDINGCODE_MEM_STORE_DIR=${target}`,
    );
    // The viewer keeps working on the new store.
    const memories = await api(s, "/api/memories?project=1");
    expect(memories.status).toBe(200);
  });
});

describe("wizardingcode-mem ui: backups", () => {
  test("without a target there is nothing to list, and nothing to run", async () => {
    const s = await start();
    expect(await (await api(s, "/api/backups")).json()).toEqual({
      target: null,
      last: null,
      due: false,
      entries: [],
    });
    expect((await api(s, "/api/backups", { method: "POST", body: "{}" })).status).toBe(400);
  });

  test("with a folder as target: back up now, list, restore", async () => {
    const folder = join(base, "nas");
    const s = await start();
    await api(s, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({ WIZARDINGCODE_MEM_BACKUP_TO: folder }),
    });
    const made = await api(s, "/api/backups", { method: "POST", body: "{}" });
    expect(made.status).toBe(200);
    const { name } = (await made.json()) as { name: string };
    expect(name).toMatch(/^wizardingcode-mem-.*\.db\.gz$/);

    const listed = (await (await api(s, "/api/backups")).json()) as {
      target: { kind: string; label: string };
      last: { name: string };
      due: boolean;
      entries: { name: string; bytes: number }[];
    };
    expect(listed.target).toEqual({ kind: "folder", label: folder });
    expect(listed.last.name).toBe(name);
    expect(listed.due).toBe(false);
    expect(listed.entries.map((e) => e.name)).toEqual([name]);

    // Lose a memory, then bring the copy back.
    const gone = await api(s, "/api/memories/1", {
      method: "POST",
      body: JSON.stringify({ status: "archived" }),
    });
    expect(gone.status).toBe(200);
    expect(
      (await api(s, "/api/backups/restore", { method: "POST", body: JSON.stringify({ name }) }))
        .status,
    ).toBe(400);
    const restored = await api(s, "/api/backups/restore", {
      method: "POST",
      body: JSON.stringify({ name, confirm: true }),
    });
    expect(restored.status).toBe(200);
    const memory = (await (await api(s, "/api/memories/1")).json()) as { status: string };
    expect(memory.status).toBe("active");
  });
});
