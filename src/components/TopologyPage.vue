<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import type { ArpPresenceIndex } from '../domain/arp'
import { arpObjectKey } from '../domain/arp'
import type { DeviceRecord, Machine } from '../domain/model'
import { buildTopologyGraph, traceOf, type TopologyNode } from '../domain/topology'
import { wifiLive, withWifi } from '../domain/wifiGraph'
import { useWifiPlan } from '../composables/useWifiPlan'
import type { RawTopology } from '../types/topology'
import { useTopologyLayout } from '../composables/useTopologyLayout'
import { JACK_SIZE, drawsJack, fitScale, packFrame, portShape, speedTag, type PlacedNode } from '../presentation/topologyLayout'
import LoadingSpinner from './LoadingSpinner.vue'
import NoticeBanner from './NoticeBanner.vue'
import TopologyCables from './TopologyCables.vue'
import TopologyCard from './TopologyCard.vue'
import TopologyGroups from './TopologyGroups.vue'
import TopologyLayerSwitch from './TopologyLayerSwitch.vue'
import TopologyLegend from './TopologyLegend.vue'
import TopologyWifi from './TopologyWifi.vue'
import TopologyWifiFrames from './TopologyWifiFrames.vue'
import { buildWifiGrid } from '../domain/wifi'
import { loadLayerStates, saveLayerStates, type LayerId, type LayerState } from '../presentation/layers'
import type { WifiData } from '../types/wifi'
import type { ZigbeeData } from '../types/zigbee'
import { mergeZigbeePlan, withZigbee, zigbeeAvailable } from '../domain/zigbeeGraph'
import { useThrottledPlan } from '../composables/useThrottledPlan'

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
  /** The Zigbee network from Home Assistant (`zigbee` source); null until the first snapshot. */
  zigbee?: ZigbeeData | null
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
/** Layers: Wired and Wi-Fi, each shown / grey / hidden, remembered in local storage. */
const layers = ref(loadLayerStates())
watch(layers, (states) => saveLayerStates(states), { deep: true })
const onLayer = (id: LayerId, state: LayerState) => {
  layers.value = { ...layers.value, [id]: state }
}

const wiredGraph = computed(() => {
  if (!props.topology) return null
  const metricIds = new Set(metricKey.value ? metricKey.value.split(',') : [])
  return buildTopologyGraph(props.topology.data, props.topology.devices, props.topology.machineIds, metricIds)
})

/**
 * Wi-Fi in the diagram: radio ports, client cards / ports and Wi-Fi edges from the plan
 * (`useWifiPlan`: sticky clients, structural changes at most every 10 s); live values only
 * relabel ports and dim disconnected clients, so they never change the layout input. With the
 * Wi-Fi layer hidden the diagram is the wired graph alone.
 */
const wifiData = computed(() => props.wifi ?? null)
const { plan } = useWifiPlan(wifiData)
const live = computed(() => (plan.value ? wifiLive(plan.value, wifiData.value) : null))
/**
 * Zigbee in the diagram: the coordinator's port, the device frame and the bead line, from a
 * sticky plan as for Wi-Fi; availability only dims cards. Hidden layer: not in the graph.
 */
const zigbeeData = computed(() => props.zigbee ?? null)
const { plan: zigbeePlan } = useThrottledPlan(zigbeeData, mergeZigbeePlan)
const zigbeeLive = computed(() => zigbeeAvailable(zigbeeData.value))

const graph = computed(() => {
  let g = wiredGraph.value
  if (!g) return g
  if (plan.value && live.value && layers.value.wifi !== 'hidden') {
    g = withWifi(g, plan.value, live.value, props.topology?.machineIds, props.topology?.devices)
  }
  if (zigbeePlan.value && layers.value.zigbee !== 'hidden') g = withZigbee(g, zigbeePlan.value, zigbeeLive.value)
  return g
})
const { placement, phase, error } = useTopologyLayout(graph)

const viewport = ref<HTMLElement | null>(null)
const { width: viewportWidth } = useElementSize(viewport)
const scale = computed(() => fitScale(viewportWidth.value, placement.value?.width ?? 0))

