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
  MCP_NAME,
  type UninstallResult,
  uninstallHooksFile,
} from "./hooks-file.ts";
import { ourShellHookBinary, shellHookCommand } from "./shell-hook.ts";

// Codex CLI: hooks.json in CODEX_HOME (~/.codex), the same shape as Claude Code's, but a
// hook's `command` is one shell string. Codex asks the user to approve new hooks.

export const CODEX: HostSpec = {
  agent: "codex",
  events: [
    ["SessionStart", "session-start"],
    ["UserPromptSubmit", "prompt"],
    ["Stop", "turn-end"],
    ["SessionEnd", "session-end"],
  ],
  entry: (binaryPath, event) => ({
    type: "command",
    command: shellHookCommand(binaryPath, "codex", event),
    timeout: HOOK_TIMEOUT_SECONDS,
  }),
  isOurs: (hook) => ourShellHookBinary(hook, "codex") !== null,
  binaryOf: (hook) => ourShellHookBinary(hook, "codex") ?? "",
  mcpAdd: (binaryPath) => ["codex", "mcp", "add", MCP_NAME, "--", binaryPath, "mcp"],
  mcpRemove: ["codex", "mcp", "remove", MCP_NAME],
  notes: [
    "Codex asks you to approve new hooks the first time: run /hooks inside Codex and accept the wizardingcode-mem entries.",
  ],
};

export const installCodex = (context: InstallContext): InstallResult =>
  installHooksFile(CODEX, context);
export const uninstallCodex = (context: InstallContext): UninstallResult =>
  uninstallHooksFile(CODEX, context);
export const inspectCodexHooks = (text: string, path = "hooks.json") =>
  inspectHooksFile(CODEX, text, path);

export function codexContext(
  binaryPath: string,
  env: Record<string, string | undefined> = process.env,
): InstallContext & { configDir: string } {
  const configDir = env.CODEX_HOME || join(env.HOME || homedir(), ".codex");
  return {
    configDir,
    settingsPath: join(configDir, "hooks.json"),
    dataDir: defaultDataDir(env),
    binaryPath,
    run,
    now: Date.now,
  };
}
