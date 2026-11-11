import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AREA_ID, AREA_MAX } from "../../src/modules/knowledge/entry.ts";
import {
  loadSettings,
  narrowOnly,
  parseShareList,
  publicSettings,
  validatePatch,
} from "../../src/settings/settings.ts";
import {
  entryUid,
  LEVEL_LABELS,
  LEVELS,
  memoryUid,
  ROOTS,
  SHARE_AREA,
  widens,
} from "../../src/sharing/types.ts";

const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS";
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS";

const made: string[] = [];
/** A data directory whose env file holds the given lines. */
const dir = (...lines: string[]) => {
  const dataDir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-sharing-settings-"));
  made.push(dataDir);
  if (lines.length > 0) writeFileSync(join(dataDir, "env"), `${lines.join("\n")}\n`);
  return dataDir;
};
afterAll(() => {
  for (const dataDir of made) rmSync(dataDir, { recursive: true, force: true });
});

describe("levels, roots and area ids", () => {
  test("the levels, their labels and the roots are the fixed lists", () => {
    expect(LEVELS).toEqual(["local", "receive", "knowledge", "all"]);
    expect(LEVEL_LABELS).toEqual({
      local: "Nothing",
      receive: "Receive only",
      knowledge: "Knowledge",
      all: "Knowledge and memories",
    });
    expect(ROOTS).toEqual(["workspace", "shared"]);
  });

  test("a level widens only to a later one", () => {
    expect(widens("local", "all")).toBe(true);
    expect(widens("knowledge", "all")).toBe(true);
    expect(widens("all", "knowledge")).toBe(false);
    expect(widens("all", "all")).toBe(false);
  });

  test("a root-qualified id takes exactly the ids the knowledge store takes", () => {
    const accepted = ["sales", "a1-b", "2fa", "2026-launch", "a".repeat(40)];
    const refused = ["Sales", "-x", "x_y", "", "a".repeat(41), "a/b", "x.y"];
    expect(AREA_MAX).toBe(40);
    for (const [ids, expected] of [
      [accepted, true],
      [refused, false],
    ] as const) {
      for (const id of ids) {
        expect(AREA_ID.test(id) && id.length <= AREA_MAX).toBe(expected);
        expect(SHARE_AREA.test(`workspace:${id}`)).toBe(expected);
        expect(SHARE_AREA.test(`shared:${id}`)).toBe(expected);
      }
    }
  });

  test("an id without one of the two roots, in lower case, is refused", () => {
    for (const text of ["sales", "Workspace:sales", "workspace:", "other:sales"]) {
      expect(SHARE_AREA.test(text)).toBe(false);
    }
  });
});

describe("parseShareList", () => {
  test("trims, lower-cases, de-duplicates and sorts", () => {
    expect(parseShareList(" Workspace, shared ,workspace ", ROOTS_KEY)).toEqual({
      list: ["shared", "workspace"],
      problem: null,
    });
  });

  test("none and an absent value are the empty list", () => {
    for (const key of [ROOTS_KEY, AREAS_KEY] as const) {
      expect(parseShareList("none", key)).toEqual({ list: [], problem: null });
      expect(parseShareList(null, key)).toEqual({ list: [], problem: null });
    }
  });

  test("one token that is not a root empties the list and is named by position only", () => {
    const { list, problem } = parseShareList("workspace,all", ROOTS_KEY);
    expect(list).toEqual([]);
    expect(problem).toBe(`${ROOTS_KEY}: token 2 is not a root; the list was emptied`);
    expect(problem).not.toContain("all");
  });

  test("one token that is not a root-qualified area id empties the list", () => {
    const { list, problem } = parseShareList("workspace:sales,Sales", AREAS_KEY);
    expect(list).toEqual([]);
    expect(problem).toBe(
      `${AREAS_KEY}: token 2 is not a root-qualified area id; the list was emptied`,
    );
  });
});

