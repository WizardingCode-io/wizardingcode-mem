import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentId } from "../../src/core/types.ts";
import { antigravityContext, inspectAntigravityHooks } from "../../src/install/antigravity.ts";
import { inspectSettings } from "../../src/install/claude-code.ts";
import { codexContext, inspectCodexHooks } from "../../src/install/codex.ts";
import { copilotContext, inspectCopilotHooks } from "../../src/install/copilot.ts";
import { cursorContext, inspectCursorHooks } from "../../src/install/cursor.ts";
import { detectAgents } from "../../src/install/detect.ts";
import { droidContext, inspectDroidSettings } from "../../src/install/droid.ts";
import { findGeminiLeftover, geminiLeftoverContext } from "../../src/install/gemini-leftover.ts";
import { LEGACY_MCP_NAME, MCP_NAME } from "../../src/install/hooks-file.ts";
import { opencodePluginPath } from "../../src/install/opencode.ts";
import { inspectQwenSettings, qwenContext } from "../../src/install/qwen.ts";

// A read-only report of this machine: which supported agents are here, the files our
// installer would write for each, whether they exist, and whether our entries are in them.
// It writes nothing and runs no agent. Usage: bun scripts/proof/agents.ts

const env = process.env;
const home = env.HOME || homedir();
const short = (path: string) => (path.startsWith(home) ? `~${path.slice(home.length)}` : path);

const COMMAND: Record<AgentId, string> = {
  "claude-code": "claude",
  codex: "codex",
  cursor: "cursor",
  opencode: "opencode",
  qwen: "qwen",
  droid: "droid",
  copilot: "copilot",
  antigravity: "agy",
};

interface Target {
  hooks: string;
  /** The MCP file when it is not the hooks file, or null when the server lives in the hooks file. */
  mcp: string | null;
  inspect: ((text: string) => { events: string[]; binaries: string[] }) | null;
  dirs: string[];
}

const claudeDir = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
const antigravity = antigravityContext("", env);
const TARGETS: Record<AgentId, Target> = {
  "claude-code": {
    hooks: join(claudeDir, "settings.json"),
    mcp: null,
    inspect: inspectSettings,
    dirs: [claudeDir],
  },
  codex: {
    hooks: codexContext("", env).settingsPath,
    mcp: join(codexContext("", env).configDir, "config.toml"),
    inspect: inspectCodexHooks,
    dirs: [codexContext("", env).configDir],
  },
  cursor: {
    hooks: cursorContext("", env).settingsPath,
    mcp: cursorContext("", env).mcpPath ?? null,
    inspect: inspectCursorHooks,
    dirs: [cursorContext("", env).configDir],
  },
  opencode: {
    hooks: opencodePluginPath(env),
    mcp: null,
    inspect: null,
    dirs: [join(opencodePluginPath(env), "..", "..")],
  },
  qwen: {
    hooks: qwenContext("", env).settingsPath,
    mcp: null,
    inspect: inspectQwenSettings,
    dirs: [qwenContext("", env).configDir],
  },
  droid: {
    hooks: droidContext("", env).settingsPath,
    mcp: droidContext("", env).mcpPath ?? null,
    inspect: inspectDroidSettings,
    dirs: [droidContext("", env).configDir],
  },
  copilot: {
    hooks: copilotContext("", env).settingsPath,
    mcp: copilotContext("", env).mcpPath ?? null,
    inspect: inspectCopilotHooks,
    dirs: [copilotContext("", env).configDir],
  },
  antigravity: {
    hooks: antigravity.settingsPath,
    mcp: antigravity.mcpPath ?? null,
    inspect: inspectAntigravityHooks,
    dirs: [antigravity.configDir, ...antigravity.appDirs],
  },
};

const read = (path: string): string | null => {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
};
const hasServer = (text: string | null) =>
  text !== null && (text.includes(MCP_NAME) || text.includes(LEGACY_MCP_NAME));

const which = (command: string) => Bun.which(command);
const found = new Set(detectAgents({ env, which }));

console.log(`Agents on this machine (read-only; HOME shown as ~)\n`);
for (const agent of Object.keys(TARGETS) as AgentId[]) {
  const target = TARGETS[agent];
  const onPath = which(COMMAND[agent]);
  console.log(`${agent}${found.has(agent) ? "" : "   (not detected)"}`);
  console.log(`  command ${COMMAND[agent]}: ${onPath === null ? "not on PATH" : short(onPath)}`);
  for (const dir of target.dirs)
    console.log(`  dir ${short(dir)}: ${existsSync(dir) ? "exists" : "absent"}`);
  const hooksText = read(target.hooks);
  console.log(`  hooks file ${short(target.hooks)}: ${hooksText === null ? "absent" : "exists"}`);
  if (hooksText !== null) {
    if (target.inspect === null) {
      console.log(
        `    ours: ${hooksText.includes("@wizardingcode-mem-plugin") ? "present" : "no"}`,
      );
    } else {
      try {
        const ours = target.inspect(hooksText);
        console.log(
          ours.events.length === 0
            ? "    our hooks: none"
            : `    our hooks: ${ours.events.join(", ")} -> ${ours.binaries.map(short).join(", ")}`,
        );
      } catch (error) {
        console.log(
          `    our hooks: file not readable by the installer (${(error as Error).message})`,
        );
      }
    }
  }
  if (target.mcp !== null) {
    const mcpText = read(target.mcp);
    console.log(
      `  mcp file ${short(target.mcp)}: ${mcpText === null ? "absent" : `exists, our server ${hasServer(mcpText) ? "present" : "not there"}`}`,
    );
  } else if (hooksText !== null && agent !== "opencode") {
    console.log(
      `  mcp in the hooks file: our server ${hasServer(hooksText) ? "present" : "not there"}`,
    );
  }
  console.log("");
}

const leftover = findGeminiLeftover(geminiLeftoverContext(env).settingsPath);
console.log("Gemini CLI leftovers");
if (leftover === null) console.log("  none");
else {
  console.log(`  settings ${short(leftover.settingsPath)}`);
  console.log(`  hooks: ${leftover.hooks.join(", ") || "none"}`);
  console.log(`  mcp server: ${leftover.mcp ? "yes" : "no"}`);
  console.log(`  extensions: ${leftover.extensions.map(short).join(", ") || "none"}`);
  console.log("  clean with: wizardingcode-mem uninstall gemini");
}
