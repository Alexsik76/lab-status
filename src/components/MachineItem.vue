<script setup lang="ts">
import { computed } from 'vue'
import type { Machine } from '../domain/model'
import { formatHardware } from '../presentation/hardware'
import { balanceMachineUnits } from '../presentation/layout'
import { getNodePrimaryUrlAndPort } from '../presentation/url'
import ContainerItem from './ContainerItem.vue'
import GuestItem from './GuestItem.vue'
import LinkOrPlain from './LinkOrPlain.vue'
import OsIcon from './OsIcon.vue'
import StateBadge from './StateBadge.vue'
import Tag from './Tag.vue'

const props = defineProps<{
  machine: Machine
}>()

const hwText = computed(() => formatHardware(props.machine.hardware))
const modelText = computed(() => props.machine.model || props.machine.manufacturer || '')

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
    <LinkOrPlain
      :href="hostUrl"
      class="host-card"
      :class="{ 'is-clickable': !!hostUrl }"
    >
      <div class="host-header">
        <span
          class="drag-handle"
          title="Drag to reorder servers"
          role="button"
          tabindex="0"
          aria-label="Drag to move"
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
        <OsIcon :platform="machine.platform" :size="22" />
        <span class="host-name">{{ machine.name }}</span>
        <span class="spacer"></span>
        <StateBadge :state="machine.state" variant="machine" />
      </div>

      <div class="host-meta">
        <span v-if="modelText" class="host-model">{{ modelText }}</span>
        <div class="host-network-hw">
          <span class="host-ip">
            {{ machine.ip }}<span v-if="hostPort" class="host-port">{{ hostPort }}</span>
          </span>
          <span v-if="hwText" class="host-hw">{{ hwText }}</span>
        </div>
      </div>

      <div v-if="machine.tags?.length" class="host-tags">
        <Tag v-for="tag in machine.tags" :key="tag.name" :tag="tag" size="sm" />
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
    </LinkOrPlain>

    <!-- Right Content Area: 2 Columns Grid -->
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
  background: var(--color-bg-tile);
  border: 1px solid var(--color-border-tile);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: border-color 0.15s ease;
  list-style: none;
}

.machine-tile.is-unreachable {
  border: 2px solid var(--color-state-down);
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
  background: var(--color-bg-spine);
  border-right: 1px solid var(--color-border-spine);
  text-decoration: none;
  color: inherit;
  transition: background 0.12s ease;
  user-select: none;
}

.host-card.is-clickable {
  cursor: pointer;
}
.host-card.is-clickable:hover {
  background: var(--color-bg-spine-hover);
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
  color: var(--color-text-dim);
  cursor: grab;
  border-radius: var(--radius-xs);
  transition: color 0.12s ease, background 0.12s ease;
  user-select: none;
  margin-left: -6px;
  flex: none;
}
.drag-handle:hover {
  color: var(--color-text-secondary);
  background: var(--color-border-spine);
}
.drag-handle:active {
  cursor: grabbing;
}

.host-name {
  font-family: var(--font-sans);
  font-size: 28px;
  line-height: 1.05;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-text-host);
}

.spacer {
  flex: 1;
}

.host-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.3;
  color: var(--color-text-muted);
}

.host-model {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-model);
}

.host-network-hw {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  color: var(--color-text-secondary);
}

.host-port {
  color: var(--color-text-port);
}
.host-hw {
  color: var(--color-text-muted);
}

.host-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
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
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-port);
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
  border-radius: var(--radius-xs);
  border: 1px dashed var(--color-border-slot);
  background: var(--color-bg-slot);
  display: flex;
  align-items: center;
  justify-content: center;
}

.slot-line {
  width: 60%;
  height: 1px;
  background: var(--color-border-slot-line);
}

.metric-pct {
  color: var(--color-text-pct);
  font-family: var(--font-mono);
  font-size: 11px;
}

/* Right Content Area */
.machine-content {
  flex: 1;
  min-width: 0;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
  border-radius: var(--radius-sm);
  box-shadow: inset 0 0 0 1px var(--color-border-apps);
}

.empty {
  grid-column: 1 / -1;
  align-self: center;
  padding: 0 12px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text-empty);
}

@media (max-width: 900px) {
  .machine-tile {
    flex-direction: column;
  }
  .host-card {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--color-border-spine);
  }
  .machine-content {
    grid-template-columns: 1fr;
  }
}
</style>
