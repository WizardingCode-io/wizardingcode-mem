import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectFolderName } from "../../src/modules/knowledge/repo.ts";
import { entryUid } from "../../src/sharing/types.ts";
import { teamPaths } from "../../src/team/db.ts";
import { LeaseHeldError } from "../../src/team/errors.ts";
import { OPERATOR } from "../../src/team/ids.ts";
import { MIRROR_LEASE, MIRROR_TTL_MS } from "../../src/team/lease.ts";
import { createTeamLog } from "../../src/team/log.ts";
import {
  fileNameFor,
  memberIdentity,
  purgeItem,
  repoFolder,
  runMirror,
  SERVER_IDENTITY,
  scheduleMirror,
} from "../../src/team/mirror.ts";
import {
  claimLease,
  entryByUuid,
  explainPendingMirror,
  getMeta,
  leaseOf,
  memoryByKey,
  setMeta,
} from "../../src/team/store.ts";
import { MAIN } from "../helpers/cli.ts";
import { realGit, stubGit } from "../helpers/stub-git.ts";
import {
  ALIAS_A,
  ALIAS_B,
  adminOf,
  cleanTestDirs,
  entryPayload,
  eventsOf,
  fakeTimers,
  type Joined,
  memberOf,
  memoryPayload,
  pushOne,
  rehashed,
  sendOf,
  startTestServer,
  type TestServer,
} from "../helpers/team.ts";

const open: TestServer[] = [];
const start = async (overrides = {}) => {
  const t = await startTestServer(overrides);
  open.push(t);
  return t;
};
afterEach(async () => {
  for (const t of open.splice(0)) await t.close();
});
afterAll(() => cleanTestDirs());

interface Team {
  t: TestServer;
  admin: Joined;
  ana: Joined;
  rui: Joined;
}

async function team(overrides = {}): Promise<Team> {
  const t = await start(overrides);
  const admin = await adminOf(t, "Admin");
  const ana = await memberOf(t, admin.token, "Ana");
  const rui = await memberOf(t, admin.token, "Rui");
  return { t, admin, ana, rui };
}

const uuidOf = (uid: string) => uid.slice(-36);

/** The mirror's context over a test server, with git found on the test's own PATH. */
function mirrorCtx(t: TestServer, gitPath?: string) {
  return {
    db: t.server.db,
    dataDir: t.dir,
    env: { PATH: process.env.PATH ?? "", HOME: join(t.dir, "home") },
    ...(gitPath === undefined ? {} : { gitPath }),
    log: createTeamLog(
      (line) => t.lines.push(line),
      () => t.clock.now,
    ),
    now: () => t.clock.now,
  };
}

const repos = (t: TestServer) => teamPaths(t.dir).repos;
const sharedRepo = (t: TestServer) => join(repos(t), "shared");

/** The commits oldest first: subject, author name, author email, committer name, committer email, body. */
function commitsOf(
  repo: string,
): { subject: string; an: string; ae: string; cn: string; ce: string; body: string }[] {
  const raw = realGit(
    repo,
    "log",
    "--reverse",
    "--format=%s%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%b%x1e",
  );
  return raw
    .split("\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [subject, an, ae, cn, ce, body] = record.split("\x1f");
      return {
        subject: subject as string,
        an: an as string,
        ae: ae as string,
        cn: cn as string,
        ce: ce as string,
        body: (body ?? "").trim(),
      };
    });
}

const filesAt = (repo: string) =>
  realGit(repo, "ls-files")
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .sort();
const lastRun = (t: TestServer) =>
  JSON.parse(getMeta(t.server.db, "mirror.last") ?? "null") as {
    at: number;
    commits: number;
    error: string | null;
  } | null;