/**
 * Hover trace: the one device being pointed at (or focused from the keyboard). Its cables and
 * Wi-Fi lines, neighbours and their ports are emphasised, the rest toned down.
 */
const tracedId = ref<string | null>(null)
/** A Wi-Fi frame member pointed at: its frame is traced, and only this member stands out. */
const tracedMember = ref<string | null>(null)
const frameOfMember = computed(
  () => new Map((graph.value?.nodes ?? []).flatMap((n) => (n.members ?? []).map((m) => [m.id, n.id] as const))),
)
const trace = computed(() => (graph.value && tracedId.value ? traceOf(graph.value, tracedId.value) : null))
const onTrace = (nodeId: string | null) => {
  const frame = nodeId ? frameOfMember.value.get(nodeId) : undefined
  tracedMember.value = frame ? nodeId : null
  tracedId.value = frame ?? nodeId
}
const isTraced = (nodeId: string, frameId?: string) => {
  const t = trace.value
  if (!t) return false
  if (!frameId) return t.nodeIds.has(nodeId)
  // A member: traced with its frame (the access point was pointed at), or when it is the one.
  return t.nodeIds.has(frameId) && (tracedMember.value === null || tracedMember.value === nodeId)
}

/** Wi-Fi lines of clients not connected now: laid out (no relayout), not drawn. */
const hiddenEdges = computed(() => {
  const g = graph.value
  if (!g) return new Set<string>()
  const offPorts = new Set(g.nodes.flatMap((n) => n.ports.filter((p) => p.kind === 'radio' && p.off).map((p) => p.id)))
  return new Set(g.edges.filter((e) => e.medium === 'wifi' && (offPorts.has(e.target) || offPorts.has(e.source))).map((e) => e.id))
})

const wifiGrid = computed(() => (props.wifi ? buildWifiGrid(props.wifi, (deviceId) => placement.value?.nodes.get(deviceId)?.x) : null))

const isEmpty = computed(() => graph.value !== null && graph.value.edges.length === 0)

const cards = computed(() => {
  const g = graph.value
  const p = placement.value
  if (!g || !p) return []
  const item = (node: TopologyNode, placed: PlacedNode, frameId?: string) => {
    const deviceId = node.deviceId ?? (node.kind === 'wifi-client' ? null : node.id)
    const machine = node.isMachine && deviceId ? (props.machines.get(deviceId) ?? null) : null
    const presence = machine || !deviceId ? null : (props.presence.get(arpObjectKey('device', deviceId)) ?? null)
    // Cards with a radio port (access points, wired devices also on Wi-Fi, Wi-Fi clients) stay
    // visible when the wired layer is grey.
    const anchor = node.inFrame || node.ports.some((port) => port.kind === 'radio' || port.kind === 'zigbee')
    return { node, placed, machine, presence, anchor, frameId }
  }
  return g.nodes.flatMap((node) => {
    const placed = p.nodes.get(node.id)
    if (!placed) return []
    if (node.kind !== 'wifi-group' && node.kind !== 'zigbee-group') return [item(node, placed)]
    // A frame of Wi-Fi clients: its members at their grid slots, relative to the frame.
    const { slots } = packFrame(node.members ?? [])
    return (node.members ?? []).map((member, i) =>
      item(member, { x: placed.x + slots[i].x, y: placed.y + slots[i].y, width: slots[i].width, height: slots[i].height, ports: new Map() }, node.id),
    )
  })
})

