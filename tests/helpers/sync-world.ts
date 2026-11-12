// A whole world for the sync's tests: the in-process team server, a client store with a
// knowledge store on the same fake clock, one project bound to the server, and the helpers
// that write entries and memories and read the server's feed. With `named`, a second project
// with no git remote, bound under a shared name (ADR 0028).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Redacted } from "../../src/core/redact.ts";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { renderTaxonomy } from "../../src/modules/knowledge/entry.ts";
import { openRepo, resetGitCaches } from "../../src/modules/knowledge/repo.ts";
import { openStore } from "../../src/modules/knowledge/store-open.ts";
import type { EntryChange, KnowledgeStore } from "../../src/modules/knowledge/types.ts";
import { setLevel } from "../../src/sharing/store.ts";
import { insertMemory } from "../../src/store/memories.ts";
import type { Fetch } from "../../src/sync/context.ts";
import { confirmJoin, joinServer } from "../../src/sync/join.ts";
import { readTokens, type ServerRow, serverById } from "../../src/sync/servers.ts";
import { CONTRACT } from "../../src/team/contract.ts";
import { newHexId } from "../../src/team/ids.ts";
import type { ServerOptions } from "../../src/team/server.ts";
import { insertName } from "../../src/team/store.ts";
import { realGit } from "./stub-git.ts";
import { cleanSyncDirs, fakeClock, fakeTimers, openSyncStore, type SyncTestStore } from "./sync.ts";
import { api, cleanTestDirs, pullAll, startTestServer, type TestServer } from "./team.ts";

export const ALIAS = "remote:github.com/acme/site";
/** The shared name of the second project of a named world. */
export const NAME = "name:wizardingcode";
const realFetch: Fetch = (input, init) => fetch(input, init);

export interface World {
  t: TestServer;
  store: SyncTestStore;
  knowledge: KnowledgeStore;
  serverId: string;
  /** The admin's token: this device's. */
  token: string;
  projectId: number;
  /** The project bound under `NAME`, in a named world; null otherwise. */
  namedProjectId: number | null;
  /** The registry id of `NAME`, in a named world; null otherwise. */
  nameId: string | null;
  server: () => ServerRow;
  close(): Promise<void>;
}

export interface WorldOptions {
  /** A second project with a `path:` alias alone, bound to the server under `NAME` at the level. */
  named?: boolean;
  /** Options for the test server: its contract seam among them. */
  server?: Partial<ServerOptions>;
}

const open: World[] = [];

