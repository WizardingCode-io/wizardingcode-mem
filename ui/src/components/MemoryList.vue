<script setup lang="ts">
// Memories as Sales OS's Pipeline list: a 40px toolbar, a 28px column header aligned with
// the rows, one card per group (28px header: chevron, stage pill, count, meta), 32px rows
// on a grid with an 8px column gap. With the detail dock open, the narrow column set.
import { computed, nextTick, reactive, ref, watch, watchEffect } from "vue";
import { KINDS, type Kind, type MemoryItem } from "../api";
import { day, IMPORTANCE_LABEL, KIND_TONE, projectTone } from "../format";
import { linked, loadList, PAGE, project, select, state } from "../viewer";
import Empty from "./Empty.vue";
import Importance from "./Importance.vue";

const props = defineProps<{ docked: boolean }>();
// Search within this project: a field that opens in the toolbar (⌘K searches everywhere).
const searching = ref(Boolean(state.q));
const q = ref(state.q);
const field = ref<HTMLInputElement | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(q, (value) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    state.q = value.trim();
    void loadList();
  }, 150);
});
async function toggleSearch() {
  searching.value = !searching.value;
  if (!searching.value) q.value = "";
  else {
    await nextTick();
    field.value?.focus();
  }
}

type GroupBy = "kind" | "importance" | "none";
const groupBy = ref<GroupBy>("kind");
const GROUP_LABEL: Record<GroupBy, string> = { kind: "Kind", importance: "Importance", none: "None" };
const collapsed = reactive<Record<string, boolean>>({});

