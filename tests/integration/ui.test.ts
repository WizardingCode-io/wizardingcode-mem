import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { MemoryKind } from "../../src/core/types.ts";
import { openHistoryDb } from "../../src/history/db.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { setMeta } from "../../src/store/meta.ts";
import { startUi, type UiServer } from "../../src/ui/server.ts";

const NOW = Date.UTC(2026, 9, 5, 12);
const DAY = 86_400_000;

let base: string;
let dataDir: string;
let project: string;
let projectId: number;
let server: UiServer | undefined;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-ui-")));
  dataDir = join(base, "data");
  project = join(base, "shop");
  mkdirSync(project);
  const db = openDb({ dataDir, busyTimeoutMs: 2000 });
  projectId = resolveProject(db, project, NOW).id;
  seed(db, "The cart total is rounded once, at the end.", "Per-line rounding caused drift.", {
    kind: "decision",
    importance: 4,
    files: ["src/cart/total.ts"],
  });
  seed(db, "Never deploy on Fridays.", "Support is thin at the weekend.", {
    kind: "convention",
    importance: 4,
  });
  seed(db, "Ran the formatter on three files.", "", {
    kind: "change",
    importance: 1,
    status: "archived",
  });
  mkdirSync(join(base, "other"));
  const other = resolveProject(db, join(base, "other"), NOW).id;
  seed(db, "Elsewhere: the API key rotates monthly.", "", { kind: "gotcha", projectId: other });
  db.close();
});
afterEach(async () => {
  await server?.stop();
  server = undefined;
  rmSync(base, { recursive: true, force: true });
});

function seed(
  db: Db,
  title: string,
  body: string,
  extra: {
    kind?: MemoryKind;
    importance?: number;
    projectId?: number;
    files?: string[];
    status?: string;
  } = {},
): number {
  const id = insertMemory(db, {
    projectId: extra.projectId ?? projectId,
    kind: extra.kind ?? "decision",
    title,
    body: body as Redacted,
    terms: (extra.files ?? []).join(" "),
    importance: extra.importance ?? 2,
    branch: null,
    commit: null,
    origin: "manual",
    judge: "typesafe",
    judgeVersion: "1",
    sourceTurnId: null,
    files: (extra.files ?? []).map((path) => ({ path, role: "changed" as const })),
    now: NOW - 2 * DAY,
  });
  if (extra.status) db.run("UPDATE memories SET status = ? WHERE id = ?", [extra.status, id]);
  return id;
}

async function start(
  options: {
    idleMs?: number;
    onIdle?: () => void;
    env?: Record<string, string | undefined>;
    spawn?: (...args: string[]) => void;
  } = {},
): Promise<UiServer> {
  server = await startUi({ dataDir, port: 0, open: false, now: () => NOW, ...options });
  return server;
}
const api = (s: UiServer, path: string, init: RequestInit = {}) =>
  fetch(`${s.origin}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${s.token}`, ...(init.headers ?? {}) },
  });

