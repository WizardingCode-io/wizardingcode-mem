// What the viewer draws from the modules that are on: their buttons in the rail, in module
// order, and the keys that switch to them. Pure, so the tests drive it without a browser.
// No import from api.ts: it reads the page's location.

export interface ModuleViewInfo {
  tab: string;
  label: string;
  icon: string;
  key: string;
}
export interface ModuleInfo {
  id: string;
  name: string;
  views: ModuleViewInfo[];
}

/** Settings is the viewer's own, not a module's: its button sits at the rail's foot. */
export const SETTINGS_KEY = "5";

/**
 * Every view of the modules given, in order. A tab an earlier view already has is not drawn
 * twice; a key already taken (or Settings's) is dropped, and that view is reached by its button.
 */
export function railViews(modules: readonly ModuleInfo[]): ModuleViewInfo[] {
  const tabs = new Set<string>();
  const keys = new Set<string>([SETTINGS_KEY]);
  const views: ModuleViewInfo[] = [];
  for (const module of modules) {
    for (const view of module.views) {
      if (tabs.has(view.tab)) continue;
      tabs.add(view.tab);
      const key = view.key !== "" && !keys.has(view.key) ? view.key : "";
      if (key !== "") keys.add(key);
      views.push({ ...view, key });
    }
  }
  return views;
}

/** Which tab each key opens: the views' keys, and Settings's. */
export function viewKeys(views: readonly ModuleViewInfo[]): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const view of views) if (view.key !== "") keys[view.key] = view.tab;
  keys[SETTINGS_KEY] = "settings";
  return keys;
}
