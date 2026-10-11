import { readdirSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaultDataDir } from "../util/paths.ts";
import { run } from "./context.ts";
import {
  HOOK_TIMEOUT_SECONDS,
  type HostSpec,
  type InstallContext,
  type InstallResult,
  inspectHooksFile,
  installHooksFile,
  MCP_NAME,
  type UninstallResult,
  uninstallHooksFile,
} from "./hooks-file.ts";
import { ourShellHookBinary, shellHookCommand } from "./shell-hook.ts";

// Google Antigravity: its CLI (`agy`), Antigravity 2.0 and the Antigravity IDE all read
// ~/.gemini/config/hooks.json and ~/.gemini/config/mcp_config.json. The hooks file maps hook
// *names* to their events, so ours is one definition named wizardingcode-mem beside the
// user's; PreInvocation and Stop take their handlers directly, with no matcher. The MCP
// server goes into mcp_config.json beside the user's servers.
//
// ~/.gemini is shared with the Gemini CLI, whose files (settings.json, extensions/) are never
// opened here, and whose entries run `hook gemini`, never `hook antigravity`. No environment
// variable moving these files is documented, so GEMINI_CLI_HOME does not move them.
//
// No plugin: the plugin documentation does not say how a plugin's hook finds its own
// directory, so a hook there could not reliably run the binary it ships.

export type AntigravityContext = InstallContext & { mcpPath: string };

export const ANTIGRAVITY: HostSpec = {
  agent: "antigravity",
  definition: MCP_NAME,
  layout: "flat",
  events: [
    ["PreInvocation", "session-start"],
    ["Stop", "turn-end"],
  ],
  entry: (binaryPath, event) => ({
    type: "command",
    command: shellHookCommand(binaryPath, "antigravity", event),
    timeout: HOOK_TIMEOUT_SECONDS,
  }),
  isOurs: (hook) => ourShellHookBinary(hook, "antigravity") !== null,
  binaryOf: (hook) => ourShellHookBinary(hook, "antigravity") ?? "",
  mcpAdd: () => [],
  mcpRemove: [],
  mcpFile: (context) => (context as AntigravityContext).mcpPath,
  notes: [
    "Antigravity CLI, Antigravity 2.0 and the Antigravity IDE all read these files; /hooks and /mcp in agy show them.",
  ],
};

export const installAntigravity = (context: AntigravityContext): InstallResult =>
  installHooksFile(ANTIGRAVITY, context);

/** Also removes ~/.gemini/config when that leaves it empty; ~/.gemini itself is never removed. */
export function uninstallAntigravity(context: AntigravityContext): UninstallResult {
  const result = uninstallHooksFile(ANTIGRAVITY, context);
  const configDir = dirname(context.settingsPath);
  try {
    if (readdirSync(configDir).length === 0) rmdirSync(configDir);
  } catch {
    // Not there, or not ours to judge: left as it is.
  }
  return result;
}

export const inspectAntigravityHooks = (text: string) => inspectHooksFile(ANTIGRAVITY, text);

export function antigravityContext(
  binaryPath: string,
  env: Record<string, string | undefined> = process.env,
): AntigravityContext & { configDir: string; appDirs: string[] } {
  const gemini = join(env.HOME || homedir(), ".gemini");
  const configDir = join(gemini, "config");
  return {
    configDir,
    // Each surface's own app data directory, as the hooks documentation names them.
    appDirs: ["antigravity-cli", "antigravity", "antigravity-ide"].map((dir) => join(gemini, dir)),
    settingsPath: join(configDir, "hooks.json"),
    mcpPath: join(configDir, "mcp_config.json"),
    dataDir: defaultDataDir(env),
    binaryPath,
    run,
    now: Date.now,
  };
}
