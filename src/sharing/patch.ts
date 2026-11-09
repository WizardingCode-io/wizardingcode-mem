// What the Sharing page saves: its switches as the settings patch. Pure, and a leaf over
// `types.ts` (the settings' names are imported as types only, which no bundle carries), so
// the viewer imports it as it imports the levels' labels, and a test proves each rule
// without a browser.
import type { SettingKey, SharingKey, Source } from "../settings/settings.ts";
import { ROOTS, type Root, shareListText } from "./types.ts";

const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS" satisfies SharingKey;
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS" satisfies SharingKey;

/** The Sharing page as it stands when Save is pressed. */
export interface SharingToggles {
  /** Each root's switch. */
  roots: Record<Root, boolean>;
  /** Each area's switch, by root-qualified id. */
  areas: Record<string, boolean>;
  /** Each root's areas as its taxonomy holds them; null for a root with no taxonomy. */
  taxonomies: Record<Root, { id: string; label: string }[] | null>;
  /** The listed ids no taxonomy holds, as the page was told. */
  inert: string[];
  /** Where each key's value comes from, as the settings view says. */
  sources: Record<SharingKey, Source>;
}

/**
 * The settings patch of the page's switches. Each list is sorted comma text, or `none`: the
 * roots that are on; the areas that are on and that their root's taxonomy holds. An id no
 * taxonomy holds allows nothing, so it is never written back, and neither is one the page
 * lists as inert. A key the environment sets is left out: what the page shows for it is the
 * file's value narrowed, and saving that would overwrite what the person chose.
 */
export function buildSharingPatch(input: SharingToggles): Partial<Record<SettingKey, string>> {
  const held = new Set(
    ROOTS.flatMap((root) => (input.taxonomies[root] ?? []).map((area) => `${root}:${area.id}`)),
  );
  const inert = new Set(input.inert);
  const roots = ROOTS.filter((root) => input.roots[root]).sort();
  const areas = Object.keys(input.areas)
    .filter((id) => input.areas[id] === true && held.has(id) && !inert.has(id))
    .sort();
  const patch: Partial<Record<SettingKey, string>> = {};
  if (input.sources[ROOTS_KEY] !== "env") patch[ROOTS_KEY] = shareListText(roots);
  if (input.sources[AREAS_KEY] !== "env") patch[AREAS_KEY] = shareListText(areas);
  return patch;
}
