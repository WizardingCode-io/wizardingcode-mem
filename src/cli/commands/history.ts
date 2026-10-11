import { claudeCodeRoot } from "../../adapters/claude-code/history.ts";
import { codexRoot } from "../../adapters/codex/history.ts";
import { restoreImports } from "../../backfill/replace.ts";
import { runBackfill } from "../../backfill/run.ts";
import { makeJudge } from "../../judge/index.ts";
import { loadSettings } from "../../settings/settings.ts";
import { type Db, openDb } from "../../store/db.ts";
import { logError } from "../../util/log.ts";
import { resolvePaths } from "../../util/paths.ts";
import { EXIT_USAGE } from "../exit.ts";

const USAGE = `Usage: wizardingcode-mem history import [--days <n>] [--agent claude-code|codex] [--max-seconds <n>]
       wizardingcode-mem history restore-imports
`;

function positiveInt(argv: string[], flag: string): number | undefined | null {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;
  const value = Number(argv[at + 1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * `wizardingcode-mem history`: distils what the agents already have on disk from the
 * last days, oldest first, behind any live turn. Safe to interrupt and run again.
 */
export async function run(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== "import" && sub !== "restore-imports") {
    process.stderr.write(USAGE);
    return EXIT_USAGE;
  }
  const days = positiveInt(rest, "--days");
  const maxSeconds = positiveInt(rest, "--max-seconds");
  const agentAt = rest.indexOf("--agent");
  const agent = agentAt === -1 ? undefined : rest[agentAt + 1];
  if (
    days === null ||
    maxSeconds === null ||
    (agent !== undefined && agent !== "claude-code" && agent !== "codex")
  ) {
    process.stderr.write(`wizardingcode-mem history: bad option\n${USAGE}`);
    return EXIT_USAGE;
  }
  let db: Db | undefined;
  try {
    const { dataDir, storeDir } = resolvePaths();
    db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
    if (sub === "restore-imports") {
      process.stdout.write(`history: ${restoreImports(db)} restored\n`);
      return 0;
    }
    const report = await runBackfill(
      {
        db,
        judge: makeJudge({ db, dataDir }),
        now: Date.now,
        roots: { claudeCode: claudeCodeRoot(), codex: codexRoot() },
      },
      {
        days: days ?? loadSettings(process.env, dataDir).historyDays,
        maxMs: (maxSeconds ?? 600) * 1000,
        agents: agent === undefined ? ["claude-code", "codex"] : [agent],
      },
    );
    process.stdout.write(
      `history: ${report.transcripts} transcripts, ${report.queued} queued, ${report.known} known, ${report.skipped} skipped, ${report.distilled} distilled, ${report.replaced} imports replaced, ${report.remaining} remaining\n`,
    );
    return 0;
  } catch (error) {
    logError("history", error);
    process.stderr.write(
      `wizardingcode-mem: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    db?.close();
  }
}
