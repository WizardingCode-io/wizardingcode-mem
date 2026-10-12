import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Loaded before every test file (bunfig.toml). Hooks run from tests must never start a
// viewer or open a browser on the developer's machine, nor take over a real ~/.shibaox
// left by 0.3.0: the switches are off unless a test turns them on for itself. Child
// processes inherit them through process.env.
process.env.WIZARDINGCODE_MEM_UI_AUTO_OPEN ??= "off";
process.env.WIZARDINGCODE_MEM_UI_BROWSER ??= "none";
process.env.WIZARDINGCODE_MEM_MIGRATE ??= "off";
// The brand's home (the app's state file, the data directories) is a throwaway
// directory unless a test points it elsewhere: nothing here may touch ~/.wizardingcode.
process.env.WIZARDINGCODE_HOME ??= mkdtempSync(join(tmpdir(), "wizardingcode-test-home-"));
