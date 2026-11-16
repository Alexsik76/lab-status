<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, provide, reactive, ref, watch, watchEffect } from 'vue'
import AppHeader, { type Page } from './components/AppHeader.vue'
import ArpPage from './components/ArpPage.vue'
import ErrorPage from './components/ErrorPage.vue'
import InventorySkeleton from './components/InventorySkeleton.vue'
import LabTree from './components/LabTree.vue'
import NoticeBanner from './components/NoticeBanner.vue'
import { useArp } from './composables/useArp'
import { useLab } from './composables/useLab'
import { useSourceStatuses } from './composables/useSourceStatuses'
import { countViews } from './domain/arp'
import { statusPhaseKey } from './injection'

const arp = useArp()
const sources = useSourceStatuses()
const labState = useLab(arp.presence)
const lab = reactive(labState)
provide(statusPhaseKey, labState.livePhase)

const hash = ref(typeof window === 'undefined' ? '' : window.location.hash)
useEventListener('hashchange', () => {
  hash.value = window.location.hash
})
const page = computed<Page>(() => (hash.value === '#/arp' ? 'arp' : 'hosts'))
const arpDisconnected = computed(() => countViews(arp.rows.value.values()).disconnected)

watchEffect(() => {
  if (typeof document !== 'undefined') document.title = `Homelab · ${page.value === 'arp' ? 'ARP' : 'Hosts'}`
})

/* Each page keeps its own scroll position; restored when the page enters again. */
if (typeof window !== 'undefined' && 'scrollRestoration' in history) history.scrollRestoration = 'manual'
const scrollPositions: Partial<Record<Page, number>> = {}
watch(page, (_to, from) => {
  scrollPositions[from] = window.scrollY
})
function restoreScroll() {
  window.scrollTo(0, scrollPositions[page.value] ?? 0)
}
</script>

<template>
  <main class="homelab-app">
    <AppHeader
      :page="page"
      :counts="lab.counts"
      :refreshing="lab.isRefreshing"
      :updated-at="lab.updatedAt"
      :statuses="sources.statuses.value"
      :stream-state="sources.streamState.value"
      :arp-phase="arp.phase.value"
      :arp-disconnected="arpDisconnected"
      @refresh="labState.refresh"
    />

    <Transition name="page" mode="out-in" @enter="restoreScroll">
      <ArpPage
        v-if="page === 'arp'"
        key="arp"
        :rows="arp.rows.value"
        :phase="arp.phase.value"
        :error-message="arp.errorMessage.value"
      />

      <div v-else key="hosts" class="hosts-page">
        <ErrorPage
          v-if="lab.view === 'fatal'"
          :message="lab.fatalError ?? 'Unknown error.'"
          :retrying="lab.isRefreshing"
          @retry="labState.refresh"
        />

        <InventorySkeleton v-else-if="lab.view === 'loading'" />

        <template v-else>
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
      </div>
    </Transition>
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

.hosts-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Page change: a short, barely visible fade with a 4px drift. */
.page-enter-active,
.page-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.page-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active {
    transition: none;
  }
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
