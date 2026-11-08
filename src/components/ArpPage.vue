<script setup lang="ts">
import { computed, ref } from 'vue'
import { compareAddresses, countViews, matchesView, type ArpRows, type ArpView } from '../domain/arp'
import type { ArpPhase } from '../composables/useArp'
import NoticeBanner from './NoticeBanner.vue'

const props = defineProps<{
  rows: ArpRows
  phase: ArpPhase
  errorMessage: string | null
}>()

const VIEWS: { id: ArpView; label: string }[] = [
  { id: 'all', label: 'all' },
  { id: 'unknown', label: 'unknown' },
  { id: 'active', label: 'active' },
  { id: 'disconnected', label: 'disconnected' },
]

const view = ref<ArpView>('all')
const counts = computed(() => countViews(props.rows.values()))
const visible = computed(() =>
  [...props.rows.values()]
    .filter((row) => matchesView(row, view.value))
    .sort((a, b) => compareAddresses(a.address, b.address)),
)
</script>

<template>
  <section class="arp-page">
    <header class="arp-header">
      <div class="arp-title-row">
        <a class="back-link" href="#/">homelab</a>
        <span class="arp-title">/ arp</span>
        <span class="arp-live" :class="`phase-${phase}`">
          <span class="live-dot"></span>{{ phase === 'live' ? 'live' : phase === 'loading' ? 'connecting…' : 'offline' }}
        </span>
      </div>
      <nav class="arp-views" aria-label="ARP views">
        <button
          v-for="v in VIEWS"
          :key="v.id"
          type="button"
          class="view-btn"
          :class="{ 'is-active': view === v.id }"
          @click="view = v.id"
        >
          {{ v.label }} <span class="view-count">{{ counts[v.id] }}</span>
        </button>
      </nav>
    </header>

    <NoticeBanner v-if="errorMessage">
      {{ errorMessage }}<template v-if="rows.size"> Showing the last received table.</template>
    </NoticeBanner>

    <div class="arp-table-wrap">
      <table class="arp-table">
        <thead>
          <tr>
            <th></th>
            <th>address</th>
            <th>mac</th>
            <th>interface</th>
            <th>status</th>
            <th>netbox</th>
            <th>port</th>
            <th>description</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visible" :key="row.id" :class="[`presence-${row.presence}`, { 'is-unknown': !row.netbox }]">
            <td><span class="presence-dot" :title="row.presence"></span></td>
            <td class="mono">{{ row.address }}</td>
            <td class="mono dim">{{ row.mac || '—' }}</td>
            <td class="dim">{{ row.interface }}</td>
            <td class="mono">
              {{ row.status || '—' }}<span v-if="row.dhcp" class="flag" title="DHCP static lease">dhcp</span>
            </td>
            <td>
              <template v-if="row.netbox">
                <a v-if="row.netbox.url" :href="row.netbox.url" target="_blank" rel="noopener" class="nb-name">{{ row.netbox.name }}</a>
                <span v-else class="nb-name">{{ row.netbox.name }}</span>
                <span class="nb-kind">{{ row.netbox.kind === 'vm' ? 'vm' : row.netbox.role ?? 'device' }}</span>
              </template>
              <span v-else class="unknown-label">unknown</span>
            </td>
            <td class="mono dim">{{ row.netbox?.interface ?? '' }}</td>
            <td class="dim">{{ row.netbox?.description ?? '' }}</td>
          </tr>
          <tr v-if="!visible.length">
            <td colspan="8" class="empty">{{ phase === 'loading' ? 'Waiting for the router…' : 'No entries.' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.arp-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-secondary);
}

.arp-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.arp-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.back-link,
.arp-title {
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-text-title);
}

.back-link:hover {
  color: var(--color-text-host);
  text-decoration: underline;
}

.arp-live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-dim);
}

.live-dot,
.presence-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  box-sizing: border-box;
  border: 1.5px dashed var(--color-state-unknown-dot);
}

.phase-live { color: var(--color-state-up); }
.phase-live .live-dot { background: var(--color-state-up); border: none; }
.phase-failed { color: var(--color-state-down); }
.phase-failed .live-dot { background: var(--color-state-down); border: none; }

.arp-views {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.view-btn {
  background: var(--color-bg-spine);
  border: 1px solid var(--color-border-guest);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
}

.view-btn:hover { background: var(--color-bg-hover-dim); }
.view-btn.is-active { color: var(--color-text-title); border-color: var(--color-border-btn-hover); }
.view-count { color: var(--color-text-dim); margin-left: 4px; }

.arp-table-wrap {
  overflow-x: auto;
  background: var(--color-bg-tile);
  border: 1px solid var(--color-border-tile);
  border-radius: var(--radius-lg);
}

.arp-table {
  width: 100%;
  border-collapse: collapse;
}

.arp-table th {
  text-align: left;
  font-weight: 500;
  color: var(--color-text-dim);
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border-spine);
  white-space: nowrap;
}

.arp-table td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--color-border-tile);
  white-space: nowrap;
}

.arp-table tbody tr:hover { background: var(--color-bg-spine); }
.mono { font-family: var(--font-mono); color: var(--color-text-primary); }
.dim { color: var(--color-text-muted); }

.presence-active .presence-dot { background: var(--color-state-up); border: none; }
.presence-disconnected .presence-dot { background: transparent; border: 1.5px solid var(--color-state-down); }
.presence-disconnected td { color: var(--color-text-stopped); }

.flag {
  margin-left: 6px;
  font-size: 10px;
  color: var(--color-text-dim);
}

.nb-name { color: var(--color-text-host); }
a.nb-name:hover { text-decoration: underline; }
.nb-kind { margin-left: 6px; font-size: 10px; color: var(--color-text-dim); }

.unknown-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-accent);
}

.empty {
  text-align: center;
  color: var(--color-text-empty);
  padding: 20px;
}
</style>
