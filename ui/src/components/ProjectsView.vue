<script setup lang="ts">
// Projects and their links as Sales OS's Tickets list (and Pipeline's groups): a 40px toolbar
// with the search field first, one card per group (28px header: chevron, stage pill, count),
// a 28px column header inside each card, 32px rows (letter tile, bold name, muted place). The
// selected project opens in the app's 320px dock: its suggestions with their reasons and
// Link / Reject, its confirmed links with Unlink, a way to link one by hand, and what it
// shares with the team's server.
import { computed, onMounted, reactive, ref, watch } from "vue";
import { NAME_PREFIX } from "../../../src/core/identity.ts";
import { sharedNameOf } from "../../../src/sharing/names.ts";
import { api, LEVEL_LABELS, LEVELS, type Level, type LinkKind, type NameItem, type Project, RouteError, type ServerEntry, widens } from "../api";
import { compact, day, hue } from "../format";
import { projectGroups, projectLinks, projectPlace, signalParts, visibleFrom } from "../links";
import { loadLinks, loadOverview, openCross, reload, state } from "../viewer";
import Confirm from "./Confirm.vue";
import Dock from "./Dock.vue";
import DockProps from "./DockProps.vue";
import Empty from "./Empty.vue";

const props = defineProps<{ docked: boolean }>();
const toast = useToast();

const q = ref("");
const field = ref<HTMLInputElement | null>(null);
const reviewOnly = ref(false);
const collapsed = reactive<Record<string, boolean>>({});

const pending = computed(() => state.links.filter((l) => l.status === "suggested").length);
const confirmedCount = computed(() => state.links.filter((l) => l.status === "confirmed").length);
const shown = computed(() => {
  const words = q.value.trim().toLowerCase();
  return state.projects.filter((p) => !words || p.name.toLowerCase().includes(words) || p.key.toLowerCase().includes(words));
});
const groups = computed(() => projectGroups(shown.value, state.links).filter((g) => !reviewOnly.value || g.key === "review"));
const TONE = {
  review: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  linked: { bg: "var(--violet-soft)", fg: "var(--violet-text)" },
  alone: { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" },
} as const;

const COLS_WIDE = "grid-template-columns: minmax(0, 1fr) 260px 80px 96px;";
const COLS_DOCK = "grid-template-columns: minmax(0, 1fr) 216px;";
const cols = computed(() => (props.docked ? COLS_DOCK : COLS_WIDE));

/** The row's links cell: what is waiting, then the first link (or suggestion) and how many more. */
function linksCell(p: Project) {
  const mine = projectLinks(state.links, p.id);
  const first = mine.confirmed[0] ?? mine.suggested[0];
  const all = mine.confirmed.length ? mine.confirmed.length : mine.suggested.length;
  return {
    review: mine.suggested.length,
    text: first ? `${first.label === "Same product" ? "With" : first.label} ${first.otherName}` : "",
    muted: mine.confirmed.length === 0,
    more: Math.max(0, all - 1),
  };
}

const selected = computed(() => state.projects.find((p) => p.id === state.linkProject) ?? null);
const mine = computed(() => (selected.value ? projectLinks(state.links, selected.value.id) : { confirmed: [], suggested: [] }));
const reads = computed(() => (selected.value ? visibleFrom(state.links, selected.value.id) : []));
function open(id: number) {
  openCross("projects", state.linkProject === id ? null : id);
}
const dockRows = computed(() => {
  const p = selected.value;
  if (!p) return [];
  return [
    { icon: p.key.startsWith("remote:") ? "i-lucide-git-branch" : "i-lucide-folder", k: p.key.startsWith("remote:") ? "Remote" : "Folder", v: projectPlace(p.key) },
    { icon: "i-lucide-sticky-note", k: "Memories", v: `${p.active.toLocaleString("en-GB")} active` },
    { icon: "i-lucide-clock", k: "Last active", v: p.lastActivity ? day(p.lastActivity) : "—", mono: true },
    { icon: "i-lucide-eye", k: "Reads", v: reads.value.length ? `Itself and ${reads.value.map((r) => r.name).join(", ")}` : "Only itself" },
  ];
});

const busy = ref<number | null>(null);
async function decide(id: number, change: "confirm" | "reject" | "unlink", other: string) {
  busy.value = id;
  try {
    await api.decideLink(id, change);
    await loadLinks();
    if (state.tab !== "projects") await reload();
    const title = change === "confirm" ? `Linked with ${other}` : change === "reject" ? "Suggestion rejected" : `Unlinked from ${other}`;
    const description = change === "reject" ? "It will not be suggested again." : change === "unlink" ? "Link them again here whenever you want." : "Each now reads what the other remembers, as the link says.";
    toast.add({ title, description, color: "success" });
  } catch (error) {
    toast.add({ title: "Not changed", description: error instanceof Error ? error.message : String(error), color: "error" });
  } finally {
    busy.value = null;
  }
}

// Linking by hand: another project and the kind.
const target = ref<number | undefined>(undefined);
const kind = ref<LinkKind>("product");
const targets = computed(() =>
  state.projects
    .filter((p) => p.id !== selected.value?.id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ label: p.name, value: p.id })),
);
const linking = ref(false);
async function linkByHand() {
  const p = selected.value;
  if (!p || target.value === undefined) return;
  linking.value = true;
  try {
    const made = await api.link(p.id, target.value, kind.value);
    await loadLinks();
    toast.add({ title: `Linked with ${made.from === p.id ? made.toName : made.fromName}`, color: "success" });
    target.value = undefined;
  } catch (error) {
    toast.add({ title: "Not linked", description: error instanceof Error ? error.message : String(error), color: "error" });
  } finally {
    linking.value = false;
  }
}
// What the project shares: a wider level is previewed and confirmed; a narrower one is set.
// The level binds the project to a server (ADR 0027): the one it is bound to, else the only
// one listed, else the one picked here when several are.
const servers = ref<ServerEntry[]>([]);
const chosenServer = ref<string | undefined>(undefined);
const serverItems = computed(() => servers.value.map((s) => ({ label: `${s.name} · ${s.host}`, value: s.id })));
onMounted(async () => {
  try {
    servers.value = (await api.servers()).servers.filter((s) => s.state !== "pending");
  } catch {
    servers.value = [];
  }
});
/** The server a level of this project goes to, by id; undefined leaves it to the server's rule. */
const serverFor = (p: Project) => p.server?.id ?? (servers.value.length > 1 ? chosenServer.value : undefined);
const serverNameFor = (p: Project) => p.server?.name ?? (servers.value.length > 1 ? servers.value.find((s) => s.id === chosenServer.value)?.name : servers.value[0]?.name) ?? null;
const sharingBusy = ref(false);
const widening = ref<{ id: number; name: string; level: Level; description: string } | null>(null);
const LEVEL_ITEMS = LEVELS.map((level) => ({ label: LEVEL_LABELS[level], value: level }));
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
/** Whatever failed, the person reads one plain sentence: no message, no path. */
const notChanged = () => toast.add({ title: "Not changed", description: "The level could not be saved.", color: "error" });

