import type { EngineModule, Moment, MomentInput } from "./module.ts";

/**
 * Characters each moment may add to the agent's context, shared by every module. These
 * are the budgets memory had for each moment before there were modules.
 */
export const MOMENT_BUDGET: Readonly<Record<Moment, number>> = {
  "session-start": 4200,
  prompt: 2400,
  "file-read": 1200,
  "tool-failed": 1200,
};

/**
 * One moment's context: each module in order, within its share of the budget, joined by a
 * blank line. A module that throws, or says more than its share, contributes nothing; the
 * others are unaffected. Null when no module has anything to say.
 */
export function compose(
  modules: readonly EngineModule[],
  input: Omit<MomentInput, "budgetChars">,
  onError?: (moduleId: string, error: unknown) => void,
): string | null {
  const budget = MOMENT_BUDGET[input.moment];
  // Shares are taken in order: a later module gets at most what the earlier ones left.
  // Counted in characters, so that rounding can never make them sum above the budget.
  let left = budget;
  const parts: string[] = [];
  for (const module of modules) {
    const budgetChars = Math.min(left, Math.floor(clampShare(module.share) * budget));
    left -= budgetChars;
    if (module.contribute === undefined) continue;
    let text: string | null;
    try {
      text = module.contribute({ ...input, budgetChars });
    } catch (error) {
      onError?.(module.id, error);
      continue;
    }
    // Whole or not at all: half a note reads as a complete one.
    if (text === null || text === "" || text.length > budgetChars) continue;
    parts.push(text);
  }
  return parts.length === 0 ? null : parts.join("\n\n");
}

function clampShare(share: number): number {
  if (!(share > 0)) return 0;
  return Math.min(1, share);
}
