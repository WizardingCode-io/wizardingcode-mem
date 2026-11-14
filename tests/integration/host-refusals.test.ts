// What the host's tool refuses before it reads or changes anything more (ADR 0033): exit 69.
import { describe, expect, test } from "bun:test";
import { renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { follow, upgrade } from "../../src/host/follow.ts";
import { stateDir } from "../../src/host/state.ts";
import { hostWorld, type World } from "../helpers/host-world.ts";

const CASES: Array<
  [name: string, arrange: (w: World) => void, says: RegExp, dockerAfter: RegExp | null]
> = [
  [
    "without the lock's marker",
    (w) => {
      delete w.deps.env.WIZARDINGCODE_MEM_HOST_LOCKED;
    },
    /upgrade\.sh/,
    null,
  ],
  [
    "a Compose under 2.20.0",
    (w) => {
      w.composeVersion = "v2.19.1";
    },
    /Docker Compose 2\.19\.1 .* 2\.20\.0/,
    /^docker compose version/,
  ],
  [
    "a server whose image is not of the repository",
    (w) => {
      if (w.container) w.container.ref = "ghcr.io/someone/else:0.9.1";
    },
    /ghcr\.io\/someone\/else:0\.9\.1/,
    /^docker inspect/,
  ],
  [
    "more than one server container",
    (w) => {
      w.extraContainers = ["c8"];
    },
    /more than one/,
    /^docker ps/,
  ],
  [
    "a container with no volume at /data",
    (w) => {
      w.noVolume = true;
    },
    /\/data/,
    /^docker inspect/,
  ],
  [
    "a .env line that is neither a version nor a version with a digest",
    (w) => {
      w.setEnv("WIZARDINGCODE_MEM_VERSION=latest\n");
    },
    /WIZARDINGCODE_MEM_VERSION=<a>\.<b>\.<c>/,
    /^docker inspect/,
  ],
  [
    "a .env that is a symbolic link",
    (w) => {
      renameSync(join(w.folder, ".env"), join(w.folder, "real.env"));
      symlinkSync(join(w.folder, "real.env"), join(w.folder, ".env"));
    },
    /\.env is a symbolic link/,
    null,
  ],
  [
    "a state.json that is a symbolic link",
    (w) => {
      writeFileSync(join(w.folder, "elsewhere.json"), '{"format":1}');
      symlinkSync(join(w.folder, "elsewhere.json"), join(stateDir(w.folder), "state.json"));
    },
    /state\.json is a symbolic link/,
    null,
  ],
  [
    "a state.json of a higher format",
    (w) => {
      writeFileSync(join(stateDir(w.folder), "state.json"), '{"format":2}');
    },
    /format 2/,
    /^docker inspect/,
  ],
];

describe("the tool refuses, with exit 69 and nothing changed", () => {
  for (const [name, arrange, says, dockerAfter] of CASES)
    for (const verb of ["follow", "upgrade"] as const)
      test(`${verb}: ${name}`, async () => {
        const w = hostWorld();
        arrange(w);
        const before = w.env();
        const exit =
          verb === "follow"
            ? await follow(w.deps, w.folder, { dryRun: false })
            : await upgrade(w.deps, w.folder);
        expect(exit).toBe(69);
        expect(w.err.join("\n")).toMatch(says);
        expect(w.env()).toBe(before);
        expect(w.writes).toEqual([]);
        expect(w.fetched).toEqual([]);
        expect(w.ran(/ up -d | stop server$|^docker pull |verifier@/)).toEqual([]);
        // Nothing of Docker is asked after the call that showed the refusal.
        const last = w.calls.at(-1)?.line ?? "";
        if (dockerAfter === null) expect(w.calls).toEqual([]);
        else expect(last).toMatch(dockerAfter);
      });

  test("a Compose that does not answer is cannot-check, not a refusal", async () => {
    const w = hostWorld();
    w.composeVersion = null;
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(13);
    expect(w.out.at(-1)).toBe("cannot-check: Docker did not answer");
  });

  test("a version with a prefix and a suffix is read by its first three numbers", async () => {
    const w = hostWorld();
    w.composeVersion = "v2.29.1-desktop.1";
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(0);
  });
});
