import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Loaded before every test file (bunfig.toml). Hooks run from tests must never start a
// viewer or open a browser on the developer's machine, nor take over a real ~/.shibaox
// left by 0.3.0: the switches are off unless a test turns them on for itself. Child
// processes inherit them through process.env.
process.env.WIZARDINGCODE_MEM_UI_AUTO_OPEN ??= "off";
process.env.WIZARDINGCODE_MEM_UI_BROWSER ??= "none";
process.env.WIZARDINGCODE_MEM_MIGRATE ??= "off";
// The brand's home (the app's state file, the data directories) is always a throwaway
// directory, whatever the developer's shell exports: nothing here may touch a real
// ~/.wizardingcode. Path overrides from the shell are dropped; tests set their own.
const testHome = mkdtempSync(join(tmpdir(), "wizardingcode-test-home-"));
process.env.WIZARDINGCODE_HOME = testHome;
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
// Every variable the code reads to find a directory (an agent's home or config, the
// store, a legacy install). Dropped from the shell's environment so no test can be
// redirected to a real directory; tests that need one set it themselves. Add new ones here.
const PATH_OVERRIDES = [
  "WIZARDINGCODE_MEM_DATA_DIR",
  "WIZARDINGCODE_MEM_STORE_DIR",
  "WIZARDINGCODE_MEM_CLAUDE_MEM_DIR",
  "WIZARDINGCODE_MEM_CLAUDE_DESKTOP_CONFIG",
  "SHIBAOX_HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "QWEN_HOME",
  "COPILOT_HOME",
  "GEMINI_CLI_HOME",
  "APPDATA",
  "LOCALAPPDATA",
];
for (const name of PATH_OVERRIDES) delete process.env[name];
process.on("exit", () => rmSync(testHome, { recursive: true, force: true }));