describe("the export", () => {
  test("two revisions and a withdraw: the files, the commits in order with authors, committer and trailers, the marks; a second run commits nothing", async () => {
    const { t, ana, rui } = await team();
    const a1 = entryPayload({ scope: "shared", slug: "alpha", body: "one" });
    const a2 = rehashed({ ...a1, body: "two\n" });
    const b = entryPayload({ scope: "shared", slug: "beta" });
    await pushOne(t.server, ana.token, sendOf(a1));
    await pushOne(t.server, ana.token, sendOf(a2, { baseRevision: 1, baseHash: a1.hash }));
    await pushOne(t.server, rui.token, sendOf(b));
    await pushOne(t.server, rui.token, {
      op: "withdraw",
      kind: "entry",
      uid: b.uid,
      baseRevision: 1,
      baseHash: b.hash,
    });

    const run = await runMirror(mirrorCtx(t), { rebuild: false });
    expect(run).toEqual({ commits: 4, errors: [] });
    const repo = sharedRepo(t);
    const aFile = fileNameFor(uuidOf(a1.uid), "alpha");
    expect(aFile).toBe(`entries/alpha--${uuidOf(a1.uid).slice(0, 8)}.md`);
    expect(readFileSync(join(repo, aFile), "utf8")).toBe(a2.frontmatter + a2.body);
    expect(existsSync(join(repo, fileNameFor(uuidOf(b.uid), "beta")))).toBe(false);
    expect(filesAt(repo)).toEqual(["entries/.gitkeep", aFile, "knowledge.json"].sort());
    const commits = commitsOf(repo);
    expect(commits.map((c) => c.subject)).toEqual([
      "team: init shared",
      `team: send ${a1.uid}`,
      `team: send ${a1.uid}`,
      `team: send ${b.uid}`,
      `team: withdraw ${b.uid}`,
    ]);
    expect(commits[0]).toMatchObject({ an: SERVER_IDENTITY.name, ae: SERVER_IDENTITY.email });
    expect(commits[1]).toMatchObject({
      an: "Ana",
      ae: `${ana.memberId}@members.wizardingcode.invalid`,
      cn: SERVER_IDENTITY.name,
      ce: SERVER_IDENTITY.email,
    });
    expect(commits[3]).toMatchObject({
      an: "Rui",
      ae: `${rui.memberId}@members.wizardingcode.invalid`,
    });
    expect(commits[2]?.body).toBe(`Revision: 2\nUid: ${a1.uid}\nHash: ${a2.hash}`);
    expect(commits[4]?.body).toBe(`Revision: 2\nUid: ${b.uid}\nHash: ${b.hash}`);
    expect(memberIdentity({ id: "m1", name: "Ana" })).toEqual({
      name: "Ana",
      email: "m1@members.wizardingcode.invalid",
    });
    expect(entryByUuid(t.server.db, uuidOf(a1.uid))?.mirror_revision).toBe(2);
    expect(entryByUuid(t.server.db, uuidOf(b.uid))?.mirror_revision).toBe(2);
    expect(lastRun(t)).toEqual({ at: t.clock.now, commits: 4, error: null });
    const manifest = JSON.parse(readFileSync(join(repo, "knowledge.json"), "utf8"));
    expect(manifest).toMatchObject({ format: 1, scope: "shared", mirror: true });

    const head = realGit(repo, "rev-parse", "HEAD");
    const again = await runMirror(mirrorCtx(t), { rebuild: false });
    expect(again).toEqual({ commits: 0, errors: [] });
    expect(realGit(repo, "rev-parse", "HEAD")).toBe(head);
    expect(lastRun(t)?.commits).toBe(0);
    expect(leaseOf(t.server.db, MIRROR_LEASE)).toBeNull();
  });

  test("a slug change renames the file in one commit; a move to another alias removes it there and writes it here", async () => {
    const { t, ana } = await team();
    const p = entryPayload({ scope: "project", remoteAlias: ALIAS_A, slug: "first" });
    await pushOne(t.server, ana.token, sendOf(p));
    await runMirror(mirrorCtx(t), { rebuild: false });
    const folderA = join(repos(t), repoFolder("project", ALIAS_A, null));
    expect(repoFolder("project", ALIAS_A, null)).toBe(
      `projects/github-com-acme-site-${projectFolderName(ALIAS_A).slice(0, 8)}`,
    );
    const uuid = uuidOf(p.uid);
    expect(existsSync(join(folderA, fileNameFor(uuid, "first")))).toBe(true);
    const renamed = { ...p, slug: "second" };
    await pushOne(t.server, ana.token, sendOf(renamed, { baseRevision: 1, baseHash: p.hash }));
    expect((await runMirror(mirrorCtx(t), { rebuild: false })).commits).toBe(1);
    expect(existsSync(join(folderA, fileNameFor(uuid, "first")))).toBe(false);
    expect(existsSync(join(folderA, fileNameFor(uuid, "second")))).toBe(true);
    const renameCommit = commitsOf(folderA).at(-1);
    expect(renameCommit?.subject).toBe(`team: send ${p.uid}`);
    expect(
      realGit(folderA, "show", "--name-status", "--no-renames", "--format=", "HEAD")
        .trim()
        .split("\n")
        .sort(),
    ).toEqual([`A\t${fileNameFor(uuid, "second")}`, `D\t${fileNameFor(uuid, "first")}`]);

    const moved = { ...renamed, uid: entryUid("project", ALIAS_B, uuid), remoteAlias: ALIAS_B };
    await pushOne(t.server, ana.token, sendOf(moved, { baseRevision: 2, baseHash: p.hash }));
    expect((await runMirror(mirrorCtx(t), { rebuild: false })).commits).toBe(1);
    const folderB = join(repos(t), repoFolder("project", ALIAS_B, null));
    expect(existsSync(join(folderA, fileNameFor(uuid, "second")))).toBe(false);
    expect(readFileSync(join(folderB, fileNameFor(uuid, "second")), "utf8")).toBe(
      p.frontmatter + p.body,
    );
    expect(commitsOf(folderA).at(-1)?.subject).toBe(`team: move ${moved.uid}`);
    expect(commitsOf(folderB).map((c) => c.subject)).toEqual([
      `team: init project`,
      `team: send ${moved.uid}`,
    ]);
    expect(JSON.parse(readFileSync(join(folderB, "knowledge.json"), "utf8"))).toMatchObject({
      scope: "project",
      remoteAlias: ALIAS_B,
      mirror: true,
    });
  });

  test("members' folders come from the id and the slug of the name, never the raw name", async () => {
    const { t, admin } = await team();
    const names = ["../x", "a/b", ".", "-rf"];
    const members: Joined[] = [];
    for (const name of names) members.push(await memberOf(t, admin.token, name));
    for (const member of members) {
      await pushOne(
        t.server,
        member.token,
        sendOf(entryPayload({ scope: "workspace", slug: "note" })),
      );
    }
    expect((await runMirror(mirrorCtx(t), { rebuild: false })).errors).toEqual([]);
    const folders = readdirSync(join(repos(t), "members")).sort();
    expect(folders).toEqual(
      [
        `${members[0]?.memberId}-x`,
        `${members[1]?.memberId}-a-b`,
        `${members[2]?.memberId}-member`,
        `${members[3]?.memberId}-rf`,
      ].sort(),
    );
    expect(readdirSync(repos(t)).sort()).toEqual(["members"]);
    for (const [index, member] of members.entries()) {
      const folder = join(
        repos(t),
        repoFolder("workspace", null, { id: member.memberId, name: names[index] as string }),
      );
      expect(JSON.parse(readFileSync(join(folder, "knowledge.json"), "utf8"))).toMatchObject({
        scope: "workspace",
        memberId: member.memberId,
        memberName: names[index],
        mirror: true,
      });
    }
  });
});

