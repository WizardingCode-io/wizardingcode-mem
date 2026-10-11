import { homedir } from "node:os";
import { join } from "node:path";
import { claudeDesktopConfigPath } from "../install/claude-desktop.ts";
import { codexContext } from "../install/codex.ts";
import { cursorContext } from "../install/cursor.ts";
import { geminiContext } from "../install/gemini.ts";
import { opencodePluginPath } from "../install/opencode.ts";
import { qwenContext } from "../install/qwen.ts";
import { storeDirOf } from "../util/paths.ts";
import type { DoctorContext } from "./checks.ts";

/** Where everything is on this machine, as `doctor` and the viewer's Agents panel see it. */
export function doctorContext(dataDir: string, now = Date.now()): DoctorContext {
  return {
    dataDir,
    storeDir: storeDirOf(dataDir),
    settingsPath: join(
      process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
      "settings.json",
    ),
    codexHooksPath: codexContext("").settingsPath,
    cursorHooksPath: cursorContext("").settingsPath,
    geminiSettingsPath: geminiContext("").settingsPath,
    opencodePluginPath: opencodePluginPath(),
    qwenSettingsPath: qwenContext("").settingsPath,
    claudeDesktopConfigPath: claudeDesktopConfigPath(),
    which: (command) => Bun.which(command),
    now,
    legacyVariables: Object.keys(process.env)
      .filter((name) => name.startsWith("SHIBAOX_") && process.env[name] !== "")
      .sort(),
  };
}
