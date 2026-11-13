// The UI evidence of the viewer's release notice (AC-11, ADR 0030): the About card's Release
// block in its states (latest, out, off, off-env, unchecked, failed) and the banner over the
// memories view (update-out), at 360, 768 and 1280, light and dark, taken by Google Chrome in
// headless mode over the DevTools protocol. The viewer runs in this process over a seeded data
// directory; the routes are the real ones, and update.json is written as the daily check writes it.
//   ./node_modules/.bin/bun .crew/work/<item>/probes/capture-008.ts <review/ui dir>
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../../../package.json" with { type: "json" };
import type { Redacted } from "../../../../src/core/redact.ts";
import { openDb } from "../../../../src/store/db.ts";
import { insertMemory } from "../../../../src/store/memories.ts";
import { startUi, type UiServer } from "../../../../src/ui/server.ts";
import { UPDATE_DISMISSED } from "../../../../src/ui/update.ts";
import { STATE_FILE, type UpdateState, writeState } from "../../../../src/update/state.ts";

const [outDir] = process.argv.slice(2) as [string];
if (!outDir) {
  console.log("usage: capture-008.ts <review/ui dir>");
  process.exit(64);
}
mkdirSync(outDir, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9348;
const WIDTHS = [1280, 768, 360] as const;
const SCHEMES = ["dark", "light"] as const;
const HEIGHT = 900;
const HOUR = 3_600_000;

// --- The seed: one project with three memories, and a staged binary older than this copy ----------
const base = mkdtempSync(join(tmpdir(), "wcm-008-capture-"));
const dataDir = join(base, "data");
const home = join(base, "home");
mkdirSync(dataDir, { recursive: true });
mkdirSync(home, { recursive: true });
const baseEnv: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  HOME: home,
  WIZARDINGCODE_HOME: dataDir,
  WIZARDINGCODE_MEM_DATA_DIR: dataDir,
  WIZARDINGCODE_MEM_MIGRATE: "off",
  WIZARDINGCODE_MEM_DISTILL: "off",
  WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
  WIZARDINGCODE_MEM_UI_BROWSER: "none",
  // No transcripts of the person's own agents: the History offer stays out of the captures.
  CLAUDE_CONFIG_DIR: join(base, "no-claude"),
  CODEX_HOME: join(base, "no-codex"),
};
const db = openDb({ dataDir, busyTimeoutMs: 5000 });
const now = Date.now();
const project = db
  .query<{ id: number }, [string, string, number]>("INSERT INTO projects (key, name, created_at) VALUES (?, ?, ?) RETURNING id")
  .get(`path:${join(home, "work", "site")}`, "site", now)?.id as number;
db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [`path:${join(home, "work", "site")}`, project]);
for (const [title, body] of [
  ["The queue keeps one lease per worker", "A worker holds one lease; a second one waits."],
  ["One binary, no daemon", "The hooks and the viewer are one binary."],
  ["Prices are read from the plan, never typed", "The checkout reads the plan's price at the moment of the order."],
] as const) {
  insertMemory(db, { projectId: project, kind: "decision", title, body: body as Redacted, terms: "", importance: 4, branch: null, commit: null, origin: "distilled", judge: "heuristic", judgeVersion: "1", sourceTurnId: null, files: [], now: now - HOUR });
}
const RUNNING = pkg.version;
const [major, minor] = RUNNING.split(".").map(Number) as [number, number];
const NEWER = `${major}.${minor + 1}.0`;
const OLDER = `${major}.${Math.max(0, minor - 1)}.0`;
const envFile = join(dataDir, "env");
const stateFile = join(dataDir, STATE_FILE);
const staged = join(dataDir, "bin", "wizardingcode-mem");
/** What the daily check would have left: a state, or none; the setting in the file; a staged copy. */
function world(input: { state?: Partial<UpdateState> | null; off?: boolean; setting?: string; stagedCopy?: boolean }): void {
  rmSync(stateFile, { force: true });
  rmSync(envFile, { force: true });
  rmSync(join(dataDir, "bin"), { recursive: true, force: true });
  db.run("DELETE FROM meta WHERE key = ?", [UPDATE_DISMISSED]);
  if (input.state !== undefined && input.state !== null) {
    writeState(dataDir, { latest: NEWER, checkedAt: Date.now() - 3 * HOUR, attemptAt: Date.now() - 3 * HOUR, failedAt: null, reason: null, ...input.state });
  }
  if (input.off === true) writeFileSync(envFile, "WIZARDINGCODE_MEM_UPDATE=off\n");
  if (input.setting !== undefined) writeFileSync(envFile, `WIZARDINGCODE_MEM_UPDATE=${input.setting}\n`);
  if (input.stagedCopy === true) {
    mkdirSync(join(dataDir, "bin"), { recursive: true });
    writeFileSync(staged, `#!/bin/sh\necho ${OLDER}\n`);
    chmodSync(staged, 0o755);
  }
}
let viewer: UiServer = await startUi({ dataDir, homeDir: join(base, "brand-home"), port: 0, open: false, env: baseEnv, spawn: () => undefined });
/**
 * The viewer again, in another environment (the one way a setting comes "from the
 * environment"), or with a report that cannot be built.
 */