describe("failures, repair, rebuild, purge", () => {
  test("a failing commit is recorded for its repository, the others are exported, and the next run exports it", async () => {
    const { t, ana } = await team();
    const shared = entryPayload({ scope: "shared", slug: "s" });
    const project = entryPayload({ scope: "project", remoteAlias: ALIAS_A, slug: "p" });
    await pushOne(t.server, ana.token, sendOf(shared));
    await pushOne(t.server, ana.token, sendOf(project));
    expect((await runMirror(mirrorCtx(t), { rebuild: false })).commits).toBe(2);
    await pushOne(
      t.server,
      ana.token,
      sendOf(rehashed({ ...shared, body: "s2\n" }), { baseRevision: 1, baseHash: shared.hash }),
    );
    await pushOne(
      t.server,
      ana.token,
      sendOf(rehashed({ ...project, body: "p2\n" }), { baseRevision: 1, baseHash: project.hash }),
    );
    const stub = stubGit(join(t.dir, "stub-fail"), { failOnce: "commit", stderr: "fatal: boom" });
    const run = await runMirror(mirrorCtx(t, stub), { rebuild: false });
    expect(run.commits).toBe(1);
    expect(run.errors).toHaveLength(1);
    expect(run.errors[0]?.folder).toBe("shared");
    expect(run.errors[0]?.message).toContain("boom");
    expect(lastRun(t)?.error).toContain("shared");
    expect(entryByUuid(t.server.db, uuidOf(shared.uid))?.mirror_revision).toBe(1);
    expect(entryByUuid(t.server.db, uuidOf(project.uid))?.mirror_revision).toBe(2);
    const next = await runMirror(mirrorCtx(t), { rebuild: false });
    expect(next).toEqual({ commits: 1, errors: [] });
    expect(entryByUuid(t.server.db, uuidOf(shared.uid))?.mirror_revision).toBe(2);
    expect(
      readFileSync(join(sharedRepo(t), fileNameFor(uuidOf(shared.uid), "s")), "utf8"),
    ).toContain("s2");
  });

  test("a folder with .git and no HEAD is completed; a stale index.lock is removed before the first git call", async () => {
    const { t, ana } = await team();
    const folder = join(repos(t), repoFolder("project", ALIAS_B, null));
    mkdirSync(folder, { recursive: true });
    realGit(folder, "init", "-q", "--template=", folder);
    writeFileSync(join(folder, ".git", "index.lock"), "");
    expect(realGit(folder, "rev-parse", "--is-inside-work-tree").trim()).toBe("true");
    await pushOne(
      t.server,
      ana.token,
      sendOf(entryPayload({ scope: "project", remoteAlias: ALIAS_B, slug: "q" })),
    );
    expect((await runMirror(mirrorCtx(t), { rebuild: false })).errors).toEqual([]);
    expect(existsSync(join(folder, ".git", "index.lock"))).toBe(false);
    expect(commitsOf(folder).map((c) => c.subject)).toEqual([
      "team: init project",
      expect.stringMatching(/^team: send project:/),
    ]);
  });

  test("--rebuild after a repository was deleted by hand rewrites it in order while the server holds its lease", async () => {
    const { t, ana, rui } = await team();
    const a = entryPayload({ scope: "shared", slug: "a" });
    await pushOne(t.server, ana.token, sendOf(a));
    await pushOne(
      t.server,
      rui.token,
      sendOf(rehashed({ ...a, body: "two\n" }), { baseRevision: 1, baseHash: a.hash }),
    );
    const w = entryPayload({ scope: "workspace", slug: "w" });
    await pushOne(t.server, ana.token, sendOf(w));
    await runMirror(mirrorCtx(t), { rebuild: false });
    const before = commitsOf(sharedRepo(t)).map((c) => [c.subject, c.an, c.body]);
    const beforeFiles = filesAt(sharedRepo(t));
    rmSync(sharedRepo(t), { recursive: true, force: true });
    expect(leaseOf(t.server.db, "serve.lease")?.until).toBeGreaterThan(t.clock.now);
    const rebuilt = await runMirror(mirrorCtx(t), { rebuild: true });
    expect(rebuilt).toEqual({ commits: 3, errors: [] });
    expect(commitsOf(sharedRepo(t)).map((c) => [c.subject, c.an, c.body])).toEqual(before);
    expect(filesAt(sharedRepo(t))).toEqual(beforeFiles);
    expect(readFileSync(join(sharedRepo(t), fileNameFor(uuidOf(a.uid), "a")), "utf8")).toContain(
      "two",
    );
    const memberFolder = join(
      repos(t),
      repoFolder("workspace", null, { id: ana.memberId, name: "Ana" }),
    );
    expect(commitsOf(memberFolder)).toHaveLength(2);
  });

  test("purge of an entry whose revisions span two folders leaves it in no commit, records the key and the purge row; purge of a memory", async () => {
    const { t, ana } = await team();
    const p = entryPayload({ scope: "shared", slug: "secret-ish" });
    const keep = entryPayload({ scope: "shared", slug: "keep" });
    await pushOne(t.server, ana.token, sendOf(keep));
    await pushOne(t.server, ana.token, sendOf(p));
    const uuid = uuidOf(p.uid);
    const moved = {
      ...p,
      uid: entryUid("project", ALIAS_A, uuid),
      remoteAlias: ALIAS_A,
      scope: "project" as const,
    };
    await pushOne(t.server, ana.token, sendOf(moved, { baseRevision: 1, baseHash: p.hash }));
    await runMirror(mirrorCtx(t), { rebuild: false });
    const folderA = join(repos(t), repoFolder("project", ALIAS_A, null));
    expect(
      realGit(
        sharedRepo(t),
        "log",
        "--all",
        "--format=%s",
        "--",
        fileNameFor(uuid, "secret-ish"),
      ).trim(),
    ).not.toBe("");

    const purged = await purgeItem(mirrorCtx(t), "entry", moved.uid, t.clock.now, OPERATOR);
    expect(purged).toEqual({ revisions: 2, feedRows: 3, errors: [] });
    expect(
      t.server.db
        .query<{ source: string; target: string }, []>(
          "SELECT source, target FROM audit WHERE action = 'purged'",
        )
        .all(),
    ).toEqual([{ source: "cli", target: moved.uid }]);
    expect(entryByUuid(t.server.db, uuid)).toBeNull();
    const rows = t.server.db
      .query<{ op: string; hash: string; key: string }, [string, string]>(
        "SELECT op, hash, key FROM changes WHERE key = ? OR key LIKE ? ORDER BY seq",
      )
      .all(uuid, `${uuid}@%`);
    expect(rows.map((r) => r.op)).toEqual(["purge", "purge", "purge", "purge"]);
    expect(rows.every((r) => r.hash === "")).toBe(true);
    expect(
      t.server.db
        .query<{ key: string }, [string]>("SELECT key FROM purged WHERE key = ?")
        .get(uuid),
    ).toEqual({ key: uuid });
    expect(
      realGit(
        sharedRepo(t),
        "log",
        "--all",
        "--format=%s",
        "--",
        fileNameFor(uuid, "secret-ish"),
      ).trim(),
    ).toBe("");
    expect(
      realGit(folderA, "log", "--all", "--format=%s", "--", fileNameFor(uuid, "secret-ish")).trim(),
    ).toBe("");
    for (const repo of [sharedRepo(t), folderA]) {
      expect(realGit(repo, "log", "--all", "--format=%s").includes(uuid)).toBe(false);
    }
    // The kept entry is still there with its history.
    expect(readFileSync(join(sharedRepo(t), fileNameFor(uuidOf(keep.uid), "keep")), "utf8")).toBe(
      keep.frontmatter + keep.body,
    );
    expect(commitsOf(sharedRepo(t)).map((c) => c.subject)).toEqual([
      "team: init shared",
      `team: send ${keep.uid}`,
    ]);
    // A re-send of the purged entry is refused.
    expect(await pushOne(t.server, ana.token, sendOf(p))).toMatchObject({
      result: "refused",
      reason: "purged",
    });

    const m = memoryPayload({ rowId: 9 });
    await pushOne(t.server, ana.token, sendOf(m));
    const feedUid = `remote:${ana.deviceAlias}:${m.uid}`;
    const purgedMemory = await purgeItem(mirrorCtx(t), "memory", feedUid, t.clock.now, OPERATOR);
    expect(purgedMemory).toEqual({ revisions: 1, feedRows: 1, errors: [] });
    expect(memoryByKey(t.server.db, ana.deviceId, m.uid)).toBeNull();
    expect(
      t.server.db
        .query<{ op: string }, [string]>("SELECT op FROM changes WHERE key = ? ORDER BY seq")
        .all(`${ana.deviceId}:${m.uid}`)
        .map((r) => r.op),
    ).toEqual(["purge", "purge"]);
    expect(await pushOne(t.server, ana.token, sendOf(m))).toMatchObject({
      result: "refused",
      reason: "purged",
    });
    await expect(
      purgeItem(mirrorCtx(t), "entry", `shared:${uuid}`, t.clock.now, OPERATOR),
    ).rejects.toThrow();
  });
});

