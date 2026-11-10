// The second round's UI captures, taken by Google Chrome in headless mode driven over the
// DevTools protocol: the five states the first round found undeclared, and the two states its
// defects changed. Writes <page>-<state>@1512.png and console-<page>-<state>.json into the
// review folder and merges the rows into its manifest.json.
//   ./node_modules/.bin/bun probes/capture-round-two.ts <viewer url with token> <data dir> <review/ui dir>
// The viewer must run over a data directory seeded by scratchpad/seed-sharing-capture-2.ts,
// with WIZARDINGCODE_MEM_SHARE_ROOTS=workspace,shared in its environment (wider than the
// file, so the page shows the problems alert).
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [viewerUrl, dataDir, outDir] = process.argv.slice(2) as [string, string, string];
if (!viewerUrl || !dataDir || !outDir) {
  console.log("usage: capture-round-two.ts <viewer url> <data dir> <review/ui dir>");
  process.exit(64);
}
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const WIDTH = 1512;
const HEIGHT = 982;

// --- Chrome ------------------------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), "wizardingcode-mem-capture-"));
const chrome = Bun.spawn(
  [
    CHROME,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    `--window-size=${WIDTH},${HEIGHT}`,
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdout: "ignore", stderr: "ignore" },
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let wsUrl = "";
for (let i = 0; i < 50 && !wsUrl; i++) {
  try {
    const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as Array<{
      type: string;
      webSocketDebuggerUrl: string;
    }>;
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

// --- CDP ---------------------------------------------------------------------------------
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
    consoleLog.push({
      kind: params.type,
      text: params.args.map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? ""))).join(" "),
    });
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
  const out = await send<{ result: { value?: T; description?: string }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
  );
  if (out.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);
  }
  return out.result.value as T;
};
const waitFor = async (predicate: string, what: string, ms = 15000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      // The document may not exist yet right after a navigation.
      if (await evaluate<boolean>(`!!(document.body && (${predicate}))`)) return;
    } catch {}
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
};
const settle = () => sleep(600);

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

// --- The captures ------------------------------------------------------------------------
const rows: Array<Record<string, unknown>> = [];
const capture = async (page: string, state: string, note: string, clip?: { x: number; y: number; width: number; height: number }) => {
  const shot = await send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  const png = `${page}-${state}@${WIDTH}.png`;
  writeFileSync(join(outDir, png), Buffer.from(shot.data, "base64"));
  const consoleFile = `console-${page}-${state}.json`;
  writeFileSync(
    join(outDir, consoleFile),
    `${JSON.stringify({ messages: consoleLog, note: "Chrome's console, exceptions and log entries since the previous capture, read over the DevTools protocol (Runtime and Log domains)." }, null, 2)}\n`,
  );
  consoleLog = [];
  rows.push({ page, state, width: WIDTH, capture: png, console: consoleFile, by: "session", note: `${note}${clip ? " A clip of the page at the row." : ""}` });
  console.log(png);
};
// Click the first element whose own text is exactly `text`, among `selector`.
const clickText = (selector: string, text: string) =>
  evaluate<boolean>(
    `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`,
  );
const must = async (ok: Promise<boolean>, what: string) => {
  if (!(await ok)) throw new Error(`not found: ${what}`);
};
const PATCH_FETCH = (ruleSource: string) =>
  `(() => { if (!window.__realFetch) window.__realFetch = window.fetch; const rule = ${ruleSource}; window.fetch = (u, o) => (rule(String(u), o || {}) ? Promise.reject(new TypeError("Failed to fetch")) : window.__realFetch(u, o)); return true; })()`;
const RESTORE_FETCH = `(() => { if (window.__realFetch) window.fetch = window.__realFetch; return true; })()`;

