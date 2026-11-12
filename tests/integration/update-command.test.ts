// The release notice through its commands: the step after the drain, `update`, `doctor` and
// `status`. `distill` and `update` run in this process with a fetch of the test's own, so
// nothing here reaches github.com.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { run as distill } from "../../src/cli/commands/distill.ts";
import { run as update } from "../../src/cli/commands/update.ts";
import { runChecks } from "../../src/doctor/checks.ts";
import { doctorContext } from "../../src/doctor/context.ts";
import { CHANNEL_COMMANDS } from "../../src/update/channels.ts";
import { updateCheck } from "../../src/update/report.ts";
import { readState, STATE_FILE, type UpdateState, writeState } from "../../src/update/state.ts";
import { runCliWith } from "../helpers/cli.ts";

const NOW = Date.now();
const HOUR = 3_600_000;
const TAG = (version: string) =>
  `https://github.com/WizardingCode-io/wizardingcode-mem/releases/tag/v${version}`;
const answering = (status: number, location: string | null, calls: string[] = []) =>
  (async (url: string) => {
    calls.push(String(url));
    return { status, headers: new Headers(location === null ? {} : { Location: location }) };
  }) as unknown as typeof fetch;
const state = (over: Partial<UpdateState> = {}): UpdateState => ({
  latest: null,
  checkedAt: null,
  attemptAt: null,
  failedAt: null,
  reason: null,
  ...over,
});

let home: string;
let dataDir: string;
let out: string;
let err: string;
const saved = {
  env: { ...process.env },
  stdout: process.stdout.write,
  stderr: process.stderr.write,
};

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-updatecmd-")));
  dataDir = join(home, "mem");
  process.env.WIZARDINGCODE_HOME = home;
  delete process.env.WIZARDINGCODE_MEM_DATA_DIR;
  delete process.env.WIZARDINGCODE_MEM_STORE_DIR;
  process.env.WIZARDINGCODE_MEM_UPDATE = "check";
  delete process.env.CI;
  out = "";
  err = "";
  process.stdout.write = ((text: string) => {
    out += text;
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((text: string) => {
    err += text;
    return true;
  }) as typeof process.stderr.write;
});
afterEach(() => {
  process.stdout.write = saved.stdout;
  process.stderr.write = saved.stderr;
  for (const key of ["WIZARDINGCODE_HOME", "WIZARDINGCODE_MEM_UPDATE", "CI"] as const) {
    if (saved.env[key] === undefined) delete process.env[key];
    else process.env[key] = saved.env[key];
  }
  rmSync(home, { recursive: true, force: true });
});
const deps = (fetchImpl: typeof fetch) => ({ fetch: fetchImpl, now: () => NOW });