describe("isolation, the lease, the plan", () => {
  test("git runs with no user config, the mirror's root as ceiling, --template= on init and safe.directory after the runner's own settings", async () => {
    const { t, ana } = await team();
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "iso" })));
    const envFile = join(t.dir, "env.txt");
    const argsFile = join(t.dir, "args.txt");
    const stub = stubGit(join(t.dir, "stub-iso"), { dumpEnvTo: envFile, recordArgsTo: argsFile });
    expect((await runMirror(mirrorCtx(t, stub), { rebuild: false })).errors).toEqual([]);
    const env = readFileSync(envFile, "utf8");
    expect(env).toContain("GIT_CONFIG_GLOBAL=/dev/null");
    expect(env).toContain("GIT_CONFIG_NOSYSTEM=1");
    expect(env).toContain(`GIT_CEILING_DIRECTORIES=${repos(t)}`);
    expect(env).not.toMatch(/^HOME=/m);
    // One call per record, each ended by a tab and a newline; a commit message spans lines inside its argument.
    const calls = readFileSync(argsFile, "utf8")
      .split("\t\n")
      .filter((record) => record !== "" && record !== "\n")
      .map((record) => record.split("\t"));
    expect(calls.length).toBeGreaterThanOrEqual(5);
    const init = calls.find((args) => args.includes("init"));
    expect(init).toContain("--template=");
    for (const args of calls) {
      // No signing anywhere; the hooks path pointed at a file wherever a repository is named.
      expect(args).toContain("commit.gpgsign=false");
      if (args.includes("--git-dir")) {
        expect(
          args.some((arg) => arg.startsWith("core.hooksPath=") && arg.endsWith("/.git/config")),
        ).toBe(true);
      }
      const safe = args.indexOf("safe.directory=*");
      expect({ args: args.join(" "), found: safe > 0 }).toEqual({
        args: args.join(" "),
        found: true,
      });
      expect(args[safe - 1]).toBe("-c");
      // After every one of the runner's own settings: the last of them is the hooks path or the ref format.
      const last = Math.max(
        args.indexOf("init.defaultRefFormat=files"),
        args.findIndex((arg) => arg.startsWith("core.hooksPath=")),
      );
      expect(last).toBeLessThan(safe);
    }
  });

  test("a second run while the lease is held refuses; the lease is renewed before each git call and released after; a lost lease aborts the run", async () => {
    const { t, ana } = await team();
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "one" })));
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "two" })));
    expect(claimLease(t.server.db, MIRROR_LEASE, "mirror-other", t.clock.now, MIRROR_TTL_MS)).toBe(
      true,
    );
    await expect(runMirror(mirrorCtx(t), { rebuild: false })).rejects.toThrow(LeaseHeldError);
    t.server.db.run("DELETE FROM meta WHERE key = ?", [MIRROR_LEASE]);

    // One renewal per git call: the clock is read once to take the lease, once per renewal
    // (before every git call), once per revision for the commit's time, once for the record.
    const argsFile = join(t.dir, "renew-args.txt");
    const stub = stubGit(join(t.dir, "stub-renew"), { recordArgsTo: argsFile });
    let reads = 0;
    const ctx = { ...mirrorCtx(t, stub), now: () => t.clock.now + 1000 * reads++ };
    const run = await runMirror(ctx, { rebuild: false });
    expect(run.commits).toBe(2);
    const gitCalls = readFileSync(argsFile, "utf8")
      .split("\t\n")
      .filter((record) => record !== "" && record !== "\n").length;
    expect(gitCalls).toBeGreaterThan(4);
    expect(reads).toBe(1 + gitCalls + run.commits + 1);
    expect(leaseOf(t.server.db, MIRROR_LEASE)).toBeNull();

    // A lost lease: the clock's fourth read hands the lease to another owner.
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "three" })));
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "four" })));
    let calls = 0;
    const stolen = {
      ...mirrorCtx(t),
      now: () => {
        calls++;
        if (calls === 4)
          setMeta(
            t.server.db,
            MIRROR_LEASE,
            JSON.stringify({ owner: "mirror-intruder", until: t.clock.now + 999_999 }),
          );
        return t.clock.now;
      },
    };
    const aborted = await runMirror(stolen, { rebuild: false });
    expect(aborted.commits).toBeLessThan(2);
    expect(aborted.errors.some((e) => /lease/.test(e.message))).toBe(true);
    expect(lastRun(t)?.error).toMatch(/lease/);
    expect(leaseOf(t.server.db, MIRROR_LEASE)?.owner).toBe("mirror-intruder");
  });

  test("the pending query uses the partial index", async () => {
    const t = await start();
    const plan = explainPendingMirror(t.server.db);
    expect(plan.some((line) => line.includes("entries_pending"))).toBe(true);
  });

  test("a purge while a mirror run holds the lease is refused before anything is erased; after it, the purge erases and audits", async () => {
    const { t, ana } = await team();
    const p = entryPayload({ scope: "shared", slug: "held" });
    await pushOne(t.server, ana.token, sendOf(p));
    await runMirror(mirrorCtx(t), { rebuild: false });
    const uuid = uuidOf(p.uid);
    expect(claimLease(t.server.db, MIRROR_LEASE, "mirror-other", t.clock.now, MIRROR_TTL_MS)).toBe(
      true,
    );
    await expect(purgeItem(mirrorCtx(t), "entry", p.uid, t.clock.now, OPERATOR)).rejects.toThrow(
      LeaseHeldError,
    );
    expect(entryByUuid(t.server.db, uuid)).not.toBeNull();
    expect(
      t.server.db
        .query<{ key: string }, [string]>("SELECT key FROM purged WHERE key = ?")
        .get(uuid),
    ).toBeNull();
    expect(
      t.server.db
        .query<{ n: number }, []>("SELECT count(*) AS n FROM audit WHERE action = 'purged'")
        .get()?.n,
    ).toBe(0);
    expect(realGit(sharedRepo(t), "log", "--all", "--format=%s").includes(uuid)).toBe(true);
    t.server.db.run("DELETE FROM meta WHERE key = ?", [MIRROR_LEASE]);
    const done = await purgeItem(mirrorCtx(t), "entry", p.uid, t.clock.now, OPERATOR);
    expect(done).toEqual({ revisions: 1, feedRows: 1, errors: [] });
    expect(entryByUuid(t.server.db, uuid)).toBeNull();
    expect(realGit(sharedRepo(t), "log", "--all", "--format=%s").includes(uuid)).toBe(false);
    expect(
      t.server.db
        .query<{ n: number }, []>("SELECT count(*) AS n FROM audit WHERE action = 'purged'")
        .get()?.n,
    ).toBe(1);
  });
});

