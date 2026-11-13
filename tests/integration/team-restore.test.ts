import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { openTeamForWrite, TEAM_LATEST, teamPaths } from "../../src/team/db.ts";
import { LeaseHeldError } from "../../src/team/errors.ts";
import { readHighWater, writeHighWater } from "../../src/team/instance.ts";
import { holdLease, SERVE_LEASE, SERVE_TTL_MS } from "../../src/team/lease.ts";
import { type RestoreInput, RestoreRefused, restore } from "../../src/team/restore.ts";
import { getMeta, leaseOf, sequenceHighWater } from "../../src/team/store.ts";
import { runCliWith } from "../helpers/cli.ts";
import { cleanTestDirs, startTestServer } from "../helpers/team.ts";
import {
  audit,
  cleanRestoreDirs,
  crashImage,
  dataHashes,
  NEXT,
  NEXT_MIGRATIONS,
  rawOpen,
  type SinceIds,
  since,
  upgrade,
  type WorldIds,
  world,
} from "../helpers/team-restore.ts";

afterAll(() => {
  cleanRestoreDirs();
  cleanTestDirs();
});

const P = "docker compose run --rm server serve ";
const LOST = "lost with the restore";
const ITEM_NOTE = "  note: the older image answers no such item if it arrived after the copy";

interface Scene {
  /** The crash image: the directory the restore works on. */
  dir: string;
  ids: WorldIds;
  late: SinceIds;
  /** The upgrade copy inside the crash image, and its time. */
  copy: string;
  ms: number;
}

/** `prepare` writes more into the upgraded directory before the crash image is taken. */
async function scene(
  prepare?: (dir: string, late: SinceIds, ids: WorldIds) => void,
): Promise<Scene> {
  const { dir, ids } = await world();
  const { copy, ms } = upgrade(dir);
  const late = since(dir, ids);
  prepare?.(dir, late, ids);
  const image = crashImage(dir);
  return { dir: image, ids, late, copy: join(image, "backups", basename(copy)), ms };
}

const run = (s: Scene, over: Partial<RestoreInput> = {}): string[] =>
  restore({ dir: s.dir, toSchema: TEAM_LATEST, latest: NEXT, yes: false, now: Date.now, ...over });

const lineOf = (lines: string[], ...words: string[]): string => {
  const found = lines.filter((line) => words.every((word) => line.includes(word)));
  expect(found).toHaveLength(1);
  return found[0] as string;
};

const readOnly = (file: string) => new Database(file, { readonly: true });

const count = (db: Database, sql: string, ...values: string[]): number =>
  db.query<{ n: number }, string[]>(sql).get(...values)?.n ?? 0;

const leftovers = (dir: string): string[] =>
  [...readdirSync(dir), ...readdirSync(join(dir, "backups"))].filter(
    (name) => name.startsWith("team.db.restoring") || name.startsWith("team-before-rollback-"),
  );

