<script setup lang="ts">
// The history import, as the source rows of Sales OS's Knowledge base panel draw a sync:
// a 28px tile, the name over a 12px line, a status pill and the row's action on the right,
// and while it runs a 4px bar with the percentage. Confirms as the system dialogs.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api, type HistoryProgress, type HistoryStatus } from "../../api";
import { ago } from "../../format";
import { awaitingStart, historyCardDescription, importLabel, importPill, indexPill, progressOf, progressPoller, sessionsFound, sizeOf } from "../../history";
import { typesafeJudging } from "../../settings";
import { loadOverview } from "../../viewer";
import Confirm from "../Confirm.vue";
import Card from "./Card.vue";

const toast = useToast();
const status = ref<HistoryStatus | null>(null);
const busy = ref<"none" | "import" | "index" | "forget" | "replace" | "restore">("none");
const forgetting = ref(false);
const replacing = ref(false);
/** The count the replace dialog shows; it changes when the server says it moved. */
const expected = ref(0);
const moved = ref(false);
/** When this page asked for a run, so the poll waits for the background process to start. */
let requestedAt: number | null = null;
let requestedKind: "import" | "index" = "import";

const n = (v: number) => v.toLocaleString("en-GB");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const fail = (title: string, error: unknown) =>
  toast.add({ title, description: error instanceof Error ? error.message : String(error), color: "error" });

// Any run (import or index) holds the store: the buttons wait for it.
const running = computed(() => status.value?.run.state === "running");
const importing = computed(() => status.value?.import.state === "running");
const progress = computed(() => (status.value ? progressOf(status.value.queue) : null));
const pill = computed(() => (status.value ? importPill(status.value) : null));
const ipill = computed(() => (status.value ? indexPill(status.value) : null));

const sessionsLine = computed(() => {
  const s = status.value;
  if (!s) return "";
  const imp = s.import;
  if (imp.state === "running" && progress.value) {
    const p = progress.value;
    const started = imp.startedAt ? ` · started ${ago(imp.startedAt)}` : "";
    return p.total ? `${n(p.settled)} of ${plural(p.total, "turn")}${started}` : `Reading sessions${started}`;
  }
  const found = `${n(sessionsFound(s))} found · Claude Code ${n(s.transcripts.claudeCode)} · Codex ${n(s.transcripts.codex)}`;
  if (imp.state === "done" && s.queue.pending > 0) return `${found} · ${n(s.queue.pending)} left`;
  if (imp.state === "done" && imp.finishedAt) return `${found} · last import ${ago(imp.finishedAt)}`;
  if (imp.state === "failed") return `${found} · stopped${imp.finishedAt ? ` ${ago(imp.finishedAt)}` : ""}, ${n(s.queue.pending)} left`;
  return found;
});
const indexLine = computed(() => {
  const i = status.value?.index;
  if (!i) return "";
  const run = status.value?.run;
  const last = run?.kind === "index" && run.state === "done" && run.finishedAt ? ` · updated ${ago(run.finishedAt)}` : "";
  return i.exists ? `${plural(i.files, "file")} · ${plural(i.turns, "turn")} · ${sizeOf(i.bytes)}${last}` : "Not built yet. The import builds it.";
});
const replaceLine = computed(() => {
  const r = status.value?.replace;
  if (!r) return "";
  const ready = `${plural(r.wouldArchive, "import")} in ${plural(r.projectsReady, "project")} now covered by your own sessions`;
  if (r.replaced > 0) return r.wouldArchive > 0 ? `${n(r.replaced)} replaced · ${ready}` : `${n(r.replaced)} replaced`;
  return r.wouldArchive > 0 ? ready : "None to replace yet";
});

async function load() {
  try {
    status.value = await api.history();
  } catch (error) {
    fail("History", error);
  }
}

