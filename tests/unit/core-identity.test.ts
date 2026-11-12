// The identity leaf (ADR 0028): the alias kinds, the two slug grammars and the three
// predicates every reader of "a name a team knows a project by" applies, with no import.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ALIAS_KINDS,
  aliasKind,
  hasLetterOrDigit,
  isHostLedAlias,
  isSharedName,
  isSharedSlug,
  isTeamAlias,
  NAME_PREFIX,
  REMOTE_PREFIX,
  RESERVED,
  SHARED_SLUG,
  SLUG,
  SLUG_MAX,
  stripTeamPrefix,
  TEAM_ALIAS_SQL,
} from "../../src/core/identity.ts";
import { isSlug } from "../../src/modules/knowledge/entry.ts";

const ROOT = join(import.meta.dir, "..", "..");
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("the alias kinds", () => {
  test("the five kinds, each with whether a team may know a project by it", () => {
    expect(Object.keys(ALIAS_KINDS).sort()).toEqual([
      "gitdir",
      "imported",
      "name",
      "path",
      "remote",
    ]);
    expect(ALIAS_KINDS.remote.team).toBe(true);
    expect(ALIAS_KINDS.name.team).toBe(true);
    expect(ALIAS_KINDS.gitdir.team).toBe(false);
    expect(ALIAS_KINDS.path.team).toBe(false);
    expect(ALIAS_KINDS.imported.team).toBe(false);
  });

  test("aliasKind reads the prefix, null for an alias of no kind", () => {
    expect(aliasKind("remote:github.com/acme/site")).toBe("remote");
    expect(aliasKind("name:wizardingcode")).toBe("name");
    expect(aliasKind("gitdir:/x/.git")).toBe("gitdir");
    expect(aliasKind("path:/x")).toBe("path");
    expect(aliasKind("imported:docs")).toBe("imported");
    expect(aliasKind("Name:x")).toBeNull();
    expect(aliasKind("github.com/acme/site")).toBeNull();
    expect(NAME_PREFIX).toBe("name:");
    expect(REMOTE_PREFIX).toBe("remote:");
  });
});

describe("the slug grammars", () => {
  test("SLUG is the knowledge store's pattern, with its length and the reserved names", () => {
    expect(SLUG.source).toBe("^[a-z0-9][a-z0-9-]*$");
    expect(SLUG_MAX).toBe(80);
    for (const word of ["con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9"]) {
      expect(RESERVED.test(word)).toBe(true);
    }
    expect(RESERVED.test("console")).toBe(false);
  });

  test("SHARED_SLUG is stricter: no leading, trailing or double hyphen, the length, no reserved name", () => {
    for (const slug of ["wizardingcode", "estrategia-de-marca", "a", "a1-b2", "x".repeat(80)]) {
      expect(isSharedSlug(slug)).toBe(true);
    }
    for (const slug of ["Bad", "-x", "x-", "x--y", "x".repeat(81), "con", "", "a b", "ção"]) {
      expect(isSharedSlug(slug)).toBe(false);
    }
    expect(SHARED_SLUG.test("x--y")).toBe(false);
  });

  test("every shared slug is a knowledge slug; not every knowledge slug is a shared slug", () => {
    for (const slug of ["wizardingcode", "estrategia-de-marca", "a", "x".repeat(80)]) {
      expect(isSlug(slug)).toBe(true);
      expect(isSharedSlug(slug)).toBe(true);
    }
    for (const slug of ["abc-", "a--b"]) {
      expect(isSlug(slug)).toBe(true);
      expect(isSharedSlug(slug)).toBe(false);
    }
  });

  test("hasLetterOrDigit looks past the marks and the case", () => {
    expect(hasLetterOrDigit("Estratégia")).toBe(true);
    expect(hasLetterOrDigit("Ção")).toBe(true);
    expect(hasLetterOrDigit("7")).toBe(true);
    expect(hasLetterOrDigit("!!!")).toBe(false);
    expect(hasLetterOrDigit("")).toBe(false);
    expect(hasLetterOrDigit(" - ")).toBe(false);
  });
});