describe("the dry run", () => {
  test("changes no data file and prints the copy, the counts and the commands in order", async () => {
    const s = await scene();
    const before = dataHashes(s.dir);
    const lines = run(s);
    expect(dataHashes(s.dir)).toEqual(before);
    expect(lines.slice(0, 8)).toEqual([
      `would_restore=${s.copy}`,
      `copied_at=${new Date(s.ms).toISOString()}`,
      "lost.entries_created=1",
      "lost.entries_revised=1",
      "lost.memories=1",
      "lost.names=1",
      "lost.members=1",
      "lost.devices=2",
    ]);
    expect(lines[8]).toBe("lost.withdrawn=1");
    expect(lines[9]).toMatch(/^lost\.changes=[1-9]\d*$/);
    expect(lines[10]).toBe(`run: ${P}instance renew`);
    expect(lines.filter((line) => line.includes("instance renew"))).toHaveLength(1);
    const firstAudit = lines.findIndex(
      (line) => line.includes(" purged ") || line.includes(" join "),
    );
    const firstInvitation = lines.findIndex((line) => line.startsWith("invitation "));
    expect(firstAudit).toBeGreaterThan(10);
    expect(firstInvitation).toBeGreaterThan(
      lines.findLastIndex((line) => /^\d{4}-\d\d-\d\dT/.test(line)),
    );
    expect(lines.at(-1)).toBe(`run: ${P}mirror --rebuild`);
    expect(lines.findLastIndex((line) => line.startsWith("invitation "))).toBe(lines.length - 2);
  });

  test("a target in the copy carries its command, one that is not is lost", async () => {
    const s = await scene((dir, late) => {
      const db = rawOpen(dir);
      audit(db, { source: "cli", action: "device revoked", target: late.zoe.devices[0] });
      db.close();
    });
    const lines = run(s);
    expect(lineOf(lines, " device revoked ", s.ids.rui.deviceId)).toEndWith(
      ` -> ${P}revoke ${s.ids.rui.deviceId}`,
    );
    expect(lineOf(lines, " member disabled ", s.ids.rui.memberId)).toEndWith(
      ` -> ${P}disable ${s.ids.rui.memberId}`,
    );
    const joins = lines.filter((line) => line.includes(" join "));
    expect(joins).toHaveLength(2);
    for (const line of joins) expect(line).toEndWith(" -> lost with the restore");
    expect(lineOf(lines, " device revoked ", s.late.zoe.devices[0])).toEndWith(
      " -> lost with the restore",
    );
  });

  test("a purge is always printed, of an entry that was in the copy too", async () => {
    const s = await scene();
    const lines = run(s);
    const line = lineOf(lines, " purged ");
    expect(line).toEndWith(` -> ${P}purge entry ${s.ids.doomed.uid} --yes`);
    expect(lines[lines.indexOf(line) + 1]).toBe(ITEM_NOTE);
  });

  test("a token rotated since the copy revokes the device", async () => {
    const s = await scene();
    const lines = run(s);
    const line = lineOf(lines, " token rotated ");
    expect(line).toEndWith(` -> ${P}revoke ${s.ids.ana.deviceId}`);
    expect(lines[lines.indexOf(line) + 1]).toBe(
      "  note: the device joins again with a new invitation",
    );
  });

  test("a member or an invitation that is not in the copy is lost; one that is carries its command", async () => {
    const s = await scene((dir, late) => {
      const db = rawOpen(dir);
      const cli = (action: string, target: string, detail = "") =>
        audit(db, { source: "cli", action, target, detail });
      cli("member disabled", late.zoe.memberId, "devices 2, withdrawn 0");
      cli("member enabled", late.zoe.memberId);
      cli("role set", late.zoe.memberId, "admin");
      cli("invitation revoked", late.lateInvitation);
      db.close();
    });
    const lines = run(s);
    for (const action of ["member disabled", "member enabled", "role set"]) {
      expect(lineOf(lines, ` ${action} `, s.late.zoe.memberId)).toEndWith(` -> ${LOST}`);
    }
    expect(lineOf(lines, " invitation revoked ", s.late.lateInvitation)).toEndWith(` -> ${LOST}`);
  });

  test("an enabled member, a role, a withdrawing disable and a revoked invitation carry their commands", async () => {
    const s = await scene((dir, _late, ids) => {
      const db = rawOpen(dir);
      const ana = ids.ana.memberId;
      const rui = ids.rui.memberId;
      const open = ids.invitation;
      const cli = (action: string, target: string, detail = "") =>
        audit(db, { source: "cli", action, target, detail });
      cli("member enabled", rui);
      cli("role set", ana, "admin");
      cli("role set", rui, "root");
      cli("member disabled", ana, "devices 1, withdrawn 2");
      cli("invitation revoked", open);
      db.close();
    });
    const lines = run(s);
    const { ana, rui } = s.ids;
    expect(lineOf(lines, " member enabled ", rui.memberId)).toEndWith(
      ` -> ${P}enable ${rui.memberId}`,
    );
    expect(lineOf(lines, " role set ", ana.memberId)).toEndWith(
      ` -> ${P}role ${ana.memberId} admin`,
    );
    expect(lineOf(lines, " role set ", rui.memberId)).toEndWith(` -> ${LOST}`);
    expect(lineOf(lines, " member disabled ", ana.memberId)).toEndWith(
      ` -> ${P}disable ${ana.memberId} --withdraw`,
    );
    expect(lineOf(lines, " member disabled ", rui.memberId)).toEndWith(
      ` -> ${P}disable ${rui.memberId}`,
    );
    expect(lineOf(lines, " invitation revoked ", s.ids.invitation)).toEndWith(
      ` -> ${P}invitation revoke ${s.ids.invitation}`,
    );
  });

  test("a withdrawal, a reinstatement and a name's purge always carry their command", async () => {
    const memoryTarget = "remote:github.com/acme/site:late-memory";
    const s = await scene((dir) => {
      const db = rawOpen(dir);
      const cli = (action: string, target: string, detail = "") =>
        audit(db, { source: "cli", action, target, detail });
      cli("item withdrawn", "shared:11111111-1111-4111-8111-111111111111", "entry revision 3");
      cli("item withdrawn", memoryTarget, "memory revision 2");
      cli("item reinstated", "shared:11111111-1111-4111-8111-111111111111", "entry");
      cli("name purged", "name:late", "0 entries, 0 memories under it");
      cli("purged", memoryTarget, "memory: 1 rows, 1 feed rows");
      cli("purged", "shared:22222222-2222-4222-8222-222222222222", "table; drop: 1 rows");
      cli("item withdrawn", "shared:33333333-3333-4333-8333-333333333333", "everything revision 1");
      db.close();
    });
    const lines = run(s);
    const withNote = (line: string, note: string) => {
      expect(lines[lines.indexOf(line) + 1]).toBe(note);
    };
    const withdrawn = lineOf(lines, " item withdrawn ", "shared:11111111");
    expect(withdrawn).toEndWith(
      ` -> ${P}withdraw entry shared:11111111-1111-4111-8111-111111111111`,
    );
    withNote(withdrawn, ITEM_NOTE);
    expect(lineOf(lines, " item withdrawn ", memoryTarget)).toEndWith(
      ` -> ${P}withdraw memory ${memoryTarget}`,
    );
    const reinstated = lineOf(lines, " item reinstated ");
    expect(reinstated).toEndWith(
      ` -> ${P}reinstate entry shared:11111111-1111-4111-8111-111111111111`,
    );
    withNote(reinstated, ITEM_NOTE);
    const name = lineOf(lines, " name purged ");
    expect(name).toEndWith(` -> ${P}purge name name:late --yes`);
    withNote(name, "  note: the older image answers no such name if it was created after the copy");
    expect(lineOf(lines, " purged ", memoryTarget)).toEndWith(
      ` -> ${P}purge memory ${memoryTarget} --yes`,
    );
    // A kind that is not one of the two known words is never pasted into a command.
    expect(lineOf(lines, " purged ", "shared:22222222")).toEndWith(` -> ${LOST}`);
    expect(lineOf(lines, " item withdrawn ", "shared:33333333")).toEndWith(` -> ${LOST}`);
  });

  test("a member's own withdrawal since the copy is counted and carries serve withdraw, once", async () => {
    const s = await scene();
    const lines = run(s);
    expect(lines).toContain("lost.withdrawn=1");
    const line = lineOf(lines, "withdrawn since the copy");
    expect(line).toBe(
      `entry ${s.ids.unshared.uid} withdrawn since the copy -> ${P}withdraw entry ${s.ids.unshared.uid}`,
    );
    expect(lines[lines.indexOf(line) + 1]).toBe(
      "  note: the older image's withdrawal is the operator's: its member cannot send the item again until serve reinstate",
    );
    // After the audit lines, before the invitations.
    expect(lines.indexOf(line)).toBeGreaterThan(
      lines.findLastIndex((entry) => /^\d{4}-\d\d-\d\dT/.test(entry)),
    );
    expect(lines.indexOf(line)).toBeLessThan(
      lines.findIndex((entry) => entry.startsWith("invitation ")),
    );
  });

  test("a member's withdrawal after an admin's withdrawal and reinstatement of the same item is still listed", async () => {
    const s = await scene((dir, _late, ids) => {
      const db = rawOpen(dir);
      // After the copy: the admin withdrew it (revision 2), reinstated it, and its member
      // then withdrew it (revision 3, the current row).
      audit(db, {
        source: "cli",
        action: "item withdrawn",
        target: ids.unshared.uid,
        detail: "entry revision 2",
      });
      audit(db, {
        source: "cli",
        action: "item reinstated",
        target: ids.unshared.uid,
        detail: "entry",
      });
      db.run("UPDATE changes SET revision = 3, at = ? WHERE uid = ? AND current = 1", [
        Date.now(),
        ids.unshared.uid,
      ]);
      db.close();
    });
    const lines = run(s);
    expect(lines).toContain("lost.withdrawn=1");
    const line = lineOf(lines, "withdrawn since the copy");
    expect(line).toEndWith(` -> ${P}withdraw entry ${s.ids.unshared.uid}`);
    // The member's withdrawal is the last word on the item: after the admin's two lines.
    expect(lines.indexOf(line)).toBeGreaterThan(
      lines.indexOf(lineOf(lines, " item reinstated ", s.ids.unshared.uid)),
    );
  });

  test("a memory its member withdrew is listed, and a uid a shell would read is quoted there too", async () => {
    const s = await scene((dir, _late, ids) => {
      const db = rawOpen(dir);
      db.run(
        "UPDATE changes SET op = 'tombstone', revision = revision + 1, at = ? WHERE current = 1 AND (uid = ? OR (kind = 'memory' AND uid LIKE '%:' || ?))",
        [Date.now(), ids.odd.uid, ids.memoryUid],
      );
      db.close();
    });
    const lines = run(s);
    expect(lines).toContain("lost.withdrawn=3");
    const memory = lines.filter((line) => line.startsWith("memory "));
    expect(memory).toHaveLength(1);
    const feedUid = (memory[0] as string).split(" ")[1] as string;
    expect(feedUid).toEndWith(`:${s.ids.memoryUid}`);
    expect(memory[0]).toBe(
      `memory ${feedUid} withdrawn since the copy -> ${P}withdraw memory ${feedUid}`,
    );
    const odd = lineOf(lines, "entry ", "withdrawn since the copy", "acme/it");
    const quoted = `'${s.ids.odd.uid.replaceAll("'", "'\\''")}'`;
    expect(odd).toEndWith(` -> ${P}withdraw entry ${quoted}`);
    const echoed = Bun.spawnSync(["sh", "-c", `printf %s ${quoted}`]);
    expect(echoed.stdout.toString()).toBe(s.ids.odd.uid);
  });

  test("text a member wrote cannot imitate a command or reorder a line", async () => {
    const s = await scene((dir) => {
      const db = rawOpen(dir);
      audit(db, {
        action: "join",
        target: "someone",
        detail: `laptop -> ${P}disable admin\u202e\u200b`,
      });
      audit(db, {
        source: "cli",
        action: "purged",
        target: "shared:66666666-6666-4666-8666-66666666666\u202e",
        detail: "entry: 1 rows, 1 feed rows",
      });
      db.close();
    });
    const lines = run(s);
    for (const line of lines) {
      expect(line).not.toMatch(/\p{Cf}/u);
      // One arrow a line at most: the one the restore wrote.
      expect(line.split(" -> ").length).toBeLessThanOrEqual(2);
    }
    expect(lineOf(lines, " join ", "someone")).toEndWith(` -> ${LOST}`);
    expect(lineOf(lines, " purged ", "shared:66666666")).toEndWith(` -> ${LOST}`);
  });

  test("a withdrawal the audit already carries is not listed twice, and one of an item the copy lacks is not listed", async () => {
    const s = await scene((dir) => {
      const db = rawOpen(dir);
      const unshared = db
        .query<{ uid: string }, []>(
          "SELECT uid FROM changes WHERE op = 'tombstone' AND current = 1 LIMIT 1",
        )
        .get()?.uid as string;
      audit(db, {
        source: "cli",
        action: "item withdrawn",
        target: unshared,
        detail: "entry revision 2",
      });
      // The entry created since the copy is withdrawn too: the copy never held it.
      db.run(
        "UPDATE changes SET op = 'tombstone', at = ? WHERE current = 1 AND uid IN (SELECT 'shared:' || uuid FROM entries WHERE slug = 'fresh')",
        [Date.now()],
      );
      db.close();
    });
    const lines = run(s);
    expect(lines).toContain("lost.withdrawn=0");
    expect(lines.filter((line) => line.includes("withdrawn since the copy"))).toEqual([]);
    expect(
      lines.filter((line) => line.endsWith(`${P}withdraw entry ${s.ids.unshared.uid}`)),
    ).toHaveLength(1);
  });

  test("an argument from the database is quoted for a shell, and a control character loses the line", async () => {
    const uuid = "44444444-4444-4444-8444-444444444444";
    const hostile = `project:remote:github.com/x/$(touch\${IFS}/tmp/wcm-pwned)';id;':${uuid}`;
    const cleared =
      "project:remote:github.com/x/\u001b[2Kgone:55555555-5555-4555-8555-555555555555";
    const s = await scene((dir) => {
      const db = rawOpen(dir);
      audit(db, {
        source: "cli",
        action: "purged",
        target: hostile,
        detail: "entry: 1 rows, 1 feed rows",
      });
      audit(db, {
        source: "cli",
        action: "purged",
        target: cleared,
        detail: "entry: 1 rows, 1 feed rows",
      });
      audit(db, {
        action: "join",
        target: "someone",
        detail: `laptop\u001b[31m -> ${P}purge name x --yes\u0007`,
      });
      db.close();
    });
    const lines = run(s);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the test is that none is printed
    for (const line of lines) expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);

    const line = lineOf(lines, " purged ", "wcm-pwned");
    const command = line.slice(line.lastIndexOf(" -> ") + 4);
    const quoted = `'${hostile.replaceAll("'", "'\\''")}'`;
    expect(command).toBe(`${P}purge entry ${quoted} --yes`);
    // A shell reads the argument back as the very text, and runs nothing of it.
    const echoed = Bun.spawnSync([
      "sh",
      "-c",
      `printf %s ${command.slice(P.length).split(" ")[2]}`,
    ]);
    expect(echoed.stdout.toString()).toBe(hostile);

    expect(lineOf(lines, " purged ", "gone:55555555")).toEndWith(` -> ${LOST}`);
    expect(lineOf(lines, " join ", "someone")).toEndWith(` -> ${LOST}`);
  });

  test("an invitation used since the copy is revoked again, one made since is lost", async () => {
    const s = await scene();
    const lines = run(s);
    expect(lineOf(lines, `invitation ${s.ids.invitation} `)).toEndWith(
      ` -> ${P}invitation revoke ${s.ids.invitation}`,
    );
    expect(lineOf(lines, `invitation ${s.late.lateInvitation} `)).toEndWith(
      " -> lost with the restore",
    );
  });

  test("a million changes prints the renewal twice", async () => {
    const s = await scene();
    const copy = readOnly(s.copy);
    const mark = sequenceHighWater(copy, "changes");
    copy.close();
    const feedFile = teamPaths(s.dir).feedFile;
    writeHighWater(feedFile, { ...readHighWater(feedFile), changes: mark + 1_000_000 });
    expect(run(s).filter((line) => line === `run: ${P}instance renew`)).toHaveLength(2);
  });
});

