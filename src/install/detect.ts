import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentId } from "../core/types.ts";
import { codexContext } from "./codex.ts";
import { cursorContext } from "./cursor.ts";
import { droidContext } from "./droid.ts";
import { geminiContext } from "./gemini.ts";
import { opencodePluginPath } from "./opencode.ts";
import { qwenContext } from "./qwen.ts";

// Which supported agents are on this machine: their command is on PATH, or they have
// left a configuration directory behind. Nothing is created by looking.

export const AGENT_ORDER: readonly AgentId[] = [
  "claude-code",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  "qwen",
  "droid",
];

export function detectAgents(options: {
  env: Record<string, string | undefined>;
  which: (command: string) => string | null;
}): AgentId[] {
  const { env, which } = options;
  const home = env.HOME || homedir();
  const configDir: Record<AgentId, string> = {
    "claude-code": env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
    codex: codexContext("", env).configDir,
    cursor: cursorContext("", env).configDir,
    gemini: geminiContext("", env).configDir,
    opencode: dirname(dirname(opencodePluginPath(env))),
    qwen: qwenContext("", env).configDir,
    droid: droidContext("", env).configDir,
  };
  const command: Record<AgentId, string> = {
    "claude-code": "claude",
    codex: "codex",
    cursor: "cursor",
    gemini: "gemini",
    opencode: "opencode",
    qwen: "qwen",
    droid: "droid",
  };
  return AGENT_ORDER.filter(
    (agent) => which(command[agent]) !== null || existsSync(configDir[agent]),
  );
}
