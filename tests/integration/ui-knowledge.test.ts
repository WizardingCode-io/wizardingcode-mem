import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { knowledgeDir } from "../../src/modules/knowledge/files.ts";
import { proposePromotions } from "../../src/modules/knowledge/promote.ts";
import { KNOWLEDGE_VIEWS } from "../../src/modules/knowledge/views.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { touchSession } from "../../src/store/sessions.ts";
import { startUi, type UiServer } from "../../src/ui/server.ts";
import { searchTerms } from "../../src/util/words.ts";

// The Knowledge view's routes: the project's entries as its folder has them (read only),
// one entry in full, and the proposals to make memories knowledge, accepted or rejected
// on the author's click. Everything against a temporary store and a temporary project.

const NOW = new Date(2026, 9, 12, 15, 30).getTime();

let base: string;
let dataDir: string;
let repo: string;
let dir: string;
let projectId: number;
let sessionId: number;
let env: Record<string, string | undefined>;
let server: UiServer | undefined;

const withDb = <T>(run: (db: Db) => T): T => {
  const db = openDb({ dataDir, busyTimeoutMs: 2000 });
  try {
    return run(db);
  } finally {
    db.close();
  }
};
const withDbAsync = async <T>(run: (db: Db) => Promise<T>): Promise<T> => {
  const db = openDb({ dataDir, busyTimeoutMs: 2000 });
  try {
    return await run(db);
  } finally {
    db.close();
  }
};

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-ui-knowledge-")));
  dataDir = join(base, "data");
  repo = join(base, "shop");
  mkdirSync(repo);
  dir = knowledgeDir(repo);
  env = {
    WIZARDINGCODE_MEM_STORE_DIR: undefined,
    HOME: join(base, "home"),
    WIZARDINGCODE_HOME: join(base, "home", ".wizardingcode"),
  };
  withDb((db) => {
    projectId = resolveProject(db, repo, NOW).id;
  });
});
afterEach(async () => {
  await server?.stop();
  server = undefined;
  rmSync(base, { recursive: true, force: true });
});

/** A session in the project's folder: how the viewer knows where the project lives. */
function session(cwd = repo): void {
  withDb((db) => {
    sessionId = touchSession(db, {
      agent: "claude-code",
      agentSessionId: "s-1",
      projectId,
      cwd,
      branch: null,
      now: NOW,
    }).id;
  });
}

function entry(slug: string, text: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slug}.md`), text);
}

const start = async () => {
  server = await startUi({ dataDir, port: 0, open: false, env, now: () => NOW });
  return server;
};
const get = (s: UiServer, path: string) =>
  fetch(`${s.origin}${path}`, { headers: { Authorization: `Bearer ${s.token}` } });
const post = (s: UiServer, path: string) =>
  fetch(`${s.origin}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.token}` },
    body: "{}",
  });

interface Listed {
  state: string;
  root: string | null;
  dir: string | null;
  problem: string | null;
  entries: {
    slug: string;
    title: string;
    kind: string;
    essential: boolean;
    status: string;
    problem: string | null;
    path: string;
    body?: string;
  }[];
}
const knowledge = async (s: UiServer): Promise<Listed> => {
  const response = await get(s, `/api/knowledge?project=${projectId}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Listed;
};

