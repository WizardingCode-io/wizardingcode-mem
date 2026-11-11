<script setup lang="ts">
// A settings section, as Sales OS's Settings artboard: a header line (15px semibold title,
// the muted line beside it, anything on the right), then the body in a bordered card.
defineProps<{ id: string; title: string; description?: string; soon?: boolean; flush?: boolean }>();
</script>

<template>
  <section :id="`s-${id}`" class="flex scroll-mt-4 flex-col gap-2">
    <div class="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-0.5">
      <h2 class="wz-section-title">{{ title }}</h2>
      <!-- The description takes its own line where it cannot have 256px beside the title (a phone's width). -->
      <span v-if="description" class="min-w-0 flex-1 basis-64 text-[13px] leading-[18px] text-(--ink-muted)">{{ description }}</span>
      <span v-if="soon" class="wz-status" :style="{ background: 'var(--violet-soft)', color: 'var(--violet-text)' }">Soon</span>
      <slot name="aside" />
    </div>
    <div class="wz-table" :class="flush ? '' : 'p-4'"><slot /></div>
  </section>
</template>
