// The viewer's sharing routes: what the policy is, what a change would release, a project's
// level, and the two sharing lists saved through the settings. Each case runs the real
// server over its own data directory, with a project whose folder has a git remote. The
// knowledge entries are written by the knowledge store into real repositories.
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { DEFAULT_AREAS } from "../../src/modules/knowledge/entry.ts";
import { resetGitCaches } from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import { openStore } from "../../src/modules/knowledge/store-open.ts";
import type { ScopeRef } from "../../src/modules/knowledge/types.ts";
import { epochOf } from "../../src/sharing/levels.ts";
import { loadPolicy } from "../../src/sharing/policy.ts";
import { applySettingsPatch, counterOf, levelRows, setLevel } from "../../src/sharing/store.ts";
import type { Level } from "../../src/sharing/types.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { insertPending, setContract, writeToken } from "../../src/sync/servers.ts";
import { flagName } from "../../src/sync/state.ts";
import { nameByAlias, purgeName } from "../../src/team/store.ts";
import { statusOf } from "../../src/ui/api.ts";
import { startUi, type UiServer } from "../../src/ui/server.ts";
import { realGit } from "../helpers/stub-git.ts";
import {
  cleanSyncDirs,
  openSyncStore,
  type SyncTestStore,
  serverFixture,
} from "../helpers/sync.ts";
import { cleanWorlds, closeWorlds, NAME, type World, world } from "../helpers/sync-world.ts";
import { eventsOf, api as teamApi } from "../helpers/team.ts";

const NOW = Date.UTC(2026, 10, 9, 8);
const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS";
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS";
const REMOTE = "remote:github.com/acme/site";
const WORKSPACE = { scope: "workspace" } as const;
const TITLE = "Discovery call script";
const SLUG = "discovery-call-script";
const LONG = 60_000;

let base: string;
let dataDir: string;
let home: string;
let project: string;
let projectId: number;
/** What the server's git and its redaction see; a case adds the sharing keys to it. */
let env: Record<string, string | undefined>;
let server: UiServer | undefined;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-ui-sharing-")));
  dataDir = join(base, "data");
  home = join(base, "home");
  project = join(home, "work", "site");
  mkdirSync(dataDir);
  mkdirSync(project, { recursive: true });
  realGit(project, "init", "-q");
  realGit(project, "remote", "add", "origin", "https://github.com/acme/site.git");
  env = { PATH: process.env.PATH, HOME: home };
  resetGitCaches();
  projectId = withDb((db) => resolveProject(db, project, NOW).id);
});
afterEach(async () => {
  await server?.stop();
  server = undefined;
  rmSync(base, { recursive: true, force: true });
});

