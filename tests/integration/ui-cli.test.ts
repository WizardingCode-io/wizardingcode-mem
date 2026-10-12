import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startUi, type UiServer } from "../../src/ui/server.ts";
import { readUiState, UI_STATE_FILE } from "../../src/ui/state.ts";
import { runCliWith } from "../helpers/cli.ts";

const MAIN = new URL("../../src/cli/main.ts", import.meta.url).pathname;

let base: string;
let dataDir: string;
let homeDir: string;
let server: UiServer | undefined;
let opened: number;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-ui-cli-")));
  dataDir = join(base, "home", "mem");
  homeDir = join(base, "home");
  mkdirSync(dataDir, { recursive: true });
  opened = 0;
});
afterEach(async () => {
  await server?.stop();
  server = undefined;
  rmSync(base, { recursive: true, force: true });
});

describe("wizardingcode-mem ui --auto", () => {
  test("with a viewer already running, asks it to show itself and leaves, silently", async () => {
    server = await startUi({
      dataDir,
      homeDir,
      port: 0,
      open: false,
      openBrowser: () => void opened++,
    });
    const result = await runCliWith(
      { env: { WIZARDINGCODE_MEM_DATA_DIR: dataDir, WIZARDINGCODE_HOME: homeDir } },
      "ui",
      "--auto",
    );
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(opened).toBe(1);
    // The running viewer is still the one on record.
    expect(readUiState(homeDir, dataDir)?.pid).toBe(process.pid);
  });

  test("two sessions starting while the old state file moves leave one app and no old file", async () => {
    server = await startUi({
      dataDir,
      homeDir: join(base, "elsewhere"),
      port: 0,
      open: false,
      openBrowser: () => void opened++,
    });
    const recorded = readUiState(join(base, "elsewhere"));
    // As an older version left it: in the memory data directory.
    writeFileSync(join(dataDir, UI_STATE_FILE), JSON.stringify(recorded));
    const env = { WIZARDINGCODE_MEM_DATA_DIR: dataDir, WIZARDINGCODE_HOME: homeDir };
    const results = await Promise.all([
      runCliWith({ env }, "ui", "--auto"),
      runCliWith({ env }, "ui", "--auto"),
    ]);
    for (const r of results) expect(r).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(opened).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(dataDir, UI_STATE_FILE))).toBe(false);
    expect(readUiState(homeDir, dataDir)?.pid).toBe(process.pid);
  });

  test("with a stale state file, starts a viewer of its own and records it", async () => {
    // A viewer that died: its port answers nobody.
    const dead = await startUi({ dataDir, homeDir, port: 0, open: false });
    const { origin } = dead;
    await dead.stop();
    writeFileSync(
      join(homeDir, UI_STATE_FILE),
      JSON.stringify({ pid: 999_999, origin, token: "stale", startedAt: 0 }),
    );
    const proc = Bun.spawn([process.execPath, MAIN, "ui", "--auto"], {
      env: {
        ...process.env,
        WIZARDINGCODE_MEM_DATA_DIR: dataDir,
        WIZARDINGCODE_HOME: homeDir,
        WIZARDINGCODE_MEM_UI_BROWSER: "none",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      let state = readUiState(homeDir, dataDir);
      for (let i = 0; i < 100 && state?.pid !== proc.pid; i++) {
        await Bun.sleep(50);
        state = readUiState(homeDir, dataDir);
      }
      expect(state?.pid).toBe(proc.pid);
      expect(state?.origin).not.toBe(origin);
      const alive = await fetch(`${state?.origin}/api/ping`, {
        headers: { Authorization: `Bearer ${state?.token}` },
      });
      expect(alive.status).toBe(200);
    } finally {
      proc.kill();
      await proc.exited;
    }
    expect(await new Response(proc.stdout).text()).toBe("");
  }, 15_000);
});
