<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, type BackupsView } from "../../api";
import { ago, when } from "../../format";
import { fromEnvironment, saveSettings, setting, settingsState, valueOf } from "../../settings";
import { loadOverview } from "../../viewer";
import Card from "./Card.vue";

const toast = useToast();
const view = ref<BackupsView | null>(null);
const busy = ref<"none" | "test" | "now" | "restore">("none");
const restoring = ref<string | null>(null);
const mb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

// The form mirrors the settings; saving writes only what changed.
type Kind = "none" | "folder" | "s3";
const kindItems = [
  { label: "Nowhere (off)", value: "none" },
  { label: "A folder — external disk, NAS", value: "folder" },
  { label: "An S3-compatible bucket — AWS, R2, MinIO, B2", value: "s3" },
];
const current = () => valueOf("WIZARDINGCODE_MEM_BACKUP_TO") ?? "";
const kindOf = (to: string): Kind => (to === "" ? "none" : to.startsWith("s3://") ? "s3" : "folder");
const kind = ref<Kind>(kindOf(current()));
const to = ref(current());
const every = ref(valueOf("WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS") ?? "24");
const keep = ref(valueOf("WIZARDINGCODE_MEM_BACKUP_KEEP") ?? "10");
const endpoint = ref(valueOf("WIZARDINGCODE_MEM_BACKUP_S3_ENDPOINT") ?? "");
const region = ref(valueOf("WIZARDINGCODE_MEM_BACKUP_S3_REGION") ?? "");
const accessKey = ref(valueOf("WIZARDINGCODE_MEM_BACKUP_S3_ACCESS_KEY") ?? "");
const secretKey = ref("");
const secretSet = computed(() => {
  const s = setting("WIZARDINGCODE_MEM_BACKUP_S3_SECRET_KEY");
  return s !== null && "secret" in s && s.set;
});
const locked = computed(() => fromEnvironment("WIZARDINGCODE_MEM_BACKUP_TO"));
watch(
  () => settingsState.view,
  () => {
    to.value = current();
    kind.value = kindOf(to.value);
    every.value = valueOf("WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS") ?? "24";
    keep.value = valueOf("WIZARDINGCODE_MEM_BACKUP_KEEP") ?? "10";
  },
);
watch(kind, (k) => {
  if (k === "none") to.value = "";
  else if (k === "s3" && !to.value.startsWith("s3://")) to.value = "s3://";
  else if (k === "folder" && to.value.startsWith("s3://")) to.value = "";
});

async function load() {
  try {
    view.value = await api.backups();
  } catch (error) {
    toast.add({ title: "Backups", description: error instanceof Error ? error.message : String(error), color: "error" });
  }
}
onMounted(load);

async function save() {
  const patch: Record<string, string | null> = {
    WIZARDINGCODE_MEM_BACKUP_TO: kind.value === "none" ? null : to.value.trim(),
    WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS: every.value,
    WIZARDINGCODE_MEM_BACKUP_KEEP: keep.value,
  };
  if (kind.value === "s3") {
    patch.WIZARDINGCODE_MEM_BACKUP_S3_ENDPOINT = endpoint.value.trim() || null;
    patch.WIZARDINGCODE_MEM_BACKUP_S3_REGION = region.value.trim() || null;
    patch.WIZARDINGCODE_MEM_BACKUP_S3_ACCESS_KEY = accessKey.value.trim() || null;
    if (secretKey.value.trim()) patch.WIZARDINGCODE_MEM_BACKUP_S3_SECRET_KEY = secretKey.value.trim();
  }
  if (await saveSettings(patch)) {
    secretKey.value = "";
    toast.add({ title: "Backup settings saved", color: "success" });
    await load();
  }
}

async function test() {
  busy.value = "test";
  try {
    const result = await api.testBackups();
    toast.add(
      result.ok
        ? { title: "Target reachable", description: `${result.label}: ${result.entries} backup${result.entries === 1 ? "" : "s"} there.`, color: "success" }
        : { title: "Target not reachable", description: result.detail, color: "error" },
    );
  } catch (error) {
    toast.add({ title: "Target not reachable", description: error instanceof Error ? error.message : String(error), color: "error" });
  } finally {
    busy.value = "none";
  }
}

async function backupNow() {
  busy.value = "now";
  try {
    const outcome = await api.backupNow();
    toast.add(outcome.ok ? { title: "Backed up", description: `${outcome.name} · ${mb(outcome.bytes)}`, color: "success" } : { title: "Not backed up", description: outcome.detail, color: "error" });
    await load();
  } catch (error) {
    toast.add({ title: "Not backed up", description: error instanceof Error ? error.message : String(error), color: "error" });
  } finally {
    busy.value = "none";
  }
}

async function restore() {
  if (restoring.value === null) return;
  busy.value = "restore";
  try {
    const outcome = await api.restoreBackup(restoring.value);
    if (outcome.ok) {
      toast.add({ title: "Restored", description: `The previous database was kept as ${outcome.replaced.split("/").pop()}.${outcome.historyRemoved ? " The history index was removed; run wizardingcode-mem history index to rebuild it." : ""}`, color: "success" });
      restoring.value = null;
      await Promise.all([load(), loadOverview()]);
    } else {
      toast.add({ title: "Not restored", description: outcome.detail, color: "error" });
    }
  } catch (error) {
    toast.add({ title: "Not restored", description: error instanceof Error ? error.message : String(error), color: "error" });
  } finally {
    busy.value = "none";
  }
}
</script>

