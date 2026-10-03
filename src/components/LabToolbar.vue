<script setup lang="ts">
import { useDateFormat } from '@vueuse/core'
import { computed } from 'vue'
import type { TreeCounts } from '../domain/model'
import LoadingSpinner from './LoadingSpinner.vue'

const props = defineProps<{
  refreshing: boolean
  updatedAt: Date | null
  counts: TreeCounts | null
}>()
defineEmits<{ refresh: [] }>()

const formattedTime = useDateFormat(() => props.updatedAt ?? undefined, 'ddd D MMM YYYY · HH:mm:ss')
const shortTime = useDateFormat(() => props.updatedAt ?? undefined, 'HH:mm:ss')

const summary = computed(() => {
  const c = props.counts
  if (!c) return null
  const stopped = c.stoppedGuests ? ` (${c.stoppedGuests} stopped)` : ''
  return `${c.machines} machines · ${c.guests} guests${stopped} · ${c.containers} containers`
})
</script>

<template>
  <header class="toolbar">
    <div class="toolbar-left">
      <span class="homelab-title">homelab</span>
      <span v-if="summary" class="homelab-counts">{{ summary }}</span>
    </div>

    <div class="toolbar-right">
      <button
        type="button"
        class="refresh-btn"
        :disabled="refreshing"
        @click="$emit('refresh')"
      >
        <LoadingSpinner v-if="refreshing" />
        <svg
          v-else
          class="refresh-icon"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
        </svg>
        <span>Refresh</span>
      </button>

      <span v-if="updatedAt" class="timestamp">
        rendered {{ formattedTime }}
      </span>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text-dim);
}

.toolbar-left {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
}

.homelab-title {
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-text-title);
}

.homelab-counts {
  color: var(--color-text-muted);
  font-size: 12px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-bg-spine);
  border: 1px solid var(--color-border-guest);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  color: var(--color-text-title);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--color-bg-hover-dim);
  border-color: var(--color-border-btn-hover);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-icon {
  display: block;
}

.timestamp {
  white-space: nowrap;
}
</style>