describe("narrowOnly", () => {
  test("with no environment the file's list stands", () => {
    expect(narrowOnly(["shared", "workspace"], null)).toEqual({
      list: ["shared", "workspace"],
      ignored: 0,
      narrowed: false,
    });
  });

  test("what the environment adds is ignored and counted", () => {
    expect(narrowOnly(["workspace"], ["shared", "workspace"])).toEqual({
      list: ["workspace"],
      ignored: 1,
      narrowed: false,
    });
  });

  test("what the environment leaves out is removed", () => {
    expect(narrowOnly(["shared", "workspace"], ["workspace"])).toEqual({
      list: ["workspace"],
      ignored: 0,
      narrowed: true,
    });
    expect(narrowOnly(["workspace"], [])).toEqual({ list: [], ignored: 0, narrowed: true });
  });
});

describe("the two sharing keys in loadSettings and publicSettings", () => {
  test("the file's lists are read sorted", () => {
    const dataDir = dir(`${ROOTS_KEY}=workspace`, `${AREAS_KEY}=workspace:sales,shared:ops`);
    expect(loadSettings({}, dataDir).sharing).toEqual({
      roots: ["workspace"],
      areas: ["shared:ops", "workspace:sales"],
      problems: [],
    });
  });

  test("an environment that only adds changes nothing, and says how much it added", () => {
    const dataDir = dir(`${ROOTS_KEY}=workspace`);
    const env = { [ROOTS_KEY]: "workspace,shared" };
    expect(loadSettings(env, dataDir).sharing).toEqual({
      roots: ["workspace"],
      areas: [],
      problems: [`the environment's ${ROOTS_KEY} names 1 more than the file; ignored`],
    });
    expect(publicSettings(env, dataDir)[ROOTS_KEY]).toEqual({
      value: "workspace",
      source: "file",
    });
  });

  test("an environment that removes an id of the file's narrows, and is the source", () => {
    const dataDir = dir(`${ROOTS_KEY}=shared,workspace`);
    const env = { [ROOTS_KEY]: "workspace" };
    expect(loadSettings(env, dataDir).sharing.roots).toEqual(["workspace"]);
    expect(publicSettings(env, dataDir)[ROOTS_KEY]).toEqual({ value: "workspace", source: "env" });
  });

  test("none in the environment empties the file's list", () => {
    const dataDir = dir(`${ROOTS_KEY}=workspace`);
    const env = { [ROOTS_KEY]: "none" };
    expect(loadSettings(env, dataDir).sharing).toEqual({ roots: [], areas: [], problems: [] });
    expect(publicSettings(env, dataDir)[ROOTS_KEY]).toEqual({ value: "none", source: "env" });
  });

  test("an invalid token in the environment empties everything and names its position", () => {
    const dataDir = dir(`${AREAS_KEY}=workspace:sales`);
    const env = { [AREAS_KEY]: "workspace:sales,Sales!" };
    const { sharing } = loadSettings(env, dataDir);
    expect(sharing.areas).toEqual([]);
    expect(sharing.problems).toHaveLength(1);
    expect(sharing.problems[0]).toContain("token 2");
    expect(sharing.problems[0]).not.toContain("Sales!");
    expect(publicSettings(env, dataDir)[AREAS_KEY]).toEqual({ value: "none", source: "env" });
  });

  test("an invalid environment over no file value is still the default", () => {
    const dataDir = dir();
    const env = { [AREAS_KEY]: "Sales!" };
    expect(loadSettings(env, dataDir).sharing.areas).toEqual([]);
    expect(publicSettings(env, dataDir)[AREAS_KEY]).toEqual({ value: "none", source: "default" });
  });

  test("an empty environment variable is unset", () => {
    const dataDir = dir(`${ROOTS_KEY}=workspace`);
    for (const value of ["", "  "]) {
      const env = { [ROOTS_KEY]: value };
      expect(loadSettings(env, dataDir).sharing).toEqual({
        roots: ["workspace"],
        areas: [],
        problems: [],
      });
      expect(publicSettings(env, dataDir)[ROOTS_KEY]).toEqual({
        value: "workspace",
        source: "file",
      });
    }
  });

  test("with no file and no environment both keys are the default, none", () => {
    const view = publicSettings({}, dir());
    expect(view[ROOTS_KEY]).toEqual({ value: "none", source: "default" });
    expect(view[AREAS_KEY]).toEqual({ value: "none", source: "default" });
  });

  test("an invalid token in the file empties the file's list and names its position", () => {
    const dataDir = dir(`${AREAS_KEY}=workspace:Sales!`);
    const { sharing } = loadSettings({}, dataDir);
    expect(sharing.areas).toEqual([]);
    expect(sharing.problems).toEqual([
      `${AREAS_KEY}: token 1 is not a root-qualified area id; the list was emptied`,
    ]);
    expect(publicSettings({}, dataDir)[AREAS_KEY]).toEqual({ value: "none", source: "file" });
  });

  test("the problems come per key in a fixed order: the file's token, then the environment's", () => {
    const dataDir = dir(`${ROOTS_KEY}=workspace,everything`, `${AREAS_KEY}=Sales!`);
    const env = { [ROOTS_KEY]: "nowhere", [AREAS_KEY]: "shared:ops,Ops!" };
    expect(loadSettings(env, dataDir).sharing.problems).toEqual([
      `${ROOTS_KEY}: token 2 is not a root; the list was emptied`,
      `the environment's ${ROOTS_KEY}: token 1 is not a root; the list was emptied`,
      `${AREAS_KEY}: token 1 is not a root-qualified area id; the list was emptied`,
      `the environment's ${AREAS_KEY}: token 2 is not a root-qualified area id; the list was emptied`,
    ]);
  });
});

