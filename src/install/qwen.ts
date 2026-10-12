import { homedir } from "node:os";
import { join, resolve } from "node:path";
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

// Qwen Code: hooks and MCP servers both live in ~/.qwen/settings.json (QWEN_HOME moves it).
// Each hook has a `name`, which lets the user turn it off at runtime, and a timeout in
// seconds. The documentation says `qwen mcp add` writes the same `mcpServers` entry as
// editing the file, so the server goes in with the hooks, in one write.

export const QWEN: HostSpec = {
  agent: "qwen",
  events: [
    ["SessionStart", "session-start"],
    ["UserPromptSubmit", "prompt"],
    ["Stop", "turn-end"],
    ["SessionEnd", "session-end"],
  ],
  entry: (binaryPath, event) => ({
    name: MCP_NAME,
    type: "command",
    command: shellHookCommand(binaryPath, "qwen", event),
    timeout: HOOK_TIMEOUT_SECONDS,
  }),
  isOurs: (hook) => ourShellHookBinary(hook, "qwen") !== null,
  binaryOf: (hook) => ourShellHookBinary(hook, "qwen") ?? "",
  mcpAdd: () => [],
  mcpRemove: [],
  mcpInSettings: true,
  notes: [],
};

export const installQwen = (context: InstallContext): InstallResult =>
  installHooksFile(QWEN, context);
export const uninstallQwen = (context: InstallContext): UninstallResult =>
  uninstallHooksFile(QWEN, context);
export const inspectQwenSettings = (text: string, path = "settings.json") =>
  inspectHooksFile(QWEN, text, path);

/** QWEN_HOME as Qwen Code reads it: empty is unset, a leading ~ is home, relative is from here. */
function qwenHome(env: Record<string, string | undefined>, home: string): string {
  const value = env.QWEN_HOME;
  if (!value) return join(home, ".qwen");
  if (value === "~" || value.startsWith("~/")) return join(home, value.slice(1));
  return resolve(value);
}

export function qwenContext(
  binaryPath: string,
  env: Record<string, string | undefined> = process.env,
): InstallContext & { configDir: string } {
  const configDir = qwenHome(env, env.HOME || homedir());
  return {
    configDir,
    settingsPath: join(configDir, "settings.json"),
    dataDir: defaultDataDir(env),
    binaryPath,
    run,
    now: Date.now,
  };
}
