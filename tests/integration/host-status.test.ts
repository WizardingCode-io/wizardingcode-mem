// `serve host status` (ADR 0033): what an operator reads six months later. It writes nothing.
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "../../src/host/state.ts";
import { status } from "../../src/host/status.ts";
import { hostWorld, IMAGE, NEW, OLD, sha, VOLUME } from "../helpers/host-world.ts";

const HOUR = 3_600_000;

describe("status", () => {
  test("prints, in order, what runs, the schema, the last change and run, the rejected, what waits, the lock, the tool, and one next command", async () => {
    const w = hostWorld();
    w.setState({
      format: 1,
      lastChange: { kind: "applied", from: "0.9.0", to: "0.9.1", at: w.now - 2 * HOUR },
      lastRun: {
        verb: "follow",
        outcome: "waits-migration",
        exit: 14,
        at: w.now - 10 * 60_000,
        candidate: { version: "0.10.0", digest: sha("d") },
      },
      rejected: [
        {
          digest: sha("e"),
          version: "0.9.5",
          at: w.now - 72 * HOUR,
          reason: "the container is restarting (exit 2), health starting",
          log: "20261110T120000Z-0.9.5.log",
        },
      ],
    });
    writeFileSync(join(stateDir(w.folder), "lock.info"), "follow\n4242\n2026-11-13T11:59:00Z\n");
    expect(await status(w.deps, w.folder, "held")).toBe(0);
    expect(w.out).toEqual([
      `runs: 0.9.1 (${OLD.digest}), healthy, since 2026-11-13T11:00:00Z`,
      "schema: 2",
      "last change: applied 0.9.0 -> 0.9.1, 2h ago",
      "last run: follow waits-migration (exit 14), 10m ago",
      `rejected: 0.9.5 ${sha("e")}, 3d ago: the container is restarting (exit 2), health starting (log 20261110T120000Z-0.9.5.log)`,
      `waits: 0.10.0 (waits-migration); run ${w.folder}/upgrade.sh upgrade`,
      "lock: held by follow since 2026-11-13T11:59:00Z",
      "tool: 0.9.1",
      `next: ${w.folder}/upgrade.sh upgrade`,
    ]);
    expect(w.writes).toEqual([]);
    expect(w.ran(/ up -d | stop |^docker pull |^docker run |^docker image rm /)).toEqual([]);
    expect(w.fetched).toEqual([]);
  });

  test("an image with no digest, a .env that differs, an interrupted apply, a free lock", async () => {
    const w = hostWorld();
    const local = w.images.find((i) => i.id === OLD.id);
    if (local) local.digest = null;
    w.setEnv(`WIZARDINGCODE_MEM_VERSION=${NEW.version}@${NEW.digest}\n`);
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
        files: [],
        volume: VOLUME,
        attended: false,
        at: w.now - 90_000,
      },
    });
    expect(await status(w.deps, w.folder, "free")).toBe(0);
    expect(w.out).toEqual([
      "runs: 0.9.1 (no digest), healthy, since 2026-11-13T11:00:00Z",
      `.env: names ${NEW.version}@${NEW.digest}, which is not what runs`,
      "schema: 2",
      "last change: none",
      "last run: none",
      "interrupted: an unattended apply of 0.9.2 begun 1m ago",
      "lock: free",
      "tool: 0.9.1",
      `next: ${w.folder}/upgrade.sh follow`,
    ]);
    expect(w.writes).toEqual([]);
  });

  test("nothing to do, and no lock line when the launcher did not say", async () => {
    const w = hostWorld();
    expect(await status(w.deps, w.folder, undefined)).toBe(0);
    expect(w.out).toEqual([
      `runs: 0.9.1 (${OLD.digest}), healthy, since 2026-11-13T11:00:00Z`,
      "schema: 2",
      "last change: none",
      "last run: none",
      "tool: 0.9.1",
      "next: nothing to do",
    ]);
  });

  test("a server that is down: the recorded reason, and the runbook as the next step", async () => {
    const w = hostWorld();
    if (w.container) w.container = { ...w.container, state: "exited", ref: `${IMAGE}:0.9.1` };
    w.setState({
      format: 1,
      lastChange: {
        kind: "down",
        from: "0.9.1",
        to: "0.9.2",
        at: w.now - 30_000,
        reason: "the database's schema could not be read with the previous image",
      },
    });
    expect(await status(w.deps, w.folder, "free")).toBe(0);
    expect(w.out[0]).toBe("runs: nothing healthy (the container is exited)");
    expect(w.out).toContain(
      "last change: down 0.9.1 -> 0.9.2, 30s ago: the database's schema could not be read with the previous image",
    );
    expect(w.out.at(-1)).toBe("next: see Rollback in docs/runbooks/team-server.md");
  });

  test("a Docker that does not answer is exit 13, and a state it cannot read exit 69", async () => {
    const silent = hostWorld();
    silent.dockerSilent = true;
    expect(await status(silent.deps, silent.folder, "free")).toBe(13);
    expect(silent.err.join("\n")).toContain("Docker did not answer");

    const refused = hostWorld();
    writeFileSync(join(stateDir(refused.folder), "state.json"), "{not json");
    expect(await status(refused.deps, refused.folder, "free")).toBe(69);
  });
});
