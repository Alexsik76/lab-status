<script setup lang="ts">
import { computed } from 'vue'
import type { RawTopologyVlan } from '../types/topology'
import { vlanColor, type PlacedGroup } from '../presentation/topologyLayout'

/**
 * Group rectangles: dashed, rounded, a label at the top left with the group's name, member
 * count and common VLAN. Not interactive. Drawn twice: the frames under the cables and cards
 * (`part="frame"`), the labels on a page-coloured chip above the cables (`part="label"`), so a
 * cable crossing the group's top edge does not run through the text.
 */
const props = defineProps<{
  groups: readonly PlacedGroup[]
  vlans: readonly RawTopologyVlan[]
  part: 'frame' | 'label'
}>()

const items = computed(() => {
  const names = new Map(props.vlans.map((v) => [v.vid, v.name]))
  return props.groups.map((p) => {
    const { group } = p
    const vlan = group.vlan
    const vlanText = vlan === null ? '' : ` · VLAN ${vlan}${names.get(vlan) ? ` ${names.get(vlan)}` : ''}`
    return {
      ...p,
      label: `${group.label} · ${group.memberIds.length}${vlanText}`,
      color: vlan === null ? null : vlanColor(vlan),
    }
  })
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
      :style="{ left: `${g.x + 10}px`, top: `${g.y + 5}px`, ...(g.color ? { '--group-color': g.color } : {}) }"
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
.group-label.has-vlan {
  color: var(--group-color);
}
</style>
