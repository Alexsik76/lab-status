<script setup lang="ts">
import { computed } from 'vue'
import type { Machine, State } from '../domain/model'
import type { TopologyNode } from '../domain/topology'
import { routeHash } from '../presentation/route'
import {
  CARD_BORDER,
  CARD_LINE_HEIGHT,
  CARD_PADDING_Y,
  JACK_LABEL_GAP,
  JACK_NAME_MAX,
  JACK_SIZE,
  cardLines,
  drawsJack,
  jackBandHeight,
  portShape,
  titleBadge,
  styleColor,
  type PlacedNode,
} from '../presentation/topologyLayout'
import OsIcon from './OsIcon.vue'
import StateBadge from './StateBadge.vue'
import TopologyJack from './TopologyJack.vue'

/**
 * One device on the topology: an HTML card at its ELK position. A Hosts machine links to its
 * tile on the Hosts page, shows its state beside the name and a counts (and load) row; other
 * devices show their ARP presence beside the name when the router knows it. Switch-like devices draw their cabled ports as jacks on the edges.
 */
const props = defineProps<{
  node: TopologyNode
  placed: PlacedNode
  machine?: Machine | null
  /** ARP presence of a device that is not a Hosts machine. */
  presence?: 'up' | 'down' | null
  /** Hover trace: this device is the traced one or one of its neighbours. */
  traced?: boolean
  /** Hover trace: the ports at the ends of the traced cables (null when nothing is traced). */
  tracedPorts?: ReadonlySet<string> | null
  /** An access point of the Wi-Fi block: stays visible when the wired layer is grey. */
  anchor?: boolean
}>()

/**
 * Hover trace: pointing at the card (mouse or pen, not touch) or focusing it from the keyboard
 * asks the page to trace this device; leaving or blurring ends it. A tap only follows the link.
 */
const emit = defineEmits<{ trace: [deviceId: string | null] }>()
const onPointerEnter = (e: PointerEvent) => {
  if (e.pointerType !== 'touch') emit('trace', props.node.id)
}
const onFocusIn = (e: FocusEvent) => {
  const el = e.currentTarget as HTMLElement
  if (el.matches(':focus-visible')) emit('trace', props.node.id)
}
const endTrace = () => emit('trace', null)

const subtitle = computed(() => props.node.model || props.node.roleSlug || '')
const href = computed(() =>
  props.node.isMachine && props.machine ? routeHash('hosts', props.node.deviceId ?? props.node.id) : null,
)

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

/** The rows and paddings are the ones `cardSize` gave ELK: every row has its fixed height. */
const lines = computed(() => cardLines(props.node))
/** Full badge on wide cards; elsewhere the dot, so the name keeps its room. */
const badge = computed(() => titleBadge(props.placed.width))
const bodyStyle = computed(() => ({
  paddingTop: `${CARD_PADDING_Y + jackBandHeight(props.node, 'NORTH')}px`,
  paddingBottom: `${CARD_PADDING_Y + jackBandHeight(props.node, 'SOUTH')}px`,
}))
/** The NetBox device behind the card (a Wi-Fi client's own id is not one). */
const focusId = computed(() => props.node.deviceId ?? props.node.id)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const jacks = computed(() =>
  props.node.ports.map((port) => {
    const at = props.placed.ports.get(port.id) ?? { x: 0, y: 0 }
    const shape = portShape(port)
    const label = port.label ?? port.name
    const cut = label.indexOf(' · ')
    return {
      port,
      x: at.x,
      north: port.side === 'NORTH',
      color: styleColor(port.style),
      kind: port.style.kind,
      shape,
      size: JACK_SIZE[shape],
      jack: drawsJack(props.node, port),
      radio: port.kind === 'radio',
      off: !!port.off,
      label,
      // A radio label on two lines: SSID, then channel / off / down.
      lines: port.kind === 'radio' && cut > 0 ? [label.slice(0, cut), label.slice(cut + 3)] : [label],
    }
  }),
)
</script>

