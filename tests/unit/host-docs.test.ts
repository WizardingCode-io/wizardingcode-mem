// The documents of the host's tool (ADR 0033), held to the code: the team runbook's Upgrade
// and Rollback, the ADR, the pointers to it, and the release runbook's two rules.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT, EXIT_MEANING } from "../../src/host/rule.ts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const runbook = read("docs/runbooks/team-server.md");
/** The text of one `###` section of the team runbook, its heading included. */
function sectionOf(heading: string): string {
  const start = runbook.indexOf(`### ${heading}\n`);
  expect(start).toBeGreaterThan(-1);
  const next = runbook.indexOf("\n### ", start + 1);
  return runbook.slice(start, next === -1 ? undefined : next);
}

describe("the team runbook's Upgrade", () => {
  const section = sectionOf("Upgrade");

  test("names the launcher's three verbs, the dry run, the two units and where its files are", () => {
    for (const words of [
      "upgrade.sh status",
      "upgrade.sh follow",
      "upgrade.sh follow --dry-run",
      "upgrade.sh upgrade",
      "`deploy/upgrade.sh`",
      "`deploy/wizardingcode-mem-upgrade.service`",
      "`deploy/wizardingcode-mem-upgrade.timer`",
      "`upgrade-state/`",
      "journalctl -u wizardingcode-mem-upgrade.service",
      "systemctl enable --now wizardingcode-mem-upgrade.timer",
      "OnFailure=",
      "OnCalendar",
    ])
      expect({ words, there: section.includes(words) }).toEqual({ words, there: true });
  });

  test("every exit code of the tool is in its table, with the meaning the code gives it", () => {
    const rows = [...section.matchAll(/^\| (\d+) \| (.+) \|$/gm)].map(
      (match) => [Number(match[1]), match[2]] as const,
    );
    const codes = Object.values(EXIT).sort((a, b) => a - b);
    expect(rows.map(([code]) => code)).toEqual(codes);
    for (const [code, meaning] of rows)
      expect({ code, meaning }).toEqual({ code, meaning: EXIT_MEANING[code] as string });
    expect(
      Object.keys(EXIT_MEANING)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(codes);
  });

  test("says what the dry run downloads, what exit 12 can mean, and keeps the hand upgrade", () => {
    expect(section).toContain("may download");
    expect(section).toMatch(/12[^\n]*(Sigstore|registry)/);
    expect(section).toContain("docker compose pull server");
    expect(section).toContain("docker compose up -d server");
    expect(section).toContain("bootstrap code");
  });

  test("every path it cites under deploy/ exists", () => {
    const cited = [
      ...new Set([...runbook.matchAll(/`(deploy\/[A-Za-z0-9_./-]+)`/g)].map((m) => m[1] as string)),
    ];
    expect(cited.length).toBeGreaterThanOrEqual(3);
    expect(cited.filter((path) => !existsSync(join(ROOT, path)))).toEqual([]);
  });
});

describe("the team runbook's Rollback", () => {
  test("turns the timer off first", () => {
    const section = sectionOf("Rollback");
    const off = section.indexOf("systemctl disable --now wizardingcode-mem-upgrade.timer");
    expect(off).toBeGreaterThan(-1);
    expect(off).toBeLessThan(
      section.indexOf("docker compose run --rm server serve restore --to-schema"),
    );
  });
});

describe("the record of the decision", () => {
  test("ADR 0033 exists and names the four decisions it was given", () => {
    const adr = read("docs/adr/0033-host-follows-releases.md");
    for (const name of ["D-1", "D-2", "D-4", "D-6"])
      expect({ name, there: adr.includes(name) }).toEqual({ name, there: true });
    expect(adr).toMatch(/^# ADR 0033 /);
  });

  test("ADR 0032 points to it where it said what was not built", () => {
    const adr = read("docs/adr/0032-signed-images.md");
    const notBuilt = adr.slice(adr.indexOf("## What is not built"));
    expect(notBuilt).toContain("0033-host-follows-releases.md");
  });

  test("CLAUDE.md names the folder, the launcher and the verbs", () => {
    const claude = read("CLAUDE.md");
    for (const words of [
      "`src/host/`",
      "`deploy/upgrade.sh`",
      "serve host status | follow [--dry-run] | upgrade",
      "ADR 0033",
    ])
      expect({ words, there: claude.includes(words) }).toEqual({ words, there: true });
  });

  test("the release runbook carries the two rules a release keeps for the hosts", () => {
    const release = read("docs/runbooks/release.md");
    const start = release.indexOf("## What a release keeps for the hosts");
    expect(start).toBeGreaterThan(-1);
    const section = release.slice(start, release.indexOf("\n## ", start + 1));
    expect(section).toContain("The release before must be able to verify this one.");
    expect(section).toContain("`COSIGN_IMAGE`");
    expect(section).toContain("`SIGNER_IDENTITY`");
    expect(section).toContain("`upgrade-state/state.json`");
    expect(section).toContain("a release before it writes it");
    expect(section).toContain("`deploy/upgrade.sh`");
  });
});
