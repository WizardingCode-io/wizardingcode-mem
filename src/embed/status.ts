/**
 * Where semantic search stands, as the viewer's card, `doctor` and the install offer see it:
 * the model (there, its size, switched on, readable), a download under way and its progress,
 * the backfill, and how many active memories have a vector of the model. Reads only.
 */

import { loadSettings, publicSettings, type Source } from "../settings/settings.ts";
import type { Db } from "../store/db.ts";
import { EMBED_DOWNLOAD_LEASE, EMBED_LEASE, getMeta, leaseActive } from "../store/meta.ts";
import { MODEL_BYTES } from "./download.ts";
import { loadModel, modelState } from "./model.ts";

export const PROGRESS_DONE = "embed.download.done";
export const PROGRESS_TOTAL = "embed.download.total";
/** Why the last download failed; cleared when the next one starts or one succeeds. */
export const DOWNLOAD_ERROR = "embed.download.error";
/** Declined at the install prompt: neither install nor anything else asks again. */
export const SEMANTIC_OFFER_DISMISSED = "embed.offer.dismissed";

export interface SemanticStatus {
  model: {
    present: boolean;
    bytes: number;
    /** What the download fetches, for the card before there is a file. */
    expectedBytes: number;
    enabled: boolean;
    /** Where the switch comes from: the environment wins over the settings file. */
    source: Source;
    /** Why a present, switched-on model cannot be used; null when it can. */
    problem: string | null;
  };
  download: { running: boolean; done: number; total: number; error: string | null };
  backfill: { running: boolean };
  memories: { active: number; withVectors: number };
  offer: { dismissed: boolean };
}

const count = (db: Db, sql: string, ...args: string[]): number =>
  db.query<{ n: number }, string[]>(sql).get(...args)?.n ?? 0;

const numberMeta = (db: Db, key: string): number => {
  const n = Number(getMeta(db, key) ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Never opens or creates the database: the caller passes one, or null when there is none. */
export function semanticStatus(
  db: Db | null,
  dataDir: string,
  env: Record<string, string | undefined>,
  now: number,
): SemanticStatus {
  const state = modelState(dataDir, env);
  const enabled = loadSettings(env, dataDir).semantic === "on";
  const source = publicSettings(env, dataDir).WIZARDINGCODE_MEM_SEMANTIC.source;
  const model = {
    present: state.present,
    bytes: state.bytes,
    expectedBytes: MODEL_BYTES,
    enabled,
    source,
    problem: state.present && enabled ? state.reason : null,
  };
  if (db === null) {
    return {
      model,
      download: { running: false, done: 0, total: 0, error: null },
      backfill: { running: false },
      memories: { active: 0, withVectors: 0 },
      offer: { dismissed: false },
    };
  }
  const running = leaseActive(db, EMBED_DOWNLOAD_LEASE, now);
  const active = count(db, "SELECT count(*) AS n FROM memories WHERE status = 'active'");
  // Vectors of the model in place; of any model when it is switched off or unreadable.
  const loaded = state.present && enabled ? loadModel({ dataDir, env }) : null;
  const withVectors = loaded
    ? count(
        db,
        `SELECT count(*) AS n FROM memories m JOIN memory_vectors v ON v.memory_id = m.id
         WHERE m.status = 'active' AND v.model = ?`,
        loaded.id,
      )
    : count(
        db,
        `SELECT count(*) AS n FROM memories m JOIN memory_vectors v ON v.memory_id = m.id
         WHERE m.status = 'active'`,
      );
  return {
    model,
    download: {
      running,
      done: running ? numberMeta(db, PROGRESS_DONE) : 0,
      total: running ? numberMeta(db, PROGRESS_TOTAL) : 0,
      error: getMeta(db, DOWNLOAD_ERROR),
    },
    backfill: { running: leaseActive(db, EMBED_LEASE, now) },
    memories: { active, withVectors },
    offer: { dismissed: getMeta(db, SEMANTIC_OFFER_DISMISSED) === "1" },
  };
}
