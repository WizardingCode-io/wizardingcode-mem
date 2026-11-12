import { join } from "node:path";
import pkg from "../../../package.json" with { type: "json" };
import { updateSetting } from "../../settings/settings.ts";
import { REPOSITORY } from "../../update/channels.ts";
import { checkForRelease, mode as modeOf } from "../../update/check.ts";
import { commandLines, stagedFacts, updateReport } from "../../update/report.ts";
import { lastFailed } from "../../update/state.ts";
import { defaultDataDir } from "../../util/paths.ts";

/**
 * `wizardingcode-mem update`: asks now which release is the latest and says how to get it.
 * It downloads nothing and changes nothing but the check's own state.
 */
export async function run(
  _argv: string[] = [],
  deps: { fetch: typeof fetch; now: () => number } = { fetch, now: Date.now },
): Promise<number> {
  const dataDir = defaultDataDir();
  const setting = updateSetting(process.env, dataDir);
  const mode = modeOf(setting.value, process.env);
  const facts = stagedFacts(dataDir, pkg.version);
  const report = (asked: boolean) =>
    updateReport({
      dataDir,
      env: process.env,
      now: deps.now(),
      running: pkg.version,
      facts,
      asked,
    });
  if (mode === "off" || mode === "off-unknown") {
    const where =
      setting.source === "env"
        ? "unset WIZARDINGCODE_MEM_UPDATE in this environment to turn it on"
        : `set WIZARDINGCODE_MEM_UPDATE=check in ${join(dataDir, "env")} to turn it on`;
    process.stdout.write(`${report(false).lines.join("\n")}\n${where}\n`);
    return 0;
  }
  const result = await checkForRelease({
    dataDir,
    mode,
    now: deps.now(),
    fetch: deps.fetch,
    repository: REPOSITORY,
    force: true,
  });
  process.stdout.write(`${[...report(true).lines, ...commandLines()].join("\n")}\n`);
  if (result.error !== undefined) {
    process.stderr.write(`wizardingcode-mem: could not record the check: ${result.error}\n`);
    return 1;
  }
  return result.state !== null && lastFailed(result.state) ? 1 : 0;
}
