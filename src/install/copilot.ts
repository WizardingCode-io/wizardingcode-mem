import { existsSync, readFileSync, rmSync } from "node:fs";
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

// GitHub Copilot: the CLI loads every ~/.copilot/hooks/*.json (COPILOT_HOME moves the
// directory), and VS Code's agent mode reads the same files, mapping the CLI's camelCase events
// to its own. So the hooks go in a file of their own, wizardingcode-mem.json, that nothing else
// writes: the user's hook files and settings.json are never opened. The shared HostSpec
// machinery still does the writing, so that the receipt, the backup of a file that somehow was
// there before, and the merge into mcp-config.json work as for every other host.
//
// Each entry uses `command` (the CLI's cross-platform field and VS Code's own) and `timeout`
// (an alias of the CLI's `timeoutSec`, and VS Code's field), both in seconds.
//
// The MCP server goes into mcp-config.json beside the user's servers. VS Code's own mcp.json is
// per profile and is not edited; the install says how to add the server there.

export type CopilotContext = InstallContext & { mcpPath: string };

export const COPILOT: HostSpec = {
  agent: "copilot",
  layout: "flat",
  topLevel: { version: 1 },
  events: [
    ["sessionStart", "session-start"],
    ["userPromptSubmitted", "prompt"],
    ["agentStop", "turn-end"],
    ["sessionEnd", "session-end"],
  ],
  entry: (binaryPath, event) => ({
    type: "command",
    command: shellHookCommand(binaryPath, "copilot", event),
    timeout: HOOK_TIMEOUT_SECONDS,
  }),
  isOurs: (hook) => ourShellHookBinary(hook, "copilot") !== null,
  binaryOf: (hook) => ourShellHookBinary(hook, "copilot") ?? "",
  mcpAdd: () => [],
  mcpRemove: [],
  mcpFile: (context) => (context as CopilotContext).mcpPath,
  mcpEntry: (binaryPath) => ({ type: "local", command: binaryPath, args: ["mcp"], tools: ["*"] }),
  notes: [],
};

/** What VS Code needs for the memory tools: its own command adds the server to its profile. */
export function vsCodeMcpNote(binaryPath: string): string[] {
  const server = JSON.stringify({ name: MCP_NAME, command: binaryPath, args: ["mcp"] });
  return [
    "VS Code (agent mode) runs the same hooks. For the memory tools there, run once:",
    `  code --add-mcp '${server.replace(/'/g, "'\\''")}'`,
    "  or let VS Code discover Copilot CLI's servers (setting chat.mcp.discovery.enabled).",
  ];
}

export function installCopilot(context: CopilotContext): InstallResult {
  const result = installHooksFile(COPILOT, context);
  return { ...result, notes: [...result.notes, ...vsCodeMcpNote(context.binaryPath)] };
}

/** The file is ours alone: once our hooks are out of it, a file holding nothing else goes too. */
export function uninstallCopilot(context: CopilotContext): UninstallResult {
  const result = uninstallHooksFile(COPILOT, context);
  if (result.settings !== "edited" || !existsSync(context.settingsPath)) return result;
  try {
    const left = JSON.parse(readFileSync(context.settingsPath, "utf8")) as Record<string, unknown>;
    const { version, ...rest } = left;
    if (Object.keys(rest).length === 0 && (version === undefined || version === 1)) {
      rmSync(context.settingsPath);
      return { ...result, settings: "removed" };
    }
  } catch {
    // Whatever is there now is the user's to keep.
  }
  return result;
}

export const inspectCopilotHooks = (text: string) => inspectHooksFile(COPILOT, text);

/** COPILOT_HOME as the documentation gives it: a directory replacing ~/.copilot; empty is unset. */
function copilotHome(env: Record<string, string | undefined>, home: string): string {
  const value = env.COPILOT_HOME;
  if (!value) return join(home, ".copilot");
  if (value === "~" || value.startsWith("~/")) return join(home, value.slice(1));
  return resolve(value);
}

export function copilotContext(
  binaryPath: string,
  env: Record<string, string | undefined> = process.env,
): CopilotContext & { configDir: string } {
  const configDir = copilotHome(env, env.HOME || homedir());
  return {
    configDir,
    settingsPath: join(configDir, "hooks", `${MCP_NAME}.json`),
    mcpPath: join(configDir, "mcp-config.json"),
    dataDir: defaultDataDir(env),
    binaryPath,
    run,
    now: Date.now,
  };
}