async function restart(extra: Record<string, string>, broken = false): Promise<void> {
  await viewer.stop();
  viewer = await startUi({
    dataDir,
    homeDir: join(base, "brand-home"),
    port: 0,
    open: false,
    env: { ...baseEnv, ...extra },
    spawn: () => undefined,
    ...(broken
      ? {
          updateReport: () => {
            throw new Error("EIO: i/o error, read");
          },
        }
      : {}),
  });
}

// --- Chrome over the DevTools protocol ------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), "wcm-008-chrome-"));
const chrome = Bun.spawn(
  [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--window-size=1280,${HEIGHT}`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
  { stdout: "ignore", stderr: "ignore" },
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let wsUrl = "";
for (let i = 0; i < 50 && !wsUrl; i++) {
  try {
    const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
  } catch {
    await sleep(200);
  }
}
const finish = async (code: number) => {
  try {
    chrome.kill();
  } catch {}
  await viewer.stop().catch(() => undefined);
  db.close();
  rmSync(base, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
  process.exit(code);
};
if (!wsUrl) {
  console.log("Chrome gave no page target");
  await finish(1);
}
type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
const ws = new WebSocket(wsUrl);
await new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve();
  ws.onerror = (e) => reject(e);
});
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let consoleLog: Array<{ kind: string; text: string }> = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data)) as Message;
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (!p) return;
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const params = msg.params as { type: string; args: Array<{ value?: unknown; description?: string }> };
    consoleLog.push({ kind: params.type, text: params.args.map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? ""))).join(" ") });
  } else if (msg.method === "Runtime.exceptionThrown") {
    const params = msg.params as { exceptionDetails: { text: string; exception?: { description?: string } } };
    consoleLog.push({ kind: "exception", text: params.exceptionDetails.exception?.description ?? params.exceptionDetails.text });
  } else if (msg.method === "Log.entryAdded") {
    const params = msg.params as { entry: { level: string; text: string; url?: string } };
    consoleLog.push({ kind: `log:${params.entry.level}`, text: `${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ""}` });
  }
};
const send = <T = unknown>(method: string, params: Record<string, unknown> = {}) =>
  new Promise<T>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async <T = unknown>(expression: string): Promise<T> => {
  const out = await send<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);
  return out.result.value as T;
};
const waitFor = async (predicate: string, what: string, ms = 15000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if (await evaluate<boolean>(`!!(document.body && (${predicate}))`)) return;
    } catch {}
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
};
const has = (text: string) => `document.body.innerText.includes(${JSON.stringify(text)})`;
const gone = (text: string) => `!${has(text)}`;
const settle = () => sleep(600);
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");

const rows: Array<Record<string, unknown>> = [];
let width: number = WIDTHS[0];
let scheme: (typeof SCHEMES)[number] = SCHEMES[0];
const capture = async (page: string, state: string, note: string) => {
  await settle();
  const shot = await send<{ data: string }>("Page.captureScreenshot", { format: "png" });
  const png = `${page}-${state}@${width}-${scheme}.png`;
  writeFileSync(join(outDir, png), Buffer.from(shot.data, "base64"));
  const consoleFile = `console-${page}-${state}@${width}-${scheme}.json`;
  writeFileSync(join(outDir, consoleFile), `${JSON.stringify({ messages: consoleLog, note: "Chrome's console, exceptions and log entries since the previous capture, read over the DevTools protocol (Runtime and Log domains)." }, null, 2)}\n`);
  // The gate pairs a state with console-<page>-<state>.json: every viewport and scheme merged.
  const mergedFile = join(outDir, `console-${page}-${state}.json`);
  const before = existsSync(mergedFile) ? (JSON.parse(readFileSync(mergedFile, "utf8")) as { messages: unknown[] }).messages : [];
  writeFileSync(mergedFile, `${JSON.stringify({ messages: [...before, ...consoleLog.map((m) => ({ capture: png, ...m }))], note: "The console messages of every viewport and scheme of this state, merged from the per-capture files." }, null, 2)}\n`);
  consoleLog = [];
  rows.push({ page, state, width, scheme, motion: "none", capture: png, console: consoleFile, by: "session", note });
  console.log(png);
};
const open = async (hash: string, predicate: string, what: string) => {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await send("Page.navigate", { url: `${viewer.origin}/?token=${viewer.token}&theme=${scheme}${hash}` });
  await waitFor(predicate, what);
  await settle();
};
const about = (predicate: string, what: string) => open("#settings/about", predicate, what);
const SWITCH = "Check for new releases once a day";

try {
  for (scheme of SCHEMES) {
    for (width of WIDTHS) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: HEIGHT, deviceScaleFactor: 1, mobile: width < 700 });
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });

      // Latest: the running version is the latest release.
      world({ state: { latest: RUNNING } });
      await about(has(`${RUNNING} is the latest`), "the latest state");
      await capture("settings-about", "latest", `update.json names ${RUNNING}, the version this viewer runs: the Release block reads '${RUNNING} is the latest (checked 3 h ago)' in the quiet tone with a check icon, no commands, and the switch on; About in the Settings list carries no mark.`);

      // Out: a newer release, and a staged copy older than this one.
      world({ state: {}, stagedCopy: true });
      await about(has(`${NEWER} is out`), "the out state");
      await capture("settings-about", "out", `update.json names ${NEWER} and the staged binary answers ${OLDER}: '${NEWER} is out (checked 3 h ago); the agents run ${OLDER}' in the warning tone, the agents line under it, one row per channel (plugin as an instruction, Homebrew, npm and the script as commands with a copy button), the switch on; the release banner shows above the page and About carries the mark 'new'.`);

      // The banner over the memories view.
      await open("#memories", has(`${NEWER} is out.`), "the banner over the memories view");
      await capture("memories", "update-out", `The same data on the memories view: the banner 'wizardingcode-mem ${NEWER} is out. The agents run ${OLDER}.' under the top bar, across the window's width, with 'How to update' and 'Dismiss'. At 360 the line is the release alone, '${NEWER} is out.'.`);

      // Off: the check turned off in the file.
      world({ state: {}, off: true });
      await about(has("Off (WIZARDINGCODE_MEM_UPDATE in"), "the off state");
      await capture("settings-about", "off", "WIZARDINGCODE_MEM_UPDATE=off in the data directory's env file, with a newer release already in update.json: 'Off (WIZARDINGCODE_MEM_UPDATE in <data dir>/env)' in the muted tone, no commands, no banner, the switch off and enabled.");

      // Off by the environment: the switch cannot change it.
      world({ state: {} });
      await restart({ WIZARDINGCODE_MEM_UPDATE: "off" });
      await about(has("Set by WIZARDINGCODE_MEM_UPDATE in the environment"), "the off-env state");
      await capture("settings-about", "off-env", "The viewer started with WIZARDINGCODE_MEM_UPDATE=off in its environment: 'Off (WIZARDINGCODE_MEM_UPDATE in the environment this viewer was started with)' in the muted tone; the switch is off and disabled, and its description says the environment sets it.");
      await restart({});

      // Not checked yet: no update.json.
      world({ state: null });
      await about(has("Not checked yet"), "the unchecked state");
      await capture("settings-about", "unchecked", "No update.json yet (a new install): 'Not checked yet' in the muted tone, the switch on, no commands and no banner.");

      // Failed: the last check could not reach github.com.
      world({ state: { latest: null, checkedAt: null, failedAt: Date.now() - 2 * HOUR, reason: "offline" } });
      await about(has("Could not check (offline"), "the failed state");
      await capture("settings-about", "failed", "The last check failed and no release is known: 'Could not check (offline, 2 h ago); no release known yet' in the warning tone with the problem sign (a triangle, not the release's arrow), the switch on, no commands and no banner.");

      // Ahead: this copy is newer than the latest release (a build from main).
      world({ state: { latest: OLDER } });
      await about(has(`${RUNNING} is ahead of the latest release ${OLDER}`), "the ahead state");
      await capture("settings-about", "ahead", `update.json names ${OLDER}, older than this copy: '${RUNNING} is ahead of the latest release ${OLDER} (checked 3 h ago)' in the quiet tone with the check sign, no commands, no banner, no mark.`);

      // Off-unknown: the key holds a value that is neither check nor off.
      world({ state: {}, setting: "sometimes" });
      await about(has("Off (WIZARDINGCODE_MEM_UPDATE is neither check nor off)"), "the off-unknown state");
      await capture("settings-about", "off-unknown", "WIZARDINGCODE_MEM_UPDATE=sometimes in the env file: 'Off (WIZARDINGCODE_MEM_UPDATE is neither check nor off)' in the muted tone, and the switch off, since no check runs; turning it on writes check.");

      // CI: the environment says CI, so the daily check never runs.
      world({ state: null });
      await restart({ CI: "true" });
      await about(has("Not checked in CI"), "the ci state");
      await capture("settings-about", "ci", "The viewer started with CI set and no update.json: 'Not checked in CI' in the muted tone, the switch on (the setting allows the check; the environment holds it).");

      // Unbuilt: the report itself could not be built.
      await restart({}, true);
      await about(has("Not checked: EIO: i/o error, read"), "the unbuilt state");
      await capture("settings-about", "unbuilt", "The report could not be built (the route's builder throws, as a disk error would): 'Not checked: EIO: i/o error, read' in the warning tone with the problem sign, no commands, no banner; the card and its switch stay.");
      await restart({});

      // The banner when no copy is staged: this copy is the one that runs.
      world({ state: {} });
      await open("#memories", has(`${NEWER} is out.`), "the banner with no staged copy");
      await capture("memories", "update-out-copy", `A newer release and no staged binary: the banner reads 'wizardingcode-mem ${NEWER} is out. This copy is ${RUNNING}.' (the release alone at 360).`);
      void SWITCH;
    }
  }
} catch (error) {
  console.log(`capture failed: ${error instanceof Error ? error.message : String(error)}`);
  try {
    const shot = await send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, `failed-step@${width}-${scheme}.png`), Buffer.from(shot.data, "base64"));
    const text = await evaluate<string>("document.body.innerText.slice(0, 2000)");
    writeFileSync(join(outDir, `failed-step@${width}-${scheme}.json`), `${JSON.stringify({ text, console: consoleLog }, null, 2)}\n`);
  } catch {}
  await finish(1);
}

