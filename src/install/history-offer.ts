import { claudeCodeRoot, listClaudeCodeTranscripts } from "../adapters/claude-code/history.ts";
import { codexRoot, listCodexTranscripts } from "../adapters/codex/history.ts";
import { HISTORY_OFFER_DISMISSED, type HistoryStatus, historyStatus } from "../history/status.ts";
import { loadSettings } from "../settings/settings.ts";
import { openDb, openExisting } from "../store/db.ts";
import { setMeta } from "../store/meta.ts";
import { resolvePaths } from "../util/paths.ts";
import { spawnDetached } from "../util/self.ts";

export interface HistoryOfferDeps {
  status: () => Pick<HistoryStatus, "transcripts"> & {
    run: Pick<HistoryStatus["run"], "state">;
    import: Pick<HistoryStatus["import"], "state">;
    offer: HistoryStatus["offer"];
  };
  historyDays: number;
  tty: boolean;
  confirm: (question: string) => boolean;
  spawn: (...args: string[]) => void;
  dismiss: () => void;
}

const LATER = "wizardingcode-mem history import";

/**
 * After an install: offers to learn from the sessions already on this machine. Nothing runs
 * unasked: a terminal is asked, anywhere else a hint is printed. Returns the lines to print.
 */
export function offerHistoryImport(flags: string[], deps: HistoryOfferDeps): string[] {
  if (flags.includes("--no-import-history")) return [];
  let found: ReturnType<HistoryOfferDeps["status"]>;
  try {
    found = deps.status();
  } catch {
    return [];
  }
  const sessions = found.transcripts.claudeCode + found.transcripts.codex;
  // Only an import counts: an index run reads the transcripts but learns nothing from them.
  if (
    sessions === 0 ||
    found.import.state !== "never" ||
    found.run.state === "running" ||
    found.offer.dismissed
  )
    return [];

  const start = (): string[] => {
    deps.spawn("history", "import");
    return ["history: importing in the background — wizardingcode-mem status shows progress"];
  };
  if (flags.includes("--import-history")) return start();
  if (!deps.tty) {
    return [`history: ${sessions} past sessions found. To learn from them, run: ${LATER}`];
  }
  const agreed = deps.confirm(
    `Found ${sessions} past sessions from Claude Code and Codex. Learn from the last ${deps.historyDays} days now, in the background? Nothing leaves this machine except TypeSafe judgements if you set a key.`,
  );
  if (agreed) return start();
  deps.dismiss();
  return [`history: skipped. To learn from past sessions later, run: ${LATER}`];
}

/** The offer wired to this machine's store, settings and transcripts. */
export function offerHistoryImportHere(
  flags: string[],
  confirm: (question: string) => boolean,
): string[] {
  const { storeDir, dataDir } = resolvePaths();
  const settings = loadSettings(process.env, dataDir);
  const roots = { claudeCode: claudeCodeRoot(), codex: codexRoot() };
  return offerHistoryImport(flags, {
    status: () => {
      // No store yet: nothing has run or been dismissed, and the install creates none just to ask.
      const db = openExisting(storeDir);
      if (db === null) {
        return {
          transcripts: {
            claudeCode: listClaudeCodeTranscripts(roots.claudeCode, 0).length,
            codex: listCodexTranscripts(roots.codex, 0).length,
          },
          run: { state: "never" as const },
          import: { state: "never" as const },
          offer: { dismissed: false },
        };
      }
      try {
        return historyStatus(db, storeDir, roots, Date.now());
      } finally {
        db.close();
      }
    },
    historyDays: settings.historyDays,
    tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    confirm,
    spawn: spawnDetached,
    dismiss: () => {
      const db = openDb({ dataDir: storeDir, busyTimeoutMs: 5000 });
      try {
        setMeta(db, HISTORY_OFFER_DISMISSED, "1");
      } finally {
        db.close();
      }
    },
  });
}
