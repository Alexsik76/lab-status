<script setup lang="ts">
import type { TopologyNode } from '../domain/topology'
import { ZIGBEE_MESH_NOTE } from '../domain/zigbeeGraph'
import { styleColor } from '../presentation/topologyLayout'

/**
 * Frames packing the Wi-Fi-only clients of one radio ("Home · 5180 · 3", VLAN colour) or the
 * Zigbee devices ("Zigbee · 5", Zigbee colour), in the visual language of the device groups:
 * dashed, a label chip on the bottom border. Drawn twice: the frames under the cables
 * (`part="frame"`), the labels above them. The member cards inside handle hover and links; the
 * Zigbee label carries a title (the mesh routes are not shown), so it takes the pointer.
 */
defineProps<{
  frames: readonly { node: TopologyNode; x: number; y: number; width: number; height: number }[]
  part: 'frame' | 'label'
  /** Hover trace: traced node ids (a traced frame stays bright). */
  traced: ReadonlySet<string> | null
}>()

const color = (node: TopologyNode) =>
  node.kind === 'zigbee-group' ? 'var(--color-zigbee)' : styleColor(node.ports[0]?.style ?? { kind: 'unknown', vlan: null })
const title = (node: TopologyNode) => (node.kind === 'zigbee-group' ? ZIGBEE_MESH_NOTE : undefined)
</script>

<template>
  <template v-for="f in frames" :key="f.node.id">
    <div
      v-if="part === 'frame'"
      class="wifi-frame"
      :class="[`frame-${f.node.kind}`, { 'is-traced': traced?.has(f.node.id), 'is-offline': f.node.offline }]"
      :data-frame="f.node.id"
      :title="title(f.node)"
      :style="{ left: `${f.x}px`, top: `${f.y}px`, width: `${f.width}px`, height: `${f.height}px`, '--group-color': color(f.node) }"
      aria-hidden="true"
    ></div>
    <span
      v-else
      class="wifi-frame-label"
      :class="[`frame-${f.node.kind}`, { 'is-traced': traced?.has(f.node.id) }]"
      :data-frame="f.node.id"
      :title="title(f.node)"
      :style="{ left: `${f.x + 10}px`, top: `${f.y + f.height}px`, '--group-color': color(f.node) }"
    >
      {{ f.node.label }}
    </span>
  </template>
</template>

<style scoped>
.wifi-frame {
  position: absolute;
  box-sizing: border-box;
  border: 1.5px dashed var(--group-color);
  border-radius: var(--radius-lg);
  background: color-mix(in oklch, var(--group-color) 4%, transparent);
  pointer-events: none;
  transition: opacity 0.15s ease, border-color 0.15s ease;
}
.wifi-frame.is-traced {
  background: color-mix(in oklch, var(--group-color) 9%, transparent);
}
.wifi-frame-label {
  position: absolute;
  z-index: 2;
  transform: translateY(-50%);
  padding: 2px 4px;
  border-radius: var(--radius-xs);
  background: var(--color-bg-page);
  pointer-events: none;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.03em;
  white-space: nowrap;
  color: var(--group-color);
  transition: opacity 0.15s ease;
}
.wifi-frame-label.frame-zigbee-group {
  pointer-events: auto;
  cursor: help;
}
@media (prefers-reduced-motion: reduce) {
  .wifi-frame,
  .wifi-frame-label {
    transition: none;
  }
}
</style>
