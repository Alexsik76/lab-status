<script setup lang="ts">
import { useDateFormat } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import type { SourceName, SourceStatuses } from '../composables/useSourceStatuses'
import { SOURCE_NAMES } from '../composables/useSourceStatuses'
import type { StreamState } from '../composables/useEventStream'
import { ageSeconds, bitCount, CLOCK_RED, clockColor, formatAge, rgb, toBits } from '../presentation/clock'

/**
 * The header's refresh block: one button, the binary clock on top and the local time of the
 * last inventory update (HH:MM:SS) below; as tall as the Hosts | ARP switch.
 *
 * The clock is the age in whole seconds of the NetBox inventory (what Refresh re-reads),
 * counting up, one diamond per bit, most significant left. The colour of the lit bits goes
 * green -> yellow -> orange-red over the inventory period; any source in error turns them
 * orange-red. It ticks once per second and stops while the stream is paused. The tooltip
 * starts with the full date and time, then one line per source.
 */
const props = defineProps<{
  statuses: Readonly<SourceStatuses>
  streamState: StreamState
  refreshing?: boolean
  /** The inventory's time as the page knows it (also from local storage, before the stream). */
  updatedAt?: Date | null
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
  wifi: 'Wi-Fi',
  zigbee: 'Zigbee',
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
/** The inventory source's own time when it has reported, else the page's stored one. */
const updated = computed<Date | null>(() => {
  const at = inventory.value?.updatedAt
  return at ? new Date(at) : (props.updatedAt ?? null)
})
const time = useDateFormat(() => updated.value ?? undefined, 'HH:mm:ss')
const fullTime = useDateFormat(() => updated.value ?? undefined, 'ddd D MMM YYYY · HH:mm:ss')
const label = computed(() => {
  if (age.value === null) return 'Refresh, data age unknown'
  return updated.value ? `Refresh, data ${age.value} s old, updated ${time.value}` : `Refresh, data ${age.value} s old`
})

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

/*
 * One inline SVG, drawn 1:1 so the outlines stay crisp: a diamond per bit (half-diagonal 3 px,
 * centres 7 px apart, most significant left), vertically centred in a 12 px tall box, with a
 * 0.5 px margin so no outline is clipped.
 */
const HALF = 3
const STEP = 7
const BOX_HEIGHT = 12
const MARGIN = 0.5
const geometry = computed(() => {
  const inner = 2 * HALF + STEP * (bits.value.length - 1)
  const width = inner + 2 * MARGIN
  const height = BOX_HEIGHT + 2 * MARGIN
  return { width, height, viewBox: `${-MARGIN} ${-MARGIN} ${width} ${height}` }
})
function diamond(i: number): string {
  const cx = HALF + STEP * i
  const cy = BOX_HEIGHT / 2
  return `${cx},${cy - HALF} ${cx + HALF},${cy} ${cx},${cy + HALF} ${cx - HALF},${cy}`
}

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
      <svg
        class="bits"
        :width="geometry.width"
        :height="geometry.height"
        :viewBox="geometry.viewBox"
        aria-hidden="true"
        focusable="false"
      >
        <polygon
          v-for="(lit, i) in bits"
          :key="i"
          class="bit"
          :class="{ lit }"
          :points="diamond(i)"
          :fill="lit ? color : 'none'"
          :stroke="lit ? color : undefined"
          :data-bit="bits.length - 1 - i"
        />
      </svg>
      <span class="updated-time">{{ updated ? time : '--:--:--' }}</span>
    </button>
    <span :id="tipId" class="tip" role="tooltip">
      <span class="tip-when">{{ updated ? fullTime : 'Inventory not loaded yet' }}</span>
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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  box-sizing: border-box;
  height: var(--header-control-height);
  padding: 0 10px;
  background: var(--color-bg-slot);
  border: 1px solid var(--color-border-guest);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color 0.18s ease;
}
.refresh-btn:hover:not(:disabled) {
  background: var(--color-bg-control-hover);
}
.refresh-btn:focus-visible {
  outline: 1px solid var(--color-border-btn-hover);
  outline-offset: 1px;
}
.refresh-btn:disabled {
  opacity: 0.6;
  cursor: progress;
}

.updated-time {
  display: block;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 11px;
  letter-spacing: 0.02em;
  color: var(--color-text-dim);
  font-variant-numeric: tabular-nums;
}

.bits {
  display: block;
  flex: none;
}
.bit {
  stroke-width: 0.9;
  stroke-linejoin: miter;
  transition: fill 0.3s ease, stroke 0.3s ease;
}
.bit:not(.lit) {
  stroke: var(--color-state-unknown-dot);
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
.tip-name,
.tip-when {
  color: var(--color-text-title);
}
.tip-when {
  margin-bottom: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .refresh-btn,
  .bit,
  .tip {
    transition: none;
  }
}
</style>
