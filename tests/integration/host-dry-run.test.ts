// `follow --dry-run` (ADR 0033): the outcome `follow` would reach. It may download; it changes
// no container, no .env, no state and no history.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { follow } from "../../src/host/follow.ts";
import { stateDir } from "../../src/host/state.ts";
import { hostWorld, NEW, OLD, sha } from "../helpers/host-world.ts";

describe("follow --dry-run", () => {
  test("says first what it may do, reaches the outcome follow would, and writes nothing", async () => {
    const w = hostWorld();
    const before = w.env();
    expect(await follow(w.deps, w.folder, { dryRun: true })).toBe(0);
    expect(w.out[0]).toBe(
      "dry run: may download the candidate and remove an older candidate's image; changes no container, .env or state",
    );
    expect(w.out.at(-1)).toMatch(/^would: apply: /);
    expect(w.env()).toBe(before);
    expect(w.container).toMatchObject({ id: "c1", imageId: OLD.id });
    expect(w.ran(/ up -d | stop server$/)).toEqual([]);
    expect(w.writes).toEqual([]);
    expect(existsSync(join(stateDir(w.folder), "state.json"))).toBe(false);
    expect(existsSync(join(stateDir(w.folder), "history.log"))).toBe(false);
  });

  test("it gives the exit of the outcome it would reach", async () => {
    const w = hostWorld();
    w.verifier = { code: 1, stderr: "no matching signatures" };
    expect(await follow(w.deps, w.folder, { dryRun: true })).toBe(12);
    expect(w.out.at(-1)).toMatch(/^would: not-verified: /);
    expect(w.writes).toEqual([]);
  });

  test("after a pull, the images that are neither running, previous nor the candidate are removed", async () => {
    const w = hostWorld();
    const earlier = {
      id: sha("5"),
      digest: sha("f"),
      version: "0.9.15",
      teamSchema: 2,
      contract: 2,
      accepts: [1, 2],
      start: ["healthy" as const],
    };
    const previous = { ...earlier, id: sha("4"), digest: sha("0"), version: "0.9.0" };
    w.images.push(earlier, previous);
    w.present.add(earlier.id).add(previous.id);
    w.setState({
      format: 1,
      previous: { id: previous.id, version: "0.9.0", envLine: "WIZARDINGCODE_MEM_VERSION=0.9.0" },
    });
    await follow(w.deps, w.folder, { dryRun: true });
    expect(w.ran(/^docker image rm /).map((call) => call.cmd.at(-1))).toEqual([earlier.id]);
    expect([...w.present].sort()).toEqual([OLD.id, NEW.id, previous.id].sort());
  });

  test("with an interrupted apply in the state it changes nothing and says so", async () => {
    const w = hostWorld();
    w.setState({
      format: 1,
      intent: {
        digest: NEW.digest as string,
        id: NEW.id,
        version: "0.9.2",
        fromId: OLD.id,
        fromEnvLine: "WIZARDINGCODE_MEM_VERSION=0.9.1",
        fromVersion: "0.9.1",
        schema: 2,
        project: "proj",
        directory: w.folder,
        files: [`${w.folder}/compose.yml`],
        volume: "proj_data",
        attended: false,
        at: w.now - 1000,
      },
    });
    expect(await follow(w.deps, w.folder, { dryRun: true })).toBe(14);
    expect(w.out.at(-1)).toMatch(/^would: finish the interrupted apply of 0\.9\.2 first/);
    expect(w.writes).toEqual([]);
    expect(w.state().intent).toBeDefined();
  });
});
