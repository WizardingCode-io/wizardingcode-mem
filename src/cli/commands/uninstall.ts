import { uninstallClaudeCode } from "../../install/claude-code.ts";
import { claudeDesktopConfigPath, uninstallClaudeDesktop } from "../../install/claude-desktop.ts";
import { codexContext, uninstallCodex } from "../../install/codex.ts";
import { claudeCodeContext } from "../../install/context.ts";
import { cursorContext, uninstallCursor } from "../../install/cursor.ts";
import { geminiContext, uninstallGemini } from "../../install/gemini.ts";
import { opencodePluginPath, uninstallOpenCode } from "../../install/opencode.ts";
import { qwenContext, uninstallQwen } from "../../install/qwen.ts";
import { defaultDataDir } from "../../util/paths.ts";
import { EXIT_USAGE } from "../exit.ts";
import { AGENT_NAMES, SUPPORTED_AGENTS } from "./install.ts";

const OUTCOME = {
  restored: "put back exactly as it was",
  removed: "removed (wizardingcode-mem had created it)",
  edited: "wizardingcode-mem's entries removed, everything else kept",
  untouched: "had nothing of wizardingcode-mem's in it",
} as const;

/** `wizardingcode-mem uninstall <agent>`: removes what install wrote. Memories are never deleted. */
export function run(argv: string[]): number {
  const [agent] = argv;
  if (agent === undefined || !SUPPORTED_AGENTS.includes(agent)) {
    process.stderr.write(
      `wizardingcode-mem uninstall: unknown agent "${agent ?? ""}". Supported: ${SUPPORTED_AGENTS.join(", ")}\n`,
    );
    return EXIT_USAGE;
  }
  try {
    if (agent === "claude-desktop") {
      const configPath = claudeDesktopConfigPath();
      const removed = uninstallClaudeDesktop({ configPath });
      process.stdout.write(
        [
          "Removed wizardingcode-mem from Claude Desktop.",
          `  ${configPath}: ${removed ? "server removed" : "had nothing of wizardingcode-mem's in it"}`,
          "  The plugin, if you added it in Customize → Plugins, is removed there.",
          `Your memories are still in ${defaultDataDir()}. Delete that folder to remove them.`,
          "",
        ].join("\n"),
      );
      return 0;
    }
    if (agent === "opencode") {
      const result = uninstallOpenCode({ pluginPath: opencodePluginPath() });
      const outcome = {
        removed: "removed",
        kept: "left alone (not written by wizardingcode-mem)",
        absent: "was not there",
      }[result.plugin];
      process.stdout.write(
        [
          "Removed wizardingcode-mem from OpenCode.",
          `  ${result.pluginPath}: ${outcome}`,
          `Your memories are still in ${defaultDataDir()}. Delete that folder to remove them.`,
          "",
        ].join("\n"),
      );
      return 0;
    }
    const result =
      agent === "codex"
        ? uninstallCodex(codexContext(""))
        : agent === "gemini"
          ? uninstallGemini(geminiContext(""))
          : agent === "cursor"
            ? uninstallCursor(cursorContext(""))
            : agent === "qwen"
              ? uninstallQwen(qwenContext(""))
              : uninstallClaudeCode(claudeCodeContext(""));
    process.stdout.write(
      [
        `Removed wizardingcode-mem from ${AGENT_NAMES[agent]}.`,
        `  ${result.settingsPath}: ${OUTCOME[result.settings]}`,
        `Your memories are still in ${defaultDataDir()}. Delete that folder to remove them.`,
        "",
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    process.stderr.write(
      `wizardingcode-mem uninstall: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