interface Group {
  key: string;
  label: string;
  tone: { bg: string; fg: string } | null;
  items: MemoryItem[];
  stale: number;
}
const IMPORTANCE_TONE: Record<number, { bg: string; fg: string }> = {
  5: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  4: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  3: { bg: "var(--blue-soft)", fg: "var(--blue-text)" },
  2: { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" },
  1: { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" },
};
const groups = computed<Group[]>(() => {
  const make = (key: string, label: string, tone: Group["tone"], items: MemoryItem[]): Group => ({
    key,
    label,
    tone,
    items,
    stale: items.filter((m) => m.stale).length,
  });
  if (groupBy.value === "none" || state.q) return [make("all", "", null, state.items)];
  if (groupBy.value === "importance") {
    return [5, 4, 3, 2, 1]
      .map((n) => make(`i${n}`, IMPORTANCE_LABEL[n] as string, IMPORTANCE_TONE[n] ?? null, state.items.filter((m) => m.importance === n)))
      .filter((g) => g.items.length > 0);
  }
  return KINDS.map((k) => make(k, k, KIND_TONE[k], state.items.filter((m) => m.kind === k))).filter((g) => g.items.length > 0);
});
watchEffect(() => {
  state.order = groups.value.flatMap((g) => (collapsed[g.key] ? [] : g.items.map((m) => m.id)));
});

const COLS_WIDE = "grid-template-columns: minmax(0, 1fr) 92px 168px 92px 40px;";
const COLS_DOCK = "grid-template-columns: minmax(0, 1fr) 92px 84px;";
const cols = computed(() => (props.docked ? COLS_DOCK : COLS_WIDE));

const important = computed({
  get: () => state.minImportance >= 4,
  set: (on: boolean) => {
    state.minImportance = on ? 4 : 1;
    void loadList();
  },
});
const archived = computed({
  get: () => state.status === "archived",
  set: (on: boolean) => {
    state.status = on ? "archived" : "active";
    void loadList();
  },
});
function setKind(kind: Kind | null) {
  state.kind = kind;
  void loadList();
}
const kindMenu = computed(() => [
  [{ label: "All kinds", type: "checkbox" as const, checked: state.kind === null, onUpdateChecked: () => setKind(null) }],
  KINDS.map((k) => ({ label: k, type: "checkbox" as const, checked: state.kind === k, onUpdateChecked: () => setKind(state.kind === k ? null : k) })),
]);
const groupMenu = computed(() => [
  (["kind", "importance", "none"] as GroupBy[]).map((g) => ({
    label: GROUP_LABEL[g],
    type: "checkbox" as const,
    checked: groupBy.value === g,
    onUpdateChecked: () => {
      groupBy.value = g;
    },
  })),
]);
// This project alone, or with the projects linked to it (the default once there are any).
function setScope(scope: "linked" | "project") {
  state.scope = scope;
  void loadList();
}
const scopeMenu = computed(() => [
  [
    { label: project.value ? `This project · ${project.value.name}` : "This project", type: "checkbox" as const, checked: state.scope === "project", onUpdateChecked: () => setScope("project") },
    { label: `With linked · ${linked.value.map((l) => l.name).join(", ")}`, type: "checkbox" as const, checked: state.scope === "linked", onUpdateChecked: () => setScope("linked") },
  ],
]);
const withLinked = computed(() => state.scope === "linked" && linked.value.length > 0);
/** A row from a linked project names it. */
const origin = (m: MemoryItem) => (m.projectId === state.projectId ? null : (state.projects.find((p) => p.id === m.projectId)?.name ?? "linked"));
const filtered = computed(() => Boolean(state.q || state.kind || state.minImportance > 1 || state.status !== "active"));
</script>

<template>
  <!-- Toolbar row, 40px: grouping and toggles left; filter, search right. -->
  <div class="flex h-10 flex-none items-center gap-2 px-4">
    <UDropdownMenu :items="groupMenu" :content="{ align: 'start' }">
      <button type="button" class="wz-pill group"><UIcon name="i-lucide-rows-3" class="size-3.5" />Group: {{ state.q ? "None" : GROUP_LABEL[groupBy] }}</button>
    </UDropdownMenu>
    <UDropdownMenu v-if="linked.length" :items="scopeMenu" :content="{ align: 'start' }">
      <button type="button" class="wz-pill" :aria-pressed="withLinked">Projects: <b class="font-semibold text-(--ink)">{{ withLinked ? `This + ${linked.length} linked` : "This one" }}</b><UIcon name="i-lucide-chevron-down" class="size-3" /></button>
    </UDropdownMenu>
    <button type="button" class="wz-pill" :aria-pressed="important" @click="important = !important">Important and up</button>
    <button type="button" class="wz-pill" :aria-pressed="archived" @click="archived = !archived">Archived<template v-if="project?.archived"> · {{ project.archived.toLocaleString() }}</template></button>
    <button v-if="state.kind" type="button" class="wz-pill" aria-pressed="true" :title="`Only ${state.kind}; click to show every kind`" @click="setKind(null)">{{ state.kind }}<UIcon name="i-lucide-x" class="size-3" /></button>
    <div class="flex-1" />
    <UDropdownMenu :items="kindMenu" :content="{ align: 'end' }">
      <button type="button" class="wz-icon-btn" aria-label="Filter by kind"><UIcon name="i-lucide-list-filter" class="size-[15px]" /></button>
    </UDropdownMenu>
    <label v-if="searching" class="flex h-7 w-56 items-center gap-1.5 rounded-lg border border-(--btn-secondary-line) bg-(--paper-raised) px-2">
      <UIcon name="i-lucide-search" class="size-3.5 flex-none text-(--ink-muted)" />
      <input ref="field" v-model="q" type="search" placeholder="Search this project" aria-label="Search this project" class="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] outline-none focus-visible:outline-none" @keydown.esc.stop="toggleSearch">
    </label>
    <button type="button" class="wz-icon-btn" :aria-pressed="searching" aria-label="Search this project" @click="toggleSearch"><UIcon :name="searching ? 'i-lucide-x' : 'i-lucide-search'" class="size-[15px]" /></button>
  </div>

  <template v-if="state.items.length">
    <div role="row" class="grid h-7 flex-none items-center gap-x-2 border-b border-(--line) px-7" :style="cols">
      <span role="columnheader" class="wz-hcell pl-5">Memory</span>
      <span role="columnheader" class="wz-hcell">Importance</span>
      <template v-if="!docked">
        <span role="columnheader" class="wz-hcell">Files</span>
        <span role="columnheader" class="wz-hcell">Updated</span>
        <span role="columnheader" class="wz-hcell text-right">Reads</span>
      </template>
      <span v-else role="columnheader" class="wz-hcell">Updated</span>
    </div>
    <div role="rowgroup" class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-1">
      <section v-for="g in groups" :key="g.key" class="wz-group" :aria-label="g.label || 'Memories'">
        <div v-if="g.tone" class="wz-group-head">
          <button type="button" class="wz-icon-btn sm" :aria-expanded="!collapsed[g.key]" :aria-label="`Show or hide ${g.label}`" @click="collapsed[g.key] = !collapsed[g.key]">
            <UIcon name="i-lucide-chevron-down" class="size-3.5 transition-transform duration-[160ms] ease-out" :class="{ '-rotate-90': collapsed[g.key] }" />
          </button>
          <span class="wz-stage" :style="{ background: g.tone.bg, color: g.tone.fg }">{{ g.label }}</span>
          <span class="wz-mono text-(--ink-muted)">{{ g.items.length }}</span>
          <span v-if="g.stale" class="wz-mono text-(--line-strong)">· {{ g.stale }} stale</span>
        </div>
        <div class="wz-collapse" :style="{ gridTemplateRows: collapsed[g.key] ? '0fr' : '1fr' }">
          <div :style="{ visibility: collapsed[g.key] ? 'hidden' : 'visible' }">
            <button
              v-for="m in g.items"
              :key="m.id"
              :data-id="m.id"
              type="button"
              role="row"
              class="wz-row"
              :class="{ 'border-t-0': !g.tone && m === g.items[0] }"
              :style="cols"
              :aria-selected="m.id === state.selected"
              @click="select(m.id)"
            >
              <span role="cell" class="flex min-w-0 items-center gap-2">
                <span class="wz-ring" :style="{ color: KIND_TONE[m.kind].fg }" role="img" :aria-label="m.kind" />
                <span class="min-w-0 flex-initial truncate text-[13px] leading-[18px]" :class="m.status === 'superseded' ? 'text-(--ink-muted) line-through' : 'text-(--ink)'">{{ m.title }}</span>
                <span v-if="origin(m)" class="inline-flex h-5 max-w-[140px] min-w-0 flex-none items-center rounded px-1.5 text-[11px] leading-[14px] font-semibold whitespace-nowrap" :style="{ background: projectTone(origin(m)!).bg, color: projectTone(origin(m)!).fg }" :title="`From ${origin(m)}, a linked project`"><span class="truncate">{{ origin(m) }}</span></span>
                <span v-if="m.stale" class="wz-status square flex-none" :style="{ background: 'var(--warn-soft)', color: 'var(--warn)' }">Stale</span>
                <span v-if="m.status === 'archived'" class="wz-status flex-none" :style="{ background: 'var(--paper-sunken)', color: 'var(--ink-muted)' }">Archived</span>
              </span>
              <span role="cell" class="flex min-w-0 items-center"><Importance :value="m.importance" /></span>
              <template v-if="!docked">
                <span role="cell" class="wz-mono text-(--ink-muted)" :title="m.files.join('\n')">{{ m.files[0]?.split('/').pop() ?? "—" }}<template v-if="m.files.length > 1"> +{{ m.files.length - 1 }}</template></span>
                <span role="cell" class="wz-mono text-(--ink-muted)">{{ day(m.updatedAt) }}</span>
                <span role="cell" class="wz-mono text-right text-(--ink-muted)">{{ m.useCount || "—" }}</span>
              </template>
              <span v-else role="cell" class="wz-mono text-(--ink-muted)">{{ day(m.updatedAt) }}</span>
            </button>
          </div>
        </div>
      </section>
      <div class="flex h-8 flex-none items-center gap-2 px-1 text-xs text-(--ink-muted)">
        <span class="font-mono">1–{{ state.items.length.toLocaleString("en-GB") }} of {{ state.total.toLocaleString("en-GB") }}</span>
        <span v-if="state.q">· matching “{{ state.q }}”</span>
        <span class="flex-1" />
        <button v-if="state.items.length < state.total" type="button" class="wz-link" :disabled="state.loading" @click="loadList(state.items.length)">Load {{ Math.min(PAGE, state.total - state.items.length) }} more</button>
      </div>
    </div>
  </template>
  <div v-else-if="state.loading" class="flex flex-col gap-2 px-4 pt-1">
    <div v-for="n in 3" :key="n" class="wz-group">
      <div class="wz-group-head"><span class="skeleton h-5 w-28" /></div>
      <div v-for="r in 3" :key="r" class="flex h-8 items-center gap-3 border-t border-(--row-line) px-3"><span class="skeleton h-3 flex-1" /><span class="skeleton h-3 w-16" /></div>
    </div>
  </div>
  <Empty v-else-if="filtered" icon="i-lucide-search-x" title="No memories match" text="Try fewer words, another kind, or turn a filter off." />
  <Empty v-else icon="i-lucide-sticky-note" title="Nothing remembered yet" text="Start a session in any of your agents. What is worth keeping shows up here." />
</template>
