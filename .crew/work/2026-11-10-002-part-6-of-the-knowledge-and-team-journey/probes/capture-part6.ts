// The UI evidence of part 6 (AC-90): every declared state of /settings#servers (empty, listed,
// adding, confirming, pending, error, stopped, rejoining, removing, resuming, token-missing,
// held, muted, unavailable), /settings#sharing (one, several) and the /projects dock (bound,
// choosing, receive, sent, widening), at 360, 768 and 1280, light and dark, taken by Google
// Chrome in headless mode over the DevTools protocol. The viewer and the team server run in
// this process over a seeded data directory; the routes are the real ones.
//   ./node_modules/.bin/bun .crew/work/<item>/probes/capture-part6.ts <review/ui dir>
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../../../src/core/project.ts";
import type { Redacted } from "../../../../src/core/redact.ts";
import { personAuthor } from "../../../../src/modules/knowledge/author.ts";
import { renderTaxonomy } from "../../../../src/modules/knowledge/entry.ts";
import { openRepo } from "../../../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../../../src/modules/knowledge/store.ts";
import { openStore } from "../../../../src/modules/knowledge/store-open.ts";
import { setLevel } from "../../../../src/sharing/store.ts";
import { openDb } from "../../../../src/store/db.ts";
import { insertMemory } from "../../../../src/store/memories.ts";
import { restoreHoldKey, setMeta } from "../../../../src/store/meta.ts";
import type { SyncContext } from "../../../../src/sync/context.ts";
import { insertPending, readTokens, tokensPath, writeToken } from "../../../../src/sync/servers.ts";
import { startUi } from "../../../../src/ui/server.ts";
import { realClock, realTimers } from "../../../../src/util/clock.ts";
import { realGit } from "../../../../tests/helpers/stub-git.ts";
import { adminOf, invite, startTestServer } from "../../../../tests/helpers/team.ts";

const [outDir] = process.argv.slice(2) as [string];
if (!outDir) {
  console.log("usage: capture-part6.ts <review/ui dir>");
  process.exit(64);
}
mkdirSync(outDir, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9341;
const WIDTHS = [1280, 768, 360] as const;
const SCHEMES = ["dark", "light"] as const;
const HEIGHT = 900;
const TOKEN_TWO = `wcm1_${"u".repeat(43)}`;
const SERVER_TWO = "22222222aaaaaaaa";

// --- The seed: a data directory with two projects (remotes), memories, one workspace entry ------
const base = mkdtempSync(join(tmpdir(), "wcm-part6-capture-"));
const dataDir = join(base, "data");
const home = join(base, "home");
mkdirSync(dataDir, { recursive: true });
mkdirSync(home, { recursive: true });
const env: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  HOME: home,
  WIZARDINGCODE_HOME: dataDir,
  WIZARDINGCODE_MEM_DATA_DIR: dataDir,
  WIZARDINGCODE_MEM_MIGRATE: "off",
  WIZARDINGCODE_MEM_DISTILL: "off",
  WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
  WIZARDINGCODE_MEM_UI_BROWSER: "none",
  WIZARDINGCODE_MEM_AUTHOR: "Ana",
};
writeFileSync(join(dataDir, "env"), "WIZARDINGCODE_MEM_SHARE_ROOTS=workspace\nWIZARDINGCODE_MEM_SHARE_AREAS=workspace:sales\n");
const db = openDb({ dataDir, busyTimeoutMs: 5000 });
const now = Date.now();
const projectDir = (name: string, remote: string) => {
  const folder = join(home, "work", name);
  mkdirSync(folder, { recursive: true });
  realGit(folder, "init", "-q");
  realGit(folder, "remote", "add", "origin", remote);
  return resolveProject(db, folder, now).id;
};
const site = projectDir("site", "https://github.com/acme/site.git");
const widgets = projectDir("widgets", "https://github.com/acme/widgets.git");
const seedMemory = (projectId: number, title: string, body: string) =>
  insertMemory(db, {
    projectId,
    kind: "decision",
    title,
    body: body as Redacted,
    terms: "",
    importance: 4,
    branch: null,
    commit: null,
    origin: "distilled",
    judge: "heuristic",
    judgeVersion: "1",
    sourceTurnId: null,
    files: [],
    now: now - 3_600_000,
  });
