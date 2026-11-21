<script setup lang="ts">
import { computed } from 'vue'
import type { Machine, State } from '../domain/model'
import type { TopologyNode } from '../domain/topology'
import { routeHash } from '../presentation/route'
import { JACK_WIDTH, styleColor, type PlacedNode } from '../presentation/topologyLayout'
import OsIcon from './OsIcon.vue'
import StateBadge from './StateBadge.vue'

/**
 * One device on the topology: an HTML card at its ELK position. A Hosts machine links to its
 * tile on the Hosts page and shows a summary line; other devices show their ARP presence when
 * the router knows it. Switch-like devices draw their cabled ports as jacks on the edges.
 */
const props = defineProps<{
  node: TopologyNode
  placed: PlacedNode
  machine?: Machine | null
  /** ARP presence of a device that is not a Hosts machine. */
  presence?: 'up' | 'down' | null
}>()

const subtitle = computed(() => props.node.model || props.node.roleSlug || '')
const href = computed(() => (props.node.isMachine && props.machine ? routeHash('hosts', props.node.id) : null))

const state = computed<State | null>(() => props.machine?.state ?? props.presence ?? null)

const containerCount = computed(() => {
  const m = props.machine
  if (!m) return 0
  const inGuests = m.guests.reduce(
    (n, g) => n + g.standalone.length + g.stacks.reduce((k, s) => k + s.containers.length, 0),
    0,
  )
  return inGuests + m.apps.length
})

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const jacks = computed(() =>
  props.node.ports.map((port) => {
    const at = props.placed.ports.get(port.id) ?? { x: 0, y: 0 }
    return { port, x: at.x, north: port.side === 'NORTH', color: styleColor(port.style), kind: port.style.kind }
  }),
)
</script>

<template>
  <component
    :is="href ? 'a' : 'div'"
    :href="href ?? undefined"
    class="topo-card"
    :class="{ 'is-offline': node.offline, 'is-link': !!href, 'is-switch': node.switchLike }"
    :style="{ left: `${placed.x}px`, top: `${placed.y}px`, width: `${placed.width}px`, height: `${placed.height}px` }"
    :data-focus-device="node.id"
    :aria-label="href ? `${node.name}: show on the Hosts page` : undefined"
  >
    <div class="card-body" :class="{ 'has-north': node.switchLike && jacks.some((j) => j.north) }">
      <div class="card-title">
        <OsIcon :icon="node.icon" :label="node.platform" :size="18" :dim="node.offline" />
        <span class="card-name">{{ node.name }}</span>
        <StateBadge v-if="!machine && state" :state="state" variant="machine" class="card-state" />
      </div>
      <div class="card-meta">
        <span class="card-sub">{{ subtitle }}</span>
        <span v-if="node.ip" class="card-ip">{{ node.ip }}</span>
      </div>
      <div v-if="machine" class="card-summary">
        <StateBadge :state="machine.state" variant="machine" />
        <span>{{ plural(machine.guests.length, 'guest') }} · {{ plural(containerCount, 'container') }}</span>
        <span v-if="machine.metrics" class="card-load">
          CPU {{ machine.metrics.cpu.currentPct }} · MEM {{ machine.metrics.mem.currentPct }}
        </span>
      </div>
    </div>

    <template v-for="j in jacks" :key="j.port.id">
      <span
        v-if="node.switchLike"
        class="jack"
        :class="[`kind-${j.kind}`, j.north ? 'at-north' : 'at-south']"
        :style="{ left: `${j.x - JACK_WIDTH / 2}px`, '--jack-color': j.color }"
        :title="j.port.name"
      >
        <span class="jack-name">{{ j.port.name }}</span>
      </span>
      <span
        v-else
        class="entry"
        :class="j.north ? 'at-north' : 'at-south'"
        :style="{ left: `${j.x}px`, '--jack-color': j.color }"
        :title="j.port.name"
      ></span>
    </template>
  </component>
</template>

<style scoped>
.topo-card {
  position: absolute;
  box-sizing: border-box;
  display: block;
  border: 1px solid var(--color-border-guest);
  border-radius: var(--radius-lg);
  background: var(--color-bg-tile);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.topo-card.is-link {
  cursor: pointer;
}
.topo-card.is-link:hover,
.topo-card.is-link:focus-visible {
  border-color: var(--color-border-btn-hover);
  background: var(--color-bg-spine);
  outline: none;
}
.topo-card.is-link:hover .card-name,
.topo-card.is-link:focus-visible .card-name {
  color: var(--color-text-accent);
}
/* Dim the content, not the card: a focus outline on it stays bright. */
.topo-card.is-offline > * {
  opacity: 0.45;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 12px 0;
}
.card-body.has-north {
  padding-top: 26px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.card-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-host);
  transition: color 0.12s ease;
}

.card-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.35;
}
.card-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-model);
}
.card-ip {
  color: var(--color-text-secondary);
}

.card-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px 8px;
  margin-top: 3px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
}
.card-summary :deep(.variant-machine) {
  padding-left: 0;
}
.card-load {
  color: var(--color-text-pct);
}

/* Jack: a small socket centred on the card edge, its port name inside the card. */
.jack {
  position: absolute;
  width: 24px;
  height: 12px;
  box-sizing: border-box;
  border-radius: 3px;
  border: 1.5px solid var(--jack-color);
  background: color-mix(in oklch, var(--jack-color) 30%, var(--color-bg-page));
  z-index: 1;
}
.jack.at-south {
  bottom: -6px;
}
.jack.at-north {
  top: -6px;
}
.jack.kind-trunk {
  background: var(--color-bg-page);
}
.jack.kind-unknown {
  border-style: dashed;
  background: var(--color-bg-slot);
}
.jack-name {
  position: absolute;
  left: 50%;
  max-width: 50px;
  overflow: hidden;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  font-family: var(--font-mono);
  font-size: 9.5px;
  line-height: 1;
  white-space: nowrap;
  color: var(--color-text-dim);
  pointer-events: none;
}
.at-south .jack-name {
  bottom: calc(100% + 3px);
}
.at-north .jack-name {
  top: calc(100% + 3px);
}

/* Entry point of a cable on a device that is not switch-like. */
.entry {
  position: absolute;
  width: 6px;
  height: 6px;
  margin-left: -3px;
  border-radius: var(--radius-pill);
  background: var(--jack-color);
}
.entry.at-north {
  top: -3.5px;
}
.entry.at-south {
  bottom: -3.5px;
}

@media (prefers-reduced-motion: reduce) {
  .topo-card,
  .card-name {
    transition: none;
  }
}
</style>
