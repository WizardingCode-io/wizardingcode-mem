// The viewer tells of a newer release (ADR 0030): it reads what the daily check kept, says it
// in its own shape, remembers a dismissed banner per release, and asks the network nothing.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { openDb } from "../../src/store/db.ts";
import { getMeta } from "../../src/store/meta.ts";
import { startUi, type UiServer } from "../../src/ui/server.ts";
import { UPDATE_DISMISSED, type ViewerUpdate, viewerUpdate } from "../../src/ui/update.ts";
import { CHANNEL_COMMANDS } from "../../src/update/channels.ts";
import { type UpdateState, writeState } from "../../src/update/state.ts";

const NOW = Date.UTC(2026, 10, 12, 12);
const HOUR = 3_600_000;
const RUNNING = pkg.version;
/** A release after the one this suite runs, and one after that. */
const NEWER = "99.0.0";
const NEWEST = "99.1.0";

let base: string;
let dataDir: string;
let server: UiServer | undefined;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-ui-update-")));
  dataDir = join(base, "data");
  mkdirSync(dataDir, { recursive: true });
});
afterEach(async () => {
  await server?.stop();
  server = undefined;
  rmSync(base, { recursive: true, force: true });
});

/** The viewer over the data directory, with the test's own environment and clock. */
async function start(env: Record<string, string | undefined> = {}): Promise<UiServer> {
  server = await startUi({ dataDir, port: 0, open: false, now: () => NOW, env });
  return server;
}
const call = (s: UiServer, path: string, init: RequestInit = {}) =>
  fetch(`${s.origin}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${s.token}`, "content-type": "application/json" },
  });
const update = async (s: UiServer) => (await (await call(s, "/api/update")).json()) as ViewerUpdate;
const dismiss = (s: UiServer, body = "{}") =>
  call(s, "/api/update/dismiss", { method: "POST", body });

const state = (over: Partial<UpdateState> = {}): UpdateState => ({
  latest: NEWER,
  checkedAt: NOW - 3 * HOUR,
  attemptAt: NOW - 3 * HOUR,
  failedAt: null,
  reason: null,
  ...over,
});
const dismissed = () => {
  const db = openDb({ dataDir, busyTimeoutMs: 2000 });
  try {
    return getMeta(db, UPDATE_DISMISSED);
  } finally {
    db.close();
  }
};

describe("GET /api/update", () => {
  test("is behind the token", async () => {
    const s = await start();
    expect((await fetch(`${s.origin}/api/update`)).status).toBe(401);
    expect((await fetch(`${s.origin}/api/update/dismiss`, { method: "POST" })).status).toBe(401);
  });

  test("a release out: the line, the four channels' commands, the banner", async () => {
    writeState(dataDir, state());
    expect(await update(await start())).toEqual({
      running: RUNNING,
      staged: null,
      latest: NEWER,
      checkedAt: NOW - 3 * HOUR,
      failedAt: null,
      reason: null,
      mode: "check",
      out: true,
      line: `${NEWER} is out (checked 3 h ago); this copy is ${RUNNING}`,
      agents: null,
      commands: CHANNEL_COMMANDS.map(({ channel, command, shell }) => ({
        channel,
        command,
        shell,
      })),
      fromEnvironment: false,
      banner: true,
    });
    expect(CHANNEL_COMMANDS.length).toBe(4);
  });

  test("the running version is the latest", async () => {
    writeState(dataDir, state({ latest: RUNNING }));
    expect(await update(await start())).toMatchObject({
      latest: RUNNING,
      mode: "check",
      out: false,
      line: `${RUNNING} is the latest (checked 3 h ago)`,
      commands: [],
      banner: false,
    });
  });

  test("the check off in the file, and off by the environment", async () => {
    writeState(dataDir, state());
    writeFileSync(join(dataDir, "env"), "WIZARDINGCODE_MEM_UPDATE=off\n");
    const inFile = await update(await start());
    expect(inFile).toMatchObject({
      mode: "off",
      out: false,
      fromEnvironment: false,
      banner: false,
    });
    expect(inFile.line).toBe(`off (WIZARDINGCODE_MEM_UPDATE in ${join(dataDir, "env")})`);
    expect(inFile.commands).toEqual([]);
    await server?.stop();

    rmSync(join(dataDir, "env"));
    const byEnv = await update(await start({ WIZARDINGCODE_MEM_UPDATE: "off" }));
    expect(byEnv).toMatchObject({ mode: "off", out: false, fromEnvironment: true, banner: false });
    expect(byEnv.line).toStartWith("off (WIZARDINGCODE_MEM_UPDATE in this command's environment");
  });

  test("a value that is neither check nor off, and CI", async () => {
    writeFileSync(join(dataDir, "env"), "WIZARDINGCODE_MEM_UPDATE=sometimes\n");
    expect(await update(await start())).toMatchObject({
      mode: "off-unknown",
      out: false,
      line: "off (WIZARDINGCODE_MEM_UPDATE is neither check nor off)",
      banner: false,
    });
    await server?.stop();

    rmSync(join(dataDir, "env"));
    expect(await update(await start({ CI: "true" }))).toMatchObject({
      mode: "ci",
      out: false,
      line: "not checked in CI",
      banner: false,
    });
  });

  test("not checked yet, and a last check that failed", async () => {
    expect(await update(await start())).toMatchObject({
      latest: null,
      checkedAt: null,
      mode: "check",
      out: false,
      line: "not checked yet",
      commands: [],
      banner: false,
    });
    await server?.stop();

    writeState(
      dataDir,
      state({ latest: null, checkedAt: null, failedAt: NOW - 2 * HOUR, reason: "offline" }),
    );
    expect(await update(await start())).toMatchObject({
      latest: null,
      failedAt: NOW - 2 * HOUR,
      reason: "offline",
      out: false,
      line: "could not check (offline, 2 h ago); no release known yet",
      banner: false,
    });
  });

  // The staged file is run to ask its version: an executable is needed, and root never runs it.
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "a staged binary of another version gives the agents line",
    async () => {
      mkdirSync(join(dataDir, "bin"));
      const staged = join(dataDir, "bin", "wizardingcode-mem");
      writeFileSync(staged, "#!/bin/sh\necho 0.0.1\n");
      chmodSync(staged, 0o755);
      writeState(dataDir, state());
      const answer = await update(await start());
      expect(answer.staged).toBe("0.0.1");
      expect(answer.line).toBe(`${NEWER} is out (checked 3 h ago); the agents run 0.0.1`);
      expect(answer.agents).toBe(
        `agents run 0.0.1 from ${staged}; this copy is ${RUNNING}: wizardingcode-mem install moves them to it`,
      );
    },
  );

  test("a report that cannot be built is said in the same shape", () => {
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    try {
      const answer = viewerUpdate({
        db,
        dataDir,
        env: {},
        now: NOW,
        build: () => {
          throw new Error("EACCES: permission denied, open '/x/update.json'\n    at somewhere");
        },
      });
      expect(answer).toEqual({
        running: RUNNING,
        staged: null,
        latest: null,
        checkedAt: null,
        failedAt: null,
        reason: null,
        mode: "check",
        out: false,
        line: "not checked: EACCES: permission denied, open '/x/update.json'",
        agents: null,
        commands: [],
        fromEnvironment: false,
        banner: false,
      });
    } finally {
      db.close();
    }
  });
});

