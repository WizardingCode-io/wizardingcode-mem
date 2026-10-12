import { basename } from "node:path";
import {
  HOOK_TIMEOUT_SECONDS,
  type HostSpec,
  type InstallContext,
  type InstallResult,
  inspectHooksFile,
  installHooksFile,
  isOurBinaryName,
  MCP_NAME,
  type UninstallResult,
  uninstallHooksFile,
} from "./hooks-file.ts";

export type { InstallContext, InstallResult, UninstallResult } from "./hooks-file.ts";

// Claude Code: ~/.claude/settings.json, hooks in exec form (`command` + `args`, no shell).

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const CLAUDE_CODE: HostSpec = {
  agent: "claude-code",
  events: [
    ["SessionStart", "session-start"],
    ["UserPromptSubmit", "prompt"],
    ["Stop", "turn-end"],
    ["SessionEnd", "session-end"],
    // Matchers: without one, Claude Code would call us after every tool.
    ["PostToolUse", "file-read", "Read"],
    // ["PostToolUseFailure", "tool-failed", "Bash"] is held: on real history 83% of failures injected, with unrelated notes (ADR 0015); it returns only once a narrowed version passes the bar set there.
  ],
  entry: (binaryPath, event) => ({
    type: "command",
    command: binaryPath,
    args: ["hook", "claude-code", event],
    timeout: HOOK_TIMEOUT_SECONDS,
  }),
  isOurs(hook) {
    if (!isObject(hook) || typeof hook.command !== "string" || !Array.isArray(hook.args)) {
      return false;
    }
    return (
      isOurBinaryName(basename(hook.command)) &&
      hook.args[0] === "hook" &&
      hook.args[1] === "claude-code"
    );
  },
  binaryOf: (hook) => hook.command as string,
  mcpAdd: (binaryPath) => [
    "claude",
    "mcp",
    "add",
    "--scope",
    "user",
    MCP_NAME,
    "--",
    binaryPath,
    "mcp",
  ],
  mcpRemove: ["claude", "mcp", "remove", "--scope", "user", MCP_NAME],
  notes: [],
};

export const installClaudeCode = (context: InstallContext): InstallResult =>
  installHooksFile(CLAUDE_CODE, context);
export const uninstallClaudeCode = (context: InstallContext): UninstallResult =>
  uninstallHooksFile(CLAUDE_CODE, context);
export const inspectSettings = (text: string) => inspectHooksFile(CLAUDE_CODE, text);
export const HOOKED_EVENTS: readonly string[] = [
  ...new Set(CLAUDE_CODE.events.map(([hostEvent]) => hostEvent)),
];
