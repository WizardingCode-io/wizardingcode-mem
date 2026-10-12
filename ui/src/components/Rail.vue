<script setup lang="ts">
// The icon rail: 48px, 36×36 icon buttons (radius 8) with a tooltip to the right that names
// them and their key. Top: fold the projects panel. The views of the modules that are on
// (/api/modules; memory's are Memories, Turns, Overview, History, Across projects). Bottom:
// theme, settings.
import { rail, sidebarOpen, type Tab, theme } from "../viewer";

defineProps<{ tab: Tab }>();
const emit = defineEmits<{ go: [tab: Tab] }>();
/** Projects and You are one page: the rail lights its button on either. */
const on = (view: string, tab: Tab) => view === tab || (view === "projects" && tab === "you");
const btn = (on: boolean) => [
  "flex size-9 items-center justify-center rounded-lg",
  on ? "bg-[#25211E] text-[#F4F1EC]" : "text-[#9A938B] hover:bg-[#1E1B18] hover:text-[#F4F1EC]",
];
const tip = { content: { side: "right" as const, sideOffset: 8 } };
</script>

<template>
  <nav aria-label="Main" class="flex w-12 flex-none flex-col items-center gap-1 border-r border-[#2B2724] bg-[#0B0A09] py-2">
    <UTooltip :text="sidebarOpen ? 'Hide projects' : 'Show projects'" :kbds="['[']" v-bind="tip">
      <button type="button" :class="btn(false)" :aria-pressed="sidebarOpen" :aria-label="sidebarOpen ? 'Hide projects' : 'Show projects'" @click="sidebarOpen = !sidebarOpen">
        <UIcon :name="sidebarOpen ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'" class="size-[18px]" />
      </button>
    </UTooltip>
    <span class="my-1 h-px w-6 bg-[#2B2724]" />
    <UTooltip v-for="v in rail" :key="v.tab" :text="v.label" :kbds="v.key === '' ? [] : [v.key]" v-bind="tip">
      <button type="button" :class="btn(on(v.tab, tab))" :aria-label="v.label" :aria-current="on(v.tab, tab) ? 'page' : undefined" @click="emit('go', v.tab as Tab)">
        <UIcon :name="v.icon" class="size-[18px]" />
      </button>
    </UTooltip>
    <div class="flex-1" />
    <UTooltip :text="theme === 'dark' ? 'Light theme' : 'Dark theme'" v-bind="tip">
      <button type="button" :class="btn(false)" aria-label="Switch theme" @click="theme = theme === 'dark' ? 'light' : 'dark'"><UIcon :name="theme === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'" class="size-[18px]" /></button>
    </UTooltip>
    <UTooltip text="Settings" :kbds="['5']" v-bind="tip">
      <button type="button" :class="btn(tab === 'settings')" aria-label="Settings" :aria-current="tab === 'settings' ? 'page' : undefined" @click="emit('go', 'settings')"><UIcon name="i-lucide-settings" class="size-[18px]" /></button>
    </UTooltip>
  </nav>
</template>
