<script setup lang="ts">
// Past conversations as Sales OS's Audit log (AdminAudit): a 40px filter row with the search
// field first, then one card with a 34px title row, a 28px column header, day groups (28px:
// chevron, the day, a count) and 32px rows (when, agent, what: bold title and muted sub,
// project pill). The selected turn opens in the app's 320px dock: the prompt and the answer.
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api, type PastSearch, type PastTurn } from "../api";
import { AGENT_TILE, projectTone } from "../format";
import { agentName, dayGroups } from "../history";
import { firstLine, pastBody, pastLine, tidyPaths } from "../prompt";
import { project, state } from "../viewer";
import Dock from "./Dock.vue";
import DockProps from "./DockProps.vue";
import Empty from "./Empty.vue";
import Markdown from "./Markdown.vue";

const emit = defineEmits<{ settings: [page: string] }>();
const toast = useToast();

const SEARCH_LIMIT = 25;
const RECENT_LIMIT = 50;
const result = ref<PastSearch | null>(null);
const loading = ref(false);
const running = ref(false);
const q = ref(state.pastQ);
const field = ref<HTMLInputElement | null>(null);
// Only the last request counts: typing fast must not let an older answer win.
let asked = 0;

async function load() {
  const ticket = ++asked;
  loading.value = true;
  try {
    const words = state.pastQ;
    const found = await api.historySearch(words, state.pastAll ? null : state.projectId, words ? SEARCH_LIMIT : RECENT_LIMIT);
    if (ticket !== asked) return;
    result.value = found;
    if (!found.indexed) running.value = (await api.historyProgress()).run.state === "running";
    if (found.indexed && state.pastId !== null && !found.hits.some((h) => h.id === state.pastId)) state.pastId = null;
  } catch (error) {
    if (ticket === asked) result.value = { indexed: true, hits: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (ticket === asked) loading.value = false;
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch(q, (value) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    state.pastQ = value.trim();
    void load();
  }, 200);
});
watch(
  () => [state.projectId, state.pastAll],
  () => void load(),
);
onMounted(() => {
  void load();
});

const hits = computed<PastTurn[]>(() => (result.value?.indexed ? result.value.hits : []));
const groups = computed(() => dayGroups(hits.value, Date.now()));
const collapsed = reactive<Record<string, boolean>>({});
const selected = computed(() => hits.value.find((h) => h.id === state.pastId) ?? null);
function open(id: number) {
  state.pastId = state.pastId === id ? null : id;
}

const scopeMenu = computed(() => [
  [
    { label: project.value ? `This project · ${project.value.name}` : "This project", type: "checkbox" as const, checked: !state.pastAll, disabled: !project.value, onUpdateChecked: () => { state.pastAll = false; } },
    { label: "All projects", type: "checkbox" as const, checked: state.pastAll, onUpdateChecked: () => { state.pastAll = true; } },
  ],
]);
const scopeLabel = computed(() => (state.pastAll || !project.value ? "All" : project.value.name));
function clearSearch() {
  q.value = "";
  field.value?.focus();
}

const COLS = "grid-template-columns: 52px 120px minmax(0, 1fr) 112px;";
const time = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const tile = (agent: string) => AGENT_TILE[agent] ?? { letter: agent.charAt(0), bg: "#D9D4CD" };
/** The row's muted part: what the line already says about itself, or the answer's first line. */
const sub = (h: PastTurn) => pastLine(h.prompt).sub || (h.answer === null ? "No answer recorded" : firstLine(h.answer));

