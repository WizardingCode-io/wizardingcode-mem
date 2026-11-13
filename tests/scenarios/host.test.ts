// The host's tool against a real Docker daemon (ADR 0033): a throwaway Compose project, a
// local registry and small stand-in images. Skipped unless WIZARDINGCODE_MEM_HOST_SCENARIOS=1:
// it needs a daemon, builds images and takes a minute or two. CI's `host` job runs it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { BOUNDS } from "../../src/host/bounds.ts";
import { type Deps, realDeps, type Target } from "../../src/host/deps.ts";
import { follow, upgrade } from "../../src/host/follow.ts";

const ON = process.env.WIZARDINGCODE_MEM_HOST_SCENARIOS === "1";
const HERE = join(import.meta.dir, "host");
const REGISTRY_IMAGE =
  "registry:2@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373";
const BUSYBOX =
  "busybox:1.36@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662";
const DIGEST_IN_ENV = /^WIZARDINGCODE_MEM_VERSION=(\d+\.\d+\.\d+)@(sha256:[0-9a-f]{64})$/m;

function sh(cmd: string[], cwd?: string): string {
  const out = Bun.spawnSync(cmd, {
    ...(cwd === undefined ? {} : { cwd }),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (out.exitCode !== 0)
    throw new Error(`${cmd.join(" ")}: exit ${out.exitCode}\n${out.stderr.toString()}`);
  return out.stdout.toString().trim();
}

test("the host scenarios say when they are skipped", () => {
  if (!ON)
    console.log(
      "host scenarios skipped: set WIZARDINGCODE_MEM_HOST_SCENARIOS=1 (needs a Docker daemon)",
    );
  expect(typeof ON).toBe("boolean");
});

describe.skipIf(!ON)("a host follows releases, against a real daemon", () => {
  const tag = `wcm-scn-${process.pid}`;
  let folder = "";
  let repo = "";
  let registry = "";
  let lines: string[] = [];

  const images: Array<[version: string, args: Record<string, string>]> = [
    ["0.9.1", {}],
    ["0.9.2", {}],
    ["0.9.3", { WCM_START: "exit" }],
    ["0.9.4", { WCM_HEALTH: "bad" }],
    ["0.9.5", {}],
    ["0.10.0", { WCM_SCHEMA: "3" }],
  ];

  function deps(verified: boolean): Deps {
    const target: Target = {
      image: repo,
      registry,
      cosignImage: BUSYBOX,
      // The verifier here is busybox: `true` is a signature that verifies, `false` one that does not.
      verifyArgs: () => [verified ? "true" : "false"],
    };
    lines = [];
    return {
      ...realDeps({
        leaseMs: 1000,
        version: "scenario",
        // The suite's preload points HOME at a throwaway folder; Docker's CLI finds its
        // Compose plugin and its context under the person's own.
        env: { ...process.env, HOME: userInfo().homedir, WIZARDINGCODE_MEM_HOST_LOCKED: "1" },
        target,
        bounds: { ...BOUNDS, waitUnattended: 30_000, waitAttended: 30_000, upMargin: 30_000 },
      }),
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
    };
  }
  /** Moves the registry's `latest` to the image of `version`. */
  function release(version: string): void {
    sh(["docker", "pull", "-q", `${repo}:${version}`]);
    sh(["docker", "tag", `${repo}:${version}`, `${repo}:latest`]);
    sh(["docker", "push", "-q", `${repo}:latest`]);
  }
  /** What the project's server runs now: its version by `serve status`, and its health. */
  function server(): { version: string; health: string; schema: string } {
    const id = sh(["docker", "compose", "ps", "-q", "server"], folder);
    const health = sh(["docker", "inspect", "--format", "{{.State.Health.Status}}", id]);
    const status = sh(["docker", "exec", id, "wizardingcode-mem", "serve", "status"]);
    return {
      version: /^version: (.*)$/m.exec(status)?.[1] ?? "",
      schema: /^schema: (.*)$/m.exec(status)?.[1] ?? "",
      health,
    };
  }
  const env = () => readFileSync(join(folder, ".env"), "utf8");

  beforeAll(() => {
    // The registry listens on the daemon's own host network, where the daemon's loopback finds
    // it: on Docker Desktop the daemon runs in a virtual machine whose loopback does not see a
    // published port. There this process cannot reach that network either, so it reads through
    // a second registry, a read-through mirror of the first, on a published port.
    const port = 20000 + Math.floor(Math.random() * 30000);
    sh([
      "docker",
      "run",
      "-d",
      "--name",
      `${tag}-registry`,
      "--network",
      "host",
      "-e",
      `REGISTRY_HTTP_ADDR=0.0.0.0:${port}`,
      REGISTRY_IMAGE,
    ]);
    repo = `127.0.0.1:${port}/wcm`;
    registry = `http://127.0.0.1:${port}`;
    if (process.platform === "darwin") {
      const gateway = sh([
        "docker",
        "network",
        "inspect",
        "bridge",
        "--format",
        "{{(index .IPAM.Config 0).Gateway}}",
      ]);
      sh([
        "docker",
        "run",
        "-d",
        "--name",
        `${tag}-mirror`,
        "-p",
        "127.0.0.1::5000",
        "-e",
        `REGISTRY_PROXY_REMOTEURL=http://${gateway}:${port}`,
        REGISTRY_IMAGE,
      ]);
      const published = sh(["docker", "port", `${tag}-mirror`, "5000/tcp"])
        .split(":")
        .pop();
      registry = `http://127.0.0.1:${published}`;
    }
    for (const [version, args] of images) {
      const build = Object.entries({ WCM_VERSION: version, ...args }).flatMap(([k, v]) => [
        "--build-arg",
        `${k}=${v}`,
      ]);
      sh(["docker", "build", "-q", ...build, "-t", `${repo}:${version}`, HERE]);
      sh(["docker", "push", "-q", `${repo}:${version}`]);
    }
    // The folder as Compose will record it, so the label and the tool's --dir agree.
    folder = realpathSync(mkdtempSync(join(tmpdir(), `${tag}-`)));
    copyFileSync(join(HERE, "compose.yml"), join(folder, "compose.yml"));
    writeFileSync(
      join(folder, ".env"),
      `SCENARIO_IMAGE=${repo}\nWIZARDINGCODE_MEM_VERSION=0.9.1\n`,
    );
    sh(["docker", "pull", "-q", `${repo}:0.9.1`]);
    sh(["docker", "compose", "up", "-d", "--wait", "server"], folder);
  }, 600_000);

  afterAll(() => {
    const quiet = (cmd: string[], cwd?: string) =>
      Bun.spawnSync(cmd, {
        ...(cwd === undefined ? {} : { cwd }),
        stdout: "ignore",
        stderr: "ignore",
      });
    if (folder !== "") {
      quiet(["docker", "compose", "down", "-v", "-t", "1"], folder);
      rmSync(folder, { recursive: true, force: true });
    }
    quiet(["docker", "rm", "-f", `${tag}-registry`, `${tag}-mirror`]);
    const left = Bun.spawnSync(["docker", "image", "ls", "-q", repo]).stdout.toString().split("\n");
    for (const id of new Set(left.filter(Boolean))) quiet(["docker", "image", "rm", "-f", id]);
  }, 120_000);

  test("a verified higher image of the same schema ends running, healthy, with .env naming its digest", async () => {
    release("0.9.2");
    expect({ exit: await follow(deps(true), folder, { dryRun: false }), lines }).toMatchObject({
      exit: 0,
    });
    expect(server()).toEqual({ version: "0.9.2", health: "healthy", schema: "2" });
    expect(DIGEST_IN_ENV.exec(env())?.[1]).toBe("0.9.2");
    expect(env()).toContain(`SCENARIO_IMAGE=${repo}\n`);
    expect(lines.at(-1)).toBe("applied: 0.9.1 -> 0.9.2");
  }, 180_000);

  test("an image that exits at start ends with the previous image running healthy, and is not tried again", async () => {
    const before = env();
    release("0.9.3");
    expect({ exit: await follow(deps(true), folder, { dryRun: false }), lines }).toMatchObject({
      exit: 11,
    });
    expect(server()).toEqual({ version: "0.9.2", health: "healthy", schema: "2" });
    expect(env()).toBe(before);
    expect(await follow(deps(true), folder, { dryRun: false })).toBe(11);
    expect(lines.at(-1)).toMatch(/^rejected: 0\.9\.3 /);
  }, 180_000);

  test("an image that stays unhealthy ends with the previous image running healthy", async () => {
    const before = env();
    release("0.9.4");
    expect({ exit: await follow(deps(true), folder, { dryRun: false }), lines }).toMatchObject({
      exit: 11,
    });
    expect(server()).toEqual({ version: "0.9.2", health: "healthy", schema: "2" });
    expect(env()).toBe(before);
  }, 180_000);

  test("an image the verifier refuses changes nothing", async () => {
    const before = env();
    release("0.9.5");
    expect({ exit: await follow(deps(false), folder, { dryRun: false }), lines }).toMatchObject({
      exit: 12,
    });
    expect(server()).toEqual({ version: "0.9.2", health: "healthy", schema: "2" });
    expect(env()).toBe(before);
  }, 180_000);

  test("an image of another schema waits under follow and runs after upgrade", async () => {
    release("0.10.0");
    expect({ exit: await follow(deps(true), folder, { dryRun: false }), lines }).toMatchObject({
      exit: 14,
    });
    expect(server().version).toBe("0.9.2");
    expect({ exit: await upgrade(deps(true), folder), lines }).toMatchObject({ exit: 0 });
    expect(server()).toEqual({ version: "0.10.0", health: "healthy", schema: "3" });
    expect(DIGEST_IN_ENV.exec(env())?.[1]).toBe("0.10.0");
  }, 180_000);
});