/** A server, a confirmed client store with a knowledge store, and project 1 bound to it at `level`. */
export async function world(
  level: "receive" | "knowledge" | "all" = "knowledge",
  options: WorldOptions = {},
): Promise<World> {
  const clock = fakeClock();
  const timers = fakeTimers(clock);
  const t = await startTestServer(options.server ?? {}, { clock, timers });
  const store = openSyncStore({ clock, timers, fetch: realFetch });
  store.ctx.env = {
    ...store.ctx.env,
    PATH: process.env.PATH,
    HOME: store.dataDir,
    WIZARDINGCODE_MEM_AUTHOR: "Ana",
  };
  resetGitCaches();
  writeFileSync(
    join(store.dataDir, "env"),
    "WIZARDINGCODE_MEM_SHARE_ROOTS=workspace\nWIZARDINGCODE_MEM_SHARE_AREAS=workspace:sales\n",
  );
  const knowledge = openStore({
    db: store.db,
    dataDir: store.dataDir,
    env: store.ctx.env,
    now: () => clock.now,
  });
  store.db.run("INSERT INTO projects (id, key, name, created_at) VALUES (1, ?, 'site', 1)", [
    ALIAS,
  ]);
  store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, 1)", [ALIAS]);
  const joined = await joinServer(store.ctx, {
    url: t.server.origin,
    code: t.code,
    label: "laptop",
    name: "Ana",
  });
  if (!joined.ok) throw new Error(`join failed: ${joined.message}`);
  confirmJoin(store.ctx, joined.serverId);
  const bound = setLevel(store.db, {
    projectId: 1,
    destination: joined.serverId,
    level,
    source: "cli",
    now: clock.now,
    confirm: true,
  });
  if (!bound.ok) throw new Error(`setLevel failed: ${bound.reason}`);
  const token = readTokens(store.dataDir)[joined.serverId] as string;

  let namedProjectId: number | null = null;
  let nameId: string | null = null;
  if (options.named === true) {
    store.db.run(
      "INSERT INTO projects (id, key, name, created_at) VALUES (2, 'path:/work/brand', 'brand', 1)",
    );
    store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES ('path:/work/brand', 2)");
    const current = options.server?.contract?.current ?? CONTRACT;
    if (current >= 2) {
      const made = await api(t.server, token, "POST", "/v1/names", { alias: NAME });
      if (made.status !== 201) throw new Error(`the name was not created: ${made.status}`);
      nameId = made.body.id as string;
    } else {
      // A server that speaks 1 has the registry table and no route to it: the row is seeded.
      nameId = newHexId();
      const row = serverById(store.db, joined.serverId) as ServerRow;
      insertName(t.server.db, {
        alias: NAME,
        id: nameId,
        memberId: joined.member.id,
        deviceId: row.deviceId,
        at: clock.now,
      });
    }
    const named = setLevel(store.db, {
      projectId: 2,
      destination: joined.serverId,
      level,
      source: "cli",
      now: clock.now,
      confirm: true,
      as: NAME,
      nameId,
    });
    if (!named.ok) throw new Error(`setLevel of the named project failed: ${named.reason}`);
    namedProjectId = 2;
  }

  const w: World = {
    t,
    store,
    knowledge,
    serverId: joined.serverId,
    token,
    projectId: 1,
    namedProjectId,
    nameId,
    server: () => serverById(store.db, joined.serverId) as ServerRow,
    close: async () => {
      store.close();
      await t.close();
    },
  };
  open.push(w);
  return w;
}

/** Closes every world a test left open; call it in `afterEach`. */
export async function closeWorlds(): Promise<void> {
  for (const w of open.splice(0)) await w.close();
}

/** Removes every directory; call it in `afterAll`. */
export function cleanWorlds(): void {
  cleanTestDirs();
  cleanSyncDirs();
}

export const change = (over: Partial<EntryChange> = {}): EntryChange => ({
  title: "Discovery call script",
  kind: "strategy",
  area: "sales",
  context: "agency clients",
  subject: "discovery call",
  body: "The body.",
  ...over,
});

/** Writes the workspace taxonomy with the sales area, so the policy's area is in force. */
export function taxonomy(w: World): void {
  const repo = openRepo(w.knowledge, { scope: "workspace" }, { create: personAuthor(w.knowledge) });
  if (repo === null) throw new Error("no workspace repository");
  writeFileSync(
    join(repo.path, "taxonomy.md"),
    renderTaxonomy({
      version: 2,
      updated: "2026-11-10T00:00:00Z",
      areas: [
        { id: "sales", label: "Sales" },
        { id: "code", label: "Code" },
      ],
    }),
  );
  commitByHand(repo.path, "taxonomy");
}

/** A commit outside the store, as a person's editor or shell makes one. */
export function commitByHand(repoPath: string, message: string): void {
  realGit(repoPath, "add", "-A");
  realGit(repoPath, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", message);
}

/** The server's feed for the project, from the start, as this device reads it. */
export const feed = (w: World, token: string = w.token) =>
  pullAll(w.t.server, token, { since: 0, scope: "all", projects: [ALIAS] });

/** The server's feed for the aliases given, from the start. */
export const feedOf = (w: World, projects: readonly string[], token: string = w.token) =>
  pullAll(w.t.server, token, { since: 0, scope: "all", projects: [...projects] });

export const memory = (
  w: World,
  title: string,
  over: Partial<{ importance: number; now: number; projectId: number }> = {},
): number =>
  insertMemory(w.store.db, {
    projectId: over.projectId ?? w.projectId,
    kind: "decision",
    title,
    body: "One file, one process." as Redacted,
    terms: "",
    importance: over.importance ?? 3,
    branch: null,
    commit: null,
    origin: "distilled",
    judge: "heuristic",
    judgeVersion: "1",
    sourceTurnId: null,
    files: [],
    now: over.now ?? w.store.clock.now,
  });
