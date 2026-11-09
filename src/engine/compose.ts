import { MOMENT_BUDGET } from "./budget.ts";
import type { EngineModule, MomentInput } from "./module.ts";

/** The blank line between two contributions. */
const SEPARATOR = "\n\n";

/**
 * One moment's context: each module within its part of the budget, joined by a blank line
 * in the list's order. A module that throws, or says more than its part, contributes
 * nothing; the others are unaffected. Null when no module has anything to say.
 *
 * The modules with a declared share are asked first, each within its share. The
 * "remainder" module is asked last and gets the budget less what the declared modules
 * actually wrote, a blank line each (ADR 0024's F5′): a declared module that says nothing,
 * throws or overruns costs the remainder nothing, so memory alone or beside a silent
 * module keeps the whole budget.
 */
export function compose(
  modules: readonly EngineModule[],
  input: Omit<MomentInput, "budgetChars">,
  onError?: (moduleId: string, error: unknown) => void,
): string | null {
  const budget = MOMENT_BUDGET[input.moment];
  // The blank lines between contributions are text too: set their worst case aside first.
  const speaking = modules.filter((module) => module.contribute !== undefined).length;
  const declared = shares(modules, budget, SEPARATOR.length * Math.max(0, speaking - 1));
  const parts: (string | null)[] = modules.map(() => null);
  let charged = 0;
  for (const [i, module] of modules.entries()) {
    if (module.share === "remainder") continue;
    const text = ask(module, input, declared[i] ?? 0, onError);
    if (text === null) continue;
    parts[i] = text;
    charged += text.length + SEPARATOR.length;
  }
  // Only the first remainder module gets what is left; a second one would find nothing.
  let left = Math.max(0, budget - charged);
  for (const [i, module] of modules.entries()) {
    if (module.share !== "remainder" || module.contribute === undefined) continue;
    parts[i] = ask(module, input, left, onError);
    left = 0;
  }
  const said = parts.filter((text): text is string => text !== null);
  return said.length === 0 ? null : said.join(SEPARATOR);
}

/** One module's text within `budgetChars`, or null when it has none that fits. */
function ask(
  module: EngineModule,
  input: Omit<MomentInput, "budgetChars">,
  budgetChars: number,
  onError?: (moduleId: string, error: unknown) => void,
): string | null {
  if (module.contribute === undefined) return null;
  let text: string | null;
  try {
    text = module.contribute({ ...input, budgetChars });
  } catch (error) {
    onError?.(module.id, error);
    return null;
  }
  // Whole or not at all: half a note reads as a complete one.
  if (text === null || text === "" || text.length > budgetChars) return null;
  return text;
}

/**
 * Each declared module's characters for one moment, by position: in order, each at most
 * what the earlier ones left. Counted in characters, so rounding can never make them sum
 * above the budget once the separators are paid for. A module that never contributes, and
 * the remainder module, take nothing here.
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
