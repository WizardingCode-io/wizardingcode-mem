// The one read of /api/update per page load, shared by the banner, the About card and the
// Settings list. A read that fails leaves it null: no notice is better than a broken page.
import { ref } from "vue";
import { api } from "./api";
import type { ViewerUpdate } from "./update";

export const updateState = ref<ViewerUpdate | null>(null);
let asked = false;

/** Reads it once; `again` reads it anew, after the setting or the dismissal changed it. */
export async function loadUpdate(again = false): Promise<void> {
  if (asked && !again) return;
  asked = true;
  try {
    updateState.value = await api.update();
  } catch {
    // The card shows without its Release block; the next load asks again.
  }
}
