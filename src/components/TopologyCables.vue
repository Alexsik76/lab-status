<script setup lang="ts">
import { computed } from 'vue'
import type { TopologyEdge } from '../domain/topology'
import { cableWidth, roundedPath, styleColor, trunkWidths, type Point } from '../presentation/topologyLayout'

/** The cables under the cards: orthogonal ELK routes with rounded corners. */
const props = defineProps<{
  edges: readonly TopologyEdge[]
  routes: ReadonlyMap<string, Point[]>
  width: number
  height: number
  /** Hover trace: the traced cables (null when nothing is traced); drawn last, so on top. */
  traced?: ReadonlySet<string> | null
}>()

const cables = computed(() =>
  props.edges.flatMap((edge) => {
    const points = props.routes.get(edge.id)
    if (!points) return []
    const trunk = edge.style.kind === 'trunk' ? trunkWidths(edge.speed) : null
    const width = trunk ? trunk.outer : cableWidth(edge.speed)
    return [{ edge, d: roundedPath(points), width, core: trunk?.core ?? 0, color: styleColor(edge.style) }]
  }),
)

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
      :class="[`cable kind-${c.edge.style.kind}`, { 'is-traced': c.isTraced }]"
      :style="{ '--cable-color': c.color }"
      :data-cable="c.edge.id"
    >
      <path :d="c.d" :stroke="c.color" :stroke-width="c.width" />
      <path v-if="c.edge.style.kind === 'trunk'" :d="c.d" class="core" :stroke-width="c.core" />
    </g>
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
