import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { MemoryKind } from "../../src/core/types.ts";
import { loadModel, modelPath } from "../../src/embed/model.ts";
import { writeMemoryVector } from "../../src/embed/vectors.ts";
import { openHistoryDb } from "../../src/history/db.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { linkProjects, suggestLink, visibleProjects } from "../../src/store/links.ts";
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

  test("with the semantic model, an edit writes the memory's new vector", async () => {
    mkdirSync(join(dataDir, "models"), { recursive: true });
    copyFileSync(join(import.meta.dir, "../fixtures/embed/subset.wcpack"), modelPath(dataDir));
    const s = await start({ env: {} });
    const edited = await api(s, "/api/memories/1", {
      method: "PATCH",
      body: JSON.stringify({ title: "Never mock the database in these tests." }),
    });
    expect(edited.status).toBe(200);
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    expect(db.query("SELECT memory_id, model FROM memory_vectors").all()).toEqual([
      { memory_id: 1, model: loadModel({ dataDir, env: {} })?.id },
    ]);
    db.close();
  });

  test("with the semantic model, the list and the palette find by meaning too", async () => {
    mkdirSync(join(dataDir, "models"), { recursive: true });
    copyFileSync(join(import.meta.dir, "../fixtures/embed/subset.wcpack"), modelPath(dataDir));
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    const id = seed(
      db,
      "A hook must never exit with code 2.",
      "Claude Code treats exit code 2 as a request to block the user's action.",
      { kind: "gotcha" },
    );
    writeMemoryVector(
      db,
      loadModel({ dataDir, env: {} }),
      id,
      "A hook must never exit with code 2.",
      "Claude Code treats exit code 2 as a request to block the user's action.",
    );
    db.close();
    // Shares no word with the memory.
    const q = encodeURIComponent(
      "o agente bloqueia a ação do utilizador quando o nosso script termina mal",
    );
    const without = await start({ env: { WIZARDINGCODE_MEM_SEMANTIC: "off" } });
    const none = (await (
      await api(without, `/api/memories?project=${projectId}&q=${q}`)
    ).json()) as {
      items: { id: number }[];
    };
    expect(none.items.map((m) => m.id)).not.toContain(id);
    await without.stop();
    const s = await start({ env: {} });
    const list = (await (await api(s, `/api/memories?project=${projectId}&q=${q}`)).json()) as {
      items: { id: number }[];
    };
    expect(list.items.map((m) => m.id)).toContain(id);
    const hits = (await (await api(s, `/api/search?q=${q}`)).json()) as { id: number }[];
    expect(hits.map((hit) => hit.id)).toContain(id);
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

  test("progress is light: only the run, the last import and the queue", async () => {
    const { s } = await startSpying();
    const progress = (await (await api(s, "/api/history/progress")).json()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(progress).sort()).toEqual(["import", "queue", "run"]);
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

  test("replace then restore, with a real count; both refused while a run is going", async () => {
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    const session = db
      .query<{ id: number }, [number, number, number]>(
        `INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at)
         VALUES ('claude-code', 'h1', ?, '/shop', ?, ?) RETURNING id`,
      )
      .get(projectId, NOW, NOW)?.id as number;
    db.run(
      `INSERT INTO turns (session_id, project_id, seq, state, origin, prompt, started_at, ended_at)
       VALUES (?, ?, 1, 'done', 'history', 'q', ?, ?)`,
      [session, projectId, NOW - 60 * DAY, NOW - 10 * DAY],
    );
    // seed() dates memories two days ago: move them inside the covered span, as imports.
    db.run(
      "UPDATE memories SET origin = 'imported', created_at = ? WHERE project_id = ? AND status = 'active'",
      [NOW - 30 * DAY, projectId],
    );
    db.close();
    const { s } = await startSpying();
    const preview = (await (await api(s, "/api/history")).json()) as {
      replace: { wouldArchive: number };
    };
    expect(preview.replace.wouldArchive).toBe(2);

    holdLease(NOW + 60_000);
    expect((await post(s, "/api/history/replace-imports", { expected: 2 })).status).toBe(409);
    expect((await post(s, "/api/history/restore-imports")).status).toBe(409);
    holdLease(NOW - 1000);

    const replaced = await post(s, "/api/history/replace-imports", { expected: 2 });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toEqual({ projects: 1, archived: 2, spared: 0 });
    expect(await (await post(s, "/api/history/replace-imports", { expected: 2 })).json()).toEqual({
      count: 0,
    });
    expect(await (await post(s, "/api/history/restore-imports")).json()).toEqual({ restored: 2 });
    const after = (await (await api(s, "/api/history")).json()) as {
      replace: { wouldArchive: number; replaced: number };
    };
    expect(after.replace).toMatchObject({ wouldArchive: 2, replaced: 0 });
  });

  test("the offer is its own light route: shown with the count, gone once dismissed", async () => {
    const claude = join(dataDir, "claude-home");
    mkdirSync(join(claude, "projects", "-shop"), { recursive: true });
    writeFileSync(join(claude, "projects", "-shop", "s1.jsonl"), "{}\n");
    const s = await start({
      env: { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: join(dataDir, "no-codex") },
    });
    expect((await fetch(`${s.origin}/api/history/offer`)).status).toBe(401);
    expect(await (await api(s, "/api/history/offer")).json()).toEqual({
      show: true,
      sessions: 1,
      transcripts: { claudeCode: 1, codex: 0 },
    });
    await post(s, "/api/history/offer/dismiss");
    expect(await (await api(s, "/api/history/offer")).json()).toMatchObject({ show: false });
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

describe("wizardingcode-mem ui: semantic search", () => {
  const post = (s: UiServer, path: string) => api(s, path, { method: "POST", body: "{}" });
  const placeModel = () => {
    mkdirSync(join(dataDir, "models"), { recursive: true });
    copyFileSync(join(import.meta.dir, "../fixtures/embed/subset.wcpack"), modelPath(dataDir));
  };
  const hold = (key: string, until = NOW + 60_000) => {
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    setMeta(db, key, JSON.stringify({ owner: `${process.pid}-x`, until }));
    db.close();
  };
  const startSpying = async (env: Record<string, string | undefined> = {}) => {
    const spawned: string[][] = [];
    const s = await start({ env, spawn: (...args: string[]) => void spawned.push(args) });
    return { s, spawned };
  };
  type SemanticState = {
    model: {
      present: boolean;
      bytes: number;
      expectedBytes: number;
      enabled: boolean;
      source: string;
      problem: string | null;
    };
    download: { running: boolean; done: number; total: number; error: string | null };
    backfill: { running: boolean };
    memories: { active: number; withVectors: number };
  };
  const state = async (s: UiServer) =>
    (await (await api(s, "/api/semantic")).json()) as SemanticState;

  test("every route needs the token", async () => {
    const s = await start({ env: {} });
    expect((await fetch(`${s.origin}/api/semantic`)).status).toBe(401);
    for (const path of ["download", "on", "off", "delete"]) {
      expect((await fetch(`${s.origin}/api/semantic/${path}`, { method: "POST" })).status).toBe(
        401,
      );
    }
  });

  test("the state without a model: not downloaded, the size to expect, no vectors", async () => {
    const { s } = await startSpying();
    const got = await state(s);
    expect(got.model).toMatchObject({ present: false, bytes: 0, enabled: true, problem: null });
    expect(got.model.expectedBytes).toBeGreaterThan(100_000_000);
    expect(got.download).toEqual({ running: false, done: 0, total: 0, error: null });
    expect(got.backfill).toEqual({ running: false });
    // Two active in the project, one in the other; the archived one does not count.
    expect(got.memories).toEqual({ active: 3, withVectors: 0 });
  });

  test("with the model: present, and the memories that have a vector of it", async () => {
    placeModel();
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    const model = loadModel({ dataDir, env: {} });
    writeMemoryVector(db, model, 1, "The cart total is rounded once, at the end.", "x");
    // The archived memory's vector is not counted.
    writeMemoryVector(db, model, 3, "Ran the formatter on three files.", "");
    db.close();
    const { s } = await startSpying();
    const got = await state(s);
    expect(got.model.present).toBe(true);
    expect(got.model.bytes).toBeGreaterThan(0);
    expect(got.memories).toEqual({ active: 3, withVectors: 1 });
  });

  test("download starts the download and then the backfill, detached; once at a time", async () => {
    const { s, spawned } = await startSpying();
    expect(await (await post(s, "/api/semantic/download")).json()).toEqual({ started: true });
    expect(spawned).toEqual([["embed", "download", "--backfill"]]);
    hold("embed.download.lease");
    expect(await (await post(s, "/api/semantic/download")).json()).toEqual({ started: false });
    hold("embed.download.lease", NOW - 1000);
    hold("embed.lease");
    expect(await (await post(s, "/api/semantic/download")).json()).toEqual({ started: false });
    expect(spawned).toHaveLength(1);
  });

  test("backfill starts alone when the model is there, once at a time", async () => {
    const { s, spawned } = await startSpying();
    expect((await post(s, "/api/semantic/backfill")).status).toBe(409);
    placeModel();
    expect(await (await post(s, "/api/semantic/backfill")).json()).toEqual({ started: true });
    hold("embed.lease");
    expect(await (await post(s, "/api/semantic/backfill")).json()).toEqual({ started: false });
    expect(spawned).toEqual([["embed", "backfill"]]);
    expect((await fetch(`${s.origin}/api/semantic/backfill`, { method: "POST" })).status).toBe(401);
  });

  test("the state carries the download's progress and its last error", async () => {
    const { s } = await startSpying();
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    setMeta(db, "embed.download.done", "1000");
    setMeta(db, "embed.download.total", "4000");
    setMeta(db, "embed.download.error", "download failed: offline");
    db.close();
    hold("embed.download.lease");
    hold("embed.lease");
    const got = await state(s);
    expect(got.download).toEqual({
      running: true,
      done: 1000,
      total: 4000,
      error: "download failed: offline",
    });
    expect(got.backfill).toEqual({ running: true });
  });

  test("off and on save the setting; the environment still wins", async () => {
    const { s } = await startSpying();
    const off = (await (await post(s, "/api/semantic/off")).json()) as SemanticState;
    expect(off.model).toMatchObject({ enabled: false, source: "file" });
    expect((await state(s)).model.enabled).toBe(false);
    const on = (await (await post(s, "/api/semantic/on")).json()) as SemanticState;
    expect(on.model.enabled).toBe(true);
    await s.stop();
    const pinned = await startSpying({ WIZARDINGCODE_MEM_SEMANTIC: "on" });
    const still = (await (await post(pinned.s, "/api/semantic/off")).json()) as SemanticState;
    expect(still.model).toMatchObject({ enabled: true, source: "env" });
  });

  test("delete removes the model, the memory vectors and the past turns' vectors", async () => {
    placeModel();
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    writeMemoryVector(db, loadModel({ dataDir, env: {} }), 1, "t", "b");
    db.close();
    const hdb = openHistoryDb(dataDir, { create: true }) as NonNullable<
      ReturnType<typeof openHistoryDb>
    >;
    hdb.run(
      "INSERT INTO files (path, agent, size, mtime, indexed_at) VALUES ('/t', 'codex', 1, 1, 1)",
    );
    hdb.run(
      `INSERT INTO turns (id, path, agent, session_id, turn_id, project_id, project_name, cwd, started_at, ended_at, prompt, final_text)
       VALUES (1, '/t', 'codex', 's', 't', NULL, 'p', '/', 1, 1, 'q', 'a')`,
    );
    hdb.run("INSERT INTO turn_vectors (turn_id, model, scale, vec) VALUES (1, 'm', 1, x'00')");
    hdb.close();
    const { s } = await startSpying();
    hold("embed.lease");
    expect((await post(s, "/api/semantic/delete")).status).toBe(409);
    expect(existsSync(modelPath(dataDir))).toBe(true);
    hold("embed.lease", NOW - 1000);
    hold("embed.download.lease");
    expect((await post(s, "/api/semantic/delete")).status).toBe(409);
    hold("embed.download.lease", NOW - 1000);
    const gone = await post(s, "/api/semantic/delete");
    expect(gone.status).toBe(200);
    expect(((await gone.json()) as SemanticState).model.present).toBe(false);
    expect(existsSync(modelPath(dataDir))).toBe(false);
    const check = openDb({ dataDir, busyTimeoutMs: 2000 });
    expect(check.query("SELECT count(*) AS n FROM memory_vectors").get()).toEqual({ n: 0 });
    check.close();
    const after = openHistoryDb(dataDir, { create: false }) as NonNullable<
      ReturnType<typeof openHistoryDb>
    >;
    expect(after.query("SELECT count(*) AS n FROM turn_vectors").get()).toEqual({ n: 0 });
    expect(after.query("SELECT count(*) AS n FROM turns").get()).toEqual({ n: 1 });
    after.close();
  });

  test("delete is refused while a history run holds its lease", async () => {
    placeModel();
    const { s } = await startSpying();
    hold("history.lease");
    const refused = await post(s, "/api/semantic/delete");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain("history run");
    expect(existsSync(modelPath(dataDir))).toBe(true);
  });

  test("download honours the switch: refused while semantic search is off", async () => {
    const { s, spawned } = await startSpying({ WIZARDINGCODE_MEM_SEMANTIC: "off" });
    const refused = await post(s, "/api/semantic/download");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain("turned off");
    expect(spawned).toEqual([]);
  });

  test("delete never creates the history index", async () => {
    placeModel();
    const { s } = await startSpying();
    expect((await post(s, "/api/semantic/delete")).status).toBe(200);
    expect(existsSync(join(dataDir, "history.db"))).toBe(false);
  });
});

describe("wizardingcode-mem ui: linked projects", () => {
  const ids = () => {
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    try {
      const of = (name: string) =>
        db.query<{ id: number }, [string]>("SELECT id FROM projects WHERE name = ?").get(name)
          ?.id as number;
      mkdirSync(join(base, "lib"));
      const lib = resolveProject(db, join(base, "lib"), NOW).id;
      seed(db, "The library rotates its cache weekly.", "", { projectId: lib, kind: "gotcha" });
      return { other: of("other"), lib };
    } finally {
      db.close();
    }
  };
  const withDb = <T>(fn: (db: Db) => T): T => {
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  };
  const post = (s: UiServer, path: string, body?: unknown) =>
    api(s, path, {
      method: "POST",
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
  interface LinkView {
    id: number;
    from: number;
    fromName: string;
    to: number;
    toName: string;
    kind: string;
    status: string;
    signals: string[];
  }

  test("every links route needs the token", async () => {
    const s = await start();
    expect((await fetch(`${s.origin}/api/links`)).status).toBe(401);
    for (const path of [
      "/api/links",
      "/api/links/1/confirm",
      "/api/links/1/reject",
      "/api/links/1/unlink",
    ]) {
      expect((await fetch(`${s.origin}${path}`, { method: "POST" })).status).toBe(401);
    }
  });

  test("lists every link with its projects' names and signals, and the pending suggestions", async () => {
    const { other, lib } = ids();
    const suggested = withDb((db) => {
      linkProjects(db, projectId, lib, "uses", NOW);
      return suggestLink(db, projectId, other, "product", ["remote owner + “shop”"], NOW) as number;
    });
    const s = await start();
    const body = (await (await api(s, "/api/links")).json()) as {
      links: LinkView[];
      pending: { total: number; byProject: Record<string, number> };
    };
    expect(body.links).toEqual([
      expect.objectContaining({
        from: projectId,
        fromName: "shop",
        to: lib,
        toName: "lib",
        kind: "uses",
        status: "confirmed",
      }),
      expect.objectContaining({
        id: suggested,
        fromName: "shop",
        toName: "other",
        kind: "product",
        status: "suggested",
        signals: ["remote owner + “shop”"],
      }),
    ]);
    expect(body.pending).toEqual({
      total: 1,
      byProject: { [String(projectId)]: 1, [String(other)]: 1 },
    });
  });

  test("links by hand; refuses itself, an unknown project and an unknown kind", async () => {
    const { lib } = ids();
    const s = await start();
    const made = await post(s, "/api/links", { from: projectId, to: lib, kind: "uses" });
    expect(made.status).toBe(200);
    expect(await made.json()).toEqual(
      expect.objectContaining({ from: projectId, to: lib, kind: "uses", status: "confirmed" }),
    );
    expect(withDb((db) => visibleProjects(db, projectId).map((v) => v.name))).toEqual(["lib"]);
    expect((await post(s, "/api/links", { from: lib, to: lib, kind: "product" })).status).toBe(400);
    expect((await post(s, "/api/links", { from: lib, to: 999, kind: "product" })).status).toBe(400);
    expect((await post(s, "/api/links", { from: lib, to: projectId, kind: "x" })).status).toBe(400);
  });

  test("confirms or rejects a suggestion only; unlinks a confirmed link only", async () => {
    const { other, lib } = ids();
    const [a, b] = withDb((db) => [
      suggestLink(db, projectId, other, "product", [], NOW) as number,
      suggestLink(db, projectId, lib, "uses", [], NOW) as number,
    ]);
    const s = await start();
    const confirmed = await post(s, `/api/links/${a}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual(expect.objectContaining({ id: a, status: "confirmed" }));
    expect((await post(s, `/api/links/${a}/reject`)).status).toBe(409);
    expect((await post(s, `/api/links/${b}/reject`)).status).toBe(200);
    expect((await post(s, `/api/links/${b}/confirm`)).status).toBe(409);
    expect((await post(s, `/api/links/${b}/unlink`)).status).toBe(409);
    expect((await post(s, "/api/links/999/confirm")).status).toBe(404);
    const unlinked = await post(s, `/api/links/${a}/unlink`);
    expect(await unlinked.json()).toEqual(expect.objectContaining({ id: a, status: "rejected" }));
    expect(withDb((db) => visibleProjects(db, projectId))).toEqual([]);
  });

  test("confirming one kind of a pair rejects the other: it leaves the list and the count", async () => {
    const { lib } = ids();
    const [uses, product] = withDb((db) => [
      suggestLink(db, projectId, lib, "uses", ["package.json depends on lib"], NOW) as number,
      suggestLink(db, lib, projectId, "product", ["same owner"], NOW) as number,
    ]);
    const s = await start();
    expect((await post(s, `/api/links/${uses}/confirm`)).status).toBe(200);
    const body = (await (await api(s, "/api/links")).json()) as {
      links: LinkView[];
      pending: { total: number };
    };
    expect(body.links.find((l) => l.id === product)?.status).toBe("rejected");
    expect(body.pending.total).toBe(0);
    expect((await post(s, `/api/links/${product}/confirm`)).status).toBe(409);
    expect(withDb((db) => visibleProjects(db, lib))).toEqual([]);
  });

  test("the memory list takes its linked projects on request; the palette searches a project's group", async () => {
    const { lib } = ids();
    withDb((db) => linkProjects(db, projectId, lib, "uses", NOW));
    const s = await start();
    type List = { total: number; items: { title: string; projectId: number }[] };
    const own = (await (await api(s, `/api/memories?project=${projectId}`)).json()) as List;
    expect(own.total).toBe(2);
    const linked = (await (
      await api(s, `/api/memories?project=${projectId}&scope=linked`)
    ).json()) as List;
    expect(linked.total).toBe(3);
    expect(linked.items.find((m) => m.projectId === lib)?.title).toBe(
      "The library rotates its cache weekly.",
    );
    const searched = (await (
      await api(s, `/api/memories?project=${projectId}&scope=linked&q=rotates`)
    ).json()) as List;
    expect(searched.items.map((m) => m.title)).toEqual(["The library rotates its cache weekly."]);
    // From the library, the consumer stays out.
    const fromLib = (await (
      await api(s, `/api/memories?project=${lib}&scope=linked`)
    ).json()) as List;
    expect(fromLib.total).toBe(1);

    const hits = (await (await api(s, `/api/search?q=rotates&project=${projectId}`)).json()) as {
      projectName: string;
    }[];
    expect(hits.map((h) => h.projectName)).toEqual(["lib"]);
    const everywhere = (await (await api(s, "/api/search?q=rotates")).json()) as unknown[];
    expect(everywhere).toHaveLength(2);
  });
});

describe("wizardingcode-mem ui: your rules and the links offer", () => {
  const withDb = <T>(fn: (db: Db) => T): T => {
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  };
  const post = (s: UiServer, path: string) => api(s, path, { method: "POST" });
  const otherId = () =>
    withDb(
      (db) =>
        db.query<{ id: number }, []>("SELECT id FROM projects WHERE name = 'other'").get()
          ?.id as number,
    );
  /** The Friday rule in shop, a copy in other, and a proposal of the pair. */
  const proposeFriday = () =>
    withDb((db) => {
      const other = otherId();
      const shopCopy = db
        .query<{ id: number }, []>(
          "SELECT id FROM memories WHERE title = 'Never deploy on Fridays.'",
        )
        .get()?.id as number;
      const otherCopy = seed(db, "Never deploy on Fridays.", "Nobody is around to fix it.", {
        kind: "convention",
        importance: 3,
        projectId: other,
      });
      const ids = [shopCopy, otherCopy].sort((a, b) => a - b);
      const proposal = db
        .query<{ id: number }, [string, number]>(
          `INSERT INTO rule_proposals (memory_ids, title, body, reason, status, created_at)
           VALUES (?, 'Never deploy on Fridays.', 'Support is thin at the weekend.', 'repeated', 'proposed', ?)
           RETURNING id`,
        )
        .get(JSON.stringify(ids), NOW)?.id as number;
      return { proposal, copies: ids, other };
    });
  const statusOf = (id: number) =>
    withDb(
      (db) =>
        db.query<{ status: string }, [number]>("SELECT status FROM memories WHERE id = ?").get(id)
          ?.status,
    );
  interface Rules {
    proposed: {
      id: number;
      title: string;
      body: string;
      reason: string;
      kind: string;
      projects: string[];
    }[];
    accepted: { memoryId: number; title: string; kind: string; projects: string[] }[];
  }

  test("every rules and offer route needs the token", async () => {
    const s = await start();
    expect((await fetch(`${s.origin}/api/rules`)).status).toBe(401);
    expect((await fetch(`${s.origin}/api/links/offer`)).status).toBe(401);
    for (const path of [
      "/api/rules/1/accept",
      "/api/rules/1/reject",
      "/api/rules/1/undo",
      "/api/links/offer/dismiss",
    ]) {
      expect((await fetch(`${s.origin}${path}`, { method: "POST" })).status).toBe(401);
    }
  });

  test("lists proposals with the projects they came from; nothing accepted yet", async () => {
    const { proposal } = proposeFriday();
    const s = await start();
    const rules = (await (await api(s, "/api/rules")).json()) as Rules;
    expect(rules.proposed).toEqual([
      expect.objectContaining({
        id: proposal,
        title: "Never deploy on Fridays.",
        reason: "repeated",
        kind: "convention",
        projects: ["other", "shop"],
      }),
    ]);
    expect(rules.accepted).toEqual([]);
  });

  test("make mine supersedes the copies; undo archives the rule and brings them back", async () => {
    const { proposal, copies } = proposeFriday();
    const s = await start();
    const made = await post(s, `/api/rules/${proposal}/accept`);
    expect(made.status).toBe(200);
    const { userMemoryId } = (await made.json()) as { userMemoryId: number };
    expect(copies.map(statusOf)).toEqual(["superseded", "superseded"]);
    const rules = (await (await api(s, "/api/rules")).json()) as Rules;
    expect(rules.proposed).toEqual([]);
    expect(rules.accepted).toEqual([
      expect.objectContaining({
        memoryId: userMemoryId,
        title: "Never deploy on Fridays.",
        kind: "convention",
        projects: ["other", "shop"],
      }),
    ]);
    expect((await post(s, `/api/rules/${proposal}/accept`)).status).toBe(409);

    const undone = await post(s, `/api/rules/${userMemoryId}/undo`);
    expect(undone.status).toBe(200);
    expect(await undone.json()).toEqual({ undone: true });
    expect(statusOf(userMemoryId)).toBe("archived");
    expect(copies.map(statusOf)).toEqual(["active", "active"]);
    expect(((await (await api(s, "/api/rules")).json()) as Rules).accepted).toEqual([]);
    expect((await post(s, `/api/rules/${userMemoryId}/undo`)).status).toBe(404);
  });

  test("reject is for open proposals only; unknown ones are not found", async () => {
    const { proposal, copies } = proposeFriday();
    const s = await start();
    expect(await (await post(s, `/api/rules/${proposal}/reject`)).json()).toEqual({
      rejected: true,
    });
    expect((await post(s, `/api/rules/${proposal}/reject`)).status).toBe(409);
    expect((await post(s, `/api/rules/${proposal}/accept`)).status).toBe(409);
    expect((await post(s, "/api/rules/999/accept")).status).toBe(404);
    expect((await post(s, "/api/rules/999/reject")).status).toBe(404);
    // A memory that is not one of the author's rules cannot be undone.
    expect((await post(s, `/api/rules/${copies[0]}/undo`)).status).toBe(404);
    expect(((await (await api(s, "/api/rules")).json()) as Rules).proposed).toEqual([]);
  });

  test("a proposal whose sources changed is refused with the reason", async () => {
    const { proposal, copies } = proposeFriday();
    withDb((db) =>
      db.run("UPDATE memories SET status = 'archived' WHERE id = ?", [copies[1] as number]),
    );
    const s = await start();
    const refused = await post(s, `/api/rules/${proposal}/accept`);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain("still state");
  });

  test("the offer counts new suggestions and proposals, and stays quiet once dismissed until more come", async () => {
    const s = await start();
    expect(await (await api(s, "/api/links/offer")).json()).toEqual({
      show: false,
      suggestions: 0,
      proposals: 0,
    });
    proposeFriday();
    mkdirSync(join(base, "lib"));
    const lib = withDb((db) => resolveProject(db, join(base, "lib"), NOW).id);
    const decided = withDb((db) => suggestLink(db, projectId, lib, "uses", [], NOW) as number);
    withDb((db) => suggestLink(db, projectId, otherId(), "product", [], NOW));
    await post(s, `/api/links/${decided}/reject`);
    expect(await (await api(s, "/api/links/offer")).json()).toEqual({
      show: true,
      suggestions: 1,
      proposals: 1,
    });
    expect(await (await post(s, "/api/links/offer/dismiss")).json()).toEqual({ dismissed: true });
    expect(await (await api(s, "/api/links/offer")).json()).toEqual({
      show: false,
      suggestions: 0,
      proposals: 0,
    });
    // Something new after the dismissal brings it back, counting only what is new.
    mkdirSync(join(base, "api"));
    withDb((db) => {
      const apiProject = resolveProject(db, join(base, "api"), NOW).id;
      suggestLink(db, apiProject, lib, "uses", [], NOW);
    });
    expect(await (await api(s, "/api/links/offer")).json()).toEqual({
      show: true,
      suggestions: 1,
      proposals: 0,
    });
  });
});