seedMemory(site, "The queue keeps one lease per worker", "A worker holds one lease; a second one waits.");
seedMemory(site, "Retries back off from two seconds", "Doubling to ten minutes, then stays there.");
seedMemory(widgets, "Widgets render from the catalogue once", "The catalogue is read at start, never per request.");
const knowledge = openStore({ db, dataDir, env, now: () => Date.now() });
const workspace = openRepo(knowledge, { scope: "workspace" }, { create: personAuthor(knowledge) });
if (workspace === null) throw new Error("no workspace repository");
writeFileSync(
  join(workspace.path, "taxonomy.md"),
  renderTaxonomy({ version: 2, updated: "2026-11-10T00:00:00Z", areas: [{ id: "sales", label: "Sales" }, { id: "code", label: "Code" }] }),
);
realGit(workspace.path, "add", "-A");
realGit(workspace.path, "-c", "user.name=Ana", "-c", "user.email=ana@example.invalid", "commit", "-qm", "taxonomy");
writeEntry(
  knowledge,
  { scope: "workspace" },
  { title: "Discovery call script", kind: "strategy", area: "sales", context: "agency clients", subject: "discovery call", body: "Open with the outcome they named, then the constraint." },
  personAuthor(knowledge),
);
const ctx: SyncContext = { db, dataDir, storeDir: dataDir, env, fetch: (input, init) => fetch(input, init), clock: realClock, timers: realTimers, pid: process.pid, version: "0", log: () => undefined };

// --- The team server and the viewer, in this process ---------------------------------------------
const team = await startTestServer({}, {});
const admin = await adminOf(team, "Admin");
const viewer = await startUi({ dataDir, homeDir: join(base, "brand"), port: 0, open: false, env, spawn: () => undefined });
const teamUrl = team.server.origin;
const serverId = team.server.serverId;

