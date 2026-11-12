// `share project --as`, `share names`, `share name forget` and `share status` with a shared name
// (ADR 0028), through the binary against the in-process team server.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { levelRows, setLevel } from "../../src/sharing/store.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { insertPending, setContract, writeToken } from "../../src/sync/servers.ts";
import { flagName } from "../../src/sync/state.ts";
import { insertName, nameByAlias, purgeName } from "../../src/team/store.ts";
import { runCliWith } from "../helpers/cli.ts";
import { realGit } from "../helpers/stub-git.ts";
import { serverFixture } from "../helpers/sync.ts";
import { cleanWorlds, closeWorlds, type World, world } from "../helpers/sync-world.ts";
import { api, memberOf } from "../helpers/team.ts";

const LONG = 120_000;
const dirs: string[] = [];
afterEach(async () => {
  await closeWorlds();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => cleanWorlds());

const env = (w: World) => ({
  PATH: process.env.PATH ?? "",
  HOME: w.store.dataDir,
  WIZARDINGCODE_HOME: w.store.dataDir,
  WIZARDINGCODE_MEM_DATA_DIR: w.store.dataDir,
  WIZARDINGCODE_MEM_MIGRATE: "off",
  WIZARDINGCODE_MEM_DISTILL: "off",
  WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
  WIZARDINGCODE_MEM_UI_BROWSER: "none",
  WIZARDINGCODE_MEM_SYNC: "off",
});

/** A plain folder named `name`, known to the world's store as a project by its path alone. */
function folderProject(w: World, name: string): { folder: string; id: number } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "wcm-share-names-")));
  dirs.push(base);
  const folder = join(base, name);
  mkdirSync(folder);
  return { folder, id: resolveProject(w.store.db, folder, 1).id };
}

/** A folder with a git remote, known to the store: a project a team matches by its remote. */
function remoteProject(w: World, name: string): { folder: string; id: number } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "wcm-share-names-")));
  dirs.push(base);
  const folder = join(base, name);
  mkdirSync(folder);
  realGit(folder, "init", "-q");
  realGit(folder, "remote", "add", "origin", `https://github.com/acme/${name}.git`);
  return { folder, id: resolveProject(w.store.db, folder, 1).id };
}

const share = (w: World, cwd: string, ...args: string[]) =>
  runCliWith({ env: env(w), cwd }, "share", ...args);
const requests = (w: World, route: string) =>
  w.t.lines.filter((line) => line.includes(`"route":"${route}"`)).length;
const rowOf = (w: World, projectId: number) =>
  levelRows(w.store.db).find((row) => row.projectId === projectId);