describe("the real child", () => {
  test("the server runs serve mirror --data <dir> through this binary's command line and forwards its lines to the log", async () => {
    const t = await start({
      mirrorCommand: (dir: string) => [process.execPath, MAIN, "serve", "mirror", "--data", dir],
    });
    const admin = await adminOf(t, "Admin");
    const payload = entryPayload({ scope: "shared", slug: "child" });
    await pushOne(t.server, admin.token, sendOf(payload));
    expect(lastRun(t)).toBeNull();
    // The quiet minute passes: the timer launches the child, a real process over the same database.
    t.clock.advance(60_000);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && lastRun(t) === null) await Bun.sleep(100);
    expect(lastRun(t)).toMatchObject({ commits: 1, error: null });
    while (
      Date.now() < deadline &&
      !eventsOf(t, "mirror").some((line) => line.child === "mirror")
    ) {
      await Bun.sleep(50);
    }
    const forwarded = eventsOf(t, "mirror").find((line) => line.child === "mirror");
    expect(forwarded).toMatchObject({ commits: 1, errors: [] });
    expect(eventsOf(t, "mirror-exit")).toHaveLength(0);
    expect(entryByUuid(t.server.db, uuidOf(payload.uid))?.mirror_revision).toBe(1);
    expect(existsSync(join(sharedRepo(t), fileNameFor(uuidOf(payload.uid), "child")))).toBe(true);
  }, 40_000);
});

