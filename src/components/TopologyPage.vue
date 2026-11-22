<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import type { ArpPresenceIndex } from '../domain/arp'
import { arpObjectKey } from '../domain/arp'
import type { DeviceRecord, Machine } from '../domain/model'
import { buildTopologyGraph, traceOf } from '../domain/topology'
import type { RawTopology } from '../types/topology'
import { useTopologyLayout } from '../composables/useTopologyLayout'
import { JACK_SIZE, fitScale, jackShape, speedTag } from '../presentation/topologyLayout'
import LoadingSpinner from './LoadingSpinner.vue'
import NoticeBanner from './NoticeBanner.vue'
import TopologyCables from './TopologyCables.vue'
import TopologyCard from './TopologyCard.vue'
import TopologyGroups from './TopologyGroups.vue'
import TopologyLayerSwitch from './TopologyLayerSwitch.vue'
import TopologyLegend from './TopologyLegend.vue'
import TopologyWifi from './TopologyWifi.vue'
import { buildWifiGrid } from '../domain/wifi'
import { loadLayerStates, saveLayerStates, type LayerId, type LayerState } from '../presentation/layers'
import type { WifiData } from '../types/wifi'

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
  /** The router's wireless networks (`wifi` source); null until the first snapshot. */
  wifi?: WifiData | null
  /** Why there is no Wi-Fi data (the source's error), if so. */
  wifiError?: string | null
}>()

/** Rebuilt only with the inventory; live states reach the cards through `machines` and `presence`. */
/**
 * Machines with Proxmox metrics (their cards have a load line). A string, so the graph is
 * rebuilt, and laid out again, only when the set changes, not on every metrics event.
 */
const metricKey = computed(() =>
  [...props.machines.values()]
    .filter((m) => m.metrics)
    .map((m) => m.id)
    .sort()
    .join(','),
)
const graph = computed(() => {
  if (!props.topology) return null
  const metricIds = new Set(metricKey.value ? metricKey.value.split(',') : [])
  return buildTopologyGraph(props.topology.data, props.topology.devices, props.topology.machineIds, metricIds)
})
const { placement, phase, error } = useTopologyLayout(graph)

const viewport = ref<HTMLElement | null>(null)
const { width: viewportWidth } = useElementSize(viewport)
const scale = computed(() => fitScale(viewportWidth.value, placement.value?.width ?? 0))

/**
 * Hover trace: the one device being pointed at (or focused from the keyboard). Its cables,
 * neighbours and their ports are emphasised, the rest toned down.
 */
const tracedId = ref<string | null>(null)
/** The access point traced together with it: its column in the Wi-Fi block. */
const tracedApId = ref<string | null>(null)
const trace = computed(() => (graph.value && tracedId.value ? traceOf(graph.value, tracedId.value) : null))
const onTrace = (deviceId: string | null) => {
  tracedId.value = deviceId
  tracedApId.value = deviceId ? (props.wifi?.aps.find((ap) => ap.deviceId === deviceId)?.id ?? null) : null
}
/** From the Wi-Fi block: a column header or chip traces its access point's card. */
const onApTrace = (apId: string | null) => {
  tracedApId.value = apId
  const deviceId = apId ? (props.wifi?.aps.find((ap) => ap.id === apId)?.deviceId ?? null) : null
  tracedId.value = deviceId && graph.value?.nodes.some((n) => n.id === deviceId) ? deviceId : null
}

/** Layers: Wired and Wi-Fi, each shown / grey / hidden, remembered in local storage. */
const layers = ref(loadLayerStates())
watch(layers, (states) => saveLayerStates(states), { deep: true })
const onLayer = (id: LayerId, state: LayerState) => {
  layers.value = { ...layers.value, [id]: state }
}

/** Access-point cards stay fully visible when the wired layer is grey: anchors for Wi-Fi. */
const apDeviceIds = computed(() => new Set((props.wifi?.aps ?? []).flatMap((ap) => (ap.deviceId ? [ap.deviceId] : []))))

