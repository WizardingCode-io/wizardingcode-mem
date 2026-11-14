// A run that finds an intent in the state (ADR 0033): an apply was interrupted. What the
// container is decides, and an attended intent is never undone.
import { describe, expect, test } from "bun:test";
import { follow, upgrade } from "../../src/host/follow.ts";
import type { Intent } from "../../src/host/state.ts";
import { hostWorld, IMAGE, NEW, OLD, sha, VOLUME, type World } from "../helpers/host-world.ts";

const OLD_LINE = "WIZARDINGCODE_MEM_VERSION=0.9.1";
const NEW_VALUE = `${NEW.version}@${NEW.digest}`;
const intent = (w: World, over: Partial<Intent> = {}): Intent => ({
  digest: NEW.digest as string,
  id: NEW.id,
  version: "0.9.2",
  fromId: OLD.id,
  fromEnvLine: OLD_LINE,
  fromVersion: "0.9.1",
  schema: 2,
  project: "proj",
  directory: w.folder,
  files: [`${w.folder}/compose.yml`],
  volume: VOLUME,
  attended: false,
  at: w.now - 60_000,
  ...over,
});
/** A host where an apply was cut after .env was rewritten. */
function cut(over: Partial<Intent> = {}): World {
  const w = hostWorld();
  w.present.add(NEW.id);
  w.setEnv(`SERVER_DOMAIN=team.example.com\nWIZARDINGCODE_MEM_VERSION=${NEW_VALUE}\n`);
  w.setState({ format: 1, intent: intent(w, over) });
  return w;
}
const candidateContainer = (
  w: World,
  state: "running" | "restarting" | "exited",
  health: "healthy" | "starting" | "unhealthy",
  exitCode = 0,
) => {
  w.container = {
    id: "c9",
    imageId: NEW.id,
    ref: `${IMAGE}:${NEW_VALUE}`,
    state,
    health,
    exitCode,
  };
};

