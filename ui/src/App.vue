<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from "vue";
import { api } from "./api";
import HistoryOffer from "./components/HistoryOffer.vue";
import MemoryDetail from "./components/MemoryDetail.vue";
import MemoryList from "./components/MemoryList.vue";
import Palette from "./components/Palette.vue";
import ProjectStats from "./components/ProjectStats.vue";
import Rail from "./components/Rail.vue";
import Settings from "./components/Settings.vue";
import Sidebar from "./components/Sidebar.vue";
import TopBar from "./components/TopBar.vue";
import TurnsView from "./components/TurnsView.vue";
import { ago, hue } from "./format";
import { closeDetail, loadList, loadOverview, move, project, reload, select, selectProject, sidebarOpen, startHeartbeat, state, type Tab } from "./viewer";

// The view tabs (Sales OS page header, second row): a 10px square each, in the brand's hues.
const tabs: { label: string; value: Tab; hue: string }[] = [
  { label: "Memories", value: "memories", hue: "#9B5CFF" },
  { label: "Turns", value: "turns", hue: "#2E7BFF" },
  { label: "Overview", value: "overview", hue: "#2EE6C8" },
];
const tab = computed({
  get: () => state.tab,
  set: (t: Tab) => {
    state.tab = t;
    history.replaceState(null, "", t === "memories" ? "#" : `#${t}`);
    void reload();
  },
});
// The detail is a 320px dock from 1280px up, a sheet below: decided here, not by CSS, so that
// the sheet's scrim never covers a page that already shows the column.
const wide = matchMedia("(min-width: 1280px)");
const isWide = ref(wide.matches);
const onWide = (e: MediaQueryListEvent) => { isWide.value = e.matches; };
wide.addEventListener("change", onWide);
onBeforeUnmount(() => wide.removeEventListener("change", onWide));
const sheet = computed({
  get: () => !isWide.value && state.detail !== null,
  set: (open: boolean) => { if (!open) closeDetail(); },
});
const palette = ref(false);
// The tab names the project first: the favicon already says whose app it is.
watchEffect(() => {
  document.title = project.value ? `${project.value.name} · wizardingcode-mem` : "wizardingcode-mem";
});

/** Settings, on one of its pages: the page reads the hash when it opens. */
function openSettings(page: string) {
  tab.value = "settings";
  history.replaceState(null, "", `#settings/${page}`);
}

function openTurn(id: number) {
  state.turnId = id;
  tab.value = "turns";
}
const failed = ref("");

async function openMemory(id: number) {
  const m = await api.memory(id);
  if (m.projectId !== state.projectId) await selectProject(m.projectId);
  tab.value = "memories";
  await select(id);
}

function onKey(e: KeyboardEvent) {
  // An overlay that took the key (Escape closing a sheet or the palette) keeps it.
  if (e.defaultPrevented) return;
  const target = e.target as HTMLElement | null;
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(target?.tagName ?? "") || target?.isContentEditable;
  if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    palette.value = !palette.value;
    return;
  }
  if (palette.value) return;
  if (e.key === "/" && !typing) {
    e.preventDefault();
    palette.value = true;
    return;
  }
  if (e.key === "Escape") {
    if (typing) (target as HTMLElement).blur();
    else if (state.tab === "turns" && state.turnId !== null) state.turnId = null;
    else if (state.selected !== null) closeDetail();
    return;
  }
  if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === "[") {
      e.preventDefault();
      sidebarOpen.value = !sidebarOpen.value;
      return;
    }
    const views: Record<string, Tab> = { "1": "memories", "2": "turns", "3": "overview", "4": "settings" };
    const view = views[e.key];
    if (view) {
      e.preventDefault();
      tab.value = view;
      return;
    }
  }
  if (typing || state.tab !== "memories") return;
  if (e.key === "ArrowDown" || e.key === "j") {
    e.preventDefault();
    move(1);
  } else if (e.key === "ArrowUp" || e.key === "k") {
    e.preventDefault();
    move(-1);
  }
}

