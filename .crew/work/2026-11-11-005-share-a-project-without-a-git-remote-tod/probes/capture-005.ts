// The UI evidence of the shared names (AC-43, ADR 0028): every declared state of the /projects
// dock (unnamed, new, joins, taken, not-changed, refused, creating, joining, created, exists,
// removed, more-names, named, named-nothing, remote-too, held, missing, recreated, purged, imported-stay)
// and of /settings#servers (names, flagged, held), at 360, 768 and 1280, light and dark, taken by Google Chrome in headless mode over the DevTools protocol.
// The viewer and the team server run in this process over a seeded data directory; the routes
// are the real ones.
//   ./node_modules/.bin/bun .crew/work/<item>/probes/capture-005.ts <review/ui dir>
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../../../src/core/project.ts";
import type { Redacted } from "../../../../src/core/redact.ts";
import { personAuthor } from "../../../../src/modules/knowledge/author.ts";
import { renderTaxonomy } from "../../../../src/modules/knowledge/entry.ts";
import { openRepo } from "../../../../src/modules/knowledge/repo.ts";
import { openStore } from "../../../../src/modules/knowledge/store-open.ts";
import { setLevel } from "../../../../src/sharing/store.ts";
import { openDb } from "../../../../src/store/db.ts";
import { insertMemory } from "../../../../src/store/memories.ts";
import type { SyncContext } from "../../../../src/sync/context.ts";
import { confirmJoin, joinServer } from "../../../../src/sync/join.ts";
import { readTokens, setContract } from "../../../../src/sync/servers.ts";
import { clearName, flagName } from "../../../../src/sync/state.ts";
import { insertName, purgeName } from "../../../../src/team/store.ts";
import { startUi } from "../../../../src/ui/server.ts";
import { realClock, realTimers } from "../../../../src/util/clock.ts";
import { realGit } from "../../../../tests/helpers/stub-git.ts";
import { api, invite, joinAs, startTestServer } from "../../../../tests/helpers/team.ts";