describe("isHostLedAlias", () => {
  test("a remote whose first segment is a host name, with a port or without", () => {
    for (const alias of [
      "remote:github.com/acme/site",
      "remote:gitlab.example.org/a/b",
      "remote:git.example.com:8443/a/b",
      "remote:my-host.internal/repo",
    ]) {
      expect(isHostLedAlias(alias)).toBe(true);
    }
  });

  test("never a local path, a file origin, a host without a dot, or another kind of alias", () => {
    for (const alias of [
      "remote:/users/someone/repo",
      "remote:../other",
      "remote:./here",
      "remote:c:\\x",
      "remote:server/repo",
      "remote:",
      "remote:/",
      "remote:.hidden/repo",
      "remote:a..b/repo",
      "path:/users/someone/repo",
      "github.com/acme/site",
      "name:wizardingcode",
    ]) {
      expect(isHostLedAlias(alias)).toBe(false);
    }
  });
});

describe("isSharedName and isTeamAlias", () => {
  test("a shared name is name: followed by a shared slug", () => {
    for (const alias of [
      "name:wizardingcode",
      "name:estrategia-de-marca",
      "name:a",
      `name:${"x".repeat(80)}`,
    ]) {
      expect(isSharedName(alias)).toBe(true);
    }
    for (const alias of [
      "name:Bad",
      "name:-x",
      "name:x-",
      "name:x--y",
      `name:${"x".repeat(81)}`,
      "name:con",
      "name:",
      "remote:x",
      "x",
      "Name:wizardingcode",
    ]) {
      expect(isSharedName(alias)).toBe(false);
    }
  });

  test("a team alias is a host-led remote or a shared name, nothing else", () => {
    expect(isTeamAlias("remote:github.com/acme/site")).toBe(true);
    expect(isTeamAlias("name:wizardingcode")).toBe(true);
    for (const alias of [
      "remote:/users/someone/repo",
      "gitdir:/x/.git",
      "path:/x",
      "imported:docs",
      "name:Bad",
    ]) {
      expect(isTeamAlias(alias)).toBe(false);
    }
  });

  test("stripTeamPrefix removes one team prefix and leaves the rest", () => {
    expect(stripTeamPrefix("remote:github.com/acme/site")).toBe("github.com/acme/site");
    expect(stripTeamPrefix("name:wizardingcode")).toBe("wizardingcode");
    expect(stripTeamPrefix("remote:remote:x")).toBe("remote:x");
    expect(stripTeamPrefix("path:/x")).toBe("path:/x");
  });

  test("the SQL prefilter names the two prefixes by substr, so no LIKE case folding applies", () => {
    expect(TEAM_ALIAS_SQL).toBe(
      "(substr(alias, 1, 7) = 'remote:' OR substr(alias, 1, 5) = 'name:')",
    );
  });
});

describe("the leaf and its importers", () => {
  test("the leaf imports nothing", () => {
    expect(source("src/core/identity.ts")).not.toMatch(/^\s*import\b/m);
  });

  test("the contract imports the leaf and not the sharing levels; the entry module takes SLUG from the leaf", () => {
    const contract = source("src/team/contract.ts");
    expect(contract).toContain('from "../core/identity.ts"');
    expect(contract).not.toContain("../sharing/levels.ts");
    expect(source("src/modules/knowledge/entry.ts")).toContain('from "../../core/identity.ts"');
  });

  test("the literal LIKE 'remote:%' remains only where it means a git remote", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith(".ts") && readFileSync(path, "utf8").includes("'remote:%'")) {
          hits.push(path.slice(ROOT.length + 1));
        }
      }
    };
    walk(join(ROOT, "src"));
    expect(hits.sort()).toEqual(["src/core/project.ts", "src/links/suggest.ts"]);
    expect(existsSync(join(ROOT, "src/core/identity.ts"))).toBe(true);
  });
});