const manifest = {
  by: "session",
  method:
    "The session ran the viewer (startUi) from source in one Bun process over a seeded data directory (one project with three memories), wrote update.json as the daily check writes it (writeState), the env file and a staged binary that answers an older version, and drove Google Chrome in headless mode over the DevTools protocol (probes/capture-008.ts). Each state was set again for every viewport and scheme; the off-env state restarts the viewer with the setting in its environment. PNG screenshots, viewport-sized, motion none. No request left the machine: the viewer reads update.json and never asks.",
  pages: {
    "settings-about": { route: "/settings#about", declared: ["latest", "out", "off", "off-env", "unchecked", "failed", "ahead", "off-unknown", "ci", "unbuilt"] },
    memories: { route: "/memories", declared: ["update-out", "update-out-copy"] },
  },
  viewports: [...WIDTHS],
  schemes: [...SCHEMES],
  motion: "none",
  observations: [
    "The versions in the captures are derived from the running one: the newer release is the next minor, the staged copy the previous minor.",
    "The clicks of 'How to update', 'Dismiss' and the copy buttons are not driven here: the routes behind them are held by tests/integration/ui-update.test.ts, and the buttons are read in the captures.",
  ],
  captures: rows,
};
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest: ${rows.length} captures`);
ws.close();
await finish(0);