const [outDir] = process.argv.slice(2) as [string];
if (!outDir) {
  console.log("usage: capture-005.ts <review/ui dir>");
  process.exit(64);
}
mkdirSync(outDir, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9342;
const WIDTHS = [1280, 768, 360] as const;
const SCHEMES = ["dark", "light"] as const;
const HEIGHT = 900;

// --- The seed: a data directory with one remote project and four projects known by their path --
const base = mkdtempSync(join(tmpdir(), "wcm-005-capture-"));
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
const site = (() => {
  const folder = join(home, "work", "site");
  mkdirSync(folder, { recursive: true });
  realGit(folder, "init", "-q");
  realGit(folder, "remote", "add", "origin", "https://github.com/acme/site.git");
  return resolveProject(db, folder, now).id;
})();
/** A project on a plain folder, known by its path alone: no remote, no name yet. */
const pathProject = (name: string): number => {
  const key = `path:${join(home, "work", name)}`;
  const id = db
    .query<{ id: number }, [string, string, number]>("INSERT INTO projects (key, name, created_at) VALUES (?, ?, ?) RETURNING id")
    .get(key, name, now)?.id as number;
  db.run("INSERT INTO project_aliases (alias, project_id) VALUES (?, ?)", [key, id]);
  return id;
};
const wizardingcode = pathProject("wizardingcode");
const brand = pathProject("brand");
const imports = pathProject("imports");
const later = pathProject("later");
const seedMemory = (projectId: number, title: string, body: string, origin: "distilled" | "imported" = "distilled") =>
  insertMemory(db, {
    projectId,
    kind: "decision",
    title,
    body: body as Redacted,
    terms: "",
    importance: 4,
    branch: null,
    commit: null,
    origin,
    judge: origin === "imported" ? "claude-mem" : "heuristic",
    judgeVersion: "1",
    sourceTurnId: null,
    files: [],
    now: now - 3_600_000,
  });
seedMemory(site, "The queue keeps one lease per worker", "A worker holds one lease; a second one waits.");
seedMemory(wizardingcode, "One binary, no daemon", "The hooks and the viewer are one binary.");
seedMemory(wizardingcode, "Retries back off from two seconds", "Doubling to ten minutes, then stays there.");
seedMemory(wizardingcode, "The viewer is loopback only", "A token in the URL; nothing leaves for the network.");
seedMemory(imports, "Imported: the old build pipeline", "From claude-mem.", "imported");
seedMemory(imports, "Imported: the first deploy notes", "From claude-mem.", "imported");
const knowledge = openStore({ db, dataDir, env, now: () => Date.now() });
const workspace = openRepo(knowledge, { scope: "workspace" }, { create: personAuthor(knowledge) });
if (workspace === null) throw new Error("no workspace repository");
writeFileSync(
  join(workspace.path, "taxonomy.md"),
  renderTaxonomy({ version: 2, updated: "2026-11-11T00:00:00Z", areas: [{ id: "sales", label: "Sales" }, { id: "code", label: "Code" }] }),
);
realGit(workspace.path, "add", "-A");
realGit(workspace.path, "-c", "user.name=Ana", "-c", "user.email=ana@example.invalid", "commit", "-qm", "taxonomy");
const ctx: SyncContext = { db, dataDir, storeDir: dataDir, env, fetch: (input, init) => fetch(input, init), clock: realClock, timers: realTimers, pid: process.pid, version: "0", log: () => undefined };

// --- The team server, this device joined to it, a teammate, and the names ------------------------
const team = await startTestServer({}, {});
const joined = await joinServer(ctx, { url: team.server.origin, code: team.code, label: "laptop", name: "Ana" });
if (!joined.ok) throw new Error(`join failed: ${joined.message}`);
confirmJoin(ctx, joined.serverId, "viewer");
const serverId = joined.serverId;
const adminToken = readTokens(dataDir)[serverId] as string;
const bruno = await joinAs(team.server, await invite(team, adminToken, { role: "member", name: "Bruno" }), "bruno-laptop");
const createName = async (token: string, alias: string): Promise<string> => {
  const made = await api(team.server, token, "POST", "/v1/names", { alias });
  if (made.status !== 201) throw new Error(`the name ${alias} was not created: ${made.status}`);
  return (made.body as { id: string }).id;
};
const docsId = await createName(bruno.token, "name:docs");
void docsId;
// A name the operator removed: a create of it is refused `purged`.
await createName(bruno.token, "name:gone");
if (purgeName(team.server.db, "name:gone", Date.now()) !== "purged") throw new Error("gone was not purged");
/** 1,001 names on the server, for the list's cap; removed again after the capture. */
const seedBulk = () => {
  for (let i = 0; i < 1001; i++) {
    insertName(team.server.db, {
      alias: `name:bulk-${String(i).padStart(4, "0")}`,
      id: (0x10000 + i).toString(16).padStart(16, "0"),
      memberId: bruno.memberId,
      deviceId: bruno.deviceId,
      at: Date.now(),
    });
  }
};
const clearBulk = () => team.server.db.run("DELETE FROM names WHERE alias LIKE 'name:bulk-%'");
// The one-round-trip race of the two-phase bind: between the server's create and the write,
// memory is turned off for the project, so the write refuses and the name stays on the server.
let raceProject: number | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await realFetch(input, init);
  const url = String(input instanceof Request ? input.url : input);
  if (raceProject !== null && init?.method === "POST" && url.endsWith("/v1/names")) {
    db.run("UPDATE projects SET disabled = 1 WHERE id = ?", [raceProject]);
    raceProject = null;
  }
  return response;
}) as typeof fetch;
const brandId = await createName(adminToken, "name:brand");
const importsId = await createName(adminToken, "name:imports");
const laterId = await createName(adminToken, "name:later");
const bind = (projectId: number, alias: string, nameId: string, level: "receive" | "knowledge" | "all") => {
  const out = setLevel(db, { projectId, destination: serverId, level, source: "viewer", now: Date.now(), confirm: true, as: alias, nameId });
  if (!out.ok) throw new Error(`setLevel ${alias}: ${out.reason}`);
};
const unbind = (projectId: number) => {
  const out = setLevel(db, { projectId, destination: serverId, level: "local", source: "viewer", now: Date.now(), confirm: true });
  if (!out.ok) throw new Error(`setLevel local: ${out.reason}`);
};
bind(brand, "name:brand", brandId, "knowledge");
bind(imports, "name:imports", importsId, "all");
bind(later, "name:later", laterId, "knowledge");
// Journey 5: the named project gained a git remote since; the next session recorded its alias.
db.run("INSERT INTO project_aliases (alias, project_id) VALUES ('remote:github.com/acme/later', ?)", [later]);

