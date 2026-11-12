// The release's documents held to the code: the pointers to the release runbook, the names
// CLAUDE.md gives, the commands and paths the runbook cites, and the summary lines it shows.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Outcome, summaryLine, type Target } from "../../scripts/release/lib.ts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const RUNBOOK = "docs/runbooks/release.md";
const runbook = read(RUNBOOK);

describe("the release's documents", () => {
  test("the team runbook and CLAUDE.md point at the release runbook", () => {
    expect(read("docs/runbooks/team-server.md")).toContain(`\`${RUNBOOK}\``);
    expect(read("CLAUDE.md")).toContain(`\`${RUNBOOK}\``);
  });

  test("CLAUDE.md names the workflows, the scripts, the ADR and the way back", () => {
    const claude = read("CLAUDE.md");
    for (const name of [
      ".github/workflows/release.yml",
      ".github/workflows/distribute.yml",
      "scripts/release/lib.ts",
      "ADR 0029",
      "install --force",
      "environment `release`",
    ]) {
      expect({ name, named: claude.includes(name) }).toEqual({ name, named: true });
    }
  });

  test("every wizardingcode-mem command the runbook cites is one the CLI knows, with its flag", () => {
    const commands = [...read("src/cli/main.ts").matchAll(/^\s+([a-z-]+): \(\) => import\(/gm)].map(
      (match) => match[1] as string,
    );
    const cited = [...runbook.matchAll(/`wizardingcode-mem ([^`]+)`/g)].map((match) =>
      (match[1] as string).trim().split(/\s+/),
    );
    expect(cited.length).toBeGreaterThan(0);
    for (const [command, ...rest] of cited) {
      expect({ command, known: commands.includes(command as string) }).toEqual({
        command,
        known: true,
      });
      const module = read(`src/cli/commands/${command}.ts`);
      for (const flag of rest.filter((word) => word.startsWith("--")))
        expect({ command, flag, named: module.includes(flag) }).toEqual({
          command,
          flag,
          named: true,
        });
    }
  });

  test("every repository file the runbook cites exists", () => {
    const cited = [
      ...runbook.matchAll(/`((?:\.github|docs|scripts|src|packaging|npm|plugins)\/[^`\s<>*]+)`/g),
    ].map((match) => match[1] as string);
    expect(cited.length).toBeGreaterThanOrEqual(3);
    for (const path of cited)
      expect({ path, exists: existsSync(join(ROOT, path)) }).toEqual({ path, exists: true });
  });

  test("every line of 'What a run shows' is a line the run can write", () => {
    const n = "<n>" as unknown as number;
    const lines: Array<[Target, Outcome]> = [
      ["npm", { kind: "published", name: "<name>", version: "<version>", tag: "<dist-tag>" }],
      ["npm", { kind: "already-published", name: "<name>", version: "<version>" }],
      ["npm", { kind: "would-publish", name: "<name>", version: "<version>" }],
      ["token", { kind: "token-ok", date: "<date>", days: n }],
      ["token", { kind: "token-renew", date: "<date>", days: n }],
      ["token", { kind: "token-unknown" }],
      ["tap", { kind: "written", version: "<version>" }],
      ["tap", { kind: "already-at", version: "<version>" }],
      ["tap", { kind: "would-write", version: "<version>" }],
      ["tap", { kind: "skipped-prerelease" }],
      ["marketplace", { kind: "written", version: "<version>" }],
      ["marketplace", { kind: "already-at", version: "<version>" }],
      ["marketplace", { kind: "left-alone", higher: "<higher>" }],
      ["marketplace", { kind: "would-write", version: "<version>" }],
      ["marketplace", { kind: "skipped-prerelease" }],
      ["latest", { kind: "moved", version: "<version>" }],
      ["latest", { kind: "would-move", version: "<version>" }],
      [
        "latest",
        { kind: "held-contract", tag: "<tag>", accepts: n, previous: "<previous>", speaks: n },
      ],
      ["latest", { kind: "held-unreadable", read: "<the read that failed>" }],
      ["latest", { kind: "moved-by-hand", version: "<version>" }],
      ["latest", { kind: "not-moved", job: "<job>" }],
      ["latest", { kind: "skipped-prerelease" }],
      ["tap", { kind: "failed", sentence: "<sentence>" }],
      ["plan", { kind: "refused", sentence: "<sentence>" }],
    ];
    const possible = lines.map(([target, outcome]) => summaryLine(target, outcome));
    const start = runbook.indexOf("## What a run shows");
    const section = runbook.slice(start, runbook.indexOf("\n## ", start + 1));
    const shown = [...section.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);
    expect(shown.length).toBeGreaterThan(15);
    for (const line of shown)
      expect({ line, possible: possible.includes(line) }).toEqual({ line, possible: true });
    // And the table leaves none out.
    for (const line of possible)
      expect({ line, shown: shown.includes(line) }).toEqual({ line, shown: true });
  });
});