// The shared name (ADR 0028): a project with no host-led remote, or one that carries a name, has
// the field; its server's names are read once per server when the section opens; the sentence
// under the field comes from the preview route when the field settles, never per keystroke; a
// level chosen under a name the project is not yet bound by asks to create or join it first.
type NameSentence = { kind: "new" | "joins" | "taken" | "refused" | "created" | "purged"; slug: string; text: string; item: NameItem | null };
const namesByServer = reactive(new Map<string, { names: NameItem[]; truncated: boolean }>());
const typedName = ref("");
/** What the field holds while the person types; taken as the name when the field is left without a pick. */
const searchTerm = ref("");
const nameSentence = ref<NameSentence | null>(null);
/** The create or join confirmation: the question is the body's first sentence, the would-leave line its second. */
const binding = ref<{ id: number; name: string; level: Level; action: "create" | "join"; slug: string; question: string; leaves: string } | null>(null);
/** The field shows for a project with no host-led remote, and for one that carries a name. */
const hasField = (p: Project) => !p.remote || p.sharedName !== null;
/** The server the dock's names come from: the bound one, the chosen one, else the only one. */
const serverEntry = computed(() => {
  const p = selected.value;
  if (!p) return undefined;
  const id = serverFor(p) ?? servers.value[0]?.id;
  return servers.value.find((s) => s.id === id);
});
/** The server speaks contract 1: shared names are held until it is upgraded. */
const namesHeld = computed(() => (serverEntry.value?.contract ?? 2) < 2);
const serverNames = computed(() => (serverEntry.value ? namesByServer.get(serverEntry.value.id) : undefined));
const slugOfAlias = (alias: string) => alias.slice(NAME_PREFIX.length);
const nameItems = computed(() => (serverNames.value?.names ?? []).map((name) => slugOfAlias(name.alias)));
/** The server holds more names than the list carries (the first 1,000). */
const moreNames = computed(() => serverNames.value?.truncated === true);
const listedName = (slug: string) => serverNames.value?.names.find((name) => name.alias === `${NAME_PREFIX}${slug}`) ?? null;
const recreatedBy = computed(() => serverEntry.value?.names.find((name) => name.slug === selected.value?.sharedName)?.recreatedBy ?? "a teammate");
const prefill = (p: Project) => {
  const named = sharedNameOf(p.name);
  return named.ok ? slugOfAlias(named.alias) : "";
};
function levelPhrase(level: Level, project: string): string {
  if (level === "receive") return `and receive it into ${project}`;
  if (level === "knowledge") return `and share knowledge of ${project} as it`;
  if (level === "all") return `and share knowledge and memories of ${project} as it`;
  return `and share nothing of ${project}`;
}
/** The name's creator as the person reads it: "you" for this machine's own member. */
const creatorOf = (item: NameItem) => (item.createdBy.name === serverEntry.value?.member ? "you" : item.createdBy.name);
const joinText = (slug: string, item: NameItem) => `Joins \`${slug}\` · created by ${creatorOf(item)} · ${count(item.entries, "entry", "entries")}, ${count(item.memories, "memory", "memories")}`;
const joinTitle = (slug: string, item: NameItem, level: Level, project: string) =>
  `Join \`${slug}\`, created by ${creatorOf(item)} (${count(item.entries, "entry", "entries")}, ${count(item.memories, "memory", "memories")}), ${levelPhrase(level, project)}?`;

