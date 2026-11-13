// `follow` applying a release (ADR 0033): a verified, higher image of the database's schema.
import { describe, expect, test } from "bun:test";
import { follow } from "../../src/host/follow.ts";
import { hostWorld, IMAGE, indexOfCall, NEW, OLD, sha } from "../helpers/host-world.ts";

const UP = / up -d --no-deps --pull never --wait --wait-timeout 300 server$/;

describe("follow applies a verified higher release of the same schema", () => {
  test(".env names version and digest, every other line as it was, and the exit is 0", async () => {
    const w = hostWorld();
    expect({ exit: await follow(w.deps, w.folder, { dryRun: false }), err: w.err }).toEqual({
      exit: 0,
      err: [],
    });
    expect(w.env()).toBe(
      `SERVER_DOMAIN=team.example.com\nWIZARDINGCODE_MEM_VERSION=${NEW.version}@${NEW.digest}\n`,
    );
    expect(w.container).toMatchObject({ imageId: NEW.id, state: "running", health: "healthy" });
    expect(w.out.at(-1)).toBe("applied: 0.9.1 -> 0.9.2");
  });

  test("up names the project, the directory and each file of the container's labels", async () => {
    const w = hostWorld();
    await follow(w.deps, w.folder, { dryRun: false });
    const ups = w.ran(UP);
    expect(ups).toHaveLength(1);
    expect(ups[0]?.cmd.slice(0, ups[0].cmd.indexOf("up"))).toEqual([
      "docker",
      "compose",
      "--project-directory",
      w.folder,
      "-p",
      "proj",
      "-f",
      `${w.folder}/compose.yml`,
      "-f",
      `${w.folder}/compose.override.yml`,
    ]);
  });

  test("the verifier runs before the pull, the pull before any run of the candidate", async () => {
    const w = hostWorld();
    await follow(w.deps, w.folder, { dryRun: false });
    const verifier = indexOfCall(w, /^docker run .* ghcr\.io\/acme\/verifier@/);
    const pull = indexOfCall(w, /^docker pull /);
    const candidate = indexOfCall(w, new RegExp(`^docker run .* ${NEW.id} serve version$`));
    expect(verifier).toBeGreaterThan(-1);
    expect(pull).toBeGreaterThan(verifier);
    expect(candidate).toBeGreaterThan(pull);
    expect(w.calls[pull]?.line).toBe(`docker pull ${IMAGE}@${NEW.digest}`);
    expect(w.calls[verifier]?.cmd.slice(-3)).toEqual([
      "verify",
      `${IMAGE}@${NEW.digest}`,
      "--the-identity",
    ]);
  });

  test("the facts are read in the rule's order", async () => {
    const w = hostWorld();
    await follow(w.deps, w.folder, { dryRun: false });
    const order = [
      /^docker compose version --short$/,
      /^docker ps /,
      /^docker inspect /,
      /^docker exec c1 wizardingcode-mem serve status$/,
      /^docker exec c1 wizardingcode-mem serve version$/,
      /^docker run .* ghcr\.io\/acme\/verifier@/,
      /^docker pull /,
      / up -d /,
    ].map((pattern) => indexOfCall(w, pattern));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The registry is asked after the running server and before the verifier.
    expect(w.fetched).toEqual(["https://ghcr.io/v2/acme/team/manifests/latest"]);
  });

  test("the intent is in the state before .env changes, and gone after", async () => {
    const w = hostWorld();
    await follow(w.deps, w.folder, { dryRun: false });
    const state = w.writes.indexOf("rename state.json");
    const env = w.writes.indexOf("write ..env." + process.pid + ".tmp");
    expect(state).toBeGreaterThan(-1);
    expect(env).toBeGreaterThan(state);
    expect(w.state().intent).toBeUndefined();
    expect(w.state()).toMatchObject({
      lastChange: { kind: "applied", from: "0.9.1", to: "0.9.2" },
      previous: { id: OLD.id, version: "0.9.1", envLine: "WIZARDINGCODE_MEM_VERSION=0.9.1" },
      lastRun: { verb: "follow", outcome: "apply", exit: 0 },
    });
  });

  test("the other images of the repository are removed, never the running or the previous one", async () => {
    const w = hostWorld();
    const stale = {
      id: sha("7"),
      digest: sha("e"),
      version: "0.9.0",
      teamSchema: 2,
      contract: 2,
      accepts: [1, 2],
      start: ["healthy" as const],
    };
    w.images.push(stale);
    w.present.add(stale.id);
    await follow(w.deps, w.folder, { dryRun: false });
    expect(w.ran(/^docker image rm /).map((call) => call.cmd.at(-1))).toEqual([stale.id]);
    expect([...w.present].sort()).toEqual([OLD.id, NEW.id].sort());
    expect(w.ran(/^docker image rm .*(-f|--force)/)).toEqual([]);
  });
});
