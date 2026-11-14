// `follow` when the release it applied does not come up (ADR 0033): the way back by the
// previous image when the schema did not move, and nothing more when it did.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { follow } from "../../src/host/follow.ts";
import { stateDir } from "../../src/host/state.ts";
import { hostWorld, indexOfCall, NEW, OLD, VOLUME, type World } from "../helpers/host-world.ts";

const UP = / up -d /;
const SCHEMA_READ = new RegExp(`^docker run .* -v ${VOLUME}:/data ${OLD.id} serve status$`);
const image = (w: World, version: string) => {
  const found = w.images.find((i) => i.version === version);
  if (found === undefined) throw new Error("no such image in the model");
  return found;
};
const logs = (w: World) => readdirSync(join(stateDir(w.folder), "logs"));

describe("a start that fails with the schema unchanged", () => {
  test("the log is saved first, the schema read with the previous image, .env put back, the digest rejected, exit 11", async () => {
    const w = hostWorld();
    image(w, "0.9.2").start = ["exit2"];
    const before = w.env();
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(11);
    expect(w.env()).toBe(before);
    expect(w.container).toMatchObject({ imageId: OLD.id, state: "running", health: "healthy" });

    const log = indexOfCall(w, /^docker logs --tail 200 c2$/);
    const stop = indexOfCall(w, / stop server$/);
    const read = indexOfCall(w, SCHEMA_READ);
    const ups = w.calls
      .map((call, index) => (UP.test(call.line) ? index : -1))
      .filter((i) => i > -1);
    expect(ups).toHaveLength(2);
    expect(log).toBeGreaterThan(ups[0] as number);
    expect(stop).toBeGreaterThan(log);
    expect(read).toBeGreaterThan(stop);
    expect(ups[1] as number).toBeGreaterThan(read);

    const names = logs(w);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^\d{8}T\d{6}Z-0\.9\.2\.log$/);
    const file = join(stateDir(w.folder), "logs", names[0] as string);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toContain("log of c2");
    expect(w.state().rejected).toEqual([
      expect.objectContaining({ digest: NEW.digest, version: "0.9.2", log: names[0] }),
    ]);
    expect(w.state().intent).toBeUndefined();
    expect(w.state().lastChange).toMatchObject({ kind: "rejected", from: "0.9.1", to: "0.9.2" });
    expect(w.out.at(-1)).toMatch(/^rejected: 0\.9\.2 did not start; 0\.9\.1 runs again; log /);
  });

  test("a later follow with the same latest exits 11 and runs neither the verifier, nor a pull, nor up", async () => {
    const w = hostWorld();
    image(w, "0.9.2").start = ["exit2"];
    await follow(w.deps, w.folder, { dryRun: false });
    const seen = w.calls.length;
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(11);
    const later = w.calls.slice(seen).map((call) => call.line);
    expect(later.filter((line) => /verifier@|^docker pull |up -d| stop /.test(line))).toEqual([]);
    expect(w.out.at(-1)).toMatch(/^rejected: 0\.9\.2 \(sha256:b+\) failed to start here on /);
  });

  test("a candidate that runs unhealthy is not stopped before the read, and is never asked for the schema", async () => {
    const w = hostWorld();
    image(w, "0.9.2").start = ["unhealthy"];
    image(w, "0.9.2").statusBroken = true;
    const before = w.env();
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(11);
    expect(w.env()).toBe(before);
    expect(w.container).toMatchObject({ imageId: OLD.id, health: "healthy" });
    expect(w.ran(/ stop server$/)).toEqual([]);
    expect(w.ran(SCHEMA_READ)).toHaveLength(1);
    expect(w.ran(/^docker exec c2 /)).toEqual([]);
  });
});

describe("a start that fails and cannot be undone by the image", () => {
  const cases: Array<[name: string, arrange: (w: World) => void, reason: RegExp]> = [
    [
      "the schema moved",
      (w) => {
        const candidate = image(w, "0.9.2");
        candidate.start = ["exit2"];
        candidate.migratesAnyway = true;
        candidate.teamSchema = 3;
        candidate.versionOutput = "version=0.9.2\nteam_schema=2\ncontract=2\naccepts=1,2\n";
      },
      /migrated the database/,
    ],
    [
      "the schema cannot be read",
      (w) => {
        image(w, "0.9.2").start = ["exit2"];
        w.schemaUnreadable = true;
      },
      /could not be read/,
    ],
    [
      "the previous image does not come back healthy",
      (w) => {
        image(w, "0.9.2").start = ["exit2"];
        image(w, "0.9.1").start = ["unhealthy"];
      },
      /did not come back healthy/,
    ],
  ];
  for (const [name, arrange, reason] of cases)
    test(`${name}: exit 10, the reason in the state, the runbook named`, async () => {
      const w = hostWorld();
      arrange(w);
      const before = w.env();
      expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(10);
      expect(w.state().lastChange).toMatchObject({ kind: "down" });
      expect(w.state().lastChange?.reason).toMatch(reason);
      expect(w.state().intent).toBeUndefined();
      expect(w.state().rejected ?? []).toEqual([]);
      expect(w.out.join("\n")).toContain("Rollback in docs/runbooks/team-server.md");
      // .env is left naming the candidate when the schema says the previous image cannot take
      // over. When it could, .env was put back before the start that then failed: it names the
      // previous version, and every other line is as it was.
      expect(w.env()).toBe(
        name === "the previous image does not come back healthy"
          ? before
          : before.replace("=0.9.1\n", `=${NEW.version}@${NEW.digest}\n`),
      );
    });

  test("a schema the previous image reads, but that is not the one before the apply: exit 10, and the reason says which", async () => {
    const w = hostWorld();
    image(w, "0.9.2").start = ["exit2"];
    // The database is at another schema once the candidate has started and failed.
    const run = w.deps.run;
    w.deps.run = (cmd, options) => {
      const result = run(cmd, options);
      if (cmd.includes("up")) w.dbSchema = 1;
      return result;
    };
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(10);
    expect(w.state().lastChange).toMatchObject({
      kind: "down",
      reason: "the database is at schema 1, not the 2 it was at before 0.9.2 was applied",
    });
    expect(w.env()).toContain(`WIZARDINGCODE_MEM_VERSION=${NEW.version}@${NEW.digest}`);
    expect(w.ran(/ up -d /)).toHaveLength(1);
    expect(w.state().rejected ?? []).toEqual([]);
    expect(w.out.join("\n")).toContain("Rollback in docs/runbooks/team-server.md");
  });
});

describe("the lease", () => {
  test("a container that exited with code 1 is waited for once more after the lease's length", async () => {
    const w = hostWorld();
    image(w, "0.9.2").start = ["exit1", "healthy"];
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(0);
    expect(w.sleeps).toEqual([30_000 + 5_000]);
    expect(w.ran(UP)).toHaveLength(2);
    expect(w.container).toMatchObject({ imageId: NEW.id, health: "healthy" });
    expect(w.state().rejected ?? []).toEqual([]);
    expect(logs(w)).toEqual([]);
  });

  test("an exit code that is not the lease's is not waited for", async () => {
    const w = hostWorld();
    image(w, "0.9.2").start = ["exit2", "healthy"];
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(11);
    expect(w.sleeps).toEqual([]);
  });
});
