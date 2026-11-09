import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineModule } from "../../src/engine/module.ts";
import {
  BUILT_IN,
  enabledModules,
  moduleAllowed,
  moduleEnabled,
} from "../../src/engine/modules.ts";
import { knowledge } from "../../src/modules/knowledge/index.ts";
import { memory } from "../../src/modules/memory/index.ts";
import { echo } from "../fixtures/echo-module.ts";

const AVAILABLE: readonly EngineModule[] = [memory, knowledge, echo];
const ids = (modules: EngineModule[]) => modules.map((module) => module.id);

/** Parses with a log the test can read, so nothing reaches the real log. */
function parse(raw: string | undefined, available: readonly EngineModule[] = AVAILABLE) {
  const logged: string[] = [];
  const modules = enabledModules(raw, available, (id) => logged.push(id));
  return { ids: ids(modules), logged };
}

describe("BUILT_IN", () => {
  test("is memory, then knowledge", () => {
    expect(ids([...BUILT_IN])).toEqual(["memory", "knowledge"]);
  });
});

describe("moduleAllowed", () => {
  test("every built-in module is allowed today", () => {
    for (const module of BUILT_IN) expect(moduleAllowed(module.id)).toBe(true);
  });
});

describe("enabledModules", () => {
  test("unset, empty, whitespace or only commas mean the default, memory and knowledge", () => {
    for (const raw of [undefined, "", "   ", " , ,"]) {
      expect(parse(raw)).toEqual({ ids: ["memory", "knowledge"], logged: [] });
    }
  });

  test("defaults to the built-in list", () => {
    expect(ids(enabledModules(undefined))).toEqual(["memory", "knowledge"]);
    expect(ids(enabledModules("memory"))).toEqual(["memory"]);
  });

  test("ids are trimmed and case-insensitive; duplicates collapse", () => {
    expect(parse(" memory , MEMORY,memory ").ids).toEqual(["memory"]);
  });

  test("the order is always the engine's, never the setting's", () => {
    expect(parse("echo,memory").ids).toEqual(["memory", "echo"]);
  });

  test("unknown ids are ignored and told once each", () => {
    expect(parse("memory,nonesuch,nonesuch,personas")).toEqual({
      ids: ["memory"],
      logged: ["nonesuch", "personas"],
    });
  });

  test("memory is always on: a list without it still has it, first", () => {
    expect(parse("echo").ids).toEqual(["memory", "echo"]);
    expect(parse("nonesuch")).toEqual({ ids: ["memory"], logged: ["nonesuch"] });
  });
});

describe("moduleEnabled", () => {
  // The one rule status and doctor ask: is this module on under the settings as they stand.
  const dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-modules-"));

  test("knowledge is on by default and off when the setting names memory alone", () => {
    expect(moduleEnabled("knowledge", {}, dir)).toBe(true);
    expect(moduleEnabled("knowledge", { WIZARDINGCODE_MODULES: "memory" }, dir)).toBe(false);
  });

  test("memory is on whatever the setting says; an unknown id is never on", () => {
    expect(moduleEnabled("memory", { WIZARDINGCODE_MODULES: "nonesuch" }, dir)).toBe(true);
    expect(moduleEnabled("nonesuch", {}, dir)).toBe(false);
  });
});
