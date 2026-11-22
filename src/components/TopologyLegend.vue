<script setup lang="ts">
import type { SpeedBucket } from '../domain/topology'
import type { RawTopologyVlan } from '../types/topology'
import { cableWidth, styleColor, vlanColor } from '../presentation/topologyLayout'
import { wavyPath } from '../presentation/wavy'
import TopologyJack from './TopologyJack.vue'

/** What the cables mean: trunk, the VLANs present, no VLAN data, Wi-Fi, widths by speed. */
defineProps<{
  vlans: readonly RawTopologyVlan[]
  hasTrunk: boolean
  hasUnknown: boolean
  speeds: readonly SpeedBucket[]
  /** The Wi-Fi block is on the page. */
  wifi?: boolean
}>()

const trunk = styleColor({ kind: 'trunk', vlan: null })
/** The Wi-Fi line sample: the same wave as on the diagram. */
const wave = wavyPath([{ x: 1, y: 5 }, { x: 25, y: 5 }], 2.4, 6)
const unknown = styleColor({ kind: 'unknown', vlan: null })
</script>

<template>
  <aside class="topo-legend" aria-label="Legend">
    <ul class="legend-group">
      <li v-if="hasTrunk">
        <svg width="26" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="25" y2="5" :stroke="trunk" stroke-width="5" />
          <line x1="1" y1="5" x2="25" y2="5" stroke="var(--color-bg-page)" stroke-width="2" />
        </svg>
        trunk
      </li>
      <li v-for="v in vlans" :key="v.vid">
        <svg width="26" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="25" y2="5" :stroke="vlanColor(v.vid)" stroke-width="3" />
        </svg>
        <span class="vid">{{ v.vid }}</span>{{ v.name ? ` ${v.name}` : '' }}
      </li>
      <li v-if="hasUnknown">
        <svg width="26" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="25" y2="5" :stroke="unknown" stroke-width="3" />
        </svg>
        no VLAN data
      </li>
    </ul>
    <ul v-if="wifi" class="legend-group">
      <li data-legend="wifi">
        <svg width="26" height="10" aria-hidden="true">
          <path :d="wave" fill="none" stroke="var(--color-text-secondary)" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        Wi-Fi
      </li>
      <li data-legend="radio">
        <span class="legend-jack" style="--jack-color: var(--color-text-secondary)">
          <TopologyJack shape="radio" kind="access" :north="false" />
        </span>
        radio
      </li>
    </ul>
    <ul v-if="speeds.length" class="legend-group">
      <li v-for="s in speeds" :key="s">
        <svg width="26" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="25" y2="5" stroke="var(--color-text-dim)" :stroke-width="cableWidth(s)" />
        </svg>
        {{ s }}
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.topo-legend {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--color-border-tile);
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--color-bg-tile) 92%, transparent);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
}
.legend-group {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.legend-group + .legend-group {
  padding-top: 6px;
  border-top: 1px solid var(--color-border-tile);
}
li {
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}
svg {
  flex: none;
}
.legend-jack {
  display: inline-flex;
  justify-content: center;
  width: 26px;
  transform: scale(0.75);
}
.vid {
  color: var(--color-text-secondary);
}
</style>
