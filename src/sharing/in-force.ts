// The policy a change is made under, for every caller that changes sharing: the CLI, the
// viewer's routes, and later the sync. One sequence and one refusal, so no caller records
// what is pending differently or changes anything under a policy that could not be loaded.
import type { Env } from "../settings/settings.ts";
import type { Db } from "../store/db.ts";
import { loadPolicy } from "./policy.ts";
import { reconcileLevels, reconcileSettings } from "./store.ts";
import type { SharingPolicy } from "./types.ts";

/**
 * The policy in force once what was pending is on record: a hand edit of the env file, a
 * level its project can no longer hold. Loaded, reconciled, loaded again. Under a policy
 * that could not be loaded nothing is recorded, for the reason `sharingRefusal` gives.
 */
export function policyInForce(
  db: Db,
  dataDir: string,
  env: Env,
  now: number,
  serverId?: string,
): SharingPolicy {
  const loaded = loadPolicy(db, dataDir, env, serverId);
  if (loaded.closed) return loaded;
  reconcileSettings(db, dataDir, now);
  reconcileLevels(db, now);
  return loadPolicy(db, dataDir, env, serverId);
}

/**
 * Why nothing about sharing may be changed now: the problem of a policy that could not be
 * loaded, as the answer to whoever asked for the change; null under a policy that loaded.
 * A change made under such a policy would be written into tables this binary may not know.
 */
export function sharingRefusal(policy: SharingPolicy): string | null {
  if (!policy.closed) return null;
  return `${policy.problems[0] ?? "the sharing policy could not be loaded"}; nothing was changed`;
}
