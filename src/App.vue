<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, defineAsyncComponent, onMounted, provide, reactive, ref, watch, watchEffect } from 'vue'
import AppHeader from './components/AppHeader.vue'
import ArpPage from './components/ArpPage.vue'
import ErrorPage from './components/ErrorPage.vue'
import InventorySkeleton from './components/InventorySkeleton.vue'
import LabTree from './components/LabTree.vue'
import LoadingSpinner from './components/LoadingSpinner.vue'
import NoticeBanner from './components/NoticeBanner.vue'
import { useArp } from './composables/useArp'
import { useFocusTarget } from './composables/useFocusTarget'
import { useLab } from './composables/useLab'
import { useSourceStatuses } from './composables/useSourceStatuses'
import { useWifi } from './composables/useWifi'
import { useZigbee } from './composables/useZigbee'
import { countViews } from './domain/arp'
import type { Machine } from './domain/model'
import { statusPhaseKey, topologyDevicesKey } from './injection'
import { parseRoute, routeHash, type Page } from './presentation/route'

/** The Topology page and elkjs come in their own chunk, loaded on the first visit. */
const TopologyPage = defineAsyncComponent({
  loader: () => import('./components/TopologyPage.vue'),
  loadingComponent: LoadingSpinner,
  delay: 150,
})

const arp = useArp()
const sources = useSourceStatuses()
const wifi = useWifi()
const zigbee = useZigbee()
const labState = useLab(arp.presence)
const lab = reactive(labState)
provide(statusPhaseKey, labState.livePhase)
provide(topologyDevicesKey, labState.topologyDevices)

const hash = ref(typeof window === 'undefined' ? '' : window.location.hash)
useEventListener('hashchange', () => {
  hash.value = window.location.hash
})
const route = computed(() => parseRoute(hash.value))
const page = computed<Page>(() => route.value.page)
const arpDisconnected = computed(() => countViews(arp.rows.value.values()).disconnected)

const TITLES: Record<Page, string> = { hosts: 'Hosts', topology: 'Topology', arp: 'ARP' }
watchEffect(() => {
  if (typeof document !== 'undefined') document.title = `Homelab · ${TITLES[page.value]}`
})

const machinesById = computed(
  () => new Map<string, Machine>((lab.tree?.machines ?? []).map((m) => [m.id, m])),
)
/** No topology and the inventory status explains why (none is on its way). */
const topologyUnavailable = computed(() => (lab.topology ? null : lab.inventoryError ?? lab.topologyError))

/* Each page keeps its own scroll position; restored when the page enters again. */
if (typeof window !== 'undefined' && 'scrollRestoration' in history) history.scrollRestoration = 'manual'
const scrollPositions: Partial<Record<Page, number>> = {}
watch(page, (_to, from) => {
  scrollPositions[from] = window.scrollY
})

/*
 * `?focus=<deviceId>`: once the page has entered, its target is scrolled into view and
 * highlighted, then the parameter is dropped (replaceState) so reload and Back do not replay
 * it. The focus wins over the restored scroll position.
 */
const appRoot = ref<HTMLElement | null>(null)
const focus = useFocusTarget({
  root: () => appRoot.value ?? document,
  clear: (id) => {
    if (route.value.focus !== id) return
    const next = routeHash(page.value)
    history.replaceState(history.state, '', next)
    hash.value = next
  },
})
function restoreScroll() {
  if (!route.value.focus) window.scrollTo(0, scrollPositions[page.value] ?? 0)
}
function onPageEntered() {
  if (route.value.focus) focus.show(route.value.focus)
}
/* A new focus on the page already shown (no transition), and a focus in the opening URL. */
watch(
  () => route.value,
  (to, from) => {
    if (to.focus && from && to.page === from.page && to.focus !== from.focus) focus.show(to.focus)
  },
)
onMounted(() => {
  if (route.value.focus) focus.show(route.value.focus)
})
</script>

<template>
  <main ref="appRoot" class="homelab-app">
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

    <Transition name="page" mode="out-in" @enter="restoreScroll" @after-enter="onPageEntered">
      <ArpPage
        v-if="page === 'arp'"
        key="arp"
        :rows="arp.rows.value"
        :phase="arp.phase.value"
        :error-message="arp.errorMessage.value"
      />

      <div v-else-if="page === 'topology'" key="topology" class="hosts-page">
        <ErrorPage
          v-if="lab.view === 'fatal'"
          :message="lab.fatalError ?? 'Unknown error.'"
          :retrying="lab.isRefreshing"
          @retry="labState.refresh"
        />
        <template v-else>
          <NoticeBanner v-if="lab.refreshError && lab.topology">
            The inventory could not be refreshed; the topology is from {{ lab.inventoryTimeText }}. {{ lab.refreshError }}
          </NoticeBanner>
          <NoticeBanner v-else-if="lab.topologyError && lab.topology">
            The topology could not be refreshed; showing the cabling from an earlier read. {{ lab.topologyError }}
          </NoticeBanner>
          <TopologyPage
            :topology="lab.topology"
            :machines="machinesById"
            :presence="arp.presence.value"
            :unavailable="topologyUnavailable"
            :wifi="wifi.data.value"
            :wifi-error="wifi.errorMessage.value"
            :zigbee="zigbee.data.value"
          />
        </template>
      </div>

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

/* The target of a `?focus=` jump: a short accent pulse (a static outline with reduced motion). */
[data-focus-flash] {
  outline: 2px solid var(--color-text-accent);
  outline-offset: 3px;
  animation: focus-pulse 0.8s ease-out 2;
}
@keyframes focus-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in oklch, var(--color-text-accent) 55%, transparent);
  }
  100% {
    box-shadow: 0 0 0 14px transparent;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-focus-flash] {
    animation: none;
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
