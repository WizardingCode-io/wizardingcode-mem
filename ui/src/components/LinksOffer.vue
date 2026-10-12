<script setup lang="ts">
// The quiet offer for new link suggestions and rule proposals, as the history offer draws it
// (Sales OS SystemStates SYS-060, the page-level info banner): 36px, the full width of main
// under the page header, blue-soft with blue text, a 16px icon, one line that truncates, the
// action links on the right. Asked each time the memories open (a light route: two counts);
// dismissing it keeps it away until something newer comes.
import { computed, onMounted, ref } from "vue";
import { api, type LinksOffer } from "../api";
import { linksOfferLine } from "../links";

const emit = defineEmits<{ review: [tab: "projects" | "you"] }>();
const offered = ref<LinksOffer | null>(null);
const show = computed(() => offered.value?.show === true);
const line = computed(() => (offered.value ? linksOfferLine(offered.value) : ""));

onMounted(async () => {
  try {
    offered.value = await api.linksOffer();
  } catch {
    // No offer is better than a broken page.
  }
});

/** Seen once reviewed: the banner stays away until something newer comes. */
function review() {
  const offer = offered.value;
  emit("review", offer !== null && offer.suggestions === 0 ? "you" : "projects");
  void dismiss();
}

async function dismiss() {
  offered.value = null;
  try {
    await api.dismissLinksOffer();
  } catch {
    // Shown again next time: nothing is lost.
  }
}
</script>

<template>
  <div v-if="show" role="status" class="flex h-9 flex-none items-center gap-2 bg-(--blue-soft) pr-2 pl-4 text-[12.5px] leading-4 text-(--blue-text)">
    <UIcon name="i-lucide-link-2" class="size-4 flex-none" />
    <span class="min-w-0 flex-1 truncate">{{ line }}</span>
    <button type="button" class="flex-none cursor-pointer border-0 bg-transparent px-1 text-[12.5px] leading-4 font-semibold whitespace-nowrap text-(--blue-text) underline underline-offset-2" @click="review">Review</button>
    <button type="button" class="flex-none cursor-pointer border-0 bg-transparent px-1 text-[12.5px] leading-4 font-medium whitespace-nowrap text-(--blue-text) hover:underline hover:underline-offset-2" @click="dismiss">Not now</button>
  </div>
</template>