onMounted(async () => {
  document.addEventListener("keydown", onKey);
  onBeforeUnmount(startHeartbeat());
  const deep = /^#m(\d+)$/.exec(location.hash);
  if (location.hash === "#search") palette.value = true;
  const hashTab = (/^#(turns|overview|settings)$/.exec(location.hash)?.[1] ?? (/^#settings\/[a-z]+$/.test(location.hash) ? "settings" : undefined)) as Tab | undefined;
  if (hashTab) state.tab = hashTab;
  try {
    await loadOverview();
    if (deep) await openMemory(Number(deep[1]));
  } catch (error) {
    failed.value = error instanceof Error ? error.message : String(error);
  }
});
</script>

<template>
  <UApp :toaster="{ position: 'bottom-left', duration: 5000 }" :tooltip="{ delayDuration: 400 }">
    <div class="flex h-full flex-col overflow-hidden">
      <TopBar @palette="palette = true" />
      <div class="flex min-h-0 flex-1">
        <Rail :tab="state.tab" @go="tab = $event" />
        <!-- The projects panel folds to nothing (240ms) and keeps its width while it moves. Settings are the
             machine's, not a project's: the panel steps aside there and comes back as it was. -->
        <div class="flex-none overflow-hidden transition-[width] duration-[240ms] ease-out motion-reduce:transition-none" :class="sidebarOpen && state.tab !== 'settings' ? 'w-[216px]' : 'w-0'" :inert="!sidebarOpen || state.tab === 'settings'">
          <Sidebar class="h-full" />
        </div>
        <main class="flex min-h-0 min-w-0 flex-1 flex-col">
          <!-- Row 1, 36px: breadcrumb (16px space tile, 13px), the project's numbers, last activity. -->
          <div class="flex h-9 flex-none items-center gap-2 px-4">
            <template v-if="state.tab === 'settings'">
              <span aria-hidden="true" class="flex size-4 flex-none items-center justify-center rounded bg-(--ink) text-(--paper)"><UIcon name="i-lucide-settings" class="size-2.5" /></span>
              <nav aria-label="Breadcrumb" class="flex items-center gap-1 text-[13px] leading-[18px] whitespace-nowrap"><h1 class="m-0 text-[13px] font-semibold">Settings</h1></nav>
              <span class="ml-2 text-xs text-(--ink-muted)">For every project and every agent on this machine</span>
            </template>
            <template v-else>
              <span aria-hidden="true" class="flex size-4 flex-none items-center justify-center rounded font-display text-[9px] font-bold text-[#100E0D] uppercase" :style="{ background: project ? hue(project.name) : 'var(--line)' }">{{ project?.name.charAt(0) }}</span>
              <nav aria-label="Breadcrumb" class="flex min-w-0 flex-none items-center gap-1 text-[13px] leading-[18px] whitespace-nowrap">
                <span class="text-(--ink-muted)">Projects</span><span class="text-(--line-strong)">/</span>
                <h1 class="m-0 max-w-[280px] truncate text-[13px] font-semibold" :title="project?.key">{{ project?.name ?? "…" }}</h1>
              </nav>
              <span v-if="project" class="ml-2 flex min-w-0 items-center gap-2 overflow-hidden text-xs leading-4 whitespace-nowrap text-(--ink-muted)">
                <span><span class="font-mono font-medium text-(--ink)">{{ project.active.toLocaleString("en-GB") }}</span> active</span>
                <span class="text-(--line-strong)">·</span>
                <span><span class="font-mono font-medium text-(--ink)">{{ project.archived.toLocaleString("en-GB") }}</span> archived</span>
                <template v-if="project.stale"><span class="text-(--line-strong)">·</span><span class="inline-flex items-center gap-1"><span class="size-1.5 rounded-[1px] bg-(--warn)" /><span class="text-(--warn)">{{ project.stale.toLocaleString("en-GB") }} may be outdated</span></span></template>
              </span>
              <span class="flex-1" />
              <span v-if="project?.lastActivity" class="flex flex-none items-center gap-1.5 text-xs text-(--ink-muted)"><span class="size-1.5 rounded-full bg-(--ok)" />Last activity · {{ ago(project.lastActivity) }}</span>
            </template>
          </div>
          <!-- Row 2, 36px: the views. -->
          <div role="navigation" aria-label="Views" class="flex h-9 flex-none items-center gap-4 border-b border-(--line) px-4">
            <template v-if="state.tab !== 'settings'">
              <button
                v-for="t in tabs"
                :key="t.value"
                type="button"
                :aria-current="state.tab === t.value ? 'page' : undefined"
                class="flex h-9 items-center gap-2 border-b-2 pt-0.5 text-[12.5px] whitespace-nowrap"
                :class="state.tab === t.value ? 'border-(--ink) font-semibold text-(--ink)' : 'border-transparent text-(--ink-muted) hover:text-(--ink)'"
                @click="tab = t.value"
              >
                <span aria-hidden="true" class="size-2.5 rounded-[3px]" :style="{ background: t.hue }" />{{ t.label }}
              </button>
            </template>
            <span v-else class="flex h-9 items-center gap-2 border-b-2 border-(--ink) pt-0.5 text-[12.5px] font-semibold"><span aria-hidden="true" class="size-2.5 rounded-[3px] bg-[#FFC53D]" />This machine</span>
          </div>
          <HistoryOffer v-if="state.tab === 'memories' && !failed" @progress="openSettings('history')" />
          <div v-if="failed" class="m-4 rounded-xl border border-(--danger) bg-(--danger-soft) px-3.5 py-3 text-[13px] text-(--danger)">Could not reach wizardingcode-mem: {{ failed }}</div>
          <div v-else-if="state.tab === 'memories'" class="flex min-h-0 flex-1">
            <div class="flex min-h-0 min-w-0 flex-1 flex-col">
              <MemoryList :docked="isWide && state.detail !== null" />
            </div>
            <MemoryDetail v-if="isWide && state.detail" @open-turn="openTurn" />
          </div>
          <TurnsView v-else-if="state.tab === 'turns'" @open-memory="openMemory" />
          <Settings v-else-if="state.tab === 'settings'" />
          <ProjectStats v-else />
        </main>
      </div>
    </div>
    <USlideover v-model:open="sheet" :ui="{ content: 'max-w-[320px]' }" title="Memory" :close="false">
      <template #content><MemoryDetail class="h-full w-full border-l-0" @open-turn="openTurn" /></template>
    </USlideover>
    <Palette v-model:open="palette" @tab="tab = $event" />
  </UApp>
</template>
