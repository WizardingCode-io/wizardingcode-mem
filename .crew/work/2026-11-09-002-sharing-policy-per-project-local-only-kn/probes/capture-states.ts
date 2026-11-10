// The first round's nine states retaken on the code under review, by Google Chrome in
// headless mode over the DevTools protocol (the scaffolding of capture-round-two.ts). Three
// sets, each on its own viewer and seeded data directory:
//   a: the first round's seed (three projects, entries, memories, no level, no env file):
//      settings default, confirm, success; the dock's confirm, success, no-remote, memory-off
//   b: the same seed with no knowledge: settings empty-taxonomy
//   c: the same seed, the viewer started with WIZARDINGCODE_MEM_SHARE_ROOTS=none: settings locked
//   ./node_modules/.bin/bun probes/capture-states.ts <a|b|c> <viewer url with token> <data dir> <review/ui dir>
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [set, viewerUrl, dataDir, outDir] = process.argv.slice(2) as [string, string, string, string];
if (!["a", "b", "c"].includes(set) || !viewerUrl || !dataDir || !outDir) {
  console.log("usage: capture-states.ts <a|b|c> <viewer url> <data dir> <review/ui dir>");
  process.exit(64);
}
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9334 + ["a", "b", "c"].indexOf(set);
const WIDTH = 1512;
const HEIGHT = 982;

