<script setup lang="ts">
// A newer release is out, as Sales OS's page-level info banner (SystemStates SYS-060), the
// History offer's sibling: 36px, the full width of main, blue-soft with blue text, a 16px
// icon, one line that truncates, the actions on the right. It stays away for the release it
// was dismissed for, and comes back for a later one. Nothing is asked of the network.
import { computed, onMounted } from "vue";
import { api } from "../api";
import { bannerLine, bannerShort } from "../update";
import { loadUpdate, updateState } from "../update-state";

const emit = defineEmits<{ how: [] }>();
const show = computed(() => updateState.value?.banner === true);
const line = computed(() => (updateState.value ? bannerLine(updateState.value) : ""));
// A phone's width has room for a few words beside the two actions: the release, uncut.
const short = computed(() => (updateState.value ? bannerShort(updateState.value) : ""));

onMounted(() => loadUpdate());

async function dismiss() {
  if (updateState.value) updateState.value = { ...updateState.value, banner: false };
  try {
    await api.dismissUpdate();
  } catch {
    // Shown again next time: nothing is lost.
  }
}
</script>

<template>
  <div v-if="show" role="status" class="flex h-9 flex-none items-center gap-2 bg-(--blue-soft) pr-2 pl-4 text-[12.5px] leading-4 text-(--blue-text)">
    <UIcon name="i-lucide-circle-arrow-up" class="size-4 flex-none" />
    <span class="min-w-0 flex-1 truncate sm:hidden" :title="line">{{ short }}</span>
    <span class="hidden min-w-0 flex-1 truncate sm:inline">{{ line }}</span>
    <button type="button" class="flex-none cursor-pointer border-0 bg-transparent px-1 text-[12.5px] leading-4 font-semibold whitespace-nowrap text-(--blue-text) underline underline-offset-2" @click="emit('how')">How to update</button>
    <button type="button" class="flex-none cursor-pointer border-0 bg-transparent px-1 text-[12.5px] leading-4 font-medium whitespace-nowrap text-(--blue-text) hover:underline hover:underline-offset-2" @click="dismiss">Dismiss</button>
  </div>
</template>
