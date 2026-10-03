<script setup lang="ts">
import { provide, reactive } from 'vue'
import ErrorPage from './components/ErrorPage.vue'
import InventorySkeleton from './components/InventorySkeleton.vue'
import LabToolbar from './components/LabToolbar.vue'
import LabTree from './components/LabTree.vue'
import NoticeBanner from './components/NoticeBanner.vue'
import { useLab } from './composables/useLab'
import { statusPhaseKey } from './injection'

const labState = useLab()
const lab = reactive(labState)
provide(statusPhaseKey, labState.livePhase)
</script>

<template>
  <main class="homelab-app">
    <ErrorPage
      v-if="lab.view === 'fatal'"
      :message="lab.fatalError ?? 'Unknown error.'"
      :retrying="lab.isRefreshing"
      @retry="labState.refresh"
    />

    <InventorySkeleton v-else-if="lab.view === 'loading'" />

    <template v-else>
      <LabToolbar
        :refreshing="lab.isRefreshing"
        :updated-at="lab.updatedAt"
        :counts="lab.counts"
        @refresh="labState.refresh"
      />
      <NoticeBanner v-if="lab.refreshError">
        The inventory could not be refreshed; the inventory is from {{ lab.inventoryTimeText }}. {{ lab.refreshError }}
      </NoticeBanner>
      <NoticeBanner v-if="lab.statusPhase === 'failed'">
        <template v-if="lab.hasStatusData">
          Live statuses could not be refreshed; showing last known data. {{ lab.statusError }}
        </template>
        <template v-else>
          Live statuses are unavailable; none shown. {{ lab.statusError }}
        </template>
      </NoticeBanner>
      <NoticeBanner v-if="lab.containerStatusPhase === 'failed'">
        <template v-if="lab.hasContainerStatusData">
          Live container states could not be refreshed; showing last known data. {{ lab.containerStatusError }}
        </template>
        <template v-else>
          Live container states are unavailable; none shown. {{ lab.containerStatusError }}
        </template>
      </NoticeBanner>
      <NoticeBanner v-if="lab.proxmoxPhase === 'failed'">
        <template v-if="lab.hasProxmoxData">
          Proxmox data could not be refreshed; showing last known data. {{ lab.proxmoxError }}
        </template>
        <template v-else>
          Proxmox data is unavailable; none shown. {{ lab.proxmoxError }}
        </template>
      </NoticeBanner>

      <p v-if="lab.view === 'empty'" class="empty-state">
        NetBox returned no machines or containers.
      </p>
      <LabTree v-else-if="lab.tree" :tree="lab.tree" />
    </template>
  </main>
</template>

<style>
*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  background: var(--color-bg-page);
  font-family: var(--font-sans);
  color: var(--color-text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: inherit;
  text-decoration: none;
}
a:hover {
  color: inherit;
}

.homelab-app {
  width: 100%;
  min-height: 100vh;
  box-sizing: border-box;
  background: var(--color-bg-page);
  padding: 18px 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