describe("POST /api/update/dismiss", () => {
  test("the banner stays away for that release and comes back for a later one", async () => {
    writeState(dataDir, state());
    const s = await start();
    expect((await update(s)).banner).toBe(true);
    expect(await (await dismiss(s)).json()).toEqual({ dismissed: NEWER });
    const after = await update(s);
    expect(after).toMatchObject({ out: true, banner: false });
    expect(after.commands.length).toBe(4);
    expect(dismissed()).toBe(NEWER);

    writeState(dataDir, state({ latest: NEWEST }));
    expect(await update(s)).toMatchObject({ latest: NEWEST, out: true, banner: true });
  });

  test("with no release known it keeps nothing", async () => {
    const s = await start();
    expect(await (await dismiss(s)).json()).toEqual({ dismissed: null });
    expect(dismissed()).toBeNull();
  });

  test("the request's body is ignored: the release kept is the one update.json names", async () => {
    writeState(dataDir, state());
    const s = await start();
    const answer = await dismiss(s, JSON.stringify({ latest: NEWEST, version: NEWEST }));
    expect(await answer.json()).toEqual({ dismissed: NEWER });
    expect(dismissed()).toBe(NEWER);
    writeState(dataDir, state({ latest: NEWEST }));
    expect((await update(s)).banner).toBe(true);
  });
});

describe("the viewer asks the network nothing", () => {
  test("with a check due, neither route makes a request to another host", async () => {
    // No update.json, and neither the setting nor CI in the environment: a check is due.
    const s = await start({});
    const real = globalThis.fetch;
    const elsewhere: string[] = [];
    let own = 0;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith(s.origin)) own++;
      else elsewhere.push(url);
      return real(input, init);
    }) as typeof fetch;
    try {
      expect((await update(s)).mode).toBe("check");
      expect((await dismiss(s)).status).toBe(200);
      expect((await update(s)).line).toBe("not checked yet");
    } finally {
      globalThis.fetch = real;
    }
    expect(own).toBe(3);
    expect(elsewhere).toEqual([]);
  });
});

describe("the switch", () => {
  const put = (s: UiServer, value: string) =>
    call(s, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({ WIZARDINGCODE_MEM_UPDATE: value }),
    });
  const envFile = () => readFileSync(join(dataDir, "env"), "utf8");

  test("off and check go through PUT /api/settings, and the report follows", async () => {
    writeState(dataDir, state());
    const s = await start();
    expect((await put(s, "off")).status).toBe(200);
    expect(envFile()).toContain("WIZARDINGCODE_MEM_UPDATE=off");
    expect(await update(s)).toMatchObject({ mode: "off", out: false, banner: false });

    expect((await put(s, "check")).status).toBe(200);
    expect(envFile()).toContain("WIZARDINGCODE_MEM_UPDATE=check");
    expect(await update(s)).toMatchObject({ mode: "check", out: true, banner: true });

    expect((await put(s, "sometimes")).status).toBe(400);
    expect(envFile()).toContain("WIZARDINGCODE_MEM_UPDATE=check");
  });
});
