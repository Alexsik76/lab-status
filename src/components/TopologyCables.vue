<script setup lang="ts">
import { computed } from 'vue'
import type { TopologyEdge } from '../domain/topology'
import { cableWidth, roundedPath, styleColor, trunkWidths, type Point } from '../presentation/topologyLayout'
import { branchPoints, wavyPath } from '../presentation/wavy'

/** The cables under the cards: orthogonal ELK routes with rounded corners. */
const props = defineProps<{
  edges: readonly TopologyEdge[]
  routes: ReadonlyMap<string, Point[]>
  width: number
  height: number
  /** Hover trace: the traced cables (null when nothing is traced); drawn last, so on top. */
  traced?: ReadonlySet<string> | null
  /** Edges laid out but not drawn: the Wi-Fi lines of clients that are not connected now. */
  hidden?: ReadonlySet<string> | null
}>()

/** Wi-Fi line stroke. */
const WIFI_WIDTH = 1.5
/** Zigbee line: bead diameter and spacing. */
const ZIGBEE_BEAD = 3.4
const ZIGBEE_BEAD_GAP = 8

const cables = computed(() =>
  props.edges.flatMap((edge) => {
    const points = props.routes.get(edge.id)
    if (!points || props.hidden?.has(edge.id)) return []
    const route = points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')
    if (edge.medium === 'wifi') {
      return [{ edge, d: wavyPath(points), width: WIFI_WIDTH, core: 0, color: styleColor(edge.style), route }]
    }
    if (edge.medium === 'zigbee') {
      // Beads: round dots along the route (a dash of almost nothing, round caps).
      return [{ edge, d: roundedPath(points), width: ZIGBEE_BEAD, core: 0, color: styleColor(edge.style), route }]
    }
    const trunk = edge.style.kind === 'trunk' ? trunkWidths(edge.speed) : null
    const width = trunk ? trunk.outer : cableWidth(edge.speed)
    return [{ edge, d: roundedPath(points), width, core: trunk?.core ?? 0, color: styleColor(edge.style), route }]
  }),
)

/** Where the Wi-Fi lines of one radio port part ways after ELK merged them: a small dot. */
const branches = computed(() => {
  const bySource = new Map<string, { color: string; routes: Point[][] }>()
  for (const edge of props.edges) {
    if (edge.medium !== 'wifi' || props.hidden?.has(edge.id)) continue
    const points = props.routes.get(edge.id)
    if (!points) continue
    const entry = bySource.get(edge.source) ?? { color: styleColor(edge.style), routes: [] }
    entry.routes.push(points)
    bySource.set(edge.source, entry)
  }
  return [...bySource.entries()].flatMap(([source, { color, routes }]) =>
    branchPoints(routes).map((p, i) => ({ key: `${source}:${i}`, x: p.x, y: p.y, color })),
  )
})

/** Traced cables after the others: SVG paints in document order. */
const ordered = computed(() => {
  const t = props.traced
  if (!t?.size) return cables.value.map((c) => ({ ...c, isTraced: false }))
  const marked = cables.value.map((c) => ({ ...c, isTraced: t.has(c.edge.id) }))
  return [...marked.filter((c) => !c.isTraced), ...marked.filter((c) => c.isTraced)]
})
</script>

<template>
  <svg
    class="topo-cables"
    :class="{ 'is-tracing': !!traced?.size }"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    aria-hidden="true"
  >
    <g
      v-for="c in ordered"
      :key="c.edge.id"
      :class="[`cable kind-${c.edge.style.kind}`, `medium-${c.edge.medium ?? 'cable'}`, { 'is-traced': c.isTraced }]"
      :style="{ '--cable-color': c.color }"
      :data-cable="c.edge.id"
      :data-route="c.route"
    >
      <path
        :d="c.d"
        :stroke="c.color"
        :stroke-width="c.width"
        :stroke-dasharray="c.edge.medium === 'zigbee' ? `0.01 ${ZIGBEE_BEAD_GAP}` : undefined"
      />
      <path v-if="c.edge.style.kind === 'trunk' && !c.edge.medium?.match(/wifi|zigbee/)" :d="c.d" class="core" :stroke-width="c.core" />
    </g>
    <circle v-for="b in branches" :key="b.key" class="branch medium-wifi" :cx="b.x" :cy="b.y" r="2.4" :fill="b.color" />
  </svg>
</template>

<style scoped>
.topo-cables {
  position: absolute;
  inset: 0 auto auto 0;
  overflow: visible;
  pointer-events: none;
}
path {
  fill: none;
  stroke-linejoin: round;
}
.medium-wifi path,
.medium-zigbee path {
  stroke-linecap: round;
}
.core {
  stroke: var(--color-bg-page);
}

/* Hover trace: traced cables glow in their own colour, the others fade to 25 %. */
.cable {
  transition: opacity 0.15s ease, filter 0.15s ease;
}
.is-tracing .cable:not(.is-traced) {
  opacity: 0.25;
}
.cable.is-traced {
  filter: drop-shadow(0 0 3px var(--cable-color));
}
@media (prefers-reduced-motion: reduce) {
  .cable {
    transition: none;
  }
}
</style>