const viewer = await startUi({ dataDir, homeDir: join(base, "brand-home"), port: 0, open: false, env, spawn: () => undefined });
const serverName = team.server.origin.replace(/^https?:\/\//, "");
void serverName;

// --- Chrome over the DevTools protocol ------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), "wcm-005-chrome-"));
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
const clickText = (selector: string, text: string) =>
  evaluate<boolean>(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
/** Clicks the label of a radio or a switch by its exact text. */
const clickLabel = (text: string) =>
  evaluate<boolean>(`(() => { const el = [...document.querySelectorAll("label")].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
/** Clicks the option of the open list that is the text, or the create item that quotes it. */
const clickOption = (text: string) =>
  evaluate<boolean>(`(() => { const quoted = ${JSON.stringify(text)}; const el = [...document.querySelectorAll('[role="option"]')].find((e) => e.textContent.trim() === quoted || e.textContent.includes('"' + quoted + '"') || e.textContent.includes('“' + quoted + '”')); if (!el) return false; el.click(); return true; })()`);
/** Leaves the field after a pick, so its list closes and the sentence under it is in the capture. */
const closeList = async () => {
  // Escape, as a person closes the list; the name picked stays in the field.
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await waitFor(`document.querySelectorAll('[role="option"]').length === 0`, "the field's list closed");
  await settle();
};
const must = async (ok: Promise<boolean>, what: string) => {
  if (!(await ok)) throw new Error(`not found: ${what}`);
};
const FIELD = 'section[aria-label="Sharing"] input[role="combobox"]';
/** Types a shared name into the dock's field as a person does: the field focused, its text replaced. */
const typeName = async (text: string) => {
  await must(evaluate<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(FIELD)}); if (!el) return false; el.focus(); el.select(); return true; })()`), "the Shared name field");
  await send("Input.insertText", { text });
  await sleep(300);
};
const open = async (hash: string, predicate: string, what: string) => {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await send("Page.navigate", { url: `${viewer.origin}/?token=${viewer.token}&theme=${scheme}${hash}` });
  await waitFor(predicate, what);
  await settle();
};
const dock = (id: number, predicate: string, what: string) => open(`#projects/${id}`, predicate, what);

