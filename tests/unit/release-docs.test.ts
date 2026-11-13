// The release's documents held to the code: the pointers to the release runbook, the names
// CLAUDE.md gives, the commands and paths the runbook cites, and the summary lines it shows.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Outcome, summaryLine, type Target } from "../../scripts/release/lib.ts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const parseYaml = (text: string): unknown =>
  (Bun as unknown as { YAML: { parse(text: string): unknown } }).YAML.parse(text);

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

  test("the runbook has the signing's setup, the one approval and what to do when the image is not signed", () => {
    for (const words of [
      "release-sign",
      "Required reviewers",
      "Allow administrators to bypass",
      "covering the workflows' folder",
      "one approval",
      "image: <tag> built by",
      "image: no digest",
      // Each reason plan gives for no digest (builtDigest and readBuild).
      "no run of release.yml",
      "built the image",
      "recorded no image digest",
      "is not a digest",
      "could not be listed",
      "no longer names",
      "did not say which image",
      "90 days",
      "public",
      "replaces a run",
    ]) {
      expect({ words, said: runbook.includes(words) }).toEqual({ words, said: true });
    }
  });

  test("ADR 0032 records the decisions, the control and what is not built", () => {
    const adr = existsSync(join(ROOT, "docs/adr/0032-signed-images.md"))
      ? read("docs/adr/0032-signed-images.md")
      : "";
    for (const words of [
      "D-1",
      "D-2",
      "D-3",
      "D-5",
      "cosign",
      "distribute.yml@refs/heads/main",
      "release.yml",
      "release-sign",
      "required reviewer",
      "administrator",
      "image-digest",
      "contract with every host",
      "not built",
    ]) {
      expect({ words, said: adr.includes(words) }).toEqual({ words, said: true });
    }
    expect(read("docs/adr/0031-team-server-restore.md")).toContain("ADR 0032");
    expect(read("docs/adr/0029-release-distribution.md")).toContain("ADR 0032");
    const claude = read("CLAUDE.md");
    expect(claude).toContain("scripts/release/sign.ts");
    expect(claude).toContain("scripts/release/read.ts");
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
      ["latest", { kind: "signed", digest: "<digest>" }],
      ["latest", { kind: "already-signed", digest: "<digest>" }],
      ["latest", { kind: "would-sign", digest: "<digest>" }],
      ["latest", { kind: "no-digest" }],
      ["latest", { kind: "unreadable", version: "<version>", said: "<what the registry said>" }],
      ["latest", { kind: "tag-moved", version: "<version>", built: "<digest>" }],
      ["latest", { kind: "unverified", digest: "<digest>", said: "<cosign's last line>" }],
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

  test("the runbook says what to do when the job that starts the distribution is cut", () => {
    const start = runbook.indexOf("## Repeating a target");
    const section = runbook.slice(start, runbook.indexOf("\n## ", start + 1));
    const paragraphs = section
      .split("\n\n")
      .filter((paragraph) => paragraph.includes("`gh run list --workflow distribute.yml`"));
    expect(paragraphs).toHaveLength(1);
    const paragraph = paragraphs[0] as string;
    // The limit is the workflow's own number, so the two cannot drift.
    const release = parseYaml(read(".github/workflows/release.yml")) as {
      jobs: Record<string, { "timeout-minutes"?: number }>;
    };
    const minutes = release.jobs.distribute?.["timeout-minutes"];
    expect(minutes).toBeNumber();
    expect(paragraph).toContain(`${minutes} minutes`);
    // What a second run for the same tag does at each target, and the one exception.
    for (const said of ["already published", "already at", "moved to", "A bad release"])
      expect({ said, found: paragraph.includes(said) }).toEqual({ said, found: true });
  });

  test("the findings say what the hardening item did and what it left open", () => {
    const findings = read("docs/real-use/findings.md");
    const rows = findings
      .split("\n")
      .filter((line) => line.startsWith("| 2026-11-12 | release distribution"))
      .map((line) => {
        const cells = line.split(" | ");
        return { line, outcome: (cells.at(-1) ?? "").replace(/\s*\|\s*$/, "") };
      });
    // The rows the item answers cite it, say what was done, and are no longer deferred.
    const answered = rows.filter((row) => row.outcome.includes("2026-11-12-005"));
    expect(answered.some((row) => row.line.includes("redact"))).toBe(true);
    expect(
      answered.some(
        (row) => row.line.includes("`PUSH_REMOTE`") && row.line.includes("`timeout-minutes`"),
      ),
    ).toBe(true);
    for (const row of answered) expect(row.outcome.startsWith("deferred")).toBe(false);
    expect(rows.some((row) => row.outcome === "deferred, first of the follow-up")).toBe(false);
    // The version rule went to the next item; the rest of what stays open is named.
    const version = rows.filter((row) => row.line.includes("`version_of`"));
    expect(version.map((row) => row.outcome)).toEqual(["deferred, its own item (ADR 0030)"]);
    for (const open of ["`GIT_CONFIG_GLOBAL`", "time limit", "`MARKETPLACE_TOKEN`"])
      expect({ open, named: rows.some((row) => row.line.includes(open)) }).toEqual({
        open,
        named: true,
      });
  });

  test("ADR 0029 and CLAUDE.md carry the two rules of the writer to another repository", () => {
    const adr = read("docs/adr/0029-release-distribution.md");
    for (const said of [
      "redacts the encoded credential by exact match",
      "no destination from its environment",
      "`commitAndPush`",
      "`::add-mask::`",
    ])
      expect({ said, found: adr.includes(said) }).toEqual({ said, found: true });
    const releasing = read("CLAUDE.md")
      .split("\n")
      .filter((line) => line.startsWith("- Releasing (ADR 0029"));
    expect(releasing).toHaveLength(1);
    for (const said of ["by exact match", "no destination from its environment"])
      expect({ said, found: (releasing[0] as string).includes(said) }).toEqual({
        said,
        found: true,
      });
  });
});
