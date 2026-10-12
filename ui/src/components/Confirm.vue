<script setup lang="ts">
// A confirmation dialog as Sales OS's system dialogs draw it (SystemStates, STATES.md): sm 400px,
// 52px header with a 32px tone tile and the 15px title, one muted sentence in the body, a 56px
// footer with an optional mono code on the left, then Cancel and the action.
defineProps<{
  open: boolean;
  title: string;
  description: string;
  icon: string;
  tone: "danger" | "warn";
  action: string;
  busy?: boolean;
  disabled?: boolean;
  code?: string;
}>();
const emit = defineEmits<{ "update:open": [open: boolean]; confirm: [] }>();
</script>

<template>
  <UModal
    :open="open"
    :title="title"
    :description="description"
    :ui="{ content: 'w-[400px] max-w-[calc(100vw-32px)] rounded-xl bg-(--paper-raised) ring-0 shadow-[0_0_0_1px_var(--line),0_24px_60px_-12px_rgba(16,14,13,.28)] overflow-hidden', overlay: 'bg-[rgba(16,14,13,.48)]' }"
    @update:open="(o: boolean) => emit('update:open', o)"
  >
    <template #content>
      <div class="flex flex-col">
        <div class="flex h-[52px] flex-none items-center gap-3 pr-3 pl-5">
          <span aria-hidden="true" class="flex size-8 flex-none items-center justify-center rounded-lg" :style="tone === 'danger' ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : { background: 'var(--warn-soft)', color: 'var(--warn)' }"><UIcon :name="icon" class="size-4" /></span>
          <h3 class="m-0 min-w-0 flex-1 text-[15px] leading-5 font-semibold">{{ title }}</h3>
          <button type="button" class="wz-icon-btn" aria-label="Close" @click="emit('update:open', false)"><UIcon name="i-lucide-x" class="size-[15px]" /></button>
        </div>
        <div class="flex flex-col gap-3 px-5 pt-1 pb-4 text-[13px] leading-[18px]">
          <p class="m-0 text-(--ink-muted)">{{ description }}</p>
          <slot />
        </div>
        <div class="flex h-14 flex-none items-center gap-2 border-t border-(--row-line) px-5">
          <span v-if="code" class="font-mono text-[11px] leading-4 whitespace-nowrap text-(--line-strong)">{{ code }}</span>
          <span class="flex-1" />
          <UButton color="neutral" variant="outline" label="Cancel" @click="emit('update:open', false)" />
          <!-- The destructive button keeps its red and white text in the dark theme too. -->
          <UButton :color="tone === 'danger' ? 'error' : 'primary'" :ui="tone === 'danger' ? { base: 'bg-[#C2183A] text-white hover:bg-[#A8132F] disabled:bg-[#C2183A] aria-disabled:bg-[#C2183A]' } : undefined" :label="action" :loading="busy" :disabled="disabled" @click="emit('confirm')" />
        </div>
      </div>
    </template>
  </UModal>
</template>
