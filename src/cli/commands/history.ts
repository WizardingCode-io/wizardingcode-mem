import { statSync } from "node:fs";
import { claudeCodeRoot } from "../../adapters/claude-code/history.ts";
import { codexRoot } from "../../adapters/codex/history.ts";
import { replaceAllImports, restoreImports } from "../../backfill/replace.ts";
import { runBackfill } from "../../backfill/run.ts";
import { loadModel } from "../../embed/model.ts";
import { HISTORY_DB_FILE, openHistoryDb } from "../../history/db.ts";
import { type IndexReport, indexAll, indexTranscript } from "../../history/index-pass.ts";
import { forgetHistoryIndex, withHistoryRun } from "../../history/run-state.ts";
import { historyReadFailure, renderHits, searchHistory } from "../../history/search.ts";
import { makeJudge } from "../../judge/index.ts";
import { loadSettings } from "../../settings/settings.ts";
import { type Db, openDb, openExisting } from "../../store/db.ts";
import { HISTORY_LEASE, leaseActive } from "../../store/meta.ts";
import { logError } from "../../util/log.ts";
import { resolvePaths } from "../../util/paths.ts";
import { EXIT_USAGE } from "../exit.ts";

const USAGE = `Usage: wizardingcode-mem history import [--days <n>] [--agent claude-code|codex] [--max-seconds <n>]
       wizardingcode-mem history index [--agent claude-code|codex] [--max-seconds <n>]
       wizardingcode-mem history index --transcript <file> --agent claude-code|codex
       wizardingcode-mem history search <words...> [--project <name>] [--limit <n>]
       wizardingcode-mem history forget
       wizardingcode-mem history replace-imports
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
  if (
    sub !== "import" &&
    sub !== "index" &&
    sub !== "search" &&
    sub !== "forget" &&
    sub !== "replace-imports" &&
    sub !== "restore-imports"
  ) {
    process.stderr.write(USAGE);
    return EXIT_USAGE;
  }
  const limit = positiveInt(rest, "--limit");
  const projectAt = rest.indexOf("--project");
  const projectName = projectAt === -1 ? undefined : rest[projectAt + 1];
  const days = positiveInt(rest, "--days");
  const maxSeconds = positiveInt(rest, "--max-seconds");
  const agentAt = rest.indexOf("--agent");
  const agent = agentAt === -1 ? undefined : rest[agentAt + 1];
  const transcriptAt = rest.indexOf("--transcript");
  const transcript = transcriptAt === -1 ? undefined : rest[transcriptAt + 1];
  if (
    (transcriptAt !== -1 &&
      (sub !== "index" ||
        transcript === undefined ||
        transcript.startsWith("--") ||
        agent === undefined)) ||
    days === null ||
    maxSeconds === null ||
    limit === null ||
    (projectAt !== -1 && (projectName === undefined || projectName.startsWith("--"))) ||
    (agent !== undefined && agent !== "claude-code" && agent !== "codex")
  ) {
    process.stderr.write(`wizardingcode-mem history: bad option\n${USAGE}`);
    return EXIT_USAGE;
  }
  const words = (): string => {
    const flags = new Set(["--project", "--limit"]);
    const out: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const word = rest[i] as string;
      if (flags.has(word)) i++;
      else out.push(word);
    }
    return out.join(" ").trim();
  };
  const query = sub === "search" ? words() : "";
  if (sub === "search" && query === "") {
    process.stderr.write(`wizardingcode-mem history: search needs words\n${USAGE}`);
    return EXIT_USAGE;
  }
  let db: Db | undefined;
  try {
    const { dataDir, storeDir } = resolvePaths();
    if (sub === "forget") {
      // Only read for the lease: no main database means no run, and none is created.
      const probe = openExisting(storeDir, { allowNewer: true });
      try {
        if (probe !== null && leaseActive(probe, HISTORY_LEASE, Date.now())) {
          process.stderr.write(
            "history forget: a history run is going; try again when it finishes\n",
          );
          return 1;
        }
      } finally {
        probe?.close();
      }
      forgetHistoryIndex(storeDir);
      process.stdout.write("history forget: index deleted\n");
      return 0;
    }
    if (sub === "search") {
      let hdb: ReturnType<typeof openHistoryDb> = null;
      try {
        hdb = openHistoryDb(storeDir, { create: false, busyTimeoutMs: 2000 });
        if (hdb === null) {
          process.stdout.write(
            "history search: no history index yet — run wizardingcode-mem history import\n",
          );
          return 0;
        }
        const hits = searchHistory(hdb, { query, projectName, limit });
        process.stdout.write(
          hits.length === 0 ? "history search: no matches\n" : `${renderHits(hits)}\n`,
        );
        return 0;
      } catch (error) {
        logError("history search", error);
        process.stderr.write(`${historyReadFailure(error)}\n`);
        return 1;
      } finally {
        hdb?.close();
      }
    }
    db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
    if (sub === "replace-imports") {
      const done = replaceAllImports(db, { now: Date.now() });
      process.stdout.write(
        `history: ${done.archived} imports archived, ${done.spared} spared as confirmed, ${done.projects} projects\n`,
      );
      return 0;
    }
    if (sub === "restore-imports") {
      process.stdout.write(`history: ${restoreImports(db)} restored\n`);
      return 0;
    }
    const roots = { claudeCode: claudeCodeRoot(), codex: codexRoot() };
    const agents: ("claude-code" | "codex")[] =
      agent === undefined ? ["claude-code", "codex"] : [agent as "claude-code" | "codex"];
    const runIndex = (budgetMs: number, onProgress?: () => void): IndexReport => {
      const hdb = openHistoryDb(storeDir, { create: true, busyTimeoutMs: 2000 });
      if (hdb === null) throw new Error(`${HISTORY_DB_FILE} could not be opened`);
      try {
        return indexAll(hdb, db as Db, roots, {
          now: Date.now(),
          maxMs: budgetMs,
          agents,
          onProgress,
        });
      } finally {
        hdb.close();
      }
    };
    const indexLine = (r: IndexReport): string =>
      `history index: ${r.files} files, ${r.indexed} indexed, ${r.unchanged} unchanged, ${r.removed} removed, ${r.turns} turns, ${r.failed} failed\n`;
    const already = "history: already running\n";
    if (sub === "index" && transcript !== undefined) {
      // The session-end hook runs this: it updates an index the user has, never makes one,
      // so a `history forget` stays forgotten.
      const hdb = openHistoryDb(storeDir, { create: false, write: true, busyTimeoutMs: 2000 });
      if (hdb === null) return 0;
      try {
        const stat = statSync(transcript);
        const before = hdb
          .query<{ size: number; mtime: number }, [string]>(
            "SELECT size, mtime FROM files WHERE path = ?",
          )
          .get(transcript);
        const unchanged = before?.size === stat.size && before.mtime === Math.trunc(stat.mtimeMs);
        const turns = unchanged
          ? 0
          : indexTranscript(hdb, db, agent as "claude-code" | "codex", transcript, {
              now: Date.now(),
              projects: new Map(),
            });
        process.stdout.write(
          `history index: 1 files, ${unchanged ? 0 : 1} indexed, ${unchanged ? 1 : 0} unchanged, 0 removed, ${turns} turns, 0 failed\n`,
        );
      } finally {
        hdb.close();
      }
      return 0;
    }
    if (sub === "index") {
      const ran = await withHistoryRun(db, Date.now, "index", (renew) =>
        runIndex((maxSeconds ?? 600) * 1000, renew),
      );
      process.stdout.write(ran === null ? already : indexLine(ran.report));
      return 0;
    }
    const budgetMs = (maxSeconds ?? 600) * 1000;
    const ran = await withHistoryRun(db, Date.now, "import", async (renew) => {
      const started = Date.now();
      const backfill = await runBackfill(
        {
          db: db as Db,
          judge: makeJudge({ db: db as Db, dataDir }),
          now: Date.now,
          roots,
          model: loadModel({ dataDir }),
        },
        {
          days: days ?? loadSettings(process.env, dataDir).historyDays,
          maxMs: budgetMs,
          agents,
          onProgress: renew,
        },
      );
      process.stdout.write(
        `history: ${backfill.transcripts} transcripts, ${backfill.queued} queued, ${backfill.known} known, ${backfill.skipped} skipped (window ${backfill.skippedBy.window}, host ${backfill.skippedBy.host}, disabled ${backfill.skippedBy.disabled}, unresolved ${backfill.skippedBy.unresolved}), ${backfill.distilled} distilled, ${backfill.remaining} remaining, ${backfill.ready} projects ready for replace-imports\n`,
      );
      // The index pass gets what the backfill left, and at least a few seconds.
      const index = runIndex(Math.max(5000, budgetMs - (Date.now() - started)), renew);
      process.stdout.write(indexLine(index));
      return { ...backfill, index };
    });
    if (ran === null) process.stdout.write(already);
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
