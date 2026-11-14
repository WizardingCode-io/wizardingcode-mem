// `upgrade`, the attended verb (ADR 0033): across a migration too, and when the start fails
// it undoes nothing and names what the operator does next.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { upgrade } from "../../src/host/follow.ts";
import { stateDir } from "../../src/host/state.ts";
import { hostWorld, NEW, OLD, VOLUME, type World } from "../helpers/host-world.ts";

const FLOOR = 500 * 1024 * 1024;
const image = (w: World, version: string) => {
  const found = w.images.find((i) => i.version === version);
  if (found === undefined) throw new Error("no such image in the model");
  return found;
};

describe("upgrade applies what follow leaves to the operator", () => {
  test("a verified candidate of another schema, with room for the copy", async () => {
    const w = hostWorld();
    image(w, "0.9.2").teamSchema = 3;
    w.dbBytes = 2000;
    w.freeBytes = FLOOR + 2000;
    expect(await upgrade(w.deps, w.folder)).toBe(0);
    expect(w.container).toMatchObject({ imageId: NEW.id, health: "healthy" });
    expect(w.dbSchema).toBe(3);
    expect(w.ran(/ up -d .*--wait-timeout 1800 server$/)).toHaveLength(1);
    expect(w.ran(/ up -d /)[0]?.timeoutMs).toBe(1_800_000 + 120_000);
    expect(w.state().lastRun).toMatchObject({ verb: "upgrade", outcome: "apply", exit: 0 });
  });

  test("without room for the copy it is low-disk, and nothing changes", async () => {
    const w = hostWorld();
    image(w, "0.9.2").teamSchema = 3;
    w.dbBytes = 2000;
    w.freeBytes = FLOOR + 1999;
    const before = w.env();
    expect(await upgrade(w.deps, w.folder)).toBe(15);
    expect(w.env()).toBe(before);
    expect(w.ran(/ up -d /)).toEqual([]);
  });

  test("a digest on the rejected list, and a candidate that no longer accepts a running contract", async () => {
    const rejected = hostWorld();
    rejected.setState({
      format: 1,
      rejected: [{ digest: NEW.digest as string, version: "0.9.2", at: 1, reason: "exited 2" }],
    });
    expect(await upgrade(rejected.deps, rejected.folder)).toBe(0);
    expect(rejected.container?.imageId).toBe(NEW.id);

    const contract = hostWorld();
    image(contract, "0.9.2").accepts = [2];
    expect(await upgrade(contract.deps, contract.folder)).toBe(0);
    expect(contract.container?.imageId).toBe(NEW.id);
  });

  test("a candidate the verifier refuses: exit 12, no pull, no up, .env as it was", async () => {
    const w = hostWorld();
    w.verifier = { code: 1, stderr: "no matching signatures" };
    const before = w.env();
    expect(await upgrade(w.deps, w.folder)).toBe(12);
    expect(w.env()).toBe(before);
    expect(w.ran(/^docker pull | up -d /)).toEqual([]);
  });

  test("a candidate of a lower version is not applied either", async () => {
    const w = hostWorld();
    image(w, "0.9.2").version = "0.9.0";
    expect(await upgrade(w.deps, w.folder)).toBe(0);
    expect(w.out.at(-1)).toMatch(/^not-higher: /);
    expect(w.ran(/ up -d /)).toEqual([]);
  });
});

describe("upgrade, when the start fails", () => {
  test("the schema moved: nothing stopped, .env names the candidate, the log saved, nothing rejected, the restore command given", async () => {
    const w = hostWorld();
    const candidate = image(w, "0.9.2");
    candidate.teamSchema = 3;
    candidate.start = ["exit2"];
    candidate.migratesAnyway = true;
    expect(await upgrade(w.deps, w.folder)).toBe(10);
    expect(w.ran(/ stop server$/)).toEqual([]);
    expect(w.ran(/ up -d /)).toHaveLength(1);
    expect(w.env()).toContain(`WIZARDINGCODE_MEM_VERSION=0.9.2@${NEW.digest}`);
    expect(w.container).toMatchObject({ imageId: NEW.id, state: "restarting" });
    expect(readdirSync(join(stateDir(w.folder), "logs"))).toHaveLength(1);
    expect(w.state().rejected ?? []).toEqual([]);
    expect(w.state().intent).toBeUndefined();
    expect(w.state().lastChange).toMatchObject({
      kind: "upgrade-failed",
      from: "0.9.1",
      to: "0.9.2",
    });
    expect(
      w.ran(new RegExp(`^docker run .* -v ${VOLUME}:/data ${OLD.id} serve status$`)),
    ).toHaveLength(1);
    const out = w.out.join("\n");
    expect(out).toMatch(/^upgrade-failed: /m);
    expect(out).toContain("docker compose run --rm server serve restore --to-schema 2");
    expect(out).toContain("Rollback in docs/runbooks/team-server.md");
    expect(out).not.toContain("if `serve status` shows");
  });

  test("the schema cannot be read: the same command, given conditionally", async () => {
    const w = hostWorld();
    image(w, "0.9.2").start = ["unhealthy"];
    w.schemaUnreadable = true;
    expect(await upgrade(w.deps, w.folder)).toBe(10);
    const out = w.out.join("\n");
    expect(out).toContain("if `serve status` shows a schema above 2");
    expect(out).toContain("docker compose run --rm server serve restore --to-schema 2");
    expect(w.ran(/ stop server$/)).toEqual([]);
  });

  test("the schema did not move: no restore command, and still nothing undone", async () => {
    const w = hostWorld();
    image(w, "0.9.2").start = ["exit2"];
    expect(await upgrade(w.deps, w.folder)).toBe(10);
    expect(w.out.join("\n")).not.toContain("serve restore");
    expect(w.env()).toContain(`0.9.2@${NEW.digest}`);
    expect(w.ran(/ up -d /)).toHaveLength(1);
  });
});