describe("distill", () => {
  test("after the drain it asks which release is the latest, and keeps the answer", async () => {
    const calls: string[] = [];
    expect(await distill([], deps(answering(302, TAG("99.0.0"), calls)))).toBe(0);
    expect(calls).toEqual([
      "https://github.com/WizardingCode-io/wizardingcode-mem/releases/latest",
    ]);
    expect(readState(dataDir)).toEqual(state({ latest: "99.0.0", checkedAt: NOW, attemptAt: NOW }));
  });

  test("a check that throws, or cannot record, leaves its exit code alone", async () => {
    const throwing = (() => {
      throw new Error("no network stack");
    }) as unknown as typeof fetch;
    expect(await distill([], deps(throwing))).toBe(0);
    // A folder where the state file should be: nothing can be recorded.
    rmSync(join(dataDir, STATE_FILE), { force: true });
    mkdirSync(join(dataDir, STATE_FILE), { recursive: true });
    expect(await distill([], deps(answering(302, TAG("99.0.0"))))).toBe(0);
  });

  test("a check that throws out of its own code is caught by distill, not by the check", async () => {
    // The clock is read inside distill's guard: nothing below it can catch this.
    const broken = {
      fetch: answering(302, TAG("99.0.0")),
      now: () => {
        throw new Error("no clock");
      },
    };
    expect(await distill([], broken)).toBe(0);
    expect(readState(dataDir)).toBeNull();
  });

  test("a store that cannot be opened fails the drain, and the check still runs", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "wizardingcode-mem.db"), "not a database");
    const calls: string[] = [];
    expect(await distill([], deps(answering(302, TAG("99.0.0"), calls)))).toBe(1);
    expect(calls).toHaveLength(1);
    expect(readState(dataDir)?.latest).toBe("99.0.0");
  });

  test("turned off in the file, it asks nothing", async () => {
    delete process.env.WIZARDINGCODE_MEM_UPDATE;
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "env"), "WIZARDINGCODE_MEM_UPDATE=off\n");
    const calls: string[] = [];
    expect(await distill([], deps(answering(302, TAG("99.0.0"), calls)))).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("wizardingcode-mem update", () => {
  test("it asks now, says what is out and gives the four commands", async () => {
    // A check one second old would keep the automatic one quiet; a typed one asks.
    writeState(
      dataDir,
      state({ latest: pkg.version, checkedAt: NOW - 1000, attemptAt: NOW - 1000 }),
    );
    const calls: string[] = [];
    expect(await update([], deps(answering(302, TAG("99.0.0"), calls)))).toBe(0);
    expect(calls).toHaveLength(1);
    expect(out).toContain(`update: 99.0.0 is out (checked 0 s ago); this copy is ${pkg.version}`);
    for (const entry of CHANNEL_COMMANDS)
      expect(out).toContain(`  ${entry.channel}: ${entry.command}`);
  });

  test("it asks in CI too", async () => {
    process.env.CI = "true";
    const calls: string[] = [];
    expect(await update([], deps(answering(302, TAG(pkg.version), calls)))).toBe(0);
    expect(calls).toHaveLength(1);
    expect(out).toContain(`update: ${pkg.version} is the latest (checked 0 s ago)`);
  });

  test("a check that fails is said with its reason, and exits 1", async () => {
    expect(await update([], deps(answering(429, null)))).toBe(1);
    expect(out).toContain("update: could not check (HTTP 429, 0 s ago); no release known yet");
  });

  test("off in the file: no request, the line, and how to turn it on there", async () => {
    delete process.env.WIZARDINGCODE_MEM_UPDATE;
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "env"), "WIZARDINGCODE_MEM_UPDATE=off\n");
    const calls: string[] = [];
    expect(await update([], deps(answering(302, TAG("99.0.0"), calls)))).toBe(0);
    expect(calls).toHaveLength(0);
    expect(out).toBe(
      `update: off (WIZARDINGCODE_MEM_UPDATE in ${join(dataDir, "env")})\nset WIZARDINGCODE_MEM_UPDATE=check in ${join(dataDir, "env")} to turn it on\n`,
    );
  });

  test("off in the environment: how to turn it on is said for the environment", async () => {
    process.env.WIZARDINGCODE_MEM_UPDATE = "off";
    const calls: string[] = [];
    expect(await update([], deps(answering(302, TAG("99.0.0"), calls)))).toBe(0);
    expect(calls).toHaveLength(0);
    expect(out).toContain("in this command's environment; other processes may not see it");
    expect(out).toContain("unset WIZARDINGCODE_MEM_UPDATE in this environment to turn it on\n");
    expect(out).not.toContain("Homebrew");
  });

  test("a result that cannot be recorded is said, and exits 1", async () => {
    mkdirSync(join(dataDir, STATE_FILE), { recursive: true });
    expect(await update([], deps(answering(302, TAG("99.0.0"))))).toBe(1);
    expect(err).toContain("wizardingcode-mem: could not record the check: ");
  });
});

