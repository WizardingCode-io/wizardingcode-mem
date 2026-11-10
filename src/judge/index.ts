import { loadSettings } from "../settings/settings.ts";
import type { Db } from "../store/db.ts";
import { getMeta, setMeta } from "../store/meta.ts";
import { logError } from "../util/log.ts";
import { Breaker } from "./breaker.ts";
import { withFallback } from "./fallback.ts";
import { heuristicJudge } from "./heuristic.ts";
import { keyFingerprint } from "./key.ts";
import type { Judge } from "./types.ts";
import { TypeSafeJudge } from "./typesafe.ts";

export interface JudgeOptions {
  db: Db;
  dataDir: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /**
   * The judge an agent's tool call waits on: a short deadline, no retries, and its own
   * usage counters. The breaker is distillation's.
   */
  toolPath?: boolean;
}

/** Counters that make the cost of TypeSafe visible in `status`. */
export const USAGE_KEYS = { requests: "typesafe.requests", inputTokens: "typesafe.input_tokens" };

/** The tools' counters, apart from distillation's. */
export const TOOL_USAGE_KEYS = {
  requests: "typesafe.tools.requests",
  inputTokens: "typesafe.tools.input_tokens",
};

/** The deadline of a tool call's one request. */
export const TOOL_JUDGE_TIMEOUT_MS = 3000;

function count(db: Db, key: string, by: number): void {
  setMeta(db, key, String(Number(getMeta(db, key) ?? 0) + by));
}

/**
 * The judge this installation uses: the heuristic one alone, unless the user
 * configured a TypeSafe key (and did not turn TypeSafe off), in which case TypeSafe
 * answers first and the heuristic judge whenever it cannot. Nothing leaves the machine
 * without a key.
 */
export function makeJudge(options: JudgeOptions): Judge {
  const env = options.env ?? process.env;
  const settings = loadSettings(env, options.dataDir);
  const key = settings.typesafeKey;
  if (key === null || settings.typesafe === "off") return heuristicJudge;
  const { db } = options;
  // Tests and, one day, a managed service stand in for the public endpoint.
  const endpoint = env.WIZARDINGCODE_MEM_TYPESAFE_URL;
  const keys = options.toolPath ? TOOL_USAGE_KEYS : USAGE_KEYS;
  const typesafe = new TypeSafeJudge({
    apiKey: key,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(options.toolPath ? { timeoutMs: TOOL_JUDGE_TIMEOUT_MS, retryDelaysMs: [] } : {}),
    onUsage: (inputTokens) => {
      count(db, keys.requests, 1);
      count(db, keys.inputTokens, inputTokens);
    },
  });
  return withFallback(
    typesafe,
    heuristicJudge,
    new Breaker(db, { keyFingerprint: keyFingerprint(key) }),
    {
      onError: (error) => logError("judge typesafe", error, options.dataDir),
    },
  );
}
