<script setup lang="ts">
import { computed } from 'vue'
import type { Machine } from '../domain/model'
import { clientTooltip, type WifiGrid } from '../domain/wifi'
import { routeHash } from '../presentation/route'
import { vlanColor } from '../presentation/topologyLayout'
import type { RawTopologyVlan } from '../types/topology'
import type { WifiAp } from '../types/wifi'

/**
 * The Wi-Fi block under the wired diagram: a grid, access points as columns, networks (SSID +
 * band) as rows tinted in the row VLAN's colour. Hovering a column header or a chip traces the
 * access point on the diagram (`trace`); `tracedApId` emphasises the column the other way.
 */
const props = defineProps<{
  grid: WifiGrid | null
  vlans: readonly RawTopologyVlan[]
  /** Hosts machines by device id: a chip of such a device links to its tile. */
  machines: ReadonlyMap<string, Machine>
  tracedApId: string | null
  /** Set when there is no Wi-Fi data and none is coming. */
  error: string | null
}>()

const emit = defineEmits<{ trace: [apId: string | null] }>()

const vlanName = computed(() => new Map(props.vlans.map((v) => [v.vid, v.name])))
const rowColor = (vid: number | null) => (vid === null ? 'var(--color-border-dashed)' : vlanColor(vid))
const vlanText = (vid: number | null) => {
  if (vid === null) return 'no VLAN'
  const name = vlanName.value.get(vid)
  return name ? `VLAN ${vid} ${name}` : `VLAN ${vid}`
}
const bandText = (band: string | null) => (band ? `${band} GHz` : 'band unknown')
const chipHref = (deviceId: string | null) => (deviceId && props.machines.has(deviceId) ? routeHash('hosts', deviceId) : null)

const columns = computed(() => props.grid?.columns ?? [])
const gridStyle = computed(() => ({ gridTemplateColumns: `minmax(150px, max-content) repeat(${columns.value.length}, minmax(150px, 1fr))` }))

const onEnter = (e: PointerEvent | FocusEvent, ap: WifiAp) => {
  if (e instanceof PointerEvent && e.pointerType === 'touch') return
  if (e instanceof FocusEvent && !(e.currentTarget as HTMLElement).matches(':focus-visible')) return
  emit('trace', ap.id)
}
const onLeave = () => emit('trace', null)
</script>

<template>
  <section class="topo-wifi" aria-label="Wi-Fi">
    <h2 class="wifi-title">Wi-Fi</h2>

    <p v-if="!grid && error" class="empty-state">Wi-Fi data is unavailable. {{ error }}</p>
    <p v-else-if="!grid" class="empty-state">Reading the wireless networks…</p>
    <p v-else-if="error" class="empty-state">Wi-Fi data is unavailable. {{ error }}</p>
    <p v-else-if="!grid.rows.length || !grid.columns.length" class="empty-state">The router reports no wireless networks.</p>

    <div v-else class="wifi-scroll">
      <div class="wifi-grid" :class="{ 'is-tracing': !!tracedApId }" :style="gridStyle">
        <div class="corner"></div>
        <div
          v-for="ap in columns"
          :key="ap.id"
          class="ap-head"
          :class="{ 'is-traced': ap.id === tracedApId }"
          :data-ap="ap.id"
          tabindex="0"
          @pointerenter="onEnter($event, ap)"
          @pointerleave="onLeave"
          @focusin="onEnter($event, ap)"
          @focusout="onLeave"
        >
          <span class="ap-name">{{ ap.name }}</span>
        </div>

        <template v-for="row in grid.rows" :key="`${row.network.ssid}|${row.network.band}`">
          <div class="row-head" :style="{ '--row-color': rowColor(row.network.vlan) }">
            <span class="ssid">{{ row.network.ssid }}</span>
            <span class="row-meta">{{ bandText(row.network.band) }} · {{ vlanText(row.network.vlan) }}</span>
          </div>
          <div
            v-for="(cell, i) in row.cells"
            :key="columns[i].id"
            class="cell"
            :class="[`cell-${cell.kind}`, { 'is-traced': columns[i].id === tracedApId }]"
            :style="{ '--row-color': rowColor(row.network.vlan) }"
            :data-ap="columns[i].id"
          >
            <span v-if="cell.kind === 'disabled'" class="radio-off">radio disabled</span>
            <template v-else-if="cell.kind === 'radio'">
              <span class="radio" :class="{ 'is-down': cell.radio.state === 'down' }" :title="cell.radio.state === 'down' ? 'radio down' : undefined">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <circle cx="6" cy="9" r="1.3" fill="currentColor" />
                  <path d="M3.4 6.6 A3.6 3.6 0 0 1 8.6 6.6 M1.4 4.6 A6.4 6.4 0 0 1 10.6 4.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                </svg>
                <span class="channel">{{ cell.radio.channel !== null ? `${cell.radio.channel} MHz` : 'channel unknown' }}</span>
                <span v-if="cell.radio.state === 'down'" class="radio-state">down</span>
              </span>
              <span v-if="!cell.clients.length" class="no-clients">no clients</span>
              <span v-else class="chips">
                <component
                  :is="chipHref(client.deviceId) ? 'a' : 'span'"
                  v-for="client in cell.clients"
                  :key="client.mac"
                  class="chip"
                  :href="chipHref(client.deviceId) ?? undefined"
                  :title="clientTooltip(client)"
                  :data-mac="client.mac"
                  @pointerenter="onEnter($event, columns[i])"
                  @pointerleave="onLeave"
                >
                  {{ client.name }}
                </component>
              </span>
            </template>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.topo-wifi {
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: opacity 0.15s ease, filter 0.15s ease;
}
.wifi-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-title);
}

