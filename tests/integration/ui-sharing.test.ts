// The viewer's sharing routes: what the policy is, what a change would release, a project's
// level, and the two sharing lists saved through the settings. Each case runs the real
// server over its own data directory, with a project whose folder has a git remote. The
// knowledge entries are written by the knowledge store into real repositories.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import { DEFAULT_AREAS } from "../../src/modules/knowledge/entry.ts";
import { resetGitCaches } from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import { openStore } from "../../src/modules/knowledge/store-open.ts";
import type { ScopeRef } from "../../src/modules/knowledge/types.ts";
import { epochOf } from "../../src/sharing/levels.ts";
import { loadPolicy } from "../../src/sharing/policy.ts";
import { applySettingsPatch, counterOf, setLevel } from "../../src/sharing/store.ts";
import type { Level } from "../../src/sharing/types.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { startUi, type UiServer } from "../../src/ui/server.ts";
import { realGit } from "../helpers/stub-git.ts";

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
  perProject: { id: number; level: Level; entries: number; memories: number }[];
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
    expect(view.levels).toEqual({ local: 1, knowledge: 0, all: 0 });
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
        { id: projectId, level: "local", entries: 0, memories: 0 },
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
        { id: projectId, level: "knowledge", entries: 1, memories: 0 },
      ]);
      expect(report.counts).toEqual({ entries: 1, memories: 0 });
      expect(report.items).toBeUndefined();

      expect(levels()).toEqual([]);
      expect(changes()).toHaveLength(1);
      const view = await sharing(s);
      expect(view.report.counts.entries).toBe(0);
      expect(view.levels).toEqual({ local: 1, knowledge: 0, all: 0 });
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
      expect(typeof (await errorOf(response))).toBe("string");
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
    expect(await errorOf(unconfirmed)).toContain("confirm: true");
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
    expect(await lowered.json()).toEqual({ level: "local", old: "knowledge", boundAlias: "" });
    expect(levels()).toEqual([]);
    expect((await listed(s))[0]).toMatchObject({ sharing: "local", sharingReason: "level-local" });
  });

  test("what can never be set is refused before any confirmation is asked for", async () => {
    const plain = plainProject();
    const s = await start();
    expect((await setSharing(s, projectId, { level: "wide" })).status).toBe(400);
    expect((await setSharing(s, projectId, {})).status).toBe(400);
    expect((await setSharing(s, 999, { level: "knowledge" })).status).toBe(404);

    const noRemote = await setSharing(s, plain, { level: "knowledge" });
    expect(noRemote.status).toBe(409);
    expect(await errorOf(noRemote)).toContain("no git remote");
    expect((await setSharing(s, plain, { level: "knowledge", confirm: true })).status).toBe(409);
    // Nothing is what it shares already.
    expect((await setSharing(s, plain, { level: "local" })).status).toBe(200);

    withDb((db) => db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [projectId]));
    const off = await setSharing(s, projectId, { level: "knowledge" });
    expect(off.status).toBe(409);
    expect(await errorOf(off)).toContain("memory is off for this project");
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
        "INSERT INTO module_migrations (module, version, name, applied_at) VALUES ('sharing', 2, 'x', 0)",
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
    expect(await errorOf(set)).toContain("newer");
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
