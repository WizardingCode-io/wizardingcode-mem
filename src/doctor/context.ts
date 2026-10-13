import { homedir } from "node:os";
import { join } from "node:path";
import { antigravityContext } from "../install/antigravity.ts";
import { claudeDesktopConfigPath } from "../install/claude-desktop.ts";
import { codexContext } from "../install/codex.ts";
import { copilotContext } from "../install/copilot.ts";
import { cursorContext } from "../install/cursor.ts";
import { droidContext } from "../install/droid.ts";
import { geminiLeftoverContext } from "../install/gemini-leftover.ts";
import { opencodePluginPath } from "../install/opencode.ts";
import { qwenContext } from "../install/qwen.ts";
import { storeDirOf } from "../util/paths.ts";
import type { DoctorContext } from "./checks.ts";

/**
 * Where everything is on this machine, as `doctor` and the viewer's Agents panel see it.
 * `cwd`, given by `doctor` only, is the folder whose project's knowledge it looks at.
 */
export function doctorContext(dataDir: string, now = Date.now(), cwd?: string): DoctorContext {
  return {
    ...(cwd === undefined ? {} : { cwd }),
    env: process.env,
    dataDir,
    storeDir: storeDirOf(dataDir),
    settingsPath: join(
      process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
      "settings.json",
    ),
    codexHooksPath: codexContext("").settingsPath,
    cursorHooksPath: cursorContext("").settingsPath,
    geminiSettingsPath: geminiLeftoverContext().settingsPath,
    opencodePluginPath: opencodePluginPath(),
    qwenSettingsPath: qwenContext("").settingsPath,
    droidSettingsPath: droidContext("").settingsPath,
    copilotHooksPath: copilotContext("").settingsPath,
    antigravityHooksPath: antigravityContext("").settingsPath,
    claudeDesktopConfigPath: claudeDesktopConfigPath(),
    which: (command) => Bun.which(command),
    now,
    legacyVariables: Object.keys(process.env)
      .filter((name) => name.startsWith("SHIBAOX_") && process.env[name] !== "")
      .sort(),
  };
}
