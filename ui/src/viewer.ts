// The viewer's state, shared by every component: one project, one list, one selection.
import { useDark } from "@vueuse/core";
import { computed, reactive, ref } from "vue";
import { api, type Kind, type MemoryDetail, type MemoryItem, type Project, type TurnItem } from "./api";

export type Tab = "memories" | "turns" | "overview" | "history" | "settings";
export type Status = "active" | "archived" | "superseded" | "all";

export const PAGE = 50;

const state = reactive({
  version: "",
  dataDir: "",
  storeDir: "",
  projects: [] as Project[],
  projectId: null as number | null,
  tab: "memories" as Tab,
  q: "",
  kind: null as Kind | null,
  status: "active" as Status,
  minImportance: 1,
  items: [] as MemoryItem[],
  total: 0,
  turns: [] as TurnItem[],
  /** The turn whose trace is open in the Turns view. */
  turnId: null as number | null,
  /** The History view: what was searched, across every project or not, the turn open. */
  pastQ: "",
  pastAll: false,
  pastId: null as number | null,
  /** The ids in the order the list shows them (grouped by kind or not), for ↑ and ↓. */
  order: [] as number[],
  selected: null as number | null,
  detail: null as MemoryDetail | null,
  loading: false,
});

export const project = computed(() => state.projects.find((p) => p.id === state.projectId) ?? null);

export async function loadOverview(): Promise<void> {
  const overview = await api.overview();
  state.version = overview.version;
  state.dataDir = overview.dataDir;
  state.storeDir = overview.storeDir;
  state.projects = overview.projects;
  if (state.projectId === null && overview.projects.length > 0) {
    // ?project=<id> opens that project (a link from elsewhere); otherwise the most recent.
    const asked = Number(new URLSearchParams(location.search).get("project"));
    const chosen = overview.projects.find((p) => p.id === asked) ?? overview.projects[0]!;
    await selectProject(chosen.id);
  }
}

export async function selectProject(id: number): Promise<void> {
  if (state.projectId !== id) {
    state.projectId = id;
    closeDetail();
  }
  await reload();
}

export async function reload(): Promise<void> {
  if (state.projectId === null) return;
  if (state.tab === "memories") await loadList();
  else if (state.tab === "turns") state.turns = await api.turns(state.projectId, 200);
}

export async function loadList(offset = 0): Promise<void> {
  if (state.projectId === null) return;
  state.loading = true;
  try {
    const params: Record<string, string | number> = {
      project: state.projectId,
      status: state.status,
      minImportance: state.minImportance,
      limit: PAGE,
      offset,
    };
    if (state.q) params.q = state.q;
    if (state.kind) params.kind = state.kind;
    const page = await api.memories(params);
    state.items = offset ? state.items.concat(page.items) : page.items;
    state.total = page.total;
  } finally {
    state.loading = false;
  }
}

export async function select(id: number): Promise<void> {
  state.selected = id;
  state.detail = await api.memory(id);
  history.replaceState(null, "", `#m${id}`);
}

export function closeDetail(): void {
  state.selected = null;
  state.detail = null;
  history.replaceState(null, "", "#");
}

/** After a change to a memory: counts, list and detail again, without losing the place. */
export async function refreshAfterChange(id: number | null = state.selected): Promise<void> {
  const overview = await api.overview();
  state.projects = overview.projects;
  await reload();
  if (id !== null) await select(id);
}

export function move(delta: 1 | -1): void {
  const order = state.order.length ? state.order : state.items.map((m) => m.id);
  if (order.length === 0) return;
  const i = order.indexOf(state.selected ?? -1);
  const next = order[Math.min(order.length - 1, Math.max(0, i + delta))];
  if (next !== undefined) {
    void select(next);
    document.querySelector(`[data-id="${next}"]`)?.scrollIntoView({ block: "nearest" });
  }
}

// The theme: Nuxt UI's own colour mode (a `dark` class on <html>, remembered by the
// browser, the system's by default), pinned by ?theme= when the page is opened that way.
const isDark = useDark();
const pinned = new URLSearchParams(location.search).get("theme");
if (pinned === "light" || pinned === "dark") isDark.value = pinned === "dark";
export const theme = computed<"light" | "dark">({
  get: () => (isDark.value ? "dark" : "light"),
  set: (t) => {
    isDark.value = t === "dark";
  },
});
/**
 * Tells the server this tab exists: every half minute, and again when it comes back
 * into view; a goodbye when it closes. That is how a session starting later reuses this
 * tab instead of opening another, and why the server does not stop while it is open.
 */
export function startHeartbeat(): () => void {
  const HEARTBEAT_MS = 30_000;
  void api.ping();
  const timer = setInterval(() => void api.ping(), HEARTBEAT_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") void api.ping();
  };
  const onHide = () => void api.bye();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pagehide", onHide);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pagehide", onHide);
  };
}

export { state };

// The projects sidebar can be folded away; the browser remembers the choice (a per-viewer
// convenience, so a blocked or empty storage simply means "open").
const SIDEBAR_KEY = "wizardingcode-mem.sidebar";
function readSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
}
const sidebarOpenRef = ref(readSidebar());
export const sidebarOpen = computed<boolean>({
  get: () => sidebarOpenRef.value,
  set: (open) => {
    sidebarOpenRef.value = open;
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? "open" : "closed");
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  },
});
