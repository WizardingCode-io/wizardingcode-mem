import { Database } from "bun:sqlite";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { lastBackup } from "../backup/schedule.ts";
import { semanticStatus } from "../embed/status.ts";
import { ANTIGRAVITY } from "../install/antigravity.ts";
import { CLAUDE_CODE } from "../install/claude-code.ts";
import { claudeDesktopServer, hasClaudeDesktop } from "../install/claude-desktop.ts";
import { CODEX } from "../install/codex.ts";
import { COPILOT } from "../install/copilot.ts";
import { CURSOR } from "../install/cursor.ts";
import { DROID } from "../install/droid.ts";
import {
  describeGeminiLeftover,
  findGeminiLeftover,
  GEMINI_CLEANUP,
} from "../install/gemini-leftover.ts";
import { type HostSpec, inspectHooksFile } from "../install/hooks-file.ts";
import { findLegacyPlugins } from "../install/legacy-plugins.ts";
import { PLUGIN_MARKER } from "../install/opencode-plugin.ts";
import { QWEN } from "../install/qwen.ts";
import { Breaker } from "../judge/breaker.ts";
import { keyFingerprint } from "../judge/key.ts";
import { personAuthor } from "../modules/knowledge/author.ts";
import { KnowledgeError } from "../modules/knowledge/errors.ts";
import { FOLDER_CAP, readRepoFiles } from "../modules/knowledge/index-store.ts";
import { KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION } from "../modules/knowledge/migrations.ts";
import {
  checkRepoConfig,
  DECIDED_DIR,
  ENTRIES_DIR,
  GIT_MIN_VERSION,
  GIT_TIMEOUT_MS,
  gitTooOld,
  kindAt,
  knowledgeRoot,
  MANIFEST_FILE,
  namesIn,
  OPEN_DIR,
  parseGitVersion,
  parseManifest,
  readRegularFile,
  refuseForeign,
  refuseLinkedRoots,
  repoPath,
  runGit,
  statusOf,
  TAXONOMY_FILE,
} from "../modules/knowledge/repo.ts";
import { type FoundRepo, scanRepos } from "../modules/knowledge/resolve.ts";
import type { KnowledgeStore } from "../modules/knowledge/types.ts";
import { loadSettings } from "../settings/settings.ts";
import { isDefault, loadPolicy } from "../sharing/policy.ts";
import {
  type Level,
  type SharingPolicy,
  shareListText,
  TEAM_DESTINATION,
} from "../sharing/types.ts";
import { hookLatency } from "../status/report.ts";
import {
  DB_FILE,
  type Db,
  LATEST_VERSION,
  moduleSchemaState,
  openExisting,
  SchemaTooNewError,
} from "../store/db.ts";
import { inspectTarget } from "../store/move.ts";
import { plural } from "../util/text.ts";

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
  /** Gemini CLI's settings.json, no longer supported: only looked at for an old install of ours. */
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
  /** The environment git is run with and the settings are read from; the process's when absent. */
  env?: Record<string, string | undefined>;
  /** The installed git's version, for a test; when absent, git is asked. */
  gitVersion?: () => number[] | null;
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
    found = inspectHooksFile(spec, readFileSync(path, "utf8"), path);
  } catch (error) {
    return {
      name,
      status: "warn",
      detail: error instanceof Error ? error.message.replace(basename(path), path) : String(error),
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

const MB = 1024 * 1024;

function semanticSearch(context: DoctorContext, db: Db | null): Check {
  const name = "semantic search";
  const s = semanticStatus(db, context.dataDir, process.env, context.now);
  const size = `${Math.round(s.model.bytes / MB)} MB`;
  if (!s.model.enabled) {
    const by =
      s.model.source === "env"
        ? "by WIZARDINGCODE_MEM_SEMANTIC in the environment"
        : "in the settings";
    return {
      name,
      status: "ok",
      detail: `turned off ${by}; searches match words only${s.model.present ? ` (the model is kept, ${size})` : ""}`,
    };
  }
  if (s.download.running) {
    return {
      name,
      status: "ok",
      detail: "the search model is downloading; searches match words until it is ready",
    };
  }
  if (!s.model.present) {
    return {
      name,
      status: "ok",
      detail: `not downloaded; searches match words only. To find notes by meaning too, run: wizardingcode-mem embed download${s.download.error ? `; the last download failed (${s.download.error})` : ""}`,
    };
  }
  if (s.model.problem !== null) {
    return {
      name,
      status: "warn",
      detail: `the model cannot be used (${s.model.problem}); searches match words only. Run: wizardingcode-mem embed delete, then wizardingcode-mem embed download`,
    };
  }
  const { active, withVectors } = s.memories;
  const missing = active - withVectors;
  const vectors = `${withVectors} of ${active} active memories have a vector`;
  const rest = s.backfill.running
    ? "; the backfill is running"
    : missing > 0
      ? `; run: wizardingcode-mem embed backfill`
      : "";
  return { name, status: "ok", detail: `ready (${size}); ${vectors}${rest}` };
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

/** An old Gemini CLI install of ours, now that Gemini CLI is no longer supported; null when none. */
function geminiLeftover(context: DoctorContext): Check | null {
  const found = findGeminiLeftover(context.geminiSettingsPath);
  if (found === null) return null;
  return {
    name: "old Gemini CLI install",
    status: "warn",
    detail: `Gemini CLI support was removed, but wizardingcode-mem is still there (${describeGeminiLeftover(found)}); run: ${GEMINI_CLEANUP}`,
  };
}

/**
 * A check that reads the database. One from before a migration lacks the newer tables, and
 * doctor only looks, so it does not migrate it: a check that needs what it lacks is skipped.
 */
function readingDb(name: string, db: Db | null, check: () => Check): Check {
  try {
    return check();
  } catch (error) {
    const version =
      db?.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ??
      LATEST_VERSION;
    if (version < LATEST_VERSION) {
      return {
        name,
        status: "skip",
        detail: `needs the newer schema; the database (version ${version}) will be migrated on next use`,
      };
    }
    return {
      name,
      status: "fail",
      detail: `could not be checked: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// --- Knowledge ------------------------------------------------------------------------

/** A folder past this many files is close to the index's cap: said before files are left out. */
const FOLDER_WARN = 4000;
const LOCK_STALE_MS = 60_000;
const PROBLEMS_NAMED = 5;

/**
 * The fixed scopes' names with no database to map projects by: whatever is at each, a
 * link or a file included, as the module finds them (`scanRepos`).
 */
function foldersByHand(dataDir: string): FoundRepo[] {
  const found: FoundRepo[] = [];
  for (const scope of ["workspace", "shared"] as const) {
    const relative = `knowledge/${scope}`;
    const path = repoPath(dataDir, relative);
    if (kindAt(path) !== "absent") found.push({ ref: { scope }, path, relative });
  }
  return found;
}

/**
 * Every name under `knowledge/projects/`, mapped or not, a link or a file included. Read
 * with the module's own `namesIn` and `kindAt`: a folder that cannot be listed, or a name
 * that cannot be looked at, is a refusal, which becomes this check's warning with or
 * without a database, never a shorter list.
 */
function projectFolders(dataDir: string): string[] {
  return namesIn(repoPath(dataDir, "knowledge/projects"))
    .filter((name) => !name.startsWith("."))
    .sort()
    .map((name) => `knowledge/projects/${name}`)
    .filter((relative) => kindAt(repoPath(dataDir, relative)) !== "absent");
}

/**
 * The knowledge repositories, read by hand: the folders, the manifests, `.git` and the
 * files. The database, read-only, answers four things only: the module's schema version,
 * the files the index left out, the project aliases that map manifests, and the author
 * setting. With git present, one `git status` per repository, taking no lock.
 */
function knowledgeRepositories(context: DoctorContext, db: Db | null): Check {
  const name = "knowledge";
  // The module's own rule, before anything under these folders is listed or read.
  refuseLinkedRoots(context.dataDir);
  if (kindAt(knowledgeRoot(context.dataDir)) === "absent") {
    return { name, status: "skip", detail: "no knowledge repository yet" };
  }
  const env = context.env ?? process.env;
  const store: KnowledgeStore = {
    // Read-only, and only where a database exists: `scanRepos` and nothing that writes.
    db: db as Db,
    dataDir: context.dataDir,
    env,
    now: () => context.now,
    settings: loadSettings(env, context.dataDir),
    gitTimeoutMs: GIT_TIMEOUT_MS,
    renew: null,
    report: null,
  };
  const warnings: string[] = [];
  const notes: string[] = [];

  let git = context.which("git") !== null;
  if (!git) {
    warnings.push("git is not installed: knowledge cannot be written or checked for hand edits");
  } else {
    let version: number[] | null = null;
    try {
      version =
        context.gitVersion !== undefined
          ? context.gitVersion()
          : parseGitVersion(
              runGit(store, null, ["--version"], {
                operation: "doctor",
                readOnly: true,
                quiet: true,
              }).stdout,
            );
    } catch (error) {
      if (!(error instanceof KnowledgeError)) throw error;
    }
    const wanted = GIT_MIN_VERSION.join(".").replace(/\.0$/, "");
    if (version === null) {
      git = false;
      warnings.push(`git did not answer: knowledge needs git ${wanted} or newer`);
    } else if (gitTooOld(version)) {
      git = false;
      warnings.push(`git ${version.join(".")} is older than ${wanted}, which knowledge needs`);
    }
  }

  // With no database, or one whose knowledge tables do not exist yet, no project can be
  // mapped: every folder is read as it is.
  const unmapped = (): FoundRepo[] => [
    ...foldersByHand(context.dataDir),
    ...projectFolders(context.dataDir).map((relative) => ({
      ref: { scope: "project", projectId: 0 } as const,
      path: repoPath(context.dataDir, relative),
      relative,
    })),
  ];
  let found: FoundRepo[];
  if (db === null) {
    found = unmapped();
    notes.push("no database: the checks that read it were skipped");
  } else {
    let scan: ReturnType<typeof scanRepos>;
    try {
      scan = scanRepos(store);
    } catch (error) {
      // Only tables that do not exist yet are a reason to read the folders unmapped; any
      // other failure is a fault, and reaches the person as this check's warning.
      if (!String((error as Error).message).includes("no such table: knowledge_")) throw error;
      scan = { found: unmapped(), orphans: [], ambiguous: [], claimed: [] };
    }
    found = scan.found;
    for (const entry of scan.ambiguous) {
      warnings.push(
        `ambiguous: project ${entry.projectId} matches ${entry.taken} and ${entry.others.join(", ")}`,
      );
    }
    for (const claim of scan.claimed) {
      warnings.push(
        `ambiguous: ${claim.path} is claimed by projects ${claim.byProjectId} and ${claim.wantedBy}`,
      );
    }
    if (moduleSchemaState(db, KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION) === "too-new") {
      warnings.push("the knowledge tables are newer than this wizardingcode-mem; upgrade it");
    } else {
      try {
        const over = db
          .query<{ path: string; over_cap: number }, []>(
            "SELECT path, over_cap FROM knowledge_repos WHERE over_cap > 0 ORDER BY path",
          )
          .all();
        for (const row of over) {
          warnings.push(
            `${row.path}: ${plural(row.over_cap, "file")} over the cap of ${FOLDER_CAP}`,
          );
        }
      } catch (error) {
        // The tables are created on the next write; there is nothing recorded to read.
        if (!String((error as Error).message).includes("no such table: knowledge_")) throw error;
      }
    }
    if (personAuthor(store).source === "default") {
      warnings.push("no author configured: set WIZARDINGCODE_MEM_AUTHOR or a git user.name");
    }
  }

  // Every name where a repository goes, mapped to a project or not. The module's own
  // rule comes first, before anything under a name is looked at: a link or a file put
  // there, or a folder the store did not make, is said by name, and neither read nor
  // handed to git. Then a folder with no repository in it is said.
  const folders = new Set([
    ...found.map((repo) => repo.relative),
    ...projectFolders(context.dataDir),
  ]);
  const unread = new Set<string>();
  for (const relative of folders) {
    const path = repoPath(context.dataDir, relative);
    try {
      refuseForeign(path);
      if (kindAt(join(path, ".git")) === "folder") continue;
      warnings.push(`${relative} is not a git repository`);
    } catch (error) {
      if (!(error instanceof KnowledgeError)) throw error;
      warnings.push(`${relative}: ${error.message}`);
    }
    unread.add(relative);
  }

  let entries = 0;
  let drafts = 0;
  let open = 0;
  // The repositories read: one the store refuses has its warning above, and is not counted.
  let repositories = 0;
  const problems: string[] = [];
  for (const repo of found) {
    if (unread.has(repo.relative)) continue;
    repositories++;
    try {
      // Never through a link, and never more than the cap: as the module reads every file.
      const bytes = readRegularFile(join(repo.path, MANIFEST_FILE));
      if (bytes === null) warnings.push(`${repo.relative}: ${MANIFEST_FILE} is missing`);
      else {
        const manifest = parseManifest(new TextDecoder().decode(bytes));
        if ("problem" in manifest) warnings.push(`${repo.relative}: ${manifest.problem}`);
      }
    } catch (error) {
      if (!(error instanceof KnowledgeError)) throw error;
      warnings.push(`${repo.relative}: ${error.message}`);
    }
    try {
      const age = context.now - statSync(join(repo.path, ".git", "index.lock")).mtimeMs;
      if (age > LOCK_STALE_MS) {
        warnings.push(
          `${repo.relative}: .git/index.lock is ${Math.round(age / 1000)} s old; a git process died there, remove the file`,
        );
      }
    } catch {
      // No lock: nothing is writing.
    }
    let files: ReturnType<typeof readRepoFiles>;
    try {
      for (const folder of [ENTRIES_DIR, OPEN_DIR, DECIDED_DIR]) {
        // None when the folder is not there: git does not track an empty one, so a fresh
        // clone may not have it.
        const count = namesIn(join(repo.path, ...folder.split("/"))).filter(
          (file) => !file.startsWith("."),
        ).length;
        if (count > FOLDER_WARN) {
          warnings.push(
            `${repo.relative}: ${folder}/ holds ${count} files; the index keeps ${FOLDER_CAP}`,
          );
        }
      }
      files = readRepoFiles(store, { ...repo, id: 0 });
    } catch (error) {
      // A folder of entries or proposals that cannot be read is said by name, and never
      // counted as an empty one. The other repositories are still checked.
      if (!(error instanceof KnowledgeError)) throw error;
      warnings.push(`${repo.relative}: ${error.message}`);
      continue;
    }
    entries += files.entries.length;
    drafts += files.entries.filter(({ entry }) => entry.status === "draft").length;
    open += files.proposals.filter(({ path }) => path.startsWith(`${OPEN_DIR}/`)).length;
    problems.push(
      ...files.entries.filter(({ entry }) => entry.problem !== null).map(({ entry }) => entry.slug),
    );

    if (!git) continue;
    try {
      // A repository whose own configuration could run a program is never handed to git.
      checkRepoConfig(repo.path);
      const changed = statusOf(store, { ...repo, id: 0 }, [
        ENTRIES_DIR,
        "proposals",
        TAXONOMY_FILE,
        MANIFEST_FILE,
      ]).length;
      if (changed > 0) {
        warnings.push(
          `${repo.relative}: ${changed} changed outside the engine; run wizardingcode-mem knowledge adopt`,
        );
      }
    } catch (error) {
      if (!(error instanceof KnowledgeError)) throw error;
      warnings.push(`${repo.relative}: ${error.message}`);
    }
  }
  if (problems.length > 0) {
    const more = problems.length - PROBLEMS_NAMED;
    warnings.push(
      `${plural(problems.length, "entry has a problem", "entries have problems")}: ${problems
        .slice(0, PROBLEMS_NAMED)
        .join(", ")}${more > 0 ? ` and ${more} more` : ""}`,
    );
  }

  const counts = [
    `${plural(repositories, "repository", "repositories")}, ${plural(entries, "entry", "entries")}, ${plural(drafts, "draft")}, ${plural(open, "open proposal")}`,
    ...notes,
  ].join("; ");
  return warnings.length === 0
    ? { name, status: "ok", detail: counts }
    : { name, status: "warn", detail: `${warnings.join("; ")} (${counts})` };
}

/** Contains its own errors: an unreadable folder or manifest is a warning, never a thrown error. */
function knowledge(context: DoctorContext, db: Db | null): Check {
  try {
    return knowledgeRepositories(context, db);
  } catch (error) {
    return {
      name: "knowledge",
      status: "warn",
      detail: `could not be checked: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// --- Sharing --------------------------------------------------------------------------

/** How many projects stand at a level for the team, as the policy reads them now. */
function projectsAt(policy: SharingPolicy, level: Level): number {
  return [...policy.levels.values()].filter(
    (row) => row.destination === TEAM_DESTINATION && row.level === level,
  ).length;
}

/**
 * What may leave this machine, or every problem the policy's loader raised: an emptied
 * list, an ignored environment value, a level that no longer holds, an inert area id, a hand
 * edit nobody recorded, a level this version does not know, a newer sharing schema. It only
 * looks: nothing is reconciled here. Its own try, not `readingDb`'s: at the current schema a
 * store may still lack the sharing tables, which is every default and not an older schema.
 * Sharing chosen with no team server configured is no warning: there is nothing to fix.
 */
function sharing(context: DoctorContext, db: Db | null): Check {
  const name = "sharing";
  if (db === null) return { name, status: "skip", detail: "no database yet" };
  try {
    const policy = loadPolicy(db, context.dataDir, context.env ?? process.env, context.now);
    if (policy.problems.length > 0) {
      return { name, status: "warn", detail: policy.problems.join(" · ") };
    }
    if (isDefault(policy)) {
      return { name, status: "ok", detail: "nothing leaves this machine (every default)" };
    }
    const detail = [
      `roots: ${shareListText([...policy.roots].sort())}`,
      plural(policy.areas.size, "allowed area"),
      `knowledge: ${plural(projectsAt(policy, "knowledge"), "project")}`,
      `knowledge and memories: ${plural(projectsAt(policy, "all"), "project")}`,
      `epoch ${policy.epoch}`,
    ].join(" · ");
    return { name, status: "ok", detail };
  } catch (error) {
    return {
      name,
      status: "warn",
      detail: `could not be checked: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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
        : readingDb("queue", db, () => queue(db, context.now)),
      readingDb("hook speed", db, () => hookSpeed(db)),
      readingDb("TypeSafe", db, () => typeSafe(context, db)),
      readingDb("semantic search", db, () => semanticSearch(context, db)),
      readingDb("backups", db, () => backups(context, db)),
      knowledge(context, db),
      sharing(context, db),
      // Claude Code is the host this started on: its absence is a warning, not a skip.
      hooksHost("Claude Code", CLAUDE_CODE, context.settingsPath, null, context),
      hooksHost("Codex", CODEX, context.codexHooksPath, "codex", context),
      hooksHost("Cursor", CURSOR, context.cursorHooksPath, "cursor", context),
      openCode(context),
      hooksHost("Qwen Code", QWEN, context.qwenSettingsPath, "qwen", context),
      hooksHost("Factory Droid", DROID, context.droidSettingsPath, "droid", context),
      hooksHost("GitHub Copilot", COPILOT, context.copilotHooksPath, "copilot", context),
      hooksHost("Antigravity", ANTIGRAVITY, context.antigravityHooksPath, "agy", context),
      claudeDesktop(context),
      legacy(context),
      geminiLeftover(context),
    ].filter((check): check is Check => check !== null);
  } finally {
    db?.close();
  }
}