describe.each([false, true])("refusals (yes: %p)", (yes) => {
  const refused = (s: Scene, over: Partial<RestoreInput>, ...words: string[]) => {
    const before = dataHashes(s.dir);
    let thrown: unknown;
    try {
      run(s, { yes, ...over });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RestoreRefused);
    for (const word of words) expect((thrown as Error).message).toContain(word);
    expect(dataHashes(s.dir)).toEqual(before);
  };

  /** A second file named as a newer upgrade copy of the same schema. */
  const newerCopy = (s: Scene): string =>
    join(s.dir, "backups", `team-${s.ms + 60_000}-v${TEAM_LATEST}-1.db`);

  test("a lease an earlier restore left, with words that do not say to stop a server", async () => {
    const s = await scene();
    // The staging file of the restore that holds the lease is not this run's to remove.
    writeFileSync(`${teamPaths(s.dir).db}.restoring`, "another run's copy");
    const db = rawOpen(s.dir);
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
      SERVE_LEASE,
      JSON.stringify({ owner: "restore-abc", until: Date.now() + 60_000 }),
    ]);
    db.close();
    refused(s, {}, "an earlier restore", "run it again after");
  });

  test("a copy that opens and fails quick_check", async () => {
    const s = await scene();
    copyFileSync(s.copy, newerCopy(s));
    // The file's last page is overwritten: the header and the schema still read.
    const bytes = readFileSync(newerCopy(s));
    bytes.fill(0xff, bytes.length - 4096);
    writeFileSync(newerCopy(s), bytes);
    refused(s, {}, basename(newerCopy(s)), "quick_check");
  });

  test("a fresh serve.lease", async () => {
    const s = await scene();
    const db = rawOpen(s.dir);
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
      SERVE_LEASE,
      JSON.stringify({ owner: "serve-x", until: Date.now() + 60_000 }),
    ]);
    db.close();
    refused(s, {}, "lease");
  });

  test("the present file behind this binary", async () => {
    refused(await scene(), { latest: NEXT + 1 }, "schema");
  });

  test("a target that is this binary's own schema", async () => {
    refused(await scene(), { toSchema: NEXT }, "nothing to go back to");
  });

  test("no backups folder", async () => {
    const s = await scene();
    rmSync(join(s.dir, "backups"), { recursive: true });
    refused(s, {}, "backups");
  });

  test("no upgrade copy for the schema", async () => {
    refused(await scene(), { toSchema: TEAM_LATEST - 1 }, "no upgrade copy");
  });

  test("a copy whose user_version is another", async () => {
    const s = await scene();
    copyFileSync(s.copy, newerCopy(s));
    const db = new Database(newerCopy(s));
    db.run("PRAGMA user_version = 7");
    db.close();
    refused(s, {}, "user_version");
  });

  test("a copy that is not a team database", async () => {
    const s = await scene();
    const db = new Database(newerCopy(s));
    db.run("CREATE TABLE stranger (x INTEGER)");
    db.run(`PRAGMA user_version = ${TEAM_LATEST}`);
    db.close();
    refused(s, {}, "not a team database");
  });

  test("a copy that cannot be read", async () => {
    const s = await scene();
    writeFileSync(newerCopy(s), Buffer.alloc(8192));
    refused(s, {}, basename(newerCopy(s)));
  });

  test("too little free space", async () => {
    refused(await scene(), { freeBytes: () => 1 }, "free");
  });
});

