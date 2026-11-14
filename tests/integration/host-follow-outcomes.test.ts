// Every outcome of `follow` that changes nothing (ADR 0033): its exit code, what it does not
// touch, and which later facts it never reads.
import { describe, expect, test } from "bun:test";
import { follow } from "../../src/host/follow.ts";
import { SCRUBBED } from "../../src/host/run.ts";
import { hostWorld, NEW, OLD, type World } from "../helpers/host-world.ts";

const VERIFIER = /^docker run .* ghcr\.io\/acme\/verifier@/;
const PULL = /^docker pull /;
const image = (w: World, version: string) => {
  const found = w.images.find((i) => i.version === version);
  if (found === undefined) throw new Error("no such image in the model");
  return found;
};

interface Case {
  name: string;
  arrange: (w: World) => void;
  exit: number;
  outcome: string;
  /** The last row of the rule the run reaches. */
  row: number;
}

const CASES: Case[] = [
  {
    name: "Docker did not answer",
    arrange: (w) => {
      w.dockerSilent = true;
    },
    exit: 13,
    outcome: "cannot-check",
    row: 1,
  },
  {
    name: "starting",
    arrange: (w) => {
      if (w.container) w.container.health = "starting";
    },
    exit: 0,
    outcome: "starting",
    row: 2,
  },
  {
    name: "down: no container",
    arrange: (w) => {
      w.container = null;
    },
    exit: 10,
    outcome: "down",
    row: 3,
  },
  {
    name: "down: unhealthy",
    arrange: (w) => {
      if (w.container) w.container.health = "unhealthy";
    },
    exit: 10,
    outcome: "down",
    row: 3,
  },
  {
    name: "down: exited",
    arrange: (w) => {
      if (w.container) w.container.state = "exited";
    },
    exit: 10,
    outcome: "down",
    row: 3,
  },
  {
    name: "env-differs",
    arrange: (w) => {
      w.setEnv("WIZARDINGCODE_MEM_VERSION=0.9.0\n");
    },
    exit: 14,
    outcome: "env-differs",
    row: 4,
  },
  {
    name: "the running server's serve status cannot run",
    arrange: (w) => {
      image(w, "0.9.1").statusBroken = true;
    },
    exit: 13,
    outcome: "cannot-check",
    row: 5,
  },
  {
    name: "the registry gives no digest",
    arrange: (w) => {
      w.registryDigest = null;
    },
    exit: 13,
    outcome: "cannot-check",
    row: 6,
  },
  {
    name: "current",
    arrange: (w) => {
      w.registryDigest = OLD.digest;
    },
    exit: 0,
    outcome: "current",
    row: 7,
  },
  {
    name: "the verifier's run itself failed",
    arrange: (w) => {
      w.verifier = { code: 125, stderr: "Unable to find image" };
    },
    exit: 13,
    outcome: "cannot-check",
    row: 9,
  },
  {
    name: "the verifier exceeded its bound",
    arrange: (w) => {
      w.verifier = { code: 124, timedOut: true };
    },
    exit: 13,
    outcome: "cannot-check",
    row: 9,
  },
  {
    name: "not-verified",
    arrange: (w) => {
      w.verifier = { code: 1, stderr: "no matching signatures" };
    },
    exit: 12,
    outcome: "not-verified",
    row: 10,
  },
  {
    name: "low-disk before the pull",
    arrange: (w) => {
      w.freeBytes = 100 * 1024 * 1024;
    },
    exit: 15,
    outcome: "low-disk",
    row: 11,
  },
  {
    name: "low-disk: free space unknown",
    arrange: (w) => {
      w.freeBytes = null;
    },
    exit: 15,
    outcome: "low-disk",
    row: 11,
  },
  {
    name: "the pull failed",
    arrange: (w) => {
      w.pullFails = true;
    },
    exit: 13,
    outcome: "cannot-check",
    row: 12,
  },
  {
    name: "untrusted serve version output",
    arrange: (w) => {
      image(w, "0.9.2").versionOutput =
        "version=0.9.2; rm -rf /\nteam_schema=2\ncontract=2\naccepts=1,2\n";
    },
    exit: 13,
    outcome: "cannot-check",
    row: 12,
  },
  {
    name: "a team_schema that is no integer",
    arrange: (w) => {
      image(w, "0.9.2").versionOutput = "version=0.9.2\nteam_schema=two\ncontract=2\naccepts=1,2\n";
    },
    exit: 13,
    outcome: "cannot-check",
    row: 12,
  },
  {
    name: "not-higher",
    arrange: (w) => {
      image(w, "0.9.2").version = "0.9.0";
    },
    exit: 0,
    outcome: "not-higher",
    row: 13,
  },
  {
    name: "waits-migration",
    arrange: (w) => {
      image(w, "0.9.2").teamSchema = 3;
    },
    exit: 14,
    outcome: "waits-migration",
    row: 14,
  },
  {
    name: "waits-contract",
    arrange: (w) => {
      image(w, "0.9.2").accepts = [2];
    },
    exit: 14,
    outcome: "waits-contract",
    row: 15,
  },
];

