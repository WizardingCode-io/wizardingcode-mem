<script setup lang="ts">
// Projects and their links as Sales OS's Tickets list (and Pipeline's groups): a 40px toolbar
// with the search field first, one card per group (28px header: chevron, stage pill, count),
// a 28px column header inside each card, 32px rows (letter tile, bold name, muted place). The
// selected project opens in the app's 320px dock: its suggestions with their reasons and
// Link / Reject, its confirmed links with Unlink, and a way to link one by hand.
import { computed, reactive, ref } from "vue";
import { api, type LinkKind, type Project } from "../api";
import { compact, day, hue } from "../format";
import { projectGroups, projectLinks, projectPlace, signalParts, visibleFrom } from "../links";
import { loadLinks, reload, state } from "../viewer";
import Dock from "./Dock.vue";
import DockProps from "./DockProps.vue";
import Empty from "./Empty.vue";

const props = defineProps<{ docked: boolean }>();
const toast = useToast();

const q = ref("");
const field = ref<HTMLInputElement | null>(null);
const reviewOnly = ref(false);
const collapsed = reactive<Record<string, boolean>>({});

const pending = computed(() => state.links.filter((l) => l.status === "suggested").length);
const confirmedCount = computed(() => state.links.filter((l) => l.status === "confirmed").length);
const shown = computed(() => {
  const words = q.value.trim().toLowerCase();
  return state.projects.filter((p) => !words || p.name.toLowerCase().includes(words) || p.key.toLowerCase().includes(words));
});
const groups = computed(() => projectGroups(shown.value, state.links).filter((g) => !reviewOnly.value || g.key === "review"));
const TONE = {
  review: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  linked: { bg: "var(--violet-soft)", fg: "var(--violet-text)" },
  alone: { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" },
} as const;

const COLS_WIDE = "grid-template-columns: minmax(0, 1fr) 260px 80px 96px;";
const COLS_DOCK = "grid-template-columns: minmax(0, 1fr) 216px;";
const cols = computed(() => (props.docked ? COLS_DOCK : COLS_WIDE));

/** The row's links cell: what is waiting, then the first link (or suggestion) and how many more. */
function linksCell(p: Project) {
  const mine = projectLinks(state.links, p.id);
  const first = mine.confirmed[0] ?? mine.suggested[0];
  const all = mine.confirmed.length ? mine.confirmed.length : mine.suggested.length;
  return {
    review: mine.suggested.length,
    text: first ? `${first.label === "Same product" ? "With" : first.label} ${first.otherName}` : "",
    muted: mine.confirmed.length === 0,
    more: Math.max(0, all - 1),
  };
}

const selected = computed(() => state.projects.find((p) => p.id === state.linkProject) ?? null);
const mine = computed(() => (selected.value ? projectLinks(state.links, selected.value.id) : { confirmed: [], suggested: [] }));
const reads = computed(() => (selected.value ? visibleFrom(state.links, selected.value.id) : []));
function open(id: number) {
  state.linkProject = state.linkProject === id ? null : id;
  history.replaceState(null, "", state.linkProject === null ? "#projects" : `#projects/${id}`);
}
const dockRows = computed(() => {
  const p = selected.value;
  if (!p) return [];
  return [
    { icon: p.key.startsWith("remote:") ? "i-lucide-git-branch" : "i-lucide-folder", k: p.key.startsWith("remote:") ? "Remote" : "Folder", v: projectPlace(p.key) },
    { icon: "i-lucide-sticky-note", k: "Memories", v: `${p.active.toLocaleString("en-GB")} active` },
    { icon: "i-lucide-clock", k: "Last active", v: p.lastActivity ? day(p.lastActivity) : "—", mono: true },
    { icon: "i-lucide-eye", k: "Reads", v: reads.value.length ? `Itself and ${reads.value.map((r) => r.name).join(", ")}` : "Only itself" },
  ];
});

const busy = ref<number | null>(null);
async function decide(id: number, change: "confirm" | "reject" | "unlink", other: string) {
  busy.value = id;
  try {
    await api.decideLink(id, change);
    await loadLinks();
    if (state.tab !== "projects") await reload();
    const title = change === "confirm" ? `Linked with ${other}` : change === "reject" ? "Suggestion rejected" : `Unlinked from ${other}`;
    const description = change === "reject" ? "It will not be suggested again." : change === "unlink" ? "Link them again here whenever you want." : "Each now reads what the other remembers, as the link says.";
    toast.add({ title, description, color: "success" });
  } catch (error) {
    toast.add({ title: "Not changed", description: error instanceof Error ? error.message : String(error), color: "error" });
  } finally {
    busy.value = null;
  }
}

// Linking by hand: another project and the kind.
const target = ref<number | undefined>(undefined);
const kind = ref<LinkKind>("product");
const targets = computed(() =>
  state.projects
    .filter((p) => p.id !== selected.value?.id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ label: p.name, value: p.id })),
);
const linking = ref(false);
async function linkByHand() {
  const p = selected.value;
  if (!p || target.value === undefined) return;
  linking.value = true;
  try {
    const made = await api.link(p.id, target.value, kind.value);
    await loadLinks();
    toast.add({ title: `Linked with ${made.from === p.id ? made.toName : made.fromName}`, color: "success" });
    target.value = undefined;
  } catch (error) {
    toast.add({ title: "Not linked", description: error instanceof Error ? error.message : String(error), color: "error" });
  } finally {
    linking.value = false;
  }
}
const RELATION_TONE = {
  "Same product": { bg: "var(--violet-soft)", fg: "var(--violet-text)" },
  Uses: { bg: "var(--blue-soft)", fg: "var(--blue-text)" },
  "Used by": { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" },
} as const;
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Toolbar row, 40px: the search field first, as the Audit log's; then the one toggle. -->
    <div class="flex h-10 flex-none items-center gap-2 px-4">
      <label class="flex h-7 w-[232px] flex-none items-center gap-1.5 rounded-lg border border-(--btn-secondary-line) bg-(--paper-raised) px-2 text-(--ink-muted)">
        <UIcon name="i-lucide-search" class="size-3.5 flex-none" />
        <input ref="field" v-model="q" type="search" placeholder="Find a project" aria-label="Find a project" class="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-(--ink) outline-none focus-visible:outline-none" @keydown.esc.stop="q ? (q = '') : field?.blur()">
      </label>
      <button v-if="pending" type="button" class="wz-pill" :aria-pressed="reviewOnly" @click="reviewOnly = !reviewOnly">To review · {{ pending }}</button>
      <div class="flex-1" />
      <span class="wz-meta">{{ confirmedCount ? `${confirmedCount} ${confirmedCount === 1 ? "link" : "links"}` : "No links yet" }}<template v-if="pending"> · {{ pending }} {{ pending === 1 ? "suggestion" : "suggestions" }} to review</template></span>
    </div>

    <div class="flex min-h-0 flex-1 border-t border-(--line)">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div v-if="groups.length" role="rowgroup" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-4">
          <section v-for="g in groups" :key="g.key" class="wz-group" :aria-label="g.label">
            <div class="wz-group-head">
              <button type="button" class="wz-icon-btn sm" :aria-expanded="!collapsed[g.key]" :aria-label="`Show or hide ${g.label}`" @click="collapsed[g.key] = !collapsed[g.key]">
                <UIcon name="i-lucide-chevron-down" class="size-3.5 transition-transform duration-[160ms] ease-out" :class="{ '-rotate-90': collapsed[g.key] }" />
              </button>
              <span class="wz-stage" :style="{ background: TONE[g.key].bg, color: TONE[g.key].fg }">{{ g.label }}</span>
              <span class="wz-mono text-(--ink-muted)">{{ g.items.length }}</span>
              <span v-if="g.key === 'review'" class="wz-meta">· shared owners, manifests and workspaces</span>
            </div>
            <div class="wz-collapse" :style="{ gridTemplateRows: collapsed[g.key] ? '0fr' : '1fr' }">
              <div :style="{ visibility: collapsed[g.key] ? 'hidden' : 'visible' }">
                <div role="row" class="wz-table-head border-t border-(--row-line)" :style="cols">
                  <span role="columnheader" class="pl-7">Project · where</span>
                  <span role="columnheader">Links</span>
                  <template v-if="!docked">
                    <span role="columnheader">Memories</span>
                    <span role="columnheader">Last active</span>
                  </template>
                </div>
                <button
                  v-for="p in g.items"
                  :key="p.id"
                  :data-project="p.id"
                  type="button"
                  role="row"
                  class="wz-row"
                  :style="cols"
                  :aria-selected="p.id === state.linkProject"
                  @click="open(p.id)"
                >
                  <span role="cell" class="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" class="wz-tile" :style="{ background: hue(p.name) }">{{ p.name.charAt(0) }}</span>
                    <span class="wz-name max-w-[60%] flex-initial">{{ p.name }}</span>
                    <span class="wz-meta flex-1" :title="p.key">{{ projectPlace(p.key) }}</span>
                  </span>
                  <span role="cell" class="flex min-w-0 items-center gap-1.5">
                    <span v-if="linksCell(p).review" class="wz-status square flex-none" :style="{ background: 'var(--warn-soft)', color: 'var(--warn)' }">{{ linksCell(p).review }} to review</span>
                    <span v-if="linksCell(p).text" class="wz-meta flex-initial" :class="{ 'text-(--ink)!': !linksCell(p).muted }">{{ linksCell(p).text }}</span>
                    <span v-if="linksCell(p).more" class="wz-mono flex-none text-(--ink-muted)">+{{ linksCell(p).more }}</span>
                    <span v-if="!linksCell(p).review && !linksCell(p).text" class="wz-meta">—</span>
                  </span>
                  <template v-if="!docked">
                    <span role="cell" class="wz-mono text-(--ink-muted)">{{ compact(p.active) }}</span>
                    <span role="cell" class="wz-mono text-(--ink-muted)">{{ p.lastActivity ? day(p.lastActivity) : "—" }}</span>
                  </template>
                </button>
              </div>
            </div>
          </section>
          <p v-if="!state.links.length" class="m-0 flex h-8 flex-none items-center gap-2 px-1 text-xs text-(--ink-muted)">
            <UIcon name="i-lucide-info" class="size-3.5 flex-none" />
            <span class="truncate">No links yet. Suggestions come from a shared owner and name, a manifest or one workspace; open a project to link it by hand.</span>
          </p>
        </div>
        <Empty v-else-if="q || reviewOnly" icon="i-lucide-search-x" title="No projects match" text="Try another name, or show every project.">
          <div class="mt-3 flex items-center gap-4"><button type="button" class="wz-link text-[13px]" @click="q = ''; reviewOnly = false">Show every project</button></div>
        </Empty>
        <Empty v-else icon="i-lucide-folder" title="No projects yet" text="Start a session in any of your agents. Its project shows up here." />
      </div>

      <Dock v-if="selected" type="Project" icon="i-lucide-folder" :id="selected.id" label="Project links" @close="state.linkProject = null">
        <template #head>
          <div class="flex items-center gap-2.5">
            <span aria-hidden="true" class="flex size-8 flex-none items-center justify-center rounded-lg font-display text-[13px] font-bold text-[#100E0D] uppercase" :style="{ background: hue(selected.name) }">{{ selected.name.charAt(0) }}</span>
            <div class="flex min-w-0 flex-col">
              <h2 class="m-0 truncate text-[15px] leading-5 font-semibold">{{ selected.name }}</h2>
              <span class="wz-meta" :title="selected.key">{{ projectPlace(selected.key) }}</span>
            </div>
          </div>
        </template>
        <template #props>
          <DockProps :rows="dockRows" />
        </template>

        <section v-if="mine.suggested.length" aria-label="Suggestions" class="flex flex-col gap-2 border-t border-(--line) pt-3">
          <div class="flex h-5 items-center gap-2"><h3 class="m-0 text-sm font-semibold">To review</h3><span class="wz-mono text-(--ink-muted)">{{ mine.suggested.length }}</span></div>
          <div v-for="s in mine.suggested" :key="s.link.id" :data-suggestion="s.link.id" class="flex flex-col gap-2 rounded-lg border border-(--line) bg-(--paper) p-2.5">
            <div class="flex h-5 min-w-0 items-center gap-2">
              <span aria-hidden="true" class="wz-tile" :style="{ background: hue(s.otherName) }">{{ s.otherName.charAt(0) }}</span>
              <span class="wz-name flex-1">{{ s.otherName }}</span>
              <span class="wz-status flex-none" :style="{ background: RELATION_TONE[s.label].bg, color: RELATION_TONE[s.label].fg }">{{ s.label }}</span>
            </div>
            <dl v-if="s.link.signals.length" class="m-0 flex flex-col gap-1">
              <div v-for="sig in s.link.signals" :key="sig" class="flex min-w-0 flex-wrap items-baseline gap-x-1.5" :title="sig">
                <dt v-if="signalParts(sig).label" class="flex-none text-xs leading-4 text-(--ink-muted)">{{ signalParts(sig).label }}</dt>
                <dd class="m-0 min-w-0 font-mono text-xs leading-4 text-(--ink) [overflow-wrap:anywhere]">{{ signalParts(sig).value }}</dd>
              </div>
            </dl>
            <div class="flex items-center gap-2">
              <UButton size="xs" color="neutral" icon="i-lucide-link-2" label="Link" :loading="busy === s.link.id" @click="decide(s.link.id, 'confirm', s.otherName)" />
              <UButton size="xs" color="neutral" variant="outline" label="Reject" :disabled="busy === s.link.id" @click="decide(s.link.id, 'reject', s.otherName)" />
            </div>
          </div>
        </section>

        <section aria-label="Linked projects" class="flex flex-col gap-1 border-t border-(--line) pt-3">
          <div class="flex h-5 items-center gap-2"><h3 class="m-0 text-sm font-semibold">Linked</h3><span class="wz-mono text-(--ink-muted)">{{ mine.confirmed.length }}</span></div>
          <p v-if="!mine.confirmed.length" class="m-0 text-xs leading-4 text-(--ink-muted)">Not linked to any project. Its memories stay its own.</p>
          <div v-for="c in mine.confirmed" :key="c.link.id" :data-link="c.link.id" class="flex h-8 min-w-0 items-center gap-2">
            <span aria-hidden="true" class="wz-tile" :style="{ background: hue(c.otherName) }">{{ c.otherName.charAt(0) }}</span>
            <span class="min-w-0 flex-1 truncate text-[13px] leading-[18px]">{{ c.otherName }}</span>
            <span class="wz-status flex-none" :style="{ background: RELATION_TONE[c.label].bg, color: RELATION_TONE[c.label].fg }">{{ c.label }}</span>
            <UButton size="xs" color="neutral" variant="ghost" label="Unlink" :loading="busy === c.link.id" @click="decide(c.link.id, 'unlink', c.otherName)" />
          </div>
          <p class="m-0 pt-1 text-xs leading-4 text-(--ink-muted)">Same product: each reads the other. Uses: this one reads the library, never the reverse.</p>
        </section>

        <section aria-label="Link by hand" class="flex flex-col gap-2 border-t border-(--line) pt-3">
          <h3 class="m-0 h-5 text-sm font-semibold">Link by hand</h3>
          <USelectMenu v-model="target" :items="targets" value-key="value" placeholder="Choose a project" size="md" class="w-full" :search-input="{ placeholder: 'Find a project' }" />
          <div class="flex items-center gap-2">
            <div class="wz-segmented" role="group" aria-label="Kind of link">
              <button type="button" :aria-pressed="kind === 'product'" @click="kind = 'product'">Same product</button>
              <button type="button" :aria-pressed="kind === 'uses'" @click="kind = 'uses'">Uses it</button>
            </div>
            <span class="flex-1" />
            <UButton size="sm" color="neutral" variant="outline" label="Link" :disabled="target === undefined" :loading="linking" @click="linkByHand" />
          </div>
        </section>
      </Dock>
    </div>
  </div>
</template>
