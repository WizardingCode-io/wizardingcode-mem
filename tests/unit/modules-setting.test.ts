import { describe, expect, test } from "bun:test";
import type { EngineModule } from "../../src/engine/module.ts";
import { BUILT_IN, enabledModules, moduleAllowed } from "../../src/engine/modules.ts";
import { memory } from "../../src/modules/memory/index.ts";
import { echo } from "../fixtures/echo-module.ts";

const AVAILABLE: readonly EngineModule[] = [memory, echo];
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
  test("unset, empty, whitespace or only commas mean the default, of what is available", () => {
    for (const raw of [undefined, "", "   ", " , ,"]) {
      expect(parse(raw)).toEqual({ ids: ["memory"], logged: [] });
    }
  });

  test("defaults to memory and knowledge (ruling K7)", () => {
    expect(ids(enabledModules(undefined))).toEqual(["memory", "knowledge"]);
    expect(ids(enabledModules("memory,knowledge"))).toEqual(["memory", "knowledge"]);
    expect(ids(enabledModules("memory"))).toEqual(["memory"]);
  });

  test("ids are trimmed and case-insensitive; duplicates collapse", () => {
    expect(parse(" memory , MEMORY,memory ").ids).toEqual(["memory"]);
  });

  test("the order is always the engine's, never the setting's", () => {
    expect(parse("echo,memory").ids).toEqual(["memory", "echo"]);
  });

  test("unknown ids are ignored and told once each", () => {
    expect(parse("memory,vault,vault,personas")).toEqual({
      ids: ["memory"],
      logged: ["vault", "personas"],
    });
  });

  test("memory is always on: a list without it still has it, first", () => {
    expect(parse("echo").ids).toEqual(["memory", "echo"]);
    expect(parse("personas")).toEqual({ ids: ["memory"], logged: ["personas"] });
  });
});
