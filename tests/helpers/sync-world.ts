// A whole world for the sync's tests: the in-process team server, a client store with a
// knowledge store on the same fake clock, one project bound to the server, and the helpers
// that write entries and memories and read the server's feed.
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
import { realGit } from "./stub-git.ts";
import { cleanSyncDirs, fakeClock, fakeTimers, openSyncStore, type SyncTestStore } from "./sync.ts";
import { cleanTestDirs, pullAll, startTestServer, type TestServer } from "./team.ts";

export const ALIAS = "remote:github.com/acme/site";
const realFetch: Fetch = (input, init) => fetch(input, init);

export interface World {
  t: TestServer;
  store: SyncTestStore;
  knowledge: KnowledgeStore;
  serverId: string;
  /** The admin's token: this device's. */
  token: string;
  projectId: number;
  server: () => ServerRow;
  close(): Promise<void>;
}

const open: World[] = [];

/** A server, a confirmed client store with a knowledge store, and project 1 bound to it at `level`. */
export async function world(level: "receive" | "knowledge" | "all" = "knowledge"): Promise<World> {
  const clock = fakeClock();
  const timers = fakeTimers(clock);
  const t = await startTestServer({}, { clock, timers });
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
  const w: World = {
    t,
    store,
    knowledge,
    serverId: joined.serverId,
    token: readTokens(store.dataDir)[joined.serverId] as string,
    projectId: 1,
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

export const memory = (
  w: World,
  title: string,
  over: Partial<{ importance: number; now: number }> = {},
): number =>
  insertMemory(w.store.db, {
    projectId: w.projectId,
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
