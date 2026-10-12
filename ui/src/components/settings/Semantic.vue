<script setup lang="ts">
// Search by meaning, drawn as the History card: the source rows of Sales OS's Knowledge base
// panel (a 28px tile, the name over a 12px line, a status pill and the row's action on the
// right, a 4px bar with the percentage while something runs). Polls only while it runs.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api, type SemanticStatus } from "../../api";
import { awaitingBackfill, downloadPercent, modelLine, modelPill, SEMANTIC_POLL_MS, semanticBusy, vectorsLine, vectorsPercent, vectorsPill } from "../../semantic";
import Confirm from "../Confirm.vue";
import Card from "./Card.vue";

const toast = useToast();
const status = ref<SemanticStatus | null>(null);
const busy = ref<"none" | "download" | "backfill" | "switch" | "delete">("none");
const deleting = ref(false);
/** When this page asked for a run, so polling waits for the background process to show. */
let requestedAt: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

const fail = (title: string, error: unknown) =>
  toast.add({ title, description: error instanceof Error ? error.message : String(error), color: "error" });

const s = computed(() => status.value);
const downloading = computed(() => s.value?.download.running === true);
const backfilling = computed(() => s.value?.backfill.running === true);
const running = computed(() => downloading.value || backfilling.value);
const pill = computed(() => (s.value ? modelPill(s.value) : null));
const vpill = computed(() => (s.value ? vectorsPill(s.value) : null));
const fromEnv = computed(() => s.value?.model.source === "env");
const missing = computed(() => (s.value ? s.value.memories.active - s.value.memories.withVectors : 0));
const sizeMb = computed(() => (s.value ? Math.round((s.value.model.bytes || s.value.model.expectedBytes) / 1024 / 1024) : 140));

function schedule() {
  if (timer !== null || stopped) return;
  timer = setTimeout(() => {
    timer = null;
    void poll();
  }, SEMANTIC_POLL_MS);
}

async function poll() {
  const was = running.value;
  const before = s.value;
  await load();
  const now = s.value;
  if (!now) return;
  // The download hands over to the backfill: wait for it rather than stop polling in between.
  if (before && awaitingBackfill(before, now)) requestedAt = Date.now();
  if (semanticBusy(now, requestedAt, Date.now())) {
    if (now.download.running || now.backfill.running) requestedAt = null;
    schedule();
    return;
  }
  requestedAt = null;
  if (was) {
    if (now.model.present && now.memories.withVectors >= now.memories.active) toast.add({ title: "Search model ready", description: "Searches find notes by meaning as well as by words.", color: "success" });
    else if (!now.model.present && now.download.error) toast.add({ title: "Download stopped", description: now.download.error, color: "warning" });
  }
}

async function load() {
  try {
    status.value = await api.semantic();
  } catch (error) {
    fail("Search by meaning", error);
  }
}

onMounted(async () => {
  await load();
  if (s.value && semanticBusy(s.value, null, Date.now())) schedule();
});
onBeforeUnmount(() => {
  stopped = true;
  if (timer !== null) clearTimeout(timer);
});

async function start(kind: "download" | "backfill") {
  busy.value = kind;
  try {
    const asked = Date.now();
    const { started } = kind === "download" ? await api.semanticDownload() : await api.semanticBackfill();
    if (!started) toast.add({ title: "Already running", description: "One at a time; this one is shown here.", color: "info" });
    else {
      requestedAt = asked;
      toast.add({ title: kind === "download" ? "Downloading the search model" : "Making vectors", description: "It runs in the background; you can close this page.", color: "success" });
    }
    if (status.value && kind === "download") status.value = { ...status.value, download: { ...status.value.download, running: true, error: null } };
    if (status.value && kind === "backfill") status.value = { ...status.value, backfill: { running: true } };
    schedule();
  } catch (error) {
    fail("Not started", error);
  } finally {
    busy.value = "none";
  }
}

async function turn(on: boolean) {
  busy.value = "switch";
  try {
    status.value = await api.semanticSwitch(on);
    toast.add({ title: on ? "Search by meaning on" : "Search by meaning off", description: on ? "Searches find notes by meaning as well as by words." : "Searches match words only. The model is kept.", color: "success" });
  } catch (error) {
    fail("Not changed", error);
  } finally {
    busy.value = "none";
  }
}

async function remove() {
  busy.value = "delete";
  try {
    status.value = await api.semanticDelete();
    deleting.value = false;
    toast.add({ title: "Search model deleted", description: "Searches match words only. Download brings it back.", color: "success" });
  } catch (error) {
    fail("Not deleted", error);
  } finally {
    busy.value = "none";
  }
}
</script>