describe("GET /api/knowledge", () => {
  test("a project whose folder is not known yet says so", async () => {
    const s = await start();
    expect(await knowledge(s)).toEqual({
      state: "unknown",
      root: null,
      dir: null,
      problem: null,
      entries: [],
    });
  });

  test("no knowledge folder: where the files would go, and no entries", async () => {
    session();
    const s = await start();
    expect(await knowledge(s)).toEqual({
      state: "missing",
      root: repo,
      dir,
      problem: null,
      entries: [],
    });
    expect(existsSync(dir)).toBe(false);
  });

  test("the entries as the files say, without their bodies; a file not understood is flagged", async () => {
    session();
    entry(
      "orders-saga",
      "---\ntitle: Orders are cancelled through the saga\nkind: decision\nessential: true\nstatus: active\nupdated: 2026-10-01\n---\nThe saga undoes each step.\n",
    );
    entry(
      "problem-details",
      "---\ntitle: Handlers return problem details\nkind: rule\n---\nAlways.\n",
    );
    entry("broken", "---\ntitle: [unclosed\nkind: nonsense\n---\nSomething.\n");
    const s = await start();
    const listed = await knowledge(s);
    expect(listed.state).toBe("ok");
    expect(listed.entries.map((e) => [e.slug, e.kind, e.essential, e.status])).toEqual([
      ["orders-saga", "decision", true, "active"],
      ["broken", "decision", false, expect.any(String)],
      ["problem-details", "rule", false, "active"],
    ]);
    expect(listed.entries.every((e) => e.body === undefined)).toBe(true);
    expect(listed.entries.find((e) => e.slug === "broken")?.problem).toBeString();
    expect(listed.entries.find((e) => e.slug === "orders-saga")?.path).toBe(
      join(dir, "orders-saga.md"),
    );
  });

  test("follows the folder: a file added or removed shows on the next read", async () => {
    session();
    entry("one", "---\ntitle: One\nkind: decision\n---\nA.\n");
    const s = await start();
    expect((await knowledge(s)).entries.map((e) => e.slug)).toEqual(["one"]);
    entry("two", "---\ntitle: Two\nkind: howto\n---\nB.\n");
    expect((await knowledge(s)).entries.map((e) => e.slug)).toEqual(["one", "two"]);
    rmSync(join(dir, "one.md"));
    expect((await knowledge(s)).entries.map((e) => e.slug)).toEqual(["two"]);
  });

  test("knowledge is off in the home folder: the reason, and nothing read", async () => {
    session();
    entry("one", "---\ntitle: One\nkind: decision\n---\nA.\n");
    env.HOME = repo;
    const s = await start();
    const listed = await knowledge(s);
    expect(listed.state).toBe("off");
    expect(listed.problem).toMatch(/home folder/);
    expect(listed.entries).toEqual([]);
  });

  test("the project is required", async () => {
    const s = await start();
    expect((await get(s, "/api/knowledge")).status).toBe(400);
    expect((await get(s, "/api/knowledge?project=x")).status).toBe(400);
  });
});

