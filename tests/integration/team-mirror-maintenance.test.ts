// The mirror commits through the store's runner: no commit of a run starts maintenance by
// itself, the runner runs git's own after it, and a lease lost there stops the run.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { teamPaths } from "../../src/team/db.ts";
import { MIRROR_LEASE } from "../../src/team/lease.ts";
import { createTeamLog } from "../../src/team/log.ts";
import { runMirror } from "../../src/team/mirror.ts";
import { leaseOf, setMeta } from "../../src/team/store.ts";
import { realGit, stubGit } from "../helpers/stub-git.ts";
import {
  adminOf,
  cleanTestDirs,
  entryPayload,
  memberOf,
  pushOne,
  sendOf,
  startTestServer,
  type TestServer,
} from "../helpers/team.ts";

const SETTINGS = ["maintenance.auto=false", "maintenance.autoDetach=false", "gc.autoDetach=false"];

const open: TestServer[] = [];
afterEach(async () => {
  for (const t of open.splice(0)) await t.close();
});
afterAll(() => cleanTestDirs());

async function team() {
  const t = await startTestServer({});
  open.push(t);
  const admin = await adminOf(t, "Admin");
  const ana = await memberOf(t, admin.token, "Ana");
  return { t, ana };
}

function mirrorCtx(t: TestServer, gitPath: string) {
  return {
    db: t.server.db,
    dataDir: t.dir,
    env: { PATH: process.env.PATH ?? "", HOME: join(t.dir, "home") },
    gitPath,
    log: createTeamLog(
      (line) => t.lines.push(line),
      () => t.clock.now,
    ),
    now: () => t.clock.now,
  };
}

const sharedRepo = (t: TestServer) => join(teamPaths(t.dir).repos, "shared");

const callsIn = (file: string): string[][] =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\t\n")
        .filter((record) => record !== "" && record !== "\n")
        .map((record) => record.replace(/^\n/, "").split("\t"))
    : [];

const subjects = (repo: string) => realGit(repo, "log", "--format=%s").trim().split("\n");

describe("a mirror run's git", () => {
  test("every call carries the three settings; git ran the runner's maintenance after each commit, and nothing detached", async () => {
    const { t, ana } = await team();
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "one" })));
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "two" })));
    const record = join(t.dir, "args.txt");
    const trace = join(t.dir, "trace.txt");
    const stub = stubGit(join(t.dir, "tracing-git"), { recordArgsTo: record, traceTo: trace });

    const run = runMirror(mirrorCtx(t, stub), { rebuild: false });
    expect(run).toEqual({ commits: 2, errors: [] });

    const calls = callsIn(record);
    expect(calls.length).toBeGreaterThan(4);
    for (const args of calls) for (const setting of SETTINGS) expect(args).toContain(setting);

    const commands = readFileSync(trace, "utf8")
      .split("\n")
      .map((line) => /trace: built-in: git (.*)$/.exec(line)?.[1])
      .filter((command): command is string => command !== undefined)
      .filter((command) => /^(commit|maintenance)\b/.test(command));
    const commits = commands.filter((command) => command.startsWith("commit"));
    // The repository's first commit, then one per revision.
    expect(commits.length).toBe(3);
    expect(commands.length).toBe(commits.length * 2);
    commands.forEach((command, index) => {
      if (index % 2 === 0) expect(command.startsWith("commit ")).toBe(true);
      else expect(command).toBe("maintenance run --auto --quiet");
    });
    expect(readFileSync(trace, "utf8")).not.toContain("--detach");
  });

  test("a lease lost at the maintenance call: no git runs without it, the landed revision is recorded, the run stops at its next git call, and the next run commits nothing twice", async () => {
    const { t, ana } = await team();
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "one" })));
    await pushOne(t.server, ana.token, sendOf(entryPayload({ scope: "shared", slug: "two" })));
    const record = join(t.dir, "args.txt");
    const stub = stubGit(join(t.dir, "recording-git"), { recordArgsTo: record });
    // The clock is read at each renewal: the read that follows the second commit (the first
    // revision's) is the maintenance call's, and it hands the lease to another owner.
    let stolen = false;
    let callsWhenStolen = -1;
    const commitsSoFar = () => callsIn(record).filter((args) => args.includes("commit")).length;
    const ctx = {
      ...mirrorCtx(t, stub),
      now: () => {
        if (!stolen && commitsSoFar() === 2 && callsIn(record).at(-1)?.includes("commit")) {
          stolen = true;
          callsWhenStolen = callsIn(record).length;
          setMeta(
            t.server.db,
            MIRROR_LEASE,
            JSON.stringify({ owner: "mirror-intruder", until: t.clock.now + 999_999 }),
          );
        }
        return t.clock.now;
      },
    };

    const aborted = runMirror(ctx, { rebuild: false });
    expect(stolen).toBe(true);
    // The first revision landed and is counted; the second was never started.
    expect(aborted.commits).toBe(1);
    expect(aborted.errors.some((error) => /lease/.test(error.message))).toBe(true);
    expect(leaseOf(t.server.db, MIRROR_LEASE)?.owner).toBe("mirror-intruder");
    // No git ran after the lease was lost: neither the maintenance nor the next revision's.
    expect(callsIn(record).length).toBe(callsWhenStolen);
    expect(callsIn(record).at(-1)).toContain("commit");
    expect(subjects(sharedRepo(t)).length).toBe(2);

    t.server.db.run("DELETE FROM meta WHERE key = ?", [MIRROR_LEASE]);
    const next = runMirror(mirrorCtx(t, stub), { rebuild: false });
    // The landed revision was recorded, so only the second is committed now.
    expect(next).toEqual({ commits: 1, errors: [] });
    expect(subjects(sharedRepo(t)).length).toBe(3);
    expect(realGit(sharedRepo(t), "status", "--porcelain").trim()).toBe("");
  });
});