describe("the two sharing keys in validatePatch", () => {
  const AREAS_RULE = "a comma list of root-qualified area ids such as workspace:sales, or none";
  const ROOTS_RULE = "a comma list of workspace and shared, or none";
  const errorsOf = (patch: Record<string, unknown>) => {
    const result = validatePatch(patch);
    return result.ok ? {} : result.errors;
  };

  test("a list is stored trimmed, lower-cased, de-duplicated and sorted", () => {
    expect(validatePatch({ [AREAS_KEY]: "shared:marketing, workspace:sales" })).toEqual({
      ok: true,
      changes: { [AREAS_KEY]: "shared:marketing,workspace:sales" },
    });
    expect(validatePatch({ [ROOTS_KEY]: " Workspace,shared,workspace " })).toEqual({
      ok: true,
      changes: { [ROOTS_KEY]: "shared,workspace" },
    });
  });

  test("what is not a root-qualified area id is refused with the rule, whatever the value", () => {
    for (const value of ["Sales", "sales", "workspace:"]) {
      expect(errorsOf({ [AREAS_KEY]: value })).toEqual({ [AREAS_KEY]: AREAS_RULE });
    }
    expect(AREAS_RULE).not.toContain("Sales");
  });

  test("what is not a root is refused with the rule", () => {
    expect(errorsOf({ [ROOTS_KEY]: "all" })).toEqual({ [ROOTS_KEY]: ROOTS_RULE });
    expect(ROOTS_RULE).not.toContain("all");
  });

  test("an empty list is stored as none, and null clears the key", () => {
    expect(validatePatch({ [ROOTS_KEY]: "" })).toEqual({
      ok: true,
      changes: { [ROOTS_KEY]: "none" },
    });
    expect(validatePatch({ [ROOTS_KEY]: null })).toEqual({
      ok: true,
      changes: { [ROOTS_KEY]: null },
    });
  });
});

describe("item uids", () => {
  test("an entry's uid is its id scoped by its repository", () => {
    expect(entryUid("project", "remote:github.com/x/y", "u")).toBe(
      "project:remote:github.com/x/y:u",
    );
    expect(entryUid("workspace", null, "u")).toBe("workspace:u");
    expect(entryUid("shared", null, "u")).toBe("shared:u");
  });

  test("a project entry without its project's remote alias has no uid", () => {
    expect(() => entryUid("project", null, "u")).toThrow();
  });

  test("a memory's uid is its row id scoped by the store's generation", () => {
    expect(memoryUid("ab12cd34", 7)).toBe("ab12cd34:7");
  });
});