describe("doctor", () => {
  const check = (stateOver: Partial<UpdateState>) => {
    writeState(dataDir, state(stateOver));
    return updateCheck(dataDir, { WIZARDINGCODE_MEM_UPDATE: "check" }, NOW);
  };

  test("a release that is out is a warning that points to update", () => {
    expect(check({ latest: "99.0.0", checkedAt: NOW - 2 * HOUR })).toEqual({
      name: "update",
      status: "warn",
      detail: `99.0.0 is out (checked 2 h ago); this copy is ${pkg.version}; run wizardingcode-mem update for the commands`,
    });
  });

  test("the latest, and a check that failed, are fine", () => {
    expect(check({ latest: pkg.version, checkedAt: NOW - HOUR })).toEqual({
      name: "update",
      status: "ok",
      detail: `${pkg.version} is the latest (checked 1 h ago)`,
    });
    expect(check({ failedAt: NOW - HOUR, reason: "offline" }).status).toBe("ok");
  });

  test("the command prints it and its exit code does not move; runChecks does not carry it", async () => {
    mkdirSync(dataDir, { recursive: true });
    const env = { WIZARDINGCODE_HOME: home, WIZARDINGCODE_MEM_UPDATE: "check", CI: "" };
    const before = await runCliWith({ env }, "doctor");
    writeState(dataDir, state({ latest: "99.0.0", checkedAt: Date.now() - 2 * HOUR }));
    const after = await runCliWith({ env }, "doctor");
    expect(before.stdout).toContain("ok    update: not checked yet");
    expect(after.stdout).toContain("warn  update: 99.0.0 is out (checked 2 h ago); this copy is");
    expect(after.exitCode).toBe(before.exitCode);
    const names = runChecks(doctorContext(dataDir)).map((entry) => entry.name);
    expect(names).not.toContain("update");
  });
});

describe("status", () => {
  const env = () => ({ WIZARDINGCODE_HOME: home, WIZARDINGCODE_MEM_UPDATE: "check", CI: "" });
  const out99 = () =>
    writeState(dataDir, state({ latest: "99.0.0", checkedAt: Date.now() - 2 * HOUR }));
  const stage = (script: string) => {
    mkdirSync(join(dataDir, "bin"), { recursive: true });
    const file = join(dataDir, "bin", "wizardingcode-mem");
    writeFileSync(file, script);
    chmodSync(file, 0o755);
    return file;
  };

  test("with no staged binary it speaks of this copy, and lists the commands", async () => {
    out99();
    const result = await runCliWith({ env: env() }, "status");
    const lines = result.stdout.split("\n");
    expect(lines[0]).toBe(`wizardingcode-mem ${pkg.version}`);
    expect(lines[1]).toBe(`update: 99.0.0 is out (checked 2 h ago); this copy is ${pkg.version}`);
    for (const entry of CHANNEL_COMMANDS)
      expect(result.stdout).toContain(`  ${entry.channel}: ${entry.command}`);
    expect(result.exitCode).toBe(0);
  });

  test("with an older staged binary it speaks of the agents, and names install", async () => {
    out99();
    const file = stage('#!/bin/sh\nif [ "$1" = "--version" ]; then echo 0.0.1; fi\n');
    const result = await runCliWith({ env: env() }, "status");
    expect(result.stdout).toContain(
      "update: 99.0.0 is out (checked 2 h ago); the agents run 0.0.1\n",
    );
    expect(result.stdout).toContain(
      `agents run 0.0.1 from ${file}; this copy is ${pkg.version}: wizardingcode-mem install moves them to it\n`,
    );
  });

  test("nothing is listed when no release is out", async () => {
    writeState(dataDir, state({ latest: pkg.version, checkedAt: Date.now() - HOUR }));
    const result = await runCliWith({ env: env() }, "status");
    expect(result.stdout).toContain(`update: ${pkg.version} is the latest (checked 1 h ago)\n`);
    expect(result.stdout).not.toContain("Homebrew");
  });

  test("a store that cannot be opened: the lines are still printed, as text and as JSON", async () => {
    out99();
    writeFileSync(join(dataDir, "wizardingcode-mem.db"), "not a database");
    const text = await runCliWith({ env: env() }, "status");
    expect(text.exitCode).toBe(1);
    expect(text.stdout).toContain(`wizardingcode-mem ${pkg.version}\nupdate: 99.0.0 is out`);
    expect(text.stderr).toStartWith("wizardingcode-mem: ");
    const json = await runCliWith({ env: env() }, "status", "--json");
    expect(json.exitCode).toBe(1);
    const parsed = JSON.parse(json.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["error", "update", "version"]);
    expect((parsed.update as { latest: string }).latest).toBe("99.0.0");
  });

  test("--json carries the report beside what it already had", async () => {
    out99();
    const result = await runCliWith({ env: env() }, "status", "--json");
    const parsed = JSON.parse(result.stdout) as { version: string; update: { out: boolean } };
    expect(parsed.version).toBe(pkg.version);
    expect(parsed.update.out).toBe(true);
  });
});