describe("wizardingcode-mem ui: the page", () => {
  test("listens on the loopback only, at a URL that carries a token, and serves the page there", async () => {
    const s = await start();
    expect(s.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(s.url).toBe(`${s.origin}/?token=${s.token}`);
    const page = await fetch(s.url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("<title>wizardingcode-mem</title>");
    expect(html).toContain('<div id="app">');
    // Built into one file: no script or stylesheet fetched from anywhere.
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(html).toContain("--primary:");
  });

  test("the page carries a Content-Security-Policy that keeps every load on this origin", async () => {
    const s = await start();
    const page = await fetch(s.url);
    const csp = page.headers.get("content-security-policy") ?? "";
    const directives = new Map(
      csp
        .split(";")
        .map((part) => part.trim().split(/\s+/))
        .filter((words) => words[0] !== "")
        .map((words) => [words[0] as string, words.slice(1)]),
    );
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("img-src")).toEqual(["'self'", "data:"]);
    expect(directives.get("connect-src")).toEqual(["'self'"]);
    expect(directives.get("font-src")).toEqual(["'self'", "data:"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    // The inline scripts run by their hash; nothing else may.
    const scriptSrc = directives.get("script-src") ?? [];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    const html = await page.text();
    const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
    expect(inline.length).toBeGreaterThan(0);
    for (const body of inline) {
      const hash = new Bun.CryptoHasher("sha256").update(body).digest("base64");
      expect(scriptSrc).toContain(`'sha256-${hash}'`);
    }
  });

  test("without the token, nothing is served", async () => {
    const s = await start();
    expect((await fetch(`${s.origin}/`)).status).toBe(401);
    expect((await fetch(`${s.origin}/?token=wrong`)).status).toBe(401);
    expect((await fetch(`${s.origin}/api/overview`)).status).toBe(401);
  });

  test("a request from another origin or host is refused, token or not", async () => {
    const s = await start();
    const r = await api(s, "/api/overview", { headers: { Host: "evil.example" } });
    expect(r.status).toBe(403);
  });

  test("the brand fonts are served from the binary, not from the network, and need no token", async () => {
    const s = await start();
    for (const font of [
      "unbounded-variable.woff2",
      "instrument-sans-variable.woff2",
      "jetbrains-mono-variable.woff2",
    ]) {
      const r = await fetch(`${s.origin}/assets/${font}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("font/woff2");
      expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    }
    const html = await (await fetch(s.url)).text();
    expect(html).not.toMatch(/https?:\/\/fonts\./);
  });
});

describe("wizardingcode-mem ui: the API", () => {
  test("overview lists projects with their counts, and where the data lives", async () => {
    const s = await start();
    const overview = (await (await api(s, "/api/overview")).json()) as {
      dataDir: string;
      version: string;
      projects: {
        id: number;
        name: string;
        active: number;
        archived: number;
        superseded: number;
      }[];
    };
    expect(overview.dataDir).toBe(dataDir);
    expect(overview.projects.map((p) => [p.name, p.active, p.archived, p.superseded])).toEqual([
      ["shop", 2, 1, 0],
      ["other", 1, 0, 0],
    ]);
  });

  test("memories of a project, newest first, with a total; archived ones on request", async () => {
    const s = await start();
    const active = (await (await api(s, `/api/memories?project=${projectId}`)).json()) as {
      total: number;
      items: { id: number; title: string; kind: string; status: string; files: string[] }[];
    };
    expect(active.total).toBe(2);
    expect(active.items.map((m) => m.title)).toEqual([
      "Never deploy on Fridays.",
      "The cart total is rounded once, at the end.",
    ]);
    expect(active.items[1]?.files).toEqual(["src/cart/total.ts"]);
    const archived = (await (
      await api(s, `/api/memories?project=${projectId}&status=archived`)
    ).json()) as {
      items: { title: string }[];
    };
    expect(archived.items.map((m) => m.title)).toEqual(["Ran the formatter on three files."]);
  });

  test("searches with the same engine as the agent, narrowed by kind", async () => {
    const s = await start();
    const found = (await (
      await api(s, `/api/memories?project=${projectId}&q=rounding`)
    ).json()) as {
      items: { title: string }[];
    };
    expect(found.items.map((m) => m.title)).toEqual([
      "The cart total is rounded once, at the end.",
    ]);
    const none = (await (
      await api(s, `/api/memories?project=${projectId}&q=rounding&kind=convention`)
    ).json()) as {
      items: unknown[];
    };
    expect(none.items).toEqual([]);
  });

  test("narrows to an importance floor, and to recent turns of a project", async () => {
    const s = await start();
    const important = (await (
      await api(s, `/api/memories?project=${projectId}&minImportance=4`)
    ).json()) as { total: number; items: { importance: number }[] };
    expect(important.total).toBe(2);
    expect(important.items.every((m) => m.importance >= 4)).toBe(true);
    const critical = (await (
      await api(s, `/api/memories?project=${projectId}&minImportance=5`)
    ).json()) as {
      total: number;
      items: unknown[];
    };
    expect(critical).toEqual({ total: 0, items: [] });
    const all = (await (
      await api(s, `/api/memories?project=${projectId}&minImportance=1`)
    ).json()) as {
      total: number;
    };
    expect(all.total).toBe(2);
    const turns = (await (await api(s, `/api/turns?project=${projectId}`)).json()) as unknown[];
    expect(turns).toEqual([]);
  });

  test("one memory in full, with its files; another project's is not found", async () => {
    const s = await start();
    const one = (await (await api(s, "/api/memories/1")).json()) as {
      id: number;
      title: string;
      body: string;
      files: string[];
      fileRoles: { path: string; role: string }[];
      judge: string;
    };
    expect(one).toMatchObject({
      id: 1,
      title: "The cart total is rounded once, at the end.",
      body: "Per-line rounding caused drift.",
      files: ["src/cart/total.ts"],
      fileRoles: [{ path: "src/cart/total.ts", role: "changed" }],
      judge: "typesafe",
    });
    expect((await api(s, "/api/memories/999")).status).toBe(404);
  });

  test("archives and restores a memory; nothing else can be done to it", async () => {
    const s = await start();
    const archive = await api(s, "/api/memories/1", {
      method: "POST",
      body: JSON.stringify({ status: "archived" }),
    });
    expect(archive.status).toBe(200);
    expect(((await (await api(s, "/api/memories/1")).json()) as { status: string }).status).toBe(
      "archived",
    );
    const restore = await api(s, "/api/memories/1", {
      method: "POST",
      body: JSON.stringify({ status: "active" }),
    });
    expect(restore.status).toBe(200);
    expect(((await (await api(s, "/api/memories/1")).json()) as { status: string }).status).toBe(
      "active",
    );
    expect(
      (
        await api(s, "/api/memories/1", {
          method: "POST",
          body: JSON.stringify({ status: "superseded" }),
        })
      ).status,
    ).toBe(400);
    expect((await api(s, "/api/memories/1", { method: "POST", body: "nope" })).status).toBe(400);
  });

  test("a memory can be edited: title, body, kind and importance; the judge becomes the user", async () => {
    const s = await start();
    const edited = await api(s, "/api/memories/1", {
      method: "PATCH",
      body: JSON.stringify({
        title: "Totals are rounded once.",
        body: "At the end.",
        kind: "convention",
        importance: 5,
      }),
    });
    expect(edited.status).toBe(200);
    expect((await edited.json()) as object).toMatchObject({
      id: 1,
      title: "Totals are rounded once.",
      body: "At the end.",
      kind: "convention",
      importance: 5,
      judge: "user",
    });
    // Searchable under the new words, no longer under the old.
    const found = (await (await api(s, `/api/memories?project=${projectId}&q=rounded`)).json()) as {
      total: number;
    };
    expect(found.total).toBe(1);
    const gone = (await (await api(s, `/api/memories?project=${projectId}&q=drift`)).json()) as {
      total: number;
    };
    expect(gone.total).toBe(0);
    // Only those fields, and only valid values.
    for (const bad of [
      { kind: "rumour" },
      { importance: 9 },
      { title: "" },
      { status: "archived" },
    ]) {
      expect(
        (await api(s, "/api/memories/1", { method: "PATCH", body: JSON.stringify(bad) })).status,
      ).toBe(400);
    }
    expect(
      (await api(s, "/api/memories/999", { method: "PATCH", body: JSON.stringify({ title: "x" }) }))
        .status,
    ).toBe(404);
  });

  test("a memory's source carries enough of its prompt to show what it was, past a long preamble", async () => {
    const s = await start();
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    const sessionId = db
      .query<{ id: number }, [number]>(
        "INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at) VALUES ('claude-code', 'z', ?, '/p', 1, 1) RETURNING id",
      )
      .get(projectId)?.id as number;
    const prompt = `<agent-message from="a1">\n[Subagent hand-back] ${"preamble ".repeat(60)}\n\nThe stock is fixed.\n</agent-message>`;
    const turnId = db
      .query<{ id: number }, [number, number, string]>(
        "INSERT INTO turns (session_id, project_id, seq, state, prompt, started_at) VALUES (?, ?, 1, 'done', ?, 5) RETURNING id",
      )
      .get(sessionId, projectId, prompt)?.id as number;
    db.run("UPDATE memories SET source_turn_id = ? WHERE id = 1", [turnId]);
    db.close();
    const memory = (await (await api(s, "/api/memories/1")).json()) as {
      source: { prompt: string };
    };
    expect(memory.source.prompt).toContain("The stock is fixed.");
  });

  test("the turns list carries enough of a prompt to name it: a task's summary comes after long ids", async () => {
    const s = await start();
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    const sessionId = db
      .query<{ id: number }, [number]>(
        "INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at) VALUES ('claude-code', 'y', ?, '/p', 1, 1) RETURNING id",
      )
      .get(projectId)?.id as number;
    const prompt = `<task-notification>\n<task-id>ab2bf5ed009ca26c3</task-id>\n<tool-use-id>toolu_0131KH9Yici5qKkHMDvtys9u</tool-use-id>\n<output-file>/private/tmp/${"x".repeat(160)}/tasks/ab2bf5ed009ca26c3.output</output-file>\n<status>completed</status>\n<summary>Background command "Run the suite" completed (exit code 0)</summary>\n</task-notification>`;
    db.run(
      "INSERT INTO turns (session_id, project_id, seq, state, prompt, started_at) VALUES (?, ?, 1, 'skipped', ?, 5)",
      [sessionId, projectId, prompt],
    );
    db.close();
    const turns = (await (await api(s, `/api/turns?project=${projectId}`)).json()) as {
      prompt: string;
    }[];
    expect(turns[0]?.prompt).toContain("<summary>Background command");
  });

  test("a turn in full, with the memories that came from it; the memory points back at its turn", async () => {
    const s = await start();
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    const sessionId = db
      .query<{ id: number }, [number]>(
        "INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at) VALUES ('codex', 'x', ?, '/p', 1, 1) RETURNING id",
      )
      .get(projectId)?.id as number;
    const turnId = db
      .query<{ id: number }, [number, number]>(
        `INSERT INTO turns (session_id, project_id, seq, state, prompt, final_text, files_changed, commands, errors, started_at, ended_at)
         VALUES (?, ?, 1, 'done', 'why does the total drift?', 'Rounded once now.', '["src/cart/total.ts"]', '["bun test"]', '[]', 10, 20) RETURNING id`,
      )
      .get(sessionId, projectId)?.id as number;
    db.run("UPDATE memories SET source_turn_id = ? WHERE id = 1", [turnId]);
    db.close();

    const turns = (await (await api(s, `/api/turns?project=${projectId}`)).json()) as {
      id: number;
      memoryIds: number[];
    }[];
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ id: turnId, memoryIds: [1] });
    const turn = (await (await api(s, `/api/turns/${turnId}`)).json()) as object;
    expect(turn).toMatchObject({
      id: turnId,
      agent: "codex",
      state: "done",
      prompt: "why does the total drift?",
      finalText: "Rounded once now.",
      filesChanged: ["src/cart/total.ts"],
      commands: ["bun test"],
      memories: [{ id: 1, title: "The cart total is rounded once, at the end.", kind: "decision" }],
    });
    expect((await api(s, "/api/turns/999")).status).toBe(404);
    const memory = (await (await api(s, "/api/memories/1")).json()) as {
      source: { turnId: number };
    };
    expect(memory.source.turnId).toBe(turnId);
  });

  test("a project's numbers: by kind, status, importance and judge, by week, and the hooks' speed", async () => {
    const s = await start();
    const stats = (await (await api(s, `/api/projects/${projectId}/stats`)).json()) as {
      byKind: Record<string, number>;
      byStatus: Record<string, number>;
      byImportance: Record<string, number>;
      byJudge: Record<string, number>;
      turns: Record<string, number>;
      weekly: { weekStart: number; memories: number; turns: number }[];
      hooks: unknown[];
    };
    expect(stats.byKind).toMatchObject({
      decision: 1,
      convention: 1,
      change: 0,
      fix: 0,
      gotcha: 0,
      discovery: 0,
    });
    expect(stats.byStatus).toEqual({ active: 2, archived: 1, superseded: 0 });
    expect(stats.byImportance).toMatchObject({ "4": 2, "1": 0 });
    expect(stats.byJudge).toEqual({ typesafe: 2 });
    expect(stats.weekly).toHaveLength(8);
    expect(stats.weekly.reduce((n, w) => n + w.memories, 0)).toBe(2);
    expect((await api(s, "/api/projects/999/stats")).status).toBe(404);
  });

  test("a search across every project, for the command palette", async () => {
    const s = await start();
    const hits = (await (await api(s, "/api/search?q=rotates")).json()) as {
      projectName: string;
      title: string;
    }[];
    expect(hits).toEqual([
      expect.objectContaining({
        projectName: "other",
        title: "Elsewhere: the API key rotates monthly.",
      }),
    ]);
    const many = (await (await api(s, "/api/search?q=the")).json()) as unknown[];
    expect(many.length).toBeGreaterThanOrEqual(2);
    expect(await (await api(s, "/api/search?q=")).json()).toEqual([]);
  });

  test("the status report of a project, as the CLI shows it", async () => {
    const s = await start();
    const status = (await (await api(s, `/api/status?project=${projectId}`)).json()) as {
      memories: { active: number; archived: number };
    };
    expect(status.memories).toMatchObject({ active: 2, archived: 1 });
  });

  test("the history status, behind the token", async () => {
    const s = await start({
      env: { CLAUDE_CONFIG_DIR: join(dataDir, "no-claude"), CODEX_HOME: join(dataDir, "no-codex") },
    });
    expect((await fetch(`${s.origin}/api/history`)).status).toBe(401);
    const history = (await (await api(s, "/api/history")).json()) as {
      run: { state: string };
      index: { exists: boolean };
      transcripts: { claudeCode: number };
    };
    expect(history.run.state).toBe("never");
    expect(history.index.exists).toBe(false);
    expect(history.transcripts.claudeCode).toBe(0);
  });
});

describe("wizardingcode-mem ui: history runs", () => {
  const post = (s: UiServer, path: string, body?: unknown) =>
    api(s, path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  const histEnv = () => ({
    CLAUDE_CONFIG_DIR: join(dataDir, "no-claude"),
    CODEX_HOME: join(dataDir, "no-codex"),
  });
  const holdLease = (until: number) => {
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    setMeta(db, "history.lease", JSON.stringify({ owner: `${process.pid}-x`, until }));
    setMeta(db, "history.run.state", "running");
    db.close();
  };
  const startSpying = async () => {
    const spawned: string[][] = [];
    const s = await start({
      env: histEnv(),
      spawn: (...args: string[]) => void spawned.push(args),
    });
    return { s, spawned };
  };

  test("every route needs the token", async () => {
    const s = await start({ env: histEnv() });
    for (const path of [
      "import",
      "index",
      "forget",
      "replace-imports",
      "restore-imports",
      "offer/dismiss",
    ]) {
      expect((await fetch(`${s.origin}/api/history/${path}`, { method: "POST" })).status).toBe(401);
    }
    expect((await fetch(`${s.origin}/api/history/progress`)).status).toBe(401);
  });

  test("import and index start a detached run, unless one is going", async () => {
    const { s, spawned } = await startSpying();
    expect(await (await post(s, "/api/history/import")).json()).toEqual({ started: true });
    expect(await (await post(s, "/api/history/index")).json()).toEqual({ started: true });
    expect(spawned).toEqual([
      ["history", "import"],
      ["history", "index"],
    ]);
    holdLease(NOW + 60_000);
    expect(await (await post(s, "/api/history/import")).json()).toEqual({ started: false });
    expect(await (await post(s, "/api/history/index")).json()).toEqual({ started: false });
    expect(spawned.length).toBe(2);
  });

  test("progress is light: only the run and the queue", async () => {
    const { s } = await startSpying();
    const progress = (await (await api(s, "/api/history/progress")).json()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(progress).sort()).toEqual(["queue", "run"]);
    expect((progress.run as { state: string }).state).toBe("never");
    holdLease(NOW + 60_000);
    const running = (await (await api(s, "/api/history/progress")).json()) as {
      run: { state: string };
    };
    expect(running.run.state).toBe("running");
  });

  test("forget deletes the index, and is refused while a run is going", async () => {
    const { s } = await startSpying();
    const index = join(dataDir, "history.db");
    writeFileSync(index, "x");
    holdLease(NOW + 60_000);
    expect((await post(s, "/api/history/forget")).status).toBe(409);
    expect(existsSync(index)).toBe(true);
    holdLease(NOW - 1000);
    expect(await (await post(s, "/api/history/forget")).json()).toEqual({ forgotten: true });
    expect(existsSync(index)).toBe(false);
  });

  test("replace-imports needs the count the user saw; a stale one is a 409 with the new count", async () => {
    const { s } = await startSpying();
    expect((await post(s, "/api/history/replace-imports", {})).status).toBe(400);
    const stale = await post(s, "/api/history/replace-imports", { expected: 7 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ count: 0 });
    const ok = await post(s, "/api/history/replace-imports", { expected: 0 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ archived: 0, projects: 0 });
  });

  test("restore-imports and the offer dismissal", async () => {
    const { s } = await startSpying();
    expect(await (await post(s, "/api/history/restore-imports")).json()).toEqual({ restored: 0 });
    expect(await (await post(s, "/api/history/offer/dismiss")).json()).toEqual({ dismissed: true });
    const status = (await (await api(s, "/api/history")).json()) as {
      offer: { dismissed: boolean };
    };
    expect(status.offer.dismissed).toBe(true);
  });
});

describe("wizardingcode-mem ui: searching past conversations", () => {
  type Hit = {
    id: number;
    project: string;
    agent: string;
    sessionId: string;
    cwd: string;
    startedAt: number;
    endedAt: number;
    prompt: string;
    answer: string | null;
  };
  type Found = { indexed: boolean; hits?: Hit[]; error?: string };
  const histEnv = () => ({
    CLAUDE_CONFIG_DIR: join(dataDir, "no-claude"),
    CODEX_HOME: join(dataDir, "no-codex"),
  });
  const seedHistory = () => {
    const hdb = openHistoryDb(dataDir, { create: true });
    if (hdb === null) throw new Error("no history db");
    hdb.run(
      "INSERT INTO files (path, agent, size, mtime, indexed_at) VALUES ('/t.jsonl', 'claude-code', 1, 1, 1)",
    );
    const turn = (
      n: number,
      pid: number,
      name: string,
      prompt: string,
      answer: string | null,
      at: number,
    ) =>
      hdb.run(
        `INSERT INTO turns (path, agent, session_id, turn_id, project_id, project_name, cwd, started_at, ended_at, prompt, final_text)
         VALUES ('/t.jsonl', ?, 's1', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n === 3 ? "codex" : "claude-code",
          `t${n}`,
          pid,
          name,
          `/w/${name}`,
          at - 60_000,
          at,
          prompt,
          answer,
        ],
      );
    turn(
      1,
      projectId,
      "shop",
      "Why is the cart total drifting?",
      "Per-line rounding; round once at the end.",
      NOW - 3 * DAY,
    );
    turn(2, projectId, "shop", "Add a Friday deploy freeze", null, NOW - DAY);
    turn(3, 999, "blog", "The cart widget on the blog", "Moved it to the sidebar.", NOW - 2 * DAY);
    hdb.close();
  };
  const search = async (s: UiServer, query: string) =>
    (await (await api(s, `/api/history/search${query}`)).json()) as Found;

  test("needs the token", async () => {
    const s = await start({ env: histEnv() });
    expect((await fetch(`${s.origin}/api/history/search?q=cart`)).status).toBe(401);
  });

  test("without an index it says so, and creates nothing", async () => {
    const s = await start({ env: histEnv() });
    expect(await search(s, "?q=cart")).toEqual({ indexed: false });
    expect(existsSync(join(dataDir, "history.db"))).toBe(false);
  });

  test("finds turns by their words, across projects or in one", async () => {
    seedHistory();
    const s = await start({ env: histEnv() });
    const all = await search(s, "?q=cart");
    expect(all.indexed).toBe(true);
    expect(all.hits?.map((h) => h.project).sort()).toEqual(["blog", "shop"]);
    const shop = await search(s, `?q=cart&project=${projectId}`);
    expect(shop.hits).toHaveLength(1);
    expect(shop.hits?.[0]).toMatchObject({
      project: "shop",
      agent: "claude-code",
      sessionId: "s1",
      cwd: "/w/shop",
      startedAt: NOW - 3 * DAY - 60_000,
      endedAt: NOW - 3 * DAY,
      prompt: "Why is the cart total drifting?",
      answer: "Per-line rounding; round once at the end.",
    });
    expect(typeof shop.hits?.[0]?.id).toBe("number");
    expect((await search(s, "?q=cart&limit=1")).hits).toHaveLength(1);
    expect((await search(s, "?q=nothing-like-this")).hits).toEqual([]);
  });

  test("without words, the latest turns, newest first", async () => {
    seedHistory();
    const s = await start({ env: histEnv() });
    const latest = await search(s, "");
    expect(latest.hits?.map((h) => h.prompt)).toEqual([
      "Add a Friday deploy freeze",
      "The cart widget on the blog",
      "Why is the cart total drifting?",
    ]);
    expect((await search(s, `?project=${projectId}&limit=1`)).hits?.map((h) => h.prompt)).toEqual([
      "Add a Friday deploy freeze",
    ]);
  });

  test("an index that cannot be read is reported, not a failure", async () => {
    writeFileSync(join(dataDir, "history.db"), "not a database at all, just text".repeat(40));
    const s = await start({ env: histEnv() });
    const res = await api(s, "/api/history/search?q=cart");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Found;
    expect(body.indexed).toBe(true);
    expect(body.hits).toEqual([]);
    expect(body.error).toContain("could not be read");
  });
});

describe("wizardingcode-mem ui: lifecycle", () => {
  test("stops itself after a stretch without requests", async () => {
    let idle = 0;
    const s = await start({ idleMs: 50, onIdle: () => idle++ });
    await api(s, "/api/overview");
    await Bun.sleep(150);
    expect(idle).toBe(1);
  });
});