describe("an interrupted apply", () => {
  for (const attended of [false, true])
    test(`the candidate runs healthy (${attended ? "attended" : "unattended"}): the apply is recorded and the run goes on`, async () => {
      const w = cut({ attended });
      candidateContainer(w, "running", "healthy");
      w.registryDigest = NEW.digest;
      expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(0);
      expect(w.state().intent).toBeUndefined();
      expect(w.state().lastChange).toMatchObject({ kind: "applied", from: "0.9.1", to: "0.9.2" });
      expect(w.state().previous).toMatchObject({ id: OLD.id });
      expect(w.out.at(-1)).toMatch(/^current: /);
      expect(w.ran(/ up -d | stop server$/)).toEqual([]);
    });

  for (const attended of [false, true])
    test(`the previous image runs healthy (${attended ? "attended" : "unattended"}): .env is put back and nothing is rejected`, async () => {
      const w = cut({ attended });
      w.registryDigest = OLD.digest;
      expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(0);
      expect(w.env()).toBe(`SERVER_DOMAIN=team.example.com\n${OLD_LINE}\n`);
      expect(w.state().intent).toBeUndefined();
      expect(w.state().rejected ?? []).toEqual([]);
      expect(w.ran(/ up -d | stop server$/)).toEqual([]);
    });

  test("another image runs healthy: the intent is cleared, and .env is the operator's to settle", async () => {
    const w = cut();
    const other = { ...structuredClone(OLD), id: sha("6"), digest: sha("c"), version: "0.9.3" };
    w.images.push(other);
    w.present.add(other.id);
    w.container = {
      id: "c7",
      imageId: other.id,
      ref: `${IMAGE}:0.9.3`,
      state: "running",
      health: "healthy",
      exitCode: 0,
    };
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(14);
    expect(w.state().intent).toBeUndefined();
    expect(w.out.at(-1)).toMatch(/^env-differs: /);
    expect(w.env()).toContain(NEW_VALUE);
  });

  test("starting, under fifteen minutes: exit 0 and the intent kept; past them it is a failed start", async () => {
    const young = cut();
    candidateContainer(young, "running", "starting");
    expect(await follow(young.deps, young.folder, { dryRun: false })).toBe(0);
    expect(young.out.at(-1)).toMatch(/^starting: /);
    expect(young.state().intent).toBeDefined();
    expect(young.ran(/ up -d | stop server$|^docker logs /)).toEqual([]);

    const old = cut({ at: Date.UTC(2026, 10, 13, 11, 0, 0) });
    candidateContainer(old, "running", "starting");
    expect(await follow(old.deps, old.folder, { dryRun: false })).toBe(11);
    expect(old.container).toMatchObject({ imageId: OLD.id, health: "healthy" });
  });

  test("unattended, a failed container of the candidate: the failed start's way, and the release is rejected", async () => {
    const w = cut();
    candidateContainer(w, "restarting", "starting", 2);
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(11);
    expect(w.ran(/^docker logs --tail 200 c9$/)).toHaveLength(1);
    expect(w.ran(/ stop server$/)).toHaveLength(1);
    expect(w.container).toMatchObject({ imageId: OLD.id, health: "healthy" });
    expect(w.env()).toBe(`SERVER_DOMAIN=team.example.com\n${OLD_LINE}\n`);
    expect(w.state().rejected).toEqual([expect.objectContaining({ digest: NEW.digest })]);
    expect(w.state().intent).toBeUndefined();
  });

  test("unattended, no container: the previous image is started with the intent's project, and nothing is rejected", async () => {
    const w = cut();
    w.container = null;
    w.registryDigest = OLD.digest;
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(0);
    const ups = w.ran(/ up -d /);
    expect(ups).toHaveLength(1);
    expect(ups[0]?.cmd.slice(0, 8)).toEqual([
      "docker",
      "compose",
      "--project-directory",
      w.folder,
      "-p",
      "proj",
      "-f",
      `${w.folder}/compose.yml`,
    ]);
    expect(
      w.ran(new RegExp(`^docker run .* -v ${VOLUME}:/data ${OLD.id} serve status$`)),
    ).toHaveLength(1);
    expect(w.ran(/^docker logs /)).toEqual([]);
    expect(w.container).toMatchObject({ imageId: OLD.id, health: "healthy" });
    expect(w.state().rejected ?? []).toEqual([]);
    expect(w.state().intent).toBeUndefined();
  });

  test("unattended, a stopped container that is not the candidate's: the same, nothing rejected", async () => {
    const w = cut();
    if (w.container) w.container.state = "exited";
    w.registryDigest = OLD.digest;
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(0);
    expect(w.container).toMatchObject({ imageId: OLD.id, state: "running", health: "healthy" });
    expect(w.state().rejected ?? []).toEqual([]);
  });

  test("attended, a server that is not healthy: nothing is changed, exit 10, and the intent stays", async () => {
    for (const verb of ["follow", "upgrade"] as const) {
      const w = cut({ attended: true });
      candidateContainer(w, "restarting", "starting", 3);
      const before = w.env();
      const exit =
        verb === "follow"
          ? await follow(w.deps, w.folder, { dryRun: false })
          : await upgrade(w.deps, w.folder);
      expect({ verb, exit }).toEqual({ verb, exit: 10 });
      expect(w.env()).toBe(before);
      expect(w.ran(/ up -d | stop server$/)).toEqual([]);
      expect(w.state().intent).toBeDefined();
      expect(w.out.join("\n")).toContain("an attended upgrade to 0.9.2 was interrupted");
    }
  });
});

describe("after a failure that ends an intent", () => {
  test("the run after a down saves no log, stops nothing and reads no schema", async () => {
    const w = hostWorld();
    const candidate = w.images.find((i) => i.version === "0.9.2");
    if (candidate) candidate.start = ["exit2"];
    w.schemaUnreadable = true;
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(10);
    expect(w.state().intent).toBeUndefined();
    const seen = w.calls.length;
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(10);
    const later = w.calls.slice(seen).map((call) => call.line);
    expect(
      later.filter((line) => /^docker logs | stop server$|serve status$| up -d /.test(line)),
    ).toEqual([]);
    expect(w.out.at(-1)).toMatch(
      /^down: the server is not running healthy: .*could not be read.*Rollback/,
    );
  });

  test("an attended failure leaves no intent", async () => {
    const w = hostWorld();
    const candidate = w.images.find((i) => i.version === "0.9.2");
    if (candidate) candidate.start = ["exit2"];
    expect(await upgrade(w.deps, w.folder)).toBe(10);
    expect(w.state().intent).toBeUndefined();
  });
});