const base = viewerUrl.replace(/#.*$/, "");
const finish = async (code: number) => {
  try {
    chmodSync(dataDir, 0o755);
  } catch {}
  ws.close();
  chrome.kill();
  await sleep(300);
  process.exit(code);
};

try {
  // 1. Settings → Sharing with the environment wider than the file: the problems alert.
  await send("Page.navigate", { url: `${base}#settings/sharing` });
  await waitFor(`document.body.innerText.includes("Workspace knowledge")`, "the Sharing page");
  await settle();
  await capture(
    "settings-sharing",
    "problems",
    "The environment holds WIZARDINGCODE_MEM_SHARE_ROOTS=workspace,shared while the file says workspace: the environment is ignored and the page shows the problems alert above the roots; the Workspace root on, the file's areas (sales on, legal inert).",
  );

  // 2. The inert-area row with Remove.
  const rect = await evaluate<{ x: number; y: number; width: number; height: number } | null>(
    `(() => { const all = [...document.querySelectorAll("li, div")].filter((e) => e.textContent.includes("not in the taxonomy") && e.querySelector("button")); if (all.length === 0) return null; const el = all.reduce((a, b) => (a.getBoundingClientRect().height <= b.getBoundingClientRect().height ? a : b)); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
  if (!rect) throw new Error("the inert-area row was not found");
  await capture(
    "settings-sharing",
    "inert-area",
    "The file's areas hold workspace:legal while the workspace taxonomy has no legal area: the row reads 'legal · not in the taxonomy; ignored' with its Remove button.",
    { x: Math.max(0, rect.x - 16), y: Math.max(0, rect.y - 12), width: Math.min(WIDTH, rect.width + 32), height: rect.height + 24 },
  );

  // 3. The load error: GET /api/sharing fails while the page mounts.
  await evaluate(PATCH_FETCH(`(u, o) => u.includes("/api/sharing") && !u.includes("/preview") && !(o.method && o.method !== "GET")`));
  await must(clickText("button, a", "Viewer"), "the Viewer nav item");
  await waitFor(`!document.body.innerText.includes("Workspace knowledge")`, "the Viewer page");
  await must(clickText("button, a", "Sharing"), "the Sharing nav item");
  await waitFor(`document.body.innerText.includes("Sharing could not be loaded.")`, "the load error");
  await settle();
  await capture("settings-sharing", "load-error", "GET /api/sharing failed while the page mounted (fetch rejected in the page): the paragraph 'Sharing could not be loaded.' and no controls.");
  await evaluate(RESTORE_FETCH);

  // 4. The error toast, now a plain sentence: the data directory read-only, Finance turned on and saved.
  await must(clickText("button, a", "Viewer"), "the Viewer nav item");
  await waitFor(`!document.body.innerText.includes("Sharing could not be loaded.")`, "the Viewer page");
  await must(clickText("button, a", "Sharing"), "the Sharing nav item");
  await waitFor(`document.body.innerText.includes("Workspace knowledge")`, "the Sharing page again");
  await settle();
  console.log(
    `Save disabled with nothing changed: ${await evaluate<boolean | null>(`(() => { const b = [...document.querySelectorAll("button")].find((e) => e.textContent.trim() === "Save"); return b ? b.disabled : null; })()`)}`,
  );
  chmodSync(dataDir, 0o555);
  await must(
    evaluate<boolean>(
      `(() => { const row = (s) => { let el = s; while (el && !(el.textContent || "").includes("Finance")) el = el.parentElement; return el; }; const sw = [...document.querySelectorAll('[role="switch"]')].find((s) => { const r = row(s); return r && r.getBoundingClientRect().height < 48; }); if (!sw) return false; sw.click(); return true; })()`,
    ),
    "the Finance switch",
  );
  await settle();
  await must(clickText("button", "Save"), "the Save button");
  await waitFor(`document.body.innerText.includes("Share more knowledge?") || document.body.innerText.includes("Share")`, "the confirmation dialog");
  await settle();
  await must(
    evaluate<boolean>(
      `(() => { const b = [...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].find((e) => e.textContent.trim() === "Share"); if (!b) return false; b.click(); return true; })()`,
    ),
    "the dialog's Share action",
  );
  await waitFor(`document.body.innerText.includes("The settings file could not be written.")`, "the error toast");
  await capture(
    "settings-sharing",
    "error",
    "Finance turned on and saved while the data directory was read-only: the toast 'Sharing not saved' with the plain sentence 'The settings file could not be written.', no path and no error message; the switches as chosen, nothing recorded.",
  );
  chmodSync(dataDir, 0o755);

  // 5. Across projects: the row pill at Knowledge. The viewer reads its hash when it loads,
  // so a new document each time.
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url: `${base}#projects` });
  await waitFor(
    `document.body.innerText.includes("Across projects") && document.body.innerText.includes("wizardingcode-mem") && !document.body.innerText.includes("Workspace knowledge")`,
    "the projects list",
  );
  await settle();
  await capture("projects", "row-pill-knowledge", "The wizardingcode-mem project at Knowledge (set from the shell before the capture): its row shows the 'Knowledge' pill; the other two rows show none.");

  // 6. The dock: the radio list with the three labels in full.
  // The deep link the viewer reads when it loads: the project open in the dock.
  const { Database } = await import("bun:sqlite");
  const store = new Database(join(dataDir, "wizardingcode-mem.db"), { readonly: true });
  const memId = (store.query("SELECT id FROM projects WHERE name = 'wizardingcode-mem'").get() as { id: number } | null)?.id;
  store.close();
  if (!memId) throw new Error("the wizardingcode-mem project is not in the store");
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url: `${base}#projects/${memId}` });
  await waitFor(`[...document.querySelectorAll('[role="radio"]')].length >= 3`, "the dock's level list");
  await settle();
  await capture("projects-dock", "default", "The wizardingcode-mem project opened in the dock: the Sharing section with Knowledge current and the radio list Nothing / Knowledge / Knowledge and memories, each label in full at the dock's 320px.");

  // 7. The dock's Not changed toast: the preview fails.
  await evaluate(PATCH_FETCH(`(u, o) => u.includes("/api/sharing/preview") || (u.includes("/api/projects/") && u.endsWith("/sharing"))`));
  await must(
    evaluate<boolean>(
      `(() => { const r = [...document.querySelectorAll('[role="radio"]')].find((e) => (e.closest("label, div")?.textContent || e.getAttribute("aria-label") || "").includes("Knowledge and memories")); if (!r) return false; r.click(); return true; })()`,
    ),
    "the Knowledge and memories radio",
  );
  await waitFor(`document.body.innerText.includes("The level could not be saved.")`, "the Not changed toast");
  await capture("projects-dock", "not-changed", "Knowledge and memories chosen while the preview request failed (fetch rejected in the page): the toast 'Not changed' with 'The level could not be saved.'; the dock keeps Knowledge.");
  await evaluate(RESTORE_FETCH);
} catch (error) {
  console.log(`capture failed: ${error instanceof Error ? error.message : String(error)}`);
  try {
    const shot = await send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, "failed-step.png"), Buffer.from(shot.data, "base64"));
    console.log("the page at the failure: failed-step.png");
  } catch {}
  await finish(1);
}

