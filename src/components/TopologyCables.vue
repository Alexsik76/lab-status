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
</script>

<template>
  <svg class="topo-cables" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
    <g v-for="c in cables" :key="c.edge.id" :class="`cable kind-${c.edge.style.kind}`">
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
</style>
