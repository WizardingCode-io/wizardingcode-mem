// The documents of the team server's restore (ADR 0031) held to what was built: the ADR
// names the decision and the commands, the two older ADRs say what was true before it, and
// CLAUDE.md names the new file and opens.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const source = (path: string) =>
  existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), "utf8") : "";

describe("the restore's documents", () => {
  test("ADR 0031 names the decision, the commands and the open", () => {
    const adr = source("docs/adr/0031-team-server-restore.md");
    for (const words of [
      "D-1",
      "serve restore",
      "serve instance renew",
      "serve mirror --rebuild",
      "serve version",
      "openTeamPresent",
      "everyone who can push a tag or a branch",
      "0026",
    ]) {
      expect(adr).toContain(words);
    }
  });

  test("the older ADRs say latest was pushed at build time, and ADR 0026 points at the restore", () => {
    const distribution = source("docs/adr/0029-release-distribution.md");
    const server = source("docs/adr/0026-team-server.md");
    expect(distribution).toContain("pushed at build time");
    expect(server).toContain("pushed at build time");
    const rollback = server.split("\n").find((line) => line.includes("a previous image exits 3"));
    expect(rollback).toBeDefined();
    expect(rollback).toContain("ADR 0031");
    expect(rollback).not.toContain("cp /data/backups");
  });

  test("CLAUDE.md names the restore's file and the opens", () => {
    const claude = source("CLAUDE.md");
    for (const words of [
      "src/team/restore.ts",
      "openTeamPresent",
      "openTeamCopy",
      "openTeamStaging",
    ]) {
      expect(claude).toContain(words);
    }
    expect(claude).not.toContain("the three opens");
  });
});
