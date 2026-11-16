<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import type { SourceName, SourceStatuses } from '../composables/useSourceStatuses'
import { SOURCE_NAMES } from '../composables/useSourceStatuses'
import type { StreamState } from '../composables/useEventStream'
import { ageSeconds, bitCount, CLOCK_RED, clockColor, formatAge, rgb, toBits } from '../presentation/clock'

/**
 * Refresh button drawn as a binary clock: the age in whole seconds of the NetBox inventory
 * (what Refresh re-reads), counting up, one square per bit, most significant left. The colour
 * of the lit bits goes green -> yellow -> orange-red over the inventory period; any source in
 * error turns them orange-red. It ticks once per second and stops while the stream is paused.
 */
const props = defineProps<{
  statuses: Readonly<SourceStatuses>
  streamState: StreamState
  refreshing?: boolean
}>()
defineEmits<{ refresh: [] }>()

const DEFAULT_PERIOD_S = 300
const LABELS: Record<SourceName, string> = {
  inventory: 'NetBox inventory',
  services: 'Service checks',
  proxmox: 'Proxmox',
  metrics: 'Proxmox graphs',
  containers: 'Containers',
  arp: 'ARP',
}
const STREAMING: ReadonlySet<SourceName> = new Set(['containers', 'arp'])

const now = ref(Date.now())
const paused = computed(() => props.streamState === 'paused')
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    if (!paused.value) now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer)
})
watch(paused, (isPaused) => {
  if (!isPaused) now.value = Date.now()
})

const inventory = computed(() => props.statuses.inventory)
const periodS = computed(() => inventory.value?.periodS || DEFAULT_PERIOD_S)
const age = computed(() => ageSeconds(inventory.value?.updatedAt, now.value))
const bits = computed(() => toBits(age.value ?? 0, bitCount(periodS.value)))
const anyError = computed(() => SOURCE_NAMES.some((name) => props.statuses[name]?.state === 'error'))
const color = computed(() =>
  rgb(anyError.value ? CLOCK_RED : clockColor((age.value ?? 0) / periodS.value)),
)
const label = computed(() =>
  age.value === null ? 'Refresh, data age unknown' : `Refresh, data ${age.value} s old`,
)

const lines = computed(() =>
  SOURCE_NAMES.map((name) => {
    const status = props.statuses[name]
    let text: string
    if (!status) text = 'no data yet'
    else if (STREAMING.has(name)) text = paused.value ? 'paused' : status.state === 'live' ? 'live' : status.state
    else {
      const seconds = ageSeconds(status.updatedAt, now.value)
      text = seconds === null ? status.state : formatAge(seconds)
    }
    return { name, label: LABELS[name], text, error: status?.error ?? null }
  }),
)

const tipId = useId()
</script>

<template>
  <span class="refresh-clock">
    <button
      type="button"
      class="refresh-btn"
      :class="{ 'has-error': anyError }"
      :disabled="refreshing"
      :aria-busy="refreshing ? 'true' : 'false'"
      :aria-label="label"
      :aria-describedby="tipId"
      :style="{ '--bit-color': color }"
      @click="$emit('refresh')"
    >
      <span
        v-for="(lit, i) in bits"
        :key="i"
        class="bit"
        :class="{ lit }"
        :data-bit="bits.length - 1 - i"
      ></span>
    </button>
    <span :id="tipId" class="tip" role="tooltip">
      <span v-for="line in lines" :key="line.name" class="tip-line" :data-source="line.name">
        <span class="tip-name">{{ line.label }}</span> {{ line.text }}<template v-if="line.error"> · {{ line.error }}</template>
      </span>
    </span>
  </span>
</template>

<style scoped>
.refresh-clock {
  position: relative;
  display: inline-flex;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 5px 7px;
  background: var(--color-bg-spine);
  border: 1px solid var(--color-border-guest);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.refresh-btn:hover:not(:disabled) {
  background: var(--color-bg-hover-dim);
  border-color: var(--color-border-btn-hover);
}
.refresh-btn:focus-visible {
  outline: 1px solid var(--color-border-btn-hover);
  outline-offset: 1px;
}
.refresh-btn:disabled {
  opacity: 0.6;
  cursor: progress;
}

.bit {
  display: block;
  flex: none;
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  border: 1px solid var(--color-state-unknown-dot);
  border-radius: 1px;
  background: transparent;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}
.bit.lit {
  background: var(--bit-color);
  border-color: var(--bit-color);
}

.tip {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: max-content;
  max-width: 360px;
  padding: 6px 9px;
  border: 1px solid var(--color-border-btn-hover);
  border-radius: var(--radius-sm);
  background: var(--color-bg-spine);
  box-shadow: 0 4px 14px oklch(0 0 0 / 0.35);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.4;
  text-align: left;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.refresh-clock:hover .tip,
.refresh-clock:focus-within .tip {
  opacity: 1;
}
.tip-name {
  color: var(--color-text-title);
}

@media (prefers-reduced-motion: reduce) {
  .refresh-btn,
  .bit,
  .tip {
    transition: none;
  }
}
</style>