describe("the restore", () => {
  test("moves the present database aside whole and puts the upgrade copy back in WAL mode", async () => {
    const s = await scene();
    const feedFile = teamPaths(s.dir).feedFile;
    const feed = readFileSync(feedFile);
    const lines = run(s, { yes: true });
    expect(lines[0]).toBe(`restored=${s.copy}`);
    const asideLine = lines[1] as string;
    expect(asideLine).toStartWith(`aside=${join(s.dir, "backups", "team-before-rollback-")}`);

    const aside = readOnly(asideLine.slice("aside=".length));
    expect(aside.query("PRAGMA user_version").get()).toEqual({ user_version: NEXT });
    expect(count(aside, "SELECT count(*) AS n FROM audit WHERE action = 'wal only'")).toBe(1);
    expect(leaseOf(aside, SERVE_LEASE)?.owner.startsWith("restore-") ?? false).toBe(false);
    aside.close();

    const db = readOnly(teamPaths(s.dir).db);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: TEAM_LATEST });
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    const uuid = (uid: string) => uid.slice(-36);
    expect(
      count(db, "SELECT count(*) AS n FROM entries WHERE uuid = ?", uuid(s.ids.doomed.uid)),
    ).toBe(1);
    expect(count(db, "SELECT count(*) AS n FROM members WHERE id = ?", s.late.zoe.memberId)).toBe(
      0,
    );
    expect(
      count(
        db,
        "SELECT count(*) AS n FROM devices WHERE id = ? AND revoked_at IS NULL",
        s.ids.rui.deviceId,
      ),
    ).toBe(1);
    expect(leaseOf(db, SERVE_LEASE)).toBeNull();
    db.close();

    expect(readFileSync(feedFile).equals(feed)).toBe(true);
    expect(leftovers(s.dir).filter((name) => name.startsWith("team.db.restoring"))).toEqual([]);
  });

  test("a server started while the restore holds its lease is refused", async () => {
    const s = await scene();
    let asked = 0;
    const lines = run(s, {
      yes: true,
      copyFile: (from, to) => {
        const later = Date.now() + 31_000;
        const db = openTeamForWrite(s.dir, later, { latest: NEXT, migrations: NEXT_MIGRATIONS });
        try {
          expect(() => holdLease(db, SERVE_LEASE, "serve", SERVE_TTL_MS, () => later)).toThrow(
            LeaseHeldError,
          );
          asked++;
        } finally {
          db.close();
        }
        copyFileSync(from, to);
      },
    });
    expect(asked).toBe(1);
    expect(lines[0]).toStartWith("restored=");
  });
});