describe("the scheduler", () => {
  test("a push arms a 60-second timer, the hourly tick runs it, never twice at once; stop signals the child and waits", async () => {
    const calls: { dataDir: string; signal: AbortSignal }[] = [];
    let release: () => void = () => undefined;
    const t = await start({
      mirrorChild: (dataDir: string, signal: AbortSignal) => {
        calls.push({ dataDir, signal });
        return new Promise<void>((resolve) => {
          release = resolve;
          signal.addEventListener("abort", () => resolve());
        });
      },
    });
    const admin = await adminOf(t, "Admin");
    const started = performance.now();
    await pushOne(t.server, admin.token, sendOf(entryPayload({ scope: "shared", slug: "a" })));
    expect(performance.now() - started).toBeLessThan(500);
    expect(calls).toHaveLength(0);
    t.clock.advance(30_000);
    await pushOne(t.server, admin.token, sendOf(entryPayload({ scope: "shared", slug: "b" })));
    t.clock.advance(30_000);
    expect(calls).toHaveLength(0);
    t.clock.advance(30_000);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.dataDir).toBe(t.dir);
    // The child is alive: the hourly tick and a new push timer start nothing.
    t.clock.advance(3_600_000);
    expect(calls).toHaveLength(1);
    release();
    await Bun.sleep(10);
    t.clock.advance(3_600_000);
    expect(calls).toHaveLength(2);
    // Stop signals the running child and waits for it.
    const stopped = t.server.stop();
    await Bun.sleep(10);
    expect(calls[1]?.signal.aborted).toBe(true);
    await stopped;
    expect(t.server.exitCode()).toBe(0);
  });

  test("scheduleMirror alone: one timer re-armed by pushes, stop clears it", async () => {
    const clock = { now: 0, advance: (_ms: number) => undefined };
    const timers = fakeTimers(clock);
    let runs = 0;
    const lines: string[] = [];
    const log = createTeamLog(
      (line) => lines.push(line),
      () => clock.now,
    );
    const scheduler = scheduleMirror({ dataDir: "/tmp/x", log }, timers, async () => {
      runs++;
    });
    scheduler.afterPush();
    clock.advance(59_000);
    expect(runs).toBe(0);
    scheduler.afterPush();
    clock.advance(59_000);
    expect(runs).toBe(0);
    clock.advance(1_000);
    expect(runs).toBe(1);
    scheduler.afterPush();
    await scheduler.stop();
    clock.advance(120_000);
    expect(runs).toBe(1);
    expect(timers.pending()).toBe(0);
  });
});
