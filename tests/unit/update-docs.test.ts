// The documents of the release notice, held to what the code does and to each other.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANNEL_COMMANDS } from "../../src/update/channels.ts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const lineWith = (text: string, needle: string) =>
  text.split("\n").filter((line) => line.includes(needle));

describe("the README", () => {
  const readme = read("README.md");

  test("no longer promises that nothing leaves the machine", () => {
    // Case-sensitive: "Nothing leaves your machine for knowledge, except…" is scoped and stays.
    expect(readme).not.toContain("nothing leaves your machine unless you ask");
    expect(readme).not.toContain("nothing ever leaves your machine");
    expect(readme).toContain("none of your data leaves your machine unless you ask");
  });

  test("says the request in its network bullet, with how often and how to turn it off", () => {
    const bullet = lineWith(readme, "- **No telemetry");
    expect(bullet).toHaveLength(1);
    for (const said of [
      "github.com",
      "once a day",
      "once an hour",
      "never in CI",
      "wizardingcode-mem update",
      "WIZARDINGCODE_MEM_UPDATE=off",
      "~/.wizardingcode/mem/env",
    ])
      expect({ said, found: (bullet[0] as string).includes(said) }).toEqual({ said, found: true });
  });

  test("lists the setting, with the switch the viewer has for it since item 2026-11-12-008", () => {
    const sentence = lineWith(readme, "Every setting can be changed from the viewer");
    expect(sentence).toHaveLength(1);
    expect(sentence[0]).not.toContain("WIZARDINGCODE_MEM_UPDATE");
    const row = lineWith(readme, "| `WIZARDINGCODE_MEM_UPDATE` |");
    expect(row).toHaveLength(1);
    expect(row[0]).toContain("**Settings → About**");
  });

  test("has every shell command the notice prints", () => {
    const shell = CHANNEL_COMMANDS.filter((entry) => entry.shell);
    expect(shell).toHaveLength(3);
    for (const entry of shell)
      expect({ command: entry.command, found: readme.includes(entry.command) }).toEqual({
        command: entry.command,
        found: true,
      });
  });
});

describe("the release runbook, the ADR and CLAUDE.md", () => {
  test("the runbook says where clients are told from and how a notice is withdrawn", () => {
    const runbook = read("docs/runbooks/release.md");
    for (const said of ["told from the GitHub release", "gh release edit", "--latest"])
      expect({ said, found: runbook.includes(said) }).toEqual({ said, found: true });
  });

  test("ADR 0030 records the decision and what must never follow from it", () => {
    const path = "docs/adr/0030-release-notice.md";
    expect(existsSync(join(ROOT, path))).toBe(true);
    const adr = read(path);
    for (const said of [
      "releases/latest",
      "update.json",
      "hands over",
      "only tells",
      "must never start a download",
      "0029",
    ])
      expect({ said, found: adr.includes(said) }).toEqual({ said, found: true });
  });

  test("CLAUDE.md names the folder and the command", () => {
    const claude = read("CLAUDE.md");
    const start = claude.indexOf("## Commands");
    const commands = claude.slice(start, claude.indexOf("\n## ", start + 1));
    expect(commands).toContain("src/update/");
    expect(commands).toContain("wizardingcode-mem update");
  });

  test("the viewer's notice: the README, CLAUDE.md and the findings row (ADR 0030)", () => {
    const readme = read("README.md");
    // Neither place says the key is set by hand any more.
    expect(readme).not.toMatch(/two have no field yet/);
    expect(readme).not.toMatch(/WIZARDINGCODE_MEM_UPDATE[^\n]*set by hand/);
    expect(readme).toContain("one has no field yet and is set by hand: `WIZARDINGCODE_MEM_AUTHOR`");
    expect(readme).toContain("**Settings → About**");
    expect(readme).toMatch(/a banner at the top[^\n]*says a newer release is out/);

    const claude = read("CLAUDE.md");
    for (const said of [
      "GET /api/update",
      "POST /api/update/dismiss",
      "src/ui/update.ts",
      "ui/src/update.ts",
      "src/update/mode.ts",
      "update.dismissed",
    ])
      expect({ said, found: claude.includes(said) }).toEqual({ said, found: true });

    const row = read("docs/real-use/findings.md")
      .split("\n")
      .find((line) => line.includes("The viewer has no About line for the latest release"));
    expect(row).toContain("answered by item 2026-11-12-008");
    // Its other remarks stay deferred.
    expect(row).toContain("`stageBinary`");
    expect(row).toMatch(/deferred \|$/);
  });
});
