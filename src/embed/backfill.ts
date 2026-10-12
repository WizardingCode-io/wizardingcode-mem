/**
 * Gives a vector to every memory that lacks one of the loaded model: memories written while the
 * model was absent, imports, and rows of an older model. One run at a time, under the embed lease
 * (which also keeps a move or a restore away); resumable, since each batch commits on its own.
 */

import { type Db, withWrite } from "../store/db.ts";
import {
  claimLease,
  EMBED_DOWNLOAD_LEASE,
  EMBED_LEASE,
  leaseActive,
  releaseLease,
} from "../store/meta.ts";
import type { Model } from "./model.ts";
import { writeMemoryVector } from "./vectors.ts";

const BATCH = 64;
const LEASE_MS = 60_000;

// Superseded memories never come back; archived ones can, and should do so with a vector.
const TODO = `FROM memories m LEFT JOIN memory_vectors v ON v.memory_id = m.id
  WHERE m.status <> 'superseded' AND (v.memory_id IS NULL OR v.model <> ?)`;

/** Null when another run holds the lease. */
export async function runEmbedBackfill(
  db: Db,
  model: Model,
  /** `owner`: the holder of a lease handed over to this run (a download that came first). */
  options: { limit?: number; now: () => number; owner?: string },
): Promise<{ written: number; remaining: number } | null> {
  const owner = options.owner ?? `${process.pid}-${crypto.randomUUID()}`;
  if (!claimLease(db, EMBED_LEASE, owner, options.now(), LEASE_MS)) return null;
  let written = 0;
  let selected = 0;
  // A cursor, so a row that fails to write is not picked again in the same run.
  let after = 0;
  try {
    for (;;) {
      const want = Math.min(BATCH, (options.limit ?? Number.POSITIVE_INFINITY) - selected);
      if (want <= 0) break;
      // Selected and written in one transaction: a concurrent edit or drain either lands
      // before (and is read here) or after (and replaces this row); no row is written twice.
      const done = withWrite(db, () => {
        const rows = db
          .query<{ id: number; title: string; body: string }, [string, number, number]>(
            `SELECT m.id, m.title, m.body ${TODO} AND m.id > ? ORDER BY m.id LIMIT ?`,
          )
          .all(model.id, after, want);
        for (const row of rows) {
          if (writeMemoryVector(db, model, row.id, row.title, row.body)) written++;
        }
        return rows;
      });
      selected += done.length;
      if (done.length < want) break;
      after = done[done.length - 1]?.id ?? after;
      if (!claimLease(db, EMBED_LEASE, owner, options.now(), LEASE_MS)) break;
      // Let the rest of the process (the viewer's requests) run between batches.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    releaseLease(db, EMBED_LEASE, owner);
  }
  const remaining =
    db.query<{ n: number }, [string]>(`SELECT count(*) AS n ${TODO}`).get(model.id)?.n ?? 0;
  return { written, remaining };
}

/** What a background command prints after an automatic pass. */
export const healLine = (out: { written: number; remaining: number }): string =>
  `embed: ${out.written} vectors written, ${out.remaining} remaining\n`;

/** How many vectors one automatic pass writes at most; the next background run continues. */
export const HEAL_LIMIT = 500;

/**
 * The automatic pass at the end of background work (a drain, a history import): memories written
 * while the model was absent or switched off, imports, edits, get their vector without anyone
 * running `embed backfill`. Never on the hook path. Null, and no write at all, when there is no
 * model, nothing missing, or a backfill or a download already holds its lease.
 */
export async function healVectors(
  db: Db,
  model: Model | null,
  options: { now: () => number; limit?: number },
): Promise<{ written: number; remaining: number } | null> {
  if (model === null) return null;
  const at = options.now();
  if (leaseActive(db, EMBED_LEASE, at) || leaseActive(db, EMBED_DOWNLOAD_LEASE, at)) return null;
  if (db.query<{ x: number }, [string]>(`SELECT 1 AS x ${TODO} LIMIT 1`).get(model.id) === null) {
    return null;
  }
  return runEmbedBackfill(db, model, { now: options.now, limit: options.limit ?? HEAL_LIMIT });
}
