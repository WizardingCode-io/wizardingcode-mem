<script setup lang="ts">
// The project's knowledge as Sales OS's Knowledge base (AdminKnowledge): a 40px toolbar of
// filter pills; the proposals as its "Needs attention" card (36px title row, 40px two-line
// items: a 24px tile, bold title and muted line, the row's buttons); the entries as the
// app's grouped lists, one card per kind (28px header: chevron, stage pill, count; a 28px
// column header; 32px rows). An entry or a proposal opens in the app's 320px dock: the
// entry's Markdown and frontmatter (essential, path, problem), read only; a proposal's text
// with Make knowledge (the screen's one primary) and Reject. Nothing is written to the
// repository without that click.
import { computed, onMounted, onUnmounted, reactive, ref, watch, watchEffect } from "vue";
import { api, type KnowledgeEntry, type KnowledgeView, type Promotion } from "../api";
import { day } from "../format";
import { becomes, entryCounts, entryGroups, type EntryFilter, KIND_LABEL, type KnowledgeKind, knowledgeCrumb, knowledgeEmpty, knowledgeHash, relativePath, sourceMemory } from "../knowledge";
import { state } from "../viewer";
import Dock from "./Dock.vue";
import DockProps from "./DockProps.vue";
import Empty from "./Empty.vue";
import Markdown from "./Markdown.vue";

const props = defineProps<{ docked: boolean }>();
const emit = defineEmits<{ "open-memory": [id: number] }>();
const toast = useToast();

const view = ref<KnowledgeView | null>(null);
const proposals = ref<Promotion[]>([]);
const failed = ref("");
// Only the last request counts: switching projects fast must not let an older answer win.
let asked = 0;
async function load() {
  const projectId = state.projectId;
  if (projectId === null) return;
  const ticket = ++asked;
  try {
    const [knowledge, open] = await Promise.all([api.knowledge(projectId), api.promotions(projectId)]);
    if (ticket !== asked) return;
    view.value = knowledge;
    proposals.value = open;
    failed.value = "";
    // The open item may be gone (a file deleted, a proposal decided elsewhere).
    const key = state.knowledgeOpen;
    if (key?.startsWith("e:") && !knowledge.entries.some((e) => `e:${e.slug}` === key)) state.knowledgeOpen = null;
    if (key?.startsWith("p") && !open.some((p) => `p${p.id}` === key)) state.knowledgeOpen = null;
  } catch (error) {
    if (ticket === asked) failed.value = error instanceof Error ? error.message : String(error);
  }
}
onMounted(() => void load());
watch(
  () => state.projectId,
  () => {
    view.value = null;
    proposals.value = [];
    void load();
  },
);

// The header shows this page's numbers, not memory's.
watchEffect(() => {
  state.knowledgeCrumb = knowledgeCrumb(view.value, proposals.value);
});
onUnmounted(() => {
  state.knowledgeCrumb = null;
});

// Proposals only where accepting could write: with a folder, or where one can be made.
const offered = computed(() => (view.value?.state === "ok" || view.value?.state === "missing" ? proposals.value : []));
const filter = ref<EntryFilter>("all");
const counts = computed(() => entryCounts(view.value?.entries ?? []));
const groups = computed(() => entryGroups(view.value?.entries ?? [], filter.value));
const empty = computed(() => (view.value ? knowledgeEmpty(view.value) : null));
const collapsed = reactive<Record<string, boolean>>({});
const PILLS: { value: EntryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "essential", label: "Essential" },
  { value: "attention", label: "Needs attention" },
  { value: "retired", label: "Draft or superseded" },
];
const pills = computed(() => PILLS.filter((p) => p.value === "all" || p.value === "essential" || counts.value[p.value] > 0));

const COLS_WIDE = "grid-template-columns: minmax(0, 1fr) 104px 216px 88px;";
const COLS_DOCK = "grid-template-columns: minmax(0, 1fr) 104px;";
const cols = computed(() => (props.docked ? COLS_DOCK : COLS_WIDE));

