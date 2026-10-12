<script setup lang="ts">
// Your rules as Sales OS's Settings tables (Integrations, Agents & approvals): a section title
// with one muted line, then a card with a 28px column header and 32px rows (bold rule, muted
// why; the projects as pills; the kind; the row's action on the right). A rule opens in the
// app's 320px dock with its full text and Make mine / Reject, or Undo once it is yours.
import { computed, ref } from "vue";
import { api, type AcceptedRule, type ProposedRule } from "../api";
import { day, KIND_TONE, projectTone } from "../format";
import { ruleWhy } from "../links";
import { loadOverview, state } from "../viewer";
import Dock from "./Dock.vue";
import DockProps from "./DockProps.vue";
import Empty from "./Empty.vue";
import Markdown from "./Markdown.vue";

const props = defineProps<{ docked: boolean }>();
const toast = useToast();

const proposed = computed(() => state.rules?.proposed ?? []);
const accepted = computed(() => state.rules?.accepted ?? []);
const COLS_WIDE = "grid-template-columns: minmax(0, 1fr) 200px 96px 152px;";
const COLS_DOCK = "grid-template-columns: minmax(0, 1fr) 152px;";
const cols = computed(() => (props.docked ? COLS_DOCK : COLS_WIDE));
const kindTone = (kind: string) => KIND_TONE[kind as keyof typeof KIND_TONE] ?? { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" };

type Selected = { type: "proposed"; rule: ProposedRule } | { type: "accepted"; rule: AcceptedRule };
const selected = computed<Selected | null>(() => {
  const key = state.rule;
  if (key === null) return null;
  const id = Number(key.slice(1));
  if (key.startsWith("p")) {
    const rule = proposed.value.find((r) => r.id === id);
    return rule ? { type: "proposed", rule } : null;
  }
  const rule = accepted.value.find((r) => r.memoryId === id);
  return rule ? { type: "accepted", rule } : null;
});
function open(key: string) {
  state.rule = state.rule === key ? null : key;
  history.replaceState(null, "", state.rule === null ? "#you" : `#you/${key}`);
}
const dockRows = computed(() => {
  const s = selected.value;
  if (!s) return [];
  return [
    { icon: "i-lucide-tag", k: "Kind", v: s.rule.kind },
    { icon: "i-lucide-folder", k: s.type === "proposed" ? "Found in" : "Replaced in", v: s.rule.projects.length ? `${s.rule.projects.length} ${s.rule.projects.length === 1 ? "project" : "projects"}` : "—" },
    { icon: "i-lucide-sparkles", k: "Why", v: ruleWhy(s.rule) },
    { icon: "i-lucide-clock", k: s.type === "proposed" ? "Proposed" : "Yours since", v: day(s.rule.createdAt), mono: true },
  ];
});

const busy = ref<string | null>(null);
async function act(key: string, run: () => Promise<unknown>, done: { title: string; description: string }) {
  busy.value = key;
  try {
    await run();
    await loadOverview();
    toast.add({ ...done, color: "success" });
  } catch (error) {
    toast.add({ title: "Not changed", description: error instanceof Error ? error.message : String(error), color: "error" });
  } finally {
    busy.value = null;
  }
}
const makeMine = (r: ProposedRule) =>
  act(`p${r.id}`, () => api.decideRule(r.id, "accept"), {
    title: "Made yours",
    description: `Every project's brief now carries it, labelled (you). The ${r.projects.length === 1 ? "copy is" : `${r.projects.length} copies are`} kept, superseded.`,
  });
const reject = (r: ProposedRule) =>
  act(`p${r.id}`, () => api.decideRule(r.id, "reject"), { title: "Proposal rejected", description: "It will not be proposed again." });
const undo = (r: AcceptedRule) =>
  act(`r${r.memoryId}`, () => api.undoRule(r.memoryId), { title: "No longer yours", description: "The rule is archived and each project has its own copy back." });
</script>

<template>
  <div class="flex min-h-0 flex-1 border-t border-(--line)">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-4">
      <template v-if="state.rules && (proposed.length || accepted.length)">
        <!-- Proposed: what you keep repeating, waiting for Make mine or Reject. -->
        <section aria-label="Proposed rules" class="flex flex-none flex-col gap-2">
          <div class="flex h-5 items-center gap-2">
            <h2 class="m-0 text-sm leading-5 font-semibold whitespace-nowrap">Proposed</h2>
            <span class="wz-meta">Conventions and decisions you repeat in projects that are not linked, or said hold everywhere</span>
          </div>
          <div class="wz-table">
            <div role="row" class="wz-table-head" :style="cols">
              <span role="columnheader">Rule · why</span>
              <template v-if="!docked">
                <span role="columnheader">Found in</span>
                <span role="columnheader">Kind</span>
              </template>
              <span role="columnheader" class="text-right">Action</span>
            </div>
            <div
              v-for="r in proposed"
              :key="r.id"
              :data-proposal="r.id"
              role="row"
              tabindex="0"
              class="wz-row"
              :style="cols"
              :aria-selected="state.rule === `p${r.id}`"
              @click="open(`p${r.id}`)"
              @keydown.enter.self="open(`p${r.id}`)"
            >
              <span role="cell" class="flex min-w-0 items-center gap-1.5">
                <span class="wz-name max-w-[64%] flex-initial">{{ r.title }}</span>
                <span class="wz-meta flex-1">{{ ruleWhy(r) }}</span>
              </span>
              <template v-if="!docked">
                <span role="cell" class="flex min-w-0 items-center gap-1 overflow-hidden" :title="r.projects.join(', ')">
                  <span v-for="name in r.projects.slice(0, 2)" :key="name" class="inline-flex h-5 min-w-0 flex-initial items-center rounded px-1.5 text-[11px] leading-[14px] font-semibold whitespace-nowrap" :style="{ background: projectTone(name).bg, color: projectTone(name).fg }"><span class="truncate">{{ name }}</span></span>
                  <span v-if="r.projects.length > 2" class="wz-mono flex-none text-(--ink-muted)">+{{ r.projects.length - 2 }}</span>
                </span>
                <span role="cell" class="flex min-w-0"><span class="wz-stage" :style="{ background: kindTone(r.kind).bg, color: kindTone(r.kind).fg }">{{ r.kind }}</span></span>
              </template>
              <span role="cell" class="flex items-center justify-end gap-1" @click.stop>
                <UButton size="xs" color="neutral" variant="ghost" label="Reject" :disabled="busy === `p${r.id}`" @click="reject(r)" />
                <UButton size="xs" color="neutral" variant="outline" label="Make mine" :loading="busy === `p${r.id}`" @click="makeMine(r)" />
              </span>
            </div>
            <p v-if="!proposed.length" class="m-0 flex h-8 items-center border-t border-(--row-line) px-3 text-xs text-(--ink-muted)">Nothing waiting. What you repeat in two projects shows up here.</p>
          </div>
        </section>

        <!-- Yours: in every project's brief, labelled (you); Undo gives the projects their copies back. -->
        <section aria-label="Your rules" class="flex flex-none flex-col gap-2">
          <div class="flex h-5 items-center gap-2">
            <h2 class="m-0 text-sm leading-5 font-semibold whitespace-nowrap">Yours</h2>
            <span class="wz-meta">In every project's brief, labelled (you)</span>
          </div>
          <div class="wz-table">
            <div role="row" class="wz-table-head" :style="cols">
              <span role="columnheader">Rule</span>
              <template v-if="!docked">
                <span role="columnheader">Replaced in</span>
                <span role="columnheader">Since</span>
              </template>
              <span role="columnheader" class="text-right">Action</span>
            </div>
            <div
              v-for="r in accepted"
              :key="r.memoryId"
              :data-rule="r.memoryId"
              role="row"
              tabindex="0"
              class="wz-row"
              :style="cols"
              :aria-selected="state.rule === `r${r.memoryId}`"
              @click="open(`r${r.memoryId}`)"
              @keydown.enter.self="open(`r${r.memoryId}`)"
            >
              <span role="cell" class="flex min-w-0 items-center gap-2">
                <span class="wz-ring" :style="{ color: kindTone(r.kind).fg }" role="img" :aria-label="r.kind" />
                <span class="wz-name flex-initial">{{ r.title }}</span>
              </span>
              <template v-if="!docked">
                <span role="cell" class="flex min-w-0 items-center gap-1 overflow-hidden" :title="r.projects.join(', ')">
                  <span v-for="name in r.projects.slice(0, 2)" :key="name" class="inline-flex h-5 min-w-0 flex-initial items-center rounded px-1.5 text-[11px] leading-[14px] font-semibold whitespace-nowrap" :style="{ background: projectTone(name).bg, color: projectTone(name).fg }"><span class="truncate">{{ name }}</span></span>
                  <span v-if="r.projects.length > 2" class="wz-mono flex-none text-(--ink-muted)">+{{ r.projects.length - 2 }}</span>
                  <span v-if="!r.projects.length" class="wz-meta">—</span>
                </span>
                <span role="cell" class="wz-mono text-(--ink-muted)">{{ day(r.createdAt) }}</span>
              </template>
              <span role="cell" class="flex items-center justify-end" @click.stop>
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-undo-2" label="Undo" :loading="busy === `r${r.memoryId}`" @click="undo(r)" />
              </span>
            </div>
            <p v-if="!accepted.length" class="m-0 flex h-8 items-center border-t border-(--row-line) px-3 text-xs text-(--ink-muted)">None yet. Make a proposal yours and it shows up here.</p>
          </div>
        </section>
      </template>
      <div v-else-if="state.rules === null" class="wz-table">
        <div class="flex h-7 items-center px-3"><span class="skeleton h-3 w-28" /></div>
        <div v-for="r in 4" :key="r" class="flex h-8 items-center gap-3 border-t border-(--row-line) px-3"><span class="skeleton h-3 flex-1" /><span class="skeleton h-3 w-24" /><span class="skeleton h-3 w-16" /></div>
      </div>
      <Empty v-else icon="i-lucide-user-round-check" title="No rules of yours yet" text="When you repeat a convention or decision in projects that are not linked, or say it holds everywhere, it is proposed here to become yours." />
    </div>

    <Dock v-if="selected" type="Rule" icon="i-lucide-user-round-check" :id="selected.type === 'proposed' ? selected.rule.id : selected.rule.memoryId" :label="selected.type === 'proposed' ? 'Proposed rule' : 'Your rule'" @close="state.rule = null">
      <template #head>
        <div class="flex flex-col gap-1">
          <span class="wz-label">{{ selected.type === "proposed" ? "Proposed" : "Yours" }} · {{ ruleWhy(selected.rule) }}</span>
          <h2 class="wz-title wz-clamp m-0 line-clamp-3 text-[15px] leading-5 font-semibold [overflow-wrap:anywhere]">{{ selected.rule.title }}</h2>
        </div>
      </template>
      <template #props>
        <DockProps :rows="dockRows" />
      </template>
      <section v-if="selected.rule.projects.length" class="flex flex-col gap-2 border-t border-(--line) pt-3">
        <h3 class="m-0 h-5 text-sm font-semibold">{{ selected.type === "proposed" ? "Found in" : "Replaced in" }}</h3>
        <div class="flex flex-wrap gap-1">
          <span v-for="name in selected.rule.projects" :key="name" class="inline-flex h-5 items-center rounded px-1.5 text-[11px] leading-[14px] font-semibold whitespace-nowrap" :style="{ background: projectTone(name).bg, color: projectTone(name).fg }">{{ name }}</span>
        </div>
        <p class="m-0 text-xs leading-4 text-(--ink-muted)">{{ selected.type === "proposed" ? "Make it yours and these copies are superseded, never deleted." : "Undo and each of these gets its copy back." }}</p>
      </section>
      <section class="flex flex-col gap-2 border-t border-(--line) pt-3">
        <h3 class="m-0 h-5 text-sm font-semibold">The rule</h3>
        <Markdown v-if="selected.rule.body" :source="selected.rule.body" />
        <p v-else class="m-0 text-xs leading-4 text-(--ink-muted)">No more than its title.</p>
      </section>
      <template #footer>
        <template v-if="selected.type === 'proposed'">
          <UButton size="md" label="Make mine" icon="i-lucide-check" :loading="busy === `p${selected.rule.id}`" @click="makeMine(selected.rule)" />
          <UButton size="md" color="neutral" variant="outline" label="Reject" :disabled="busy === `p${selected.rule.id}`" @click="reject(selected.rule)" />
        </template>
        <UButton v-else size="md" color="neutral" variant="outline" icon="i-lucide-undo-2" label="Undo" :loading="busy === `r${selected.rule.memoryId}`" @click="undo(selected.rule)" />
      </template>
    </Dock>
  </div>
</template>
