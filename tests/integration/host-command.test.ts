// `wizardingcode-mem serve host` as a command (ADR 0033): its usage, and that the changing
// verbs refuse without the lock's marker, which only the launcher sets.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../helpers/cli.ts";

describe("serve host, from the command line", () => {
  test("no verb, an unknown verb, an unknown flag and a missing --dir are usage, exit 64", async () => {
    for (const args of [
      [],
      ["frobnicate", "--dir", "/tmp"],
      ["follow", "--dir", "/tmp", "--bogus"],
      ["status"],
      ["follow"],
      ["upgrade", "--dir", "/tmp", "--dry-run"],
      ["follow", "--dir", "/tmp", "--lock", "held"],
      ["status", "--dir", "/tmp", "--lock", "maybe"],
    ]) {
      const result = await runCli("serve", "host", ...args);
      expect({ args, exit: result.exitCode }).toEqual({ args, exit: 64 });
      expect(result.stderr).toContain("serve host status | follow [--dry-run] | upgrade");
      expect(result.stdout).toBe("");
    }
  });

  test("follow and upgrade without the lock's marker refuse with exit 69 and name the launcher", async () => {
    const folder = mkdtempSync(join(tmpdir(), "wcm-host-cmd-"));
    writeFileSync(join(folder, ".env"), "WIZARDINGCODE_MEM_VERSION=0.9.1\n");
    for (const verb of ["follow", "upgrade"]) {
      const result = await runCli("serve", "host", verb, "--dir", folder);
      expect({ verb, exit: result.exitCode }).toEqual({ verb, exit: 69 });
      expect(result.stderr).toContain(`${folder}/upgrade.sh`);
    }
  });

  test("the usage of serve names it", async () => {
    const result = await runCli("serve", "--help");
    expect(result.stdout).toContain("host status | follow [--dry-run] | upgrade --dir <folder>");
  });
});
