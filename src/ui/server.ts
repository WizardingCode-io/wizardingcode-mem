import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { lastBackup, restoreBackup, runBackup } from "../backup/backup.ts";
import { backupDue } from "../backup/schedule.ts";
import { targetFor } from "../backup/target.ts";
import { claudeCodeRoot } from "../adapters/claude-code/history.ts";
import { codexRoot } from "../adapters/codex/history.ts";
import { runChecks } from "../doctor/checks.ts";
import { doctorContext } from "../doctor/context.ts";
import { previewReplaceImports, replaceAllImports, restoreImports } from "../backfill/replace.ts";
import { openHistoryDb } from "../history/db.ts";
import { forgetHistoryIndex } from "../history/run-state.ts";
import { historyReadFailure, recentHistory, searchHistory } from "../history/search.ts";
import { HISTORY_LEASE, HISTORY_OFFER_DISMISSED, historyProgress, historyStatus } from "../history/status.ts";
import { loadSettings, publicSettings, saveSettings, validatePatch } from "../settings/settings.ts";
import { statusReport } from "../status/report.ts";
import { compact } from "../store/compact.ts";
import { DB_FILE, type Db, openDb } from "../store/db.ts";
import { drainActive, leaseActive, setMeta } from "../store/meta.ts";
import { inspectTarget, moveStore } from "../store/move.ts";
import { logError } from "../util/log.ts";
import { storeDirOf } from "../util/paths.ts";
import { spawnDetached } from "../util/self.ts";
import { clearUiState, writeUiState } from "./state.ts";
import {
  getMemory,
  getTurn,
  listMemories,
  listProjects,
  projectRef,
  projectStats,
  recentTurns,
  searchAll,
  setMemoryStatus,
  updateMemory,
} from "./api.ts";
import instrumentSans from "./assets/instrument-sans-variable.woff2" with { type: "file" };
import jetbrainsMono from "./assets/jetbrains-mono-variable.woff2" with { type: "file" };
import unbounded from "./assets/unbounded-variable.woff2" with { type: "file" };
import page from "./dist/index.html" with { type: "text" };

// The viewer: a local page over the database. Loopback only, a token in the URL that
// every request must carry, the Host header checked, and it stops itself when idle.
// Nothing is loaded from the network: the app (built by Vite into src/ui/dist), the
// fonts and the logo travel in the binary.

export interface UiOptions {
  dataDir: string;
  /** 0 picks a free port. */
  port?: number;
  /** Open the browser on start. */
  open?: boolean;
  now?: () => number;
  /** Without a request for this long, the server stops. */
  idleMs?: number;
  onIdle?: () => void;
  /** The environment the settings are read against; tests pass their own. */
  env?: Record<string, string | undefined>;
  /** How the browser is opened; tests count instead. */
  openBrowser?: (url: string) => void;
  /** Refuse to start when another viewer is already on record (see `UiClaimedError`). */
  exclusive?: boolean;
  /** How a background run is started (`history import`, ...); tests record instead. */
  spawn?: (...args: string[]) => void;
}

/** Thrown by an exclusive start that lost the race to another viewer. */
export class UiClaimedError extends Error {
  constructor() {
    super("another viewer is already on record");
  }
}

/** A tab that pinged this recently is there; opening another would duplicate it. */
const TAB_ALIVE_MS = 90_000;
/** Two sessions starting together must not open two tabs. */
const REOPEN_GUARD_MS = 10_000;

export interface UiServer {
  origin: string;
  /** The page's address, token included. */
  url: string;
  token: string;
  stop(): Promise<void>;
}

const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const FONTS: Record<string, string> = {
  "unbounded-variable.woff2": unbounded,
  "instrument-sans-variable.woff2": instrumentSans,
  "jetbrains-mono-variable.woff2": jetbrainsMono,
};

