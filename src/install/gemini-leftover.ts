import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaultDataDir } from "../util/paths.ts";
import { run } from "./context.ts";
import {
  type HostSpec,
  inspectHooksFile,
  LEGACY_MCP_NAME,
  MCP_NAME,
  type UninstallResult,
  uninstallHooksFile,
} from "./hooks-file.ts";
import { ourShellHookBinary } from "./shell-hook.ts";

// Gemini CLI is no longer supported (Google moved its users to Antigravity CLI). An install of
// ours from before left three things, all in Gemini's own files: hooks running `hook gemini …`
// and an MCP server named wizardingcode-mem in settings.json (GEMINI_CLI_HOME or ~/.gemini),
// and the extension under extensions/. This finds them and takes them out, and nothing else:
// the user's own entries stay, and ~/.gemini/config — Antigravity's — is never opened.
//
// Qwen Code can install Gemini extensions into its own directory; if ours went there, its hooks
// still run `hook gemini …`, which now exits silently. It is not looked for here.

export const GEMINI_CLEANUP = "wizardingcode-mem uninstall gemini";
const ANTIGRAVITY = "wizardingcode-mem install antigravity";

/** Only for taking our old entries out: nothing installs it any more. */
const GEMINI_LEFTOVER: HostSpec = {
  agent: "gemini",
  events: [
    ["SessionStart", "session-start"],
    ["BeforeAgent", "prompt"],
    ["AfterAgent", "turn-end"],
    ["SessionEnd", "session-end"],
  ],
  entry: () => ({}),
  isOurs: (hook) => ourShellHookBinary(hook, "gemini") !== null,
  binaryOf: (hook) => ourShellHookBinary(hook, "gemini") ?? "",
  mcpAdd: () => [],
  mcpRemove: [],
  // `gemini mcp add -s user` wrote our server into settings.json: it leaves with the hooks.
  mcpInSettings: true,
  notes: [],
};

export interface GeminiLeftover {
  settingsPath: string;
  /** Gemini's events still hooked to us. */
  hooks: string[];
  /** Our MCP server is still in settings.json. */
  mcp: boolean;
  /** Our extension directories (under this name, or shibaox-mem's). */
  extensions: string[];
}

export interface GeminiLeftoverContext {
  /** Gemini CLI's settings.json; extensions/ sits beside it. */
  settingsPath: string;
  dataDir: string;
  /** Runs a host command. Must not throw: a missing command is `ok: false`. */
  run: (command: string[]) => { ok: boolean; output: string };
}

export function geminiLeftoverContext(
  env: Record<string, string | undefined> = process.env,
): GeminiLeftoverContext {
  const configDir = env.GEMINI_CLI_HOME || join(env.HOME || homedir(), ".gemini");
  return { settingsPath: join(configDir, "settings.json"), dataDir: defaultDataDir(env), run };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function readSettings(settingsPath: string): { text: string; parsed: unknown } | null {
  try {
    if (!existsSync(settingsPath)) return null;
    const text = readFileSync(settingsPath, "utf8");
    return { text, parsed: JSON.parse(text) };
  } catch {
    return null;
  }
}

/** Our extensions, recognised by their directory name and the manifest Gemini installed in it. */
function ourExtensions(settingsPath: string): string[] {
  return [MCP_NAME, LEGACY_MCP_NAME]
    .map((name) => join(dirname(settingsPath), "extensions", name))
    .filter((dir) => existsSync(join(dir, "gemini-extension.json")));
}

/** What an old install of ours left for Gemini CLI; null when nothing is. Changes nothing. */
export function findGeminiLeftover(settingsPath: string): GeminiLeftover | null {
  const settings = readSettings(settingsPath);
  let hooks: string[] = [];
  let mcp = false;
  if (settings !== null && isObject(settings.parsed)) {
    try {
      hooks = inspectHooksFile(GEMINI_LEFTOVER, settings.text).events;
    } catch {
      hooks = [];
    }
    const servers = settings.parsed.mcpServers;
    mcp = isObject(servers) && (MCP_NAME in servers || LEGACY_MCP_NAME in servers);
  }
  const extensions = ourExtensions(settingsPath);
  if (hooks.length === 0 && !mcp && extensions.length === 0) return null;
  return { settingsPath, hooks, mcp, extensions };
}

export interface GeminiCleanup {
  settingsPath: string;
  settings: UninstallResult["settings"];
  /** The extension directories removed. */
  extensions: string[];
}

/**
 * Takes out what `findGeminiLeftover` finds: our hooks and server from settings.json (put back
 * as it was when nobody changed it since, otherwise edited), and our extensions — through
 * Gemini's own command when it is there, else by removing the directory.
 */
export function removeGeminiLeftover(context: GeminiLeftoverContext): GeminiCleanup {
  const found = findGeminiLeftover(context.settingsPath);
  let settings: UninstallResult["settings"] = "untouched";
  if (found !== null && (found.hooks.length > 0 || found.mcp)) {
    settings = uninstallHooksFile(GEMINI_LEFTOVER, {
      settingsPath: context.settingsPath,
      dataDir: context.dataDir,
      binaryPath: "",
      run: context.run,
      now: Date.now,
    }).settings;
  }
  const extensions: string[] = [];
  for (const dir of found?.extensions ?? []) {
    const name = dir.slice(dirname(dir).length + 1);
    context.run(["gemini", "extensions", "uninstall", name]);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    extensions.push(dir);
  }
  return { settingsPath: context.settingsPath, settings, extensions };
}

/** Where the leftover is, in a few words. */
export function describeGeminiLeftover(found: GeminiLeftover): string {
  const parts: string[] = [];
  if (found.hooks.length > 0) parts.push(`hooks in ${found.settingsPath}`);
  if (found.mcp) parts.push(`an MCP server in ${found.settingsPath}`);
  for (const dir of found.extensions) parts.push(`the extension ${dir}`);
  return parts.join(", ");
}

export interface GeminiOfferDeps {
  find: () => GeminiLeftover | null;
  remove: () => GeminiCleanup;
  tty: boolean;
  confirm: (question: string) => boolean;
}

/**
 * During `install`: an old Gemini CLI install of ours is offered for removal. A terminal is
 * asked (`--yes` answers for it); anywhere else, one line says how. Returns the lines to print.
 */
export function offerGeminiCleanup(flags: string[], deps: GeminiOfferDeps): string[] {
  let found: GeminiLeftover | null;
  try {
    found = deps.find();
  } catch {
    return [];
  }
  if (found === null) return [];
  const where = describeGeminiLeftover(found);
  const agreed =
    flags.includes("--yes") ||
    (deps.tty &&
      deps.confirm(
        `Gemini CLI support was removed, but wizardingcode-mem is still installed there (${where}). Remove it? (For Antigravity: ${ANTIGRAVITY}.)`,
      ));
  if (!deps.tty && !agreed) {
    return [
      `Gemini CLI: support was removed; wizardingcode-mem is still there (${where}). Remove it with: ${GEMINI_CLEANUP} (for Antigravity: ${ANTIGRAVITY})`,
    ];
  }
  if (!agreed) {
    return [`  Gemini CLI: left as it is. To remove it later, run: ${GEMINI_CLEANUP}`];
  }
  try {
    deps.remove();
    return [`  Gemini CLI: wizardingcode-mem's old install removed (${where})`];
  } catch (error) {
    return [
      `  Gemini CLI: could not remove it (${error instanceof Error ? error.message : String(error)}). Run: ${GEMINI_CLEANUP}`,
    ];
  }
}