const wifiGrid = computed(() => {
  if (!props.wifi) return null
  const p = placement.value
  return buildWifiGrid(props.wifi, (deviceId) => p?.nodes.get(deviceId)?.x)
})

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
  const nodes = new Map(g.nodes.map((n) => [n.id, n]))
  return g.edges.flatMap((edge) => {
    const text = speedTag(edge.speed)
    const points = p.edges.get(edge.id)
    if (!text || !points) return []
    const end = points[points.length - 1]
    // Beside the jack the cable ends in (a dot on other devices).
    const target = nodes.get(edge.targetDevice)
    const port = target?.switchLike ? target.ports.find((q) => q.id === edge.target) : undefined
    const dx = port ? JACK_SIZE[jackShape(port.type)].width / 2 + 3 : 5
    return [{ id: edge.id, text, x: end.x + dx, y: end.y }]
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
      <div class="topo-legend-corner">
        <TopologyLayerSwitch :states="layers" @change="onLayer" />
        <TopologyLegend
          :vlans="graph.vlans"
          :has-trunk="graph.hasTrunk"
          :has-unknown="graph.hasUnknown"
          :speeds="graph.speeds"
          :wifi="layers.wifi !== 'hidden'"
        />
      </div>
      <div ref="viewport" class="topo-viewport">
        <div class="topo-sizer" :style="{ width: `${placement.width * scale}px`, height: `${placement.height * scale}px` }">
          <div
            class="topo-canvas"
            :class="[{ 'is-tracing': !!trace }, `layer-wired-${layers.wired}`]"
            :style="{ width: `${placement.width}px`, height: `${placement.height}px`, transform: `scale(${scale})` }"
          >
            <TopologyGroups part="frame" :groups="placement.groups" :vlans="graph.vlans" />
            <TopologyCables
              :edges="graph.edges"
              :routes="placement.edges"
              :width="placement.width"
              :height="placement.height"
              :traced="trace?.edgeIds ?? null"
            />
            <TopologyCard
              v-for="c in cards"
              :key="c.node.id"
              :node="c.node"
              :placed="c.placed"
              :machine="c.machine"
              :presence="c.presence"
              :traced="trace?.nodeIds.has(c.node.id) ?? false"
              :traced-ports="trace?.portIds ?? null"
              :anchor="apDeviceIds.has(c.node.id)"
              @trace="onTrace"
            />
            <span
              v-for="t in tags"
              :key="t.id"
              class="speed-tag"
              :class="{ 'is-traced': trace?.edgeIds.has(t.id) }"
              :data-cable="t.id"
              :style="{ left: `${t.x}px`, top: `${t.y - 8}px` }">
              {{ t.text }}
            </span>
            <TopologyGroups part="label" :groups="placement.groups" :vlans="graph.vlans" />
          </div>
        </div>
      </div>
    </template>

    <TopologyWifi
      v-if="layers.wifi !== 'hidden'"
      class="topo-wifi-layer"
      :class="`layer-wifi-${layers.wifi}`"
      :grid="wifiGrid"
      :vlans="topology?.data.vlans ?? []"
      :machines="machines"
      :traced-ap-id="tracedApId"
      :error="wifiError ?? null"
      @trace="onApTrace"
    />
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
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
}

/*
 * Layers. Grey: faded and colourless (access-point cards stay as anchors for the Wi-Fi block);
 * hidden: the wired diagram keeps its space but draws nothing, the Wi-Fi block is not rendered.
 */
.layer-wired-grey :deep(.topo-card:not(.is-anchor)),
.layer-wired-grey :deep(.topo-cables),
.layer-wired-grey :deep(.topo-group),
.layer-wired-grey :deep(.group-label),
.layer-wired-grey .speed-tag {
  opacity: 0.2;
  filter: grayscale(1);
}
.layer-wired-hidden {
  visibility: hidden;
}
.layer-wifi-grey {
  opacity: 0.2;
  filter: grayscale(1);
}

/* Narrow screens: the legend takes its own row instead of covering the diagram. */
@media (max-width: 900px) {
  .topo-legend-corner {
    position: static;
    align-self: flex-end;
  }
}

/*
 * Hover trace, keyed on the canvas's `.is-tracing`: cards that are neither the traced device
 * nor its neighbours, the untraced jacks of a traced card, untraced speed tags and the group
 * frames and labels fade to 45 % (other cables fade to 25 % in TopologyCables).
 */
.is-tracing :deep(.topo-card:not(.is-traced)),
.is-tracing :deep(.topo-card.is-traced .jack:not(.is-traced)),
.is-tracing :deep(.topo-card.is-traced .entry:not(.is-traced)),
.is-tracing :deep(.topo-group),
.is-tracing :deep(.group-label),
.is-tracing .speed-tag:not(.is-traced) {
  opacity: 0.45;
}
.speed-tag {
  transition: opacity 0.15s ease;
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

@media (prefers-reduced-motion: reduce) {
  .speed-tag {
    transition: none;
  }
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
