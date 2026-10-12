import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startUi, type UiServer } from "../../src/ui/server.ts";
import { probeUi, readUiState, UI_STATE_FILE } from "../../src/ui/state.ts";

let base: string;
let dataDir: string;
let homeDir: string;
let server: UiServer | undefined;
let clock: number;
let opened: string[];

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-ui-state-")));
  dataDir = join(base, "home", "mem");
  homeDir = join(base, "home");
  clock = Date.UTC(2026, 9, 6, 9);
  opened = [];
});
afterEach(async () => {
  await server?.stop();
  server = undefined;
  rmSync(base, { recursive: true, force: true });
});

async function start(options: { idleMs?: number; onIdle?: () => void } = {}): Promise<UiServer> {
  server = await startUi({
    dataDir,
    homeDir,
    port: 0,
    open: false,
    now: () => clock,
    openBrowser: (url) => void opened.push(url),
    ...options,
  });
  return server;
}
const api = (s: UiServer, path: string, init: RequestInit = {}) =>
  fetch(`${s.origin}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${s.token}`, ...(init.headers ?? {}) },
  });
const post = (s: UiServer, path: string) => api(s, path, { method: "POST" });

describe("the viewer's state file", () => {
  test("says where the running viewer is, for the owner only, and goes with it", async () => {
    const s = await start();
    const path = join(homeDir, UI_STATE_FILE);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      pid: process.pid,
      origin: s.origin,
      token: s.token,
      startedAt: clock,
    });
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readUiState(homeDir, dataDir)).toMatchObject({ origin: s.origin, token: s.token });
    await s.stop();
    expect(existsSync(path)).toBe(false);
    expect(readUiState(homeDir, dataDir)).toBeNull();
  });

  test("a probe tells a live viewer from a stale file", async () => {
    const s = await start();
    expect(
      await probeUi({ pid: process.pid, origin: s.origin, token: s.token, startedAt: 0 }),
    ).toBe(true);
    expect(await probeUi({ pid: 1, origin: s.origin, token: "wrong", startedAt: 0 })).toBe(false);
    await s.stop();
    expect(await probeUi({ pid: 1, origin: s.origin, token: s.token, startedAt: 0 })).toBe(false);
  });
});

describe("opening the browser is the server's decision", () => {
  test("opens once, not again within ten seconds, and not while a tab is alive", async () => {
    const s = await start();
    expect(await (await post(s, "/api/open")).json()).toEqual({ opened: true });
    expect(opened).toEqual([s.url]);

    clock += 5_000;
    expect(await (await post(s, "/api/open")).json()).toEqual({ opened: false, reason: "recent" });

    clock += 60_000;
    expect((await post(s, "/api/ping")).status).toBe(204);
    clock += 30_000;
    expect(await (await post(s, "/api/open")).json()).toEqual({ opened: false, reason: "tab" });

    clock += 90_000;
    expect(await (await post(s, "/api/open")).json()).toEqual({ opened: true });
    expect(opened).toHaveLength(2);
  });

  test("a tab that said goodbye no longer counts", async () => {
    const s = await start();
    await post(s, "/api/ping");
    clock += 20_000;
    expect(await (await post(s, "/api/open")).json()).toEqual({ opened: false, reason: "tab" });
    expect((await post(s, "/api/bye")).status).toBe(204);
    expect(await (await post(s, "/api/open")).json()).toEqual({ opened: true });
  });

  test("the ping answers who is there, and needs the token like everything else", async () => {
    const s = await start();
    expect(await (await api(s, "/api/ping")).json()).toEqual({
      pid: process.pid,
      lastPingAt: null,
    });
    await post(s, "/api/ping");
    expect(await (await api(s, "/api/ping")).json()).toEqual({
      pid: process.pid,
      lastPingAt: clock,
    });
    expect((await fetch(`${s.origin}/api/ping`)).status).toBe(401);
  });

  test("heartbeats keep an otherwise idle viewer alive", async () => {
    let idle = 0;
    const s = await start({ idleMs: 150, onIdle: () => void idle++ });
    for (let i = 0; i < 6; i++) {
      await Bun.sleep(50);
      await post(s, "/api/ping");
    }
    expect(idle).toBe(0);
    await Bun.sleep(300);
    expect(idle).toBe(1);
  });
});
