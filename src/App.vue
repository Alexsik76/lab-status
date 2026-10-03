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
provide(statusPhaseKey, labState.statusPhase)
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
        The inventory could not be refreshed, showing the last loaded data. {{ lab.refreshError }}
      </NoticeBanner>
      <NoticeBanner v-if="lab.statusPhase === 'failed'">
        Live statuses are unavailable, so states are shown as unknown. {{ lab.statusError }}
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
  background: oklch(0.15 0.008 250);
  font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: oklch(0.93 0.006 250);
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
  background: oklch(0.15 0.008 250);
  padding: 18px 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-state {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
  color: oklch(0.55 0.012 250);
  padding: 24px;
  text-align: center;
  background: oklch(0.19 0.009 250);
  border: 1px dashed oklch(0.3 0.01 250);
  border-radius: 8px;
}
</style>