// --- Chrome over the DevTools protocol ------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), "wcm-part6-chrome-"));
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
  await team.close().catch(() => undefined);
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
const clickText = (selector: string, text: string) =>
  evaluate<boolean>(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
/** Clicks the label of a radio or a switch by its exact text. */
const clickLabel = (text: string) =>
  evaluate<boolean>(`(() => { const el = [...document.querySelectorAll("label")].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
const gone = (text: string) => `!${has(text)}`;
const setValue = (selector: string, value: string) =>
  evaluate<boolean>(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value"); desc.set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`,
  );
const must = async (ok: Promise<boolean>, what: string) => {
  if (!(await ok)) throw new Error(`not found: ${what}`);
};
const open = async (hash: string, predicate: string, what: string) => {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await send("Page.navigate", { url: `${viewer.origin}/?token=${viewer.token}&theme=${scheme}${hash}` });
  await waitFor(predicate, what);
  await settle();
};

// --- The store's state between captures ---------------------------------------------------------
const resetServers = () => {
  db.run("DELETE FROM sharing_levels");
  db.run("DELETE FROM sharing_muted_members");
  db.run("DELETE FROM sharing_servers");
  for (const table of ["sharing_ledger", "sharing_sent_hashes", "sharing_refusals", "sharing_conflicts", "sharing_pending_rows", "sharing_unbound"]) db.run(`DELETE FROM ${table}`);
  db.run("DELETE FROM meta WHERE key LIKE 'sync.%' OR key LIKE 'sharing.restore_hold:%'");
  rmSync(tokensPath(dataDir), { force: true });
};
const addServerTwo = () => {
  insertPending(db, { serverId: SERVER_TWO, url: "https://two.acme.test", name: "Two", deviceId: "dev-two", deviceAlias: "laptop", memberId: "mem-two", memberName: "Ana", role: "member", contract: 1, instance: "inst-two", addedAt: Date.now() });
  db.run("UPDATE sharing_servers SET confirmed_at = ? WHERE server_id = ?", [Date.now(), SERVER_TWO]);
  writeToken(ctx, SERVER_TWO, TOKEN_TWO);
};
const level = (projectId: number, destination: string, lvl: "receive" | "knowledge") => {
  const out = setLevel(db, { projectId, destination, level: lvl, source: "viewer", now: Date.now(), confirm: true });
  if (!out.ok) throw new Error(`setLevel: ${out.reason}`);
};

try {
  for (scheme of SCHEMES) {
    for (width of WIDTHS) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: HEIGHT, deviceScaleFactor: 1, mobile: width < 700 });
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      resetServers();
      // The test server's join bucket refills by its own fake clock: a new minute per pass.
      team.clock.advance(5 * 60_000);

      // Servers: empty.
      await open("#settings/servers", has("No server listed yet."), "the empty Servers card");
      await capture("settings", "empty", "No server listed: the sentence 'No server listed yet. Nothing leaves this machine until one is.' and the 'Add a server…' button; no sync line.");
      // Adding: the form open, the address typed.
      await must(clickText("button", "Add a server…"), "the Add a server button");
      await waitFor(has("Invitation code"), "the add form");
      await must(setValue('input[placeholder="https://team.example.com"]', teamUrl), "the address field");
      await capture("settings", "adding", "The add form: address, invitation code (never echoed), this device's label and the name; Join disabled until both the address and a code are typed.");
      // Error: a code the server refuses.
      await must(setValue('input[type="password"]', `wci1_${"A".repeat(26)}`), "the code field");
      await settle();
      await must(clickText("button", "Join"), "the Join button");
      await waitFor(has("Not added"), "the refusal toast");
      await capture("settings", "error", "A refused code: the toast 'Not added · The server refused the code.'; the form stays filled, the code too, so a URL typed wrong can be fixed and the same code sent again.");
      // Confirming: a real code, the counts, the Confirm and Not now buttons.
      const code = await invite(team, admin.token, { role: "member", name: `Ana ${scheme} ${width}` });
      await must(setValue('input[type="password"]', code), "the code field");
      await settle();
      await must(clickText("button", "Join"), "the Join button");
      await waitFor(has("The server is pending until you confirm."), "the counts panel");
      await capture("settings", "confirming", "Joined: the member and role the server gave, 'Would leave now: 1 knowledge entry and 0 memories', Confirm and Not now; the row waits as Pending in the list above.");
      // Pending: left as such.
      await must(clickText("button", "Not now"), "the Not now button");
      await waitFor(has("Left pending"), "the pending toast");
      await capture("settings", "pending", "Not now: the row stays Pending with its Confirm button, and the toast says it waits in the list.");
      // Listed: confirmed.
      await must(clickText("button", "Confirm"), "the row's Confirm button");
      await waitFor(has("Server added"), "the added toast");
      await capture("settings", "listed", "Confirmed: the row reads Ok with the member and role, last sync never, Mute, Rejoin… and Remove…; the sync line below; Run now at the card's head.");
      // Sent: one server listed and a project bound to none.
      await open(`#projects/${widgets}`, has("binds this project to"), "the widgets dock with one server");
      await capture("projects", "sent", "One server listed and the project bound to none: the dock's Sharing section says a level set here binds the project to that server, above the levels, which are enabled.");
      // Muted: the server's entries kept but not shown.
      await open("#settings/servers", has("Mute"), "the listed row");
      await must(clickText("button", "Mute"), "the Mute button");
      await waitFor(has("Unmute"), "the muted row");
      await capture("settings", "muted", "The server muted: its pill reads Muted and the row offers Unmute; its entries and memories stay here but no agent is shown them.");
      await must(clickText("button", "Unmute"), "the Unmute button");
      await waitFor(gone("Unmute"), "the unmuted row");
      // Rejoining: the modal with the code field.
      await must(clickText("button", "Rejoin…"), "the Rejoin button");
      await waitFor(has("Rejoin with a new code"), "the rejoin modal");
      await capture("settings", "rejoining", "Rejoin…: the modal asks for a new invitation code (never echoed); Rejoin stays disabled until one is typed; what was sent stays on record.");
      await must(clickText("button", "Cancel"), "the modal's Cancel");
      await waitFor(gone("Rejoin with a new code"), "the rejoin modal closed");
      // Removing: the modal with what it deletes and the withdraw checkbox.
      await must(clickText("button", "Remove…"), "the Remove button");
      await waitFor(has("Remove this server?"), "the remove modal");
      await capture("settings", "removing", "Remove…: the modal names what leaves this machine (received entries and memories, levels, ledger, token), offers to withdraw what this device sent first, and says the device stays listed on the server until an admin revokes it.");
      await must(clickText("button", "Cancel"), "the modal's Cancel");
      await waitFor(gone("Remove this server?"), "the remove modal closed");
      // Held: a withdrawal hold from a restore, the Resume… button, then the resume's confirmation.
      setMeta(db, restoreHoldKey(serverId), JSON.stringify({ reason: "restore", at: Date.now(), count: 0 }));
      await open("#settings/servers", has("Resume…"), "the held row");
      await capture("settings", "held", "Withdrawals held since a restore: the row's line says nothing is taken back until you resume, and offers Resume….");
      await must(clickText("button", "Resume…"), "the Resume button");
      await waitFor(has("Resume the withdrawals?"), "the resume confirmation");
      await capture("settings", "resuming", "Resume…: the confirmation says what the next sync would withdraw per project (nothing here, so the hold is released) and asks before it does.");
      await must(clickText("button", "Cancel"), "the confirmation's Cancel");
      await waitFor(gone("Resume the withdrawals?"), "the resume confirmation closed");
      db.run("DELETE FROM meta WHERE key = ?", [restoreHoldKey(serverId)]);
      // Token missing: the token file lost its entry.
      const tokens = readTokens(dataDir);
      rmSync(tokensPath(dataDir), { force: true });
      await open("#settings/servers", has("Token missing"), "the token-missing row");
      await capture("settings", "token-missing", "The token is gone from servers.json: the pill reads Token missing and the line says to ask an admin for a code and Rejoin… with it.");
      writeToken(ctx, serverId, tokens[serverId] as string);
      // Stopped: the device revoked on the server side.
      db.run("UPDATE sharing_servers SET stopped = 'unauthorized' WHERE server_id = ?", [serverId]);
      await open("#settings/servers", has("This device was revoked"), "the stopped row");
      await capture("settings", "stopped", "The device was revoked: the row's pill reads Stopped and the line under it gives the remedy in the page's words (ask an admin for a code, then Rejoin… with it).");
      db.run("UPDATE sharing_servers SET stopped = NULL WHERE server_id = ?", [serverId]);
      // Unavailable: the list cannot be read (the token file unreadable).
      chmodSync(tokensPath(dataDir), 0o000);
      await open("#settings/servers", has("Servers could not be loaded."), "the unavailable card");
      await capture("settings", "unavailable", "The server list could not be read (here, an unreadable token file): one plain sentence, no error text, no path.");
      chmodSync(tokensPath(dataDir), 0o600);

      // Sharing: one server, then several.
      await open("#settings/sharing", has("Workspace knowledge"), "the Sharing card");
      await waitFor(has("Sending to"), "the server named");
      await capture("settings", "one", "One server listed: the card names it ('Sending to …') and says the file's lists are the ceiling; the switches edit the file's lists as before.");
      addServerTwo();
      await open("#settings/sharing", has("Workspace knowledge"), "the Sharing card");
      await waitFor(`document.querySelector('[role="combobox"], button[aria-haspopup="listbox"]')`, "the server selector");
      await capture("settings", "several", "Two servers listed: the Server selector above the roots picks whose roots and areas the switches edit; the help says the file's lists are the ceiling.");

      // Projects dock: choosing (two servers, widgets unbound), bound (site at Knowledge), receive.
      await open(`#projects/${widgets}`, `[...document.querySelectorAll('[role="radio"]')].length >= 3`, "the widgets dock");
      await waitFor(has("Choose a server"), "the dock's server picker");
      await capture("projects", "choosing", "Two servers and a project bound to none: the dock's Sharing section shows 'Choose a server' above the levels, which stay disabled until one is picked.");
      level(site, serverId, "knowledge");
      await open(`#projects/${site}`, has("Bound to"), "the bound dock");
      await capture("projects", "bound", "The site project bound to the first server at Knowledge: 'Bound to <server>' under the Sharing heading, the row's pill and the dock's label.");
      level(site, serverId, "receive");
      await open(`#projects/${site}`, has("Bound to"), "the receive dock");
      await waitFor(`[...document.querySelectorAll('[role="radio"][aria-checked="true"]')].length === 1`, "the chosen level");
      await capture("projects", "receive", "The site project at Receive only: the radio list with 'Receive only' chosen, bound to the first server; nothing of the project leaves.");
      // Widening: choosing Knowledge and memories on the receive-only project asks first, with
      // the counts (the project's two memories) and the server's name.
      await must(clickLabel("Knowledge and memories"), "the Knowledge and memories radio");
      await waitFor(has("Share more of"), "the widening dialog");
      await capture("projects", "widening", "Choosing Knowledge and memories for a project at Receive only: the dialog counts what would leave (0 knowledge entries and 2 memories of site) for the bound server and asks before anything is sent.");
      await must(clickText("button", "Cancel"), "the dialog's Cancel");
      await waitFor(gone("Share more of"), "the widening dialog closed");
    }
  }
} catch (error) {
  console.log(`capture failed: ${error instanceof Error ? error.message : String(error)}`);
  try {
    const shot = await send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, `failed-step@${width}-${scheme}.png`), Buffer.from(shot.data, "base64"));
    const text = await evaluate<string>("document.body.innerText.slice(0, 2000)");
    writeFileSync(join(outDir, `failed-step@${width}-${scheme}.json`), `${JSON.stringify({ text, console: consoleLog, server: team.lines.slice(-20) }, null, 2)}\n`);
  } catch {}
  await finish(1);
}

