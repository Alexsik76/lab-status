<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceRecord } from '../domain/model'
import type { RawTopologyVlan } from '../types/topology'
import { groupLabel } from '../presentation/groupLabel'
import { vlanColor, type PlacedGroup } from '../presentation/topologyLayout'

/**
 * Group rectangles: dashed, rounded, a label with the group's name or composition and common
 * VLAN (`groupLabel`). Not interactive. Drawn twice: the frames under the cables and cards
 * (`part="frame"`), the labels on a page-coloured chip above the cables (`part="label"`). The
 * chip sits at the bottom-left corner, centred on the bottom border: cables enter a group from
 * the top, so nothing runs through the text there.
 */
/** Distance of the label chip from the frame's left edge. */
const LABEL_INSET = 10

const props = defineProps<{
  groups: readonly PlacedGroup[]
  vlans: readonly RawTopologyVlan[]
  /** NetBox device records, to tell the members apart (cameras, recorders). */
  devices: readonly DeviceRecord[]
  part: 'frame' | 'label'
}>()

const items = computed(() => {
  const devices = new Map(props.devices.map((d) => [d.id, d]))
  return props.groups.map((p) => ({
    ...p,
    label: groupLabel(p.group, devices, props.vlans),
    color: p.group.vlan === null ? null : vlanColor(p.group.vlan),
  }))
})
</script>

<template>
  <template v-for="g in items" :key="g.group.id">
    <div
      v-if="part === 'frame'"
      class="topo-group"
      :data-group="g.group.id"
      :style="{
        left: `${g.x}px`,
        top: `${g.y}px`,
        width: `${g.width}px`,
        height: `${g.height}px`,
        ...(g.color ? { '--group-color': g.color } : {}),
      }"
      aria-hidden="true"
    ></div>
    <span
      v-else
      class="group-label"
      :class="{ 'has-vlan': !!g.color }"
      :data-group="g.group.id"
      :style="{ left: `${g.x + LABEL_INSET}px`, top: `${g.y + g.height}px`, ...(g.color ? { '--group-color': g.color } : {}) }"
    >
      {{ g.label }}
    </span>
  </template>
</template>

<style scoped>
.topo-group {
  --group-color: var(--color-border-dashed);
  position: absolute;
  box-sizing: border-box;
  border: 1.5px dashed var(--group-color);
  border-radius: var(--radius-lg);
  background: color-mix(in oklch, var(--group-color) 4%, transparent);
  pointer-events: none;
}
.group-label {
  --group-color: var(--color-border-dashed);
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
  color: var(--color-text-muted);
}
/* Hover trace: frames and labels fade (TopologyPage, keyed on `.is-tracing`). */
.topo-group,
.group-label {
  transition: opacity 0.15s ease;
}
@media (prefers-reduced-motion: reduce) {
  .topo-group,
  .group-label {
    transition: none;
  }
}
.group-label.has-vlan {
  color: var(--group-color);
}
</style>