/** Each kind as a pill, in the brand's soft hues. */
const KIND_TONE: Record<KnowledgeKind, { bg: string; fg: string }> = {
  decision: { bg: "var(--blue-soft)", fg: "var(--blue-text)" },
  rule: { bg: "var(--violet-soft)", fg: "var(--violet-text)" },
  glossary: { bg: "var(--magenta-soft)", fg: "var(--magenta-text)" },
  architecture: { bg: "var(--ok-soft)", fg: "var(--ok)" },
  howto: { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" },
};
const kindTone = (kind: string) => KIND_TONE[kind as KnowledgeKind] ?? KIND_TONE.decision;
const STATUS = {
  active: { label: "Active", bg: "var(--ok-soft)", fg: "var(--ok)" },
  draft: { label: "Draft", bg: "var(--paper-sunken)", fg: "var(--ink-muted)" },
  superseded: { label: "Superseded", bg: "var(--paper-sunken)", fg: "var(--ink-muted)" },
} as const;
const statusOf = (status: string) => STATUS[status as keyof typeof STATUS] ?? STATUS.draft;
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

function open(key: string) {
  state.knowledgeOpen = state.knowledgeOpen === key ? null : key;
}

// The open entry, read in full when it opens; the address keeps in step.
const entry = ref<KnowledgeEntry | null>(null);
watch(
  () => [state.knowledgeOpen, state.projectId] as const,
  async ([key]) => {
    if (state.tab === "knowledge") history.replaceState(null, "", knowledgeHash(key));
    entry.value = null;
    if (!key?.startsWith("e:") || state.projectId === null) return;
    try {
      const found = await api.knowledgeEntry(state.projectId, key.slice(2));
      if (state.knowledgeOpen === key) entry.value = found;
    } catch (error) {
      toast.add({ title: "Could not read the entry", description: error instanceof Error ? error.message : String(error), color: "error" });
      state.knowledgeOpen = null;
    }
  },
  { immediate: true },
);
const proposal = computed(() => {
  const key = state.knowledgeOpen;
  return key?.startsWith("p") ? (offered.value.find((p) => `p${p.id}` === key) ?? null) : null;
});
const root = computed(() => view.value?.root ?? null);
const entryRows = computed(() => {
  const e = entry.value;
  if (!e) return [];
  return [
    { icon: "i-lucide-tag", k: "Kind", v: KIND_LABEL[e.kind] ?? e.kind },
    { icon: "i-lucide-circle-dot", k: "Status", v: statusOf(e.status).label },
    { icon: "i-lucide-star", k: "Essential", v: e.essential ? "Yes · at every session start" : "No · when a prompt needs it" },
    { icon: "i-lucide-clock", k: "Updated", v: e.updated ?? "—", mono: true },
    { icon: "i-lucide-hash", k: "Tags", v: e.tags.length ? e.tags.join(", ") : "—" },
    { icon: "i-lucide-file-text", k: "File", v: fileName(e.path), mono: true },
  ];
});
const proposalRows = computed(() => {
  const p = proposal.value;
  if (!p) return [];
  return [
    { icon: "i-lucide-sticky-note", k: "From", v: `Memory #${p.memoryId} · ${p.kind}` },
    { icon: "i-lucide-tag", k: "Becomes", v: `${KIND_LABEL[becomes(p.kind)]} · not essential` },
    { icon: "i-lucide-file-text", k: "File", v: `${p.slug}.md`, mono: true },
    { icon: "i-lucide-clock", k: "Proposed", v: day(p.createdAt), mono: true },
  ];
});

const busy = ref<number | null>(null);
async function decide(p: Promotion, change: "accept" | "reject") {
  busy.value = p.id;
  try {
    const outcome = await api.decidePromotion(p.id, change);
    await load();
    if ("slug" in outcome) {
      // The new entry opens where the proposal was.
      state.knowledgeOpen = `e:${outcome.slug}`;
      toast.add({ title: "Made knowledge", description: `Written to ${relativePath(outcome.path, root.value)}. Commit it with the code; memory leaves this note to it.`, color: "success" });
    } else {
      if (state.knowledgeOpen === `p${p.id}`) state.knowledgeOpen = null;
      toast.add({ title: "Proposal rejected", description: "Nothing was written. It will not be proposed again.", color: "success" });
    }
  } catch (error) {
    toast.add({ title: "Not changed", description: error instanceof Error ? error.message : String(error), color: "error" });
    await load();
  } finally {
    busy.value = null;
  }
}

async function copyPath(path: string) {
  try {
    await navigator.clipboard.writeText(path);
    toast.add({ title: "Path copied", color: "success" });
  } catch {
    toast.add({ title: "Could not copy", color: "error" });
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Toolbar row, 40px: the filters, as the Knowledge base's; what the page is, on the right. -->
    <div class="flex h-10 flex-none items-center gap-2 px-4">
      <template v-if="view?.entries.length">
        <button v-for="p in pills" :key="p.value" type="button" class="wz-pill" :aria-pressed="filter === p.value" @click="filter = p.value">{{ p.label }} · {{ counts[p.value] }}</button>
      </template>
      <div class="flex-1" />
      <span v-if="view && (view.state === 'ok' || view.state === 'missing')" class="flex min-w-0 items-center gap-1.5 text-xs text-(--ink-muted)" :title="view.dir ?? undefined"><UIcon name="i-lucide-folder" class="size-3.5 flex-none" /><span class="truncate font-mono">.wizardingcode/knowledge</span><span class="text-(--line-strong)">·</span><span class="whitespace-nowrap">read only here: edit the files, or ask your agent</span></span>
    </div>

    <div class="flex min-h-0 flex-1 border-t border-(--line)">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-4">
        <div v-if="failed" class="rounded-xl border border-(--danger) bg-(--danger-soft) px-3.5 py-3 text-[13px] text-(--danger)">Could not read the knowledge: {{ failed }}</div>

        <!-- Proposed: memories worth keeping, waiting for Make knowledge or Reject. -->
        <section v-if="offered.length" aria-label="Proposed knowledge" class="flex-none overflow-hidden rounded-xl border border-(--line) bg-(--paper-raised)">
          <div class="flex h-9 items-center gap-2 px-3">
            <h2 class="m-0 text-sm leading-5 font-semibold whitespace-nowrap">Proposed</h2>
            <span class="inline-flex h-5 flex-none items-center rounded px-1.5 text-[11px] leading-[14px] font-semibold" :style="{ background: 'var(--violet-soft)', color: 'var(--violet-text)' }">{{ offered.length }}</span>
            <span class="wz-meta">Memories agents were shown again and again, or rules of yours</span>
          </div>
          <div role="list">
            <div
              v-for="p in offered"
              :key="p.id"
              :data-proposal="p.id"
              role="listitem"
              tabindex="0"
              class="flex h-10 cursor-pointer items-center gap-2 border-t border-(--row-line) px-3 hover:bg-(--surface-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--blue-text)"
              :class="{ 'bg-(--row-selected)! shadow-[inset_2px_0_0_var(--primary)]': state.knowledgeOpen === `p${p.id}` }"
              :aria-current="state.knowledgeOpen === `p${p.id}` ? 'true' : undefined"
              @click="open(`p${p.id}`)"
              @keydown.enter.self="open(`p${p.id}`)"
            >
              <span aria-hidden="true" class="flex size-6 flex-none items-center justify-center rounded-md" :style="{ background: kindTone(becomes(p.kind)).bg, color: kindTone(becomes(p.kind)).fg }"><UIcon name="i-lucide-sparkles" class="size-[15px]" /></span>
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="wz-name">{{ p.title }}</span>
                <span class="wz-meta">Becomes a {{ KIND_LABEL[becomes(p.kind)].toLowerCase() }} · memory #{{ p.memoryId }} · <span class="font-mono text-[11px]">{{ p.slug }}.md</span></span>
              </div>
              <span class="flex flex-none items-center gap-1" @click.stop>
                <UButton color="neutral" variant="ghost" label="Reject" :disabled="busy === p.id" @click="decide(p, 'reject')" />
                <UButton color="neutral" variant="outline" label="Make knowledge" :loading="busy === p.id" @click="decide(p, 'accept')" />
              </span>
            </div>
          </div>
        </section>

        <!-- The entries, one card per kind. -->
        <template v-if="groups.length">
          <section v-for="g in groups" :key="g.kind" class="wz-group" :aria-label="g.label">
            <div class="wz-group-head">
              <button type="button" class="wz-icon-btn sm" :aria-expanded="!collapsed[g.kind]" :aria-label="`Show or hide ${g.label}`" @click="collapsed[g.kind] = !collapsed[g.kind]">
                <UIcon name="i-lucide-chevron-down" class="size-3.5 transition-transform duration-[160ms] ease-out" :class="{ '-rotate-90': collapsed[g.kind] }" />
              </button>
              <span class="wz-stage" :style="{ background: kindTone(g.kind).bg, color: kindTone(g.kind).fg }">{{ g.label }}</span>
              <span class="wz-mono text-(--ink-muted)">{{ g.entries.length }}</span>
            </div>
            <div class="wz-collapse" :style="{ gridTemplateRows: collapsed[g.kind] ? '0fr' : '1fr' }">
              <div :style="{ visibility: collapsed[g.kind] ? 'hidden' : 'visible' }">
                <div role="row" class="wz-table-head border-t border-(--row-line)" :style="cols">
                  <span role="columnheader" class="pl-5">Entry</span>
                  <span role="columnheader">Status</span>
                  <template v-if="!docked">
                    <span role="columnheader">File</span>
                    <span role="columnheader">Updated</span>
                  </template>
                </div>
                <button
                  v-for="e in g.entries"
                  :key="e.slug"
                  :data-entry="e.slug"
                  type="button"
                  role="row"
                  class="wz-row"
                  :style="cols"
                  :aria-selected="state.knowledgeOpen === `e:${e.slug}`"
                  @click="open(`e:${e.slug}`)"
                >
                  <span role="cell" class="flex min-w-0 items-center gap-2">
                    <span class="wz-ring" :style="{ color: kindTone(e.kind).fg }" role="img" :aria-label="e.kind" />
                    <span class="min-w-0 flex-initial truncate text-[13px] leading-[18px]" :class="e.status === 'superseded' ? 'text-(--ink-muted) line-through' : 'text-(--ink)'">{{ e.title }}</span>
                    <span v-if="e.essential" class="wz-status square flex-none" :style="{ background: 'var(--violet-soft)', color: 'var(--violet-text)' }" title="Shown at every session start">Essential</span>
                    <span v-if="e.problem" class="wz-status diamond flex-none" :style="{ background: 'var(--warn-soft)', color: 'var(--warn)' }" :title="e.problem">Problem</span>
                  </span>
                  <span role="cell" class="flex min-w-0"><span class="wz-status" :style="{ background: statusOf(e.status).bg, color: statusOf(e.status).fg }">{{ statusOf(e.status).label }}</span></span>
                  <template v-if="!docked">
                    <span role="cell" class="wz-mono text-(--ink-muted)" :title="relativePath(e.path, root)">{{ fileName(e.path) }}</span>
                    <span role="cell" class="wz-mono text-(--ink-muted)">{{ e.updated ?? "—" }}</span>
                  </template>
                </button>
              </div>
            </div>
          </section>
        </template>
        <div v-else-if="view === null && !failed" class="wz-group">
          <div class="wz-group-head"><span class="skeleton h-5 w-28" /></div>
          <div v-for="r in 4" :key="r" class="flex h-8 items-center gap-3 border-t border-(--row-line) px-3"><span class="skeleton h-3 flex-1" /><span class="skeleton h-3 w-16" /><span class="skeleton h-3 w-24" /></div>
        </div>
        <Empty v-else-if="view?.entries.length" icon="i-lucide-search-x" title="No entries match" text="Show every entry, or pick another filter.">
          <div class="mt-3"><button type="button" class="wz-link text-[13px]" @click="filter = 'all'">Show every entry</button></div>
        </Empty>
        <Empty v-else-if="empty" :icon="empty.icon" :title="empty.title" :text="empty.text">
          <div v-if="empty.folder" class="mt-3 flex max-w-full items-center gap-1.5 rounded-lg border border-(--line) bg-(--paper-raised) px-2.5 py-1.5">
            <UIcon name="i-lucide-folder" class="size-3.5 flex-none text-(--ink-muted)" />
            <span class="min-w-0 truncate font-mono text-xs text-(--ink)" :title="empty.folder">{{ empty.folder }}</span>
          </div>
        </Empty>
      </div>

      <!-- An entry, read only: its Markdown and frontmatter. -->
      <Dock v-if="state.knowledgeOpen?.startsWith('e:') && entry" type="Entry" icon="i-lucide-book-open" :id="entry.slug" label="Knowledge entry" @close="state.knowledgeOpen = null">
        <template #head>
          <div class="flex flex-col gap-1">
            <span class="wz-label">{{ KIND_LABEL[entry.kind] ?? entry.kind }}<template v-if="entry.essential"> · essential</template><template v-if="entry.status !== 'active'"> · {{ entry.status }}</template></span>
            <h2 class="wz-title wz-clamp m-0 line-clamp-3 text-[15px] leading-5 font-semibold [overflow-wrap:anywhere]">{{ entry.title }}</h2>
          </div>
        </template>
        <template #props>
          <div class="flex flex-col gap-3">
            <UAlert v-if="entry.problem" color="warning" variant="soft" icon="i-lucide-triangle-alert" title="Not fully understood" :description="`${entry.problem}. Fix the file; ${entry.status === 'active' ? 'the rest of it is used as written' : 'agents are never shown a draft or superseded entry'}.`" />
            <DockProps :rows="entryRows" />
            <button v-if="sourceMemory(entry.source) !== null" type="button" class="wz-link self-start" @click="emit('open-memory', sourceMemory(entry.source)!)">Made from memory #{{ sourceMemory(entry.source) }}</button>
          </div>
        </template>
        <section class="flex flex-col gap-2 border-t border-(--line) pt-3">
          <h3 class="m-0 h-5 text-sm font-semibold">The entry</h3>
          <Markdown v-if="entry.body" :source="entry.body" />
          <p v-else class="m-0 text-xs leading-4 text-(--ink-muted)">No more than its title.</p>
        </section>
        <template #footer>
          <UButton size="md" color="neutral" variant="outline" icon="i-lucide-copy" label="Copy path" @click="copyPath(entry.path)" />
          <span class="min-w-0 flex-1 truncate text-right text-xs text-(--ink-muted)">Read only here</span>
        </template>
      </Dock>

      <!-- A proposal: what the entry would say, and the one primary of the screen. -->
      <Dock v-else-if="proposal" type="Proposal" icon="i-lucide-sparkles" :id="proposal.id" label="Proposed knowledge" @close="state.knowledgeOpen = null">
        <template #head>
          <div class="flex flex-col gap-1">
            <span class="wz-label">Proposed · {{ proposal.kind }} → {{ becomes(proposal.kind) }}</span>
            <h2 class="wz-title wz-clamp m-0 line-clamp-3 text-[15px] leading-5 font-semibold [overflow-wrap:anywhere]">{{ proposal.title }}</h2>
          </div>
        </template>
        <template #props>
          <div class="flex flex-col gap-1">
            <DockProps :rows="proposalRows" />
            <button type="button" class="wz-link self-start" @click="emit('open-memory', proposal.memoryId)">Open memory #{{ proposal.memoryId }}</button>
          </div>
        </template>
        <section class="flex flex-col gap-2 border-t border-(--line) pt-3">
          <h3 class="m-0 h-5 text-sm font-semibold">What the entry will say</h3>
          <Markdown v-if="proposal.body" :source="proposal.body" />
          <p v-else class="m-0 text-xs leading-4 text-(--ink-muted)">No more than its title.</p>
          <p class="m-0 text-xs leading-4 text-(--ink-muted)">Make knowledge writes this file into the project's folder, to commit with the code; memory then leaves this note to the entry. Nothing is written until you click.</p>
        </section>
        <template #footer>
          <UButton size="md" label="Make knowledge" icon="i-lucide-check" :loading="busy === proposal.id" @click="decide(proposal, 'accept')" />
          <UButton size="md" color="neutral" variant="outline" label="Reject" :disabled="busy === proposal.id" @click="decide(proposal, 'reject')" />
        </template>
      </Dock>
    </div>
  </div>
</template>
