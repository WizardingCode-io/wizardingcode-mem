<script setup lang="ts">
// The team servers this machine syncs with (ADR 0027): the list with each server's state and
// last sync, the add (URL, code, label; the counts of what would leave, then the yes), the
// rejoin with a code, the removal with what it deletes named, mute, and the resume of held
// withdrawals. Every action goes through the viewer's routes; no token is ever shown here.
import { computed, onMounted, ref } from "vue";
import { api, type AddedServer, type ResumePreviewEntry, RouteError, type ServerEntry, type ServersView } from "../../api";
import { ago } from "../../format";
import { loadOverview, state } from "../../viewer";
import Confirm from "../Confirm.vue";
import Card from "./Card.vue";

const toast = useToast();
const view = ref<ServersView | null>(null);
/** The list could not be read; the page says so in a plain sentence, never the error. */
const loadFailed = ref(false);
const busy = ref<string | null>(null);

// Adding: the form, then the counts with the yes, while the row waits as pending.
const adding = ref(false);
const url = ref("");
const code = ref("");
const label = ref("");
const name = ref("");
const added = ref<AddedServer | null>(null);
const rejoining = ref<ServerEntry | null>(null);
const rejoinCode = ref("");
const removing = ref<ServerEntry | null>(null);
const withdraw = ref(false);
const resuming = ref<{ server: ServerEntry; preview: ResumePreviewEntry | null } | null>(null);

const servers = computed(() => view.value?.servers ?? []);
const sync = computed(() => view.value?.sync ?? null);
const n = (count: number, one: string, many: string) => `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
const projectName = (id: number | null) => (id === null ? "the workspace" : (state.projects.find((p) => p.id === id)?.name ?? `project ${id}`));

/** What the sync's line says: the state the server reports, in the person's words. */
const syncLine = computed(() => {
  const s = sync.value;
  if (s === null) return "";
  if (s.state === "running") return s.stoppedBy ? `Sync stopping, asked by ${s.stoppedBy}.` : `Sync running${s.idleSince ? `, last activity ${ago(s.idleSince)}` : ""}.`;
  if (s.state === "stopped") return `Sync stopped by ${s.stoppedBy ?? "a command"}; it starts again with the next session.`;
  if (s.state === "failed") return `The sync's last start failed: ${s.failedStart?.reason ?? "unknown"}. Run now tries again.`;
  if (s.pid !== null && s.alive === false) return "The sync's lease is held by a process that is gone; the next session restarts it.";
  return "Sync not running; it starts with the next session.";
});