const profile = mkdtempSync(join(tmpdir(), "wizardingcode-mem-capture-"));
const chrome = Bun.spawn(
  [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--window-size=${WIDTH},${HEIGHT}`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
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
if (!wsUrl) {
  chrome.kill();
  console.log("Chrome gave no page target");
  process.exit(1);
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
const settle = () => sleep(700);
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

const rows: Array<Record<string, unknown>> = [];
const capture = async (page: string, state: string, note: string) => {
  const shot = await send<{ data: string }>("Page.captureScreenshot", { format: "png" });
  const png = `${page}-${state}@${WIDTH}.png`;
  writeFileSync(join(outDir, png), Buffer.from(shot.data, "base64"));
  const consoleFile = `console-${page}-${state}.json`;
  writeFileSync(join(outDir, consoleFile), `${JSON.stringify({ messages: consoleLog, note: "Chrome's console, exceptions and log entries since the previous capture, read over the DevTools protocol (Runtime and Log domains)." }, null, 2)}\n`);
  consoleLog = [];
  rows.push({ page, state, width: WIDTH, capture: png, console: consoleFile, by: "session", note });
  console.log(png);
};
const clickText = (selector: string, text: string) =>
  evaluate<boolean>(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
const clickSwitchOfRow = (rowText: string) =>
  evaluate<boolean>(
    `(() => { const row = (s) => { let el = s; while (el && !(el.textContent || "").includes(${JSON.stringify(rowText)})) el = el.parentElement; return el; }; const sw = [...document.querySelectorAll('[role="switch"]')].find((s) => { const r = row(s); return r && r.getBoundingClientRect().height < 64; }); if (!sw) return false; sw.click(); return true; })()`,
  );
const clickDialogAction = (text: string) =>
  evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
const must = async (ok: Promise<boolean>, what: string) => {
  if (!(await ok)) throw new Error(`not found: ${what}`);
};
const base = viewerUrl.replace(/#.*$/, "");
const open = async (hash: string, predicate: string, what: string) => {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url: `${base}${hash}` });
  await waitFor(predicate, what);
  await settle();
};
const projectId = (name: string) => {
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
  const store = new Database(join(dataDir, "wizardingcode-mem.db"), { readonly: true });
  const row = store.query("SELECT id FROM projects WHERE name = ?").get(name) as { id: number } | null;
  store.close();
  if (!row) throw new Error(`the project ${name} is not in the store`);
  return row.id;
};
const finish = async (code: number) => {
  ws.close();
  chrome.kill();
  await sleep(300);
  process.exit(code);
};

try {
  if (set === "a") {
    await open("#settings/sharing", `document.body.innerText.includes("Workspace knowledge")`, "the Sharing page");
    await capture("settings-sharing", "default", "No root, no area, every project at Nothing: the switches off, '0 entries would leave' under each root, the area totals, the projects line with zeros, Save disabled while nothing changed.");
    await must(clickSwitchOfRow("Workspace knowledge"), "the Workspace root switch");
    await must(clickSwitchOfRow("Sales"), "the Sales switch");
    await settle();
    await must(clickText("button", "Save"), "the Save button");
    await waitFor(`document.querySelector('[role="dialog"], [role="alertdialog"]')`, "the confirmation dialog");
    await settle();
    await capture("settings-sharing", "confirm", "Workspace knowledge and Sales turned on, Save clicked: the dialog 'Share more knowledge?' with the preview's count.");
    await must(clickDialogAction("Share"), "the dialog's Share action");
    await waitFor(`document.body.innerText.includes("Sharing saved")`, "the success toast");
    await capture("settings-sharing", "success", "After Share: the toast 'Sharing saved', the switches kept, the Workspace count now the entries that would leave, the last change line.");

    const mem = projectId("wizardingcode-mem");
    await open(`#projects/${mem}`, `[...document.querySelectorAll('[role="radio"]')].length >= 3`, "the dock's level list");
    await must(
      evaluate<boolean>(`(() => { const r = [...document.querySelectorAll('[role="radio"]')].find((e) => (e.closest("label, div")?.textContent || e.getAttribute("aria-label") || "").includes("Knowledge and memories")); if (!r) return false; r.click(); return true; })()`),
      "the Knowledge and memories radio",
    );
    await waitFor(`document.querySelector('[role="dialog"], [role="alertdialog"]')`, "the dock's confirmation dialog");
    await settle();
    await capture("projects-dock", "confirm", "Knowledge and memories chosen in the dock: the dialog 'Share more of wizardingcode-mem?' with the entries and memories the level would release.");
    await must(clickDialogAction("Share"), "the dialog's Share action");
    await waitFor(`document.body.innerText.includes("Sharing changed")`, "the dock's success toast");
    await capture("projects-dock", "success", "After Share: the row's pill 'Knowledge and memories', the dock's current label and the radio list with that level chosen, the toast 'Sharing changed' naming the old and new labels.");

    const site = projectId("site");
    await open(`#projects/${site}`, `document.body.innerText.includes("This project has no git remote.")`, "the no-remote dock");
    await capture("projects-dock", "no-remote", "The site project (no git remote): the radio list disabled with 'This project has no git remote. A team can only match projects by their remote.'");
    const old = projectId("old-tool");
    await open(`#projects/${old}`, `document.body.innerText.includes("Memory is off for this project.")`, "the memory-off dock");
    await capture("projects-dock", "memory-off", "The old-tool project (memory off): the radio list disabled with 'Memory is off for this project.'");
  } else if (set === "b") {
    await open("#settings/sharing", `document.body.innerText.includes("No taxonomy yet")`, "the empty-taxonomy page");
    await capture("settings-sharing", "empty-taxonomy", "A store with no knowledge repository: each root shows 'No taxonomy yet: write a knowledge entry first.' and no area.");
  } else {
    await open("#settings/sharing", `document.body.innerText.includes("Set by the environment.")`, "the locked page");
    await capture("settings-sharing", "locked", "WIZARDINGCODE_MEM_SHARE_ROOTS=none in the server's environment: both root switches off and disabled with 'Set by the environment.'; the areas as the file has them.");
  }
} catch (error) {
  console.log(`capture failed: ${error instanceof Error ? error.message : String(error)}`);
  try {
    const shot = await send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, `failed-step-${set}.png`), Buffer.from(shot.data, "base64"));
  } catch {}
  await finish(1);
}

const manifestPath = join(outDir, "manifest.json");
const manifest = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown> & { captures: Array<Record<string, unknown>>; roundTwo?: Record<string, unknown> })
  : { by: "session", captures: [] };
manifest.captures = [...manifest.captures.filter((c) => !rows.some((r) => r.page === c.page && r.state === c.state)), ...rows];
manifest.roundTwo = {
  ...(manifest.roundTwo ?? {}),
  retaken: `every state of the first round was retaken on the code under review on 2026-11-09 by probes/capture-states.ts, the same headless path (set ${set} in this run), so no capture shows the interface before the round's fixes`,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest: ${manifest.captures.length} captures`);
await finish(0);