/**
 * The page's Content-Security-Policy: every load stays on this origin (images and fonts
 * may also be `data:`), so nothing a transcript contains can reach the network. The two
 * inline scripts of the single-file build run by their hashes; styles are inline too,
 * and Vue and Nuxt UI set some at run time.
 */
export function pageCsp(html: string): string {
  const hashes = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) => `'sha256-${new Bun.CryptoHasher("sha256").update(match[1] ?? "").digest("base64")}'`,
  );
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
const PAGE_CSP = pageCsp(page as unknown as string);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const problem = (status: number, detail: string) => json({ error: detail }, status);

/** Sessions seen in the last five minutes: a move is best done between them. */
function recentSessionCount(db: Db, now: number): number {
  return (
    db
      .query<{ n: number }, [number]>("SELECT count(*) AS n FROM sessions WHERE last_seen_at > ?")
      .get(now - 5 * 60_000)?.n ?? 0
  );
}

/** A JSON object from the request, or the 400 to answer with. */
async function jsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "body must be JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return problem(400, "body must be an object");
  }
  return body as Record<string, unknown>;
}

/** Opens the page in the user's browser; `WIZARDINGCODE_MEM_UI_BROWSER=none` keeps it closed. */
export function openBrowser(url: string): void {
  if (process.env.WIZARDINGCODE_MEM_UI_BROWSER === "none") return;
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
  } catch {
    // The URL is printed anyway.
  }
}

