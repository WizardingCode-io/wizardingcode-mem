// The files an operator copies beside compose.yml (ADR 0033): the launcher's own constants
// against the code they copy, the two units, and the two numbers that bind them to the tool's
// bounds and to the image's health check.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOUNDS, worstUnattendedMs } from "../../src/host/bounds.ts";
import { IMAGE } from "../../src/host/signature.ts";
import { SERVE_TTL_MS } from "../../src/team/lease.ts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const key = (unit: string, name: string) =>
  [...unit.matchAll(new RegExp(`^${name}=(.*)$`, "gm"))].map((match) => match[1] as string);

describe("the units", () => {
  const service = read("deploy/wizardingcode-mem-upgrade.service");
  const timer = read("deploy/wizardingcode-mem-upgrade.timer");

  test("the service is a oneshot that runs the launcher's follow, and counts the lock's exit as success", () => {
    expect(key(service, "Type")).toEqual(["oneshot"]);
    expect(key(service, "ExecStart")).toHaveLength(1);
    expect(key(service, "ExecStart")[0]).toMatch(/\/upgrade\.sh follow$/);
    expect(key(service, "SuccessExitStatus")).toEqual(["75"]);
    expect(key(service, "User")).toHaveLength(1);
    expect(key(service, "After")[0]).toContain("docker.service");
    expect(key(service, "After")[0]).toContain("network-online.target");
    expect(key(service, "Wants")[0]).toContain("network-online.target");
    expect(service).not.toMatch(/^Restart=/m);
  });

  test("the timer runs it after boot, hourly, delayed and persistent", () => {
    expect(key(timer, "OnBootSec")).toEqual(["3min"]);
    expect(key(timer, "OnCalendar")).toEqual(["hourly"]);
    expect(key(timer, "RandomizedDelaySec")).toEqual(["10min"]);
    expect(key(timer, "Persistent")).toEqual(["true"]);
    expect(key(timer, "Unit")).toEqual(["wizardingcode-mem-upgrade.service"]);
    expect(key(timer, "WantedBy")).toEqual(["timers.target"]);
  });

  test("the worst unattended run fits under the service's start timeout", () => {
    const minutes = /^(\d+)min$/.exec(key(service, "TimeoutStartSec")[0] ?? "")?.[1];
    expect(minutes).toBeDefined();
    const worst = worstUnattendedMs(BOUNDS, SERVE_TTL_MS) / 1000;
    expect(worst).toBeGreaterThan(3000);
    expect(Number(minutes) * 60).toBeGreaterThan(worst);
  });

  test("the unattended wait covers the image's health check with a minute to spare", () => {
    const check = /^HEALTHCHECK (.*) CMD /m.exec(read("Dockerfile"))?.[1] ?? "";
    const seconds = (name: string) => Number(new RegExp(`--${name}=(\\d+)s`).exec(check)?.[1]);
    const retries = Number(/--retries=(\d+)/.exec(check)?.[1]);
    const needed = seconds("start-period") + seconds("interval") * retries + 60;
    expect(needed).toBeGreaterThan(60);
    expect(BOUNDS.waitUnattended / 1000).toBeGreaterThanOrEqual(needed);
  });
});

describe("the launcher's own copies", () => {
  const launcher = read("deploy/upgrade.sh");
  const value = (name: string) => new RegExp(`^${name}=(.*)$`, "m").exec(launcher)?.[1];

  test("its repository is the signer's, and its tool path the Dockerfile's", () => {
    expect(value("IMAGE")).toBe(IMAGE);
    const copied = /^COPY --from=pick --chmod=0755 \S+ (\S+)$/m.exec(read("Dockerfile"))?.[1];
    expect(copied).toBe("/usr/local/bin/wizardingcode-mem");
    expect(value("TOOL_PATH")).toBe(copied);
  });

  test("the verbs and flags it passes are the command's", () => {
    const command = read("src/host/command.ts");
    for (const word of ["status", "follow", "upgrade", "--dir", "--dry-run", "--lock"])
      expect({
        word,
        launcher: launcher.includes(word),
        command: command.includes(`"${word}"`),
      }).toEqual({ word, launcher: true, command: true });
    expect(launcher).toContain("serve host");
  });

  test("it is committed executable", () => {
    const listed = Bun.spawnSync(["git", "ls-files", "-s", "deploy/upgrade.sh"], {
      cwd: ROOT,
    }).stdout.toString();
    expect(listed.startsWith("100755 ")).toBe(true);
  });

  const shellcheck = Bun.spawnSync(["/bin/sh", "-c", "command -v shellcheck"])
    .stdout.toString()
    .trim();
  test.skipIf(shellcheck === "")(
    "shellcheck finds nothing in it (skipped where shellcheck is not installed)",
    () => {
      const result = Bun.spawnSync([shellcheck, "-s", "sh", join(ROOT, "deploy/upgrade.sh")]);
      expect({ exit: result.exitCode, out: result.stdout.toString() }).toEqual({
        exit: 0,
        out: "",
      });
    },
  );
});
