<script setup lang="ts">
// Settings as Sales OS's Settings artboard: a 200px secondary nav in groups (mono labels,
// 30px rows with an icon and a count or state on the right) and one page at a time.
import { computed, onMounted, ref } from "vue";
import { api, type Check } from "../api";
import { loadSettings, settingsState, valueOf } from "../settings";
import About from "./settings/About.vue";
import Agents from "./settings/Agents.vue";
import Backups from "./settings/Backups.vue";
import Health from "./settings/Health.vue";
import History from "./settings/History.vue";
import Judge from "./settings/Judge.vue";
import Retention from "./settings/Retention.vue";
import Storage from "./settings/Storage.vue";
import Team from "./settings/Team.vue";
import Viewer from "./settings/Viewer.vue";

const checks = ref<Check[] | null>(null);
async function loadChecks() {
  try {
    checks.value = await api.doctor();
  } catch {
    checks.value = [];
  }
}
onMounted(() => {
  if (settingsState.view === null) void loadSettings();
  void loadChecks();
});
const AGENT_CHECKS = ["Claude Code", "Claude Desktop", "Codex", "Cursor", "Gemini CLI", "OpenCode", "Qwen Code", "Factory Droid", "GitHub Copilot", "Antigravity"];
const agentChecks = computed(() => (checks.value ?? []).filter((c) => AGENT_CHECKS.includes(c.name)));
const healthChecks = computed(() => (checks.value ?? []).filter((c) => !AGENT_CHECKS.includes(c.name)));

type Page = "agents" | "health" | "judge" | "retention" | "history" | "storage" | "backups" | "viewer" | "team" | "about";
const PAGES: Page[] = ["agents", "health", "judge", "retention", "history", "storage", "backups", "viewer", "team", "about"];
// #settings/<page> opens that page (a link from the offer, or from elsewhere).
const linked = /^#settings\/([a-z]+)$/.exec(location.hash)?.[1] as Page | undefined;
const page = ref<Page>(linked && PAGES.includes(linked) ? linked : "agents");
const GROUPS = computed<{ label: string; items: { id: Page; label: string; icon: string; meta?: string; warn?: boolean }[] }[]>(() => [
  {
    label: "This machine",
    items: [
      { id: "agents", label: "Agents", icon: "i-lucide-plug", meta: checks.value ? `${agentChecks.value.filter((c) => c.status === "ok").length}/${agentChecks.value.length}` : undefined },
      { id: "health", label: "Health", icon: "i-lucide-activity", meta: healthChecks.value.some((c) => c.status !== "ok") ? `${healthChecks.value.filter((c) => c.status === "warn" || c.status === "fail").length}` : undefined, warn: healthChecks.value.some((c) => c.status === "warn" || c.status === "fail") },
    ],
  },
  {
    label: "Memory",
    items: [
      { id: "judge", label: "Judge", icon: "i-lucide-scale" },
      { id: "retention", label: "Retention", icon: "i-lucide-timer" },
      { id: "history", label: "History", icon: "i-lucide-history" },
    ],
  },
  {
    label: "Data",
    items: [
      { id: "storage", label: "Storage", icon: "i-lucide-hard-drive" },
      { id: "backups", label: "Backups", icon: "i-lucide-archive", meta: valueOf("WIZARDINGCODE_MEM_BACKUP_TO") ? undefined : "off" },
    ],
  },
  {
    label: "App",
    items: [
      { id: "viewer", label: "Viewer", icon: "i-lucide-monitor" },
      { id: "team", label: "Collaboration", icon: "i-lucide-users", meta: "soon" },
      { id: "about", label: "About", icon: "i-lucide-info" },
    ],
  },
]);
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <nav aria-label="Settings" class="flex w-[200px] flex-none flex-col gap-3 overflow-y-auto border-r border-(--line) px-2 py-3">
      <div v-for="g in GROUPS" :key="g.label" class="flex flex-col gap-0.5">
        <p class="wz-label m-0 mb-1 px-2">{{ g.label }}</p>
        <button
          v-for="n in g.items"
          :key="n.id"
          type="button"
          :aria-current="page === n.id ? 'page' : undefined"
          class="flex h-[30px] items-center gap-2 rounded-md px-2 text-left text-[13px]"
          :class="page === n.id ? 'bg-(--paper-sunken) font-semibold text-(--ink)' : 'text-(--ink) hover:bg-(--surface-hover)'"
          @click="page = n.id"
        >
          <UIcon :name="n.icon" class="size-3.5 flex-none text-(--ink-muted)" />
          <span class="min-w-0 flex-1 truncate">{{ n.label }}</span>
          <span v-if="n.meta" class="font-mono text-[10.5px]" :class="n.warn ? 'rounded-full bg-(--warn-soft) px-1.5 text-(--warn)' : 'text-(--line-strong)'">{{ n.meta }}</span>
        </button>
      </div>
      <div class="flex-1" />
      <p v-if="settingsState.view" class="m-0 px-2 text-[11.5px] leading-4 text-(--ink-muted)">Kept in the data directory, readable by you only. The environment always wins over the file.</p>
    </nav>
    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div class="flex max-w-[880px] flex-col gap-5 p-4 pb-8">
        <p v-if="settingsState.view === null" class="m-0 text-[13px] text-(--ink-muted)">Loading…</p>
        <template v-else>
          <Agents v-if="page === 'agents'" :checks="agentChecks" :loaded="checks !== null" @refresh="loadChecks" />
          <Health v-else-if="page === 'health'" :checks="healthChecks" :loaded="checks !== null" @refresh="loadChecks" />
          <Judge v-else-if="page === 'judge'" />
          <Retention v-else-if="page === 'retention'" />
          <History v-else-if="page === 'history'" />
          <Storage v-else-if="page === 'storage'" />
          <Backups v-else-if="page === 'backups'" />
          <Viewer v-else-if="page === 'viewer'" />
          <Team v-else-if="page === 'team'" />
          <About v-else />
        </template>
      </div>
    </div>
  </div>
</template>