describe("the commands before the start", () => {
  const cli = (dir: string, ...args: string[]) =>
    runCliWith({ env: { WIZARDINGCODE_MEM_MIGRATE: "off" } }, "serve", ...args, "--data", dir);

  const shared = (dir: string) => join(teamPaths(dir).repos, "shared");

  async function restored(renew: boolean) {
    const s = await scene();
    const repo = shared(s.dir);
    for (const file of [s.ids.old.file, s.ids.doomed.file, s.late.fresh.file]) {
      expect(existsSync(join(repo, file))).toBe(true);
    }
    const copy = readOnly(s.copy);
    const copyInstance = getMeta(copy, "server.instance");
    copy.close();
    const feedMark = readHighWater(teamPaths(s.dir).feedFile).changes;
    run(s, { yes: true });
    const commands = [
      ...(renew ? [["instance", "renew"]] : []),
      ["purge", "entry", s.ids.doomed.uid, "--yes"],
      ["revoke", s.ids.rui.deviceId],
      ["mirror", "--rebuild"],
    ];
    for (const command of commands) {
      const result = await cli(s.dir, ...command);
      expect({ command, code: result.exitCode, stderr: result.stderr }).toMatchObject({ code: 0 });
    }
    const t = await startTestServer({ now: Date.now, dataDir: s.dir });
    try {
      return {
        s,
        repo,
        copyInstance,
        feedMark,
        instance: getMeta(t.server.db, "server.instance"),
        changes: sequenceHighWater(t.server.db, "changes"),
      };
    } finally {
      await t.close();
    }
  }

  test("with the renewal, a new instance, a sequence past the old mark, and a mirror without what was written since", async () => {
    const r = await restored(true);
    expect(r.copyInstance).toBe(r.s.ids.instance);
    expect(r.instance).not.toBe(r.s.ids.instance);
    expect(r.changes).toBeGreaterThan(r.feedMark);
    expect(existsSync(join(r.repo, r.s.ids.old.file))).toBe(true);
    expect(existsSync(join(r.repo, r.s.ids.doomed.file))).toBe(false);
    expect(existsSync(join(r.repo, r.s.late.fresh.file))).toBe(false);
  }, 60_000);

  test("without the renewal, the upgrade copy's own instance is served", async () => {
    const r = await restored(false);
    expect(r.instance).toBe(r.copyInstance);
  }, 60_000);
});