<template>
  <Card id="backups" title="Backups" description="Compressed copies on a schedule and on demand. A restore keeps the current file.">
    <template #aside>
      <span v-if="view?.target" class="wz-status" :class="view.due ? 'square' : ''" :style="view.due ? { background: 'var(--warn-soft)', color: 'var(--warn)' } : { background: 'var(--ok-soft)', color: 'var(--ok)' }">{{ view.due ? "Due" : "Up to date" }}</span>
    </template>
    <div class="flex flex-col gap-4">
      <UFormField label="Back up to" :help="locked ? 'Set by the environment.' : undefined" :error="settingsState.errors.WIZARDINGCODE_MEM_BACKUP_TO">
        <USelectMenu v-model="kind" :items="kindItems" value-key="value" :search-input="false" class="w-full max-w-[360px]" :disabled="locked" />
      </UFormField>
      <template v-if="kind !== 'none'">
        <UFormField :label="kind === 's3' ? 'Bucket' : 'Folder'" :help="kind === 's3' ? 's3://bucket/prefix' : 'An absolute path; created if needed.'" :error="settingsState.errors.WIZARDINGCODE_MEM_BACKUP_TO">
          <UInput v-model="to" class="w-full max-w-[440px]" :ui="{ base: 'font-mono text-xs' }" :placeholder="kind === 's3' ? 's3://my-bucket/wizardingcode-mem' : '/Volumes/NAS/backups/wizardingcode-mem'" :disabled="locked" />
        </UFormField>
        <div v-if="kind === 's3'" class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Endpoint" help="Empty for AWS." :error="settingsState.errors.WIZARDINGCODE_MEM_BACKUP_S3_ENDPOINT">
            <UInput v-model="endpoint" class="w-full" :ui="{ base: 'font-mono text-xs' }" placeholder="https://<account>.r2.cloudflarestorage.com" />
          </UFormField>
          <UFormField label="Region" :error="settingsState.errors.WIZARDINGCODE_MEM_BACKUP_S3_REGION">
            <UInput v-model="region" class="w-full" :ui="{ base: 'font-mono text-xs' }" placeholder="auto" />
          </UFormField>
          <UFormField label="Access key" :error="settingsState.errors.WIZARDINGCODE_MEM_BACKUP_S3_ACCESS_KEY">
            <UInput v-model="accessKey" class="w-full" :ui="{ base: 'font-mono text-xs' }" autocomplete="off" />
          </UFormField>
          <UFormField label="Secret key" :help="secretSet ? 'Set; paste a new one to replace it.' : 'Kept in the settings file, never shown.'" :error="settingsState.errors.WIZARDINGCODE_MEM_BACKUP_S3_SECRET_KEY">
            <UInput v-model="secretKey" type="password" class="w-full" :ui="{ base: 'font-mono text-xs' }" autocomplete="off" :placeholder="secretSet ? '••••••••' : ''" />
          </UFormField>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Every" help="Hours between copies; 0 means only when you ask." :error="settingsState.errors.WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS">
            <div class="flex items-center gap-2"><UInput v-model="every" type="number" min="0" max="720" class="w-24" /><span class="text-[13px] text-(--ink-muted)">hours</span></div>
          </UFormField>
          <UFormField label="Keep" help="Older copies are removed." :error="settingsState.errors.WIZARDINGCODE_MEM_BACKUP_KEEP">
            <div class="flex items-center gap-2"><UInput v-model="keep" type="number" min="1" max="1000" class="w-24" /><span class="text-[13px] text-(--ink-muted)">copies</span></div>
          </UFormField>
        </div>
      </template>
      <div class="flex flex-wrap items-center gap-2">
        <UButton color="primary" label="Save" :loading="settingsState.saving" :disabled="locked && kind !== 'none'" @click="save" />
        <template v-if="view?.target">
          <UButton color="neutral" variant="outline" icon="i-lucide-plug-zap" label="Test" :loading="busy === 'test'" @click="test" />
          <UButton color="neutral" variant="outline" icon="i-lucide-database-backup" label="Back up now" :loading="busy === 'now'" @click="backupNow" />
        </template>
      </div>

      <template v-if="view?.target">
        <div class="wz-block text-xs text-(--ink-muted)">
          <template v-if="view.last">Last copy {{ ago(view.last.at) }} ({{ when(view.last.at) }}) · {{ mb(view.last.bytes) }} · {{ view.last.label }}</template>
          <template v-else>No copy yet.</template>
        </div>
        <UAlert v-if="view.error" color="error" variant="soft" icon="i-lucide-triangle-alert" title="The target could not be listed" :description="view.error" />
        <div v-else-if="view.entries.length" class="wz-table">
          <div class="wz-table-head" style="grid-template-columns: minmax(0, 1fr) 56px 80px 88px"><span>Copy</span><span>Schema</span><span class="text-right">Size</span><span /></div>
          <div v-for="e in view.entries" :key="e.name" class="grid h-8 items-center gap-x-2 border-t border-(--row-line) px-3" style="grid-template-columns: minmax(0, 1fr) 56px 80px 88px">
            <span class="wz-mono" :title="e.name">{{ when(e.at) }}</span>
            <span class="wz-mono text-(--ink-muted)">v{{ e.version }}</span>
            <span class="wz-mono text-right text-(--ink-muted)">{{ mb(e.bytes) }}</span>
            <button type="button" class="wz-link justify-self-end" @click="restoring = e.name">Restore…</button>
          </div>
        </div>
      </template>
    </div>
    <UModal :open="restoring !== null" title="Restore this copy?" :description="`The database is replaced by ${restoring ?? ''}. What is there now is kept, renamed, next to it. Best done between sessions.`" @update:open="(o) => { if (!o) restoring = null; }">
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="restoring = null" />
          <UButton color="error" label="Restore" :loading="busy === 'restore'" @click="restore" />
        </div>
      </template>
    </UModal>
  </Card>
</template>
