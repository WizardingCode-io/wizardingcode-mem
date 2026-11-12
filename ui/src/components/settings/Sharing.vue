<script setup lang="ts">
// What may leave this machine for the team's server: the two roots, each root's areas, and
// the levels the projects are at. The page only changes the settings file, through the
// server, which asks for the person's yes before anything is widened; nothing is sent here.
import { computed, onMounted, reactive, ref } from "vue";
import { api, buildSharingPatch, LEVEL_LABELS, type Level, type Root, type ServerEntry, type SettingKey, type SettingsPatch, type SharingView } from "../../api";
import { ago } from "../../format";
import { formatChange, projectOfChange } from "../../../../src/sharing/format.ts";
import { fromEnvironment, saveSettings, setting } from "../../settings";
import { serverChange } from "../../sharing-text";
import { openCross, state } from "../../viewer";
import Confirm from "../Confirm.vue";
import Card from "./Card.vue";

const toast = useToast();
const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS" satisfies SettingKey;
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS" satisfies SettingKey;
const LOCKED = "Set by the environment.";
const ROOT_ROWS: { root: Root; label: string; help: string }[] = [
  { root: "workspace", label: "Workspace knowledge", help: "Your cross-project entries. Its areas below also govern every project's knowledge." },
  { root: "shared", label: "Shared repository knowledge", help: "The repository written for the team." },
];
const STATEMENTS =
  "Knowledge leaves only when its root or project is allowed to leave and its area is allowed. Memories have no area: a project set to Knowledge and memories sends every active memory of its own that is not stale, branch-bound, imported or one of your rules. New areas start private. Lowering a level recalls nothing already sent; the next sync withdraws it. This page governs the team server only; TypeSafe judgements are governed by your key, under Judge.";

const view = ref<SharingView | null>(null);
/** The page could not be read; the viewer says so in a plain sentence, never the error. */
const loadFailed = ref(false);
/** The confirmed servers; with several, the switches edit the chosen one's lists (ADR 0027). */
const servers = ref<ServerEntry[]>([]);
const chosen = ref<string | undefined>(undefined);
const serverItems = computed(() => servers.value.map((s) => ({ label: `${s.name} · ${s.host}`, value: s.id })));
const several = computed(() => servers.value.length > 1);
/** The server the sentences name: the chosen one, else the only one, else none yet. */
const serverName = computed(() => (several.value ? servers.value.find((s) => s.id === chosen.value)?.name : servers.value[0]?.name) ?? null);
const CEILING = "The settings file's lists are the ceiling: a server's lists can only narrow them.";
const roots = reactive<Record<Root, boolean>>({ workspace: false, shared: false });
const areas = reactive<Record<string, boolean>>({});
/** Inert ids the person removed: hidden, and Save offered, though every save drops them. */
const removed = ref<string[]>([]);
/** The patch the page made when it was last loaded: Save is offered once it differs. */
const loadedPatch = ref("");

