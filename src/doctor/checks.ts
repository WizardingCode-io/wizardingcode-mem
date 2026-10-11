import { Database } from "bun:sqlite";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lastBackup } from "../backup/schedule.ts";
import { ANTIGRAVITY } from "../install/antigravity.ts";
import { CLAUDE_CODE } from "../install/claude-code.ts";
import { claudeDesktopServer, hasClaudeDesktop } from "../install/claude-desktop.ts";
import { CODEX } from "../install/codex.ts";
import { COPILOT } from "../install/copilot.ts";
import { CURSOR } from "../install/cursor.ts";
import { DROID } from "../install/droid.ts";
import { GEMINI } from "../install/gemini.ts";
import { type HostSpec, inspectHooksFile } from "../install/hooks-file.ts";
import { findLegacyPlugins } from "../install/legacy-plugins.ts";
import { PLUGIN_MARKER } from "../install/opencode-plugin.ts";
import { QWEN } from "../install/qwen.ts";
import { Breaker } from "../judge/breaker.ts";
import { keyFingerprint } from "../judge/key.ts";
import { loadSettings } from "../settings/settings.ts";
import { hookLatency } from "../status/report.ts";
import { DB_FILE, type Db, LATEST_VERSION, openExisting, SchemaTooNewError } from "../store/db.ts";
import { inspectTarget } from "../store/move.ts";

export interface Check {
  name: string;
  status: "ok" | "warn" | "fail" | "skip";
  detail: string;
}

export interface DoctorContext {
  dataDir: string;
  /** Where the database is: the data directory, unless the store was moved. */
  storeDir: string;
  /** Claude Code's user settings.json. */
  settingsPath: string;
  /** Where each other host keeps what `install` wrote. */
  codexHooksPath: string;
  cursorHooksPath: string;
  geminiSettingsPath: string;
  opencodePluginPath: string;
  qwenSettingsPath: string;
  droidSettingsPath: string;
  copilotHooksPath: string;
  antigravityHooksPath: string;
  /** Whether a host's command is on this machine; null when it is not. */
  which: (command: string) => string | null;
  now: number;
  /** Claude Desktop's claude_desktop_config.json, whose chat gets the memory over MCP. */
  claudeDesktopConfigPath?: string;
  /** SHIBAOX_* variables set in the environment: the names until 0.3.0. */
  legacyVariables?: string[];
}

// Folders that copy files behind SQLite's back, or cannot lock them properly.
const SYNCED =
  /[\\/](?:Dropbox|OneDrive|Google Drive|iCloud Drive|Mobile Documents)[\\/]|^\/mnt\/[a-z]\//i;
const PROMPT_BUDGET_MS = 100;
const HOUR_MS = 3_600_000;

function dataDirectory(context: DoctorContext): Check {
  const name = "data directory";
  const moved = context.storeDir !== context.dataDir;
  const where = moved ? `${context.dataDir}; database in ${context.storeDir}` : context.dataDir;
  for (const dir of moved ? [context.storeDir, context.dataDir] : [context.dataDir]) {
    if (SYNCED.test(`${dir}/`)) {
      return {
        name,
        status: "warn",
        detail: `${dir} is inside a synced or shared folder; SQLite files can be corrupted there. Move the store to a local path.`,
      };
    }
  }
  if (moved) {
    const target = inspectTarget(context.storeDir);
    if (target.network) {
      return { name, status: "warn", detail: `${where}: ${target.warnings[0]}` };
    }
  }
  if (!existsSync(context.dataDir)) {
    return { name, status: "ok", detail: `${context.dataDir} (created on first use)` };
  }
  try {
    accessSync(context.dataDir, constants.R_OK | constants.W_OK);
    if (moved) accessSync(context.storeDir, constants.R_OK | constants.W_OK);
    return { name, status: "ok", detail: where };
  } catch {
    return { name, status: "fail", detail: `${where} is not readable and writable` };
  }
}

function database(context: DoctorContext): { check: Check; db: Db | null } {
  const name = "database";
  try {
    const db = openExisting(context.storeDir);
    if (db === null) return { check: { name, status: "ok", detail: "not created yet" }, db };
    const version =
      db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
    const integrity =
      db.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check ?? "unknown";
    if (integrity !== "ok") {
      db.close();
      return {
        check: {
          name,
          status: "fail",
          detail: `${join(context.storeDir, DB_FILE)} failed its integrity check: ${integrity}. Restore a file from ${join(context.storeDir, "backups")}.`,
        },
        db: null,
      };
    }
    const pending = version < LATEST_VERSION ? ", will be migrated on next use" : "";
    return { check: { name, status: "ok", detail: `schema version ${version}${pending}` }, db };
  } catch (error) {
    const detail =
      error instanceof SchemaTooNewError
        ? error.message
        : `cannot be opened: ${error instanceof Error ? error.message : String(error)}`;
    return { check: { name, status: "fail", detail }, db: null };
  }
}

