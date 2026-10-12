import { MOMENT_BUDGET } from "./budget.ts";
import type { EngineModule, MomentInput } from "./module.ts";

/**
 * One moment's context: each module in order, within its share of the budget, joined by a
 * blank line. A module that throws, or says more than its share, contributes nothing; the
 * others are unaffected. Null when no module has anything to say.
 *
 * Modules with a declared share are asked first; a "remainder" module (memory's) is asked
 * last and given what they actually used subtracted from the budget, not what they might
 * have used: a module with nothing to say leaves the remainder exactly the whole budget,
 * so memory alone, or beside modules that are silent, says what it always said.
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
  const parts: (string | null)[] = modules.map(() => null);
  const ask = (i: number, module: EngineModule, budgetChars: number): void => {
    if (module.contribute === undefined) return;
    let text: string | null;
    try {
      text = module.contribute({ ...input, budgetChars });
    } catch (error) {
      onError?.(module.id, error);
      return;
    }
    // Whole or not at all: half a note reads as a complete one.
    if (text === null || text === "" || text.length > budgetChars) return;
    parts[i] = text;
  };
  for (const [i, module] of modules.entries()) {
    if (module.share !== "remainder") ask(i, module, budgets[i] ?? 0);
  }
  // What the declared modules said, and one blank line to join each of them to the rest.
  let left = budget;
  for (const part of parts) if (part !== null) left -= part.length + 2;
  for (const [i, module] of modules.entries()) {
    if (module.share !== "remainder" || module.contribute === undefined) continue;
    ask(i, module, Math.max(0, left));
    // A second remainder module gets nothing: the first had all that was left.
    left = 0;
  }
  const said = parts.filter((part): part is string => part !== null);
  return said.length === 0 ? null : said.join("\n\n");
}

/**
 * The characters each module with a declared share may use, by position: taken in order,
 * each at most what the earlier ones left. Counted in characters, so rounding can never
 * make them sum above the budget once the separators are paid for. "Remainder" modules
 * and modules that never contribute get 0 here (the remainder is settled after).
 */
function shares(modules: readonly EngineModule[], budget: number, separators: number): number[] {
  let left = Math.max(0, budget - separators);
  return modules.map((module) => {
    if (module.contribute === undefined || module.share === "remainder") return 0;
    const chars = Math.min(left, Math.floor(clampShare(module.share) * budget));
    left -= chars;
    return chars;
  });
}

function clampShare(share: number): number {
  if (!(share > 0)) return 0;
  return Math.min(1, share);
}
