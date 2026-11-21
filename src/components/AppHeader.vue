<script setup lang="ts">
import { computed } from 'vue'
import type { ArpPhase } from '../composables/useArp'
import type { TreeCounts } from '../domain/model'
import type { StreamState } from '../composables/useEventStream'
import type { SourceStatuses } from '../composables/useSourceStatuses'
import type { Page } from '../presentation/route'
import HoverTip from './HoverTip.vue'
import RefreshClock from './RefreshClock.vue'

export type { Page } from '../presentation/route'

const props = withDefaults(
  defineProps<{
    page: Page
    counts: TreeCounts | null
    /** Hosts and Topology pages: the refresh block (clock fed by the sources' status events, time of the inventory). */
    refreshing: boolean
    updatedAt: Date | null
    statuses?: SourceStatuses
    streamState?: StreamState
    /** ARP page: state of the live stream; badge: entries that stopped answering. */
    arpPhase: ArpPhase
    arpDisconnected: number
  }>(),
  { statuses: () => ({}), streamState: 'idle' },
)
defineEmits<{ refresh: [] }>()

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
      <a href="#/topology" class="switch-item" :class="{ 'is-active': page === 'topology' }" :aria-current="page === 'topology' ? 'page' : undefined">
        Topology
      </a>
      <a href="#/arp" class="switch-item" :class="{ 'is-active': page === 'arp' }" :aria-current="page === 'arp' ? 'page' : undefined">
        ARP
        <Transition name="badge">
          <HoverTip v-if="arpDisconnected > 0" :text="badgeTip" class="switch-badge">{{ arpDisconnected }}</HoverTip>
        </Transition>
      </a>
    </nav>

    <div class="header-right">
      <template v-if="page !== 'arp'">
        <RefreshClock
          :statuses="statuses"
          :stream-state="streamState"
          :refreshing="refreshing"
          :updated-at="updatedAt"
          @refresh="$emit('refresh')"
        />
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

/* Hosts | Topology | ARP: three equal parts, a thumb slides under the active one. */
.page-switch {
  grid-area: switch;
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 2px;
  box-sizing: border-box;
  height: var(--header-control-height);
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
  /* (padding box - 2 x 3px padding - 2 x 2px gaps) / 3 */
  width: calc((100% - 10px) / 3);
  border-radius: var(--radius-sm);
  background: var(--color-bg-hover);
  box-shadow: inset 0 0 0 1px var(--color-border-btn-hover);
  transition: transform 0.22s cubic-bezier(0.3, 0.7, 0.3, 1);
}
.on-topology .switch-thumb {
  transform: translateX(calc(100% + 2px));
}
.on-arp .switch-thumb {
  transform: translateX(calc(200% + 4px));
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
  background: var(--color-bg-control-hover);
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
  .badge-enter-active,
  .badge-leave-active {
    transition: none;
  }
}
</style>