/** How long ago, in the units a person would use. */
function agoLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(ms / 86_400_000)} d ago`;
}

function backups(context: DoctorContext, db: Db | null): Check {
  const name = "backups";
  const settings = loadSettings(process.env, context.dataDir);
  const { to, everyHours } = settings.backup;
  if (to === null) {
    return {
      name,
      status: "ok",
      detail: "not configured: set a folder or a bucket in the viewer's settings to keep copies",
    };
  }
  const last = db === null ? null : lastBackup(db);
  if (last === null) {
    return {
      name,
      status: "warn",
      detail: `none yet; ${everyHours > 0 ? "the next turn's end makes one" : "run wizardingcode-mem backup"} (${to})`,
    };
  }
  const age = context.now - last.at;
  if (everyHours > 0 && age > 2 * everyHours * HOUR_MS) {
    return {
      name,
      status: "warn",
      detail: `the last copy is ${Math.round(age / HOUR_MS)} h old, with one due every ${everyHours} h; check the target (${to}) and the logs`,
    };
  }
  return { name, status: "ok", detail: `last copy ${agoLabel(age)} · ${last.name} · ${to}` };
}

function fullTextSearch(): Check {
  const name = "full-text search";
  const probe = new Database(":memory:");
  try {
    probe.run(`CREATE VIRTUAL TABLE t USING fts5(x, tokenize = "unicode61 remove_diacritics 2")`);
    probe.run("INSERT INTO t (x) VALUES ('migração')");
    const found = probe.query("SELECT 1 FROM t WHERE t MATCH 'migracao'").get() !== null;
    const version = probe.query<{ v: string }, []>("SELECT sqlite_version() AS v").get()?.v;
    return found
      ? { name, status: "ok", detail: `FTS5 available (SQLite ${version})` }
      : { name, status: "fail", detail: "FTS5 does not fold diacritics on this SQLite" };
  } catch (error) {
    return {
      name,
      status: "fail",
      detail: `FTS5 is not available: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    probe.close();
  }
}

function queue(db: Db | null, now: number): Check {
  const name = "queue";
  if (db === null) return { name, status: "ok", detail: "nothing queued" };
  const count = (where: string, ...args: number[]) =>
    db.query<{ n: number }, number[]>(`SELECT count(*) AS n FROM turns WHERE ${where}`).get(...args)
      ?.n ?? 0;
  const failed = count("state = 'failed'");
  const waiting = count("state IN ('pending', 'processing')");
  const overdue = count("state = 'pending' AND started_at < ?", now - HOUR_MS);
  const problems: string[] = [];
  if (failed > 0) problems.push(`${failed} failed (see ${"`"}last_error${"`"} in the turns table)`);
  if (overdue > 0)
    problems.push(`${overdue} waiting for over an hour; run: wizardingcode-mem distill`);
  return problems.length > 0
    ? { name, status: "warn", detail: problems.join("; ") }
    : { name, status: "ok", detail: waiting === 0 ? "nothing queued" : `${waiting} waiting` };
}

function hookSpeed(db: Db | null): Check {
  const name = "hook speed";
  const prompt =
    db === null ? undefined : hookLatency(db).latency.find((l) => l.event === "prompt");
  if (prompt === undefined) return { name, status: "ok", detail: "no runs recorded yet" };
  const detail = `prompt p95 ${prompt.p95} ms over ${prompt.runs} runs`;
  return prompt.p95 > PROMPT_BUDGET_MS
    ? { name, status: "warn", detail: `${detail}; the budget is ${PROMPT_BUDGET_MS} ms` }
    : { name, status: "ok", detail };
}

/** How each agent installs wizardingcode-mem itself; what `doctor` suggests when it is missing. */
const NATIVE_INSTALL: Record<string, string> = {
  "claude-code":
    "run: claude plugin marketplace add WizardingCode-io/wizardingcode-plugins && claude plugin install wizardingcode-mem@wizardingcode-plugins",
  codex:
    "run: codex plugin marketplace add WizardingCode-io/wizardingcode-plugins && codex plugin add wizardingcode-mem@wizardingcode-plugins",
  gemini: "run: gemini extensions install https://github.com/WizardingCode-io/wizardingcode-mem",
  cursor: "run: wizardingcode-mem install cursor",
  opencode: "run: opencode plugin wizardingcode-mem-opencode --global",
  qwen: "run: wizardingcode-mem install qwen",
  droid: "run: wizardingcode-mem install droid",
  copilot: "run: wizardingcode-mem install copilot",
  antigravity: "run: wizardingcode-mem install antigravity",
};

