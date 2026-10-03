<script setup lang="ts">
import { computed } from 'vue'
import type { Machine } from '../domain/model'
import {
  balanceMachineUnits,
  detectMachineOs,
  getHostHardware,
  getNodePrimaryUrlAndPort,
} from '../domain/homelabUi'
import ContainerItem from './ContainerItem.vue'
import GuestItem from './GuestItem.vue'
import OsIcon from './OsIcon.vue'
import StateBadge from './StateBadge.vue'

const props = withDefaults(
  defineProps<{
    machine: Machine
    index?: number
  }>(),
  {
    index: 0,
  },
)

const machineOs = computed(() => detectMachineOs(props.machine))
const hw = computed(() => getHostHardware(props.machine))

const serviceInfo = computed(() =>
  getNodePrimaryUrlAndPort(props.machine.services, props.machine.ip),
)
const hostUrl = computed(() => serviceInfo.value.url)
const hostPort = computed(() => serviceInfo.value.portText)

const columns = computed(() => balanceMachineUnits(props.machine.guests, props.machine.apps))
const isEmpty = computed(
  () => props.machine.guests.length === 0 && props.machine.apps.length === 0,
)
</script>

<template>
  <li
    class="machine-node machine-tile"
    :class="[
      `state-${machine.state}`,
      { 'is-unreachable': machine.state === 'down' },
    ]"
  >
    <!-- Left Host Sidebar Card -->
    <component
      :is="hostUrl ? 'a' : 'div'"
      :href="hostUrl || undefined"
      :target="hostUrl ? '_blank' : undefined"
      :rel="hostUrl ? 'noopener noreferrer' : undefined"
      class="host-card"
      :class="{ 'is-clickable': !!hostUrl }"
    >
      <div class="host-header">
        <span
          class="drag-handle"
          title="Перетягніть для зміни порядку серверів"
          role="button"
          tabindex="0"
          aria-label="Перетягніть для переміщення"
          @click.stop.prevent
        >
          <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
            <circle cx="2" cy="2" r="1.2" />
            <circle cx="6" cy="2" r="1.2" />
            <circle cx="2" cy="7" r="1.2" />
            <circle cx="6" cy="7" r="1.2" />
            <circle cx="2" cy="12" r="1.2" />
            <circle cx="6" cy="12" r="1.2" />
          </svg>
        </span>
        <OsIcon :os="machineOs" :size="22" />
        <span class="host-name">{{ machine.name }}</span>
        <span class="spacer"></span>
        <StateBadge :state="machine.state" variant="machine" />
        <span v-if="hostUrl" class="host-arrow">↗</span>
      </div>

      <div class="host-meta">
        <span class="host-model">{{ machine.model || machine.manufacturer || 'Server' }}</span>
        <div class="host-network-hw">
          <span class="host-ip">
            {{ machine.ip }}<span v-if="hostPort" class="host-port">{{ hostPort }}</span>
          </span>
          <span class="host-hw">{{ hw.cores }}c · {{ hw.mem }}G</span>
        </div>
      </div>

      <div class="host-metrics" title="Data collector for CPU and MEM metrics to be configured">
        <div class="metric-row">
          <span class="metric-label">CPU</span>
          <div class="metric-slot">
            <span class="slot-line"></span>
          </div>
          <span class="metric-pct">—</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">MEM</span>
          <div class="metric-slot">
            <span class="slot-line"></span>
          </div>
          <span class="metric-pct">—</span>
        </div>
      </div>
    </component>

    <!-- Right Content Area: 3 Columns Grid -->
    <div class="machine-content">
      <div v-for="(col, colIdx) in columns" :key="colIdx" class="content-col">
        <template v-for="unit in col.items" :key="unit.id">
          <!-- Guest Unit -->
          <GuestItem v-if="unit.isGuest && unit.guest" :guest="unit.guest" />

          <!-- Host Apps Group -->
          <div v-else-if="unit.isAppGroup && unit.apps" class="app-group-card">
            <div class="apps-grid">
              <ContainerItem
                v-for="app in unit.apps"
                :key="app.id"
                :container="app"
                kind="app"
              />
            </div>
          </div>
        </template>
      </div>

      <!-- Empty notice if no guests or apps -->
      <div v-if="isEmpty" class="empty no-guests">
        No guests or apps registered in NetBox
      </div>
    </div>
  </li>
</template>

<style scoped>
.machine-tile {
  display: flex;
  box-sizing: border-box;
  background: oklch(0.19 0.009 250);
  border: 1px solid oklch(0.25 0.01 250);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.15s ease;
  list-style: none;
}

.machine-tile.is-unreachable {
  border: 2px solid oklch(0.62 0.22 27);
}

/* Left Host Card */
.host-card {
  flex: none;
  width: 250px;
  box-sizing: border-box;
  padding: 8px 14px 8px 16px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 6px;
  background: oklch(0.215 0.01 250);
  border-right: 1px solid oklch(0.26 0.01 250);
  text-decoration: none;
  color: inherit;
  transition: background 0.12s ease;
  user-select: none;
}

.host-card.is-clickable {
  cursor: pointer;
}
.host-card.is-clickable:hover {
  background: oklch(0.245 0.01 250);
}

.host-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 20px;
  color: oklch(0.48 0.01 250);
  cursor: grab;
  border-radius: 3px;
  transition: color 0.12s ease, background 0.12s ease;
  user-select: none;
  margin-left: -6px;
  flex: none;
}
.drag-handle:hover {
  color: oklch(0.85 0.006 250);
  background: oklch(0.26 0.01 250);
}
.drag-handle:active {
  cursor: grabbing;
}

.host-name {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 28px;
  line-height: 1.05;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: oklch(0.95 0.006 250);
}

.spacer {
  flex: 1;
}

.host-arrow {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 14px;
  color: oklch(0.6 0.012 250);
  margin-left: -4px;
}

.host-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  line-height: 1.3;
  color: oklch(0.6 0.012 250);
}

.host-model {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.host-network-hw {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  color: oklch(0.78 0.012 250);
}

.host-port {
  color: oklch(0.58 0.012 250);
}
.host-hw {
  color: oklch(0.6 0.012 250);
}

.host-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding-top: 2px;
}

.metric-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  color: oklch(0.55 0.012 250);
}

.metric-label {
  flex: none;
  font-weight: 500;
}

.metric-slot {
  flex: none;
  width: 50px;
  height: 14px;
  box-sizing: border-box;
  border-radius: 3px;
  border: 1px dashed oklch(0.32 0.01 250);
  background: oklch(0.18 0.008 250);
  display: flex;
  align-items: center;
  justify-content: center;
}

.slot-line {
  width: 60%;
  height: 1px;
  background: oklch(0.3 0.01 250);
}

.metric-pct {
  color: oklch(0.48 0.01 250);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
}

/* Right Content Area */
.machine-content {
  flex: 1;
  min-width: 0;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  align-items: start;
  align-content: center;
}

.content-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.app-group-card {
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid transparent;
  padding: 3px;
}

.apps-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  padding: 3px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px oklch(0.29 0.01 250);
}

.empty {
  grid-column: 1 / -1;
  align-self: center;
  padding: 0 12px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
  color: oklch(0.48 0.01 250);
}

@media (max-width: 1280px) {
  .machine-content {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .machine-tile {
    flex-direction: column;
  }
  .host-card {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid oklch(0.26 0.01 250);
  }
  .machine-content {
    grid-template-columns: 1fr;
  }
}
</style>