// While a run goes, the light progress every 3 s; the full status once it ends.
async function loadProgress(): Promise<HistoryProgress> {
  const p = await api.historyProgress();
  if (awaitingStart(p.run, requestedAt, Date.now())) {
    const run = { ...p.run, state: "running" as const, kind: requestedKind };
    return { ...p, run, import: requestedKind === "import" ? { ...p.import, state: "running" } : p.import };
  }
  return p;
}
const poller = progressPoller({
  load: loadProgress,
  apply: (p) => {
    if (status.value) status.value = { ...status.value, run: p.run, import: p.import, queue: p.queue };
  },
  finished: async () => {
    requestedAt = null;
    await load();
    const s = status.value;
    const indexing = s?.run.kind === "index";
    if (s?.run.state === "done") toast.add({ title: indexing ? "Index updated" : "History run finished", description: indexing ? "Past conversations are searchable." : "What it learnt is in Memories.", color: "success" });
    else if (s?.run.state === "failed") toast.add({ title: "History run stopped", description: indexing ? "Update index picks up where it stopped." : "Continue picks up where it stopped.", color: "warning" });
    await loadOverview().catch(() => undefined);
  },
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (h) => clearTimeout(h),
});
watch(() => status.value?.run.state, (state) => state && poller.sync(state));
onMounted(load);
onBeforeUnmount(() => poller.stop());

async function start(kind: "import" | "index") {
  busy.value = kind;
  try {
    const asked = Date.now();
    const { started } = kind === "import" ? await api.historyImport() : await api.historyIndex();
    if (!started) toast.add({ title: "Already running", description: "One history run at a time; this one is shown here.", color: "info" });
    else {
      requestedAt = asked;
      requestedKind = kind;
      toast.add({ title: kind === "import" ? "Import started" : "Updating the index", description: "It runs in the background; you can close this page.", color: "success" });
    }
    if (status.value) {
      const run = { ...status.value.run, state: "running" as const, kind };
      status.value = { ...status.value, run, import: kind === "import" ? { ...status.value.import, state: "running" } : status.value.import };
    }
  } catch (error) {
    fail("Not started", error);
  } finally {
    busy.value = "none";
  }
}

async function forget() {
  busy.value = "forget";
  try {
    await api.historyForget();
    forgetting.value = false;
    toast.add({ title: "Index forgotten", description: "Memories stay. Update index makes it again.", color: "success" });
    await load();
  } catch (error) {
    fail("Not forgotten", error);
  } finally {
    busy.value = "none";
  }
}

function askReplace() {
  if (!status.value) return;
  expected.value = status.value.replace.wouldArchive;
  moved.value = false;
  replacing.value = true;
}
async function replace() {
  busy.value = "replace";
  try {
    const outcome = await api.replaceImports(expected.value);
    if (!outcome.ok) {
      // The count moved since it was shown: show the new one and ask again.
      expected.value = outcome.count;
      moved.value = true;
      return;
    }
    replacing.value = false;
    toast.add({ title: "Imports replaced", description: `${plural(outcome.archived, "import")} archived in ${plural(outcome.projects, "project")}. Restore brings them back.`, color: "success" });
    await Promise.all([load(), loadOverview().catch(() => undefined)]);
  } catch (error) {
    fail("Not replaced", error);
  } finally {
    busy.value = "none";
  }
}

async function restore() {
  busy.value = "restore";
  try {
    const { restored } = await api.restoreImports();
    toast.add({ title: "Imports restored", description: `${plural(restored, "memory", "memories")} active again.`, color: "success" });
    await Promise.all([load(), loadOverview().catch(() => undefined)]);
  } catch (error) {
    fail("Not restored", error);
  } finally {
    busy.value = "none";
  }
}
</script>