const readText = (path: string): string | null => {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
};

/**
 * Whether the agent has wizardingcode-mem as its own plugin or extension, and how to say so.
 * Read from where each agent records what it has installed and enabled.
 */
function nativeInstall(agent: string, context: DoctorContext): string | null {
  try {
    switch (agent) {
      case "claude-code": {
        const settings = JSON.parse(readText(context.settingsPath) ?? "{}") as {
          enabledPlugins?: Record<string, unknown>;
        };
        const key = Object.entries(settings.enabledPlugins ?? {}).find(
          ([name, enabled]) => name.startsWith("wizardingcode-mem@") && enabled === true,
        )?.[0];
        return key === undefined ? null : `installed as a plugin (${key})`;
      }
      case "codex": {
        const config = readText(join(dirname(context.codexHooksPath), "config.toml")) ?? "";
        const section =
          /^\[plugins\."(wizardingcode-mem@[^"]+)"\]\s*\n((?:(?!\[)[^\n]*\n?)*)/m.exec(config);
        if (section === null || !/^enabled\s*=\s*true/m.test(section[2] ?? "")) return null;
        return `installed as a plugin (${section[1]})`;
      }
      case "gemini": {
        const manifest = readText(
          join(
            dirname(context.geminiSettingsPath),
            "extensions",
            "wizardingcode-mem",
            "gemini-extension.json",
          ),
        );
        if (manifest === null) return null;
        const version = (JSON.parse(manifest) as { version?: string }).version ?? "unknown version";
        return `installed as an extension (${version})`;
      }
      case "opencode": {
        const dir = dirname(dirname(context.opencodePluginPath));
        const listed = ["opencode.json", "opencode.jsonc"].some((file) =>
          (readText(join(dir, file)) ?? "").includes('"wizardingcode-mem-opencode'),
        );
        return listed ? "installed as an npm plugin (wizardingcode-mem-opencode)" : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Not installed directly: installed natively, absent from the machine, or simply missing. */
function withoutDirect(
  name: string,
  agent: string,
  command: string | null,
  context: DoctorContext,
): Check {
  const native = nativeInstall(agent, context);
  if (native !== null) return { name, status: "ok", detail: native };
  return command !== null && context.which(command) === null
    ? { name, status: "skip", detail: "not found on this machine" }
    : { name, status: "warn", detail: `not installed; ${NATIVE_INSTALL[agent]}` };
}

/** A host that keeps hooks in a JSON file: installed and whole, partly, pointing nowhere, or absent. */
function hooksHost(
  name: string,
  spec: HostSpec,
  path: string,
  command: string | null,
  context: DoctorContext,
): Check {
  const install = `run: wizardingcode-mem install ${spec.agent}`;
  const absent = (): Check => withoutDirect(name, spec.agent, command, context);
  if (!existsSync(path)) return absent();
  let found: ReturnType<typeof inspectHooksFile>;
  try {
    found = inspectHooksFile(spec, readFileSync(path, "utf8"));
  } catch (error) {
    return {
      name,
      status: "warn",
      detail: error instanceof Error ? error.message.replace("settings.json", path) : String(error),
    };
  }
  if (found.events.length === 0) return absent();
  const gone = found.binaries.filter((binary) => !existsSync(binary));
  if (gone.length > 0) {
    return {
      name,
      status: "fail",
      detail: `its hooks run ${gone.join(", ")}, which does not exist; ${install}`,
    };
  }
  const missing = spec.events
    .map(([hostEvent]) => hostEvent)
    .filter((event) => !found.events.includes(event));
  if (missing.length > 0) {
    return {
      name,
      status: "warn",
      detail: `partly installed or out of date (no ${missing.join(", ")} hook); ${install}`,
    };
  }
  return { name, status: "ok", detail: `installed, running ${found.binaries.join(", ")}` };
}

function openCode(context: DoctorContext): Check {
  const name = "OpenCode";
  const install = "run: wizardingcode-mem install opencode";
  const path = context.opencodePluginPath;
  let source: string | null = null;
  try {
    source = existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    source = null;
  }
  if (source === null || !source.includes(PLUGIN_MARKER)) {
    return withoutDirect(name, "opencode", "opencode", context);
  }
  const binary = /^const BINARY = (".*");$/m.exec(source)?.[1];
  const binaryPath = binary === undefined ? null : (JSON.parse(binary) as string);
  if (binaryPath === null || !existsSync(binaryPath)) {
    return {
      name,
      status: "fail",
      detail: `its plugin runs ${binaryPath ?? "an unknown binary"}, which does not exist; ${install}`,
    };
  }
  return { name, status: "ok", detail: `installed, running ${binaryPath}` };
}

/** Claude Desktop's chat: our MCP server in its config, spanning every project. Null when it is not on this machine. */
function claudeDesktop(context: DoctorContext): Check | null {
  const path = context.claudeDesktopConfigPath;
  if (path === undefined || !hasClaudeDesktop(path)) return null;
  const name = "Claude Desktop";
  const server = claudeDesktopServer(path);
  if (server === null) {
    return {
      name,
      status: "warn",
      detail: "its chat has no memory yet; run: wizardingcode-mem install claude-desktop",
    };
  }
  if (!existsSync(server.command)) {
    return {
      name,
      status: "fail",
      detail: `its config runs ${server.command}, which does not exist; run: wizardingcode-mem install claude-desktop`,
    };
  }
  return {
    name,
    status: "ok",
    detail: "chat has the memory over MCP, across every project; Cowork and Code use the plugin",
  };
}

function typeSafe(context: DoctorContext, db: Db | null): Check {
  const name = "TypeSafe";
  const settings = loadSettings(process.env, context.dataDir);
  const key = settings.typesafeKey;
  if (key === null) {
    return {
      name,
      status: "ok",
      detail: "not configured: the heuristic judge works alone and nothing leaves the machine",
    };
  }
  if (settings.typesafe === "off") {
    return {
      name,
      status: "ok",
      detail: "turned off in the settings; the key is kept and the heuristic judge works alone",
    };
  }
  const fingerprint = keyFingerprint(key);
  if (db !== null) {
    const state = new Breaker(db, { keyFingerprint: fingerprint }).state();
    if (state.reason === "auth") {
      return {
        name,
        status: "fail",
        detail:
          "the key was rejected by the service; check it at console.typesafe.ai/keys and save it again (the heuristic judge is standing in)",
      };
    }
    if (state.openUntil !== null && state.openUntil > context.now) {
      return {
        name,
        status: "warn",
        detail: `unavailable lately (${state.reason}); the heuristic judge is standing in until ${new Date(state.openUntil).toISOString()}`,
      };
    }
  }
  return { name, status: "ok", detail: `configured (key …${fingerprint.slice(-6)})` };
}

/** What is left of shibaox-mem, this product's name until 0.3.0; null when nothing is. */
function legacy(context: DoctorContext): Check | null {
  const problems = findLegacyPlugins(context).map(
    (found) => `${found.name} still enabled; ${found.hint}`,
  );
  const variables = context.legacyVariables ?? [];
  if (variables.length > 0) {
    problems.push(
      `old variables, still honoured for now: ${variables
        .map((name) => `${name} → WIZARDINGCODE_${name.slice("SHIBAOX_".length)}`)
        .join(", ")}`,
    );
  }
  return problems.length === 0
    ? null
    : { name: "shibaox-mem", status: "warn", detail: problems.join("; ") };
}

/** Looks, and changes nothing: no directory, database or setting is created or altered. */
export function runChecks(context: DoctorContext): Check[] {
  const { check: databaseCheck, db } = database(context);
  try {
    return [
      dataDirectory(context),
      databaseCheck,
      fullTextSearch(),
      databaseCheck.status === "fail"
        ? { name: "queue", status: "skip", detail: "the database could not be read" }
        : queue(db, context.now),
      hookSpeed(db),
      typeSafe(context, db),
      backups(context, db),
      // Claude Code is the host this started on: its absence is a warning, not a skip.
      hooksHost("Claude Code", CLAUDE_CODE, context.settingsPath, null, context),
      hooksHost("Codex", CODEX, context.codexHooksPath, "codex", context),
      hooksHost("Cursor", CURSOR, context.cursorHooksPath, "cursor", context),
      hooksHost("Gemini CLI", GEMINI, context.geminiSettingsPath, "gemini", context),
      openCode(context),
      hooksHost("Qwen Code", QWEN, context.qwenSettingsPath, "qwen", context),
      hooksHost("Factory Droid", DROID, context.droidSettingsPath, "droid", context),
      hooksHost("GitHub Copilot", COPILOT, context.copilotHooksPath, "copilot", context),
      hooksHost("Antigravity", ANTIGRAVITY, context.antigravityHooksPath, "agy", context),
      claudeDesktop(context),
      legacy(context),
    ].filter((check): check is Check => check !== null);
  } finally {
    db?.close();
  }
}
