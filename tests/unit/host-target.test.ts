// What the shipped command verifies with (ADR 0033). Every other test of the tool passes a
// stand-in target; this one holds the real one: the constants of src/host/signature.ts and
// nothing else, and the verifier's command built from them.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOUNDS } from "../../src/host/bounds.ts";
import { realDeps, realTarget } from "../../src/host/deps.ts";
import { verify } from "../../src/host/docker.ts";
import { COSIGN_IMAGE, IMAGE, verifyArgs } from "../../src/host/signature.ts";
import { hostRunner } from "../helpers/host-runner.ts";

const DIGEST = `sha256:${"b".repeat(64)}`;

describe("the target of the shipped command", () => {
  test("is the signer's constants, field by field", () => {
    expect(Object.keys(realTarget).sort()).toEqual([
      "cosignImage",
      "image",
      "registry",
      "verifyArgs",
    ]);
    expect(realTarget.image).toBe(IMAGE);
    expect(realTarget.registry).toBe("https://ghcr.io");
    expect(realTarget.cosignImage).toBe(COSIGN_IMAGE);
    expect(realTarget.verifyArgs).toBe(verifyArgs);
  });

  test("realDeps gives that target and the bounds of the code unless a caller passes others", () => {
    const deps = realDeps({ leaseMs: 30_000, version: "0.9.1", env: {} });
    expect(deps.target).toBe(realTarget);
    expect(deps.bounds).toBe(BOUNDS);
  });

  test("the verifier it runs is cosign's own image, confined, with the one command's arguments", () => {
    const { run, calls } = hostRunner(() => ({ code: 0 }));
    const deps = {
      ...realDeps({ leaseMs: 30_000, version: "0.9.1", env: { PATH: "/usr/bin" } }),
      run,
    };
    expect(verify(deps, DIGEST)).toBe("verified");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toEqual([
      "docker",
      "run",
      "--rm",
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "-e",
      "HOME=/tmp",
      "-e",
      "DOCKER_CONFIG=/tmp/none",
      COSIGN_IMAGE,
      ...verifyArgs(`${IMAGE}@${DIGEST}`),
    ]);
    expect(calls[0]?.timeoutMs).toBe(BOUNDS.verifier);
  });
});

describe("the command's entry", () => {
  // The `host` case of the serve command: from its `if` to the closing brace of the block.
  const serve = readFileSync(
    join(import.meta.dir, "..", "..", "src/cli/commands/serve.ts"),
    "utf8",
  );
  const start = serve.indexOf('if (argv[0] === "host") {');
  const block = serve.slice(start, serve.indexOf("\n  }\n", start));

  test("hands the tool the lease's length, the version and the environment, and no target or bounds of its own", () => {
    expect(start).toBeGreaterThan(-1);
    const calls = [...block.matchAll(/realDeps\(([^)]*)\)/g)].map((match) =>
      (match[1] as string).replace(/\s+/g, " ").trim(),
    );
    expect(calls).toEqual(["{ leaseMs: SERVE_TTL_MS, version: pkg.version, env: process.env }"]);
    expect(block).not.toMatch(/\btarget\b|\bbounds\b/);
  });

  test("passes the arguments on untouched, and reads the environment only to hand it over", () => {
    expect(block.replace(/\s+/g, " ")).toContain("return hostCommand( argv.slice(1), realDeps(");
    expect(block.match(/process\.env/g)).toHaveLength(1);
    expect(block.match(/\bargv\b/g)).toHaveLength(2);
  });
});