try {
  for (scheme of SCHEMES) {
    for (width of WIDTHS) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: HEIGHT, deviceScaleFactor: 1, mobile: width < 700 });
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });

      // Unnamed: the dock of a project with no remote, the field prefilled, the levels enabled.
      await dock(wizardingcode, has("New: you create"), "the unnamed dock");
      await capture("projects", "unnamed", "A project known by its folder alone: the Sharing section shows the 'Shared name' field prefilled with the project's slug, the sentence 'New: you create `wizardingcode` on <server>' from the preview route, and the levels enabled.");
      // New: another name the server does not hold.
      await typeName("docs-mobile");
      await waitFor(`[...document.querySelectorAll('[role="option"]')].length > 0`, "the field's list");
      await must(clickOption("docs-mobile"), "the create item for docs-mobile");
      await waitFor(has("New: you create `docs-mobile`"), "the New sentence for docs-mobile");
      await closeList();
      await capture("projects", "new", "A name typed that the server does not hold: the list offers to create it, and the sentence reads 'New: you create `docs-mobile` on <server>'; choosing a level will ask to create it.");
      // Joins: a name a teammate created, picked from the list.
      await typeName("docs");
      await waitFor(`[...document.querySelectorAll('[role="option"]')].some((o) => o.textContent.trim() === "docs")`, "the docs option");
      await must(clickOption("docs"), "the docs option");
      await waitFor(has("Joins `docs` · created by Bruno"), "the Joins sentence");
      await closeList();
      await capture("projects", "joins", "A name picked from the server's list: the sentence reads 'Joins `docs` · created by Bruno · 0 entries, 0 memories' before anything is written; choosing a level will ask to join it.");
      // Joining: the join confirmation at Receive only.
      await must(clickLabel("Receive only"), "the Receive only radio");
      await waitFor(has("Join and share"), "the join confirmation");
      await capture("projects", "joining", "Receive only chosen under a teammate's name: the confirmation 'Join a shared name?' reads 'Join `docs`, created by Bruno (0 entries, 0 memories), and receive it into wizardingcode? Nothing of wizardingcode leaves.'; the action is 'Join and share'.");
      await must(clickText("button", "Cancel"), "the confirmation's Cancel");
      await waitFor(gone("Join and share"), "the join confirmation closed");
      // Taken: a name another project on this machine carries.
      await typeName("brand");
      await waitFor(`[...document.querySelectorAll('[role="option"]')].length > 0`, "the field's list");
      await must(clickOption("brand"), "the brand option");
      await waitFor(has("This name is `brand`'s on this machine"), "the collision sentence");
      await closeList();
      await capture("projects", "taken", "A name another project on this machine carries: 'This name is `brand`'s on this machine', decided here without a request; the levels stay as they were.");
      // Not changed: a level chosen under the taken name.
      await must(clickLabel("Knowledge"), "the Knowledge radio");
      await waitFor(has("Not changed"), "the Not changed toast");
      await capture("projects", "not-changed", "Knowledge chosen while the field holds a name another project here carries: the toast 'Not changed' with the collision sentence; nothing is asked of the server and the level stays Nothing.");
      await waitFor(gone("Not changed"), "the toast gone", 20000);
      // Refused: a text that makes no name.
      await typeName("!!!");
      await waitFor(`[...document.querySelectorAll('[role="option"]')].length > 0`, "the field's list");
      await must(clickOption("!!!"), "the create item for !!!");
      await waitFor(has("No shared name can be made of that"), "the refused sentence");
      await closeList();
      await capture("projects", "refused", "A text with no letter or digit: 'No shared name can be made of that: use letters or digits.' under the field, decided here without a request; the levels are disabled while no name is held.");
      // Removed: a name the operator purged, chosen as new and refused at the confirmation.
      await typeName("gone");
      await waitFor(`[...document.querySelectorAll('[role="option"]')].length > 0`, "the field's list");
      await must(clickOption("gone"), "the create item for gone");
      await waitFor(has("New: you create `gone`"), "the New sentence for gone");
      await closeList();
      await must(clickLabel("Receive only"), "the Receive only radio");
      await waitFor(has("Create and share"), "the create confirmation for gone");
      await must(clickText("button", "Create and share"), "the Create and share button");
      await waitFor(has("the operator removed `gone`"), "the removed sentence");
      await capture("projects", "removed", "The server refused the create with `purged` (the operator removed that name): 'Removed: the operator removed `gone` from <server>; pick another name.' under the field; nothing was written.");
      // Created: the one-round-trip race, the name created and the write refused.
      const raceName = `race-${scheme}-${width}`;
      await typeName(raceName);
      await waitFor(`[...document.querySelectorAll('[role="option"]')].length > 0`, "the field's list");
      await must(clickOption(raceName), `the create item for ${raceName}`);
      await waitFor(has(`New: you create \`${raceName}\``), "the New sentence for the race name");
      await closeList();
      raceProject = wizardingcode;
      await must(clickLabel("Knowledge"), "the Knowledge radio");
      await waitFor(has("Create and share"), "the create confirmation for the race name");
      await must(clickText("button", "Create and share"), "the Create and share button");
      await waitFor(has("was created on the server; set the level again to use it"), "the created-name sentence");
      await capture("projects", "created", "The race between the server's create and the write (memory turned off for the project in between): the refusal's sentence followed by 'the name `<slug>` was created on the server; set the level again to use it, or the operator purges it' under the field; the name is in the list.");
      db.run("UPDATE projects SET disabled = 0 WHERE id = ?", [wizardingcode]);
      // Exists: a teammate created the same name between the list and the yes (journey 3).
      const takenName = `taken-${scheme}-${width}`;
      await dock(wizardingcode, has("New: you create"), "the unnamed dock for the exists state");
      await typeName(takenName);
      await waitFor(`[...document.querySelectorAll('[role="option"]')].length > 0`, "the field's list");
      await must(clickOption(takenName), `the create item for ${takenName}`);
      await waitFor(has(`New: you create \`${takenName}\``), "the New sentence for the taken name");
      await closeList();
      await must(clickLabel("Receive only"), "the Receive only radio");
      await waitFor(has("Create and share"), "the create confirmation for the taken name");
      await createName(bruno.token, `name:${takenName}`);
      await must(clickText("button", "Create and share"), "the Create and share button");
      await waitFor(has("Join and share"), "the join confirmation after exists");
      await capture("projects", "exists", "The server answered 409 exists after 'Create and share' (Bruno created the same name between the list and the yes): the dock shows the join sentence 'Joins `<slug>` · created by Bruno · 0 entries, 0 memories' under the field and reopens the confirmation as a join, 'Join and share'; nothing was written.");
      await must(clickText("button", "Cancel"), "the join confirmation's Cancel");
      await waitFor(gone("Join and share"), "the join confirmation closed");
      // More names: the server holds more than the list carries.
      seedBulk();
      await dock(wizardingcode, has("The list shows the first 1,000 names."), "the dock with the capped list");
      await capture("projects", "more-names", "A server with more than 1,000 names: 'The list shows the first 1,000 names.' under the field; a name past the cap is typed and read as New until the server answers.");
      clearBulk();
      // Creating: the create confirmation at Knowledge and memories, with the counts.
      await dock(wizardingcode, has("New: you create"), "the unnamed dock again");
      await must(clickLabel("Knowledge and memories"), "the Knowledge and memories radio");
      await waitFor(has("Create and share"), "the create confirmation");
      await capture("projects", "creating", "Knowledge and memories chosen under a new name: the confirmation 'Create a shared name?' reads 'Create `wizardingcode` on <server>, visible to every member, and share knowledge and memories of wizardingcode as it? 0 knowledge entries and 3 memories would leave.'; the action is 'Create and share'.");
      await must(clickText("button", "Cancel"), "the confirmation's Cancel");
      await waitFor(gone("Create and share"), "the create confirmation closed");

      // Named: bound under its name.
      await dock(brand, has("Shared as"), "the named dock");
      await capture("projects", "named", "A project bound under its shared name: 'Shared as `brand`.' and 'Set Nothing to leave this name.' in place of the field; the row's pill and the dock's label read Knowledge.");
      // Named at Nothing: the field with the carried name, and Forget name.
      unbind(brand);
      await dock(brand, has("Forget name"), "the named dock at Nothing");
      await capture("projects", "named-nothing", "The same project set to Nothing: it keeps its name, the field shows `brand` again, and 'Forget name' removes it; a level set again joins the name.");
      bind(brand, "name:brand", brandId, "knowledge");
      // Remote too: a named project that gained a git remote.
      await dock(later, has("This project now has a git remote"), "the remote-too dock");
      await capture("projects", "remote-too", "A named project that gained a git remote since: 'Shared as `later`. This project now has a git remote; to match by the remote instead, set Nothing, forget the name, then set the level again.'");
      // Held: the server speaks contract 1.
      setContract(db, serverId, 1);
      await dock(wizardingcode, has("The server speaks contract 1; shared names need its upgrade."), "the held dock");
      await capture("projects", "held", "The server speaks contract 1: the 'Shared name' field is disabled with 'The server speaks contract 1; shared names need its upgrade.', and the levels stay disabled for a project with no remote.");
      setContract(db, serverId, 2);
      // Missing, re-created, purged: the three flags of a bound name.
      flagName(ctx, serverId, "name:brand", "missing");
      await dock(brand, has("the server does not hold"), "the missing dock");
      await capture("projects", "missing", "The server no longer holds the bound name (a push was refused `name`): 'Missing: the server does not hold `brand`; set the level again to create or join it.'");
      clearName(ctx, serverId, "name:brand");
      flagName(ctx, serverId, "name:brand", "recreated", { id: "0123456789abcdef", member: { id: bruno.memberId, name: "Bruno" } });
      await dock(brand, has("was re-created on the server by Bruno"), "the re-created dock");
      await capture("projects", "recreated", "The name was re-created on the server under another id (journey 7): 'The shared name `brand` was re-created on the server by Bruno; join it again, or set Nothing to leave it.'");
      clearName(ctx, serverId, "name:brand");
      flagName(ctx, serverId, "name:brand", "purged");
      await dock(brand, has("the operator removed"), "the purged dock");
      await capture("projects", "purged", "The operator purged the name: 'Removed: the operator removed `brand` from the server; set Nothing to leave it.'");
      clearName(ctx, serverId, "name:brand");
      // Imported memories stay.
      await dock(imports, has("imported memories stay on this machine."), "the imported dock");
      await capture("projects", "imported-stay", "A project at Knowledge and memories with imported memories: '2 imported memories stay on this machine.' under the levels (D-6); they never leave, whatever the level.");

      // Servers: the bound names under the server, then flagged, then held.
      await open("#settings/servers", has("memories received"), "the Servers card with names");
      await capture("settings", "names", "The server row lists the shared names bound from this machine: '<slug> · 0 entries, 0 memories received · 0 members · last never', one line per name.");
      flagName(ctx, serverId, "name:brand", "missing");
      flagName(ctx, serverId, "name:imports", "recreated", { id: "0123456789abcdef", member: { id: bruno.memberId, name: "Bruno" } });
      flagName(ctx, serverId, "name:later", "purged");
      await open("#settings/servers", has("removed by the operator"), "the Servers card with flagged names");
      await capture("settings", "flagged", "The three states a bound name can carry, one per line: '· missing on the server', '· re-created by Bruno', '· removed by the operator' after the name's counts.");
      for (const alias of ["name:brand", "name:imports", "name:later"]) clearName(ctx, serverId, alias);
      setContract(db, serverId, 1);
      await open("#settings/servers", has("Shared names are held: the server speaks contract 1. Upgrade it first."), "the held Servers card");
      await capture("settings", "held", "The server speaks contract 1 with names bound: 'Shared names are held: the server speaks contract 1. Upgrade it first.' above the names' lines; nothing of those projects moves until the upgrade.");
      setContract(db, serverId, 2);
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
    "The session ran the viewer (startUi) and the in-process team server from source in one Bun process over a seeded data directory (one project with a remote, four known by their folder: wizardingcode with three memories and no name, brand bound under name:brand, imports bound under name:imports at Knowledge and memories with two imported memories, later bound under name:later and given a remote alias since; a teammate Bruno who created name:docs and name:gone, the latter purged by the operator, and who creates one name per pass for the exists state), and drove Google Chrome in headless mode over the DevTools protocol (probes/capture-005.ts). Each state was driven again for every viewport and scheme; the names were typed into the field and picked from its list as a person does. PNG screenshots, viewport-sized, motion none.",
  pages: {
    projects: {
      route: "/projects",
      declared: ["unnamed", "new", "joins", "taken", "not-changed", "refused", "creating", "joining", "created", "exists", "removed", "more-names", "named", "named-nothing", "remote-too", "held", "missing", "recreated", "purged", "imported-stay"],
    },
    settings: { routes: ["/settings#servers"], declared: ["names", "flagged", "held"] },
  },
  viewports: [...WIDTHS],
  schemes: [...SCHEMES],
  motion: "none",
  observations: [
    "The field's sentence is asked for when the field settles (a pick, the create item, or the field left), never per keystroke; a text that makes no name and a name another project here carries are decided in the page without a request, so the console holds no refused request for them.",
    "The two confirmations (create, join) are the dock's Confirm dialog with a short title ('Create a shared name?', 'Join a shared name?'), the question, the would-leave line and the imported line as the body, and 'Create and share' or 'Join and share' as the action.",
    "The created state is the one-round-trip race of the two-phase bind, driven by the probe: memory is turned off for the project between the server's create and the write, so the write refuses and the dock shows the created-name sentence; the race name differs per viewport and scheme (one create each), and the project is re-enabled after the capture.",
    "The more-names state seeds 1,001 names on the server for its capture alone and removes them after it; the other dock states read the server's four or five names.",
    "The exists state is journey 3 driven by the probe: the teammate creates the same name on the server after the confirmation opened and before the yes; the name differs per viewport and scheme (one create each by the teammate).",
    "The consoles of the created, exists and removed states each hold one browser line per capture, 'Failed to load resource: 409', from PUT /api/projects/<id>/sharing: the route answers a refusal the person reads as a sentence (409 exists, purged, or a write refused after a create) with the status the specification and the route tests pin, so the browser logs the status; the dock switches on the body's reason and shows the sentence. No other state logs anything.",
  ],
  captures: rows,
};
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest: ${rows.length} captures`);
ws.close();
await finish(0);
