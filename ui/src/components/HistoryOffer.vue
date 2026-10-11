<script lang="ts">
import { ref } from "vue";
import type { HistoryStatus } from "../api";

// Asked once per page load: the full status walks the transcripts, so going back and forth
// between views does not ask again.
const offered = ref<HistoryStatus | null>(null);
let asked = false;
</script>

<script setup lang="ts">
// The one-time offer, as Sales OS's page-level info banner (SystemStates SYS-060): 36px, the
// full width of main under the page header, blue-soft with blue text, a 16px icon, one line
// that truncates, the action links on the right.
import { computed, onMounted } from "vue";
import { api } from "../api";
import { sessionsFound, shouldOffer } from "../history";

const emit = defineEmits<{ progress: [] }>();
const toast = useToast();
const busy = ref(false);
const show = computed(() => shouldOffer(offered.value));
const line = computed(() => {
  const s = offered.value;
  if (!s) return "";
  const agents = [s.transcripts.claudeCode > 0 ? "Claude Code" : "", s.transcripts.codex > 0 ? "Codex" : ""].filter(Boolean).join(" and ");
  const count = sessionsFound(s);
  return `Learn from your ${count.toLocaleString("en-GB")} past ${count === 1 ? "session" : "sessions"} with ${agents}. It runs in the background, on this machine.`;
});

onMounted(async () => {
  if (asked) return;
  asked = true;
  try {
    offered.value = await api.history();
  } catch {
    // No offer is better than a broken page.
  }
});

async function accept() {
  busy.value = true;
  try {
    const { started } = await api.historyImport();
    offered.value = null;
    toast.add({
      title: started ? "Import started" : "Already running",
      description: "Progress is in Settings, under History.",
      color: started ? "success" : "info",
      actions: [{ label: "View", color: "neutral", variant: "link", onClick: () => emit("progress") }],
    });
  } catch (error) {
    toast.add({ title: "Not started", description: error instanceof Error ? error.message : String(error), color: "error" });
  } finally {
    busy.value = false;
  }
}

async function dismiss() {
  offered.value = null;
  try {
    await api.dismissHistoryOffer();
  } catch {
    // Shown again next time: nothing is lost.
  }
}
</script>

<template>
  <div v-if="show" role="status" class="flex h-9 flex-none items-center gap-2 bg-(--blue-soft) pr-2 pl-4 text-[12.5px] leading-4 text-(--blue-text)">
    <UIcon name="i-lucide-history" class="size-4 flex-none" />
    <span class="min-w-0 flex-1 truncate">{{ line }}</span>
    <button type="button" class="flex-none cursor-pointer border-0 bg-transparent px-1 text-[12.5px] leading-4 font-semibold whitespace-nowrap text-(--blue-text) underline underline-offset-2 disabled:opacity-60" :disabled="busy" @click="accept">Import</button>
    <button type="button" class="flex-none cursor-pointer border-0 bg-transparent px-1 text-[12.5px] leading-4 font-medium whitespace-nowrap text-(--blue-text) hover:underline hover:underline-offset-2" @click="dismiss">Not now</button>
  </div>
</template>
