import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentId } from "../core/types.ts";
import { antigravityContext } from "./antigravity.ts";
import { codexContext } from "./codex.ts";
import { copilotContext } from "./copilot.ts";
import { cursorContext } from "./cursor.ts";
import { droidContext } from "./droid.ts";
import { opencodePluginPath } from "./opencode.ts";
import { qwenContext } from "./qwen.ts";

// Which supported agents are on this machine: their command is on PATH, or they have
// left a configuration directory behind. Nothing is created by looking.

export const AGENT_ORDER: readonly AgentId[] = [
  "claude-code",
  "codex",
  "cursor",
  "opencode",
  "qwen",
  "droid",
  "copilot",
  "antigravity",
];

export function detectAgents(options: {
  env: Record<string, string | undefined>;
  which: (command: string) => string | null;
}): AgentId[] {
  const { env, which } = options;
  const home = env.HOME || homedir();
  const antigravity = antigravityContext("", env);
  // Antigravity has no directory of its own: its CLI, 2.0 app and IDE each keep one under ~/.gemini.
  const configDir: Record<AgentId, string | string[]> = {
    "claude-code": env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
    codex: codexContext("", env).configDir,
    cursor: cursorContext("", env).configDir,
    opencode: dirname(dirname(opencodePluginPath(env))),
    qwen: qwenContext("", env).configDir,
    droid: droidContext("", env).configDir,
    copilot: copilotContext("", env).configDir,
    antigravity: [antigravity.configDir, ...antigravity.appDirs],
  };
  const command: Record<AgentId, string> = {
    "claude-code": "claude",
    codex: "codex",
    cursor: "cursor",
    opencode: "opencode",
    qwen: "qwen",
    droid: "droid",
    copilot: "copilot",
    antigravity: "agy",
  };
  return AGENT_ORDER.filter(
    (agent) =>
      which(command[agent]) !== null || [configDir[agent]].flat().some((dir) => existsSync(dir)),
  );
}
