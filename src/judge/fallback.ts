import type { Breaker } from "./breaker.ts";
import { TypeSafeError } from "./client.ts";
import type { Judge, PersonalVerdict } from "./types.ts";

/** No judge could say whether a rule is personal: it stands, and the author decides. */
const UNJUDGED: PersonalVerdict = { personal: true, confidence: 0 };

export interface FallbackOptions {
  onError?: (error: unknown) => void;
  now?: () => number;
}

/**
 * A judge that asks the primary and, when it cannot answer, the fallback. The primary
 * is skipped while the breaker is open. Every verdict says which judge gave it.
 */
export function withFallback(
  primary: Judge,
  fallback: Judge,
  breaker: Breaker,
  options: FallbackOptions,
): Judge {
  const now = options.now ?? Date.now;

  const attempt = async <T>(viaPrimary: () => Promise<T>, viaFallback: () => Promise<T>) => {
    if (!breaker.allow(now())) return viaFallback();
    try {
      const verdict = await viaPrimary();
      breaker.success(now());
      return verdict;
    } catch (error) {
      options.onError?.(error);
      // A malformed request is our bug, not the service's: it says nothing about
      // whether the next request will get through.
      if (!(error instanceof TypeSafeError && error.kind === "invalid")) {
        breaker.failure(error instanceof TypeSafeError ? error.kind : "network", now());
      }
      return viaFallback();
    }
  };

  const judge: Judge = {
    name: "fallback",
    version: `${primary.version}+${fallback.version}`,
    versions: { ...fallback.versions, ...primary.versions },
    distill: (input) =>
      attempt(
        () => primary.distill(input),
        () => fallback.distill(input),
      ),
    consolidate: (input) =>
      attempt(
        () => primary.consolidate(input),
        () => fallback.consolidate(input),
      ),
  };
  const personal = primary.personal?.bind(primary);
  if (personal) {
    const other = fallback.personal?.bind(fallback);
    judge.personal = (input) =>
      attempt(
        () => personal(input),
        async () => (other ? other(input) : UNJUDGED),
      );
  }
  return judge;
}
