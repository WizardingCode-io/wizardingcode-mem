<script setup lang="ts">
// Who makes this, quietly: the version, whether a newer release is out and how to get it,
// where the code is, and WizardingCode's site. The release is read from what the daily check
// kept (ADR 0030); this page asks the network nothing.
import { computed, onMounted } from "vue";
import { fromEnvironment, saveSettings, valueOf } from "../../settings";
import { REPO, siteLink } from "../../site";
import { agentsNote, channelRows, checksDaily, releaseStatus } from "../../update";
import { loadUpdate, updateState } from "../../update-state";
import { state } from "../../viewer";
import Card from "./Card.vue";

const LINKS = [
  { label: "wizardingcode.io", sub: "Agents in production. Not in pilots.", href: siteLink("settings-about"), icon: "i-lucide-globe" },
  { label: "Source code", sub: "Apache-2.0, on GitHub", href: REPO, icon: "i-lucide-code-xml" },
  { label: "Report an issue", sub: "What broke, and what you expected", href: `${REPO}/issues/new`, icon: "i-lucide-message-square-warning" },
  { label: "Releases", sub: "What changed in each version", href: `${REPO}/releases`, icon: "i-lucide-tag" },
];
const TONES = { warn: "text-(--warn)", quiet: "text-(--ink)", muted: "text-(--ink-muted)" } as const;
// A release to get is not a check that failed: each has its sign.
const SIGNS = { out: "i-lucide-circle-arrow-up", problem: "i-lucide-triangle-alert", ok: "i-lucide-circle-check", idle: "i-lucide-circle-dashed" } as const;

const toast = useToast();
const status = computed(() => (updateState.value ? releaseStatus(updateState.value) : null));
const agents = computed(() => (updateState.value ? agentsNote(updateState.value) : null));
const commands = computed(() => (updateState.value ? channelRows(updateState.value) : []));

onMounted(() => loadUpdate());

const daily = computed({
  get: () => checksDaily(updateState.value, valueOf("WIZARDINGCODE_MEM_UPDATE")),
  set: async (on: boolean) => {
    if (await saveSettings({ WIZARDINGCODE_MEM_UPDATE: on ? "check" : "off" })) {
      toast.add({ title: on ? "Checks once a day" : "No longer checks", description: on ? "After a session's memories are saved." : "wizardingcode-mem update still asks when you type it.", color: "success" });
      await loadUpdate(true);
    }
  },
});

async function copy(channel: string, command: string) {
  try {
    await navigator.clipboard.writeText(command);
    toast.add({ title: "Copied", description: `The ${channel} command`, color: "success" });
  } catch {
    toast.add({ title: "Could not copy", color: "error" });
  }
}
</script>

<template>
  <Card id="about" title="About" :description="`wizardingcode-mem ${state.version} · memory for coding agents, by WizardingCode`" flush>
    <div class="flex flex-col gap-3 border-b border-(--row-line) px-4 py-3.5">
      <div v-if="status" class="flex items-start gap-3">
        <UIcon :name="SIGNS[status.sign]" class="mt-px size-4 flex-none" :class="TONES[status.tone]" />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="wz-label">Release</span>
          <p class="m-0 text-[13px] leading-[18px] font-semibold [overflow-wrap:anywhere]" :class="TONES[status.tone]">{{ status.text }}</p>
          <p v-if="agents" class="m-0 text-xs leading-4 [overflow-wrap:anywhere] text-(--ink-muted)">{{ agents }}</p>
        </div>
      </div>
      <ul v-if="commands.length > 0" class="m-0 flex list-none flex-col gap-2 p-0 pl-7" aria-label="How to update, by channel">
        <li v-for="c in commands" :key="c.channel" class="flex min-h-7 flex-wrap items-start gap-x-3 gap-y-0.5">
          <span class="w-32 flex-none basis-full pt-1.5 text-xs leading-4 font-semibold text-(--ink) sm:basis-32">{{ c.channel }}</span>
          <div class="flex min-w-0 flex-1 items-start gap-2">
            <code v-if="c.shell" class="min-w-0 flex-1 pt-1.5 font-mono text-xs leading-4 [overflow-wrap:anywhere] text-(--ink)">{{ c.text }}</code>
            <span v-else class="min-w-0 flex-1 pt-1.5 text-xs leading-4 text-(--ink-muted)">{{ c.text }}</span>
            <UTooltip v-if="c.shell" :text="`Copy the ${c.channel} command`">
              <button type="button" class="wz-icon-btn" :aria-label="`Copy the ${c.channel} command`" @click="copy(c.channel, c.text)"><UIcon name="i-lucide-copy" class="size-3.5" /></button>
            </UTooltip>
          </div>
        </li>
      </ul>
      <USwitch v-model="daily" :disabled="fromEnvironment('WIZARDINGCODE_MEM_UPDATE')" label="Check for new releases once a day" :description="fromEnvironment('WIZARDINGCODE_MEM_UPDATE') ? 'Set by WIZARDINGCODE_MEM_UPDATE in the environment this viewer was started with.' : 'After a session\'s memories are saved, github.com is asked which release is the latest. Nothing is downloaded.'" />
    </div>
    <a
      v-for="(l, i) in LINKS"
      :key="l.label"
      :href="l.href"
      target="_blank"
      rel="noopener noreferrer"
      class="flex h-11 items-center gap-3 px-4 hover:bg-(--surface-hover)"
      :class="{ 'border-t border-(--row-line)': i > 0 }"
    >
      <UIcon :name="l.icon" class="size-4 flex-none text-(--ink-muted)" />
      <span class="wz-name flex-none">{{ l.label }}</span>
      <span class="wz-meta flex-1">{{ l.sub }}</span>
      <UIcon name="i-lucide-arrow-up-right" class="size-3.5 flex-none text-(--ink-muted)" />
    </a>
  </Card>
</template>
