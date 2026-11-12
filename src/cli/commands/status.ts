import pkg from "../../../package.json" with { type: "json" };
import { claudeCodeRoot } from "../../adapters/claude-code/history.ts";
import { codexRoot } from "../../adapters/codex/history.ts";
import { findProject } from "../../core/project.ts";
import { historyStatus } from "../../history/status.ts";
import { formatStatus, statusReport } from "../../status/report.ts";
import { type Db, openExisting } from "../../store/db.ts";
import { reportOrReason, type UpdateReport, updateReport } from "../../update/report.ts";
import { resolvePaths } from "../../util/paths.ts";

/** `wizardingcode-mem status [--json]`: what is stored for this project, and how wizardingcode-mem is behaving. */
export function run(
  argv: string[],
  build: (dataDir: string) => UpdateReport = (dataDir) =>
    updateReport({ dataDir, env: process.env, now: Date.now(), running: pkg.version }),
): number {
  const { dataDir, storeDir } = resolvePaths();
  const json = argv.includes("--json");
  // Read from the data directory alone, before the store: it is said also when the store
  // cannot be opened, which is when a person most needs to know which copy runs.
  const { report: update, lines } = reportOrReason(() => build(dataDir));
  const notice = [...lines, ...(update?.commands ?? [])];
  let db: Db | null = null;
  try {
    db = openExisting(storeDir);
    const project = db === null ? null : findProject(db, process.cwd());
    const now = Date.now();
    const report = statusReport(db, project, dataDir, { env: process.env, now });
    if (update !== undefined) report.update = update;
    if (db !== null) {
      report.history = historyStatus(
        db,
        storeDir,
        { claudeCode: claudeCodeRoot(), codex: codexRoot() },
        now,
      );
    }
    process.stdout.write(
      json ? `${JSON.stringify(report, null, 2)}\n` : formatStatus(report, notice),
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(
      json
        ? `${JSON.stringify({ version: pkg.version, update, error: message }, null, 2)}\n`
        : `${[`wizardingcode-mem ${pkg.version}`, ...notice].join("\n")}\n`,
    );
    process.stderr.write(`wizardingcode-mem: ${message}\n`);
    return 1;
  } finally {
    db?.close();
  }
}
