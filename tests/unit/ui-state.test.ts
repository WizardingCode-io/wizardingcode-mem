import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearUiState, readUiState, UI_STATE_FILE, writeUiState } from "../../src/ui/state.ts";
import { brandHome } from "../../src/util/paths.ts";

let base: string;
let home: string;
let legacy: string;
const state = (pid: number) => ({ pid, origin: "http://127.0.0.1:1", token: "t", startedAt: 1 });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "wizardingcode-mem-state-"));
  home = join(base, "home");
  legacy = join(base, "home", "mem");
  mkdirSync(legacy, { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("the app's state file", () => {
  test("the brand home honours WIZARDINGCODE_HOME", () => {
    expect(brandHome({ WIZARDINGCODE_HOME: "/x/y" })).toBe("/x/y");
    expect(brandHome({})).toMatch(/\.wizardingcode$/);
  });

  test("is written and read at the brand level", () => {
    writeUiState(home, state(5));
    expect(existsSync(join(home, UI_STATE_FILE))).toBe(true);
    expect(readUiState(home, legacy)?.pid).toBe(5);
    clearUiState(home, 5, legacy);
    expect(readUiState(home, legacy)).toBeNull();
  });

  test("an old file in the data dir is moved to the brand level", () => {
    writeFileSync(join(legacy, UI_STATE_FILE), JSON.stringify(state(7)));
    expect(readUiState(home, legacy)?.pid).toBe(7);
    expect(existsSync(join(legacy, UI_STATE_FILE))).toBe(false);
    expect(JSON.parse(readFileSync(join(home, UI_STATE_FILE), "utf8")).pid).toBe(7);
  });

  test("with both present the brand file wins and the old one is removed", () => {
    writeFileSync(join(legacy, UI_STATE_FILE), JSON.stringify(state(7)));
    writeUiState(home, state(8));
    expect(readUiState(home, legacy)?.pid).toBe(8);
    expect(existsSync(join(legacy, UI_STATE_FILE))).toBe(false);
  });

  test("readers racing during the move all see the one app", async () => {
    for (let round = 0; round < 20; round++) {
      writeFileSync(join(legacy, UI_STATE_FILE), JSON.stringify(state(9)));
      rmSync(join(home, UI_STATE_FILE), { force: true });
      const seen = await Promise.all(
        Array.from({ length: 8 }, async () => readUiState(home, legacy)?.pid ?? null),
      );
      expect(seen).toEqual(Array(8).fill(9));
      expect(existsSync(join(legacy, UI_STATE_FILE))).toBe(false);
    }
  });
});