<template>
  <component
    :is="href ? 'a' : 'div'"
    :href="href ?? undefined"
    class="topo-card"
    :class="[
      `kind-${node.kind ?? 'device'}`,
      { 'is-offline': node.offline, 'is-link': !!href, 'is-switch': node.switchLike, 'is-traced': traced, 'is-anchor': anchor },
    ]"
    :style="{
      left: `${placed.x}px`,
      top: `${placed.y}px`,
      width: `${placed.width}px`,
      height: `${placed.height}px`,
      borderWidth: `${CARD_BORDER}px`,
    }"
    :data-focus-device="focusId"
    :data-node="node.id"
    :aria-label="href ? `${node.name}: show on the Hosts page` : undefined"
    @pointerenter="onPointerEnter"
    @pointerleave="endTrace"
    @mouseleave="endTrace"
    @focusin="onFocusIn"
    @focusout="endTrace"
  >
    <div class="card-body" :class="`body-${badge}`" :style="bodyStyle">
      <div
        v-for="line in lines"
        :key="line"
        class="card-line"
        :class="[`line-${line}`, line === 'title' ? `badge-${badge}` : '']"
        :style="{ height: `${CARD_LINE_HEIGHT[line]}px` }"
      >
        <template v-if="line === 'title'">
          <svg v-if="node.kind === 'zigbee-device'" class="zigbee-glyph" width="14" height="14" viewBox="0 0 14 14" aria-label="Zigbee">
            <path d="M3.5 4 H10.5 L3.5 10 H10.5" />
          </svg>
          <svg v-else-if="node.inFrame" class="wifi-glyph" width="14" height="14" viewBox="0 0 14 14" aria-label="Wi-Fi">
            <path d="M2.6 6.2 A6.2 6.2 0 0 1 11.4 6.2 M4.7 8.3 A3.2 3.2 0 0 1 9.3 8.3" />
            <circle cx="7" cy="10.6" r="1.2" />
          </svg>
          <OsIcon v-else :icon="node.icon" :label="node.platform" :size="18" :dim="node.offline" />
          <span class="card-name" :title="node.name">{{ node.name }}</span>
          <StateBadge
            v-if="node.isMachine || state"
            :state="state ?? 'unknown'"
            :variant="badge === 'full' ? 'machine' : 'dot'"
            class="card-state"
          />
        </template>
        <span v-else-if="line === 'sub'" class="card-text" :title="subtitle">{{ subtitle }}</span>
        <span v-else-if="line === 'ip'" class="card-text">{{ node.ip ?? '' }}</span>
        <span v-else-if="line === 'summary'" class="card-text">
          {{ machine ? `${plural(machine.guests.length, 'guest')} · ${plural(containerCount, 'container')}` : '—' }}
        </span>
        <span v-else-if="line === 'load'" class="card-text">
          CPU {{ machine?.metrics?.cpu.currentPct ?? '—' }} · MEM {{ machine?.metrics?.mem.currentPct ?? '—' }}
        </span>
      </div>
    </div>

    <template v-for="j in jacks" :key="j.port.id">
      <span
        v-if="j.jack"
        class="jack"
        :class="[`shape-${j.shape}`, j.north ? 'at-north' : 'at-south', { 'is-traced': tracedPorts?.has(j.port.id), 'is-off': j.off }]"
        :style="{
          left: `${j.x - j.size.width / 2}px`,
          [j.north ? 'top' : 'bottom']: `${-j.size.height / 2}px`,
          width: `${j.size.width}px`,
          height: `${j.size.height}px`,
          '--jack-color': j.color,
          '--jack-label-gap': `${JACK_LABEL_GAP}px`,
        }"
        :title="j.label"
        :data-port="j.port.id"
      >
        <TopologyJack :shape="j.shape" :kind="j.kind" :north="j.north" />
        <span v-if="!j.port.compact" class="jack-name" :class="{ 'is-radio': j.radio }" :style="{ maxWidth: `${JACK_NAME_MAX}px` }">
          <template v-for="(text, k) in j.lines" :key="k"><span class="jack-name-line">{{ text }}</span></template>
        </span>
      </span>
      <span
        v-else
        class="entry"
        :class="[j.north ? 'at-north' : 'at-south', { 'is-traced': tracedPorts?.has(j.port.id) }]"
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
  border-style: solid;
  border-color: var(--color-border-guest);
  border-radius: var(--radius-lg);
  background: var(--color-bg-tile);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.15s ease, background-color 0.15s ease, opacity 0.15s ease;
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
/*
 * Hover trace: the traced device and its neighbours get a brighter border, their traced jacks
 * glow and their port names stand out. The toning down of everything else is keyed on the
 * canvas's `.is-tracing` and lives in TopologyPage.
 */
.topo-card.is-traced {
  border-color: var(--color-text-dim);
}
.jack,
.entry {
  transition: opacity 0.15s ease, filter 0.15s ease;
}
.jack.is-traced {
  filter: drop-shadow(0 0 3px var(--jack-color));
}
.jack.is-traced .jack-name {
  color: var(--color-text-secondary);
  font-weight: 600;
}
.entry.is-traced {
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--jack-color) 45%, transparent);
}

/* Dim the content, not the card: a focus outline on it stays bright. */
.topo-card.is-offline > * {
  opacity: 0.45;
}

.card-body {
  box-sizing: border-box;
  height: 100%;
  padding-left: 12px;
  padding-right: 12px;
  display: flex;
  flex-direction: column;
}

/* One row of fixed height (see CARD_LINE_HEIGHT): nothing wraps, long text is cut. */
.card-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: none;
  overflow: hidden;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1;
}
.card-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wifi-glyph {
  flex: none;
  fill: none;
  stroke: var(--color-text-muted);
  stroke-width: 1.4;
  stroke-linecap: round;
}
.zigbee-glyph {
  flex: none;
  fill: none;
  stroke: var(--color-zigbee);
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.wifi-glyph circle {
  fill: var(--color-text-muted);
  stroke: none;
}
.card-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-host);
  transition: color 0.12s ease;
}
.line-sub {
  color: var(--color-text-model);
}
.line-ip {
  color: var(--color-text-secondary);
}
.line-summary {
  font-size: 10px;
  color: var(--color-text-muted);
}
.badge-full .card-state {
  margin-right: -6px;
}
/* Ordinary cards: the state is a dot; a slightly smaller name, tighter gaps and side padding
   leave room for a 16-character name (see FULL_BADGE_MIN_WIDTH). Heights are unchanged. */
.body-dot {
  padding-left: 10px;
  padding-right: 10px;
}
.badge-dot {
  gap: 5px;
}
.badge-dot .card-name {
  font-size: 15px;
}
.line-load {
  font-size: 10px;
  color: var(--color-text-pct);
}

/* Jack: a socket centred on the card edge (half outside), its port name inside the card. */
.jack {
  position: absolute;
  z-index: 1;
}
.jack-name {
  position: absolute;
  left: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  font-family: var(--font-mono);
  font-size: 9px;
  line-height: 1;
  white-space: nowrap;
  color: var(--color-text-dim);
  pointer-events: none;
}
.jack-name.is-radio {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}
.jack-name-line {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.jack.is-off {
  opacity: 0.45;
}
.at-south .jack-name {
  bottom: calc(100% + var(--jack-label-gap));
}
.at-north .jack-name {
  top: calc(100% + var(--jack-label-gap));
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
  .card-name,
  .jack,
  .entry {
    transition: none;
  }
}
</style>