describe("GET /api/knowledge/entries/:slug", () => {
  test("one entry in full: its body, frontmatter, path and problem", async () => {
    session();
    entry(
      "orders-saga",
      "---\ntitle: Orders are cancelled through the saga\nkind: decision\nessential: true\ntags: [orders, saga]\nupdated: 2026-10-01\nsource: memory:12\n---\nThe saga **undoes** each step.\n",
    );
    const s = await start();
    await knowledge(s);
    const response = await get(s, `/api/knowledge/entries/orders-saga?project=${projectId}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      slug: "orders-saga",
      path: join(dir, "orders-saga.md"),
      title: "Orders are cancelled through the saga",
      kind: "decision",
      essential: true,
      status: "active",
      tags: ["orders", "saga"],
      updated: "2026-10-01",
      source: "memory:12",
      body: "The saga **undoes** each step.",
      problem: null,
    });
    expect((await get(s, `/api/knowledge/entries/nope?project=${projectId}`)).status).toBe(404);
    // A bad percent-escape is the client's mistake, not the server's (task 5 minor).
    expect((await get(s, `/api/knowledge/entries/%E0%A4%A?project=${projectId}`)).status).toBe(400);
    expect((await get(s, "/api/knowledge/entries/orders-saga")).status).toBe(400);
  });

  test("not where knowledge is off", async () => {
    session();
    entry("one", "---\ntitle: One\nkind: decision\n---\nA.\n");
    const s = await start();
    await knowledge(s);
    env.HOME = repo;
    expect((await get(s, `/api/knowledge/entries/one?project=${projectId}`)).status).toBe(404);
  });
});

describe("proposals", () => {
  /** A decision asked for in three sessions over three days: proposed by the drain's pass. */
  function proposed(title: string): Promise<number> {
    return withDbAsync(async (db) => {
      const body = `${title}, because the review asked for it.`;
      const id = insertMemory(db, {
        projectId,
        kind: "decision",
        title,
        body: body as Redacted,
        terms: searchTerms(title, body, []),
        importance: 4,
        branch: null,
        commit: null,
        origin: "distilled",
        judge: "heuristic",
        judgeVersion: "1",
        sourceTurnId: null,
        files: [],
        now: NOW,
      });
      // Asked for in three sessions, a day apart (what promotion counts as shown).
      for (let day = 1; day <= 3; day++) {
        const shownIn = touchSession(db, {
          agent: "claude-code",
          agentSessionId: `shown-${id}-${day}`,
          projectId,
          cwd: repo,
          branch: null,
          now: NOW,
        }).id;
        db.run(
          `INSERT INTO injections (session_id, context_epoch, memory_id, event, tokens, at)
           VALUES (?, 1, ?, 'prompt', 10, ?)`,
          [shownIn, id, NOW - day * 86_400_000],
        );
      }
      await proposePromotions(db, { now: NOW, env });
      const row = db
        .query<{ id: number }, [number]>("SELECT id FROM knowledge_proposals WHERE memory_id = ?")
        .get(id);
      if (row === null) throw new Error(`memory ${id} was not proposed`);
      return row.id;
    });
  }
  interface Proposal {
    id: number;
    projectId: number;
    memoryId: number;
    slug: string;
    title: string;
    body: string;
    kind: string;
  }
  const proposals = async (s: UiServer, query = `?project=${projectId}`) => {
    const response = await get(s, `/api/knowledge/proposals${query}`);
    expect(response.status).toBe(200);
    return (await response.json()) as Proposal[];
  };

  test("listed with the memory's text; of one project or of all", async () => {
    session();
    const first = await proposed("Orders are cancelled through the saga");
    const s = await start();
    const listed = await proposals(s);
    expect(listed.map((p) => [p.id, p.slug, p.title, p.kind])).toEqual([
      [
        first,
        "orders-are-cancelled-through-the-saga",
        "Orders are cancelled through the saga",
        "decision",
      ],
    ]);
    expect((await proposals(s, "")).map((p) => p.id)).toEqual([first]);
    expect((await get(s, "/api/knowledge/proposals?project=x")).status).toBe(400);
  });

  test("Make knowledge writes the entry; it is listed at once; a second click is refused", async () => {
    session();
    const id = await proposed("Orders are cancelled through the saga");
    const s = await start();
    const made = await post(s, `/api/knowledge/proposals/${id}/accept`);
    expect(made.status).toBe(200);
    expect(await made.json()).toEqual({
      slug: "orders-are-cancelled-through-the-saga",
      path: join(dir, "orders-are-cancelled-through-the-saga.md"),
    });
    expect(readdirSync(dir)).toEqual(["orders-are-cancelled-through-the-saga.md"]);
    expect((await knowledge(s)).entries.map((e) => e.slug)).toEqual([
      "orders-are-cancelled-through-the-saga",
    ]);
    expect(await proposals(s)).toEqual([]);
    const again = await post(s, `/api/knowledge/proposals/${id}/accept`);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toMatch(/already accepted/);
  });

  test("Reject writes nothing and is final; an unknown proposal is 404", async () => {
    session();
    const id = await proposed("Orders are cancelled through the saga");
    const s = await start();
    const rejected = await post(s, `/api/knowledge/proposals/${id}/reject`);
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toEqual({ rejected: true });
    expect(existsSync(dir)).toBe(false);
    expect(await proposals(s)).toEqual([]);
    expect((await post(s, `/api/knowledge/proposals/${id}/reject`)).status).toBe(409);
    expect((await post(s, `/api/knowledge/proposals/${id}/accept`)).status).toBe(409);
    expect((await post(s, "/api/knowledge/proposals/999/accept")).status).toBe(404);
    expect((await post(s, "/api/knowledge/proposals/999/reject")).status).toBe(404);
  });

  test("refused, with nothing written, where knowledge is off", async () => {
    session();
    const id = await proposed("Orders are cancelled through the saga");
    env.HOME = repo;
    const s = await start();
    const refused = await post(s, `/api/knowledge/proposals/${id}/accept`);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/Nothing was written/);
    expect(existsSync(join(repo, ".wizardingcode"))).toBe(false);
  });
});

describe("the view in the rail, and the token", () => {
  test("Knowledge is a rail button after memory's, on key 7", async () => {
    const s = await start();
    const response = await get(s, "/api/modules");
    const modules = (await response.json()) as { id: string; views: unknown[] }[];
    expect(modules.map((m) => m.id)).toEqual(["memory", "knowledge"]);
    expect(modules[1]?.views).toEqual([...KNOWLEDGE_VIEWS]);
    expect(KNOWLEDGE_VIEWS).toEqual([
      { tab: "knowledge", label: "Knowledge", icon: "i-lucide-book-open", key: "7" },
    ]);
  });

  test("every knowledge route is behind the token", async () => {
    const s = await start();
    for (const path of [
      `/api/knowledge?project=${projectId}`,
      `/api/knowledge/entries/one?project=${projectId}`,
      "/api/knowledge/proposals",
    ]) {
      expect((await fetch(`${s.origin}${path}`)).status).toBe(401);
    }
    for (const path of ["/api/knowledge/proposals/1/accept", "/api/knowledge/proposals/1/reject"]) {
      expect((await fetch(`${s.origin}${path}`, { method: "POST" })).status).toBe(401);
    }
  });
});
