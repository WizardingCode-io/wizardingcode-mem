import { describe, expect, test } from "bun:test";
import {
  effectiveLevel,
  epochOf,
  isHostLedAlias,
  levelKey,
  levelOf,
  policyWith,
} from "../../src/sharing/levels.ts";
import type { LevelRow } from "../../src/sharing/types.ts";

const TEAM: ReadonlySet<string> = new Set(["team"]);
const known = { known: true, disabled: false, aliases: ["remote:x.example/x"] };
const row = { level: "knowledge", boundAlias: "remote:x.example/x" };

describe("levelKey", () => {
  test("names a project and a destination", () => {
    expect(levelKey(3, "team")).toBe("3@team");
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
    ]) {
      expect(isHostLedAlias(alias)).toBe(false);
    }
  });
});

describe("epochOf", () => {
  const lists = { roots: ["workspace"], areas: [] };

  test("changes with the lists and with the counter, and with nothing else", () => {
    expect(epochOf(3, lists)).toBe(epochOf(3, { roots: ["workspace"], areas: [] }));
    expect(epochOf(3, lists)).not.toBe(epochOf(3, { roots: [], areas: [] }));
    expect(epochOf(3, lists)).not.toBe(epochOf(4, lists));
  });

  test("is the counter above twenty bits of the lists' hash", () => {
    const hash = epochOf(0, lists);
    expect(Number.isInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThan(2 ** 20);
    expect(epochOf(3, lists)).toBe(3 * 2 ** 20 + hash);
  });

  test("an id is not the same in the roots as in the areas", () => {
    expect(epochOf(0, { roots: ["shared"], areas: [] })).not.toBe(
      epochOf(0, { roots: [], areas: ["shared"] }),
    );
  });
});

describe("effectiveLevel", () => {
  test("a known project without a row shares nothing", () => {
    expect(
      effectiveLevel(null, { known: true, disabled: false, aliases: [] }, "team", TEAM),
    ).toEqual({ level: "local", reason: "level-local" });
  });

  test("an unknown project has no level", () => {
    expect(
      effectiveLevel(null, { known: false, disabled: false, aliases: [] }, "team", TEAM),
    ).toEqual({ level: "local", reason: "no-project" });
    expect(effectiveLevel(row, { ...known, known: false }, "team", TEAM)).toEqual({
      level: "local",
      reason: "no-project",
    });
  });

  test("a destination that is not configured gets nothing, whatever the row", () => {
    expect(
      effectiveLevel(null, { known: true, disabled: false, aliases: [] }, "other", TEAM),
    ).toEqual({ level: "local", reason: "unknown-destination" });
    expect(effectiveLevel(row, known, "other", TEAM)).toEqual({
      level: "local",
      reason: "unknown-destination",
    });
  });

  test("a row bound to an alias the project still has is in force", () => {
    expect(effectiveLevel(row, known, "team", TEAM)).toEqual({
      level: "knowledge",
      reason: "allowed",
    });
    expect(effectiveLevel({ ...row, level: "all" }, known, "team", TEAM)).toEqual({
      level: "all",
      reason: "allowed",
    });
  });

  test("a row whose alias the project lost reads local", () => {
    expect(effectiveLevel(row, { ...known, aliases: [] }, "team", TEAM)).toEqual({
      level: "local",
      reason: "unbound-alias",
    });
    expect(
      effectiveLevel(row, { ...known, aliases: ["remote:y.example/y"] }, "team", TEAM),
    ).toEqual({
      level: "local",
      reason: "unbound-alias",
    });
  });

  test("a row bound to a path alias the project still has reads local: only a host-led alias binds", () => {
    const path = { level: "knowledge", boundAlias: "remote:/Users/x/repo" };
    const project = { ...known, aliases: ["remote:/Users/x/repo", "remote:github.com/x/repo"] };
    expect(effectiveLevel(path, project, "team", TEAM)).toEqual({
      level: "local",
      reason: "unbound-alias",
    });
  });

  test("a disabled project's row reads local", () => {
    expect(effectiveLevel(row, { ...known, disabled: true }, "team", TEAM)).toEqual({
      level: "local",
      reason: "disabled",
    });
  });

  test("a level that is not one of the three reads local", () => {
    expect(effectiveLevel({ ...row, level: "wide" }, known, "team", TEAM)).toEqual({
      level: "local",
      reason: "level-local",
    });
  });

  test("a row stored at local shares nothing, as a project with no row does", () => {
    expect(effectiveLevel({ ...row, level: "local" }, known, "team", TEAM)).toEqual({
      level: "local",
      reason: "level-local",
    });
    // Nothing was chosen, so nothing is downgraded: memory off or a lost alias changes no reason.
    for (const project of [
      { ...known, disabled: true },
      { ...known, aliases: [] },
    ]) {
      expect(effectiveLevel({ ...row, level: "local" }, project, "team", TEAM)).toEqual({
        level: "local",
        reason: "level-local",
      });
    }
  });
});

describe("policyWith", () => {
  test("is an open, empty policy for the team destination", () => {
    const policy = policyWith({});
    expect(policy.epoch).toBe(0);
    expect(policy.closed).toBe(false);
    expect([...policy.destinations]).toEqual(["team"]);
    expect(policy.projects.size).toBe(0);
    expect(policy.roots.size).toBe(0);
    expect(policy.areas.size).toBe(0);
    expect(policy.inert).toEqual([]);
    expect(policy.settings).toEqual({ roots: [], areas: [] });
    expect(policy.fileLists).toEqual({ roots: [], areas: [] });
    expect(policy.settingsSeen).toEqual({ roots: [], areas: [] });
    expect(policy.levels.size).toBe(0);
    expect(policy.problems).toEqual([]);
  });

  test("keeps what it is given", () => {
    const policy = policyWith({ closed: true, epoch: 9, roots: new Set(["shared"]) });
    expect(policy.closed).toBe(true);
    expect(policy.epoch).toBe(9);
    expect([...policy.roots]).toEqual(["shared"]);
    expect([...policy.destinations]).toEqual(["team"]);
  });
});

describe("levelOf", () => {
  const P = 4;
  const Q = 5;
  const R = 6;
  const level = (projectId: number, over: Partial<LevelRow> = {}): [string, LevelRow] => [
    levelKey(projectId, "team"),
    {
      projectId,
      destination: "team",
      level: "knowledge",
      boundAlias: "remote:x.example/x",
      reason: "allowed",
      ...over,
    },
  ];
  const policy = policyWith({
    projects: new Set([P, Q, R]),
    levels: new Map([level(P), level(R, { level: "local", reason: "disabled" })]),
  });

  test("a project with a row has the row's level", () => {
    expect(levelOf(policy, P, "team")).toEqual({ level: "knowledge", reason: "allowed" });
  });

  test("a known project without a row shares nothing", () => {
    expect(levelOf(policy, Q, "team")).toEqual({ level: "local", reason: "level-local" });
  });

  test("a downgraded row answers local with what downgraded it", () => {
    expect(levelOf(policy, R, "team")).toEqual({ level: "local", reason: "disabled" });
  });

  test("project 0 and an unknown id have no project", () => {
    expect(levelOf(policy, 0, "team")).toEqual({ level: "local", reason: "no-project" });
    expect(levelOf(policy, 99, "team")).toEqual({ level: "local", reason: "no-project" });
  });

  test("a destination the policy does not know gets nothing, even for a project with a row", () => {
    expect(levelOf(policy, P, "other")).toEqual({
      level: "local",
      reason: "unknown-destination",
    });
  });
});