<template>
  <Card id="history" title="History" :description="historyCardDescription(typesafeJudging())" flush>
    <p v-if="!status" class="m-0 px-3.5 py-3 text-[13px] text-(--ink-muted)">Loading…</p>
    <template v-else>
      <!-- Past sessions: the import and its progress. -->
      <div class="flex flex-col gap-2 px-3.5 py-2">
        <div class="flex h-9 items-center gap-2">
          <span class="flex size-7 flex-none items-center justify-center rounded-lg border border-(--line) bg-(--paper)"><UIcon name="i-lucide-history" class="size-3.5" /></span>
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="wz-name">Past sessions</span>
            <span class="wz-meta">{{ sessionsLine }}</span>
          </div>
          <span v-if="pill" class="wz-status" :class="[pill.shape, importing ? 'wz-pulse' : '']" :style="{ background: pill.bg, color: pill.fg }">{{ pill.label }}</span>
          <UButton v-if="!importing" color="primary" :label="importLabel(status)" :loading="busy === 'import'" :disabled="running || sessionsFound(status) === 0" @click="start('import')" />
        </div>
        <div v-if="progress && progress.total > 0 && (importing || status.import.state === 'failed')" class="flex items-center gap-2 pl-9">
          <span role="progressbar" :aria-valuenow="progress.percent" aria-valuemin="0" aria-valuemax="100" aria-label="History import" class="flex h-1 flex-1 overflow-hidden rounded-xs" :style="{ background: importing ? 'var(--blue-soft)' : 'var(--warn-soft)' }"><span class="h-1 rounded-xs transition-[width] duration-300 motion-reduce:transition-none" :class="importing ? 'wz-stripes' : ''" :style="{ width: `${progress.percent}%`, backgroundColor: importing ? 'var(--blue-text)' : 'var(--warn)' }" /></span>
          <span class="w-9 text-right font-mono text-xs leading-4" :style="{ color: importing ? 'var(--blue-text)' : 'var(--warn)' }">{{ progress.percent }}%</span>
        </div>
      </div>

      <!-- The search index over the transcripts. -->
      <div class="flex h-[52px] items-center gap-2 border-t border-(--row-line) px-3.5">
        <span class="flex size-7 flex-none items-center justify-center rounded-lg border border-(--line) bg-(--paper)"><UIcon name="i-lucide-text-search" class="size-3.5" /></span>
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="wz-name">Search index</span>
          <span class="wz-meta">{{ indexLine }}</span>
        </div>
        <span v-if="ipill" class="wz-status" :class="[ipill.shape, ipill.label === 'Indexing' ? 'wz-pulse' : '']" :style="{ background: ipill.bg, color: ipill.fg }">{{ ipill.label }}</span>
        <UButton v-if="status.index.exists" color="neutral" variant="ghost" label="Forget…" :disabled="running" @click="forgetting = true" />
        <UButton color="neutral" variant="outline" label="Update index" :loading="busy === 'index'" :disabled="running" @click="start('index')" />
      </div>

      <!-- claude-mem's imports, once history covers their projects. -->
      <div class="flex flex-col gap-1 border-t border-(--row-line) px-3.5 py-2">
        <div class="flex h-9 items-center gap-2">
          <span class="flex size-7 flex-none items-center justify-center rounded-lg border border-(--line) bg-(--paper)"><UIcon name="i-lucide-replace" class="size-3.5" /></span>
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="wz-name">Replace claude-mem imports</span>
            <span class="wz-meta">{{ replaceLine }}</span>
          </div>
          <UButton v-if="status.replace.replaced > 0" color="neutral" :variant="status.replace.wouldArchive > 0 ? 'ghost' : 'outline'" label="Restore" :loading="busy === 'restore'" :disabled="running" @click="restore" />
          <UButton v-if="status.replace.wouldArchive > 0 || status.replace.replaced === 0" color="neutral" variant="outline" :label="status.replace.wouldArchive > 0 ? `Replace ${n(status.replace.wouldArchive)}…` : 'Replace…'" :disabled="running || status.replace.wouldArchive === 0" @click="askReplace" />
        </div>
        <p class="m-0 pl-9 text-xs leading-4 text-(--ink-muted)">They are archived, not deleted, and Restore brings them back.</p>
      </div>
    </template>

    <Confirm
      v-model:open="forgetting"
      tone="danger"
      icon="i-lucide-trash-2"
      title="Forget the search index?"
      :description="`The index of past sessions${status?.index.exists ? ` (${sizeOf(status.index.bytes)})` : ''} is deleted from this machine. Memories stay, and Update index makes it again.`"
      action="Forget index"
      :busy="busy === 'forget'"
      @confirm="forget"
    />
    <Confirm
      v-model:open="replacing"
      tone="warn"
      icon="i-lucide-replace"
      :title="`Replace ${plural(expected, 'claude-mem import')}?`"
      :description="`${plural(expected, 'memory', 'memories')} imported from claude-mem ${expected === 1 ? 'is' : 'are'} archived where your own sessions now cover the project. Nothing is deleted; Restore brings ${expected === 1 ? 'it' : 'them'} back.`"
      :action="`Replace ${n(expected)}`"
      :busy="busy === 'replace'"
      :disabled="expected === 0"
      @confirm="replace"
    >
      <UAlert v-if="moved" color="warning" variant="soft" icon="i-lucide-triangle-alert" :description="`The count changed while this was open: it is ${n(expected)} now. Confirm again if that is right.`" />
    </Confirm>
  </Card>
</template>
