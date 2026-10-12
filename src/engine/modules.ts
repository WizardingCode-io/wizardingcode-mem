import { memory } from "../modules/memory/index.ts";
import { logError } from "../util/log.ts";
import type { EngineModule } from "./module.ts";

// Which modules this binary has, and which of them are on. The order here is the order the
// composer asks them in (memory first, ruling F3); the setting only switches them.

/** Every module shipped in this binary, in the engine's order. */
export const BUILT_IN: readonly EngineModule[] = [memory];

/** The modules on when the setting names none. */
const DEFAULT_IDS = ["memory"];

/** The seam for a later licence check: today every built-in module is allowed. */
export function moduleAllowed(_id: string): boolean {
  return true;
}

const told = new Set<string>();
/** Each unknown id reaches the log once per process: a hook runs often. */
function logUnknown(id: string): void {
  if (told.has(id)) return;
  told.add(id);
  logError("modules", new Error(`WIZARDINGCODE_MODULES names an unknown module: ${id}`));
}

/**
 * The modules on, from `WIZARDINGCODE_MODULES` (a comma list). Unset or blank means the
 * default, memory alone; otherwise exactly the known ids named, so a list without memory
 * leaves it off. Unknown ids are ignored and told once each; duplicates collapse; the
 * order is always `available`'s.
 */
export function enabledModules(
  raw: string | undefined | null,
  available: readonly EngineModule[] = BUILT_IN,
  onUnknown: (id: string) => void = logUnknown,
): EngineModule[] {
  const named = (raw ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id !== "");
  const wanted = new Set(named.length === 0 ? DEFAULT_IDS : named);
  const known = new Set(available.map((module) => module.id));
  for (const id of wanted) if (!known.has(id)) onUnknown(id);
  return available.filter((module) => wanted.has(module.id) && moduleAllowed(module.id));
}
