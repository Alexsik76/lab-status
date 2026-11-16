<script setup lang="ts">
import { useDateFormat } from '@vueuse/core'
import { computed } from 'vue'
import type { ArpPhase } from '../composables/useArp'
import type { TreeCounts } from '../domain/model'
import LoadingSpinner from './LoadingSpinner.vue'

export type Page = 'hosts' | 'arp'

const props = defineProps<{
  page: Page
  counts: TreeCounts | null
  /** Hosts page: refresh button and time of the last render. */
  refreshing: boolean
  updatedAt: Date | null
  /** ARP page: state of the live stream; badge: entries that stopped answering. */
  arpPhase: ArpPhase
  arpDisconnected: number
}>()
defineEmits<{ refresh: [] }>()

const formattedTime = useDateFormat(() => props.updatedAt ?? undefined, 'ddd D MMM YYYY · HH:mm:ss')

const summary = computed(() => {
  const c = props.counts
  if (!c) return null
  const stopped = c.stoppedGuests ? ` (${c.stoppedGuests} stopped)` : ''
  return `${c.machines} machines · ${c.guests} guests${stopped} · ${c.containers} containers`
})

const badgeTip = computed(() => {
  const n = props.arpDisconnected
  return `${n} ${n === 1 ? 'address does' : 'addresses do'} not answer: ARP status failed or incomplete`
})

const liveText = computed(() =>
  props.arpPhase === 'live' ? 'live' : props.arpPhase === 'loading' ? 'connecting…' : 'offline',
)
</script>

<template>
  <header class="app-header">
    <div class="header-left">
      <span class="homelab-title">homelab</span>
      <span v-if="summary" class="homelab-counts">{{ summary }}</span>
    </div>

    <nav class="page-switch" :class="`on-${page}`" aria-label="Pages">
      <span class="switch-thumb" aria-hidden="true"></span>
      <a href="#/" class="switch-item" :class="{ 'is-active': page === 'hosts' }" :aria-current="page === 'hosts' ? 'page' : undefined">
        Hosts
      </a>
      <a href="#/arp" class="switch-item" :class="{ 'is-active': page === 'arp' }" :aria-current="page === 'arp' ? 'page' : undefined">
        ARP
        <Transition name="badge">
          <span v-if="arpDisconnected > 0" class="switch-badge" tabindex="0" aria-describedby="arp-badge-tip">
            {{ arpDisconnected }}
            <span id="arp-badge-tip" class="badge-tip" role="tooltip">{{ badgeTip }}</span>
          </span>
        </Transition>
      </a>
    </nav>

    <div class="header-right">
      <template v-if="page === 'hosts'">
        <button type="button" class="refresh-btn" :disabled="refreshing" @click="$emit('refresh')">
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
        <span v-if="updatedAt" class="timestamp">rendered {{ formattedTime }}</span>
      </template>
      <span v-else class="arp-live" :class="`phase-${arpPhase}`">
        <span class="live-dot"></span>{{ liveText }}
      </span>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  grid-template-areas: 'left switch right';
  align-items: center;
  gap: 10px 16px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text-dim);
}

.header-left {
  grid-area: left;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 14px;
  min-width: 0;
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

/* Hosts | ARP: two equal halves, a thumb slides under the active one. */
.page-switch {
  grid-area: switch;
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--color-border-guest);
  border-radius: var(--radius-md);
  background: var(--color-bg-slot);
}

.switch-thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 4px);
  border-radius: var(--radius-sm);
  background: var(--color-bg-hover);
  box-shadow: inset 0 0 0 1px var(--color-border-btn-hover);
  transition: transform 0.22s cubic-bezier(0.3, 0.7, 0.3, 1);
}
.on-arp .switch-thumb {
  transform: translateX(calc(100% + 2px));
}

.switch-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 92px;
  padding: 5px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  letter-spacing: 0.03em;
  color: var(--color-text-muted);
  transition: color 0.18s ease, background-color 0.18s ease;
}
.switch-item:hover:not(.is-active) {
  color: var(--color-text-secondary);
  background: oklch(0.21 0.01 250);
}
.switch-item.is-active,
.switch-item.is-active:hover {
  color: var(--color-text-host);
}
.switch-item:focus-visible {
  outline: 1px solid var(--color-border-btn-hover);
  outline-offset: 1px;
}

.switch-badge {
  min-width: 16px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  background: oklch(0.62 0.22 27 / 0.2);
  color: oklch(0.78 0.14 27);
  position: relative;
  cursor: help;
}
.switch-badge:focus-visible {
  outline: 1px solid oklch(0.78 0.14 27 / 0.6);
  outline-offset: 1px;
}

/* Tooltip under the badge: fades in after a short pause, like the rest of the motion here. */
.badge-tip {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  z-index: 10;
  width: max-content;
  max-width: 260px;
  padding: 6px 9px;
  border: 1px solid var(--color-border-btn-hover);
  border-radius: var(--radius-sm);
  background: var(--color-bg-spine);
  box-shadow: 0 4px 14px oklch(0 0 0 / 0.35);
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 1.4;
  letter-spacing: 0;
  text-align: left;
  white-space: normal;
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, -3px);
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.switch-badge:hover .badge-tip,
.switch-badge:focus-visible .badge-tip {
  opacity: 1;
  transform: translate(-50%, 0);
  transition-delay: 0.25s;
}

.badge-enter-active,
.badge-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.badge-enter-from,
.badge-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

.header-right {
  grid-area: right;
  justify-self: end;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 6px 14px;
  min-width: 0;
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
  transition: background-color 0.15s ease, border-color 0.15s ease;
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

.arp-live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-dim);
}
.live-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  box-sizing: border-box;
  border: 1.5px dashed var(--color-state-unknown-dot);
}
.phase-live { color: var(--color-state-up); }
.phase-live .live-dot { background: var(--color-state-up); border: none; }
.phase-failed { color: var(--color-state-down); }
.phase-failed .live-dot { background: var(--color-state-down); border: none; }

/* Narrow screens: the switch takes its own full-width row. */
@media (max-width: 900px) {
  .app-header {
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'left right'
      'switch switch';
  }
  .page-switch {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .switch-thumb,
  .switch-item,
  .refresh-btn,
  .badge-enter-active,
  .badge-leave-active,
  .badge-tip {
    transition: none;
  }
}
</style>
