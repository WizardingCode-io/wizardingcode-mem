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

// Cursor: ~/.cursor/hooks.json holds `version: 1` and a flat list of entries per event;
// MCP servers live in ~/.cursor/mcp.json, which has no command to edit it.

export type CursorContext = InstallContext & { mcpPath: string };

export const CURSOR: HostSpec = {
  agent: "cursor",
  layout: "flat",
  topLevel: { version: 1 },
  events: [
    ["sessionStart", "session-start"],
    ["beforeSubmitPrompt", "prompt"],
    ["afterAgentResponse", "turn-end"],
    ["sessionEnd", "session-end"],
  ],
  entry: (binaryPath, event) => ({
    command: shellHookCommand(binaryPath, "cursor", event),
    timeout: HOOK_TIMEOUT_SECONDS,
  }),
  isOurs: (hook) => ourShellHookBinary(hook, "cursor") !== null,
  binaryOf: (hook) => ourShellHookBinary(hook, "cursor") ?? "",
  mcpAdd: () => [],
  mcpRemove: [],
  mcpFile: (context) => (context as CursorContext).mcpPath,
  notes: [],
};

export const installCursor = (context: CursorContext): InstallResult =>
  installHooksFile(CURSOR, context);
export const uninstallCursor = (context: CursorContext): UninstallResult =>
  uninstallHooksFile(CURSOR, context);
export const inspectCursorHooks = (text: string, path = "hooks.json") =>
  inspectHooksFile(CURSOR, text, path);

export function cursorContext(
  binaryPath: string,
  env: Record<string, string | undefined> = process.env,
): CursorContext & { configDir: string } {
  const configDir = join(env.HOME || homedir(), ".cursor");
  return {
    configDir,
    settingsPath: join(configDir, "hooks.json"),
    mcpPath: join(configDir, "mcp.json"),
    dataDir: defaultDataDir(env),
    binaryPath,
    run,
    now: Date.now,
  };
}
