<script setup lang="ts">
// ⌘K as Sales OS's Search artboard: a 640px dialog 72px from the top, a 48px input row
// (query, result count, Esc), a 36px row of scope pills, sections with mono labels and
// 36px rows (tile, bold title, muted context, mono meta, ↵ on the selected one), and a
// footer of key hints. Fixed layout: the list scrolls inside, under nothing.
import { computed, nextTick, ref, watch } from "vue";
import { api, type SearchHit } from "../api";
import { compact, hue, KIND_TONE } from "../format";
import { select, selectProject, state, theme, type Tab } from "../viewer";

const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ tab: [tab: Tab] }>();
const term = ref("");
const hits = ref<SearchHit[]>([]);
const scope = ref<"all" | "memories" | "projects" | "actions">("all");
const cursor = ref(0);
// Memories of this project and the ones linked to it, or of every project.
const everywhere = ref(false);
const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

watch([term, everywhere], ([q]) => {
  clearTimeout(timer);
  cursor.value = 0;
  if (q.trim().length < 2) {
    hits.value = [];
    return;
  }
  timer = setTimeout(async () => {
    hits.value = await api.search(q.trim(), 12, everywhere.value ? null : state.projectId);
  }, 120);
});
watch(open, async (o) => {
  if (!o) {
    term.value = "";
    scope.value = "all";
    everywhere.value = false;
    return;
  }
  await nextTick();
  input.value?.focus();
});

interface Row {
  key: string;
  title: string;
  sub: string;
  meta: string;
  tile: { text: string; bg: string; fg: string; round?: boolean; icon?: string };
  run: () => void | Promise<void>;
}
const close = () => {
  open.value = false;
};
const go = (tab: Tab) => () => {
  close();
  emit("tab", tab);
};
const q = computed(() => term.value.trim().toLowerCase());
const sections = computed(() => {
  const memories: Row[] = hits.value.map((h) => ({
    key: `m${h.id}`,
    title: h.title,
    sub: h.kind,
    meta: h.projectName,
    tile: { text: "", bg: KIND_TONE[h.kind].bg, fg: KIND_TONE[h.kind].fg, icon: "i-lucide-sticky-note" },
    run: async () => {
      close();
      if (h.projectId !== state.projectId) await selectProject(h.projectId);
      emit("tab", "memories");
      await select(h.id);
    },
  }));
  const projects: Row[] = state.projects
    .filter((p) => !q.value || p.name.toLowerCase().includes(q.value))
    .slice(0, q.value ? 6 : 4)
    .map((p) => ({
      key: `p${p.id}`,
      title: p.name,
      sub: p.key.replace(/^remote:/, ""),
      meta: `${compact(p.active)} active`,
      tile: { text: p.name.charAt(0), bg: hue(p.name), fg: "#100E0D" },
      run: async () => {
        close();
        await selectProject(p.id);
      },
    }));
  const actions: Row[] = [
    { key: "a1", title: "Show memories", sub: "This project's memories, grouped by kind", meta: "", tile: { text: "", bg: "var(--violet-soft)", fg: "var(--violet-text)", icon: "i-lucide-sticky-note" }, run: go("memories") },
    { key: "a2", title: "Show turns", sub: "Every prompt and what it became", meta: "", tile: { text: "", bg: "var(--violet-soft)", fg: "var(--violet-text)", icon: "i-lucide-history" }, run: go("turns") },
    { key: "a3", title: "Show overview", sub: "Numbers and charts for this project", meta: "", tile: { text: "", bg: "var(--violet-soft)", fg: "var(--violet-text)", icon: "i-lucide-chart-column" }, run: go("overview") },
    { key: "a6", title: "Search past conversations", sub: "Every Claude Code and Codex session on this machine", meta: "", tile: { text: "", bg: "var(--violet-soft)", fg: "var(--violet-text)", icon: "i-lucide-messages-square" }, run: go("history") },
    { key: "a7", title: "Show projects and links", sub: "Which projects read each other, and suggestions to review", meta: "", tile: { text: "", bg: "var(--violet-soft)", fg: "var(--violet-text)", icon: "i-lucide-link-2" }, run: go("projects") },
    { key: "a8", title: "Show your rules", sub: "Rules you repeat, proposed to be yours in every project", meta: "", tile: { text: "", bg: "var(--violet-soft)", fg: "var(--violet-text)", icon: "i-lucide-user-round-check" }, run: go("you") },
    { key: "a4", title: "Open settings", sub: "Judge, retention, storage, backups", meta: "", tile: { text: "", bg: "var(--violet-soft)", fg: "var(--violet-text)", icon: "i-lucide-settings" }, run: go("settings") },
    {
      key: "a5",
      title: theme.value === "dark" ? "Switch to light" : "Switch to dark",
      sub: "Remembered by this browser",
      meta: "",
      tile: { text: "", bg: "var(--violet-soft)", fg: "var(--violet-text)", icon: theme.value === "dark" ? "i-lucide-sun" : "i-lucide-moon" },
      run: () => {
        close();
        theme.value = theme.value === "dark" ? "light" : "dark";
      },
    },
  ].filter((a) => !q.value || a.title.toLowerCase().includes(q.value));
  return [
    { key: "memories" as const, label: "Memories", rows: memories, hint: q.value.length < 2 ? (everywhere.value || state.projectId === null ? "Type two letters to search every project" : "Type two letters to search this project and the ones linked to it") : "" },
    { key: "projects" as const, label: "Projects", rows: projects, hint: "" },
    { key: "actions" as const, label: "Actions", rows: actions, hint: "" },
  ];
});
const shown = computed(() => sections.value.filter((s) => (scope.value === "all" || scope.value === s.key) && (s.rows.length || s.hint)));
const flat = computed(() => shown.value.flatMap((s) => s.rows));
const count = computed(() => sections.value.reduce((a, s) => a + s.rows.length, 0));
const scopes = computed(() => [
  { key: "all" as const, label: "All", n: count.value },
  ...sections.value.map((s) => ({ key: s.key, label: s.label, n: s.rows.length })),
]);

