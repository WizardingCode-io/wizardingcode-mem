import { ADAPTERS } from "../../adapters/index.ts";
import { drainQueue } from "../../distill/queue.ts";
import { healLine, healVectors } from "../../embed/backfill.ts";
import { loadModel } from "../../embed/model.ts";
import { makeJudge } from "../../judge/index.ts";
import { proposeRulesSafely } from "../../links/rules.ts";
import { suggestLinksSafely } from "../../links/suggest.ts";
import { type Db, openDb } from "../../store/db.ts";
import { logError } from "../../util/log.ts";
import { resolvePaths } from "../../util/paths.ts";

const MAX_TURNS = 50;
const MAX_MS = 30_000;

/**
 * `wizardingcode-mem distill`: turns queued turns into memories. Hooks start it in the
 * background; it can also be run by hand. Only one instance works at a time.
 */
export async function run(): Promise<number> {
  let db: Db | undefined;
  try {
    const { dataDir, storeDir } = resolvePaths();
    db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
    const judge = makeJudge({ db, dataDir });
    const report = await drainQueue(
      {
        db,
        judge,
        adapters: ADAPTERS,
        now: Date.now,
        // Once per drain, in this background process; hooks never load it.
        model: loadModel({ dataDir }),
      },
      { owner: `${process.pid}-${crypto.randomUUID()}`, maxTurns: MAX_TURNS, maxMs: MAX_MS },
    );
    process.stdout.write(
      `distill: ${report.claimed} claimed, ${report.done} done, ${report.skipped} skipped, ${report.failed} failed\n`,
    );
    // Memories written without the model (imports, edits while it was off, a download that
    // came later) get their vector here, a bounded pass at a time: nobody has to run a backfill.
    const model = loadModel({ dataDir });
    const healed = await healVectors(db, model, { now: Date.now });
    if (healed) process.stdout.write(healLine(healed));
    // Proposals for linked projects: exact rules over remotes and manifests, bounded, never fatal.
    suggestLinksSafely(db, Date.now());
    // The author's own rules: proposed from the newest conventions and decisions, bounded, never fatal.
    await proposeRulesSafely(db, { judge, now: Date.now(), model });
    return 0;
  } catch (error) {
    logError("distill", error);
    process.stderr.write(
      `wizardingcode-mem: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    db?.close();
  }
}
