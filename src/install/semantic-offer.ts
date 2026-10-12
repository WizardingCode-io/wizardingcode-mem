import { SEMANTIC_OFFER_DISMISSED, semanticStatus } from "../embed/status.ts";
import { openDb, openExisting } from "../store/db.ts";
import { setMeta } from "../store/meta.ts";
import { resolvePaths } from "../util/paths.ts";
import { spawnDetached } from "../util/self.ts";

export interface SemanticOfferDeps {
  state: () => { present: boolean; enabled: boolean; downloading: boolean; dismissed: boolean };
  tty: boolean;
  confirm: (question: string) => boolean;
  spawn: (...args: string[]) => void;
  dismiss: () => void;
}

export const SEMANTIC_QUESTION =
  "Download the 140 MB search model so searches also find notes by meaning? Nothing you write is sent anywhere.";
const LATER = "wizardingcode-mem embed download";

/**
 * After an install: offers the search model, once. Nothing is fetched unasked: a terminal is
 * asked, anywhere else a hint is printed. Yes downloads it in the background and then gives the
 * memories already there their vectors. Returns the lines to print.
 */
export function offerSemanticModel(flags: string[], deps: SemanticOfferDeps): string[] {
  if (flags.includes("--no-semantic")) return [];
  let found: ReturnType<SemanticOfferDeps["state"]>;
  try {
    found = deps.state();
  } catch {
    return [];
  }
  if (found.present || found.downloading) return [];
  const asked = flags.includes("--semantic");
  if (!found.enabled) {
    return asked
      ? [
          "semantic: turned off (WIZARDINGCODE_MEM_SEMANTIC=off); turn it on in the viewer's settings or the environment, then run: wizardingcode-mem embed download",
        ]
      : [];
  }
  const start = (): string[] => {
    deps.spawn("embed", "download", "--backfill");
    return [
      "semantic: downloading the search model in the background (140 MB) — wizardingcode-mem embed status shows when it is ready",
    ];
  };
  if (asked) return start();
  if (found.dismissed) return [];
  if (!deps.tty) {
    return [
      `semantic: searches can also find notes by meaning. To download the 140 MB search model, run: ${LATER}`,
    ];
  }
  if (deps.confirm(SEMANTIC_QUESTION)) return start();
  deps.dismiss();
  return [
    `semantic: skipped. To turn it on later, run: ${LATER} (or Settings → Search in the viewer)`,
  ];
}

/** The offer wired to this machine's data directory and store. */
export function offerSemanticModelHere(
  flags: string[],
  confirm: (question: string) => boolean,
): string[] {
  const { storeDir, dataDir } = resolvePaths();
  return offerSemanticModel(flags, {
    state: () => {
      // No store yet: nothing was dismissed or started, and the install creates none just to ask.
      const db = openExisting(storeDir);
      try {
        const s = semanticStatus(db, dataDir, process.env, Date.now());
        return {
          present: s.model.present,
          enabled: s.model.enabled,
          downloading: s.download.running,
          dismissed: s.offer.dismissed,
        };
      } finally {
        db?.close();
      }
    },
    tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    confirm,
    spawn: spawnDetached,
    dismiss: () => {
      const db = openDb({ dataDir: storeDir, busyTimeoutMs: 5000 });
      try {
        setMeta(db, SEMANTIC_OFFER_DISMISSED, "1");
      } finally {
        db.close();
      }
    },
  });
}