const line = computed(() => (selected.value ? pastLine(selected.value.prompt) : null));
const KIND_LABEL = { prompt: "Prompt", task: "Background task", subagent: "Subagent report" } as const;
const took = (h: PastTurn) => {
  const s = Math.max(0, (h.endedAt - h.startedAt) / 1000);
  return s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
};
const dockRows = computed(() => {
  const h = selected.value;
  if (!h) return [];
  const date = new Date(h.endedAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(",", "");
  return [
    { icon: "i-lucide-folder", k: "Project", v: h.project },
    { icon: "i-lucide-bot", k: "Agent", v: agentName(h.agent) },
    { icon: "i-lucide-clock", k: "When", v: `${date} · ${time(h.endedAt)}`, mono: true },
    { icon: "i-lucide-timer", k: "Took", v: took(h), mono: true },
    { icon: "i-lucide-folder-open", k: "Folder", v: tidyPaths(h.cwd), mono: true },
    { icon: "i-lucide-hash", k: "Session", v: h.sessionId, mono: true },
  ];
});
async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.add({ title: `${what} copied`, color: "success" });
  } catch {
    toast.add({ title: "Could not copy", color: "error" });
  }
}

const importing = ref(false);
async function startImport() {
  importing.value = true;
  try {
    const { started } = await api.historyImport();
    running.value = true;
    toast.add({
      title: started ? "Import started" : "Already running",
      description: "Conversations show up here as they are indexed. Progress is in Settings, under History.",
      color: started ? "success" : "info",
      actions: [{ label: "View", color: "neutral", variant: "link", onClick: () => emit("settings", "history") }],
    });
  } catch (error) {
    toast.add({ title: "Not started", description: error instanceof Error ? error.message : String(error), color: "error" });
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
      <!-- Filter row, 40px: the search field first, as the Audit log's; then the project scope. -->
      <div class="flex h-10 flex-none items-center gap-2 px-4">
        <label class="flex h-7 w-[232px] flex-none items-center gap-1.5 rounded-lg border border-(--btn-secondary-line) bg-(--paper-raised) px-2 text-(--ink-muted)">
          <UIcon name="i-lucide-search" class="size-3.5 flex-none" />
          <input ref="field" v-model="q" type="search" placeholder="Search past conversations" aria-label="Search past conversations" class="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-(--ink) outline-none focus-visible:outline-none" @keydown.esc.stop="q ? clearSearch() : field?.blur()">
        </label>
        <UDropdownMenu :items="scopeMenu" :content="{ align: 'start' }">
          <button type="button" class="wz-pill" :aria-pressed="state.pastAll">Project: <b class="font-semibold text-(--ink)">{{ scopeLabel }}</b><UIcon name="i-lucide-chevron-down" class="size-3" /></button>
        </UDropdownMenu>
        <button v-if="q" type="button" class="wz-link ml-1" @click="clearSearch">Clear</button>
        <div class="flex-1" />
        <span v-if="result?.indexed && !result.error && hits.length" class="wz-meta">{{ state.pastQ ? `${hits.length.toLocaleString("en-GB")} best ${hits.length === 1 ? "match" : "matches"}` : "Latest first" }}</span>
      </div>

    <!-- Under the filter row, a rule; the card and the dock below it, as the Audit log. -->
    <div class="flex min-h-0 flex-1 border-t border-(--line)">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col px-4 pt-3 pb-4">
      <div v-if="result?.indexed && result.error" role="alert" class="flex items-start gap-2 rounded-xl border border-(--danger) bg-(--danger-soft) px-3.5 py-3 text-[13px] leading-[18px] text-(--danger)">
        <UIcon name="i-lucide-triangle-alert" class="mt-px size-4 flex-none" />
        <span class="min-w-0 flex-1">{{ result.error }}</span>
        <button type="button" class="wz-link flex-none text-(--danger)!" @click="emit('settings', 'history')">History settings</button>
      </div>

      <section v-else-if="hits.length" aria-label="Past conversations" class="wz-table flex min-h-0 flex-1 flex-col">
        <div class="flex h-[34px] flex-none items-center gap-2 border-b border-(--row-line) pr-2 pl-3.5">
          <h2 class="m-0 flex-none text-sm leading-5 font-semibold whitespace-nowrap">Conversations</h2>
          <span class="wz-meta">{{ state.pastAll || !project ? "Every project" : project.name }} · Claude Code and Codex sessions on this machine</span>
        </div>
        <div role="table" aria-label="Past conversations" class="flex min-h-0 flex-initial flex-col">
          <div role="row" class="wz-table-head flex-none" :style="COLS">
            <span role="columnheader">When</span>
            <span role="columnheader">Agent</span>
            <span role="columnheader">Conversation</span>
            <span role="columnheader">Project</span>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <div v-for="g in groups" :key="g.key" role="rowgroup" :aria-label="g.label">
              <button type="button" class="flex h-7 w-full items-center gap-2 border-0 border-t border-(--row-line) bg-transparent px-3 text-left" :aria-expanded="!collapsed[g.key]" @click="collapsed[g.key] = !collapsed[g.key]">
                <UIcon name="i-lucide-chevron-down" class="size-3 flex-none text-(--ink-muted) transition-transform duration-[160ms] ease-out" :class="{ '-rotate-90': collapsed[g.key] }" />
                <span class="text-xs leading-4 font-semibold whitespace-nowrap">{{ g.label }}</span>
                <span class="wz-mono text-(--ink-muted)">{{ g.hits.length }}</span>
              </button>
              <template v-if="!collapsed[g.key]">
                <button
                  v-for="h in g.hits"
                  :key="h.id"
                  :data-past="h.id"
                  type="button"
                  role="row"
                  class="wz-row"
                  :style="COLS"
                  :aria-selected="h.id === state.pastId"
                  @click="open(h.id)"
                >
                  <span role="cell" class="wz-mono text-(--ink-muted)">{{ time(h.endedAt) }}</span>
                  <span role="cell" class="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" class="wz-tile" :style="{ background: tile(h.agent).bg }">{{ tile(h.agent).letter }}</span>
                    <span class="min-w-0 truncate text-[13px] leading-[18px]">{{ agentName(h.agent) }}</span>
                  </span>
                  <span role="cell" class="flex min-w-0 items-center gap-1.5">
                    <span class="wz-name max-w-[72%] flex-initial">{{ pastLine(h.prompt).title }}</span>
                    <span class="wz-meta flex-1">{{ sub(h) }}</span>
                  </span>
                  <span role="cell" class="flex min-w-0"><span class="inline-flex h-5 max-w-full min-w-0 items-center truncate rounded px-1.5 text-[11px] leading-[14px] font-semibold whitespace-nowrap" :style="{ background: projectTone(h.project).bg, color: projectTone(h.project).fg }" :title="h.project"><span class="truncate">{{ h.project }}</span></span></span>
                </button>
              </template>
            </div>
          </div>
        </div>
        <div class="wz-table-foot mt-auto flex-none">
          <span class="truncate">{{ state.pastQ ? `The ${hits.length} best matches for “${state.pastQ}”, by day` : `The latest ${hits.length} turns` }} · read from the history index, never changed</span>
        </div>
      </section>

      <div v-else-if="loading && !result" class="flex flex-col">
        <div class="wz-table">
          <div class="flex h-[34px] items-center border-b border-(--row-line) px-3.5"><span class="skeleton h-3.5 w-28" /></div>
          <div v-for="r in 6" :key="r" class="flex h-8 items-center gap-3 border-t border-(--row-line) px-3"><span class="skeleton h-3 w-10" /><span class="skeleton h-3 w-24" /><span class="skeleton h-3 flex-1" /><span class="skeleton h-3 w-16" /></div>
        </div>
      </div>

      <!-- Empty states (STATES.md): a 48px tile, 14/600, one muted line, one primary action and a link. -->
      <Empty v-else-if="result && !result.indexed && running" icon="i-lucide-loader" title="Importing your past sessions" text="Conversations show up here as they are indexed.">
        <div class="mt-3 flex items-center gap-4"><UButton label="View progress" @click="emit('settings', 'history')" /></div>
      </Empty>
      <Empty v-else-if="result && !result.indexed" icon="i-lucide-messages-square" title="No past conversations yet" text="Import your Claude Code and Codex sessions to search them here.">
        <div class="mt-3 flex items-center gap-4">
          <UButton label="Import" icon="i-lucide-download" :loading="importing" @click="startImport" />
          <button type="button" class="wz-link text-[13px]" @click="emit('settings', 'history')">History settings</button>
        </div>
      </Empty>
      <Empty v-else-if="result && state.pastQ" icon="i-lucide-search-x" :title="`No conversations match “${state.pastQ}”`" :text="state.pastAll || !project ? 'Try fewer or other words.' : 'Try other words, or search every project.'">
        <div class="mt-3 flex items-center gap-4">
          <UButton v-if="!state.pastAll && project" label="Search all projects" @click="state.pastAll = true" />
          <button type="button" class="wz-link text-[13px]" @click="clearSearch">Clear search</button>
        </div>
      </Empty>
      <Empty v-else-if="result" icon="i-lucide-messages-square" :title="state.pastAll || !project ? 'No past conversations' : `No past conversations in ${project.name}`" text="Imported sessions of this project show up here.">
        <div v-if="!state.pastAll && project" class="mt-3 flex items-center gap-4"><UButton label="Show all projects" @click="state.pastAll = true" /></div>
      </Empty>
    </div>

    <Dock v-if="selected && line" type="Conversation" icon="i-lucide-messages-square" :id="selected.id" label="Past conversation" @close="state.pastId = null">
      <template #actions>
        <UTooltip text="Copy the prompt"><button type="button" class="wz-icon-btn" aria-label="Copy the prompt" @click="copy(selected.prompt, 'Prompt')"><UIcon name="i-lucide-copy" class="size-[15px]" /></button></UTooltip>
      </template>
      <template #head>
        <div class="flex flex-col gap-1">
          <span class="wz-label">{{ agentName(selected.agent) }} · {{ selected.project }}</span>
          <h2 class="wz-title wz-clamp m-0 line-clamp-3 text-[15px] leading-5 font-semibold [overflow-wrap:anywhere]">{{ line.title }}</h2>
          <span class="wz-meta">{{ KIND_LABEL[line.kind] }}<template v-if="line.sub && line.kind !== 'prompt'"> · {{ line.sub.replace(/^Background task · /, "") }}</template></span>
        </div>
      </template>
      <template #props>
        <DockProps :rows="dockRows" />
      </template>

      <section class="flex flex-col gap-2 border-t border-(--line) pt-3">
        <div class="flex h-5 items-center gap-2"><h3 class="m-0 flex-1 text-sm font-semibold">{{ KIND_LABEL[line.kind] }}</h3><span class="wz-mono text-(--ink-muted)">{{ time(selected.startedAt) }}</span></div>
        <Markdown :source="pastBody(selected.prompt)" />
      </section>

      <section class="flex flex-col gap-2 border-t border-(--line) pt-3">
        <div class="flex h-5 items-center gap-2"><h3 class="m-0 flex-1 text-sm font-semibold">Answer</h3><span class="wz-mono text-(--ink-muted)">{{ time(selected.endedAt) }}</span></div>
        <Markdown v-if="selected.answer" :source="tidyPaths(selected.answer)" />
        <p v-else class="m-0 text-xs leading-4 text-(--ink-muted)">No answer was recorded for this turn.</p>
      </section>

      <template #footer>
        <UButton color="neutral" variant="outline" icon="i-lucide-copy" label="Copy answer" :disabled="!selected.answer" @click="copy(selected.answer ?? '', 'Answer')" />
        <span class="flex-1" />
        <span class="wz-meta">From the history index</span>
      </template>
    </Dock>
    </div>
  </div>
</template>