export async function startUi(options: UiOptions): Promise<UiServer> {
  const token = randomBytes(16).toString("hex");
  const now = options.now ?? Date.now;
  const env = options.env ?? process.env;
  // The database may move while the server runs (Storage settings): `db` is reopened.
  let storeDir = storeDirOf(options.dataDir, env);
  let db: Db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const open = options.openBrowser ?? openBrowser;
  const spawn = options.spawn ?? spawnDetached;
  const historyRunning = () => leaseActive(db, HISTORY_LEASE, now());
  // When a tab last said it was there, and when a browser was last opened.
  let lastPingAt: number | null = null;
  let openedAt: number | null = null;
  // The page's own address, known once the port is.
  let pageUrl = "";

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    await server.stop(true);
    db.close();
    clearUiState(options.dataDir, process.pid);
  };
  const touch = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      options.onIdle?.();
      void stop();
    }, idleMs);
    idleTimer.unref?.();
  };

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;
    const host = request.headers.get("host") ?? "";
    if (host !== `127.0.0.1:${server.port}` && host !== `localhost:${server.port}`) {
      return problem(403, "wrong host");
    }
    // Fonts are served without the token: a browser cannot add one to a font request,
    // and they are the brand's, not the user's data.
    if (request.method === "GET" && path.startsWith("/assets/")) {
      const font = FONTS[path.slice("/assets/".length)];
      if (font === undefined) return problem(404, "no such asset");
      touch();
      return new Response(Bun.file(font), {
        headers: { "content-type": "font/woff2", "cache-control": "private, max-age=86400" },
      });
    }
    const presented =
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      url.searchParams.get("token");
    if (presented !== token) return problem(401, "missing or wrong token");
    touch();

    if (request.method === "GET" && path === "/") {
      return new Response(page as unknown as string, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": PAGE_CSP,
        },
      });
    }
    // Presence: who is here, a tab's heartbeat, and whether to open a browser.
    if (path === "/api/ping" && request.method === "GET") {
      return json({ pid: process.pid, lastPingAt });
    }
    if (path === "/api/ping" && request.method === "POST") {
      lastPingAt = now();
      return new Response(null, { status: 204 });
    }
    if (path === "/api/bye" && request.method === "POST") {
      lastPingAt = null;
      return new Response(null, { status: 204 });
    }
    if (path === "/api/open" && request.method === "POST") {
      const at = now();
      if (lastPingAt !== null && at - lastPingAt < TAB_ALIVE_MS) {
        return json({ opened: false, reason: "tab" });
      }
      if (openedAt !== null && at - openedAt < REOPEN_GUARD_MS) {
        return json({ opened: false, reason: "recent" });
      }
      openedAt = at;
      open(pageUrl);
      return json({ opened: true });
    }
    if (path === "/api/overview" && request.method === "GET") {
      return json({ version: pkg.version, dataDir: options.dataDir, storeDir, projects: listProjects(db) });
    }
    // Backups: the target the settings name, what is there, a copy now, and the way back.
    if (path === "/api/backups" && request.method === "GET") {
      const settings = loadSettings(env, options.dataDir);
      const target = targetFor(settings);
      if (target === null) return json({ target: null, last: null, due: false, entries: [] });
      let entries: unknown = [];
      let error: string | undefined;
      try {
        entries = await target.list();
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      }
      return json({
        target: { kind: target.kind, label: target.label },
        last: lastBackup(db),
        due: backupDue(db, settings.backup.everyHours, now()),
        entries,
        ...(error === undefined ? {} : { error }),
      });
    }
    if (path === "/api/backups" && request.method === "POST") {
      const settings = loadSettings(env, options.dataDir);
      const target = targetFor(settings);
      if (target === null) return problem(400, "no backup target is configured");
      const outcome = await runBackup({
        db,
        storeDir,
        target,
        keep: settings.backup.keep,
        now: now(),
        owner: `ui-${process.pid}`,
      });
      return json(outcome, outcome.ok ? 200 : outcome.reason === "busy" ? 409 : 400);
    }
    if (path === "/api/backups/test" && request.method === "POST") {
      const target = targetFor(loadSettings(env, options.dataDir));
      if (target === null) return problem(400, "no backup target is configured");
      try {
        const entries = await target.list();
        return json({ ok: true, label: target.label, entries: entries.length });
      } catch (failure) {
        return json({ ok: false, label: target.label, detail: failure instanceof Error ? failure.message : String(failure) });
      }
    }
    if (path === "/api/backups/restore" && request.method === "POST") {
      const body = await jsonObject(request);
      if (body instanceof Response) return body;
      if (typeof body.name !== "string") return problem(400, "name is required");
      if (body.confirm !== true) return problem(400, "confirm: true is required to restore a backup");
      const target = targetFor(loadSettings(env, options.dataDir));
      if (target === null) return problem(400, "no backup target is configured");
      db.close();
      try {
        const outcome = await restoreBackup({ storeDir, target, name: body.name, now: now() });
        return json(outcome, outcome.ok ? 200 : outcome.reason === "busy" ? 409 : 400);
      } finally {
        db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
      }
    }
    // Storage: where the database is, and moving it somewhere else.
    if (path === "/api/storage" && request.method === "GET") {
      let dbBytes = 0;
      try {
        dbBytes = statSync(join(storeDir, DB_FILE)).size;
      } catch {
        // No file yet.
      }
      return json({
        dataDir: options.dataDir,
        storeDir,
        dbBytes,
        busy: drainActive(db, now()),
        recentSessions: recentSessionCount(db, now()),
      });
    }
    if (path === "/api/storage/inspect" && request.method === "POST") {
      const body = await jsonObject(request);
      if (body instanceof Response) return body;
      if (typeof body.path !== "string" || body.path.trim() === "") return problem(400, "path is required");
      return json(inspectTarget(body.path.trim()));
    }
    if (path === "/api/storage/move" && request.method === "POST") {
      const body = await jsonObject(request);
      if (body instanceof Response) return body;
      if (typeof body.path !== "string" || body.path.trim() === "") return problem(400, "path is required");
      if (body.confirm !== true) return problem(400, "confirm: true is required to move the store");
      const to = body.path.trim();
      // Our own connection must not hold the file while it is renamed.
      db.close();
      try {
        const outcome = await moveStore({ dataDir: options.dataDir, from: storeDir, to, now: now() });
        if (outcome.ok) storeDir = outcome.to;
        return json(outcome, outcome.ok ? 200 : outcome.reason === "busy" ? 409 : 400);
      } finally {
        db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
      }
    }
    // Settings: the file in the data directory, shown with sources, secrets as fingerprints.
    if (path === "/api/settings" && request.method === "GET") {
      return json({ dataDir: options.dataDir, settings: publicSettings(env, options.dataDir) });
    }
    if (path === "/api/settings" && request.method === "PUT") {
      const body = await jsonObject(request);
      if (body instanceof Response) return body;
      const validated = validatePatch(body);
      if (!validated.ok) {
        return json({ error: "some settings could not be saved", errors: validated.errors }, 400);
      }
      saveSettings(options.dataDir, validated.changes);
      return json({ dataDir: options.dataDir, settings: publicSettings(env, options.dataDir) });
    }
    if (path === "/api/doctor" && request.method === "GET") {
      return json(runChecks(doctorContext(options.dataDir, now())));
    }
    if (path === "/api/compact" && request.method === "POST") {
      const body = await jsonObject(request);
      if (body instanceof Response) return body;
      const dryRun = body.dryRun === true;
      const { retentionDays, historyDays } = loadSettings(env, options.dataDir);
      return json(compact(db, { now: now(), dryRun, retentionDays, historyDays }));
    }
    if (path === "/api/memories" && request.method === "GET") {
      const projectId = Number(url.searchParams.get("project"));
      if (!Number.isInteger(projectId)) return problem(400, "project is required");
      const number = (name: string) => {
        const value = url.searchParams.get(name);
        return value === null ? undefined : Number(value);
      };
      return json(
        listMemories(db, {
          projectId,
          q: url.searchParams.get("q") ?? undefined,
          kind: url.searchParams.get("kind") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          minImportance: number("minImportance"),
          limit: number("limit"),
          offset: number("offset"),
        }),
      );
    }
    const one = /^\/api\/memories\/(\d+)$/.exec(path);
    if (one !== null) {
      const id = Number(one[1]);
      if (request.method === "GET") {
        const memory = getMemory(db, id);
        return memory === null ? problem(404, "no such memory") : json(memory);
      }
      if (request.method === "POST" || request.method === "PATCH") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return problem(400, "body must be JSON");
        }
        if (body === null || typeof body !== "object")
          return problem(400, "body must be an object");
        if (request.method === "PATCH") {
          const outcome = updateMemory(db, id, body as Parameters<typeof updateMemory>[2], now());
          if (outcome === "ok") return json(getMemory(db, id));
          if (outcome === "not-found") return problem(404, "no such memory");
          return problem(
            400,
            "only title, body, kind (one of ours) and importance (1–5) can change; a superseded memory cannot",
          );
        }
        const status = (body as { status?: unknown }).status;
        if (typeof status !== "string") return problem(400, "status is required");
        const outcome = setMemoryStatus(db, id, status, now());
        if (outcome === "ok") return json(getMemory(db, id));
        if (outcome === "not-found") return problem(404, "no such memory");
        return problem(400, "a memory can only be archived or made active again");
      }
    }
    const oneTurn = /^\/api\/turns\/(\d+)$/.exec(path);
    if (oneTurn !== null && request.method === "GET") {
      const turn = getTurn(db, Number(oneTurn[1]));
      return turn === null ? problem(404, "no such turn") : json(turn);
    }
    const stats = /^\/api\/projects\/(\d+)\/stats$/.exec(path);
    if (stats !== null && request.method === "GET") {
      const found = projectStats(db, Number(stats[1]), now());
      return found === null ? problem(404, "no such project") : json(found);
    }
    if (path === "/api/search" && request.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      return json(
        searchAll(db, url.searchParams.get("q") ?? "", Number.isFinite(limit) ? limit : 20),
      );
    }
    if (path === "/api/status" && request.method === "GET") {
      const projectId = Number(url.searchParams.get("project"));
      const project = Number.isInteger(projectId) ? projectRef(db, projectId) : null;
      return json(statusReport(db, project, options.dataDir));
    }
    if (path === "/api/history" && request.method === "GET") {
      return json(
        historyStatus(
          db,
          storeDir,
          { claudeCode: claudeCodeRoot(env), codex: codexRoot(env) },
          now(),
        ),
      );
    }
    // Past conversations: the history index, read only and never created here.
    if (path === "/api/history/search" && request.method === "GET") {
      const q = (url.searchParams.get("q") ?? "").trim();
      const projectParam = url.searchParams.get("project");
      const projectId = projectParam === null || projectParam === "" ? undefined : Number(projectParam);
      if (projectId !== undefined && !Number.isInteger(projectId)) return problem(400, "project must be an id");
      const limitParam = Number(url.searchParams.get("limit") ?? Number.NaN);
      const limit = Number.isFinite(limitParam) ? limitParam : undefined;
      let hdb: ReturnType<typeof openHistoryDb> = null;
      try {
        hdb = openHistoryDb(storeDir, { create: false, busyTimeoutMs: 2000 });
        if (hdb === null) return json({ indexed: false });
        const hits =
          q === "" ? recentHistory(hdb, { projectId, limit }) : searchHistory(hdb, { query: q, projectId, limit });
        return json({ indexed: true, hits });
      } catch (error) {
        logError("ui history search", error, options.dataDir);
        return json({ indexed: true, hits: [], error: historyReadFailure(error) });
      } finally {
        hdb?.close();
      }
    }
    if (path === "/api/history/progress" && request.method === "GET") {
      return json(historyProgress(db, now()));
    }
    if ((path === "/api/history/import" || path === "/api/history/index") && request.method === "POST") {
      if (historyRunning()) return json({ started: false });
      spawn("history", path.slice("/api/history/".length));
      return json({ started: true });
    }
    if (path === "/api/history/forget" && request.method === "POST") {
      if (historyRunning()) return problem(409, "a history run is going; wait for it to finish");
      forgetHistoryIndex(storeDir);
      return json({ forgotten: true });
    }
    if (path === "/api/history/replace-imports" && request.method === "POST") {
      const body = await jsonObject(request);
      if (body instanceof Response) return body;
      if (typeof body.expected !== "number") return problem(400, "expected is required");
      const count = previewReplaceImports(db);
      if (body.expected !== count) return json({ count }, 409);
      return json(replaceAllImports(db, { now: now() }));
    }
    if (path === "/api/history/restore-imports" && request.method === "POST") {
      return json({ restored: restoreImports(db) });
    }
    if (path === "/api/history/offer/dismiss" && request.method === "POST") {
      setMeta(db, HISTORY_OFFER_DISMISSED, "1");
      return json({ dismissed: true });
    }
    if (path === "/api/turns" && request.method === "GET") {
      const projectId = Number(url.searchParams.get("project"));
      if (!Number.isInteger(projectId)) return problem(400, "project is required");
      return json(recentTurns(db, projectId, Number(url.searchParams.get("limit") ?? 50)));
    }
    return problem(404, "not found");
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    async fetch(request) {
      try {
        return await handle(request);
      } catch (error) {
        logError("ui", error, options.dataDir);
        return problem(500, error instanceof Error ? error.message : String(error));
      }
    },
  });
  touch();

  const origin = `http://127.0.0.1:${server.port}`;
  const url = `${origin}/?token=${token}`;
  pageUrl = url;
  const recorded = writeUiState(
    options.dataDir,
    { pid: process.pid, origin, token, startedAt: now() },
    options.exclusive ?? false,
  );
  if (!recorded) {
    await stop();
    throw new UiClaimedError();
  }
  if (options.open) {
    openedAt = now();
    open(url);
  }
  return { origin, url, token, stop };
}
