import { claudeCodeRoot } from "../../adapters/claude-code/history.ts";
import { codexRoot } from "../../adapters/codex/history.ts";
import { findProject } from "../../core/project.ts";
import { historyStatus } from "../../history/status.ts";
import { formatStatus, statusReport } from "../../status/report.ts";
import { type Db, openExisting } from "../../store/db.ts";
import { resolvePaths } from "../../util/paths.ts";

/** `wizardingcode-mem status [--json]`: what is stored for this project, and how wizardingcode-mem is behaving. */
export function run(argv: string[]): number {
  const { dataDir, storeDir } = resolvePaths();
  let db: Db | null = null;
  try {
    db = openExisting(storeDir);
    const project = db === null ? null : findProject(db, process.cwd());
    const report = statusReport(db, project, dataDir);
    if (db !== null) {
      report.history = historyStatus(
        db,
        storeDir,
        { claudeCode: claudeCodeRoot(), codex: codexRoot() },
        Date.now(),
      );
    }
    process.stdout.write(
      argv.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : formatStatus(report),
    );
    return 0;
  } catch (error) {
    process.stderr.write(
      `wizardingcode-mem: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    db?.close();
  }
}