.wifi-scroll {
  overflow-x: auto;
}
.wifi-grid {
  display: grid;
  gap: 2px;
  font-family: var(--font-mono);
  font-size: 11px;
}

.ap-head {
  padding: 6px 10px;
  border: 1px solid var(--color-border-guest);
  border-radius: var(--radius-md);
  background: var(--color-bg-tile);
  cursor: default;
  transition: border-color 0.15s ease, opacity 0.15s ease;
}
.ap-name {
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-host);
}
.ap-head:hover .ap-name,
.ap-head:focus-visible .ap-name,
.ap-head.is-traced .ap-name {
  color: var(--color-text-accent);
}
.ap-head:focus-visible {
  outline: none;
}
.ap-head.is-traced {
  border-color: var(--color-text-dim);
}

.row-head,
.cell {
  padding: 6px 10px;
  background: color-mix(in oklch, var(--row-color) 9%, var(--color-bg-page));
  transition: opacity 0.15s ease, box-shadow 0.15s ease;
}
.row-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 3px solid var(--row-color);
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}
.ssid {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.row-meta {
  color: var(--row-color);
}

.cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.cell-none {
  background: color-mix(in oklch, var(--row-color) 4%, var(--color-bg-page));
}
.cell.is-traced {
  box-shadow: inset 0 0 0 1px var(--color-text-dim);
}
.radio {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--row-color);
}
.radio .channel {
  color: var(--color-text-secondary);
}
.radio.is-down {
  opacity: 0.6;
}
.radio-state {
  color: var(--color-state-down);
}
.radio-off,
.no-clients {
  color: var(--color-text-dim);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.chip {
  padding: 1px 6px;
  border: 1px solid color-mix(in oklch, var(--row-color) 45%, transparent);
  border-radius: var(--radius-pill);
  background: var(--color-bg-tile);
  color: var(--color-text-secondary);
  white-space: nowrap;
  cursor: default;
}
a.chip {
  cursor: pointer;
}
a.chip:hover,
a.chip:focus-visible {
  color: var(--color-text-accent);
  outline: none;
}

/* Cross-highlight: the traced access point's column stays, the others fade. */
.wifi-grid.is-tracing .ap-head:not(.is-traced),
.wifi-grid.is-tracing .cell:not(.is-traced) {
  opacity: 0.45;
}

.empty-state {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text-dim);
  padding: 18px;
  margin: 0;
  text-align: center;
  background: var(--color-bg-tile);
  border: 1px dashed var(--color-border-dashed);
  border-radius: var(--radius-lg);
}

@media (prefers-reduced-motion: reduce) {
  .topo-wifi,
  .ap-head,
  .row-head,
  .cell {
    transition: none;
  }
}
</style>