function withDb<T>(fn: (db: Db) => T): T {
  const db = openDb({ dataDir, busyTimeoutMs: 5000 });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function start(extra: Record<string, string> = {}): Promise<UiServer> {
  server = await startUi({
    dataDir,
    homeDir: join(base, "brand"),
    port: 0,
    open: false,
    now: () => NOW,
    env: { ...env, ...extra },
  });
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
const send = (s: UiServer, method: "PUT" | "POST", path: string, body: unknown) =>
  api(s, path, { method, body: JSON.stringify(body) });

interface Report {
  counts: { entries: number; memories: number };
  perRoot: Record<"workspace" | "shared", { entries: number; areaTotals: Record<string, number> }>;
  perProject: {
    id: number;
    level: Level;
    entries: number;
    memories: number;
    imported: number;
  }[];
  items?: {
    entries: { scope: string; projectId: number; slug: string; title: string; area: string }[];
    memories: unknown[];
    more: { entries: number; memories: number };
  };
}
interface Change {
  what: string;
  old: string;
  new: string;
  source: string;
}
interface View {
  epoch: number;
  closed: boolean;
  roots: string[];
  areas: string[];
  inert: string[];
  problems: string[];
  lastChange: (Change & { id: number; at: number }) | null;
  taxonomies: Record<"workspace" | "shared", { id: string; label: string }[] | null>;
  levels: Record<Level, number>;
  report: Report;
}
interface Listed {
  id: number;
  name: string;
  sharing: string;
  sharingReason: string;
  remote: boolean;
  disabled: boolean;
}

const sharing = async (s: UiServer, query = ""): Promise<View> =>
  (await (await api(s, `/api/sharing${query}`)).json()) as View;
const preview = (s: UiServer, change: unknown) => send(s, "POST", "/api/sharing/preview", change);
const previewed = async (s: UiServer, change: unknown): Promise<Report> => {
  const response = await preview(s, change);
  expect(response.status).toBe(200);
  return ((await response.json()) as { report: Report }).report;
};
const setSharing = (s: UiServer, id: number, body: unknown) =>
  send(s, "PUT", `/api/projects/${id}/sharing`, body);
const saveSettings = (s: UiServer, patch: unknown) => send(s, "PUT", "/api/settings", patch);
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error;
const listed = async (s: UiServer): Promise<Listed[]> =>
  ((await (await api(s, "/api/overview")).json()) as { projects: Listed[] }).projects;

/** A sales entry as a person writes one, into the workspace's or a project's repository. */
function writeSales(ref: ScopeRef, title = TITLE): void {
  withDb((db) => {
    const store = openStore({ db, dataDir, env, now: () => NOW });
    writeEntry(
      store,
      ref,
      {
        title,
        kind: "knowledge",
        area: "sales",
        context: "agency clients",
        subject: "discovery call",
        status: "active",
        body: `${title}, in full.`,
      },
      personAuthor(store),
    );
  });
}

/** Sets a level as a person who confirmed in a shell would. */
function share(id: number, level: Level): void {
  withDb((db) => {
    const outcome = setLevel(db, {
      projectId: id,
      destination: "team",
      level,
      source: "cli",
      now: NOW,
      confirm: true,
    });
    if (!outcome.ok) throw new Error(`the level was refused: ${outcome.reason}`);
  });
}

/** Writes the two lists as `share roots` and `share areas` would, the person having said yes. */
function allow(lists: { roots?: string; areas?: string }): void {
  withDb((db) => {
    applySettingsPatch(
      db,
      dataDir,
      {
        ...(lists.roots === undefined ? {} : { [ROOTS_KEY]: lists.roots }),
        ...(lists.areas === undefined ? {} : { [AREAS_KEY]: lists.areas }),
      },
      "cli",
      NOW,
      true,
    );
  });
}

const levels = () =>
  withDb((db) =>
    db
      .query<{ projectId: number; level: string; boundAlias: string; source: string }, []>(
        `SELECT project_id AS projectId, level, bound_alias AS boundAlias, source
           FROM sharing_levels ORDER BY project_id`,
      )
      .all(),
  );
const changes = () =>
  withDb((db) =>
    db.query<Change, []>("SELECT what, old, new, source FROM sharing_changes ORDER BY id").all(),
  );
const counter = () => withDb((db) => counterOf(db));
const envFile = () =>
  existsSync(join(dataDir, "env")) ? readFileSync(join(dataDir, "env"), "utf8") : "";

/** A second project, in a folder whose repository has no remote. Returns its id. */
function plainProject(): number {
  const plain = join(home, "work", "plain");
  mkdirSync(plain);
  realGit(plain, "init", "-q");
  return withDb((db) => resolveProject(db, plain, NOW).id);
}

describe("wizardingcode-mem ui: the sharing routes are behind the token and the Host", () => {
  test("without the token nothing is answered, and nothing is written", async () => {
    const s = await start();
    const bare = (path: string, method: string, body?: unknown) =>
      fetch(`${s.origin}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect((await bare("/api/sharing", "GET")).status).toBe(401);
    expect((await bare("/api/sharing/preview", "POST", { roots: ["workspace"] })).status).toBe(401);
    const set = await bare(`/api/projects/${projectId}/sharing`, "PUT", {
      level: "knowledge",
      confirm: true,
    });
    expect(set.status).toBe(401);
    const saved = await bare("/api/settings", "PUT", { [ROOTS_KEY]: "workspace", confirm: true });
    expect(saved.status).toBe(401);
    expect(envFile()).toBe("");
    expect(levels()).toEqual([]);
    expect(changes()).toEqual([]);
  });

  test("with the token and another Host every route is refused", async () => {
    const s = await start();
    const elsewhere = { headers: { Host: "evil.example" } };
    expect((await api(s, "/api/sharing", elsewhere)).status).toBe(403);
    const previewing = await api(s, "/api/sharing/preview", {
      method: "POST",
      body: JSON.stringify({ roots: ["workspace"] }),
      ...elsewhere,
    });
    expect(previewing.status).toBe(403);
    const set = await api(s, `/api/projects/${projectId}/sharing`, {
      method: "PUT",
      body: JSON.stringify({ level: "knowledge", confirm: true }),
      ...elsewhere,
    });
    expect(set.status).toBe(403);
    expect(levels()).toEqual([]);
  });
});

describe("wizardingcode-mem ui: the overview's projects", () => {
  test("each project carries its level, why, whether it has a remote and whether memory is on", async () => {
    const plain = plainProject();
    const s = await start();
    const projects = await listed(s);
    expect(projects.find((p) => p.id === projectId)).toMatchObject({
      name: "site",
      sharing: "local",
      sharingReason: "level-local",
      remote: true,
      disabled: false,
    });
    expect(projects.find((p) => p.id === plain)).toMatchObject({
      sharing: "local",
      sharingReason: "level-local",
      remote: false,
      disabled: false,
    });
  });

  test("a remote that is a local path gives the project no name a team knows it by: remote is false", async () => {
    const other = join(home, "work", "other");
    mkdirSync(other);
    realGit(other, "init", "-q");
    realGit(other, "remote", "add", "origin", join(home, "work", "elsewhere.git"));
    const id = withDb((db) => resolveProject(db, other, NOW).id);
    const s = await start();
    const projects = await listed(s);
    expect(projects.find((p) => p.id === id)).toMatchObject({
      sharing: "local",
      sharingReason: "level-local",
      remote: false,
      disabled: false,
    });
  });

  test("a level its project can no longer hold reads Nothing, and only the Sharing page removes it", async () => {
    share(projectId, "knowledge");
    withDb((db) => db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [projectId]));
    const s = await start();
    expect((await listed(s))[0]).toMatchObject({
      sharing: "local",
      sharingReason: "disabled",
      disabled: true,
    });
    // The overview only read: the row is still there, and nothing was logged for it.
    expect(levels().map((row) => row.level)).toEqual(["knowledge"]);
    expect(changes()).toHaveLength(1);

    const view = await sharing(s);
    expect(view.levels).toEqual({ local: 1, receive: 0, knowledge: 0, all: 0 });
    expect(view.problems).toEqual([]);
    expect(levels()).toEqual([]);
    expect(changes().at(-1)).toEqual({
      what: `project:${projectId}`,
      old: "knowledge",
      new: "local",
      source: "system",
    });
    expect(view.lastChange).toMatchObject({ what: `project:${projectId}`, source: "system" });
  });
});

describe("wizardingcode-mem ui: GET /api/sharing", () => {
  test(
    "on a fresh store everything is at its default; the taxonomy comes with the first entry",
    async () => {
      const s = await start();
      const view = await sharing(s);
      expect(view).toMatchObject({
        epoch: epochOf(0, { roots: [], areas: [] }),
        closed: false,
        roots: [],
        areas: [],
        inert: [],
        problems: [],
        lastChange: null,
        taxonomies: { workspace: null, shared: null },
        levels: { local: 1, knowledge: 0, all: 0 },
      });
      expect(view.report.counts).toEqual({ entries: 0, memories: 0 });
      expect(view.report.perProject).toEqual([
        { id: projectId, level: "local", entries: 0, memories: 0, imported: 0 },
      ]);
      expect(view.report.items).toBeUndefined();

      writeSales(WORKSPACE);
      const after = await sharing(s);
      expect(after.taxonomies.workspace).toEqual(DEFAULT_AREAS);
      expect(after.taxonomies.workspace).toHaveLength(9);
      expect(after.taxonomies.shared).toBeNull();
      // Nothing is allowed yet: the entry is counted in its area and does not leave.
      expect(after.report.perRoot.workspace).toEqual({ entries: 0, areaTotals: { sales: 1 } });
      expect(after.report.counts).toEqual({ entries: 0, memories: 0 });
    },
    LONG,
  );

  test("records a hand edit of the env file first, and answers the policy it leaves", async () => {
    const s = await start();
    const before = await sharing(s);
    writeFileSync(join(dataDir, "env"), `${ROOTS_KEY}=shared,workspace\n`);
    const view = await sharing(s);
    expect(view.roots).toEqual(["shared", "workspace"]);
    expect(view.lastChange).toMatchObject({
      what: "roots",
      old: "none",
      new: "shared,workspace",
      source: "file",
      at: NOW,
    });
    expect(view.epoch).not.toBe(before.epoch);
    expect(view.epoch).toBe(epochOf(1, { roots: ["shared", "workspace"], areas: [] }));
    expect(view.problems).toEqual([]);
    // Recorded once: a second look writes nothing.
    await sharing(s);
    expect(changes()).toHaveLength(1);
  });

  test(
    "with ?list=1 it names what would leave",
    async () => {
      writeSales(WORKSPACE);
      allow({ roots: "workspace", areas: "workspace:sales" });
      const s = await start();
      const view = await sharing(s, "?list=1");
      expect(view.roots).toEqual(["workspace"]);
      expect(view.areas).toEqual(["workspace:sales"]);
      expect(view.report.counts).toEqual({ entries: 1, memories: 0 });
      expect(view.report.items).toEqual({
        entries: [{ scope: "workspace", projectId: 0, slug: SLUG, title: TITLE, area: "sales" }],
        memories: [],
        more: { entries: 0, memories: 0 },
      });
      expect((await sharing(s)).report.items).toBeUndefined();
    },
    LONG,
  );

  test("the environment narrows what the file allows, and the settings view says so", async () => {
    allow({ roots: "workspace" });
    const s = await start({ [ROOTS_KEY]: "none" });
    const settings = (await (await api(s, "/api/settings")).json()) as {
      settings: Record<string, unknown>;
    };
    expect(settings.settings[ROOTS_KEY]).toEqual({ value: "none", source: "env" });
    expect((await sharing(s)).roots).toEqual([]);
  });

  test(
    "an area no taxonomy holds is stored as given and answered as inert",
    async () => {
      writeSales(WORKSPACE);
      const s = await start();
      const saved = await saveSettings(s, { [AREAS_KEY]: "workspace:nope", confirm: true });
      expect(saved.status).toBe(200);
      expect(envFile()).toContain(`${AREAS_KEY}=workspace:nope\n`);
      const view = await sharing(s);
      expect(view.areas).toEqual([]);
      expect(view.inert).toEqual(["workspace:nope"]);
      expect(view.problems).toEqual([expect.stringContaining("workspace:nope")]);
    },
    LONG,
  );
});

describe("wizardingcode-mem ui: POST /api/sharing/preview", () => {
  test(
    "a level a project does not have yet answers what it would release, and writes nothing",
    async () => {
      writeSales({ scope: "project", projectId });
      allow({ areas: "workspace:sales" });
      const s = await start();
      const report = await previewed(s, { level: { projectId, level: "knowledge" } });
      expect(report.perProject).toEqual([
        { id: projectId, level: "knowledge", entries: 1, memories: 0, imported: 0 },
      ]);
      expect(report.counts).toEqual({ entries: 1, memories: 0 });
      expect(report.items).toBeUndefined();

      expect(levels()).toEqual([]);
      expect(changes()).toHaveLength(1);
      const view = await sharing(s);
      expect(view.report.counts.entries).toBe(0);
      expect(view.levels).toEqual({ local: 1, receive: 0, knowledge: 0, all: 0 });
    },
    LONG,
  );

  test(
    "roots and areas together answer what both would release",
    async () => {
      writeSales(WORKSPACE);
      const s = await start();
      const report = await previewed(s, { roots: ["workspace"], areas: ["workspace:sales"] });
      expect(report.counts.entries).toBe(1);
      expect(report.perRoot.workspace.entries).toBe(1);
      // Either alone releases nothing: the root and the area must both be allowed.
      expect((await previewed(s, { roots: ["workspace"] })).counts.entries).toBe(0);
      expect((await previewed(s, { areas: ["workspace:sales"] })).counts.entries).toBe(0);
      expect(envFile()).toBe("");
      expect(changes()).toEqual([]);
    },
    LONG,
  );

  test("a project, a level, a root or an area that is not one is refused", async () => {
    const s = await start();
    for (const change of [
      { level: { projectId: 999, level: "knowledge" } },
      { level: { projectId, level: "wide" } },
      { level: "knowledge" },
      { roots: ["all"] },
      { roots: "workspace" },
      { areas: ["Sales"] },
      { areas: ["workspace:sales", 3] },
    ]) {
      const response = await preview(s, change);
      expect([JSON.stringify(change), response.status]).toEqual([JSON.stringify(change), 400]);
      const refusal = (await response.json()) as { error: string; reason: string };
      expect(typeof refusal.error).toBe("string");
      expect(["body", "invalid", "no-project", "roots", "areas"]).toContain(refusal.reason);
    }
    expect((await api(s, "/api/sharing/preview", { method: "POST", body: "nope" })).status).toBe(
      400,
    );
    // An empty change is the policy as it is.
    expect((await previewed(s, {})).counts).toEqual({ entries: 0, memories: 0 });
  });
});

describe("wizardingcode-mem ui: PUT /api/projects/<id>/sharing", () => {
  test("a wider level needs confirm: true; a narrower one needs nothing", async () => {
    const s = await start();
    const unconfirmed = await setSharing(s, projectId, { level: "knowledge" });
    expect(unconfirmed.status).toBe(400);
    const unconfirmedBody = (await unconfirmed.json()) as { error: string; reason: string };
    expect(unconfirmedBody.error).toContain("confirm: true");
    expect(unconfirmedBody.reason).toBe("needs-confirm");
    // Anything but true is not a confirmation.
    expect((await setSharing(s, projectId, { level: "knowledge", confirm: "yes" })).status).toBe(
      400,
    );
    expect(levels()).toEqual([]);
    expect(changes()).toEqual([]);

    const confirmed = await setSharing(s, projectId, { level: "knowledge", confirm: true });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({
      level: "knowledge",
      old: "local",
      boundAlias: REMOTE,
      sharedName: null,
    });
    expect(levels()).toEqual([
      { projectId, level: "knowledge", boundAlias: REMOTE, source: "viewer" },
    ]);
    expect(changes()).toEqual([
      { what: `project:${projectId}`, old: "local", new: "knowledge", source: "viewer" },
    ]);
    expect((await listed(s))[0]).toMatchObject({ sharing: "knowledge", sharingReason: "allowed" });

    const lowered = await setSharing(s, projectId, { level: "local" });
    expect(lowered.status).toBe(200);
    expect(await lowered.json()).toEqual({
      level: "local",
      old: "knowledge",
      boundAlias: "",
      sharedName: null,
    });
    expect(levels()).toEqual([]);
    expect((await listed(s))[0]).toMatchObject({ sharing: "local", sharingReason: "level-local" });
  });

  test("what can never be set is refused before any confirmation is asked for", async () => {
    const plain = plainProject();
    const s = await start();
    const reasonOf = async (response: Response) =>
      ((await response.json()) as { reason: string }).reason;
    const invalid = await setSharing(s, projectId, { level: "wide" });
    expect([invalid.status, await reasonOf(invalid)]).toEqual([400, "invalid"]);
    expect((await setSharing(s, projectId, {})).status).toBe(400);
    const unknown = await setSharing(s, 999, { level: "knowledge" });
    expect([unknown.status, await reasonOf(unknown)]).toEqual([404, "no-project"]);

    const noName = await setSharing(s, plain, { level: "knowledge" });
    expect(noName.status).toBe(400);
    const noNameBody = (await noName.json()) as { error: string; reason: string };
    expect(noNameBody.error).toContain("give it a shared name");
    expect(noNameBody.reason).toBe("no-name");
    expect((await setSharing(s, plain, { level: "knowledge", confirm: true })).status).toBe(400);
    // Nothing is what it shares already.
    expect((await setSharing(s, plain, { level: "local" })).status).toBe(200);

    withDb((db) => db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [projectId]));
    const off = await setSharing(s, projectId, { level: "knowledge" });
    expect(off.status).toBe(409);
    const offBody = (await off.json()) as { error: string; reason: string };
    expect(offBody.error).toContain("memory is off for this project");
    expect(offBody.reason).toBe("disabled");
    expect(levels()).toEqual([]);
    expect(changes()).toEqual([]);
  });
});

describe("wizardingcode-mem ui: the sharing lists in PUT /api/settings", () => {
  test("a wider list needs confirm: true in the body, and is logged as the viewer's", async () => {
    const s = await start();
    const unconfirmed = await saveSettings(s, { [ROOTS_KEY]: "workspace" });
    expect(unconfirmed.status).toBe(400);
    expect(await errorOf(unconfirmed)).toContain("confirm: true");
    const areas = await saveSettings(s, { [AREAS_KEY]: "workspace:sales" });
    expect(areas.status).toBe(400);
    expect(await errorOf(areas)).toContain("confirm: true");
    expect(envFile()).toBe("");
    expect(changes()).toEqual([]);
    expect(counter()).toBe(0);

    const confirmed = await saveSettings(s, { [ROOTS_KEY]: "workspace", confirm: true });
    expect(confirmed.status).toBe(200);
    const view = (await confirmed.json()) as { dataDir: string; settings: Record<string, unknown> };
    expect(view.dataDir).toBe(dataDir);
    expect(view.settings[ROOTS_KEY]).toEqual({ value: "workspace", source: "file" });
    expect(envFile()).toBe(`${ROOTS_KEY}=workspace\n`);
    expect(changes()).toEqual([{ what: "roots", old: "none", new: "workspace", source: "viewer" }]);
    expect(counter()).toBe(1);
  });

  test("a narrower list needs no confirm, and a patch without a sharing key is saved as before", async () => {
    allow({ roots: "shared,workspace" });
    const s = await start();
    const narrowed = await saveSettings(s, { [ROOTS_KEY]: "workspace" });
    expect(narrowed.status).toBe(200);
    const cleared = await saveSettings(s, { [ROOTS_KEY]: null });
    expect(cleared.status).toBe(200);
    expect(envFile()).not.toContain(ROOTS_KEY);
    expect(changes().map((change) => [change.old, change.new, change.source])).toEqual([
      ["none", "shared,workspace", "cli"],
      ["shared,workspace", "workspace", "viewer"],
      ["workspace", "none", "viewer"],
    ]);
    expect(counter()).toBe(3);

    const other = await saveSettings(s, { WIZARDINGCODE_MEM_RETENTION_DAYS: "30" });
    expect(other.status).toBe(200);
    expect(envFile()).toBe("WIZARDINGCODE_MEM_RETENTION_DAYS=30\n");
    // A confirmation sent with a patch that needs none is not a setting, and not an error.
    const withConfirm = await saveSettings(s, {
      WIZARDINGCODE_MEM_RETENTION_DAYS: "45",
      confirm: true,
    });
    expect(withConfirm.status).toBe(200);
    expect(changes()).toHaveLength(3);
    expect(counter()).toBe(3);
  });
});

describe("wizardingcode-mem ui: a value with a line break in PUT /api/settings", () => {
  test("is refused, so it cannot write a sharing line into the env file", async () => {
    allow({ roots: "workspace" });
    const before = envFile();
    const roots = () => withDb((db) => [...loadPolicy(db, dataDir, env).roots]);
    expect(roots()).toEqual(["workspace"]);
    const s = await start();
    for (const key of ["TYPESAFE_API_KEY", "WIZARDINGCODE_MEM_BACKUP_S3_REGION"]) {
      for (const value of [
        "x\nWIZARDINGCODE_MEM_SHARE_ROOTS=workspace,shared",
        "x\rWIZARDINGCODE_MEM_SHARE_ROOTS=workspace,shared",
      ]) {
        const response = await saveSettings(s, { [key]: value });
        expect(response.status).toBe(400);
        const body = (await response.json()) as { errors: Record<string, string> };
        expect(body.errors).toEqual({ [key]: "a value on one line" });
      }
    }
    expect(envFile()).toBe(before);
    expect(roots()).toEqual(["workspace"]);
    expect(changes()).toHaveLength(1);
  });
});

describe("wizardingcode-mem ui: a sharing policy that cannot be loaded", () => {
  test("is answered as closed, and nothing about sharing is changed under it", async () => {
    share(projectId, "knowledge");
    const s = await start();
    withDb((db) => {
      db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [projectId]);
      // A sharing schema newer than this binary, as a later version leaves it.
      db.run(
        "INSERT INTO module_migrations (module, version, name, applied_at) VALUES ('sharing', 4, 'x', 0)",
      );
    });
    const view = await sharing(s);
    expect(view.closed).toBe(true);
    expect(view.problems).toEqual([expect.stringContaining("newer")]);
    expect(view.lastChange).toBeNull();
    expect(view.report.counts).toEqual({ entries: 0, memories: 0 });
    // Nothing was reconciled: the level the project can no longer hold is left as stored.
    expect(levels().map((row) => row.level)).toEqual(["knowledge"]);
    expect(changes()).toHaveLength(1);

    const set = await setSharing(s, projectId, { level: "local" });
    expect(set.status).toBe(409);
    const setBody = (await set.json()) as { error: string; reason: string };
    expect(setBody.error).toContain("newer");
    expect(setBody.reason).toBe("closed");
    const saved = await saveSettings(s, { [ROOTS_KEY]: "workspace", confirm: true });
    expect(saved.status).toBe(409);
    expect(await errorOf(saved)).toContain("newer");
    expect(levels().map((row) => row.level)).toEqual(["knowledge"]);
    expect(envFile()).toBe("");
    expect(changes()).toHaveLength(1);
    // The other settings are saved as ever.
    expect((await saveSettings(s, { WIZARDINGCODE_MEM_RETENTION_DAYS: "30" })).status).toBe(200);
  });
});

// --- Shared names (ADR 0028) ---------------------------------------------------------------------

describe("wizardingcode-mem ui: shared names (ADR 0028)", () => {
  const stores: SyncTestStore[] = [];
  afterEach(async () => {
    for (const store of stores.splice(0)) store.close();
    await closeWorlds();
  });
  afterAll(() => {
    cleanWorlds();
    cleanSyncDirs();
  });

  /** The viewer over a store, on its clock; the file's afterEach stops it. */
  async function viewerOver(store: SyncTestStore): Promise<UiServer> {
    server = await startUi({
      dataDir: store.dataDir,
      homeDir: join(store.dataDir, "brand"),
      port: 0,
      open: false,
      now: () => store.clock.now,
      env: store.ctx.env,
      clock: store.clock,
      timers: store.timers,
      spawn: () => undefined,
    });
    return server;
  }
  /** A project on a plain folder, known by its path alone. */
  function pathProject(store: SyncTestStore, id: number, name: string): number {
    store.db.run("INSERT INTO projects (id, key, name, created_at) VALUES (?, ?, ?, 1)", [
      id,
      `path:/work/${name}`,
      name,
    ]);
    store.db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [
      `path:/work/${name}`,
      id,
    ]);
    return id;
  }
  /** How many requests the team server logged for routes whose name holds `route`. */
  const requests = (w: World, route: string) =>
    eventsOf(w.t, "request").filter((event) => String(event.route).includes(route)).length;
  const bodyOf = async (response: Response) => ({
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  });
  const previewName = (s: UiServer, id: number, body: unknown) =>
    send(s, "POST", `/api/projects/${id}/sharing/preview`, body);
  const forget = (s: UiServer, id: number) =>
    api(s, `/api/projects/${id}/name`, { method: "DELETE" });
  const aliasRows = (w: World) =>
    w.store.db
      .query<{ alias: string; projectId: number }, []>(
        "SELECT alias, project_id AS projectId FROM project_aliases ORDER BY alias",
      )
      .all();
  const changeRows = (w: World) =>
    w.store.db.query<{ what: string }, []>("SELECT what FROM sharing_changes ORDER BY id").all();
  const rowOf = (w: World, projectId: number) =>
    levelRows(w.store.db).find((row) => row.projectId === projectId);
  const projectsOf = async (s: UiServer) =>
    ((await (await api(s, "/api/overview")).json()) as { projects: Record<string, unknown>[] })
      .projects;
  const one = (projects: Record<string, unknown>[], id: number) =>
    projects.find((project) => project.id === id);

  test(
    "the overview carries each project's shared name, what its level is bound by, its imported memories and the name's state",
    async () => {
      const w = await world("knowledge", { named: true });
      pathProject(w.store, 3, "docs");
      insertMemory(w.store.db, {
        projectId: 2,
        kind: "decision",
        title: "An import",
        body: "Imported from claude-mem." as Redacted,
        terms: "",
        importance: 3,
        branch: null,
        commit: null,
        origin: "imported",
        judge: "claude-mem",
        judgeVersion: "1",
        sourceTurnId: null,
        files: [],
        now: w.store.clock.now,
      });
      const s = await viewerOver(w.store);
      const projects = await projectsOf(s);
      expect(one(projects, 1)).toMatchObject({
        name: "site",
        remote: true,
        sharedName: null,
        boundTo: "remote",
        imported: 0,
        nameState: null,
      });
      expect(one(projects, 2)).toMatchObject({
        name: "brand",
        remote: false,
        sharedName: "wizardingcode",
        boundTo: "name",
        imported: 1,
        nameState: "ok",
      });
      expect(one(projects, 3)).toMatchObject({
        name: "docs",
        remote: false,
        sharedName: null,
        boundTo: null,
        imported: 0,
        nameState: null,
      });
      flagName(w.store.ctx, w.serverId, NAME, "missing");
      expect(one(await projectsOf(s), 2)).toMatchObject({ nameState: "missing" });
      // At Nothing the project keeps its name, bound by nothing.
      expect((await setSharing(s, 2, { level: "local" })).status).toBe(200);
      expect(one(await projectsOf(s), 2)).toMatchObject({
        sharing: "local",
        sharedName: "wizardingcode",
        boundTo: null,
        nameState: null,
      });
    },
    LONG,
  );

  test(
    "the preview answers the dry run, names each refusal, and writes nothing",
    async () => {
      const w = await world("knowledge", { named: true });
      pathProject(w.store, 3, "docs");
      const s = await viewerOver(w.store);
      const aliases = aliasRows(w);
      const changes = changeRows(w);
      const seen = requests(w, "/v1/");
      expect(await bodyOf(await previewName(s, 3, { level: "knowledge", as: "Docs!" }))).toEqual({
        status: 200,
        body: { ok: true, boundAlias: "name:docs", named: true },
      });
      expect(await bodyOf(await previewName(s, 2, { level: "all", as: "wizardingcode" }))).toEqual({
        status: 200,
        body: { ok: true, boundAlias: NAME, named: false },
      });
      expect(
        await bodyOf(await previewName(s, 1, { level: "knowledge", as: "site" })),
      ).toMatchObject({ status: 409, body: { error: expect.any(String), reason: "has-remote" } });
      expect(
        await bodyOf(await previewName(s, 3, { level: "knowledge", as: "wizardingcode" })),
      ).toMatchObject({ status: 409, body: { reason: "name-taken", other: "brand" } });
      expect(
        await bodyOf(await previewName(s, 3, { level: "knowledge", as: "!!!" })),
      ).toMatchObject({ status: 400, body: { reason: "no-name" } });
      expect(await bodyOf(await previewName(s, 3, { level: "knowledge" }))).toMatchObject({
        status: 400,
        body: { reason: "no-name" },
      });
      expect(
        await bodyOf(await previewName(s, 999, { level: "knowledge", as: "x" })),
      ).toMatchObject({ status: 404, body: { reason: "no-project" } });
      expect(await bodyOf(await previewName(s, 3, { level: "wide", as: "x" }))).toMatchObject({
        status: 400,
        body: { reason: "invalid" },
      });
      expect(aliasRows(w)).toEqual(aliases);
      expect(changeRows(w)).toEqual(changes);
      expect(requests(w, "/v1/")).toBe(seen);
    },
    LONG,
  );

  test(
    "PUT with as creates or joins the name on the server; needs-confirm, unknown-name, exists and purged write nothing",
    async () => {
      const w = await world("knowledge");
      pathProject(w.store, 3, "docs");
      pathProject(w.store, 4, "other");
      pathProject(w.store, 5, "five");
      const s = await viewerOver(w.store);
      const posts = () => requests(w, "POST /v1/names");
      // No confirm, at Receive only too: refused before any request.
      expect(await bodyOf(await setSharing(s, 3, { level: "receive", as: "docs" }))).toMatchObject({
        status: 400,
        body: { reason: "needs-confirm" },
      });
      expect(posts()).toBe(0);
      // Without create, a name the server does not hold.
      expect(
        await bodyOf(await setSharing(s, 3, { level: "receive", as: "docs", confirm: true })),
      ).toMatchObject({ status: 404, body: { reason: "unknown-name" } });
      expect(rowOf(w, 3)).toBeUndefined();
      expect(nameByAlias(w.t.server.db, "name:docs")).toBeNull();
      // The create: the registry holds it, the audit row, the level bound with its id.
      const created = await bodyOf(
        await setSharing(s, 3, { level: "receive", as: "docs", confirm: true, create: true }),
      );
      expect(created).toEqual({
        status: 200,
        body: {
          level: "receive",
          old: "local",
          boundAlias: "name:docs",
          sharedName: "docs",
          named: true,
          created: true,
          joined: false,
        },
      });
      const onServer = nameByAlias(w.t.server.db, "name:docs");
      expect(onServer?.id).toMatch(/^[0-9a-f]{16}$/);
      expect(rowOf(w, 3)).toMatchObject({
        level: "receive",
        boundAlias: "name:docs",
        nameId: onServer?.id as string,
      });
      expect(
        w.t.server.db
          .query<{ n: number }, []>(
            "SELECT count(*) AS n FROM audit WHERE action = 'name created' AND target = 'name:docs'",
          )
          .get()?.n,
      ).toBe(1);
      expect(one(await projectsOf(s), 3)).toMatchObject({
        sharedName: "docs",
        boundTo: "name",
        nameState: "ok",
      });
      // A teammate's name: create against it is exists with the item; without create it is joined.
      const made = await teamApi(w.t.server, w.token, "POST", "/v1/names", {
        alias: "name:shared",
      });
      expect(made.status).toBe(201);
      const sharedId = (made.body as { id: string }).id;
      expect(
        await bodyOf(
          await setSharing(s, 4, { level: "receive", as: "shared", confirm: true, create: true }),
        ),
      ).toMatchObject({
        status: 409,
        body: { reason: "exists", name: { alias: "name:shared", id: sharedId } },
      });
      expect(rowOf(w, 4)).toBeUndefined();
      expect(
        await bodyOf(await setSharing(s, 4, { level: "receive", as: "shared", confirm: true })),
      ).toMatchObject({
        status: 200,
        body: { boundAlias: "name:shared", sharedName: "shared", created: false, joined: true },
      });
      expect(rowOf(w, 4)).toMatchObject({ nameId: sharedId });
      // A name the operator removed.
      const gone = await teamApi(w.t.server, w.token, "POST", "/v1/names", { alias: "name:gone" });
      expect(gone.status).toBe(201);
      expect(purgeName(w.t.server.db, "name:gone", w.t.clock.now)).toBe("purged");
      expect(
        await bodyOf(
          await setSharing(s, 5, { level: "receive", as: "gone", confirm: true, create: true }),
        ),
      ).toMatchObject({ status: 409, body: { reason: "purged" } });
      expect(rowOf(w, 5)).toBeUndefined();
    },
    LONG,
  );

  test(
    "every local refusal is decided before the server is asked",
    async () => {
      const w = await world("knowledge", { named: true });
      pathProject(w.store, 3, "docs");
      const s = await viewerOver(w.store);
      const seen = requests(w, "/v1/");
      const put = async (id: number, body: Record<string, unknown>) =>
        bodyOf(await setSharing(s, id, { confirm: true, create: true, ...body }));
      expect(await put(1, { level: "knowledge", as: "site" })).toMatchObject({
        status: 409,
        body: { reason: "has-remote" },
      });
      expect(await put(3, { level: "knowledge", as: "wizardingcode" })).toMatchObject({
        status: 409,
        body: { reason: "name-taken", other: "brand" },
      });
      expect(await put(2, { level: "all", as: "other" })).toMatchObject({
        status: 409,
        body: { reason: "renamed" },
      });
      w.store.db.run("UPDATE projects SET disabled = 1 WHERE id = 3");
      expect(await put(3, { level: "knowledge", as: "docs" })).toMatchObject({
        status: 409,
        body: { reason: "disabled" },
      });
      w.store.db.run("UPDATE projects SET disabled = 0 WHERE id = 3");
      expect(await put(3, { level: "knowledge", as: "!!!" })).toMatchObject({
        status: 400,
        body: { reason: "no-name" },
      });
      expect(await put(3, { level: "knowledge", as: "con" })).toMatchObject({
        status: 400,
        body: { error: expect.stringContaining("reserved"), reason: "no-name" },
      });
      expect(requests(w, "/v1/")).toBe(seen);
      expect(rowOf(w, 3)).toBeUndefined();
    },
    LONG,
  );

  test(
    "a server that cannot be reached is 502 unreachable; a row at 1 reads /v1/me once and is 409 contract; a bare 404 is 409 contract and sets the row to 1",
    async () => {
      const store = openSyncStore({ fetch: (input, init) => fetch(input, init) });
      stores.push(store);
      insertPending(store.db, serverFixture("s1", { url: "http://127.0.0.1:1", contract: 2 }));
      store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = 's1'", [
        store.clock.now,
      ]);
      writeToken(store.ctx, "s1", `wcm1_${"t".repeat(43)}`);
      pathProject(store, 3, "docs");
      const s = await viewerOver(store);
      expect(
        await bodyOf(
          await setSharing(s, 3, { level: "knowledge", as: "docs", confirm: true, create: true }),
        ),
      ).toMatchObject({ status: 502, body: { reason: "unreachable" } });
      expect(levelRows(store.db)).toEqual([]);
      await s.stop();
      server = undefined;

      const at1 = await world("knowledge", { server: { contract: { current: 1, accepted: [1] } } });
      pathProject(at1.store, 3, "docs");
      const v = await viewerOver(at1.store);
      expect(at1.server().contract).toBe(1);
      const mes = () => requests(at1, "/v1/me");
      const before = mes();
      expect(
        await bodyOf(
          await setSharing(v, 3, { level: "knowledge", as: "docs", confirm: true, create: true }),
        ),
      ).toMatchObject({ status: 409, body: { reason: "contract" } });
      expect(mes()).toBe(before + 1);
      expect(requests(at1, "/v1/names")).toBe(0);
      setContract(at1.store.db, at1.serverId, 2);
      expect(
        await bodyOf(
          await setSharing(v, 3, { level: "knowledge", as: "docs", confirm: true, create: true }),
        ),
      ).toMatchObject({ status: 409, body: { reason: "contract" } });
      expect(at1.server().contract).toBe(1);
      expect(mes()).toBe(before + 1);
      expect(rowOf(at1, 3)).toBeUndefined();
    },
    LONG,
  );

  test(
    "a level set without as on a project at Nothing that carries a name goes through the bind: needs-confirm with no request, then the join with the registry's id",
    async () => {
      const w = await world("knowledge", { named: true });
      const s = await viewerOver(w.store);
      expect((await setSharing(s, 2, { level: "local" })).status).toBe(200);
      expect(rowOf(w, 2)).toBeUndefined();
      const posts = () => requests(w, "POST /v1/names");
      const before = posts();
      // Receive only is no widening, but the name is a binding: confirmed by name, at every level.
      expect(await bodyOf(await setSharing(s, 2, { level: "receive" }))).toMatchObject({
        status: 400,
        body: { reason: "needs-confirm" },
      });
      expect(posts()).toBe(before);
      expect(rowOf(w, 2)).toBeUndefined();
      expect(
        await bodyOf(await setSharing(s, 2, { level: "receive", confirm: true })),
      ).toMatchObject({
        status: 200,
        body: { boundAlias: NAME, sharedName: "wizardingcode", joined: true, created: false },
      });
      expect(rowOf(w, 2)).toMatchObject({ level: "receive", boundAlias: NAME, nameId: w.nameId });
      expect(posts()).toBe(before);
    },
    LONG,
  );

  test("statusOf maps a refusal to its status and keeps named", () => {
    expect(statusOf({ ok: false, reason: "disabled", named: true })).toEqual({
      status: 409,
      body: { error: expect.any(String), reason: "disabled", named: true },
    });
    expect(statusOf({ ok: false, reason: "exists", name: null })).toMatchObject({
      status: 409,
      body: { reason: "exists", name: null },
    });
    expect(statusOf({ ok: false, reason: "unknown-name" })).toMatchObject({ status: 404 });
    expect(statusOf({ ok: false, reason: "unreachable", message: "x" })).toMatchObject({
      status: 502,
      body: { reason: "unreachable" },
    });
    expect(statusOf({ ok: false, reason: "name-taken", other: "brand" })).toMatchObject({
      status: 409,
      body: { reason: "name-taken", other: "brand" },
    });
  });

  test(
    "DELETE /api/projects/<id>/name forgets a name at Nothing; refused while bound, without a name, or for an unknown project",
    async () => {
      const w = await world("knowledge", { named: true });
      pathProject(w.store, 3, "docs");
      const s = await viewerOver(w.store);
      expect(await bodyOf(await forget(s, 2))).toMatchObject({
        status: 409,
        body: { reason: "name-bound" },
      });
      expect(await bodyOf(await forget(s, 3))).toMatchObject({
        status: 404,
        body: { reason: "no-name" },
      });
      expect(await bodyOf(await forget(s, 999))).toMatchObject({
        status: 404,
        body: { reason: "no-project" },
      });
      expect((await setSharing(s, 2, { level: "local" })).status).toBe(200);
      expect(await bodyOf(await forget(s, 2))).toEqual({
        status: 200,
        body: { forgotten: true, sharedName: "wizardingcode" },
      });
      expect(aliasRows(w).filter((row) => row.projectId === 2)).toEqual([
        { alias: "path:/work/brand", projectId: 2 },
      ]);
      expect(changeRows(w).at(-1)).toEqual({ what: "name:2" });
      expect(one(await projectsOf(s), 2)).toMatchObject({ sharedName: null });
      expect(await bodyOf(await forget(s, 2))).toMatchObject({
        status: 404,
        body: { reason: "no-name" },
      });
    },
    LONG,
  );
});
