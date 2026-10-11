import { homedir } from "node:os";
import { join } from "node:path";
import { defaultDataDir } from "../util/paths.ts";
import { run } from "./context.ts";
import {
  HOOK_TIMEOUT_SECONDS,
  type HostSpec,
  type InstallContext,
  type InstallResult,
  inspectHooksFile,
  installHooksFile,
  type UninstallResult,
  uninstallHooksFile,
} from "./hooks-file.ts";
import { ourShellHookBinary, shellHookCommand } from "./shell-hook.ts";

// Factory Droid: hooks go in ~/.factory/settings.json under "hooks" (the standalone
// hooks.json is keyed directly by event and stays the user's); MCP servers live in
// ~/.factory/mcp.json. No environment variable that moves ~/.factory is documented. The hook
// timeout is in seconds.

export type DroidContext = InstallContext & { mcpPath: string };

export const DROID: HostSpec = {
  agent: "droid",
  events: [
    ["SessionStart", "session-start"],
    ["UserPromptSubmit", "prompt"],
    ["Stop", "turn-end"],
    ["SessionEnd", "session-end"],
  ],
  entry: (binaryPath, event) => ({
    type: "command",
    command: shellHookCommand(binaryPath, "droid", event),
    timeout: HOOK_TIMEOUT_SECONDS,
  }),
  isOurs: (hook) => ourShellHookBinary(hook, "droid") !== null,
  binaryOf: (hook) => ourShellHookBinary(hook, "droid") ?? "",
  mcpAdd: () => [],
  mcpRemove: [],
  mcpFile: (context) => (context as DroidContext).mcpPath,
  notes: [],
};

export const installDroid = (context: DroidContext): InstallResult =>
  installHooksFile(DROID, context);
export const uninstallDroid = (context: DroidContext): UninstallResult =>
  uninstallHooksFile(DROID, context);
export const inspectDroidSettings = (text: string) => inspectHooksFile(DROID, text);

export function droidContext(
  binaryPath: string,
  env: Record<string, string | undefined> = process.env,
): DroidContext & { configDir: string } {
  const configDir = join(env.HOME || homedir(), ".factory");
  return {
    configDir,
    settingsPath: join(configDir, "settings.json"),
    mcpPath: join(configDir, "mcp.json"),
    dataDir: defaultDataDir(env),
    binaryPath,
    run,
    now: Date.now,
  };
}
