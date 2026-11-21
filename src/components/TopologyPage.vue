<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, ref } from 'vue'
import type { ArpPresenceIndex } from '../domain/arp'
import { arpObjectKey } from '../domain/arp'
import type { DeviceRecord, Machine } from '../domain/model'
import { buildTopologyGraph } from '../domain/topology'
import type { RawTopology } from '../types/topology'
import { useTopologyLayout } from '../composables/useTopologyLayout'
import { fitScale, speedTag } from '../presentation/topologyLayout'
import LoadingSpinner from './LoadingSpinner.vue'
import NoticeBanner from './NoticeBanner.vue'
import TopologyCables from './TopologyCables.vue'
import TopologyCard from './TopologyCard.vue'
import TopologyLegend from './TopologyLegend.vue'

/**
 * The physical network from NetBox cabling, laid out by ELK: an SVG layer of cables under
 * absolutely positioned HTML cards. Loaded as a separate chunk together with elkjs.
 */
const props = defineProps<{
  /** NetBox cabling with the page's devices; null while it has not arrived yet. */
  topology: { data: RawTopology; devices: readonly DeviceRecord[]; machineIds: ReadonlySet<string> } | null
  /** Hosts machines by device id, for the summary line and the link back. */
  machines: ReadonlyMap<string, Machine>
  presence: ArpPresenceIndex
  /** Set when there is no topology and none is coming (it could not be read). */
  unavailable?: string | null
}>()

/** Rebuilt only with the inventory; live states reach the cards through `machines` and `presence`. */
const graph = computed(() =>
  props.topology ? buildTopologyGraph(props.topology.data, props.topology.devices, props.topology.machineIds) : null,
)
const { placement, phase, error } = useTopologyLayout(graph)

const viewport = ref<HTMLElement | null>(null)
const { width: viewportWidth } = useElementSize(viewport)
const scale = computed(() => fitScale(viewportWidth.value, placement.value?.width ?? 0))

const isEmpty = computed(() => graph.value !== null && graph.value.edges.length === 0)

const cards = computed(() => {
  const g = graph.value
  const p = placement.value
  if (!g || !p) return []
  return g.nodes.flatMap((node) => {
    const placed = p.nodes.get(node.id)
    if (!placed) return []
    const machine = node.isMachine ? (props.machines.get(node.id) ?? null) : null
    const presence = machine ? null : (props.presence.get(arpObjectKey('device', node.id)) ?? null)
    return [{ node, placed, machine, presence }]
  })
})

/** A speed tag at the lower end of every cable that is not 1G. */
const tags = computed(() => {
  const g = graph.value
  const p = placement.value
  if (!g || !p) return []
  return g.edges.flatMap((edge) => {
    const text = speedTag(edge.speed)
    const points = p.edges.get(edge.id)
    if (!text || !points) return []
    const end = points[points.length - 1]
    return [{ id: edge.id, text, x: end.x, y: end.y }]
  })
})
</script>

<template>
  <section class="topology-page">
    <NoticeBanner v-if="phase === 'failed'">The topology could not be laid out. {{ error }}</NoticeBanner>

    <p v-if="!graph && unavailable" class="empty-state">Topology data is unavailable. {{ unavailable }}</p>
    <p v-else-if="isEmpty" class="empty-state">NetBox has no connected cables between device interfaces.</p>
    <div v-else-if="!placement" class="topo-loading" aria-busy="true">
      <LoadingSpinner /> <span>Laying out the topology…</span>
    </div>

    <template v-else-if="graph">
      <TopologyLegend
        class="topo-legend-corner"
        :vlans="graph.vlans"
        :has-trunk="graph.hasTrunk"
        :has-unknown="graph.hasUnknown"
        :speeds="graph.speeds"
      />
      <div ref="viewport" class="topo-viewport">
        <div class="topo-sizer" :style="{ width: `${placement.width * scale}px`, height: `${placement.height * scale}px` }">
          <div
            class="topo-canvas"
            :style="{ width: `${placement.width}px`, height: `${placement.height}px`, transform: `scale(${scale})` }"
          >
            <TopologyCables :edges="graph.edges" :routes="placement.edges" :width="placement.width" :height="placement.height" />
            <TopologyCard
              v-for="c in cards"
              :key="c.node.id"
              :node="c.node"
              :placed="c.placed"
              :machine="c.machine"
              :presence="c.presence"
            />
            <span v-for="t in tags" :key="t.id" class="speed-tag" :style="{ left: `${t.x + 5}px`, top: `${t.y - 8}px` }">
              {{ t.text }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.topology-page {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.topo-viewport {
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}
.topo-sizer {
  position: relative;
  margin: 0 auto;
}
.topo-canvas {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

.topo-legend-corner {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
}

/* Narrow screens: the legend takes its own row instead of covering the diagram. */
@media (max-width: 900px) {
  .topo-legend-corner {
    position: static;
    align-self: flex-end;
  }
}

.speed-tag {
  position: absolute;
  transform: translateY(-100%);
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: var(--color-bg-page);
  font-family: var(--font-mono);
  font-size: 9.5px;
  line-height: 13px;
  color: var(--color-text-secondary);
  pointer-events: none;
}

.topo-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 24px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text-dim);
}

.empty-state {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text-dim);
  padding: 24px;
  text-align: center;
  background: var(--color-bg-tile);
  border: 1px dashed var(--color-border-dashed);
  border-radius: var(--radius-lg);
}
</style>