// --- The manifest --------------------------------------------------------------------------
const manifestPath = join(outDir, "manifest.json");
const manifest = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown> & { captures: Array<Record<string, unknown>>; declared: string[]; observations: string[] })
  : { by: "session", captures: [], declared: [], observations: [] };
const kept = manifest.captures.filter((c) => !rows.some((r) => r.page === c.page && r.state === c.state));
manifest.captures = [...kept, ...rows];
manifest.declared = [...new Set([...manifest.declared, "problems", "load-error", "inert-area", "row-pill-knowledge", "not-changed"])];
manifest.observations = manifest.observations.filter(
  (o) => !o.includes("truncated to 'Knowledge …'") && !o.includes("server's message with the data directory's full path"),
);
manifest.roundTwo = {
  method:
    "Seven captures retaken or added on 2026-11-09 after the first judgement round, by Google Chrome in headless mode driven over the DevTools protocol by probes/capture-round-two.ts (prefers-color-scheme dark, 1512×982), on a viewer started from source (bun src/cli/main.ts ui --no-open) over a data directory seeded by scratchpad/seed-sharing-capture-2.ts: the first round's seed, the remote project at Knowledge, an env file with roots workspace and areas workspace:sales,workspace:legal, and WIZARDINGCODE_MEM_SHARE_ROOTS=workspace,shared in the server's environment. Failures of a request were produced by replacing fetch in the page; the write failure by making the data directory read-only.",
  fixed: ["the dock's level control shows its three labels in full (a radio list)", "the error toasts show a plain sentence, never the error's message or a path"],
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest: ${manifest.captures.length} captures`);
await finish(0);