describe("cut short", () => {
  const tables = [
    "members",
    "devices",
    "invitations",
    "entries",
    "entry_revisions",
    "memories",
    "changes",
    "names",
    "purged",
    "audit",
  ];
  /** Every row of every table, as values. */
  const counts = (dir: string): Record<string, unknown[]> => {
    const db = rawOpen(dir, true);
    try {
      return Object.fromEntries(
        tables.map((table) => [table, db.query(`SELECT * FROM ${table} ORDER BY 1, 2`).all()]),
      );
    } finally {
      db.close();
    }
  };

  test("a copy that fails half way", async () => {
    const s = await scene();
    const feedFile = teamPaths(s.dir).feedFile;
    const feed = readFileSync(feedFile);
    const before = counts(s.dir);
    const failure = new Error("disk gone");
    expect(() =>
      run(s, {
        yes: true,
        copyFile: (from, to) => {
          writeFileSync(to, readFileSync(from).subarray(0, 1024));
          throw failure;
        },
      }),
    ).toThrow(failure);
    expect(counts(s.dir)).toEqual(before);
    const db = rawOpen(s.dir, true);
    expect(count(db, "SELECT count(*) AS n FROM audit WHERE action = 'wal only'")).toBe(1);
    expect((leaseOf(db, SERVE_LEASE)?.until ?? 0) > Date.now()).toBe(false);
    db.close();
    expect(readFileSync(feedFile).equals(feed)).toBe(true);
    expect(leftovers(s.dir)).toEqual([]);
  });

  test("a lease lost during the copy", async () => {
    const s = await scene();
    const feedFile = teamPaths(s.dir).feedFile;
    const feed = readFileSync(feedFile);
    const before = counts(s.dir);
    let thrown: unknown;
    try {
      run(s, {
        yes: true,
        copyFile: (from, to) => {
          copyFileSync(from, to);
          const db = rawOpen(s.dir);
          db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
            SERVE_LEASE,
            JSON.stringify({ owner: "serve-x", until: Date.now() + 60_000 }),
          ]);
          db.close();
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RestoreRefused);
    expect((thrown as Error).message).toContain("lease");
    const db = rawOpen(s.dir, true);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: NEXT });
    db.close();
    expect(counts(s.dir)).toEqual(before);
    expect(readFileSync(feedFile).equals(feed)).toBe(true);
    expect(leftovers(s.dir)).toEqual([]);
  });

  test("a restore killed during its swap is finished by the next run", async () => {
    const s = await scene();
    const present = teamPaths(s.dir).db;
    const aside = join(s.dir, "backups", "team-before-rollback-1.db");
    copyFileSync(s.copy, `${present}.restoring`);
    renameSync(present, aside);
    expect(readFileSync(`${present}-wal`).length).toBeGreaterThan(0);
    expect(existsSync(`${present}-shm`)).toBe(true);

    const lines = run(s, { yes: true });
    expect(lines.slice(0, 2)).toEqual([`finished=${present}`, `aside=${aside}`]);
    const db = readOnly(present);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: TEAM_LATEST });
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(count(db, "SELECT count(*) AS n FROM audit WHERE action = 'wal only'")).toBe(0);
    db.close();
    expect(existsSync(`${aside}-wal`)).toBe(true);
    const old = readOnly(aside);
    expect(count(old, "SELECT count(*) AS n FROM audit WHERE action = 'wal only'")).toBe(1);
    old.close();
  });

  test("team.db missing and no staging file", async () => {
    const s = await scene();
    const aside = join(s.dir, "backups", "team-before-rollback-1.db");
    writeFileSync(aside, "");
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${teamPaths(s.dir).db}${suffix}`, { force: true });
    let thrown: unknown;
    try {
      run(s, { yes: true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RestoreRefused);
    expect((thrown as Error).message).toContain(aside);
  });
});