<template>
  <Card id="semantic" title="Search by meaning" description="Searches also find notes by what they mean. Nothing you write leaves this machine." flush>
    <p v-if="!s" class="m-0 px-3.5 py-3 text-[13px] text-(--ink-muted)">Loading…</p>
    <template v-else>
      <!-- The model: download, switch, delete. -->
      <div class="flex flex-col gap-2 px-3.5 py-2">
        <div class="flex h-9 items-center gap-2">
          <span class="flex size-7 flex-none items-center justify-center rounded-lg border border-(--line) bg-(--paper)"><UIcon name="i-lucide-brain" class="size-3.5" /></span>
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="wz-name">Search model</span>
            <span class="wz-meta truncate">{{ modelLine(s) }}</span>
          </div>
          <span v-if="pill" class="wz-status" :class="[pill.shape, downloading ? 'wz-pulse' : '']" :style="{ background: pill.bg, color: pill.fg }">{{ pill.label }}</span>
          <template v-if="!downloading">
            <UButton v-if="s.model.present" color="neutral" variant="ghost" label="Delete…" :disabled="running" @click="deleting = true" />
            <UButton v-if="!s.model.enabled" :color="s.model.present ? 'primary' : 'neutral'" :variant="s.model.present ? 'solid' : 'outline'" label="Turn on" :loading="busy === 'switch'" :disabled="fromEnv" @click="turn(true)" />
            <UButton v-else-if="s.model.present" color="neutral" variant="outline" label="Turn off" :loading="busy === 'switch'" :disabled="fromEnv" @click="turn(false)" />
            <UButton v-else color="primary" :label="s.download.error ? 'Retry' : `Download ${sizeMb} MB`" :loading="busy === 'download'" :disabled="backfilling" @click="start('download')" />
          </template>
        </div>
        <div v-if="downloading" class="flex items-center gap-2 pl-9">
          <span role="progressbar" :aria-valuenow="downloadPercent(s)" aria-valuemin="0" aria-valuemax="100" aria-label="Model download" class="flex h-1 flex-1 overflow-hidden rounded-xs" style="background: var(--blue-soft)"><span class="wz-stripes h-1 rounded-xs transition-[width] duration-300 motion-reduce:transition-none" :style="{ width: `${downloadPercent(s)}%`, backgroundColor: 'var(--blue-text)' }" /></span>
          <span class="w-9 text-right font-mono text-xs leading-4 text-(--blue-text)">{{ downloadPercent(s) }}%</span>
        </div>
      </div>

      <!-- The vectors: memories now, past conversations as the index updates. -->
      <div class="flex flex-col gap-1 border-t border-(--row-line) px-3.5 py-2">
        <div class="flex h-9 items-center gap-2">
          <span class="flex size-7 flex-none items-center justify-center rounded-lg border border-(--line) bg-(--paper)"><UIcon name="i-lucide-layers" class="size-3.5" /></span>
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="wz-name">Memories with vectors</span>
            <span class="wz-meta">{{ vectorsLine(s) }}</span>
          </div>
          <span v-if="vpill" class="wz-status" :class="[vpill.shape, backfilling ? 'wz-pulse' : '']" :style="{ background: vpill.bg, color: vpill.fg }">{{ vpill.label }}</span>
          <UButton v-if="s.model.present && s.model.enabled && !s.model.problem && missing > 0 && !backfilling" color="neutral" variant="outline" label="Backfill" :loading="busy === 'backfill'" :disabled="downloading" @click="start('backfill')" />
        </div>
        <div v-if="backfilling" class="flex items-center gap-2 pl-9">
          <span role="progressbar" :aria-valuenow="vectorsPercent(s)" aria-valuemin="0" aria-valuemax="100" aria-label="Memory vectors" class="flex h-1 flex-1 overflow-hidden rounded-xs" style="background: var(--blue-soft)"><span class="wz-stripes h-1 rounded-xs transition-[width] duration-300 motion-reduce:transition-none" :style="{ width: `${vectorsPercent(s)}%`, backgroundColor: 'var(--blue-text)' }" /></span>
          <span class="w-9 text-right font-mono text-xs leading-4 text-(--blue-text)">{{ vectorsPercent(s) }}%</span>
        </div>
        <p class="m-0 pl-9 text-xs leading-4 text-(--ink-muted)">Past conversations get their vectors as the history index updates.</p>
      </div>

      <!-- What it changes, and what it does not. -->
      <div class="flex items-start gap-2 border-t border-(--row-line) px-3.5 py-2.5">
        <UIcon name="i-lucide-info" class="mt-px size-3.5 flex-none text-(--ink-muted)" />
        <p class="m-0 text-xs leading-4 text-(--ink-muted)">
          This only affects searches: nothing is added to the agent's context by meaning.
          <template v-if="fromEnv"> The switch is set by <code class="font-mono text-[11px]">WIZARDINGCODE_MEM_SEMANTIC</code> in the environment, which wins over these settings.</template>
        </p>
      </div>
    </template>

    <Confirm
      v-model:open="deleting"
      tone="danger"
      icon="i-lucide-trash-2"
      title="Delete the search model?"
      :description="`The model (${sizeMb} MB) and every vector made with it are removed from this machine. Searches match words only, and Download brings it back.`"
      action="Delete model"
      :busy="busy === 'delete'"
      @confirm="remove"
    />
  </Card>
</template>
