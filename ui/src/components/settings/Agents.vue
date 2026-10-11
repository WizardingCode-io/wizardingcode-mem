<script setup lang="ts">
// The agents on this machine, as Settings' Integrations table: the agent's tile and name,
// a status pill (a word and a dot whose shape changes), how it is installed.
import type { Check } from "../../api";
import { AGENT_TILE } from "../../format";
import Card from "./Card.vue";
import { CHECK_STATUS } from "./status";

defineProps<{ checks: Check[]; loaded: boolean }>();
const emit = defineEmits<{ refresh: [] }>();
const ID: Record<string, string> = { "Claude Code": "claude-code", "Claude Desktop": "claude-desktop", Codex: "codex", Cursor: "cursor", "Gemini CLI": "gemini", OpenCode: "opencode", "Qwen Code": "qwen" };
const COLS = "grid-template-columns: 196px 104px minmax(0, 1fr);";
</script>

<template>
  <Card id="agents" title="Agents" :description="loaded ? `${checks.filter((c) => c.status === 'ok').length} of ${checks.length} have wizardingcode-mem · each installs it natively` : 'Each agent installs wizardingcode-mem natively'" flush>
    <template #aside>
      <UTooltip text="Check again"><button type="button" class="wz-icon-btn" aria-label="Check again" @click="emit('refresh')"><UIcon name="i-lucide-refresh-cw" class="size-[15px]" /></button></UTooltip>
    </template>
    <div class="wz-table-head" :style="COLS"><span>Agent</span><span>Status</span><span>Installed as</span></div>
    <div v-for="c in checks" :key="c.name" class="grid min-h-10 items-center gap-x-2 border-t border-(--row-line) px-3 py-1.5" :style="COLS">
      <span class="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" class="wz-tile" :style="{ background: AGENT_TILE[ID[c.name] ?? '']?.bg ?? '#D9D4CD' }">{{ AGENT_TILE[ID[c.name] ?? ""]?.letter ?? c.name.charAt(0) }}</span>
        <span class="wz-name">{{ c.name }}</span>
      </span>
      <span><span class="wz-status" :class="CHECK_STATUS[c.status].shape" :style="{ background: CHECK_STATUS[c.status].bg, color: CHECK_STATUS[c.status].fg }">{{ c.status === "ok" ? "Installed" : c.status === "skip" ? "Not here" : CHECK_STATUS[c.status].label }}</span></span>
      <span class="min-w-0 text-xs leading-4 text-(--ink-muted) [overflow-wrap:anywhere]">{{ c.detail }}</span>
    </div>
    <p v-if="!loaded" class="m-0 border-t border-(--row-line) p-3 text-[13px] text-(--ink-muted)">Checking…</p>
  </Card>
</template>