const sourceOf = (key: SettingKey) => setting(key)?.source ?? "default";
const lockedRoots = computed(() => fromEnvironment(ROOTS_KEY));
const lockedAreas = computed(() => fromEnvironment(AREAS_KEY));
const entries = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "entry" : "entries"}`;

/** The switches as the policy in force says. */
function reset(next: SharingView) {
  roots.workspace = next.roots.includes("workspace");
  roots.shared = next.roots.includes("shared");
  for (const id of Object.keys(areas)) delete areas[id];
  for (const root of ["workspace", "shared"] as const) {
    for (const area of next.taxonomies[root] ?? []) {
      const id = `${root}:${area.id}`;
      areas[id] = next.areas.includes(id);
    }
  }
  removed.value = [];
  loadedPatch.value = JSON.stringify(currentPatch());
}

async function load() {
  try {
    try {
      servers.value = (await api.servers()).servers.filter((s) => s.state !== "pending");
    } catch {
      servers.value = [];
    }
    if (several.value && (chosen.value === undefined || !servers.value.some((s) => s.id === chosen.value))) chosen.value = servers.value[0]?.id;
    const next = await api.sharing(false, several.value ? chosen.value : undefined);
    view.value = next;
    loadFailed.value = false;
    reset(next);
  } catch {
    loadFailed.value = true;
  }
}
onMounted(load);
async function chooseServer(id: string) {
  chosen.value = id;
  await load();
}

const inertOf = (root: Root) =>
  (view.value?.inert ?? []).filter((id) => id.startsWith(`${root}:`) && !removed.value.includes(id));
const totalOf = (root: Root, area: string) => view.value?.report.perRoot[root].areaTotals[area] ?? 0;

const levelCount = (level: Level) => view.value?.levels[level] ?? 0;
const openProjects = () => openCross("projects", null);

const projectName = (id: number) => state.projects.find((p) => p.id === id)?.name ?? null;
/**
 * The log's line for the last change: a project's level by its name and the labels, a server by
 * its name (`serverChange`), and every other row (a shared name among them) through the one
 * formatter `share status` renders with (`formatChange`, ADR 0028).
 */
const lastChange = computed(() => {
  const change = view.value?.lastChange;
  if (!change) return null;
  const server = /^server:([0-9a-f]+)$/.exec(change.what);
  if (server !== null) {
    const listed = servers.value.find((s) => s.id === server[1])?.name;
    const name = listed ?? (/^mute/.test(change.old) || change.old === "" ? "a server" : change.old);
    return { ...change, what: serverChange(name, change.old, change.new), old: "", new: "" };
  }
  const id = projectOfChange(change.what);
  if (id === null) return { ...change, what: formatChange(change, projectName), old: "", new: "" };
  const label = (value: string) => (value in LEVEL_LABELS ? LEVEL_LABELS[value as Level] : value);
  return { ...change, what: projectName(id) ?? `project ${id}`, old: label(change.old), new: label(change.new) };
});

// Saving: the patch through the shared rules, one preview when it would let more leave,
// the dialog, then the save with the person's yes.
const asking = ref(false);
const pending = ref<SettingsPatch | null>(null);
const leaving = ref(0);
const previewing = ref(false);
const saving = ref(false);

/** Whether Save would change anything: a switch moved, or an inert id was removed. */
const changed = computed(() => removed.value.length > 0 || JSON.stringify(currentPatch()) !== loadedPatch.value);

const listOf = (text: string | undefined) => (text === undefined || text === "none" ? [] : text.split(","));

function currentPatch() {
  const current = view.value;
  if (current === null) return null;
  return buildSharingPatch({
    roots: { ...roots },
    areas: { ...areas },
    taxonomies: current.taxonomies,
    inert: current.inert,
    sources: { [ROOTS_KEY]: sourceOf(ROOTS_KEY), [AREAS_KEY]: sourceOf(AREAS_KEY) },
  });
}

async function save() {
  const current = view.value;
  const patch = currentPatch();
  if (current === null || patch === null) return;
  const newRoots = patch[ROOTS_KEY] === undefined ? undefined : (listOf(patch[ROOTS_KEY]) as Root[]);
  const newAreas = patch[AREAS_KEY] === undefined ? undefined : listOf(patch[AREAS_KEY]);
  const widens =
    (newRoots ?? []).some((root) => !current.roots.includes(root)) ||
    (newAreas ?? []).some((id) => !current.areas.includes(id));
  if (!widens) {
    await commit(patch, false);
    return;
  }
  previewing.value = true;
  try {
    const { report } = await api.sharingPreview({
      ...(newRoots === undefined ? {} : { roots: newRoots }),
      ...(newAreas === undefined ? {} : { areas: newAreas }),
    });
    leaving.value = report.counts.entries;
    pending.value = patch;
    asking.value = true;
  } catch {
    notSaved();
  } finally {
    previewing.value = false;
  }
}

const description = computed(
  () =>
    `${leaving.value.toLocaleString("en-GB")} knowledge ${leaving.value === 1 ? "entry" : "entries"} ${serverName.value === null ? "would leave for your team's server once one is listed. Nothing is sent now." : `would leave for ${serverName.value}.`}`,
);

async function confirmShare() {
  const patch = pending.value;
  if (patch === null) return;
  await commit(patch, true);
  asking.value = false;
  pending.value = null;
}

/** Whatever failed, the person reads one plain sentence: no message, no path. */
function notSaved() {
  toast.add({ title: "Sharing not saved", description: "The settings file could not be written.", color: "error" });
}

async function commit(patch: SettingsPatch, confirmed: boolean) {
  saving.value = true;
  try {
    const forServer = several.value ? chosen.value : undefined;
    const options = { ...(confirmed ? { confirm: true } : {}), ...(forServer ? { server: forServer } : {}) };
    const taken = confirmed ? await saveSettings(patch, { confirm: true, ...options }) : await saveSettings(patch, options);
    if (!taken) {
      notSaved();
      return;
    }
    toast.add({ title: "Sharing saved", color: "success" });
    await load();
  } catch {
    notSaved();
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Card id="sharing" title="Sharing" description="What may leave this machine for your team's server. Nothing leaves until you choose it here, and nothing is sent until a server is listed.">
    <p v-if="view === null && !loadFailed" class="m-0 text-[13px] text-(--ink-muted)">Loading…</p>
    <p v-else-if="view === null" class="m-0 text-[13px] text-(--ink-muted)">Sharing could not be loaded.</p>
    <div v-else class="flex flex-col">
      <UAlert v-if="view.problems.length" class="mb-4" color="warning" variant="soft" icon="i-lucide-triangle-alert" :description="view.problems.join(' · ')" />
      <div v-if="several" class="mb-4 flex flex-col gap-2">
        <UFormField label="Server" :help="CEILING">
          <USelectMenu :model-value="chosen" :items="serverItems" value-key="value" :search-input="false" class="w-full max-w-[360px]" @update:model-value="(id) => chooseServer(id as string)" />
        </UFormField>
      </div>
      <p v-else-if="serverName" class="m-0 mb-4 text-xs leading-4 text-(--ink-muted)">Sending to {{ serverName }}. {{ CEILING }}</p>
      <div class="flex flex-col gap-4">
        <div v-for="r in ROOT_ROWS" :key="r.root" class="flex flex-col gap-2">
          <!-- The count wraps under the switch where the two do not fit on one line (a phone's width), indented to the label. -->
          <div class="flex flex-wrap items-start gap-x-3 gap-y-1">
            <USwitch v-model="roots[r.root]" class="min-w-0 flex-1 basis-56" :disabled="lockedRoots" :label="r.label" :description="lockedRoots ? `${r.help} ${LOCKED}` : r.help" />
            <span class="wz-mono flex-none pl-11 text-(--ink-muted) md:pl-0">{{ entries(view.report.perRoot[r.root].entries) }} would leave</span>
          </div>
          <div class="flex flex-col gap-1.5 pl-11">
            <p v-if="view.taxonomies[r.root] === null" class="m-0 text-xs leading-4 text-(--ink-muted)">No taxonomy yet: write a knowledge entry first.</p>
            <template v-else>
              <div v-for="a in view.taxonomies[r.root] ?? []" :key="a.id" class="flex items-center gap-3">
                <USwitch v-model="areas[`${r.root}:${a.id}`]" size="sm" class="min-w-0 flex-1" :disabled="lockedAreas" :label="a.label" />
                <span class="wz-mono flex-none text-(--ink-muted)">{{ totalOf(r.root, a.id).toLocaleString("en-GB") }} in the area</span>
              </div>
            </template>
            <div v-for="id in inertOf(r.root)" :key="id" class="flex h-6 items-center gap-3">
              <span class="min-w-0 flex-1 truncate text-xs leading-4 text-(--ink-muted)"><span class="font-mono">{{ id }}</span> · not in the taxonomy; ignored</span>
              <UButton size="xs" color="neutral" variant="ghost" label="Remove" :disabled="lockedAreas" @click="removed.push(id)" />
            </div>
            <p v-if="lockedAreas && view.taxonomies[r.root]?.length" class="m-0 text-xs leading-4 text-(--ink-muted)">{{ LOCKED }}</p>
          </div>
        </div>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <UButton color="primary" label="Save" :loading="saving || previewing" :disabled="!changed || (lockedRoots && lockedAreas)" @click="save" />
      </div>
      <div class="wz-block flex flex-col gap-2 text-xs leading-4 text-(--ink-muted)">
        <p class="m-0">{{ STATEMENTS }}</p>
        <p class="m-0">
          {{ levelCount("knowledge").toLocaleString("en-GB") }} projects share knowledge, {{ levelCount("all").toLocaleString("en-GB") }} share knowledge and memories.
          <button type="button" class="wz-link" @click="openProjects">Across projects</button>
        </p>
        <p v-if="lastChange" class="m-0">Last change: {{ lastChange.what }}<template v-if="lastChange.old || lastChange.new"> {{ lastChange.old }} → {{ lastChange.new }}</template>, {{ ago(lastChange.at) }}, from the {{ lastChange.source }}.</p>
      </div>
    </div>
    <Confirm
      v-model:open="asking"
      tone="warn"
      icon="i-lucide-share-2"
      title="Share more knowledge?"
      :description="description"
      action="Share"
      :busy="saving"
      @confirm="confirmShare"
    />
  </Card>
</template>