describe("follow, when it changes nothing", () => {
  for (const c of CASES)
    test(`${c.name}: ${c.outcome}, exit ${c.exit}`, async () => {
      const w = hostWorld();
      c.arrange(w);
      const before = w.env();
      const container = structuredClone(w.container);
      expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(c.exit);
      expect(w.out.at(-1)?.startsWith(`${c.outcome}: `)).toBe(true);
      expect(w.env()).toBe(before);
      expect(w.container).toEqual(container);
      expect(w.ran(/ up -d | stop server$/)).toEqual([]);
      expect(w.writes.filter((step) => step.includes(".env"))).toEqual([]);
      if (c.row <= 8) expect(w.ran(VERIFIER)).toEqual([]);
      else expect(w.ran(VERIFIER)).toHaveLength(1);
      if (c.row <= 11) expect(w.ran(PULL)).toEqual([]);
      else expect(w.ran(PULL)).toHaveLength(1);
      if (c.row <= 5) expect(w.fetched).toEqual([]);
      expect(w.state().lastRun).toMatchObject({ verb: "follow", outcome: c.outcome, exit: c.exit });
    });

  test("not-verified keeps the verifier's last lines, cleaned and truncated", async () => {
    const w = hostWorld();
    w.verifier = {
      code: 1,
      stderr: `first line\nsecond line\n\u001b[31mError:\u001b[0m no matching signatures\n${"z".repeat(2000)}\n`,
    };
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(12);
    const line = w.out.at(-1) as string;
    expect(line).toContain("?[31mError:?[0m no matching signatures");
    expect(line).not.toContain("\u001b");
    expect(line).not.toContain("first line");
    expect((line.match(/z/g) ?? []).length).toBeLessThanOrEqual(500);
    expect(line).toContain(`${NEW.digest} did not verify`);
  });

  test("a failed pull's words are cleaned too", async () => {
    const w = hostWorld();
    w.pullFails = true;
    await follow(w.deps, w.folder, { dryRun: false });
    expect(w.out.at(-1)).toContain("manifest unknown?[31m");
  });

  test("every call carries a time bound, up's being its wait plus the margin, and no Docker child sees the five variables", async () => {
    const w = hostWorld();
    expect(await follow(w.deps, w.folder, { dryRun: false })).toBe(0);
    expect(w.calls.length).toBeGreaterThan(8);
    for (const call of w.calls) {
      expect({ line: call.line, bounded: call.timeoutMs > 0 }).toEqual({
        line: call.line,
        bounded: true,
      });
      for (const name of SCRUBBED)
        expect({ line: call.line, name, set: call.env?.[name] }).toEqual({
          line: call.line,
          name,
          set: undefined,
        });
      expect(call.env?.PATH).toBe("/usr/bin");
    }
    expect(w.ran(/ up -d /)[0]?.timeoutMs).toBe(300_000 + 120_000);
    expect(w.ran(/^docker pull /)[0]?.timeoutMs).toBe(600_000);
    expect(w.ran(/verifier@/)[0]?.timeoutMs).toBe(180_000);
    expect(w.ran(/^docker ps /)[0]?.timeoutMs).toBe(30_000);
  });

  test("the verifier and the candidate run confined", async () => {
    const w = hostWorld();
    await follow(w.deps, w.folder, { dryRun: false });
    const confined = [
      "--rm",
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
    ];
    const verifier = w.ran(VERIFIER)[0]?.cmd ?? [];
    for (const part of [...confined, "HOME=/tmp", "DOCKER_CONFIG=/tmp/none"])
      expect({ part, there: verifier.includes(part) }).toEqual({ part, there: true });
    const candidate = w.ran(new RegExp(`${NEW.id} serve version$`))[0]?.cmd ?? [];
    for (const part of [...confined, "--network", "none", "--user", "10001:10001"])
      expect({ part, there: candidate.includes(part) }).toEqual({ part, there: true });
    expect(candidate.includes("-v")).toBe(false);
    expect(candidate.includes("-e")).toBe(false);
  });
});