describe("share project --as", () => {
  test(
    "--as with --server naming a server the project is not bound to while bound to another: one-server before any request",
    async () => {
      const w = await world("knowledge");
      const { folder, id } = folderProject(w, "docs");
      insertPending(w.store.db, serverFixture("s2"));
      w.store.db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = 's2'", [
        w.store.clock.now,
      ]);
      writeToken(w.store.ctx, "s2", `wcm1_${"t".repeat(43)}`);
      expect(
        setLevel(w.store.db, {
          projectId: id,
          destination: "s2",
          level: "receive",
          source: "cli",
          now: w.store.clock.now,
          confirm: true,
          as: "name:docs",
        }),
      ).toMatchObject({ ok: true });
      const seen = w.t.lines.filter((line) => line.includes('"event":"request"')).length;
      const refused = await share(
        w,
        folder,
        "project",
        "knowledge",
        "--as",
        "docs",
        "--server",
        w.serverId,
        "--create",
        "--yes",
      );
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain("bound to s2");
      expect(w.t.lines.filter((line) => line.includes('"event":"request"')).length).toBe(seen);
      expect(rowOf(w, id)).toMatchObject({ level: "receive", boundAlias: "name:docs" });
    },
    LONG,
  );

  test(
    "creates the name with --create after the question, binds and says so; without --yes nothing is asked of the server; status, forget and the usage",
    async () => {
      const w = await world("knowledge");
      const { folder, id } = folderProject(w, "brand");
      const serverName = w.server().name;
      const question = `Create \`estrategia-de-marca\` on ${serverName}, visible to every member, and share knowledge and memories of brand as it?`;

      const noYes = await share(
        w,
        folder,
        "project",
        "all",
        "--as",
        "Estratégia de marca",
        "--create",
      );
      expect(noYes.exitCode).toBe(1);
      expect(noYes.stdout).toContain(question);
      expect(noYes.stderr).toContain("--yes");
      expect(nameByAlias(w.t.server.db, "name:estrategia-de-marca")).toBeNull();
      expect(requests(w, "POST /v1/names")).toBe(0);
      expect(rowOf(w, id)).toBeUndefined();

      // One imported memory (claude-mem's): it never leaves, and the question and the answer say so (D-6).
      insertMemory(w.store.db, {
        projectId: id,
        kind: "decision",
        title: "An old import",
        body: "From claude-mem." as Redacted,
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
      const yes = await share(
        w,
        folder,
        "project",
        "all",
        "--as",
        "Estratégia de marca",
        "--create",
        "--yes",
      );
      expect(yes.stderr).toBe("");
      expect(yes.exitCode).toBe(0);
      expect(yes.stdout).toContain(question);
      expect(yes.stdout).toContain("would leave: 0 entries · 0 memories · 1 imported memory stays");
      expect(yes.stdout).toContain(
        "sharing: brand → Knowledge and memories, shared as estrategia-de-marca",
      );
      expect(yes.stdout.trimEnd().endsWith("\n1 imported memory stays")).toBe(true);
      const created = nameByAlias(w.t.server.db, "name:estrategia-de-marca");
      expect(created).not.toBeNull();
      expect(rowOf(w, id)).toMatchObject({
        level: "all",
        boundAlias: "name:estrategia-de-marca",
        nameId: created?.id,
      });

      // A level change on the bound name needs no server and keeps the name.
      const lower = await share(w, folder, "project", "knowledge", "--yes");
      expect(lower.exitCode).toBe(0);
      expect(lower.stdout).toBe("sharing: brand → Knowledge, shared as estrategia-de-marca\n");
      expect(requests(w, "POST /v1/names")).toBe(1);

      // status: shared as, and the name's state.
      const status = await share(w, folder, "status");
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain("brand: Knowledge (bound to name:estrategia-de-marca)");
      expect(status.stdout).toContain("shared as estrategia-de-marca");
      flagName(w.store.ctx, w.serverId, "name:estrategia-de-marca", "missing");
      expect((await share(w, folder, "status")).stdout).toContain("(missing on the server)");
      flagName(w.store.ctx, w.serverId, "name:estrategia-de-marca", "recreated", {
        id: "0123456789abcdef",
        member: { id: "m", name: "Bob" },
      });
      expect((await share(w, folder, "status")).stdout).toContain("(re-created on the server)");
      flagName(w.store.ctx, w.serverId, "name:estrategia-de-marca", "purged");
      expect((await share(w, folder, "status")).stdout).toContain("(removed by the operator)");
      setContract(w.store.db, w.serverId, 1);
      expect((await share(w, folder, "status")).stdout).toContain("names held");
      setContract(w.store.db, w.serverId, 2);

      // forget: refused while bound, then at Nothing.
      const bound = await share(w, folder, "name", "forget");
      expect(bound.exitCode).toBe(1);
      expect(bound.stderr).toContain("set it to Nothing first");
      expect((await share(w, folder, "project", "local", "--yes")).exitCode).toBe(0);
      const forgot = await share(w, folder, "name", "forget");
      expect(forgot.exitCode).toBe(0);
      expect(forgot.stdout).toBe("forgot the shared name estrategia-de-marca of brand\n");
      const none = await share(w, folder, "name", "forget");
      expect(none.exitCode).toBe(1);
      expect(none.stderr).toContain("no shared name");
      // The last change renders through formatChange.
      expect((await share(w, folder, "status")).stdout).toContain(
        "shared name of brand: name:estrategia-de-marca → none",
      );

      const usage = await share(w, folder);
      expect(usage.exitCode).toBe(64);
      for (const word of ["--as", "--create", "names", "name forget"]) {
        expect(usage.stderr).toContain(word);
      }
    },
    LONG,
  );

  test(
    "joins a live name after its question; the refusals: unheld without --create, --create against a live name, a purged name, a remote project, a reserved word; share names lists every page",
    async () => {
      const w = await world("knowledge");
      const bob = await memberOf(w.t, w.token, "Bob", "desk");
      expect(
        (await api(w.t.server, bob.token, "POST", "/v1/names", { alias: "name:x" })).status,
      ).toBe(201);
      const docs = folderProject(w, "docs");
      const serverName = w.server().name;

      const empty = await share(w, docs.folder, "names");
      expect(empty.exitCode).toBe(0);
      expect(empty.stdout).toContain("x  created by Bob  0 entries, 0 memories  last");

      const joined = await share(w, docs.folder, "project", "receive", "--as", "x", "--yes");
      expect(joined.stderr).toBe("");
      expect(joined.exitCode).toBe(0);
      expect(joined.stdout).toContain(
        "Join `x`, created by Bob (0 entries, 0 memories), and receive it into docs?",
      );
      expect(joined.stdout).toContain("sharing: docs → Receive only, shared as x");
      expect(rowOf(w, docs.id)).toMatchObject({ level: "receive", boundAlias: "name:x" });

      const pages = folderProject(w, "pages");
      const unheld = await share(w, pages.folder, "project", "knowledge", "--as", "y", "--yes");
      expect(unheld.exitCode).toBe(1);
      expect(unheld.stderr).toContain(`no shared name \`y\` on ${serverName}`);
      expect(unheld.stderr).toContain("--create");
      expect(unheld.stderr).toContain("share names");
      expect(rowOf(w, pages.id)).toBeUndefined();
      expect(nameByAlias(w.t.server.db, "name:y")).toBeNull();

      expect(
        (await api(w.t.server, bob.token, "POST", "/v1/names", { alias: "name:shared" })).status,
      ).toBe(201);
      const taken = await share(
        w,
        pages.folder,
        "project",
        "knowledge",
        "--as",
        "shared",
        "--create",
        "--yes",
      );
      expect(taken.exitCode).toBe(1);
      expect(taken.stderr).toContain("created by Bob (0 entries, 0 memories)");
      expect(taken.stderr).toContain("run without --create to join it");

      expect(
        (await api(w.t.server, bob.token, "POST", "/v1/names", { alias: "name:old" })).status,
      ).toBe(201);
      expect(purgeName(w.t.server.db, "name:old", w.store.clock.now)).toBe("purged");
      const purged = await share(
        w,
        pages.folder,
        "project",
        "knowledge",
        "--as",
        "old",
        "--create",
        "--yes",
      );
      expect(purged.exitCode).toBe(1);
      expect(purged.stderr).toContain(
        `the operator removed \`old\` from ${serverName}; pick another name`,
      );

      const site = remoteProject(w, "site");
      const before = requests(w, "GET /v1/names/name%3Az");
      const remote = await share(w, site.folder, "project", "knowledge", "--as", "z", "--yes");
      expect(remote.exitCode).toBe(1);
      expect(remote.stderr).toContain("matched by its git remote");
      expect(requests(w, "GET /v1/names/name%3Az")).toBe(before);

      const reserved = await share(w, pages.folder, "project", "knowledge", "--as", "CON", "--yes");
      expect(reserved.exitCode).toBe(1);
      expect(reserved.stderr).toContain("`con`");

      // Every page of the registry, the bound one marked.
      for (let i = 0; i < 120; i++) {
        insertName(w.t.server.db, {
          alias: `name:seed-${String(i).padStart(3, "0")}`,
          id: i.toString(16).padStart(16, "0"),
          memberId: bob.memberId,
          deviceId: bob.deviceId,
          at: w.store.clock.now,
        });
      }
      const listed = await share(w, docs.folder, "names");
      expect(listed.exitCode).toBe(0);
      const lines = listed.stdout.trim().split("\n");
      expect(lines).toHaveLength(122);
      expect(lines.filter((line) => line.startsWith("* "))).toEqual([
        expect.stringContaining("* x  created by Bob"),
      ]);
      expect(lines.filter((line) => line.includes("seed-119"))).toHaveLength(1);

      const fresh = await world("knowledge");
      const nothing = folderProject(fresh, "nothing");
      expect((await share(fresh, nothing.folder, "names")).stdout).toBe("none yet\n");
    },
    LONG,
  );

  test(
    "against a server at contract 1 the create is refused after one /v1/me read, with no POST",
    async () => {
      const w = await world("knowledge", { server: { contract: { current: 1, accepted: [1] } } });
      const { folder, id } = folderProject(w, "brand");
      const mes = requests(w, "GET /v1/me");
      const refused = await share(
        w,
        folder,
        "project",
        "knowledge",
        "--as",
        "x",
        "--create",
        "--yes",
      );
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain("speaks contract 1");
      expect(requests(w, "GET /v1/me")).toBe(mes + 1);
      expect(requests(w, "POST /v1/names")).toBe(0);
      expect(rowOf(w, id)).toBeUndefined();
      // The row at 2 against the same server: the bare 404 says the same and sets the row to 1.
      setContract(w.store.db, w.serverId, 2);
      const again = await share(
        w,
        folder,
        "project",
        "knowledge",
        "--as",
        "x",
        "--create",
        "--yes",
      );
      expect(again.exitCode).toBe(1);
      expect(again.stderr).toContain("speaks contract 1");
      expect(w.server().contract).toBe(1);
    },
    LONG,
  );
});