/** Wi-Fi client frames with their placement, for the frame and label layers. */
const frames = computed(() => {
  const g = graph.value
  const p = placement.value
  if (!g || !p) return []
  return g.nodes.flatMap((node) => {
    const placed = node.kind === 'wifi-group' || node.kind === 'zigbee-group' ? p.nodes.get(node.id) : undefined
    return placed ? [{ node, ...placed }] : []
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
    const port = target?.ports.find((q) => q.id === edge.target)
    const dx = target && port && drawsJack(target, port) ? JACK_SIZE[portShape(port)].width / 2 + 3 : 5
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
          :zigbee="layers.zigbee !== 'hidden'"
        />
      </div>
      <div ref="viewport" class="topo-viewport">
        <div class="topo-sizer" :style="{ width: `${placement.width * scale}px`, height: `${placement.height * scale}px` }">
          <div
            class="topo-canvas"
            :class="[{ 'is-tracing': !!trace }, `layer-wired-${layers.wired}`, `layer-wifi-${layers.wifi}`, `layer-zigbee-${layers.zigbee}`]"
            :style="{ width: `${placement.width}px`, height: `${placement.height}px`, transform: `scale(${scale})` }"
          >
            <TopologyGroups part="frame" :groups="placement.groups" :vlans="graph.vlans" :devices="topology?.devices ?? []" />
            <TopologyWifiFrames part="frame" :frames="frames" :traced="trace?.nodeIds ?? null" />
            <TopologyCables
              :edges="graph.edges"
              :routes="placement.edges"
              :width="placement.width"
              :height="placement.height"
              :traced="trace?.edgeIds ?? null"
              :hidden="hiddenEdges"
            />
            <TopologyCard
              v-for="c in cards"
              :key="c.node.id"
              :node="c.node"
              :placed="c.placed"
              :machine="c.machine"
              :presence="c.presence"
              :traced="isTraced(c.node.id, c.frameId)"
              :traced-ports="trace?.portIds ?? null"
              :anchor="c.anchor"
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
            <TopologyGroups part="label" :groups="placement.groups" :vlans="graph.vlans" :devices="topology?.devices ?? []" />
            <TopologyWifiFrames part="label" :frames="frames" :traced="trace?.nodeIds ?? null" />
          </div>
        </div>
      </div>
    </template>

    <TopologyWifi
      :grid="wifiGrid"
      :vlans="topology?.data.vlans ?? []"
      :machines="machines"
      :error="wifiError ?? null"
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
 * Layers. Wired grey: wired cables, copper jacks and wired-only cards fade; cards with a radio
 * port (access points, Wi-Fi clients) stay, only their copper jacks fade. Wired hidden: the
 * wired drawing keeps its space but is not drawn. Wi-Fi grey: radio ports, Wi-Fi lines and
 * Wi-Fi client cards fade; Zigbee grey: its port, bead line, frame and device cards (hidden
 * layers are taken out of the graph, see `graph`).
 */
.layer-wired-grey :deep(.topo-card:not(.is-anchor)),
.layer-wired-grey :deep(.topo-card.is-anchor .jack:not(.shape-radio):not(.shape-zigbee)),
.layer-wired-grey :deep(.topo-card.is-anchor .entry),
.layer-wired-grey :deep(.cable.medium-cable),
.layer-wired-grey :deep(.topo-group),
.layer-wired-grey :deep(.group-label),
.layer-wired-grey .speed-tag,
.layer-wifi-grey :deep(.cable.medium-wifi),
.layer-wifi-grey :deep(.branch),
.layer-wifi-grey :deep(.jack.shape-radio),
.layer-wifi-grey :deep(.topo-card.kind-wifi-client),
.layer-wifi-grey :deep(.wifi-frame.frame-wifi-group),
.layer-wifi-grey :deep(.wifi-frame-label.frame-wifi-group),
.layer-zigbee-grey :deep(.cable.medium-zigbee),
.layer-zigbee-grey :deep(.jack.shape-zigbee),
.layer-zigbee-grey :deep(.topo-card.kind-zigbee-device),
.layer-zigbee-grey :deep(.wifi-frame.frame-zigbee-group),
.layer-zigbee-grey :deep(.wifi-frame-label.frame-zigbee-group) {
  opacity: 0.2;
  filter: grayscale(1);
}
.layer-wired-hidden :deep(.topo-card:not(.is-anchor)),
.layer-wired-hidden :deep(.cable.medium-cable),
.layer-wired-hidden :deep(.topo-group),
.layer-wired-hidden :deep(.group-label),
.layer-wired-hidden .speed-tag {
  visibility: hidden;
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
.is-tracing :deep(.wifi-frame:not(.is-traced)),
.is-tracing :deep(.wifi-frame-label:not(.is-traced)),
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