async function loadNames(serverId: string) {
  if (namesByServer.has(serverId)) return;
  try {
    namesByServer.set(serverId, await api.serverNames(serverId));
  } catch {
    // Held, pending or unreachable: the field still takes a name; the preview says the rest.
    namesByServer.set(serverId, { names: [], truncated: false });
  }
}
/** The sentence under the field, from the preview route. */
async function settleName() {
  const p = selected.value;
  const typed = typedName.value.trim();
  if (!p || !hasField(p) || p.boundTo === "name" || !typed) {
    nameSentence.value = null;
    return;
  }
  // What this machine knows without a request: a text that makes no name, a name another project here carries.
  const made = sharedNameOf(typed);
  if (!made.ok) {
    nameSentence.value = { kind: "refused", slug: typed, item: null, text: made.word === undefined ? "No shared name can be made of that: use letters or digits." : `No shared name can be made of that: \`${made.word}\` is a reserved file name.` };
    return;
  }
  const owner = state.projects.find((other) => other.id !== p.id && other.sharedName === slugOfAlias(made.alias));
  if (owner !== undefined) {
    nameSentence.value = { kind: "taken", slug: slugOfAlias(made.alias), item: null, text: `This name is \`${owner.name}\`'s on this machine.` };
    return;
  }
  try {
    const answer = await api.previewProjectSharing(p.id, p.sharing === "local" ? "receive" : p.sharing, typed, serverFor(p));
    const slug = slugOfAlias(answer.boundAlias);
    const item = listedName(slug);
    nameSentence.value = item
      ? { kind: "joins", slug, item, text: joinText(slug, item) }
      : { kind: "new", slug, item: null, text: `New: you create \`${slug}\` on ${serverNameFor(p) ?? "your team's server"}` };
  } catch (error) {
    const body = error instanceof RouteError ? error.body : {};
    nameSentence.value =
      body.reason === "name-taken"
        ? { kind: "taken", slug: typed, item: null, text: `This name is \`${String(body.other ?? "another project")}\`'s on this machine.` }
        : { kind: "refused", slug: typed, item: null, text: typeof body.error === "string" ? body.error : "No shared name can be made of that." };
  }
}
watch(
  () => [selected.value?.id, serverEntry.value?.id] as const,
  async () => {
    const p = selected.value;
    nameSentence.value = null;
    if (!p || !hasField(p)) {
      typedName.value = "";
      return;
    }
    typedName.value = p.sharedName ?? prefill(p);
    const entry = serverEntry.value;
    if (entry !== undefined && !namesHeld.value) await loadNames(entry.id);
    await settleName();
  },
  { immediate: true },
);
/** The field left with a typed text and no pick: the text is the name. */
function leaveField() {
  const term = searchTerm.value.trim();
  if (term !== "" && term !== typedName.value) {
    typedName.value = term;
    void settleName();
  }
}
/** The levels are offered once a team alias is available: the git remote, the name carried, or the one typed. */
const sharingLocked = computed(() => {
  const p = selected.value;
  if (!p || p.disabled) return true;
  if (servers.value.length > 1 && !p.server && chosenServer.value === undefined) return true;
  const aliasAvailable = p.remote || p.sharedName !== null || typedName.value.trim() !== "";
  return !aliasAvailable || (hasField(p) && namesHeld.value && p.boundTo !== "name");
});
async function chooseLevel(level: Level) {
  const p = selected.value;
  if (!p || level === p.sharing) return;
  // A name the project is not yet bound by: the create or join confirmation, whatever the level.
  if (hasField(p) && level !== "local" && !(p.boundTo === "name" && p.sharedName === typedName.value.trim())) {
    await openBinding(p, level);
    return;
  }
  if (!widens(p.sharing, level)) {
    await setLevel(p.id, level, false);
    return;
  }
  sharingBusy.value = true;
  try {
    const server = serverFor(p);
    const { report } = await api.sharingPreview({ level: { projectId: p.id, level, ...(server ? { server } : {}) } });
    const own = report.perProject.find((row) => row.id === p.id) ?? report.counts;
    const serverName = serverNameFor(p);
    widening.value = {
      id: p.id,
      name: p.name,
      level,
      description: `${count(own.entries, "knowledge entry", "knowledge entries")} and ${count(own.memories, "memory", "memories")} of ${p.name} ${serverName === null ? "would leave for your team's server once one is listed. Nothing is sent now." : `would leave for ${serverName}.`}${importedLine(p)}`,
    };
  } catch {
    notChanged();
  } finally {
    sharingBusy.value = false;
  }
}
/** The imported memories stay on this machine whatever the level (D-6); said when there are any. */
const importedText = (k: number) => (k === 1 ? "1 imported memory stays on this machine." : `${k.toLocaleString("en-GB")} imported memories stay on this machine.`);
const importedLine = (p: Project) => (p.imported > 0 ? ` ${importedText(p.imported)}` : "");
/** The create or join confirmation: the title from the sentence's state, the counts from the preview. */
async function openBinding(p: Project, level: Level) {
  sharingBusy.value = true;
  try {
    if (nameSentence.value === null) await settleName();
    const sentence = nameSentence.value;
    if (sentence === null || sentence.kind === "taken" || sentence.kind === "refused" || sentence.kind === "purged") {
      toast.add({ title: "Not changed", description: sentence?.text ?? "Type a shared name first.", color: "error" });
      return;
    }
    const server = serverFor(p);
    const { report } = await api.sharingPreview({ level: { projectId: p.id, level, ...(server ? { server } : {}) } });
    const own = report.perProject.find((row) => row.id === p.id) ?? report.counts;
    const serverName = serverNameFor(p) ?? "your team's server";
    const action = sentence.item === null ? "create" : "join";
    const question =
      sentence.item === null
        ? `Create \`${sentence.slug}\` on ${serverName}, visible to every member, ${levelPhrase(level, p.name)}?`
        : joinTitle(sentence.slug, sentence.item, level, p.name);
    const leaves = `${level === "receive" ? `Nothing of ${p.name} leaves.` : `${count(own.entries, "knowledge entry", "knowledge entries")} and ${count(own.memories, "memory", "memories")} would leave.`}${importedLine(p)}`;
    binding.value = { id: p.id, name: p.name, level, action, slug: sentence.slug, question, leaves };
  } catch {
    notChanged();
  } finally {
    sharingBusy.value = false;
  }
}
async function confirmBinding() {
  const b = binding.value;
  const p = selected.value;
  if (!b || !p) return;
  sharingBusy.value = true;
  try {
    const changed = await api.setProjectSharing(b.id, b.level, true, serverFor(p), typedName.value.trim(), b.action === "create");
    binding.value = null;
    nameSentence.value = null;
    const entry = serverEntry.value;
    if (entry !== undefined) namesByServer.delete(entry.id);
    await loadOverview();
    if (entry !== undefined) await loadNames(entry.id);
    toast.add({ title: "Sharing changed", description: `${LEVEL_LABELS[changed.old]} → ${LEVEL_LABELS[changed.level]}, shared as ${changed.sharedName ?? b.slug}`, color: "success" });
  } catch (error) {
    const body = error instanceof RouteError ? error.body : {};
    const sentence = typeof body.error === "string" ? body.error : "The level could not be saved.";
    if (body.reason === "exists" && body.name !== null && typeof body.name === "object") {
      // The name was created between the list and the yes: the join state, confirmed again.
      const item = body.name as NameItem;
      nameSentence.value = { kind: "joins", slug: b.slug, item, text: joinText(b.slug, item) };
      binding.value = { ...b, action: "join", question: joinTitle(b.slug, item, b.level, b.name) };
      return;
    }
    binding.value = null;
    if (body.reason === "purged") {
      nameSentence.value = { kind: "purged", slug: b.slug, item: null, text: `Removed: the operator removed \`${b.slug}\` from ${serverNameFor(p) ?? "the server"}; pick another name.` };
      return;
    }
    if (body.named === true) {
      // The name is on the server, the level is not: the sentence says so, and the list has it.
      // The route's two sentences, as one the dock shows: a capital first letter and a full stop.
      nameSentence.value = { kind: "created", slug: b.slug, item: null, text: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.` };
      const entry = serverEntry.value;
      if (entry !== undefined) {
        namesByServer.delete(entry.id);
        await loadNames(entry.id);
      }
      return;
    }
    toast.add({ title: "Not changed", description: sentence, color: "error" });
  } finally {
    sharingBusy.value = false;
  }
}
async function forgetName(p: Project) {
  sharingBusy.value = true;
  try {
    await api.forgetProjectName(p.id);
    await loadOverview();
    typedName.value = prefill(p);
    nameSentence.value = null;
    toast.add({ title: "Name forgotten", description: `${p.name} no longer carries a shared name.`, color: "success" });
  } catch {
    toast.add({ title: "Not changed", description: "The name could not be forgotten.", color: "error" });
  } finally {
    sharingBusy.value = false;
  }
}
async function setLevel(id: number, level: Level, confirm: boolean) {
  sharingBusy.value = true;
  try {
    const p = state.projects.find((row) => row.id === id);
    const changed = await api.setProjectSharing(id, level, confirm, p ? serverFor(p) : undefined);
    await loadOverview();
    toast.add({ title: "Sharing changed", description: `${LEVEL_LABELS[changed.old]} → ${LEVEL_LABELS[changed.level]}`, color: "success" });
  } catch {
    notChanged();
  } finally {
    sharingBusy.value = false;
    widening.value = null;
  }
}

const RELATION_TONE = {
  "Same product": { bg: "var(--violet-soft)", fg: "var(--violet-text)" },
  Uses: { bg: "var(--blue-soft)", fg: "var(--blue-text)" },
  "Used by": { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" },
} as const;
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Toolbar row, 40px: the search field first, as the Audit log's; then the one toggle. -->
    <div class="flex h-10 flex-none items-center gap-2 px-4">
      <label class="flex h-7 w-[232px] flex-none items-center gap-1.5 rounded-lg border border-(--btn-secondary-line) bg-(--paper-raised) px-2 text-(--ink-muted)">
        <UIcon name="i-lucide-search" class="size-3.5 flex-none" />
        <input ref="field" v-model="q" type="search" placeholder="Find a project" aria-label="Find a project" class="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-(--ink) outline-none focus-visible:outline-none" @keydown.esc.stop="q ? (q = '') : field?.blur()">
      </label>
      <button v-if="pending" type="button" class="wz-pill" :aria-pressed="reviewOnly" @click="reviewOnly = !reviewOnly">To review · {{ pending }}</button>
      <div class="flex-1" />
      <span class="wz-meta">{{ confirmedCount ? `${confirmedCount} ${confirmedCount === 1 ? "link" : "links"}` : "No links yet" }}<template v-if="pending"> · {{ pending }} {{ pending === 1 ? "suggestion" : "suggestions" }} to review</template></span>
    </div>

    <div class="flex min-h-0 flex-1 border-t border-(--line)">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div v-if="groups.length" role="rowgroup" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-4">
          <section v-for="g in groups" :key="g.key" class="wz-group" :aria-label="g.label">
            <div class="wz-group-head">
              <button type="button" class="wz-icon-btn sm" :aria-expanded="!collapsed[g.key]" :aria-label="`Show or hide ${g.label}`" @click="collapsed[g.key] = !collapsed[g.key]">
                <UIcon name="i-lucide-chevron-down" class="size-3.5 transition-transform duration-[160ms] ease-out" :class="{ '-rotate-90': collapsed[g.key] }" />
              </button>
              <span class="wz-stage" :style="{ background: TONE[g.key].bg, color: TONE[g.key].fg }">{{ g.label }}</span>
              <span class="wz-mono text-(--ink-muted)">{{ g.items.length }}</span>
              <span v-if="g.key === 'review'" class="wz-meta">· shared owners, manifests and workspaces</span>
            </div>
            <div class="wz-collapse" :style="{ gridTemplateRows: collapsed[g.key] ? '0fr' : '1fr' }">
              <div :style="{ visibility: collapsed[g.key] ? 'hidden' : 'visible' }">
                <div role="row" class="wz-table-head border-t border-(--row-line)" :style="cols">
                  <span role="columnheader" class="pl-7">Project · where</span>
                  <span role="columnheader">Links</span>
                  <template v-if="!docked">
                    <span role="columnheader">Memories</span>
                    <span role="columnheader">Last active</span>
                  </template>
                </div>
                <button
                  v-for="p in g.items"
                  :key="p.id"
                  :data-project="p.id"
                  type="button"
                  role="row"
                  class="wz-row"
                  :style="cols"
                  :aria-selected="p.id === state.linkProject"
                  @click="open(p.id)"
                >
                  <span role="cell" class="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" class="wz-tile" :style="{ background: hue(p.name) }">{{ p.name.charAt(0) }}</span>
                    <span class="wz-name max-w-[60%] flex-initial">{{ p.name }}</span>
                    <span class="wz-meta flex-1" :title="p.key">{{ projectPlace(p.key) }}</span>
                  </span>
                  <span role="cell" class="flex min-w-0 items-center gap-1.5">
                    <span v-if="linksCell(p).review" class="wz-status square flex-none" :style="{ background: 'var(--warn-soft)', color: 'var(--warn)' }">{{ linksCell(p).review }} to review</span>
                    <span v-if="linksCell(p).text" class="wz-meta flex-initial" :class="{ 'text-(--ink)!': !linksCell(p).muted }">{{ linksCell(p).text }}</span>
                    <span v-if="linksCell(p).more" class="wz-mono flex-none text-(--ink-muted)">+{{ linksCell(p).more }}</span>
                    <span v-if="!linksCell(p).review && !linksCell(p).text && p.sharing === 'local'" class="wz-meta">—</span>
                    <span v-if="p.sharing !== 'local'" class="wz-status flex-none" :style="{ background: 'var(--blue-soft)', color: 'var(--blue-text)' }">{{ LEVEL_LABELS[p.sharing] }}</span>
                  </span>
                  <template v-if="!docked">
                    <span role="cell" class="wz-mono text-(--ink-muted)">{{ compact(p.active) }}</span>
                    <span role="cell" class="wz-mono text-(--ink-muted)">{{ p.lastActivity ? day(p.lastActivity) : "—" }}</span>
                  </template>
                </button>
              </div>
            </div>
          </section>
          <p v-if="!state.links.length" class="m-0 flex h-8 flex-none items-center gap-2 px-1 text-xs text-(--ink-muted)">
            <UIcon name="i-lucide-info" class="size-3.5 flex-none" />
            <span class="truncate">No links yet. Suggestions come from a shared owner and name, a manifest or one workspace; open a project to link it by hand.</span>
          </p>
        </div>
        <Empty v-else-if="q || reviewOnly" icon="i-lucide-search-x" title="No projects match" text="Try another name, or show every project.">
          <div class="mt-3 flex items-center gap-4"><button type="button" class="wz-link text-[13px]" @click="q = ''; reviewOnly = false">Show every project</button></div>
        </Empty>
        <Empty v-else icon="i-lucide-folder" title="No projects yet" text="Start a session in any of your agents. Its project shows up here." />
      </div>

      <Dock v-if="selected" type="Project" icon="i-lucide-folder" :id="selected.id" label="Project links" @close="openCross('projects', null)">
        <template #head>
          <div class="flex items-center gap-2.5">
            <span aria-hidden="true" class="flex size-8 flex-none items-center justify-center rounded-lg font-display text-[13px] font-bold text-[#100E0D] uppercase" :style="{ background: hue(selected.name) }">{{ selected.name.charAt(0) }}</span>
            <div class="flex min-w-0 flex-col">
              <h2 class="m-0 truncate text-[15px] leading-5 font-semibold">{{ selected.name }}</h2>
              <span class="wz-meta" :title="selected.key">{{ projectPlace(selected.key) }}</span>
            </div>
          </div>
        </template>
        <template #props>
          <DockProps :rows="dockRows" />
        </template>

        <section v-if="mine.suggested.length" aria-label="Suggestions" class="flex flex-col gap-2 border-t border-(--line) pt-3">
          <div class="flex h-5 items-center gap-2"><h3 class="m-0 text-sm font-semibold">To review</h3><span class="wz-mono text-(--ink-muted)">{{ mine.suggested.length }}</span></div>
          <div v-for="s in mine.suggested" :key="s.link.id" :data-suggestion="s.link.id" class="flex flex-col gap-2 rounded-lg border border-(--line) bg-(--paper) p-2.5">
            <div class="flex h-5 min-w-0 items-center gap-2">
              <span aria-hidden="true" class="wz-tile" :style="{ background: hue(s.otherName) }">{{ s.otherName.charAt(0) }}</span>
              <span class="wz-name flex-1">{{ s.otherName }}</span>
              <span class="wz-status flex-none" :style="{ background: RELATION_TONE[s.label].bg, color: RELATION_TONE[s.label].fg }">{{ s.label }}</span>
            </div>
            <dl v-if="s.link.signals.length" class="m-0 flex flex-col gap-1">
              <div v-for="sig in s.link.signals" :key="sig" class="flex min-w-0 flex-wrap items-baseline gap-x-1.5" :title="sig">
                <dt v-if="signalParts(sig).label" class="flex-none text-xs leading-4 text-(--ink-muted)">{{ signalParts(sig).label }}</dt>
                <dd class="m-0 min-w-0 font-mono text-xs leading-4 text-(--ink) [overflow-wrap:anywhere]">{{ signalParts(sig).value }}</dd>
              </div>
            </dl>
            <div class="flex items-center gap-2">
              <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-link-2" label="Link" :loading="busy === s.link.id" @click="decide(s.link.id, 'confirm', s.otherName)" />
              <UButton size="xs" color="neutral" variant="outline" label="Reject" :disabled="busy === s.link.id" @click="decide(s.link.id, 'reject', s.otherName)" />
            </div>
          </div>
        </section>

        <section aria-label="Linked projects" class="flex flex-col gap-1 border-t border-(--line) pt-3">
          <div class="flex h-5 items-center gap-2"><h3 class="m-0 text-sm font-semibold">Linked</h3><span class="wz-mono text-(--ink-muted)">{{ mine.confirmed.length }}</span></div>
          <p v-if="!mine.confirmed.length" class="m-0 text-xs leading-4 text-(--ink-muted)">Not linked to any project. Its memories stay its own.</p>
          <div v-for="c in mine.confirmed" :key="c.link.id" :data-link="c.link.id" class="flex h-8 min-w-0 items-center gap-2">
            <span aria-hidden="true" class="wz-tile" :style="{ background: hue(c.otherName) }">{{ c.otherName.charAt(0) }}</span>
            <span class="min-w-0 flex-1 truncate text-[13px] leading-[18px]">{{ c.otherName }}</span>
            <span class="wz-status flex-none" :style="{ background: RELATION_TONE[c.label].bg, color: RELATION_TONE[c.label].fg }">{{ c.label }}</span>
            <UButton size="xs" color="neutral" variant="ghost" label="Unlink" :loading="busy === c.link.id" @click="decide(c.link.id, 'unlink', c.otherName)" />
          </div>
          <p class="m-0 pt-1 text-xs leading-4 text-(--ink-muted)">Same product: each reads the other. Uses: this one reads the library, never the reverse.</p>
        </section>

        <section aria-label="Sharing" class="flex flex-col gap-2 border-t border-(--line) pt-3">
          <div class="flex h-5 items-center gap-2"><h3 class="m-0 text-sm font-semibold">Sharing</h3><span class="wz-meta">{{ LEVEL_LABELS[selected.sharing] }}</span></div>
          <p v-if="selected.server" class="m-0 text-xs leading-4 text-(--ink-muted)">Bound to {{ selected.server.name }}.</p>
          <UFormField v-else-if="servers.length > 1" label="Server" help="The level binds this project to the server you pick." class="w-full">
            <USelectMenu :model-value="chosenServer" :items="serverItems" value-key="value" :search-input="false" placeholder="Choose a server" size="sm" class="w-full" @update:model-value="(id) => (chosenServer = id as string)" />
          </UFormField>
          <p v-else-if="servers.length === 1" class="m-0 text-xs leading-4 text-(--ink-muted)">A level set here binds this project to {{ servers[0]?.name }}.</p>
          <!-- The shared name (ADR 0028): a project with no host-led remote, or one that carries a name. -->
          <template v-if="!selected.remote || selected.sharedName">
            <div v-if="selected.boundTo === 'name'" class="flex flex-col gap-1">
              <p class="m-0 text-xs leading-4 text-(--ink)">Shared as <code class="wz-mono">{{ selected.sharedName }}</code>.<template v-if="selected.remote"> This project now has a git remote; to match by the remote instead, set Nothing, forget the name, then set the level again.</template></p>
              <p v-if="selected.nameState === 'missing'" class="m-0 text-xs leading-4 text-(--warn)">Missing: the server does not hold <code class="wz-mono">{{ selected.sharedName }}</code>; set the level again to create or join it.</p>
              <p v-else-if="selected.nameState === 'recreated'" class="m-0 text-xs leading-4 text-(--warn)">The shared name <code class="wz-mono">{{ selected.sharedName }}</code> was re-created on the server by {{ recreatedBy }}; join it again, or set Nothing to leave it.</p>
              <p v-else-if="selected.nameState === 'purged'" class="m-0 text-xs leading-4 text-(--warn)">Removed: the operator removed <code class="wz-mono">{{ selected.sharedName }}</code> from the server; set Nothing to leave it.</p>
              <p v-else-if="!selected.remote" class="m-0 text-xs leading-4 text-(--ink-muted)">Set Nothing to leave this name.</p>
            </div>
            <UFormField v-else label="Shared name" :help="namesHeld ? undefined : 'A name the team matches this project by: a new one, or one a teammate created.'" class="w-full">
              <UInputMenu v-model="typedName" :items="nameItems" create-item :disabled="namesHeld || sharingBusy" placeholder="shared name" size="sm" class="w-full" @update:model-value="settleName" @update:search-term="(term: string) => (searchTerm = term)" @create="(term: string) => { typedName = term; settleName(); }" @blur="leaveField" />
              <p v-if="namesHeld" class="m-0 pt-1 text-xs leading-4 text-(--warn)">The server speaks contract 1; shared names need its upgrade.</p>
              <p v-else-if="nameSentence" class="m-0 pt-1 text-xs leading-4" :class="nameSentence.kind === 'new' || nameSentence.kind === 'joins' ? 'text-(--ink-muted)' : 'text-(--warn)'">{{ nameSentence.text }}</p>
              <p v-if="moreNames" class="m-0 pt-1 text-xs leading-4 text-(--ink-muted)">The list shows the first 1,000 names.</p>
            </UFormField>
            <div v-if="selected.sharedName && selected.boundTo !== 'name'" class="flex items-center">
              <UButton size="xs" color="neutral" variant="outline" label="Forget name" :loading="sharingBusy" @click="forgetName(selected)" />
            </div>
          </template>
          <URadioGroup
            :model-value="selected.sharing"
            :items="LEVEL_ITEMS"
            value-key="value"
            size="sm"
            legend="What this project shares"
            :disabled="sharingLocked || sharingBusy"
            :class="{ 'opacity-60': sharingLocked }"
            :ui="{ legend: 'sr-only', fieldset: 'gap-0', item: 'h-8 items-center' }"
            @update:model-value="(level) => chooseLevel(level as Level)"
          />
          <p v-if="selected.disabled" class="m-0 text-xs leading-4 text-(--ink)">Memory is off for this project.</p>
          <p v-if="selected.sharing === 'all' && selected.imported > 0" class="m-0 text-xs leading-4 text-(--ink-muted)">{{ importedText(selected.imported) }}</p>
          <p class="m-0 text-xs leading-4 text-(--ink-muted)">Memories have no area: Knowledge and memories sends every active memory of this project that is not stale, branch-bound, imported or one of your rules.</p>
        </section>

        <section aria-label="Link by hand" class="flex flex-col gap-2 border-t border-(--line) pt-3">
          <h3 class="m-0 h-5 text-sm font-semibold">Link by hand</h3>
          <USelectMenu v-model="target" :items="targets" value-key="value" placeholder="Choose a project" size="md" class="w-full" :search-input="{ placeholder: 'Find a project' }" />
          <div class="flex items-center gap-2">
            <div class="wz-segmented" role="group" aria-label="Kind of link">
              <button type="button" :aria-pressed="kind === 'product'" @click="kind = 'product'">Same product</button>
              <button type="button" :aria-pressed="kind === 'uses'" @click="kind = 'uses'">Uses it</button>
            </div>
            <span class="flex-1" />
            <UButton size="sm" color="neutral" variant="outline" label="Link" :disabled="target === undefined" :loading="linking" @click="linkByHand" />
          </div>
        </section>
      </Dock>
    </div>
    <Confirm
      :open="widening !== null"
      tone="warn"
      icon="i-lucide-share-2"
      :title="`Share more of ${widening?.name ?? ''}?`"
      :description="widening?.description ?? ''"
      action="Share"
      :busy="sharingBusy"
      @update:open="(o) => { if (!o) widening = null; }"
      @confirm="widening && setLevel(widening.id, widening.level, true)"
    />
    <Confirm
      :open="binding !== null"
      tone="warn"
      icon="i-lucide-share-2"
      :title="binding?.action === 'create' ? 'Create a shared name?' : 'Join a shared name?'"
      :description="binding ? `${binding.question} ${binding.leaves}` : ''"
      :action="binding?.action === 'create' ? 'Create and share' : 'Join and share'"
      :busy="sharingBusy"
      @update:open="(o) => { if (!o) binding = null; }"
      @confirm="confirmBinding"
    />
  </div>
</template>
