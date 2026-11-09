import { loadSettings } from "../../settings/settings.ts";
import type { Db } from "../../store/db.ts";
import { GIT_TIMEOUT_MS } from "./repo.ts";
import type { KnowledgeStore } from "./types.ts";

/**
 * The handle every function of the store takes. The environment and the clock are fixed
 * here, once: no later code reads `process.env` or `Date.now` on its own.
 */
export function openStore(options: {
  db: Db;
  dataDir: string;
  env?: Record<string, string | undefined>;
  now?: () => number;
  gitTimeoutMs?: number;
}): KnowledgeStore {
  const env = options.env ?? process.env;
  return {
    db: options.db,
    dataDir: options.dataDir,
    env,
    now: options.now ?? Date.now,
    settings: loadSettings(env, options.dataDir),
    gitTimeoutMs: options.gitTimeoutMs ?? GIT_TIMEOUT_MS,
    renew: null,
  };
}