const manifest = {
  by: "session",
  method:
    "The session ran the viewer (startUi) and the in-process team server from source in one Bun process over a seeded data directory (two projects with remotes, three memories, one workspace entry at area sales, the env file allowing the workspace root and workspace:sales), and drove Google Chrome in headless mode over the DevTools protocol (probes/capture-part6.ts). Each state was driven again for every viewport and scheme; the joins used invitation codes minted by the test server's admin. PNG screenshots, viewport-sized, motion none.",
  pages: {
    settings: {
      routes: ["/settings#servers", "/settings#sharing"],
      declared: ["empty", "listed", "adding", "confirming", "pending", "error", "stopped", "rejoining", "removing", "resuming", "token-missing", "held", "muted", "unavailable", "one", "several"],
    },
    projects: { route: "/projects", declared: ["bound", "choosing", "receive", "sent", "widening"] },
  },
  viewports: [...WIDTHS],
  schemes: [...SCHEMES],
  motion: "none",
  observations: [
    "The servers' add route answers an expected refusal (a refused code, a URL that is not a server's) as 200 with ok false, and an unreadable server list as 200 with an error field, so the browser's console holds no error line for a state the page shows as a sentence.",
    "Under 640px the Settings shell turns its 200px nav into a select above the cards, so the cards take the width; the Servers card's rows wrap at every width (the name, the state and the actions on the first line, the member and the last sync on the second).",
  ],
  captures: rows,
};
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest: ${rows.length} captures`);
ws.close();
await finish(0);