const STATE_TONE: Record<ServerEntry["state"], { bg: string; fg: string }> = {
  ok: { bg: "var(--ok-soft)", fg: "var(--ok)" },
  pending: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  "token missing": { bg: "var(--warn-soft)", fg: "var(--warn)" },
  stopped: { bg: "var(--danger-soft)", fg: "var(--danger)" },
};
/** A muted server is healthy but silent: its pill is neutral, never the green of Ok. */
const MUTED_TONE = { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" };
const toneOf = (s: ServerEntry) => (s.state === "ok" && s.muted ? MUTED_TONE : STATE_TONE[s.state]);
const stateLabel = (s: ServerEntry) => (s.state === "ok" ? (s.muted ? "Muted" : "Ok") : s.state === "pending" ? "Pending" : s.state === "token missing" ? "Token missing" : "Stopped");
/** The held withdrawals' line: the count when there is one, else the hold alone, each with its reason. */
const holdLine = (s: ServerEntry) => {
  const since = s.hold?.reason === "bulk" ? "a sweep found more to withdraw than you would expect" : "the restore";
  return s.hold && s.hold.count > 0
    ? `${n(s.hold.count, "withdrawal", "withdrawals")} held since ${since}; nothing is taken back until you resume.`
    : `A hold since ${since}: the next sync withdraws nothing until you resume.`;
};
/** The remedy in the page's words: the CLI's command is this row's Rejoin… button. */
const stoppedLine = (s: ServerEntry) => {
  const text = (s.remedy ?? "").replace(/`/g, "");
  const line = text.includes("share server rejoin") ? `${text.replace(/,? then share server rejoin/, "")}, then Rejoin… with it.` : `${text}.`;
  return line.charAt(0).toUpperCase() + line.slice(1);
};

async function load() {
  try {
    view.value = await api.servers();
    loadFailed.value = false;
  } catch {
    loadFailed.value = true;
  }
}
onMounted(load);

/** Whatever failed, the person reads one plain sentence per cause: no message, no path. */
const ADD_FAILED: Record<string, string> = {
  url: "That is not a server address: use https, or http on this machine.",
  code: "The server refused the code.",
  joined: "This server is already listed.",
  network: "The server could not be reached.",
  "server-id": "The server answered with an id this machine cannot store.",
  contract: "The server speaks a newer contract; upgrade wizardingcode-mem.",
  rate: "The server is rate limiting this machine; try again in a minute.",
};
const failure = (error: unknown, fallback: string) =>
  error instanceof RouteError && typeof error.body.error === "string" ? (ADD_FAILED[error.body.error] ?? fallback) : fallback;

async function add() {
  busy.value = "add";
  try {
    added.value = await api.addServer({
      url: url.value.trim(),
      code: code.value.trim(),
      ...(label.value.trim() ? { label: label.value.trim() } : {}),
      ...(name.value.trim() ? { name: name.value.trim() } : {}),
    });
    code.value = "";
    await load();
  } catch (error) {
    toast.add({ title: "Not added", description: failure(error, "The server could not be added."), color: "error" });
  } finally {
    busy.value = null;
  }
}

async function confirmAdd(target = url.value.trim()) {
  busy.value = "confirm";
  try {
    await api.confirmServer(target);
    added.value = null;
    adding.value = false;
    url.value = "";
    label.value = "";
    name.value = "";
    toast.add({ title: "Server added", description: "The sync starts with this session.", color: "success" });
    await Promise.all([load(), loadOverview()]);
  } catch {
    toast.add({ title: "Not confirmed", description: "The server could not be confirmed; add it again.", color: "error" });
  } finally {
    busy.value = null;
  }
}

function notNow() {
  added.value = null;
  adding.value = false;
  toast.add({ title: "Left pending", description: "The server waits in the list until you confirm it.", color: "neutral" });
}

async function rejoin() {
  const target = rejoining.value;
  if (target === null) return;
  busy.value = "rejoin";
  try {
    await api.rejoinServer(target.id, rejoinCode.value.trim());
    rejoining.value = null;
    rejoinCode.value = "";
    toast.add({ title: "Rejoined", description: `${target.name} has this device again.`, color: "success" });
    await load();
  } catch (error) {
    toast.add({ title: "Not rejoined", description: failure(error, "The server could not be rejoined."), color: "error" });
  } finally {
    busy.value = null;
  }
}

async function toggleMute(s: ServerEntry) {
  busy.value = `mute:${s.id}`;
  try {
    await api.muteServer(s.id, !s.muted);
    toast.add({ title: s.muted ? "Unmuted" : "Muted", description: s.muted ? `${s.name}'s entries show again.` : `${s.name}'s entries are kept but not shown.`, color: "success" });
    await load();
  } catch {
    toast.add({ title: "Not changed", description: "The mute could not be saved.", color: "error" });
  } finally {
    busy.value = null;
  }
}

const removeDescription = computed(() => {
  const s = removing.value;
  if (s === null) return "";
  return `${s.name} leaves this machine's list: its received entries and memories, its levels, its ledger and its token are deleted here${withdraw.value ? ", and what this device sent is withdrawn from the server first" : ""}. The device stays listed on the server until an admin revokes it.${s.conflicts > 0 ? ` ${n(s.conflicts, "open conflict is", "open conflicts are")} dropped.` : ""}`;
});

async function remove() {
  const s = removing.value;
  if (s === null) return;
  busy.value = "remove";
  try {
    await api.removeServer(s.id, { yes: true, withdraw: withdraw.value });
    removing.value = null;
    withdraw.value = false;
    toast.add({ title: "Server removed", description: `${s.name} is no longer listed.`, color: "success" });
    await Promise.all([load(), loadOverview()]);
  } catch (error) {
    const why =
      error instanceof RouteError && error.body.error === "sync"
        ? "The sync did not stop in time; try again in a minute."
        : error instanceof RouteError && error.body.error === "withdraw"
          ? `${n(Number(error.body.left ?? 0), "item", "items")} could not be withdrawn; the server is still listed.`
          : "The server could not be removed.";
    toast.add({ title: "Not removed", description: why, color: "error" });
  } finally {
    busy.value = null;
  }
}

async function openResume(s: ServerEntry) {
  busy.value = `resume:${s.id}`;
  try {
    const answer = await api.resumeServer(s.id, false);
    resuming.value = { server: s, preview: answer.preview?.[0] ?? null };
  } catch {
    toast.add({ title: "Not previewed", description: "The withdrawals could not be read.", color: "error" });
  } finally {
    busy.value = null;
  }
}

const resumeDescription = computed(() => {
  const r = resuming.value;
  if (r === null) return "";
  const preview = r.preview;
  if (preview === null || preview.total === 0) return `Nothing is held for ${r.server.name} now; the hold is released.`;
  const lines = preview.perProject.map((p) => `${projectName(p.projectId)}: ${n(p.count, "item", "items")}`);
  return `The next sync withdraws ${n(preview.total, "item", "items")} from ${r.server.name} (${lines.join("; ")}). Held since the ${preview.hold?.reason === "bulk" ? "sweep found more than you would expect" : "restore"}.`;
});

async function resume() {
  const r = resuming.value;
  if (r === null) return;
  busy.value = "resume";
  try {
    await api.resumeServer(r.server.id, true);
    resuming.value = null;
    toast.add({ title: "Withdrawals released", description: "The next sync takes them back.", color: "success" });
    await load();
  } catch {
    toast.add({ title: "Not released", description: "The hold could not be released.", color: "error" });
  } finally {
    busy.value = null;
  }
}

async function runNow() {
  busy.value = "run";
  try {
    const { started } = await api.runSync();
    toast.add(started ? { title: "Sync started", description: "One round runs now.", color: "success" } : { title: "Sync not started", description: "It is already running, or no server is listed.", color: "neutral" });
    await load();
  } catch {
    toast.add({ title: "Sync not started", description: "The sync could not be started.", color: "error" });
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <Card id="servers" title="Servers" description="The team servers this machine syncs with. A server is added with an admin's invitation code; nothing is sent until you confirm it.">
    <template #aside>
      <UButton v-if="servers.length" size="xs" color="neutral" variant="outline" icon="i-lucide-play" label="Run now" :loading="busy === 'run'" @click="runNow" />
    </template>
    <p v-if="view === null && !loadFailed" class="m-0 text-[13px] text-(--ink-muted)">Loading…</p>
    <p v-else-if="view === null" class="m-0 text-[13px] text-(--ink-muted)">Servers could not be loaded.</p>
    <div v-else class="flex flex-col gap-4">
      <p v-if="servers.length === 0 && !adding" class="m-0 text-[13px] text-(--ink-muted)">No server listed yet. Nothing leaves this machine until one is.</p>
      <ul v-else-if="servers.length" class="wz-table m-0 list-none p-0">
        <li v-for="(s, i) in servers" :key="s.id" class="flex flex-col gap-1 px-3 py-2" :class="i > 0 ? 'border-t border-(--row-line)' : ''">
          <div class="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
            <span class="min-w-0 flex-1 basis-40 truncate text-[13px]" :title="`${s.name} ${s.host}`"><span class="font-semibold">{{ s.name }}</span> <span v-if="s.host !== s.name" class="wz-mono text-(--ink-muted)">{{ s.host }}</span></span>
            <span class="wz-status flex-none" :style="{ background: toneOf(s).bg, color: toneOf(s).fg }">{{ stateLabel(s) }}</span>
            <!-- Under 640px the actions take their own line, so none is cut off at a phone's width. -->
            <span class="flex min-w-0 basis-full flex-wrap items-center gap-1 sm:ml-auto sm:basis-auto sm:justify-end">
              <UButton v-if="s.state === 'pending' && added?.server.id !== s.id" size="xs" color="primary" label="Confirm" :loading="busy === 'confirm'" @click="confirmAdd(s.url)" />
              <UButton v-if="s.hold" size="xs" color="neutral" variant="outline" icon="i-lucide-play" label="Resume…" :loading="busy === `resume:${s.id}`" @click="openResume(s)" />
              <UButton v-if="s.state !== 'pending'" size="xs" color="neutral" variant="ghost" :icon="s.muted ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" :label="s.muted ? 'Unmute' : 'Mute'" :loading="busy === `mute:${s.id}`" @click="toggleMute(s)" />
              <UButton v-if="s.state !== 'pending'" size="xs" color="neutral" variant="ghost" icon="i-lucide-key-round" label="Rejoin…" @click="rejoining = s" />
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-trash-2" label="Remove…" @click="removing = s" />
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-(--ink-muted)">
            <span class="min-w-0 truncate" :title="`${s.member} (${s.role})`">{{ s.member }} ({{ s.role }})</span>
            <span class="wz-mono">last sync {{ s.lastSyncAt === null ? "never" : ago(s.lastSyncAt) }}</span>
          </div>
          <p v-if="s.state === 'stopped' && s.remedy" class="m-0 text-xs leading-4 text-(--danger)">{{ stoppedLine(s) }}</p>
          <p v-else-if="s.state === 'token missing'" class="m-0 text-xs leading-4 text-(--warn)">The token is missing: ask an admin for a code, then Rejoin… with it.</p>
          <p v-else-if="s.hold" class="m-0 text-xs leading-4 text-(--ink-muted)">{{ holdLine(s) }}</p>
        </li>
      </ul>

      <div v-if="adding" class="flex flex-col gap-3 rounded-lg border border-(--line) bg-(--paper-raised) p-3">
        <h3 class="m-0 text-sm font-semibold">Add a server</h3>
        <form v-if="added === null" class="flex flex-col gap-3" @submit.prevent="add">
          <UFormField label="Address" help="The server's https address; http only on this machine.">
            <UInput v-model="url" class="w-full max-w-[440px]" :ui="{ base: 'font-mono text-xs' }" placeholder="https://team.example.com" autocomplete="off" />
          </UFormField>
          <UFormField label="Invitation code" help="From an admin of the server; used once.">
            <UInput v-model="code" type="password" class="w-full max-w-[440px]" :ui="{ base: 'font-mono text-xs' }" autocomplete="off" />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="This device" help="How the server lists this machine; its host name when empty.">
              <UInput v-model="label" class="w-full" placeholder="laptop" autocomplete="off" />
            </UFormField>
            <UFormField label="Your name" help="For a first invitation only; otherwise the server knows you.">
              <UInput v-model="name" class="w-full" autocomplete="off" />
            </UFormField>
          </div>
          <div class="flex items-center gap-2">
            <UButton type="submit" color="primary" label="Join" :loading="busy === 'add'" :disabled="!url.trim() || !code.trim()" />
            <UButton type="button" color="neutral" variant="ghost" label="Cancel" @click="adding = false" />
          </div>
        </form>
        <template v-else>
          <p class="m-0 text-[13px]">Joined <span class="font-semibold">{{ added.server.name }}</span> as {{ added.server.member }} ({{ added.server.role }}). The server is pending until you confirm.</p>
          <p class="m-0 text-[13px]">Would leave now: {{ n(added.counts.entries, "knowledge entry", "knowledge entries") }} and {{ n(added.counts.memories, "memory", "memories") }}<template v-if="added.counts.byProject.length"> ({{ added.counts.byProject.map((p) => `${projectName(p.project)}: ${p.entries + p.memories}`).join(", ") }})</template>.</p>
          <div class="flex items-center gap-2">
            <UButton color="primary" label="Confirm" :loading="busy === 'confirm'" @click="confirmAdd()" />
            <UButton color="neutral" variant="ghost" label="Not now" @click="notNow" />
          </div>
        </template>
      </div>
      <div v-if="!adding" class="flex flex-wrap items-center gap-2">
        <UButton color="primary" icon="i-lucide-server" label="Add a server…" @click="adding = true" />
      </div>
      <div v-if="servers.length" class="wz-block text-xs leading-4 text-(--ink-muted)">
        <p class="m-0">{{ syncLine }}</p>
      </div>
    </div>

    <UModal :open="rejoining !== null" title="Rejoin with a new code" :description="`${rejoining?.name ?? ''}: a new device replaces the old one; what was sent stays on record.`" @update:open="(o) => { if (!o) rejoining = null; }">
      <template #body>
        <UFormField label="Invitation code">
          <UInput v-model="rejoinCode" type="password" class="w-full" :ui="{ base: 'font-mono text-xs' }" autocomplete="off" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="rejoining = null" />
          <UButton color="primary" label="Rejoin" :loading="busy === 'rejoin'" :disabled="!rejoinCode.trim()" @click="rejoin" />
        </div>
      </template>
    </UModal>
    <UModal :open="removing !== null" title="Remove this server?" :description="removeDescription" @update:open="(o) => { if (!o) removing = null; }">
      <template #body>
        <UCheckbox v-model="withdraw" label="Withdraw what this device sent first" />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="removing = null" />
          <UButton color="error" label="Remove" :loading="busy === 'remove'" @click="remove" />
        </div>
      </template>
    </UModal>
    <Confirm
      :open="resuming !== null"
      tone="warn"
      icon="i-lucide-play"
      title="Resume the withdrawals?"
      :description="resumeDescription"
      action="Resume"
      :busy="busy === 'resume'"
      @update:open="(o) => { if (!o) resuming = null; }"
      @confirm="resume"
    />
  </Card>
</template>
