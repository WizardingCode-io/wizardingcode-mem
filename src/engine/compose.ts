import { MOMENT_BUDGET } from "./budget.ts";
import type { EngineModule, MomentInput } from "./module.ts";

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
  // The blank lines between contributions are text too: set their worst case aside first.
  const speaking = modules.filter((module) => module.contribute !== undefined).length;
  const budgets = shares(modules, budget, 2 * Math.max(0, speaking - 1));
  const parts: string[] = [];
  for (const [i, module] of modules.entries()) {
    if (module.contribute === undefined) continue;
    const budgetChars = budgets[i] ?? 0;
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

/**
 * Each module's characters for one moment, by position. Declared shares are taken first,
 * in order, each at most what the earlier ones left; then a "remainder" module gets what
 * is left over. Counted in characters, so rounding can never make them sum above the
 * budget once the separators are paid for. A module that never contributes takes nothing.
 */
function shares(modules: readonly EngineModule[], budget: number, separators: number): number[] {
  let left = Math.max(0, budget - separators);
  const out = modules.map((module) => {
    if (module.contribute === undefined || module.share === "remainder") return 0;
    const chars = Math.min(left, Math.floor(clampShare(module.share) * budget));
    left -= chars;
    return chars;
  });
  for (const [i, module] of modules.entries()) {
    if (module.contribute === undefined || module.share !== "remainder") continue;
    out[i] = left;
    left = 0;
  }
  return out;
}

function clampShare(share: number): number {
  if (!(share > 0)) return 0;
  return Math.min(1, share);
}