function onKey(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = flat.value.length;
    if (!n) return;
    cursor.value = (cursor.value + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    nextTick(() => list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }));
  } else if (e.key === "Enter") {
    e.preventDefault();
    void flat.value[cursor.value]?.run();
  } else if (e.key === "Tab") {
    e.preventDefault();
    const keys = scopes.value.map((s) => s.key);
    scope.value = keys[(keys.indexOf(scope.value) + (e.shiftKey ? keys.length - 1 : 1)) % keys.length] ?? "all";
    cursor.value = 0;
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Search"
    description="Search memories of this project and its linked ones, or of every project; jump to a project or run an action"
    :ui="{ content: 'top-[72px] translate-y-0 sm:max-w-[640px] rounded-xl bg-(--paper-raised) ring-0 shadow-[0_0_0_1px_var(--line),0_2px_6px_#100E0D0d,0_24px_60px_-12px_#100e0d33] overflow-hidden', overlay: 'bg-[rgba(16,14,13,.48)]' }"
  >
    <template #content>
      <div class="flex flex-col" @keydown="onKey">
        <div class="flex h-12 flex-none items-center gap-3 border-b border-(--line) pr-3 pl-4">
          <UIcon name="i-lucide-search" class="size-4 flex-none text-(--ink-muted)" />
          <input ref="input" v-model="term" type="text" autocomplete="off" spellcheck="false" aria-label="Search memories, projects and actions" placeholder="Search memories, projects or type a command" class="h-8 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm leading-5 font-medium text-(--ink) caret-(--primary) outline-none focus-visible:outline-none placeholder:font-normal placeholder:text-(--line-strong)">
          <span class="flex-none font-mono text-xs text-(--line-strong)">{{ count }} results</span>
          <button type="button" class="wz-kbd hover:text-(--ink)" @click="close">Esc</button>
        </div>
        <div role="tablist" aria-label="Result type" class="flex h-9 flex-none items-center gap-2 border-b border-(--row-line) px-4">
          <button
            v-for="s in scopes"
            :key="s.key"
            type="button"
            role="tab"
            :aria-selected="scope === s.key"
            class="flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs whitespace-nowrap"
            :class="scope === s.key ? 'bg-(--ink) font-semibold text-(--paper)' : 'border border-(--line) text-(--ink-muted) hover:text-(--ink)'"
            @click="scope = s.key; cursor = 0"
          >
            {{ s.label }}<span class="font-mono text-[10.5px]" :class="scope === s.key ? 'text-(--paper)' : 'text-(--line-strong)'">{{ s.n }}</span>
          </button>
          <span class="flex-1" />
          <span class="flex items-center gap-1 text-xs text-(--line-strong)"><span class="wz-kbd">Tab</span>switch type</span>
        </div>
        <div ref="list" role="listbox" aria-label="Results" class="flex max-h-[508px] flex-col overflow-y-auto px-2 py-1">
          <template v-for="s in shown" :key="s.key">
            <div role="presentation" class="flex h-7 flex-none items-center gap-2 px-2">
              <span class="wz-label">{{ s.label }}</span>
              <span class="font-mono text-[10.5px] text-(--line-strong)">{{ s.rows.length }}</span>
            </div>
            <p v-if="!s.rows.length && s.hint" class="m-0 flex h-9 items-center px-2 text-xs text-(--ink-muted)">{{ s.hint }}</p>
            <button
              v-for="r in s.rows"
              :key="r.key"
              type="button"
              role="option"
              :aria-selected="flat[cursor] === r"
              class="flex h-9 flex-none items-center gap-3 rounded-lg px-2 text-left text-(--ink)"
              :class="flat[cursor] === r ? 'bg-(--paper-sunken)' : 'hover:bg-(--surface-hover)'"
              @mouseenter="cursor = flat.indexOf(r)"
              @click="r.run()"
            >
              <span aria-hidden="true" class="flex size-5 flex-none items-center justify-center font-display text-[10px] font-bold uppercase" :class="r.tile.round ? 'rounded-full' : 'rounded-md'" :style="{ background: r.tile.bg, color: r.tile.fg }">
                <UIcon v-if="r.tile.icon" :name="r.tile.icon" class="size-3" />{{ r.tile.text }}
              </span>
              <span class="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden whitespace-nowrap">
                <span class="min-w-0 flex-initial truncate text-[13px] leading-[18px] font-semibold">{{ r.title }}</span>
                <span class="min-w-0 flex-1 truncate text-xs leading-4 text-(--ink-muted)">{{ r.sub }}</span>
              </span>
              <span v-if="r.meta" class="flex-none font-mono text-xs text-(--ink-muted)">{{ r.meta }}</span>
              <span v-if="flat[cursor] === r" class="wz-kbd">↵</span>
            </button>
          </template>
          <p v-if="!flat.length && q.length >= 2" class="m-0 flex h-9 items-center px-2 text-xs text-(--ink-muted)">Nothing matches “{{ term }}”.</p>
        </div>
        <div class="flex h-9 flex-none items-center gap-3 border-t border-(--line) bg-(--paper) px-4 text-xs text-(--ink-muted)">
          <span class="flex items-center gap-1"><span class="wz-kbd">↑</span><span class="wz-kbd">↓</span>navigate</span>
          <span class="flex items-center gap-1"><span class="wz-kbd">↵</span>open</span>
          <span class="flex-1" />
          <div class="wz-segmented" role="group" aria-label="Which memories">
            <button type="button" :aria-pressed="!everywhere" :disabled="state.projectId === null" @click="everywhere = false">This and linked</button>
            <button type="button" :aria-pressed="everywhere" @click="everywhere = true">Every project</button>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
